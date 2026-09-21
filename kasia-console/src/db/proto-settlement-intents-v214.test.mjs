// proto-settlement-intents-v214.test.mjs — R-a / NWT M2: v214 表重建迁移。
// 真实场景: 【旧形】意图表(CHECK 只有六个 step)+ v212 起的 proto_markets 触发器(EXISTS 子查询引用意图表)+ 已有意图行 ⇒ 迁移必须成功、行保真、触发器/索引按原文重建, 且新 CHECK 接受退款路三个 step。
// 另钉住 NWT 的实测失败: 朴素 v207 配方(建 _vN → INSERT SELECT → DROP 旧 → RENAME)在这个库形上【会失败】——证明本迁移的"先 DROP 引用触发器"不是多余的。
// Run: cd kasia-console && node src/db/proto-settlement-intents-v214.test.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const Database = createRequire(import.meta.url)('better-sqlite3');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${JSON.stringify(cond)}`); fails++; } };
const tmp = (n) => `${process.env.TEMP || '/tmp'}/_j2_v214_${n}_${process.pid}.db`;
const migrate = (db) => execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: db }, stdio: 'pipe' }).toString();
const OLD_CHECK = "'seal','resolve','convert_to_claim','claim_draw','withdraw','reclaim'";

/** 造一个"迁移到 v213 为止"的旧形库: 跑完全部迁移(得到 v214 新形)后, 把意图表【手工还原成旧 CHECK】并塞几行——等价于主网库(v213)的形状。 */
function makeOldShapeDb(path) {
  try { fs.unlinkSync(path); } catch {}
  migrate(path);
  const db = new Database(path);
  const cur = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'proto_settlement_intents'").get().sql;
  const oldSql = cur.replace("'withdraw','reclaim','refund_flip','convert_to_refundclaim','refund_payout'", "'withdraw','reclaim'");
  if (oldSql === cur) throw new Error('测试夹具: 找不到新 CHECK 尾部, 无法还原旧形');
  const trigs = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%proto_settlement_intents%'").all();
  db.pragma('foreign_keys = OFF');
  for (const t of trigs) db.exec(`DROP TRIGGER "${t.name}"`);
  db.exec('ALTER TABLE proto_settlement_intents RENAME TO _tmp_intents');
  db.exec(oldSql.replace(/CREATE TABLE\s+"?proto_settlement_intents"?/, 'CREATE TABLE proto_settlement_intents'));
  db.exec('INSERT INTO proto_settlement_intents SELECT * FROM _tmp_intents; DROP TABLE _tmp_intents;');
  db.exec("CREATE INDEX IF NOT EXISTS idx_proto_settlement_intents_subject ON proto_settlement_intents(subject_type, subject_id, step); CREATE INDEX IF NOT EXISTS idx_proto_settlement_intents_status_updated ON proto_settlement_intents(status, updated_at)");
  for (const t of trigs) db.exec(t.sql);
  db.pragma('foreign_keys = ON');
  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES ('t1','Test','TST',?)").run(now);
  db.prepare("INSERT INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,created_at,updated_at) VALUES ('m1','t1',1700000000000,100,'[]','enc','aa',?,?)").run(now, now);
  for (const [k, st, status] of [['settle:market:m1:seal', 'seal', 'landed'], ['settle:market:m1:resolve', 'resolve', 'prepared']]) {
    db.prepare("INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, status, prepared_txid, prepared_tx_json, created_at, updated_at) VALUES (?, 'market', 'm1', ?, ?, 'tx', '[]', ?, ?)").run(k, st, status, now, now);
  }
  db.close();
}

console.log('[test] ① 旧形库(v213 形: 旧 CHECK + 引用意图表的触发器 + 已有意图行)⇒ 朴素 v207 配方会失败(NWT 实测复现):');
{
  const p = tmp('naive'); makeOldShapeDb(p);
  const db = new Database(p); db.pragma('foreign_keys = OFF');
  const refTrig = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%proto_settlement_intents%'").all();
  ok(refTrig.length >= 1, `旧形库里有引用意图表的触发器(${refTrig.map((t) => t.name).join(',')})`);
  ok(!/refund_flip/.test(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'proto_settlement_intents'").get().sql), '旧形: CHECK 不含 refund_flip');
  let naiveErr = null;
  try {
    db.exec('BEGIN');
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'proto_settlement_intents'").get().sql.replace(OLD_CHECK, OLD_CHECK + ",'refund_flip'").replace(/CREATE TABLE\s+"?proto_settlement_intents"?/, 'CREATE TABLE proto_settlement_intents_v214');
    db.exec(sql); db.exec('INSERT INTO proto_settlement_intents_v214 SELECT * FROM proto_settlement_intents'); db.exec('DROP TABLE proto_settlement_intents'); db.exec('ALTER TABLE proto_settlement_intents_v214 RENAME TO proto_settlement_intents');
    db.exec('COMMIT');
  } catch (e) { naiveErr = e; try { db.exec('ROLLBACK'); } catch {} }
  ok(!!naiveErr && /no such table.*proto_settlement_intents|in trigger/.test(String(naiveErr.message)), `朴素配方失败: ${naiveErr && naiveErr.message}`);
  db.close();
}

console.log('[test] ② v214 迁移: 旧形库 ⇒ 成功、行保真、触发器/索引按原文重建、接受退款路 step、integrity ok; 再跑一次 ⇒ 幂等:');
{
  const p = tmp('mig'); makeOldShapeDb(p);
  const pre = new Database(p);
  const snap = (db) => JSON.stringify({ trig: db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all(), idx: db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all(), rows: db.prepare('SELECT intent_key, step, status, prepared_txid FROM proto_settlement_intents ORDER BY intent_key').all() });
  const before = snap(pre); pre.close();
  const out = migrate(p);
  ok(/v214: proto_settlement_intents 重建\(2 行保真/.test(out), `迁移输出: 重建 2 行保真(${(out.match(/v214:[^\n]*/) || [''])[0].slice(0, 100)})`);
  const db = new Database(p);
  ok(snap(db) === before, '触发器集合(名+sql)、索引集合、行内容与重建前逐字一致');
  ok(/'refund_flip'/.test(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'proto_settlement_intents'").get().sql), '新 CHECK 含 refund_flip');
  const now = new Date().toISOString();
  for (const step of ['refund_flip', 'convert_to_refundclaim']) db.prepare("INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, status, created_at, updated_at) VALUES (?, 'market', 'm1', ?, 'pending', ?, ?)").run(`settle:market:m1:${step}`, step, now, now);
  db.prepare("INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, status, created_at, updated_at) VALUES ('settle:claim:c1:refund_payout', 'claim', 'c1', 'refund_payout', 'pending', ?, ?)").run(now, now);
  ok(db.prepare('SELECT COUNT(*) AS n FROM proto_settlement_intents').get().n === 5, '退款路三个 step 均可插入(行数 2+3)');
  let bad = null; try { db.prepare("INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, status, created_at, updated_at) VALUES ('k9', 'market', 'm1', 'bogus_step', 'pending', ?, ?)").run(now, now); } catch (e) { bad = e; }
  ok(!!bad && /CHECK/.test(String(bad.message)), 'CHECK 仍然拒绝未知 step(没有被放成无约束)');
  ok(JSON.stringify(db.pragma('integrity_check')) === '[{"integrity_check":"ok"}]' && db.pragma('foreign_key_check').length === 0, 'integrity_check ok ∧ foreign_key_check 空');
  // 触发器仍在工作: 有意图行的市场禁删(trg_pm_ws_r1_delete_guard 的 EXISTS 子查询引用新表)
  let delErr = null; try { db.prepare("DELETE FROM proto_markets WHERE id = 'm1'").run(); } catch (e) { delErr = e; }
  ok(!!delErr && /DELETE forbidden/.test(String(delErr.message)), '重建后触发器仍生效(删除有意图行的市场被拒)');
  db.close();
  const out2 = migrate(p); ok(/v214: .*idempotent skip/.test(out2), '再跑一次 ⇒ 幂等跳过');
  try { fs.unlinkSync(p); fs.unlinkSync(tmp('naive')); } catch {}
}
console.log(fails === 0 ? '\n✅✅ ALL PASS — v214 迁移(旧形库重建 / 行保真 / 触发器索引原文 / 幂等 / 朴素配方失败对照)' : `\n❌ ${fails} assertions failed`);
process.exitCode = fails === 0 ? 0 : 1;
