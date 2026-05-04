/**
 * V5 fix invariant tests — timeoutVerifying 真 emit timeout_v1 chain TX BEFORE transition (KI-20 严守).
 *
 * Per NWT r186 ack KI-29 复刻第 2 次 + r187 standby:
 * 真 timeoutVerifying line 590 transition('timed_out') 真 SET only, 0 emit chain TX → KI-20 violation.
 * V5 fix: 加 _emitTimeoutAndTransition helper 真 5 attempt retry emit pattern (跟 checkMatchedTimeout line 642-665 同款).
 *
 * Source-only invariant tests (no live DB / no live RPC) — verify code 真守 chain-first.
 *
 * Run: node --test kasia-console/test/v5-timeoutverifying-emit.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MACHINE_PATH = resolve(import.meta.dirname, '../src/services/exchange-machine.js');
const INDEX_PATH = resolve(import.meta.dirname, '../src/index.js');

test('V5 source: _emitTimeoutAndTransition helper 真存在', () => {
  const src = readFileSync(MACHINE_PATH, 'utf-8');
  assert.match(src, /async function _emitTimeoutAndTransition\(id, reason\)/);
});

test('V5 source: helper 真 emit kanet_exchange_timeout_v1 BEFORE transition (chain-first 严守)', () => {
  const src = readFileSync(MACHINE_PATH, 'utf-8');
  // 真 helper body: send_broadcast first, transition() last (sequence 守)
  const helperMatch = src.match(/async function _emitTimeoutAndTransition\(id, reason\)\s*\{[\s\S]+?\n\}/);
  assert.ok(helperMatch, 'helper body 真存在');
  const body = helperMatch[0];
  // emit chain TX in retry loop
  assert.match(body, /kanet_exchange_timeout_v1/);
  assert.match(body, /send_broadcast/);
  assert.match(body, /channel:\s*['"]kanet-exchange['"]/);
  assert.match(body, /for\s*\(let ta\s*=\s*1;\s*ta\s*<=\s*3/);  // 3 attempt retry
  // transition AFTER emit (true sequence)
  const emitIdx = body.indexOf('send_broadcast');
  const transIdx = body.indexOf("transition(id, 'timed_out')");
  assert.ok(emitIdx > 0 && transIdx > 0 && transIdx > emitIdx, 'transition 真 AFTER emit');
});

test('V5 source: helper 真 fail-open on broadcast failure (return false, NOT transition)', () => {
  const src = readFileSync(MACHINE_PATH, 'utf-8');
  const helperMatch = src.match(/async function _emitTimeoutAndTransition\(id, reason\)\s*\{[\s\S]+?\n\}/);
  const body = helperMatch[0];
  // broadcast 失败 → return false (NOT transition), retry next tick
  assert.match(body, /if \(!timeoutTxId\) \{[\s\S]*return false/);
});

test('V5 source: timeoutVerifying 真 async + 2 处 transition 真 use helper', () => {
  const src = readFileSync(MACHINE_PATH, 'utf-8');
  // function 真 async
  assert.match(src, /export async function timeoutVerifying\(\)/);
  // stuck (verifying/awaiting_*) → _emitTimeoutAndTransition
  // stuckVerified (verified→timed_out 120min) → _emitTimeoutAndTransition
  const calls = src.match(/await _emitTimeoutAndTransition\(/g) || [];
  assert.equal(calls.length, 2, '真 2 处 await _emitTimeoutAndTransition (stuck + stuckVerified)');
});

test('V5 source: timeoutVerifying 真 NOT direct transition(id, "timed_out") (helper sole writer)', () => {
  const src = readFileSync(MACHINE_PATH, 'utf-8');
  // grep timeoutVerifying body for direct transition('timed_out')
  const fnMatch = src.match(/export async function timeoutVerifying\(\)\s*\{[\s\S]+?\n\}/);
  assert.ok(fnMatch, 'timeoutVerifying body 真存在');
  const body = fnMatch[0];
  // 真应 0 row direct transition('timed_out') in body — 真用 helper
  // (stuckDelivering 真 transition('verified') 真 OK NOT timed_out)
  const directTimedOutCalls = body.match(/transition\([^)]*['"]timed_out['"]\)/g) || [];
  assert.equal(directTimedOutCalls.length, 0, "timeoutVerifying body 真 0 direct transition('timed_out') — 真 helper sole writer");
});

test('V5 source: caller index.js 真 .catch async pattern (跟 checkMatchedTimeout 同款)', () => {
  const src = readFileSync(INDEX_PATH, 'utf-8');
  // 真 timeoutVerifying().catch(...) pattern (NOT sync `try { timeoutVerifying() }`)
  assert.match(src, /timeoutVerifying\(\)\.catch\(/);
  // 真 0 sync `timeoutVerifying()` in try-block
  assert.ok(!src.match(/try\s*\{[^}]*timeoutVerifying\(\);[^}]*\}/), 'caller 真 .catch async, NOT sync try-block');
});
