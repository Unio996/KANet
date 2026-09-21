// drive-F2.mjs — 接续 F 臂: sim-actions drive F 在 bet0 确认等待处超时退出(fee UTXO 面值不足, 见 actions.jsonl relay_topup)。bet0 已 post 过, 这里【不重发 bet0】: 等 bet0 confirmed → bet1(700) → 等 sealed。全部经 sim-actions 既有命令/库。
import { createRequire } from 'node:module'; import { execFileSync } from 'node:child_process'; import fs from 'node:fs';
const Database = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-console/')('better-sqlite3'); const RUN = 'D:/kanet-tn12/scratch/_j2_e2e_run';
const id = JSON.parse(fs.readFileSync(`${RUN}/arms.json`, 'utf8')).F; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...a) => { const d = new Database(`${RUN}/console.simnet.db`, { readonly: true, fileMustExist: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const log = (...a) => console.log(new Date().toISOString(), ...a);
const t0 = Date.now();
while (Date.now() - t0 < 25 * 60_000 && q('SELECT status FROM proto_bets WHERE market_id = ? AND side = 0', id)?.status !== 'confirmed') await sleep(3000);
log('bet0 confirmed?', q('SELECT status FROM proto_bets WHERE market_id = ? AND side = 0', id)?.status);
log(execFileSync('node', ['sim-actions.mjs', 'bet', 'F', '1', '700'], { cwd: RUN, encoding: 'utf8' }).split('\n').filter((l) => !l.startsWith('[')).join('\n'));
while (Date.now() - t0 < 30 * 60_000 && q('SELECT status FROM proto_markets WHERE id = ?', id)?.status !== 'sealed') await sleep(3000);
const ni = JSON.parse(execFileSync('node', ['sim-actions.mjs', 'pmt'], { cwd: RUN, encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('{')).pop());
fs.appendFileSync(`${RUN}/evidence/actions.jsonl`, JSON.stringify({ at: new Date().toISOString(), action: 'drive_sealed', arm: 'F', marketId: id, node: ni, note: 'continued by drive-F2.mjs (bet0 posted by first drive; not re-posted)' }) + '\n');
log('sealed', q('SELECT status FROM proto_markets WHERE id = ?', id)?.status, JSON.stringify(ni));
