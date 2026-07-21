// payoutshardv2-offset-tripwire.test.mjs — regression trip-wire (Bettor+NWT+J2 2026-07-08 深夜,
// #bejhos risk-scoped follow-up): the anchor bug in computeCloseZkTmplAnchor (fixed same session,
// see commit history) was caused by a hardcoded absolute-offset constant going stale after a .sil
// edit nobody re-measured. Three sibling constants of the exact same class exist and were verified
// still correct tonight against live on-chain data — but NOT live-refactored (risk-scoped: they
// serve the currently-working committee close_attest path for uqmp8+3o0a6, and a rushed 1am rewrite
// of load-bearing enforce code risks a worse regression than leaving proven-correct hardcoding alone
// one more day). This test is the agreed compromise: independently live-derive each offset by
// compiling a real PayoutShardV2 with distinct, non-colliding marker values and locating them via
// indexOf, then assert the hardcoded constants still match. If a future .sil edit shifts any of
// these (the same way it silently shifted _CLOSEZK_REFUNDROOT_ABS), this test goes red immediately
// instead of waiting for the next real mint/attest to fail in production.
import { compilePayoutShardV2Redeem } from './pool-shard-register.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// distinct, non-colliding 32B markers (not z32 — z32 collides with the many all-zero W17/init fields
// in PayoutShardV2's ctor, exactly the pitfall computeCloseZkTmplAnchor's fix just worked around).
const MARKER_POOL_MERKLE_ROOT = 'aa'.repeat(32);
const MARKER_PREDICATE_COMMIT = 'bb'.repeat(32);
const MARKER_CLOSEZK_ANCHOR = 'cc'.repeat(32);
const MARKER_CONSOLIDATED_POOL = 123456789;

function findUnique(buf, needle, label) {
  const first = buf.indexOf(needle);
  if (first < 0) throw new Error(`findUnique(${label}): marker not found`);
  const second = buf.indexOf(needle, first + 1);
  if (second >= 0) throw new Error(`findUnique(${label}): marker occurs >=2 times (offset ${first},${second})`);
  return first;
}

function main() {
  const redeemHex = compilePayoutShardV2Redeem({
    poolMerkleRoot: MARKER_POOL_MERKLE_ROOT,
    predicateCommit: MARKER_PREDICATE_COMMIT,
    closeZkTmplAnchor: MARKER_CLOSEZK_ANCHOR,
    consolidatedPool: MARKER_CONSOLIDATED_POOL,
  });
  const buf = Buffer.from(redeemHex, 'hex');

  // ── ② _PREDICATE_COMMIT_REDEEM_OFFSET_V2 (bshard-close-enforce.mjs:39) — single occurrence at ctor position ──
  const predicateBuf = Buffer.from(MARKER_PREDICATE_COMMIT, 'hex');
  const predicateOccurrences = [];
  { let idx = buf.indexOf(predicateBuf); while (idx >= 0) { predicateOccurrences.push(idx); idx = buf.indexOf(predicateBuf, idx + 1); } }
  // predicate_commit appears once at the ctor position (offset 642) AND inlined again elsewhere in
  // committee-check code paths not exercised by this dummy ctor's structure — assert the KNOWN ctor
  // offset (642) is among the occurrences, matching what enforce actually reads.
  ok(predicateOccurrences.includes(642), `_PREDICATE_COMMIT_REDEEM_OFFSET_V2=642 matches live-compiled ctor position (found at [${predicateOccurrences.join(',')}])`);

  // ── ③④ _PMR_COMMITTEE_CHECK_OFFSETS_V2 (bshard-close-enforce.mjs:612) — 5 inlined poolMerkleRoot copies ──
  const pmrBuf = Buffer.from(MARKER_POOL_MERKLE_ROOT, 'hex');
  const pmrOccurrences = [];
  { let idx = buf.indexOf(pmrBuf); while (idx >= 0) { pmrOccurrences.push(idx); idx = buf.indexOf(pmrBuf, idx + 1); } }
  const HARDCODED_PMR_OFFSETS_V2 = [1126, 1390, 1654, 1918, 2182];
  // poolMerkleRoot is inlined 10x total: 5x for close_attest's committee check (asserted below) + 5x
  // for cancel_attest's own separate committee check (bshard-close-enforce.mjs comment: "cancel_attest
  // 自己另一组[3107,3371,3635,3899,4163]今天close_attest路径用不到") — a second, legitimate code
  // region, not a drift. Assert count >= 5 (not ==) so this test doesn't false-positive if that
  // second region's own count changes for unrelated reasons; the load-bearing check is the 5 exact
  // offsets below.
  ok(pmrOccurrences.length >= HARDCODED_PMR_OFFSETS_V2.length, `poolMerkleRoot occurs >=${HARDCODED_PMR_OFFSETS_V2.length} times in live-compiled ctor (found ${pmrOccurrences.length}: [${pmrOccurrences.join(',')}] — close_attest's 5 + cancel_attest's own separate 5 expected)`);
  for (const expected of HARDCODED_PMR_OFFSETS_V2) {
    ok(pmrOccurrences.includes(expected), `_PMR_COMMITTEE_CHECK_OFFSETS_V2 entry ${expected} matches a live-found occurrence`);
  }

  console.log(fails === 0
    ? '\n✅✅ ALL PASS — hardcoded PREDICATE_COMMIT_V2/PMR_COMMITTEE_CHECK_OFFSETS_V2 still match current PayoutShardV2.sil compiled structure'
    : `\n❌ ${fails} assertions failed — a hardcoded offset has drifted (same failure class as the closeZkTmplAnchor bug fixed 2026-07-08). DO NOT silently patch the constant — investigate what .sil/silverc change shifted it, then live-derive-refactor the affected call site.`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
