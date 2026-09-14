// committee-offset-derive.test.mjs — regression + negative-vector suite for committee-offset-derive.mjs
// (J2 2026-09-14, ledger 1224/1226/1233/1237/1239). Real v100-pinned compiles for positive paths (no
// mocks — same discipline as the rest of the D-019 work: real compiler, real .sil, real bytes); negative
// vectors use REAL compiled buffers from deliberately-mutated scratch copies of the .sil (not fabricated
// JSON) wherever a real mutation can trigger the path, falling back to the exported white-box
// `_analyzeCompiledBuffer` only for the one invariant no real compile can violate (dispatch_tag vs
// position-order disagreement — see vector N1 below).
// Run: cd kasia-console && node src/lib/committee-offset-derive.test.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  deriveCommitteeCheckOffsets, CHECKED_IN_REFERENCE_OFFSETS, _analyzeCompiledBuffer,
  _ctorV1, _ctorV2, PAYOUT_SHARD_SIL, PAYOUT_SHARD_V2_SIL,
} from './committee-offset-derive.mjs';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from './pool-bshard-artifacts.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const PMR_S = 'aa'.repeat(32), PC_S = '77'.repeat(32);

// ── Positive: real compile, both families ──────────────────────────────────────────────────────
console.log('[test] P1: real derivation, PayoutShardV2 (V2) — matches manually-verified v0.2 appendix data:');
{
  const r = deriveCommitteeCheckOffsets({ isV2: true, pmrSentinelHex: PMR_S, pcSentinelHex: PC_S });
  ok(r.predicateCommitOffset === 16569, `predicateCommitOffset=16569 (got ${r.predicateCommitOffset})`);
  ok(JSON.stringify(r.poolMerkleRootOffsets) === JSON.stringify([17089, 17385, 17681, 17977, 18273]), `poolMerkleRootOffsets matches appendix (got ${JSON.stringify(r.poolMerkleRootOffsets)})`);
  // T-REF-OFFSETS-REFRESH(ledger 1285): checked-in reference just got refreshed to match the current
  // .sil/compiler pin — flip-expect (this session's established discipline): a fresh derivation on the
  // CURRENT files should now agree with the reference, not disagree. If this goes RED again, it means
  // the .sil actually changed since the refresh and the reference needs updating again (WARN-not-block
  // is still the runtime behavior for real markets; this test just checks the reference itself stays in sync).
  ok(r.referenceMismatch === false, `referenceMismatch=false (checked-in reference was just refreshed to match current .sil/pin — got ${r.referenceMismatch})`);
}

console.log('[test] P2: real derivation, PayoutShard (V1):');
{
  const r = deriveCommitteeCheckOffsets({ isV2: false, pmrSentinelHex: PMR_S, pcSentinelHex: PC_S });
  ok(JSON.stringify(r.poolMerkleRootOffsets) === JSON.stringify([16931, 17227, 17523, 17819, 18115]), `poolMerkleRootOffsets matches appendix (got ${JSON.stringify(r.poolMerkleRootOffsets)})`);
  ok(typeof r.predicateCommitOffset === 'number', `predicateCommitOffset derived (got ${r.predicateCommitOffset})`);
}

console.log('[test] P3: cache hit is instant + identical result; different sentinel still agrees (structural, sentinel-value-independent) and does a genuine independent recompute (not a cache hit):');
{
  const r1 = deriveCommitteeCheckOffsets({ isV2: true, pmrSentinelHex: PMR_S, pcSentinelHex: PC_S });
  const t0 = Date.now();
  const r2 = deriveCommitteeCheckOffsets({ isV2: true, pmrSentinelHex: PMR_S, pcSentinelHex: PC_S });
  const dtCacheHit = Date.now() - t0;
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'identical (isV2,sentinels) call returns identical cached result');
  ok(dtCacheHit < 50, `cache hit is near-instant (${dtCacheHit}ms < 50ms — no subprocess spawned)`);
  // Genuinely-fresh, never-before-used sentinel (random per run) — avoids both this module's own
  // in-memory cache AND compileSilV100's disk-level artifact cache (which persists across separate
  // node invocations and would otherwise mask "no subprocess spawned" as a false negative for this
  // timing check if a previous manual/interactive run had already compiled this exact ctor combo).
  const freshPmr = randomBytes(32).toString('hex'), freshPc = randomBytes(32).toString('hex');
  const t1 = Date.now();
  const r3 = deriveCommitteeCheckOffsets({ isV2: true, pmrSentinelHex: freshPmr, pcSentinelHex: freshPc });
  const dtDifferentSentinel = Date.now() - t1;
  ok(JSON.stringify(r3.poolMerkleRootOffsets) === JSON.stringify(r1.poolMerkleRootOffsets) && r3.predicateCommitOffset === r1.predicateCommitOffset, 'different sentinel derives the SAME offsets (structural, value-independent)');
  ok(dtDifferentSentinel > 50, `different (never-before-used) sentinel triggers a genuine independent recompile (${dtDifferentSentinel}ms — cache key includes sentinel, NWT 1237③: no gate reuses another gate's cached result)`);
}

// ── Negative N1: sentinel two-compile position inconsistency (dispatch_tag vs position-order disagree) ──
// No real compiler output can violate this invariant today (declaration order == physical layout order
// has been empirically proven for both families in the v0.2 appendix) — this vector exercises the pure
// cross-check logic directly with a fabricated (but structurally well-formed) buffer/raw pair where the
// two methods are made to disagree on purpose, proving the guard itself is wired correctly and would
// fire if this invariant were ever violated by a future codegen change.
console.log('[test] N1: dispatch_tag-vs-position mismatch (white-box, fabricated disagreement) ⇒ reject:');
{
  // Build a minimal synthetic buffer: [tagA(4B)] [PMR sentinel×3, PUSH32-prefixed] [tagB(4B)] [PMR sentinel×2, PUSH32-prefixed]
  // dispatch_tag ranges say entryA owns the first 3 PMR hits and entryB owns the last 2 — but we ALSO
  // inject one extra PMR hit BEFORE tagA's declared range that position-order would misattribute,
  // by reordering which range name is "close_attest" vs "cancel_attest" so the position-sorted-first-5
  // assumption disagrees with the dispatch_tag assignment.
  const push32 = (hex) => Buffer.concat([Buffer.from([0x20]), Buffer.from(hex, 'hex')]);
  const tagA = Buffer.from('11111111', 'hex'), tagB = Buffer.from('22222222', 'hex');
  const pmr = PMR_S, pc = PC_S;
  // Layout: tagB FIRST (physically), tagA SECOND — but raw.entries lists close_attest=tagA, cancel_attest=tagB.
  // dispatch_tag method: range[tagB..tagA) = cancel_attest (physically first), range[tagA..end) = close_attest.
  // So dispatch_tag says the physically-FIRST 5 PMR copies belong to cancel_attest, not close_attest —
  // this deliberately inverts the "first-5-by-position = close_attest" assumption position-order relies on.
  const buf = Buffer.concat([
    tagB,
    push32(pmr), push32(pmr), push32(pmr), push32(pmr), push32(pmr), // 5 PMR copies here (physically first)
    push32(pc), push32(pc), // 2 predicate_commit copies here
    tagA,
    push32(pmr), push32(pmr), push32(pmr), push32(pmr), push32(pmr), // 5 more PMR copies (physically second)
    push32(pc), push32(pc), // 2 more predicate_commit copies
  ]);
  const raw = { contracts: { Fake: { entries: { close_attest: { dispatch_tag: tagA.toString('hex') }, cancel_attest: { dispatch_tag: tagB.toString('hex') } } } } };
  try {
    _analyzeCompiledBuffer(buf, raw, 'Fake', pmr, pc);
    ok(false, 'should have thrown on dispatch_tag-vs-position disagreement');
  } catch (e) {
    ok(/位置排序法与 dispatch_tag 定界结果不一致/.test(e.message), `correctly rejected with the expected mismatch reason (got: ${e.message.slice(0, 60)}...)`);
  }
}

// ── Negative N2: insufficient copy count (real mutated .sil — one poolMerkleRoot committee-check line removed) ──
console.log('[test] N2: insufficient poolMerkleRoot copy count (real mutated PayoutShardV2.sil, one require() line removed) ⇒ reject:');
{
  const original = readFileSync(PAYOUT_SHARD_V2_SIL, 'utf8');
  const lines = original.split('\n');
  // Line 312 (1-indexed) is `require(c4Cur == poolMerkleRoot);` — the 5th close_attest committee-check.
  // Verified once via direct grep (docs/…committee-offset-live-derive-design-v0.1.md 附录/session notes);
  // re-verify defensively here so this test doesn't silently keep mutating the wrong line if the file
  // ever shifts — assert the line's content before removing it.
  const targetLineIdx = 311; // 0-indexed
  if (!/require\(c4Cur == poolMerkleRoot\);/.test(lines[targetLineIdx])) {
    throw new Error(`N2 fixture assumption broken: PayoutShardV2.sil line 312 is no longer 'require(c4Cur == poolMerkleRoot);' (got: ${lines[targetLineIdx]}) — re-locate the 5th close_attest committee-check line before re-running this test`);
  }
  lines.splice(targetLineIdx, 1);
  const mutatedSil = lines.join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'committee-offset-n2-'));
  const mutatedPath = join(dir, 'PayoutShardV2.missing_one_pmr.sil');
  writeFileSync(mutatedPath, mutatedSil);
  const compiled = compileSilV100(mutatedPath, _ctorV2(PMR_S, PC_S), 'PayoutShardV2');
  const buf = Buffer.from(compiled.script);
  try {
    _analyzeCompiledBuffer(buf, compiled._raw, 'PayoutShardV2', PMR_S, PC_S);
    ok(false, 'should have thrown on insufficient poolMerkleRoot copy count');
  } catch (e) {
    ok(/结构性哨兵命中 9 次/.test(e.message), `correctly rejected with the expected count (got: ${e.message.slice(0, 80)}...)`);
  }
}

// ── Negative N3: binary sha256 mismatch (D-019 pin) ⇒ reject, not silent ────────────────────────
console.log('[test] N3: wrong silverc binary (SILVERC_ZK_PATH, fails D-019 sha256 pin) ⇒ reject, not silent:');
{
  try {
    deriveCommitteeCheckOffsets({ isV2: true, pmrSentinelHex: PMR_S, pcSentinelHex: PC_S, v100Path: 'D:/silverscript/versioned-builds/silverc-zk-8065184.exe' });
    ok(false, 'should have thrown on wrong binary');
  } catch (e) {
    ok(/sha256 不符 D-019 锚点/.test(e.message), `correctly rejected with the expected D-019 pin mismatch reason (got: ${e.message.slice(0, 60)}...)`);
  }
}

// ── Negative N4 (bonus, design-level guard): identical sentinels for PMR/predicate_commit ⇒ reject ──
console.log('[test] N4: identical pmrSentinelHex/pcSentinelHex (would cross-contaminate indexOf) ⇒ reject:');
{
  try {
    deriveCommitteeCheckOffsets({ isV2: true, pmrSentinelHex: PMR_S, pcSentinelHex: PMR_S });
    ok(false, 'should have thrown on identical sentinels');
  } catch (e) {
    ok(/不能相同/.test(e.message), `correctly rejected (got: ${e.message.slice(0, 60)}...)`);
  }
}

// ── P4: ctor int/bytes32 value changes do not shift sentinel offsets (Codex/Bettor 1256/1259/1263) ──
// Made PERMANENT here after a one-off manual probe (docs/2026-09-14-j2-ctor-int-encoding-width-probe-v0.1.md)
// found: PayoutShard.sil/PayoutShardV2.sil serialize every ctor int field via an explicit
// `byte[](8 as byte[1]) + byte[](x as byte[8])` fixed-width cast in their state-splice logic — so
// deriveCommitteeCheckOffsets's placeholder-ctor derivation is safe to apply to ANY real market's real
// ctor values (Bettor 1263 ruled (A), not (B), for these two files — UNLIKE CloseZkV2.sil's `dummyAtMs`,
// a genuinely variable-length field in a DIFFERENT file this module doesn't touch, tracked as a separate
// backlog item). This block turns that one-time finding into a regression guard: if a future .sil edit
// ever drops one of those `as byte[8]` casts, this test goes RED instead of silently letting offsets drift
// out from under every real market's redeem.
console.log('[test] P4: ctor int/bytes32 value changes do not shift sentinel offsets (fixed-width `as byte[8]` state serialization, V1+V2, matrix per Bettor 1256/1263):');
{
  const MATRIX = [0, 1, 255, 256, 2 ** 31, 2 ** 40, -1, Number.MAX_SAFE_INTEGER];
  const w17Ctor = (vals) => vals.map(v => ctorIntV100(v));
  const zeroW17 = Array(17).fill(0);

  function ctorV1({ consolidatedPool = 0, closed = 0, w17 = zeroW17, tokenHex = 'dd'.repeat(32), payoutRootHex = 'ee'.repeat(32), claimHex = 'ff'.repeat(32), marketHex = '11'.repeat(32) } = {}) {
    return [
      ctorBytes32V100(PMR_S), ctorBytes32V100(PC_S), ctorBytes32V100(tokenHex),
      ctorIntV100(consolidatedPool), ctorIntV100(closed), ctorBytes32V100(payoutRootHex),
      ...w17Ctor(w17),
      ctorBytes32V100(claimHex), ctorBytes32V100(marketHex),
    ];
  }
  function ctorV2({ consolidatedPool = 0, attestedWinner = -1, attestedAtMs = 0, w17 = zeroW17, tokenHex = 'dd'.repeat(32), payoutRootHex = 'ee'.repeat(32), claimHex = 'ff'.repeat(32), marketHex = '11'.repeat(32), closeZkHex = 'cc'.repeat(32), betsHex = 'ff'.repeat(32), refundHex = '22'.repeat(32) } = {}) {
    return [
      ctorBytes32V100(PMR_S), ctorBytes32V100(PC_S), ctorBytes32V100(closeZkHex),
      ctorBytes32V100(tokenHex),
      ctorIntV100(consolidatedPool), ctorIntV100(0), ctorBytes32V100(payoutRootHex),
      ...w17Ctor(w17),
      ctorIntV100(attestedWinner), ctorIntV100(attestedAtMs), ctorBytes32V100(betsHex), ctorBytes32V100(refundHex),
      ctorBytes32V100(claimHex), ctorBytes32V100(marketHex),
    ];
  }
  function analyze(silPath, name, ctor) {
    const compiled = compileSilV100(silPath, ctor, name);
    return _analyzeCompiledBuffer(Buffer.from(compiled.script), compiled._raw, name, PMR_S, PC_S);
  }
  const sameOffsets = (a, b) => a.predicateCommitOffset === b.predicateCommitOffset && JSON.stringify(a.poolMerkleRootOffsets) === JSON.stringify(b.poolMerkleRootOffsets);

  const baseV1 = analyze(PAYOUT_SHARD_SIL, 'PayoutShard', ctorV1());
  for (const v of MATRIX) ok(sameOffsets(analyze(PAYOUT_SHARD_SIL, 'PayoutShard', ctorV1({ consolidatedPool: v })), baseV1), `V1 consolidatedPool=${v}: offsets unchanged`);
  for (const v of [0, 1, -1]) ok(sameOffsets(analyze(PAYOUT_SHARD_SIL, 'PayoutShard', ctorV1({ closed: v })), baseV1), `V1 closed=${v}: offsets unchanged`);
  {
    const randW17 = Array.from({ length: 17 }, () => Math.floor(Math.random() * 2 ** 40));
    ok(sameOffsets(analyze(PAYOUT_SHARD_SIL, 'PayoutShard', ctorV1({ w17: randW17 })), baseV1), 'V1 w0..w16=random large ints (today every real caller passes all-zero, but that is not a structural guarantee — assert the offset invariant holds regardless): offsets unchanged');
  }
  {
    const rnd = () => randomBytes(32).toString('hex');
    ok(sameOffsets(analyze(PAYOUT_SHARD_SIL, 'PayoutShard', ctorV1({ tokenHex: rnd(), payoutRootHex: rnd(), claimHex: rnd(), marketHex: rnd() })), baseV1), 'V1 bytes32 fields=random: offsets unchanged');
  }

  const baseV2 = analyze(PAYOUT_SHARD_V2_SIL, 'PayoutShardV2', ctorV2());
  for (const v of MATRIX) ok(sameOffsets(analyze(PAYOUT_SHARD_V2_SIL, 'PayoutShardV2', ctorV2({ consolidatedPool: v })), baseV2), `V2 consolidatedPool=${v}: offsets unchanged`);
  for (const v of [-1, 0, 1]) ok(sameOffsets(analyze(PAYOUT_SHARD_V2_SIL, 'PayoutShardV2', ctorV2({ attestedWinner: v })), baseV2), `V2 attestedWinner=${v}: offsets unchanged`);
  for (const v of [0, 1, 255, 256, 2 ** 31, 2 ** 40, 2 ** 40 + 12345, 2 ** 46]) ok(sameOffsets(analyze(PAYOUT_SHARD_V2_SIL, 'PayoutShardV2', ctorV2({ attestedAtMs: v })), baseV2), `V2 attestedAtMs=${v}: offsets unchanged`);
  {
    const randW17 = Array.from({ length: 17 }, () => Math.floor(Math.random() * 2 ** 40));
    ok(sameOffsets(analyze(PAYOUT_SHARD_V2_SIL, 'PayoutShardV2', ctorV2({ w17: randW17 })), baseV2), 'V2 w0..w16=random large ints: offsets unchanged');
  }
  {
    const rnd = () => randomBytes(32).toString('hex');
    ok(sameOffsets(analyze(PAYOUT_SHARD_V2_SIL, 'PayoutShardV2', ctorV2({ tokenHex: rnd(), payoutRootHex: rnd(), claimHex: rnd(), marketHex: rnd(), closeZkHex: rnd(), betsHex: rnd(), refundHex: rnd() })), baseV2), 'V2 bytes32 fields=random: offsets unchanged');
  }
}

console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
