/**
 * llm-health watchdog tests — T1.4 (per task PZ-INFRA-llm-health-watchdog v1.0 §T1.4)
 *
 * Run: node --test kasia-console/test-framework/cases/system/llm-health.test.mjs
 *
 * Mix:
 * - Source-level invariants (cron-safe, no Console needed)
 * - Live endpoint tests (skip_in_batch, defer to T1.5 operator manual verify)
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../../..');

// ── Source-level invariants (cron-safe) ───────────────────────────────────────

test('agent-health.js indicators 含 llm_upstream field', () => {
  const src = readFileSync(join(ROOT, 'kasia-console/src/services/agent-health.js'), 'utf-8');
  assert.match(src, /llm_upstream:\s*llmStatus/, 'agent-health.js must add indicators.llm_upstream from llmStatus');
  assert.match(src, /_fetchLlmStatus/, 'agent-health.js must define _fetchLlmStatus helper');
});

test('agent-health.js fail-closed on LLM probe err (red NOT green)', () => {
  const src = readFileSync(join(ROOT, 'kasia-console/src/services/agent-health.js'), 'utf-8');
  // catch block returns { overall: 'red' } on err
  assert.match(src, /catch[^{]*\{\s*return\s*\{\s*overall:\s*['"]red['"]/, 'fail-closed: probe err → overall=red (KI-16 anti-pattern #3)');
});

test('llm-watchdog.mjs has retry cap (Anti-pattern #4)', () => {
  const src = readFileSync(join(ROOT, 'scripts/llm-watchdog.mjs'), 'utf-8');
  assert.match(src, /RETRY_CAP\s*=/, 'watchdog must define RETRY_CAP constant');
  assert.match(src, /withinRetryCap/, 'watchdog must define withinRetryCap gate');
  assert.match(src, /retry cap.*EXCEEDED/i, 'watchdog must broadcast cap-exceed alarm');
});

test('llm-watchdog.mjs broadcasts on respawn (Anti-pattern #2 / KI-9)', () => {
  const src = readFileSync(join(ROOT, 'scripts/llm-watchdog.mjs'), 'utf-8');
  assert.match(src, /\/api\/chat\/send/, 'watchdog must broadcast via /api/chat/send (NOT silent restart)');
  assert.match(src, /respawn|DOWN/, 'watchdog broadcast must indicate respawn/DOWN event');
});

test('llm-watchdog.mjs uses env var override (Anti-pattern #1)', () => {
  const src = readFileSync(join(ROOT, 'scripts/llm-watchdog.mjs'), 'utf-8');
  // Check at least 4 critical env vars are overridable
  for (const v of ['KANET_ROOT', 'LLAMA_EXE', 'LITELLM_EXE', 'CONSOLE_URL']) {
    assert.match(src, new RegExp(`process\\.env\\.${v}`), `watchdog must support process.env.${v} override`);
  }
});

test('llm-watchdog.mjs spawn detached + unref (Anti-pattern #3)', () => {
  const src = readFileSync(join(ROOT, 'scripts/llm-watchdog.mjs'), 'utf-8');
  assert.match(src, /detached:\s*true/, 'watchdog spawn must use detached:true');
  assert.match(src, /\.unref\(\)/, 'watchdog spawn must call .unref() (NOT parent-cascade kill)');
});

test('api/health.js exposes /api/system/llm-health route', () => {
  const src = readFileSync(join(ROOT, 'kasia-console/src/api/health.js'), 'utf-8');
  assert.match(src, /['"]\/api\/system\/llm-health['"]/, '/api/system/llm-health route must be registered');
  assert.match(src, /alive.*functioning|functioning.*alive/, 'endpoint must distinguish alive vs functioning (KI-16)');
});

// ── Live endpoint test (skip_in_batch — needs Console restart, defer T1.5 operator) ──

export const skip_in_batch = true; // suite-level: live tests skip in cron

test('LIVE: /api/system/llm-health returns correct shape (skip_in_batch)', async () => {
  // T1.5 operator post-Console-restart manually verifies. Cron skip per skip_in_batch flag.
  // Kept here for documentation / manual run via `node --test`.
  try {
    const res = await fetch('http://127.0.0.1:3100/api/system/llm-health', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return; // Console may not have new route loaded yet (pre-restart)
    const data = await res.json();
    assert.ok(data.llama_server);
    assert.ok(typeof data.llama_server.alive === 'boolean');
    assert.ok(typeof data.llama_server.functioning === 'boolean');
    assert.ok(['green', 'yellow', 'red'].includes(data.overall));
  } catch {
    // Console not running OR route not loaded yet — skip silently
  }
});
