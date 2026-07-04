// worldcup-schedule-cron.mjs — #35 世界杯赛程自动开盘 (J2, 2026-07-04, Owner 钦定头号任务)。
//
// 设计: docs/2026-07-04-worldcup-G1-market-wording-preflight-design.md §3。
// 关键洞察(不用自己搭赛程桥接): ESPN 自己为 QF/SF/3rd/Final 预先发布了带真实 event id + kickoff 的
// "占位符"赛事(队伍名形如 'RD16 W1'/'QFW2'/'SF L1' —— 占位符名字全含数字, 真队伍缩写从不含数字,
// 用这个当判定谓词)。上一轮结果出来后 ESPN 自己把占位符换成真队名, event id 不变。cron 只需定期
// 重新 fetch 同一个 espn_event_id, 检测双边是否已解析成真队伍 → 走 create-v07(#41/R16 验过的安全
// 管线, market_id 烤进 spine)建盘。
//
// 措辞(Bettor 决策1批准): 「{A} 能晋级下一轮吗?」/ "Will {A} advance?" (advance 语义,
// 点球晋级算 YES) —— 决赛/3rd-place 例外用 win 语义(§1.3), 但两者对我们的 predicate 都一样是
// {metric:'winner', op:'==', operand:队伍}, 差别只在文案措辞, 不影响本 cron 的判定逻辑。

import { sqlite } from '../db/client.js';

const MAKER_RELAY_ID = process.env.WORLDCUP_MAKER_RELAY_ID || '15593e10-fe63-4806-a7b5-cae062699de8'; // broker-1, #41/R16 已验证 maker
const CONSOLE_BASE = process.env.WORLDCUP_CONSOLE_BASE || 'http://127.0.0.1:3200';
const TICK_MS = parseInt(process.env.WORLDCUP_SCHEDULE_TICK_MS, 10) || 1800000; // 30min — 非高频需求, 省资源
const CREATE_WINDOW_HOURS = 48; // G1 §3: kickoff 前 24-48h 自动建盘
const DEADLINE_BUFFER_HOURS = 4; // G1 决策1: deadline = kickoff + 4h

// 占位符检测: 真实 FIFA 队伍缩写(ESPN team.abbreviation)从不含数字; 占位符(RD16 W1/QFW2/SF L1)全含数字。
function isPlaceholder(abbr) {
  return !abbr || /\d/.test(abbr);
}

async function fetchEspnTeams(espnEventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnEventId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ESPN fetch HTTP ${res.status}`);
  const j = await res.json();
  const comp = j?.header?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;
  return { home: home.team?.abbreviation, homeName: home.team?.displayName, away: away.team?.abbreviation, awayName: away.team?.displayName };
}

async function createAdvanceMarket({ espnEventId, team, teamName, kickoffUtc, deadlineUtc }) {
  const spec = {
    title: `Will ${teamName} advance?`,
    title_zh: `${teamName} 能晋级下一轮吗?`,
    resolution_criteria: `以${teamName}是否晋级为准。90分钟战平→加时→点球大战，点球晋级也算「是/YES」。以赛事官方最终晋级结果为准（ESPN event ${espnEventId}）。`,
    data_source_canonical: `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnEventId}`,
    resolution_predicate: { metric: 'winner', op: '==', operand: team },
    source_label: 'ESPN FIFA World Cup',
    card_group_id: `fifa-2026-${espnEventId}`,
  };
  const body = {
    maker_relay_id: MAKER_RELAY_ID, outcome_side: 'YES',
    outcome_end_date: new Date(deadlineUtc * 1000).toISOString(),
    resolution_rule_spec: JSON.stringify(spec), maker_stake_kas: 100, pool_merkle_root: 'auto',
    outcome_condition_id: `espn:${espnEventId}`, // #27 dedup-gate 天然唯一键(每个 ESPN event 只建一次)
  };
  const r = await fetch(`${CONSOLE_BASE}/api/pool/market/create-v07`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: j.ok, marketId: j.market_id, error: j.error, status: r.status, duplicate: j.duplicate };
}

export async function worldcupScheduleTick() {
  const rows = sqlite.prepare("SELECT * FROM worldcup_schedule WHERE status = 'pending_teams'").all();
  if (rows.length === 0) return { checked: 0, created: 0 };
  let created = 0;
  const nowSec = Math.floor(Date.now() / 1000);
  for (const row of rows) {
    try {
      // 逃生阀: kickoff 已过太久(比如超时未解析·罕见但防死循环), 标 skipped 不再纠缠。
      if (row.kickoff_utc < nowSec - 6 * 3600) {
        sqlite.prepare("UPDATE worldcup_schedule SET status='skipped', skip_reason='kickoff passed, teams never resolved', updated_at=datetime('now') WHERE id=?").run(row.id);
        console.log(`[worldcup-schedule] ${row.espn_event_id} skipped: kickoff passed unresolved`);
        continue;
      }
      const teams = await fetchEspnTeams(row.espn_event_id);
      if (!teams) continue;
      if (isPlaceholder(teams.home) || isPlaceholder(teams.away)) continue; // 还没出结果, 下次 tick 再查
      // G1 §3: 只在 kickoff 前 24-48h 窗口内自动建盘(不提前太多, 也不错过)。若已经在窗口内或已过 kickoff
      // 但 deadline 还没到(比如 cron tick 间隔较大错过了窗口开头), 仍补建——别因为错过窗口就永远不建。
      const deadlineUtc = row.kickoff_utc + DEADLINE_BUFFER_HOURS * 3600;
      if (deadlineUtc <= nowSec) {
        sqlite.prepare("UPDATE worldcup_schedule SET status='skipped', skip_reason='deadline already passed by the time teams resolved', updated_at=datetime('now') WHERE id=?").run(row.id);
        console.log(`[worldcup-schedule] ${row.espn_event_id} skipped: deadline已过 (队伍刚解析太晚)`);
        continue;
      }
      const withinWindow = row.kickoff_utc - nowSec <= CREATE_WINDOW_HOURS * 3600;
      if (!withinWindow) continue; // 队伍已知但离开赛还早, 按 G1 §3 节奏等窗口到了再建(避免太早建盘占资源)
      // home team 作为"晋级方"标的(跟已建的 4 场 R16 盘一致的约定)。
      const res = await createAdvanceMarket({
        espnEventId: row.espn_event_id, team: teams.home, teamName: teams.homeName || teams.home,
        kickoffUtc: row.kickoff_utc, deadlineUtc,
      });
      if (res.ok) {
        sqlite.prepare("UPDATE worldcup_schedule SET status='created', market_id=?, updated_at=datetime('now') WHERE id=?").run(res.marketId, row.id);
        console.log(`[worldcup-schedule] ✅ ${row.espn_event_id} (${teams.homeName} v ${teams.awayName}) → market ${res.marketId}`);
        created++;
      } else if (res.duplicate) {
        // #27 dedup-gate 判重复(理论不该发生, 但若发生说明之前建过没回填, 直接认领那个 market_id 别重建)。
        sqlite.prepare("UPDATE worldcup_schedule SET status='created', market_id=?, updated_at=datetime('now') WHERE id=?").run(res.marketId, row.id);
        console.log(`[worldcup-schedule] ${row.espn_event_id} dedup-gate 判已存在(${res.marketId}), 回填不重建`);
      } else {
        console.warn(`[worldcup-schedule] ❌ ${row.espn_event_id} create fail: HTTP ${res.status} ${res.error}`);
      }
    } catch (e) {
      console.warn(`[worldcup-schedule] ${row.espn_event_id} tick error: ${e.message}`);
    }
  }
  return { checked: rows.length, created };
}

let _timer = null;
export function startWorldcupScheduleCron() {
  if (_timer) return;
  console.log(`[worldcup-schedule] starting·tick=${TICK_MS}ms·maker=${MAKER_RELAY_ID.slice(0, 8)}`);
  _timer = setInterval(() => { worldcupScheduleTick().catch((e) => console.log(`[worldcup-schedule] tick uncaught: ${e.message}`)); }, TICK_MS);
  worldcupScheduleTick().catch((e) => console.log(`[worldcup-schedule] startup tick: ${e.message}`)); // immediate first tick
}
