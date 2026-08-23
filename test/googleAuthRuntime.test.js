const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { SignatureRealtyRuntime } = require('../src/runtime/app');
const { SESSION_COOKIE_NAME } = require('../src/services/authService');
const { makeDbFile } = require('./admin-test-utils');

test('session cookie auth resolves trusted tenant actor and ignores spoofed headers', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const runtime = new SignatureRealtyRuntime(dbFile);

  repository.createUser({
    UserID: 'USR-GOOGLE-1',
    Name: 'Google User',
    Email: 'google.user@example.com',
    Role: 'AGENT',
    Status: 'Active',
    Permissions: ['LEADS_READ'],
    CompanyID: 'COMP-G1',
    BrokerageID: 'BRK-G1'
  }, { userId: 'USR-0001', role: 'ADMIN' });

  const sessionId = runtime.auth.issueSession({
    userId: 'USR-GOOGLE-1',
    role: 'AGENT',
    companyId: 'COMP-G1',
    brokerageId: 'BRK-G1',
    permissions: ['LEADS_READ']
  });

  const resolved = runtime.resolveAuthenticatedActor({
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
      'x-user-id': 'FAKE-USER',
      'x-company-id': 'FAKE-COMPANY',
      'x-brokerage-id': 'FAKE-BROKERAGE',
      'x-user-role': 'ADMIN'
    },
    pathname: '/api/media'
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.actor.userId, 'USR-GOOGLE-1');
  assert.equal(resolved.actor.role, 'AGENT');
  assert.equal(resolved.actor.companyId, 'COMP-G1');
  assert.equal(resolved.actor.brokerageId, 'BRK-G1');
});
