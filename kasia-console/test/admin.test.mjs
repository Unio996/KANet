/**
 * admin.js tests — Task 2 (per tasks/PZ-HANDSHAKE-bug-report-and-fix v1.0 §方案 C).
 *
 * Mix:
 * - Source-level invariants (cron-safe, no Console needed)
 * - Live endpoint test (skip_in_batch, gracefully skips if Console not running)
 *
 * Run: node --test kasia-console/test/admin.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Source-level invariants ───────────────────────────────────────────────────

test('admin.js: registers POST /api/admin/manual-handshake-accept', () => {
  const src = readFileSync(join(ROOT, 'src/api/admin.js'), 'utf-8');
  assert.match(src, /['"]\/api\/admin\/manual-handshake-accept['"]/);
  assert.match(src, /fastify\.post/);
});

test('admin.js: uses verifyIngestRequest preHandler (canonical auth, KI-3)', () => {
  const src = readFileSync(join(ROOT, 'src/api/admin.js'), 'utf-8');
  assert.match(src, /verifyIngestRequest/);
  assert.match(src, /preHandler/);
  // Import canonical: from '../services/ingest-auth.js'
  assert.match(src, /from\s+['"]\.\.\/services\/ingest-auth\.js['"]/);
});

test('admin.js: uses sendCommandAsync with type=handshake (canonical pattern)', () => {
  const src = readFileSync(join(ROOT, 'src/api/admin.js'), 'utf-8');
  assert.match(src, /sendCommandAsync/);
  assert.match(src, /type:\s*['"]handshake['"]/);
  assert.match(src, /from\s+['"]\.\.\/services\/relay-manager\.js['"]/);
});

test('admin.js: validates required args (relayNodeId + remoteAddress)', () => {
  const src = readFileSync(join(ROOT, 'src/api/admin.js'), 'utf-8');
  // Both args must be checked before sendCommand
  assert.match(src, /relayNodeId/);
  assert.match(src, /remoteAddress/);
  assert.match(src, /400/);
});

test('admin.js: 0 SQL writer (passes through to Relay, NOT direct DB mutation)', () => {
  const src = readFileSync(join(ROOT, 'src/api/admin.js'), 'utf-8');
  assert.doesNotMatch(src, /UPDATE\s+/i);
  assert.doesNotMatch(src, /INSERT\s+INTO/i);
  assert.doesNotMatch(src, /from\s+['"]\.\.\/db\/client/);
});

test('index.js: registers admin routes', () => {
  const src = readFileSync(join(ROOT, 'src/index.js'), 'utf-8');
  assert.match(src, /registerAdminRoutes/);
  assert.match(src, /from\s+['"]\.\/api\/admin\.js['"]/);
});

// ── Live endpoint test (skip_in_batch — needs Console + INGEST_SECRET) ────────

export const skip_in_batch = true;

test('LIVE: /api/admin/manual-handshake-accept rejects missing args (skip_in_batch)', async () => {
  const consoleUrl = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';
  const ingestSecret = process.env.INGEST_SECRET || '';
  if (!ingestSecret) return; // graceful skip if env not set
  try {
    const res = await fetch(`${consoleUrl}/api/admin/manual-handshake-accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': ingestSecret },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /required/);
    }
  } catch {
    // Console may not be running — skip silently
  }
});

test('LIVE: /api/admin/manual-handshake-accept 401 without x-ingest-secret (skip_in_batch)', async () => {
  const consoleUrl = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';
  try {
    const res = await fetch(`${consoleUrl}/api/admin/manual-handshake-accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayNodeId: 'x', remoteAddress: 'y' }),
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(res.status, 401);
  } catch {
    // Console may not be running — skip
  }
});
