/**
 * Bug H γ 6 iter race regression — Tier 2 source-test cover Bug K/L/M/N/O/P + R
 *
 * Phase 1 RE 7 case per NWT 02:43 (5/15) verdict 钦定 post Bug S+T PASS.
 *
 * 6 iter race fixes (Bug K-P 5/14 + Bug R 5/14) 全 deterministic source-level invariants.
 * NWT 不 Tier 4 测 (broker side effect 限), J2 ship Tier 2 source-test, NWT audit + verify.
 *
 * 跑法: node --test test-framework/cases/broker/bug_h_iter_k_r_race_regression.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTER = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');
const BSC_WATCHER = readFileSync(join(__dirname, '../../../src/services/broker-bsc-intake-watcher.js'), 'utf-8');
const EX_MACHINE = readFileSync(join(__dirname, '../../../src/services/exchange-machine.js'), 'utf-8');

test('Bug K regression — _doPublishAfterPrepay guard accepts pending_prepay + active (watcher race)', () => {
  // Bug K: watcher UPDATE status='active' before _doPublishAfterPrepay → publish guard reject.
  // Fix: guard accept ['pending_prepay', 'active'], idempotency gate on offer_id.
  assert.match(ROUTER, /\['pending_prepay', 'active'\]\.includes\(e\.status\)/,
    'guard must accept BOTH pending_prepay + active states');
  assert.match(ROUTER, /if \(e\.offer_id\) return \{ ok: false, error: `escrow row already has offer_id/,
    'idempotency must gate on offer_id (not on status alone)');
});

test('Bug L regression — watcher retry query covers active+offer_id IS NULL', () => {
  // Bug L: status='active' rows (Bug K race: prepay UPDATE succeeded but publish failed) not picked up.
  // Fix: query WHERE (status='pending_prepay' OR (status='active' AND offer_id IS NULL)).
  assert.match(BSC_WATCHER, /status\s*=\s*'pending_prepay'\s*OR\s*\(status\s*=\s*'active'\s*AND\s*offer_id\s*IS\s*NULL\)/,
    'pending escrow query must include active+offer_id-NULL retry path');
});

test('Bug M regression — UPDATE user_refund_addr from tx.from (cross-chain-verify event field)', () => {
  // Bug M: tx.sender / tx.from_address wrong → 'unknown' refund addr. cross-chain-verify scanRecentTransfers
  // emits event.from. Fix: use tx.from || null, NOT tx.sender / tx.from_address / user_kasia_addr fallback.
  assert.match(BSC_WATCHER, /user_refund_addr\s*=\s*\?[\s\S]{0,500}?tx\.tx_hash[^,]*,\s*String\(tx\.amount\),\s*tx\.from\s*\|\|\s*null/,
    'UPDATE user_refund_addr must use tx.from (not tx.sender / tx.from_address)');
  // Negative assertion: tx.sender / tx.from_address must not be used as refund source
  assert.doesNotMatch(BSC_WATCHER, /user_refund_addr\s*[=:]\s*[^,\n]*tx\.sender/,
    'tx.sender must NOT be referenced for refund addr');
  assert.doesNotMatch(BSC_WATCHER, /user_refund_addr\s*[=:]\s*[^,\n]*tx\.from_address/,
    'tx.from_address must NOT be referenced for refund addr');
});

test('Bug N regression — BUY publish give_amount = USDT escrow amount (not target_amount KAS)', () => {
  // Bug N: BUY body had give_amount=target_amount (50 KAS) but give_asset=USDT → broker balance check
  // saw 50 USDT request → fail. Fix: give_amount = e.amount_received || e.amount_quoted (真 USDT escrowed).
  assert.match(ROUTER, /give_amount:\s*String\(e\.amount_received\s*\|\|\s*e\.amount_quoted\)[^,]*,?\s*\/\/\s*真 USDT escrow amount/,
    'BUY give_amount must be amount_received||amount_quoted (USDT), NOT e.target_amount (KAS)');
});

test('Bug O regression — pending_prepay → active extends expires_at to +30 minutes', () => {
  // Bug O: 5min pending_prepay TTL too short for publish retry post-prepay. Fix: extend to +30 min on active.
  assert.match(BSC_WATCHER, /UPDATE user_escrow_balances[\s\S]+?status\s*=\s*'active'[\s\S]+?expires_at\s*=\s*datetime\('now',\s*'\+30 minutes'\)/,
    'pending→active UPDATE must extend expires_at to +30 minutes (active offer TTL, not 5min quote TTL)');
});

test("Bug P regression — no // comment inside SQL template literal (parser-breaking)", () => {
  // Bug P: 3 times placed // comment inside SQL template literal causing parser break.
  // Negative invariant: no `//` line comment between any backtick-quoted SQL block in broker watchers.
  // Heuristic: scan each template literal in BSC_WATCHER + EX_MACHINE for // line-comment occurrence.
  const checkFile = (label, src) => {
    const templates = src.match(/`[^`]*`/gms) || [];
    for (const tpl of templates) {
      // SQL template heuristic: starts within whitespace and contains UPDATE/SELECT/INSERT/DELETE keyword.
      if (!/\b(UPDATE|SELECT|INSERT|DELETE|CREATE)\b/i.test(tpl)) continue;
      // Allow `--` SQL line comment, but block `//` JS-style.
      assert.ok(!/\n\s*\/\/[^\n]*\n/.test(tpl),
        `${label} contains // line comment inside SQL template literal (Bug P parser break risk): ${tpl.slice(0, 80)}...`);
    }
  };
  checkFile('broker-bsc-intake-watcher.js', BSC_WATCHER);
  checkFile('exchange-machine.js', EX_MACHINE);
});

test('Bug R regression — BUY kaspa_tx short-circuit also fires _settleEscrowToUser hook', () => {
  // Bug R: BUY completed via kaspa_tx short-circuit RETURNed before L1352 main settle hook,
  // so escrow_user_target never received KAS. Fix: same setImmediate _settleEscrowToUser hook
  // inside short-circuit branch (mirror L1352 path).
  // Verify (1) short-circuit branch has isEscrow + escrow_id + escrow_user_target check
  assert.match(EX_MACHINE, /Bug R 5\/14 fix[\s\S]{0,400}?const isEscrow\s*=[\s\S]{0,200}?meta\.escrow_id/,
    'Bug R fix comment + isEscrow check present in short-circuit branch');
  // Verify (2) setImmediate(() => { _settleEscrowToUser(...) }) called inside short-circuit
  assert.match(EX_MACHINE, /Bug R[\s\S]{0,800}?setImmediate\(\(\)\s*=>\s*\{\s*_settleEscrowToUser\(meta\.escrow_id,\s*finalOffer\.id\)/,
    'short-circuit branch must call setImmediate(_settleEscrowToUser(escrow_id, offer.id))');
  // Verify (3) two _settleEscrowToUser hook sites total (one short-circuit + one main path)
  const hookCount = (EX_MACHINE.match(/_settleEscrowToUser\(meta\.escrow_id/g) || []).length;
  assert.ok(hookCount >= 2, `_settleEscrowToUser must be invoked from BOTH short-circuit + main path (found ${hookCount})`);
});
