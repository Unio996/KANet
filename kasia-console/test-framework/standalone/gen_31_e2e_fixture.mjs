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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_LIB = join(__dirname, '../../src/lib');
const imp = (rel) => import(pathToFileURL(join(SRC_LIB, rel)).href);
const { computeSettleChunks } = await imp('pool-settle-chunks.mjs');
const { payoutRoot } = await imp('pool-payout-root.mjs');

// —— fixture 参数 (Bettor 100-winner/3-chunk; 1 KAS 均匀全 winning side → 100 winner storage-bound → [40,47,13]) ——
const N_WINNERS = 100;
const STAKE_SOMPI = 1e8;                  // 1 KAS/bettor (= API min-bet floor)
const POOL_VALUE = N_WINNERS * STAKE_SOMPI + 1e9;   // 100 KAS + 10 KAS fee/fixed headroom
const ORACLE_BOND = 1.2e8;
const FIXED = [{ value: 5e7 }, ...Array.from({ length: 5 }, () => ({ value: ORACLE_BOND }))];  // broker + 5 committee

// 确定性 winner pk (merkle_index = i; 真 e2e: seed→keypair 派生, 此 fixture pk = 确定占位, on-chain setup 替真 keypair).
//   ⚠ 真 on-chain 须真 keypair(注册需签); 此 fixture 的 pk 仅供 payoutRoot/partition determinism 参考.
function mkWinners(n) {
  return Array.from({ length: n }, (_, i) => ({
    merkle_index: i,
    pk: ((i % 250) + 1).toString(16).padStart(2, '0').repeat(32),  // 占位确定 pk (on-chain: seed→真 XOnlyPublicKey)
    amount: STAKE_SOMPI,                                            // 真 e2e: computePoolPayouts BigInt(此 fixture 均匀)
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
    note: 'J1 #31 e2e expected fixture (off-chain deterministic). on-chain e2e(④) 造此 100-winner v08 市场 → settle → 逐 chunk 验 output{pk-derive addr, amount} == 此期望 + payoutRoot byte-equal 两节点. pk 为确定占位, on-chain setup seed→真 keypair.',
    n_winners: N_WINNERS, stake_sompi: STAKE_SOMPI, pool_value: POOL_VALUE,
    payoutRoot: root,
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
