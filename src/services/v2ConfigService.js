/**
 * PHASE 8 — V2 Configuration Engine
 *
 * Provides FieldConfig and QuestionConfig:
 *   - Stored in DB collections V2FieldConfig / V2QuestionConfig
 *   - Seeded from static definitions below on first run if DB is empty
 *   - DB config always has priority; static is the fallback and seed source
 *   - Existing static v2Config.js (V2FormRegistry, EntityConfig, WorkflowConfig…)
 *     is NOT replaced — it continues to serve FormRegistry and form-level config.
 *
 * RequiredMode semantics:
 *   CREATE_CORE   = high-value; shown first; still NEVER blocks Requirement creation
 *   IMPORTANT     = improves quality significantly
 *   OPTIONAL      = nice to have; shown last
 *   CONDITIONAL   = depends on another field's value
 *
 * UNKNOWN is always a valid Requirement field state. RequiredMode is UX metadata only.
 */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────

const REQUIRED_MODE = {
  CREATE_CORE:  'CREATE_CORE',
  IMPORTANT:    'IMPORTANT',
  OPTIONAL:     'OPTIONAL',
  CONDITIONAL:  'CONDITIONAL'
};

const FIELD_TIER = {
  CORE:      'CORE',
  IMPORTANT: 'IMPORTANT',
  OPTIONAL:  'OPTIONAL'
};

const SECTION = {
  TRANSACTION: 'Transaction',
  BUDGET:      'Budget',
  LOCATION:    'Location',
  PROPERTY:    'Property Details',
  TIMING:      'Timing',
  EXTRAS:      'Extras'
};

// ── Static FieldConfig ─────────────────────────────────────────────────────────
// Scope: TransactionType / Category / SubCategory = null means "applies to all contexts"
// This is the canonical list; it is written to DB on first run.

const STATIC_FIELD_CONFIG = [
  // ─── Transaction context ─────────────────────────────────────────────────
  { FieldConfigID: 'FC-001', FieldKey: 'TransactionType',   FieldLabel: 'Transaction Type',        QuestionLabel: 'Kya karna chahte hain?',            FieldType: 'Select',      Section: SECTION.TRANSACTION, Tier: FIELD_TIER.CORE,      RequiredMode: REQUIRED_MODE.CREATE_CORE, Options: ['Purchase','Sale','Rent','Rent Out','Lease','Lease Out'], DisplayOrder: 1,  TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: 'Select type',      _v2: true },
  { FieldConfigID: 'FC-002', FieldKey: 'Category',          FieldLabel: 'Category',                QuestionLabel: 'Kaunse type ki property chahiye?',  FieldType: 'Select',      Section: SECTION.TRANSACTION, Tier: FIELD_TIER.CORE,      RequiredMode: REQUIRED_MODE.CREATE_CORE, Options: ['Residential','Commercial','Land','Industrial'],                              DisplayOrder: 2,  TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: 'Select category',  _v2: true },
  { FieldConfigID: 'FC-003', FieldKey: 'SubCategory',       FieldLabel: 'Sub Category',            QuestionLabel: 'Specifically kaunsa type?',         FieldType: 'Select',      Section: SECTION.TRANSACTION, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: [],                                                                           DisplayOrder: 3,  TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: 'Depends on Category', Placeholder: 'Select sub-category', _v2: true },

  // ─── Budget — common ─────────────────────────────────────────────────────
  { FieldConfigID: 'FC-010', FieldKey: 'BudgetMin',         FieldLabel: 'Budget Min',              QuestionLabel: 'Budget minimum kitna hai?',          FieldType: 'Number',      Section: SECTION.BUDGET,      Tier: FIELD_TIER.CORE,      RequiredMode: REQUIRED_MODE.CREATE_CORE, Options: [],                                                                           DisplayOrder: 10, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: 'e.g. 5000000',  _v2: true },
  { FieldConfigID: 'FC-011', FieldKey: 'BudgetMax',         FieldLabel: 'Budget Max',              QuestionLabel: 'Budget maximum kitna hai?',          FieldType: 'Number',      Section: SECTION.BUDGET,      Tier: FIELD_TIER.CORE,      RequiredMode: REQUIRED_MODE.CREATE_CORE, Options: [],                                                                           DisplayOrder: 11, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: 'e.g. 10000000', _v2: true },
  { FieldConfigID: 'FC-012', FieldKey: 'BudgetType',        FieldLabel: 'Budget Type',             QuestionLabel: 'Budget type kya hai?',               FieldType: 'Select',      Section: SECTION.BUDGET,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: ['All Inclusive','Base Price','Negotiable'],                                  DisplayOrder: 12, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-013', FieldKey: 'BudgetFlexibility', FieldLabel: 'Budget Flexibility',      QuestionLabel: 'Budget mein kitni flexibility hai?', FieldType: 'Select',      Section: SECTION.BUDGET,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: ['Strict','Slightly Flexible','Very Flexible'],                               DisplayOrder: 13, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },

  // ─── Location — common ───────────────────────────────────────────────────
  { FieldConfigID: 'FC-020', FieldKey: 'Location1',         FieldLabel: 'Primary Location',        QuestionLabel: 'Kahan property chahiye?',            FieldType: 'Text',        Section: SECTION.LOCATION,    Tier: FIELD_TIER.CORE,      RequiredMode: REQUIRED_MODE.CREATE_CORE, Options: [],                                                                           DisplayOrder: 20, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: 'e.g. Vesu, Adajan', _v2: true },
  { FieldConfigID: 'FC-021', FieldKey: 'Location2',         FieldLabel: 'Secondary Location',      QuestionLabel: 'Koi aur location acceptable hai?',  FieldType: 'Text',        Section: SECTION.LOCATION,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 21, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: 'e.g. Pal, Sarthana', _v2: true },
  { FieldConfigID: 'FC-022', FieldKey: 'Location3',         FieldLabel: 'Tertiary Location',       QuestionLabel: 'Koi aur location?',                 FieldType: 'Text',        Section: SECTION.LOCATION,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 22, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-023', FieldKey: 'AvoidLocations',    FieldLabel: 'Avoid Locations',         QuestionLabel: 'Kaunse areas avoid karne hain?',    FieldType: 'Text',        Section: SECTION.LOCATION,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 23, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },

  // ─── Timing — common ─────────────────────────────────────────────────────
  { FieldConfigID: 'FC-030', FieldKey: 'Possession',        FieldLabel: 'Possession',              QuestionLabel: 'Possession kab tak chahiye?',        FieldType: 'Select',      Section: SECTION.TIMING,      Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: ['Ready','Ready to Move','0-6 Months','6-12 Months','1-2 Years','2-3 Years','3+ Years'], DisplayOrder: 30, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-031', FieldKey: 'Urgency',           FieldLabel: 'Urgency',                 QuestionLabel: 'Kitni jaldi chahiye?',               FieldType: 'Select',      Section: SECTION.TIMING,      Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: ['Immediate','High','Medium','Low'],                                          DisplayOrder: 31, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-032', FieldKey: 'MoveInDate',        FieldLabel: 'Move-in Date',            QuestionLabel: 'Kab move in karna hai?',             FieldType: 'Date',        Section: SECTION.TIMING,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 32, TransactionType: null, Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },

  // ─── Residential ─────────────────────────────────────────────────────────
  { FieldConfigID: 'FC-040', FieldKey: 'BHKMin',            FieldLabel: 'BHK Min',                 QuestionLabel: 'Minimum kitne BHK chahiye?',         FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: ['1BHK','2BHK','3BHK','4BHK','5BHK+','Studio'],                              DisplayOrder: 40, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-041', FieldKey: 'BHKMax',            FieldLabel: 'BHK Max',                 QuestionLabel: 'Maximum kitne BHK chalenge?',        FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: ['1BHK','2BHK','3BHK','4BHK','5BHK+','Studio'],                              DisplayOrder: 41, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-042', FieldKey: 'AreaMin',           FieldLabel: 'Area Min (sq.ft)',        QuestionLabel: 'Minimum area kitna chahiye?',        FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 42, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-043', FieldKey: 'AreaMax',           FieldLabel: 'Area Max (sq.ft)',        QuestionLabel: 'Maximum area kitna?',                FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 43, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-044', FieldKey: 'Furnishing',        FieldLabel: 'Furnishing',              QuestionLabel: 'Furnished ya unfurnished chahiye?',  FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: ['Unfurnished','Semi Furnished','Fully Furnished'],                           DisplayOrder: 44, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-045', FieldKey: 'Facing',            FieldLabel: 'Facing',                  QuestionLabel: 'Kaunsa facing chahiye?',             FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: ['East','West','North','South','North-East','North-West','South-East','South-West'], DisplayOrder: 45, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-046', FieldKey: 'Floor',             FieldLabel: 'Floor Preference',        QuestionLabel: 'Kaunsa floor prefer karte hain?',   FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: ['Ground','Low (1-5)','Mid (6-15)','High (16+)','Any'],                      DisplayOrder: 46, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-047', FieldKey: 'Parking',           FieldLabel: 'Parking',                 QuestionLabel: 'Parking ki zaroorat hai?',           FieldType: 'MultiSelect', Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: ['2 Wheeler','Car','No Preference'],                                          DisplayOrder: 47, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-048', FieldKey: 'Vastu',             FieldLabel: 'Vastu Compliant',         QuestionLabel: 'Vastu compliant chahiye?',           FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 48, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-049', FieldKey: 'GatedCommunity',    FieldLabel: 'Gated Community',         QuestionLabel: 'Gated community chahiye?',           FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 49, TransactionType: null, Category: 'Residential', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },

  // ─── Commercial ──────────────────────────────────────────────────────────
  { FieldConfigID: 'FC-060', FieldKey: 'AreaMin',           FieldLabel: 'Area Min (sq.ft)',        QuestionLabel: 'Minimum area kitna chahiye?',        FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: [],                                                                           DisplayOrder: 40, TransactionType: null, Category: 'Commercial', SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-061', FieldKey: 'AreaMax',           FieldLabel: 'Area Max (sq.ft)',        QuestionLabel: 'Maximum area?',                      FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: [],                                                                           DisplayOrder: 41, TransactionType: null, Category: 'Commercial', SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-062', FieldKey: 'BusinessType',      FieldLabel: 'Business Type',           QuestionLabel: 'Business type kya hai?',             FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: ['Retail','Office','Hospitality','Healthcare','Education','IT/ITES','Other'], DisplayOrder: 42, TransactionType: null, Category: 'Commercial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-063', FieldKey: 'PowerLoad',         FieldLabel: 'Power Load (KW)',         QuestionLabel: 'Power load kitna chahiye?',          FieldType: 'Number',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 43, TransactionType: null, Category: 'Commercial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-064', FieldKey: 'FireNOC',           FieldLabel: 'Fire NOC Required',       QuestionLabel: 'Fire NOC required hai?',             FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 44, TransactionType: null, Category: 'Commercial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-065', FieldKey: 'FrontageWidth',     FieldLabel: 'Frontage Width (ft)',     QuestionLabel: 'Frontage width kitna chahiye?',      FieldType: 'Number',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 45, TransactionType: null, Category: 'Commercial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-066', FieldKey: 'ParkingSlots',      FieldLabel: 'Parking Slots',           QuestionLabel: 'Kitne parking slots chahiye?',       FieldType: 'Number',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 46, TransactionType: null, Category: 'Commercial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-067', FieldKey: 'LiftRequired',      FieldLabel: 'Lift Required',           QuestionLabel: 'Lift chahiye?',                      FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 47, TransactionType: null, Category: 'Commercial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },

  // ─── Land ────────────────────────────────────────────────────────────────
  { FieldConfigID: 'FC-070', FieldKey: 'PlotAreaMin',       FieldLabel: 'Plot Area Min (sq.yd)',   QuestionLabel: 'Plot ka minimum area?',              FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: [],                                                                           DisplayOrder: 40, TransactionType: null, Category: 'Land', SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-071', FieldKey: 'PlotAreaMax',       FieldLabel: 'Plot Area Max (sq.yd)',   QuestionLabel: 'Plot ka maximum area?',              FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: [],                                                                           DisplayOrder: 41, TransactionType: null, Category: 'Land', SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-072', FieldKey: 'Zoning',            FieldLabel: 'Zoning',                  QuestionLabel: 'Zoning kya chahiye?',                FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: ['Residential','Commercial','Mixed Use','Agricultural','Industrial'],         DisplayOrder: 42, TransactionType: null, Category: 'Land', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-073', FieldKey: 'ApproachRoad',      FieldLabel: 'Approach Road Width (ft)',QuestionLabel: 'Approach road ki width?',            FieldType: 'Number',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 43, TransactionType: null, Category: 'Land', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-074', FieldKey: 'WaterLine',         FieldLabel: 'Water Line Available',    QuestionLabel: 'Water line available hai?',          FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 44, TransactionType: null, Category: 'Land', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-075', FieldKey: 'GasPipeline',       FieldLabel: 'Gas Pipeline Available',  QuestionLabel: 'Gas pipeline available hai?',        FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 45, TransactionType: null, Category: 'Land', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-076', FieldKey: 'CornerPlot',        FieldLabel: 'Corner Plot Preferred',   QuestionLabel: 'Corner plot chahiye?',               FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                           DisplayOrder: 46, TransactionType: null, Category: 'Land', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },

  // ─── Industrial ──────────────────────────────────────────────────────────
  { FieldConfigID: 'FC-080', FieldKey: 'AreaMin',               FieldLabel: 'Area Min (sq.ft)',          QuestionLabel: 'Minimum area kitna chahiye?',        FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: [],                                                                          DisplayOrder: 40, TransactionType: null, Category: 'Industrial', SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-081', FieldKey: 'AreaMax',               FieldLabel: 'Area Max (sq.ft)',          QuestionLabel: 'Maximum area?',                      FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: [],                                                                          DisplayOrder: 41, TransactionType: null, Category: 'Industrial', SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-082', FieldKey: 'ZoneType',              FieldLabel: 'Zone Type',                 QuestionLabel: 'Industrial zone type kya chahiye?',  FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Warehouse','Manufacturing','Logistics','Cold Storage','Data Center'],      DisplayOrder: 42, TransactionType: null, Category: 'Industrial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-083', FieldKey: 'PowerLoad',             FieldLabel: 'Power Load (KW)',           QuestionLabel: 'Power load kitna chahiye?',          FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: [],                                                                          DisplayOrder: 43, TransactionType: null, Category: 'Industrial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-084', FieldKey: 'LoadingBay',            FieldLabel: 'Loading Bay Required',      QuestionLabel: 'Loading bay chahiye?',               FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,  Options: [],                                                                          DisplayOrder: 44, TransactionType: null, Category: 'Industrial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-085', FieldKey: 'CeilingHeight',         FieldLabel: 'Ceiling Height (ft)',       QuestionLabel: 'Ceiling height kitna chahiye?',      FieldType: 'Number',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,  Options: [],                                                                          DisplayOrder: 45, TransactionType: null, Category: 'Industrial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-086', FieldKey: 'FlooringType',          FieldLabel: 'Flooring Type',             QuestionLabel: 'Flooring type kya chahiye?',         FieldType: 'Select',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,  Options: ['VDF','Epoxy','Tiles','Plain Cement','Any'],                                DisplayOrder: 46, TransactionType: null, Category: 'Industrial', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },

  // ─── Rent-specific (Rent + Rent Out) ─────────────────────────────────────
  { FieldConfigID: 'FC-090', FieldKey: 'TenantType',            FieldLabel: 'Tenant Type',               QuestionLabel: 'Konsa tenant type chahiye?',         FieldType: 'Select',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Family','Bachelor','Company','Any'],                                        DisplayOrder: 30, TransactionType: 'Rent',     Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-091', FieldKey: 'Deposit',               FieldLabel: 'Security Deposit (months)', QuestionLabel: 'Security deposit kitne months ka?',  FieldType: 'Number',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: [],                                                                          DisplayOrder: 31, TransactionType: 'Rent',     Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-092', FieldKey: 'MaintenanceCharges',    FieldLabel: 'Maintenance Charges (₹/mo)',QuestionLabel: 'Maintenance charges kitne honge?',   FieldType: 'Number',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,  Options: [],                                                                          DisplayOrder: 32, TransactionType: 'Rent',     Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-093', FieldKey: 'PetAllowed',            FieldLabel: 'Pets Allowed',              QuestionLabel: 'Pets allowed hai?',                  FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,  Options: [],                                                                          DisplayOrder: 33, TransactionType: 'Rent',     Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-094', FieldKey: 'TenantType',            FieldLabel: 'Tenant Type',               QuestionLabel: 'Konsa tenant type accept karoge?',   FieldType: 'Select',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Family','Bachelor','Company','Any'],                                        DisplayOrder: 30, TransactionType: 'Rent Out', Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-095', FieldKey: 'Deposit',               FieldLabel: 'Security Deposit (months)', QuestionLabel: 'Security deposit kitna rakhna hai?', FieldType: 'Number',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: [],                                                                          DisplayOrder: 31, TransactionType: 'Rent Out', Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-096', FieldKey: 'MaintenanceCharges',    FieldLabel: 'Maintenance Charges (₹/mo)',QuestionLabel: 'Maintenance charges kya honge?',     FieldType: 'Number',      Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,  Options: [],                                                                          DisplayOrder: 32, TransactionType: 'Rent Out', Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-097', FieldKey: 'PetAllowed',            FieldLabel: 'Pets Allowed',              QuestionLabel: 'Pets allow karoge?',                 FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,  Options: [],                                                                          DisplayOrder: 33, TransactionType: 'Rent Out', Category: null, SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },

  // ─── Agriculture ─────────────────────────────────────────────────────────
  { FieldConfigID: 'FC-100', FieldKey: 'TotalArea',             FieldLabel: 'Total Area (acres)',        QuestionLabel: 'Total kitna area chahiye?',          FieldType: 'Number',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.CORE,      RequiredMode: REQUIRED_MODE.CREATE_CORE, Options: [],                                                                         DisplayOrder: 20, TransactionType: null, Category: 'Agriculture', SubCategory: null, Active: true, DefaultValue: null, Validation: 'positive-number', HelpText: null, Placeholder: 'e.g. 5', _v2: true },
  { FieldConfigID: 'FC-101', FieldKey: 'WaterSource',           FieldLabel: 'Water Source',              QuestionLabel: 'Paani ka source kya hai?',           FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: ['Well','Borewell','Canal','River','None'],                                  DisplayOrder: 21, TransactionType: null, Category: 'Agriculture', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-102', FieldKey: 'SoilType',              FieldLabel: 'Soil Type',                 QuestionLabel: 'Mitti ka type kya hai?',             FieldType: 'Select',      Section: SECTION.PROPERTY,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: ['Black','Red','Alluvial','Sandy','Loamy','Mixed'],                          DisplayOrder: 22, TransactionType: null, Category: 'Agriculture', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-103', FieldKey: 'ElectricityAvailable',  FieldLabel: 'Electricity Available',     QuestionLabel: 'Bijli available hai?',               FieldType: 'Boolean',     Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: [],                                                                         DisplayOrder: 23, TransactionType: null, Category: 'Agriculture', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-104', FieldKey: 'RoadAccess',            FieldLabel: 'Road Access',               QuestionLabel: 'Seedha road access hai?',            FieldType: 'Boolean',     Section: SECTION.PROPERTY,    Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT,   Options: [],                                                                         DisplayOrder: 24, TransactionType: null, Category: 'Agriculture', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-105', FieldKey: 'IrrigationAvailable',   FieldLabel: 'Irrigation Available',      QuestionLabel: 'Sinchai ki suvidha hai?',            FieldType: 'Boolean',     Section: SECTION.PROPERTY,    Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                         DisplayOrder: 25, TransactionType: null, Category: 'Agriculture', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true },
  { FieldConfigID: 'FC-106', FieldKey: 'Fencing',               FieldLabel: 'Fencing Available',         QuestionLabel: 'Fencing hai?',                       FieldType: 'Boolean',     Section: SECTION.EXTRAS,      Tier: FIELD_TIER.OPTIONAL,  RequiredMode: REQUIRED_MODE.OPTIONAL,    Options: [],                                                                         DisplayOrder: 26, TransactionType: null, Category: 'Agriculture', SubCategory: null, Active: true, DefaultValue: null, Validation: null, HelpText: null, Placeholder: null, _v2: true }
];

// ── Build static QuestionConfig from FieldConfig ───────────────────────────────
// One QuestionConfig entry per FieldConfig row, sorted CORE→IMPORTANT→OPTIONAL

function buildStaticQuestionConfig(fieldConfig) {
  const tierOrder = { [FIELD_TIER.CORE]: 1, [FIELD_TIER.IMPORTANT]: 2, [FIELD_TIER.OPTIONAL]: 3 };
  return fieldConfig
    .filter((f) => f.Active !== false)
    .map((f, idx) => ({
      QuestionConfigID: `Q-${String(idx + 1).padStart(3, '0')}`,
      FieldConfigID:    f.FieldConfigID,
      FieldKey:         f.FieldKey,
      QuestionLabel:    f.QuestionLabel,
      FieldLabel:       f.FieldLabel,
      TransactionType:  f.TransactionType,
      Category:         f.Category,
      SubCategory:      f.SubCategory,
      FieldType:        f.FieldType,
      Section:          f.Section,
      Priority:         f.Tier,   // CORE | IMPORTANT | OPTIONAL
      Options:          f.Options || [],
      // Sort key for ordering: CORE first (1), then IMPORTANT (2), then OPTIONAL (3)
      // Within same tier: by DisplayOrder
      DisplayOrder:     (tierOrder[f.Tier] || 3) * 1000 + (f.DisplayOrder || 99),
      Active:           true,
      _v2:              true
    }))
    .sort((a, b) => a.DisplayOrder - b.DisplayOrder);
}

// ── V2ConfigService ────────────────────────────────────────────────────────────

class V2ConfigService {
  constructor(repository) {
    if (!repository) throw new Error('V2ConfigService requires a repository');
    this.repository = repository;
  }

  // ── Seed ──────────────────────────────────────────────────────────────────

  /**
   * Write static FieldConfig and QuestionConfig to DB if DB collections are empty.
   * Idempotent: safe to call on every startup.
   * Returns: { seeded: boolean, fieldConfigCount, questionConfigCount }
   */
  seedConfigIfEmpty() {
    const db = this.repository.read();
    let changed = false;

    if (!Array.isArray(db.V2FieldConfig)) {
      db.V2FieldConfig = [];
      changed = true;
    }
    if (!Array.isArray(db.V2QuestionConfig)) {
      db.V2QuestionConfig = [];
      changed = true;
    }

    const alreadyHasField    = db.V2FieldConfig.length > 0;
    const alreadyHasQuestion = db.V2QuestionConfig.length > 0;

    if (!alreadyHasField) {
      db.V2FieldConfig = STATIC_FIELD_CONFIG.slice(); // shallow copy — immutable seed
      changed = true;
    }
    if (!alreadyHasQuestion) {
      db.V2QuestionConfig = buildStaticQuestionConfig(db.V2FieldConfig);
      changed = true;
    }

    if (changed) {
      this.repository.write(db);
    }

    return {
      seeded:            changed,
      fieldConfigCount:  db.V2FieldConfig.length,
      questionConfigCount: db.V2QuestionConfig.length
    };
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Return FieldConfig records, optionally filtered.
   * DB config has priority; falls back to static if DB collection is empty.
   *
   * Filters: { transactionType, category, subCategory, tier, active }
   * - null/undefined filter values are ignored (no filter applied)
   * - For transactionType/category/subCategory: a record with null scope matches ALL values.
   */
  getFieldConfig(filters = {}) {
    const db = this.repository.read();
    let rows = (Array.isArray(db.V2FieldConfig) && db.V2FieldConfig.length > 0)
      ? db.V2FieldConfig
      : STATIC_FIELD_CONFIG;

    if (filters.transactionType !== undefined && filters.transactionType !== null) {
      rows = rows.filter((r) => r.TransactionType === null || r.TransactionType === filters.transactionType);
    }
    if (filters.category !== undefined && filters.category !== null) {
      rows = rows.filter((r) => r.Category === null || r.Category === filters.category);
    }
    if (filters.subCategory !== undefined && filters.subCategory !== null) {
      rows = rows.filter((r) => r.SubCategory === null || r.SubCategory === filters.subCategory);
    }
    if (filters.tier !== undefined && filters.tier !== null) {
      rows = rows.filter((r) => r.Tier === filters.tier);
    }
    if (filters.active !== undefined) {
      rows = rows.filter((r) => r.Active === filters.active);
    }

    return rows.slice().sort((a, b) => (a.DisplayOrder || 99) - (b.DisplayOrder || 99));
  }

  /**
   * Return QuestionConfig records, optionally filtered.
   * DB config has priority; falls back to static if DB collection is empty.
   *
   * Filters: { transactionType, category, subCategory, priority }
   */
  getQuestionConfig(filters = {}) {
    const db = this.repository.read();
    let rows = (Array.isArray(db.V2QuestionConfig) && db.V2QuestionConfig.length > 0)
      ? db.V2QuestionConfig
      : buildStaticQuestionConfig(
          (Array.isArray(db.V2FieldConfig) && db.V2FieldConfig.length > 0)
            ? db.V2FieldConfig
            : STATIC_FIELD_CONFIG
        );

    if (filters.transactionType !== undefined && filters.transactionType !== null) {
      rows = rows.filter((r) => r.TransactionType === null || r.TransactionType === filters.transactionType);
    }
    if (filters.category !== undefined && filters.category !== null) {
      rows = rows.filter((r) => r.Category === null || r.Category === filters.category);
    }
    if (filters.subCategory !== undefined && filters.subCategory !== null) {
      rows = rows.filter((r) => r.SubCategory === null || r.SubCategory === filters.subCategory);
    }
    if (filters.priority !== undefined && filters.priority !== null) {
      rows = rows.filter((r) => r.Priority === filters.priority);
    }
    if (filters.active !== undefined) {
      rows = rows.filter((r) => r.Active === filters.active);
    }

    return rows.slice().sort((a, b) => (a.DisplayOrder || 99) - (b.DisplayOrder || 99));
  }

  /**
   * Resolve the fields that are relevant for a given T/C/SC context.
   * Returns FieldConfig rows where scope matches (null scope = universal).
   * Ordered by DisplayOrder.
   */
  resolveFieldsForContext(transactionType, category, subCategory) {
    return this.getFieldConfig({
      transactionType: transactionType || null,
      category:        category        || null,
      subCategory:     subCategory     || null,
      active:          true
    });
  }

  /**
   * Get a single FieldConfig record by FieldConfigID.
   */
  getFieldConfigById(id) {
    const db = this.repository.read();
    const rows = (Array.isArray(db.V2FieldConfig) && db.V2FieldConfig.length > 0)
      ? db.V2FieldConfig
      : STATIC_FIELD_CONFIG;
    return rows.find((r) => r.FieldConfigID === id) || null;
  }

  /**
   * Get FieldConfig records for a given FieldKey (may have multiple rows if
   * the field exists for different categories).
   */
  getFieldConfigByKey(fieldKey) {
    const db = this.repository.read();
    const rows = (Array.isArray(db.V2FieldConfig) && db.V2FieldConfig.length > 0)
      ? db.V2FieldConfig
      : STATIC_FIELD_CONFIG;
    return rows.filter((r) => r.FieldKey === fieldKey);
  }

  // ── Convenience: static constants exposed for consumers ───────────────────

  static get REQUIRED_MODE()  { return REQUIRED_MODE; }
  static get FIELD_TIER()     { return FIELD_TIER; }
  static get SECTION()        { return SECTION; }
  static get STATIC_FIELD_CONFIG() { return STATIC_FIELD_CONFIG; }
}

module.exports = {
  V2ConfigService,
  REQUIRED_MODE,
  FIELD_TIER,
  SECTION,
  STATIC_FIELD_CONFIG,
  buildStaticQuestionConfig
};
