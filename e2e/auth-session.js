const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signInWithGoogle } = require('../test/googleAuthTestUtils');

const AUTH_STATE_FILE = path.join(os.tmpdir(), 'sig-playwright-auth.json');

function readAuthState() {
  return JSON.parse(fs.readFileSync(AUTH_STATE_FILE, 'utf8'));
}

async function createSessionToken(email = 'admin@sig.realty') {
  const state = readAuthState();
  const { setCookie, response, payload } = await signInWithGoogle(state.baseUrl, {
    privateKey: state.privateKeyPem,
    clientId: state.clientId,
    kid: state.kid,
    email,
    sub: email
  });
  if (!response.ok || !payload?.ok) {
    throw new Error(`Unable to authenticate ${email}: ${payload?.error || response.status}`);
  }
  const match = String(setCookie).match(/sig_session=([^;]+)/);
  if (!match) {
    throw new Error('Authenticated session cookie was not returned');
  }
  return decodeURIComponent(match[1]);
}

async function applySession(page, email = 'admin@sig.realty') {
  const token = await createSessionToken(email);
  await page.setExtraHTTPHeaders({ 'x-session-token': token });
  return { token };
}

module.exports = {
  applySession,
  createSessionToken
};
