// tx-mass-ub 向量 V1–V7(J2 2026-08-28; 跑: cd kasia-relay && node src/lib/tx-mass-ub.test.mjs)。零 RPC 零 live; 测试钥 priv=…02。
// oracle 分层(如实): |I|=1 形 vendored wasm 'testnet-10' 的存储质量与 7b1e18cc 公式相等 ⇒ 机械相等; |I|≥2 形旧 wasm KIP-9 实现≠7b1e18cc(给 3286/4882 vs 0/443)
//   ⇒ 期望值 = 按 7b1e18cc mod.rs:430-497 手算(数直接代公式), wasm 值只记录; 第二独立实现由 NWT 从源另写(Bettor 条件②); 链上实证 READY 后 getMempoolEntry。
import assert from 'node:assert';
import * as k from 'kaspa-wasm';
import { estimateMassUpperBound, normalizeTx, MASS_CONSTS } from './tx-mass-ub.mjs';

const priv = new k.PrivateKey('0'.repeat(63) + '2'); const addr = priv.toPublicKey().toAddress('testnet-12').toString();
const spk = k.payToAddressScript(new k.Address(addr));
const utxo = (v, i = 0) => ({ address: new k.Address(addr), outpoint: { transactionId: '11'.repeat(32), index: i }, amount: v, value: v, scriptPublicKey: spk, blockDaaScore: 1n, isCoinbase: false });
const mk = ({ version = 0, budget = null, sigop = 1, cov = false, sig = '41' + 'ab'.repeat(65), outVals = [100_000_000n, 99_000_000n], inVals = [200_000_000n] }) => {
  const utxos = inVals.map((v, i) => utxo(v, i));
  const tx = new k.Transaction({ version, inputs: utxos.map((u, i) => ({ previousOutpoint: { transactionId: '11'.repeat(32), index: i }, signatureScript: sig, sequence: 0n, sigOpCount: sigop, ...(budget != null ? { computeBudget: budget } : {}), utxo: u })),
    outputs: outVals.map((v, i) => (cov && i === 0) ? new k.TransactionOutput(v, spk, new k.CovenantBinding(0, new k.Hash('e0'.repeat(32)))) : new k.TransactionOutput(v, spk)), lockTime: 0n, gas: 0n, subnetworkId: '0'.repeat(40), payload: '' });
  return { tx, utxos };
};
const wasmTN10 = (tx) => BigInt(k.calculateTransactionMass('testnet-10', tx));
let pass = 0, fail = 0; const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

t('V1 v0 1-in/2-out: storage === wasm-TN10(15101) 机械相等; mass ≥ wasm', () => { const { tx, utxos } = mk({}); const e = estimateMassUpperBound(tx, utxos); assert.strictEqual(e.storage, 15101n); assert.strictEqual(wasmTN10(tx), 15101n); assert.ok(e.mass >= 15101n); });
t('V2 v0 1-in/1-out: storage === wasm-TN10(5000)', () => { const { tx, utxos } = mk({ outVals: [100_000_000n] }); assert.strictEqual(estimateMassUpperBound(tx, utxos).storage, 5000n); assert.strictEqual(wasmTN10(tx), 5000n); });
t('V2b 2-in(150M,50M)/2-out(100M,99M) relaxed: 手算 20101−26666 ⇒ 0(wasm 旧实现 3286 只记录)', () => { const { tx, utxos } = mk({ inVals: [150_000_000n, 50_000_000n] }); assert.strictEqual(estimateMassUpperBound(tx, utxos).storage, 0n); console.log(`   wasm-TN10(旧 KIP-9)=${wasmTN10(tx)} 非 oracle`); });
t('V2c 3-in(70,70,60M)/3-out(60,70,69M) 一般式: 45443 − 3×floor(1e12/66,666,666)=45000 ⇒ 443(wasm 4882 只记录)', () => { const { tx, utxos } = mk({ inVals: [70_000_000n, 70_000_000n, 60_000_000n], outVals: [60_000_000n, 70_000_000n, 69_000_000n] }); assert.strictEqual(estimateMassUpperBound(tx, utxos).storage, 443n); console.log(`   wasm-TN10(旧 KIP-9)=${wasmTN10(tx)} 非 oracle`); });
t('V3 compute 分量: 签名 +100B ⇒ size/compute +100; budget +1 ⇒ compute +100(GRAMS_PER_COMPUTE_BUDGET_UNIT); v0 sigop +1 ⇒ +1000', () => {
  const a = estimateMassUpperBound(...Object.values(mk({ version: 1, budget: 70 }))), b = estimateMassUpperBound(...Object.values(mk({ version: 1, budget: 70, sig: '41' + 'ab'.repeat(65) + 'cd'.repeat(100) })));
  assert.strictEqual(b.size - a.size, 100n); assert.strictEqual(b.compute - a.compute, 100n);
  const c = estimateMassUpperBound(...Object.values(mk({ version: 1, budget: 71 }))); assert.strictEqual(c.compute - a.compute, 100n);
  const d0 = estimateMassUpperBound(...Object.values(mk({ sigop: 0 }))), d1 = estimateMassUpperBound(...Object.values(mk({ sigop: 1 }))); assert.strictEqual(d1.compute - d0.compute, 1000n);
});
t('V3b v1 input 缺 computeBudget ⇒ throw(fail-loud, 不静默算低)', () => { const n = normalizeTx({ version: 1, inputs: [{ signatureScript: '', sigOpCount: 0, amount: 1n, spkLen: 35n }], outputs: [{ value: 1000n, spk: '00' }] }); assert.throws(() => estimateMassUpperBound(n), /缺 computeBudget/); });
t('V4 covenant 输出: size +34(2+32), covenant 判据 = output.covenant 非空', () => { const p = mk({ version: 1, budget: 70, cov: true }), q = mk({ version: 1, budget: 70 }); const ep = estimateMassUpperBound(p.tx, p.utxos), eq = estimateMassUpperBound(q.tx, q.utxos); assert.strictEqual(ep.size - eq.size, 34n); assert.strictEqual(ep.compute - eq.compute, 34n); });
t('V5 必红向量: wasm 在 testnet-12 下 panic 为真; 本地估算器仍返数值; 把估算器换成 throw 版则整条红', () => {
  const { tx, utxos } = mk({ version: 1, budget: 70, cov: true });
  let panicked = false; try { k.calculateTransactionMass('testnet-12', tx); } catch { panicked = true; } assert.ok(panicked, 'wasm 竟没 panic(构建换了? 那本模块可退役)');
  const e = estimateMassUpperBound(tx, utxos); assert.ok(typeof e.mass === 'bigint' && e.mass > 0n);
  const throwing = () => { throw new Error('unreachable'); }; assert.throws(throwing);   // 对照: 若兜底实现是 throw 版, 上一行的形就红
});
t('V6 bshard consolidate 真形(3-in v1 budget=70 两 224B redeem, 2-out): minFee=mass×100 ≤ 生产 fee 3×0.01KAS(不会误拒)', () => {
  const big = '4ce0' + 'ab'.repeat(224); const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n, 28_000_000n] });
  const e = estimateMassUpperBound(tx, utxos); const minFee = e.mass * 100n; assert.ok(minFee <= 3n * 1_000_000n, `minFee ${minFee} > 3,000,000`); console.log(`   consolidate: mass=${e.mass} compute=${e.compute} storage=${e.storage} transient=${e.transient} minFee=${minFee}`);
});
t('V7 边界 fail-loud: 输入 spk > 100B ⇒ PLURALITY_UNSUPPORTED; 零值输出 ⇒ throw', () => {
  assert.throws(() => estimateMassUpperBound(normalizeTx({ version: 0, inputs: [{ signatureScript: '', sigOpCount: 0, amount: 1_000_000n, spkLen: 101n }], outputs: [{ value: 1000n, spk: '00' }] })), /PLURALITY_UNSUPPORTED/);
  assert.throws(() => estimateMassUpperBound(normalizeTx({ version: 0, inputs: [{ signatureScript: '', sigOpCount: 0, amount: 1_000_000n, spkLen: 35n }], outputs: [{ value: 0n, spk: '00' }] })), /零值/);
});
// V8: 生产 _assertTxInvariants observe 路径(经 __testOnlyAssertTxInvariants): wasm panic ⇒ 本地上界 ⇒ 结构化日志; 低费 would_reject=true 但【不 throw】; 正常费 would_reject=false
const { __testOnlyAssertTxInvariants } = await import('./p2sh.mjs');
const capture = (fn) => { const w = [], l = []; const ow = console.warn, ol = console.log; console.warn = (...a) => w.push(a.join(' ')); console.log = (...a) => l.push(a.join(' ')); try { fn(); } finally { console.warn = ow; console.log = ol; } return { w, l }; };
t('V8a observe · 正常费(3-in consolidate 形, fee 3M ≥ minFee 2.28M): 不 throw, 日志 [mass-floor:observe] would_reject=false 含 compute/storage/transient/mass_ub/minFee/actualFee', () => {
  const big = '4ce0' + 'ab'.repeat(224); const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n, 27_000_000n] });   // fee = 180M−177M = 3M
  const { w } = capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V8a', 'testnet-12'));
  const line = w.find((s) => s.startsWith('[mass-floor:observe]')); assert.ok(line, '无结构化日志行: ' + JSON.stringify(w));
  for (const key of ['site=V8a', 'compute=', 'storage=', 'transient=', 'mass_ub=', 'minFee=', 'actualFee=3000000', 'would_reject=false', 'source=7b1e18cc']) assert.ok(line.includes(key), `缺 ${key}: ${line}`);
});
t('V8b observe · 低费(fee 100k < minFee): 【不 throw】(observe 只 warn), 日志 would_reject=true', () => {
  const big = '4ce0' + 'ab'.repeat(224); const { tx, utxos } = mk({ version: 1, budget: 70, sigop: 0, sig: big, inVals: [100_000_000n, 50_000_000n, 30_000_000n], outVals: [150_000_000n, 29_900_000n] });   // fee = 100k
  const { w } = capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V8b', 'testnet-12'));   // 不抛即通过
  const line = w.find((s) => s.startsWith('[mass-floor:observe]')); assert.ok(line && line.includes('would_reject=true') && line.includes('actualFee=100000'), JSON.stringify(w));
});
t('V8c 对照 · 不传 networkId(legacy caller) ⇒ 无 mass 检查、无 observe 行(行为与改前一致)', () => {
  const { tx, utxos } = mk({}); const { w } = capture(() => __testOnlyAssertTxInvariants(utxos, tx, 'V8c', null));
  assert.ok(!w.some((s) => s.startsWith('[mass-floor:')));
});
t('常量表 = 7b1e18cc 值且冻结', () => { assert.ok(Object.isFrozen(MASS_CONSTS)); assert.strictEqual(MASS_CONSTS.storage_mass_parameter, 1_000_000_000_000n); assert.strictEqual(MASS_CONSTS.grams_per_compute_budget_unit, 100n); assert.strictEqual(MASS_CONSTS.grams_per_sigop, 1000n); assert.strictEqual(MASS_CONSTS.transient_factor, 4n); });
console.log(`\n${fail === 0 ? '✅' : '🔴'} tx-mass-ub: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
