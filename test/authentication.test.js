const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { SignatureRealtyRuntime } = require('../src/runtime/app');
const { AuthService } = require('../src/services/authService');
const { makeDbFile } = require('./admin-test-utils');

test('authentication context resolves trusted session and ignores client-supplied identity', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const auth = new AuthService(repository);

  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const resolved = auth.resolveRequestContext({
    headers: {
      'x-session-token': token,
      'x-user-id': 'FAKE-USER',
      'x-company-id': 'FAKE-COMPANY',
      'x-brokerage-id': 'FAKE-BROKERAGE',
      'x-user-role': 'BROKER',
      'x-user-permissions': 'LEADS_CREATE'
    },
    query: {
      userId: 'FAKE-USER',
      companyId: 'FAKE-COMPANY',
      brokerageId: 'FAKE-BROKERAGE',
      role: 'BROKER',
      permissions: 'LEADS_CREATE'
    }
  });

  assert.equal(resolved.authenticated, true);
  assert.equal(resolved.actorId, 'USR-0001');
  assert.equal(resolved.companyId, 'COMP-001');
  assert.equal(resolved.brokerageId, 'BRK-001');
  assert.equal(resolved.role, 'ADMIN');
  assert.deepEqual(resolved.permissions, ['*']);
});

test('authentication denies missing, invalid, disabled and fake identity requests', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const runtime = new SignatureRealtyRuntime(dbFile);
  const auth = new AuthService(repository);

  const missing = runtime.resolveAuthenticatedActor({});
  assert.equal(missing.ok, false);
  assert.equal(missing.statusCode, 401);

  const invalid = runtime.resolveAuthenticatedActor({
    headers: { 'x-session-token': 'INVALID_TOKEN' }
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.statusCode, 401);

  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  repository.updateUserStatus('USR-0001', 'Inactive', { userId: 'USR-0001', role: 'ADMIN' });
  const disabled = auth.resolveRequestContext({ headers: { 'x-session-token': token } });
  assert.equal(disabled.authenticated, false);
  assert.equal(disabled.statusCode, 401);

  repository.updateUserStatus('USR-0001', 'Active', { userId: 'USR-0001', role: 'ADMIN' });
  const freshToken = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const fakeUser = auth.resolveRequestContext({
    headers: {
      'x-session-token': freshToken,
      'x-user-id': 'FAKE-USER',
      'x-company-id': 'FAKE-COMPANY',
      'x-brokerage-id': 'FAKE-BROKERAGE',
      'x-user-role': 'BROKER',
      'x-user-permissions': 'LEADS_CREATE'
    }
  });
  assert.equal(fakeUser.authenticated, true);
  assert.equal(fakeUser.actorId, 'USR-0001');
  assert.equal(fakeUser.companyId, 'COMP-001');
  assert.equal(fakeUser.brokerageId, 'BRK-001');
  assert.equal(fakeUser.role, 'ADMIN');
});

test('expired session is rejected even when client identity is spoofed', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const auth = new AuthService(repository);

  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const session = auth.sessions.get(token);
  if (session) {
    session.expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
  }

  const expired = auth.resolveRequestContext({
    headers: {
      'x-session-token': token,
      'x-user-id': 'FAKE-USER',
      'x-company-id': 'FAKE-COMPANY',
      'x-brokerage-id': 'FAKE-BROKERAGE',
      'x-user-role': 'BROKER',
      'x-user-permissions': 'LEADS_CREATE'
    },
    query: {
      userId: 'FAKE-USER',
      companyId: 'FAKE-COMPANY',
      brokerageId: 'FAKE-BROKERAGE',
      role: 'BROKER',
      permissions: 'LEADS_CREATE'
    }
  });

  assert.equal(expired.authenticated, false);
  assert.equal(expired.statusCode, 401);
});

test('public route remains public and protected route enforces auth', () => {
  const repository = new JsonRepository(makeDbFile());
  const auth = new AuthService(repository);

  assert.equal(auth.isPublicRoute('/api/public/properties'), true);
  assert.equal(auth.isPublicRoute('/api/admin/overview'), false);
  assert.equal(auth.isPublicRoute('/api/reports/summary'), false);

  const publicResult = auth.resolveRequestContext({
    headers: {},
    pathname: '/api/public/properties'
  });
  assert.equal(publicResult.authenticated, true);
  assert.equal(publicResult.public, true);

  const protectedResult = auth.resolveRequestContext({
    headers: {},
    pathname: '/api/admin/overview'
  });
  assert.equal(protectedResult.authenticated, false);
  assert.equal(protectedResult.statusCode, 401);
});

test('cross-tenant access is denied by the auth context', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const auth = new AuthService(repository);

  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const crossTenant = auth.resolveRequestContext({
    headers: {
      'x-session-token': token,
      'x-company-id': 'COMP-999',
      'x-brokerage-id': 'BRK-999'
    }
  });

  assert.equal(crossTenant.authenticated, true);
  assert.equal(crossTenant.companyId, 'COMP-001');
  assert.equal(crossTenant.brokerageId, 'BRK-001');
});
