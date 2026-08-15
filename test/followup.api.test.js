const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const PORT = 4186;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-followup-api-')), 'sig-realty-db.json');

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/dashboard`);
      if (response.ok) return;
    } catch (error) {
      await delay(200);
    }
  }
  throw new Error(`Server did not start at ${BASE_URL}`);
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  return { response, data };
}

let serverProcess;

test.before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), SIG_REALTY_DB_FILE: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');
  await waitForServer();
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

test('follow-up API creates and lists follow-ups for a lead', async () => {
  const created = await requestJson('/api/followups', {
    method: 'POST',
    body: JSON.stringify({
      leadId: 'LEAD-0001',
      requirementId: 'REQ-0001',
      relatedEntityType: 'Requirement',
      relatedEntityId: 'REQ-0001',
      activityType: 'FOLLOW_UP',
      dueDate: '2026-08-20',
      priority: 'High',
      status: 'PENDING',
      notes: 'Follow-up test note',
      assignedUser: 'USR-0001'
    })
  });

  assert.equal(created.response.ok, true);
  assert.equal(created.data.ok, true);
  assert.ok(created.data.data.FollowUpID);

  const list = await requestJson('/api/followups?leadId=LEAD-0001');
  assert.equal(list.response.ok, true);
  assert.equal(list.data.ok, true);
  assert.ok(list.data.data.some((item) => item.Notes === 'Follow-up test note'));
});
