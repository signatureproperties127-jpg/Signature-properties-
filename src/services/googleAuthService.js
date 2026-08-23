const crypto = require('crypto');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid Google ID token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(decodeBase64Url(encodedHeader).toString('utf8'));
    payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'));
  } catch (_) {
    throw new Error('Invalid Google ID token');
  }
  return {
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: decodeBase64Url(encodedSignature),
    header,
    payload
  };
}

class GoogleAuthService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.nowFn = options.nowFn || (() => Date.now());
    this.jwksUrl = options.jwksUrl || GOOGLE_JWKS_URL;
    this.cachedJwks = null;
    this.jwksExpiresAt = 0;
  }

  async fetchJwks() {
    if (this.cachedJwks && this.nowFn() < this.jwksExpiresAt) {
      return this.cachedJwks;
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Google auth is unavailable');
    }
    const response = await this.fetchImpl(this.jwksUrl);
    if (!response || !response.ok) {
      throw new Error('Unable to verify Google token');
    }
    const body = await response.json();
    const cacheControl = response.headers && typeof response.headers.get === 'function' ? response.headers.get('cache-control') : '';
    const maxAgeMatch = String(cacheControl || '').match(/max-age=(\d+)/i);
    const ttlSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 300;
    this.cachedJwks = Array.isArray(body?.keys) ? body.keys : [];
    this.jwksExpiresAt = this.nowFn() + Math.max(30, ttlSeconds || 300) * 1000;
    return this.cachedJwks;
  }

  async verifyIdToken(idToken, expectedAudience) {
    if (!expectedAudience) throw new Error('Google sign-in is not configured');
    const parsed = parseJwt(idToken);
    const { header, payload, signingInput, signature } = parsed;
    if (String(header.alg || '') !== 'RS256' || !header.kid) {
      throw new Error('Invalid Google ID token');
    }

    const keys = await this.fetchJwks();
    const key = keys.find((entry) => entry && entry.kid === header.kid && entry.kty === 'RSA');
    if (!key) throw new Error('Unable to verify Google token');

    const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
    const verified = crypto.verify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature);
    if (!verified) throw new Error('Invalid Google ID token');

    const issuer = String(payload.iss || '').trim();
    if (!GOOGLE_ISSUERS.has(issuer)) throw new Error('Invalid Google issuer');

    const audience = String(payload.aud || '').trim();
    if (audience !== expectedAudience) throw new Error('Invalid Google audience');

    const exp = Number(payload.exp || 0);
    if (!Number.isFinite(exp) || exp * 1000 <= this.nowFn()) throw new Error('Google token expired');

    const email = String(payload.email || '').trim().toLowerCase();
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    if (!email || !emailVerified) throw new Error('Google account email is not verified');

    return {
      sub: String(payload.sub || '').trim(),
      email,
      name: String(payload.name || '').trim(),
      picture: String(payload.picture || '').trim()
    };
  }
}

module.exports = {
  GoogleAuthService,
  GOOGLE_JWKS_URL
};
