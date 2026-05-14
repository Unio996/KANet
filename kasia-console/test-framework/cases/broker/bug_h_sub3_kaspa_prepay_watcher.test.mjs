/**
 * Bug H Sub #3 — broker-intake-watcher intakeKaspaEscrowTick regression (Owner 12:05 candidate A v2 SELL flow).
 *
 * Scope: 镜像 Sub #2 BSC watcher 对 KAS — polls kaspa_tx_log for incoming KAS to broker Kasia addr,
 * matches pending_prepay SELL escrow rows by amount (±0.5%), UPDATE escrow + call _doPublishAfterPrepay.
 * ESCROW_MODE off (default) → 直 return.
 *
 * 跑法: node --test test-framework/cases/broker/bug_h_sub3_kaspa_prepay_watcher.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { intakeKaspaEscrowTick, getKaspaEscrowStats } from '../../../src/services/broker-intake-watcher.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WATCHER = readFileSync(join(__dirname, '../../../src/services/broker-intake-watcher.js'), 'utf-8');

test('Bug H Sub #3 — intakeKaspaEscrowTick exported async function', () => {
  assert.strictEqual(typeof intakeKaspaEscrowTick, 'function', 'intakeKaspaEscrowTick must be exported');
});

test('Bug H Sub #3 — ESCROW_MODE off (default) → early return reason=escrow_mode_off', async () => {
  const saved = process.env.BROKER_V3_ESCROW_MODE;
  delete process.env.BROKER_V3_ESCROW_MODE;
  try {
    const r = await intakeKaspaEscrowTick();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'escrow_mode_off');
  } finally {
    if (saved !== undefined) process.env.BROKER_V3_ESCROW_MODE = saved;
  }
});

test('Bug H Sub #3 — startIntakeWatcher() interval calls intakeKaspaEscrowTick (parallel scan with intakeTick)', () => {
  assert.match(WATCHER, /intakeKaspaEscrowTick\(\)/, 'startIntakeWatcher must invoke intakeKaspaEscrowTick');
});

test('Bug H Sub #3 — query pending_prepay WHERE side=sell_kas + chain=kaspa + broker_recv_addr', () => {
  assert.match(WATCHER, /WHERE status = 'pending_prepay'[\s\S]+?side = 'sell_kas'[\s\S]+?chain = 'kaspa'[\s\S]+?broker_recv_addr = \?/, 'query must filter by status + side=sell_kas + chain=kaspa + broker_recv_addr');
});

test('Bug H Sub #3 — kaspa_tx_log scan recent 10 min inbound to broker', () => {
  assert.match(WATCHER, /FROM kaspa_tx_log[\s\S]+?WHERE to_address = \?[\s\S]+?observed_at > datetime\('now', '-10 minutes'\)/, 'must scan kaspa_tx_log with 10-min recent window');
});

test('Bug H Sub #3 — amount match within ±0.5% tolerance (ESCROW_KAS_TOLERANCE_PCT)', () => {
  assert.match(WATCHER, /ESCROW_KAS_TOLERANCE_PCT = 0\.005/, 'KAS tolerance constant 0.005 (±0.5%)');
});

test('Bug H Sub #3 — post-match UPDATE escrow: prepayment_tx + amount_received + user_refund_addr + status=active', () => {
  assert.match(WATCHER, /UPDATE user_escrow_balances[\s\S]+?SET prepayment_tx = \?, amount_received = \?, user_refund_addr = \?, status = 'active'/, 'atomic 4-field UPDATE');
});

test('Bug H Sub #3 — fallback user_refund_addr=user_kasia_addr if from_address NULL (kaspa_tx_log indexer 残留)', () => {
  assert.match(WATCHER, /tx\.from_address \|\| e\.user_kasia_addr/, 'fallback: from_address NULL → use user_kasia_addr (DM sender)');
});

test('Bug H Sub #3 — anti-replay: UNIQUE constraint catch + continue (NOT throw)', () => {
  // Use multiline match since UNIQUE handler spans multiple lines
  assert.match(WATCHER, /UNIQUE constraint failed/, 'UNIQUE constraint check present');
  assert.match(WATCHER, /broker-kaspa-intake-escrow.*already used \(anti-replay\)/, 'anti-replay log');
});

test('Bug H Sub #3 — call _doPublishAfterPrepay post-update', () => {
  assert.match(WATCHER, /_doPublishAfterPrepay\(e\.id, BROKER_RELAY_ID\)/, 'must call _doPublishAfterPrepay');
});

test('Bug H Sub #3 — getKaspaEscrowStats exported', () => {
  assert.strictEqual(typeof getKaspaEscrowStats, 'function');
  const stats = getKaspaEscrowStats();
  assert.ok('ticks' in stats && 'matches' in stats);
});
