// J1 test: reDeriveCommittee bettor-exclude fix (2026-06-23) — 修 enforce 漏排 bettor(sample 排, enforce 没排)。
// 验: ① bettor∈oracle pool 被 reDeriveCommittee 排除(== production sampleAndStoreCommittee) ② 非空泛(bettor 大 stake,
//      旧行为[只排 maker/broker]会选中它, fix 后排除 → 委员集真变) ③ side_lock>deadline 不排 ④ NULL → fail-loud。
import { reDeriveCommittee } from '../src/lib/bshard-close-enforce.mjs';
import { deriveCommitteeSeed, selectCommittee } from '../src/services/pool-committee-sampler.mjs';
import { buildPoolMerkleTree } from '../src/services/pool-merkle-v06.mjs';

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

const MID = 'test-market-bettor-exclude';
const ENDBLOCK = 'ab'.repeat(32);
const DEADLINE = 1000;
const pk = (i) => String(i + 1).padStart(2, '0').repeat(32);
const members = Array.from({ length: 10 }, (_, i) => ({ pk_hex: pk(i), stake_sompi: i === 2 ? 100000000n : 100n }));
const MAKER = pk(0), BROKER = pk(1), BETTOR = pk(2);   // m2 = oracle∩bettor, 大 stake → 非空泛
const poolMerkleRoot = (() => { const t = buildPoolMerkleTree(members.map(m => m.pk_hex)); return (t.root?.toString ? t.root.toString('hex') : String(t.root)).toLowerCase(); })();

function mkCtx({ bettors, deadlineDaa = DEADLINE }) {
  return {
    loadPoolSnapshot: async () => ({ pool_merkle_root: poolMerkleRoot, members, maker_pk: MAKER, broker_pk: BROKER, deadline_daa: deadlineDaa }),
    onChainPoolMerkleRoot: poolMerkleRoot,   // C2-anchor (worktree reDeriveCommittee 需链锚 root)
    fetchEndBlockHashCanonical: async () => ENDBLOCK,
    deadlineDaa,
    loadBettors: bettors === undefined ? undefined : async () => bettors,
  };
}
const seed = deriveCommitteeSeed(MID, ENDBLOCK, poolMerkleRoot);
const expectWith = (ex) => selectCommittee(members, seed, { excludePks: ex }).selected.map(c => c.pk_hex);

(async () => {
  console.log('== T1: bettor m2 (side_lock_daa<=deadline) 被 reDeriveCommittee 排除 ==');
  const c1 = await reDeriveCommittee(MID, mkCtx({ bettors: [{ pk: BETTOR, side_lock_daa: 500 }] }));
  ok(!c1.includes(BETTOR), `m2 bettor ∉ 委员集 (${c1.length} 委员)`);
  ok(JSON.stringify(c1) === JSON.stringify(expectWith([MAKER, BROKER, BETTOR])), 'reDeriveCommittee == selectCommittee(exclude maker+broker+bettor) = 匹配 sample');

  console.log('== T2: 非空泛 — 旧行为(只排 maker/broker)会选中大 stake bettor m2 ==');
  const oldBehavior = expectWith([MAKER, BROKER]);
  ok(oldBehavior.includes(BETTOR), `旧行为(无 bettor-exclude)选中 m2(大 stake) → fix 非空泛`);
  ok(JSON.stringify(c1) !== JSON.stringify(oldBehavior), 'fix 后委员集 != 旧行为 (bettor-exclude 真生效)');

  console.log('== T3: side_lock_daa > deadline (越界 bet) 不排除 ==');
  const c3 = await reDeriveCommittee(MID, mkCtx({ bettors: [{ pk: BETTOR, side_lock_daa: 2000 }] }));
  ok(JSON.stringify(c3) === JSON.stringify(expectWith([MAKER, BROKER])), '越界 bet(daa>deadline)不进 exclude');

  console.log('== T4: NULL side_lock_daa → fail-loud throw ==');
  let threw = false;
  try { await reDeriveCommittee(MID, mkCtx({ bettors: [{ pk: BETTOR, side_lock_daa: null }] })); } catch (e) { threw = /side_lock_daa|fail-loud/.test(e.message); }
  ok(threw, 'NULL side_lock_daa bettor → throw');

  console.log('== T5: 无 bettor (loadBettors 返 []) → 只排 maker/broker (graceful) ==');
  const c5 = await reDeriveCommittee(MID, mkCtx({ bettors: [] }));
  ok(JSON.stringify(c5) === JSON.stringify(expectWith([MAKER, BROKER])), '无 bettor → exclude=maker+broker');

  console.log('== T6: loadBettors 缺失 → fail-loud throw (NWT: 别静默 skip 必需 exclude) ==');
  let t6 = false;
  try { await reDeriveCommittee(MID, mkCtx({ bettors: undefined })); } catch (e) { t6 = /loadBettors|fail-loud|静默/.test(e.message); }
  ok(t6, 'ctx.loadBettors 缺 → throw (非静默 skip bettor-exclude)');

  console.log('== T7: deadlineDaa 非法 (0) → fail-loud throw ==');
  let t7 = false;
  try { await reDeriveCommittee(MID, mkCtx({ bettors: [], deadlineDaa: 0 })); } catch (e) { t7 = /deadlineDaa|非法|fail-loud/.test(e.message); }
  ok(t7, 'deadlineDaa<=0 → throw (无法 chain-anchor bettor-exclude)');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
