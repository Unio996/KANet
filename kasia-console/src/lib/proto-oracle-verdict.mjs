// proto-oracle-verdict.mjs — oracle 整合批 B: derive 结果 → verdict 行的【纯逻辑】(B1 贴标 / B2·B4 写入决策表 / B3 side 映射 / 证据引用)。
// 设计 docs/2026-09-20-bettor-oracle-batchB-adapter-verdict-promote-design-v0.1.md §2 / §10 B1–B4 / §11;
// D-032 v0.2.4 §2.2(单口径)删 uma 分支与极性翻转、UMA 窗断言(assertUmaWindowSafe/UMA_MIN_FINALIZATION_WINDOW_MS,
// 只服务于已删的 polymarket 路,连同其在 proto-oracle-adapter-core.mjs/services/proto-oracle-adapter.mjs 的调用点一并清)。
// 无 DB / 无 IO / 无 process.env 直读。
// 🔴 批 A / 批 D 全靠 source_kind 标签: 赞成集仅 extractor, llm / human 只能触发冻结。所以贴标错 = LLM 结果以 extractor 进赞成集(门拦不住)——
//    classifySourceKind 是全仓【唯一】贴标函数, 只有一条路能得到非 llm: kanet 路且 extractor_kind_used==='judgeline-deterministic' ⇒ extractor。
//    其余一切(含未知 / 新增的 extractor_kind_used)一律 llm。
import { createHash } from 'node:crypto';

// ── B2 extractor_kind_used → 暂态 / 实质(未知值按暂态) ──
// 实质 = 源已 final 但判不出 / 明确弃权(写 NULL, 计入异议集 ⇒ 冻结); 暂态 = 还没法判(不写, 下 tick 重试到 cutoff)。
export const SUBSTANTIVE_ABSTAIN_KINDS = Object.freeze({
  'judgeline-abstain': 'extractor',      // 源 final, predicate 字段不足 / 不合法(D-L1 judgeLine 明确 ABSTAIN)
  'judgeline-no-fields': 'extractor',    // 有 predicate 但已 final 的证据里抽不出结构化字段(抽取器 final 后才会走到这里)
  'spec-no-question': 'llm',             // 无 predicate 的 LLM 路: spec 缺 title + resolution_criteria = 无问题可判
});
export const TRANSIENT_ABSTAIN_KINDS = Object.freeze(['known-source-not-final', 'extractor-exception', 'no-extractor-match']);

const isYesNo = (o) => o === 'YES' || o === 'NO';

/**
 * 单一贴标 + 分类。
 * @param {{branch: 'extractor', result: object|null}} o  branch = adapter 调的是哪一路(D-032 单口径下只剩 kanet 路), result = derive* 的返回
 * @returns {{cls: 'vote'|'substantive_abstain'|'transient', kind: 'extractor'|'llm'|null, label?: 'YES'|'NO', reason: string}}
 */
export function classifyDerivation({ branch, result }) {
  if (branch !== 'extractor') throw new RangeError(`classifyDerivation: 未知 branch ${JSON.stringify(branch)}(D-032 单口径后只接受 'extractor')`);
  const r = result && typeof result === 'object' ? result : null;
  if (!r) return { cls: 'transient', kind: null, reason: 'no_result' };
  // kanet 路
  if (r.ok === true) {
    if (isYesNo(r.outcome)) {
      // B1: 仅确定性算术(judgeline-deterministic)⇒ extractor; 其余任何有 outcome 的结果(含未知 / 新增 extractor_kind_used、LLM 路)⇒ llm
      const kind = r.extractor_kind_used === 'judgeline-deterministic' ? 'extractor' : 'llm';
      return { cls: 'vote', kind, label: r.outcome, reason: kind === 'extractor' ? 'judgeline_deterministic' : `llm_class(extractor_kind_used=${String(r.extractor_kind_used)})` };
    }
    if (r.outcome === 'ABSTAIN') {
      const sub = Object.prototype.hasOwnProperty.call(SUBSTANTIVE_ABSTAIN_KINDS, r.extractor_kind_used) ? SUBSTANTIVE_ABSTAIN_KINDS[r.extractor_kind_used] : null;
      if (sub) return { cls: 'substantive_abstain', kind: sub, reason: `abstain:${r.extractor_kind_used}` };
      return { cls: 'transient', kind: null, reason: `abstain_transient:${String(r.extractor_kind_used)}` };   // 已知暂态 + 未知值 ⇒ 暂态
    }
    return { cls: 'transient', kind: null, reason: `unknown_outcome:${String(r.outcome)}` };
  }
  // ok:false: 只有 LLM 低置信 / 不可解析(daemon_abstain)是实质(写 NULL); 其余(取数失败 / HTTP 错 / 无 provider / 超时 …)全是暂态
  if (typeof r.reason === 'string' && r.reason.startsWith('daemon_abstain')) return { cls: 'substantive_abstain', kind: 'llm', reason: 'llm_daemon_abstain' };
  return { cls: 'transient', kind: null, reason: `derive_failed: ${String(r.reason || 'unknown').slice(0, 120)}` };
}

// ── B3 side 映射 ──
/** side_map 必须是 label→side 的双射: 恰有 yes / no 两个键, 值为 {0,1} 的一个排列。返回规范化 {yes, no}; 非法 ⇒ null。 */
export function normalizeSideMap(sideMap) {
  if (!sideMap || typeof sideMap !== 'object' || Array.isArray(sideMap)) return null;
  const keys = Object.keys(sideMap).sort();
  if (keys.length !== 2 || keys[0] !== 'no' || keys[1] !== 'yes') return null;
  const y = sideMap.yes, n = sideMap.no;
  if (!((y === 0 && n === 1) || (y === 1 && n === 0))) return null;
  return { yes: y, no: n };
}

/**
 * label → side(0/1)(D-032 单口径:不再有第二裁判的极性翻转,直接按 side_map 查)。
 * @param {'YES'|'NO'} label  derive* 返回的 outcome
 * @param {{sideMap: object, branch: 'extractor'}} ctx
 * @returns {0|1}  非法输入抛错(不猜)
 */
export function toSide(label, { sideMap, branch } = {}) {
  const sm = normalizeSideMap(sideMap);
  if (!sm) throw new TypeError('toSide: side_map 非法(须 label→side 双射 {yes,no}→{0,1})');
  if (!isYesNo(label)) throw new RangeError(`toSide: label 必须是 YES|NO: ${JSON.stringify(label)}`);
  if (branch !== 'extractor') throw new RangeError(`toSide: 未知 branch ${JSON.stringify(branch)}(D-032 单口径后只接受 'extractor')`);
  return sm[label.toLowerCase()];
}

// ── 证据引用(evidence_ref 必填非空白; 同 (市场, source_kind, 证据哈希) 至多一条) ──
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
/** evidence_ref = `<url|->#sha256:<hash>`; 哈希取 evidence_raw(有票)或 `<extractor_kind_used>|<reason>`(弃权行)。 */
export function evidenceRefOf({ result, cls }) {
  const r = result || {};
  const basis = cls === 'vote' && r.evidence_raw ? String(r.evidence_raw) : `${String(r.extractor_kind_used || 'no-kind')}|${String(r.reason || r.outcome || '')}`;
  return `${String(r.evidence_url || '-')}#sha256:${sha256(basis)}`;
}

// ── B2 / B4 写入决策表 ──
/**
 * 把本 tick 各路的分类结果 + 已有 verdict 行 + pmt 状态 ⇒ 要写的 verdict 行清单(只增)。
 * 表: {暂态: 不写, 下 tick 重试到 cutoff} {实质异议 / 实质 ABSTAIN: 必写 NULL, pmt 无效也写 pmt_at=NULL(B4), 不受 outcome_end 限制} {赞成: pmt 有效 ∧ pmt >= outcome_end 才写(M1)}。
 * 🔴 M1(NWT 复核): 批准票的 pmt_at 必须 >= outcome_end 才有资格进赞成集(批 D N1); [outcome_end, +~2.3min) 窗内 pmt 仍 < outcome_end, 这时写下的批准票 pmt_at < oe 永久失格 ⇒ 市场必走 cutoff 冻结 → 退款。
 *    所以批准票 pmt < oe 时本 tick 不写(skipped approval_deferred_pmt_before_outcome_end), 下 tick 再 derive / 写; 异议 / 实质 ABSTAIN 不受此限(B4: 任何时候都写)。
 * "实质异议" = 本次的票与【已有行 ∪ 本 tick 其它票】里某个非 NULL outcome 相反(冲突里的每一方都写: 任何一方缺失都会让冻结集漏掉冲突)。
 * 同 (市场, source_kind, evidence_ref) 已存在 ⇒ 不重写; 同 (市场, kind) 已有行 ⇒ 该路本 tick 不该再 derive(由调用方先用 alreadyHas 过滤)。
 * @param {{items: {branch, cls, kind, side?: 0|1, evidenceRef: string, confidence?: number}[], existing: {source_kind, outcome, evidence_ref}[], pmt: {valid: boolean, pmtMs?: number}|null, outcomeEndMs: number}} o   outcomeEndMs 必填(安全整数; 缺 ⇒ 抛, 不静默放宽批准票门)
 * @returns {{writes: {source_kind, outcome: 0|1|null, pmt_at: number|null, evidence_ref: string, confidence: number|null, why: string}[], skipped: {branch, why}[]}}
 */
export function planVerdictWrites({ items, existing = [], pmt, outcomeEndMs }) {
  if (!Number.isSafeInteger(outcomeEndMs) || outcomeEndMs <= 0) throw new TypeError('planVerdictWrites: outcomeEndMs 必填(正安全整数): 批准票要 pmt >= outcome_end 才写(M1)');
  const pmtOk = !!(pmt && pmt.valid === true && Number.isSafeInteger(pmt.pmtMs) && pmt.pmtMs > 0);
  const pmtAt = pmtOk ? pmt.pmtMs : null;
  const outcomesSeen = new Set(existing.filter((v) => v.outcome === 0 || v.outcome === 1).map((v) => v.outcome));
  for (const it of items) if (it.cls === 'vote') outcomesSeen.add(it.side);
  const conflict = outcomesSeen.size > 1;
  const writes = [], skipped = [];
  const dup = (kind, ref) => existing.some((v) => v.source_kind === kind && v.evidence_ref === ref);
  for (const it of items) {
    if (it.cls === 'transient') { skipped.push({ branch: it.branch, why: 'transient' }); continue; }
    if (!it.kind || typeof it.evidenceRef !== 'string' || !it.evidenceRef.trim()) { skipped.push({ branch: it.branch, why: 'no_kind_or_evidence_ref' }); continue; }
    if (dup(it.kind, it.evidenceRef)) { skipped.push({ branch: it.branch, why: 'duplicate_evidence' }); continue; }
    if (it.cls === 'substantive_abstain') { writes.push({ source_kind: it.kind, outcome: null, pmt_at: pmtAt, evidence_ref: it.evidenceRef, confidence: null, why: 'substantive_abstain' }); continue; }
    // vote
    if (!(it.side === 0 || it.side === 1)) { skipped.push({ branch: it.branch, why: 'vote_without_side' }); continue; }
    if (conflict) { writes.push({ source_kind: it.kind, outcome: it.side, pmt_at: pmtAt, evidence_ref: it.evidenceRef, confidence: it.confidence ?? null, why: 'dissent(conflict)' }); continue; }
    if (!pmtOk) { skipped.push({ branch: it.branch, why: 'approval_deferred_pmt_invalid' }); continue; }
    if (pmtAt < outcomeEndMs) { skipped.push({ branch: it.branch, why: 'approval_deferred_pmt_before_outcome_end' }); continue; }   // M1: 盖 pmt_at < oe 的批准票永久失格于赞成集 ⇒ 不写, 下 tick 再判
    writes.push({ source_kind: it.kind, outcome: it.side, pmt_at: pmtAt, evidence_ref: it.evidenceRef, confidence: it.confidence ?? null, why: 'approval' });
  }
  return { writes, skipped };
}
