// J1 offline teeth-test: C2-anchor — reDeriveCommittee poolMerkleRoot 链锚 (Track B, 2026-06-22).
//   验 poolMerkleRoot 从【链上 PS redeem】(chain-anchored) 读, DB root 必 == 它; 不静默信 DB。
//   ⚠ 牙非 vacuous: 用【真 silverc 编的 PayoutShard redeem】(genesis-烤 poolMerkleRoot) → 证 extractOnChainPoolMerkleRoot
//   从真 redeem 抽对 + reDeriveCommittee 拒 DB-篡改 root / 子集成员 / 无链锚 (单变量 A/B)。
import { reDeriveCommittee, extractOnChainPoolMerkleRoot } from '../src/lib/bshard-close-enforce.mjs';
import { buildPoolMerkleTree } from '../src/services/pool-merkle-v06.mjs';
import { compileSil, ctorBytes32, ctorInt } from '../src/lib/pool-bshard-artifacts.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const SILVERC = 'D:/silverscript/target/release/silverc.exe';
const z32 = '00'.repeat(32);
const W17 = () => Array.from({ length: 17 }, () => ctorInt(0));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
async function throws(fn, re, m) { try { await fn(); ok(false, `${m} — 应 throw 但没 throw`); } catch (e) { ok(re.test(e.message), `${m}: ${e.message.slice(0, 90)}`); } }

const MID = 'logical-market-C2';
// 6 distinct committee members (≥5 after exclude). pk = 32B hex.
const members = Array.from({ length: 6 }, (_, i) => ({ pk_hex: (0xa0 + i).toString(16).padStart(2, '0').repeat(32), stake_sompi: String(1_000_000 * (i + 1)) }));
const poolMerkleRoot = buildPoolMerkleTree(members.map(m => m.pk_hex)).root.toString('hex').toLowerCase();
const predicate_commit = 'dd'.repeat(32);
// 真 PayoutShard redeem，genesis-烤 poolMerkleRoot
const psCtor = [ctorBytes32(poolMerkleRoot), ctorBytes32(predicate_commit), ctorInt(123456), ctorInt(0), ctorBytes32(z32), ...W17()];
const psRedeem = Buffer.from(compileSil(join(LIB, 'PayoutShard.sil'), psCtor, SILVERC).script).toString('hex');
console.log(`[setup] poolMerkleRoot=${poolMerkleRoot.slice(0, 16)} psRedeem ${psRedeem.length / 2}B`);

const baseCtx = (overrides = {}) => ({
  loadPoolSnapshot: async () => ({ pool_merkle_root: poolMerkleRoot, members, maker_pk: null, broker_pk: null, ...(overrides.snap || {}) }),
  fetchEndBlockHashCanonical: async () => '11'.repeat(32),
  deadlineDaa: 1000,
  ...overrides.ctx,
});

(async () => {
  console.log('== T0: extractOnChainPoolMerkleRoot 从真 redeem 抽 == genesis poolMerkleRoot ==');
  ok(extractOnChainPoolMerkleRoot(psRedeem) === poolMerkleRoot, `extracted == poolMerkleRoot`);

  console.log('== T1: honest — DB root == 链锚, 完整成员 → 返 5 委员 ==');
  const c1 = await reDeriveCommittee(MID, baseCtx(), psRedeem);
  ok(Array.isArray(c1) && c1.length === 5, `5 committee selected (${c1.length})`);

  console.log('== T2: 🦷 DB poolMerkleRoot 篡改 (DB != 链锚) → fail-loud ==');
  await throws(() => reDeriveCommittee(MID, baseCtx({ snap: { pool_merkle_root: 'cc'.repeat(32) } }), psRedeem),
    /C2-anchor: DB poolMerkleRoot.*!=.*链上/, 'rejected DB-tamper');

  console.log('== T3: 🦷 子集成员 (漏一个诚实成员, buildPoolMerkleTree != 链锚) → reject ==');
  // members 子集但 DB root 仍设成完整 root → buildPoolMerkleTree(子集) != 链锚 → C2 子集攻击防
  await throws(() => reDeriveCommittee(MID, baseCtx({ snap: { members: members.slice(0, 5) } }), psRedeem),
    /C2: 成员集非完整/, 'rejected subset members');

  console.log('== T4: 🦷 无链锚 (psRedeemHex + onChainPoolMerkleRoot 都缺) → fail-loud (拒静默信 DB) ==');
  await throws(() => reDeriveCommittee(MID, baseCtx(), null),
    /C2-anchor: 无 chain-anchored poolMerkleRoot/, 'fail-loud no-anchor');

  console.log('== T5: ctx.onChainPoolMerkleRoot 直接注入 (daemon scout 链读路) → 工作, 无需 psRedeem ==');
  const c5 = await reDeriveCommittee(MID, baseCtx({ ctx: { onChainPoolMerkleRoot: poolMerkleRoot } }), null);
  ok(Array.isArray(c5) && c5.length === 5, `5 committee via onChainPoolMerkleRoot (${c5.length})`);

  console.log('== T6: 🦷 extractor cross-check — redeem 某 offset 篡改 (5 副本不一致) → throw ==');
  const corrupt = Buffer.from(psRedeem, 'hex'); corrupt[1002] ^= 0xff;   // 破坏第1个 inlined 副本
  await throws(async () => extractOnChainPoolMerkleRoot(corrupt.toString('hex')),
    /副本不一致|非 PUSH32/, 'extractor cross-check fail-loud');

  console.log('== T7: 🦷 非 PayoutShard redeem (太短) → extractor throw ==');
  await throws(async () => extractOnChainPoolMerkleRoot('aa'.repeat(100)),
    /非 PUSH32|太短/, 'extractor short-redeem fail-loud');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
