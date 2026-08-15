const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const PORT = 4181;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-api-'));
const DB_FILE = path.join(DB_DIR, 'sig-realty-db.json');

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/dashboard`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(200);
    }
  }

  throw new Error(`Server did not start at ${BASE_URL}`);
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  return { response, data };
}

async function buildFixture() {
  const lead = await requestJson('/api/leads', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Shortlist API Lead',
      city: 'Bengaluru',
      phone: '+91 9000007001',
      email: 'shortlist.api.lead@example.com',
      leadStatus: 'New',
      assignedAgentId: 'USR-0001'
    })
  });

  const requirement = await requestJson('/api/requirements', {
    method: 'POST',
    body: JSON.stringify({
      leadId: lead.data.data.LeadID,
      transactionId: 'TXN-SL-API-001',
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1: 'Shortlist API City',
      location2: 'Shortlist API Avenue',
      location3: 'Shortlist API District',
      bhkMin: 3,
      bhkMax: 3,
      areaMin: 1300,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      specialNotes: 'shortlist api fixture',
      formType: 'residential'
    })
  });

  const property = await requestJson('/api/inventory', {
    method: 'POST',
    body: JSON.stringify({
      transactionType: 'Sale',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      project: 'Shortlist API Crest',
      location: 'Shortlist API City',
      city: 'Shortlist API City',
      bhk: 3,
      area: 1450,
      price: 15000000,
      possession: 'Ready',
      status: 'Available',
      ownerId: 'OWN-SL-API',
      brokerId: 'BRO-SL-API',
      builderId: 'BUIL-SL-API'
    })
  });

  const run = await requestJson('/api/matching/run', {
    method: 'POST',
    body: JSON.stringify({ requirementId: requirement.data.data.RequirementID })
  });

  const match = run.data.data.matches.find((item) => item.PropertyID === property.data.data.PropertyID);

  return {
    requirementId: requirement.data.data.RequirementID,
    propertyId: property.data.data.PropertyID,
    matchId: match.MatchID
  };
}

let serverProcess;

test.before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), SIG_REALTY_DB_FILE: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');
  await waitForServer();
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

test('shortlist API supports add/list/update/remove/re-add/idempotency/restart persistence', async () => {
  const fixture = await buildFixture();

  const firstAdd = await requestJson('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({
      requirementId: fixture.requirementId,
      propertyId: fixture.propertyId,
      matchId: fixture.matchId,
      priority: 'High',
      notes: 'primary shortlist'
    })
  });

  assert.equal(firstAdd.response.ok, true);
  assert.equal(firstAdd.data.ok, true);
  assert.equal(firstAdd.data.data.Status, 'Active');

  const secondAdd = await requestJson('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({
      requirementId: fixture.requirementId,
      propertyId: fixture.propertyId,
      matchId: fixture.matchId,
      priority: 'Medium'
    })
  });

  assert.equal(secondAdd.response.ok, true);
  assert.equal(secondAdd.data.ok, true);
  assert.equal(secondAdd.data.alreadyShortlisted, true);
  assert.equal(secondAdd.data.data.ShortlistID, firstAdd.data.data.ShortlistID);

  const listActive = await requestJson(`/api/requirements/${fixture.requirementId}/shortlist?status=Active`);
  assert.equal(listActive.response.ok, true);
  assert.equal(listActive.data.ok, true);
  assert.equal(listActive.data.data.filter((item) => item.PropertyID === fixture.propertyId).length, 1);

  const shortlistId = firstAdd.data.data.ShortlistID;
  const byId = await requestJson(`/api/shortlist/${shortlistId}`);
  assert.equal(byId.response.ok, true);
  assert.equal(byId.data.ok, true);

  const updated = await requestJson(`/api/shortlist/${shortlistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ priority: 'Low', notes: 'backup after review' })
  });
  assert.equal(updated.response.ok, true);
  assert.equal(updated.data.data.Priority, 'Low');
  assert.equal(updated.data.data.Notes, 'backup after review');

  const removed = await requestJson(`/api/shortlist/${shortlistId}/remove`, {
    method: 'POST',
    body: JSON.stringify({ removedBy: 'api-test' })
  });
  assert.equal(removed.response.ok, true);
  assert.equal(removed.data.data.Status, 'Removed');

  const reAdd = await requestJson('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({
      requirementId: fixture.requirementId,
      propertyId: fixture.propertyId,
      matchId: fixture.matchId,
      priority: 'Medium',
      notes: 're-add flow'
    })
  });
  assert.equal(reAdd.response.ok, true);
  assert.equal(reAdd.data.ok, true);
  assert.notEqual(reAdd.data.data.ShortlistID, shortlistId);

  const beforeRestartId = reAdd.data.data.ShortlistID;
  const beforeRestartScore = reAdd.data.data.MatchScore;

  serverProcess.kill('SIGTERM');
  await delay(600);

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), SIG_REALTY_DB_FILE: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');
  await waitForServer();

  const afterRestart = await requestJson(`/api/shortlist/${beforeRestartId}`);
  assert.equal(afterRestart.response.ok, true);
  assert.equal(afterRestart.data.ok, true);
  assert.equal(afterRestart.data.data.ShortlistID, beforeRestartId);
  assert.equal(afterRestart.data.data.PropertyID, fixture.propertyId);
  assert.equal(afterRestart.data.data.MatchScore, beforeRestartScore);

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const stored = db.Shortlists.find((item) => item.ShortlistID === beforeRestartId);
  assert.ok(stored);
  assert.equal(stored.RequirementID, fixture.requirementId);
  assert.equal(stored.PropertyID, fixture.propertyId);
});

test('shortlist API invalid inputs are controlled', async () => {
  const invalidRequirement = await requestJson('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({ requirementId: 'REQ-NOT-FOUND', propertyId: 'PROP-XYZ' })
  });
  assert.equal(invalidRequirement.response.ok, false);
  assert.equal(invalidRequirement.data.ok, false);

  const invalidPriority = await requestJson('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({ requirementId: 'REQ-NOT-FOUND', propertyId: 'PROP-XYZ', priority: 'Urgent' })
  });
  assert.equal(invalidPriority.response.ok, false);
  assert.equal(invalidPriority.data.error, 'Invalid priority');

  const invalidShortlist = await requestJson('/api/shortlist/SL-NOT-FOUND');
  assert.equal(invalidShortlist.response.status, 404);
  assert.equal(invalidShortlist.data.ok, false);
});
