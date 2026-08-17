#!/usr/bin/env node
/**
 * PHASE 19 — V2 Migration Script (DRY-RUN by default)
 *
 * Migrates V1 leads/transactions/requirements to V2 format.
 *
 * Usage:
 *   node scripts/migrateV2.js --dry-run       (default — zero writes to DB)
 *   node scripts/migrateV2.js --apply          (writes changes in one atomic write)
 *   node scripts/migrateV2.js --report         (stats only)
 *   node scripts/migrateV2.js --rollback       (reverts using MigrationMap)
 *
 * Safety guarantees:
 *   - DRY-RUN performs ZERO writes to the database (no counter changes)
 *   - APPLY accumulates all changes in memory first, then writes once
 *   - No records are ever deleted (V1 records kept alongside V2 copies)
 *   - No auto-migration on startup
 *   - Rollback uses MigrationMap stored in db._V2MigrationMap
 */

'use strict';

const path  = require('path');
const fs    = require('fs');

const args     = process.argv.slice(2);
const DRY_RUN  = !args.includes('--apply');
const ROLLBACK = args.includes('--rollback');
const REPORT   = args.includes('--report');

const DB_FILE = process.env.SIG_REALTY_DB_FILE || path.join(__dirname, '../data/sig-realty-db.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[migrateV2] ${msg}`); }
function warn(msg) { console.warn(`[migrateV2] ⚠  ${msg}`); }
function ok(msg)   { console.log(`[migrateV2] ✓  ${msg}`); }

const { JsonRepository } = require('../src/data/repository');
const { IdEngine, PREFIXES, formatV2Id, parseV2Seq } = require('../src/data/idEngine');

const repo = new JsonRepository(DB_FILE);

// ── In-memory ID allocator (DRY-RUN safe, no DB writes) ───────────────────────

/**
 * Build a stateful ID allocator from the current DB state.
 * DRY-RUN: uses in-memory counters only — no writes.
 * APPLY:   used to pre-assign IDs before the single batch write.
 */
function buildIdAllocator(db) {
  // Bootstrap from existing V2 counters or max existing IDs
  const existing = db._V2Counters || {};
  const leadMax   = Math.max(existing.Lead || 0,   ...(db.Leads || []).map((r) => parseV2Seq(r.LeadID, PREFIXES.Lead)));
  const txnMax    = Math.max(existing.Transaction || 0, ...(db.Transactions || []).map((r) => parseV2Seq(r.TransactionID, PREFIXES.Transaction)));
  const reqMax    = Math.max(existing.Requirement || 0, ...(db.Requirements || []).map((r) => parseV2Seq(r.RequirementID, PREFIXES.Requirement)));

  const counters = { Lead: leadMax, Transaction: txnMax, Requirement: reqMax };

  return {
    nextLeadId()        { return formatV2Id(PREFIXES.Lead,        ++counters.Lead); },
    nextTransactionId() { return formatV2Id(PREFIXES.Transaction,  ++counters.Transaction); },
    nextRequirementId() { return formatV2Id(PREFIXES.Requirement,  ++counters.Requirement); },
    finalCounters()     { return { ...counters }; }
  };
}

// ── V1 detection ──────────────────────────────────────────────────────────────

function isV1Lead(lead)   { return !lead._v2 && !IdEngine.isV2LeadId(lead.LeadID || ''); }
function isV1Txn(t)       { return !t._v2 && !IdEngine.isV2TransactionId(t.TransactionID || ''); }
function isV1Req(r)       { return !r._v2 && !IdEngine.isV2RequirementId(r.RequirementID || ''); }

// ── ROLLBACK ──────────────────────────────────────────────────────────────────

function doRollback() {
  log('Starting rollback…');
  const db  = repo.read();
  const map = db._V2MigrationMap;

  if (!map || !map.leads || map.leads.length === 0) {
    warn('No migration map found in database. Nothing to rollback.');
    process.exit(1);
  }

  log(`Migration map found. Migrated: ${map.leads.length} leads, ${map.transactions.length} transactions, ${map.requirements.length} requirements`);

  const migratedLeadIds = new Set(map.leads.map((m) => m.v2Id));
  const migratedTxnIds  = new Set(map.transactions.map((m) => m.v2Id));
  const migratedReqIds  = new Set(map.requirements.map((m) => m.v2Id));

  // Only remove records created by migration (marked with _migratedFromV1)
  const beforeLeads = db.Leads.length;
  db.Leads        = (db.Leads || []).filter((l) => !(migratedLeadIds.has(l.LeadID) && l._migratedFromV1));
  db.Transactions = (db.Transactions || []).filter((t) => !(migratedTxnIds.has(t.TransactionID) && t._migratedFromV1));
  db.Requirements = (db.Requirements || []).filter((r) => !(migratedReqIds.has(r.RequirementID) && r._migratedFromV1));

  // Restore V2 counters to pre-migration values
  if (map.countersBefore) {
    db._V2Counters = map.countersBefore;
  }

  delete db._V2MigrationMap;

  if (!DRY_RUN) {
    repo.write(db);
    ok(`Rollback complete. Removed ${beforeLeads - db.Leads.length} migrated records.`);
  } else {
    log(`DRY-RUN: would remove ${beforeLeads - db.Leads.length} migrated records (no writes performed).`);
  }
}

// ── MIGRATE ───────────────────────────────────────────────────────────────────

function buildMigration(db, allocator) {
  const { FORM_REGISTRY_VERSION } = require('../src/data/v2Config');
  const now         = new Date().toISOString();
  const migrationMap = {
    migratedAt:     now,
    dryRun:         DRY_RUN,
    countersBefore: { ...(db._V2Counters || {}) },
    leads:          [],
    transactions:   [],
    requirements:   []
  };

  const newLeads        = [];
  const newTransactions = [];
  const newRequirements = [];

  // ── Leads ────────────────────────────────────────────────────────────────
  const v1Leads = (db.Leads || []).filter(isV1Lead);
  log(`Found ${v1Leads.length} V1 leads to migrate`);

  for (const v1 of v1Leads) {
    const v2Id = allocator.nextLeadId();
    migrationMap.leads.push({ v1Id: v1.LeadID, v2Id, migratedAt: now });

    newLeads.push({
      LeadID:          v2Id,
      ClientName:      v1.ClientName || v1.Name || null,
      PrimaryMobile:   v1.Phone || v1.PrimaryMobile || null,
      AlternateMobile: v1.AlternateMobile || null,
      WhatsApp:        v1.WhatsApp || null,
      Email:           v1.Email || null,
      ClientStatus:    v1.LeadStatus || v1.ClientStatus || 'New',
      LeadStatus:      v1.LeadStatus || 'New',
      ClientLifecycle: 'Prospect',
      ClientScore:     0,
      Source:          v1.Source || v1.LeadSource || 'Manual',
      LeadSource:      v1.LeadSource || v1.Source || 'Manual',
      Phone:           v1.Phone || null,
      City:            v1.City || null,
      AssignedAgentID: v1.AssignedAgentID || v1.AgentID || null,
      Tags:            [],
      Notes:           v1.Notes || v1.Description || '',
      CreatedBy:       'migration',
      CreatedAt:       v1.CreatedAt || now,
      UpdatedBy:       'migration',
      UpdatedAt:       now,
      Version:         1,
      RecordHash:      null,
      LegacyID:        v1.LeadID,
      _v2:             true,
      _migratedFromV1: true
    });

    ok(`Lead: ${v1.LeadID} → ${v2Id} (${v1.ClientName || v1.Name})`);
  }

  // ── Transactions ──────────────────────────────────────────────────────────
  const v1Txns  = (db.Transactions || []).filter(isV1Txn);
  log(`Found ${v1Txns.length} V1 transactions to migrate`);

  const validTxnTypes = ['Purchase', 'Sale', 'Rent', 'Rent Out', 'Lease', 'Lease Out'];

  for (const v1 of v1Txns) {
    const leadMap  = migrationMap.leads.find((m) => m.v1Id === v1.LeadID);
    const v2LeadId = leadMap ? leadMap.v2Id : v1.LeadID;
    const v2Id     = allocator.nextTransactionId();
    const txnType  = v1.TransactionType || v1.Type || 'Purchase';

    migrationMap.transactions.push({ v1Id: v1.TransactionID, v2Id, v2LeadId, migratedAt: now });

    newTransactions.push({
      TransactionID:     v2Id,
      LeadID:            v2LeadId,
      TransactionType:   validTxnTypes.includes(txnType) ? txnType : 'Purchase',
      Type:              validTxnTypes.includes(txnType) ? txnType : 'Purchase',
      TransactionStatus: v1.Status || v1.TransactionStatus || 'Open',
      Status:            v1.Status || 'Open',
      PipelineStage:     v1.Stage || v1.PipelineStage || 'New',
      Notes:             v1.Notes || '',
      CreatedBy:         'migration',
      CreatedAt:         v1.CreatedAt || now,
      UpdatedBy:         'migration',
      UpdatedAt:         now,
      Version:           1,
      LegacyID:          v1.TransactionID,
      _v2:               true,
      _migratedFromV1:   true
    });

    ok(`Transaction: ${v1.TransactionID} → ${v2Id} (Lead: ${v2LeadId})`);
  }

  // ── Requirements ──────────────────────────────────────────────────────────
  const v1Reqs = (db.Requirements || []).filter(isV1Req);
  log(`Found ${v1Reqs.length} V1 requirements to migrate`);

  for (const v1 of v1Reqs) {
    const leadMap = migrationMap.leads.find((m) => m.v1Id === v1.LeadID);
    const txnMap  = migrationMap.transactions.find((m) => m.v1Id === (v1.TransactionID || v1.transactionId));

    const v2LeadId = leadMap ? leadMap.v2Id : v1.LeadID;
    const v2TxnId  = txnMap  ? txnMap.v2Id  : v1.TransactionID;

    if (!v2TxnId) {
      warn(`Requirement ${v1.RequirementID}: no matching Transaction — skipping`);
      continue;
    }

    const v2Id = allocator.nextRequirementId();
    migrationMap.requirements.push({ v1Id: v1.RequirementID, v2Id, v2LeadId, v2TxnId, migratedAt: now });

    newRequirements.push({
      RequirementID:      v2Id,
      RequirementCode:    v2Id,
      LeadID:             v2LeadId,
      TransactionID:      v2TxnId,
      TransactionType:    v1.TransactionType || 'Purchase',
      RequirementStatus:  v1.Status || v1.RequirementStatus || 'Draft',
      Status:             v1.Status || 'Draft',
      PipelineStage:      v1.PipelineStage || 'New',
      Category:           v1.Category || null,
      SubCategory:        v1.SubCategory || null,
      PropertyType:       v1.PropertyType || null,
      BudgetMin:          v1.BudgetMin || null,
      BudgetMax:          v1.BudgetMax || null,
      Location1:          v1.Location || v1.Location1 || null,
      Location2:          v1.Location2 || null,
      Urgency:            v1.Urgency || null,
      Possession:         v1.Possession || null,
      BHKMin:             v1.BHKMin || null,
      BHKMax:             v1.BHKMax || null,
      AreaMin:            v1.AreaMin || null,
      AreaMax:            v1.AreaMax || null,
      SpecialNotes:       v1.SpecialNotes || v1.Notes || null,
      FormVersion:        FORM_REGISTRY_VERSION,
      FormKey:            'generic',
      RequirementScore:   null,
      ScoreBreakdown:     null,
      CreatedBy:          'migration',
      CreatedAt:          v1.CreatedAt || now,
      UpdatedBy:          'migration',
      UpdatedAt:          now,
      Version:            1,
      LegacyID:           v1.RequirementID,
      _v2:                true,
      _migratedFromV1:    true
    });

    ok(`Requirement: ${v1.RequirementID} → ${v2Id}`);
  }

  return { migrationMap, newLeads, newTransactions, newRequirements, finalCounters: allocator.finalCounters() };
}

// ── Report ────────────────────────────────────────────────────────────────────

function report(db) {
  const v1Leads = (db.Leads || []).filter(isV1Lead);
  const v2Leads = (db.Leads || []).filter((l) => l._v2);
  const v1Txns  = (db.Transactions || []).filter(isV1Txn);
  const v2Txns  = (db.Transactions || []).filter((t) => t._v2);
  const v1Reqs  = (db.Requirements || []).filter(isV1Req);
  const v2Reqs  = (db.Requirements || []).filter((r) => r._v2);

  console.log('\n── Migration Report ──────────────────────────────────');
  console.log(`Leads:         V1: ${v1Leads.length}   V2: ${v2Leads.length}   Total: ${(db.Leads||[]).length}`);
  console.log(`Transactions:  V1: ${v1Txns.length}  V2: ${v2Txns.length}  Total: ${(db.Transactions||[]).length}`);
  console.log(`Requirements:  V1: ${v1Reqs.length}  V2: ${v2Reqs.length}  Total: ${(db.Requirements||[]).length}`);
  console.log(`_V2Counters: ${JSON.stringify(db._V2Counters || {})}`);
  console.log('─────────────────────────────────────────────────────\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log(`Database: ${DB_FILE}`);
  log(`Mode: ${ROLLBACK ? 'ROLLBACK' : DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);

  if (REPORT) {
    const db = repo.read();
    report(db);
    return;
  }

  if (ROLLBACK) {
    doRollback();
    return;
  }

  // Read DB ONCE into memory — all subsequent operations use this snapshot
  const db = repo.read();

  if (db._V2MigrationMap && !DRY_RUN) {
    warn('A V2 migration has already been applied. Run --rollback first, or --dry-run to preview.');
    process.exit(1);
  }

  // Build in-memory ID allocator (NO DB writes — safe for both dry-run and apply)
  const allocator = buildIdAllocator(db);

  // Build migration plan entirely in memory
  const { migrationMap, newLeads, newTransactions, newRequirements, finalCounters } = buildMigration(db, allocator);

  const total = newLeads.length + newTransactions.length + newRequirements.length;

  if (DRY_RUN) {
    log(`\nDRY-RUN SUMMARY — would migrate ${total} records (zero writes performed):`);
    log(`  • ${newLeads.length} leads`);
    log(`  • ${newTransactions.length} transactions`);
    log(`  • ${newRequirements.length} requirements`);
    log(`  Final counters would be: ${JSON.stringify(finalCounters)}`);
    log('\nRun with --apply to perform actual migration (one atomic write).');
    log('Run with --rollback to revert a previous --apply migration.');
  } else {
    // APPLY: mutate the in-memory snapshot, then write once
    db.Leads        = [...(db.Leads || []),        ...newLeads];
    db.Transactions = [...(db.Transactions || []), ...newTransactions];
    db.Requirements = [...(db.Requirements || []), ...newRequirements];
    db._V2Counters  = finalCounters;
    db._V2MigrationMap = migrationMap;

    repo.write(db); // single atomic write
    ok(`Migration complete: ${newLeads.length} leads, ${newTransactions.length} transactions, ${newRequirements.length} requirements`);
  }

  report(DRY_RUN ? db : repo.read());
}

main().catch((e) => {
  console.error('[migrateV2] Fatal error:', e.message);
  process.exit(1);
});
