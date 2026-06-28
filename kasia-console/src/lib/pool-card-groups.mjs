// pool-card-groups.mjs — 赛事聚合卡【纯聚合器】(J2, 2026-06-28, Owner① UX 首页后端).
//
// 把已查出的 pending_bettors 散盘行 (含 per-leg 池/人数, 由 caller 用 trending 同款 SQL 算好) 按
// spec.card_group_id 聚成【赛事卡】(一场赛 → winner/spread/total 多 leg 嵌一卡)。纯函数·零 I/O·可独测。
//
// 单源理由 (线8 机制哲学): 聚合/去重/trust-字段映射只在此一处实现, /api/pool/markets/card_groups 端点
//   只负责 SQL + 调本函数 → 端点与测试同走一份逻辑, 不漂移。card_group_id/leg_key 由 sports-card-builder.mjs
//   建市时折入 spec (= 建市侧单源)。
//
// 护栏: commingled spine (FINDING-2) 由 caller 传入 commingledSpines Set 排除 (单源 isCommingledSpine helper);
//   AutoBetter 押注由 caller 的 SQL 排除 (per-leg 数已净)。本函数不碰链不碰 settle。

const BETTOR_WEIGHT = 10;   // 与 trending 同权 (多人小注 > 单人刷大池)

/**
 * aggregateCardGroups — 纯聚合: market 行 → 赛事卡数组。
 * @param {Array<object>} rows  每行: { id, resolution_rule_spec(JSON str), outcome_side, deadline,
 *   maker_stake_amount, spine_p2sh, bettor_count, yes_sompi, no_sompi } (per-leg 数已由 SQL 算好/净化)
 * @param {Set<string>} commingledSpines  FINDING-2 commingled spine_p2sh 集 (单源 helper 产)
 * @param {{limit?:number}} [opts]
 * @returns {{ ok:true, count:number, card_groups:Array<object> }}
 */
export function aggregateCardGroups(rows, commingledSpines, opts = {}) {
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 8, 1), 50);
  const groups = new Map();
  for (const r of rows) {
    if (commingledSpines && commingledSpines.has(r.spine_p2sh)) continue;   // FINDING-2 排除
    let spec;
    try { spec = JSON.parse(r.resolution_rule_spec || ''); } catch { continue; }
    if (!spec || typeof spec !== 'object' || !spec.card_group_id) continue;   // 只聚合带 card_group 的赛事盘
    const cgid = spec.card_group_id;
    const legKey = spec.leg_key || r.id;
    const kind = String(legKey).split('_')[0] || 'unknown';   // winner/spread/total (= leg_key 前缀)
    const makerSompi = r.maker_stake_amount || 0;
    const makerOnYes = r.outcome_side === 'YES';
    const yesPool = Number(r.yes_sompi) + (makerOnYes ? makerSompi : 0);
    const noPool = Number(r.no_sompi) + (!makerOnYes ? makerSompi : 0);
    const totalPool = yesPool + noPool;
    const leg = {
      id: r.id, leg_key: legKey, kind,
      label: spec.title || legKey,
      line: spec.line || null, subject: spec.subject || null,
      deadline: r.deadline,
      bettor_count: r.bettor_count,
      total_pool_kas: totalPool / 1e8,
      yes_implied_prob: totalPool > 0 ? yesPool / totalPool : null,
      // trust 字段 (UI 信任卡): 可审计来源 + 结算规则 + 链上 spine 锚
      data_source_canonical: spec.data_source_canonical || null,
      resolution_criteria: spec.resolution_criteria || null,
      spine_p2sh: r.spine_p2sh,
      _activity: r.bettor_count * BETTOR_WEIGHT + totalPool / 1e8,
    };
    let g = groups.get(cgid);
    if (!g) {
      g = {
        card_group_id: cgid,
        event_title: (spec.home_team && spec.away_team)
          ? `${spec.home_team} vs ${spec.away_team}` : (spec.source_label || cgid),
        league_label: spec.source_label || null,
        event_id: spec.event_id || null,
        home_team: spec.home_team || null, away_team: spec.away_team || null,
        kickoff: spec.kickoff || null,
        legsByKey: new Map(),
      };
      groups.set(cgid, g);
    }
    // dedupe 同 leg_key: 留活跃度高那条 (重复建市)
    const prev = g.legsByKey.get(legKey);
    if (!prev || leg._activity > prev._activity) g.legsByKey.set(legKey, leg);
  }
  const cards = [...groups.values()].map((g) => {
    const legs = [...g.legsByKey.values()]
      .sort((a, b) => b._activity - a._activity)
      .map(({ _activity, ...l }) => l);
    const total_bettor_count = legs.reduce((s, l) => s + l.bettor_count, 0);
    const total_pool_kas = Math.round(legs.reduce((s, l) => s + l.total_pool_kas, 0) * 1e8) / 1e8;
    const soonest_deadline = legs.reduce((m, l) => (m === null || l.deadline < m ? l.deadline : m), null);
    const { legsByKey, ...meta } = g;
    return { ...meta, leg_count: legs.length, total_bettor_count, total_pool_kas, soonest_deadline, legs };
  })
    .filter((c) => c.leg_count > 0)
    .sort((a, b) => (b.total_bettor_count * BETTOR_WEIGHT + b.total_pool_kas) - (a.total_bettor_count * BETTOR_WEIGHT + a.total_pool_kas))
    .slice(0, limit);
  return { ok: true, count: cards.length, card_groups: cards };
}
