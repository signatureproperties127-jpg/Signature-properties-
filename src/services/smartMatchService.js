/**
 * Smart Match V2
 * =================
 * Given a V2 Requirement (client's need), score every property in the
 * inventory and return the ranked candidates.
 *
 * Design principles
 *   1. HARD filters   → category / sub-category / transaction (rent vs sale)
 *   2. SCORING (100)  → budget, location, size (BHK/carpet), rate/sqft,
 *                       furnishing, sub-category specific bonus fields
 *   3. Returns TOP-N with per-criterion explanation for UI display
 *
 * The requirement's dynamic values may live at any of:
 *   requirement.<key>              (top-level, e.g. BudgetMin)
 *   requirement.Fields.<key>.value (V2 wrapped form)
 *   requirement.<lowercaseKey>     (legacy)
 */

const TRANSACTION_ALIAS = {
  Purchase: ['Sale', 'Rent + Sale', 'Purchase'],
  Sale:     ['Sale', 'Rent + Sale', 'Purchase'],
  Rent:     ['Rent', 'Lease', 'Rent + Sale'],
  'Rent Out': ['Rent', 'Lease', 'Rent + Sale'],
  Lease:    ['Rent', 'Lease', 'Rent + Sale'],
  'Lease Out': ['Rent', 'Lease', 'Rent + Sale']
};

const WEIGHTS = {
  category:    15,   // hard filter but included in score
  subCategory: 10,
  location:    20,
  budget:      25,
  rateSqft:    10,
  size:        10,
  furnishing:   5,
  specific:     5    // e.g. cabins/workstations for office
};

class SmartMatchService {
  constructor(repository) { this.repository = repository; }

  _val(obj, key) {
    if (!obj) return null;
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
    const f = obj.Fields;
    if (f && f[key] !== undefined) {
      const v = f[key];
      return (v && typeof v === 'object' && 'value' in v) ? v.value : v;
    }
    // Try lowercase first-char (budgetMin vs BudgetMin)
    const lo = key[0].toLowerCase() + key.slice(1);
    if (obj[lo] !== undefined && obj[lo] !== null && obj[lo] !== '') return obj[lo];
    if (f && f[lo] !== undefined) {
      const v = f[lo];
      return (v && typeof v === 'object' && 'value' in v) ? v.value : v;
    }
    return null;
  }

  _normLoc(s) { return String(s || '').trim().toLowerCase(); }

  match(requirement, options = {}) {
    if (!requirement) return { ok: false, error: 'Requirement not found' };
    const db = this.repository.read();
    const inventory = (db.Inventory || []).filter(p => !p._deleted && p.ListingStatus !== 'Sold' && p.ListingStatus !== 'Rented');

    const reqCat  = this._val(requirement, 'Category');
    const reqSub  = this._val(requirement, 'SubCategory');
    const reqTxn  = this._val(requirement, 'TransactionType');
    const allowedListings = new Set(TRANSACTION_ALIAS[reqTxn] || [reqTxn]);

    const reqBudgetMin = Number(this._val(requirement, 'BudgetMin')) || null;
    const reqBudgetMax = Number(this._val(requirement, 'BudgetMax')) || null;
    const reqRateMin   = Number(this._val(requirement, 'RatePerSqFtMin')) || null;
    const reqRateMax   = Number(this._val(requirement, 'RatePerSqFtMax')) || null;
    const reqBHK       = this._val(requirement, 'BHK');
    const reqCarpet    = Number(this._val(requirement, 'CarpetArea')) || null;
    const reqLocs      = [
      this._val(requirement, 'Location1'),
      this._val(requirement, 'Location2'),
      this._val(requirement, 'Location3')
    ].filter(Boolean).map(this._normLoc);
    const reqFurnish   = this._val(requirement, 'FurnishingType') || this._val(requirement, 'Furnishing');
    const reqCabins    = Number(this._val(requirement, 'Cabins')) || null;
    const reqWorkstations = Number(this._val(requirement, 'Workstations')) || null;
    const reqFrontage  = Number(this._val(requirement, 'FrontageWidth')) || null;

    const results = [];
    for (const prop of inventory) {
      // ── HARD FILTERS ────────────────────────────────────────────────
      if (reqCat && prop.Category !== reqCat) continue;
      // SubCategory is a "soft" filter — if req has it and prop has it, match; else allow
      if (reqSub && prop.SubCategory && prop.SubCategory !== reqSub) continue;
      // Transaction/Listing side
      if (reqTxn && prop.ListingFor && !allowedListings.has(prop.ListingFor)) continue;

      // ── SCORING ─────────────────────────────────────────────────────
      const breakdown = [];
      let score = 0;

      // Category (hard filter, but points contribute if matched)
      if (reqCat && prop.Category === reqCat) { score += WEIGHTS.category; breakdown.push({ k: 'category', v: WEIGHTS.category, note: `Category ${reqCat} ✓` }); }
      if (reqSub && prop.SubCategory === reqSub) { score += WEIGHTS.subCategory; breakdown.push({ k: 'subCategory', v: WEIGHTS.subCategory, note: `${reqSub} ✓` }); }

      // Budget: property's AskingPrice within req's Min/Max
      const propPrice = this._val(prop, 'AskingPrice') != null ? Number(this._val(prop, 'AskingPrice')) : null;
      if (propPrice != null && (reqBudgetMin || reqBudgetMax)) {
        if (reqBudgetMax && propPrice > reqBudgetMax * 1.15) {
          breakdown.push({ k: 'budget', v: 0, note: `Above budget (${_fmtInr(propPrice)})` });
        } else if (reqBudgetMin && propPrice < reqBudgetMin * 0.7) {
          breakdown.push({ k: 'budget', v: WEIGHTS.budget * 0.5, note: `Below budget (${_fmtInr(propPrice)})` });
          score += WEIGHTS.budget * 0.5;
        } else if (reqBudgetMax && propPrice > reqBudgetMax) {
          // slightly over — soft
          score += WEIGHTS.budget * 0.7;
          breakdown.push({ k: 'budget', v: WEIGHTS.budget * 0.7, note: `Slightly over (${_fmtInr(propPrice)})` });
        } else {
          score += WEIGHTS.budget;
          breakdown.push({ k: 'budget', v: WEIGHTS.budget, note: `Within budget (${_fmtInr(propPrice)}) ✓` });
        }
      }

      // Rate/Sqft
      const propRate = this._val(prop, 'AskingRatePerSqFt') != null ? Number(this._val(prop, 'AskingRatePerSqFt')) : null;
      if (propRate != null && (reqRateMin || reqRateMax)) {
        const inRange = (!reqRateMin || propRate >= reqRateMin * 0.9) && (!reqRateMax || propRate <= reqRateMax * 1.1);
        if (inRange) {
          score += WEIGHTS.rateSqft;
          breakdown.push({ k: 'rateSqft', v: WEIGHTS.rateSqft, note: `Rate ₹${propRate}/sqft ✓` });
        } else {
          breakdown.push({ k: 'rateSqft', v: 0, note: `Rate ₹${propRate}/sqft off range` });
        }
      }

      // Location — Primary/Secondary match
      const propLocs = [prop.Location1, prop.Location2].filter(Boolean).map(this._normLoc);
      if (reqLocs.length && propLocs.length) {
        const overlap = propLocs.filter(pl => reqLocs.includes(pl));
        if (overlap.length) {
          score += WEIGHTS.location;
          breakdown.push({ k: 'location', v: WEIGHTS.location, note: `Location ${overlap.join('/')} ✓` });
        } else {
          breakdown.push({ k: 'location', v: 0, note: `Location mismatch (${propLocs.join('/')})` });
        }
      }

      // Size / BHK
      const propBHK    = this._val(prop, 'BHK');
      const propCarpet = Number(this._val(prop, 'CarpetArea') || this._val(prop, 'CarpetAreaComm')) || null;
      if (reqBHK && propBHK) {
        if (String(propBHK).trim() === String(reqBHK).trim()) {
          score += WEIGHTS.size;
          breakdown.push({ k: 'size', v: WEIGHTS.size, note: `${propBHK} ✓` });
        } else {
          breakdown.push({ k: 'size', v: 0, note: `BHK ${propBHK} vs ${reqBHK}` });
        }
      } else if (reqCarpet && propCarpet) {
        const diff = Math.abs(propCarpet - reqCarpet) / reqCarpet;
        if (diff <= 0.15) { score += WEIGHTS.size; breakdown.push({ k: 'size', v: WEIGHTS.size, note: `Carpet ${propCarpet} sqft ✓` }); }
        else if (diff <= 0.30) { score += WEIGHTS.size * 0.6; breakdown.push({ k: 'size', v: WEIGHTS.size * 0.6, note: `Carpet ${propCarpet} sqft (close)` }); }
      }

      // Furnishing
      const propFurn = this._val(prop, 'FurnishingType') || this._val(prop, 'Furnishing');
      if (reqFurnish && propFurn) {
        if (String(propFurn).toLowerCase() === String(reqFurnish).toLowerCase()) {
          score += WEIGHTS.furnishing;
          breakdown.push({ k: 'furnishing', v: WEIGHTS.furnishing, note: `${propFurn} ✓` });
        }
      }

      // Sub-category specifics (Office cabins, Shop frontage)
      if (reqSub === 'Office') {
        const pc = Number(this._val(prop, 'Cabins')) || 0;
        const pw = Number(this._val(prop, 'Workstations')) || 0;
        const cabinsOK = !reqCabins || pc >= reqCabins;
        const wsOK     = !reqWorkstations || pw >= reqWorkstations;
        if ((reqCabins || reqWorkstations) && cabinsOK && wsOK) {
          score += WEIGHTS.specific;
          breakdown.push({ k: 'specific', v: WEIGHTS.specific, note: `${pc} cabins / ${pw} seats ✓` });
        }
      }
      if (reqSub === 'Shop' && reqFrontage) {
        const pf = Number(this._val(prop, 'FrontageWidth')) || 0;
        if (pf >= reqFrontage * 0.9) {
          score += WEIGHTS.specific;
          breakdown.push({ k: 'specific', v: WEIGHTS.specific, note: `Frontage ${pf}ft ✓` });
        }
      }

      const level = score >= 85 ? 'Excellent' : score >= 65 ? 'Strong' : score >= 45 ? 'Possible' : 'Weak';
      results.push({
        PropertyID: prop.PropertyID,
        Title:      prop.Title,
        Category:   prop.Category,
        SubCategory:prop.SubCategory,
        ListingFor: prop.ListingFor,
        InventorySource: prop.InventorySource,
        Location1:  prop.Location1,
        SocietyName:prop.SocietyName,
        AskingPrice: propPrice,
        AskingRatePerSqFt: propRate,
        BHK:        propBHK,
        CarpetArea: propCarpet,
        Photos:     prop.Photos || [],
        OwnerName:  prop.OwnerName,
        BrokerName: prop.BrokerName,
        BuilderName:prop.BuilderName,
        ExclusiveWithMe: !!prop.ExclusiveWithMe,
        Score:      Math.round(score),
        MatchLevel: level,
        Breakdown:  breakdown
      });
    }

    results.sort((a, b) => b.Score - a.Score);
    const minScore = options.minScore == null ? 40 : options.minScore;
    const filtered = results.filter(r => r.Score >= minScore);
    return {
      ok: true,
      data: {
        requirementId: requirement.RequirementID,
        leadId:        requirement.LeadID,
        criteria:      { reqCat, reqSub, reqTxn, reqLocs, reqBudgetMin, reqBudgetMax, reqBHK, reqCarpet, reqFurnish, reqCabins, reqWorkstations, reqFrontage },
        total:         filtered.length,
        scanned:       inventory.length,
        matches:       filtered.slice(0, options.limit || 20)
      }
    };
  }

  matchByRequirementId(requirementId, options = {}) {
    const db = this.repository.read();
    const req = (db.Requirements || []).find(r => r.RequirementID === requirementId);
    if (!req) return { ok: false, error: 'Requirement not found' };
    return this.match(req, options);
  }
}

function _fmtInr(n) {
  if (!n) return '—';
  if (n >= 1e7) return '₹' + (n/1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return '₹' + (n/1e5).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
}

module.exports = { SmartMatchService };
