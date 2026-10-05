// mm_c_tweak.mjs — 【仅 simnet 彩排库副本·harness 专用】选项 C: 委员路径没有 polymarket/UMA 分支(见报件), 为了证明并发/pin/cap/账目, 把 3 个已建盘的判定改成
// blockhash_parity(委员能验的那条链上判定), target_daa 逐盘挑选使其奇偶 == 请求里已提议的赢向(桩: cond 偶 ⇒ YES(0), 奇 ⇒ NO(1))。生产代码零改动。
// 用法: node mm_c_tweak.mjs <tag>
import { createRequire } from 'node:module';
import { http, relays, sleep, log } from '../2026-10-05-j2-strict-zero/szlib.mjs';
const tag = process.argv[2] || 'pos';
const Db = createRequire('D:/kanet-tn12/kasia-console/')('better-sqlite3');
const db = new Db(`D:/kanet-tn12/scratch/_j2_mm/console.mm.${tag}.db`); db.pragma('busy_timeout = 20000');
const rows = db.prepare("SELECT id, outcome_condition_id, resolution_rule_spec, metadata FROM pool_markets WHERE protocol_status='collecting_sigs'").all();
const blockAt = async (d) => (await http('POST', `/api/relay/${relays.settler.id}/send-command`, { type: 'chain_get_block_at_daa', min_daa_score: d }));
let d = Number(process.argv[3] || 138000); const used = new Set();
for (const m of rows) {
  const req = JSON.parse(m.metadata).bshard_close_request_v2; const need = Number(req.new_attestedWinner);
  let found = null;
  for (let i = 0; i < 400 && !found; i++, d++) {
    const b = await blockAt(d); if (!b.ok || !b.hash) continue;
    const par = parseInt(String(b.hash).slice(-2), 16) % 2;
    if (par === need && !used.has(b.daaScore)) found = { d, daa: b.daaScore, hash: b.hash };
  }
  if (!found) throw new Error('no daa found for ' + m.id);
  used.add(found.daa);
  const spec = JSON.parse(m.resolution_rule_spec); spec.judge_type = 'blockhash_parity'; spec.target_daa = found.d;
  db.prepare("UPDATE pool_markets SET resolution_rule_spec = ?, outcome_market_source = 'kanet_v07' WHERE id = ?").run(JSON.stringify(spec), m.id);
  log(m.id.slice(-8), 'proposed winner', need, '=> target_daa', found.d, 'hash tail', found.hash.slice(-2));
}
