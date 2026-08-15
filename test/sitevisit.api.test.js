const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { JsonRepository } = require('../src/data/repository');

const dbFile = path.join(os.tmpdir(), `sig-sitevisit-api-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
process.env.SIG_REALTY_DB_FILE = dbFile;

let server;
let baseUrl;
let testPort;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Could not allocate test port'));
          return;
        }
        resolve(port);
      });
    });
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, PORT: String(testPort), SIG_REALTY_DB_FILE: dbFile },
      cwd: path.join(__dirname, '..')
    });

    server.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('running at')) {
        baseUrl = `http://127.0.0.1:${testPort}`;
        resolve();
      }
    });

    server.stderr.on('data', (chunk) => {
      console.error(chunk.toString());
    });

    server.on('exit', (code) => {
      if (code && !baseUrl) {
        reject(new Error(`Server exited early with code ${code}`));
      }
    });

    setTimeout(() => {
      if (!baseUrl) {
        resolve();
      }
    }, 1200);
  });
}

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: testPort,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

test('site visit API lifecycle works', async () => {
  testPort = await getFreePort();
  const repository = new JsonRepository(dbFile);
  const seededLead = repository.createLead({ LeadID: 'LEAD-API-SITE', ClientName: 'Lina', City: 'Bengaluru', Phone: '+91 11111', Email: 'lina@test.com', LeadStatus: 'Active' });
  const seededRequirement = repository.createRequirement({ RequirementID: 'REQ-API-SITE', RequirementCode: 'REQ-API-SITE', LeadID: seededLead.LeadID, TransactionID: 'TXN-API-SITE', TransactionType: 'Purchase', Category: 'Residential', PropertyType: 'Apartment', BudgetMin: 12000000, BudgetMax: 15000000, Location1: 'Whitefield', Status: 'Active' });
  repository.create('Inventory', { PropertyID: 'PROP-API-SITE', TransactionType: 'Purchase', Category: 'Residential', PropertyType: 'Apartment', Project: 'Bay View', Location: 'Whitefield', City: 'Bengaluru', BHK: 2, Area: 1400, Price: 13500000, Status: 'Available' });
  repository.createMatch({ MatchID: 'MATCH-API-SITE', RequirementID: seededRequirement.RequirementID, PropertyID: 'PROP-API-SITE', LeadID: seededLead.LeadID, Score: 92, MatchLevel: 'Strong', MatchedCriteria: ['Budget', 'Location'], FailedCriteria: [], UnknownCriteria: [], ScoreBreakdown: {}, Explanation: 'Strong fit', Status: 'Active' });

  await startServer();

  try {
    const leadResp = await request('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientName: 'Lina', city: 'Bengaluru', phone: '+91 11111', email: 'lina@test.com', leadStatus: 'Active' }) });
    const leadPayload = JSON.parse(leadResp.body);
    const lead = leadPayload.data;

    const requirementResp = await request('/api/requirements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: lead.LeadID, transactionType: 'Purchase', category: 'Residential', propertyType: 'Apartment', location1: 'Whitefield', budgetMin: 12000000, budgetMax: 15000000 }) });
    const requirement = JSON.parse(requirementResp.body).data;

    const propertyResp = await request('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: 'PROP-API-TEST', transactionType: 'Purchase', category: 'Residential', propertyType: 'Apartment', project: 'Bay View', location: 'Whitefield', city: 'Bengaluru', bhk: 2, area: 1400, price: 13500000, status: 'Available' }) });
    const property = JSON.parse(propertyResp.body).data;

    const matchResp = await request('/api/matching/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requirementId: requirement.RequirementID }) });
    const matchPayload = JSON.parse(matchResp.body);
    const matchId = matchPayload.data?.matches?.find((item) => item.PropertyID === property.PropertyID)?.MatchID || null;

    const createResp = await request('/api/site-visits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: lead.LeadID, requirementId: requirement.RequirementID, propertyId: property.PropertyID, matchId, visitDate: '2026-10-01', visitTime: '12:00', duration: '90 mins', meetingPoint: 'Lobby', assignedAgentId: 'USR-0001', clientName: 'Lina', clientPhone: '+91 11111', notes: 'API flow' }) });
    const created = JSON.parse(createResp.body);
    assert.equal(created.ok, true);

    const getResp = await request(`/api/site-visits/${created.data.VisitID}`);
    const fetched = JSON.parse(getResp.body);
    assert.equal(fetched.ok, true);
    assert.equal(fetched.data.VisitID, created.data.VisitID);

    const listResp = await request('/api/site-visits');
    const listed = JSON.parse(listResp.body);
    assert.equal(listed.ok, true);
    assert.equal(listed.data.length >= 1, true);

    const confirmResp = await request(`/api/site-visits/${created.data.VisitID}/confirm`, { method: 'PATCH' });
    const confirmed = JSON.parse(confirmResp.body);
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.data.Status, 'Confirmed');

    const completeResp = await request(`/api/site-visits/${created.data.VisitID}/complete`, { method: 'PATCH' });
    const completed = JSON.parse(completeResp.body);
    assert.equal(completed.ok, true);
    assert.equal(completed.data.Status, 'Completed');
  } finally {
    server?.kill('SIGTERM');
  }
});
