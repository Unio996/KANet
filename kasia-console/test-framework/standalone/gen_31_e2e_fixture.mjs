// J1tn #31 — gate B 跨节点 chunked-settle e2e 数据备料 (Bettor【必回】"别让 e2e 卡在没数据").
//
// 产**确定性 100-winner fixture** = e2e 的 expected 参考: winner 集(pk+amount merkle_index ASC) + payoutRoot
//   + 预期 chunk partition(每 chunk seg + winners + change). on-chain e2e(④落)用此造市+settle, 逐 chunk 验
//   实际 output {pk-derive addr, amount} == fixture 期望 + payoutRoot byte-equal(两节点).
//
// 性质: 纯 off-chain 确定性 DATA-gen(我域可现出, 非 gated). on-chain 造市(market_publish v08 + 100 bettor
//   register + fund pool-lock) = gated on ② v08 create wire — 那步 seed→真 keypair 注册, 此 fixture 是 expected 参考.
//
// run: node test-framework/standalone/gen_31_e2e_fixture.mjs   (输出 fixture JSON + 自验 determinism)
//   写 fixtures/31_e2e_100winner.json (e2e harness Phase C/D + on-chain setup 共用).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { blake2b } from '@noble/hashes/blake2b';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_LIB = join(__dirname, '../../src/lib');
const imp = (rel) => import(pathToFileURL(join(SRC_LIB, rel)).href);
const { computeSettleChunks } = await imp('pool-settle-chunks.mjs');
const { payoutRoot } = await imp('pool-payout-root.mjs');
const kaspa = await import('kaspa-wasm');

// —— (A) shared deterministic seed → 真 keypair (KANet-UI 造市用同 seed 同派生法 → 同 100 keypair → 链上
//    bettor_pk == fixture pk → 链上 payoutRoot == fixture payoutRoot byte-equal; NWT 独立重算交叉验 root). ——
// **公开派生法 (KANet-UI 复现铁律)**: sk_i = blake2b(utf8(SEED) ‖ uint32LE(i))[32]; pk_i = kaspa.PrivateKey(sk_i)
//   .toPublicKey().toXOnlyPublicKey() (64-hex x-only). privkey 派自 seed → KANet-UI 可签 bettor register.
const SEED = 'KANET-31-E2E-FIXTURE-SEED-v1';
function deriveSk(i) {
  const idx = Buffer.alloc(4); idx.writeUInt32LE(i);
  return Buffer.from(blake2b(Buffer.concat([Buffer.from(SEED, 'utf8'), idx]), { dkLen: 32 })).toString('hex');
}
function derivePk(i) {
  return new kaspa.PrivateKey(deriveSk(i)).toPublicKey().toXOnlyPublicKey().toString();
}

// —— fixture 参数 (Bettor 100-winner/3-chunk; 1 KAS 均匀全 winning side → 100 winner storage-bound → [40,47,13]) ——
const N_WINNERS = 100;
const STAKE_SOMPI = 1e8;                  // 1 KAS/bettor (= API min-bet floor)
const POOL_VALUE = N_WINNERS * STAKE_SOMPI + 1e9;   // 100 KAS + 10 KAS fee/fixed headroom
const ORACLE_BOND = 1.2e8;
const FIXED = [{ value: 5e7 }, ...Array.from({ length: 5 }, () => ({ value: ORACLE_BOND }))];  // broker + 5 committee

// winner pk = seed 派生**真 XOnlyPublicKey** (merkle_index = i; KANet-UI 同 seed 同派生 → 链上 bettor_pk == 此 → payoutRoot byte-equal).
function mkWinners(n) {
  return Array.from({ length: n }, (_, i) => ({
    merkle_index: i,
    pk: derivePk(i),                  // 真 x-only pk (seed→PrivateKey→toPublicKey→toXOnlyPublicKey), 非占位
    amount: STAKE_SOMPI,              // 真 e2e: computePoolPayouts BigInt(此 fixture 1KAS 均匀全 winning side)
  }));
}

function build() {
  const winners = mkWinners(N_WINNERS);
  const root = payoutRoot(winners).toString('hex');
  const plan = computeSettleChunks(winners, FIXED, POOL_VALUE, root);

  // 每 chunk 期望 outputs (e2e 逐 chunk check_utxo_landed 比对): winner 子段 {merkle_index, pk, amount} + change.
  const chunks = plan.chunks.map((c, i) => ({
    idx: i,
    kind: c.kind, chunk_kind: c.chunk_kind,
    seg_lo: c.seg_lo, seg_hi: c.seg_hi, segLen: c.seg_hi - c.seg_lo,
    winners: c.winners.map((w, k) => ({ merkle_index: c.seg_lo + k, pk: w.pk, amount: w.amount })),
    change: c.change,
    // chunk_0 额外 6 fixed 输出 (broker out0 + 5 committee out1-5); e2e 验 addr==pk-derive + value floor.
    fixedOutputs: c.chunk_kind === 0 ? { broker_value: FIXED[0].value, committee_bond: ORACLE_BOND } : null,
  }));

  return {
    note: 'J1 #31 e2e expected fixture (A: seed-派生真 keypair). on-chain e2e(④): KANet-UI 用同 seed 同派生法造 100-winner v08 市场 → settle → 逐 chunk 验 output{pk-derive addr, amount} == 此期望 + 链上 payoutRoot == 此 payoutRoot byte-equal. NWT 独立 impl 重算 payoutRoot 交叉验(2-impl 抓共享 builder bug).',
    // —— (A) 派生契约 (KANet-UI 复现铁律 + NWT 独立重算锚) ——
    seed: SEED,
    derivation: 'sk_i = blake2b(utf8(seed) ‖ uint32LE(i))[dkLen32]; pk_i = kaspa-wasm PrivateKey(sk_i).toPublicKey().toXOnlyPublicKey() (64-hex x-only); i=0..99 (merkle_index)',
    n_winners: N_WINNERS, stake_sompi: STAKE_SOMPI, pool_value: POOL_VALUE,
    payoutRoot: root,                 // = pool-payout-root.mjs(真 pk) → NWT 独立 impl 须重算出同值 (cross-check)
    route: plan.route, numChunks: plan.numChunks,
    segLens: plan.chunks.map(c => c.seg_hi - c.seg_lo),
    chunks,
  };
}

// —— 自验 determinism (两次 build byte-identical = 确定性) + 结构 sanity ——
const f1 = build();
const f2 = build();
let fails = 0;
const ck = (n, ok, d) => { if (ok) console.log(`  PASS ${n}`); else { fails++; console.error(`  FAIL ${n}: ${d || ''}`); } };

ck('determinism: 两次 build byte-identical', JSON.stringify(f1) === JSON.stringify(f2));
ck('payoutRoot 64-hex', f1.payoutRoot.length === 64);
ck(`partition = [40,47,13] (100-winner storage-bound)`, JSON.stringify(f1.segLens) === JSON.stringify([40, 47, 13]), `got [${f1.segLens}]`);
ck('seg coverage 0..100 连续', f1.chunks[0].seg_lo === 0 && f1.chunks[f1.chunks.length - 1].seg_hi === N_WINNERS
  && f1.chunks.every((c, i) => i === 0 || c.seg_lo === f1.chunks[i - 1].seg_hi));
ck('末 chunk change==0', f1.chunks[f1.chunks.length - 1].change === 0);
ck('每 winner ∈ 恰 1 chunk (Σ segLen == 100)', f1.chunks.reduce((s, c) => s + c.segLen, 0) === N_WINNERS);

const outPath = join(__dirname, '../fixtures/31_e2e_100winner.json');
writeFileSync(outPath, JSON.stringify(f1, null, 1));
console.log(`\n${fails === 0 ? '✅' : '❌'} fixture-gen: ${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} | payoutRoot=${f1.payoutRoot.slice(0, 16)}.. partition=[${f1.segLens}]`);
console.log(`写 fixture → ${outPath} (e2e Phase C/D + on-chain setup 共用)`);
process.exit(fails === 0 ? 0 : 1);
