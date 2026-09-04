'use strict';

/**
 * RERA Import Config — target areas, regex, status normalization.
 *
 * Areas can be updated at runtime via PATCH /api/v2/rera/config (stored in DB
 * as _ReraConfig). Regex + status map are code-level defaults (rarely change).
 */

const DEFAULT_AREAS = ['Vesu', 'Adajan', 'Pal', 'Piplod', 'Athwa', 'Citylight'];

// Loose but structured — matches most Gujarat RERA formats:
//   PR/GJ/SURAT/SURAT CITY/Surat Municipal Corporation/RAA02008/010919
//   PR/GJ/SURAT/SURAT/SUDA/CAA07001/030418
const RERA_REGEX = /^PR\/GJ\/SURAT\/[^/]+\/[^/]+\/[A-Z]{2,4}\d{4,7}\/\d{6}$/i;

// Locked to last 10 rolling years. Applied inclusive on RERARegistrationDate.
const REGISTRATION_WINDOW_YEARS = 10;

const STATUS_MAP = {
  'ongoing': 'Ongoing',
  'under construction': 'Ongoing',
  'in progress': 'Ongoing',
  'active': 'Ongoing',

  'new': 'New',
  'new registration': 'New',
  'not started': 'New',
  'yet to start': 'New',

  'completed': 'Completed',
  'occupied': 'Completed',
  'oc received': 'Completed',
  'occupation certificate received': 'Completed',
  'possession given': 'Completed',

  'lapsed': 'Lapsed',
  'cancelled': 'Lapsed',
  'canceled': 'Lapsed',
  'suspended': 'Lapsed',
  'expired': 'Lapsed',
  'terminated': 'Lapsed'
};

function normalizeStatus(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return 'New';
  return STATUS_MAP[key] || 'New';
}

// Normalize area strings: lowercase, strip spaces / hyphens / underscores.
//   "City Light"  -> "citylight"
//   "city-light"  -> "citylight"
//   "CITYLIGHT"   -> "citylight"
//   "Vesu "       -> "vesu"
function normalizeArea(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_]+/g, '').trim();
}

function loadConfig(repository) {
  const db = repository.read();
  db._ReraConfig = db._ReraConfig || { areas: DEFAULT_AREAS };
  if (!Array.isArray(db._ReraConfig.areas) || !db._ReraConfig.areas.length) {
    db._ReraConfig.areas = DEFAULT_AREAS.slice();
  }
  return {
    areas: db._ReraConfig.areas.slice(),
    areasNormalized: db._ReraConfig.areas.map(normalizeArea),
    regex: RERA_REGEX,
    windowYears: REGISTRATION_WINDOW_YEARS
  };
}

function saveAreas(repository, areas) {
  const clean = (Array.isArray(areas) ? areas : [])
    .map((a) => String(a || '').trim())
    .filter(Boolean);
  if (!clean.length) throw new Error('At least one area required');
  const db = repository.read();
  db._ReraConfig = { ...(db._ReraConfig || {}), areas: clean };
  repository.write(db);
  return clean;
}

// Match: row's village OR location must fuzzy-match ANY configured area.
function matchArea(row, cfg) {
  const village = normalizeArea(row.Village || row.village || '');
  const locality = normalizeArea(row.Location1 || row.Location || row.location || row.Locality || '');
  for (let i = 0; i < cfg.areasNormalized.length; i += 1) {
    const a = cfg.areasNormalized[i];
    if (!a) continue;
    if (village === a || locality === a) return cfg.areas[i];
    // partial-contains fallback ("Vesu Extension" contains "vesu")
    if (village && village.includes(a)) return cfg.areas[i];
    if (locality && locality.includes(a)) return cfg.areas[i];
  }
  return null;
}

module.exports = {
  DEFAULT_AREAS,
  RERA_REGEX,
  REGISTRATION_WINDOW_YEARS,
  STATUS_MAP,
  normalizeStatus,
  normalizeArea,
  loadConfig,
  saveAreas,
  matchArea
};
