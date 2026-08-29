// cltv-locktime.mjs — CLTV 绝对锁的 tx.lockTime 构造（J2 2026-08-29, D-016 A′; 稿 cfedc5c6 §3）
// 纯函数, 零依赖. 落地位置: kasia-relay/src/lib/cltv-locktime.mjs
//
// 共识事实 (7b1e18cc):
//   opcodes/mod.rs:1030-1034  栈值与 tx.lock_time 须同域: 都 < LOCK_TIME_THRESHOLD(DAA) 或都 >= (time); 混 ⇒ "mismatched locktime types"
//   opcodes/mod.rs:1037-1038  每个被锁输入各自要求 stack_lock_time <= tx.lock_time  ⇒ 多输入取 max(E_i)
//   opcodes/mod.rs:1055-1056  被锁输入 sequence == MAX ⇒ 拒 ("transaction input is finalized")
//   tx_validation_in_header_context.rs:70-88  lock_time < 块 DAA(或 PMT) 才终局; lock_time==0 ⇒ Finalized(无锁)
//   lock_time 是 u64 ⇒ 上界 2^64-1; time 域保守取 < 2^63 (Bettor 附加条件, 与 daa 域对称)
export const LOCK_TIME_THRESHOLD = 500_000_000_000n;
export const MAX_TX_IN_SEQUENCE_NUM = (1n << 64n) - 1n;
export const TIME_DOMAIN_UPPER = 1n << 63n;   // 保守上界 (u64 实际 2^64-1)

export class CltvError extends Error {
  constructor(code, msg) { super(`${code}: ${msg}`); this.code = code; }
}
// 错误码三分 (gate (a) 广播段据此判"构造错" vs "链上 inconclusive"): 这三种都是【构造错】, 绝不应到达节点
export const CLTV_ERR = Object.freeze({ ARGS_MISSING: 'CLTV_ARGS_MISSING', BOUNDS_EMPTY: 'CLTV_BOUNDS_EMPTY', DOMAIN_MIXED: 'CLTV_DOMAIN_MIXED', DELAY_NONPOSITIVE: 'CLTV_DELAY_NONPOSITIVE' });

const toBig = (v, i) => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  throw new CltvError(CLTV_ERR.ARGS_MISSING, `bounds[${i}] 须为 bigint 或安全整数, 实 ${typeof v}`);
};

/**
 * cltvLockTime({ domain, bounds }) → BigInt tx.lockTime
 * @param {'daa'|'time'} domain  锁域 (与 .sil 里 E 的量级一致; 由调用方声明, 本函数只【核】不【推断】)
 * @param {Array<bigint|number>} bounds  各被锁输入的 E_i (脚本会 push 的值)
 * 规则: daa ⇒ 每个 0 <= E_i < 5e11; time ⇒ 每个 5e11 <= E_i < 2^63; 返回 max(E_i) (多输入 over-delay 保守方向)
 * 🔴 Codex 9eab914a ④ (funds-safety): daa 域 E=0 数学合法但 lock_time=0 = 共识【已终局/无锁】 ⇒ 恢复锁绝不能静默实例化零延迟
 *    ⇒ 一律拒 E==0 (CLTV_DELAY_NONPOSITIVE)。生产 API 【没有】allowZero 开关 (NWT 2026-08-29: 防误用);
 *    测试若需 E=0 形用 _cltvLockTimeAllowZeroForTests (test-only 导出, 名字自带警告)。恢复配置侧另用 assertPositiveDelay(n)。
 */
export function cltvLockTime(opts) {
  return _cltvLockTimeImpl(opts, false);
}
/** test-only: 允许 daa 域 E=0 (构造"无锁"对照向量用)。🔴 生产/恢复路绝不 import 此名。 */
export function _cltvLockTimeAllowZeroForTests(opts) {
  return _cltvLockTimeImpl(opts, true);
}
function _cltvLockTimeImpl(opts, allowZero) {
  if (!opts || typeof opts !== 'object') throw new CltvError(CLTV_ERR.ARGS_MISSING, 'opts 缺失');
  const { domain, bounds } = opts;
  if (domain !== 'daa' && domain !== 'time') throw new CltvError(CLTV_ERR.ARGS_MISSING, `domain 须为 'daa'|'time', 实 ${String(domain)}`);
  if (!Array.isArray(bounds)) throw new CltvError(CLTV_ERR.ARGS_MISSING, 'bounds 须为数组');
  if (bounds.length === 0) throw new CltvError(CLTV_ERR.BOUNDS_EMPTY, 'bounds 为空: 没有被锁输入就不该调本函数 (lockTime=0n 是"无锁", 不是"锁到 0")');
  let max = null;
  bounds.forEach((v, i) => {
    const e = toBig(v, i);
    if (domain === 'daa') {
      if (!(e >= 0n && e < LOCK_TIME_THRESHOLD)) throw new CltvError(CLTV_ERR.DOMAIN_MIXED, `daa 域要求 0 <= E < ${LOCK_TIME_THRESHOLD}, bounds[${i}]=${e}`);
      if (e === 0n && !allowZero) throw new CltvError(CLTV_ERR.DELAY_NONPOSITIVE, `daa 域 E=0 = lock_time 0 = 共识无锁; 恢复锁不得零延迟 (bounds[${i}])`);
    } else if (!(e >= LOCK_TIME_THRESHOLD && e < TIME_DOMAIN_UPPER)) {
      throw new CltvError(CLTV_ERR.DOMAIN_MIXED, `time 域要求 ${LOCK_TIME_THRESHOLD} <= E < 2^63, bounds[${i}]=${e}`);
    }
    if (max === null || e > max) max = e;
  });
  return max;
}

/** 被锁输入的 sequence: 显式 0 <= s < MAX (CLTV 与 finalization 双要求). 默认 0n.
 *  🔴 Codex 9eab914a ③: 原只拒 == MAX 与负数, 不拒 > MAX (2^64 能过; 序列化/适配器换了可能隐式截断成 MAX 或 0) ⇒ 改闭区间上界 < MAX。 */
export function cltvSequence(seq = 0n) {
  let s;
  try { s = typeof seq === 'bigint' ? seq : BigInt(seq); } catch { throw new CltvError(CLTV_ERR.ARGS_MISSING, `sequence 非整数: ${String(seq)}`); }
  if (s < 0n) throw new CltvError(CLTV_ERR.ARGS_MISSING, 'sequence 负值');
  if (s >= MAX_TX_IN_SEQUENCE_NUM) throw new CltvError(CLTV_ERR.ARGS_MISSING, `CLTV 输入 sequence 须 < MAX(2^64-1): ${s} (== MAX 会被判 finalized ⇒ 脚本拒; > MAX 越界可能被隐式截断)`);
  return s;
}

/** 恢复配置侧: 相对延迟 n_recovery_delay_daa 须 > 0 (Codex 9eab914a ④). 供 §6-3 builder/ctor 装载处【强制】调用; 抛 CLTV_DELAY_NONPOSITIVE。
 *  sane-max (NWT 2026-08-29 建议, 采): 默认 max = 1e7 DAA (≈11.6 天 @10 bps) = gate (d) CFG-UNIT-DOMAIN 相对量级带上界
 *  (docs/2026-08-27-j2-s63-gate-d-conservative-bounds-v0.1.md §4 L200: 相对量 [1e3, 1e7), ≥1e7 = 拿错尺)。
 *  只钉 max 不钉 min=1e3: 探针/测试用 N=100 合法; 生产 ctor 装载处再按 CFG-UNIT-DOMAIN 带检查 [1e3,1e7) (两道各管各的)。
 *  5e11 (LOCK_TIME_THRESHOLD) 只逮 gross typo (把绝对 DAA 当相对), 1e7 逮 "多打一个 0" 这种 config typo。 */
export const DELAY_SANE_MAX_DAA = 10_000_000n;
export function assertPositiveDelay(nDaa, label = 'n_recovery_delay_daa', { max = DELAY_SANE_MAX_DAA } = {}) {
  let n;
  try { n = typeof nDaa === 'bigint' ? nDaa : BigInt(nDaa); } catch { throw new CltvError(CLTV_ERR.ARGS_MISSING, `${label} 非整数: ${String(nDaa)}`); }
  if (n <= 0n) throw new CltvError(CLTV_ERR.DELAY_NONPOSITIVE, `${label} 须 > 0 (零/负延迟 = 恢复锁不存在): ${n}`);
  const m = typeof max === 'bigint' ? max : BigInt(max);
  if (n >= m) throw new CltvError(CLTV_ERR.DOMAIN_MIXED, `${label} 超 sane-max ${m} (config typo? 相对 DAA 量级带上界; 5e11 才是域阈): ${n}`);
  return n;
}

/** 分类: 节点拒因文本 → 'lock-reject'(锁按预期拒, 用作负向量证据) | 'inconclusive'。
 *  逐字文本来源 (git show 7b1e18cc:<path>, NWT 2026-08-29 复核):
 *   - crypto/txscript/src/opcodes/mod.rs:1034  "mismatched locktime types -- tx locktime {}, stack locktime {}"
 *   - crypto/txscript/src/opcodes/mod.rs:1038  "locktime requirement not satisfied -- locktime is greater than the transaction locktime: {} > {}"
 *       ⚠ 同一文本也出现在 :1097 (OpCheckSequenceVerify/CSV 路径); 探针与 §6-3 恢复锁是【纯 CLTV】(无 CSV), 故本分类无歧义;
 *         若将来同一脚本含 CSV, 须先按 opcode 上下文再分类.
 *   - crypto/txscript/src/opcodes/mod.rs:1056  "transaction input is finalized"
 *   - consensus/core/src/errors/tx.rs:33       #[error("transaction input #{0} is not finalized")]  ⇒ Display 逐字形 "transaction input #0 is not finalized"
 */
export function classifyLockReject(errText) {
  const s = String(errText || '');
  if (/mismatched locktime types/.test(s)) return { kind: 'lock-reject', reason: 'domain_mismatch', consensus_site: 'opcodes/mod.rs:1034' };
  if (/locktime requirement not satisfied/.test(s)) return { kind: 'lock-reject', reason: 'not_yet', consensus_site: 'opcodes/mod.rs:1038' };
  if (/transaction input is finalized/.test(s)) return { kind: 'lock-reject', reason: 'sequence_max', consensus_site: 'opcodes/mod.rs:1056' };
  if (/transaction input #\d+ is not finalized/.test(s)) return { kind: 'lock-reject', reason: 'not_finalized', consensus_site: 'consensus/core/src/errors/tx.rs:33 (check_tx_is_finalized @ tx_validation_in_header_context.rs:86)' };
  return { kind: 'inconclusive', reason: 'other', consensus_site: null };
}
