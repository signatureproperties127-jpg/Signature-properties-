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

## What's Been Implemented — Session 7 (Sep 4, 2026 latest)

### Smart Match V2 (Requirement → Inventory)
- **New `src/services/smartMatchService.js`** — V2-aware matching engine
  - Understands both `Fields.<key>.value` wrapping and flat requirement fields
  - Hard filters: Category, SubCategory (soft), TransactionType with alias set (Purchase ↔ Sale ↔ Rent+Sale; Rent ↔ Lease)
  - Weighted scoring (out of 100): Category 15, SubCategory 10, Location 20, Budget 25, Rate/sqft 10, Size (BHK/carpet) 10, Furnishing 5, Sub-cat specifics 5
  - Levels: 85+ Excellent / 65+ Strong / 45+ Possible / <45 Weak (hidden by default)
  - Sub-category specifics: Office matches Cabins+Workstations, Shop matches Frontage
  - Excludes Sold / Rented properties automatically
- **API**: `GET /api/v2/requirements/:id/matches?limit=10&minScore=40`
  - Returns criteria (for debug), scanned count, total matches, and top-N matches with `Score`, `MatchLevel`, and per-criterion `Breakdown` array
- **UI in Client Workspace**:
  - Every requirement card now has a **🎯 Smart Match** button (replaces old "Matching" navigate-away link)
  - Click expands an inline panel with header "🎯 Smart Matches — X of Y properties match"
  - Each match card shows: photo thumb, source badge (⭐/🏗️/🤝 color-coded), title, sub-cat + location + society + price, score with colour-coded level (green Excellent → orange Possible), and green pills for matched criteria + red pills for misses
  - Loaded lazily on click (dataset.loaded flag prevents refetch)
- **Verified end-to-end**: Sneha Trivedi's Villa/Vesu ₹2.5-4Cr requirement scored PROP-0003 Dumas Road villa 60/Possible with "Within budget ₹3.50 Cr ✓", "4 BHK ✓" green + "Location mismatch ✓" red



## What's Been Implemented — Session 6 (Sep 4, 2026 late)
- **New top-level field `InventorySource`** on every property = one of `Own` / `Builder` / `Broker`; auto-derived from OwnerType when missing (Builder → Builder, Sub-broker → Broker, everything else → Own)
- **Backend**:
  - `list()` supports `?source=Own|Builder|Broker` filter
  - `create()` + `update()` accept `InventorySource`, `BuilderName`, `ProjectName`, `BrokerName`, `BrokerMobile`, `BrokerCommissionShare` at top-level
  - New helper `_deriveInventorySource(ownerType)` for backfill on legacy records
- **Frontend / `/inventory`**:
  - **Source filter row** with 4 chips: All Sources / ⭐ My Own Inventory / 🏗️ Builder Inventory / 🤝 Broker Inventory (color-coded amber / blue / purple)
  - **Header count bar** now shows per-source breakdown: "9 of 9 · ⭐ Own 5 · 🏗️ Builder 2 · 🤝 Broker 2"
  - **Color-coded source badge** on top-right of every property card (Own = amber, Builder = blue, Broker = purple)
  - **Source-aware footer**: shows Owner name for Own listings, "Broker Name • Split X%" for Broker, "Builder • Project" for Builder
  - **Contextual form fields**: Ownership section reveals Builder Name/Project only for Builder source; Broker Name/Mobile/Commission Split only for Broker source (auto-toggle via `onSourceChange`)
  - Auto-adjusts OwnerType dropdown when source changes (Builder → Builder OwnerType, Broker → Sub-broker OwnerType)
- **Sample data reassigned**: 9 Surat properties now split 5 Own / 2 Builder / 2 Broker with realistic broker (Kunal Estate Agency Split 50%, Vinay Realtors Split 60%) and builder (Kamrej Developers → Kamrej Green Estate, Pandesara Infra → Signature Industrial Park) details
- **Legacy Bengaluru duplicates cleaned** (Azure Crest test data removed from inventory)
- **Verified end-to-end**: filter chip switches instantly, badge colors render correctly, footer copy adapts per source



## What's Been Implemented — Session 5 (Sep 4, 2026 later)
- **New service**: `src/services/inventoryService.js` — CRUD + photo upload
- **API endpoints**:
  - `GET  /api/v2/inventory` — list with filters (q, category, subCategory, transactionType, status)
  - `POST /api/v2/inventory` — create property
  - `GET  /api/v2/inventory/:id` — detail
  - `PATCH /api/v2/inventory/:id` — update
  - `DELETE /api/v2/inventory/:id` — soft delete
  - `POST /api/v2/inventory/:id/photos` — multi-photo upload (base64 data URLs)
  - `DELETE /api/v2/inventory/:id/photos/:photoId` — delete individual photo
- **Photo storage**: Base64 payload → decoded to `/app/uploads/properties/<id>/<timestamp>.<ext>` on disk → served under `/uploads/properties/<id>/…`
- **`/inventory.html` grid page**:
  - Photo-card layout with status badge, photo count badge, owner info footer
  - Filter chips per category (🏠 Res / 🏢 Comm / 🏭 Ind / 🌾 Land)
  - Live search across title/owner/society/area
  - Indian-formatted prices (₹1.25 Cr, ₹75L, ₹22,000/mo, ₹95,000/mo)
  - Rate/sqft, carpet area, BHK, furnishing, cabins, frontage, GIDC, ★ Exclusive facts pills
- **Add / Edit Property modal**:
  - Static blocks: Photos, Property Info, Ownership
  - Dynamic Pricing + Commission + Property + Legal + Project sections from V2FieldConfig
  - Multi-photo drag/click upload with base64 preview strip + individual delete
  - Full data-testid coverage
- **24 new Property-scoped V2FieldConfig fields** (EntityScope='Property'):
  - Listing: Title, ListingFor, ListingStatus, AvailableFrom, PropertyURL, ExclusiveWithMe
  - Ownership: OwnerName, OwnerMobile, OwnerType, OwnerEmail, POA
  - Pricing: AskingPrice, AskingRatePerSqFt, MinPrice, MaintenanceMonthly, DepositMonths, NegotiableMargin
  - Commission: CommissionMode (11 options incl. 1%/2% splits, Rent=1mo, Fixed), CommissionAmount
  - Project: ProjectName, BuilderName, BuilderRERA, ProjectPossession, ProjectStatus
- **8 sample Surat properties seeded** across all categories: Ratnakar Nine Square Vesu, City Light rent, Dumas Road villa, Ghod Dod office (4 cabins/20 seats), Vesu shop, GIDC Sachin textile godown, Kamrej NA plot 12 vigha, GIDC Pandesara factory
- **Nav updated**: Inventory link added to Clients + Duplicates pages
- **Verified end-to-end**: Created PROP-0009 via UI (₹75L @ ₹7,200/sqft + Exclusive), uploaded 3 photos via API, photos serve correctly via `/uploads/…`, card shows 📷 3 badge



## What's Been Implemented — Session 4 (Sep 4, 2026 later)
- **`add-need-modal` in `client-workspace.html` now fully dynamic** — uses same `/api/v2/form-config` endpoint as the clients page Add Client modal
- Removed hardcoded budget/location inputs — everything renders from V2FieldConfig (154 fields)
- **Section-grouped rendering**: Budget → Location → Property → Legal → Client → Timing → Details
- **Autocomplete datalists** for fields with Options (Surat area presets, industry types, etc.)
- **Tier indicators**: CORE fields show red `*` asterisk
- **Help text** rendered below field (e.g., "Rate range per sq ft (Surat market unit)", "Gujarat RERA registration number", "1 vigha = 17,424 sqft")
- **Full data-testid coverage**: `need-txn-type`, `need-category`, `need-subcategory`, `need-req-field-<FieldKey>` for every dynamic field
- **saveAddNeed() collects all fields dynamically** via `[data-field-key]` attribute — no hardcoded field extraction
- Removed legacy `addLocationRow()` + `location-row` — replaced by dynamic Location1/2/3 fields
- **End-to-end verified**: Created Commercial/Office requirement (R000199) with Cabins=4, Workstations=20, MeetingRooms=2, ConferenceRoom=Yes, FurnishingType=Fully Furnished, NatureOfBusiness=IT/Software, GujaratRERA — all fields persisted correctly to DB



## What's Been Implemented — Session 3 (Sep 4, 2026 later)

### Duplicate Merge UI
- **Fuzzy dup detection** in `googleSheetSyncService._syncOneRow()`:
  - After exact phone-match miss, checks Name (case-insensitive, whitespace-normalised) and Email
  - If match found, still creates lead but marks `_reviewStatus: 'PENDING_DUP_MERGE'` + `_dupCandidates: [leadIds]` + `_reviewNote`
- **APIs**:
  - `GET  /api/v2/duplicates/pending` — enriched list (source + candidate leads + reason)
  - `POST /api/v2/duplicates/keep-separate` — clear pending flag, keep as new client
  - `POST /api/v2/duplicates/merge` — merge source into target with field-level overrides (source|target per field). Transactions/Requirements/Activities/Follow-ups all reassigned; source lead deleted; `_mergedFrom` tracked on target for audit
  - `DELETE /api/v2/duplicates/:leadId` — hard delete pending-review lead (was spam)
- **UI** — `/duplicates.html`:
  - Card per pending lead, dropdown to switch between candidates
  - Side-by-side grid: label / NEW (yellow) / EXISTING (green)
  - Diff rows auto-highlighted in yellow
  - Radio button per field to pick source or target value
  - 3-action row: 🗑 Delete Incoming, Keep Separate, ✓ Merge into Target
  - Toast notifications for success/error
- **Nav integration**: clients.html topbar now has `Duplicates <badge>` with red count when items pending
- **Verified end-to-end**: seeded 2 fuzzy dupes ("kartik" & "Prashant Missel"), merged one with field override (Email + City from source), kept the other separate — all 3 API paths pass

## What's Been Implemented — Session 2 (Sep 4, 2026 mid)

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
