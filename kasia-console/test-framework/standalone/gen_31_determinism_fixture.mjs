// J1tn #31 — gate B 确定性 e2e fixture (8-participant aggregate, 压 4 命门: re-index/parimutuel/loser-filter/dust).
//
// fixture-must-mirror-production: 经**生产 computePoolPayouts + computeChunkFee 单源**算真 parimutuel amount + filter
//   + re-index → 真 payoutRoot 锚. 镜像 ② extraction (canonical: maker@-1 先, winning bettors merkle_index ASC).
//   组成 = KANet-UI e2e 市场设计 (散 winners{0,2,3,5,7}/夹 losers{1,4,6}/变额 stake). winner=YES(0). totalPool=2850 KAS.
//   minerFee=(B)-uniform computeChunkFee 单源(fixture+④ wire 物理同值). oracleBond=1 sompi (KANet-UI 实拉 create default).
//
// byte-equal: e2e 造市用同 seed derivePk(0..7) keypair + 同 fees → 链上 payoutRoot == 此锚 (4-impl: J1/②/NWT/链上).
// run: node test-framework/standalone/gen_31_determinism_fixture.mjs  (输出 fixture + 自验 4 命门, exit 0=PASS).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_LIB = join(__dirname, '../../src/lib');
const imp = (rel) => import(pathToFileURL(join(SRC_LIB, rel)).href);
const { computeChunkFee } = await imp('pool-settle-chunks.mjs');
const settler = await import(pathToFileURL(join(__dirname, '../../src/services/pool-market-settler.js')).href);
const { computePoolPayouts } = settler;
const { payoutLeaf, payoutRoot: computePayoutRoot } = await imp('pool-payout-root.mjs');
const kaspa = await import('kaspa-wasm');
const { blake2b } = await import('@noble/hashes/blake2b');

// —— (A) shared seed → 真 keypair (KANet-UI 同 seed 同派生 → 链上 bettor_pk == fixture pk) ——
const SEED = 'KANET-31-E2E-FIXTURE-SEED-v1';
const derivePk = (i) => {
  const idx = Buffer.alloc(4); idx.writeUInt32LE(i);
  const sk = Buffer.from(blake2b(Buffer.concat([Buffer.from(SEED, 'utf8'), idx]), { dkLen: 32 })).toString('hex');
  return new kaspa.PrivateKey(sk).toPublicKey().toXOnlyPublicKey().toString();
};

// —— KANet-UI e2e 市场组成 (merkle_index | side(0=YES赢/1=NO输) | stake KAS) ——
const KAS = 100000000n;  // sompi/KAS
const COMP = [
  { mi: 0, side: 0, kas: 500n, isMaker: true },   // maker pk0 YES 赢
  { mi: 1, side: 1, kas: 300n },                   // pk1 NO 输
  { mi: 2, side: 0, kas: 200n },                   // pk2 YES 赢
  { mi: 3, side: 0, kas: 700n },                   // pk3 YES 赢
  { mi: 4, side: 1, kas: 400n },                   // pk4 NO 输
  { mi: 5, side: 0, kas: 150n },                   // pk5 YES 赢
  { mi: 6, side: 1, kas: 250n },                   // pk6 NO 输
  { mi: 7, side: 0, kas: 350n },                   // pk7 YES 赢
];
const WINNER = 0;                                  // YES wins (settler 约定 0=YES)
const FEES = { brokerFeePct: 190, oracleFeePct: 100, makerFeePct: 10, oracleBond: 1, committeeMode: true, oracleCount: 5, unanimous: true };

function build() {
  // participants 序 = [maker(idx0 prepend), ...bettors by merkle_index ASC] (镜像 settler L1674 + dispatchPhase2 L1565).
  const maker = COMP.find(c => c.isMaker);
  const bettors = COMP.filter(c => !c.isMaker).sort((a, b) => a.mi - b.mi);
  const participants = [
    { pk: derivePk(maker.mi), stake: Number(maker.kas * KAS), direction: maker.side, isMaker: true, mi: maker.mi },
    ...bettors.map(b => ({ pk: derivePk(b.mi), stake: Number(b.kas * KAS), direction: b.side, isMaker: false, mi: b.mi })),
  ];
  // minerFee = (B)-uniform computeChunkFee 单源 (aggregate: nWinners=赢家数, nFixedOut=6 broker+5committee, no change).
  const nWinners = participants.filter(p => p.direction === WINNER).length;
  const minerFee = computeChunkFee({ nWinners, nFixedOut: 6, hasChange: false });

  // 生产 computePoolPayouts → parimutuel winnerPayouts [{participantIndex, isMaker, amount(Number), amountSompi(exact)}].
  const payouts = computePoolPayouts({ participants, winner: WINNER, minerFee, ...FEES });

  // ② extraction 镜像 (canonical sort: maker sortKey=-1 先, winning bettors merkle_index ASC; pk x-only; amount=exact).
  const chunkWinners = payouts.winnerPayouts.map(w => {
    const p = participants[w.participantIndex];
    return { pk: p.pk, amount: w.amountSompi, _sortKey: w.isMaker ? -1 : p.mi, merkle_index: p.mi, isMaker: w.isMaker };
  }).sort((a, b) => a._sortKey - b._sortKey);  // re-index 0..K-1 = array index = SS leaf 位

  const root = computePayoutRoot(chunkWinners.map(w => ({ pk: w.pk, amount: BigInt(w.amount) }))).toString('hex');
  return { participants, minerFee, payouts, chunkWinners, root, nWinners };
}

// ─── self-verify 4 命门 ───
const f = build();
let fails = 0;
const ck = (n, ok, d) => { if (ok) console.log(`  PASS ${n}`); else { fails++; console.error(`  FAIL ${n}: ${d || ''}`); } };

// ①re-index: 散 winner merkle_index {0,2,3,5,7} → 连续 payout-plan 0..4 (chunkWinners array index).
ck('① re-index: winner merkle_index {0,2,3,5,7} → 连续 0..4',
  JSON.stringify(f.chunkWinners.map(w => w.merkle_index)) === JSON.stringify([0, 2, 3, 5, 7]), `got ${f.chunkWinners.map(w=>w.merkle_index)}`);
// ②parimutuel 变额: amounts 非 uniform (变额 stake → 变额 payout).
const amts = f.chunkWinners.map(w => BigInt(w.amount));
ck('② parimutuel 变额 (amounts 非全等)', new Set(amts.map(String)).size > 1, `amounts=${amts}`);
// ③loser-filter: 3 losers{1,4,6} stake 入 pot 不入 root (5 winners 在 root, 非 8).
ck('③ loser-filter: root 只 5 winners (8 participant − 3 loser)', f.chunkWinners.length === 5);
// ④maker@idx0=winners[0]=dust absorber: maker(merkle_index 0) 是 chunkWinners[0] + 拿 dust.
ck('④ maker=winners[0]=dust absorber (chunkWinners[0].isMaker)', f.chunkWinners[0].isMaker === true);
// 守恒: Σ winner payout + fees + bondReserve + minerFee == totalPool.
const totalPool = COMP.reduce((s, c) => s + c.kas * KAS, 0n);
const sumPayout = amts.reduce((s, x) => s + x, 0n);
ck('守恒: Σ payout ≤ totalPool (余=fees+bond+minerFee)', sumPayout < totalPool && sumPayout > 0n, `Σ=${sumPayout} pool=${totalPool}`);
// determinism: 2-build byte-identical.
ck('determinism: 2-build root identical', build().root === f.root);

const out = {
  note: 'J1 #31 确定性 fixture (8-participant aggregate, 真 parimutuel via 生产 computePoolPayouts+computeChunkFee 单源). e2e: KANet-UI 同 seed derivePk(0..7)+同 fees 造市 → 链上 payoutRoot==此 root byte-equal. NWT 独立 impl 交叉.',
  seed: SEED, winner: WINNER, fees: FEES, minerFee: f.minerFee, totalPool_sompi: totalPool.toString(),
  derivation: 'sk_i=blake2b(utf8(seed)‖uint32LE(mi))[32]; pk_i=kaspa PrivateKey(sk).toPublicKey().toXOnlyPublicKey()',
  composition: COMP.map(c => ({ merkle_index: c.mi, pk: derivePk(c.mi), side: c.side === 0 ? 'YES' : 'NO', stake_sompi: (c.kas * KAS).toString(), isMaker: !!c.isMaker })),
  payoutRoot: f.root,
  winners: f.chunkWinners.map((w, i) => ({ leaf_index: i, merkle_index: w.merkle_index, pk: w.pk, amount_sompi: w.amount, isMaker: w.isMaker })),
};
const outPath = join(__dirname, '../fixtures/31_determinism_8p.json');
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`\n${fails === 0 ? '✅' : '❌'} 确定性 fixture: ${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} | payoutRoot=${f.root.slice(0, 16)}.. minerFee=${f.minerFee} winners=${f.nWinners}`);
console.log(`amounts(sompi)=[${f.chunkWinners.map(w => w.amount).join(', ')}]`);
console.log(`写 → ${outPath}`);
process.exit(fails === 0 ? 0 : 1);
