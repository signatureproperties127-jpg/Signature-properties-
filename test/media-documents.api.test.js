const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDbFile, requestJson, seedUsers, startServer, stopServer } = require('./admin-test-utils');

function authHeaders(extra = {}) {
  return {
    'x-user-id': 'USR-API-1',
    'x-user-role': 'AGENT',
    'x-company-id': 'COMP-API',
    'x-brokerage-id': 'BRK-API',
    ...extra
  };
}

function seedMediaUsers(dbFile) {
  seedUsers(dbFile, [
    { UserID: 'USR-API-1', Name: 'API Agent', Email: 'api.agent@example.com', Mobile: '+91 9000001001', Role: 'AGENT', Status: 'Active', Permissions: ['MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE', 'DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE'], CompanyID: 'COMP-API', BrokerageID: 'BRK-API' },
    { UserID: 'USR-PRIVATE-1', Name: 'Private Media Owner', Email: 'private.media.owner@example.com', Mobile: '+91 9000001002', Role: 'AGENT', Status: 'Active', Permissions: ['MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE'], CompanyID: 'COMP-API', BrokerageID: 'BRK-API' },
    { UserID: 'USR-OTHER-1', Name: 'Private Media Viewer', Email: 'private.media.viewer@example.com', Mobile: '+91 9000001003', Role: 'AGENT', Status: 'Active', Permissions: ['MEDIA_READ'], CompanyID: 'COMP-API', BrokerageID: 'BRK-API' },
    { UserID: 'USR-DOC-PRIVATE', Name: 'Private Document Owner', Email: 'private.doc.owner@example.com', Mobile: '+91 9000001004', Role: 'AGENT', Status: 'Active', Permissions: ['DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE'], CompanyID: 'COMP-API', BrokerageID: 'BRK-API' },
    { UserID: 'USR-DOC-OTHER', Name: 'Private Document Viewer', Email: 'private.doc.viewer@example.com', Mobile: '+91 9000001005', Role: 'AGENT', Status: 'Active', Permissions: ['DOCUMENT_READ'], CompanyID: 'COMP-API', BrokerageID: 'BRK-API' }
  ]);
}

function mediaPayload(overrides = {}) {
  return {
    EntityType: 'PROPERTY',
    EntityID: 'PROP-API-1',
    PropertyID: 'PROP-API-1',
    Title: 'API image',
    MediaType: 'IMAGE',
    StorageProvider: 'TEST_PROVIDER',
    StoragePath: '/tmp/media-1.jpg',
    MimeType: 'image/jpeg',
    SizeBytes: 1024,
    Checksum: 'abc123',
    Visibility: 'PUBLIC',
    ...overrides
  };
}

function documentPayload(overrides = {}) {
  return {
    EntityType: 'PROPERTY',
    EntityID: 'PROP-API-2',
    PropertyID: 'PROP-API-2',
    Title: 'API document',
    DocumentType: 'PROPERTY_DOCUMENT',
    StorageProvider: 'TEST_PROVIDER',
    StoragePath: '/tmp/doc-1.pdf',
    MimeType: 'application/pdf',
    SizeBytes: 2048,
    Checksum: 'doc123',
    Visibility: 'PUBLIC',
    ...overrides
  };
}

test('create media via API', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload()
    });
    assert.equal(response.response.status, 201);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.MediaType, 'IMAGE');
    assert.equal(response.payload.data.Visibility, 'PUBLIC');
    assert.equal(response.payload.data.StoragePath, undefined);
  } finally {
    await stopServer(child);
  }
});

test('get media via API', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ Title: 'Media lookup' })
    });
    const response = await requestJson(baseUrl, `/api/media/${created.payload.data.MediaID}`, {
      headers: authHeaders()
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.Title, 'Media lookup');
    assert.equal(response.payload.data.StoragePath, undefined);
  } finally {
    await stopServer(child);
  }
});

test('delete/archive media via API', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ Title: 'DELETE media' })
    });
    const response = await requestJson(baseUrl, `/api/media/${created.payload.data.MediaID}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.DeletedAt !== null, true);
  } finally {
    await stopServer(child);
  }
});

test('create document via API', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ Title: 'API deed' })
    });
    assert.equal(response.response.status, 201);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.DocumentType, 'PROPERTY_DOCUMENT');
    assert.equal(response.payload.data.StoragePath, undefined);
  } finally {
    await stopServer(child);
  }
});

test('get document via API', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ Title: 'Doc lookup' })
    });
    const response = await requestJson(baseUrl, `/api/documents/${created.payload.data.DocumentID}`, {
      headers: authHeaders()
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.Title, 'Doc lookup');
    assert.equal(response.payload.data.StoragePath, undefined);
  } finally {
    await stopServer(child);
  }
});

test('delete/archive document via API', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ Title: 'DELETE doc' })
    });
    const response = await requestJson(baseUrl, `/api/documents/${created.payload.data.DocumentID}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.DeletedAt !== null, true);
  } finally {
    await stopServer(child);
  }
});

test('invalid visibility rejected by media API', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ Visibility: 'TOP_SECRET' })
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.payload.ok, false);
    assert.match(response.payload.error, /Invalid visibility/);
  } finally {
    await stopServer(child);
  }
});

test('missing auth rejected', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      body: documentPayload()
    });
    assert.equal(response.response.status, 401);
    assert.equal(response.payload.ok, false);
  } finally {
    await stopServer(child);
  }
});

test('spoofed tenant headers are ignored for media', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders({ 'x-company-id': 'COMP-OTHER' }),
      body: mediaPayload({ Title: 'Foreign media' })
    });
    const response = await requestJson(baseUrl, `/api/media/${created.payload.data.MediaID}`, {
      headers: authHeaders({ 'x-company-id': 'COMP-API' })
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.Title, 'Foreign media');
  } finally {
    await stopServer(child);
  }
});

test('private media hidden from other user', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders({ 'x-user-id': 'USR-PRIVATE-1' }),
      body: mediaPayload({ Title: 'Private media', Visibility: 'PRIVATE' })
    });
    const response = await requestJson(baseUrl, `/api/media/${created.payload.data.MediaID}`, {
      headers: authHeaders({ 'x-user-id': 'USR-OTHER-1' })
    });
    assert.equal(response.response.status, 403);
    assert.equal(response.payload.ok, false);
  } finally {
    await stopServer(child);
  }
});

test('private document hidden from other user', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders({ 'x-user-id': 'USR-DOC-PRIVATE' }),
      body: documentPayload({ Title: 'Private doc', Visibility: 'PRIVATE' })
    });
    const response = await requestJson(baseUrl, `/api/documents/${created.payload.data.DocumentID}`, {
      headers: authHeaders({ 'x-user-id': 'USR-DOC-OTHER' })
    });
    assert.equal(response.response.status, 403);
    assert.equal(response.payload.ok, false);
  } finally {
    await stopServer(child);
  }
});

test('invalid entity rejected by media API', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ EntityType: 'USER' })
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.payload.ok, false);
    assert.match(response.payload.error, /Invalid entity type/);
  } finally {
    await stopServer(child);
  }
});

test('invalid MIME rejected by document API', async () => {
  const dbFile = makeDbFile();
  seedMediaUsers(dbFile);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ MimeType: 'not-valid' })
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.payload.ok, false);
    assert.match(response.payload.error, /Invalid MIME type/);
  } finally {
    await stopServer(child);
  }
});

test('invalid size rejected by media API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ SizeBytes: 0 })
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.payload.ok, false);
    assert.match(response.payload.error, /Invalid size/);
  } finally {
    await stopServer(child);
  }
});

test('response DTOs do not expose private storage or tenant metadata', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const media = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ Title: 'Sanitized media' })
    });
    const document = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ Title: 'Sanitized doc' })
    });
    assert.equal(media.response.status, 201);
    assert.equal(document.response.status, 201);
    assert.equal(media.payload.data.StoragePath, undefined);
    assert.equal(document.payload.data.StoragePath, undefined);
    assert.equal(media.payload.data.CompanyID, undefined);
    assert.equal(document.payload.data.CompanyID, undefined);
  } finally {
    await stopServer(child);
  }
});
