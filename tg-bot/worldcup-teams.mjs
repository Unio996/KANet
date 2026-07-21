// worldcup-teams.mjs — 2026 FIFA World Cup 决赛夜临时展示过滤 (KANet-UI 2026-07-19, #19+① 合并设计).
//
// 目的: 首页赛事区 fallback (messages.mjs) 和 /bet 世界杯专题 (prediction-menu.mjs) 都会从
// resolution_rule_spec 标题里挑"世界杯相关"盘展示。问题: 一批"XX国夺冠/晋级"期货盘的球队已经
// 淘汰、结果数学锁定 NO, 但盘子仍挂 pending_bettors 直到远期 deadline 才结算, 混进列表里显示成
// "还能押"极度误导用户 (Owner 2026-07-19 决赛夜亲自撞见)。本模块只做纯展示层过滤, 不碰
// resolution_rule_spec / market_metadata_hash / DB 写入 / 结算逻辑 — 那些已锁定NO的盘子该怎么
// 提前结算是 J2 认领的独立 workstream (oracle/settle 域), 不在这个文件范围内。
//
// ⚠️ TEMPORARY (决赛夜专用, 非通用赛程跟踪系统): WC_SURVIVING_TEAMS 是硬编码的当前决赛两队。
// 决赛(2026-07-19 19:00 UTC)结束后这个列表本身就会过期 — 无论谁夺冠, "Will Spain/Argentina
// win" 也变成已锁定结果, 但赢家还需要在结算前保留可见("已经赢了实锤但盘子技术上还没settle"的
// 状态展示是不同的产品问题, 不该用这条排除规则处理)。决赛结束后必须有人(排 J2 workstream 或
// 下一个接位 agent) 手动评估是否要下线整个 fallback 或更新/清空这个列表 — 刻意不写自动过期逻辑
// (범위刻意收紧到今晚, 不为假设的未来场景加复杂度)。

export const WC_SURVIVING_TEAMS = ['Spain', 'Argentina'];

// 只匹配"单队期货/晋级"句式 (Will X win/reach/advance/be eliminated...)。刻意不匹配对战盘
// ("Spain vs Argentina (Final)") — 双方都还活着才会存在这种盘, 不受这条规则影响。
const TEAM_FUTURES_PATTERN = /\b(win|reach|advance|eliminated)\b/i;

// Bettor 设计闸红队 2026-07-19 实测抓到的 MUST-FIX: TEAM_FUTURES_PATTERN 的 'win' 会误命中个人奖
// 盘("Will Lamine Yamal win the Golden Ball"), 淘汰队球员照样能拿个人奖, 不受球队淘汰锁定, 不该被
// 藏。个人奖关键词命中直接短路放行, 优先于 TEAM_FUTURES_PATTERN 判断。
const INDIVIDUAL_AWARD_PATTERN = /golden (ball|boot|glove)|top (goal)?scorer|young player|best (player|xi)|player of the tournament|\bmvp\b/i;

function extractTitle(rawSpec) {
  let spec;
  try { spec = JSON.parse(rawSpec); } catch { return String(rawSpec || ''); }
  return spec?.event_title || spec?.title || '';
}

function isWorldCupTitle(title) {
  const lower = title.toLowerCase();
  return lower.includes('fifa') || lower.includes('world cup') || title.includes('世界杯');
}

/** True 只当: 是世界杯盘 + 标题是单队期货/晋级句式 + 标题不含任何存活队名。
 *  纯字符串判断, 不查表不碰DB, market 只需要 resolution_rule_spec 字段。 */
export function isDecidedWorldCupMarket(market) {
  const title = extractTitle(market?.resolution_rule_spec);
  if (!title) return false;
  if (!isWorldCupTitle(title)) return false;
  if (INDIVIDUAL_AWARD_PATTERN.test(title)) return false;
  if (!TEAM_FUTURES_PATTERN.test(title)) return false;
  const mentionsSurvivor = WC_SURVIVING_TEAMS.some((team) => title.includes(team));
  return !mentionsSurvivor;
}
