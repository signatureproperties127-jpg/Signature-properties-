'use strict';

const { parse: csvParse } = require('csv-parse/sync');
const xlsx = require('xlsx');
const {
  loadConfig,
  matchArea,
  normalizeStatus,
  RERA_REGEX,
  REGISTRATION_WINDOW_YEARS
} = require('./reraConfig');

/**
 * ReraImportService — CSV / Excel bulk import of Gujarat RERA project data
 * into the existing Inventory collection with IsReraMaster=true.
 *
 * Pipeline: parse -> normalize columns -> row filter (area + 10yr window)
 * -> aggregate by RERANumber -> dedup vs existing Inventory -> insert/update.
 */

// Canonical output field name  ->  candidate source column headers (any match)
const COLUMN_ALIASES = {
  RERANumber:           ['reranumber', 'rera number', 'rera registration number', 'rera no', 'registration number', 'reraid'],
  ProjectName:          ['projectname', 'project name', 'project', 'name of project'],
  BuilderName:          ['buildername', 'builder name', 'promoter name', 'promotername', 'promoter', 'developer'],
  ProjectStatus:        ['projectstatus', 'project status', 'status'],
  Location1:            ['location', 'location1', 'locality', 'area', 'project location', 'address', 'projectaddress'],
  Taluka:               ['taluka', 'sub district', 'subdistrict', 'tehsil'],
  Village:              ['village', 'gaam', 'village name'],
  UnitType:             ['unittype', 'unit type', 'apartmenttype', 'apartment type', 'configuration', 'bhk', 'type'],
  UnitCount:            ['unitcount', 'unit count', 'no of units', 'number of units', 'totalunit', 'total units', 'units'],
  CarpetAreaSqft:       ['carpetarea', 'carpet area', 'carpet area sqft', 'carpetareasqft', 'carpet'],
  CarpetAreaSqm:        ['carpetareasqm', 'carpet area sqm'],
  PossessionDate:       ['possessiondate', 'possession date', 'possession', 'proposeddateofcompletion', 'completion date'],
  LandAreaSqm:          ['landarea', 'land area', 'landareasqm', 'land area sqm', 'plot area', 'total area'],
  RERARegistrationDate: ['reraregistrationdate', 'registration date', 'rera registration date', 'registrationdate', 'dateofregistration']
};

class ReraImportService {
  constructor(repository) {
    this.repo = repository;
  }

  // ── Parsing ──────────────────────────────────────────────────────────────
  parseBuffer(fileBuffer, filename = '') {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const wb = xlsx.read(fileBuffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return xlsx.utils.sheet_to_json(sheet, { defval: '' });
    }
    // Default CSV
    const text = Buffer.isBuffer(fileBuffer) ? fileBuffer.toString('utf8') : String(fileBuffer);
    return csvParse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
      bom: true
    });
  }

  // Detect and return mapping: sourceHeader -> canonicalField
  detectColumnMap(sampleRow) {
    const headers = Object.keys(sampleRow || {});
    const map = {}; // sourceHeader -> canonical
    const seen = new Set();

    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
      const aliasSet = new Set(aliases.map((a) => a.toLowerCase().replace(/[\s_]/g, '')));
      const hit = headers.find((h) => {
        const norm = String(h || '').toLowerCase().replace(/[\s_]/g, '');
        return aliasSet.has(norm);
      });
      if (hit && !seen.has(hit)) {
        map[hit] = canonical;
        seen.add(hit);
      }
    }
    return map;
  }

  // Apply column map to a row -> normalized row keyed by canonical field
  applyMap(row, columnMap) {
    const out = {};
    for (const [source, canonical] of Object.entries(columnMap)) {
      out[canonical] = row[source];
    }
    return out;
  }

  // ── Value parsing helpers ────────────────────────────────────────────────
  _parseDate(raw) {
    if (!raw && raw !== 0) return null;
    if (raw instanceof Date && !isNaN(raw)) return raw;
    const s = String(raw).trim();
    if (!s) return null;
    // Try ISO / YYYY-MM-DD first
    const iso = new Date(s);
    if (!isNaN(iso)) return iso;
    // Try DD/MM/YYYY or DD-MM-YYYY
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      let [, dd, mm, yy] = m;
      if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
      const d = new Date(Number(yy), Number(mm) - 1, Number(dd));
      if (!isNaN(d)) return d;
    }
    // Excel serial (numeric)
    if (/^\d+(\.\d+)?$/.test(s)) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const d = new Date(excelEpoch + Number(s) * 86400000);
      if (!isNaN(d)) return d;
    }
    return null;
  }

  _parseInt(v) {
    if (v == null || v === '') return null;
    const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return isNaN(n) ? null : n;
  }

  _parseFloat(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? null : n;
  }

  _normalizeConfig(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toUpperCase()
      .replace(/BEDROOM(S)?/g, 'BHK')
      .replace(/\s+/g, '');
    // 1BHK, 2BHK, 3BHK etc.
    const m = s.match(/(\d+(?:\.\d+)?)\s*(BHK|RK)/);
    if (m) return `${m[1]}${m[2]}`;
    return s || null;
  }

  // ── Validation + Filtering ───────────────────────────────────────────────
  _cutoffDate() {
    const t = new Date();
    t.setFullYear(t.getFullYear() - REGISTRATION_WINDOW_YEARS);
    return t;
  }

  // ── Aggregation ──────────────────────────────────────────────────────────
  // Group parsed rows by RERANumber (RERA CSVs list unit-types as separate rows)
  aggregate(mappedRows, cfg) {
    const grouped = new Map();
    const outOfArea = [];
    const tooOld = [];
    const invalidRera = [];
    const other = [];
    const cutoff = this._cutoffDate();

    for (const r of mappedRows) {
      const rera = String(r.RERANumber || '').trim();
      if (!rera) { other.push({ row: r, reason: 'Missing RERANumber' }); continue; }
      if (!RERA_REGEX.test(rera)) { invalidRera.push({ RERANumber: rera, reason: `Bad format (expected PR/GJ/SURAT/.../XXX/DDMMYY)` }); continue; }

      const regDate = this._parseDate(r.RERARegistrationDate);
      if (regDate && regDate < cutoff) { tooOld.push({ RERANumber: rera, RegistrationDate: regDate.toISOString().slice(0, 10) }); continue; }

      const matchedArea = matchArea(r, cfg);
      if (!matchedArea) { outOfArea.push({ RERANumber: rera, Village: r.Village, Location: r.Location1 }); continue; }

      const key = rera;
      if (!grouped.has(key)) {
        grouped.set(key, {
          RERANumber: rera,
          ProjectName: String(r.ProjectName || '').trim() || null,
          BuilderName: String(r.BuilderName || '').trim() || null,
          ProjectStatus: normalizeStatus(r.ProjectStatus),
          Location1: matchedArea,
          Taluka: String(r.Taluka || '').trim() || null,
          Village: String(r.Village || '').trim() || null,
          Configurations: new Set(),
          TotalUnits: 0,
          _CarpetMin: null,
          _CarpetMax: null,
          PossessionDate: regDate && this._parseDate(r.PossessionDate)
            ? this._parseDate(r.PossessionDate).toISOString().slice(0, 10)
            : (this._parseDate(r.PossessionDate) ? this._parseDate(r.PossessionDate).toISOString().slice(0, 10) : null),
          LandArea: this._parseFloat(r.LandAreaSqm),
          RERARegistrationDate: regDate ? regDate.toISOString().slice(0, 10) : null
        });
      }
      const g = grouped.get(key);
      // Aggregate unit-level info
      const cfgLabel = this._normalizeConfig(r.UnitType);
      if (cfgLabel) g.Configurations.add(cfgLabel);
      const units = this._parseInt(r.UnitCount);
      if (units) g.TotalUnits += units;
      let carpet = this._parseFloat(r.CarpetAreaSqft);
      if (!carpet && r.CarpetAreaSqm) carpet = this._parseFloat(r.CarpetAreaSqm) * 10.7639;
      if (carpet) {
        if (g._CarpetMin == null || carpet < g._CarpetMin) g._CarpetMin = Math.round(carpet);
        if (g._CarpetMax == null || carpet > g._CarpetMax) g._CarpetMax = Math.round(carpet);
      }
    }

    const projects = Array.from(grouped.values()).map((g) => {
      const out = { ...g, Configurations: Array.from(g.Configurations).sort() };
      if (g._CarpetMin != null || g._CarpetMax != null) {
        out.AreaRange = { min: g._CarpetMin, max: g._CarpetMax };
      } else {
        out.AreaRange = null;
      }
      delete out._CarpetMin;
      delete out._CarpetMax;
      return out;
    });

    return { projects, outOfArea, tooOld, invalidRera, other };
  }

  // ── Preview (no persistence) ─────────────────────────────────────────────
  preview(fileBuffer, filename, columnMap = null) {
    let rows;
    try {
      rows = this.parseBuffer(fileBuffer, filename);
    } catch (e) {
      return { ok: false, error: `Parse failed: ${e.message}` };
    }
    if (!rows.length) return { ok: false, error: 'Empty file' };

    const cfg = loadConfig(this.repo);
    const detected = this.detectColumnMap(rows[0]);
    const effectiveMap = columnMap && Object.keys(columnMap).length ? columnMap : detected;

    // Warn if required columns missing
    const canonicalsFound = new Set(Object.values(effectiveMap));
    const required = ['RERANumber', 'ProjectName'];
    const missingRequired = required.filter((r) => !canonicalsFound.has(r));

    const mapped = rows.map((r) => this.applyMap(r, effectiveMap));
    const agg = this.aggregate(mapped, cfg);

    return {
      ok: true,
      data: {
        totalRows: rows.length,
        detectedColumns: Object.keys(rows[0]),
        columnMap: effectiveMap,
        missingRequired,
        summary: {
          projects: agg.projects.length,
          outOfArea: agg.outOfArea.length,
          tooOld: agg.tooOld.length,
          invalidRera: agg.invalidRera.length,
          other: agg.other.length
        },
        samples: {
          projects: agg.projects.slice(0, 20),
          outOfArea: agg.outOfArea.slice(0, 5),
          tooOld: agg.tooOld.slice(0, 5),
          invalidRera: agg.invalidRera.slice(0, 10),
          other: agg.other.slice(0, 5)
        },
        areasConfig: cfg.areas,
        registrationCutoff: this._cutoffDate().toISOString().slice(0, 10)
      }
    };
  }

  // ── Fields safe to overwrite on existing rows (RERA-authoritative) ───────
  _safeUpdateFields(agg) {
    return {
      ProjectStatus: agg.ProjectStatus,
      PossessionDate: agg.PossessionDate,
      Configurations: agg.Configurations,
      TotalUnits: agg.TotalUnits,
      AreaRange: agg.AreaRange,
      LandArea: agg.LandArea,
      Location1: agg.Location1,
      Taluka: agg.Taluka,
      Village: agg.Village,
      RERARegistrationDate: agg.RERARegistrationDate
    };
  }

  // ── Commit (persistence) ─────────────────────────────────────────────────
  commit(fileBuffer, filename, columnMap = null, options = {}) {
    const previewResult = this.preview(fileBuffer, filename, columnMap);
    if (!previewResult.ok) return previewResult;

    const { projects } = this.aggregate(
      this.parseBuffer(fileBuffer, filename).map((r) => this.applyMap(r, columnMap || previewResult.data.columnMap)),
      loadConfig(this.repo)
    );

    const db = this.repo.read();
    db.Inventory = db.Inventory || [];
    const byRera = new Map();
    for (const p of db.Inventory) {
      if (p.RERANumber) byRera.set(String(p.RERANumber).toUpperCase(), p);
    }

    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    const insertedIds = [];
    const updatedIds = [];
    const flagNeedsReview = !!options.needsReview;

    for (const agg of projects) {
      const existing = byRera.get(agg.RERANumber.toUpperCase());
      if (existing) {
        Object.assign(existing, this._safeUpdateFields(agg), { UpdatedAt: now });
        updated += 1;
        updatedIds.push(existing.PropertyID);
      } else {
        const propertyId = this.repo.createId('PROP');
        // RERA projects are ~99% flats/apartments. Default SubCategory=Flat so
        // SmartMatch and reverse match can find them. Copy first config → BHK.
        const firstCfg = (agg.Configurations || [])[0];
        const bhkMatch = firstCfg ? firstCfg.match(/^(\d+(?:\.\d+)?)/) : null;
        const bhkValue = bhkMatch ? bhkMatch[1] + ' BHK' : null;
        const row = {
          PropertyID: propertyId,
          Title: `${agg.ProjectName || 'Untitled Project'} — ${agg.BuilderName || 'Unknown Builder'}`,
          Category: 'Residential',
          SubCategory: 'Flat',
          BHK: bhkValue,
          ListingFor: 'Sale',
          ListingStatus: 'Available',
          Status: null,
          InventorySource: 'Builder',
          IsReraMaster: true,
          NeedsReview: flagNeedsReview,
          RERANumber: agg.RERANumber,
          ProjectName: agg.ProjectName,
          BuilderName: agg.BuilderName,
          ProjectStatus: agg.ProjectStatus,
          Location1: agg.Location1,
          Taluka: agg.Taluka,
          Village: agg.Village,
          Configurations: agg.Configurations,
          TotalUnits: agg.TotalUnits || null,
          AreaRange: agg.AreaRange,
          CarpetArea: agg.AreaRange ? agg.AreaRange.min : null,
          PossessionDate: agg.PossessionDate,
          LandArea: agg.LandArea,
          RERARegistrationDate: agg.RERARegistrationDate,
          ProjectURL: null,
          ImportedFrom: options.importedFrom || 'GujRERA-CSV',
          ImportedAt: now,
          AskingPrice: null,
          AskingRatePerSqFt: null,
          Photos: [],
          CreatedAt: now,
          UpdatedAt: now,
          CreatedBy: options.userId || 'system'
        };
        db.Inventory.push(row);
        byRera.set(agg.RERANumber.toUpperCase(), row);
        inserted += 1;
        insertedIds.push(propertyId);
      }
    }

    // Write import history
    db._ReraImports = db._ReraImports || [];
    const importRecord = {
      ImportID: this.repo.createId('RIMP'),
      Source: options.importedFrom || 'GujRERA-CSV',
      Filename: filename,
      RunAt: now,
      RunBy: options.userId || 'system',
      Inserted: inserted,
      Updated: updated,
      SkippedOutOfArea: previewResult.data.summary.outOfArea,
      SkippedTooOld: previewResult.data.summary.tooOld,
      InvalidRera: previewResult.data.summary.invalidRera,
      Other: previewResult.data.summary.other,
      InsertedPropertyIDs: insertedIds,
      UpdatedPropertyIDs: updatedIds
    };
    db._ReraImports.unshift(importRecord);
    if (db._ReraImports.length > 100) db._ReraImports = db._ReraImports.slice(0, 100);

    this.repo.write(db);

    return {
      ok: true,
      data: {
        ...importRecord,
        errorSamples: {
          invalidRera: previewResult.data.samples.invalidRera,
          other: previewResult.data.samples.other,
          outOfArea: previewResult.data.samples.outOfArea,
          tooOld: previewResult.data.samples.tooOld
        }
      }
    };
  }

  listHistory(limit = 20) {
    const db = this.repo.read();
    const rows = (db._ReraImports || []).slice(0, limit);
    return { ok: true, data: rows, count: rows.length };
  }
}

module.exports = { ReraImportService, COLUMN_ALIASES };
