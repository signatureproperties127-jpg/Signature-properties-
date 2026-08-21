const crypto = require('node:crypto');
const http = require('node:http');

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

async function signInWithGoogle(baseUrl, { privateKey, clientId, email, kid = 'kid-1', sub = email, expSeconds = 600 } = {}) {
  const token = makeToken(privateKey, {
    iss: 'https://accounts.google.com',
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + expSeconds,
    email,
    email_verified: true,
    sub
  }, kid);

  const response = await fetch(`${baseUrl}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token })
  });
  const payload = await response.json();
  return {
    response,
    payload,
    setCookie: response.headers.get('set-cookie') || ''
  };
}

module.exports = {
  makeToken,
  signInWithGoogle,
  startJwksServer
};
