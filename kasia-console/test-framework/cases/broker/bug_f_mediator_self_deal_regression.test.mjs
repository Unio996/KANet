/**
 * Bug F — broker-v3 mediator self-deal false-positive regression (NWT 10:53 选 A propose).
 *
 * 5/14 J2 cross-verify C4.4 surface: broker-v3 router._doAccept 旧 pass `relayNodeId=broker (Trader-B)`
 * 到 client.acceptOffer → server takerAddr = broker addr → maker (broker-as-maker) === taker → 拒.
 * 双 path 不一致: API reject 但 broadcast 已上链 → exchange-machine.transition 用 payload taker
 * (J2 metadata.user_id) → DB 'verifying' state with orphan taker addr.
 *
 * 修 (NWT 10:53 选 A): router._doAccept peer 反查 relay_nodes WHERE address=peer 得 user relay id,
 * 传 acceptOffer with relayNodeId=takerRelayId (user 而非 broker). user 无 local relay 时 explicit
 * error (broker 无法代签 chain TX, fallback 之前 silent self-deal 不安全).
 *
 * 跑法: node --test test-framework/cases/broker/bug_f_mediator_self_deal_regression.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTER_JS = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');

test('Bug F — _doAccept peer 反查 relay_nodes WHERE address=peer', () => {
  assert.match(ROUTER_JS, /SELECT id FROM relay_nodes WHERE address = \?/, '_doAccept must SELECT relay_nodes by address');
  assert.match(ROUTER_JS, /\.get\(peer\)/, '_doAccept must .get(peer) to find user relay');
});

test('Bug F — _doAccept 用 takerRelayId 传 acceptOffer (NOT broker relayNodeId)', () => {
  // Match the acceptOffer call inside _doAccept block, verify relayNodeId param is takerRelayId
  const doAcceptBlock = ROUTER_JS.match(/async function _doAccept[\s\S]+?\n\}/);
  assert.ok(doAcceptBlock, '_doAccept block found');
  assert.match(doAcceptBlock[0], /acceptOffer\(\{\s*\n?\s*relayNodeId:\s*takerRelayId/, 'acceptOffer must use takerRelayId (not raw relayNodeId)');
});

test('Bug F — user without local relay returns explicit error (NOT silent fallback)', () => {
  const doAcceptBlock = ROUTER_JS.match(/async function _doAccept[\s\S]+?\n\}/);
  assert.match(doAcceptBlock[0], /if \(!takerRelayId\)/, '_doAccept must check missing takerRelayId');
  assert.match(doAcceptBlock[0], /你需在本节点有 relay 才能通过 broker 接单/, 'must explicit error to user (NOT silent self-deal fallback)');
});

test('Bug F — old self-deal trigger pattern (relayNodeId raw in acceptOffer) NOT present', () => {
  // Pre-fix code: `acceptOffer({ relayNodeId, offer_id: ... })` with broker's relayNodeId.
  // Post-fix: only `relayNodeId: takerRelayId` should appear inside _doAccept.
  const doAcceptBlock = ROUTER_JS.match(/async function _doAccept[\s\S]+?\n\}/);
  // Negative check: shouldn't have `{ relayNodeId, offer_id` (raw param passthrough)
  assert.doesNotMatch(doAcceptBlock[0], /acceptOffer\(\{\s*\n?\s*relayNodeId,\s*offer_id/, 'must NOT use raw relayNodeId param (Bug F regression)');
});

test('Bug F — clears flow state on error path (UX safety)', () => {
  const doAcceptBlock = ROUTER_JS.match(/async function _doAccept[\s\S]+?\n\}/);
  // Both error paths (no takerRelayId + acceptOffer fail) must clearFlowState
  const errorPathCount = (doAcceptBlock[0].match(/stateMachine\.clearFlowState\(peer\)/g) || []).length;
  assert.ok(errorPathCount >= 2, `clearFlowState should be called on multiple error paths (found ${errorPathCount})`);
});
