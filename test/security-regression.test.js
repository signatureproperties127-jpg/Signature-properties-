'use strict';

/**
 * Security regression tests for P0/P1 authentication and tenant-isolation fixes.
 *
 * Confirmed P0 — previously unauthenticated endpoints:
 *   P0-1  GET  /api/followups
 *   P0-2  POST /api/followups
 *   P0-3  GET  /api/calendar
 *
 * Confirmed P1 — previously unauthenticated endpoints:
 *   P1-1  GET  /api/transactions
 *   P1-2  GET  /api/search
 *   P1-3  GET  /api/brokers
 *
 * Confirmed P1 — missing tenant isolation on write endpoints:
 *   P1-4  PATCH  /api/leads/:id
 *   P1-5  PATCH  /api/requirements/:id
 *   P1-6  DELETE /api/requirements/:id
 *
 * Additional coverage:
 *   - Authenticated requests succeed after the fixes
 *   - Broker-network public share routes remain accessible without auth
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

// ─────────────────────────────────────────────────────────────────────────────
// Test database helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a database with two users from different tenants.
 *
 * USR-TENANT-A  →  COMP-AAA / BRK-AAA  (email: tenant.a@example.com)
 * USR-TENANT-B  →  COMP-BBB / BRK-BBB  (email: tenant.b@example.com)
 *
 * Both users have full LEADS/REQUIREMENTS permissions so tests can focus on
 * the tenant-isolation check rather than on permission failures.
 *
 * Note: repository.createUser() does not persist CompanyID/BrokerageID, so we
 * write the user records directly into the database JSON file.  The repository
 * is only used to trigger ensureDatabase() so the file and schema exist first.
 */
function makeTenantDb() {
  const dbFile = makeDbFile();
  // Touch the db so ensureDatabase() runs and creates the initial schema
  new JsonRepository(dbFile);

  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const now = new Date().toISOString();
  raw.Users.push(
    {
      UserID: 'USR-TENANT-A',
      Name: 'Tenant A User',
      Mobile: '+910000000010',
      Role: 'AGENT',
      Email: 'tenant.a@example.com',
      Status: 'Active',
      Permissions: ['LEADS_READ', 'LEADS_CREATE', 'LEADS_UPDATE', 'REQUIREMENTS_READ', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_DELETE'],
      CompanyID: 'COMP-AAA',
      BrokerageID: 'BRK-AAA',
      CreatedAt: now,
      UpdatedAt: now
    },
    {
      UserID: 'USR-TENANT-B',
      Name: 'Tenant B User',
      Mobile: '+910000000011',
      Role: 'AGENT',
      Email: 'tenant.b@example.com',
      Status: 'Active',
      Permissions: ['LEADS_READ', 'LEADS_UPDATE', 'REQUIREMENTS_READ', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_DELETE'],
      CompanyID: 'COMP-BBB',
      BrokerageID: 'BRK-BBB',
      CreatedAt: now,
      UpdatedAt: now
    }
  );
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));

  return dbFile;
}

// Identity headers for admin-test-utils → resolves to a real Google session.
// These users MUST have CompanyID/BrokerageID so resolveRequestContext passes.
const tenantAHeaders = { 'x-user-id': 'USR-TENANT-A', 'x-user-role': 'AGENT' };
const tenantBHeaders = { 'x-user-id': 'USR-TENANT-B', 'x-user-role': 'AGENT' };

/**
 * Stamp a CompanyID/BrokerageID directly onto an existing lead record.
 * createLead() does not store tenant fields, so we patch the file directly.
 */
function stampLeadTenant(dbFile, leadId, companyId, brokerageId) {
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const idx = raw.Leads.findIndex((l) => l.LeadID === leadId);
  assert.notEqual(idx, -1, `Lead ${leadId} not found in db`);
  raw.Leads[idx].CompanyID = companyId;
  raw.Leads[idx].BrokerageID = brokerageId;
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));
}

/**
 * Stamp a CompanyID/BrokerageID onto an existing requirement record.
 */
function stampRequirementTenant(dbFile, requirementId, companyId, brokerageId) {
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const idx = raw.Requirements.findIndex((r) => r.RequirementID === requirementId);
  assert.notEqual(idx, -1, `Requirement ${requirementId} not found in db`);
  raw.Requirements[idx].CompanyID = companyId;
  raw.Requirements[idx].BrokerageID = brokerageId;
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));
}

function seedP0OperationalGraph(dbFile, { companyId, brokerageId, tag }) {
  const now = new Date().toISOString();
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const leadId = `LEAD-${tag}`;
  const requirementId = `REQ-${tag}`;
  const propertyId = `PROP-${tag}`;
  const matchId = `MATCH-${tag}`;
  const shortlistId = `SL-${tag}`;
  const visitId = `VISIT-${tag}`;
  const negotiationId = `NEG-${tag}`;
  const tokenId = `TOK-${tag}`;
  const dealId = `DEAL-${tag}`;
  const commissionId = `COM-${tag}`;
  const closingId = `CLS-${tag}`;
  const ownerId = `OWN-${tag}`;
  const builderId = `BLD-${tag}`;
  const projectId = `PRJ-${tag}`;

  raw.Leads.push({
    LeadID: leadId,
    ClientName: `Client ${tag}`,
    CompanyID: companyId,
    BrokerageID: brokerageId,
    AssignedAgentID: 'USR-TENANT-A',
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Requirements.push({
    RequirementID: requirementId,
    LeadID: leadId,
    TransactionID: 'TXN-0001',
    Category: 'Residential',
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Inventory.push({
    PropertyID: propertyId,
    Project: `Project ${tag}`,
    Category: 'Residential',
    TransactionType: 'Purchase',
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Matches.push({
    MatchID: matchId,
    RequirementID: requirementId,
    PropertyID: propertyId,
    Score: 95,
    MatchLevel: 'High',
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Shortlists.push({
    ShortlistID: shortlistId,
    RequirementID: requirementId,
    LeadID: leadId,
    PropertyID: propertyId,
    MatchID: matchId,
    Status: 'Active',
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.SiteVisits.push({
    VisitID: visitId,
    LeadID: leadId,
    RequirementID: requirementId,
    PropertyID: propertyId,
    MatchID: matchId,
    VisitDate: '2026-08-01',
    VisitTime: '11:00',
    Status: 'Scheduled',
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Negotiations.push({
    NegotiationID: negotiationId,
    LeadID: leadId,
    RequirementID: requirementId,
    PropertyID: propertyId,
    TransactionID: 'TXN-0001',
    Status: 'OPEN',
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Tokens.push({
    TokenID: tokenId,
    NegotiationID: negotiationId,
    LeadID: leadId,
    RequirementID: requirementId,
    PropertyID: propertyId,
    TokenAmount: 100000,
    PaidAmount: 10000,
    PendingAmount: 90000,
    Status: 'PENDING',
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Deals.push({
    DealID: dealId,
    LeadID: leadId,
    RequirementID: requirementId,
    PropertyID: propertyId,
    NegotiationID: negotiationId,
    TokenID: tokenId,
    FinalPrice: 5000000,
    Brokerage: 50000,
    Status: 'OPEN',
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Commission.push({
    CommissionID: commissionId,
    DealID: dealId,
    LeadID: leadId,
    RequirementID: requirementId,
    PropertyID: propertyId,
    Status: 'PENDING',
    GrossCommission: 50000,
    ReceivedAmount: 0,
    PendingAmount: 50000,
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Closings.push({
    ClosingID: closingId,
    DealID: dealId,
    LeadID: leadId,
    RequirementID: requirementId,
    PropertyID: propertyId,
    Status: 'IN_PROGRESS',
    Checklist: [
      { ItemKey: 'TOKEN_VERIFIED', Label: 'TOKEN VERIFIED', Status: 'PENDING', CompletedBy: null, CompletedAt: null, Notes: '' },
      { ItemKey: 'AGREEMENT_COMPLETED', Label: 'AGREEMENT COMPLETED', Status: 'PENDING', CompletedBy: null, CompletedAt: null, Notes: '' }
    ],
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Owners.push({
    OwnerID: ownerId,
    Name: `Owner ${tag}`,
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Builders.push({
    BuilderID: builderId,
    Name: `Builder ${tag}`,
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });
  raw.Projects.push({
    ProjectID: projectId,
    BuilderID: builderId,
    ProjectName: `Project ${tag}`,
    CompanyID: companyId,
    BrokerageID: brokerageId,
    CreatedAt: now,
    UpdatedAt: now
  });

  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));
  return { leadId, requirementId, propertyId, matchId, shortlistId, visitId, negotiationId, tokenId, dealId, commissionId, ownerId, builderId, projectId };
}

// ─────────────────────────────────────────────────────────────────────────────
// P0/P1 — Unauthenticated 401 gate tests
// ─────────────────────────────────────────────────────────────────────────────

test('P0-1: GET /api/followups returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/followups');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/followups must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P0-2: POST /api/followups returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/followups', {
      method: 'POST',
      body: { Notes: 'test' }
    });
    assert.equal(res.response.status, 401, 'Unauthenticated POST /api/followups must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P0-3: GET /api/calendar returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/calendar');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/calendar must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-1: GET /api/transactions returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/transactions');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/transactions must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-2: GET /api/search returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/search?q=test');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/search must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-3: GET /api/brokers returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/brokers');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/brokers must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Positive access tests — authenticated tenant-scoped user succeeds
// ─────────────────────────────────────────────────────────────────────────────

test('authenticated user can GET /api/followups after P0-1 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/followups', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
    assert.equal(res.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

test('authenticated user can GET /api/calendar after P0-3 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/calendar', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
    assert.equal(res.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

test('authenticated user can GET /api/transactions after P1-1 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/transactions', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
  } finally {
    await stopServer(server.child);
  }
});

test('authenticated user can GET /api/search after P1-2 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/search?q=test', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
  } finally {
    await stopServer(server.child);
  }
});

test('authenticated user can GET /api/brokers after P1-3 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/brokers', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-4 — Lead PATCH tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

test('P1-4: cross-tenant PATCH /api/leads/:id is rejected with 403', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    // Tenant A creates a lead
    const created = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'A Client', City: 'Mumbai', Phone: '9000000001', Email: 'aclient@example.com' }
    });
    assert.equal(created.response.status, 200, `Lead creation failed: ${JSON.stringify(created.payload)}`);
    const leadId = created.payload.data?.LeadID || created.payload.LeadID;
    assert.ok(leadId, 'Lead ID must be returned');

    // Stamp COMP-AAA ownership on the lead record
    stampLeadTenant(dbFile, leadId, 'COMP-AAA', 'BRK-AAA');

    // Tenant B (COMP-BBB) attempts PATCH — must be rejected
    const patch = await requestJson(server.baseUrl, `/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: tenantBHeaders,
      body: { ClientName: 'Hacked' }
    });
    assert.equal(patch.response.status, 403, 'Cross-tenant PATCH /api/leads/:id must return 403');
    assert.equal(patch.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-4: same-tenant PATCH /api/leads/:id succeeds with 200', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const created = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'A Client 2', City: 'Mumbai', Phone: '9000000002', Email: 'aclient2@example.com' }
    });
    assert.equal(created.response.status, 200, `Lead creation failed: ${JSON.stringify(created.payload)}`);
    const leadId = created.payload.data?.LeadID || created.payload.LeadID;
    assert.ok(leadId);

    stampLeadTenant(dbFile, leadId, 'COMP-AAA', 'BRK-AAA');

    // Same tenant A updates their own lead — must succeed
    const patch = await requestJson(server.baseUrl, `/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: tenantAHeaders,
      body: { City: 'Delhi' }
    });
    assert.equal(patch.response.status, 200, 'Same-tenant PATCH /api/leads/:id must return 200');
    assert.equal(patch.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-5 — Requirement PATCH tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

test('P1-5: cross-tenant PATCH /api/requirements/:id is rejected with 403', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    // Tenant A creates a lead and requirement
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Req Client', City: 'Pune', Phone: '9000000003', Email: 'rc@example.com' }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;
    assert.ok(leadId);

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 5000000, BudgetMax: 10000000 }
    });
    assert.equal(reqRes.response.status, 200, `Requirement creation failed: ${JSON.stringify(reqRes.payload)}`);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId, 'Requirement ID must be returned');

    // Stamp COMP-AAA ownership
    stampRequirementTenant(dbFile, requirementId, 'COMP-AAA', 'BRK-AAA');

    // Tenant B attempts PATCH — must be rejected
    const patch = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      method: 'PATCH',
      headers: tenantBHeaders,
      body: { BudgetMax: 99999999 }
    });
    assert.equal(patch.response.status, 403, 'Cross-tenant PATCH /api/requirements/:id must return 403');
    assert.equal(patch.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-5: same-tenant PATCH /api/requirements/:id succeeds with 200', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Req Client 2', City: 'Pune', Phone: '9000000004', Email: 'rc2@example.com' }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 5000000, BudgetMax: 10000000 }
    });
    assert.equal(reqRes.response.status, 200, `Requirement creation failed: ${JSON.stringify(reqRes.payload)}`);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId);

    stampRequirementTenant(dbFile, requirementId, 'COMP-AAA', 'BRK-AAA');

    // Same tenant A updates their own requirement — must succeed
    const patch = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      method: 'PATCH',
      headers: tenantAHeaders,
      body: { BudgetMax: 12000000 }
    });
    assert.equal(patch.response.status, 200, 'Same-tenant PATCH /api/requirements/:id must return 200');
    assert.equal(patch.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-6 — Requirement DELETE tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

test('P1-6: cross-tenant DELETE /api/requirements/:id is rejected with 403', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Del Client', City: 'Chennai', Phone: '9000000005', Email: 'del@example.com' }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 3000000, BudgetMax: 6000000 }
    });
    assert.equal(reqRes.response.status, 200, `Requirement creation failed: ${JSON.stringify(reqRes.payload)}`);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId);

    stampRequirementTenant(dbFile, requirementId, 'COMP-AAA', 'BRK-AAA');

    // Tenant B attempts DELETE — must be rejected
    const del = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      method: 'DELETE',
      headers: tenantBHeaders
    });
    assert.equal(del.response.status, 403, 'Cross-tenant DELETE /api/requirements/:id must return 403');
    assert.equal(del.payload.ok, false);

    // Requirement must still exist after the rejected delete
    const get = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      headers: tenantAHeaders
    });
    assert.equal(get.response.status, 200, 'Requirement must still exist after a rejected cross-tenant delete');
  } finally {
    await stopServer(server.child);
  }
});

test('P1-6: same-tenant DELETE /api/requirements/:id succeeds', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Del Client 2', City: 'Chennai', Phone: '9000000006', Email: 'del2@example.com' }
    });

    test('P0: unauthenticated operational and master routes return 401', async () => {
      const dbFile = makeTenantDb();
      const server = await startServer(dbFile);
      try {
        const cases = [
          ['GET', '/api/site-visits'],
          ['POST', '/api/site-visits'],
          ['PATCH', '/api/site-visits/VISIT-X/confirm'],
          ['GET', '/api/shortlist'],
          ['POST', '/api/shortlist'],
          ['PATCH', '/api/shortlist/SL-X'],
          ['GET', '/api/negotiations'],
          ['POST', '/api/negotiations'],
          ['POST', '/api/negotiations/NEG-X/offer'],
          ['GET', '/api/tokens'],
          ['POST', '/api/tokens'],
          ['GET', '/api/deals'],
          ['POST', '/api/deals'],
          ['GET', '/api/commission'],
          ['POST', '/api/commission'],
          ['POST', '/api/commission/calculate'],
          ['PATCH', '/api/commission/COM-X/status'],
          ['GET', '/api/closing/DEAL-X/history'],
          ['PATCH', '/api/closing/DEAL-X/checklist'],
          ['GET', '/api/owners'],
          ['POST', '/api/owners'],
          ['GET', '/api/builders'],
          ['POST', '/api/builders'],
          ['GET', '/api/projects'],
          ['POST', '/api/projects']
        ];
        for (const [method, route] of cases) {
          const res = await requestJson(server.baseUrl, route, { method, body: method === 'GET' ? undefined : {} });
          assert.equal(res.response.status, 401, `${method} ${route} must return 401`);
        }
      } finally {
        await stopServer(server.child);
      }
    });

    test('P0: authenticated same-tenant routes remain accessible', async () => {
      const dbFile = makeTenantDb();
      const ids = seedP0OperationalGraph(dbFile, { companyId: 'COMP-AAA', brokerageId: 'BRK-AAA', tag: 'A' });
      const server = await startServer(dbFile);
      try {
        const listRoutes = ['/api/site-visits', '/api/shortlist', '/api/negotiations', '/api/tokens', '/api/deals', '/api/commission', '/api/owners', '/api/builders', '/api/projects'];
        for (const route of listRoutes) {
          const res = await requestJson(server.baseUrl, route, { headers: tenantAHeaders });
          assert.equal(res.response.status, 200, `Authenticated GET ${route} must be accessible`);
          assert.equal(res.payload.ok, true);
        }

        const siteVisitConfirm = await requestJson(server.baseUrl, `/api/site-visits/${ids.visitId}/confirm`, {
          method: 'PATCH',
          headers: tenantAHeaders,
          body: {}
        });
        assert.equal(siteVisitConfirm.response.status, 200);
        assert.equal(siteVisitConfirm.payload.ok, true);

        const negotiationOffer = await requestJson(server.baseUrl, `/api/negotiations/${ids.negotiationId}/offer`, {
          method: 'POST',
          headers: tenantAHeaders,
          body: { CurrentOffer: 4500000 }
        });
        assert.equal(negotiationOffer.response.status, 200);
        assert.equal(negotiationOffer.payload.ok, true);

        const commissionStatus = await requestJson(server.baseUrl, `/api/commission/${ids.commissionId}/status`, {
          method: 'PATCH',
          headers: tenantAHeaders,
          body: { Status: 'PARTIAL' }
        });
        assert.equal(commissionStatus.response.status, 200);
        assert.equal(commissionStatus.payload.ok, true);

        const closingChecklist = await requestJson(server.baseUrl, `/api/closing/${ids.dealId}/checklist`, {
          method: 'PATCH',
          headers: tenantAHeaders,
          body: { ItemKey: 'TOKEN_VERIFIED', Status: 'COMPLETED' }
        });
        assert.equal(closingChecklist.response.status, 200);
        assert.equal(closingChecklist.payload.ok, true);
      } finally {
        await stopServer(server.child);
      }
    });

    test('P0: cross-tenant access is rejected with 403 for tenant-sensitive operations', async () => {
      const dbFile = makeTenantDb();
      const ids = seedP0OperationalGraph(dbFile, { companyId: 'COMP-AAA', brokerageId: 'BRK-AAA', tag: 'A' });
      seedP0OperationalGraph(dbFile, { companyId: 'COMP-BBB', brokerageId: 'BRK-BBB', tag: 'B' });
      const server = await startServer(dbFile);
      try {
        const crossVisit = await requestJson(server.baseUrl, `/api/site-visits/${ids.visitId}/confirm`, {
          method: 'PATCH',
          headers: tenantBHeaders,
          body: {}
        });
        assert.equal(crossVisit.response.status, 403);

        const crossShortlist = await requestJson(server.baseUrl, `/api/shortlist/${ids.shortlistId}`, {
          method: 'PATCH',
          headers: tenantBHeaders,
          body: { Notes: 'cross tenant attempt' }
        });
        assert.equal(crossShortlist.response.status, 403);

        const crossNegotiation = await requestJson(server.baseUrl, `/api/negotiations/${ids.negotiationId}/offer`, {
          method: 'POST',
          headers: tenantBHeaders,
          body: { CurrentOffer: 4600000 }
        });
        assert.equal(crossNegotiation.response.status, 403);

        const crossTokenCreate = await requestJson(server.baseUrl, '/api/tokens', {
          method: 'POST',
          headers: tenantBHeaders,
          body: { LeadID: ids.leadId, RequirementID: ids.requirementId, PropertyID: ids.propertyId, NegotiationID: ids.negotiationId, TokenAmount: 250000 }
        });
        assert.equal(crossTokenCreate.response.status, 403);

        const crossDealCreate = await requestJson(server.baseUrl, '/api/deals', {
          method: 'POST',
          headers: tenantBHeaders,
          body: { LeadID: ids.leadId, RequirementID: ids.requirementId, PropertyID: ids.propertyId, NegotiationID: ids.negotiationId, TokenID: ids.tokenId, FinalPrice: 5100000 }
        });
        assert.equal(crossDealCreate.response.status, 403);

        const crossCommissionStatus = await requestJson(server.baseUrl, `/api/commission/${ids.commissionId}/status`, {
          method: 'PATCH',
          headers: tenantBHeaders,
          body: { Status: 'PARTIAL' }
        });
        assert.equal(crossCommissionStatus.response.status, 403);

        const crossClosing = await requestJson(server.baseUrl, `/api/closing/${ids.dealId}/checklist`, {
          method: 'PATCH',
          headers: tenantBHeaders,
          body: { ItemKey: 'TOKEN_VERIFIED', Status: 'COMPLETED' }
        });
        assert.equal(crossClosing.response.status, 403);

        const owners = await requestJson(server.baseUrl, '/api/owners', { headers: tenantBHeaders });
        assert.equal(owners.response.status, 200);
        assert.equal((owners.payload.data || []).some((row) => row.OwnerID === ids.ownerId), false);

        const builders = await requestJson(server.baseUrl, '/api/builders', { headers: tenantBHeaders });
        assert.equal(builders.response.status, 200);
        assert.equal((builders.payload.data || []).some((row) => row.BuilderID === ids.builderId), false);

        const projects = await requestJson(server.baseUrl, '/api/projects', { headers: tenantBHeaders });
        assert.equal(projects.response.status, 200);
        assert.equal((projects.payload.data || []).some((row) => row.ProjectID === ids.projectId), false);
      } finally {
        await stopServer(server.child);
      }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 3000000, BudgetMax: 6000000 }
    });
    assert.equal(reqRes.response.status, 200, `Requirement creation failed: ${JSON.stringify(reqRes.payload)}`);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId);

    stampRequirementTenant(dbFile, requirementId, 'COMP-AAA', 'BRK-AAA');

    // Same tenant A deletes their own requirement — must succeed
    const del = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      method: 'DELETE',
      headers: tenantAHeaders
    });
    assert.equal(del.response.status, 200, 'Same-tenant DELETE /api/requirements/:id must return 200');
    assert.equal(del.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Broker-network public share routes must remain publicly accessible
// ─────────────────────────────────────────────────────────────────────────────

test('broker-network public share routes remain accessible without auth after security fixes', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    // Tenant A creates a lead and requirement that they own
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Share Test Client', City: 'Hyderabad', Phone: '9000000099', Email: 'sharetest@example.com', assignedAgentId: 'USR-TENANT-A' }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;
    assert.ok(leadId);

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 5000000, BudgetMax: 10000000 }
    });
    assert.equal(reqRes.response.status, 200);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId);

    // Tenant A creates a broker-network share for their own requirement
    const shareRes = await requestJson(server.baseUrl, '/api/broker-network/shares', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { requirementId, expiry: '7d' }
    });
    assert.equal(shareRes.response.status, 201, `Share creation failed: ${JSON.stringify(shareRes.payload)}`);
    const token = shareRes.payload.data?.token;
    assert.ok(token, 'Share token must be present');

    // Unauthenticated GET of the public share endpoint must return 200
    const publicRes = await requestJson(server.baseUrl, `/api/broker-network/public/${token}`);
    assert.equal(publicRes.response.status, 200, 'Public share route must be accessible without auth');
    assert.ok(publicRes.payload.ok !== false, 'Public share route must return a valid response');
  } finally {
    await stopServer(server.child);
  }
});
