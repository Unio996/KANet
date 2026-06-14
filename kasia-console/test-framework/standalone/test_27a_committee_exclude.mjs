// J1tn #27a regression (part 1/2) — committee bettor/oracle EXCLUDE + starve fail-loud.
//
// scope: #27a (oracle∩bettor exclusion) + #27a v2 (chain-anchored bettor-exclude). The exclude SET is computed
//        in sampleAndStoreCommittee (maker_pk + broker_pk + bettors with side_lock_daa <= deadline_daa) and
//        APPLIED by selectCommittee(members, seed, {excludePks}). This file tests the production selectCommittee
//        application + its starve guard. The daa-derivation + NULL fail-loud is in test_27a_null_daa_failloud.mjs.
// bug guarded: a same-PK double-role (maker/broker/bettor also an oracle) could vote its own market → must be
//        excluded from the committee. And if exclusion starves the eligible pool below COMMITTEE_SIZE, the
//        sampler MUST fail-loud (throw), never silently sample a too-small / wrong committee (cross-node fork).
//
// 真调生产 export selectCommittee (pool-committee-sampler.mjs, pure: no DB/IPC) = 非拷贝逻辑.
// run: node test-framework/standalone/test_27a_committee_exclude.mjs   (exit 0=PASS, 1=FAIL)

import { selectCommittee } from '../../src/services/pool-committee-sampler.mjs';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else { fails++; console.error(`FAIL ${name}: ${detail || ''}`); }
}

const COMMITTEE_SIZE = 5; // matches pool-committee-sampler COMMITTEE_SIZE (mirror constant; asserted via proof below)
const seed = Buffer.alloc(32, 7); // fixed 32-byte VRF seed → reproducible
// 8 distinct oracle pks (64-hex), varied stakes
const pk = (b) => String(b).repeat(2).padStart(2, '0').repeat(32).slice(0, 64);
const mk = (hex, stake) => ({ pk_hex: hex, stake_sompi: BigInt(stake) });
const PKS = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', '17', '28'].map(h => h.repeat(32)); // 8 × 64-hex
const members = PKS.map((p, i) => mk(p, (i + 1) * 1_00000000)); // 1..8 KAS

// 1. no exclude → exactly COMMITTEE_SIZE selected, all from the pool, no duplicates
const r0 = selectCommittee(members, seed, {});
const sel0 = r0.selected.map(s => s.pk_hex);
check('no-exclude → COMMITTEE_SIZE selected', sel0.length === COMMITTEE_SIZE, `got ${sel0.length}`);
check('no-exclude → all selected are pool members', sel0.every(p => PKS.includes(p)), JSON.stringify(sel0));
check('no-exclude → no duplicate picks', new Set(sel0).size === sel0.length, JSON.stringify(sel0));
check('proof committee_size == 5', r0.proof.committee_size === COMMITTEE_SIZE, `${r0.proof.committee_size}`);

// 2. EXCLUDE: exclude 2 specific members → NONE of them may appear in the committee
const excluded = [PKS[0], PKS[3]];
const r1 = selectCommittee(members, seed, { excludePks: excluded });
const sel1 = r1.selected.map(s => s.pk_hex);
check('exclude → excluded PKs never selected', excluded.every(e => !sel1.includes(e)), `excluded=${JSON.stringify(excluded)} selected=${JSON.stringify(sel1)}`);
check('exclude → still COMMITTEE_SIZE from remaining 6', sel1.length === COMMITTEE_SIZE, `got ${sel1.length}`);

// 3. EXCLUDE case-insensitive (excludePks lowercases; pass UPPER, pool lower → still excluded)
const r1b = selectCommittee(members, seed, { excludePks: [PKS[0].toUpperCase()] });
check('exclude is case-insensitive', !r1b.selected.map(s => s.pk_hex).includes(PKS[0]), 'UPPER exclude should still drop the lower pk');

// 4. STARVE fail-loud: pool of exactly COMMITTEE_SIZE, exclude 1 → eligible=4 < 5 → MUST throw (no silent under-size)
const minPool = members.slice(0, COMMITTEE_SIZE); // exactly 5
let threw = false, msg = '';
try { selectCommittee(minPool, seed, { excludePks: [PKS[0]] }); }
catch (e) { threw = true; msg = e.message; }
check('starve (eligible < COMMITTEE_SIZE) → fail-loud throw', threw && />= 5|COMMITTEE_SIZE|after excludePks/.test(msg), `threw=${threw} msg=${msg}`);

// 5. DETERMINISM: same (members, seed, excludePks) → identical selection (reproducible across nodes)
const rA = selectCommittee(members, seed, { excludePks: excluded });
const rB = selectCommittee(members, seed, { excludePks: excluded });
check('determinism: same inputs → identical committee',
  JSON.stringify(rA.selected.map(s => s.pk_hex)) === JSON.stringify(rB.selected.map(s => s.pk_hex)),
  `A=${JSON.stringify(rA.selected.map(s => s.pk_hex))} B=${JSON.stringify(rB.selected.map(s => s.pk_hex))}`);

// 6. DETERMINISM independent of input member ORDER (sampler sorts by pk_hex) → cross-node order-agnostic
const shuffled = [...members].reverse();
const rShuf = selectCommittee(shuffled, seed, { excludePks: excluded });
check('determinism: input order does not change committee',
  JSON.stringify(rShuf.selected.map(s => s.pk_hex).sort()) === JSON.stringify(rA.selected.map(s => s.pk_hex).sort()),
  `shuffled=${JSON.stringify(rShuf.selected.map(s => s.pk_hex).sort())}`);

console.log(fails === 0 ? '\n✅ #27a committee-exclude regression PASS' : `\n❌ ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
