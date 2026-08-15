const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

function makeDbFile(prefix = 'sig-admin-test-') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'sig-realty-db.json');
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Could not allocate a free port'));
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function startServer(dbFile, options = {}) {
  const port = options.port || await findFreePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), SIG_REALTY_DB_FILE: dbFile, ...(options.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + (options.timeout || 15000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/dashboard`);
      if (response.ok) {
        return { child, baseUrl, port };
      }
    } catch (_) {
      // retry until the server is ready
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  child.kill('SIGTERM');
  await once(child, 'exit').catch(() => {});
  throw new Error(`Server failed to start\n${logs.join('')}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}

async function requestJson(baseUrl, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  const requestOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body !== undefined) {
    requestOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
    if (!hasContentType) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(`${baseUrl}${route}`, requestOptions);
  const payload = await response.json();
  return { response, payload };
}

function adminHeaders(extra = {}) {
  return {
    'x-user-id': 'USR-0001',
    'x-user-role': 'ADMIN',
    ...extra
  };
}

function managerHeaders(extra = {}) {
  return {
    'x-user-id': 'USR-0002',
    'x-user-role': 'MANAGER',
    ...extra
  };
}

module.exports = {
  adminHeaders,
  managerHeaders,
  makeDbFile,
  requestJson,
  startServer,
  stopServer
};
