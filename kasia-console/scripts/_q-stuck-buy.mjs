import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });

const st = db.prepare("SELECT protocol_status, COUNT(*) c FROM exchange_offers GROUP BY protocol_status ORDER BY c DESC").all();
console.log('=== protocol_status counts ===');
console.table(st);

const active = db.prepare(`
  SELECT id, protocol_status, give_asset, give_amount, want_asset, want_amount,
         broadcast_at, matched_at, verifying_started_at, delivering_at, completed_at,
         expires_at, maker, taker, taker_chain
  FROM exchange_offers
  WHERE protocol_status NOT IN ('completed','cancelled','expired','disputed','refunded')
  ORDER BY broadcast_at DESC
  LIMIT 30
`).all();
console.log('\n=== non-terminal offers ===');
console.table(active);

// Specifically the "0/7" — likely matched/verifying offers waiting for buy completion to verify+deliver
const stuckBuy = db.prepare(`
  SELECT id, protocol_status, give_asset, give_amount, want_asset, want_amount,
         matched_at, verifying_started_at, payment_tx, delivery_tx,
         maker, taker, metadata
  FROM exchange_offers
  WHERE protocol_status IN ('matched','verifying','delivering','paid')
  ORDER BY matched_at DESC NULLS LAST
`).all();
console.log('\n=== matched/verifying/delivering/paid (the 0/7 candidates) ===');
console.log('count:', stuckBuy.length);
for (const r of stuckBuy) {
  console.log('---');
  console.log({
    id: r.id?.slice(0,8),
    status: r.protocol_status,
    swap: `${r.give_amount} ${r.give_asset} → ${r.want_amount} ${r.want_asset}`,
    matched_at: r.matched_at,
    verifying_started_at: r.verifying_started_at,
    payment_tx: r.payment_tx?.slice(0,16),
    delivery_tx: r.delivery_tx?.slice(0,16),
    maker: r.maker?.slice(-10),
    taker: r.taker?.slice(-10),
  });
  if (r.metadata) {
    try { console.log('  meta:', JSON.parse(r.metadata)); } catch {}
  }
}

db.close();
