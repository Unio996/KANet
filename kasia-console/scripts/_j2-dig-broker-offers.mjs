import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: false });
const BROKER_KASPA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

console.log('=== broker offers 真 status 真 dig (Owner 训不要 standby) ===\n');

const allRecent = db.prepare(`
  SELECT id, give_asset, give_amount, want_asset, want_amount, protocol_status, expires_at, broadcast_at,
    json_extract(metadata, '$.source') AS source
  FROM exchange_offers
  WHERE maker = ? AND broadcast_at > datetime('now', '-3 hours')
  ORDER BY broadcast_at DESC LIMIT 20
`).all(BROKER_KASPA);
console.log(`broker offers 近 3h: ${allRecent.length}`);
const stuckOpen = [];
for (const o of allRecent) {
  const expired = o.expires_at && new Date(o.expires_at) < new Date();
  const flag = (o.protocol_status === 'open' && expired) ? ' ⚠ STUCK OPEN+EXPIRED' : '';
  console.log(`  ${o.id.slice(0,8)} ${o.give_amount} ${o.give_asset} → ${o.want_amount} ${o.want_asset} status=${o.protocol_status} exp=${o.expires_at} bcast=${o.broadcast_at} src=${o.source}${flag}`);
  if (o.protocol_status === 'open' && expired) stuckOpen.push(o);
}
console.log(`\n真 stuck (open + expired): ${stuckOpen.length}`);
if (stuckOpen.length > 0) {
  console.log('真 cleanup: set protocol_status="expired"');
  for (const o of stuckOpen) {
    db.prepare(`UPDATE exchange_offers SET protocol_status='expired', updated_at=datetime('now') WHERE id=?`).run(o.id);
    console.log(`  ✓ ${o.id.slice(0,8)} → expired`);
  }
}
db.close();
