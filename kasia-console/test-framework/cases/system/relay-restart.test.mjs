/**
 * Relay restart endpoint unit tests — Bug 1 path C ship (per Owner 5/2 approve, T1-bugfix-handshake)
 *
 * Run: node --test kasia-console/test-framework/cases/system/relay-restart.test.mjs
 *
 * Scope:
 * - stopRelay edge case (non-existing relayId)
 * - Type/export invariants for stopRelay + startRelay
 * - Source-level grep: endpoint /api/relay/:id/restart registered + stopRelay imported
 *
 * Live verify (real spawn + kill PID change) defer to operator hat manual test post-ship.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { stopRelay, startRelay } from '../../../src/services/relay-manager.js';

test('stopRelay non-existing relayId returns ok:false reason:not_running', async () => {
  const r = await stopRelay('non-existing-id-' + Math.random().toString(36).slice(2));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_running');
});

test('stopRelay + startRelay exported as async functions', () => {
  assert.equal(typeof stopRelay, 'function');
  assert.equal(typeof startRelay, 'function');
  const stopP = stopRelay('placeholder').catch(() => {});
  assert.ok(stopP instanceof Promise, 'stopRelay returns Promise');
});

test('source: /api/relay/:id/restart endpoint registered in api/relay.js', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../../../src/api/relay.js', import.meta.url), 'utf-8');
  assert.match(src, /['"]\/api\/relay\/:id\/restart['"]/, 'endpoint route /api/relay/:id/restart not found');
  assert.match(src, /import\s+\{[^}]*stopRelay[^}]*\}/, 'stopRelay not imported in api/relay.js');
  assert.match(src, /await\s+stopRelay\(\s*id\s*\)/, 'stopRelay not awaited in restart handler');
  assert.match(src, /await\s+startRelay\(\s*id\s*\)/, 'startRelay not awaited in restart handler');
});
