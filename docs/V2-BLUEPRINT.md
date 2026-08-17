# Signature Properties V2 — Revised Implementation Blueprint

Status: **AWAITING APPROVAL — no code until approved.**
This document supersedes the previous form-centric V2 plan. Where it conflicts with `replit.md`, THIS document wins.

---

## 1. Revised architecture (frozen)

**Product principle:** a client-centric, transaction-aware, configuration-driven, progressive, conversation-based CRM. The CRM is the agent's memory, not a form collection.

```
UI concept:        CLIENT  →  NEEDS
Backend identity:  LEAD    →  TRANSACTION  →  REQUIREMENT
```

- One Client = one Lead identity, forever. Multiple needs = multiple Transactions under the same LeadID. Never a second Lead.
- "Need" is a UX concept only — no Need DB entity. A Need card = Transaction + its Requirement.
- Requirement = the current understanding of one need. It starts tiny and grows through conversations. Same L/T/R IDs for its entire life.
- Hard invariant (server-rejected): `Requirement.LeadID === Transaction.LeadID`.
- Requirement stores criteria only — never property/inventory data. Matching Engine out of scope.
- Frontend executes configuration; server enforces the same configuration. No hardcoded `if (category === 'Residential')` business logic in the frontend.

### The critical shift from the previous build

| Previous (rejected) | Revised (approved) |
|---|---|
| Big requirement form, required fields enforced at creation | Minimal creation: Name + Phone (+ optional TransactionType/Category/Location/Budget) is a complete, VALID save |
| Missing field = validation error | Missing field = **UNKNOWN** — never an error, never treated as NO |
| Completeness = filled/total | Completeness = Core / Important / Optional tiers from config |
| Form filled once | Requirement progressively updated via PATCH across many conversations |
| Field shown if it exists in registry | Field relevance states: HIDDEN / VISIBLE / RELEVANT / REQUIRED / COMPLETED, driven by config + dependencies |

---

## 2. Revised data model

### Lead (client-level only — no need data here)
`LeadID (L000001)`, ClientName, PrimaryMobile, AlternateMobile, WhatsApp, Email, Tags[], ClientStatus, ClientLifecycle, ClientScore, Source, AssignedAgentID, Notes, LegacyID, `_v2: true`, audit fields.

### Transaction (what the client is trying to do)
`TransactionID (T000001)`, LeadID, TransactionType (Purchase|Sale|Rent|Rent Out|Lease|Lease Out), TransactionStatus (Open|Active|Closed|Cancelled), PipelineStage (New→…→Deal), CreatedBy/At, UpdatedBy/At, Version, LegacyID. Pipeline lives here — never on Lead.

### Requirement (evolving structured record)
```
RequirementID (R000001), LeadID, TransactionID,
TransactionType / Category / SubCategory,
FormVersion (immutable after creation),
RequirementStatus (Draft|Active|Paused|Closed|Lost|Archived),
Fields: {                        ← NEW: three-state field store
  BHK:      { state: "KNOWN", value: 3 },
  Parking:  { state: "NOT_REQUIRED" },
  Possession: { state: "UNKNOWN" }        // or simply absent = UNKNOWN
},
Preferences: [ "Near school", "Not near temple" ],   ← free-form, client's words
SpecialNotes: "Buying for mother",
DynamicAttributes: { ... },              ← business-configured custom fields
Completeness: { core: "complete", important: "1/2", optional: "1/5" },
RequirementScore, RequirementHistory (append-only), LegacyID, audit fields.
```
Field states: **UNKNOWN** (not asked), **KNOWN** (has value), **NOT_APPLICABLE / NOT_REQUIRED** (client explicitly declined). UNKNOWN ≠ NO — ever.

### Configuration collections (all persisted, versioned, editable)
EntityConfig, FormConfig, **FieldConfig** (FieldID, Entity, FieldKey, FieldLabel, **QuestionLabel** (separate!), FieldType, TransactionType/Category/SubCategory scope, Required, Visible, Default, Options, Validation, Dependency, Priority, Section, HelpText, Version, IsActive), OptionConfig, **DependencyConfig**, ValidationConfig, WorkflowConfig, ColumnConfig, ScoringConfig, TagConfig, **QuestionConfig** (Field, Question, Priority, Condition, NextQuestion, T/C/S scope).

Form Registry key: `TransactionType|Category|SubCategory`, each with FormVersion + IsActive. Requirements remain interpretable via their stored FormVersion.

Completeness tiers per form config: **Core** (e.g. Budget, Location, Transaction, Category) / **Important** (e.g. BHK, Possession) / **Optional** (e.g. Parking, Facing). Only Core can ever block anything, and only if configured.

---

## 3. Retain / Adapt / Rework audit of existing code

| Component | Verdict | Why |
|---|---|---|
| `src/data/idEngine.js` (L/T/R IDs, counters) | **RETAIN** | Fully matches directive §38 |
| `src/data/repository.js` additions (`_V2Counters`, `RequirementHistory`) | **RETAIN** | Correct persistence path |
| `src/services/v2LeadService.js` — duplicate detection, tags, normalizePhone, ClientScore | **RETAIN** (minor adapt) | Matches §5, §33; verify no need-level fields on Lead |
| `src/services/v2TransactionService.js` | **RETAIN** | Model matches §7 exactly |
| Body caching (`req._parsedBody`), V2Router dispatch pattern, feature flag | **RETAIN** | Matches §36, §41 |
| `scripts/migrateV2.js` (dry-run default, MigrationMap, rollback) | **RETAIN** | Matches §42 |
| `src/data/v2Config.js` — EntityConfig, WorkflowConfig, TagConfig, ScoringConfig, ColumnConfig | **RETAIN core, ADAPT** | Statuses/tags/pipeline match §34; must move from in-code constants to persisted, business-editable configuration; add QuestionConfig, DependencyConfig, FieldConfig metadata (QuestionLabel, Priority, Section, relevance states), completeness tiers |
| `V2FormRegistry` (40+ entries) | **ADAPT** | Keys/FormVersion correct; per-field `required` flags must be re-tiered into Core/Important/Optional; add Rent-specific fields (Move-in Date, Tenant Type, Deposit, Pets…), Agriculture category |
| `src/services/v2RequirementService.js` | **REWORK** | Current `_validateFormFields` rejects missing required fields at creation — directly violates §9/§30. Must accept minimal requirements, add three-state Fields store, Preferences/SpecialNotes/DynamicAttributes, tiered completeness, progressive PATCH semantics |
| `clients.html` Add Client modal | **REWORK** | Must become the small New Client form (§5): Name, Phone, optional need seed → one save creates L + T + R atomically |
| `client-workspace.html` | **ADAPT/REWORK** | Keep 6-section shell; Transactions/Requirements tabs merge into a "Needs" section with Need cards (§23, §48); add Known/Still-to-discover panel + Next Best Question (§21, §25) |
| `requirements-view.html` | **ADAPT** | Rename to global Needs view language; show tiered completeness instead of raw score only |
| `test/leadV2.test.js` (65 tests) | **ADAPT** | ID/dup/transaction/router tests retained; requirement validation tests rewritten for progressive model |
| Legacy modules (Inventory, Matching, Deals, Auth, …) | **UNTOUCHED** | §39–40 |

---

## 4. Revised 20 phases (with current status)

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture freeze + baseline (this blueprint) | ← YOU ARE HERE |
| 1 | Canonical Client/Lead model | DONE — retain |
| 2 | Central ID engine | DONE — retain |
| 3 | Repository persistence | DONE — retain |
| 4 | Client/Lead service | DONE — minor adapt |
| 5 | Duplicate protection | DONE — retain |
| 6 | Transaction service | DONE — retain |
| 7 | Requirement service **rework**: three-state fields, minimal-valid creation, Preferences/SpecialNotes/DynamicAttributes, progressive PATCH | REWORK |
| 8 | Dynamic Configuration Engine: persist all configs in DB, admin-editable, FieldConfig with QuestionLabel/Priority/Section | NEW |
| 9 | Form Registry + FormVersion: re-tier fields (Core/Important/Optional), Rent/Agriculture forms | ADAPT |
| 10 | Dynamic Field + Dependency Engine: relevance states (HIDDEN/VISIBLE/RELEVANT/REQUIRED/COMPLETED), DependencyConfig evaluation, server-side mirror | NEW |
| 11 | Progressive Requirement / Conversation Capture: "Add Update" flow — structured field updates logged to RequirementHistory + Activities | NEW |
| 12 | Question Engine: QuestionConfig + Next-Best-Question suggestion (priority + condition driven, no AI/NLP) | NEW |
| 13 | Client Workspace rework: Needs cards, Known/To-discover, call experience panel | REWORK |
| 14 | Client List: small New Client form (atomic L+T+R create) | ADAPT |
| 15 | Global Needs/Requirements view | ADAPT |
| 16 | Activity + Follow-up + Timeline integration (LeadID/TransactionID/RequirementID refs — absorbs proposed Task #4) | ADAPT |
| 17 | Scoring + tiered Completeness from ScoringConfig | ADAPT |
| 18 | API compatibility + full regression | VERIFY |
| 19 | Migration tooling + dry run | DONE — re-verify vs new Requirement shape |
| 20 | Feature flag + staging + rollout | ADAPT |

---

## 5. File-by-file responsibility map

| File | Responsibility |
|---|---|
| `server.js` | Routing, body cache, V2Router dispatch — unchanged pattern |
| `src/api/v2Router.js` | All V2 endpoints (§36 list) + new: `POST /api/v2/clients` (atomic L+T+R), `PATCH` progressive requirement updates, `GET /api/v2/next-question`, config CRUD endpoints |
| `src/data/idEngine.js` | L/T/R ID generation (retain) |
| `src/data/v2Config.js` | Config *defaults/seeds* only; live config moves to DB collections |
| `src/data/repository.js` | Adds config collections + QuestionConfig; all writes still Controller→Service→Repository→JSON |
| `src/services/v2LeadService.js` | Client-level data, dup check, tags, ClientScore |
| `src/services/v2TransactionService.js` | Transaction CRUD, status, pipeline |
| `src/services/v2RequirementService.js` | Progressive requirement lifecycle, three-state fields, completeness, history |
| `src/services/v2ConfigService.js` (new) | Config resolution: FieldConfig + DependencyConfig + ValidationConfig → resolved field set for T/C/S/FormVersion/context |
| `src/services/v2QuestionService.js` (new) | Next-Best-Question from QuestionConfig |
| `clients.html` / `client-workspace.html` / `requirements-view.html` | Config-executing UIs, zero hardcoded category logic |
| `scripts/migrateV2.js` | Unchanged flow; requirement mapper updated for Fields store |
| `test/leadV2.test.js` (+ new files) | Per §45 test matrix |

---

## 6. Migration & compatibility strategy

- Legacy APIs/data untouched; V1 records never deleted; `LEAD_V2_ENABLED=false` default; flag is UX gating, not security.
- Shared endpoints keep flag fall-through; new endpoints always active.
- Migration stays manual: backup → normalize → dedupe → create L/T/R → validate → report → dry-run → review → apply. `_V2MigrationMap` preserved.
- Migrated legacy requirements: every legacy field with a value → `KNOWN`; absent → `UNKNOWN` (never fabricated).

## 7. Test strategy (per §45)

- **Unit:** IDs, phone normalization, dup detection, lifecycle/status separation, three-state fields (UNKNOWN ≠ NO), dependency engine, FormVersion immutability, question engine, tiered completeness, scoring.
- **API:** Lead/Transaction/Requirement CRUD, check-duplicate, workspace, global needs, minimal-create acceptance (the §46 Rahul Shah script as an automated test), second-need flow (§47).
- **Integration:** Client → Need → progressive updates → same IDs throughout.
- **Regression:** auth, dashboard, inventory, matching, follow-ups, site visits, deals, commission — all legacy endpoints byte-compatible.

## 8. Phase-gate mechanism

After every phase: STOP and report Phase / Objective / Files changed / Functions added / Data-model changes / API changes / UI changes / Tests run / Pass-fail / Backward compatibility / Risks / Next phase — then wait for explicit approval before continuing. No silent multi-phase implementation.
