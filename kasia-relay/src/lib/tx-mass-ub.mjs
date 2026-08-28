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
//  9  | storage relaxed 路径          | outs_pl==1 ∨ (|I|>2 ⇒ false) ∨ ins_pl==1 ∨ (outs_pl==2 ∧ ins_pl==2), 其中 *_pl = Σ plurality: max(0, Σ_o C·p_o²/v_o − Σ_i C·p_i²/v_i), C = 1e12 | mod.rs:430-487; constants.rs:25 | 逐字(🔴 v2 修: 首版把 plurality 当常数 1 ⇒ covenant UTXO(p=2)被低估, Codex e6d3d2f8 抓; 现按 cell 的 p 与 Σp)
// 10  | storage 一般路径              | max(0, Σ_o C·p_o²/v_o − Σp_i × floor(C / floor(Σ_i v_i / Σp_i)))                                | mod.rs:489-497                                   | 逐字取整顺序(mean = Σamount/Σplurality floor; 先 C/mean floor 再 × Σp_in)
// 14  | plurality(每 cell)            | p = ceil((63 + |spk| + (has_covenant ? 32 : 0)) / 100); 【输入】has_covenant 取 matched UTXO entry 的 covenantId 非空(生产 _psInputCovId 三级读), 不从花费 tx 的输出形推; 【输出】取 output.covenant 非空 | mod.rs:83-99 utxo_plurality; :107-117 UtxoEntry/TransactionOutput impl; :137-160 UtxoCell | 逐字; 标准 35B P2PK p=1, 带 covenant 的同 spk p=2; 上限保险 = 共识 max_plurality(:527-531: (63 + min(max_script_public_key_len=10_000, 500_000/10)).div_ceil(100) = 101), 超出 throw(fail-loud)
// 11  | mass 总                      | max(compute, storage, transient)                                                                | wallet/core 侧口径(calculateTransactionMass = 三者取大); 共识按三类分别限 | 取大 = 三条限任一都能盖
// 12  | 费地板                        | minFee = mass × MIN_SOMPI_PER_MASS(100; qlfpv 实测 442000/4420)                                 | p2sh.mjs:41 既有                                 | 不改
// 13  | oracle 覆盖范围(如实)          | vendored wasm 传 'testnet-10' 可算, 但其 KIP-9 实现≠7b1e18cc: |I|=1 形两者相等(15101/5000 机械相等); |I|≥2 形 wasm 给 3286/4882 vs 本式 0/443 | 实测 scratch/_j2_mass_ub | 旧 wasm 只作 |I|=1 oracle; |I|≥2 与 compute 分量的第二实现由 NWT 从源另写(Bettor 条件②), 链上实证 READY 后 getMempoolEntry
//  边界(如实): (a) plurality 现按 #14 精确算(v2); 超共识 max_plurality(101) 的 cell 抛 PLURALITY_OUT_OF_RANGE(fail-loud 不 fail-open);
//            (b) 本模块只在 wasm panic 时启用(wasm 成功仍用 wasm); (c) observe 阶段只 warn 不 throw(Bettor 条件③), enforce 另报备。
import { Buffer } from 'node:buffer';

export const MASS_CONSTS = Object.freeze({
  source_commit: '7b1e18cc',
  mass_per_tx_byte: 1n, mass_per_script_pub_key_byte: 10n,          // config/params.rs:669 TESTNET12_PARAMS
  grams_per_compute_budget_unit: 100n, grams_per_sigop: 1000n,       // mass/units.rs:4-5
  storage_mass_parameter: 100_000_000n * 10_000n,                    // constants.rs:25 = SOMPI_PER_KASPA × 10_000 = 1e12
  transient_factor: 4n,                                               // constants.rs:30
  HASH_SIZE: 32n, SUBNETWORK_ID_SIZE: 20n,
  utxo_const_storage: 63n, utxo_unit_size: 100n,                     // mass/mod.rs:85-97 (32+4+8+8+1+2+8 = 63; 100B/unit)
  max_script_public_key_len: 10_000n, compute_mass_limit: 500_000n,   // config/params.rs TESTNET12 :669 附近: max_script_public_key_len 10_000; block_mass_limits.compute 500_000
});
/** #14 utxo_plurality(spk_len, has_covenant) = ceil((63 + |spk| + (cov ? 32 : 0)) / 100) — mod.rs:83-99 逐字 */
export function utxoPlurality(spkLen, hasCovenant) {
  const C = MASS_CONSTS; const n = C.utxo_const_storage + BigInt(spkLen) + (hasCovenant ? C.HASH_SIZE : 0n);
  return (n + C.utxo_unit_size - 1n) / C.utxo_unit_size;
}
/** 共识 max_plurality(mod.rs:527-531): (63 + min(max_script_public_key_len, ceil(compute_limit / mass_per_spk_byte))).div_ceil(100) */
export function maxPlurality() {
  const C = MASS_CONSTS; const maxSpk = C.max_script_public_key_len < (C.compute_mass_limit + C.mass_per_script_pub_key_byte - 1n) / C.mass_per_script_pub_key_byte ? C.max_script_public_key_len : (C.compute_mass_limit + C.mass_per_script_pub_key_byte - 1n) / C.mass_per_script_pub_key_byte;
  return (C.utxo_const_storage + maxSpk + C.utxo_unit_size - 1n) / C.utxo_unit_size;
}

const hexBytes = (h) => { const s = typeof h === 'string' ? h : (h?.toString?.() ?? ''); return BigInt(Buffer.from(s.replace(/^0x/, ''), 'hex').length); };
const spkHex = (spk) => (typeof spk === 'string' ? spk : (spk?.script ?? spk?.scriptPublicKey ?? ''));

/**
 * 归一化输入形. 接受 (a) kaspa-wasm Transaction + matchedUtxos(p2sh._assertTxInvariants 的两个参数), 或 (b) 已归一的 plain 对象.
 * plain 形: { version, payload(hex), inputs:[{ signatureScript(hex), sigOpCount, computeBudget, amount(BigInt), spkLen(BigInt), hasCovenant(bool) }], outputs:[{ value(BigInt), spk(hex), covenant(bool) }] }
 * 🔴 #14: 【输入】has_covenant 只取 matched UTXO entry 的 covenantId(生产 _psInputCovId :1753 三级读: entry.covenantId ?? covenant?.covenantId ?? covenantId), 绝不从花费 tx 的输出形推。
 */
const entryCovId = (u) => u?.entry?.covenantId ?? u?.covenant?.covenantId ?? u?.covenantId ?? null;
export function normalizeTx(tx, matchedUtxos = null) {
  const inputs = (tx.inputs || []).map((i, idx) => {
    const u = matchedUtxos?.[idx] ?? i.utxo ?? null;
    const amount = BigInt(u?.amount ?? u?.value ?? u?.entry?.amount ?? i.amount ?? 0);
    const uspk = u?.scriptPublicKey ?? u?.entry?.scriptPublicKey ?? null;
    const spkLen = uspk ? hexBytes(spkHex(uspk)) : (i.spkLen != null ? BigInt(i.spkLen) : 0n);
    const hasCovenant = u ? (entryCovId(u) != null && String(entryCovId(u)) !== '') : !!i.hasCovenant;
    return { signatureScript: i.signatureScript ?? '', sigOpCount: Number(i.sigOpCount ?? 0), computeBudget: i.computeBudget == null ? null : Number(i.computeBudget), amount, spkLen, hasCovenant, plurality: utxoPlurality(spkLen, hasCovenant) };
  });
  const outputs = (tx.outputs || []).map((o) => { const spk = spkHex(o.scriptPublicKey ?? o.spk ?? ''); const covenant = !!(o.covenant); return { value: BigInt(o.value), spk, covenant, plurality: utxoPlurality(hexBytes(spk), covenant) }; });
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

// 🔴 v2(Codex e6d3d2f8): 逐字照 mod.rs:430-497, 每 cell {plurality, amount}; 谓词与项全部按 Σplurality, 不按对象个数
export function storageMass(n, { __testOnlyForcePlurality1 = false } = {}) {
  const C = MASS_CONSTS.storage_mass_parameter;
  if (n.inputs.length === 0) return 0n;
  const cell = (c) => ({ p: __testOnlyForcePlurality1 ? 1n : BigInt(c.plurality), v: BigInt(c.amount ?? c.value) });
  const outs = n.outputs.map(cell); const ins = n.inputs.map(cell);
  if (outs.some((c) => c.v <= 0n) || ins.some((c) => c.v <= 0n)) throw new Error('tx-mass-ub: 零值输出/输入(应先被 dust/Σ 检查拒)');
  const maxP = maxPlurality(); for (const c of [...outs, ...ins]) if (c.p < 1n || c.p > maxP) throw new Error(`tx-mass-ub: PLURALITY_OUT_OF_RANGE p=${c.p} (共识 max_plurality=${maxP}, mod.rs:527-531)`);
  // :447-456 单遍累加: outs_plurality = Σp(o); harmonic_outs = Σ C·p²/v
  const outsPl = outs.reduce((a, c) => a + c.p, 0n);
  const harmOuts = outs.reduce((a, c) => a + (C * c.p * c.p) / c.v, 0n);
  // :465-476 relaxed 谓词: outs_pl==1 ∨ (inputs.len()>2 ⇒ false) ∨ ins_pl==1 ∨ (outs_pl==2 ∧ ins_pl==2)
  let relaxed;
  if (outsPl === 1n) relaxed = true;
  else if (ins.length > 2) relaxed = false;
  else { const insPl = ins.reduce((a, c) => a + c.p, 0n); relaxed = insPl === 1n || (outsPl === 2n && insPl === 2n); }
  if (relaxed) { const harmIns = ins.reduce((a, c) => a + (C * c.p * c.p) / c.v, 0n); return harmOuts > harmIns ? harmOuts - harmIns : 0n; }   // :480-487
  // :489-497 一般式: (ins_plurality, sum_ins) 折叠; mean_ins = sum/ins_plurality (floor); arithmetic_ins = ins_plurality × (C / mean_ins)
  const insPl = ins.reduce((a, c) => a + c.p, 0n); const sumIns = ins.reduce((a, c) => a + c.v, 0n);
  const meanIns = sumIns / insPl;
  const arithmeticIns = insPl * (C / meanIns);
  return harmOuts > arithmeticIns ? harmOuts - arithmeticIns : 0n;
}

/** 主入口: 返回 { mass, compute, storage, transient, size, source_commit }. 任何输入形状问题 throw(fail-loud), 不返回可能偏低的数. */
export function estimateMassUpperBound(tx, matchedUtxos = null, opts = {}) {
  const n = normalizeTx(tx, matchedUtxos);
  const { size, compute, transient } = computeMass(n); const storage = storageMass(n, opts);
  const mass = [compute, storage, transient].reduce((a, b) => (a > b ? a : b));                                                      // #11
  return { mass, compute, storage, transient, size, source_commit: MASS_CONSTS.source_commit, plurality: { ins: n.inputs.map((i) => i.plurality), outs: n.outputs.map((o) => o.plurality) } };
}
