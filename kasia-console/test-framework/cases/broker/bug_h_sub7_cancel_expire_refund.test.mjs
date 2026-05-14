/**
 * Bug H Sub #7 — cancel/expire 真链 refund regression (Owner 12:05 candidate A v2).
 *
 * Scope:
 * - exchange-machine.js _refundEscrow: lookup escrow → route by status (pending_prepay no-tx / active 真链 refund / settled reject)
 * - exchange-machine.js sweepExpiredEscrows: periodic sweep 60s tick for expired pending_prepay + active rows
 * - state-machine.js WAIT_PREPAY 'cancel' → triggerCancelEscrow
 * - router.js _doCancelEscrow: lookup pending escrow + call _refundEscrow + reply user
 * - broker-intake-watcher.js setInterval wires sweepExpiredEscrows (60s with flag check)
 *
 * 跑法: node --test test-framework/cases/broker/bug_h_sub7_cancel_expire_refund.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXCHANGE_MACHINE = readFileSync(join(__dirname, '../../../src/services/exchange-machine.js'), 'utf-8');
const STATE_MACHINE = readFileSync(join(__dirname, '../../../src/services/broker-v3/state-machine.js'), 'utf-8');
const ROUTER = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');
const INTAKE_WATCHER = readFileSync(join(__dirname, '../../../src/services/broker-intake-watcher.js'), 'utf-8');

test('Bug H Sub #7 — _refundEscrow exported async function', () => {
  assert.match(EXCHANGE_MACHINE, /export async function _refundEscrow\(escrowId, reason = 'unspecified'\)/, '_refundEscrow exported');
});

test('Bug H Sub #7 — _refundEscrow idempotent: status=refunded already → return ok+idempotent', () => {
  assert.match(EXCHANGE_MACHINE, /e\.status === 'refunded'[\s\S]+?return \{ ok: true, idempotent: true \}/, 'refunded already → idempotent return');
});

test('Bug H Sub #7 — _refundEscrow reject: status=settled → cannot refund', () => {
  assert.match(EXCHANGE_MACHINE, /e\.status === 'settled'[\s\S]+?already_settled/, 'settled → return error already_settled');
});

test('Bug H Sub #7 — pending_prepay path: UPDATE status=refunded WITHOUT chain TX', () => {
  assert.match(EXCHANGE_MACHINE, /e\.status === 'pending_prepay'[\s\S]+?UPDATE user_escrow_balances[\s\S]+?SET status = 'refunded'[\s\S]+?no_chain_tx: true/, 'pending_prepay → mark refunded, no chain TX');
});

test('Bug H Sub #7 — active path BUY (asset USDT/USDC): refund via transferUsdt', () => {
  assert.match(EXCHANGE_MACHINE, /transferUsdt\(e\.chain, wallet\.privkey_encrypted, e\.user_refund_addr/, 'BUY refund via transferUsdt to user_refund_addr');
});

test('Bug H Sub #7 — active path SELL (asset KAS): refund via broker-action-queue sendKas (R4)', () => {
  assert.match(EXCHANGE_MACHINE, /isKasRefund[\s\S]+?broker-action-queue[\s\S]+?kind:\s*'sendKas'/, 'SELL refund via broker-action-queue sendKas');
});

test('Bug H Sub #7 — UPDATE escrow status active → refunded + refund_tx atomic', () => {
  assert.match(EXCHANGE_MACHINE, /UPDATE user_escrow_balances[\s\S]+?SET status = 'refunded', refund_tx = \?[\s\S]+?WHERE id = \? AND status = 'active'/, 'atomic UPDATE');
});

test('Bug H Sub #7 — cascade cancel offer if status open/matched', () => {
  assert.match(EXCHANGE_MACHINE, /\['open', 'matched'\]\.includes\(offer\.protocol_status\)[\s\S]+?transition\(e\.offer_id, 'cancelled'/, 'cascade cancel offer');
});

test('Bug H Sub #7 — sweepExpiredEscrows exported async function', () => {
  assert.match(EXCHANGE_MACHINE, /export async function sweepExpiredEscrows\(\)/, 'sweepExpiredEscrows exported');
});

test('Bug H Sub #7 — sweep queries pending_prepay + active expired', () => {
  assert.match(EXCHANGE_MACHINE, /WHERE status = 'pending_prepay' AND expires_at < datetime\('now'\)/, 'pending_prepay TTL query');
  assert.match(EXCHANGE_MACHINE, /WHERE status = 'active' AND expires_at < datetime\('now'\)/, 'active TTL query');
});

test('Bug H Sub #7 — sweep calls _refundEscrow with proper reason string', () => {
  assert.match(EXCHANGE_MACHINE, /_refundEscrow\(row\.id, 'pending_prepay_ttl_expired'\)/, 'sweep pending reason');
  assert.match(EXCHANGE_MACHINE, /_refundEscrow\(row\.id, 'active_offer_ttl_expired'\)/, 'sweep active reason');
});

test('Bug H Sub #7 — broker-intake-watcher.js setInterval wires sweepExpiredEscrows (flag-gated)', () => {
  assert.match(INTAKE_WATCHER, /BROKER_V3_ESCROW_MODE === 'true'[\s\S]+?sweepExpiredEscrows\(\)/, 'sweep wired in 60s tick, ESCROW_MODE flag-gated');
});

test('Bug H Sub #7 — state-machine WAIT_PREPAY cancel → triggerCancelEscrow (NOT silent clear)', () => {
  assert.match(STATE_MACHINE, /\/\^\(no\|取消\|cancel\)\$\/i\.test\(msg\)[\s\S]+?triggerCancelEscrow: true/, 'WAIT_PREPAY cancel fires triggerCancelEscrow');
});

test('Bug H Sub #7 — router dispatch handles triggerCancelEscrow → _doCancelEscrow', () => {
  assert.match(ROUTER, /result\.triggerCancelEscrow[\s\S]+?_doCancelEscrow/, 'triggerCancelEscrow → _doCancelEscrow');
});

test('Bug H Sub #7 — _doCancelEscrow function defined in router.js + calls _refundEscrow', () => {
  assert.match(ROUTER, /async function _doCancelEscrow\(peer, draft, prevReply\)/, '_doCancelEscrow defined');
  assert.match(ROUTER, /_refundEscrow.*user_cancel_via_menu/, '_doCancelEscrow calls _refundEscrow with reason');
});
