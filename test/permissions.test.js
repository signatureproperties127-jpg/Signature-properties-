const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { SignatureRealtyRuntime } = require('../src/runtime/app');
const { makeDbFile } = require('./admin-test-utils');

test('role and user permissions resolve through the admin boundary', async () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const runtime = new SignatureRealtyRuntime(dbFile);

  assert.equal(repository.hasPermission({ userId: 'USR-0001', role: 'ADMIN' }, 'SETTINGS_MANAGE'), true);
  assert.equal(repository.hasPermission({ userId: 'USR-0002', role: 'MANAGER' }, 'REPORTS_VIEW'), true);
  assert.equal(repository.hasPermission({ userId: 'USR-0002', role: 'MANAGER' }, 'SETTINGS_MANAGE'), false);

  const allowed = await runtime.getAdminSettings({ userId: 'USR-0001', role: 'ADMIN' });
  assert.equal(allowed.ok, true);

  const forbidden = await runtime.getAdminSettings({ userId: 'USR-0002', role: 'MANAGER' });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.statusCode, 403);

  const permissions = repository.getPermissions();
  const adminPermission = permissions.find((item) => item.PermissionCode === 'ADMIN_VIEW');
  assert.ok(adminPermission);
  assert.equal(adminPermission.Module, 'Admin');
});
