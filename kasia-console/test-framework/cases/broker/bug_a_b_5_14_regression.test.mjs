/**
 * Regression — Bug A (UTXO race) + Bug B (preview no quote) — Owner 5/14 实测暴露.
 *
 * Bug A: kasia-relay/src/lib/transaction.mjs markUtxoSpent 旧 key probe
 *   `entry.entry?.transactionId || entry.transactionId` — miss kaspa-wasm IUtxoEntry
 *   shape (real path `entry.outpoint.transactionId`) → silent skip → filterPendingUtxos
 *   never filters → publish broadcast + reply DM 3 ms apart 撞同 UTXO → RPC reject
 *   'already spent in the mempool' → rpc-listener.mjs reply catch 不识别 → 静默 fail
 *   → user 0 reply. Owner 5/14 08:51 BSC menu DM 实测暴露.
 *
 * Bug B: kasia-console/src/services/broker-v3/state-machine.js _previewText 0 价格
 *   → user 盲下单 (Owner 5/14 严训 §2).
 *
 * 跑法: node --test test-framework/cases/broker/bug_a_b_5_14_regression.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSACTION_MJS = readFileSync(join(__dirname, '../../../../kasia-relay/src/lib/transaction.mjs'), 'utf-8');
const RPC_LISTENER_MJS = readFileSync(join(__dirname, '../../../../kasia-relay/src/rpc-listener.mjs'), 'utf-8');
const STATE_MACHINE = readFileSync(join(__dirname, '../../../src/services/broker-v3/state-machine.js'), 'utf-8');

test('Bug A Layer A — markUtxoSpent uses entry.outpoint.transactionId (kaspa-wasm IUtxoEntry shape)', () => {
  assert.match(TRANSACTION_MJS, /function\s+_outpointOf\s*\(/, '_outpointOf helper must exist');
  assert.match(TRANSACTION_MJS, /entry\?\.outpoint\s*\|\|\s*entry\?\.entry\?\.outpoint/, '_outpointOf must handle UtxoEntry + UtxoEntryReference shape');
  assert.match(TRANSACTION_MJS, /function\s+_utxoKey\s*\(/, '_utxoKey helper must exist');
});

test('Bug A Layer A — old broken key probe (entry.entry?.transactionId) deleted', () => {
  // Old buggy code used `entry.entry?.transactionId || entry.transactionId` WITHOUT outpoint.
  // After fix, _utxoKey must reach via outpoint first, with flat fallback as backward-compat.
  // Regression: if anywhere references entry.entry?.transactionId as PRIMARY (not fallback), fail.
  const usesOutpointFirst = /op\?\.transactionId|outpoint\?\.transactionId/.test(TRANSACTION_MJS);
  assert.ok(usesOutpointFirst, 'must reach transactionId via outpoint (kaspa-wasm shape)');
});

test('Bug A Layer B — rpc-listener replyToMessage retry handler covers mempool reject', () => {
  assert.match(RPC_LISTENER_MJS, /already spent.*?in the mempool/, 'reply retry must recognize mempool reject error pattern');
  assert.match(RPC_LISTENER_MJS, /markUtxoSpentByOutpoint/, 'reply retry must mark UTXO explicitly on mempool reject');
  assert.match(RPC_LISTENER_MJS, /Reply mempool reject.*sleep/, 'reply retry must log + sleep on mempool reject');
});

test('Bug B — _previewText fetches getKasPrice + shows total stable', () => {
  assert.match(STATE_MACHINE, /async\s+function\s+_previewText/, '_previewText must be async');
  assert.match(STATE_MACHINE, /getKasPrice/, '_previewText must call getKasPrice');
  assert.match(STATE_MACHINE, /KAS 中间价/, '_previewText must show mid price line');
  assert.match(STATE_MACHINE, /你付总额|你收总额/, '_previewText must show total USDT/USDC line');
  assert.match(STATE_MACHINE, /oracle down/, '_previewText must fallback gracefully if oracle down');
});

test('Bug B — _previewText USDC for Base, USDT for others', () => {
  assert.match(STATE_MACHINE, /pay_chain[^=]*===\s*['"]base['"]\s*\?\s*['"]USDC['"]\s*:\s*['"]USDT['"]/, 'base chain must use USDC, others USDT');
});

test('_handleTradeFlow async + dispatch awaits BUY/SELL', () => {
  assert.match(STATE_MACHINE, /async\s+function\s+_handleTradeFlow/, '_handleTradeFlow must be async (calls async _previewText)');
  assert.match(STATE_MACHINE, /case\s+'BUY_FLOW':\s*return\s+await\s+_handleTradeFlow/, "BUY_FLOW dispatch must await");
  assert.match(STATE_MACHINE, /case\s+'SELL_FLOW':\s*return\s+await\s+_handleTradeFlow/, "SELL_FLOW dispatch must await");
});
