const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { adminHeaders, authenticateHeaders, requestJson, startServer: sharedStartServer, stopServer: sharedStopServer } = require('./admin-test-utils');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-reporting-api-')), 'sig-realty-db.json');
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

async function startServer(dbPath) {
  const port = await findFreePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), SIG_REALTY_DB_FILE: dbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const timeout = Date.now() + 15000;
  while (Date.now() < timeout) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${baseUrl}/api/dashboard`);
      if (res.ok) return { child, baseUrl };
    } catch (_) {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  child.kill('SIGTERM');
  await once(child, 'exit');
  throw new Error(`Server failed to start\n${logs.join('')}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}

async function createLifecycle(baseUrl, suffix = 'RPA01', opts = {}) {
  const leadRes = await fetch(`${baseUrl}/api/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientName: `Reporting API Lead ${suffix}`,
      city: opts.city || 'Bengaluru',
      phone: `+91 8222200${suffix}`,
      email: `reporting.api.${suffix}@example.com`,
      leadStatus: 'Active',
      assignedAgentId: opts.agentId || 'USR-7001',
      leadSource: opts.source || 'Manual'
    })
  });
  assert.equal(leadRes.status, 200);
  const lead = await leadRes.json();

  const reqRes = await fetch(`${baseUrl}/api/requirements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      leadId: lead.data.LeadID,
      transactionId: `TXN-RPA-${suffix}`,
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1: opts.location || `RPA Location ${suffix}`,
      location2: `RPA East ${suffix}`,
      location3: `RPA District ${suffix}`,
      bhkMin: 2,
      bhkMax: 3,
      areaMin: 1200,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      formType: 'residential'
    })
  });
  assert.equal(reqRes.status, 200);
  const requirement = await reqRes.json();

  const invRes = await fetch(`${baseUrl}/api/inventory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      transactionType: 'Sale',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      project: opts.project || `RPA Project ${suffix}`,
      location: opts.location || `RPA Location ${suffix}`,
      city: opts.city || 'Bengaluru',
      bhk: 3,
      area: 1480,
      price: 16500000,
      possession: 'Ready',
      status: 'Available',
      builderId: opts.builderId || 'BLD-RPA-01'
    })
  });
  assert.equal(invRes.status, 200);
  const property = await invRes.json();

  const matchingRes = await fetch(`${baseUrl}/api/matching/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requirementId: requirement.data.RequirementID })
  });
  assert.equal(matchingRes.status, 200);
  const matching = await matchingRes.json();
  const match = matching.data.matches.find((item) => item.PropertyID === property.data.PropertyID);
  assert.ok(match);

  const shortlistRes = await fetch(`${baseUrl}/api/shortlist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requirementId: requirement.data.RequirementID, propertyId: property.data.PropertyID, matchId: match.MatchID, priority: 'High' })
  });
  assert.equal(shortlistRes.status, 200);
  const shortlist = await shortlistRes.json();

  const visitRes = await fetch(`${baseUrl}/api/site-visits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      leadId: lead.data.LeadID,
      requirementId: requirement.data.RequirementID,
      propertyId: property.data.PropertyID,
      matchId: match.MatchID,
      shortlistId: shortlist.data.ShortlistID,
      visitDate: '2026-12-10',
      visitTime: '11:00',
      assignedAgentId: opts.agentId || 'USR-7001'
    })
  });
  assert.equal(visitRes.status, 200);
  const visit = await visitRes.json();

  const negotiationRes = await fetch(`${baseUrl}/api/negotiations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      LeadID: lead.data.LeadID,
      RequirementID: requirement.data.RequirementID,
      TransactionID: requirement.data.TransactionID,
      PropertyID: property.data.PropertyID,
      MatchID: match.MatchID,
      ShortlistID: shortlist.data.ShortlistID,
      SiteVisitID: visit.data.VisitID,
      AskingPrice: 16500000,
      CurrentOffer: 16100000,
      AgreedPrice: 16100000,
      Status: 'AGREED',
      AssignedAgentID: opts.agentId || 'USR-7001'
    })
  });
  assert.equal(negotiationRes.status, 200);
  const negotiation = await negotiationRes.json();

  const tokenRes = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      NegotiationID: negotiation.data.NegotiationID,
      LeadID: lead.data.LeadID,
      RequirementID: requirement.data.RequirementID,
      PropertyID: property.data.PropertyID,
      SiteVisitID: visit.data.VisitID,
      ShortlistID: shortlist.data.ShortlistID,
      TokenAmount: 600000,
      PaidAmount: 300000,
      PendingAmount: 300000,
      Status: 'PARTIAL'
    })
  });
  assert.equal(tokenRes.status, 200);
  const token = await tokenRes.json();

  const dealRes = await fetch(`${baseUrl}/api/deals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      LeadID: lead.data.LeadID,
      RequirementID: requirement.data.RequirementID,
      PropertyID: property.data.PropertyID,
      MatchID: match.MatchID,
      ShortlistID: shortlist.data.ShortlistID,
      SiteVisitID: visit.data.VisitID,
      NegotiationID: negotiation.data.NegotiationID,
      TokenID: token.data.TokenID,
      FinalPrice: 16100000,
      Brokerage: 322000,
      Status: 'COMPLETED'
    })
  });
  assert.equal(dealRes.status, 200);
  const deal = await dealRes.json();

  const commissionRes = await fetch(`${baseUrl}/api/commission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      DealID: deal.data.DealID,
      LeadID: lead.data.LeadID,
      RequirementID: requirement.data.RequirementID,
      PropertyID: property.data.PropertyID,
      AgentID: opts.agentId || 'USR-7001',
      CommissionType: 'PERCENTAGE',
      BaseAmount: 16100000,
      CommissionRate: 2,
      AgentSharePercent: 50,
      CompanySharePercent: 50
    })
  });
  assert.equal(commissionRes.status, 200);
}

test('reporting API exposes dashboard and lead analytics with real filtered aggregates', async () => {
  const dbPath = makeDbFile();
  const { child, baseUrl } = await sharedStartServer(dbPath);

  try {
    await createLifecycle(baseUrl, 'RPA11', { source: 'Manual', agentId: 'USR-7001' });
    await createLifecycle(baseUrl, 'RPA12', { source: 'Reference', agentId: 'USR-7002', city: 'Mumbai' });

    const dashboardRes = await requestJson(baseUrl, '/api/reports/dashboard?datePreset=thisyear', { headers: adminHeaders() });
    assert.equal(dashboardRes.response.status, 200);
    const dashboard = dashboardRes.payload;
    assert.equal(dashboard.ok, true);
    assert.equal(dashboard.data.executive.totalLeads >= 2, true);
    assert.equal(dashboard.data.pipeline.deal >= 2, true);

    const leadsRes = await requestJson(baseUrl, '/api/reports/leads?datePreset=thisyear', { headers: adminHeaders() });
    assert.equal(leadsRes.response.status, 200);
    const leads = leadsRes.payload;
    assert.equal(leads.ok, true);
    assert.equal(leads.data.sourceBreakdown.length >= 2, true);

    const reportsRes = await requestJson(baseUrl, '/api/reports?datePreset=thisyear', { headers: adminHeaders() });
    assert.equal(reportsRes.response.status, 200);
    const reports = reportsRes.payload;
    assert.equal(reports.ok, true);
    assert.equal(Boolean(reports.data.dashboard), true);
    assert.equal(Boolean(reports.data.deals), true);
  } finally {
    await sharedStopServer(child);
    fs.unlinkSync(dbPath);
  }
});

test('reporting API validates date range, role scope, and CSV export', async () => {
  const dbPath = makeDbFile();
  const { child, baseUrl } = await sharedStartServer(dbPath);

  try {
    await createLifecycle(baseUrl, 'RPA21', { source: 'Instagram', agentId: 'USR-0003' });
    await createLifecycle(baseUrl, 'RPA22', { source: 'Facebook', agentId: 'USR-0002' });

    const invalidRange = await requestJson(baseUrl, '/api/reports/dashboard?datePreset=custom&dateFrom=2026-12-31&dateTo=2026-01-01', { headers: adminHeaders() });
    assert.equal(invalidRange.response.status, 400);

    const scoped = await requestJson(baseUrl, '/api/reports/dashboard?datePreset=thisyear', {
      headers: { 'x-user-role': 'AGENT', 'x-user-id': 'USR-0003' }
    });
    assert.equal(scoped.response.status, 200);
    const scopedPayload = scoped.payload;
    assert.equal(scopedPayload.ok, true);
    assert.equal(scopedPayload.data.executive.totalLeads, 1);

    const csvRes = await fetch(`${baseUrl}/api/reports/export?type=deals&format=csv&datePreset=thisyear`, {
      headers: await authenticateHeaders(baseUrl, adminHeaders())
    });
    assert.equal(csvRes.status, 200);
    assert.equal(csvRes.headers.get('content-type').includes('text/csv'), true);
    const csvBody = await csvRes.text();
    assert.equal(csvBody.startsWith('DealID,LeadID,PropertyID,FinalPrice,Brokerage,Status,AgreementDate,RegistrationDate,ClosingDate'), true);
  } finally {
    await sharedStopServer(child);
    fs.unlinkSync(dbPath);
  }
});
