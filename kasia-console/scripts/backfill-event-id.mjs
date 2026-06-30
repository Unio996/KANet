// backfill-event-id.mjs — #27 层B 存量 backfill: 给老 polymarket 盘回填 Polymarket event_id (母子盘原生分组)
//   Owner 钦定 2026-06-30 母子盘. seeder (pool-market-seeder.js 695ce499) 起【新盘】存 event_id;
//   此脚本回填【存量老盘】(spec 无 event_id) → bot 按 event_id 把同赛事多玩法子盘归并母盘显示(KANet-UI 显示层).
//
// 用法 (在 console 机器·有 data/console.db 处跑):
//   node scripts/backfill-event-id.mjs            # DRY-RUN (只统计·不写库)
//   node scripts/backfill-event-id.mjs --apply    # 真写库
//   node scripts/backfill-event-id.mjs --limit 10 # 只跑前 10 个 (测试用·避免 hammer gamma)
//   CONSOLE_DB_PATH=/path/to/console.db node scripts/backfill-event-id.mjs --apply
//
// 设计:
//   - 只目标 proper 0x-64hex(66-char) conditionId. 16-char 老内部 id 无法 gamma 回填 → SQL 已排除.
//   - gamma 查 (实测可行模式·condition_ids 复数批量返空是坑→必单查): ?condition_ids=<id>(active 盘)·
//     空则 &closed=true(resolved/老盘). events[0]={id,title,slug} = Polymarket 原生赛事分组.
//   - 幂等·可重跑: spec 已有 event_id 跳过(SQL + 运行时双重). 防御: fetch/parse 失败跳过·绝不写坏 spec.
//   - rate-limit: 每盘间 DELAY_MS·避免 gamma 限流.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const limArg = process.argv.indexOf('--limit');
const LIMIT = limArg >= 0 ? parseInt(process.argv[limArg + 1], 10) : 0;
const DB_PATH = process.env.CONSOLE_DB_PATH || path.resolve(process.cwd(), 'data/console.db');
const GAMMA = 'https://gamma-api.polymarket.com/markets';
const DELAY_MS = Number(process.env.BACKFILL_DELAY_MS) || 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new Database(DB_PATH);

let rows = db.prepare(`
  SELECT id, outcome_condition_id, resolution_rule_spec
  FROM pool_markets
  WHERE outcome_market_source = 'polymarket'
    AND outcome_condition_id LIKE '0x%' AND length(outcome_condition_id) = 66
    AND resolution_rule_spec NOT LIKE '%"event_id"%'
`).all();
if (LIMIT > 0) rows = rows.slice(0, LIMIT);

console.log(`[backfill-event-id] ${APPLY ? 'APPLY(写库)' : 'DRY-RUN(不写)'} · DB=${DB_PATH} · ${rows.length} 候选 (proper 0x-66 conditionId·spec 缺 event_id)${LIMIT ? ` · --limit ${LIMIT}` : ''}`);

// gamma 单查 (plain→closed fallback). 返 events[0] 或 null.
async function fetchEvent(condId) {
  for (const suffix of ['', '&closed=true']) {
    try {
      const r = await fetch(`${GAMMA}?condition_ids=${condId}${suffix}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const arr = await r.json();
      const ev = Array.isArray(arr) && arr[0] && Array.isArray(arr[0].events) && arr[0].events[0] ? arr[0].events[0] : null;
      if (ev && ev.id) return ev;
    } catch { /* try next suffix */ }
  }
  return null;
}

let updated = 0, noEvent = 0, parseFail = 0;
const upd = db.prepare('UPDATE pool_markets SET resolution_rule_spec = ? WHERE id = ?');

for (let i = 0; i < rows.length; i++) {
  const m = rows[i];
  let spec;
  try { spec = JSON.parse(m.resolution_rule_spec); } catch { parseFail++; continue; }
  if (spec.event_id) continue;   // 幂等 (双重保险)
  const ev = await fetchEvent(m.outcome_condition_id);
  if (!ev) { noEvent++; await sleep(DELAY_MS); continue; }
  spec.event_id = String(ev.id);
  if (ev.title) spec.event_title = String(ev.title).trim().slice(0, 200);
  if (ev.slug) spec.event_slug = String(ev.slug);
  if (APPLY) upd.run(JSON.stringify(spec), m.id);
  updated++;
  if (i < 3 || updated % 25 === 0) console.log(`  [${i + 1}/${rows.length}] ${String(m.id).slice(-8)} cond=${m.outcome_condition_id.slice(0, 12)} → event_id=${spec.event_id}${spec.event_title ? ' "' + spec.event_title + '"' : ''}`);
  await sleep(DELAY_MS);
}

console.log(`[backfill-event-id] 完成: ${updated} ${APPLY ? '已回填' : '可回填(dry·--apply 才写)'} · ${noEvent} 无event/gamma空 · ${parseFail} spec解析失败 · ${rows.length} 总候选`);
db.close();
