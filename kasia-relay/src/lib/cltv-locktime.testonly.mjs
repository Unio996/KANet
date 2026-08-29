// cltv-locktime.testonly.mjs — 测试专用: daa 域允许 E=0 的 lockTime 构造 ("无锁"对照向量用)。
// 🔴 只准 *.test.mjs / test-framework 引用 (lint R-TESTONLY-EXPORT-IN-PROD 白名单 *.testonly.mjs; 生产模块 cltv-locktime.mjs 不再导出任何 test-only 变体 —— Codex 418fffbd + NWT 8/29 only-path)。
// 独立实现 (不调生产私有 impl): 域规则与 cltv-locktime.mjs 相同, 唯一差别 = daa 域 E=0 放行。生产 cltvLockTime 拒 0 (Codex 9eab914a ④)。
import { CltvError, CLTV_ERR, LOCK_TIME_THRESHOLD, TIME_DOMAIN_UPPER } from './cltv-locktime.mjs';

const toBig = (v, i) => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  throw new CltvError(CLTV_ERR.ARGS_MISSING, `bounds[${i}] 须为 bigint 或安全整数, 实 ${typeof v}`);
};
export function _cltvLockTimeAllowZeroForTests(opts) {
  if (!opts || typeof opts !== 'object') throw new CltvError(CLTV_ERR.ARGS_MISSING, 'opts 缺失');
  const { domain, bounds } = opts;
  if (domain !== 'daa' && domain !== 'time') throw new CltvError(CLTV_ERR.ARGS_MISSING, `domain 须为 'daa'|'time', 实 ${String(domain)}`);
  if (!Array.isArray(bounds)) throw new CltvError(CLTV_ERR.ARGS_MISSING, 'bounds 须为数组');
  if (bounds.length === 0) throw new CltvError(CLTV_ERR.BOUNDS_EMPTY, 'bounds 为空');
  let max = null;
  bounds.forEach((v, i) => {
    const e = toBig(v, i);
    if (domain === 'daa') { if (!(e >= 0n && e < LOCK_TIME_THRESHOLD)) throw new CltvError(CLTV_ERR.DOMAIN_MIXED, `daa 域要求 0 <= E < ${LOCK_TIME_THRESHOLD}, bounds[${i}]=${e}`); }
    else if (!(e >= LOCK_TIME_THRESHOLD && e < TIME_DOMAIN_UPPER)) throw new CltvError(CLTV_ERR.DOMAIN_MIXED, `time 域要求 ${LOCK_TIME_THRESHOLD} <= E < 2^63, bounds[${i}]=${e}`);
    if (max === null || e > max) max = e;
  });
  return max;
}
