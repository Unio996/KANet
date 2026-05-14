/**
 * Sub D — Tier 2 functional regression for markUtxoSpent / filterPendingUtxos / _utxoKey.
 *
 * NWT 09:31 audit findings (Owner 5/14 严训 "审测试日志非仅代码"):
 *   - bug_a_b_5_14_regression.test.mjs 全 Tier 1 source-pattern grep (assert.match)
 *   - 0 Tier 2 functional verify run-time post-condition (_pendingSpentUtxos.size > 0)
 *   - 这正是 33 天 silent skip 抓不到的 bug 类 (code 看上去 work, 实际 0 effect)
 *
 * 测试 strategy:
 *   - mock 3 种 kaspa-wasm entry shape (UtxoEntry / UtxoEntryReference / flat backward-compat)
 *   - 真 call markUtxoSpent → assert _pendingSpentUtxos.has(expected key)
 *   - 假 shape → assert 不 mutate _pendingSpentUtxos + console.warn fires (canary 防 regression)
 *
 * 跑法: node --test test-framework/cases/broker/bug_a_utxo_marker_functional.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { _testInternals } from '../../../../kasia-relay/src/lib/transaction.mjs';

const { pendingSpentUtxos, utxoKey, markUtxoSpent, filterPendingUtxos, warnedShapeSamples } = _testInternals;

function resetState() {
  pendingSpentUtxos.clear();
  warnedShapeSamples.clear();
}

test('Sub D T1 — IUtxoEntry shape (outpoint.transactionId): _utxoKey extracts correctly', () => {
  resetState();
  const entry = { outpoint: { transactionId: 'aabb1122', index: 3 }, amount: 1000n };
  assert.strictEqual(utxoKey(entry), 'aabb1122:3');
});

test('Sub D T2 — UtxoEntryReference shape (entry.outpoint.transactionId): _utxoKey extracts correctly', () => {
  resetState();
  const entry = { entry: { outpoint: { transactionId: 'ccdd3344', index: 0 } }, amount: 500n };
  assert.strictEqual(utxoKey(entry), 'ccdd3344:0');
});

test('Sub D T3 — flat backward-compat shape (entry.transactionId): _utxoKey extracts correctly', () => {
  resetState();
  const entry = { transactionId: 'eeff5566', index: 1 };
  assert.strictEqual(utxoKey(entry), 'eeff5566:1');
});

test('Sub D T4 — empty entry: _utxoKey returns null (NO silent set, fires canary warn)', () => {
  resetState();
  const calls = [];
  const origWarn = console.warn;
  console.warn = (...args) => { calls.push(args.join(' ')); };
  try {
    assert.strictEqual(utxoKey({}), null);
    assert.ok(calls.some(c => /unable to extract outpoint/.test(c)), 'canary console.warn must fire on unknown shape');
  } finally {
    console.warn = origWarn;
  }
});

test('Sub D T5 — markUtxoSpent with valid IUtxoEntry shape: _pendingSpentUtxos populated (run-time post-condition)', () => {
  resetState();
  const entry = { outpoint: { transactionId: 'tx1111aa', index: 0 }, amount: 100n };
  assert.strictEqual(pendingSpentUtxos.size, 0, 'state empty before mark');
  markUtxoSpent(entry);
  assert.strictEqual(pendingSpentUtxos.size, 1, 'state must populate (33-day silent skip canary)');
  assert.ok(pendingSpentUtxos.has('tx1111aa:0'), 'key tx1111aa:0 must be in map');
});

test('Sub D T6 — markUtxoSpent with unknown shape: _pendingSpentUtxos unchanged + warn fires', () => {
  resetState();
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    markUtxoSpent({ unknown: 'shape' });
    assert.strictEqual(pendingSpentUtxos.size, 0, 'unknown shape must not silently populate');
    assert.ok(warned, 'canary warn must fire');
  } finally {
    console.warn = origWarn;
  }
});

test('Sub D T7 — filterPendingUtxos excludes marked outpoint, keeps others', () => {
  resetState();
  const e1 = { outpoint: { transactionId: 'spent01', index: 0 }, amount: 100n };
  const e2 = { outpoint: { transactionId: 'fresh02', index: 0 }, amount: 200n };
  markUtxoSpent(e1);
  const filtered = filterPendingUtxos([e1, e2]);
  assert.strictEqual(filtered.length, 1, 'spent UTXO must be filtered out');
  assert.strictEqual(filtered[0].outpoint.transactionId, 'fresh02', 'fresh UTXO must remain');
});

test('Sub D T8 — canary warn rate-limited (same signature warns once)', () => {
  resetState();
  const origWarn = console.warn;
  let count = 0;
  console.warn = () => { count++; };
  try {
    utxoKey({ unknown: 'shape' });
    utxoKey({ unknown: 'shape', other: 'field' });  // different sig — should warn again
    utxoKey({ unknown: 'shape' });  // same sig as first — must NOT warn again
    assert.strictEqual(count, 2, 'rate-limit: 2 distinct sigs → 2 warns (not 3)');
  } finally {
    console.warn = origWarn;
  }
});

test('Sub D T9 — Bug A 真 root cause reproduce: silent skip if _utxoKey returned ":0" (regression guard)', () => {
  resetState();
  // 33-day silent skip 真 trigger: 旧 key probe (entry.entry?.transactionId || entry.transactionId)
  // 对 IUtxoEntry { outpoint: { transactionId: 'xxx' } } 返 ':0' (both undefined),
  // 安全 guard skip → _pendingSpentUtxos 永远空. 现 fix 后必填.
  const realisticEntry = { outpoint: { transactionId: '481658e5662d676d430cd58a14ff86bc5614ee006a526952b8c924204ef239b8', index: 0 }, amount: 4000000n };
  markUtxoSpent(realisticEntry);
  assert.strictEqual(pendingSpentUtxos.size, 1, 'Bug A regression: real kaspa-wasm entry shape must populate state');
  assert.ok(pendingSpentUtxos.has('481658e5662d676d430cd58a14ff86bc5614ee006a526952b8c924204ef239b8:0'),
    'exact UTXO key from Owner 5/14 trace must be marked');
});
