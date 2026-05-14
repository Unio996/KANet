/**
 * Sub Tier-2 — Bug D chain list functional regression (NWT 11:18 backlog ack).
 *
 * NWT 5/14 11:04 audit gap 1 + KI 第 N 次复刻补丁漏一片: Bug D source-pattern test (Tier 1)
 * verifies chains array has 6 entries, but doesn't verify run-time behavior — user input
 * '5' / '6' truly transitions state with correct chain.
 *
 * 真补 audit doc final sign #4 (NWT 11:16 backlog item).
 *
 * 跑法: node --test test-framework/cases/broker/bug_d_chain_list_functional.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  processInput, setFlowState, getFlowState, clearFlowState,
  SUPPORTED_CHAINS, _testReset,
} from '../../../src/services/broker-v3/state-machine.js';

const PEER = 'kaspa:qtest_bug_d_func';
const RELAY = 'test-relay-id';

function resetPeer() { clearFlowState(PEER); _testReset(); }

// ── T1: ACCEPT_OFFER CHAIN_SELECT input '1' → BSC ──
test('Bug D T1 — ACCEPT CHAIN_SELECT input "1" → draft.selected_chain="bsc" + triggerAccept', async () => {
  resetPeer();
  setFlowState(PEER, { flow: 'ACCEPT_OFFER', step: 'CHAIN_SELECT', draft: { offer_id: 'test-offer-1' } });
  const r = await processInput(PEER, '1', RELAY);
  assert.match(r.reply, /选 BSC 支付/);
  // CHAIN_SELECT advances to CONFIRM with selected_chain on draft
  const st = getFlowState(PEER);
  assert.strictEqual(st.step, 'CONFIRM');
  assert.strictEqual(st.draft.selected_chain, 'bsc');
});

// ── T2-T6: all 6 chains accept correctly ──
test('Bug D T2 — input "2" → ETH', async () => {
  resetPeer();
  setFlowState(PEER, { flow: 'ACCEPT_OFFER', step: 'CHAIN_SELECT', draft: { offer_id: 'x' } });
  const r = await processInput(PEER, '2', RELAY);
  assert.match(r.reply, /选 ETH 支付/);
  assert.strictEqual(getFlowState(PEER).draft.selected_chain, 'eth');
});

test('Bug D T3 — input "3" → POLYGON', async () => {
  resetPeer();
  setFlowState(PEER, { flow: 'ACCEPT_OFFER', step: 'CHAIN_SELECT', draft: { offer_id: 'x' } });
  const r = await processInput(PEER, '3', RELAY);
  assert.match(r.reply, /选 POLYGON 支付/);
  assert.strictEqual(getFlowState(PEER).draft.selected_chain, 'polygon');
});

test('Bug D T4 — input "4" → ARBITRUM', async () => {
  resetPeer();
  setFlowState(PEER, { flow: 'ACCEPT_OFFER', step: 'CHAIN_SELECT', draft: { offer_id: 'x' } });
  const r = await processInput(PEER, '4', RELAY);
  assert.match(r.reply, /选 ARBITRUM 支付/);
  assert.strictEqual(getFlowState(PEER).draft.selected_chain, 'arbitrum');
});

// ── T5 + T6: 5/6 chain — Bug D 真治根 verify (pre-fix 'out of range') ──
test('Bug D T5 — input "5" → OPTIMISM (Bug D 真治根 verify, pre-fix rejected as "回 1-4")', async () => {
  resetPeer();
  setFlowState(PEER, { flow: 'ACCEPT_OFFER', step: 'CHAIN_SELECT', draft: { offer_id: 'x' } });
  const r = await processInput(PEER, '5', RELAY);
  assert.match(r.reply, /选 OPTIMISM 支付/);
  assert.strictEqual(getFlowState(PEER).draft.selected_chain, 'optimism');
});

test('Bug D T6 — input "6" → BASE (Bug D 真治根 verify, pre-fix rejected)', async () => {
  resetPeer();
  setFlowState(PEER, { flow: 'ACCEPT_OFFER', step: 'CHAIN_SELECT', draft: { offer_id: 'x' } });
  const r = await processInput(PEER, '6', RELAY);
  assert.match(r.reply, /选 BASE 支付/);
  assert.strictEqual(getFlowState(PEER).draft.selected_chain, 'base');
});

// ── T7: invalid '7' → 'out of range' (Bug-D-residual hint dynamic verify) ──
test('Bug D T7 — input "7" out of range → "回 1-6 选链" (dynamic, NOT hardcoded "1-4")', async () => {
  resetPeer();
  setFlowState(PEER, { flow: 'ACCEPT_OFFER', step: 'CHAIN_SELECT', draft: { offer_id: 'x' } });
  const r = await processInput(PEER, '7', RELAY);
  assert.match(r.reply, /回 1-6 选链/, 'must use dynamic SUPPORTED_CHAINS.length=6 (Bug-D-residual verify)');
  // State should NOT advance — still CHAIN_SELECT
  assert.strictEqual(getFlowState(PEER).step, 'CHAIN_SELECT');
  assert.strictEqual(getFlowState(PEER).draft.selected_chain, undefined);
});

// ── T8: SUPPORTED_CHAINS const integrity ──
test('Bug D T8 — SUPPORTED_CHAINS array length === 6 + correct order', () => {
  assert.strictEqual(SUPPORTED_CHAINS.length, 6);
  assert.deepStrictEqual(SUPPORTED_CHAINS, ['bsc', 'eth', 'polygon', 'arbitrum', 'optimism', 'base']);
});
