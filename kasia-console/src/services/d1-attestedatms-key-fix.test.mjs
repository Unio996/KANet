// d1-attestedatms-key-fix.test.mjs — regression guard for the fee-input-churn deadlock
// (Bettor+NWT 2026-07-08 23:2x, #ba7z2c/#ba8vcr): payout_root alone is a deterministic function of
// (committee, bets, winner, fees) — it can stay IDENTICAL across two propose rounds that differ only
// in the fee input (e.g. a splitter consumed the old fee UTXO). D1 dedup and collectCloseSigsV2 used
// to match on payout_root only, so a re-propose with a fresh fee input would (a) have voters silently
// skip re-signing ("already signed this root") and (b) let submit collect the OLD round's signatures
// and staple them onto the NEW transaction image — which fails on-chain (SighashType.All covers the
// fee input's outpoint too). Fixed by widening the match key to (root, attestedAtMs).
import { sqlite } from '../db/client.js';
import { collectCloseSigsV2 } from '../lib/bshard-close-transport.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const MARKET_ID = `TEST_MKT_${Math.random().toString(36).slice(2)}`;
const ROOT = 'deadbeef'.repeat(8); // 64-hex, same root reused across "rounds" — the whole point of the test
const ROUND_A_MS = 1783465981208; // old round
const ROUND_B_MS = 1783466801925; // new round, same root, different fee input

function insertSig(pk, attestedAtMs) {
  const txid = `${MARKET_ID}:sig:${pk}:${attestedAtMs}`;
  const payload = JSON.stringify({ t: 'bshard_close_sig_v2', market_id: MARKET_ID, committee_pk: pk, payout_root: ROOT, signature: 'sig_' + pk, attestedAtMs });
  sqlite.prepare(`INSERT OR IGNORE INTO chain_events (txid, from_address, event_type, payload, observed_by, observed_at, is_public) VALUES (?, ?, 'bshard_close_sig_v2', ?, ?, ?, 1)`)
    .run(txid, 'addr_' + pk, payload, pk, new Date().toISOString());
}

function main() {
  // 🔴 offline-test 铁律 (Bettor 2026-07-08 23:4x catch): 这份测试用的是生产 db/client.js 单例(跟今晚其它
  // "用实实DB实实schema"测试同款, 那是刻意的——但 cleanup 必须 try/finally 保证【无论断言/异常】都执行,
  // 否则一次崩溃(今晚第一次跑就崩过, 列名打错)会把哨兵行(pkA..pkE)永久留在生产 chain_events 里,
  // 污染以后任何按 txid LIKE / market_id 的查询。这是最小闭合修复(不是换 in-memory db, 那需要给
  // collectCloseSigsV2 加 db 注入参数, 更大改动, 明天再评估要不要做)。
  try {
    // round A: 3 committee members sign the old image.
    insertSig('pkA', ROUND_A_MS);
    insertSig('pkB', ROUND_A_MS);
    insertSig('pkC', ROUND_A_MS);

    // scoped by (root, attestedAtMs=ROUND_A_MS): finds exactly the 3 old-round sigs.
    const oldRound = collectCloseSigsV2(MARKET_ID, ROOT, ROUND_A_MS);
    ok(oldRound.count === 3, `round A scoped query finds exactly its 3 sigs (got ${oldRound.count})`);

    // scoped by (root, attestedAtMs=ROUND_B_MS): must find ZERO — round B hasn't signed yet, and round
    // A's sigs (same root, different attestedAtMs) must NOT leak in (this is the exact bug).
    const newRoundBeforeSigning = collectCloseSigsV2(MARKET_ID, ROOT, ROUND_B_MS);
    ok(newRoundBeforeSigning.count === 0, `round B scoped query finds 0 sigs before anyone signs round B (was leaking round A's 3 sigs pre-fix)`);
    ok(newRoundBeforeSigning.ready === false, 'round B correctly not ready (0 < quorum) — no false-ready from stale round A sigs');

    // round B: 2 members sign the new image (same root, new attestedAtMs).
    insertSig('pkD', ROUND_B_MS);
    insertSig('pkE', ROUND_B_MS);
    const newRoundAfterSigning = collectCloseSigsV2(MARKET_ID, ROOT, ROUND_B_MS);
    ok(newRoundAfterSigning.count === 2, `round B scoped query finds exactly its own 2 sigs after signing (got ${newRoundAfterSigning.count})`);
    ok(newRoundAfterSigning.sigs.every(s => ['pkD', 'pkE'].includes(s.committee_pk)), 'round B sigs contain only round B signers, no round A cross-contamination');

    // backward-compat: omitting attestedAtMs falls back to root-only (old behavior) — sees all 5.
    const legacyCall = collectCloseSigsV2(MARKET_ID, ROOT);
    ok(legacyCall.count === 5, `omitting attestedAtMs falls back to root-only match (sees all 5 across both rounds), backward-compat preserved`);
  } finally {
    // cleanup — ALWAYS runs, even if an assertion helper or collectCloseSigsV2 itself throws.
    const cleaned = sqlite.prepare(`DELETE FROM chain_events WHERE txid LIKE ?`).run(`${MARKET_ID}%`);
    console.log(`  (cleanup: removed ${cleaned.changes} sentinel rows for ${MARKET_ID})`);
  }

  console.log(fails === 0 ? '\n✅✅ ALL PASS — (root, attestedAtMs) compound key prevents cross-round sig contamination' : `\n❌ ${fails} assertions failed`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
