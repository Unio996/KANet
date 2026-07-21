// bshard-close-enforce.psv2-read.test.mjs — regression guard for readPayoutShardV2AttestedState
//   (J1tn 2026-07-08, T2b(ii) driver 侧读取路径, 分工见 closezk-v2-mint.mjs 头部注释/COORD-LEDGER 15:53 裁定)。
//
// Round-trip test: build a synthetic pre-attest PayoutShardV2 redeem (closed=0 placeholder state),
// splice in post-attest values via the already-exported _splicePayoutV2CloseRedeem (production splice
// function, not reinvented here), then read them back via readPayoutShardV2AttestedState and assert
// byte-exact equality. Uses DISTINCT sentinel values per field (Bettor 15:59 general policy: identical
// placeholder values make positional/offset bugs invisible to a test that only checks "didn't throw").
//
// Run: cd kasia-console && node src/lib/bshard-close-enforce.psv2-read.test.mjs

import { _splicePayoutV2CloseRedeem, readPayoutShardV2AttestedState } from './bshard-close-enforce.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// ── build a synthetic pre-attest base redeem (state layout: 1B marker ‖ consolidated_pool(9B) ‖
//    closed(9B) ‖ payoutRoot(33B) ‖ w0..w16(17×9B=153B) ‖ attestedWinner(9B) ‖ attestedAtMs(9B) ‖
//    betsRoot(33B) ‖ refundRoot(33B) ‖ suffix). Offsets match bshard-close-enforce.mjs's
//    _PSV2_* constants exactly (289B state region starting at byte 1) — arbitrary filler bytes
//    are fine outside the state region, the splice/read functions never touch them.
const CONSOLIDATED_POOL = 5111000000n; // 51.11 KAS, matches today's real 3o6cs number (not touched by splice)
function pushInt(n) {
  const neg = n < 0n; let mag = neg ? -n : n;
  const b = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) { b[i] = Number(mag & 0xffn); mag >>= 8n; }
  if (neg) b[7] |= 0x80;
  return Buffer.concat([Buffer.from([0x08]), b]);
}
function pushRoot32(hex) { return Buffer.concat([Buffer.from([0x20]), Buffer.from(hex, 'hex')]); }

function buildBaseRedeem() {
  const parts = [
    Buffer.from([0x00]),               // 1B marker before state (offset 0, _PS_STATE_START=1)
    pushInt(CONSOLIDATED_POOL),        // consolidated_pool (untouched by close_attest splice)
    pushInt(0n),                       // closed=0 (pre-attest placeholder)
    pushRoot32('00'.repeat(32)),       // payoutRoot placeholder
    ...Array.from({ length: 17 }, () => pushInt(0n)),  // w0..w16 nullifier, all zero pre-attest
    pushInt(-1n),                      // attestedWinner genesis placeholder (-1, sign-magnitude, matches
                                        // real absorb/genesis convention — not read by our function pre-splice)
    pushInt(0n),                       // attestedAtMs placeholder
    pushRoot32('00'.repeat(32)),       // betsRoot placeholder
    pushRoot32('00'.repeat(32)),       // refundRoot placeholder
    Buffer.from('deadbeef', 'hex'),    // arbitrary suffix bytes (compiled contract tail, irrelevant here)
  ];
  return Buffer.concat(parts).toString('hex');
}

console.log('[test] round-trip: _splicePayoutV2CloseRedeem (write) -> readPayoutShardV2AttestedState (read), distinct sentinels:');
const base = buildBaseRedeem();
const SENT = {
  newPayoutRootHex: '33'.repeat(32),
  newAttestedWinner: 1,
  newBetsRootHex: '11'.repeat(32),
  newRefundRootHex: '22'.repeat(32),
  newAttestedAtMs: 1783413621808,   // real attestedAtMs value from today's close_attest_v2 (0a358fa0)
};
const landed = _splicePayoutV2CloseRedeem(base, SENT);
const read = readPayoutShardV2AttestedState(landed);

ok(read.consolidatedPool === CONSOLIDATED_POOL, `consolidatedPool passthrough byte-exact (${read.consolidatedPool} === ${CONSOLIDATED_POOL})`);
ok(read.closed === 1, `closed read back as 1 (${read.closed})`);
ok(read.attestedWinner === SENT.newAttestedWinner, `attestedWinner byte-exact (${read.attestedWinner} === ${SENT.newAttestedWinner})`);
ok(read.attestedAtMs === SENT.newAttestedAtMs, `attestedAtMs byte-exact, ZERO unit conversion (${read.attestedAtMs} === ${SENT.newAttestedAtMs})`);
ok(read.betsRootHex === SENT.newBetsRootHex, `betsRootHex byte-exact`);
ok(read.refundRootHex === SENT.newRefundRootHex, `refundRootHex byte-exact`);
ok(read.payoutRootHex === SENT.newPayoutRootHex, `payoutRootHex byte-exact`);

console.log('[test] fail-closed guards:');
ok((() => { try { readPayoutShardV2AttestedState(base); return false; } catch (e) { return /closed=0/.test(e.message); } })(),
  'closed!=1 (pre-attest base) throws with clear reason, does not silently return stale/placeholder values');

const outOfBounds = _splicePayoutV2CloseRedeem(base, { ...SENT, newAttestedAtMs: 5 });
ok((() => { try { readPayoutShardV2AttestedState(outOfBounds); return false; } catch (e) { return /越界/.test(e.message); } })(),
  'attestedAtMs out of [2^40,2^47) bounds throws (same guard as W2 committee-side check), not silently passed through');

const badWinner = _splicePayoutV2CloseRedeem(base, { ...SENT, newAttestedWinner: 7 });
ok((() => { try { readPayoutShardV2AttestedState(badWinner); return false; } catch (e) { return /不是 0\/1/.test(e.message); } })(),
  'attestedWinner outside {0,1} throws (offset-misalignment tripwire), not silently passed through');

ok((() => { try { readPayoutShardV2AttestedState('ab'.repeat(50)); return false; } catch (e) { return /太短/.test(e.message); } })(),
  'undersized redeem hex throws with clear reason instead of reading garbage/out-of-range bytes');

console.log(fails === 0
  ? '\n✅✅ ALL PASS — readPayoutShardV2AttestedState round-trips byte-exact against the production splice function, zero unit conversion, fail-closed on malformed input'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
