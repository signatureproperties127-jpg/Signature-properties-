'use strict';

const { SmartMatchService } = require('./smartMatchService');

/**
 * ReverseMatchService — for a given PropertyID (typically a newly-imported
 * RERA project), find every ACTIVE requirement whose SmartMatch score meets
 * the threshold. Returns a per-property list of matching (Lead, Requirement,
 * Score, Level) tuples so the UI can show "3 waiting clients matched".
 *
 * Under the hood: iterates over requirements, calls SmartMatch for each, and
 * filters the property list down to the requested PropertyIDs. That way we
 * reuse the exact scoring logic used elsewhere.
 */

class ReverseMatchService {
  constructor(repository) {
    this.repo = repository;
    this.smartMatch = new SmartMatchService(repository);
  }

  _activeRequirements() {
    const db = this.repo.read();
    const rows = (db.V2Requirements || db.Requirements || []);
    return rows.filter((r) => {
      const stage = String(r.Stage || r.Status || 'New').toLowerCase();
      if (['lost', 'closed', 'deal', 'converted', 'archived', 'cancelled'].some((s) => stage.includes(s))) return false;
      return true;
    });
  }

  _leadOf(leadId) {
    const db = this.repo.read();
    return (db.Leads || []).find((l) => l.LeadID === leadId) || null;
  }

  // For a list of PropertyIDs, return { propertyId: [ {req, lead, score, level, breakdown} ] }
  matchProperties(propertyIds = [], { minScore = 45, perPropertyLimit = 10 } = {}) {
    if (!propertyIds.length) return { ok: true, data: {} };
    const propSet = new Set(propertyIds.map(String));
    const results = {};
    for (const pid of propertyIds) results[pid] = [];

    const requirements = this._activeRequirements();
    for (const req of requirements) {
      let out;
      try {
        out = this.smartMatch.matchByRequirementId(req.RequirementID, { limit: 200, minScore });
      } catch (_) { continue; }
      if (!out?.ok || !out.data?.matches) continue;

      for (const m of out.data.matches) {
        if (!propSet.has(String(m.PropertyID))) continue;
        const lead = this._leadOf(req.LeadID) || {};
        results[m.PropertyID].push({
          RequirementID: req.RequirementID,
          RequirementCode: req.RequirementCode || req.RequirementID,
          Category: req.Category,
          SubCategory: req.SubCategory,
          TransactionType: req.TransactionType,
          LeadID: req.LeadID,
          ClientName: lead.ClientName || lead.Name || null,
          ClientPhone: lead.PrimaryMobile || lead.Phone || null,
          Score: m.Score,
          MatchLevel: m.MatchLevel,
          MatchedOn: (m.Breakdown || []).filter((b) => b.v > 0).map((b) => b.note).slice(0, 4)
        });
      }
    }

    // Sort per-property by score desc, cap at limit
    for (const pid of Object.keys(results)) {
      results[pid].sort((a, b) => b.Score - a.Score);
      if (results[pid].length > perPropertyLimit) results[pid] = results[pid].slice(0, perPropertyLimit);
    }

    return { ok: true, data: results };
  }
}

module.exports = { ReverseMatchService };
