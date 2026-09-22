// 在【主网库的文件拷贝】上验证 v214 迁移(只读源: 主网库本体不打开、不写; 拷贝由 cp 得, sha256 见 SHA256.txt)。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const KC = 'D:/kanet-tn12/scratch/_j2_wt_ra/kasia-console';
const Database = createRequire(KC + '/')('better-sqlite3');
const COPY = 'D:/kanet-tn12/scratch/_j2_ra_mainnet_backup/console.mainnet.copy.db';
const OUT = 'D:/kanet-tn12/scratch/_j2_ra_mainnet_copy_verify.txt';
const log = []; const P = (s) => { log.push(s); console.log(s); };
const snap = () => { const db = new Database(COPY, { readonly: true }); const o = {
  markets: db.prepare('SELECT id, status, winning_side, settlement_frozen_at FROM proto_markets ORDER BY id').all(),
  intents: db.prepare('SELECT * FROM proto_settlement_intents ORDER BY intent_key').all(),
  bets: db.prepare('SELECT COUNT(*) AS n FROM proto_bets').get().n, claims: db.prepare('SELECT COUNT(*) AS n FROM proto_claims').get().n,
  trig: db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all(), idx: db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all(),
  checkHasRefundFlip: /'refund_flip'/.test(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'proto_settlement_intents'").get().sql) }; db.close(); return o; };
const before = snap();
P(`BEFORE: markets=${JSON.stringify(before.markets.map((m) => [m.id.slice(0, 8), m.status]))} intents=${before.intents.length} bets=${before.bets} claims=${before.claims} triggers=${before.trig.length} indexes=${before.idx.length} check_has_refund_flip=${before.checkHasRefundFlip}`);
let migOut = '';
try { migOut = execSync('node scripts/run-migrations.mjs', { cwd: KC, env: { ...process.env, DB_PATH: COPY }, stdio: 'pipe' }).toString(); } catch (e) { P('MIGRATION FAILED: ' + String(e.stdout || '') + String(e.stderr || '')); fs.writeFileSync(OUT, log.join('\n')); process.exit(1); }
P('migration output (v213/v214 lines):'); for (const l of migOut.split('\n').filter((x) => /v21[34]|complete|error/i.test(x))) P('  ' + l.slice(0, 220));
const after = snap();
P(`AFTER : markets=${JSON.stringify(after.markets.map((m) => [m.id.slice(0, 8), m.status]))} intents=${after.intents.length} bets=${after.bets} claims=${after.claims} triggers=${after.trig.length} indexes=${after.idx.length} check_has_refund_flip=${after.checkHasRefundFlip}`);
P('markets 逐行一致: ' + (JSON.stringify(before.markets) === JSON.stringify(after.markets)));
P('intents 行内容逐列一致: ' + (JSON.stringify(before.intents) === JSON.stringify(after.intents)));
P('触发器集合(名+sql)逐字一致: ' + (JSON.stringify(before.trig) === JSON.stringify(after.trig)));
P('索引集合(名+sql)逐字一致: ' + (JSON.stringify(before.idx) === JSON.stringify(after.idx)));
P('bets/claims 计数一致: ' + (before.bets === after.bets && before.claims === after.claims));
const db = new Database(COPY, { readonly: true });
P('integrity_check: ' + JSON.stringify(db.pragma('integrity_check')) + '  foreign_key_check rows: ' + db.pragma('foreign_key_check').length);
db.close();
const okAll = JSON.stringify(before.markets) === JSON.stringify(after.markets) && JSON.stringify(before.intents) === JSON.stringify(after.intents) && JSON.stringify(before.trig) === JSON.stringify(after.trig) && JSON.stringify(before.idx) === JSON.stringify(after.idx) && after.checkHasRefundFlip;
P(okAll ? 'RESULT: PASS(v214 在主网库拷贝上通过: 行/触发器/索引保真, CHECK 已放宽)' : 'RESULT: FAIL');
fs.writeFileSync(OUT, log.join('\n') + '\n'); process.exit(okAll ? 0 : 1);
