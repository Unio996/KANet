// tx-mass-ub.mjs — 本地 tx mass 上界估算(红线 7 兜底; J2 2026-08-28 · Bettor 批-带五条件 · NWT 审的是下面这张【上界证明表】)
//
// 🔴 为什么需要它: vendored `shared/vendor/kaspa-wasm` 构建的 `Params::from(NetworkId)` 缺 TN12 分支
//    (panic 原文 `consensus/core/src/config/params.rs:644 "Testnet suffix 12 is not supported"`, 经 initConsolePanicHook 实读),
//    ⇒ `calculateTransactionMass/calculateStorageMass/updateTransactionMass` 在 'testnet-12' 下【任何 tx 形】都 panic(表现为 wasm `unreachable`)
//    ⇒ p2sh.mjs `_assertTxInvariants` 的 try/catch 自 ≥8-01 起 100% 走 "mass calc skipped"(日志 minFee 成功 0 / skipped 177,415)
//    ⇒ 红线 7(fee ≥ mass×100 sompi)从未生效, 只剩 mempool 兜底。本模块 = wasm panic 时的本地兜底, 公式逐项钉在 live 节点 commit 7b1e18cc。
//
// ── 上界证明表(每项: 公式 · 出处 `git show 7b1e18cc:<path>` · 方向) ────────────────────────────────────────────────
//  #  | 项                          | 公式/常量                                                     | 出处(7b1e18cc)                                   | 方向
//  1  | size: tx 头                  | 2(version u16) + 8(#inputs) + 8(#outputs) + 8(lockTime) + 20(subnet) + 8(gas) + 32(payload hash) + 8(payload len) + |payload| | consensus/core/src/mass/mod.rs:21-39 | 逐字 = 共识估算式(共识自己就用这个"估算"算 mass, 不是 wire 真长)
//  2  | size: input                  | 32(prev txid) + 4(index) + 8(sigscript len) + |sigscript| + 8(sequence) + (version≥1 ? 2 : 0)  | mod.rs:42-56, :58-63                              | 逐字; sigscript 按【实际】长度(签名后的 tx)
//  3  | size: output                 | 8(value) + 2(spk version) + 8(spk len) + |spk| + (covenant ? 2+32 : 0)                          | mod.rs:65-75                                     | 逐字; covenant 有则加, 判据 = output.covenant != null
//  4  | compute: size 项             | size × mass_per_tx_byte(=1)                                                                     | mod.rs:333-334; config/params.rs:669 TESTNET12   | 逐字
//  5  | compute: spk 项              | Σ_outputs (2 + |spk|) × mass_per_script_pub_key_byte(=10)                                       | mod.rs:335-340; params.rs:669                    | 逐字
//  6  | compute: script 项 v1        | GRAMS_PER_COMPUTE_BUDGET_UNIT(=100) × Σ_inputs computeBudget                                     | mod.rs:342-347; mass/units.rs:4                  | 逐字; 缺省 computeBudget 视为 0 —— ⚠ v1 共识 expect() 必有, relay 全部 v1 站点显式传 70; 缺省不会更高 ⇒ 调用方必传(见 test V3b)
//  7  | compute: script 项 v0        | GRAMS_PER_SIGOP_COUNT_UNIT(=1000) × Σ_inputs sigOpCount                                          | mod.rs:348-354; mass/units.rs:5                  | 逐字
//  8  | transient                    | size × TRANSIENT_BYTE_TO_MASS_FACTOR(=4)                                                        | mod.rs:356; constants.rs:30                      | 逐字
//  9  | storage relaxed 路径          | |O|=1 ∨ |I|=1 ∨ (|O|=2 ∧ |I|=2): max(0, Σ_o C/v_o − Σ_i C/v_i), C = STORAGE_MASS_PARAMETER = 1e12  | mod.rs:430-487; constants.rs:25                  | 逐字(plurality=1: 本仓无 plurality>1 的 UTXO 形; 若将来有 ⇒ p² 项需补, 见 §边界)
// 10  | storage 一般路径              | max(0, Σ_o C/v_o − |I| × floor(C / floor(Σ_i v_i / |I|)))                                       | mod.rs:489-497                                   | 逐字取整顺序(先 C/mean 再乘 |I|)——首版反了(减项偏小⇒结果偏大), 已改逐字: 精确 = 最紧上界
// 11  | mass 总                      | max(compute, storage, transient)                                                                | wallet/core 侧口径(calculateTransactionMass = 三者取大); 共识按三类分别限 | 取大 = 三条限任一都能盖
// 12  | 费地板                        | minFee = mass × MIN_SOMPI_PER_MASS(100; qlfpv 实测 442000/4420)                                 | p2sh.mjs:41 既有                                 | 不改
// 13  | oracle 覆盖范围(如实)          | vendored wasm 传 'testnet-10' 可算, 但其 KIP-9 实现≠7b1e18cc: |I|=1 形两者相等(15101/5000 机械相等); |I|≥2 形 wasm 给 3286/4882 vs 本式 0/443 | 实测 scratch/_j2_mass_ub | 旧 wasm 只作 |I|=1 oracle; |I|≥2 与 compute 分量的第二实现由 NWT 从源另写(Bettor 条件②), 链上实证 READY 后 getMempoolEntry
//  边界(如实): (a) plurality>1(大 spk 的 UTXO, utxo_plurality 见 mod.rs 测试)本仓无; 出现时 storage 会被低估 ⇒ 本模块对 |spk|>100B 的【输入】抛 PLURALITY_UNSUPPORTED(fail-loud 不 fail-open);
//            (b) 本模块只在 wasm panic 时启用(wasm 成功仍用 wasm); (c) observe 阶段只 warn 不 throw(Bettor 条件③), enforce 另报备。
import { Buffer } from 'node:buffer';

export const MASS_CONSTS = Object.freeze({
  source_commit: '7b1e18cc',
  mass_per_tx_byte: 1n, mass_per_script_pub_key_byte: 10n,          // config/params.rs:669 TESTNET12_PARAMS
  grams_per_compute_budget_unit: 100n, grams_per_sigop: 1000n,       // mass/units.rs:4-5
  storage_mass_parameter: 100_000_000n * 10_000n,                    // constants.rs:25 = SOMPI_PER_KASPA × 10_000 = 1e12
  transient_factor: 4n,                                               // constants.rs:30
  HASH_SIZE: 32n, SUBNETWORK_ID_SIZE: 20n,
  plurality_spk_limit_bytes: 100,                                     // 边界 (a): 超过则拒算(输入 spk > 100B 可能 plurality>1)
});

const hexBytes = (h) => { const s = typeof h === 'string' ? h : (h?.toString?.() ?? ''); return BigInt(Buffer.from(s.replace(/^0x/, ''), 'hex').length); };
const spkHex = (spk) => (typeof spk === 'string' ? spk : (spk?.script ?? spk?.scriptPublicKey ?? ''));

/**
 * 归一化输入形. 接受 (a) kaspa-wasm Transaction + matchedUtxos(p2sh._assertTxInvariants 的两个参数), 或 (b) 已归一的 plain 对象.
 * plain 形: { version, payload(hex), inputs:[{ signatureScript(hex), sigOpCount, computeBudget, amount(BigInt), spkLen(BigInt) }], outputs:[{ value(BigInt), spk(hex), covenant(bool) }] }
 */
export function normalizeTx(tx, matchedUtxos = null) {
  const inputs = (tx.inputs || []).map((i, idx) => {
    const u = matchedUtxos?.[idx] ?? i.utxo ?? null;
    const amount = BigInt(u?.amount ?? u?.value ?? u?.entry?.amount ?? i.amount ?? 0);
    const uspk = u?.scriptPublicKey ?? u?.entry?.scriptPublicKey ?? null;
    return { signatureScript: i.signatureScript ?? '', sigOpCount: Number(i.sigOpCount ?? 0), computeBudget: i.computeBudget == null ? null : Number(i.computeBudget), amount, spkLen: uspk ? hexBytes(spkHex(uspk)) : (i.spkLen != null ? BigInt(i.spkLen) : 0n) };
  });
  const outputs = (tx.outputs || []).map((o) => ({ value: BigInt(o.value), spk: spkHex(o.scriptPublicKey ?? o.spk ?? ''), covenant: !!(o.covenant) }));
  return { version: Number(tx.version ?? 0), payload: tx.payload ?? '', inputs, outputs };
}

export function estimatedSerializedSize(n) {
  const C = MASS_CONSTS; let size = 2n + 8n;                                                   // #1
  for (const i of n.inputs) { size += C.HASH_SIZE + 4n + 8n + hexBytes(i.signatureScript) + 8n; if (n.version >= 1) size += 2n; }   // #2
  size += 8n;
  for (const o of n.outputs) { size += 8n + 2n + 8n + hexBytes(o.spk); if (o.covenant) size += 2n + C.HASH_SIZE; }                // #3
  size += 8n + C.SUBNETWORK_ID_SIZE + 8n + C.HASH_SIZE + 8n + hexBytes(n.payload);                                                 // #1
  return size;
}

export function computeMass(n) {
  const C = MASS_CONSTS; const size = estimatedSerializedSize(n);
  const spkMass = n.outputs.reduce((a, o) => a + (2n + hexBytes(o.spk)) * C.mass_per_script_pub_key_byte, 0n);                     // #5
  let scriptMass;
  if (n.version >= 1) {                                                                                                             // #6
    for (const i of n.inputs) if (i.computeBudget == null) throw new Error('tx-mass-ub: v1 input 缺 computeBudget(共识 expect 必有; relay 站点须显式传)');
    scriptMass = C.grams_per_compute_budget_unit * n.inputs.reduce((a, i) => a + BigInt(i.computeBudget), 0n);
  } else {
    scriptMass = C.grams_per_sigop * n.inputs.reduce((a, i) => a + BigInt(i.sigOpCount), 0n);                                       // #7
  }
  return { size, compute: size * C.mass_per_tx_byte + spkMass + scriptMass, transient: size * C.transient_factor };                // #4 #8
}

export function storageMass(n) {
  const C = MASS_CONSTS.storage_mass_parameter;
  if (n.inputs.length === 0) return 0n;
  for (const i of n.inputs) if (i.spkLen > BigInt(MASS_CONSTS.plurality_spk_limit_bytes)) throw new Error(`tx-mass-ub: PLURALITY_UNSUPPORTED input spk ${i.spkLen}B > ${MASS_CONSTS.plurality_spk_limit_bytes}B(可能 plurality>1, 本模块不算)`);
  const outs = n.outputs.map((o) => o.value); const ins = n.inputs.map((i) => i.amount);
  if (outs.some((v) => v <= 0n) || ins.some((v) => v <= 0n)) throw new Error('tx-mass-ub: 零值输出/输入(应先被 dust/Σ 检查拒)');
  const harmOuts = outs.reduce((a, v) => a + C / v, 0n);                                                                            // #9 Σ C·p²/v, p=1
  const relaxed = outs.length === 1 || ins.length === 1 || (outs.length === 2 && ins.length === 2);
  if (relaxed) { const harmIns = ins.reduce((a, v) => a + C / v, 0n); return harmOuts > harmIns ? harmOuts - harmIns : 0n; }        // #9
  const k = BigInt(ins.length); const meanIns = ins.reduce((a, v) => a + v, 0n) / k;                                                // #10 floor
  const arithmeticIns = k * (C / meanIns);                                                                                          // #10 先 C/mean 再 ×|I|
  return harmOuts > arithmeticIns ? harmOuts - arithmeticIns : 0n;
}

/** 主入口: 返回 { mass, compute, storage, transient, size, source_commit }. 任何输入形状问题 throw(fail-loud), 不返回可能偏低的数. */
export function estimateMassUpperBound(tx, matchedUtxos = null) {
  const n = normalizeTx(tx, matchedUtxos);
  const { size, compute, transient } = computeMass(n); const storage = storageMass(n);
  const mass = [compute, storage, transient].reduce((a, b) => (a > b ? a : b));                                                      // #11
  return { mass, compute, storage, transient, size, source_commit: MASS_CONSTS.source_commit };
}
