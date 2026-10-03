// s3_bets.mjs — 两方下注: 生产 POST register-v07 (bettorA→YES(0) 10 KAS, bettorB→NO(1) 20 KAS)。
import { http, relays, rpcConnect, daa, log } from './lib.mjs';
import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/market.json', 'utf8'));
const rpc = await rpcConnect();
for (const [who, dir, kas] of [['bettorA', 0, 10], ['bettorB', 1, 20]]) {
  const t0 = Date.now();
  const r = await http('POST', `/api/pool/market/${m.market_id}/bettor/register-v07`, { bettor_relay_id: relays[who].id, direction: dir, stake_kas: kas });
  log(who, `dir=${dir} stake=${kas} (${Date.now() - t0}ms) =>`, JSON.stringify(r).slice(0, 1200));
  log('daa now', await daa(rpc));
}
process.exit(0);
