const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { JsonRepository } = require('../src/data/repository');
const { signInWithGoogle, startJwksServer } = require('./googleAuthTestUtils');

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
  const port = options.port || await findFreePort();
  const authHarness = await ensureGoogleAuthHarness();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      SIG_REALTY_DB_FILE: dbFile,
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
        serverAuthContexts.set(baseUrl, { ...authHarness, dbFile, cookies: new Map() });
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

async function resolveSessionHeaders(baseUrl, headers = {}) {
  const context = serverAuthContexts.get(baseUrl);
  if (!context) return headers;

  const identityHeaderNames = Object.keys(headers).filter((name) => IDENTITY_HEADERS.has(name.toLowerCase()));
  if (!identityHeaderNames.length) return headers;

  const user = lookupUserByIdentity(context.dbFile, headers);
  if (!user || !user.Email) {
    throw new Error(`Unable to resolve authenticated test user for ${identityHeaderNames.join(', ')}`);
  }

  let cookie = context.cookies.get(user.UserID);
  if (!cookie) {
    const signIn = await signInWithGoogle(baseUrl, {
      privateKey: context.privateKey,
      clientId: context.clientId,
      kid: context.kid,
      email: user.Email,
      sub: user.UserID
    });
    if (!signIn.response.ok || !signIn.payload?.ok) {
      throw new Error(`Google sign-in failed for ${user.Email}: ${signIn.payload?.error || signIn.response.status}`);
    }
    cookie = signIn.setCookie;
    context.cookies.set(user.UserID, cookie);
  }

  const nextHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!IDENTITY_HEADERS.has(name.toLowerCase())) {
      nextHeaders[name] = value;
    }
  }
  nextHeaders.cookie = cookie;
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
