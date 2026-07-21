// #13 backfill (2026-07-05, Owner 亲测撞见英文DM显中文规则): fifa-2026 advance类型盘的
// resolution_criteria 只有中文, 没有 resolution_criteria_zh 字段(bot端 specCriteria(spec,lang) 已经
// 支持按语言选, 但存量盘缺 _zh 字段导致英文用户还是看到中文原文)。幂等: 只处理 resolution_criteria_zh
// IS NULL 的行, 可安全重跑。范围: 只碰 fifa-2026-* card_group_id 的 advance 盘, 不碰其它 polymarket
// 镜像盘(它们本来就是英文原文)。
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'console.db');
const db = new Database(dbPath);

const ESPN_RE = /ESPN event (\d+)/;

function buildEnglishCriteria(teamName, espnEventId) {
  return `Resolves based on whether ${teamName} advances to the next round. If tied after 90 minutes, extra time and then a penalty shootout apply — advancing via penalties still counts as YES. Based on the official final advancement result (ESPN event ${espnEventId}).`;
}

function run() {
  const rows = db.prepare(`
    SELECT id, resolution_rule_spec FROM pool_markets
    WHERE resolution_rule_spec LIKE '%fifa-2026%'
      AND resolution_rule_spec NOT LIKE '%resolution_criteria_zh%'
  `).all();

  console.log(`[backfill] found ${rows.length} rows needing update (parent+shards)`);

  let updated = 0;
  let skipped = 0;
  const failures = [];

  for (const r of rows) {
    let spec;
    try { spec = JSON.parse(r.resolution_rule_spec); } catch (e) {
      failures.push({ id: r.id, reason: `JSON parse fail: ${e.message}` });
      continue;
    }
    if (!spec.title || !spec.resolution_criteria) { skipped++; continue; }
    const teamMatch = spec.title.match(/^Will (.+) advance\?$/);
    const espnMatch = spec.resolution_criteria.match(ESPN_RE);
    if (!teamMatch || !espnMatch) {
      failures.push({ id: r.id, reason: `pattern mismatch (title="${spec.title}")` });
      continue;
    }
    const teamName = teamMatch[1];
    const espnEventId = espnMatch[1];

    spec.resolution_criteria_zh = spec.resolution_criteria; // 原样保留中文
    spec.resolution_criteria = buildEnglishCriteria(teamName, espnEventId); // 主字段换英文

    try {
      db.prepare('UPDATE pool_markets SET resolution_rule_spec = ? WHERE id = ?')
        .run(JSON.stringify(spec), r.id);
      updated++;
    } catch (e) {
      failures.push({ id: r.id, reason: `UPDATE fail: ${e.message}` });
    }
  }

  console.log(`[backfill] updated=${updated} skipped=${skipped} failures=${failures.length}`);
  if (failures.length) console.log('[backfill] failures:', JSON.stringify(failures, null, 2));
}

run();
db.close();
