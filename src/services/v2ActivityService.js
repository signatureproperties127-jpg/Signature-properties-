'use strict';
/**
 * Phase 16 — V2 Activity Service
 *
 * Canonical wrapper around the repository's activity primitives,
 * adding the full V2 activity model (RequirementID, ActivityDirection,
 * Outcome, NextAction, FollowUpDate, Version) and audit fields.
 *
 * Reading activities NEVER mutates data.
 * Creating an activity NEVER creates a new Lead or Requirement.
 */

const VALID_TYPES = new Set([
  'CALL', 'WHATSAPP', 'SMS', 'MEETING', 'SITE_VISIT', 'NOTE', 'EMAIL', 'OTHER'
]);
const VALID_DIRECTIONS = new Set(['INBOUND', 'OUTBOUND', '']);

class V2ActivityService {
  /**
   * @param {import('../data/repository').JsonRepository} repo
   * @param {import('./v2RequirementService').V2RequirementService} [reqSvc]  optional — used to PATCH requirement fields during conversation capture
   */
  constructor(repo, reqSvc = null) {
    this.repo   = repo;
    this.reqSvc = reqSvc;
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  /**
   * Record an activity (conversation, call, note…).
   *
   * payload:
   *   LeadID *          string
   *   TransactionID?    string
   *   RequirementID?    string
   *   ActivityType      CALL|WHATSAPP|SMS|MEETING|SITE_VISIT|NOTE|EMAIL|OTHER
   *   ActivityDirection INBOUND|OUTBOUND
   *   Summary?          string  — one-line description
   *   Details?          string  — free text
   *   Outcome?          string
   *   NextAction?       string
   *   FollowUpDate?     ISO string
   *   FieldUpdates?     { [fieldKey]: value }  — conversation-captured field changes
   *
   * actor: { userId, role }
   */
  createActivity(payload, actor = {}) {
    const db = this.repo.read();

    // Validate Lead exists
    const lead = (db.Leads || []).find(l => l.LeadID === payload.LeadID);
    if (!lead) {
      return { ok: false, error: 'Lead not found', code: 'LEAD_NOT_FOUND' };
    }

    // Validate TransactionID belongs to Lead (if provided)
    if (payload.TransactionID) {
      const txn = (db.Transactions || []).find(t => t.TransactionID === payload.TransactionID);
      if (!txn) return { ok: false, error: 'Transaction not found', code: 'TXN_NOT_FOUND' };
      if (txn.LeadID !== payload.LeadID) {
        return { ok: false, error: 'Transaction does not belong to this Lead', code: 'RELATIONSHIP_VIOLATION' };
      }
    }

    // Validate RequirementID belongs to Lead (if provided)
    if (payload.RequirementID) {
      const req = (db.Requirements || []).find(r => r.RequirementID === payload.RequirementID);
      if (!req) return { ok: false, error: 'Requirement not found', code: 'REQ_NOT_FOUND' };
      if (req.LeadID !== payload.LeadID) {
        return { ok: false, error: 'Requirement does not belong to this Lead', code: 'RELATIONSHIP_VIOLATION' };
      }
    }

    const actType = (payload.ActivityType || payload.activityType || 'NOTE').toUpperCase();
    if (!VALID_TYPES.has(actType)) {
      return { ok: false, error: `Invalid ActivityType: ${actType}`, code: 'INVALID_TYPE' };
    }

    const dir = (payload.ActivityDirection || payload.activityDirection || '').toUpperCase();
    if (dir && !VALID_DIRECTIONS.has(dir)) {
      return { ok: false, error: `Invalid ActivityDirection: ${dir}`, code: 'INVALID_DIRECTION' };
    }

    db.Activities = db.Activities || [];
    const activity = {
      ActivityID:        this.repo.createId('ACT'),
      LeadID:            payload.LeadID,
      TransactionID:     payload.TransactionID     || null,
      RequirementID:     payload.RequirementID     || null,
      ActivityType:      actType,
      ActivityDirection: dir || null,
      Summary:           payload.Summary           || payload.summary  || '',
      Details:           payload.Details           || payload.details  || payload.Notes || payload.notes || '',
      Outcome:           payload.Outcome           || payload.outcome  || null,
      NextAction:        payload.NextAction        || payload.nextAction || null,
      FollowUpDate:      payload.FollowUpDate      || payload.followUpDate || null,
      Version:           1,
      CreatedBy:         actor.userId              || 'system',
      CreatedAt:         new Date().toISOString(),
      UpdatedAt:         new Date().toISOString()
    };

    db.Activities.push(activity);

    // Update Lead's last_activity_at
    const leadIdx = db.Leads.findIndex(l => l.LeadID === payload.LeadID);
    if (leadIdx !== -1) {
      db.Leads[leadIdx].last_activity_at = activity.CreatedAt;
      db.Leads[leadIdx].UpdatedAt        = activity.CreatedAt;
    }

    // Timeline entry
    db.Timeline = db.Timeline || [];
    db.Timeline.push({
      TimelineID: this.repo.createId('TIM'),
      LeadID:     payload.LeadID,
      EntityType: 'Activity',
      EntityID:   activity.ActivityID,
      EventType:  actType,
      EventTitle: activity.Summary || actType,
      EventDate:  activity.CreatedAt,
      Payload:    { ActivityID: activity.ActivityID, ActivityType: actType }
    });

    this.repo.write(db);

    // Optional: PATCH Requirement fields captured during conversation
    let reqPatchResult = null;
    if (payload.RequirementID && payload.FieldUpdates && Object.keys(payload.FieldUpdates).length > 0) {
      if (this.reqSvc) {
        reqPatchResult = this.reqSvc.updateRequirement(
          payload.RequirementID,
          payload.FieldUpdates,
          actor
        );
      }
    }

    return {
      ok:   true,
      data: activity,
      requirementPatch: reqPatchResult
    };
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  getActivity(activityId) {
    const db  = this.repo.read();
    const act = (db.Activities || []).find(a => a.ActivityID === activityId);
    if (!act) return { ok: false, error: 'Activity not found', code: 'NOT_FOUND' };
    return { ok: true, data: act };
  }

  listActivitiesByLead(leadId, opts = {}) {
    const db   = this.repo.read();
    const lead = (db.Leads || []).find(l => l.LeadID === leadId);
    if (!lead) return { ok: false, error: 'Lead not found', code: 'LEAD_NOT_FOUND' };

    let acts = (db.Activities || []).filter(a => a.LeadID === leadId);

    if (opts.ActivityType) {
      acts = acts.filter(a => a.ActivityType === opts.ActivityType.toUpperCase());
    }
    if (opts.RequirementID) {
      acts = acts.filter(a => a.RequirementID === opts.RequirementID);
    }
    if (opts.TransactionID) {
      acts = acts.filter(a => a.TransactionID === opts.TransactionID);
    }

    acts.sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());

    const limit = opts.limit ? Math.min(Number(opts.limit), 200) : 50;
    return { ok: true, data: acts.slice(0, limit), total: acts.length };
  }

  listActivitiesByRequirement(requirementId) {
    const db  = this.repo.read();
    const req = (db.Requirements || []).find(r => r.RequirementID === requirementId);
    if (!req) return { ok: false, error: 'Requirement not found', code: 'NOT_FOUND' };

    const acts = (db.Activities || [])
      .filter(a => a.RequirementID === requirementId)
      .sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());

    return { ok: true, data: acts };
  }

  listActivitiesByTransaction(transactionId) {
    const db  = this.repo.read();
    const txn = (db.Transactions || []).find(t => t.TransactionID === transactionId);
    if (!txn) return { ok: false, error: 'Transaction not found', code: 'NOT_FOUND' };

    const acts = (db.Activities || [])
      .filter(a => a.TransactionID === transactionId)
      .sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());

    return { ok: true, data: acts };
  }
}

module.exports = { V2ActivityService };
