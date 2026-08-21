const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');
const { makeToken, startJwksServer } = require('./googleAuthTestUtils');

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
