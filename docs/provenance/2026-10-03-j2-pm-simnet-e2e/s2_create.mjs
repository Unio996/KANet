// s2_create.mjs — 生产 POST /api/pool/market/create-v07 建盘(blockhash_parity 判定题, zk_native 默认), 池 6 人。
import { http, relays, rpcConnect, daa, log } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const rpc = await rpcConnect();
const cur = await daa(rpc);
const endMs = Date.now() + 130_000;   // POOL_DEADLINE_MIN_OVERRIDE=2 分钟
const targetDaa = cur + 1300 + 60;    // 建盘 deadline_daa ≈ cur + 1300(=130s×10/s 的服务端假设), target 略晚于它
const spec = { title: `simnet e2e parity market ${Date.now()}`, resolution_criteria: `blockhash at DAA ${targetDaa}: last byte even => YES, odd => NO`, data_source_canonical: `kaspa-simnet:blockhash_parity@${targetDaa}`, judge_type: 'blockhash_parity', target_daa: targetDaa };
const body = { maker_relay_id: relays.maker.id, outcome_side: 'YES', outcome_end_date: new Date(endMs).toISOString(), resolution_rule_spec: JSON.stringify(spec), maker_stake_kas: 130, pool_merkle_root: 'auto' };
log('create-v07 curDaa', cur, 'targetDaa', targetDaa);
const r = await http('POST', '/api/pool/market/create-v07', body);
log('create-v07 =>', JSON.stringify(r).slice(0, 900));
if (!r.ok) process.exit(2);
writeFileSync('D:/kanet-tn12/scratch/_j2_pm_e2e_sim/market.json', JSON.stringify({ market_id: r.market_id, targetDaa, createdAtDaa: cur, r }, null, 1));
process.exit(0);
