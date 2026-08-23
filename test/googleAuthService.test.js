const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { GoogleAuthService } = require('../src/services/googleAuthService');
const { makeToken } = require('./googleAuthTestUtils');

function makeService(keys, now = Date.now()) {
  return new GoogleAuthService({
    nowFn: () => now,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ keys }),
      headers: { get: () => 'public, max-age=300' }
    })
  });
}

test('google auth service verifies RS256 JWT and required claims', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const now = Date.now();
  const payload = {
    iss: 'https://accounts.google.com',
    aud: 'client-id.apps.googleusercontent.com',
    exp: Math.floor(now / 1000) + 600,
    email: 'user@example.com',
    email_verified: true,
    sub: 'google-subject-1'
  };
  const token = makeToken(privateKey, payload, 'kid-1');
  const service = makeService([{ ...jwk, kid: 'kid-1', alg: 'RS256', use: 'sig' }], now);

  const verified = await service.verifyIdToken(token, payload.aud);
  assert.equal(verified.email, 'user@example.com');
  assert.equal(verified.sub, 'google-subject-1');
});

test('google auth service rejects invalid issuer, audience, expiry, and unverified email', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const now = Date.now();
  const service = makeService([{ ...jwk, kid: 'kid-2', alg: 'RS256', use: 'sig' }], now);
  const aud = 'client-id.apps.googleusercontent.com';

  await assert.rejects(
    service.verifyIdToken(makeToken(privateKey, { iss: 'bad-issuer', aud, exp: Math.floor(now / 1000) + 10, email: 'a@b.com', email_verified: true, sub: '1' }, 'kid-2'), aud),
    /issuer/i
  );

  await assert.rejects(
    service.verifyIdToken(makeToken(privateKey, { iss: 'https://accounts.google.com', aud: 'wrong-aud', exp: Math.floor(now / 1000) + 10, email: 'a@b.com', email_verified: true, sub: '1' }, 'kid-2'), aud),
    /audience/i
  );

  await assert.rejects(
    service.verifyIdToken(makeToken(privateKey, { iss: 'https://accounts.google.com', aud, exp: Math.floor(now / 1000) - 10, email: 'a@b.com', email_verified: true, sub: '1' }, 'kid-2'), aud),
    /expired/i
  );

  await assert.rejects(
    service.verifyIdToken(makeToken(privateKey, { iss: 'https://accounts.google.com', aud, exp: Math.floor(now / 1000) + 10, email: 'a@b.com', email_verified: false, sub: '1' }, 'kid-2'), aud),
    /verified/i
  );
});
