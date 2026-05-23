/**
 * Regression test — handshake module state declarations
 *
 * Bug B history: rpc-listener.mjs:635 referenced `_handshakeAccepted` without
 * module-level `let` declaration. ESM strict mode → ReferenceError at first use,
 * silently swallowed by outer catch (pre-fix). Symptom: handshake replies dropped.
 *
 * Guard against re-introduction by asserting all handshake-related module-level
 * Set/Map state is declared at the top of rpc-listener.mjs.
 *
 * Run: node --test kasia-console/test-framework/cases/system/handshake-module-state.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_LISTENER = join(__dirname, '../../../../kasia-relay/src/rpc-listener.mjs');
const SRC = readFileSync(RPC_LISTENER, 'utf-8');
const LINES = SRC.split('\n');

function findLine(predicate) {
  for (let i = 0; i < LINES.length; i++) if (predicate(LINES[i])) return i + 1;
  return -1;
}

test('_handshakeAccepted declared at module-level (top of file, before processHandshake)', () => {
  const declLine = findLine(l => /^\s*let\s+_handshakeAccepted\s*=\s*new\s+Set\s*\(\s*\)/.test(l));
  assert.ok(declLine > 0, '_handshakeAccepted module-level let declaration missing');
  assert.ok(declLine < 200, `_handshakeAccepted declaration must be at module top (found line ${declLine}, expect < 200)`);

  const handshakeFnLine = findLine(l => /async\s+function\s+processHandshake/.test(l));
  assert.ok(handshakeFnLine > 0, 'processHandshake function not found');
  assert.ok(declLine < handshakeFnLine, `_handshakeAccepted declaration (line ${declLine}) must precede processHandshake (line ${handshakeFnLine})`);
});

test('_handshakeAccepted has no implicit auto-create guard inside processHandshake', () => {
  const guardPattern = /if\s*\(\s*!\s*_handshakeAccepted\s*\)\s*_handshakeAccepted\s*=\s*new\s+Set/;
  assert.ok(!guardPattern.test(SRC), 'redundant defensive guard `if (!_handshakeAccepted) _handshakeAccepted = new Set()` must not exist (module-level decl makes it dead code, prone to masking re-introduction of Bug B)');
});

test('all handshake-related module Set state has explicit let declaration', () => {
  const setVars = ['_handshakeAccepted', '_blocklist', '_attempted', '_seen'];
  for (const name of setVars) {
    const decl = new RegExp(`^\\s*(let|const)\\s+${name}\\s*=`, 'm');
    assert.match(SRC, decl, `module-level declaration missing for ${name}`);
  }
});
