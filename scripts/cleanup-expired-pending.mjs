// cleanup-expired-pending.mjs — 一次性清理 exchange-machine 误产生的 pending execution_states
// 背景: exchange-machine.js transition() 之前为每次状态变更都建 pending execution,
// 但 completeExecution 要求 executing 前置, 新建的 pending 永远无法推进 → 卡 DB.
// 根因已修复 (transition 不再建 pending), 本脚本清理历史脏数据.
// 运行: 需在 kasia-console 目录或 better-sqlite3 可找到时执行
//   cd /d/Anthropic/kasia-console && node /d/Anthropic/scripts/cleanup-expired-pending.mjs
// 或: node -e "..." 从 kasia-console 目录直接跑

const Database = require('better-sqlite3');
const db = new Database('D:/Anthropic/kasia-console/data/console.db');

const rows = db.prepare(`
  SELECT id, type, agent_address, created_at, display_summary 
  FROM execution_states 
  WHERE status='pending' AND source='exchange-machine'
  ORDER BY created_at DESC
`).all();

console.log('Found ' + rows.length + ' stale pending rows from exchange-machine:');
for (const r of rows) {
  console.log('  ' + r.id.slice(0,8) + ' ' + r.type + ' agent=' + r.agent_address?.slice(6,14) + ' ' + r.created_at);
}

if (rows.length === 0) { console.log('Nothing to clean.'); process.exit(0); }

const upd = db.prepare(`
  UPDATE execution_states 
  SET status='completed', 
      display_summary = COALESCE(display_summary,'') || ' [auto-resolved: system-state-transition-not-approval]',
      updated_at = ?
  WHERE status='pending' AND source='exchange-machine'
`);
const now = new Date().toISOString();
const result = upd.run(now);
console.log('\nUpdated ' + result.changes + ' rows to completed.');

// 验证
const remain = db.prepare(`SELECT COUNT(*) as c FROM execution_states WHERE status='pending' AND source='exchange-machine'`).get();
console.log('Remaining pending from exchange-machine: ' + remain.c);
const realPending = db.prepare(`SELECT COUNT(*) as c, source FROM execution_states WHERE status='pending' GROUP BY source`).all();
console.log('\nReal pending (other sources) breakdown:');
for (const r of realPending) console.log('  ' + r.source + ': ' + r.c);
