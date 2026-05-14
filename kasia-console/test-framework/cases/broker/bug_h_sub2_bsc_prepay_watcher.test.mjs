/**
 * Bug H Sub #2 — broker-bsc-intake-watcher tickEscrow regression (Owner 12:05 candidate A v2).
 *
 * Scope: 扫 user_escrow_balances pending_prepay rows, match incoming BSC USDT TX by amount (±0.5%),
 * UPDATE escrow row (prepayment_tx + amount_received + user_refund_addr) + call _doPublishAfterPrepay.
 * ESCROW_MODE off (default) → 直 return.
 *
 * 跑法: node --test test-framework/cases/broker/bug_h_sub2_bsc_prepay_watcher.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tickEscrow, getEscrowStats } from '../../../src/services/broker-bsc-intake-watcher.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WATCHER = readFileSync(join(__dirname, '../../../src/services/broker-bsc-intake-watcher.js'), 'utf-8');

test('Bug H Sub #2 — tickEscrow exported async function', () => {
  assert.strictEqual(typeof tickEscrow, 'function', 'tickEscrow must be exported function');
});

test('Bug H Sub #2 — ESCROW_MODE off (default) → tickEscrow returns reason=escrow_mode_off', async () => {
  // ensure no env override
  const saved = process.env.BROKER_V3_ESCROW_MODE;
  delete process.env.BROKER_V3_ESCROW_MODE;
  try {
    const r = await tickEscrow();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'escrow_mode_off', 'tickEscrow must early-return when flag off');
  } finally {
    if (saved !== undefined) process.env.BROKER_V3_ESCROW_MODE = saved;
  }
});

test('Bug H Sub #2 — start() interval calls BOTH tick + tickEscrow (parallel scan)', () => {
  assert.match(WATCHER, /tick\(\)\.catch[\s\S]+?tickEscrow\(\)\.catch/, 'start() setInterval must invoke both tick() and tickEscrow()');
});

test('Bug H Sub #2 — tickEscrow query pending_prepay WHERE side=buy_kas + chain=bnb + broker_recv_addr', () => {
  assert.match(WATCHER, /WHERE status = 'pending_prepay'[\s\S]+?side = 'buy_kas'[\s\S]+?chain = 'bnb'[\s\S]+?broker_recv_addr = \?/, 'query must filter by status + side + chain + broker_recv_addr');
});

test('Bug H Sub #2 — amount match within ±0.5% tolerance (ESCROW_AMOUNT_TOLERANCE_PCT)', () => {
  assert.match(WATCHER, /ESCROW_AMOUNT_TOLERANCE_PCT = 0\.005/, 'tolerance constant must be 0.005 (±0.5%)');
  assert.match(WATCHER, /Math\.abs\(t\.amount - expectedAmount\) \/ expectedAmount <= ESCROW_AMOUNT_TOLERANCE_PCT/, 'amount match formula must use ESCROW_AMOUNT_TOLERANCE_PCT');
});

test('Bug H Sub #2 — post-match UPDATE escrow: prepayment_tx + amount_received + user_refund_addr + status=active', () => {
  assert.match(WATCHER, /UPDATE user_escrow_balances[\s\S]+?SET prepayment_tx = \?, amount_received = \?, user_refund_addr = \?, status = 'active'/, 'UPDATE must set 4 fields atomically');
});

test('Bug H Sub #2 — anti-replay: UNIQUE constraint catch + continue (NOT throw)', () => {
  assert.match(WATCHER, /UNIQUE constraint failed/, 'catch UNIQUE constraint failure');
  assert.match(WATCHER, /already used \(anti-replay\)/, 'log anti-replay message');
});

test('Bug H Sub #2 — call _doPublishAfterPrepay post-update', () => {
  assert.match(WATCHER, /_doPublishAfterPrepay/, 'must call _doPublishAfterPrepay');
  assert.match(WATCHER, /import\(.*broker-v3\/router\.js/, 'must dynamic import router.js for _doPublishAfterPrepay');
});

test('Bug H Sub #2 — getEscrowStats exported', () => {
  assert.strictEqual(typeof getEscrowStats, 'function', 'getEscrowStats exported');
  const stats = getEscrowStats();
  assert.ok('ticks' in stats && 'matches' in stats, 'stats must have ticks + matches');
});
