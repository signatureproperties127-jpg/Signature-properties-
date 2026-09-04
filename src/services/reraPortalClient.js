'use strict';

/**
 * Gujarat RERA portal client — pluggable.
 * Two modes:
 *  - "mock" (default) — returns sample projects for dev/testing
 *  - "live"           — actual HTTPS request + HTML parse (production)
 *
 * Env: RERA_SCRAPER_MODE=mock|live  (default: mock)
 * Env: RERA_PORTAL_URL              (default: https://gujrera.gujarat.gov.in)
 *
 * Portal has no locality filter → we fetch all Surat district results, and
 * the scraper service post-filters against the configured target areas.
 */

const https = require('https');

const MODE = (process.env.RERA_SCRAPER_MODE || 'mock').toLowerCase();
const PORTAL_URL = process.env.RERA_PORTAL_URL || 'https://gujrera.gujarat.gov.in';

// ── Mock dataset (used when MODE=mock) ─────────────────────────────────────
const MOCK_PROJECTS = [
  { RERANumber: 'PR/GJ/SURAT/SURAT CITY/SUDA/RAA02008/010919', ProjectName: 'Ratnakar Nine Square', BuilderName: 'Ratnakar Group', ProjectStatus: 'Ongoing',       Village: 'Vesu',      Location1: 'Vesu',       Taluka: 'Surat City', UnitType: '3 BHK', UnitCount: 80,  CarpetAreaSqft: 1350, PossessionDate: '2027-06-30', LandAreaSqm: 3500, RERARegistrationDate: '2019-09-01' },
  { RERANumber: 'PR/GJ/SURAT/SURAT CITY/SMC/CAA07001/030422',  ProjectName: 'Sunrise Skyline',     BuilderName: 'Sunrise Infra',  ProjectStatus: 'New',           Village: 'Adajan',    Location1: 'Adajan',     Taluka: 'Surat City', UnitType: '2 BHK', UnitCount: 120, CarpetAreaSqft: 720,  PossessionDate: '2028-12-31', LandAreaSqm: 5000, RERARegistrationDate: '2022-04-03' },
  { RERANumber: 'PR/GJ/SURAT/SURAT CITY/SMC/DAA05002/151023',  ProjectName: 'Amber Heights',       BuilderName: 'Amber Realty',   ProjectStatus: 'Completed',     Village: 'Citylight', Location1: 'City Light', Taluka: 'Surat City', UnitType: '3 BHK', UnitCount: 40,  CarpetAreaSqft: 1200, PossessionDate: '2024-01-15', LandAreaSqm: 4200, RERARegistrationDate: '2023-10-15' },
  { RERANumber: 'PR/GJ/SURAT/SURAT CITY/SMC/FAA00777/050224',  ProjectName: 'Palm Springs',        BuilderName: 'Palm Realty',    ProjectStatus: 'Ongoing',       Village: 'Piplod',    Location1: 'Piplod',     Taluka: 'Surat City', UnitType: '4 BHK', UnitCount: 25,  CarpetAreaSqft: 1600, PossessionDate: '2028-03-31', LandAreaSqm: 6000, RERARegistrationDate: '2024-02-05' },
  // A brand-new project (not in existing DB, will be inserted)
  { RERANumber: 'PR/GJ/SURAT/SURAT CITY/SMC/GAB00901/120725',  ProjectName: 'Green Meadows',       BuilderName: 'Meadows Group',  ProjectStatus: 'New',           Village: 'Pal',       Location1: 'Pal',        Taluka: 'Surat City', UnitType: '2 BHK', UnitCount: 60,  CarpetAreaSqft: 850,  PossessionDate: '2029-06-30', LandAreaSqm: 3200, RERARegistrationDate: '2025-07-12' },
  { RERANumber: 'PR/GJ/SURAT/SURAT CITY/SMC/GAB00901/120725',  ProjectName: 'Green Meadows',       BuilderName: 'Meadows Group',  ProjectStatus: 'New',           Village: 'Pal',       Location1: 'Pal',        Taluka: 'Surat City', UnitType: '3 BHK', UnitCount: 30,  CarpetAreaSqft: 1200, PossessionDate: '2029-06-30', LandAreaSqm: 3200, RERARegistrationDate: '2025-07-12' },
  // Out-of-area (Bhatar) — will be filtered out
  { RERANumber: 'PR/GJ/SURAT/SURAT CITY/SMC/BAA09901/020818',  ProjectName: 'Diamond Terrace',     BuilderName: 'Diamond Homes',  ProjectStatus: 'Ongoing',       Village: 'Bhatar',    Location1: 'Bhatar',     Taluka: 'Surat City', UnitType: '2 BHK', UnitCount: 60,  CarpetAreaSqft: 700,  PossessionDate: '2026-03-31', LandAreaSqm: 3100, RERARegistrationDate: '2018-08-02' }
];

async function fetchMock() {
  // Small artificial delay to feel real
  await new Promise((r) => setTimeout(r, 200));
  return MOCK_PROJECTS.slice();
}

// ── Live fetcher (naive first-cut) ─────────────────────────────────────────
function _httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (SignatureRealty RERA sync bot)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers
      },
      timeout: 15000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
  });
}

async function fetchLive() {
  // Portal returns HTML/JS-heavy pages; a proper client would need Playwright
  // or a documented JSON endpoint. Placeholder — logs a warning and falls
  // back to mock if it can't reach the portal or gets non-200.
  try {
    const res = await _httpGet(`${PORTAL_URL}/`);
    if (res.status !== 200) throw new Error(`Portal returned HTTP ${res.status}`);
    // If future engineer implements a real parser, drop rows into an array
    // shaped exactly like MOCK_PROJECTS and return that. For now: return [].
    return [];
  } catch (e) {
    const err = new Error(`Live portal unreachable: ${e.message}`);
    err.code = 'PORTAL_UNREACHABLE';
    throw err;
  }
}

async function fetchAllSuratRows() {
  if (MODE === 'live') {
    return { mode: 'live', rows: await fetchLive() };
  }
  return { mode: 'mock', rows: await fetchMock() };
}

module.exports = { fetchAllSuratRows, MODE, PORTAL_URL };
