'use strict';

const { fetchAllSuratRows, MODE: SCRAPER_MODE } = require('./reraPortalClient');
const { ReraImportService } = require('./reraImportService');
const { loadConfig, matchArea, normalizeArea } = require('./reraConfig');

/**
 * ReraScraperService — quarterly (or on-demand) scraper for the Gujarat RERA
 * portal (District = Surat). Per-area job structure so a single-area failure
 * doesn't block the others. Delegates final row aggregation + insert/update
 * to ReraImportService.commit() so the code path is identical to CSV import.
 *
 * All newly-inserted rows get NeedsReview=true.
 */

const THROTTLE_MS = Number(process.env.RERA_SCRAPER_THROTTLE_MS || 2500);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class ReraScraperService {
  constructor(repository) {
    this.repo = repository;
    this.importer = new ReraImportService(repository);
  }

  _now() { return new Date().toISOString(); }

  // Convert row array back to a CSV Buffer so we can reuse ReraImportService
  _rowsToCsvBuffer(rows) {
    if (!rows.length) return Buffer.from('', 'utf8');
    const keys = ['RERANumber', 'ProjectName', 'BuilderName', 'ProjectStatus', 'Village', 'Location1', 'Taluka', 'UnitType', 'UnitCount', 'CarpetAreaSqft', 'PossessionDate', 'LandAreaSqm', 'RERARegistrationDate'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = keys.join(',');
    const body = rows.map((r) => keys.map((k) => esc(r[k])).join(',')).join('\n');
    return Buffer.from(header + '\n' + body, 'utf8');
  }

  async run({ triggeredBy = 'manual', userId = 'system' } = {}) {
    const runId = this.repo.createId('SCRAPE');
    const startedAt = this._now();
    const cfg = loadConfig(this.repo);

    // Fetch once for the whole district
    let allRows;
    let fetchMode;
    try {
      const fetched = await fetchAllSuratRows();
      allRows = fetched.rows;
      fetchMode = fetched.mode;
    } catch (e) {
      const errRecord = {
        RunID: runId,
        TriggeredBy: triggeredBy,
        StartedAt: startedAt,
        FinishedAt: this._now(),
        Mode: SCRAPER_MODE,
        Status: 'FAILED',
        Error: e.code || e.message,
        ErrorMessage: e.message,
        Areas: [],
        TotalInserted: 0,
        TotalUpdated: 0
      };
      this._saveRun(errRecord);
      return { ok: false, error: e.message, data: errRecord };
    }

    // Bucket rows per configured area (client-side, since portal has no locality filter)
    const buckets = new Map();
    for (const a of cfg.areas) buckets.set(a, []);
    const outOfArea = [];
    for (const row of allRows) {
      const hit = matchArea(row, cfg);
      if (!hit) { outOfArea.push(row); continue; }
      // If matchArea returned an area that isn't exactly in our list (case), fall back to first fuzzy match
      const bucketKey = cfg.areas.find((a) => normalizeArea(a) === normalizeArea(hit)) || hit;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey).push(row);
    }

    // Per-area jobs — each area runs independently with throttle
    const areaResults = [];
    let totalInserted = 0;
    let totalUpdated = 0;
    const allInsertedIds = [];
    let idx = 0;
    for (const [area, rows] of buckets.entries()) {
      const areaStart = this._now();
      if (idx > 0) await sleep(THROTTLE_MS); // between-area throttle
      idx += 1;

      try {
        if (!rows.length) {
          areaResults.push({ Area: area, Status: 'OK', RowCount: 0, Inserted: 0, Updated: 0, Note: 'No projects returned', StartedAt: areaStart, FinishedAt: this._now() });
          continue;
        }
        const csvBuffer = this._rowsToCsvBuffer(rows);
        const commitResult = this.importer.commit(csvBuffer, `scraper-${area.toLowerCase()}.csv`, null, {
          needsReview: true,
          userId,
          importedFrom: 'GujRERA-Scraper'
        });
        if (!commitResult.ok) throw new Error(commitResult.error || 'Commit failed');
        const d = commitResult.data;
        totalInserted += d.Inserted;
        totalUpdated += d.Updated;
        allInsertedIds.push(...(d.InsertedPropertyIDs || []));
        areaResults.push({
          Area: area,
          Status: 'OK',
          RowCount: rows.length,
          Inserted: d.Inserted,
          Updated: d.Updated,
          SkippedOutOfArea: d.SkippedOutOfArea,
          SkippedTooOld: d.SkippedTooOld,
          InvalidRera: d.InvalidRera,
          Other: d.Other,
          ImportID: d.ImportID,
          StartedAt: areaStart,
          FinishedAt: this._now()
        });
      } catch (e) {
        areaResults.push({
          Area: area,
          Status: 'FAILED',
          RowCount: rows.length,
          Inserted: 0,
          Updated: 0,
          Error: e.message,
          StartedAt: areaStart,
          FinishedAt: this._now()
        });
      }
    }

    const record = {
      RunID: runId,
      TriggeredBy: triggeredBy,
      StartedAt: startedAt,
      FinishedAt: this._now(),
      Mode: SCRAPER_MODE,
      FetchMode: fetchMode,
      Status: areaResults.some((a) => a.Status === 'FAILED') ? 'PARTIAL' : 'OK',
      TotalRowsFetched: allRows.length,
      TotalRowsOutOfArea: outOfArea.length,
      TotalInserted: totalInserted,
      TotalUpdated: totalUpdated,
      Areas: areaResults,
      InsertedPropertyIDs: allInsertedIds
    };
    this._saveRun(record);
    return { ok: true, data: record };
  }

  _saveRun(record) {
    const db = this.repo.read();
    db._ReraScrapeRuns = db._ReraScrapeRuns || [];
    db._ReraScrapeRuns.unshift(record);
    if (db._ReraScrapeRuns.length > 50) db._ReraScrapeRuns = db._ReraScrapeRuns.slice(0, 50);
    this.repo.write(db);
  }

  listRuns(limit = 20) {
    const db = this.repo.read();
    const rows = (db._ReraScrapeRuns || []).slice(0, limit);
    return { ok: true, data: rows, count: rows.length };
  }

  getRun(runId) {
    const db = this.repo.read();
    const row = (db._ReraScrapeRuns || []).find((r) => r.RunID === runId);
    if (!row) return { ok: false, error: 'Run not found' };
    return { ok: true, data: row };
  }
}

module.exports = { ReraScraperService, SCRAPER_MODE, THROTTLE_MS };
