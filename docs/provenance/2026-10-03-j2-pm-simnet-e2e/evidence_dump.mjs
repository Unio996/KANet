import { readFileSync, writeFileSync } from 'node:fs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_pm_e2e_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '1'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
const { sqlite: db } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_pm_e2e/kasia-console/src/db/client.js');   // 生产 client(M0a 门: 不裸 import better-sqlite3); 需 sim console 已停或仅读
const m = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_pm_e2e_sim/market.json', 'utf8'));
const relays = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_pm_e2e_sim/relays.json', 'utf8'));
const pub = Object.fromEntries(Object.entries(relays).map(([n, r]) => [n, { id: r.id, address: r.address, xonly: r.xonly }]));   // 去掉 priv
const out = {
  note: 'simnet 彩排证据快照(无私钥; simnet 币无价值)',
  relays_public: pub,
  market: db.prepare('select id, protocol_status, deadline, deadline_daa, pool_merkle_root, spine_p2sh, spine_lock_tx, maker_pk, broker_pk, resolution_rule_spec, substr(metadata,1,400) as metadata_head from pool_markets where id = ?').get(m.market_id),
  market_shards: db.prepare('select shard_market_id, shard_index, status, current_leaf_outpoint, current_leaf_state, current_token_outpoint from market_shards').all(),
  payout_shards: db.prepare('select logical_market_id, covenant_family, payout_ps_outpoint, payout_cov_id, token_tmpl_hash, claim_tmpl_hash, market_suffix_hash from payout_shards').all(),
  bettor_sides: db.prepare('select market_id, bettor_pk, direction, stake_amount, side_lock_tx from pool_bettor_sides').all(),
  pool_chain_view: db.prepare('select snapshot_daa, pool_size, merkle_root, derived_at from oracle_pool_chain_view order by snapshot_daa desc limit 3').all(),
  zk_events: db.prepare("select event_type, summary, created_at from events where event_type like 'zk%' order by created_at").all(),
  oracle_enrollments: db.prepare('select staker_pk_x, lock_until_daa, p2sh_addr, source, active, outpoint_txid, amount_sompi from oracle_stake_enrollments').all(),
};
writeFileSync('evidence_snapshot.json', JSON.stringify(out, null, 1));
console.log('events:', out.zk_events.length, '| zk_events[0]:', JSON.stringify(out.zk_events[0]).slice(0, 400));
