// sports-card-builder — 热门赛事 → 完整可结算盘组 (winner + 让分 spread + 大小球 total) 的【纯构建器】。
// J2-tn 2026-06-27 (Owner 热需求: 热门赛连让球/大小球捞上首页; Bettor 护栏1-6 + J1 接口雷)。
//
// 定位 (draft-only, 零钱零链):
//   本模块只产【市场定义草稿】(resolution_rule_spec + resolution_predicate + ESPN data_source),
//   不碰链、不锁 stake、不入库。on-chain 实例化 (create-v07) 是【独立后续】, gated on J1 settle-verify。
//   = 护栏1 (draft 态先建 → J1 验过 → 才翻 open 可押)。
//
// 护栏 (Bettor 钦定, 落码守):
//   护栏2 score 源: data_source_canonical 必是 ESPN summary URL (extractor 认得 → 产 5 字段
//                  winner_side/home_team/away_team/home_score/away_score)。绑二元 Polymarket(无比分)
//                  的 spread/total = judgeLine ABSTAIN = un-settleable → 本构建器拒。
//   护栏3 sport-aware 线: 足球低比分, spread 摆 -0.5/-1.5, total O/U 2.5 (别套棒球 -3.5)。
//   护栏6 半线铁律 (J1 压测实证·硬): 让分/大小球只造【半线】, 整数线物理上无法表示 push (净胜恰好==线)
//                  → judgeLine 无 void/refund verdict → stranded。本构建器对 integer operand 直接拒建。
//                  bright-line: 线定点后 operand % 10^scale === 0 (= 整数线) → REJECT。
//   J1 接口雷: 正线必传 bare "3.5" 不能 "+3.5" (parseLineToFixedPoint regex 拒 "+")。本构建器
//             subject 让分线一律传 favorite 的负让分 (如 BRA -1.5), 受让方走对手的镜像 (不传 "+")。
//
// abbr 单源: home_team/away_team/winner operand/spread subject 全过 normalizeAbbr (== ESPN extractor
//   settle 时产的 abbr), 否则 judgeLine subject!=home/away → ABSTAIN (finding1 seam)。

import { buildResolutionPredicate, parseLineToFixedPoint } from './judgeline.mjs';
import { normalizeAbbr, findExtractor } from './oracle-evidence-extractors.mjs';

// 足球 sport-aware 允许线 (护栏3)。半线 only (护栏6 由 assertNoPushLine 二次硬卡, 这里是 sanity 上界)。
const SOCCER_SPREAD_LINES = new Set(['-0.5', '-1.5', '-2.5', '0.5', '1.5', '2.5']);
const SOCCER_TOTAL_LINES = new Set(['1.5', '2.5', '3.5', '4.5']);

// 护栏6 bright-line: 线 → 定点 → 若 operand 是整数倍 (operand % 10^scale === 0) = 整数线 → push 可能 → 拒。
//   比分是整数 → margin/total 是整数 → 当线==整数时净胜/总分可恰好==线 = push = judgeLine 二元池无法表示。
//   半线 (x.5) 时 2×operand 为奇 → 永不可能 net==line → 无 push。
function assertNoPushLine(lineStr) {
  const fp = parseLineToFixedPoint(lineStr);
  if (!fp) return { ok: false, reason: `线 ${JSON.stringify(lineStr)} 非法定点格式 (需 [-]整数[.小数], 无 "+"/空格)` };
  let p = 1;
  for (let i = 0; i < fp.scale; i++) p *= 10;
  if (fp.operand % p === 0) {
    return { ok: false, reason: `线 ${JSON.stringify(lineStr)} 是整数线 → push 可能 (净胜/总分可恰好==线), 二元池无 void verdict = stranded。只造半线 (护栏6)` };
  }
  return { ok: true };
}

/**
 * buildSportsCard — 纯函数: 一场赛事 descriptor → 校验过的完整盘组 (draft 定义, 不入库不碰链)。
 * @param {object} d descriptor:
 *   { sport:'soccer', league_label, event_id, data_source_canonical(ESPN summary URL),
 *     home_team, away_team, home_name, away_name, kickoff_iso, outcome_end_date,
 *     favorite (= 负让分方 abbr, 必 == home_team 或 away_team),
 *     legs: { winner:[abbr...], spread:[lineStr...], total:[lineStr...] } }
 * @returns {{ valid:boolean, errors:string[], card_group_id, event_id, markets:object[] }}
 *   每 market: { leg_key, kind, title, resolution_criteria, resolution_predicate,
 *               data_source_canonical, resolution_rule_spec(JSON string), outcome_side:'YES', status:'draft' }
 */
export function buildSportsCard(d) {
  const errors = [];
  const markets = [];
  if (!d || typeof d !== 'object') return { valid: false, errors: ['descriptor 必须是对象'], markets: [] };

  // ── 护栏2: data_source 必 ESPN-extractable (产比分字段) ──
  const src = String(d.data_source_canonical || '').trim();
  const ext = src ? findExtractor(src) : null;
  if (!ext || ext.kind !== 'espn') {
    errors.push(`护栏2: data_source_canonical 必须是 ESPN summary URL (extractor kind=espn, 产 home/away_score)。got=${JSON.stringify(src).slice(0, 80)} kind=${ext?.kind || 'none'}`);
  }

  const home = normalizeAbbr(d.home_team);
  const away = normalizeAbbr(d.away_team);
  if (!home || !away || home === away) {
    errors.push(`home_team/away_team abbr 缺或撞 (home=${d.home_team} away=${d.away_team}) — 必从真 ESPN event 取`);
    return { valid: false, errors, markets: [] };
  }
  const fav = d.favorite ? normalizeAbbr(d.favorite) : home;
  if (fav !== home && fav !== away) {
    errors.push(`favorite ${JSON.stringify(d.favorite)} 必 == home(${home}) 或 away(${away})`);
  }
  const card_group_id = `espn-${d.league_label || 'sport'}-${d.event_id}`.replace(/\s+/g, '_');
  const matchTitle = `${d.home_name || home} vs ${d.away_name || away}`;
  const legs = d.legs || {};

  const pushMarket = (leg_key, kind, predicate, title, criteria, extra) => {
    const spec = {
      title,
      resolution_criteria: criteria,
      data_source_canonical: src,
      resolution_predicate: predicate,
      source_label: `ESPN ${d.league_label || ''}`.trim(),
      event_id: String(d.event_id),
      card_group_id,
      home_team: home,
      away_team: away,
      kickoff: d.kickoff_iso || null,
      leg_key,
      ...(extra || {}),
    };
    markets.push({
      leg_key, kind, title, resolution_criteria: criteria,
      resolution_predicate: predicate,
      data_source_canonical: src,
      resolution_rule_spec: JSON.stringify(spec),
      outcome_side: 'YES', status: 'draft',
      outcome_end_date: d.outcome_end_date || null,
    });
  };

  // ── 胜负 (moneyline) ── 每队一盘 (binary YES = 该队赢; 平局 → judgeLine 显式 NO)。
  for (const w of (legs.winner || [])) {
    const abbr = normalizeAbbr(w);
    if (abbr !== home && abbr !== away) { errors.push(`winner leg ${JSON.stringify(w)} 必 == home/away abbr`); continue; }
    const r = buildResolutionPredicate({ kind: 'winner', winner: abbr });
    if (!r.valid) { errors.push(`winner ${abbr}: ${r.reason}`); continue; }
    const name = abbr === home ? (d.home_name || home) : (d.away_name || away);
    pushMarket(`winner_${abbr}`, 'winner', r.predicate,
      `${d.league_label || ''} ${matchTitle} — ${name} to win`.trim(),
      `Resolves YES iff ESPN final result names ${name} (${abbr}) the winner; draw or ${abbr} loss → NO. Source: ESPN summary event ${d.event_id}.`);
  }

  // ── 让分 (spread) ── subject = favorite, 负让分 (bare, 无 "+")。每条线半线硬卡。
  for (const line of (legs.spread || [])) {
    const lineStr = String(line);
    if (d.sport === 'soccer' && !SOCCER_SPREAD_LINES.has(lineStr)) {
      errors.push(`护栏3: 足球 spread 线 ${JSON.stringify(lineStr)} 不在允许集 {${[...SOCCER_SPREAD_LINES].join(',')}}`); continue;
    }
    const np = assertNoPushLine(lineStr);
    if (!np.ok) { errors.push(np.reason); continue; }
    const r = buildResolutionPredicate({ kind: 'spread', line: lineStr, op: '>', subject: fav });
    if (!r.valid) { errors.push(`spread ${fav} ${lineStr}: ${r.reason}`); continue; }
    const favName = fav === home ? (d.home_name || home) : (d.away_name || away);
    const need = Math.abs(parseFloat(lineStr));
    pushMarket(`spread_${fav}_${lineStr}`, 'spread', r.predicate,
      `${d.league_label || ''} ${matchTitle} — ${favName} ${lineStr}`.trim(),
      `Resolves YES iff ${favName} (${fav}) wins by more than ${need} goal(s) (margin > ${need}); otherwise NO. Half-line = no push. Source: ESPN summary event ${d.event_id}.`,
      { line: lineStr, subject: fav });
  }

  // ── 大小球 (total) ── over (op '>'). 每条线半线硬卡。
  for (const line of (legs.total || [])) {
    const lineStr = String(line);
    if (d.sport === 'soccer' && !SOCCER_TOTAL_LINES.has(lineStr)) {
      errors.push(`护栏3: 足球 total 线 ${JSON.stringify(lineStr)} 不在允许集 {${[...SOCCER_TOTAL_LINES].join(',')}}`); continue;
    }
    const np = assertNoPushLine(lineStr);
    if (!np.ok) { errors.push(np.reason); continue; }
    const r = buildResolutionPredicate({ kind: 'total', line: lineStr, op: '>' });
    if (!r.valid) { errors.push(`total ${lineStr}: ${r.reason}`); continue; }
    pushMarket(`total_o_${lineStr}`, 'total', r.predicate,
      `${d.league_label || ''} ${matchTitle} — Over ${lineStr} goals`.trim(),
      `Resolves YES iff combined goals of both teams > ${lineStr} (i.e. >= ${Math.ceil(parseFloat(lineStr))}); otherwise NO. Half-line = no push. Source: ESPN summary event ${d.event_id}.`,
      { line: lineStr });
  }

  if (!markets.length && !errors.length) errors.push('legs 为空 — 无盘可建 (需 winner/spread/total 至少一条)');
  return { valid: errors.length === 0, errors, card_group_id, event_id: String(d.event_id), markets };
}

/**
 * fetchEspnMatchDescriptor — I/O 层: 从 ESPN summary URL 取真 abbr/home-away/league/kickoff,
 *   产 descriptor 骨架 (caller 填 legs + outcome_end_date)。abbr 必从真 event 取 (不硬编码),
 *   = settle 时 extractor 产同 abbr 的唯一保证。
 * @param {string} summaryUrl ESPN summary?event=<id> URL
 * @returns {Promise<{ok:boolean, descriptor?:object, reason?:string}>}
 */
export async function fetchEspnMatchDescriptor(summaryUrl) {
  const ext = findExtractor(summaryUrl);
  if (!ext || ext.kind !== 'espn') return { ok: false, reason: 'URL 非 ESPN-extractable summary 端点' };
  let raw;
  try {
    const res = await fetch(summaryUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, reason: `ESPN HTTP ${res.status}` };
    raw = await res.text();
  } catch (e) { return { ok: false, reason: `ESPN fetch fail: ${e.message}` }; }
  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, reason: 'ESPN 响应非 JSON' }; }
  const comp = data?.header?.competitions?.[0];
  const competitors = comp?.competitors || [];
  if (competitors.length !== 2) return { ok: false, reason: 'ESPN event 非双方对阵' };
  const h = competitors.find(c => c.homeAway === 'home');
  const a = competitors.find(c => c.homeAway === 'away');
  if (!h || !a) return { ok: false, reason: 'ESPN event 缺 home/away 映射' };
  const home_team = normalizeAbbr(h.team?.abbreviation);
  const away_team = normalizeAbbr(a.team?.abbreviation);
  if (!home_team || !away_team) return { ok: false, reason: 'ESPN team abbreviation 缺' };
  const eventId = String(data?.header?.id || comp?.id || '');
  return {
    ok: true,
    descriptor: {
      sport: 'soccer',
      league_label: data?.header?.league?.name || data?.header?.league?.abbreviation || '',
      event_id: eventId,
      data_source_canonical: summaryUrl,
      home_team, away_team,
      home_name: h.team?.displayName || home_team,
      away_name: a.team?.displayName || away_team,
      kickoff_iso: comp?.date || data?.header?.competitions?.[0]?.date || null,
      state: comp?.status?.type?.state || 'unknown',
    },
  };
}
