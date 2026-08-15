const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, stopServer, requestJson } = require('./admin-test-utils');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-broker-network-api-')), 'database.json');
}

const adminHeaders = { 'x-user-id': 'USR-0001', 'x-user-role': 'ADMIN' };

test('broker network API shares sanitized requirements and manages property responses', async () => {
  const dbFile = makeDbFile();
  const server = await startServer(dbFile);
  try {
    const property = await requestJson(server.baseUrl, '/api/inventory', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        PropertyID: 'PROP-NETWORK-API',
        Category: 'Residential',
        PropertyType: 'Apartment',
        Project: 'Network Project',
        Location: 'Bengaluru East',
        BHK: 2,
        Area: 1450,
        Price: 18000000,
        Status: 'Available',
        BrokerID: 'USR-0001'
      }
    });
    assert.equal(property.response.status, 200);

    const created = await requestJson(server.baseUrl, '/api/broker-network/shares', {
      method: 'POST',
      headers: adminHeaders,
      body: { requirementId: 'REQ-0001', expiry: '7d', companyId: 'ATTACKER', brokerageId: 'ATTACKER', brokerId: 'ATTACKER' }
    });
    assert.equal(created.response.status, 201);
    const share = created.payload.data.share;
    const token = created.payload.data.token;
    assert.ok(token);
    assert.equal(share.ShareTokenHash, undefined);
    assert.equal(created.payload.data.requirement.ClientName, undefined);
    assert.equal(created.payload.data.requirement.Phone, undefined);
    assert.equal(created.payload.data.requirement.Email, undefined);
    assert.equal(created.payload.data.requirement.SpecialNotes, undefined);

    const publicView = await requestJson(server.baseUrl, `/api/broker-network/public/${token}`);
    assert.equal(publicView.response.status, 200);
    assert.equal(publicView.payload.data.requirement.ClientName, undefined);
    assert.equal(publicView.payload.data.requirement.Phone, undefined);
    assert.equal(publicView.payload.data.requirement.Email, undefined);
    assert.doesNotMatch(JSON.stringify(publicView.payload), /Rohan Verma|98765|rohan\.v@example\.com|Need 2BHK/i);

    const attached = await requestJson(server.baseUrl, `/api/broker-network/public/${token}/properties`, {
      method: 'POST',
      headers: adminHeaders,
      body: { propertyId: 'PROP-NETWORK-API', companyId: 'ATTACKER', brokerageId: 'ATTACKER', brokerId: 'ATTACKER' }
    });
    assert.equal(attached.response.status, 201);
    assert.equal(attached.payload.data.response.OriginatingBrokerID, share.OriginatingBrokerID);
    assert.equal(attached.payload.data.response.SubmittingBrokerID, 'USR-0001');

    const responses = await requestJson(server.baseUrl, `/api/broker-network/shares/${share.SharedRequirementID}/responses`, { headers: adminHeaders });
    assert.equal(responses.response.status, 200);
    assert.equal(responses.payload.data.length, 1);

    const duplicate = await requestJson(server.baseUrl, `/api/broker-network/shares/${share.SharedRequirementID}/properties`, {
      method: 'POST', headers: adminHeaders, body: { propertyId: 'PROP-NETWORK-API' }
    });
    assert.equal(duplicate.response.status, 409);

    const revoked = await requestJson(server.baseUrl, `/api/broker-network/shares/${share.SharedRequirementID}/revoke`, { method: 'POST', headers: adminHeaders });
    assert.equal(revoked.response.status, 200);

    const revokedPublic = await requestJson(server.baseUrl, `/api/broker-network/public/${token}`);
    assert.equal(revokedPublic.response.status, 410);
  } finally {
    await stopServer(server.child);
  }
});

test('broker network API rejects guessed tokens and missing authentication', async () => {
  const server = await startServer(makeDbFile());
  try {
    const guessed = await requestJson(server.baseUrl, '/api/broker-network/public/REQ-0001');
    assert.equal(guessed.response.status, 404);
    const unauthenticated = await requestJson(server.baseUrl, '/api/broker-network/shares', { method: 'GET' });
    assert.equal(unauthenticated.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});
