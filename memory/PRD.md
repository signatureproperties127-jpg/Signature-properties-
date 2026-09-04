# Signature Realty CRM — Product Requirement Doc

## Original Problem Statement
"Build a mobile app: get hu merei app hai" — User is a real estate broker in Surat with an existing GitHub CRM. Wants to fix/improve lead management, add features, redesign UI, and deploy.

## User Persona
- **Primary user**: Real estate broker based in Surat, Gujarat
- **Daily workflow**: Lead intake, requirement capture, matching, site visits, negotiation, deal closure
- **Language**: Hinglish comfortable; regional (Gujarati) later

## Architecture
- **Existing codebase**: Node.js 20 + vanilla HTML/CSS/JS + JSON file DB
- **Ports adapted**: Node app now listens on both `3000` (frontend routes) and `8001` (`/api/*` routes) to work with Emergent ingress
- **DB**: `/app/data/sig-realty-db.json` — file-backed via `JsonRepository`
- **Supervisor**: `realty` program running `node server.js` (kills default backend/frontend)
- **Auth**: `DEMO_MODE=true` env auto-authenticates as System Admin (`USR-0001`) — for preview without Google OAuth
- **Preview URL**: `https://e6961d98-7d3f-45b6-bd35-6e53a7314088.preview.emergentagent.com`

## Core Modules Present
32 existing modules (Clients, Transactions, Requirements, Matching, Broker Network, etc.). Detailed inventory in chat.

## What's Been Implemented — Session 2 (Sep 4, 2026 continued)

### Track A: Full Category Depth (86 new fields)
- `scripts/seedFullCategoryFields.js` — comprehensive V2FieldConfig seed
- **Residential** (16 fields): PlotArea, BuiltUpArea, Garden, SwimmingPool, ServantQuarter, BoundaryWall, Balconies, Bathrooms, AgeOfProperty, OwnershipType, LoanApproved, KitchenType, PGSharingType, etc.
- **Commercial** (33 fields): FurnishingType (Bare/Semi/Fully/Plug-and-Play), FloorNumber, Lift, ParkingCarSlots, PowerLoadKVA, ACType, CeilingHeightComm; Office: Cabins, Workstations, MeetingRooms, ConferenceRoom, Reception, Pantry, ServerRoom, NatureOfBusiness; Shop: FrontageWidth, Depth, FacadeType, Mezzanine, Footfall; Warehouse: LoadingBay, TruckAccess, FloorLoadCapacity; Showroom: DisplayWindow, StorageBackroom
- **Industrial** (15 fields): GIDCApproval, IndustryZone (GIDC Sachin/Palsana/Hojiwala/Pandesara/Ichhapore), PowerLoadHP, ETP, BoilerAllowed, IndustryType, WaterConnection, CraneAvailable, LabourQuarter, ColdChambers, TempRange
- **Land** (18 fields): LandAreaUnit (with Vigha for Gujarat), RatePerVigha, RatePerSqYard, LandZoning, TPScheme, NAOrder, FSI, BuildingPermission; Agricultural: SoilType, WaterSource, ExistingCrops, IrrigationType, FarmHouse
- **Common** (4 fields): Purpose, ClientType (Individual/HUF/Pvt Ltd/NRI), GujaratRERA, Priority
- Total V2FieldConfig entries: **154** (up from 61)

### Track C: Google Sheets Real-time Sync (Live)
- **Endpoint**: `POST /api/sync/google-sheet` (X-Sync-Token auth)
- **Setup helper**: `GET /api/sync/google-sheet/setup` returns webhook URL + token
- **Service**: `src/services/googleSheetSyncService.js` — column-map based ETL
  - 40 sheet columns → V2 model mapping (Lead / Transaction / Requirement)
  - Indian budget parsing: "2Cr" → 20000000, "40000" → 40000, "1.3" → 13000000, "2L" → 200000
  - Phone normalisation for dup matching
  - Status mapping: Telecalling/Verified/Lost/Call Not Received → CRM statuses
  - Legacy sheet IDs preserved as LegacyID + used as LeadID when creating new
- **Apps Script**: `scripts/apps-script-webhook.gs` — user pastes in their sheet's Extensions → Apps Script
  - `onEdit` trigger (simple) — every cell edit syncs the row
  - `onSheetChange` installable trigger (via `installTriggers()`)  — catches inserts
  - `syncAllRows()` — one-time full backfill
- **Live import result**: **190 real leads** imported from user's actual sheet
  - Comm tab: 79 rows
  - Sale tab: 79 rows
  - Rent tab: 32 rows
- Sync token env: `SHEET_SYNC_TOKEN` (defaults to dev-mode if unset)



## What's Been Implemented — Session 1 (Sep 4, 2026 earlier)
- Created `/etc/supervisor/conf.d/realty.conf` — runs Node app under supervisor
- Added `DEMO_MODE` bypass in `authService.js` — auto-login as ADMIN without Google OAuth
- Fixed missing `CompanyID`/`BrokerageID` on seeded Users

### Surat-Specific Enhancements (Lead Management)
- Seed script `scripts/seedSuratData.js` adds:
  - 35 Surat area presets (Vesu, Adajan, Piplod, Athwa, Pal, etc.)
  - 7 new V2FieldConfig entries: `RatePerSqFtMin`, `RatePerSqFtMax`, `SocietyName`, `RERANumber`, `CarpetArea`, `SuperBuiltUpArea`, `LeadSource`
  - 8 realistic Surat sample leads with transactions + requirements
- Location fields (`Location1/2/3/AvoidLocations`) now render as **Autocomplete** with Surat area suggestions

### Fully Dynamic Requirement Form
- **`resolveFormConfig()` refactored** (`v2FormRegistryService.js`):
  - Auto-includes V2FieldConfig entries whose TransactionType/Category are null OR match context
  - Case-insensitive dedup (avoids `budgetMin` / `BudgetMin` duplicates)
  - Promotes FieldType to `Autocomplete` when meta has Options
- **`clients.html` Add Client modal fully dynamic**:
  - Hardcoded requirement fields removed
  - Every field renders from `/api/v2/form-config` response
  - Adding new field = 1 row in `V2FieldConfig`, no HTML changes

### Clients List UI Improvements
- Added columns: **Rate/Sqft**, **Source** (in addition to Budget, Location)
- New filter chips: 🔥 Hot, 💰 Investor, 👨‍👩‍👧 Family, 🔁 Repeat
- Extended `_needSummaries` API response to include Rate/Sqft/Society/Carpet
- Formatted Indian currency (₹75L, ₹1.2Cr, ₹5,500/sqft)
- Added `data-testid` on all interactive elements

### Fixes
- `_V2Counters` case mismatch (lowercase vs CamelCase) — resolved
- Duplicate LeadID L000002 issue — cleaned up
- Users seeded with tenant IDs (CompanyID: COMP-001, BrokerageID: BRK-001)

## Data State
- 10 Leads (2 legacy + 8 Surat)
- 8 Requirements (with Rate/Sqft, Location, Society for Surat entries)
- 35 Surat areas configured on 4 location fields
- 61 V2FieldConfig entries (54 original + 7 Surat-specific)

## Prioritized Backlog (Not Yet Started)
### P0
- Requirement form validation before save (Surat-specific — RERA mandatory for commercial)
- Property/Inventory master UI (photos gallery, owner/builder/project master)
- WhatsApp share button working (share property to client)

### P1
- Follow-ups + Calendar module UI (bell notifications, daily widget)
- Site Visit scheduler + feedback capture
- Shortlist compare view (side-by-side 2-3 properties)
- Broker Network UI (share requirement with sub-brokers)

### P2
- Unified UI redesign (consistent design system across all pages)
- Loan eligibility + Stamp duty calculators
- Gujarati/Hindi language toggle
- MongoDB migration (from JSON file DB)
- Emergent deployment configuration

## Files Modified
- `/app/server.js` — dual port listen
- `/app/clients.html` — Surat fields + dynamic form + testids
- `/app/src/services/v2FormRegistryService.js` — dynamic field merge
- `/app/src/services/authService.js` — DEMO_MODE bypass
- `/app/src/api/v2Router.js` — extended `_needSummaries`
- `/app/scripts/seedSuratData.js` (NEW) — Surat seed
- `/etc/supervisor/conf.d/realty.conf` (NEW) — supervisor config
- `/app/data/sig-realty-db.json` — Surat data + 7 new field configs

## Test Credentials (Demo Mode Active)
- No login required; all APIs auto-authenticate as `USR-0001` (System Admin)
- To disable demo mode: set `DEMO_MODE=false` in `/etc/supervisor/conf.d/realty.conf` and restart

## Known Issues
- `client-workspace.html` "New Requirement" modal not yet made dynamic (only `clients.html` Add Client modal is fully dynamic)
- Google OAuth flow untested (requires client ID)
- No end-to-end test suite run yet (existing Playwright tests may need port config update)
