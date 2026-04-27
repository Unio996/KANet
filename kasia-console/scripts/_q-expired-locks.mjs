import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });

// 找最近 100 笔 expired 单, JOIN fund_locks 看是否 release
const rows = db.prepare(`
  SELECT 
    eo.id,
    eo.protocol_status,
    eo.broadcast_at,
    eo.expires_at,
    json_extract(eo.metadata,'$.source') as source,
    fl.id as lock_id,
    fl.status as lock_status,
    fl.created_at as lock_created,
    fl.released_at as lock_released
  FROM exchange_offers eo
  LEFT JOIN fund_locks fl ON fl.order_id = eo.id
  WHERE eo.protocol_status='expired'
  ORDER BY eo.broadcast_at DESC
  LIMIT 30
`).all();

const stats = { with_lock: 0, no_lock: 0, lock_released: 0, lock_locked: 0 };
for (const r of rows) {
  if (r.lock_id) {
    stats.with_lock++;
    if (r.lock_status === 'released') stats.lock_released++;
    else if (r.lock_status === 'locked') stats.lock_locked++;
  } else {
    stats.no_lock++;
  }
}
console.log('=== 最近 30 笔 expired 单 fund_locks 状态 ===');
console.log(stats);

console.log('\n=== 详情 (前 10 条) ===');
for (const r of rows.slice(0, 10)) {
  console.log(`offer ${r.id?.slice(0,8)} src=${r.source||'-'} broadcast=${r.broadcast_at?.slice(11,19)} expires=${r.expires_at?.slice(11,19)} lock=${r.lock_id?.slice(0,8)||'-'}/${r.lock_status||'-'} released=${r.lock_released?.slice(11,19)||'-'}`);
}

// 检查是否有 broker_dynamic_quote 的 expired (= 14b 真 timeout 案例)
const bdqExpired = db.prepare(`
  SELECT 
    eo.id, eo.broadcast_at, eo.expires_at,
    fl.status as lock_status, fl.released_at
  FROM exchange_offers eo
  LEFT JOIN fund_locks fl ON fl.order_id = eo.id
  WHERE eo.protocol_status='expired'
    AND json_extract(eo.metadata,'$.source')='broker_dynamic_quote'
  ORDER BY eo.broadcast_at DESC
  LIMIT 10
`).all();
console.log('\n=== broker_dynamic_quote 的 expired 单 (14b 自然 timeout 真案例) ===');
console.log(bdqExpired.length, 'rows');
for (const r of bdqExpired) {
  console.log(`  offer ${r.id?.slice(0,8)}  broadcast→expires=${r.broadcast_at?.slice(11,19)}→${r.expires_at?.slice(11,19)}  lock_status=${r.lock_status||'-'}  released=${r.released_at?.slice(11,19)||'-'}`);
}

db.close();
