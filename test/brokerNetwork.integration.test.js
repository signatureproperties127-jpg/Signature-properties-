const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonRepository } = require('../src/data/repository');
const { BrokerNetworkService } = require('../src/services/brokerNetworkService');

function setup() {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-broker-network-integration-')), 'database.json');
  const repository = new JsonRepository(dbFile);
  const db = repository.read();
  db.Users.push(
    { UserID: 'BROKER-A', Name: 'Broker A', Role: 'BROKER', Status: 'Active', BrokerID: 'BRO-A', BrokerageID: 'BR-A', CompanyID: 'CO-A' },
    { UserID: 'BROKER-B', Name: 'Broker B', Role: 'EXTERNAL_BROKER', Status: 'Active', BrokerID: 'BRO-B', BrokerageID: 'BR-B', CompanyID: 'CO-B' }
  );
  db.Requirements[0].CreatedBy = 'BROKER-A';
  db.Inventory.push({ PropertyID: 'PROP-B1', Category: 'Residential', PropertyType: 'Apartment', Project: 'B1 Project', Location: 'Bengaluru East', BHK: 2, Area: 1400, Price: 18500000, Status: 'Available', BrokerID: 'BRO-B' });
  repository.write(db);
  return { dbFile, repository };
}

test('broker A shares, broker B responds, broker A reviews, and state survives restart', () => {
  const { dbFile, repository } = setup();
  const brokerA = { userId: 'BROKER-A' };
  const brokerB = { userId: 'BROKER-B' };
  const first = new BrokerNetworkService(repository);
  const created = first.createShare({ requirementId: 'REQ-0001', receivingBrokerId: 'BRO-B', expiry: '7d' }, brokerA);
  const publicView = first.resolveShare(created.data.token, brokerB);
  assert.equal(publicView.requirement.SharedRequirementID, created.data.share.SharedRequirementID);
  assert.equal(publicView.requirement.ClientName, undefined);

  const submitted = first.attachProperty(created.data.share.SharedRequirementID, 'PROP-B1', { message: 'Available for review' }, brokerB);
  assert.equal(submitted.data.property.PropertyID, 'PROP-B1');
  assert.equal(submitted.data.response.SubmittingBrokerID, 'BRO-B');
  assert.equal(submitted.data.response.OriginatingBrokerID, 'BRO-A');

  const restarted = new BrokerNetworkService(new JsonRepository(dbFile));
  const detail = restarted.getShare(created.data.share.SharedRequirementID, brokerA);
  assert.equal(detail.data.responses.length, 1);
  assert.equal(detail.data.responses[0].property.SubmittingBrokerID, 'BRO-B');
  assert.equal(restarted.events(created.data.share.SharedRequirementID, brokerA).data.length, 3);
});
