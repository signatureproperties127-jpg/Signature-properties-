const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function makeToken(privateKey, payload, kid = 'kid-1') {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

async function startJwksServer(keys) {
  const server = http.createServer((req, res) => {
    if (req.url === '/certs') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
      res.end(JSON.stringify({ keys }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  return {
    server,
    url: `http://127.0.0.1:${port}/certs`,
    stop: () => new Promise((resolve) => server.close(resolve))
  };
}

test('google auth API issues and revokes secure session cookie', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const jwks = await startJwksServer([{ ...jwk, kid: 'kid-1', alg: 'RS256', use: 'sig' }]);

  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  repository.createUser({
    UserID: 'USR-GAUTH-1',
    Name: 'Google Auth User',
    Email: 'google.auth.user@example.com',
    Role: 'AGENT',
    Status: 'Active',
    Permissions: ['LEADS_READ'],
    CompanyID: 'COMP-GAUTH',
    BrokerageID: 'BRK-GAUTH'
  }, { userId: 'USR-0001', role: 'ADMIN' });

  const { child, baseUrl } = await startServer(dbFile, {
    env: {
      GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
      GOOGLE_JWKS_URL: jwks.url
    }
  });

  try {
    const config = await requestJson(baseUrl, '/api/auth/config');
    assert.equal(config.response.status, 200);
    assert.equal(config.payload.data.clientId, 'client-id.apps.googleusercontent.com');

    const token = makeToken(privateKey, {
      iss: 'https://accounts.google.com',
      aud: 'client-id.apps.googleusercontent.com',
      exp: Math.floor(Date.now() / 1000) + 600,
      email: 'google.auth.user@example.com',
      email_verified: true,
      sub: 'google-sub-1'
    }, 'kid-1');

    const signin = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    });
    const signinPayload = await signin.json();
    assert.equal(signin.status, 200);
    assert.equal(signinPayload.ok, true);
    const setCookie = signin.headers.get('set-cookie') || '';
    assert.match(setCookie, /sig_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Lax/i);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: setCookie }
    });
    const logoutPayload = await logout.json();
    assert.equal(logout.status, 200);
    assert.equal(logoutPayload.ok, true);
    assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/i);
  } finally {
    await stopServer(child);
    await jwks.stop();
  }
});
