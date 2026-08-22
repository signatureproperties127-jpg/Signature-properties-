const http = require('http');
const fs = require('fs');
const path = require('path');
const { SignatureRealtyRuntime } = require('./src/runtime/app');
const { V2Router } = require('./src/api/v2Router');
const { SESSION_COOKIE_NAME } = require('./src/services/authService');
const { GoogleAuthService } = require('./src/services/googleAuthService');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const runtime = new SignatureRealtyRuntime();
// V2 Router shares the same repository instance as the runtime
const v2Router = new V2Router(runtime.repository, (req, url) => resolveSessionActor(req, url));
const googleAuthService = new GoogleAuthService({ jwksUrl: process.env.GOOGLE_JWKS_URL });
const activeSockets = new Set();
let appServer;
let shutdownInProgress = false;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function resolveSessionActor(req, url) {
  const query = {};
  for (const [key, value] of url.searchParams.entries()) query[key] = value;
  const resolved = runtime.resolveAuthenticatedActor({
    headers: req.headers || {},
    query,
    pathname: url.pathname || ''
  });
  return resolved.ok ? resolved.actor : null;
}

function getReportActor(req, url) {
  const sessionActor = resolveSessionActor(req, url);
  if (!sessionActor) return null;
  return {
    userId: sessionActor.userId || '',
    role: sessionActor.role || 'AGENT',
    companyId: sessionActor.companyId || '',
    brokerageId: sessionActor.brokerageId || '',
    permissions: Array.isArray(sessionActor.permissions) ? sessionActor.permissions : [],
    user: sessionActor.user || null
  };
}

function getReportFilters(url) {
  return {
    datePreset: url.searchParams.get('datePreset') || undefined,
    dateFrom: url.searchParams.get('dateFrom') || undefined,
    dateTo: url.searchParams.get('dateTo') || undefined,
    agentId: url.searchParams.get('agentId') || undefined,
    transactionType: url.searchParams.get('transactionType') || undefined,
    category: url.searchParams.get('category') || undefined,
    location: url.searchParams.get('location') || undefined,
    leadSource: url.searchParams.get('leadSource') || undefined,
    builder: url.searchParams.get('builder') || undefined,
    project: url.searchParams.get('project') || undefined,
    dealStatus: url.searchParams.get('dealStatus') || undefined,
    commissionStatus: url.searchParams.get('commissionStatus') || undefined,
    sortBy: url.searchParams.get('sortBy') || undefined
  };
}

function getAdminActor(req) {
  const sessionActor = resolveSessionActor(req, new URL(req.url, `http://${req.headers.host}`));
  if (!sessionActor) return null;
  return {
    userId: sessionActor.userId || '',
    role: sessionActor.role || '',
    companyId: sessionActor.companyId || '',
    brokerageId: sessionActor.brokerageId || '',
    permissions: Array.isArray(sessionActor.permissions) ? sessionActor.permissions : [],
    user: sessionActor.user || null
  };
}

function getNetworkActor(req) {
  const sessionActor = resolveSessionActor(req, new URL(req.url, `http://${req.headers.host}`));
  if (!sessionActor) return null;
  return {
    userId: sessionActor.userId || '',
    role: sessionActor.role || '',
    companyId: sessionActor.companyId || '',
    brokerageId: sessionActor.brokerageId || '',
    permissions: Array.isArray(sessionActor.permissions) ? sessionActor.permissions : [],
    user: sessionActor.user || null
  };
}

function getAuthenticatedActor(req, url) {
  const sessionActor = resolveSessionActor(req, url || new URL(req.url, `http://${req.headers.host}`));
  if (!sessionActor) return null;
  return {
    userId: sessionActor.userId || '',
    role: String(sessionActor.role || 'AGENT').trim().toUpperCase(),
    companyId: sessionActor.companyId || '',
    brokerageId: sessionActor.brokerageId || '',
    permissions: Array.isArray(sessionActor.permissions) ? sessionActor.permissions : [],
    user: sessionActor.user || null
  };
}

function getAuthorizedReportActor(req, res, url, permission = 'REPORTS_VIEW') {
  const actor = getReportActor(req, url);
  if (!actor?.userId) {
    sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
    return null;
  }
  if (permission && !runtime.repository.hasPermission(actor, permission)) {
    sendJson(res, { ok: false, error: 'Forbidden' }, 403);
    return null;
  }
  return actor;
}

function buildSessionCookie(value, maxAgeSeconds = 3600) {
  const encoded = encodeURIComponent(String(value || ''));
  const base = [`${SESSION_COOKIE_NAME}=${encoded}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`];
  if ((Number(maxAgeSeconds) || 0) <= 0) {
    base.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  return base.join('; ');
}

function stripSensitiveMedia(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const { StoragePath, ThumbnailPath, Checksum, UploadedBy, CompanyID, BrokerageID, ...safe } = row;
  return safe;
}

function stripSensitiveDocument(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const { StoragePath, Checksum, UploadedBy, CompanyID, BrokerageID, ...safe } = row;
  return safe;
}

function tenantCheck(record = {}, actor = {}) {
  if (!record || typeof record !== 'object') return { ok: true };
  if (actor.companyId && record.CompanyID && String(record.CompanyID) !== String(actor.companyId)) {
    return { ok: false, statusCode: 403, error: 'Forbidden' };
  }
  if (actor.brokerageId && record.BrokerageID && String(record.BrokerageID) !== String(actor.brokerageId)) {
    return { ok: false, statusCode: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

// ── readJson helper (may be called before V2 dispatch) ──────────────────────
async function readJsonOnce(req) {
  if (req._parsedBody !== undefined) return req._parsedBody;
  const body = await readJson(req);
  req._parsedBody = body;
  return body;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const isAuthConfigPath = /^\/api\/auth\/config\/?$/i.test(pathname);
  const isAuthGooglePath = /^\/api\/auth\/google\/?$/i.test(pathname);

  try {
    // ── V2 Router — handled FIRST for V2-specific and enhanced routes ────────
    // Routes that need a body: pre-read once so V2 and legacy handlers share it
    const needsBody = ['POST', 'PATCH', 'PUT'].includes(req.method);
    let bodyForV2   = null;
    if (needsBody) {
      try { bodyForV2 = await readJsonOnce(req); } catch(_) { bodyForV2 = {}; }
    }

    const v2Result = await v2Router.handle(req, res, url, bodyForV2);
    if (v2Result && v2Result.handled) {
      sendJson(res, v2Result.body, v2Result.statusCode || 200);
      return;
    }
    // ── End V2 Router ─────────────────────────────────────────────────────────

    if (isAuthConfigPath && req.method === 'GET') {
      const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
      if (!clientId) {
        sendJson(res, { ok: false, error: 'Google sign-in is not configured' }, 503);
        return;
      }
      sendJson(res, { ok: true, data: { clientId } });
      return;
    }

    if (isAuthGooglePath && req.method === 'POST') {
      const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
      if (!clientId) {
        sendJson(res, { ok: false, error: 'Google sign-in is not configured' }, 503);
        return;
      }

      const body = await readJson(req);
      const idToken = String(body.idToken || body.credential || '').trim();
      if (!idToken) {
        sendJson(res, { ok: false, error: 'Google ID token is required' }, 400);
        return;
      }

      let googleIdentity;
      try {
        googleIdentity = await googleAuthService.verifyIdToken(idToken, clientId);
      } catch (error) {
        sendJson(res, { ok: false, error: error.message || 'Invalid Google sign-in' }, 401);
        return;
      }

      const users = typeof runtime.repository.listUsers === 'function' ? runtime.repository.listUsers() : [];
      const user = (users || []).find((candidate) =>
        String(candidate?.Email || '').trim().toLowerCase() === googleIdentity.email
      );
      if (!user || String(user.Status || '').trim().toUpperCase() !== 'ACTIVE') {
        sendJson(res, { ok: false, error: 'Unauthorized account' }, 403);
        return;
      }

      const companyId = String(user.CompanyID || user.CompanyId || '').trim();
      const brokerageId = String(user.BrokerageID || user.BrokerageId || '').trim();
      if (!companyId || !brokerageId) {
        sendJson(res, { ok: false, error: 'Tenant scope required' }, 403);
        return;
      }

      const sessionId = runtime.auth.issueSession({
        userId: user.UserID,
        role: user.Role,
        companyId,
        brokerageId,
        permissions: Array.isArray(user.Permissions) ? user.Permissions : []
      });

      sendJson(
        res,
        { ok: true, data: { userId: user.UserID, role: user.Role } },
        200,
        { 'Set-Cookie': buildSessionCookie(sessionId, 3600) }
      );
      return;
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const context = runtime.auth.resolveRequestContext({
        headers: req.headers || {},
        pathname: pathname
      });
      if (context.authenticated && !context.public && context.sessionId) {
        runtime.auth.revokeSession(context.sessionId);
      }
      sendJson(res, { ok: true }, 200, { 'Set-Cookie': buildSessionCookie('', 0) });
      return;
    }

      if (pathname === '/api/public/properties' && req.method === 'GET') {
      const payload = await runtime.listPublicProperties();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/public/projects' && req.method === 'GET') {
      const payload = await runtime.listPublicProjects();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/dashboard') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const payload = await runtime.dashboard();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/leads' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const body = await readJson(req);
      const payload = await runtime.createLead(body);
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/leads' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const payload = await runtime.leads();
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/leads/')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const match = pathname.match(/^\/api\/leads\/([^/]+)(?:\/([^/]+))?$/);

      if (!match) {
        sendJson(res, { ok: false, error: 'Bad lead path' }, 400);
        return;
      }

      const leadId = match[1];
      const subPath = match[2];

      if (req.method === 'GET') {
        if (subPath === 'workspace') {
          const workspace = await runtime.getLeadWorkspace(leadId);
          sendJson(res, workspace);
          return;
        }

        if (subPath === 'requirements') {
          const payload = await runtime.getLeadRequirements(leadId);
          sendJson(res, payload);
          return;
        }

        if (subPath === 'activity') {
          const payload = await runtime.getLeadActivity(leadId);
          sendJson(res, payload);
          return;
        }

        const lead = await runtime.readLead(leadId);
        sendJson(res, lead);
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateLead(leadId, { ...body, params: { leadId } });
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        if (subPath === 'requirements') {
          const body = await readJson(req);
          const payload = await runtime.createRequirement(leadId, body.transactionId || 'TXN-0001', body);
          sendJson(res, payload);
          return;
        }

        if (subPath === 'activity') {
          const body = await readJson(req);
          const payload = await runtime.addActivity(leadId, body);
          sendJson(res, payload);
          return;
        }
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/transactions') {
      const payload = await runtime.router.route('transactions', 'list');
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/followups') {
      if (req.method === 'GET') {
        const leadId = url.searchParams.get('leadId') || url.searchParams.get('LeadID') || undefined;
        const requirementId = url.searchParams.get('requirementId') || url.searchParams.get('RequirementID') || undefined;
        const payload = await runtime.listFollowUps({
          LeadID: leadId,
          RequirementID: requirementId
        });
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        const payload = await runtime.createFollowUp(body);
        sendJson(res, payload, 201);
        return;
      }
    }

    if (pathname === '/api/inventory' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const payload = await runtime.listInventory();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/inventory' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const body = await readJson(req);
      const payload = await runtime.createInventoryProperty(body);
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/requirements' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const body = await readJson(req);
      const payload = await runtime.createRequirement(body.leadId || body.LeadID, body.transactionId || body.TransactionID || 'TXN-0001', body);
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/requirements/') && pathname.endsWith('/matches')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const parts = pathname.split('/').filter(Boolean);
      const requirementId = parts[2];
      const payload = await runtime.getMatches(requirementId);
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/requirements/') && pathname.endsWith('/shortlist')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const parts = pathname.split('/').filter(Boolean);
      const requirementId = parts[2];
      const status = url.searchParams.get('status') || undefined;
      const payload = await runtime.listShortlist({ requirementId, status });
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/requirements/')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const match = pathname.match(/^\/api\/requirements\/([^/]+)(?:\/archive)?$/);
      if (!match) {
        sendJson(res, { ok: false, error: 'Bad requirements path' }, 400);
        return;
      }

      const requirementId = match[1];

      if (req.method === 'GET') {
        const payload = await runtime.readRequirement(requirementId);
        sendJson(res, payload);
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateRequirement(requirementId, body);
        sendJson(res, payload);
        return;
      }

      if (req.method === 'DELETE') {
        const payload = await runtime.deleteRequirement(requirementId);
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST' && pathname.endsWith('/archive')) {
        const payload = await runtime.archiveRequirement(requirementId);
        sendJson(res, payload);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/forms' || pathname.startsWith('/api/forms/')) {
      const parts = pathname.split('/').filter(Boolean);
      const formType = parts[2] || 'residential';
      const config = await runtime.formConfig(formType);
      sendJson(res, { ok: true, data: config });
      return;
    }

    if (pathname === '/api/requirements' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const payload = await runtime.requirements();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/matching/run' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const body = await readJson(req);
      const requirementId = body.requirementId || body.requirementID;
      if (!requirementId) {
        sendJson(res, { ok: false, error: 'requirementId required' }, 400);
        return;
      }
      const payload = await runtime.runMatching(requirementId);
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/matching') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const payload = await runtime.matching();
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/matches/')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const matchId = pathname.split('/').pop();
      const payload = await runtime.getMatch(matchId);
      sendJson(res, payload);
      return;
    }

      if (pathname === '/api/broker-network/shares' && req.method === 'POST') {
      const actor = getNetworkActor(req);
      if (!actor?.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      const body = await readJson(req);
      const payload = runtime.brokerNetworkCreateShare(body, actor);
      sendJson(res, payload, 201);
      return;
    }

    if (pathname === '/api/broker-network/shares' && req.method === 'GET') {
      const actor = getNetworkActor(req);
      if (!actor?.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      sendJson(res, runtime.brokerNetworkListShares(actor));
      return;
    }

    if (pathname === '/public' || pathname === '/public/') {
      const publicProperties = await runtime.listPublicProperties();
      const publicProjects = await runtime.listPublicProjects();
      const propertyCards = (publicProperties.data || []).slice(0, 12).map((property) => `
        <article class="card">
          <div class="eyebrow">${escapeHtml(property.PropertyType || 'Property')}</div>
          <h3>${escapeHtml(property.Project || property.PropertyID || 'Property')}</h3>
          <p>${escapeHtml(property.Location || 'Location unavailable')}</p>
          <div class="meta">₹${escapeHtml(Number(property.Price || 0).toLocaleString('en-IN'))}</div>
        </article>
      `).join('') || '<p class="empty">No public properties yet.</p>';

      const projectCards = (publicProjects.data || []).slice(0, 12).map((project) => `
        <article class="card">
          <div class="eyebrow">Project</div>
          <h3>${escapeHtml(project.ProjectName || project.ProjectID || 'Project')}</h3>
          <p>${escapeHtml(project.Location || 'Location unavailable')}</p>
          <div class="meta">${escapeHtml(project.BuilderID || 'Builder information unavailable')}</div>
        </article>
      `).join('') || '<p class="empty">No public projects yet.</p>';

      sendHtml(res, `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Signature Properties | Public Portfolio</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f5f7fb; color: #17212f; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 40px 20px 80px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
    .brand { font-size: 2rem; font-weight: 700; }
    .subtitle { color: #52607a; margin-top: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
    .card { background: #fff; border-radius: 16px; padding: 18px; box-shadow: 0 10px 25px rgba(17,24,39,0.06); }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; font-size: 11px; margin-bottom: 8px; }
    h3 { margin: 0 0 10px; font-size: 1.2rem; }
    p { margin: 0 0 10px; color: #475569; }
    .meta { color: #0f172a; font-weight: 600; }
    .empty { color: #64748b; }
    .section { margin-top: 36px; }
    .section h2 { margin: 0 0 18px; font-size: 1.4rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div>
        <div class="brand">Signature Properties</div>
        <div class="subtitle">Public portfolio</div>
      </div>
    </div>

    <section class="section">
      <h2>Public Properties</h2>
      <div class="grid">${propertyCards}</div>
    </section>

    <section class="section">
      <h2>Public Projects</h2>
      <div class="grid">${projectCards}</div>
    </section>
  </div>
</body>
</html>`);
      return;
    }

    if (pathname.startsWith('/api/broker-network/public/') && req.method === 'GET') {
      const token = pathname.split('/').pop();
      sendJson(res, { ok: true, data: runtime.brokerNetworkResolveShare(token) });
      return;
    }

    if (pathname.startsWith('/api/broker-network/public/') && pathname.endsWith('/properties') && req.method === 'POST') {
      const parts = pathname.split('/').filter(Boolean);
      const token = parts[3];
      const body = await readJson(req);
      const actor = getNetworkActor(req);
      if (!actor?.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      const resolved = runtime.brokerNetworkResolveShare(token, { ...actor, requireAuth: true });
      const payload = runtime.brokerNetworkAttachProperty(resolved.share.SharedRequirementID, body.propertyId || body.PropertyID, body, actor);
      sendJson(res, payload, 201);
      return;
    }

    if (pathname.startsWith('/api/broker-network/shares/')) {
      const parts = pathname.split('/').filter(Boolean);
      const shareId = parts[3];
      const action = parts[4];
      const propertyId = parts[5];
      const actor = getNetworkActor(req);
      if (!actor?.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }

      if (req.method === 'GET' && !action) {
        sendJson(res, runtime.brokerNetworkGetShare(shareId, actor));
        return;
      }
      if (req.method === 'POST' && action === 'revoke') {
        sendJson(res, runtime.brokerNetworkRevokeShare(shareId, actor));
        return;
      }
      if (req.method === 'GET' && action === 'responses') {
        sendJson(res, runtime.brokerNetworkListResponses(shareId, actor));
        return;
      }
      if (req.method === 'POST' && action === 'properties') {
        const body = await readJson(req);
        sendJson(res, runtime.brokerNetworkAttachProperty(shareId, body.propertyId || body.PropertyID, body, actor), 201);
        return;
      }
      if (req.method === 'DELETE' && action === 'properties' && propertyId) {
        sendJson(res, runtime.brokerNetworkRemoveProperty(shareId, propertyId, actor));
        return;
      }
      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/broker/share') {
      if (req.method === 'POST') {
        const body = await readJson(req);
        const payload = await runtime.brokerShare(body.requirementId, body.brokerId);
        sendJson(res, { ok: true, data: payload });
      } else {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      }
      return;
    }

    if (pathname === '/api/site-visits' && req.method === 'GET') {
      const payload = await runtime.listSiteVisits();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/site-visits' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.createSiteVisit(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname.startsWith('/api/site-visits/')) {
      const visitId = pathname.split('/').filter(Boolean)[2];
      if (!visitId) {
        sendJson(res, { ok: false, error: 'Bad site visits path' }, 400);
        return;
      }

      if (req.method === 'GET') {
        const payload = await runtime.getSiteVisit(visitId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/confirm')) {
        const payload = await runtime.confirmSiteVisit(visitId);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/reschedule')) {
        const body = await readJson(req);
        const payload = await runtime.rescheduleSiteVisit(visitId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/complete')) {
        const payload = await runtime.completeSiteVisit(visitId);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/cancel')) {
        const payload = await runtime.cancelSiteVisit(visitId);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/no-show')) {
        const payload = await runtime.markSiteVisitNoShow(visitId);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateSiteVisit(visitId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/shortlist' && req.method === 'GET') {
      const requirementId = url.searchParams.get('requirementId') || undefined;
      const leadId = url.searchParams.get('leadId') || undefined;
      const status = url.searchParams.get('status') || undefined;
      const payload = await runtime.listShortlist({ requirementId, leadId, status });
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/shortlist' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.addToShortlist(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname.startsWith('/api/shortlist/')) {
      const shortlistId = pathname.split('/').filter(Boolean)[2];

      if (req.method === 'GET') {
        const payload = await runtime.getShortlist(shortlistId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateShortlist(shortlistId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST' && pathname.endsWith('/remove')) {
        const body = await readJson(req);
        const payload = await runtime.removeFromShortlist(shortlistId, body.removedBy || body.RemovedBy || 'system');
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/negotiations' && req.method === 'GET') {
      const payload = await runtime.listNegotiations();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/negotiations' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.createNegotiation(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname.startsWith('/api/negotiations/')) {
      const negotiationId = pathname.split('/').filter(Boolean)[2];
      if (!negotiationId) {
        sendJson(res, { ok: false, error: 'Bad negotiation path' }, 400);
        return;
      }
      const action = pathname.split('/').filter(Boolean)[3] || null;
      if (req.method === 'GET') {
        if (action === 'history') {
          const payload = await runtime.getNegotiationHistory(negotiationId);
          sendJson(res, payload, payload.ok ? 200 : 404);
          return;
        }

        const payload = await runtime.getNegotiation(negotiationId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateNegotiation(negotiationId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);

        if (action === 'offer') {
          const payload = await runtime.makeNegotiationOffer(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'counter') {
          const payload = await runtime.makeNegotiationCounterOffer(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'accept') {
          const payload = await runtime.acceptNegotiationOffer(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'reject') {
          const payload = await runtime.rejectNegotiationOffer(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'hold') {
          const payload = await runtime.holdNegotiation(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'resume') {
          const payload = await runtime.resumeNegotiation(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'agree') {
          const payload = await runtime.markNegotiationAgreed(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'token') {
          const payload = await runtime.recordNegotiationToken(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'agreement') {
          const payload = await runtime.markNegotiationAgreement(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'registration') {
          const payload = await runtime.markNegotiationRegistration(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'complete') {
          const payload = await runtime.completeNegotiation(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'cancel') {
          const payload = await runtime.cancelNegotiation(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/tokens' && req.method === 'GET') {
      const payload = await runtime.listTokens();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/tokens' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.createToken(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/deals' && req.method === 'GET') {
      const payload = await runtime.listDeals();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/deals' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.createDeal(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/commission' && req.method === 'GET') {
      const payload = await runtime.listCommissions();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/commission' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.createCommission(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/commission/calculate' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.calculateCommission(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/commission/summary' && req.method === 'GET') {
      const payload = await runtime.getCommissionSummary();
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname.startsWith('/api/commission/')) {
      const parts = pathname.split('/').filter(Boolean);
      const commissionId = parts[2];
      const action = parts[3] || null;
      if (!commissionId) {
        sendJson(res, { ok: false, error: 'Bad commission path' }, 400);
        return;
      }

      if (req.method === 'GET' && !action) {
        const payload = await runtime.getCommission(commissionId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'GET' && action === 'payments') {
        const payload = await runtime.listCommissionPayments(commissionId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'GET' && action === 'history') {
        const payload = await runtime.getCommissionHistory(commissionId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'PATCH' && action === 'status') {
        const body = await readJson(req);
        const payload = await runtime.updateCommissionStatus(commissionId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST' && action === 'payment') {
        const body = await readJson(req);
        const payload = await runtime.recordCommissionPayment(commissionId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname.startsWith('/api/closing/')) {
      const parts = pathname.split('/').filter(Boolean);
      const dealId = parts[2];
      const action = parts[3] || null;
      if (!dealId) {
        sendJson(res, { ok: false, error: 'Bad closing path' }, 400);
        return;
      }

      if (req.method === 'GET' && !action) {
        const payload = await runtime.getClosing(dealId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'GET' && action === 'history') {
        const payload = await runtime.getClosingHistory(dealId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'POST' && action === 'start') {
        const body = await readJson(req);
        const payload = await runtime.startClosing(dealId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && action === 'checklist') {
        const body = await readJson(req);
        const payload = await runtime.updateClosingChecklist(dealId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST' && action === 'complete') {
        const body = await readJson(req);
        const payload = await runtime.completeClosing(dealId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST' && action === 'close') {
        const body = await readJson(req);
        const payload = await runtime.closeDeal(dealId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/brokers') {
      const payload = await runtime.router.route('brokers', 'list');
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/calendar' && req.method === 'GET') {
      const followUps = await runtime.listFollowUps({});
      const events = (followUps.data || []).map((item) => ({
        FollowUpID: item.FollowUpID,
        LeadID: item.LeadID,
        RequirementID: item.RequirementID,
        RelatedEntityType: item.RelatedEntityType,
        RelatedEntityID: item.RelatedEntityID,
        DueDate: item.DueDate,
        Priority: item.Priority,
        Status: item.Status,
        Notes: item.Notes,
        AssignedUser: item.AssignedUser,
        ActivityType: item.ActivityType
      }));
      sendJson(res, { ok: true, data: events });
      return;
    }

    if (pathname === '/api/notifications') {
      const actor = getAdminActor(req);
      if (req.method === 'GET') {
        const payload = await runtime.getAdminNotifications(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateAdminNotifications(body, actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }
    }

    if (pathname === '/api/owners') {
      if (req.method === 'GET') {
        const payload = await runtime.listOwners();
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        const payload = await runtime.createOwner(body);
        sendJson(res, payload, payload.ok ? 201 : 400);
        return;
      }
    }

    if (pathname === '/api/builders') {
      if (req.method === 'GET') {
        const payload = await runtime.listBuilders();
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        const payload = await runtime.createBuilder(body);
        sendJson(res, payload, payload.ok ? 201 : 400);
        return;
      }
    }

    if (pathname === '/api/projects') {
      if (req.method === 'GET') {
        const payload = await runtime.listProjects();
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        const payload = await runtime.createProject(body);
        sendJson(res, payload, payload.ok ? 201 : 400);
        return;
      }
    }

    if (pathname === '/api/media' && req.method === 'POST') {
      const body = await readJson(req);
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
      const result = await service.createMedia({
        ...body,
        CompanyID: actor.companyId,
        BrokerageID: actor.brokerageId
      }, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, result.ok ? { ok: true, data: stripSensitiveMedia(result.data) } : result, result.ok ? 201 : (result.statusCode || 400));
      return;
    }

    if (pathname.startsWith('/api/media/')) {
      const mediaId = pathname.split('/').filter(Boolean)[2];
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }

      if (req.method === 'GET') {
        const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
        const existing = runtime.repository.getMedia(mediaId);
        if (!existing) {
          sendJson(res, { ok: false, statusCode: 404, error: 'Media not found' }, 404);
          return;
        }
        const scope = tenantCheck(existing, actor);
        if (!scope.ok) {
          sendJson(res, { ok: false, statusCode: 403, error: 'Forbidden' }, 403);
          return;
        }
        const result = await service.getMedia(mediaId, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
        if (result.ok) {
          sendJson(res, { ok: true, data: stripSensitiveMedia(result.data) }, 200);
        } else {
          sendJson(res, result, result.statusCode || 404);
        }
        return;
      }

      if (req.method === 'DELETE') {
        const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
        const existing = runtime.repository.getMedia(mediaId);
        if (!existing) {
          sendJson(res, { ok: false, statusCode: 404, error: 'Media not found' }, 404);
          return;
        }
        const scope = tenantCheck(existing, actor);
        if (!scope.ok) {
          sendJson(res, { ok: false, statusCode: 403, error: 'Forbidden' }, 403);
          return;
        }
        const result = await service.deleteMedia(mediaId, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
        sendJson(res, result.ok ? { ok: true, data: stripSensitiveMedia(result.data) } : result, result.statusCode || (result.ok ? 200 : 400));
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    const mediaEntityMatch = pathname.match(/^\/api\/(builders|projects|properties)\/([^/]+)\/media$/);
    if (mediaEntityMatch && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const entityType = mediaEntityMatch[1].toUpperCase();
      const entityId = mediaEntityMatch[2];
      const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
      const filters = {
        BuilderID: entityType === 'BUILDERS' ? entityId : undefined,
        ProjectID: entityType === 'PROJECTS' ? entityId : undefined,
        PropertyID: entityType === 'PROPERTIES' ? entityId : undefined,
        CompanyID: actor.companyId,
        BrokerageID: actor.brokerageId
      };
      const result = await service.listMedia(filters, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, { ok: true, data: (result.data || []).map(stripSensitiveMedia) }, 200);
      return;
    }

    if (pathname === '/api/documents' && req.method === 'POST') {
      const body = await readJson(req);
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
      const result = await service.createDocument({
        ...body,
        CompanyID: actor.companyId,
        BrokerageID: actor.brokerageId
      }, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, result.ok ? { ok: true, data: stripSensitiveDocument(result.data) } : result, result.ok ? 201 : (result.statusCode || 400));
      return;
    }

    if (pathname.startsWith('/api/documents/')) {
      const documentId = pathname.split('/').filter(Boolean)[2];
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }

      if (req.method === 'GET') {
        const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
        const existing = runtime.repository.getDocument(documentId);
        if (!existing) {
          sendJson(res, { ok: false, statusCode: 404, error: 'Document not found' }, 404);
          return;
        }
        const scope = tenantCheck(existing, actor);
        if (!scope.ok) {
          sendJson(res, { ok: false, statusCode: 403, error: 'Forbidden' }, 403);
          return;
        }
        const result = await service.getDocument(documentId, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
        if (result.ok) {
          sendJson(res, { ok: true, data: stripSensitiveDocument(result.data) }, 200);
        } else {
          sendJson(res, result, result.statusCode || 404);
        }
        return;
      }

      if (req.method === 'DELETE') {
        const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
        const existing = runtime.repository.getDocument(documentId);
        if (!existing) {
          sendJson(res, { ok: false, statusCode: 404, error: 'Document not found' }, 404);
          return;
        }
        const scope = tenantCheck(existing, actor);
        if (!scope.ok) {
          sendJson(res, { ok: false, statusCode: 403, error: 'Forbidden' }, 403);
          return;
        }
        const result = await service.deleteDocument(documentId, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
        sendJson(res, result.ok ? { ok: true, data: stripSensitiveDocument(result.data) } : result, result.statusCode || (result.ok ? 200 : 400));
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    const documentEntityMatch = pathname.match(/^\/api\/(builders|projects|properties)\/([^/]+)\/documents$/);
    if (documentEntityMatch && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const entityType = documentEntityMatch[1].toUpperCase();
      const entityId = documentEntityMatch[2];
      const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
      const filters = {
        BuilderID: entityType === 'BUILDERS' ? entityId : undefined,
        ProjectID: entityType === 'PROJECTS' ? entityId : undefined,
        PropertyID: entityType === 'PROPERTIES' ? entityId : undefined,
        CompanyID: actor.companyId,
        BrokerageID: actor.brokerageId
      };
      const result = await service.listDocuments(filters, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, { ok: true, data: (result.data || []).map(stripSensitiveDocument) }, 200);
      return;
    }

    if (pathname === '/api/documents' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
      const result = await service.listDocuments({ CompanyID: actor.companyId, BrokerageID: actor.brokerageId }, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, { ok: true, data: (result.data || []).map(stripSensitiveDocument) }, 200);
      return;
    }

    if (pathname === '/api/media' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
      const result = await service.listMedia({ CompanyID: actor.companyId, BrokerageID: actor.brokerageId }, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, { ok: true, data: (result.data || []).map(stripSensitiveMedia) }, 200);
      return;
    }

    if (pathname.startsWith('/api/admin/')) {
      const parts = pathname.split('/').filter(Boolean);
      const resource = parts[2] || '';
      const subResource = parts[3] || '';
      const action = parts[4] || '';
      const actor = getAdminActor(req);

      if (resource === 'overview' && req.method === 'GET') {
        const payload = await runtime.getAdminOverview(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'users') {
        if (req.method === 'GET' && !subResource) {
          const payload = await runtime.listAdminUsers(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'POST' && !subResource) {
          const body = await readJson(req);
          const payload = await runtime.createAdminUser(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (subResource && req.method === 'PATCH' && action === 'status') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminUserStatus(subResource, body.status || body.Status, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (subResource && req.method === 'PATCH' && !action) {
          const body = await readJson(req);
          const payload = await runtime.updateAdminUser(subResource, body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'roles') {
        if (req.method === 'GET' && !subResource) {
          const payload = await runtime.listAdminRoles(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'POST' && !subResource) {
          const body = await readJson(req);
          const payload = await runtime.createAdminRole(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (subResource && req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminRole(subResource, body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'permissions' && req.method === 'GET') {
        const payload = await runtime.listAdminPermissions(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'settings') {
        if (req.method === 'GET') {
          const payload = await runtime.getAdminSettings(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminSettings(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'masters') {
        if (req.method === 'GET' && !subResource) {
          const filters = { masterType: url.searchParams.get('masterType') || undefined, active: url.searchParams.get('active') || undefined };
          const payload = await runtime.getAdminMasters(filters, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'POST' && !subResource) {
          const body = await readJson(req);
          const payload = await runtime.createAdminMaster(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (subResource && req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminMaster(subResource, body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'pipeline') {
        if (req.method === 'GET') {
          const payload = await runtime.getAdminPipeline(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminPipeline(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'forms') {
        if (req.method === 'GET' && !subResource) {
          const payload = await runtime.getAdminForms(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH' && subResource && action === 'fields') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminFormField(subResource, parts[5], body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH' && subResource) {
          const body = await readJson(req);
          const payload = await runtime.updateAdminForm(subResource, body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'notifications') {
        if (req.method === 'GET') {
          const payload = await runtime.getAdminNotifications(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminNotifications(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'audit' && req.method === 'GET') {
        const filters = { userId: url.searchParams.get('userId') || undefined, module: url.searchParams.get('module') || undefined, action: url.searchParams.get('action') || undefined, entityType: url.searchParams.get('entityType') || undefined, dateFrom: url.searchParams.get('dateFrom') || undefined, dateTo: url.searchParams.get('dateTo') || undefined };
        const payload = await runtime.getAdminAudit(filters, actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'backups') {
        if (req.method === 'GET') {
          const payload = await runtime.getAdminBackups(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'POST') {
          const body = await readJson(req);
          const payload = await runtime.createAdminBackup(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'restore' && req.method === 'POST') {
        const body = await readJson(req);
        const payload = await runtime.restoreAdminBackup(body.backupId, body, actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'health' && req.method === 'GET') {
        const payload = await runtime.getAdminHealth(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'maintenance' && req.method === 'GET') {
        const payload = await runtime.getAdminMaintenance(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      sendJson(res, { ok: false, error: 'API not found' }, 404);
      return;
    }

    if (pathname === '/api/reports' && req.method === 'GET') {
      const filters = getReportFilters(url);
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getReportsCenter(filters, actor);
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/reports/dashboard' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getDashboardReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/leads' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getLeadsReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/requirements' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getRequirementsReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/inventory' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getInventoryReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/matching' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getMatchingReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/shortlist' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getShortlistReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/site-visits' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getSiteVisitReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/negotiations' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getNegotiationReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/tokens' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getTokenReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/deals' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getDealReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/commission' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getCommissionReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/closing' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getClosingReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/agents' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getAgentsReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/sources' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getSourcesReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/locations' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getLocationsReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/builders' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getBuildersReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/financial' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getFinancialReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/export' && req.method === 'GET') {
      const type = url.searchParams.get('type') || '';
      const format = String(url.searchParams.get('format') || 'csv').toLowerCase();
      if (format !== 'csv') {
        sendJson(res, { ok: false, error: 'Only csv export is supported' }, 400);
        return;
      }

      const actor = getAuthorizedReportActor(req, res, url, 'REPORTS_EXPORT');
      if (!actor) return;
      const payload = await runtime.exportReportCsv(type, getReportFilters(url), actor);
      if (!payload.ok) {
        sendJson(res, payload, 400);
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${payload.filename || 'report.csv'}"`,
        'Cache-Control': 'no-store'
      });
      res.end(payload.data);
      return;
    }

    if (pathname === '/api/search' && req.method === 'GET') {
      const query = url.searchParams.get('q') || '';
      const payload = await runtime.globalSearch(query);
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/users') {
      sendJson(res, { ok: true, data: [] });
      return;
    }

    sendJson(res, { ok: false, error: 'API not found' }, 404);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message || 'Error' }, error.statusCode || 500);
  }
}

async function readJson(req) {
  // If body was already parsed by the V2Router pre-read, return the cache.
  if (req._parsedBody !== undefined) return req._parsedBody;
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        req._parsedBody = {};
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(body);
        req._parsedBody = parsed;
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, payload, statusCode = 200, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sendHtml(res, body, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signature Properties Broker Network</title><style>body{margin:0;background:#f4f1ea;color:#17211b;font:16px Georgia,serif}main{max-width:720px;margin:0 auto;padding:32px 20px}.eyebrow{letter-spacing:.12em;text-transform:uppercase;font:12px Arial,sans-serif;color:#6d746e}.panel{background:#fffdf8;border:1px solid #d8d0c2;padding:24px;box-shadow:0 10px 30px #24352812}h1{font-size:clamp(28px,7vw,48px);line-height:1.05;margin:12px 0 24px}dl{display:grid;grid-template-columns:1fr 1fr;gap:14px;border-top:1px solid #e7e0d4;padding-top:18px}dt{font:11px Arial,sans-serif;text-transform:uppercase;color:#777}dd{margin:4px 0 0;font-size:19px}.privacy{background:#edf2e9;padding:12px;font:14px Arial,sans-serif;margin:22px 0}label{display:block;font:12px Arial,sans-serif;text-transform:uppercase;color:#555;margin-top:18px}input,button{box-sizing:border-box;width:100%;min-height:48px;margin-top:7px;padding:12px;border:1px solid #bcb5a8;font:16px Arial,sans-serif}button{background:#1f4d36;color:white;border-color:#1f4d36;cursor:pointer}#result{font:14px Arial,sans-serif;margin-top:14px}@media(max-width:480px){main{padding:20px 14px}.panel{padding:18px}dl{grid-template-columns:1fr}}</style></head><body>${body}</body></html>`);
}

function sendBrokerNetworkPage(res, token, payload) {
  const requirement = payload.requirement || {};
  const locations = (requirement.Locations || []).map(escapeHtml).join(' / ') || 'Flexible';
  const body = `<main><div class="eyebrow">Signature Properties / Broker Network</div><section class="panel"><h1>Shared property requirement</h1><div class="privacy">Client identity remains hidden. Share only suitable inventory for this requirement.</div><dl><div><dt>Transaction</dt><dd>${escapeHtml(requirement.TransactionType || 'Property')}</dd></div><div><dt>Category</dt><dd>${escapeHtml(requirement.Category || 'Any')}</dd></div><div><dt>Budget</dt><dd>${escapeHtml(requirement.BudgetMin || '-')} - ${escapeHtml(requirement.BudgetMax || '-')}</dd></div><div><dt>Location</dt><dd>${locations}</dd></div><div><dt>BHK</dt><dd>${escapeHtml(requirement.BHKMin || '-')} - ${escapeHtml(requirement.BHKMax || '-')}</dd></div><div><dt>Possession</dt><dd>${escapeHtml(requirement.Possession || 'Any')}</dd></div></dl><label for="propertyId">Attach matching property</label><input id="propertyId" placeholder="Property ID"><button id="attach">Attach Property</button><div id="result" role="status"></div></section><script>document.getElementById('attach').addEventListener('click',async()=>{const result=document.getElementById('result');const propertyId=document.getElementById('propertyId').value.trim();if(!propertyId){result.textContent='Enter a property ID.';return}const response=await fetch('/api/broker-network/public/${encodeURIComponent(token)}/properties',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId})});const data=await response.json();result.textContent=data.ok?'Property submitted.':(data.error||'Unable to submit property.');});</script></main>`;
  sendHtml(res, body);
}

appServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  if (url.pathname === '/public' || url.pathname === '/public/') {
    const publicProperties = await runtime.listPublicProperties();
    const publicProjects = await runtime.listPublicProjects();
    const propertyCards = (publicProperties.data || []).slice(0, 12).map((property) => `
      <article class="card">
        <div class="eyebrow">${escapeHtml(property.PropertyType || 'Property')}</div>
        <h3>${escapeHtml(property.Project || property.PropertyID || 'Property')}</h3>
        <p>${escapeHtml(property.Location || 'Location unavailable')}</p>
        <div class="meta">₹${escapeHtml(Number(property.Price || 0).toLocaleString('en-IN'))}</div>
      </article>
    `).join('') || '<p class="empty">No public properties yet.</p>';

    const projectCards = (publicProjects.data || []).slice(0, 12).map((project) => `
      <article class="card">
        <div class="eyebrow">Project</div>
        <h3>${escapeHtml(project.ProjectName || project.ProjectID || 'Project')}</h3>
        <p>${escapeHtml(project.Location || 'Location unavailable')}</p>
        <div class="meta">${escapeHtml(project.BuilderID || 'Builder information unavailable')}</div>
      </article>
    `).join('') || '<p class="empty">No public projects yet.</p>';

    sendHtml(res, `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Signature Properties | Public Portfolio</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f5f7fb; color: #17212f; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 40px 20px 80px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
    .brand { font-size: 2rem; font-weight: 700; }
    .subtitle { color: #52607a; margin-top: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
    .card { background: #fff; border-radius: 16px; padding: 18px; box-shadow: 0 10px 25px rgba(17,24,39,0.06); }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; font-size: 11px; margin-bottom: 8px; }
    h3 { margin: 0 0 10px; font-size: 1.2rem; }
    p { margin: 0 0 10px; color: #475569; }
    .meta { color: #0f172a; font-weight: 600; }
    .empty { color: #64748b; }
    .section { margin-top: 36px; }
    .section h2 { margin: 0 0 18px; font-size: 1.4rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div>
        <div class="brand">Signature Properties</div>
        <div class="subtitle">Public portfolio</div>
      </div>
    </div>

    <section class="section">
      <h2>Public Properties</h2>
      <div class="grid">${propertyCards}</div>
    </section>

    <section class="section">
      <h2>Public Projects</h2>
      <div class="grid">${projectCards}</div>
    </section>
  </div>
</body>
</html>`);
    return;
  }

  if (url.pathname.startsWith('/broker-network/share/')) {
    const token = url.pathname.split('/').pop();
    try {
      const payload = runtime.brokerNetworkResolveShare(token);
      sendBrokerNetworkPage(res, token, payload);
    } catch (error) {
      sendHtml(res, `<main><h1>Share unavailable</h1><p>${escapeHtml(error.message || 'This share is no longer available.')}</p></main>`, error.statusCode || 404);
    }
    return;
  }

  // ── V2 page routing — extensionless URLs → .html files ─────────────────────
  const V2_ROUTES = {
    '/clients':             '/clients.html',
    '/client-workspace':    '/client-workspace.html',
    '/requirements-view':   '/requirements-view.html'
  };

  let filePath = url.pathname === '/' ? '/index.html'
    : (V2_ROUTES[url.pathname] || url.pathname);

  filePath = path.normalize(filePath).replace(/^\.\.[\/\\]/, '');
  const resolvedPath = path.resolve(ROOT, `.${filePath}`);

  if (!resolvedPath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolvedPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
    });
    res.end(content);
  });
});

appServer.on('connection', (socket) => {
  activeSockets.add(socket);
  socket.on('close', () => {
    activeSockets.delete(socket);
  });
});

function gracefulShutdown(signal) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  if (!appServer || !appServer.listening) {
    return;
  }

  console.log(`Shutdown signal received (${signal}); closing HTTP server...`);

  if (typeof appServer.closeAllConnections === 'function') {
    appServer.closeAllConnections();
  }
  if (typeof appServer.closeIdleConnections === 'function') {
    appServer.closeIdleConnections();
  }

  for (const socket of [...activeSockets]) {
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  appServer.close();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

appServer.listen(PORT, () => {
  console.log(`Signature Properties running at http://localhost:${PORT}`);
});
