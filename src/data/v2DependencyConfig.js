/**
 * PHASE 10 — Static Dependency Configuration
 *
 * This file provides the canonical initial seed for V2DependencyConfig.
 * The DB is authoritative at runtime (DB-first, static fallback).
 *
 * Rule schema:
 *   DependencyID   — unique identifier (DEP-001, DEP-002, …)
 *   FormKey        — optional: scopes rule to a specific T|C|SC form key (null = any)
 *   TransactionType — context filter (null = all transaction types)
 *   Category        — context filter (null = all categories)
 *   SubCategory     — context filter (null = all subcategories)
 *   SourceField     — field whose value is checked (null = context-only rule)
 *   Operator        — condition type (see OPERATORS below)
 *   ExpectedValue   — value to compare against (null for EXISTS/NOT_EXISTS)
 *   TargetField     — field whose dependency state is controlled
 *   ResultState     — RELEVANT | NOT_RELEVANT | HIDDEN | VISIBLE
 *   Priority        — lower number = higher priority (used when multiple rules conflict)
 *   IsActive        — boolean; inactive rules are ignored at evaluation time
 *   Version         — rule version string
 *   CreatedAt/UpdatedAt — ISO timestamps
 *
 * UNKNOWN field behaviour:
 *   When SourceField is UNKNOWN, value-based operators (EQUALS, NOT_EQUALS, IN,
 *   NOT_IN, GREATER_THAN, etc.) evaluate to FALSE — i.e. the rule does NOT fire.
 *   EXISTS evaluates to false for UNKNOWN/absent fields.
 *   NOT_EXISTS evaluates to true for UNKNOWN/absent fields.
 *
 * Precedence (lowest number wins when multiple rules match):
 *   NOT_RELEVANT = 1  (strongest suppressor)
 *   HIDDEN       = 2
 *   RELEVANT     = 3
 *   VISIBLE      = 4  (weakest — default visible hint)
 *
 * Rules are purely about relevance/visibility.
 * They do NOT add mandatory validation.
 * RELEVANT means "useful to capture". UNKNOWN remains valid.
 */

'use strict';

const DEPENDENCY_CONFIG_VERSION = '1.0';

// ── State constants ────────────────────────────────────────────────────────────
const STATE = {
  RELEVANT:     'RELEVANT',
  NOT_RELEVANT: 'NOT_RELEVANT',
  HIDDEN:       'HIDDEN',
  VISIBLE:      'VISIBLE'
};

// ── Operator constants ─────────────────────────────────────────────────────────
const OP = {
  EQUALS:                 'EQUALS',
  NOT_EQUALS:             'NOT_EQUALS',
  IN:                     'IN',
  NOT_IN:                 'NOT_IN',
  EXISTS:                 'EXISTS',
  NOT_EXISTS:             'NOT_EXISTS',
  GREATER_THAN:           'GREATER_THAN',
  GREATER_THAN_OR_EQUAL:  'GREATER_THAN_OR_EQUAL',
  LESS_THAN:              'LESS_THAN',
  LESS_THAN_OR_EQUAL:     'LESS_THAN_OR_EQUAL',
  CONTAINS:               'CONTAINS',
  NOT_CONTAINS:           'NOT_CONTAINS'
};

// ── Helper builder ─────────────────────────────────────────────────────────────
let _idx = 1;
function rule(opts) {
  const id = `DEP-${String(_idx++).padStart(3, '0')}`;
  return {
    DependencyID:    id,
    FormKey:         opts.formKey         || null,
    TransactionType: opts.transactionType !== undefined ? opts.transactionType : null,
    Category:        opts.category        !== undefined ? opts.category        : null,
    SubCategory:     opts.subCategory     !== undefined ? opts.subCategory     : null,
    SourceField:     opts.sourceField     !== undefined ? opts.sourceField     : null,
    Operator:        opts.operator        !== undefined ? opts.operator        : null,
    ExpectedValue:   opts.expectedValue   !== undefined ? opts.expectedValue   : null,
    TargetField:     opts.targetField,
    ResultState:     opts.resultState,
    Priority:        opts.priority        !== undefined ? opts.priority        : 50,
    IsActive:        opts.isActive        !== false,
    Version:         DEPENDENCY_CONFIG_VERSION,
    CreatedAt:       '2026-01-01T00:00:00.000Z',
    UpdatedAt:       '2026-01-01T00:00:00.000Z',
    _v2:             true
  };
}

// ── Rules ──────────────────────────────────────────────────────────────────────

const STATIC_DEPENDENCY_RULES = [

  // ════════════════════════════════════════════════════════════════════════════
  // TRANSACTION-TYPE RULES (context-only, no SourceField condition)
  // ════════════════════════════════════════════════════════════════════════════

  // ── Rent / Rent Out — make rental-specific fields RELEVANT ──────────────────
  rule({ transactionType: 'Rent',     targetField: 'TenantType',         resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Rent',     targetField: 'Deposit',            resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Rent',     targetField: 'MaintenanceCharges', resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Rent',     targetField: 'PetAllowed',         resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Rent',     targetField: 'MoveInDate',         resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Rent',     targetField: 'LockInPeriod',       resultState: STATE.RELEVANT,     priority: 10 }),

  rule({ transactionType: 'Rent Out', targetField: 'TenantType',         resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'Deposit',            resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'MaintenanceCharges', resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'PetAllowed',         resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'MoveInDate',         resultState: STATE.RELEVANT,     priority: 10 }),

  // ── Rent / Rent Out — suppress purchase-only fields ─────────────────────────
  rule({ transactionType: 'Rent',     targetField: 'PropertyPreference', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent',     targetField: 'ConstructionStatus', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'PropertyPreference', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'ConstructionStatus', resultState: STATE.NOT_RELEVANT, priority: 10 }),

  // ── Purchase / Sale — make ownership-specific fields RELEVANT ────────────────
  rule({ transactionType: 'Purchase', targetField: 'PropertyPreference', resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Purchase', targetField: 'ConstructionStatus', resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Purchase', targetField: 'Possession',         resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Sale',     targetField: 'PropertyPreference', resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Sale',     targetField: 'ConstructionStatus', resultState: STATE.RELEVANT,     priority: 10 }),

  // ── Purchase / Sale — suppress rental-only fields ────────────────────────────
  rule({ transactionType: 'Purchase', targetField: 'TenantType',         resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Purchase', targetField: 'Deposit',            resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Purchase', targetField: 'MaintenanceCharges', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Purchase', targetField: 'PetAllowed',         resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Purchase', targetField: 'MoveInDate',         resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Sale',     targetField: 'TenantType',         resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Sale',     targetField: 'Deposit',            resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Sale',     targetField: 'MoveInDate',         resultState: STATE.NOT_RELEVANT, priority: 10 }),

  // ── Lease / Lease Out ────────────────────────────────────────────────────────
  rule({ transactionType: 'Lease',     targetField: 'LeaseDuration',      resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Lease',     targetField: 'Deposit',            resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Lease Out', targetField: 'LeaseDuration',      resultState: STATE.RELEVANT,     priority: 10 }),
  rule({ transactionType: 'Lease Out', targetField: 'Deposit',            resultState: STATE.RELEVANT,     priority: 10 }),

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY RULES
  // ════════════════════════════════════════════════════════════════════════════

  // ── Residential — RELEVANT ──────────────────────────────────────────────────
  rule({ category: 'Residential', targetField: 'BHKMin',          resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Residential', targetField: 'BHKMax',          resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Residential', targetField: 'Furnishing',      resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Residential', targetField: 'Parking',         resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Residential', targetField: 'SwimmingPool',    resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Residential', targetField: 'Gym',             resultState: STATE.RELEVANT,     priority: 20 }),

  // ── Residential — suppress commercial/land/agriculture-specific fields ───────
  rule({ category: 'Residential', targetField: 'BusinessType',        resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'ZoneType',            resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'PlotAreaMin',         resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'Zoning',              resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'TotalArea',           resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'WaterSource',         resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'SoilType',            resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'IrrigationAvailable', resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'LoadingBay',          resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'PowerLoad',           resultState: STATE.NOT_RELEVANT, priority: 20 }),

  // ── Commercial — RELEVANT ───────────────────────────────────────────────────
  rule({ category: 'Commercial', targetField: 'BusinessType',    resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Commercial', targetField: 'PowerLoad',       resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Commercial', targetField: 'FireNOC',         resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Commercial', targetField: 'FrontageWidth',   resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Commercial', targetField: 'ParkingSlots',    resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Commercial', targetField: 'LiftRequired',    resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Commercial', targetField: 'AreaMin',         resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Commercial', targetField: 'AreaMax',         resultState: STATE.RELEVANT,     priority: 20 }),

  // ── Commercial — suppress residential/land/agriculture-specific fields ───────
  rule({ category: 'Commercial', targetField: 'BHKMin',              resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'BHKMax',              resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'Furnishing',          resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'SwimmingPool',        resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'Gym',                 resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'ZoneType',            resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'PlotAreaMin',         resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'TotalArea',           resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'WaterSource',         resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'IrrigationAvailable', resultState: STATE.NOT_RELEVANT, priority: 20 }),

  // ── Industrial — RELEVANT ───────────────────────────────────────────────────
  rule({ category: 'Industrial', targetField: 'ZoneType',      resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Industrial', targetField: 'PowerLoad',     resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Industrial', targetField: 'LoadingBay',    resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Industrial', targetField: 'CeilingHeight', resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Industrial', targetField: 'FlooringType',  resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Industrial', targetField: 'AreaMin',       resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Industrial', targetField: 'AreaMax',       resultState: STATE.RELEVANT,     priority: 20 }),

  // ── Industrial — suppress ────────────────────────────────────────────────────
  rule({ category: 'Industrial', targetField: 'BHKMin',              resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'BHKMax',              resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'Furnishing',          resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'BusinessType',        resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'PlotAreaMin',         resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'TotalArea',           resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'WaterSource',         resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'Zoning',              resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'IrrigationAvailable', resultState: STATE.NOT_RELEVANT, priority: 20 }),

  // ── Land — RELEVANT ─────────────────────────────────────────────────────────
  rule({ category: 'Land', targetField: 'PlotAreaMin',  resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Land', targetField: 'PlotAreaMax',  resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Land', targetField: 'Zoning',       resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Land', targetField: 'CornerPlot',   resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Land', targetField: 'RoadFacing',   resultState: STATE.RELEVANT,     priority: 20 }),

  // ── Land — suppress ─────────────────────────────────────────────────────────
  rule({ category: 'Land', targetField: 'BHKMin',              resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'BHKMax',              resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'Furnishing',          resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'BusinessType',        resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'ZoneType',            resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'TotalArea',           resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'WaterSource',         resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'IrrigationAvailable', resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'PowerLoad',           resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'LoadingBay',          resultState: STATE.NOT_RELEVANT, priority: 20 }),

  // ── Agriculture — RELEVANT ──────────────────────────────────────────────────
  rule({ category: 'Agriculture', targetField: 'TotalArea',           resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'WaterSource',         resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'SoilType',            resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'ElectricityAvailable', resultState: STATE.RELEVANT,    priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'RoadAccess',          resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'IrrigationAvailable', resultState: STATE.RELEVANT,     priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'Fencing',             resultState: STATE.RELEVANT,     priority: 20 }),

  // ── Agriculture — suppress ──────────────────────────────────────────────────
  rule({ category: 'Agriculture', targetField: 'BHKMin',       resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'BHKMax',       resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'Furnishing',   resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'BusinessType', resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'ZoneType',     resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'PlotAreaMin',  resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'PowerLoad',    resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'LoadingBay',   resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'FireNOC',      resultState: STATE.NOT_RELEVANT, priority: 20 }),

  // ════════════════════════════════════════════════════════════════════════════
  // SUBCATEGORY RULES
  // ════════════════════════════════════════════════════════════════════════════

  rule({ subCategory: 'Office',    targetField: 'FireNOC',        resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Office',    targetField: 'LiftRequired',   resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Showroom',  targetField: 'FrontageWidth',  resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Factory',   targetField: 'PowerLoad',      resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Factory',   targetField: 'CeilingHeight',  resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Factory',   targetField: 'LoadingBay',     resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Warehouse', targetField: 'CeilingHeight',  resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Warehouse', targetField: 'LoadingBay',     resultState: STATE.RELEVANT, priority: 30 }),

  rule({ subCategory: 'Agricultural Land', targetField: 'IrrigationAvailable', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Agricultural Land', targetField: 'WaterSource',         resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Farm House',        targetField: 'Fencing',             resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Orchard',           targetField: 'WaterSource',         resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Orchard',           targetField: 'SoilType',            resultState: STATE.RELEVANT, priority: 30 }),

  rule({ subCategory: 'Villa',      targetField: 'SwimmingPool', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Bungalow',   targetField: 'SwimmingPool', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Penthouse',  targetField: 'SwimmingPool', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ subCategory: 'Penthouse',  targetField: 'Gym',          resultState: STATE.RELEVANT, priority: 30 }),

  // ════════════════════════════════════════════════════════════════════════════
  // FIELD-VALUE-BASED RULES (SourceField + Operator + ExpectedValue)
  // ════════════════════════════════════════════════════════════════════════════

  // When Parking exists (client has stated a preference) — show ParkingType detail
  rule({
    category: 'Residential',
    sourceField: 'Parking', operator: OP.EXISTS,
    targetField: 'ParkingType', resultState: STATE.RELEVANT, priority: 40
  }),

  // When BHKMin ≥ 3 — swimming pool becomes more relevant
  rule({
    category: 'Residential',
    sourceField: 'BHKMin', operator: OP.GREATER_THAN_OR_EQUAL, expectedValue: 3,
    targetField: 'SwimmingPool', resultState: STATE.RELEVANT, priority: 40
  }),

  // When BHKMin ≥ 4 — Gym becomes relevant
  rule({
    category: 'Residential',
    sourceField: 'BHKMin', operator: OP.GREATER_THAN_OR_EQUAL, expectedValue: 4,
    targetField: 'Gym', resultState: STATE.RELEVANT, priority: 40
  }),

  // TenantType = Company → show GSTRequired
  rule({
    transactionType: 'Rent',
    sourceField: 'TenantType', operator: OP.EQUALS, expectedValue: 'Company',
    targetField: 'GSTRequired', resultState: STATE.RELEVANT, priority: 40
  }),
  rule({
    transactionType: 'Rent Out',
    sourceField: 'TenantType', operator: OP.EQUALS, expectedValue: 'Company',
    targetField: 'GSTRequired', resultState: STATE.RELEVANT, priority: 40
  }),

  // Furnishing IN [Furnished, Semi-Furnished] → Appliances field is RELEVANT
  rule({
    category: 'Residential',
    sourceField: 'Furnishing', operator: OP.IN, expectedValue: ['Furnished', 'Semi-Furnished'],
    targetField: 'Appliances', resultState: STATE.RELEVANT, priority: 40
  }),

  // Furnishing = Unfurnished → hide Appliances
  rule({
    category: 'Residential',
    sourceField: 'Furnishing', operator: OP.EQUALS, expectedValue: 'Unfurnished',
    targetField: 'Appliances', resultState: STATE.NOT_RELEVANT, priority: 40
  }),

  // BusinessType NOT in [Retail, Showroom] → FrontageWidth NOT_RELEVANT for Commercial
  rule({
    category: 'Commercial',
    sourceField: 'BusinessType', operator: OP.NOT_IN, expectedValue: ['Retail', 'Showroom'],
    targetField: 'FrontageWidth', resultState: STATE.NOT_RELEVANT, priority: 40
  }),

  // FireNOC NOT_EXISTS + Category=Commercial → still RELEVANT (default is already handled)
  // BudgetMax NOT_EXISTS — show budget flexibility
  rule({
    sourceField: 'BudgetMax', operator: OP.NOT_EXISTS,
    targetField: 'BudgetFlexibility', resultState: STATE.RELEVANT, priority: 40
  }),

  // BudgetMax EXISTS — hide flexibility (they know their budget)
  rule({
    sourceField: 'BudgetMax', operator: OP.EXISTS,
    targetField: 'BudgetFlexibility', resultState: STATE.HIDDEN, priority: 40
  })

];

module.exports = {
  STATIC_DEPENDENCY_RULES,
  DEPENDENCY_CONFIG_VERSION,
  STATE,
  OP
};
