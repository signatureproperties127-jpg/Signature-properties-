const crypto = require('crypto');

const SHARE_STATUSES = new Set(['ACTIVE', 'EXPIRED', 'REVOKED', 'COMPLETED']);
const RESPONSE_STATUSES = new Set(['SUBMITTED', 'VIEWED', 'SHORTLISTED', 'REJECTED', 'CONTACTED', 'NEGOTIATING', 'DEAL', 'CLOSED']);
const NETWORK_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER', 'BROKER', 'AGENT', 'EXTERNAL_BROKER']);

class BrokerNetworkService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.publicBaseUrl = options.publicBaseUrl || process.env.PUBLIC_BASE_URL || '';
  }

  readDatabase() {
    const db = this.repository.read();
    db.SharedRequirements = db.SharedRequirements || [];
    db.SharedRequirementProperties = db.SharedRequirementProperties || [];
    db.BrokerNetworkEvents = db.BrokerNetworkEvents || [];
    db.BrokerRelationships = db.BrokerRelationships || [];
    return db;
  }

  actorUser(actor = {}) {
    const userId = String(actor.userId || actor.userID || '').trim();
    if (!userId) return null;
    const user = this.repository.getUser(userId);
    if (!user || String(user.Status || '').toUpperCase() !== 'ACTIVE') return null;
    return user;
  }

  actorContext(actor = {}) {
    const user = this.actorUser(actor);
    if (!user) return { ok: false, statusCode: 401, error: 'Unauthorized' };
    const role = String(user.Role || actor.role || '').toUpperCase();
    if (!NETWORK_ROLES.has(role)) return { ok: false, statusCode: 403, error: 'Broker network access denied' };
    return {
      ok: true,
      actor: {
        userId: user.UserID,
        user,
        role,
        brokerId: user.BrokerID || user.BrokerId || actor.brokerId || user.UserID,
        brokerageId: user.BrokerageID || user.BrokerageId || null,
        companyId: user.CompanyID || user.CompanyId || null,
        name: user.Name || 'Broker'
      }
    };
  }

  requireActor(actor) {
    const context = this.actorContext(actor);
    if (!context.ok) throw this.error(context.error, context.statusCode);
    return context.actor;
  }

  error(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  canManageAll(actor) {
    return ['ADMIN', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER'].includes(actor.role);
  }

  getRequirement(requirementId) {
    const requirement = this.repository.find('Requirements', 'RequirementID', requirementId);
    if (!requirement) throw this.error('Requirement not found', 404);
    return requirement;
  }

  canAccessRequirement(requirement, actor) {
    if (this.canManageAll(actor)) return true;
    const lead = this.repository.find('Leads', 'LeadID', requirement.LeadID);
    return requirement.CreatedBy === actor.userId || lead?.AssignedAgentID === actor.userId;
  }

  createToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }

  expiresAt(expiry = '7d') {
    const match = String(expiry).match(/^(\d+)(h|d)$/i);
    const amount = match ? Number(match[1]) : 7;
    const unit = match ? match[2].toLowerCase() : 'd';
    return new Date(Date.now() + amount * (unit === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000)).toISOString();
  }

  safeLocations(requirement) {
    return [requirement.Location1, requirement.Location2, requirement.Location3].filter(Boolean);
  }

  toBrokerNetworkRequirementDTO(requirement, share) {
    return {
      SharedRequirementID: share.SharedRequirementID,
      TransactionType: requirement.TransactionType || null,
      Category: requirement.Category || null,
      SubCategory: requirement.SubCategory || null,
      PropertyType: requirement.PropertyType || null,
      BudgetMin: requirement.BudgetMin ?? null,
      BudgetMax: requirement.BudgetMax ?? null,
      Locations: this.safeLocations(requirement),
      BHKMin: requirement.BHKMin ?? null,
      BHKMax: requirement.BHKMax ?? null,
      AreaMin: requirement.AreaMin ?? null,
      AreaMax: requirement.AreaMax ?? null,
      Possession: requirement.Possession || null,
      Urgency: requirement.Urgency || null,
      Preferences: requirement.Preferences || requirement.Amenities || null,
      OriginatingBrokerDisplayName: share.OriginatingBrokerDisplayName || null,
      Status: share.Status,
      ExpiresAt: share.ExpiresAt
    };
  }

  toBrokerNetworkPropertyDTO(property, response) {
    return {
      PropertyID: property.PropertyID,
      PropertyType: property.PropertyType || null,
      Category: property.Category || null,
      SubCategory: property.SubCategory || null,
      Project: property.Project || null,
      Location: property.Location || null,
      City: property.City || null,
      BHK: property.BHK ?? null,
      Area: property.Area ?? null,
      Price: property.Price ?? null,
      Possession: property.Possession || null,
      Status: property.Status || null,
      Amenities: property.Amenities || null,
      Media: property.Media || [],
      SubmittingBrokerID: response?.SubmittingBrokerID || null,
      SubmittingBrokerName: response?.SubmittingBrokerName || null,
      SubmittingBrokerageID: response?.SubmittingBrokerageID || null,
      SubmittedAt: response?.CreatedAt || null,
      ResponseStatus: response?.Status || null,
      Message: response?.Message || null
    };
  }

  recordEvent(db, share, actor, eventType, entityType = 'SharedRequirement', entityId = share.SharedRequirementID, metadata = {}) {
    const event = {
      EventID: this.repository.createId('BNE'),
      SharedRequirementID: share.SharedRequirementID,
      ActorUserID: actor?.userId || null,
      ActorBrokerID: actor?.brokerId || null,
      ActorBrokerageID: actor?.brokerageId || null,
      EventType: eventType,
      EntityType: entityType,
      EntityID: entityId,
      Metadata: metadata,
      CreatedAt: new Date().toISOString()
    };
    db.BrokerNetworkEvents.push(event);
    return event;
  }

  shareView(share) {
    const { ShareTokenHash, ...safe } = share;
    return safe;
  }

  createShare(payload = {}, actorInput = {}) {
    const actor = this.requireActor(actorInput);
    const requirement = this.getRequirement(payload.RequirementID || payload.requirementId);
    if (!this.canAccessRequirement(requirement, actor)) throw this.error('Requirement access denied', 403);

    const token = this.createToken();
    const now = new Date().toISOString();
    const share = {
      SharedRequirementID: this.repository.createId('SHR-REQ'),
      RequirementID: requirement.RequirementID,
      OriginatingBrokerID: actor.brokerId,
      OriginatingBrokerageID: actor.brokerageId,
      OriginatingCompanyID: actor.companyId,
      ReceivingBrokerID: payload.ReceivingBrokerID || payload.receivingBrokerId || null,
      ReceivingBrokerageID: payload.ReceivingBrokerageID || payload.receivingBrokerageId || null,
      OriginatingBrokerDisplayName: actor.name,
      ShareTokenHash: this.hashToken(token),
      Status: 'ACTIVE',
      ExpiresAt: this.expiresAt(payload.Expiry || payload.expiry || '7d'),
      RevokedAt: null,
      LastAccessedAt: null,
      AccessCount: 0,
      CreatedBy: actor.userId,
      UpdatedBy: actor.userId,
      CreatedAt: now,
      UpdatedAt: now,
      ClosedAt: null
    };

    const db = this.readDatabase();
    db.SharedRequirements.push(share);
    this.recordEvent(db, share, actor, 'REQUIREMENT_SHARED');
    this.repository.write(db);

    return {
      ok: true,
      data: {
        share: this.shareView(share),
        token,
        shareUrl: `${this.publicBaseUrl}/broker-network/share/${token}`,
        requirement: this.toBrokerNetworkRequirementDTO(requirement, share)
      }
    };
  }

  resolveShare(token, actorInput = {}) {
    const actor = this.actorContext(actorInput);
    const db = this.readDatabase();
    const share = db.SharedRequirements.find((item) => item.ShareTokenHash === this.hashToken(token));
    if (!share) throw this.error('Share not found', 404);
    if (share.Status === 'REVOKED') throw this.error('Share revoked', 410);
    if (share.Status === 'COMPLETED') throw this.error('Share completed', 410);
    if (new Date(share.ExpiresAt).getTime() <= Date.now()) {
      share.Status = 'EXPIRED';
      this.recordEvent(db, share, actor.ok ? actor.actor : null, 'SHARE_EXPIRED');
      this.repository.write(db);
      throw this.error('Share expired', 410);
    }
    if (!actor.ok && actorInput.requireAuth) throw this.error('Unauthorized', 401);
    if (actor.ok && !this.canReadShare(share, actor.actor)) throw this.error('Share access denied', 403);

    const requirement = this.getRequirement(share.RequirementID);
    share.AccessCount += 1;
    share.LastAccessedAt = new Date().toISOString();
    share.UpdatedAt = share.LastAccessedAt;
    this.recordEvent(db, share, actor.ok ? actor.actor : null, 'SHARE_OPENED');
    this.repository.write(db);
    return { share: this.shareView(share), requirement: this.toBrokerNetworkRequirementDTO(requirement, share) };
  }

  canReadShare(share, actor) {
    if (this.canManageAll(actor)) return true;
    return share.OriginatingBrokerID === actor.brokerId ||
      share.ReceivingBrokerID === actor.brokerId ||
      (share.ReceivingBrokerageID && share.ReceivingBrokerageID === actor.brokerageId);
  }

  findShare(shareId) {
    const db = this.readDatabase();
    const share = db.SharedRequirements.find((item) => item.SharedRequirementID === shareId);
    if (!share) throw this.error('Share not found', 404);
    return { db, share };
  }

  listShares(actorInput = {}) {
    const actor = this.requireActor(actorInput);
    const db = this.readDatabase();
    return {
      ok: true,
      data: db.SharedRequirements.filter((share) => this.canReadShare(share, actor)).map((share) => this.shareView(share))
    };
  }

  getShare(shareId, actorInput = {}) {
    const actor = this.requireActor(actorInput);
    const { share } = this.findShare(shareId);
    if (!this.canReadShare(share, actor)) throw this.error('Share access denied', 403);
    const requirement = this.getRequirement(share.RequirementID);
    return { ok: true, data: { share: this.shareView(share), requirement: this.toBrokerNetworkRequirementDTO(requirement, share), responses: this.listResponsesForShare(shareId, actor) } };
  }

  revokeShare(shareId, actorInput = {}) {
    const actor = this.requireActor(actorInput);
    const { db, share } = this.findShare(shareId);
    if (share.OriginatingBrokerID !== actor.brokerId && !this.canManageAll(actor)) throw this.error('Share revoke denied', 403);
    if (share.Status === 'REVOKED') return { ok: true, data: this.shareView(share) };
    share.Status = 'REVOKED';
    share.RevokedAt = new Date().toISOString();
    share.UpdatedAt = share.RevokedAt;
    share.UpdatedBy = actor.userId;
    this.recordEvent(db, share, actor, 'SHARE_REVOKED');
    this.repository.write(db);
    return { ok: true, data: this.shareView(share) };
  }

  permittedProperty(property, actor) {
    if (!property) return false;
    if (property.BrokerID && property.BrokerID !== actor.brokerId) return false;
    if (!property.BrokerID && actor.role === 'EXTERNAL_BROKER') return false;
    return ['Available', 'Shortlisted', 'Draft', 'Active'].includes(property.Status || 'Available');
  }

  attachProperty(shareId, propertyId, payload = {}, actorInput = {}) {
    const actor = this.requireActor(actorInput);
    const { db, share } = this.findShare(shareId);
    if (!this.canReadShare(share, actor)) throw this.error('Share access denied', 403);
    this.resolveShareByRecord(db, share, actor);
    const property = this.repository.find('Inventory', 'PropertyID', propertyId) || this.repository.find('Properties', 'PropertyID', propertyId);
    if (!this.permittedProperty(property, actor)) throw this.error('Property is not permitted for this broker', 403);
    if (db.SharedRequirementProperties.some((row) => row.SharedRequirementID === shareId && row.PropertyID === propertyId && row.Status !== 'REJECTED')) {
      throw this.error('Property already attached', 409);
    }
    const now = new Date().toISOString();
    const response = {
      SharedRequirementPropertyID: this.repository.createId('SHR-PROP'),
      SharedRequirementID: shareId,
      PropertyID: propertyId,
      SubmittingBrokerID: actor.brokerId,
      SubmittingBrokerageID: actor.brokerageId,
      OriginatingBrokerID: share.OriginatingBrokerID,
      OriginatingBrokerageID: share.OriginatingBrokerageID,
      Status: 'SUBMITTED',
      Notes: payload.Notes || payload.notes || '',
      Message: payload.Message || payload.message || payload.Notes || payload.notes || '',
      SubmittingBrokerName: actor.name,
      CreatedAt: now,
      UpdatedAt: now
    };
    db.SharedRequirementProperties.push(response);
    this.recordEvent(db, share, actor, 'PROPERTY_SUBMITTED', 'SharedRequirementProperty', response.SharedRequirementPropertyID, { PropertyID: propertyId });
    this.repository.write(db);
    return { ok: true, data: { response, property: this.toBrokerNetworkPropertyDTO(property, response) } };
  }

  resolveShareByRecord(db, share, actor) {
    if (share.Status === 'REVOKED' || share.Status === 'COMPLETED') throw this.error('Share is not active', 410);
    if (new Date(share.ExpiresAt).getTime() <= Date.now()) {
      share.Status = 'EXPIRED';
      this.recordEvent(db, share, actor, 'SHARE_EXPIRED');
      this.repository.write(db);
      throw this.error('Share expired', 410);
    }
  }

  listResponsesForShare(shareId, actor) {
    const db = this.readDatabase();
    const share = db.SharedRequirements.find((item) => item.SharedRequirementID === shareId);
    if (!share || !this.canReadShare(share, actor)) throw this.error('Share access denied', 403);
    return db.SharedRequirementProperties.filter((row) => row.SharedRequirementID === shareId).map((response) => {
      const property = this.repository.find('Inventory', 'PropertyID', response.PropertyID) || this.repository.find('Properties', 'PropertyID', response.PropertyID);
      return { ...response, property: property ? this.toBrokerNetworkPropertyDTO(property, response) : null };
    });
  }

  listResponses(shareId, actorInput = {}) {
    const actor = this.requireActor(actorInput);
    return { ok: true, data: this.listResponsesForShare(shareId, actor) };
  }

  removeProperty(shareId, propertyId, actorInput = {}) {
    const actor = this.requireActor(actorInput);
    const { db, share } = this.findShare(shareId);
    if (!this.canReadShare(share, actor)) throw this.error('Share access denied', 403);
    const response = db.SharedRequirementProperties.find((row) => row.SharedRequirementID === shareId && row.PropertyID === propertyId);
    if (!response) throw this.error('Property response not found', 404);
    if (response.SubmittingBrokerID !== actor.brokerId && share.OriginatingBrokerID !== actor.brokerId && !this.canManageAll(actor)) throw this.error('Property removal denied', 403);
    response.Status = 'REJECTED';
    response.UpdatedAt = new Date().toISOString();
    this.recordEvent(db, share, actor, 'PROPERTY_REMOVED', 'SharedRequirementProperty', response.SharedRequirementPropertyID, { PropertyID: propertyId });
    this.repository.write(db);
    return { ok: true, data: response };
  }

  events(shareId, actorInput = {}) {
    const actor = this.requireActor(actorInput);
    const { share } = this.findShare(shareId);
    if (!this.canReadShare(share, actor)) throw this.error('Share access denied', 403);
    return { ok: true, data: this.readDatabase().BrokerNetworkEvents.filter((event) => event.SharedRequirementID === shareId) };
  }
}

module.exports = { BrokerNetworkService };
