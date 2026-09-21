// arm-status.mjs — 只读: 各臂状态一览(市场 / verdict / 冻结 / 意图)。
import { createRequire } from 'node:module'; import fs from 'node:fs';
const Database = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-console/')('better-sqlite3');
const RUN = 'D:/kanet-tn12/scratch/_j2_e2e_run'; const arms = fs.existsSync(`${RUN}/arms.json`) ? JSON.parse(fs.readFileSync(`${RUN}/arms.json`, 'utf8')) : {};
const db = new Database(`${RUN}/console.simnet.db`, { readonly: true, fileMustExist: true });
const iso = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(11, 19) : '-');
for (const [arm, id] of Object.entries(arms)) {
  const m = db.prepare('SELECT status, winning_side ws, winning_side_source src, settlement_frozen_at fz, frozen_reason fr, deadline_ms d, outcome_end_ms oe FROM proto_markets WHERE id = ?').get(id);
  const v = db.prepare('SELECT source_kind k, outcome o, pmt_at p FROM proto_market_verdicts WHERE market_id = ? ORDER BY id').all(id);
  const bets = db.prepare("SELECT side, status FROM proto_bets WHERE market_id = ?").all(id).map((b) => `${b.side}:${b.status}`).join(',');
  const it = db.prepare("SELECT step, status FROM proto_settlement_intents WHERE subject_id = ? OR subject_id IN (SELECT id FROM proto_claims WHERE market_id = ?)").all(id, id).map((i) => `${i.step}:${i.status}`).join(',');
  console.log(`${arm} ${id.slice(0, 8)} ${m.status} ws=${m.ws} src=${m.src} frozen=${m.fr || '-'} oe=${iso(m.oe)} D=${iso(m.d)} bets=[${bets}] verdicts=${JSON.stringify(v.map((x) => [x.k, x.o, iso(x.p)]))} intents=[${it}]`);
}
