/**
 * PHASE 7 — V2 Requirement Service
 *
 * Requirement belongs to exactly one Transaction and one Lead.
 * Requirement.LeadID MUST equal Transaction.LeadID (enforced at creation).
 * Requirement MUST NOT copy Inventory/Property data.
 * FormVersion is immutable once stored.
 * RequirementStatus and PipelineStage are independent fields.
 */

'use strict';

const { IdEngine }     = require('../data/idEngine');
const { EntityConfig, WorkflowConfig, ScoringConfig, V2FormRegistry, FORM_REGISTRY_VERSION } = require('../data/v2Config');

const REQ_STATUSES    = EntityConfig.Requirement.statuses;
const PIPELINE_STAGES = EntityConfig.Requirement.pipelineStages;

class V2RequirementService {
  constructor(repository) {
    if (!repository) throw new Error('V2RequirementService requires a repository');
    this.repository = repository;
    this.idEngine   = new IdEngine(repository);
  }

  // ── Form Registry ──────────────────────────────────────────────────────────

  /**
   * Resolve form key: TransactionType|Category|SubCategory
   * Falls back to 'generic' when no exact match.
   */
  resolveFormKey(txnType, category, subCategory) {
    const key = `${txnType}|${category}|${subCategory}`;
    if (V2FormRegistry[key]) return key;
    // Try partial match without subCategory
    const catKey = Object.keys(V2FormRegistry).find((k) => k.startsWith(`${txnType}|${category}|`));
    return catKey || 'generic';
  }

  getFormConfig(txnType, category, subCategory) {
    const key = this.resolveFormKey(txnType, category, subCategory);
    return V2FormRegistry[key] || V2FormRegistry.generic;
  }

  // ── Create Requirement ─────────────────────────────────────────────────────

  createRequirement(transactionId, payload, actor = {}) {
    const db = this.repository.read();

    // Validate Transaction exists and is durable
    const transaction = (db.Transactions || []).find((t) => t.TransactionID === transactionId);
    if (!transaction) {
      return { ok: false, error: `Transaction not found: ${transactionId}` };
    }

    const leadId = payload.LeadID || payload.leadId || transaction.LeadID;

    // Enforce: Requirement.LeadID MUST equal Transaction.LeadID
    if (leadId !== transaction.LeadID) {
      return { ok: false, error: `Requirement LeadID (${leadId}) must equal Transaction LeadID (${transaction.LeadID})` };
    }

    // Validate Lead exists
    const lead = (db.Leads || []).find((l) => l.LeadID === leadId);
    if (!lead) return { ok: false, error: `Lead not found: ${leadId}` };

    const txnType    = payload.TransactionType || payload.transactionType || transaction.TransactionType || transaction.Type || 'Purchase';
    const category   = payload.Category || payload.category || null;
    const subCategory = payload.SubCategory || payload.subCategory || null;

    // Resolve form and freeze FormVersion at creation time
    const formKey     = this.resolveFormKey(txnType, category || '', subCategory || '');
    const formConfig  = V2FormRegistry[formKey] || V2FormRegistry.generic;
    const formVersion = formConfig.formVersion || FORM_REGISTRY_VERSION;

    // Status validation
    const status = payload.RequirementStatus || payload.status || payload.Status || 'Draft';
    if (!REQ_STATUSES.includes(status)) {
      return { ok: false, error: `Invalid RequirementStatus. Must be one of: ${REQ_STATUSES.join(', ')}` };
    }

    const stage = payload.PipelineStage || payload.pipelineStage || 'New';
    if (!PIPELINE_STAGES.includes(stage)) {
      return { ok: false, error: `Invalid PipelineStage. Must be one of: ${PIPELINE_STAGES.join(', ')}` };
    }

    // ── Server-side form validation (required fields, positive numbers, option membership)
    const formValidation = this._validateFormFields(payload, formConfig);
    if (!formValidation.ok) return formValidation;

    // ── Cross-field numeric range checks
    const budgetMin = this._num(payload.BudgetMin || payload.budgetMin);
    const budgetMax = this._num(payload.BudgetMax || payload.budgetMax);
    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
      return { ok: false, error: 'BudgetMin must be ≤ BudgetMax' };
    }

    const areaMin = this._num(payload.AreaMin || payload.areaMin);
    const areaMax = this._num(payload.AreaMax || payload.areaMax);
    if (areaMin !== null && areaMax !== null && areaMin > areaMax) {
      return { ok: false, error: 'AreaMin must be ≤ AreaMax' };
    }

    const now   = new Date().toISOString();
    const reqId = this.idEngine.nextRequirementId();

    const requirement = {
      RequirementID:      reqId,
      RequirementCode:    reqId, // backward compat
      LeadID:             leadId,
      TransactionID:      transactionId,
      TransactionType:    txnType,
      RequirementStatus:  status,
      Status:             status,  // backward compat
      PipelineStage:      stage,
      Category:           category,
      SubCategory:        subCategory,
      PropertyPreference: payload.PropertyPreference || payload.propertyPreference || payload.PropertyType || payload.propertyType || null,
      PropertyType:       payload.PropertyType || payload.propertyType || null, // backward compat
      BudgetMin:          budgetMin,
      BudgetMax:          budgetMax,
      BudgetType:         payload.BudgetType || payload.budgetType || null,
      BudgetFlexibility:  payload.BudgetFlexibility || payload.budgetFlexibility || null,
      Location1:          payload.Location1 || payload.location1 || null,
      Location2:          payload.Location2 || payload.location2 || null,
      Location3:          payload.Location3 || payload.location3 || null,
      AvoidLocations:     payload.AvoidLocations || payload.avoidLocations || null,
      Possession:         payload.Possession || payload.possession || null,
      Urgency:            payload.Urgency || payload.urgency || null,
      MoveInDate:         payload.MoveInDate || payload.moveInDate || null,
      // Category-specific data stored as a blob — no property data here
      CategorySpecificData: this._extractCategoryData(payload, formConfig),
      Preferences:        payload.Preferences || payload.preferences || null,
      // Backward compat fields
      BHKMin:             this._num(payload.BHKMin || payload.bhkMin),
      BHKMax:             this._num(payload.BHKMax || payload.bhkMax),
      AreaMin:            areaMin,
      AreaMax:            areaMax,
      SpecialNotes:       payload.SpecialNotes || payload.specialNotes || payload.Notes || payload.notes || null,
      // V2 scoring
      RequirementScore:   null, // computed below
      ScoreBreakdown:     null,
      // Form versioning — IMMUTABLE after creation
      FormVersion:        formVersion,
      FormKey:            formKey,
      // Audit
      CreatedBy:          actor.userId || 'system',
      CreatedAt:          now,
      UpdatedBy:          actor.userId || 'system',
      UpdatedAt:          now,
      Version:            1,
      LegacyID:           payload.LegacyID || null,
      _v2:                true
    };

    // Compute initial score
    const score = this._computeRequirementScore(requirement);
    requirement.RequirementScore = score.total;
    requirement.ScoreBreakdown   = score.breakdown;

    db.Requirements = db.Requirements || [];
    db.Requirements.push(requirement);

    // Requirement history entry
    db.RequirementHistory = db.RequirementHistory || [];
    db.RequirementHistory.push({
      RequirementHistoryID: this.repository.createId('REQH'),
      RequirementID:        reqId,
      VersionNumber:        1,
      ChangedBy:            actor.userId || 'system',
      ChangedAt:            now,
      ChangeSummary:        'Requirement created',
      PreviousData:         null,
      NewData:              requirement
    });

    this.repository.write(db);
    this.repository.addTimelineEntry(leadId, 'Requirement', reqId, 'REQUIREMENT_CREATED', 'Requirement created', { Category: category, RequirementStatus: status });

    return { ok: true, data: requirement };
  }

  // ── Update Requirement ─────────────────────────────────────────────────────

  updateRequirement(requirementId, payload, actor = {}) {
    const db  = this.repository.read();
    db.Requirements = db.Requirements || [];
    const idx = db.Requirements.findIndex((r) => r.RequirementID === requirementId);
    if (idx === -1) return { ok: false, error: 'Requirement not found' };

    const existing = db.Requirements[idx];
    const now      = new Date().toISOString();

    // Guard immutable fields
    if (payload.RequirementID && payload.RequirementID !== requirementId) return { ok: false, error: 'RequirementID is immutable' };
    if (payload.LeadID && payload.LeadID !== existing.LeadID) return { ok: false, error: 'LeadID is immutable on a Requirement' };
    if (payload.TransactionID && payload.TransactionID !== existing.TransactionID) return { ok: false, error: 'TransactionID is immutable on a Requirement' };
    if (payload.FormVersion && payload.FormVersion !== existing.FormVersion) return { ok: false, error: 'FormVersion is immutable' };

    // Status transition
    let status = existing.RequirementStatus || existing.Status || 'Draft';
    const nextStatus = payload.RequirementStatus || payload.status || payload.Status;
    if (nextStatus && nextStatus !== status) {
      const allowed = WorkflowConfig.requirementStatus.transitions[status] || [];
      if (!allowed.includes(nextStatus)) {
        return { ok: false, error: `RequirementStatus transition from '${status}' to '${nextStatus}' is not allowed` };
      }
      status = nextStatus;
    }

    // Pipeline stage — free movement
    let stage = existing.PipelineStage || 'New';
    const nextStage = payload.PipelineStage || payload.pipelineStage;
    if (nextStage) {
      if (!PIPELINE_STAGES.includes(nextStage)) return { ok: false, error: `Invalid PipelineStage: ${nextStage}` };
      stage = nextStage;
    }

    const budgetMin = payload.BudgetMin !== undefined ? this._num(payload.BudgetMin) : (payload.budgetMin !== undefined ? this._num(payload.budgetMin) : existing.BudgetMin);
    const budgetMax = payload.BudgetMax !== undefined ? this._num(payload.BudgetMax) : (payload.budgetMax !== undefined ? this._num(payload.budgetMax) : existing.BudgetMax);
    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
      return { ok: false, error: 'BudgetMin must be ≤ BudgetMax' };
    }

    const areaMin = payload.AreaMin !== undefined ? this._num(payload.AreaMin) : (payload.areaMin !== undefined ? this._num(payload.areaMin) : existing.AreaMin);
    const areaMax = payload.AreaMax !== undefined ? this._num(payload.AreaMax) : (payload.areaMax !== undefined ? this._num(payload.areaMax) : existing.AreaMax);
    if (areaMin !== null && areaMax !== null && areaMin > areaMax) {
      return { ok: false, error: 'AreaMin must be ≤ AreaMax' };
    }

    const updated = {
      ...existing,
      RequirementStatus:   status,
      Status:              status,
      PipelineStage:       stage,
      Category:            payload.Category || payload.category || existing.Category,
      SubCategory:         payload.SubCategory || payload.subCategory || existing.SubCategory,
      PropertyPreference:  payload.PropertyPreference || payload.propertyPreference || payload.PropertyType || payload.propertyType || existing.PropertyPreference,
      PropertyType:        payload.PropertyType || payload.propertyType || existing.PropertyType,
      BudgetMin:           budgetMin,
      BudgetMax:           budgetMax,
      BudgetType:          payload.BudgetType || payload.budgetType || existing.BudgetType,
      BudgetFlexibility:   payload.BudgetFlexibility || payload.budgetFlexibility || existing.BudgetFlexibility,
      Location1:           payload.Location1 !== undefined ? payload.Location1 : (payload.location1 !== undefined ? payload.location1 : existing.Location1),
      Location2:           payload.Location2 !== undefined ? payload.Location2 : (payload.location2 !== undefined ? payload.location2 : existing.Location2),
      Location3:           payload.Location3 !== undefined ? payload.Location3 : (payload.location3 !== undefined ? payload.location3 : existing.Location3),
      AvoidLocations:      payload.AvoidLocations !== undefined ? payload.AvoidLocations : (payload.avoidLocations !== undefined ? payload.avoidLocations : existing.AvoidLocations),
      Possession:          payload.Possession || payload.possession || existing.Possession,
      Urgency:             payload.Urgency || payload.urgency || existing.Urgency,
      MoveInDate:          payload.MoveInDate || payload.moveInDate || existing.MoveInDate,
      CategorySpecificData: payload.CategorySpecificData || payload.categorySpecificData || existing.CategorySpecificData,
      Preferences:         payload.Preferences || payload.preferences || existing.Preferences,
      BHKMin:              this._num(payload.BHKMin || payload.bhkMin) ?? existing.BHKMin,
      BHKMax:              this._num(payload.BHKMax || payload.bhkMax) ?? existing.BHKMax,
      AreaMin:             areaMin,
      AreaMax:             areaMax,
      SpecialNotes:        payload.SpecialNotes !== undefined ? payload.SpecialNotes : (payload.specialNotes !== undefined ? payload.specialNotes : existing.SpecialNotes),
      // FormVersion immutable — not updated
      UpdatedBy:           actor.userId || 'system',
      UpdatedAt:           now,
      Version:             (existing.Version || 1) + 1
    };

    // Recompute score
    const score = this._computeRequirementScore(updated);
    updated.RequirementScore = score.total;
    updated.ScoreBreakdown   = score.breakdown;

    db.Requirements[idx] = updated;

    // History entry
    db.RequirementHistory = db.RequirementHistory || [];
    db.RequirementHistory.push({
      RequirementHistoryID: this.repository.createId('REQH'),
      RequirementID:        requirementId,
      VersionNumber:        updated.Version,
      ChangedBy:            actor.userId || 'system',
      ChangedAt:            now,
      ChangeSummary:        `Status: ${status}, Stage: ${stage}`,
      PreviousData:         { Status: existing.RequirementStatus, PipelineStage: existing.PipelineStage },
      NewData:              { Status: status, PipelineStage: stage }
    });

    this.repository.write(db);
    this.repository.addTimelineEntry(existing.LeadID, 'Requirement', requirementId, 'REQUIREMENT_UPDATED', 'Requirement updated', { RequirementStatus: status, PipelineStage: stage });

    return { ok: true, data: { requirement: updated, history: [db.RequirementHistory[db.RequirementHistory.length - 1]] } };
  }

  // ── Read Helpers ───────────────────────────────────────────────────────────

  getRequirement(requirementId) {
    const db  = this.repository.read();
    const row = (db.Requirements || []).find((r) => r.RequirementID === requirementId);
    if (!row) return { ok: false, error: 'Requirement not found' };
    const history = (db.RequirementHistory || []).filter((h) => h.RequirementID === requirementId);
    return { ok: true, data: { ...row, history } };
  }

  listRequirementsByTransaction(transactionId) {
    const db   = this.repository.read();
    const rows = (db.Requirements || []).filter((r) => r.TransactionID === transactionId);
    return rows.sort((a, b) => new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime());
  }

  listRequirementsByLead(leadId) {
    const db   = this.repository.read();
    const rows = (db.Requirements || []).filter((r) => r.LeadID === leadId);
    return rows.sort((a, b) => new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime());
  }

  listAllRequirements(filters = {}) {
    const db  = this.repository.read();
    let rows  = db.Requirements || [];
    if (filters.LeadID)            rows = rows.filter((r) => r.LeadID === filters.LeadID);
    if (filters.TransactionID)     rows = rows.filter((r) => r.TransactionID === filters.TransactionID);
    if (filters.RequirementStatus) rows = rows.filter((r) => (r.RequirementStatus || r.Status) === filters.RequirementStatus);
    if (filters.PipelineStage)     rows = rows.filter((r) => r.PipelineStage === filters.PipelineStage);
    if (filters.Category)          rows = rows.filter((r) => r.Category === filters.Category);
    if (filters.TransactionType)   rows = rows.filter((r) => r.TransactionType === filters.TransactionType);
    return rows.sort((a, b) => new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime());
  }

  /**
   * Global Requirement View — enriched with client name from Lead.
   * This queries Requirement records only — NOT a second Lead database.
   */
  listGlobalRequirements(filters = {}) {
    const db    = this.repository.read();
    const leads = db.Leads || [];
    let rows    = this.listAllRequirements(filters);

    return rows.map((req) => {
      const lead = leads.find((l) => l.LeadID === req.LeadID);
      return {
        ...req,
        clientName:    lead ? lead.ClientName : null,
        clientMobile:  lead ? (lead.PrimaryMobile || lead.Phone) : null,
        clientStatus:  lead ? (lead.ClientStatus || lead.LeadStatus) : null,
        budgetRange:   this._formatBudget(req.BudgetMin, req.BudgetMax),
        transactionLink: req.TransactionID
      };
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _num(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Validate payload against form config:
   *   - required fields must be present and non-empty
   *   - Select/MultiSelect fields must have values in the declared options
   *   - positive-number fields must be > 0
   *
   * Field values are looked up by fieldId (as written in the form config), with
   * a case-insensitive fallback for camelCase vs PascalCase differences.
   */
  _validateFormFields(payload, formConfig) {
    if (!formConfig || !formConfig.fields) return { ok: true };

    // Merge direct payload + CategorySpecificData for lookup
    const catData = payload.CategorySpecificData || payload.categorySpecificData || {};
    const lookup = { ...payload, ...catData };

    // Build a case-insensitive key map so BudgetMin and budgetMin both resolve
    const ciMap = {};
    for (const k of Object.keys(lookup)) {
      ciMap[k.toLowerCase()] = lookup[k];
    }
    const resolve = (fieldId) => {
      if (lookup[fieldId] !== undefined) return lookup[fieldId];
      return ciMap[String(fieldId).toLowerCase()];
    };

    for (const fieldKey of Object.keys(formConfig.fields)) {
      const f = formConfig.fields[fieldKey];
      const rawVal = resolve(f.fieldId || fieldKey);

      // Required check
      if (f.required) {
        const empty = rawVal === undefined || rawVal === null || rawVal === '';
        if (empty) {
          return { ok: false, error: `Required field missing: ${f.fieldLabel || f.fieldId || fieldKey}` };
        }
      }

      // Skip further checks if field is absent (it's optional and not provided)
      if (rawVal === undefined || rawVal === null || rawVal === '') continue;

      // positive-number constraint
      if (f.validation === 'positive-number' || (f.extra && f.extra.validation === 'positive-number')) {
        const n = Number(rawVal);
        if (!Number.isFinite(n) || n < 0) {
          return { ok: false, error: `${f.fieldLabel || fieldKey} must be a positive number` };
        }
      }

      // Option membership for Select fields
      if ((f.fieldType === 'Select' || f.fieldType === 'MultiSelect') && Array.isArray(f.options) && f.options.length > 0) {
        if (f.fieldType === 'Select') {
          if (!f.options.includes(rawVal)) {
            return { ok: false, error: `Invalid value '${rawVal}' for ${f.fieldLabel || fieldKey}. Allowed: ${f.options.join(', ')}` };
          }
        } else {
          // MultiSelect: value may be an array or comma-string
          const vals = Array.isArray(rawVal) ? rawVal : String(rawVal).split(',').map((s) => s.trim());
          for (const v of vals) {
            if (!f.options.includes(v)) {
              return { ok: false, error: `Invalid value '${v}' for ${f.fieldLabel || fieldKey}. Allowed: ${f.options.join(', ')}` };
            }
          }
        }
      }
    }

    return { ok: true };
  }

  _extractCategoryData(payload, formConfig) {
    if (!formConfig || !formConfig.fields) return {};
    const data = {};
    // Extract only known form fields (category-specific keys)
    const skip = new Set([
      'LeadID', 'TransactionID', 'Category', 'SubCategory', 'TransactionType',
      'BudgetMin', 'BudgetMax', 'BudgetType', 'BudgetFlexibility',
      'Location1', 'Location2', 'Location3', 'AvoidLocations',
      'Possession', 'Urgency', 'MoveInDate', 'Preferences',
      'RequirementStatus', 'PipelineStage', 'Status', 'FormVersion',
      'leadId', 'transactionId', 'category', 'subCategory', 'transactionType',
      'budgetMin', 'budgetMax', 'budgetType', 'budgetFlexibility',
      'location1', 'location2', 'location3', 'avoidLocations',
      'possession', 'urgency', 'moveInDate', 'preferences',
      'requirementStatus', 'pipelineStage', 'status', 'formVersion'
    ]);
    for (const fieldKey of Object.keys(formConfig.fields)) {
      const fieldId = formConfig.fields[fieldKey].fieldId || fieldKey;
      const val = payload[fieldId] !== undefined ? payload[fieldId] : payload[fieldKey];
      if (val !== undefined && !skip.has(fieldKey) && !skip.has(fieldId)) {
        data[fieldId] = val;
      }
    }
    return data;
  }

  _formatBudget(min, max) {
    const fmt = (n) => {
      if (n === null || n === undefined) return null;
      if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
      if (n >= 1e5) return `₹${(n / 1e5).toFixed(0)} L`;
      return `₹${n.toLocaleString('en-IN')}`;
    };
    const fMin = fmt(min);
    const fMax = fmt(max);
    if (fMin && fMax) return `${fMin} – ${fMax}`;
    return fMin || fMax || null;
  }

  _computeRequirementScore(req) {
    const cfg   = ScoringConfig.requirement;
    let score   = 0;
    const breakdown = {};
    const totalFields = 8; // approximate for completeness

    for (const rule of cfg.rules) {
      let pts = 0;
      if (rule.field === 'hasBudget') {
        pts = rule.scoring[String(!!(req.BudgetMin || req.BudgetMax))] || 0;
      } else if (rule.field === 'hasLocation') {
        pts = rule.scoring[String(!!req.Location1)] || 0;
      } else if (rule.field === 'hasCategory') {
        pts = rule.scoring[String(!!req.Category)] || 0;
      } else if (rule.field === 'urgency') {
        const urgMap = { Immediate: 'High', High: 'High', Medium: 'Medium', Low: 'Low' };
        pts = rule.scoring[urgMap[req.Urgency] || 'Low'] || rule.scoring.Low || 0;
      } else if (rule.field === 'completeness') {
        const filled = [req.BudgetMin, req.BudgetMax, req.Location1, req.Category, req.SubCategory, req.TransactionType, req.Urgency, req.Possession].filter((v) => v !== null && v !== undefined && v !== '').length;
        const pct = filled / totalFields;
        pts = Math.round(pct * rule.maxScore);
      }
      breakdown[rule.field] = pts;
      score += pts;
    }

    return { total: Math.min(score, cfg.maxScore), breakdown };
  }
}

module.exports = { V2RequirementService };
