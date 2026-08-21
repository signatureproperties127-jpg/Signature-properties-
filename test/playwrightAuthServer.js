const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const AUTH_STATE_FILE = path.join(os.tmpdir(), 'sig-playwright-auth.json');
const PORT = String(process.env.PORT || 4173);
const DB_FILE = process.env.SIG_REALTY_DB_FILE || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-playwright-db-')), 'sig-realty-db.json');
const clientId = 'playwright-client-id.apps.googleusercontent.com';
const kid = 'playwright-kid-1';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs1' }).toString();
const jwk = publicKey.export({ format: 'jwk' });

let child;

const jwksServer = http.createServer((req, res) => {
  if (req.url === '/certs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
    res.end(JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] }));
    return;
  }
  res.writeHead(404);
  res.end();
});

function shutdown(code = 0) {
  const finalize = () => jwksServer.close(() => process.exit(code));
  try {
    fs.rmSync(AUTH_STATE_FILE, { force: true });
  } catch (_) {
    // ignore cleanup errors
  }
  if (child && child.exitCode === null) {
    child.once('exit', finalize);
    child.kill('SIGTERM');
    return;
  }
  finalize();
}

jwksServer.listen(0, '127.0.0.1', () => {
  const address = jwksServer.address();
  const jwksPort = typeof address === 'object' && address ? address.port : null;
  const jwksUrl = `http://127.0.0.1:${jwksPort}/certs`;

  fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify({
    baseUrl: `http://127.0.0.1:${PORT}`,
    clientId,
    kid,
    privateKeyPem
  }), { mode: 0o600 });

  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT,
      SIG_REALTY_DB_FILE: DB_FILE,
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_JWKS_URL: jwksUrl
    },
    stdio: 'inherit'
  });

  child.on('exit', (code) => shutdown(code || 0));
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
