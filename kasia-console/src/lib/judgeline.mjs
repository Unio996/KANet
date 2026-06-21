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
//
// 命门③ canonicalPredicate/predicateCommit 的纯依赖 (均守上面纯函数硬约束: 无 I/O/时钟/随机/浮点):
//   blake2b — 同 pool-payout-root payoutLeaf / SS 链上同款 (dkLen 32); normalizeAbbr — abbr canonical 单源。
import { blake2b } from '@noble/hashes/blake2b';
import { normalizeAbbr } from './oracle-evidence-extractors.mjs';

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

/**
 * validateResolutionPredicate — 建市 prevet: 结构校验 predicate 合 judgeLine 契约 (oracle 让分/大小球 wave, J1 2026-06-20)。
 * judgeLine 在 settle 时对脏 predicate 返 ABSTAIN(judge-time 兜底); 本函数在【建市 prevet】拒脏 predicate(create-time 闸),
 * 防脏 predicate baked on-chain 后市场永 ABSTAIN(不可改)。与 judgeLine 同文件 = 共用 METRICS/NUM_OPS, 契约零 drift。
 *
 * 命门(Bettor determinism, 落码守): scale 定点无浮点 — operand 必整数(线 ×10^scale, 如 -3.5 → operand:35 scale:1),
 *   禁浮点(跨平台不确定); emit 侧(create)与 judge 侧(judgeLine)同 scale 约定对死。subject 是 team abbr(judge-time
 *   验 == home/away_team, 此处只验结构非空; abbr 必走 J2 normalizeAbbr 单源 = emit==field 同 abbr)。
 *
 * @param {object} predicate 市场 resolution_predicate {metric, op, operand, scale?, subject?}
 * @returns {{valid:boolean, reason?:string}}
 */
export function validateResolutionPredicate(predicate) {
  if (!predicate || typeof predicate !== 'object') return { valid: false, reason: 'predicate 必须是对象' };
  const { metric, op, operand } = predicate;
  if (!METRICS.has(metric)) return { valid: false, reason: `metric 必须 ∈ {${[...METRICS].join(',')}}, got ${JSON.stringify(metric)}` };

  // winner: 字符串相等, 仅 op '=='
  if (metric === 'winner') {
    if (op !== '==') return { valid: false, reason: "winner metric 仅支持 op '=='" };
    if (typeof operand !== 'string' || !operand.trim()) return { valid: false, reason: 'winner operand 必须是非空 team abbr 字符串' };
    if (operand === TIE_TOKEN) return { valid: false, reason: `winner operand 不可为平局 token '${TIE_TOKEN}'(保留)` };
    return { valid: true };
  }

  // 数值 metric: margin / total / score — 整数定点
  if (!NUM_OPS.has(op)) return { valid: false, reason: `${metric} metric 的 op 必须 ∈ {${[...NUM_OPS].join(',')}}, got ${JSON.stringify(op)}` };
  if (!isInt(operand)) return { valid: false, reason: 'operand 必须是整数(定点 ×10^scale, 如线 3.5→operand:35 scale:1); 禁浮点(跨平台不确定)' };
  const scale = predicate.scale === undefined ? 0 : predicate.scale;
  if (pow10(scale) === null) return { valid: false, reason: 'scale 必须是整数 0..6' };

  if (metric === 'total') {
    if (predicate.subject !== undefined && predicate.subject !== null) return { valid: false, reason: 'total metric 不应有 subject(它合两队总分)' };
    return { valid: true };
  }
  // margin / score 需 subject(team abbr)
  if (typeof predicate.subject !== 'string' || !predicate.subject.trim()) return { valid: false, reason: `${metric} metric 需 subject(让分方/计分方 team abbr)` };
  return { valid: true };
}

/**
 * parseLineToFixedPoint — 线字符串 → {operand:int, scale:int} 定点, 【纯字符串解析无浮点】(NWT determinism 命门④, J1)。
 * 🔴禁 parseFloat(s)×10^scale: 浮点 0.1-class 误差(3.5×10=35 OK 但某些线 ×10 → 34.9999→round 错, 跨平台不确定)。
 * 安全 = split "." 直接拼整数: "3.5"→{35,1} / "-3.5"→{-35,1} / "220.5"→{2205,1} / "7"→{7,0} / "3.25"→{325,2}。
 * @param {string} lineStr
 * @returns {{operand:number, scale:number}|null} null = 非法格式
 */
export function parseLineToFixedPoint(lineStr) {
  if (typeof lineStr !== 'string') return null;
  const s = lineStr.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;          // 仅 [-]整数[.小数]; 无指数/空格/多点
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? '' : body.slice(dot + 1);
  const scale = fracPart.length;
  if (pow10(scale) === null) return null;               // scale 0..6 (与 judgeLine 同界)
  const digits = intPart + fracPart;                    // 纯字符串拼接, 无浮点: "3"+"5"="35"
  const mag = parseInt(digits, 10);                     // digits 全数字(regex 已保证)→ 安全整数解析
  if (!Number.isSafeInteger(mag)) return null;
  return { operand: neg ? -mag : mag, scale };
}

/**
 * buildResolutionPredicate — 市场类型 + 线 + subject → judgeLine 兼容 predicate (emit 侧, J1 oracle 让分/大小球 wave)。
 * 用 parseLineToFixedPoint(无浮点) + validateResolutionPredicate(prevet) = emit 的 operand/scale 与 judge 侧契约对死。
 * @param {{kind:'winner'|'spread'|'total', line?:string, op?:string, winner?:string, subject?:string}} o
 *   spread(让分): {kind:'spread', line:"-3.5"|"3.5", op:'>'(cover默认)|'<', subject:让分方abbr}
 *   total(大小球): {kind:'total', line:"220.5", op:'>'(over默认)|'<'}
 *   winner: {kind:'winner', winner:abbr}
 * @returns {{valid:boolean, predicate?:object, reason?:string}}
 */
export function buildResolutionPredicate(o) {
  if (!o || typeof o !== 'object') return { valid: false, reason: 'opts 必须是对象' };
  if (o.kind === 'winner') {
    const predicate = { metric: 'winner', op: '==', operand: o.winner };
    const v = validateResolutionPredicate(predicate);
    return v.valid ? { valid: true, predicate } : { valid: false, reason: v.reason };
  }
  if (o.kind === 'spread' || o.kind === 'total') {
    const fp = parseLineToFixedPoint(o.line);
    if (!fp) return { valid: false, reason: `线 ${JSON.stringify(o.line)} 非法定点格式(需 [-]整数[.小数], scale≤6)` };
    const metric = o.kind === 'spread' ? 'margin' : 'total';
    const op = o.op || '>';                              // 默认 '>': spread cover / total over
    let operand = fp.operand;
    if (o.kind === 'spread') {
      // 🔴让分 sign 语义(round-trip 测抓到, 别错): line = subject 的让分(负=favored 被让, 正=underdog 受让)。
      //   subject covers iff (subject_score + line) > opp_score ⟺ margin(subject) > -line。∴ operand = -line。
      //   "LAL -3.5"(line=-35)→ operand=+35 → margin(LAL)>3.5 才 cover(赢超 3.5); "LAL +3.5"(line=35)→ operand=-35 → margin>-3.5(输不超 3.5 或赢)。
      operand = -operand;
    }
    const predicate = { metric, op, operand, scale: fp.scale };
    if (o.kind === 'spread') predicate.subject = o.subject;  // 让分方 abbr(必 == home/away_team, judge-time 验)
    const v = validateResolutionPredicate(predicate);
    return v.valid ? { valid: true, predicate } : { valid: false, reason: v.reason };
  }
  return { valid: false, reason: `未知 kind ${JSON.stringify(o.kind)}` };
}

// ─────────────────────────────────────────────────────────────────────────
// 命门③ (Owner 钦定①真门) — predicate→genesis-commitment 单源绑定 (J1, 2026-06-21)。
//
// predicate_commit 是 PayoutShard ctor 参2 (redeem offset 518) 烤死的 immutable genesis hash。
// 委员 enforceCommitteeSign 必验【blake2b(canonicalPredicate(predicate)) == 链上 predicate_commit】
// (从被签 close_attest tx 的 PS input redeem 抽, 不信 driver/DB/caller env)——否则委员 re-derive
// 跑在【未绑 predicate】上 = vacuous 假牙 (NWT/Bettor 红队抓, 2026-06-21)。
//
// 单源铁律: genesis 烤 predicate_commit 与委员 re-bind 必调【同一 canonicalPredicate】, 否则跨层
// 序列化漂移 → hash 裂 → 命门③ 误拒/被绕 (cross-layer-consistency 病)。
// ─────────────────────────────────────────────────────────────────────────

/**
 * canonicalPredicate — predicate → 确定性 canonical bytes (跨节点 byte-identical)。
 * 格式 pc1 (长度前缀防分隔符注入, float-free):
 *   parts = ['pc1', metric, op, scaleCanon, operandCanon, subjectCanon]
 *   bytes = Σ ( uint32LE(utf8(part).byteLength) ‖ utf8(part) )
 * 字段规范:
 *   · operandCanon: winner → normalizeAbbr(operand) (胜方 abbr 单源, 与 judgeLine winner_side===operand 对死);
 *                   margin/total/score → String(operand) (已 ×10^scale 整数, validate 已强制)
 *   · subjectCanon: margin/score → normalizeAbbr(subject); winner/total → ''
 *   · scaleCanon:   winner → '0'(无 scale 语义); 数值 → String(scale??0)
 * @param {{metric:string, op:string, operand:(string|number), scale?:number, subject?:string}} predicate
 * @returns {Uint8Array} 确定性 canonical bytes
 * @throws 若 predicate 不合 judgeLine 契约 (委员路径必 try/catch → 拒签; 攻击者改结构 → 抛 → 拒)
 */
export function canonicalPredicate(predicate) {
  const v = validateResolutionPredicate(predicate);
  if (!v.valid) throw new Error(`canonicalPredicate: predicate 不合 judgeLine 契约 — ${v.reason}`);

  const metric = predicate.metric;
  const op = predicate.op;
  let operandCanon, subjectCanon, scaleCanon;

  if (metric === 'winner') {
    operandCanon = normalizeAbbr(predicate.operand);              // 胜方 abbr → 单源规范
    if (operandCanon === null) throw new Error('canonicalPredicate: winner operand 非法 abbr');
    if (operandCanon === TIE_TOKEN) throw new Error(`canonicalPredicate: winner operand 规范化后==平局 token '${TIE_TOKEN}'(保留)`);
    subjectCanon = '';
    scaleCanon = '0';
  } else {
    operandCanon = String(predicate.operand);                    // 已定点整数 (validate isInt 保证)
    scaleCanon = String(predicate.scale === undefined ? 0 : predicate.scale);
    if (metric === 'total') {
      subjectCanon = '';
    } else {
      subjectCanon = normalizeAbbr(predicate.subject);           // margin/score 让分方/计分方
      if (subjectCanon === null) throw new Error('canonicalPredicate: margin/score subject 非法 abbr');
    }
  }

  const parts = ['pc1', metric, op, scaleCanon, operandCanon, subjectCanon];
  const enc = new TextEncoder();
  const encoded = parts.map((p) => enc.encode(p));
  const total = encoded.reduce((n, b) => n + 4 + b.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const b of encoded) {
    dv.setUint32(off, b.length, true);                           // LE 长度前缀
    off += 4;
    out.set(b, off);
    off += b.length;
  }
  return out;
}

/**
 * predicateCommit — 命门③ genesis commitment = blake2b(canonicalPredicate(p))[32]。
 * == PayoutShard ctor 参2 predicate_commit (redeem offset 518)。blake2b dkLen 32, 同 payoutLeaf/SS
 * 链上同款。genesis 烤 + 委员 re-bind 单源同此 (零跨层漂移)。
 * @param {{metric,op,operand,scale?,subject?}} predicate
 * @returns {string} 64-hex (lowercase) 32-byte commitment
 */
export function predicateCommit(predicate) {
  const h = blake2b(canonicalPredicate(predicate), { dkLen: 32 });
  let hex = '';
  for (let i = 0; i < h.length; i++) hex += h[i].toString(16).padStart(2, '0');
  return hex;
}
