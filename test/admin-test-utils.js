const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { JsonRepository } = require('../src/data/repository');
const { startJwksServer } = require('./googleAuthTestUtils');
const { TEST_SESSION_SECRET } = require('./session-test-utils');

const IDENTITY_HEADERS = new Set([
  'x-user-id',
  'x-userid',
  'x-user-role',
  'x-company-id',
  'x-companyid',
  'x-brokerage-id',
  'x-brokerageid'
]);
const serverAuthContexts = new Map();
let googleAuthHarnessPromise;

async function ensureGoogleAuthHarness() {
  if (googleAuthHarnessPromise) return googleAuthHarnessPromise;
  googleAuthHarnessPromise = (async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'test-kid-1';
    const clientId = 'test-client-id.apps.googleusercontent.com';
    const jwk = publicKey.export({ format: 'jwk' });
    const jwks = await startJwksServer([{ ...jwk, kid, alg: 'RS256', use: 'sig' }]);
    return { privateKey, clientId, kid, jwksUrl: jwks.url, stop: jwks.stop };
  })();
  return googleAuthHarnessPromise;
}

function makeDbFile(prefix = 'sig-admin-test-') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'sig-realty-db.json');
}

function ensureTenantScopedDefaultUsers(dbFile) {
  const repository = new JsonRepository(dbFile);
  const tenantUsers = [
    { UserID: 'USR-0001', CompanyID: 'COMP-001', BrokerageID: 'BRO-0001' },
    { UserID: 'USR-0002', CompanyID: 'COMP-001', BrokerageID: 'BRO-0001' },
    { UserID: 'USR-0003', CompanyID: 'COMP-001', BrokerageID: 'BRO-0001' }
  ];
  for (const entry of tenantUsers) {
    const user = repository.getUser(entry.UserID);
    if (!user) continue;
    repository.updateUser(entry.UserID, entry, { userId: 'USR-0001', role: 'ADMIN' });
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Could not allocate a free port'));
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function startServer(dbFile, options = {}) {
  ensureTenantScopedDefaultUsers(dbFile);
  const port = options.port || await findFreePort();
  const authHarness = await ensureGoogleAuthHarness();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      SIG_REALTY_DB_FILE: dbFile,
      NODE_ENV: 'test',
      SIG_REALTY_TEST_SESSION_TOKEN: TEST_SESSION_SECRET,
      GOOGLE_CLIENT_ID: authHarness.clientId,
      GOOGLE_JWKS_URL: authHarness.jwksUrl,
      ...(options.env || {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + (options.timeout || 15000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/public/properties`);
      if (response.ok) {
        serverAuthContexts.set(baseUrl, { ...authHarness, dbFile, tokens: new Map() });
        return { child, baseUrl, port };
      }
    } catch (_) {
      // retry until the server is ready
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  child.kill('SIGTERM');
  await once(child, 'exit').catch(() => {});
  throw new Error(`Server failed to start\n${logs.join('')}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}

function lookupUserByIdentity(dbFile, headers = {}) {
  const repository = new JsonRepository(dbFile);
  const requestedUserId = headers['x-user-id'] || headers['x-userid'] || '';
  if (requestedUserId) {
    const user = repository.getUser(String(requestedUserId).trim());
    if (user) return user;
  }

  const requestedRole = String(headers['x-user-role'] || '').trim().toUpperCase();
  if (requestedRole) {
    return (repository.listUsers() || []).find((user) => String(user.Role || '').trim().toUpperCase() === requestedRole) || null;
  }

  return null;
}

function normalizePermissions(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return fallback;
}

async function issueSessionToken(baseUrl, user = {}, headers = {}) {
  const context = serverAuthContexts.get(baseUrl);
  if (!context) return '';
  const requestedUserId = String(headers['x-user-id'] || headers['x-userid'] || '').trim();
  const requestedRole = String(headers['x-user-role'] || '').trim().toUpperCase();
  let rawUser = null;
  try {
    const rawDb = JSON.parse(fs.readFileSync(context.dbFile, 'utf8'));
    const rawUsers = Array.isArray(rawDb?.Users) ? rawDb.Users : [];
    rawUser = requestedUserId
      ? (rawUsers.find((entry) => String(entry?.UserID || '').trim() === requestedUserId) || null)
      : null;
    if (!rawUser && requestedRole) {
      rawUser = rawUsers.find((entry) => String(entry?.Role || '').trim().toUpperCase() === requestedRole) || null;
    }
  } catch (_) {
    rawUser = null;
  }

  const companyId = String(headers['x-company-id'] || headers['x-companyid'] || rawUser?.CompanyID || user.CompanyID || 'COMP-001').trim();
  const brokerageId = String(headers['x-brokerage-id'] || headers['x-brokerageid'] || rawUser?.BrokerageID || user.BrokerageID || 'BRO-0001').trim();
  const role = String(headers['x-user-role'] || rawUser?.Role || user.Role || 'AGENT').trim().toUpperCase();
  const permissions = normalizePermissions(headers['x-user-permissions'] || rawUser?.Permissions || user.Permissions, rawUser?.Permissions || user.Permissions || []);
  try {
    const rawDb = JSON.parse(fs.readFileSync(context.dbFile, 'utf8'));
    const users = Array.isArray(rawDb?.Users) ? rawDb.Users : [];
    const index = users.findIndex((entry) => String(entry?.UserID || '').trim() === 'USR-0001');
    if (index !== -1) {
      users[index] = {
        ...users[index],
        Role: role,
        CompanyID: companyId,
        BrokerageID: brokerageId,
        Permissions: permissions
      };
      rawDb.Users = users;
      fs.writeFileSync(context.dbFile, JSON.stringify(rawDb, null, 2));
    }
  } catch (_) {
    // best-effort patch for test fixtures
  }
  const cacheKey = JSON.stringify({ role, companyId, brokerageId, permissions });
  if (context.tokens.has(cacheKey)) {
    return context.tokens.get(cacheKey);
  }

  const response = await fetch(`${baseUrl}/api/auth/test-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: TEST_SESSION_SECRET, userId: 'USR-0001' })
  });
  const payload = await response.json();
  if (!response.ok || !payload?.ok || !payload?.data?.token) {
    throw new Error(`Unable to issue test session token: ${payload?.error || response.status}`);
  }
  context.tokens.set(cacheKey, payload.data.token);
  return payload.data.token;
}

async function resolveSessionHeaders(baseUrl, headers = {}) {
  const context = serverAuthContexts.get(baseUrl);
  if (!context) return headers;

  const identityHeaderNames = Object.keys(headers).filter((name) => IDENTITY_HEADERS.has(name.toLowerCase()));
  if (!identityHeaderNames.length) return headers;

  const user = lookupUserByIdentity(context.dbFile, headers);
  if (!user) {
    throw new Error(`Unable to resolve authenticated test user for ${identityHeaderNames.join(', ')}`);
  }

  const token = await issueSessionToken(baseUrl, user, headers);

  const nextHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!IDENTITY_HEADERS.has(name.toLowerCase())) {
      nextHeaders[name] = value;
    }
  }
  nextHeaders['x-session-token'] = token;
  return nextHeaders;
}

async function requestJson(baseUrl, route, options = {}) {
  const headers = await resolveSessionHeaders(baseUrl, { ...(options.headers || {}) });
  const requestOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body !== undefined) {
    requestOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
    if (!hasContentType) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(`${baseUrl}${route}`, requestOptions);
  const payload = await response.json();
  return { response, payload };
}

function seedUsers(dbFile, users = []) {
  const repository = new JsonRepository(dbFile);
  for (const user of users) {
    const existing = repository.getUser(user.UserID);
    if (existing) {
      repository.updateUser(user.UserID, user, { userId: 'USR-0001', role: 'ADMIN' });
      continue;
    }
    repository.createUser(user, { userId: 'USR-0001', role: 'ADMIN' });
  }
}

function adminHeaders(extra = {}) {
  return {
    'x-user-id': 'USR-0001',
    'x-user-role': 'ADMIN',
    ...extra
  };
}

function managerHeaders(extra = {}) {
  return {
    'x-user-id': 'USR-0002',
    'x-user-role': 'MANAGER',
    ...extra
  };
}

module.exports = {
  authenticateHeaders: resolveSessionHeaders,
  adminHeaders,
  managerHeaders,
  makeDbFile,
  requestJson,
  seedUsers,
  startServer,
  stopServer
};
