/**
 * Sub Tier-2 — Bug C chain normalize functional regression (NWT 11:18 backlog ack).
 *
 * NWT 5/14 11:04 audit gap 1: Bug C source-pattern test (Tier 1) doesn't verify run-time
 * behavior of normalizeChainKey. Tier 2 functional verifies actual alias mapping + chains.find
 * matching across UI label / DB-canonical / aliases.
 *
 * 真补 audit doc final sign #4 (NWT 11:16 backlog item).
 *
 * 跑法: node --test test-framework/cases/broker/bug_c_chain_normalize_functional.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { _testInternalsRouter } from '../../../src/services/broker-v3/router.js';
import { _testInternalsExchange } from '../../../src/api/exchange.js';

const fnRouter = _testInternalsRouter.normalizeChainKey;
const fnExchange = _testInternalsExchange.normalizeChainKey;

// ── Bug C T1: BSC family alias 全 mapping (UI 'bsc' → DB 'bnb') ──
test('Bug C T1 — BSC family alias: bsc / bep20 / binance-smart-chain → bnb', () => {
  assert.strictEqual(fnRouter('bsc'), 'bnb');
  assert.strictEqual(fnRouter('BSC'), 'bnb');  // uppercase OK
  assert.strictEqual(fnRouter('bep20'), 'bnb');
  assert.strictEqual(fnRouter('binance-smart-chain'), 'bnb');
});

// ── Bug C T2: DB-canonical pass-through (bnb / sol / eth) ──
test('Bug C T2 — DB-canonical pass-through: bnb / sol / eth → identity', () => {
  assert.strictEqual(fnRouter('bnb'), 'bnb');
  assert.strictEqual(fnRouter('sol'), 'sol');
  assert.strictEqual(fnRouter('eth'), 'eth');
});

// ── Bug C T3: Other chain alias (solana → sol, ethereum → eth) ──
test('Bug C T3 — solana → sol, ethereum → eth', () => {
  assert.strictEqual(fnRouter('solana'), 'sol');
  assert.strictEqual(fnRouter('SOLANA'), 'sol');
  assert.strictEqual(fnRouter('ethereum'), 'eth');
  assert.strictEqual(fnRouter('Ethereum'), 'eth');
});

// ── Bug C T4: Other chain lowercase passthrough (polygon / arbitrum / optimism / base) ──
test('Bug C T4 — polygon / arbitrum / optimism / base → lowercase identity', () => {
  assert.strictEqual(fnRouter('polygon'), 'polygon');
  assert.strictEqual(fnRouter('Polygon'), 'polygon');
  assert.strictEqual(fnRouter('arbitrum'), 'arbitrum');
  assert.strictEqual(fnRouter('optimism'), 'optimism');
  assert.strictEqual(fnRouter('base'), 'base');
});

// ── Bug C T5: null / empty / undefined input safety ──
test('Bug C T5 — null / empty / undefined safe handling', () => {
  assert.strictEqual(fnRouter(null), null);
  assert.strictEqual(fnRouter(undefined), undefined);
  assert.strictEqual(fnRouter(''), '');
});

// ── Bug C T6: chains.find pattern real run-time (双 wrap match) ──
test('Bug C T6 — chains.find with normalizeChainKey双 wrap finds BSC UI label in DB-canonical chains', () => {
  // Simulate Bug C real scenario: chains array has DB-canonical 'bnb', user input 'bsc' UI label
  const chains = [
    { chain: 'bnb', address: '0xtest_bnb_addr' },
    { chain: 'eth', address: '0xtest_eth_addr' },
  ];
  const selectedNorm = fnRouter('bsc');  // UI 'bsc' → 'bnb'
  const found = chains.find(c => fnRouter(c.chain) === selectedNorm);
  assert.ok(found, 'must find chain via normalizeChainKey双 wrap (Bug C真治根)');
  assert.strictEqual(found.chain, 'bnb');
  assert.strictEqual(found.address, '0xtest_bnb_addr');
});

// ── Bug C T7: chains.find rejects truly absent chain ──
test('Bug C T7 — chains.find returns undefined for unaccepted chain', () => {
  const chains = [{ chain: 'bnb', address: '0xtest' }];
  const selectedNorm = fnRouter('sol');  // 'sol' not in chains
  const found = chains.find(c => fnRouter(c.chain) === selectedNorm);
  assert.strictEqual(found, undefined);
});

// ── Bug C T8: PARITY — router.js + exchange.js normalizeChainKey 行为一致 (双侧 fn parity) ──
test('Bug C T8 — PARITY: router.js + exchange.js normalizeChainKey 行为一致 (双 fn parity guard)', () => {
  // 5/14 Bug C 真因: 双侧 fn 必 sync (5/12 §3.2 只修 router 一侧 + 漏 exchange 一侧 真复发).
  // Tier 2 parity guard: 16 input sample 双 fn 出同 result.
  const cases = ['bsc', 'BSC', 'bep20', 'binance-smart-chain', 'bnb',
    'eth', 'ETH', 'ethereum', 'Ethereum',
    'sol', 'solana', 'SOLANA',
    'polygon', 'arbitrum', 'optimism', 'base'];
  for (const c of cases) {
    assert.strictEqual(fnRouter(c), fnExchange(c), `parity broken for input '${c}'`);
  }
});
