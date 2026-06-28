// uma-oo-extractor.mjs — 线2 UMA OO resolution → KANet StructuredEvidence + field_hash. J1 slice-1 (2026-06-28).
//
// 镜像 oracle-evidence-extractors.mjs 的 source-aware extractor 模式 (wrapper {final, fields, field_hash} | ABSTAIN)
// + judgeline.mjs 的 ABSTAIN-not-guess 哲学。继承非替换: 新增一个【UMA OO 源】, 与 ESPN/CoinGecko 并列。
//
// 两轴 (NWT 红队):
//   - C (J1) ancillary_data 问题绑定: reader 按 ancillary_id 读, 错绑 → miss → ABSTAIN (在 reader + 此处双守).
//   - GAP-B (NWT) resolution-VALUE 编码: UMA settle value (bytes32/numeric) → YES/NO 的映射函数 **必在
//     predicate_commit 冻结** (建市烤死, 非 settle 时选 = 防操纵)。mapUmaValueToOutcome = 该冻结映射 (单源)。
// finality (J1-A / GAP-A): !settled → ABSTAIN (禁 proposed = funds-safe, 同 judgeLine null→ABSTAIN 不 fall LLM)。

import { createHash } from 'node:crypto';
import { UMA_YES, UMA_NO, UMA_INDETERMINATE } from './uma-oo-reader.mjs';

// field_hash 输入集 (== NWT hash集==输入集 invariant, 同 __STRUCTURED_EVIDENCE_FIELDS__)。
export const __UMA_EVIDENCE_FIELDS__ = ['resolved_outcome', 'uma_value', 'settled_block', 'ancillary_id'];

export const UMA_ABSTAIN_TOKEN = 'ABSTAIN';

/**
 * mapUmaValueToOutcome — GAP-B 冻结映射 (单源, predicate_commit 烤死): UMA OO settle value → 'YES'|'NO'|ABSTAIN.
 *   UMA YES_OR_NO_QUERY binary: 1e18=YES, 0=NO, 0.5e18=50-50→ABSTAIN. 任何意外值 → ABSTAIN (abstain-not-guess,
 *   不猜 = 防"未知编码被蒙成 YES/NO 发错 winner")。
 * @param {BigInt|string|number|null} value
 * @returns {'YES'|'NO'|'ABSTAIN'}
 */
export function mapUmaValueToOutcome(value) {
  if (value === null || value === undefined) return UMA_ABSTAIN_TOKEN;
  let v;
  try { v = BigInt(value); } catch { return UMA_ABSTAIN_TOKEN; }
  if (v === UMA_YES) return 'YES';
  if (v === UMA_NO) return 'NO';
  if (v === UMA_INDETERMINATE) return UMA_ABSTAIN_TOKEN; // 50-50 = 无确定结果 → 弃权
  return UMA_ABSTAIN_TOKEN;                              // 意外值 → 弃权不猜
}

/**
 * extractUmaOoFields — OoResolution → wrapper { final, fields, field_hash }。
 *   final ∈ {'YES','NO','ABSTAIN'}. ABSTAIN 时 fields/field_hash = null (同 extractEspnFields null 语义:
 *   predicate 在但抽取空 → ABSTAIN 不 fall LLM = funds-safe)。
 *   finality gate: 非 settled / value 缺 → ABSTAIN (禁 proposed)。
 * @param {{value: BigInt|null, settled: boolean, settled_block: number|null, ancillary_id: string}} resolution
 */
export function extractUmaOoFields(resolution) {
  // finality (J1-A): 只 bonded DVM-settled 可消费。proposed/未终局/value 缺 → ABSTAIN。
  if (!resolution || resolution.settled !== true || resolution.value === null || resolution.value === undefined) {
    return { final: UMA_ABSTAIN_TOKEN, fields: null, field_hash: null };
  }
  const resolved_outcome = mapUmaValueToOutcome(resolution.value);
  if (resolved_outcome === UMA_ABSTAIN_TOKEN) {
    return { final: UMA_ABSTAIN_TOKEN, fields: null, field_hash: null };
  }
  const fields = {
    resolved_outcome,
    uma_value: BigInt(resolution.value).toString(), // BigInt → 定长十进制 string (stable hash, 无 BigInt JSON 问题)
    settled_block: resolution.settled_block ?? null,
    ancillary_id: resolution.ancillary_id ?? null,
  };
  return { final: resolved_outcome, fields, field_hash: umaCanonicalFieldHash(fields) };
}

// canonical 序列化 = 固定 key order 的严格 4 字段 (防 JSON.stringify 插入序漂移 → field_hash 裂)。
// 镜像 oracle-evidence-extractors stableStringifyFields 模式 (UMA-specific 字段集, 非复用 sports 那个)。
function stableStringifyUmaFields(fields) {
  return JSON.stringify([
    ['resolved_outcome', fields.resolved_outcome],
    ['uma_value', fields.uma_value],
    ['settled_block', fields.settled_block],
    ['ancillary_id', fields.ancillary_id],
  ]);
}

// field_hash = sha256(canonical 4 字段)。跨委员 byte-equal (determinism 源轴, NWT quorum 闸复用位)。
export function umaCanonicalFieldHash(fields) {
  return createHash('sha256').update(stableStringifyUmaFields(fields)).digest('hex');
}
