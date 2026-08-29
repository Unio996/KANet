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
export const CLTV_ERR = Object.freeze({ ARGS_MISSING: 'CLTV_ARGS_MISSING', BOUNDS_EMPTY: 'CLTV_BOUNDS_EMPTY', DOMAIN_MIXED: 'CLTV_DOMAIN_MIXED' });

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
 */
export function cltvLockTime(opts) {
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
    } else if (!(e >= LOCK_TIME_THRESHOLD && e < TIME_DOMAIN_UPPER)) {
      throw new CltvError(CLTV_ERR.DOMAIN_MIXED, `time 域要求 ${LOCK_TIME_THRESHOLD} <= E < 2^63, bounds[${i}]=${e}`);
    }
    if (max === null || e > max) max = e;
  });
  return max;
}

/** 被锁输入的 sequence: 显式非 MAX (CLTV 与 finalization 双要求). 默认 0n; 传 MAX ⇒ throw. */
export function cltvSequence(seq = 0n) {
  const s = typeof seq === 'bigint' ? seq : BigInt(seq);
  if (s === MAX_TX_IN_SEQUENCE_NUM) throw new CltvError(CLTV_ERR.ARGS_MISSING, 'CLTV 输入 sequence 不得为 MAX (会被判 finalized ⇒ 脚本拒)');
  if (s < 0n) throw new CltvError(CLTV_ERR.ARGS_MISSING, 'sequence 负值');
  return s;
}

/** 分类: 节点拒因文本 → 'construct-error'(我们的锁构造错) | 'lock-reject'(锁按预期拒, 用作负向量证据) | 'inconclusive' */
export function classifyLockReject(errText) {
  const s = String(errText || '');
  if (/mismatched locktime types/.test(s)) return { kind: 'lock-reject', reason: 'domain_mismatch', consensus_site: 'opcodes/mod.rs:1034' };
  if (/locktime requirement not satisfied/.test(s)) return { kind: 'lock-reject', reason: 'not_yet', consensus_site: 'opcodes/mod.rs:1038' };
  if (/transaction input is finalized/.test(s)) return { kind: 'lock-reject', reason: 'sequence_max', consensus_site: 'opcodes/mod.rs:1056' };
  if (/not finalized/i.test(s)) return { kind: 'lock-reject', reason: 'not_finalized', consensus_site: 'tx_validation_in_header_context.rs:86' };
  return { kind: 'inconclusive', reason: 'other', consensus_site: null };
}
