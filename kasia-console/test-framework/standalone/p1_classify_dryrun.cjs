#!/usr/bin/env node
// j2-classify-dryrun.cjs — Codex "Required next evidence #4": a dry-run migration report that
// creates NO authorization and NO transaction, showing deterministic classification and reasons.
//
// 【怎么跑 —— 完整命令, 照抄即可】
//   cd <repo>/kasia-console && node test-framework/standalone/p1_classify_dryrun.cjs            # 正式跑
//   cd <repo>/kasia-console && node test-framework/standalone/p1_classify_dryrun.cjs --selftest # 分支自测
//   输入: <repo>/scratch/j2-cohort-rows.csv (先跑 cohort-export.cjs 生成) + j1-158-received.txt(链上读数)
//   覆盖路径: KANET_ROOT=<repo> 或 KANET_SCRATCH=<dir>
//   🔴 路径走 KANET_ROOT 不硬编码(CLAUDE.md:242): 硬编码会让"入库以求可复现"自相矛盾。
//
// 🔴 v2 (2026-08-05 16:4xZ) — REWRITTEN, and the reason is the whole point of this file:
//   v1 classified 121 sides as REFUND_LANDED because the refund transactions were on chain.
//   Every measurement behind that was true. **The subject was wrong**: those refunds returned the
//   MAKER's spine stake to our own maker-1 identity (SUM(refund_amount) 4734.6 KAS ≈ SUM(maker_stake)
//   4735.0 KAS), while these rows are BETTOR sides worth 1208.5 KAS — a different pot entirely.
//   Zero of 1510 refund transactions spend a bettor side_lock_tx. Bettor voided v1; this is the redo.
//   ⇒ The check that would have caught it costs nothing: **subtract the evidence's amount from the
//     amount of the rows it is supposed to explain.** 4734.6 ≠ 1208.5 was visible the whole time.
//
// Subject of THIS file: one bettor side per row. Chain input: is that side's own outpoint still in
// the live UTXO set (J1's getUtxosByAddresses over the 27 side_p2sh addresses, 158/158 received).
const fs = require('fs');
const path = require('path');
const ROOT = process.env.KANET_ROOT || path.resolve(__dirname, '../../..');
// 输入与输出都留在 scratch/(gitignored): 含 bettor_pk / txid 的行级数据不入公开仓库 —— 入库的是方法。
const S = (process.env.KANET_SCRATCH || path.join(ROOT, 'scratch')) + path.sep;

// ---- classification: pure function, no I/O ------------------------------------------------------
// Codex §6 wants at least six classes. Three of his six cannot be filled with the instruments we
// have, and they are named as such rather than folded into a neighbour — inventing a verdict is
// exactly what v1 did.
// 🔴 v3 (2026-08-06, Codex `6a4cba9d` ①) — the live set is keyed by CANONICAL OUTPOINT, not txid.
//   v2 asked `liveSet.has(side_lock_tx)`, i.e. it treated a txid as if it identified an output.
//   One tx has many outputs and only one of them is the bettor-side covenant output, so a live
//   *sibling* output would have counted the side as still locked.
//   For this cohort the side output is at index 0 — production hardcodes it
//   (`kasia-console/src/api/pool.js` buildBettorRefundClaim: `outpointIndex: 0`) and 2,152 claims
//   have succeeded through that path. But **an invariant being true is not the tool enforcing it**:
//   v2 would have kept returning the same answer after the convention changed. So the index is now
//   part of the key, asserted per row, and a nonzero-index live output is an explicit reject.
const SIDE_OUTPUT_INDEX = 0;                    // asserted, not assumed — see SIDE_INDEX_SOURCE
const SIDE_INDEX_SOURCE = 'kasia-console/src/api/pool.js buildBettorRefundClaim ⇒ outpointIndex: 0';

function classify(row, liveSet) {
  const R = (cls, why) => ({ cls, why });
  if (!row.side_lock_tx) return R('NO_SIDE_LOCK_RECORDED', 'row carries no side_lock_tx');
  if (!liveSet) return R('UNCLASSIFIED_NO_CHAIN_READ', 'no live UTXO set supplied');
  // Live at the index this cohort's sides are built at ⇒ the side output itself is unspent.
  const sideOutpoint = `${row.side_lock_tx}:${SIDE_OUTPUT_INDEX}`;
  // A live output of the SAME tx at a DIFFERENT index says nothing about the side output; if that
  // is all we have, the side is absent and must be classified as such rather than as still-locked.
  const siblingLive = [...liveSet].some((k) => k.startsWith(row.side_lock_tx + ':') && k !== sideOutpoint);
  if (!liveSet.has(sideOutpoint) && siblingLive)
    return R('SIDE_UTXO_ABSENT__SIBLING_OUTPUT_LIVE',
      `only a non-index-${SIDE_OUTPUT_INDEX} output of ${row.side_lock_tx.slice(0, 12)}… is live; the side output itself is gone. Side index source: ${SIDE_INDEX_SOURCE}`);
  if (liveSet.has(sideOutpoint))
    // The money is demonstrably still sitting at the side address, unspent, and unclaimed.
    // This is Codex's "still-spendable predecessor" — WITHOUT the second half of his phrase
    // ("with independently valid refund evidence"): refund_authorization is NULL on all 125.
    return R('SIDE_UTXO_LIVE__UNCLAIMED',
      'side outpoint present in the live UTXO set and claim_txid is NULL => funds still locked at the side address; refund evidence NOT established (authorization is NULL)');
  // Absent from the live set. Two causes, opposite handling, and no instrument separates them:
  //   (a) it existed and was spent — by whom is unknowable (Kaspa RPC has no tx-by-id/spent-by)
  //   (b) it never existed — the bet never landed, so there is nothing to explain
  // side_lock_daa would answer (a)/(b), but it is NULL for the targets AND NULL for 173 sides in
  // the same markets that were provably claimed => zero discriminating power in this population.
  return R('SIDE_UTXO_ABSENT__SPENT_OR_NEVER_EXISTED',
    'side outpoint not in the live UTXO set; local records explain nothing. Cannot distinguish "existed and was spent" from "the bet never landed" — three local instruments were each killed by a control arm, and no chain query answers "did this outpoint ever exist".');
}

// ---- self test: every branch, expected class named up front, run against the REAL parser ---------
if (process.argv.includes('--selftest')) {
  // 🔴 v1's selftest fed classify() hand-built objects and passed 8/8 while the real run put 121
  //    rows in the wrong class: the CSV parser dropped a field on adjacent empty values, and the
  //    boolean coercion list was hand-written. A branch table can be fully covered and still be
  //    fed wrong values by the layer above it. ⇒ this selftest goes through parseCsv() too.
  const tmp = S + '_selftest_rows.csv';
  fs.writeFileSync(tmp, 'market_id,side_rowid,side_lock_tx,stake_amount,auth\n' +
    '"m1","1","aaaa","100",""\n' +      // aaaa:0 live        -> LIVE
    '"m2","2","bbbb","100",""\n' +      // only bbbb:1 live   -> SIBLING_OUTPUT_LIVE (the adversarial one)
    '"m3","3","","100",""\n' +          // no lock tx         -> NO_SIDE_LOCK_RECORDED (adjacent empties!)
    '"m4","4","cccc","100",""\n');      // nothing of cccc    -> ABSENT
  const rows = parseCsv(tmp);
  // Canonical outpoints. `bbbb:1` is the adversarial one Codex asked for: the tx is present in the
  // live set, but only at an index that is NOT where this cohort's side output lives. Matching on
  // txid alone would call it locked; it must be rejected instead.
  const live = new Set(['aaaa:0', 'bbbb:1']);
  const cases = [
    ['live outpoint', rows[0], live, 'SIDE_UTXO_LIVE__UNCLAIMED'],
    ['sibling output live only', rows[1], live, 'SIDE_UTXO_ABSENT__SIBLING_OUTPUT_LIVE'],
    ['absent outpoint', rows[3], live, 'SIDE_UTXO_ABSENT__SPENT_OR_NEVER_EXISTED'],
    ['no lock tx recorded', rows[2], live, 'NO_SIDE_LOCK_RECORDED'],
    ['no chain read', rows[0], null, 'UNCLASSIFIED_NO_CHAIN_READ'],
  ];
  let bad = 0;
  for (const [name, row, ls, want] of cases) {
    const got = classify(row, ls);
    if (got.cls !== want) bad++;
    console.log((got.cls === want ? 'PASS' : 'FAIL') + '  ' + name.padEnd(24) + ' -> ' + got.cls);
  }
  fs.unlinkSync(tmp);

  // ---- v4 negative fixtures --------------------------------------------------------------------
  // 🔴 Every guard below gets an input that MUST be refused. A guard tested only with good input
  //   proves nothing: today three separate throwaway checks in this investigation returned a
  //   plausible number while being completely broken, and in each case the missing arm was the one
  //   whose expected answer differs from the failure output. Positive-only coverage is how a check
  //   that never fires passes forever.
  const wrote = (name, text) => { const p = S + name; fs.writeFileSync(p, text); return p; };
  const mustThrow = (name, fn, needle) => {
    let msg = null;
    try { fn(); } catch (e) { msg = e.message; }
    const ok = msg !== null && (!needle || msg.includes(needle));
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name.padEnd(34) + ' -> ' +
      (msg === null ? 'NO ERROR RAISED (guard is not firing)' : msg.slice(0, 70) + '…'));
    if (!ok) bad++;
  };
  const H = 'market_id,side_rowid,side_lock_tx,stake_amount,auth\n';
  console.log('');

  // A (positive + the assertion that actually fails on the pre-fix code): CRLF must parse to
  // exactly the same fields as LF. The `auth` column is deliberately LAST and non-empty in row 1 —
  // with a single row or an empty last cell, `.trim()` removes the trailing CR and both arms agree
  // for the wrong reason. That false negative happened during this investigation; hence this shape.
  const body = '"m1","1","aa","100","AUTH-EXISTS"\n"m2","2","bb","100",""\n';
  const lf = parseCsv(wrote('_st_lf.csv', H + body));
  const crlf = parseCsv(wrote('_st_crlf.csv', (H + body).replace(/\n/g, '\r\n')));
  const sameFields = JSON.stringify(lf) === JSON.stringify(crlf);
  const keyClean = Object.keys(crlf[0]).includes('auth') && !Object.keys(crlf[0]).some((k) => k.includes('\r'));
  const authKept = crlf[0].auth === 'AUTH-EXISTS';
  for (const [n, ok] of [['CRLF parses identically to LF', sameFields],
                         ['CRLF leaves no \\r in header keys', keyClean],
                         ['CRLF keeps the last column value', authKept]]) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + n.padEnd(34) + ' -> ' + (ok ? 'ok' : 'MISMATCH'));
    if (!ok) bad++;
  }

  mustThrow('A-bis: field containing a newline',
    () => parseCsv(wrote('_st_nl.csv', H + '"m1","1","aa","100","half\n')), 'odd number of quotes');
  mustThrow('B: same cohort row twice',
    () => parseCsv(wrote('_st_duprow.csv', H + '"m1","1","aa","100",""\n"m1","1","aa","100",""\n')), 'the same cohort row');
  mustThrow('B: two rows, one side_lock_tx',
    () => parseCsv(wrote('_st_dupmoney.csv', H + '"m1","1","aa","100",""\n"m2","2","aa","100",""\n')), 'SAME side_lock_tx');
  const hex = 'a'.repeat(64);
  mustThrow('C: duplicate live-set entries',
    () => loadLiveSet([`${hex}:0`, `${hex}:0`], 'fixture'), 'duplicate outpoint');
  mustThrow('C: bare txid in live set',
    () => loadLiveSet([hex], 'fixture'), 'bare txid');
  for (const f of ['_st_lf.csv', '_st_crlf.csv', '_st_nl.csv', '_st_duprow.csv', '_st_dupmoney.csv'])
    { try { fs.unlinkSync(S + f); } catch { /* fixture already gone */ } }

  console.log('\n' + (bad === 0 ? 'all' : 'SOME FAILED —') + ' branch + guard fixtures done; failures=' + bad);
  console.log('NOTE: proves the branches are exercisable, the parser feeds them correctly, and each');
  console.log('      guard actually refuses its bad input. Does NOT prove any real row is classified');
  console.log('      correctly — that rests on the chain read.');
  process.exit(bad ? 1 : 0);
}

// ---- CSV: a real quoted-field splitter; refuses to guess when the field count disagrees ----------
// 🔴 v4 (2026-08-06, Codex §3 + Bettor A-加固档) — four defects that Codex listed as MISSING TESTS
//   turned out to be LIVE BUGS when the tests were actually run. They are fixed here, and the
//   distinction is worth keeping: "缺一个测试" and "有一个 bug" read identically in a review, and
//   only running the missing test separates them.
//     A   CRLF   -> the last header cell became `md_valid\r`, so THAT COLUMN read as undefined on
//                   every row. If `auth` had been the last column, "125/125 authorization is NULL"
//                   would have been true by construction, independent of the data.
//     B   dup rows      -> the same side counted twice; conservation still balances, total is wrong.
//     C   dup live set  -> `new Set()` deduped silently; 3 identical lines printed "loaded 1".
//     D   empty input   -> "0 sides / 0.00 KAS" and exit 0, i.e. an empty run looks like a good one.
function stripCr(line) {
  // CRLF is the line ending RFC 4180 actually specifies, so this accepts it rather than tolerating
  // it. Only a trailing CR is removed: a CR anywhere else is real content and must survive to be
  // caught by the field-count / quote checks instead of being silently swallowed here.
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function parseCsv(p) {
  const L = fs.readFileSync(p, 'utf8').trim().split('\n').map(stripCr);
  const h = splitCsvLine(L[0]);
  const rows = L.slice(1).filter((l) => l !== '').map((l, n) => {
    // A field spanning a newline would already have been cut in half by the split above, and the
    // failure would surface as a field-count mismatch — i.e. the right refusal with the wrong
    // reason. Say what actually happened instead; we do not support multi-line fields and this
    // dataset (txids, integers, statuses) has no use for them.
    if ((l.match(/"/g) || []).length % 2 !== 0)
      throw new Error(`${p} line ${n + 2}: odd number of quotes — looks like a field containing a newline; this script does not support multi-line CSV fields`);
    const v = splitCsvLine(l);
    if (v.length !== h.length)
      throw new Error(`${p} line ${n + 2}: ${v.length} fields, header has ${h.length} — refusing to guess alignment`);
    return Object.fromEntries(h.map((k, i) => [k, v[i]]));
  });
  assertNoDuplicateRows(rows, p);
  return rows;
}

// B — two duplicate checks, deliberately kept separate because they are different invariants and a
// violation of each means something different (Bettor asked which key; the answer is "both"):
//   row identity   (market_id, side_rowid)  -> the exporter emitted the same DB row twice
//   money identity  side_lock_tx            -> two DIFFERENT rows claim the same locked output.
// The second one is not a formatting complaint: it is a finding about the data, so it says so.
// 🔵 money identity upgrades to (side_p2sh, side_lock_tx) once the cohort carries the side address —
//   one tx can legitimately fund two different side addresses, and only the address separates them.
function assertNoDuplicateRows(rows, p) {
  const seenRow = new Map(), seenMoney = new Map();
  let noLockTx = 0;
  rows.forEach((r, i) => {
    const rk = `${r.market_id}|${r.side_rowid}`;
    if (seenRow.has(rk))
      throw new Error(`${p}: rows ${seenRow.get(rk) + 2} and ${i + 2} are the same cohort row (market_id, side_rowid)=${rk} — the export emitted it twice; counting it twice would double this side's stake`);
    seenRow.set(rk, i);
    if (!r.side_lock_tx) { noLockTx++; return; }
    if (seenMoney.has(r.side_lock_tx))
      throw new Error(`${p}: rows ${seenMoney.get(r.side_lock_tx) + 2} and ${i + 2} are different cohort rows claiming the SAME side_lock_tx ${String(r.side_lock_tx).slice(0, 12)}… — that is a data finding, not a format error: either the export is wrong or two sides are recorded against one locked output`);
    seenMoney.set(r.side_lock_tx, i);
  });
  if (noLockTx) console.log('note: %d row(s) carry no side_lock_tx — exempt from the money-identity check by construction, not by oversight', noLockTx);
}

// C — the live set was built with `new Set(...)`, which deduped silently: a file with three
// identical lines reported "loaded 1 outpoints". That made the loaded count useless as a
// completeness check against "158 received", which is exactly what it was being used for.
function loadLiveSet(raw, where) {
  const bare = raw.filter((s) => /^[0-9a-f]{64}$/i.test(s));
  const canonical = raw.filter((s) => /^[0-9a-f]{64}:\d+$/i.test(s));
  if (bare.length) {
    throw new Error(
      `live set has ${bare.length} bare txid line(s) with no ":<index>" (of ${raw.length}). ` +
      'An outpoint is (txid, index); matching on txid alone counts a live sibling output as if it ' +
      'were the side output. Regenerate the file from the chain reader with the index column ' +
      '(entry.outpoint.index), e.g. "<txid>:0" per line, then re-run.');
  }
  if (canonical.length !== raw.length)
    throw new Error(`live set: ${raw.length - canonical.length} line(s) match neither bare txid nor <txid>:<index> — refusing to guess`);
  const set = new Set(canonical);
  if (set.size !== canonical.length) {
    const dup = canonical.filter((s, i) => canonical.indexOf(s) !== i);
    throw new Error(`${where}: ${canonical.length - set.size} duplicate outpoint line(s) (e.g. ${[...new Set(dup)].slice(0, 3).join(', ')}). Deduping them silently would make the loaded count disagree with the number of records the chain returned, and that count is used as evidence of completeness`);
  }
  return set;
}

// ---- real run ------------------------------------------------------------------------------------
// A cohort that fails its own integrity checks used to come out as a raw stack trace (exit 1).
// It is loud either way, but an evidence tool should say what it refused and why, and use a code a
// caller can branch on: 0 ok / 2 chain read degraded / 3 empty input / 5 cohort input rejected.
let rows;
try {
  rows = parseCsv(S + 'j2-cohort-rows.csv');
} catch (e) {
  console.error('🔴 cohort REJECTED: ' + (e && e.message ? e.message : String(e)));
  console.error('   Refusing to classify a cohort that does not pass its own integrity checks.');
  process.exit(5);
}
// D — an empty cohort used to print "0 sides / 0.00 KAS / 0 of 0" and exit 0. A run that classified
// nothing is not a clean run; if the export upstream silently produced no rows, this is the only
// place that would have noticed, and it was reporting success.
if (rows.length === 0) {
  console.error('🔴 cohort is EMPTY (0 data rows) in %sj2-cohort-rows.csv', S);
  console.error('   Exiting 3 rather than printing a 0-row report: "classified nothing" and');
  console.error('   "classified everything and found nothing" must not share an exit code.');
  process.exit(3);
}
let live = null;
try {
  // 🔴 The live set must be CANONICAL OUTPOINTS (`<64-hex txid>:<index>`), never bare txids.
  //   The bare-txid file this script used to read was produced by regexing 64-hex out of chat
  //   messages — that extraction silently dropped the index, i.e. half of an outpoint, and nobody
  //   noticed for a day. Refusing bare txids here is the whole point of the v3 hardening: a
  //   silently-degraded input must fail loudly instead of being matched on the half that survived.
  const raw = fs.readFileSync(S + 'j1-158-received.txt', 'utf8').trim().split('\n').map((s) => stripCr(s).trim()).filter(Boolean);
  live = loadLiveSet(raw, S + 'j1-158-received.txt');
  console.log('live UTXO set loaded: %d outpoints (J1, getUtxosByAddresses over the 27 side_p2sh)', live.size);
  if (live.size === 0) {
    console.error('🔴 live set is EMPTY (file present, zero usable entries) — every row would fall to');
    console.error('   UNCLASSIFIED_NO_CHAIN_READ and the run would print a tidy report that means nothing.');
    process.exit(3);
  }
} catch (e) {
  // 🔴 This catch used to swallow everything, which silently neutralised the format guard added
  //   above: a malformed live set produced "no chain read" and a tidy 125-row UNCLASSIFIED report
  //   instead of the loud refusal it was written to be. A missing file is a legitimate state; a
  //   present-but-wrong file is not, and the two must not collapse into the same output.
  if (e && e.code === 'ENOENT') {
    console.log('!! no live UTXO set file — every row falls to UNCLASSIFIED_NO_CHAIN_READ');
  } else {
    console.error('🔴 live set REJECTED: ' + (e && e.message ? e.message : String(e)));
    console.error('   Refusing to classify against a degraded chain read. Fix the input, then re-run.');
    process.exit(2);
  }
}

const out = rows.map((r) => {
  const v = classify(r, live);
  return { ...r, classification: v.cls, reason: v.why };
});
const cols = ['market_id', 'side_rowid', 'ver', 'status', 'bettor_pk', 'stake_amount',
  'side_lock_tx', 'auth', 'classification', 'reason'];
fs.writeFileSync(S + 'j2-dryrun-classification.csv',
  cols.join(',') + '\n' + out.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(',')).join('\n'));

const t = {}, kas = {};
for (const r of out) {
  t[r.classification] = (t[r.classification] || 0) + 1;
  kas[r.classification] = (kas[r.classification] || 0) + Number(r.stake_amount || 0);
}
console.log('\n== DRY RUN (subject = bettor side): %d sides. NO authorization written, NO transaction built. ==', out.length);
for (const [k, n] of Object.entries(t).sort((a, b) => b[1] - a[1]))
  console.log('  ' + k.padEnd(42) + ' ' + String(n).padStart(4) + ' sides  ' + (kas[k] / 1e8).toFixed(2).padStart(9) + ' KAS');
console.log('\n  total staked across all classes: %s KAS', (Object.values(kas).reduce((a, b) => a + b, 0) / 1e8).toFixed(2));

// Conservation (Codex §2): every row lands in exactly one class and no stake is created or lost on
// the way. 🔴 Note what this does NOT catch: duplicate rows inflate both sides equally, so the
// identity still holds. B's dedup check is not redundant with this — each catches what the other
// cannot, which is why both are here.
{
  const nClass = Object.values(t).reduce((a, b) => a + b, 0);
  const sumClass = Object.values(kas).reduce((a, b) => a + b, 0);
  const sumCohort = rows.reduce((a, r) => a + Number(r.stake_amount || 0), 0);
  if (nClass !== out.length)
    throw new Error(`conservation: classes hold ${nClass} sides but the cohort has ${out.length}`);
  if (sumClass !== sumCohort)
    throw new Error(`conservation: classes hold ${sumClass} sompi but the cohort has ${sumCohort} (difference ${sumClass - sumCohort})`);
  console.log('  conservation: %d sides and %s KAS accounted for, matching the cohort exactly',
    nClass, (sumCohort / 1e8).toFixed(2));
}
console.log('  rows whose refund_authorization is NULL: %d / %d  (no class here creates refund authority)',
  out.filter((r) => !r.auth).length, out.length);
console.log('\nwritten: %sj2-dryrun-classification.csv', S);
