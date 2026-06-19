// D-L1: deterministic judgeLine pure function — oracle hardening wave 1 (J1, 2026-06-19).
// Adversarial-consensus design放行: docs/2026-06-19-bettor-adversarial-review-wave1.md.
//
// 承重原则 — determinism = 跨节点 AGREE 非 CORRECT。本函数只保证"同输入→同输出"(算术轴①),
// 正确性由上游源完整性(NWT field-hash 源轴)+ 部署等价(KANet-UI manifest 码轴)在 settler 合并
// 双轴 gate 兜。judgeLine.mjs 必列入 settle-path manifest(算术轴跨节点一致靠码轴覆盖)。
//
// 纯函数硬约束(算术轴, 落码必守):
//   · 无 LLM / 无 I/O / 无时钟(Date/now) / 无随机(Math.random) / 无浮点(float)运算
//   · 仅整数定点比较; 同 (predicate, fields) 在任何节点 byte-identical 码下 → 同 verdict
//
// 输入集 invariant(J1/J2/NWT 三方对齐, hash集==judgeLine输入集):
//   fields(J2 StructuredEvidence) = { winner_side, home_team, away_team, home_score, away_score }
//   —— 全整数/abbr, 零时间戳/动态字段。NWT field_hash 哈严格这5个。
//   predicate(市场 resolution_predicate, 建市固定 on-chain, 不进 field_hash):
//     { metric, op, operand, scale, subject? }
//
// 三态: 可判+字段足 → 'YES'|'NO'; 字段缺/不合法/无法判 → 'ABSTAIN'(不猜)。
// 主观/不可结构化谓词在【建市 prevet】拒(spec-validation), 不到 judgeLine。

const METRICS = new Set(['winner', 'margin', 'total', 'score']);
const NUM_OPS = new Set(['==', '>=', '<=', '>', '<']);
// 平局 canonical token (J2 单源 normalizeAbbr 产, 真 team abbr 永不撞)。winner metric 显式拦截,
// 不让平局 fall through 到 === 涌现(NWT 确定性 seam)。margin/total/score 平局=正常整数无需特判。
const TIE_TOKEN = 'TIE';

// 整数 10^scale (scale 小: 0..6)。纯整数, 不用 Math.pow(可能返回 float)。
function pow10(scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) return null;
  let p = 1;
  for (let i = 0; i < scale; i++) p *= 10;
  return p;
}

function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }

// subject(队 abbr)映射到该队得分。subject 必等于 home_team 或 away_team, 否则 null(→ABSTAIN)。
function subjectScore(fields, subject) {
  if (subject === fields.home_team) return { self: fields.home_score, other: fields.away_score };
  if (subject === fields.away_team) return { self: fields.away_score, other: fields.home_score };
  return null;
}

function applyNumOp(op, lhs, rhs) {
  switch (op) {
    case '==': return lhs === rhs;
    case '>=': return lhs >= rhs;
    case '<=': return lhs <= rhs;
    case '>':  return lhs > rhs;
    case '<':  return lhs < rhs;
    default:   return null;
  }
}

/**
 * judgeLine — 确定性纯判函数。
 * @param {{metric:string, op:string, operand:(string|number), scale?:number, subject?:string}} predicate
 * @param {{winner_side?:string, home_team?:string, away_team?:string, home_score?:number, away_score?:number}} fields
 * @returns {'YES'|'NO'|'ABSTAIN'}
 */
export function judgeLine(predicate, fields) {
  // 0. 基本结构校验 → 不合法即 ABSTAIN(不猜)
  if (!predicate || typeof predicate !== 'object') return 'ABSTAIN';
  if (!fields || typeof fields !== 'object') return 'ABSTAIN';
  const { metric, op, operand } = predicate;
  if (!METRICS.has(metric)) return 'ABSTAIN';

  // 1. winner: 字符串相等, 仅 op '=='。读 winner_side。
  if (metric === 'winner') {
    if (op !== '==') return 'ABSTAIN';                 // winner 只支持 ==
    if (typeof operand !== 'string' || !operand) return 'ABSTAIN';
    const w = fields.winner_side;
    if (typeof w !== 'string' || !w) return 'ABSTAIN'; // 缺胜方(空/null)=数据不足 → ABSTAIN(abstain-not-guess)
    if (w === TIE_TOKEN) return 'NO';                  // 显式平局: 'X 赢?'平局 = X 没赢 = NO (Bettor 裁①, 可确定非瞎判, 非 === 涌现)
    return w === operand ? 'YES' : 'NO';
  }

  // 2..4 数值 metric: margin / total / score — 整数定点比较。
  if (!NUM_OPS.has(op)) return 'ABSTAIN';
  if (!isInt(operand)) return 'ABSTAIN';               // operand 必整数(定点已 ×10^scale)
  const scale = predicate.scale === undefined ? 0 : predicate.scale;
  const mul = pow10(scale);
  if (mul === null) return 'ABSTAIN';                  // 非法 scale

  // 计算 metric 的整数值(field 原始 scale=0)
  let fieldVal;
  if (metric === 'total') {
    if (!isInt(fields.home_score) || !isInt(fields.away_score)) return 'ABSTAIN';
    fieldVal = fields.home_score + fields.away_score;
  } else {
    // margin / score 需要 subject 映射
    if (typeof predicate.subject !== 'string' || !predicate.subject) return 'ABSTAIN';
    if (!isInt(fields.home_score) || !isInt(fields.away_score)) return 'ABSTAIN';
    if (typeof fields.home_team !== 'string' || typeof fields.away_team !== 'string') return 'ABSTAIN';
    const s = subjectScore(fields, predicate.subject);
    if (s === null) return 'ABSTAIN';                  // subject 不匹配任一队
    fieldVal = metric === 'score' ? s.self : (s.self - s.other); // score=自分, margin=净胜(可负)
  }

  // 定点对齐: field 原始整数 ×10^scale 与 operand(已 ×10^scale)同标度比较。纯整数。
  const scaledField = fieldVal * mul;
  const res = applyNumOp(op, scaledField, operand);
  if (res === null) return 'ABSTAIN';
  return res ? 'YES' : 'NO';
}

export const __JUDGELINE_INPUT_FIELDS__ = ['winner_side', 'home_team', 'away_team', 'home_score', 'away_score'];
