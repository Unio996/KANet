// s4_bet_c.mjs — 把 shard0 置 sealed(驱动层 DB 操作, 仅为让第三注开第二片, 以覆盖「第 2 片 consolidate 消费 PS 已持有代币」路径), 再由 bettorA 下第三注(5 KAS, YES)。
import { http, relays, log } from './lib.mjs';
import { readFileSync } from 'node:fs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
const { sqlite: db } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/db/client.js');
const m = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/market.json', 'utf8'));
const r0 = db.prepare("update market_shards set status='sealed' where logical_market_id = ? and shard_index = 0").run(m.market_id);
log('shard0 -> sealed rows', r0.changes);
const t0 = Date.now();
const r = await http('POST', `/api/pool/market/${m.market_id}/bettor/register-v07`, { bettor_relay_id: relays.bettorA.id, direction: 0, stake_kas: 5 });
log(`bettorA 5 KAS YES (${Date.now() - t0}ms) =>`, JSON.stringify(r).slice(0, 700));
log('shards:', JSON.stringify(db.prepare('select shard_index,status,current_leaf_state,current_token_outpoint from market_shards where logical_market_id=? order by shard_index').all(m.market_id)));
process.exit(0);
