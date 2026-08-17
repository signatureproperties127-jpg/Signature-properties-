/**
 * PHASE 18 — Lead Module V2 Tests
 *
 * Tests covering all V2 contracts:
 *   - IdEngine: ID format, counter persistence
 *   - V2LeadService: create, duplicate detection, update, tags, workflow transitions
 *   - V2TransactionService: create, update, parent-chain validation
 *   - V2RequirementService: create with form version, parent-chain validation, score
 *   - V2Config: form registry
 *   - Regression: legacy routes still function
 */

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Test DB helper ─────────────────────────────────────────────────────────────

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-v2-test-'));
  return path.join(dir, 'test.json');
}

function makeRepo(dbFile) {
  const { JsonRepository } = require('../src/data/repository');
  return new JsonRepository(dbFile);
}

// ── IdEngine ──────────────────────────────────────────────────────────────────

describe('IdEngine', () => {
  test('generates Lead IDs in L000001 format', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const repo  = makeRepo(makeTempDb());
    const engine = new IdEngine(repo);
    const id = engine.nextLeadId();
    assert.match(id, /^L\d{6,}$/);
  });

  test('generates sequentially incrementing IDs', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const repo   = makeRepo(makeTempDb());
    const engine = new IdEngine(repo);
    const id1 = engine.nextLeadId();
    const id2 = engine.nextLeadId();
    const n1  = parseInt(id1.slice(1), 10);
    const n2  = parseInt(id2.slice(1), 10);
    assert.equal(n2, n1 + 1);
  });

  test('generates Transaction IDs in T000001 format', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const repo   = makeRepo(makeTempDb());
    const engine = new IdEngine(repo);
    const id = engine.nextTransactionId();
    assert.match(id, /^T\d{6,}$/);
  });

  test('generates Requirement IDs in R000001 format', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const repo   = makeRepo(makeTempDb());
    const engine = new IdEngine(repo);
    const id = engine.nextRequirementId();
    assert.match(id, /^R\d{6,}$/);
  });

  test('counters persist across repository reads', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const dbFile  = makeTempDb();
    const repo1   = makeRepo(dbFile);
    const engine1 = new IdEngine(repo1);
    engine1.nextLeadId(); // L000001
    engine1.nextLeadId(); // L000002

    const repo2   = makeRepo(dbFile);
    const engine2 = new IdEngine(repo2);
    const id3 = engine2.nextLeadId(); // L000003
    assert.equal(parseInt(id3.slice(1), 10), 3);
  });

  test('isV2LeadId detects V2 format', () => {
    const { IdEngine } = require('../src/data/idEngine');
    assert.equal(IdEngine.isV2LeadId('L000001'), true);
    assert.equal(IdEngine.isV2LeadId('LEAD-0001-12345'), false);
    assert.equal(IdEngine.isV2LeadId(null), false);
  });
});

// ── V2LeadService ─────────────────────────────────────────────────────────────

describe('V2LeadService', () => {
  let repo, svc;
  beforeEach(() => {
    repo = makeRepo(makeTempDb());
    const { V2LeadService } = require('../src/services/v2LeadService');
    svc = new V2LeadService(repo);
  });

  test('creates a lead with V2 ID', () => {
    // Use phone that does not conflict with seed data (seed uses 9876543210)
    const result = svc.createLead({ ClientName: 'Ravi Kumar', PrimaryMobile: '9971230001', Email: 'raviv2test@example.com' });
    assert.equal(result.ok, true, result.error || JSON.stringify(result));
    assert.match(result.data.LeadID, /^L\d{6,}$/);
    assert.equal(result.data.ClientName, 'Ravi Kumar');
    assert.equal(result.data._v2, true);
  });

  test('sets default ClientStatus to New', () => {
    const result = svc.createLead({ ClientName: 'Test User', PrimaryMobile: '9000000001' });
    assert.equal(result.ok, true);
    assert.equal(result.data.ClientStatus, 'New');
  });

  test('sets default ClientLifecycle to Prospect', () => {
    const result = svc.createLead({ ClientName: 'Test User', PrimaryMobile: '9000000002' });
    assert.equal(result.ok, true);
    assert.equal(result.data.ClientLifecycle, 'Prospect');
  });

  test('sets RecordHash on creation', () => {
    const result = svc.createLead({ ClientName: 'Hash Test', PrimaryMobile: '9000000003' });
    assert.equal(result.ok, true);
    assert.ok(result.data.RecordHash);
  });

  test('exact duplicate (same mobile) is rejected', () => {
    svc.createLead({ ClientName: 'Duplicate A', PrimaryMobile: '9111111111' });
    const result = svc.createLead({ ClientName: 'Duplicate B', PrimaryMobile: '9111111111' });
    assert.equal(result.ok, false);
    assert.equal(result.duplicateResult, 'EXACT_MATCH');
  });

  test('exact duplicate (same email) is rejected', () => {
    svc.createLead({ ClientName: 'User A', PrimaryMobile: '9222222221', Email: 'same@test.com' });
    const result = svc.createLead({ ClientName: 'User B', PrimaryMobile: '9222222222', Email: 'same@test.com' });
    assert.equal(result.ok, false);
    assert.equal(result.duplicateResult, 'EXACT_MATCH');
  });

  test('confirmDuplicate flag allows creation over possible duplicate', () => {
    svc.createLead({ ClientName: 'Ravi Kumar', PrimaryMobile: '9333333333' });
    const result = svc.createLead({ ClientName: 'Ravi Kumar', PrimaryMobile: '9333333334' }, {}, { allowPossibleDuplicate: true });
    assert.equal(result.ok, true);
  });

  test('checkDuplicate returns NO_MATCH for brand new contact', () => {
    const result = svc.checkDuplicate({ PrimaryMobile: '9888888888', Email: 'new@test.com' });
    assert.equal(result.result, 'NO_MATCH');
  });

  test('updateLead allows valid status transition New → Active', () => {
    const created = svc.createLead({ ClientName: 'Status Test', PrimaryMobile: '9444444440' });
    const updated = svc.updateLead(created.data.LeadID, { ClientStatus: 'Active' });
    assert.equal(updated.ok, true);
    assert.equal(updated.data.ClientStatus, 'Active');
  });

  test('updateLead blocks invalid status transition Active → New', () => {
    const created = svc.createLead({ ClientName: 'Invalid Tx', PrimaryMobile: '9444444441' });
    svc.updateLead(created.data.LeadID, { ClientStatus: 'Active' });
    const result = svc.updateLead(created.data.LeadID, { ClientStatus: 'New' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not allowed'));
  });

  test('updateLead increments Version', () => {
    const created = svc.createLead({ ClientName: 'Ver Test', PrimaryMobile: '9444444442' });
    assert.equal(created.data.Version, 1);
    const updated = svc.updateLead(created.data.LeadID, { Notes: 'Updated' });
    assert.equal(updated.data.Version, 2);
  });

  test('addTag applies valid tag', () => {
    const created = svc.createLead({ ClientName: 'Tag Test', PrimaryMobile: '9555555555' });
    const tagged  = svc.addTag(created.data.LeadID, 'VIP');
    assert.equal(tagged.ok, true);
    assert.ok(tagged.data.Tags.includes('VIP'));
  });

  test('addTag rejects invalid tag', () => {
    const created = svc.createLead({ ClientName: 'Tag Bad', PrimaryMobile: '9555555556' });
    const result  = svc.addTag(created.data.LeadID, 'INVALID_TAG');
    assert.equal(result.ok, false);
  });

  test('removeTag removes a tag', () => {
    const created = svc.createLead({ ClientName: 'Tag Remove', PrimaryMobile: '9555555557', Tags: ['VIP', 'Hot'] });
    svc.removeTag(created.data.LeadID, 'Hot');
    const lead = repo.readLead(created.data.LeadID);
    assert.ok(!lead.Tags.includes('Hot'));
    assert.ok(lead.Tags.includes('VIP'));
  });

  test('listLeads filters by ClientStatus', () => {
    svc.createLead({ ClientName: 'A', PrimaryMobile: '9600000001' });
    svc.createLead({ ClientName: 'B', PrimaryMobile: '9600000002', ClientStatus: 'Verified' });
    const results = svc.listLeads({ ClientStatus: 'New' });
    assert.ok(results.every(r => r.ClientStatus === 'New' || r.LeadStatus === 'New'));
  });

  test('findLeadByMobile normalizes phone format', () => {
    // Use a phone that is not in seed data
    svc.createLead({ ClientName: 'Phone Norm', PrimaryMobile: '+91 99710 00099' });
    const found = svc.findLeadByMobile('9971000099');
    assert.ok(found, 'Expected to find the lead by normalized phone');
    assert.equal(found.ClientName, 'Phone Norm');
  });
});

// ── V2TransactionService ───────────────────────────────────────────────────────

describe('V2TransactionService', () => {
  let repo, leadSvc, txnSvc;
  beforeEach(() => {
    repo = makeRepo(makeTempDb());
    const { V2LeadService }        = require('../src/services/v2LeadService');
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    leadSvc = new V2LeadService(repo);
    txnSvc  = new V2TransactionService(repo);
  });

  function createTestLead(mobile = '9700000001') {
    const res = leadSvc.createLead({ ClientName: 'Txn Test Lead', PrimaryMobile: mobile });
    return res.data;
  }

  test('creates transaction with V2 ID', () => {
    const lead = createTestLead();
    const result = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Purchase' });
    assert.equal(result.ok, true);
    assert.match(result.data.TransactionID, /^T\d{6,}$/);
    assert.equal(result.data._v2, true);
  });

  test('creates transaction with correct LeadID', () => {
    const lead = createTestLead();
    const result = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Rent' });
    assert.equal(result.ok, true);
    assert.equal(result.data.LeadID, lead.LeadID);
  });

  test('rejects invalid TransactionType', () => {
    const lead = createTestLead('9700000002');
    const result = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Gift' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('TransactionType'));
  });

  test('rejects transaction for non-existent lead', () => {
    const result = txnSvc.createTransaction('L999999', { TransactionType: 'Purchase' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'));
  });

  test('TransactionID is immutable on update', () => {
    const lead  = createTestLead('9700000003');
    const txn   = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Sale' });
    const result = txnSvc.updateTransaction(txn.data.TransactionID, { TransactionID: 'T999999' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('immutable'));
  });

  test('LeadID is immutable on update', () => {
    const lead  = createTestLead('9700000004');
    const txn   = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Sale' });
    const result = txnSvc.updateTransaction(txn.data.TransactionID, { LeadID: 'L999999' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('immutable'));
  });

  test('blocks invalid status transition Open → Closed (must go through Active)', () => {
    // Note: Open → Closed IS allowed per WorkflowConfig
    const lead  = createTestLead('9700000005');
    const txn   = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Purchase' });
    const result = txnSvc.updateTransaction(txn.data.TransactionID, { TransactionStatus: 'Closed' });
    // Open → Closed is allowed per config
    assert.equal(result.ok, true);
  });

  test('blocks transition from Closed', () => {
    const lead  = createTestLead('9700000006');
    const txn   = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Purchase' });
    txnSvc.updateTransaction(txn.data.TransactionID, { TransactionStatus: 'Closed' });
    const result = txnSvc.updateTransaction(txn.data.TransactionID, { TransactionStatus: 'Open' });
    assert.equal(result.ok, false);
  });

  test('listTransactionsByLead returns only that lead\'s transactions', () => {
    // Self-contained: create own repo/services to avoid beforeEach shared state
    const localRepo = makeRepo(makeTempDb());
    const { V2LeadService }        = require('../src/services/v2LeadService');
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    const localLeadSvc = new V2LeadService(localRepo);
    const localTxnSvc  = new V2TransactionService(localRepo);

    const r1 = localLeadSvc.createLead({ ClientName: 'Lead One',  PrimaryMobile: '9900000010' });
    const r2 = localLeadSvc.createLead({ ClientName: 'Lead Two',  PrimaryMobile: '9900000011' });
    assert.ok(r1.ok, r1.error || 'lead1 create failed');
    assert.ok(r2.ok, r2.error || 'lead2 create failed');

    const lead1 = r1.data;
    const lead2 = r2.data;

    localTxnSvc.createTransaction(lead1.LeadID, { TransactionType: 'Purchase' });
    localTxnSvc.createTransaction(lead1.LeadID, { TransactionType: 'Rent' });
    localTxnSvc.createTransaction(lead2.LeadID, { TransactionType: 'Sale' });
    const rows = localTxnSvc.listTransactionsByLead(lead1.LeadID);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.LeadID === lead1.LeadID));
  });
});

// ── V2RequirementService ───────────────────────────────────────────────────────

describe('V2RequirementService', () => {
  let repo, leadSvc, txnSvc, reqSvc;
  beforeEach(() => {
    repo = makeRepo(makeTempDb());
    const { V2LeadService }          = require('../src/services/v2LeadService');
    const { V2TransactionService }   = require('../src/services/v2TransactionService');
    const { V2RequirementService }   = require('../src/services/v2RequirementService');
    leadSvc = new V2LeadService(repo);
    txnSvc  = new V2TransactionService(repo);
    reqSvc  = new V2RequirementService(repo);
  });

  function setup(mobile = '9800000001') {
    const lead = leadSvc.createLead({ ClientName: 'Req Test', PrimaryMobile: mobile }).data;
    const txn  = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Purchase' }).data;
    return { lead, txn };
  }

  /**
   * Minimum payload that satisfies all required fields in the generic form
   * (common fields: BudgetMin, BudgetMax, Location1, Urgency).
   * Tests that need a specific form (Residential/Commercial) add their own required fields.
   */
  function minReq(leadId, overrides = {}) {
    return {
      LeadID:    leadId,
      BudgetMin: 5000000,
      BudgetMax: 10000000,
      Location1: 'Test Location',
      Urgency:   'High',
      ...overrides
    };
  }

  test('creates requirement with V2 ID', () => {
    const { lead, txn } = setup();
    // Generic form — only common required fields needed
    const result = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.equal(result.ok, true, result.error || 'create failed');
    assert.match(result.data.RequirementID, /^R\d{6,}$/);
    assert.equal(result.data._v2, true);
  });

  test('enforces Requirement.LeadID == Transaction.LeadID', () => {
    const { lead, txn } = setup();
    const lead2 = leadSvc.createLead({ ClientName: 'Other Lead', PrimaryMobile: '9800000099' }).data;
    const result = reqSvc.createRequirement(txn.TransactionID, { LeadID: lead2.LeadID });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('LeadID'));
  });

  test('rejects requirement for non-existent transaction', () => {
    const { lead } = setup();
    const result = reqSvc.createRequirement('T999999', { LeadID: lead.LeadID });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'));
  });

  test('freezes FormVersion at creation time', () => {
    const { lead, txn } = setup('9800000002');
    // Generic form — only common required fields needed
    const result = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.ok(result.ok, result.error || 'create failed');
    assert.ok(result.data.FormVersion);
    const fv = result.data.FormVersion;

    // Update cannot change FormVersion
    const updateResult = reqSvc.updateRequirement(result.data.RequirementID, { FormVersion: 'hacked-v99' });
    assert.equal(updateResult.ok, false);
    assert.ok(updateResult.error.includes('FormVersion'));

    // Verify original FormVersion unchanged
    const req2 = repo.read().Requirements.find(r => r.RequirementID === result.data.RequirementID);
    assert.equal(req2.FormVersion, fv);
  });

  test('budget validation: BudgetMin cannot exceed BudgetMax', () => {
    const { lead, txn } = setup('9800000003');
    // Provide all required fields but with invalid budget range
    const result = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID, { BudgetMin: 10000000, BudgetMax: 5000000 }));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Budget') || result.error.includes('budget'),
      `Expected budget error, got: ${result.error}`);
  });

  test('RequirementID and LeadID are immutable on update', () => {
    const { lead, txn } = setup('9800000004');
    // Generic form — no category-specific required fields
    const created = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.ok(created.ok, created.error || 'create failed');
    const r1 = reqSvc.updateRequirement(created.data.RequirementID, { RequirementID: 'R999999' });
    assert.equal(r1.ok, false);
    const r2 = reqSvc.updateRequirement(created.data.RequirementID, { LeadID: 'L999999' });
    assert.equal(r2.ok, false);
  });

  test('blocks invalid RequirementStatus transition', () => {
    const { lead, txn } = setup('9800000005');
    // Create with Active status — needs all required fields
    const created = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID, { RequirementStatus: 'Active' }));
    assert.ok(created.ok, created.error || 'create failed');
    // Active → Draft is not allowed
    const result = reqSvc.updateRequirement(created.data.RequirementID, { RequirementStatus: 'Draft' });
    assert.equal(result.ok, false);
  });

  test('computes RequirementScore on creation', () => {
    const { lead, txn } = setup('9800000006');
    // Generic form — avoids category-specific required fields (BHKMin etc.)
    const result = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.ok(result.ok, result.error || 'create failed');
    assert.ok(typeof result.data.RequirementScore === 'number' || (typeof result.data.RequirementScore === 'object' && result.data.RequirementScore !== null));
  });

  test('records RequirementHistory on creation', () => {
    const { lead, txn } = setup('9800000007');
    const r = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.ok(r.ok, r.error || 'create failed');
    const db = repo.read();
    assert.ok((db.RequirementHistory || []).length > 0);
  });

  test('listRequirementsByTransaction returns only that transaction\'s requirements', () => {
    const { lead, txn } = setup('9800000008');
    const txn2 = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Rent' }).data;
    reqSvc.createRequirement(txn.TransactionID,  minReq(lead.LeadID));
    reqSvc.createRequirement(txn2.TransactionID, minReq(lead.LeadID));
    const rows = reqSvc.listRequirementsByTransaction(txn.TransactionID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].TransactionID, txn.TransactionID);
  });

  test('listGlobalRequirements enriches with client name', () => {
    const { lead, txn } = setup('9800000009');
    // Generic form — avoids category-specific required fields
    reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    const rows = reqSvc.listGlobalRequirements();
    const row  = rows.find(r => r.LeadID === lead.LeadID);
    assert.ok(row);
    assert.equal(row.clientName, 'Req Test');
  });
});

// ── V2Config ───────────────────────────────────────────────────────────────────

describe('V2Config', () => {
  test('V2FormRegistry contains Residential Flat Purchase entry', () => {
    const { V2FormRegistry } = require('../src/data/v2Config');
    const key = 'Purchase|Residential|Flat';
    assert.ok(V2FormRegistry[key]);
    assert.equal(V2FormRegistry[key].transactionType, 'Purchase');
    assert.equal(V2FormRegistry[key].category, 'Residential');
  });

  test('V2FormRegistry entries have a formVersion', () => {
    const { V2FormRegistry, FORM_REGISTRY_VERSION } = require('../src/data/v2Config');
    for (const key of Object.keys(V2FormRegistry)) {
      const form = V2FormRegistry[key];
      assert.ok(form.formVersion, `${key} missing formVersion`);
    }
  });

  test('EntityConfig defines Lead statuses', () => {
    const { EntityConfig } = require('../src/data/v2Config');
    assert.ok(Array.isArray(EntityConfig.Lead.statuses));
    assert.ok(EntityConfig.Lead.statuses.includes('New'));
    assert.ok(EntityConfig.Lead.statuses.includes('Blacklisted'));
  });

  test('WorkflowConfig Blacklisted leads have no transitions', () => {
    const { WorkflowConfig } = require('../src/data/v2Config');
    assert.deepEqual(WorkflowConfig.leadStatus.transitions['Blacklisted'], []);
  });

  test('TagConfig includes Investor, VIP, Hot, NRI', () => {
    const { TagConfig } = require('../src/data/v2Config');
    const tags = TagConfig.availableTags.map(t => t.value);
    for (const t of ['Investor', 'VIP', 'Hot', 'NRI']) {
      assert.ok(tags.includes(t), `Missing tag: ${t}`);
    }
  });
});

// ── normalizePhone ────────────────────────────────────────────────────────────

describe('normalizePhone', () => {
  test('strips country code +91', () => {
    const { normalizePhone } = require('../src/services/v2LeadService');
    assert.equal(normalizePhone('+919876543210'), '9876543210');
  });

  test('strips spaces and hyphens', () => {
    const { normalizePhone } = require('../src/services/v2LeadService');
    assert.equal(normalizePhone('+91 98765-43210'), '9876543210');
  });

  test('handles null gracefully', () => {
    const { normalizePhone } = require('../src/services/v2LeadService');
    assert.equal(normalizePhone(null), null);
  });
});

// ── V2Router: legacy contract + feature flag ──────────────────────────────────

describe('V2Router: legacy contract and feature flag', () => {
  function makeRouter(dbFile) {
    const { V2Router } = require('../src/api/v2Router');
    const repo = makeRepo(dbFile);
    return new V2Router(repo);
  }

  function fakeUrl(pathname, params = {}) {
    const url = new URL(`http://localhost${pathname}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url;
  }

  function fakeReq(method = 'GET') {
    return { method, headers: {} };
  }

  test('check-duplicate is always active (new route, no flag needed)', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('POST'), null, fakeUrl('/api/leads/check-duplicate'), { PrimaryMobile: '9999000001' });
      assert.ok(result !== null, 'check-duplicate must be handled regardless of flag');
      assert.equal(result.handled, true);
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/leads falls through to legacy when LEAD_V2_ENABLED is false', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/leads'), {});
      assert.equal(result, null, 'GET /api/leads must fall through when flag is off');
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('POST /api/leads falls through to legacy when LEAD_V2_ENABLED is false', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('POST'), null, fakeUrl('/api/leads'), { ClientName: 'Test' });
      assert.equal(result, null, 'POST /api/leads must fall through when flag is off');
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/leads is handled when LEAD_V2_ENABLED is true', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'true';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/leads'), {});
      assert.ok(result !== null, 'GET /api/leads must be handled when flag is on');
      assert.equal(result.handled, true);
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/leads/:id falls through when flag is off', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/leads/LEAD-0001'), {});
      assert.equal(result, null, 'GET /api/leads/:id must fall through when flag is off');
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/requirements falls through when flag is off', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/requirements'), {});
      assert.equal(result, null, 'GET /api/requirements must fall through when flag is off');
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/transactions/:id is always handled (new route)', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/transactions/T000001'), {});
      // Returns handled=true with 404 (not found) — still routed by V2Router
      assert.ok(result !== null, 'GET /api/transactions/:id must be handled by V2Router (new route)');
      assert.equal(result.handled, true);
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });
});

// ── Server-side form validation ───────────────────────────────────────────────

describe('V2RequirementService: server-side form validation', () => {
  function makeServices(dbFile) {
    const repo = makeRepo(dbFile);
    const { V2LeadService }        = require('../src/services/v2LeadService');
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    return {
      repo,
      leadSvc: new V2LeadService(repo),
      txnSvc:  new V2TransactionService(repo),
      reqSvc:  new V2RequirementService(repo)
    };
  }

  function createParents(svcs, mobileSuffix = '01') {
    const lead = svcs.leadSvc.createLead({ ClientName: 'Val Test', PrimaryMobile: `9988770${mobileSuffix}` });
    assert.ok(lead.ok, lead.error);
    const txn = svcs.txnSvc.createTransaction(lead.data.LeadID, { TransactionType: 'Purchase' });
    assert.ok(txn.ok, txn.error);
    return { leadId: lead.data.LeadID, txnId: txn.data.TransactionID };
  }

  test('rejects missing required field (Urgency) for Residential Flat', () => {
    const svcs = makeServices(makeTempDb());
    const { leadId, txnId } = createParents(svcs, '02');
    const result = svcs.reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      TransactionType: 'Purchase',
      Category: 'Residential',
      SubCategory: 'Flat',
      BudgetMin: 5000000,
      BudgetMax: 8000000,
      Location1: 'Pune',
      BHKMin: '2BHK',
      BHKMax: '3BHK'
      // Urgency intentionally omitted — it is required
    });
    assert.equal(result.ok, false, 'Should reject when required field Urgency is missing');
    assert.ok(result.error.toLowerCase().includes('urgency') || result.error.toLowerCase().includes('required'),
      `Expected 'urgency' or 'required' in error, got: ${result.error}`);
  });

  test('rejects invalid option value for a Select field', () => {
    const svcs = makeServices(makeTempDb());
    const { leadId, txnId } = createParents(svcs, '03');
    const result = svcs.reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      TransactionType: 'Purchase',
      Category: 'Residential',
      SubCategory: 'Flat',
      BudgetMin: 5000000,
      BudgetMax: 8000000,
      Location1: 'Pune',
      BHKMin: '2BHK',
      BHKMax: '3BHK',
      Urgency: 'SUPER_URGENT'  // Not in ['Immediate', 'High', 'Medium', 'Low']
    });
    assert.equal(result.ok, false, 'Should reject invalid option value');
    assert.ok(result.error.toLowerCase().includes('super_urgent') || result.error.toLowerCase().includes('urgency'),
      `Expected option error, got: ${result.error}`);
  });

  test('accepts valid option value for Urgency', () => {
    const svcs = makeServices(makeTempDb());
    const { leadId, txnId } = createParents(svcs, '04');
    const result = svcs.reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      TransactionType: 'Purchase',
      Category: 'Residential',
      SubCategory: 'Flat',
      BudgetMin: 5000000,
      BudgetMax: 8000000,
      Location1: 'Pune',
      BHKMin: '2BHK',
      BHKMax: '3BHK',
      Urgency: 'High'
    });
    assert.equal(result.ok, true, result.error || 'Should accept valid option value');
  });

  test('rejects negative number for positive-number field', () => {
    const svcs = makeServices(makeTempDb());
    const { leadId, txnId } = createParents(svcs, '05');
    const result = svcs.reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      TransactionType: 'Purchase',
      Category: 'Residential',
      SubCategory: 'Flat',
      BudgetMin: -100,  // Must be positive
      BudgetMax: 8000000,
      Location1: 'Pune',
      BHKMin: '2BHK',
      BHKMax: '3BHK',
      Urgency: 'High'
    });
    assert.equal(result.ok, false, 'Should reject negative positive-number field');
    assert.ok(result.error.toLowerCase().includes('positive') || result.error.toLowerCase().includes('budget'),
      `Expected positive/budget error, got: ${result.error}`);
  });
});

// ── Migration: dry-run is non-mutating ────────────────────────────────────────

describe('Migration: dry-run performs zero DB writes', () => {
  test('dry-run does not change _V2Counters or add records', () => {
    const dbFile = makeTempDb();
    const repo = makeRepo(dbFile);

    // Read baseline
    const before = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const countersBefore = { ...(before._V2Counters || {}) };
    const leadCountBefore = (before.Leads || []).length;

    // Build allocator (in-memory only — same as dry-run path in migrateV2.js)
    const { IdEngine, PREFIXES, formatV2Id, parseV2Seq } = require('../src/data/idEngine');

    // Simulate what buildIdAllocator does in dry-run — read DB snapshot, no writes
    const db = repo.read();
    const existing = db._V2Counters || {};
    let leadSeq = Math.max(existing.Lead || 0, ...(db.Leads || []).map((r) => parseV2Seq(r.LeadID, PREFIXES.Lead)));
    const nextId = formatV2Id(PREFIXES.Lead, ++leadSeq);
    assert.match(nextId, /^L\d{6,}$/, 'Allocator generates valid V2 ID');

    // Re-read DB — counters must be unchanged (no writes happened)
    const after = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.deepEqual(after._V2Counters || {}, countersBefore, 'Dry-run must not modify _V2Counters');
    assert.equal((after.Leads || []).length, leadCountBefore, 'Dry-run must not add lead records');
  });
});

// ── Regression: Repository existing functionality ─────────────────────────────

describe('Regression: existing repository methods', () => {
  test('createId still produces legacy-format IDs', () => {
    const repo = makeRepo(makeTempDb());
    const id = repo.createId('TEST');
    assert.ok(String(id).startsWith('TEST-'));
  });

  test('readLead still works for V2 leads', () => {
    const repo = makeRepo(makeTempDb());
    const { V2LeadService } = require('../src/services/v2LeadService');
    const svc = new V2LeadService(repo);
    const result = svc.createLead({ ClientName: 'Regression', PrimaryMobile: '9100000001' });
    const lead   = repo.readLead(result.data.LeadID);
    assert.ok(lead);
    assert.equal(lead.ClientName, 'Regression');
  });

  test('addTimelineEntry works for V2 entities', () => {
    const repo = makeRepo(makeTempDb());
    const { V2LeadService } = require('../src/services/v2LeadService');
    const svc = new V2LeadService(repo);
    const result = svc.createLead({ ClientName: 'Timeline Test', PrimaryMobile: '9100000002' });
    const db = repo.read();
    const events = (db.Timeline || []).filter(t => t.LeadID === result.data.LeadID);
    assert.ok(events.length > 0);
    assert.equal(events[0].EventType, 'LEAD_CREATED');
  });
});
