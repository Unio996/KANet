// recovery-lock-builder.testonly.mjs — 测试专用: 自定 sane-max 装载恢复配置 ("超 max 被拒"/"自定 max 内放行"向量用)。
// 🔴 只准 *.test.mjs / test-framework 引用 (lint R-TESTONLY-EXPORT-IN-PROD 白名单 *.testonly.mjs)。生产模块 recovery-lock-builder.mjs 不再导出任何 test-only 变体 (Codex 418fffbd + NWT 8/29 only-path)。
// 返回值【不带 BRAND】(BRAND 是生产模块私有 WeakSet, 本模块造不出) ⇒ 不能喂给 planRecoveryDaa —— 这正是 only-path: 自定 max 的 cfg 在生产路上无法使用。
import { CltvError, CLTV_ERR, assertPositiveDelay } from './cltv-locktime.mjs';
import { assertNoRawOverride, RECOVERY_DAA_ENTRY } from './recovery-lock-builder.mjs';

export function _loadRecoveryConfigWithMaxForTests(raw, max) {
  if (!raw || typeof raw !== 'object') throw new CltvError(CLTV_ERR.ARGS_MISSING, 'recovery config 缺失');
  assertNoRawOverride(raw);
  if (raw.n_recovery_delay_daa === undefined || raw.n_recovery_delay_daa === null) throw new CltvError(CLTV_ERR.ARGS_MISSING, 'n_recovery_delay_daa 缺失');
  const n = assertPositiveDelay(raw.n_recovery_delay_daa, raw.label || 'n_recovery_delay_daa', { max });
  return Object.freeze({ nDelayDaa: n, entry: RECOVERY_DAA_ENTRY, _unbranded_testonly: true });
}
