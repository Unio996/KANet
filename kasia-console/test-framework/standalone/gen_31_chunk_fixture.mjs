// J1tn #31 — gate B >47-winner CHUNK e2e fixture (#31 核心创新链上验: entry0 settle_chunk payoutRoot climb + chunk-chain).
//
// fixture-must-mirror-production: 生产 computePoolPayouts(真 parimutuel) + computeChunkFee(§1⑥ global minerFee =
//   Σ_i computeChunkFee(per-chunk args), count-based 非循环 under FLOOR) → 单全局 payoutRoot 跨全 winner → chunk 真锚.
//   组成 = KANet-UI 设计(119 participant, derivePk(0..118), seed KANET-31-E2E-FIXTURE-SEED-v1):
//     mi==0 maker YES 100KAS; mi∈LOSER_MI NO; else winner YES (变额 ~1.2-3KAS, FLOOR-safe ≥1KAS).
//   → 111 winner(含 maker) → 小 payout → mass>470k → chunk. partition 由 computeSettleChunks 实算(变额 mass).
//
// §1⑥ global minerFee (J1/J2 co-design): Σ_i computeChunkFee(chunk_i: nFixedOut=i==0?6:0, hasChange=i<last).
//   count-based(FLOOR→47-cap-bound partition 不依赖 payout)→ 确定性 → byte-equal. provisional→partition→Σfee→final 一步收敛.
// run: node test-framework/standalone/gen_31_chunk_fixture.mjs   (自验 + 对 J2 值 149897660/[47,47,17], exit 0=PASS).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_LIB = join(__dirname, '../../src/lib');
const imp = (rel) => import(pathToFileURL(join(SRC_LIB, rel)).href);
const { computeChunkFee, computeSettleChunks } = await imp('pool-settle-chunks.mjs');
const settler = await import(pathToFileURL(join(__dirname, '../../src/services/pool-market-settler.js')).href);
const { computePoolPayouts } = settler;
const { payoutRoot: computePayoutRoot } = await imp('pool-payout-root.mjs');
const kaspa = await import('kaspa-wasm');
const { blake2b } = await import('@noble/hashes/blake2b');

const SEED = 'KANET-31-E2E-FIXTURE-SEED-v1';
const derivePk = (i) => {
  const idx = Buffer.alloc(4); idx.writeUInt32LE(i);
  const sk = Buffer.from(blake2b(Buffer.concat([Buffer.from(SEED, 'utf8'), idx]), { dkLen: 32 })).toString('hex');
  return new kaspa.PrivateKey(sk).toPublicKey().toXOnlyPublicKey().toString();
};

// —— KANet-UI 组成规则 (确定性, derivePk(0..118)) ——
const N = 119;
const LOSER_MI = new Set([1, 16, 31, 46, 61, 76, 91, 106]);
const KAS = 100000000n;
function kasOf(mi) {
  if (mi === 0) return 100;
  if (LOSER_MI.has(mi)) return 1.0 + ((mi * 3) % 11) * 0.1;
  return Math.round((1.2 + ((mi * 7) % 19) * 0.1) * 100) / 100;
}
const WINNER = 0;  // YES wins
const FEES = { brokerFeePct: 190, oracleFeePct: 100, makerFeePct: 10, oracleBond: 1, committeeMode: true, oracleCount: 5, unanimous: true };

// participants 序 = [maker idx0, ...bettors merkle_index ASC] (镜像 settler L1674/dispatchPhase2 L1565).
const COMP = Array.from({ length: N }, (_, mi) => ({
  mi, side: (mi === 0 || !LOSER_MI.has(mi)) ? 0 : 1, kas: kasOf(mi), isMaker: mi === 0,
}));
const maker = COMP[0];
const bettors = COMP.slice(1).sort((a, b) => a.mi - b.mi);
const participants = [
  { pk: derivePk(0), stake: Math.round(maker.kas * 1e8), direction: maker.side, isMaker: true, mi: 0 },
  ...bettors.map(b => ({ pk: derivePk(b.mi), stake: Math.round(b.kas * 1e8), direction: b.side, isMaker: false, mi: b.mi })),
];

// canonical sort → chunkWinners (maker@-1 先, winning bettors merkle_index ASC; amount=exact amountSompi).
function toChunkWinners(payouts) {
  return payouts.winnerPayouts.map(w => {
    const p = participants[w.participantIndex];
    return { pk: p.pk, amount: w.amountSompi, _sortKey: w.isMaker ? -1 : p.mi, merkle_index: p.mi, isMaker: w.isMaker };
  }).sort((a, b) => a._sortKey - b._sortKey);
}
// §1⑥ global minerFee = Σ_i computeChunkFee(per-chunk args) from a partition.
function globalMinerFee(chunks) {
  return chunks.reduce((sum, c, i) => {
    const isLast = i === chunks.length - 1;
    return sum + computeChunkFee({ nWinners: c.seg_hi - c.seg_lo, nFixedOut: i === 0 ? 6 : 0, hasChange: !isLast });
  }, 0);
}

function build() {
  const poolValue = participants.reduce((s, p) => s + p.stake, 0) + 5;  // + oracle bond inputs (5×1 sompi)
  // §1⑥ 一步收敛: provisional minerFee → partition → Σfee → final. FIXED(broker+committee)从 payouts 算(uniform 假设, 待 J2 确认).
  let minerFee = computeChunkFee({ nWinners: 47, nFixedOut: 6, hasChange: true }) * 3;  // provisional upper guess
  let plan, chunkWinners, perChunkFees = [], FIXED = [];
  for (let iter = 0; iter < 5; iter++) {
    const payouts = computePoolPayouts({ participants, winner: WINNER, minerFee, ...FEES });
    // chunk_0 fixed outputs = broker(brokerFee) + 5 committee(oracleBond + oracleFeeTotal/5 share, uniform 近似).
    const committeeVal = FEES.oracleBond + Math.floor(payouts.oracleFeeTotal / 5);
    FIXED = [{ value: payouts.brokerFee }, ...Array.from({ length: 5 }, () => ({ value: committeeVal }))];
    chunkWinners = toChunkWinners(payouts).map(({ pk, amount }) => ({ pk, amount }));
    const root = computePayoutRoot(chunkWinners).toString('hex');
    plan = computeSettleChunks(chunkWinners, FIXED, poolValue, root);
    perChunkFees = plan.chunks.map((c, i) => computeChunkFee({ nWinners: c.seg_hi - c.seg_lo, nFixedOut: i === 0 ? 6 : 0, hasChange: i < plan.chunks.length - 1 }));
    const newFee = perChunkFees.reduce((s, f) => s + f, 0);
    if (newFee === minerFee) break;  // count-stable convergence
    minerFee = newFee;
  }
  const payouts = computePoolPayouts({ participants, winner: WINNER, minerFee, ...FEES });
  chunkWinners = toChunkWinners(payouts);
  const root = computePayoutRoot(chunkWinners.map(w => ({ pk: w.pk, amount: BigInt(w.amount) }))).toString('hex');
  return { minerFee, perChunkFees, plan, chunkWinners, root, poolValue };
}

const f = build();
const segLens = f.plan.chunks.map(c => c.seg_hi - c.seg_lo);
let fails = 0;
const ck = (n, ok, d) => { if (ok) console.log(`  PASS ${n}`); else { fails++; console.error(`  FAIL ${n}: ${d || ''}`); } };

ck(`route=chunk (mass>470k, >47 winner)`, f.plan.route === 'chunk', `route=${f.plan.route}`);
ck(`partition [47,47,17] == J2 实算`, JSON.stringify(segLens) === JSON.stringify([47, 47, 17]), `got [${segLens}]`);
ck(`§1⑥ global minerFee == J2 149897660`, f.minerFee === 149897660, `got ${f.minerFee} (per-chunk=[${f.perChunkFees}])`);
ck(`per-chunk fees == J2 [67346070,60491970,22059620]`, JSON.stringify(f.perChunkFees) === JSON.stringify([67346070, 60491970, 22059620]), `got [${f.perChunkFees}]`);
ck(`单全局 payoutRoot 跨全 ${f.chunkWinners.length} winner (一 root)`, f.root.length === 64 && f.chunkWinners.length === 111);
ck(`末 chunk change==0`, BigInt(f.plan.chunks[f.plan.chunks.length - 1].change) === 0n);
ck(`seg 全局连续 0..111 (leaf index 全局非 per-chunk 重置)`, f.plan.chunks[0].seg_lo === 0 && f.plan.chunks[f.plan.chunks.length - 1].seg_hi === 111 && f.plan.chunks.every((c, i) => i === 0 || c.seg_lo === f.plan.chunks[i - 1].seg_hi));
ck(`maker=winners[0]=dust absorber`, f.chunkWinners[0].isMaker === true);
ck(`determinism 2-build`, build().root === f.root);

const out = {
  note: 'J1 #31 CHUNK fixture(>47 winner, entry0 settle_chunk 链上 payoutRoot climb). 单全局 payoutRoot 跨全 111 winner; chunk leaf=全局连续 0..110. §1⑥ global minerFee=Σ per-chunk computeChunkFee(count-based). KANet-UI 同 seed 造市→链上 chunk_0 commit payoutRoot==此 root byte-equal.',
  seed: SEED, winner: WINNER, fees: FEES, globalMinerFee: f.minerFee, perChunkFees: f.perChunkFees,
  n_winners: f.chunkWinners.length, route: f.plan.route, segLens,
  payoutRoot: f.root,
  partition: f.plan.chunks.map((c, i) => ({ idx: i, chunk_kind: c.chunk_kind, seg_lo: c.seg_lo, seg_hi: c.seg_hi, segLen: c.seg_hi - c.seg_lo, change: c.change })),
  winners: f.chunkWinners.map((w, i) => ({ leaf_index: i, merkle_index: w.merkle_index, pk: w.pk, amount_sompi: w.amount, isMaker: w.isMaker })),
};
writeFileSync(join(__dirname, '../fixtures/31_chunk_119p.json'), JSON.stringify(out, null, 1));
console.log(`\n${fails === 0 ? '✅' : '❌'} CHUNK fixture: ${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} | payoutRoot=${f.root.slice(0, 16)}.. globalMinerFee=${f.minerFee} segLens=[${segLens}] winners=${f.chunkWinners.length}`);
process.exit(fails === 0 ? 0 : 1);
