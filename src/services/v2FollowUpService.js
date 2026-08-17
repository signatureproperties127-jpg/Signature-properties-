'use strict';
/**
 * Phase 16 — V2 Follow-up Service
 *
 * Canonical follow-up management. Wraps repository primitives with
 * the full V2 model (TransactionID, RequirementID, ActivityID, DueAt,
 * Type, Status, AssignedTo, audit).
 *
 * Reading follow-ups NEVER mutates data.
 * Creating a follow-up NEVER creates a new Requirement.
 */

const VALID_STATUSES = new Set(['PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE']);

class V2FollowUpService {
  /**
   * @param {import('../data/repository').JsonRepository} repo
   */
  constructor(repo) {
    this.repo = repo;
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  /**
   * payload:
   *   LeadID *          string
   *   TransactionID?    string
   *   RequirementID?    string
   *   ActivityID?       string  — conversation that triggered the follow-up
   *   DueAt *           ISO string
   *   Type?             string  e.g. CALL, VISIT, DOCUMENT, OTHER
   *   Notes?            string
   *   AssignedTo?       userId string
   * actor: { userId, role }
   */
  createFollowUp(payload, actor = {}) {
    const db = this.repo.read();

    if (!payload.LeadID) {
      return { ok: false, error: 'LeadID is required', code: 'VALIDATION_ERROR' };
    }
    const lead = (db.Leads || []).find(l => l.LeadID === payload.LeadID);
    if (!lead) {
      return { ok: false, error: 'Lead not found', code: 'LEAD_NOT_FOUND' };
    }

    if (payload.RequirementID) {
      const req = (db.Requirements || []).find(r => r.RequirementID === payload.RequirementID);
      if (!req) return { ok: false, error: 'Requirement not found', code: 'NOT_FOUND' };
      if (req.LeadID !== payload.LeadID) {
        return { ok: false, error: 'Requirement does not belong to this Lead', code: 'RELATIONSHIP_VIOLATION' };
      }
    }

    if (!payload.DueAt && !payload.DueDate && !payload.dueAt) {
      return { ok: false, error: 'DueAt is required', code: 'VALIDATION_ERROR' };
    }

    const now = new Date().toISOString();
    db.FollowUps = db.FollowUps || [];

    const followUp = {
      FollowUpID:     this.repo.createId('FU'),
      LeadID:         payload.LeadID,
      TransactionID:  payload.TransactionID  || null,
      RequirementID:  payload.RequirementID  || null,
      ActivityID:     payload.ActivityID     || null,
      DueAt:          payload.DueAt          || payload.DueDate || payload.dueAt,
      Type:           (payload.Type          || payload.type    || 'CALL').toUpperCase(),
      Status:         'PENDING',
      AssignedTo:     payload.AssignedTo     || payload.assignedTo || actor.userId || 'system',
      Notes:          payload.Notes          || payload.notes   || '',
      CreatedBy:      actor.userId           || 'system',
      CreatedAt:      now,
      UpdatedAt:      now
    };

    db.FollowUps.push(followUp);
    this.repo.write(db);
    return { ok: true, data: followUp };
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  updateFollowUp(followUpId, patch, actor = {}) {
    const db = this.repo.read();
    db.FollowUps = db.FollowUps || [];
    const idx = db.FollowUps.findIndex(f => f.FollowUpID === followUpId);
    if (idx === -1) return { ok: false, error: 'Follow-up not found', code: 'NOT_FOUND' };

    const fu = db.FollowUps[idx];
    if (fu.Status === 'COMPLETED' || fu.Status === 'CANCELLED') {
      return { ok: false, error: `Cannot update a ${fu.Status} follow-up`, code: 'INVALID_STATE' };
    }

    // Immutable fields
    const IMMUTABLE = new Set(['FollowUpID', 'LeadID', 'CreatedBy', 'CreatedAt']);
    const updates = {};
    for (const [k, v] of Object.entries(patch)) {
      if (IMMUTABLE.has(k)) continue;
      if (k === 'Status' && !VALID_STATUSES.has(String(v).toUpperCase())) continue;
      updates[k] = v;
    }

    db.FollowUps[idx] = { ...fu, ...updates, UpdatedAt: new Date().toISOString() };
    this.repo.write(db);
    return { ok: true, data: db.FollowUps[idx] };
  }

  // ── State transitions ───────────────────────────────────────────────────────

  completeFollowUp(followUpId, actor = {}) {
    const db = this.repo.read();
    db.FollowUps = db.FollowUps || [];
    const idx = db.FollowUps.findIndex(f => f.FollowUpID === followUpId);
    if (idx === -1) return { ok: false, error: 'Follow-up not found', code: 'NOT_FOUND' };

    const fu = db.FollowUps[idx];
    if (fu.Status === 'COMPLETED') {
      return { ok: false, error: 'Follow-up already completed', code: 'ALREADY_COMPLETED' };
    }
    if (fu.Status === 'CANCELLED') {
      return { ok: false, error: 'Cannot complete a cancelled follow-up', code: 'INVALID_STATE' };
    }

    db.FollowUps[idx] = {
      ...fu,
      Status:      'COMPLETED',
      CompletedAt: new Date().toISOString(),
      CompletedBy: actor.userId || 'system',
      UpdatedAt:   new Date().toISOString()
    };
    this.repo.write(db);
    return { ok: true, data: db.FollowUps[idx] };
  }

  cancelFollowUp(followUpId, actor = {}) {
    const db = this.repo.read();
    db.FollowUps = db.FollowUps || [];
    const idx = db.FollowUps.findIndex(f => f.FollowUpID === followUpId);
    if (idx === -1) return { ok: false, error: 'Follow-up not found', code: 'NOT_FOUND' };

    const fu = db.FollowUps[idx];
    if (fu.Status === 'CANCELLED') {
      return { ok: false, error: 'Follow-up already cancelled', code: 'ALREADY_CANCELLED' };
    }
    if (fu.Status === 'COMPLETED') {
      return { ok: false, error: 'Cannot cancel a completed follow-up', code: 'INVALID_STATE' };
    }

    db.FollowUps[idx] = {
      ...fu,
      Status:      'CANCELLED',
      CancelledAt: new Date().toISOString(),
      CancelledBy: actor.userId || 'system',
      UpdatedAt:   new Date().toISOString()
    };
    this.repo.write(db);
    return { ok: true, data: db.FollowUps[idx] };
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  getFollowUp(followUpId) {
    const db = this.repo.read();
    const fu = (db.FollowUps || []).find(f => f.FollowUpID === followUpId);
    if (!fu) return { ok: false, error: 'Follow-up not found', code: 'NOT_FOUND' };
    return { ok: true, data: fu };
  }

  listFollowUps(filters = {}) {
    const db = this.repo.read();
    const now = new Date();
    let fus = (db.FollowUps || []);

    // Filters
    if (filters.LeadID)         fus = fus.filter(f => f.LeadID         === filters.LeadID);
    if (filters.TransactionID)  fus = fus.filter(f => f.TransactionID  === filters.TransactionID);
    if (filters.RequirementID)  fus = fus.filter(f => f.RequirementID  === filters.RequirementID);
    if (filters.AssignedTo)     fus = fus.filter(f => f.AssignedTo     === filters.AssignedTo);
    if (filters.Status)         fus = fus.filter(f => f.Status === filters.Status.toUpperCase());

    // Time-window presets
    if (filters.preset === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
      fus = fus.filter(f => f.DueAt >= todayStart && f.DueAt <= todayEnd && f.Status === 'PENDING');
    } else if (filters.preset === 'overdue') {
      fus = fus.filter(f => f.DueAt < now.toISOString() && f.Status === 'PENDING');
    } else if (filters.preset === 'upcoming') {
      fus = fus.filter(f => f.DueAt >= now.toISOString() && f.Status === 'PENDING');
    } else if (filters.preset === 'completed') {
      fus = fus.filter(f => f.Status === 'COMPLETED');
    }

    // Apply OVERDUE status automatically when reading
    fus = fus.map(f => {
      if (f.Status === 'PENDING' && new Date(f.DueAt) < now) {
        return { ...f, Status: 'OVERDUE' };
      }
      return f;
    });

    fus.sort((a, b) => {
      const aTime = new Date(a.DueAt).getTime();
      const bTime = new Date(b.DueAt).getTime();
      return aTime - bTime;
    });

    const limit = filters.limit ? Math.min(Number(filters.limit), 200) : 100;
    return { ok: true, data: fus.slice(0, limit), total: fus.length };
  }
}

module.exports = { V2FollowUpService };
