// watch-freeze-F.mjs — F 臂: 轮询库, 一旦 winning_side 已写(promote 成功)且未冻结, 立刻调 sim-actions freeze F(仓库 freezeMarket)。只读库 + 调既有命令, 零改仓库码。
import { createRequire } from 'node:module'; import { execFileSync } from 'node:child_process'; import fs from 'node:fs';
const Database = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-console/')('better-sqlite3');
const RUN = 'D:/kanet-tn12/scratch/_j2_e2e_run'; const id = JSON.parse(fs.readFileSync(`${RUN}/arms.json`, 'utf8')).F;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const t0 = Date.now();
while (Date.now() - t0 < 40 * 60_000) {
  const db = new Database(`${RUN}/console.simnet.db`, { readonly: true, fileMustExist: true });
  const m = db.prepare('SELECT status, winning_side ws, settlement_frozen_at fz FROM proto_markets WHERE id = ?').get(id); db.close();
  if (m.ws != null && m.fz == null) { console.log(new Date().toISOString(), 'promoted ws=' + m.ws + ' status=' + m.status + ' -> freezing'); console.log(execFileSync('node', ['sim-actions.mjs', 'freeze', 'F'], { cwd: RUN, encoding: 'utf8' })); break; }
  if (m.fz != null) { console.log(new Date().toISOString(), 'already frozen (no promote?)', JSON.stringify(m)); break; }
  await sleep(2000);
}
console.log('watch done', new Date().toISOString());
