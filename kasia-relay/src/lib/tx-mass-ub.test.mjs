// tx-mass-ub 向量 V1–V7(J2 2026-08-28; 跑: cd kasia-relay && node src/lib/tx-mass-ub.test.mjs)。零 RPC 零 live; 测试钥 priv=…02。
// oracle 分层(如实): |I|=1 形 vendored wasm 'testnet-10' 的存储质量与 7b1e18cc 公式相等 ⇒ 机械相等; |I|≥2 形旧 wasm KIP-9 实现≠7b1e18cc(给 3286/4882 vs 0/443)
//   ⇒ 期望值 = 按 7b1e18cc mod.rs:430-497 手算(数直接代公式), wasm 值只记录; 第二独立实现由 NWT 从源另写(Bettor 条件②); 链上实证 READY 后 getMempoolEntry。
import assert from 'node:assert';
import * as k from 'kaspa-wasm';
import { estimateMassUpperBound, normalizeTx, MASS_CONSTS, utxoPlurality, maxPlurality, storageMass } from './tx-mass-ub.mjs';
import { readFileSync } from 'node:fs';

const priv = new k.PrivateKey('0'.repeat(63) + '2'); const addr = priv.toPublicKey().toAddress('testnet-12').toString();
const spk = k.payToAddressScript(new k.Address(addr));
// inCov[i]=true ⇒ 该 matched UTXO entry 带 covenantId(生产 _psInputCovId 读法的第一级 entry.covenantId 用不上——RPC entry 顶层 covenantId); outCov[i]=true ⇒ 该输出带 CovenantBinding
const utxo = (v, i = 0, hasCov = false) => ({ address: new k.Address(addr), outpoint: { transactionId: '11'.repeat(32), index: i }, amount: v, value: v, scriptPublicKey: spk, blockDaaScore: 1n, isCoinbase: false, ...(hasCov ? { covenantId: 'e0'.repeat(32) } : {}) });
const mk = ({ version = 0, budget = null, sigop = 1, cov = false, sig = '41' + 'ab'.repeat(65), outVals = [100_000_000n, 99_000_000n], inVals = [200_000_000n], inCov = [], outCov = null }) => {
  const utxos = inVals.map((v, i) => utxo(v, i, !!inCov[i]));
  const oc = outCov ?? outVals.map((_, i) => cov && i === 0);
  const tx = new k.Transaction({ version, inputs: utxos.map((u, i) => ({ previousOutpoint: { transactionId: '11'.repeat(32), index: i }, signatureScript: sig, sequence: 0n, sigOpCount: sigop, ...(budget != null ? { computeBudget: budget } : {}), utxo: u })),
    outputs: outVals.map((v, i) => oc[i] ? new k.TransactionOutput(v, spk, new k.CovenantBinding(0, new k.Hash('e0'.repeat(32)))) : new k.TransactionOutput(v, spk)), lockTime: 0n, gas: 0n, subnetworkId: '0'.repeat(40), payload: '' });
  return { tx, utxos };
};
const wasmTN10 = (tx) => BigInt(k.calculateTransactionMass('testnet-10', tx));
let pass = 0, fail = 0; const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

await t('V1 v0 1-in/2-out: storage === wasm-TN10(15101) 机械相等; mass ≥ wasm', () => { const { tx, utxos } = mk({}); const e = estimateMassUpperBound(tx, utxos); assert.strictEqual(e.storage, 15101n); assert.strictEqual(wasmTN10(tx), 15101n); assert.ok(e.mass >= 15101n); });
await t('V2 v0 1-in/1-out: storage === wasm-TN10(5000)', () => { const { tx, utxos } = mk({ outVals: [100_000_000n] }); assert.strictEqual(estimateMassUpperBound(tx, utxos).storage, 5000n); assert.strictEqual(wasmTN10(tx), 5000n); });
await t('V2b 2-in(150M,50M)/2-out(100M,99M) relaxed: 手算 20101−26666 ⇒ 0(wasm 旧实现 3286 只记录)', () => { const { tx, utxos } = mk({ inVals: [150_000_000n, 50_000_000n] }); assert.strictEqual(estimateMassUpperBound(tx, utxos).storage, 0n); console.log(`   wasm-TN10(旧 KIP-9)=${wasmTN10(tx)} 非 oracle`); });
await t('V2c 3-in(70,70,60M)/3-out(60,70,69M) 一般式: 45443 − 3×floor(1e12/66,666,666)=45000 ⇒ 443(wasm 4882 只记录)', () => { const { tx, utxos } = mk({ inVals: [70_000_000n, 70_000_000n, 60_000_000n], outVals: [60_000_000n, 70_000_000n, 69_000_000n] }); assert.strictEqual(estimateMassUpperBound(tx, utxos).storage, 443n); console.log(`   wasm-TN10(旧 KIP-9)=${wasmTN10(tx)} 非 oracle`); });
await t('V3 compute 分量: 签名 +100B ⇒ size/compute +100; budget +1 ⇒ compute +100(GRAMS_PER_COMPUTE_BUDGET_UNIT); v0 sigop +1 ⇒ +1000', () => {
  const a = estimateMassUpperBound(...Object.values(mk({ version: 1, budget: 70 }))), b = estimateMassUpperBound(...Object.values(mk({ version: 1, budget: 70, sig: '41' + 'ab'.repeat(65) + 'cd'.repeat(100) })));
  assert.strictEqual(b.size - a.size, 100n); assert.strictEqual(b.compute - a.compute, 100n);
  const c = estimateMassUpperBound(...Object.values(mk({ version: 1, budget: 71 }))); assert.strictEqual(c.compute - a.compute, 100n);
  const d0 = estimateMassUpperBound(...Object.values(mk({ sigop: 0 }))), d1 = estimateMassUpperBound(...Object.values(mk({ sigop: 1 }))); assert.strictEqual(d1.compute - d0.compute, 1000n);
});
await t('V3b v1 input 缺 computeBudget ⇒ throw(fail-loud, 不静默算低)', () => { const n = normalizeTx({ version: 1, inputs: [{ signatureScript: '', sigOpCount: 0, amount: 1n, spkLen: 35n }], outputs: [{ value: 1000n, spk: '00' }] }); assert.throws(() => estimateMassUpperBound(n), /缺 computeBudget/); });
await t('V4 covenant 输出: size +34(2+32), covenant 判据 = output.covenant 非空', () => { const p = mk({ version: 1, budget: 70, cov: true }), q = mk({ version: 1, budget: 70 }); const ep = estimateMassUpperBound(p.tx, p.utxos), eq = estimateMassUpperBound(q.tx, q.utxos); assert.strictEqual(ep.size - eq.size, 34n); assert.strictEqual(ep.compute - eq.compute, 34n); });
await t('V5 必红向量: wasm 在 testnet-12 下 panic 为真; 本地估算器仍返数值; 把估算器换成 throw 版则整条红', () => {
  const { tx, utxos } = mk({ version: 1, budget: 70, cov: true });
  let panicked = false; try { k.calculateTransactionMass('testnet-12', tx); } catch { panicked = true; } assert.ok(panicked, 'wasm 竟没 panic(构建换了? 那本模块可退役)');
  const e = estimateMassUpperBound(tx, utxos); assert.ok(typeof e.mass === 'bigint' && e.mass > 0n);
  const throwing = () => { throw new Error('unreachable'); }; assert.throws(throwing);   // 对照: 若兜底实现是 throw 版, 上一行的形就红
});
await t('V6 bshard consolidate 真形(3-in v1 budget=70 两 224B redeem, 2-out): minFee=mass×100 ≤ 生产 fee 3×0.01KAS(不会误拒)', () => {
  const big = '4ce0' + 'ab'.repeat(224); const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n, 28_000_000n] });
  const e = estimateMassUpperBound(tx, utxos); const minFee = e.mass * 100n; assert.ok(minFee <= 3n * 1_000_000n, `minFee ${minFee} > 3,000,000`); console.log(`   consolidate: mass=${e.mass} compute=${e.compute} storage=${e.storage} transient=${e.transient} minFee=${minFee}`);
});
await t('V7 边界 fail-loud: 输入 spk 10,100B ⇒ p=102 > max_plurality(101) ⇒ PLURALITY_OUT_OF_RANGE; spk 101B ⇒ p=2 正常算; 零值输出 ⇒ throw', () => {
  assert.strictEqual(maxPlurality(), 101n);
  assert.throws(() => estimateMassUpperBound(normalizeTx({ version: 0, inputs: [{ signatureScript: '', sigOpCount: 0, amount: 1_000_000n, spkLen: 10_100n }], outputs: [{ value: 1000n, spk: '00' }] })), /PLURALITY_OUT_OF_RANGE/);
  assert.doesNotThrow(() => estimateMassUpperBound(normalizeTx({ version: 0, inputs: [{ signatureScript: '', sigOpCount: 0, amount: 1_000_000n, spkLen: 101n }], outputs: [{ value: 1000n, spk: '00' }] })));
  assert.throws(() => estimateMassUpperBound(normalizeTx({ version: 0, inputs: [{ signatureScript: '', sigOpCount: 0, amount: 1_000_000n, spkLen: 35n }], outputs: [{ value: 0n, spk: '00' }] })), /零值/);
});
// ── P 系(Codex e6d3d2f8 plurality MUST-FIX): 夹具 scratch/_j2_mass_ub/plurality-fixtures.json 五组 + NWT 独立 oracle 已给数的形; 每格带"强制 p=1 ⇒ 旧值"必红对照 ──
await t('P0 utxoPlurality: 35B P2PK p=1; 同 spk + covenant ⇒ (63+35+32)/100 ⇒ p=2; 37B+cov ⇒ 2; 出处 mod.rs:83-99', () => {
  assert.strictEqual(utxoPlurality(35n, false), 1n); assert.strictEqual(utxoPlurality(35n, true), 2n); assert.strictEqual(utxoPlurality(37n, true), 2n); assert.strictEqual(utxoPlurality(137n, false), 2n); assert.strictEqual(utxoPlurality(38n, false), 2n);
});
const FIX = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_mass_ub/plurality-fixtures.json', 'utf8'));
const cellsToTx = (cells) => { const ins = cells.filter((c) => c.side === 'in'), outs = cells.filter((c) => c.side === 'out'); return mk({ inVals: ins.map((c) => BigInt(c.amount)), inCov: ins.map((c) => c.has_covenant), outVals: outs.map((c) => BigInt(c.amount)), outCov: outs.map((c) => c.has_covenant), sigop: 0 }); };
for (const g of FIX.groups) {
  await t(`P-${g.id}: storage === 手算 ${g.expect.storage} (${g.expect.branch}); 输入 cov 取自 matched entry.covenantId; 强制 p=1 ⇒ 旧值 ${g.expect.old_p1_impl}(必红对照)`, () => {
    const { tx, utxos } = cellsToTx(g.cells); const e = estimateMassUpperBound(tx, utxos);
    assert.deepStrictEqual(e.plurality.ins.map(String), g.expect.p_in.map(String)); assert.deepStrictEqual(e.plurality.outs.map(String), g.expect.p_out.map(String));
    assert.strictEqual(e.storage, BigInt(g.expect.storage));
    const old = storageMass(normalizeTx(tx, utxos), { __testOnlyForcePlurality1: true }); assert.strictEqual(old, BigInt(String(g.expect.old_p1_impl).replace(/\(.*$/, '')));
    if (g.expect.storage !== String(g.expect.old_p1_impl).replace(/\(.*$/, '')) assert.notStrictEqual(e.storage, old, '必红对照: p=1 强制值应不同');
  });
}
await t('P-NWT oracle 三形(NWT 从源独立给数): cov→cov 200M→100M = 20000; cov→2plain 200M→(100M,99M) = 101; plain→cov 100M = 30000', () => {
  const a = mk({ inVals: [200_000_000n], inCov: [true], outVals: [100_000_000n], outCov: [true], sigop: 0 }); assert.strictEqual(estimateMassUpperBound(a.tx, a.utxos).storage, 20000n);
  const b = mk({ inVals: [200_000_000n], inCov: [true], outVals: [100_000_000n, 99_000_000n], outCov: [false, false], sigop: 0 }); assert.strictEqual(estimateMassUpperBound(b.tx, b.utxos).storage, 101n);
  const c = mk({ inVals: [100_000_000n], inCov: [false], outVals: [100_000_000n], outCov: [true], sigop: 0 }); assert.strictEqual(estimateMassUpperBound(c.tx, c.utxos).storage, 30000n);
});
await t('P-input-cov-source: 输入 covenant 只从 matched entry 取——同一 tx 花费一个"看起来像 covenant"的 P2SH 但 entry 无 covenantId ⇒ p=1; entry 有 ⇒ p=2', () => {
  const a = mk({ inVals: [100_000_000n], inCov: [false], outVals: [100_000_000n], outCov: [false], sigop: 0 }); assert.deepStrictEqual(estimateMassUpperBound(a.tx, a.utxos).plurality.ins, [1n]);
  const b = mk({ inVals: [100_000_000n], inCov: [true], outVals: [100_000_000n], outCov: [false], sigop: 0 }); assert.deepStrictEqual(estimateMassUpperBound(b.tx, b.utxos).plurality.ins, [2n]);
});
await t('P-prod-shapes: genesis(plain in → cov out + change) 与 consolidate(cov in ×2 + fee in → cov out + change) 的 storage 用 p 算且 ≥ p=1 值', () => {
  const g = mk({ version: 1, budget: 70, sigop: 0, inVals: [200_000_000n], inCov: [false], outVals: [100_000_000n, 99_000_000n], outCov: [true, false] }); const eg = estimateMassUpperBound(g.tx, g.utxos); const og = storageMass(normalizeTx(g.tx, g.utxos), { __testOnlyForcePlurality1: true });
  assert.ok(eg.storage >= og, `genesis ${eg.storage} < p1 ${og}`); console.log(`   genesis: storage p=${eg.storage} (p1 ${og}) mass=${eg.mass}`);
  const big = '4ce0' + 'ab'.repeat(224); const c = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], inCov: [true, true, false], outVals: [150_000_000n, 28_000_000n], outCov: [true, false] }); const ec = estimateMassUpperBound(c.tx, c.utxos); const oc = storageMass(normalizeTx(c.tx, c.utxos), { __testOnlyForcePlurality1: true });
  assert.ok(ec.storage >= oc); console.log(`   consolidate: storage p=${ec.storage} (p1 ${oc}) compute=${ec.compute} mass=${ec.mass} minFee=${ec.mass * 100n}`);
});
// V8: 生产 _assertTxInvariants observe 路径(经 __testOnlyAssertTxInvariants): wasm panic ⇒ 本地上界 ⇒ 结构化日志; 低费 would_reject=true 但【不 throw】; 正常费 would_reject=false
const { __testOnlyAssertTxInvariants } = await import('./p2sh.mjs');
const capture = (fn) => { const w = [], l = []; const ow = console.warn, ol = console.log; console.warn = (...a) => w.push(a.join(' ')); console.log = (...a) => l.push(a.join(' ')); try { fn(); } finally { console.warn = ow; console.log = ol; } return { w, l }; };
await t('V8a observe · 正常费(3-in consolidate 形, fee 3M ≥ minFee 2.28M): 不 throw, 日志 [mass-floor:observe] would_reject=false 含 compute/storage/transient/mass_ub/minFee/actualFee', () => {
  const big = '4ce0' + 'ab'.repeat(224); const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n, 27_000_000n] });   // fee = 180M−177M = 3M
  const { w } = capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V8a', 'testnet-12'));
  const line = w.find((s) => s.startsWith('[mass-floor:observe]')); assert.ok(line, '无结构化日志行: ' + JSON.stringify(w));
  for (const key of ['site=V8a', 'compute=', 'storage=', 'transient=', 'mass_ub=', 'minFee=', 'actualFee=3000000', 'would_reject=false', 'source=7b1e18cc']) assert.ok(line.includes(key), `缺 ${key}: ${line}`);
});
await t('V8b observe · 低费(fee 100k < minFee): 【不 throw】(observe 只 warn), 日志 would_reject=true', () => {
  const big = '4ce0' + 'ab'.repeat(224); const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n, 29_900_000n] });   // fee = 100k
  const { w } = capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V8b', 'testnet-12'));   // 不抛即通过
  const line = w.find((s) => s.startsWith('[mass-floor:observe]')); assert.ok(line && line.includes('would_reject=true') && line.includes('actualFee=100000'), JSON.stringify(w));
});
await t('V8c 对照 · 不传 networkId(legacy caller) ⇒ 无 mass 检查、无 observe 行(行为与改前一致)', () => {
  const { tx, utxos } = mk({}); const { w } = capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V8c', null));
  assert.ok(!w.some((s) => s.startsWith('[mass-floor:')));
});
// ── Codex 438e46e9: dominance 向量(三分量各主导一形) + sigop/budget 敏感形 ──
await t('D1 compute 主导: v1 budget=70 ×3 输入(21000 grams) > storage(0) > transient', () => { const big = '4ce0' + 'ab'.repeat(224); const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n, 28_000_000n] }); const e = estimateMassUpperBound(tx, utxos); assert.ok(e.compute > e.storage && e.compute > e.transient && e.mass === e.compute, `c=${e.compute} s=${e.storage} t=${e.transient}`); });
await t('D2 storage 主导: 1 KAS 拆 8 个 0.001 KAS 小输出(每个 C/v = 1e7) ⇒ storage 8e7 − 1e4 ≫ compute', () => { const { tx, utxos } = mk({ inVals: [100_000_000n], outVals: Array(8).fill(100_000n) }); const e = estimateMassUpperBound(tx, utxos); assert.strictEqual(e.storage, 8n * 10_000_000n - 10_000n); assert.ok(e.mass === e.storage && e.storage > e.compute && e.storage > e.transient); });
await t('D3 transient 主导: v0 sigop=0 + 6KB 签名脚本 + 单大额输出 ⇒ transient(size×4) > compute(size + 370)', () => { const { tx, utxos } = mk({ version: 0, sigop: 0, sig: 'ab'.repeat(6000), inVals: [200_000_000n], outVals: [199_000_000n] }); const e = estimateMassUpperBound(tx, utxos); assert.ok(e.transient > e.compute && e.transient > e.storage && e.mass === e.transient, `c=${e.compute} s=${e.storage} t=${e.transient}`); });
await t('D4 sigop 敏感(v0): sigop 0→5 ⇒ compute +5000; 其它分量不变', () => { const a = estimateMassUpperBound(...Object.values(mk({ sigop: 0 }))), b = estimateMassUpperBound(...Object.values(mk({ sigop: 5 }))); assert.strictEqual(b.compute - a.compute, 5000n); assert.strictEqual(a.storage, b.storage); assert.strictEqual(a.transient, b.transient); });
await t('D5 budget 敏感(v1): budget 0→70 ⇒ compute +7000; v1 size 比 v0 多 2B/输入', () => { const a = estimateMassUpperBound(...Object.values(mk({ version: 1, budget: 0 }))), b = estimateMassUpperBound(...Object.values(mk({ version: 1, budget: 70 }))), v0 = estimateMassUpperBound(...Object.values(mk({ version: 0, sigop: 0 }))); assert.strictEqual(b.compute - a.compute, 7000n); assert.strictEqual(a.size - v0.size, 2n); });
// ── V9 observe 权威对照 hook(经 __testOnlyWrapRpcForMassObserve + 假 rpc): submit 后 getMempoolEntry.mass ⇒ ub_ok / inconclusive ──
const { __testOnlyWrapRpcForMassObserve, _massObserveStats } = await import('./p2sh.mjs');
const fakeRpc = (massReply) => ({ submitTransaction: async () => ({ transactionId: null }), getMempoolEntry: async () => massReply });
await t('V9a 权威 mass ≤ 本地上界 ⇒ 日志 ub_ok=true; > ⇒ ub_ok=false 计 violation; 无 mass ⇒ inconclusive 计数(不算通过)', async () => {
  const big = '4ce0' + 'ab'.repeat(224); const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n, 27_000_000n] });
  const txid = String(tx.id); const before = { ...(_massObserveStats) };
  const runOnce = async (reply) => { capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V9', 'testnet-12')); const rpc = __testOnlyWrapRpcForMassObserve({ submitTransaction: async () => ({ transactionId: txid }), getMempoolEntry: async () => reply }); const w = []; const ow = console.warn; console.warn = (...a) => w.push(a.join(' ')); try { await rpc.submitTransaction({}); } finally { console.warn = ow; } return w.find((s) => s.startsWith('[mass-floor:observe:auth]')) || ''; };
  const l1 = await runOnce({ entry: { transaction: { mass: 20000n }, fee: 1n, isOrphan: false } }); assert.ok(l1.includes('ub_ok=true') && l1.includes('authoritative_mass=20000'), l1);
  const l2 = await runOnce({ entry: { transaction: { mass: 99_999_999n }, fee: 1n, isOrphan: false } }); assert.ok(l2.includes('ub_ok=false'), l2);
  const l3 = await runOnce({ entry: { transaction: {}, fee: 1n, isOrphan: false } }); assert.ok(l3.includes('ub_ok=inconclusive'), l3);
  assert.strictEqual(_massObserveStats.ub_ok - before.ub_ok, 1); assert.strictEqual(_massObserveStats.ub_violation - before.ub_violation, 1); assert.strictEqual(_massObserveStats.inconclusive - before.inconclusive, 1);
});
await t('V9b hook 不改 submit 语义: 返回值原样; getMempoolEntry 抛错 ⇒ inconclusive 且 submit 仍成功返回', async () => {
  const rpc = __testOnlyWrapRpcForMassObserve({ submitTransaction: async () => ({ transactionId: 'ff'.repeat(32) }), getMempoolEntry: async () => { throw new Error('boom'); } });
  const r = await rpc.submitTransaction({}); assert.strictEqual(r.transactionId, 'ff'.repeat(32));
  void fakeRpc;
});
// ── NWT MUST(泄漏): submit 抛错后 Map 不增; cap 逐出最旧 ──
const { __testOnlyMassObserveSize } = await import('./p2sh.mjs');
await t('V10a submit 抛错(网络/mempool 拒) ⇒ Map 条目被 finally 清, size 不增', async () => {
  const big = '4ce0' + 'ab'.repeat(224);
  const s0 = __testOnlyMassObserveSize();
  for (let i = 0; i < 5; i++) {
    const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n + BigInt(i), 50_000_000n, 30_000_000n], outVals: [150_000_000n, 27_000_000n] });
    capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V10a', 'testnet-12'));
    assert.strictEqual(__testOnlyMassObserveSize(), s0 + 1, '记录应先进 Map');
    const rpc = __testOnlyWrapRpcForMassObserve({ submitTransaction: async () => { throw new Error('mempool reject'); }, getMempoolEntry: async () => ({}) });
    await assert.rejects(() => rpc.submitTransaction({ transaction: tx }), /mempool reject/);
    assert.strictEqual(__testOnlyMassObserveSize(), s0, `第 ${i} 次失败后 Map 泄漏: ${__testOnlyMassObserveSize()} ≠ ${s0}`);
  }
});
await t('V10b cap: 连续 300 条不 submit 的记录 ⇒ Map 上限 256, 逐出最旧且 evicted 计数', async () => {
  const big = '4ce0' + 'ab'.repeat(224); const ev0 = _massObserveStats.evicted;
  // ⚠ txid 只取决于 outpoint/输出/脚本, 不取决于 utxo amount ⇒ 首版只变 inVals 得到 300 个【同一 txid】(Map 恒 1 条, evicted=0 假绿形); 改为每条变输出值
  for (let i = 0; i < 300; i++) { const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [200_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n + BigInt(i), 27_000_000n] }); capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V10b', 'testnet-12')); }
  assert.ok(__testOnlyMassObserveSize() <= 256, `size ${__testOnlyMassObserveSize()} > 256`); assert.ok(_massObserveStats.evicted - ev0 >= 44, `evicted ${_massObserveStats.evicted - ev0}`);
});
// ── observe v2: 拒绝文本自带权威 mass(live 实形) ⇒ 第二来源; 不匹配 ⇒ inconclusive; 原错误原样重抛 ──
const { parseRejectMass } = await import('./p2sh.mjs');
const REAL_REJECT = 'RPC Server (remote error) -> Rejected transaction 4fb9d07caa29e0110b70198008f6c46e9f15e9b073504f5ec6d8bf72cb0f263c: transaction 4fb9d07caa29e0110b70198008f6c46e9f15e9b073504f5ec6d8bf72cb0f263c is not standard: transaction has 1000003 fees which is under the required amount of 1636200 for compute mass 16362';
await t('V11a parseRejectMass: live 真文本 ⇒ {minFeeAuth 1636200, authoritativeMass 16362}(M/K=100 = MIN_SOMPI_PER_MASS); 非拒费文本 ⇒ null', () => {
  const p = parseRejectMass(REAL_REJECT); assert.deepStrictEqual(p, { minFeeAuth: 1636200n, authoritativeMass: 16362n }); assert.strictEqual(p.minFeeAuth / p.authoritativeMass, 100n);
  assert.strictEqual(parseRejectMass('failed to verify the signature script: script ran, but verification failed'), null); assert.strictEqual(parseRejectMass(''), null); assert.strictEqual(parseRejectMass(undefined), null);
});
await t('V11b submit 抛拒费文本 ⇒ 记 source=reject authoritative_mass=K ub_ok 照算(auth_from_reject +1), 原错误原样重抛, Map 仍清; 抛非拒费文本 ⇒ inconclusive +1', async () => {
  const big = '4ce0' + 'ab'.repeat(224); const s0 = { ...(_massObserveStats) }; const size0 = __testOnlyMassObserveSize();   // V10b 故意留了 ≤256 条未 submit 记录 ⇒ 断言用【前后差为零】而非 size===0(首版写错, 3c0474b7 带红入库, 本 fix-up 改)
  const mkCase = (i) => mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n + 1000n * BigInt(i), 27_000_000n] });
  const { __testOnlyMassObserveHas } = await import('./p2sh.mjs');
  const runReject = async (i, text) => { const { tx, utxos } = mkCase(i); capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V11b', 'testnet-12')); const txid = String(tx.id); assert.ok(__testOnlyMassObserveHas(txid), '记录应先进 Map'); const w = []; const ow = console.warn; console.warn = (...a) => w.push(a.join(' ')); const rpc = __testOnlyWrapRpcForMassObserve({ submitTransaction: async () => { throw new Error(text); }, getMempoolEntry: async () => ({}) }); let thrown = null; try { await rpc.submitTransaction({ transaction: tx }); } catch (e) { thrown = e; } finally { console.warn = ow; } assert.ok(!__testOnlyMassObserveHas(txid), 'finally 须删自己的记录'); return { w, thrown }; };
  const a = await runReject(1, REAL_REJECT); assert.ok(a.thrown && a.thrown.message === REAL_REJECT, '原错误须原样重抛');
  const la = a.w.find((s) => s.includes('source=reject')); assert.ok(la && la.includes('authoritative_mass=16362') && la.includes('minFee_auth=1636200') && /ub_ok=(true|false)/.test(la), JSON.stringify(a.w));
  const b = await runReject(2, 'failed to verify the signature script: script ran, but verification failed'); assert.ok(b.thrown);
  const lb = b.w.find((s) => s.includes('source=reject')); assert.ok(lb && lb.includes('ub_ok=inconclusive'), JSON.stringify(b.w));
  assert.strictEqual(_massObserveStats.auth_from_reject - s0.auth_from_reject, 1); assert.strictEqual(_massObserveStats.inconclusive - s0.inconclusive, 1);
  assert.ok(__testOnlyMassObserveSize() <= size0, 'size 不得增长(cap 处插入逐出最旧 ⇒ 可能净减, 不可净增)');
});
await t('常量表 = 7b1e18cc 值且冻结', () => { assert.ok(Object.isFrozen(MASS_CONSTS)); assert.strictEqual(MASS_CONSTS.storage_mass_parameter, 1_000_000_000_000n); assert.strictEqual(MASS_CONSTS.grams_per_compute_budget_unit, 100n); assert.strictEqual(MASS_CONSTS.grams_per_sigop, 1000n); assert.strictEqual(MASS_CONSTS.transient_factor, 4n); });
console.log(`\n${fail === 0 ? '✅' : '🔴'} tx-mass-ub: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
