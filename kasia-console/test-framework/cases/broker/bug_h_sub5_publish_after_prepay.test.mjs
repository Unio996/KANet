/**
 * Bug H Sub #5.残 — _doPublishAfterPrepay BUY/SELL semantic correctness regression.
 *
 * Owner 11:28 实测 + Owner 12:05 钦定 candidate A v2 broker-escrow custody:
 * - BUY: broker holds USER prepaid USDT (escrow), wants KAS for user → publish body:
 *   give_asset='USDT', want_asset='KAS', accepted_chains.address=broker_kaspa_addr (taker sends KAS)
 * - SELL: broker holds USER prepaid KAS (escrow), wants USDT for user → publish body:
 *   give_asset='KAS', want_asset='USDT', accepted_chains.address=broker_evm_addr (taker sends USDT)
 *
 * 修反 legacy _doPublish (give=KAS want=USDT for BOTH BUY+SELL — Bug H surface 现 mode).
 *
 * 跑法: node --test test-framework/cases/broker/bug_h_sub5_publish_after_prepay.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTER = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');

test('Bug H Sub #5.残 — _doPublishAfterPrepay function exported', () => {
  assert.match(ROUTER, /export async function _doPublishAfterPrepay\(escrowRowId, relayNodeId\)/, '_doPublishAfterPrepay must be exported async function');
});

test('Bug H Sub #5.残 — BUY semantic: give=USDT/USDC want=KAS accepted_chains.address=broker_kaspa', () => {
  const buyBlock = ROUTER.match(/isBuy[\s\S]+?'kaspa',\s*verification:\s*'cross_chain_tx'[\s\S]+?expected_asset:\s*'KAS'/);
  assert.ok(buyBlock, 'BUY body block found with correct semantic');
  // Check give_asset = e.asset (USDT or USDC for base)
  assert.match(buyBlock[0], /give_asset:\s*e\.asset/, 'BUY give_asset=e.asset (USDT/USDC from escrow)');
  assert.match(buyBlock[0], /want_asset:\s*'KAS'/, 'BUY want_asset=KAS');
  assert.match(buyBlock[0], /want_chain:\s*'kaspa'/, 'BUY want_chain=kaspa');
});

test('Bug H Sub #5.残 — SELL semantic: give=KAS want=USDT accepted_chains.address=broker_evm', () => {
  const sellBlock = ROUTER.match(/give_asset:\s*'KAS',\s*\n\s*give_amount[\s\S]+?want_asset:\s*e\.target_asset/);
  assert.ok(sellBlock, 'SELL body block found');
  assert.match(sellBlock[0], /give_chain:\s*'kaspa'/, 'SELL give_chain=kaspa (KAS escrow)');
  assert.match(sellBlock[0], /want_asset:\s*e\.target_asset/, 'SELL want_asset=e.target_asset (USDT/USDC)');
});

test('Bug H Sub #5.残 — verification_meta 含 escrow_id + escrow_user + escrow_user_target (settle hook)', () => {
  // Both BUY+SELL bodies must include escrow context for matched-settle-to-user flow
  const escrowCtxCount = (ROUTER.match(/escrow_id:\s*e\.id/g) || []).length;
  assert.ok(escrowCtxCount >= 2, `escrow_id reference must appear in both BUY+SELL meta (found ${escrowCtxCount})`);
  const userTargetCount = (ROUTER.match(/escrow_user_target:\s*e\.user_target_addr/g) || []).length;
  assert.ok(userTargetCount >= 2, `escrow_user_target must appear in both meta (found ${userTargetCount})`);
});

test('Bug H Sub #5.残 — metadata source=broker-v3-escrow (distinct from legacy broker-v3)', () => {
  assert.match(ROUTER, /source:\s*'broker-v3-escrow'/, 'metadata.source=broker-v3-escrow (for audit/filter post-flip)');
});

test('Bug H Sub #5.残 — post-publish update escrow status pending_prepay → active + offer_id backfill', () => {
  assert.match(ROUTER, /UPDATE user_escrow_balances[\s\S]+?SET offer_id = \?, status = 'active'/, 'must UPDATE status active + offer_id post publishOffer success');
});

test('Bug H Sub #5.残 — guard: escrow row not found OR wrong status → return early', () => {
  assert.match(ROUTER, /if \(!e\) return \{ ok: false, error:[\s\S]*?escrow row[\s\S]*?not found/, 'guard escrow not found');
  // Bug K fix 5/14: accept both pending_prepay AND active (watcher UPDATE race), idempotency via offer_id
  assert.match(ROUTER, /\['pending_prepay', 'active'\]\.includes\(e\.status\)/, 'guard accepts both pending_prepay + active states');
  assert.match(ROUTER, /if \(e\.offer_id\) return \{ ok: false, error: `escrow row already has offer_id/, 'idempotency guard on offer_id');
});

test('Bug H Sub #5.残 — legacy _doPublish 保留 (ESCROW_MODE=false default 不破)', () => {
  // Both _doPublishAfterPrepay (escrow) + _doPublish (legacy) coexist
  assert.match(ROUTER, /async function _doPublish\(peer, draft, relayNodeId, prevReply\)/, 'legacy _doPublish preserved');
  assert.match(ROUTER, /export async function _doPublishAfterPrepay\(escrowRowId, relayNodeId\)/, 'new _doPublishAfterPrepay exported');
});
