#!/usr/bin/env node
// G2-B 二期 qlfpv 实测：合约 ctor minerFee=50_000 但 stash refund_amount=9_995_000_000
// (= 100 KAS - 5M floor) 不匹合约 require value==100 KAS - 50_000. 清 stash 让下次
// settler-tick 用正确公式 (== market.miner_fee 50_000) 重新 dispatchRefund.
import Database from 'better-sqlite3';
const db = new Database('./data/console.db');

const ids = ['ext-pool-v06-1780229085541-qlfpv', 'ext-pool-1780056388641-15sch'];
for (const id of ids) {
  const row = db.prepare("SELECT id, protocol_version, miner_fee, maker_stake_amount, metadata FROM pool_markets WHERE id=?").get(id);
  if (!row) { console.log(`skip ${id} not found`); continue; }
  let meta = {};
  try { meta = JSON.parse(row.metadata || '{}'); } catch {}
  // Strip stale refund stash so dispatchRefund re-runs with correct minerFee.
  delete meta.refund_tx_obj;
  delete meta.refund_dispatched_at;
  delete meta.refund_amount;
  delete meta.refund_reason;
  db.prepare("UPDATE pool_markets SET metadata=?, protocol_status='verifying', updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(JSON.stringify(meta), id);
  console.log(`reset ${id}: stripped refund_* stash + status→verifying (was refunding). miner_fee=${row.miner_fee} maker_stake=${row.maker_stake_amount} pv=${row.protocol_version}`);
  console.log(`  expected new refund_amount = ${row.maker_stake_amount} - ${row.miner_fee} = ${row.maker_stake_amount - row.miner_fee}`);
}
db.close();
