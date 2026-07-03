// pool-preflight-gate.mjs — G1 世界杯市场 pre-flight gate (J2, 2026-07-04)
//
// 设计: docs/2026-07-04-worldcup-G1-market-wording-preflight-design.md (Bettor, NWT v2 GREEN)
// 三项全绿才允许建盘: ①镜像源逻辑等价核对(非字面文本比对) ②deadline 充足 ③judge 延迟参数存在。
//
// NWT BLOCKING-2 修(设计 §2.1): 禁字面 text-equals — 我方模板刻意用"晋级/advance"而镜像源大概率
// 用"win/获胜"措辞，若逐字比对，gate 会把自己每一盘都拦下。改为比对三个逻辑属性:
//   ① 同一场次(matchId/队伍对/kickoff 时间一致) ② 同一 resolution 事件源
//   ③ 点球晋级归类一致(我方"点球晋级算 YES"与镜像源判定规则映射相同)
//
// 只做纯校验计算 + 一个 DB 写入 helper, 不碰建市主流程(由 caller 在 create-v07 里挂钩调用)。

/**
 * checkMirrorSourceEquivalence — NWT BLOCKING-2 修法: 三属性逻辑等价, 非字面文本比对。
 * @param {object} o {
 *   ourMatchId, ourTeamA, ourTeamB, ourKickoffUtc(unix sec),
 *   ourResolutionSource(string, e.g. 'official_fifa_result'),
 *   ourPenaltyCountsAsAdvance(bool|null, null=此盘不涉及点球语义如冠军长线/win式单场盘),
 *   mirrorMatchId, mirrorTeamA, mirrorTeamB, mirrorKickoffUtc,
 *   mirrorResolutionSource, mirrorPenaltyCountsAsAdvance(bool|null)
 * }
 * @returns {{ pass, reasons: string[] }}
 */
export function checkMirrorSourceEquivalence(o) {
  const reasons = [];
  // ① 同一场次: matchId 精确匹配 OR (队伍对匹配 + kickoff 在 ±30min 内, 容跨源时区/精度差)
  const sameMatchId = o.ourMatchId && o.mirrorMatchId && String(o.ourMatchId) === String(o.mirrorMatchId);
  const teamsMatch = _sameTeamPair(o.ourTeamA, o.ourTeamB, o.mirrorTeamA, o.mirrorTeamB);
  const kickoffClose = Number.isFinite(o.ourKickoffUtc) && Number.isFinite(o.mirrorKickoffUtc)
    && Math.abs(o.ourKickoffUtc - o.mirrorKickoffUtc) <= 1800; // 30min tolerance
  if (!sameMatchId && !(teamsMatch && kickoffClose)) {
    reasons.push(`场次不对齐: matchId(${o.ourMatchId} vs ${o.mirrorMatchId}) 不match, 且队伍/kickoff 也对不上(teamsMatch=${teamsMatch} kickoffClose=${kickoffClose})`);
  }
  // ② 同一 resolution 事件源
  if (!o.ourResolutionSource || !o.mirrorResolutionSource || o.ourResolutionSource !== o.mirrorResolutionSource) {
    reasons.push(`resolution 源不一致: ours="${o.ourResolutionSource}" mirror="${o.mirrorResolutionSource}"`);
  }
  // ③ 点球晋级归类一致(仅当双方都定义了这个语义时才比对; null=此盘类型不涉及, 视为通过——如 §1.2/§1.3 win 式单场盘)
  if (o.ourPenaltyCountsAsAdvance !== null && o.mirrorPenaltyCountsAsAdvance !== null) {
    if (o.ourPenaltyCountsAsAdvance !== o.mirrorPenaltyCountsAsAdvance) {
      reasons.push(`点球晋级归类不一致: ours=${o.ourPenaltyCountsAsAdvance} mirror=${o.mirrorPenaltyCountsAsAdvance}`);
    }
  }
  return { pass: reasons.length === 0, reasons };
}

function _sameTeamPair(a1, b1, a2, b2) {
  if (!a1 || !b1 || !a2 || !b2) return false;
  const norm = (s) => String(s).trim().toLowerCase();
  const p1 = [norm(a1), norm(b1)].sort();
  const p2 = [norm(a2), norm(b2)].sort();
  return p1[0] === p2[0] && p1[1] === p2[1];
}

/**
 * checkDeadlineSufficient — §2 项2: deadline >= kickoff + minBufferHours(默认4h:
 * 90min 正赛 + 30min 加时 + 点球 + 判定缓冲)。
 */
export function checkDeadlineSufficient({ deadlineUnixSec, kickoffUtcUnixSec, minBufferHours = 4 }) {
  if (!Number.isFinite(deadlineUnixSec) || !Number.isFinite(kickoffUtcUnixSec)) {
    return { pass: false, reasons: [`deadline/kickoff 非数字: deadline=${deadlineUnixSec} kickoff=${kickoffUtcUnixSec}`] };
  }
  const minDeadline = kickoffUtcUnixSec + minBufferHours * 3600;
  if (deadlineUnixSec < minDeadline) {
    return { pass: false, reasons: [`deadline 不足: ${deadlineUnixSec} < kickoff+${minBufferHours}h(${minDeadline}), 差 ${((minDeadline - deadlineUnixSec) / 60).toFixed(1)} 分钟`] };
  }
  return { pass: true, reasons: [] };
}

/**
 * checkJudgeTimingConfigured — §2 项3: judge 延迟参数必须显式提供(不是"忘了配默认成0"这种隐式)。
 * 具体推荐值待 G7 扫描结论(Bettor 7/6 前) — 本函数只校验"有没有配", 不钉死数值(数值决策不在这个 gate 的职责)。
 */
export function checkJudgeTimingConfigured({ judgeDelayMinutes }) {
  if (!Number.isFinite(judgeDelayMinutes) || judgeDelayMinutes < 0) {
    return { pass: false, reasons: [`judge 延迟参数未配置或非法: judgeDelayMinutes=${judgeDelayMinutes}(等 G7 扫描结论给推荐值前, caller 必须显式传一个 >=0 的值, 不许留空默认成0悄悄通过)`] };
  }
  return { pass: true, reasons: [] };
}

/**
 * runPreflightGate — 三项汇总, 全绿才 pass。
 * @returns {{ pass, checks: {mirrorSource, deadline, judgeTiming}, checkedAt }}
 */
export function runPreflightGate({ mirrorCheck, deadlineCheck, judgeTimingCheck, mirrorSnapshot }) {
  const mirrorSource = checkMirrorSourceEquivalence(mirrorCheck);
  const deadline = checkDeadlineSufficient(deadlineCheck);
  const judgeTiming = checkJudgeTimingConfigured(judgeTimingCheck);
  return {
    pass: mirrorSource.pass && deadline.pass && judgeTiming.pass,
    checks: { mirrorSource, deadline, judgeTiming },
    // 供人工追溯的镜像源快照(conditionId + criteria 原文) — 设计 §2.1 要求存, 非机器逐字比对用途。
    mirrorSnapshot: mirrorSnapshot || null,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * savePreflightRecord — 落 pool_markets.metadata.preflight(设计 §2 "核对记录落 DB")。
 * 调用方需已有 market row(create-v07 主流程建完 row 后调用, 或建 row 时一并塞进 metadata)。
 */
export function savePreflightRecord(db, marketId, gateResult) {
  const row = db.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) throw new Error(`savePreflightRecord: market ${marketId} not found`);
  let meta = {}; try { meta = JSON.parse(row.metadata || '{}'); } catch {}
  meta.preflight = gateResult;
  db.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), marketId);
}
