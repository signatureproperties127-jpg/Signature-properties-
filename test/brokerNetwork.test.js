const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonRepository } = require('../src/data/repository');
const { BrokerNetworkService } = require('../src/services/brokerNetworkService');

function makeNetwork() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-broker-network-'));
  const repository = new JsonRepository(path.join(directory, 'database.json'));
  const db = repository.read();
  db.Users.push(
    { UserID: 'BROKER-A', Name: 'Originating Broker', Role: 'BROKER', Status: 'Active', BrokerID: 'BRO-A', BrokerageID: 'BR-A', CompanyID: 'CO-A' },
    { UserID: 'BROKER-B', Name: 'Receiving Broker', Role: 'EXTERNAL_BROKER', Status: 'Active', BrokerID: 'BRO-B', BrokerageID: 'BR-B', CompanyID: 'CO-B' },
    { UserID: 'BROKER-C', Name: 'Other Broker', Role: 'EXTERNAL_BROKER', Status: 'Active', BrokerID: 'BRO-C', BrokerageID: 'BR-C', CompanyID: 'CO-C' }
  );
  db.Requirements[0].CreatedBy = 'BROKER-A';
  db.Requirements[0].LeadID = 'LEAD-0001';
  db.Inventory.push({ PropertyID: 'PROP-B', Category: 'Residential', PropertyType: 'Apartment', Project: 'Broker B Project', Location: 'Bengaluru East', BHK: 2, Area: 1200, Price: 18000000, Status: 'Available', BrokerID: 'BRO-B' });
  db.Inventory.push({ PropertyID: 'PROP-C', Category: 'Residential', PropertyType: 'Apartment', Project: 'Broker C Project', Location: 'Bengaluru East', BHK: 2, Area: 1200, Price: 18000000, Status: 'Available', BrokerID: 'BRO-C' });
  repository.write(db);
  return { repository, service: new BrokerNetworkService(repository, { publicBaseUrl: 'https://sig.realty' }) };
}

const actorA = { userId: 'BROKER-A' };
const actorB = { userId: 'BROKER-B' };
const actorC = { userId: 'BROKER-C' };

function serialized(value) {
  return JSON.stringify(value);
}

test('creates opaque unique share tokens and a sanitized requirement DTO', () => {
  const { service } = makeNetwork();
  const first = service.createShare({ requirementId: 'REQ-0001', expiry: '7d' }, actorA);
  const second = service.createShare({ requirementId: 'REQ-0001', expiry: '7d' }, actorA);

  assert.notEqual(first.data.token, second.data.token);
  assert.match(first.data.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(first.data.share.ShareTokenHash, undefined);
  assert.match(first.data.shareUrl, new RegExp(first.data.token));
  assert.equal(first.data.requirement.ClientName, undefined);
  assert.equal(first.data.requirement.Phone, undefined);
  assert.equal(first.data.requirement.Email, undefined);
  assert.equal(first.data.requirement.SpecialNotes, undefined);
  assert.doesNotMatch(serialized(first.data.requirement), /Rohan Verma|98765|rohan\.v@example\.com|parking/i);
});

test('opens a share, attaches only submitting broker inventory, preserves attribution, and prevents duplicates', () => {
  const { service } = makeNetwork();
  const created = service.createShare({ requirementId: 'REQ-0001', receivingBrokerId: 'BRO-B' }, actorA);
  const opened = service.resolveShare(created.data.token, actorB);
  assert.equal(opened.requirement.SharedRequirementID, created.data.share.SharedRequirementID);

  const response = service.attachProperty(created.data.share.SharedRequirementID, 'PROP-B', { message: 'Matching unit' }, actorB);
  assert.equal(response.data.response.OriginatingBrokerID, 'BRO-A');
  assert.equal(response.data.response.SubmittingBrokerID, 'BRO-B');
  assert.equal(response.data.property.OwnerID, undefined);
  assert.equal(response.data.property.Message, 'Matching unit');

  assert.throws(() => service.attachProperty(created.data.share.SharedRequirementID, 'PROP-B', {}, actorB), /already attached/);
  assert.throws(() => service.attachProperty(created.data.share.SharedRequirementID, 'PROP-C', {}, actorB), /not permitted/);
  assert.equal(service.listResponses(created.data.share.SharedRequirementID, actorA).data.length, 1);
});

test('rejects unauthorized share access and supports revocation and expiry', () => {
  const { repository, service } = makeNetwork();
  const created = service.createShare({ requirementId: 'REQ-0001', receivingBrokerId: 'BRO-B' }, actorA);
  assert.throws(() => service.resolveShare(created.data.token, actorC), /access denied/);
  assert.throws(() => service.resolveShare('not-a-real-token'), /Share not found/);

  service.revokeShare(created.data.share.SharedRequirementID, actorA);
  assert.throws(() => service.resolveShare(created.data.token, actorB), /revoked/);

  const expired = service.createShare({ requirementId: 'REQ-0001', receivingBrokerId: 'BRO-B' }, actorA);
  const db = repository.read();
  db.SharedRequirements.find((share) => share.SharedRequirementID === expired.data.share.SharedRequirementID).ExpiresAt = new Date(Date.now() - 1000).toISOString();
  repository.write(db);
  assert.throws(() => service.resolveShare(expired.data.token, actorB), /expired/);
});

test('persists network event history without client identity data', () => {
  const { service, repository } = makeNetwork();
  const created = service.createShare({ requirementId: 'REQ-0001', receivingBrokerId: 'BRO-B' }, actorA);
  service.resolveShare(created.data.token, actorB);
  service.attachProperty(created.data.share.SharedRequirementID, 'PROP-B', {}, actorB);
  const events = service.events(created.data.share.SharedRequirementID, actorA).data;
  assert.deepEqual(events.map((event) => event.EventType), ['REQUIREMENT_SHARED', 'SHARE_OPENED', 'PROPERTY_SUBMITTED']);
  assert.doesNotMatch(serialized(events), /Rohan Verma|98765|rohan\.v@example\.com|Need 2BHK/i);
  const restarted = new BrokerNetworkService(new JsonRepository(repository.dbFile));
  assert.equal(restarted.listResponses(created.data.share.SharedRequirementID, actorA).data.length, 1);
});
