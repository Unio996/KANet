// tx-mass-ub-browser.mjs — 浏览器版本地 tx mass 上界估算(D-034 §8 后续票⑥, Bettor 派工 2026-09-27:
// 广播前必须做完整三维 mass 预检)。不写新的估算逻辑, 逐字照搬
// kasia-relay/src/lib/tx-mass-ub.mjs(J2 2026-08-28 · Bettor 批-带五条件 · NWT 审的上界证明表, 公式
// 逐项钉在 live 节点 commit 7b1e18cc, 见源文件头注完整推导表)。
//
// 唯一改动: 移除 `import { Buffer } from 'node:buffer'`(浏览器没有这个模块), 把唯一用到 Buffer 的
// hexBytes() 换成不依赖 Buffer 的等价实现(hex 字符串每 2 个字符 = 1 字节, 纯算术, 不是近似值)。
// 其余全部公式/常量/判据逐字不改——vendor/tx-mass-ub-browser-parity.mjs 对两边跑同一批随机 tx 形状
// 逐字段比对过 mass/compute/storage/transient 四个数值全部相等。

export const MASS_CONSTS = Object.freeze({
  source_commit: '7b1e18cc',
  mass_per_tx_byte: 1n, mass_per_script_pub_key_byte: 10n,
  grams_per_compute_budget_unit: 100n, grams_per_sigop: 1000n,
  storage_mass_parameter: 100_000_000n * 10_000n,
  transient_factor: 4n,
  HASH_SIZE: 32n, SUBNETWORK_ID_SIZE: 20n,
  utxo_const_storage: 63n, utxo_unit_size: 100n,
  max_script_public_key_len: 10_000n, compute_mass_limit: 500_000n,
});

export function utxoPlurality(spkLen, hasCovenant) {
  const C = MASS_CONSTS; const n = C.utxo_const_storage + BigInt(spkLen) + (hasCovenant ? C.HASH_SIZE : 0n);
  return (n + C.utxo_unit_size - 1n) / C.utxo_unit_size;
}
export function maxPlurality() {
  const C = MASS_CONSTS; const maxSpk = C.max_script_public_key_len < (C.compute_mass_limit + C.mass_per_script_pub_key_byte - 1n) / C.mass_per_script_pub_key_byte ? C.max_script_public_key_len : (C.compute_mass_limit + C.mass_per_script_pub_key_byte - 1n) / C.mass_per_script_pub_key_byte;
  return (C.utxo_const_storage + maxSpk + C.utxo_unit_size - 1n) / C.utxo_unit_size;
}

// hex 字符串字节长度 — 原版用 Buffer.from(hex,'hex').length, 这里直接用字符数/2(偶数长度 hex 字符串
// 的定义本身就是这个关系, 不是近似——每 2 个 hex 字符编码 1 字节, 不存在"Buffer 特有行为"这种东西)。
const hexBytes = (h) => { const s = (typeof h === 'string' ? h : (h?.toString?.() ?? '')).replace(/^0x/, ''); return BigInt(s.length / 2); };
const spkHex = (spk) => (typeof spk === 'string' ? spk : (spk?.script ?? spk?.scriptPublicKey ?? ''));

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
  const C = MASS_CONSTS; let size = 2n + 8n;
  for (const i of n.inputs) { size += C.HASH_SIZE + 4n + 8n + hexBytes(i.signatureScript) + 8n; if (n.version >= 1) size += 2n; }
  size += 8n;
  for (const o of n.outputs) { size += 8n + 2n + 8n + hexBytes(o.spk); if (o.covenant) size += 2n + C.HASH_SIZE; }
  size += 8n + C.SUBNETWORK_ID_SIZE + 8n + C.HASH_SIZE + 8n + hexBytes(n.payload);
  return size;
}

export function computeMass(n) {
  const C = MASS_CONSTS; const size = estimatedSerializedSize(n);
  const spkMass = n.outputs.reduce((a, o) => a + (2n + hexBytes(o.spk)) * C.mass_per_script_pub_key_byte, 0n);
  let scriptMass;
  if (n.version >= 1) {
    for (const i of n.inputs) if (i.computeBudget == null) throw new Error('tx-mass-ub: v1 input 缺 computeBudget(共识 expect 必有; relay 站点须显式传)');
    scriptMass = C.grams_per_compute_budget_unit * n.inputs.reduce((a, i) => a + BigInt(i.computeBudget), 0n);
  } else {
    scriptMass = C.grams_per_sigop * n.inputs.reduce((a, i) => a + BigInt(i.sigOpCount), 0n);
  }
  return { size, compute: size * C.mass_per_tx_byte + spkMass + scriptMass, transient: size * C.transient_factor };
}

export function storageMass(n, { __testOnlyForcePlurality1 = false } = {}) {
  const C = MASS_CONSTS.storage_mass_parameter;
  if (n.inputs.length === 0) return 0n;
  const cell = (c) => ({ p: __testOnlyForcePlurality1 ? 1n : BigInt(c.plurality), v: BigInt(c.amount ?? c.value) });
  const outs = n.outputs.map(cell); const ins = n.inputs.map(cell);
  if (outs.some((c) => c.v <= 0n) || ins.some((c) => c.v <= 0n)) throw new Error('tx-mass-ub: 零值输出/输入(应先被 dust/Σ 检查拒)');
  const maxP = maxPlurality(); for (const c of [...outs, ...ins]) if (c.p < 1n || c.p > maxP) throw new Error(`tx-mass-ub: PLURALITY_OUT_OF_RANGE p=${c.p} (共识 max_plurality=${maxP}, mod.rs:527-531)`);
  const outsPl = outs.reduce((a, c) => a + c.p, 0n);
  const harmOuts = outs.reduce((a, c) => a + (C * c.p * c.p) / c.v, 0n);
  let relaxed;
  if (outsPl === 1n) relaxed = true;
  else if (ins.length > 2) relaxed = false;
  else { const insPl = ins.reduce((a, c) => a + c.p, 0n); relaxed = insPl === 1n || (outsPl === 2n && insPl === 2n); }
  if (relaxed) { const harmIns = ins.reduce((a, c) => a + (C * c.p * c.p) / c.v, 0n); return harmOuts > harmIns ? harmOuts - harmIns : 0n; }
  const insPl = ins.reduce((a, c) => a + c.p, 0n); const sumIns = ins.reduce((a, c) => a + c.v, 0n);
  const meanIns = sumIns / insPl;
  const arithmeticIns = insPl * (C / meanIns);
  return harmOuts > arithmeticIns ? harmOuts - arithmeticIns : 0n;
}

/** 主入口: 返回 { mass, compute, storage, transient, size, source_commit }. 任何输入形状问题 throw(fail-loud)。 */
export function estimateMassUpperBound(tx, matchedUtxos = null, opts = {}) {
  const n = normalizeTx(tx, matchedUtxos);
  const { size, compute, transient } = computeMass(n); const storage = storageMass(n, opts);
  const mass = [compute, storage, transient].reduce((a, b) => (a > b ? a : b));
  return { mass, compute, storage, transient, size, source_commit: MASS_CONSTS.source_commit, plurality: { ins: n.inputs.map((i) => i.plurality), outs: n.outputs.map((o) => o.plurality) } };
}
