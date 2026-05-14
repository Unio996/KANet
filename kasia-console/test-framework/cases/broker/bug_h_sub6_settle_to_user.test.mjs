/**
 * Bug H Sub #6 — exchange-machine matched → settle 真 deliver to user_target_addr (Owner 12:05 candidate A v2).
 *
 * Post-completed transition for escrow-backed offer (meta.escrow_id 存):
 * - BUY escrow: broker 真链 send KAS to user kasia addr via broker-action-queue
 * - SELL escrow: broker 真链 transferUsdt to user EVM addr
 * - UPDATE user_escrow_balances status='active' → 'settled' + settle_tx
 *
 * 跑法: node --test test-framework/cases/broker/bug_h_sub6_settle_to_user.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXCHANGE_MACHINE = readFileSync(join(__dirname, '../../../src/services/exchange-machine.js'), 'utf-8');

test('Bug H Sub #6 — _settleEscrowToUser function defined', () => {
  assert.match(EXCHANGE_MACHINE, /async function _settleEscrowToUser\(escrowId, offerId\)/, '_settleEscrowToUser async function defined');
});

test('Bug H Sub #6 — escrow detection: metadata.source=broker-v3-escrow OR meta.escrow_id', () => {
  assert.match(EXCHANGE_MACHINE, /broker-v3-escrow.*\|\|.*meta\.escrow_id/, 'escrow detection via metadata.source OR meta.escrow_id');
});

test('Bug H Sub #6 — post-completed hook fires _settleEscrowToUser via setImmediate', () => {
  assert.match(EXCHANGE_MACHINE, /setImmediate\(\(\) => \{\s*_settleEscrowToUser\(meta\.escrow_id, finalOffer\.id\)/, 'setImmediate _settleEscrowToUser call');
});

test('Bug H Sub #6 — idempotent guard: skip if escrow status !== active', () => {
  assert.match(EXCHANGE_MACHINE, /if \(e\.status !== 'active'\) \{[\s\S]*?skip \(idempotent\)/, 'status != active → skip with idempotent log');
});

test('Bug H Sub #6 — BUY (target_asset=KAS) routes through broker-action-queue sendKas (R4 single-pump)', () => {
  assert.match(EXCHANGE_MACHINE, /isKas[\s\S]+?broker-action-queue[\s\S]+?kind:\s*'sendKas'/, 'BUY escrow uses broker-action-queue sendKas');
});

test('Bug H Sub #6 — SELL (target_asset=USDT/USDC) routes through transferUsdt', () => {
  assert.match(EXCHANGE_MACHINE, /transferUsdt\(e\.target_chain, wallet\.privkey_encrypted, e\.user_target_addr/, 'SELL escrow uses transferUsdt with broker EVM key');
});

test('Bug H Sub #6 — UPDATE escrow status active → settled + settle_tx atomic', () => {
  assert.match(EXCHANGE_MACHINE, /UPDATE user_escrow_balances[\s\S]+?SET status = 'settled', settle_tx = \?/, 'UPDATE status settled + settle_tx');
});

test('Bug H Sub #6 — guards: escrow row not found / no user_target_addr / no broker relay → log + return', () => {
  assert.match(EXCHANGE_MACHINE, /escrow row \$\{escrowId\} not found/, 'guard escrow not found');
  assert.match(EXCHANGE_MACHINE, /无 user_target_addr/, 'guard no user_target_addr');
  assert.match(EXCHANGE_MACHINE, /no broker relay for maker/, 'guard no broker relay');
});

test('Bug H Sub #6 — settle err catch + log (does NOT throw past setImmediate boundary)', () => {
  assert.match(EXCHANGE_MACHINE, /\[exchange-escrow-settle\] settle err for escrow/, 'catch + log settle err');
});
