// recovery-lock-builder.mjs — §6-3 恢复锁（D-016 A′ · DAA 域 CLTV 相对锚）的【纯逻辑】构造器草案（J2 2026-08-29, Bettor 令"builder 草案·不接线"）
// 🔴 未接线: 无人 import 本文件; 不碰 kaspa-wasm、不签名、不广播。它只把"配置 → E/lockTime/sequence/提交时机"的判断集中到一处,
//    让 wiring 时的 ctor/builder 只能经这里拿数——这就是 NWT 2026-08-29 wiring-time 审点 ①②的落点:
//    ① 配置装载处【强制】调 assertPositiveDelay(loadRecoveryConfig 不调它就拿不到 cfg);
//    ② 恢复路绝不 import _cltvLockTimeAllowZeroForTests(本文件不 import 它; recovery-lock-builder.test.mjs 用 grep 断言钉死)。
// 机械镜像: scratch/_j2_s63a_transition/build.mjs §3b (探针 v0.3 P 向量 + N6..N9), 见 docs/provenance/2026-08-29-s63a-probe-v03/。
// 共识事实 (7b1e18cc): opcodes/mod.rs:1030-1038 (域同类 + stack E <= tx.lock_time) / :1055-1056 (sequence==MAX 拒) /
//   tx_validation_in_header_context.rs:56-88 (DAA 域: lock_time < 块 DAA 才终局 ⇒ 提交须 tip DAA > E, 否则 NotFinalized = N8)。
import { cltvLockTime, cltvSequence, assertPositiveDelay, CltvError, CLTV_ERR, LOCK_TIME_THRESHOLD, MAX_TX_IN_SEQUENCE_NUM } from './cltv-locktime.mjs';

export const RECOVERY_DAA_ENTRY = 3;   // 探针 v0.3 ABI: [transition, claim, recovery, recovery_daa] ⇒ recovery_daa = entry 3 (真合约接线时按其 ABI 重钉, 测试断言防漂)

/** 装载恢复配置 —— 唯一入口, 内部强制 assertPositiveDelay (审点①)。
 *  @param {object} raw  { n_recovery_delay_daa: bigint|number|string, label? , max? }
 *  @returns {Readonly<{ nDelayDaa: bigint, entry: number }>} */
export function loadRecoveryConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new CltvError(CLTV_ERR.ARGS_MISSING, 'recovery config 缺失');
  if (raw.n_recovery_delay_daa === undefined || raw.n_recovery_delay_daa === null) throw new CltvError(CLTV_ERR.ARGS_MISSING, 'n_recovery_delay_daa 缺失 (恢复锁不能靠默认值实例化)');
  const n = assertPositiveDelay(raw.n_recovery_delay_daa, raw.label || 'n_recovery_delay_daa', raw.max !== undefined ? { max: raw.max } : {});
  const entry = raw.entry === undefined ? RECOVERY_DAA_ENTRY : raw.entry;
  if (!Number.isInteger(entry) || entry < 0) throw new CltvError(CLTV_ERR.ARGS_MISSING, `entry 非法: ${String(raw.entry)}`);
  return Object.freeze({ nDelayDaa: n, entry });
}

const toBig = (v, what) => { try { const b = typeof v === 'bigint' ? v : BigInt(v); return b; } catch { throw new CltvError(CLTV_ERR.ARGS_MISSING, `${what} 非整数: ${String(v)}`); } };

/** 规划一笔 recovery_daa 花费: E = successorDaa + n; lockTime/sequence 经 cltv helper 核域; 不构造 wasm 对象。
 *  @param {{ nDelayDaa: bigint, entry: number }} cfg  loadRecoveryConfig 的返回 (别处造的对象一律拒: 必须带 frozen 标记)
 *  @param {{ successorDaa: bigint|number, selfInputIndex?: number, sequence?: bigint }} p  successorDaa = 被花 UTXO(phase=1 后继)落块 DAA, 由链回读给, 不许估
 *  @returns {{ E: bigint, lockTime: bigint, sequence: bigint, entry: number, selfInputIndex: number, sigPushes: [number, number], earliestSubmitTipDaa: bigint }} */
export function planRecoveryDaa(cfg, p) {
  if (!cfg || !Object.isFrozen(cfg) || typeof cfg.nDelayDaa !== 'bigint') throw new CltvError(CLTV_ERR.ARGS_MISSING, 'cfg 须来自 loadRecoveryConfig (frozen, nDelayDaa bigint)');
  if (!p || p.successorDaa === undefined || p.successorDaa === null) throw new CltvError(CLTV_ERR.ARGS_MISSING, 'successorDaa 缺失: 须链回读的后继落块 DAA');
  const d = toBig(p.successorDaa, 'successorDaa');
  if (d < 0n || d >= LOCK_TIME_THRESHOLD) throw new CltvError(CLTV_ERR.DOMAIN_MIXED, `successorDaa 不在 DAA 域 [0, 5e11): ${d}`);
  const E = d + cfg.nDelayDaa;
  const lockTime = cltvLockTime({ domain: 'daa', bounds: [E] });   // 核域 + 拒 0 (E>0 已由 n>0 保证, 仍走同一闸)
  const sequence = cltvSequence(p.sequence === undefined ? 0n : p.sequence);
  const selfInputIndex = p.selfInputIndex === undefined ? 0 : p.selfInputIndex;
  if (!Number.isInteger(selfInputIndex) || selfInputIndex < 0) throw new CltvError(CLTV_ERR.ARGS_MISSING, `selfInputIndex 非法: ${String(p.selfInputIndex)}`);
  return Object.freeze({ E, lockTime, sequence, entry: cfg.entry, selfInputIndex, sigPushes: [selfInputIndex, cfg.entry], earliestSubmitTipDaa: E + 1n });
}

/** 提交时机 (N8 教训: lock_time 必须 < 块 DAA 才终局): 只有 tipDaa > E 才准广播; 相等仍拒。 */
export function canSubmitRecovery(plan, tipDaa) {
  const t = toBig(tipDaa, 'tipDaa');
  return t > plan.E;
}

/** 构造后的形状核 (wasm 对象或 JSON 皆可, 只读字段): lockTime==E / 被锁输入 sequence 显式且 ≠ MAX / 输出 terminal 无 covenant。不等 ⇒ throw, 绝不静默修。 */
export function assertRecoveryTxShape(plan, txLike) {
  if (!txLike || typeof txLike !== 'object') throw new CltvError(CLTV_ERR.ARGS_MISSING, 'tx 缺失');
  const lt = toBig(txLike.lockTime, 'tx.lockTime');
  if (lt !== plan.E) throw new CltvError(CLTV_ERR.DOMAIN_MIXED, `tx.lockTime ${lt} ≠ E ${plan.E} (N6 形: E−1 ⇒ CLTV not satisfied; 时间量级 ⇒ mismatched types = N7)`);
  const inputs = txLike.inputs; if (!Array.isArray(inputs) || !inputs[plan.selfInputIndex]) throw new CltvError(CLTV_ERR.ARGS_MISSING, `inputs[${plan.selfInputIndex}] 缺失`);
  const seq = toBig(inputs[plan.selfInputIndex].sequence, 'input.sequence');
  if (seq >= MAX_TX_IN_SEQUENCE_NUM) throw new CltvError(CLTV_ERR.ARGS_MISSING, `被锁输入 sequence == MAX ⇒ 脚本判 finalized (N9): ${seq}`);
  if (seq !== plan.sequence) throw new CltvError(CLTV_ERR.ARGS_MISSING, `sequence ${seq} ≠ plan ${plan.sequence}`);
  const outputs = txLike.outputs; if (!Array.isArray(outputs) || outputs.length === 0) throw new CltvError(CLTV_ERR.ARGS_MISSING, 'outputs 空');
  for (const [i, o] of outputs.entries()) if (o && o.covenant) throw new CltvError(CLTV_ERR.ARGS_MISSING, `outputs[${i}] 带 covenant: recovery 是 terminal 出口, 不得续 covenant`);
  return true;
}
