const crypto = require('crypto');

const VALID_ROLES = new Set(['ADMIN', 'MANAGER', 'AGENT', 'BROKER', 'VIEWER']);
const ALL_PERMISSIONS = [
  'LEADS_READ', 'LEADS_CREATE', 'LEADS_UPDATE', 'LEADS_DELETE',
  'REQUIREMENTS_READ', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_DELETE',
  'INVENTORY_READ', 'INVENTORY_CREATE', 'INVENTORY_UPDATE', 'INVENTORY_DELETE',
  'SITE_VISIT_READ', 'SITE_VISIT_CREATE', 'SITE_VISIT_UPDATE', 'SITE_VISIT_DELETE',
  'NEGOTIATION_READ', 'NEGOTIATION_UPDATE',
  'TOKEN_READ', 'TOKEN_CREATE', 'TOKEN_UPDATE',
  'DEAL_READ', 'DEAL_CREATE', 'DEAL_UPDATE',
  'COMMISSION_READ', 'COMMISSION_UPDATE',
  'MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE',
  'DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE',
  'USER_READ', 'USER_CREATE', 'USER_UPDATE', 'USER_DELETE',
  'ADMIN_READ', 'ADMIN_UPDATE',
  'REPORT_READ',
  'AUDIT_READ'
];

const ROLE_PERMISSIONS = {
  ADMIN: ALL_PERMISSIONS,
  MANAGER: [
    'LEADS_READ', 'LEADS_CREATE', 'LEADS_UPDATE',
    'REQUIREMENTS_READ', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_UPDATE',
    'INVENTORY_READ', 'INVENTORY_CREATE', 'INVENTORY_UPDATE',
    'SITE_VISIT_READ', 'SITE_VISIT_CREATE', 'SITE_VISIT_UPDATE',
    'NEGOTIATION_READ', 'NEGOTIATION_UPDATE',
    'TOKEN_READ', 'TOKEN_CREATE', 'TOKEN_UPDATE',
    'DEAL_READ', 'DEAL_CREATE', 'DEAL_UPDATE',
    'COMMISSION_READ', 'COMMISSION_UPDATE',
    'MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE',
    'DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE',
    'REPORT_READ', 'AUDIT_READ'
  ],
  AGENT: [
    'LEADS_READ', 'LEADS_CREATE', 'LEADS_UPDATE',
    'REQUIREMENTS_READ', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_UPDATE',
    'INVENTORY_READ',
    'SITE_VISIT_READ', 'SITE_VISIT_CREATE', 'SITE_VISIT_UPDATE',
    'NEGOTIATION_READ', 'NEGOTIATION_UPDATE',
    'TOKEN_READ', 'TOKEN_CREATE', 'TOKEN_UPDATE',
    'DEAL_READ', 'DEAL_CREATE', 'DEAL_UPDATE',
    'COMMISSION_READ', 'COMMISSION_UPDATE',
    'MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE',
    'DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE',
    'REPORT_READ'
  ],
  BROKER: [
    'NEGOTIATION_READ', 'NEGOTIATION_UPDATE',
    'TOKEN_READ', 'TOKEN_CREATE', 'TOKEN_UPDATE',
    'DEAL_READ', 'DEAL_CREATE', 'DEAL_UPDATE',
    'MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE',
    'DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE',
    'REPORT_READ'
  ],
  VIEWER: [
    'LEADS_READ',
    'REQUIREMENTS_READ',
    'INVENTORY_READ',
    'SITE_VISIT_READ',
    'NEGOTIATION_READ',
    'TOKEN_READ',
    'DEAL_READ',
    'COMMISSION_READ',
    'MEDIA_READ',
    'DOCUMENT_READ',
    'REPORT_READ'
  ]
};

class AuthService {
  constructor(repository) {
    this.repository = repository;
    this.sessions = new Map();
    this.publicRoutePatterns = [/^\/api\/public\//i, /^\/health(?:\/|$)/i, /^\/favicon\./i, /^\/$/i];
  }

  normalizePermission(value) {
    return String(value || '').trim().toUpperCase();
  }

  normalizePermissions(list) {
    if (!Array.isArray(list)) return [];
    return Array.from(new Set(list.map((item) => this.normalizePermission(item)).filter(Boolean)));
  }

  getActorIdentity(actor = {}, context = {}) {
    const rawActor = actor && actor.actor ? actor.actor : actor;
    const user = rawActor && typeof rawActor === 'object' ? (rawActor.user || rawActor.account || null) : null;
    const userId = String(rawActor?.userId || rawActor?.userID || rawActor?.id || user?.UserID || context.userId || context.userID || '').trim();
    const repositoryUser = this.repository && typeof this.repository.getUser === 'function' ? this.repository.getUser(userId) : null;
    const userRecord = repositoryUser || user || null;
    const role = String((userRecord?.Role || rawActor?.role || context.role || '').trim() || '').toUpperCase();
    const companyId = String(
      rawActor?.companyId ||
      rawActor?.companyID ||
      user?.CompanyID ||
      user?.CompanyId ||
      userRecord?.CompanyID ||
      userRecord?.CompanyId ||
      ''
    ).trim();
    const brokerageId = String(
      rawActor?.brokerageId ||
      rawActor?.brokerageID ||
      user?.BrokerageID ||
      user?.BrokerageId ||
      userRecord?.BrokerageID ||
      userRecord?.BrokerageId ||
      ''
    ).trim();
    const permissions = this.normalizePermissions(Array.isArray(userRecord?.Permissions) ? userRecord.Permissions : []);
    const status = String(userRecord?.Status || rawActor?.status || context.status || '').trim().toUpperCase();
    return { user: userRecord, userId, role, companyId, brokerageId, permissions, status };
  }

  isPublicRoute(pathname = '') {
    const normalized = String(pathname || '').trim();
    return this.publicRoutePatterns.some((pattern) => pattern.test(normalized));
  }

  issueSession(identity = {}) {
    const userId = String(identity.userId || identity.userID || '').trim();
    if (!userId) {
      throw new Error('userId is required to issue a session');
    }

    const user = this.repository && typeof this.repository.getUser === 'function' ? this.repository.getUser(userId) : null;
    const role = String(identity.role || user?.Role || 'AGENT').trim().toUpperCase();
    const companyId = String(identity.companyId || user?.CompanyID || user?.CompanyId || '').trim();
    const brokerageId = String(identity.brokerageId || user?.BrokerageID || user?.BrokerageId || '').trim();
    const permissions = Array.isArray(identity.permissions)
      ? identity.permissions
      : typeof identity.permissions === 'string'
        ? identity.permissions.split(',').map((item) => String(item).trim()).filter(Boolean)
        : Array.isArray(user?.Permissions)
          ? user.Permissions
          : [];

    const sessionId = crypto.randomBytes(24).toString('hex');
    const session = {
      sessionId,
      userId,
      role,
      companyId,
      brokerageId,
      permissions,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  revokeSession(sessionId) {
    if (!sessionId) return false;
    return this.sessions.delete(String(sessionId));
  }

  resolveRequestContext(request = {}) {
    const headers = request.headers || {};
    const query = request.query || {};
    const pathname = request.pathname || '';

    if (this.isPublicRoute(pathname)) {
      return {
        authenticated: true,
        public: true,
        actorId: null,
        userId: null,
        role: 'PUBLIC',
        companyId: null,
        brokerageId: null,
        permissions: [],
        user: null,
        statusCode: 200
      };
    }

    const authHeader = headers.authorization || headers.Authorization || '';
    const tokenFromHeader = String(authHeader).startsWith('Bearer ')
      ? String(authHeader).replace(/^Bearer\s+/i, '').trim()
      : headers['x-session-token'] || headers['x-sessiontoken'] || '';
    const token = tokenFromHeader || query.sessionToken || query.token || '';

    if (!token) {
      return { authenticated: false, statusCode: 401, error: 'Unauthorized', public: false };
    }

    const session = this.sessions.get(token);
    if (!session) {
      return { authenticated: false, statusCode: 401, error: 'Unauthorized', public: false };
    }

    const expiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : null;
    if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return { authenticated: false, statusCode: 401, error: 'Session expired', public: false };
    }

    const user = this.repository && typeof this.repository.getUser === 'function' ? this.repository.getUser(session.userId) : null;
    if (!user) {
      this.sessions.delete(token);
      return { authenticated: false, statusCode: 401, error: 'Unauthorized', public: false };
    }

    if (String(user.Status || '').trim().toUpperCase() !== 'ACTIVE') {
      this.sessions.delete(token);
      return { authenticated: false, statusCode: 401, error: 'Unauthorized', public: false };
    }

    const role = String(session.role || user.Role || '').trim().toUpperCase() || 'AGENT';
    const companyId = String(session.companyId || user.CompanyID || user.CompanyId || '').trim();
    const brokerageId = String(session.brokerageId || user.BrokerageID || user.BrokerageId || '').trim();
    const permissions = Array.isArray(session.permissions) && session.permissions.length
      ? session.permissions
      : Array.isArray(user.Permissions)
        ? user.Permissions
        : [];

    if (!companyId || !brokerageId) {
      return { authenticated: false, statusCode: 403, error: 'Tenant scope required', public: false };
    }

    return {
      authenticated: true,
      public: false,
      actorId: user.UserID,
      userId: user.UserID,
      role,
      companyId,
      brokerageId,
      permissions,
      user,
      statusCode: 200
    };
  }

  requirePermission(actor = {}, permission, context = {}) {
    const permissionKey = this.normalizePermission(permission);
    if (!permissionKey) {
      return { ok: false, statusCode: 400, error: 'Permission is required' };
    }

    const rawActor = actor && actor.actor ? actor.actor : actor;
    const candidate = this.getActorIdentity(rawActor || {}, context);
    const userRecord = candidate.user;

    if (!candidate.userId || !userRecord) {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }

    if (String(userRecord.Status || '').trim().toUpperCase() !== 'ACTIVE') {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }

    const role = String(userRecord.Role || candidate.role || '').trim().toUpperCase();
    if (!VALID_ROLES.has(role)) {
      return { ok: false, statusCode: 403, error: 'Unknown role' };
    }

    const requestedCompanyId = String(context.companyId || context.companyID || '').trim();
    const requestedBrokerageId = String(context.brokerageId || context.brokerageID || '').trim();
    if ((requestedCompanyId || requestedBrokerageId) && (!candidate.companyId || !candidate.brokerageId)) {
      return { ok: false, statusCode: 403, error: 'Tenant scope required' };
    }
    if (requestedCompanyId && candidate.companyId && requestedCompanyId !== candidate.companyId) {
      return { ok: false, statusCode: 403, error: 'Cross-tenant access denied' };
    }
    if (requestedBrokerageId && candidate.brokerageId && requestedBrokerageId !== candidate.brokerageId) {
      return { ok: false, statusCode: 403, error: 'Cross-tenant access denied' };
    }

    const userPermissions = this.normalizePermissions(Array.isArray(userRecord.Permissions) ? userRecord.Permissions : []);
    const rolePermissions = new Set((ROLE_PERMISSIONS[role] || []).map((item) => this.normalizePermission(item)));
    const effectivePermissions = userPermissions.length ? new Set(userPermissions) : new Set(rolePermissions);

    if (role === 'ADMIN' || effectivePermissions.has('*') || effectivePermissions.has(permissionKey)) {
      return { ok: true, actor: { userId: candidate.userId, role, companyId: candidate.companyId, brokerageId: candidate.brokerageId, permissions: Array.from(effectivePermissions) } };
    }

    return { ok: false, statusCode: 403, error: 'Forbidden' };
  }
}

module.exports = {
  AuthService,
  VALID_ROLES,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS
};
