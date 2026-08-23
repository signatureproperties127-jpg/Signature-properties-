const { JsonRepository } = require('../src/data/repository');

const TEST_SESSION_SECRET = 'sig-realty-test-session-secret';

function normalizePermissions(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return fallback;
}

function configureFixtureUser(dbFile, options = {}) {
  const repository = new JsonRepository(dbFile);
  const existing = repository.getUser('USR-0001');
  const role = String(options.role || existing?.Role || 'ADMIN').trim().toUpperCase();
  const companyId = String(options.companyId || existing?.CompanyID || 'COMP-0001').trim();
  const brokerageId = String(options.brokerageId || existing?.BrokerageID || 'BRO-0001').trim();
  const permissions = normalizePermissions(options.permissions, existing?.Permissions || []);
  repository.updateUser('USR-0001', {
    Role: role,
    CompanyID: companyId,
    BrokerageID: brokerageId,
    Permissions: permissions
  }, { userId: 'USR-0001', role: 'ADMIN' });
}

async function issueTestSession(baseUrl, dbFile, options = {}) {
  configureFixtureUser(dbFile, options);
  const response = await fetch(`${baseUrl}/api/auth/test-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: TEST_SESSION_SECRET, userId: 'USR-0001' })
  });
  const payload = await response.json();
  if (!response.ok || !payload?.ok || !payload?.data?.token) {
    throw new Error(`Unable to issue test session: ${payload?.error || response.status}`);
  }
  return payload.data.token;
}

module.exports = {
  TEST_SESSION_SECRET,
  configureFixtureUser,
  issueTestSession
};
