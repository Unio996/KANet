// heavy-index-v199.test.mjs — ② 记账式索引迁移离线测试。跑: cd kasia-console && node src/db/heavy-index-v199.test.mjs
// sanctioned 形: DB_PATH=mkdtemp 临时库 → import client.js 拿 sqlite(不裸 import better-sqlite3); 自建小表 kaspa_tx_log。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'v199-'));
process.env.DB_PATH = join(dir, 'v199.db');
const { sqlite } = await import(pathToFileURL(join(HERE, 'client.js')).href);
const { ensureKaspaTxLogToAddrObservedIndex, KASPA_TX_LOG_TO_ADDR_OBSERVED_INDEX } = await import(pathToFileURL(join(HERE, 'heavy-index-v199.mjs')).href);

let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
sqlite.exec(`CREATE TABLE kaspa_tx_log (tx_id TEXT PRIMARY KEY, block_hash TEXT, block_time INTEGER, from_address TEXT, to_address TEXT, amount REAL, outputs_json TEXT, observed_at TEXT NOT NULL, network TEXT);
  CREATE INDEX idx_kaspa_tx_log_to_address ON kaspa_tx_log(to_address);
  INSERT INTO kaspa_tx_log (tx_id, to_address, amount, observed_at) VALUES ('a', 'kaspatest:x', 1, '2026-09-05T00:00:00Z'), ('b', 'kaspatest:x', 2, '2026-09-05T01:00:00Z');`);
const hasIdx = () => !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(KASPA_TX_LOG_TO_ADDR_OBSERVED_INDEX);
// 计划形与 broker-intake-watcher.js:703-717 同(等值 to_address + observed_at 范围 + ORDER BY observed_at DESC); 范围界用绑定 ISO 串(lint R-SQL-TIME-STRINGCMP 禁 datetime() 空格形与 ISO 列裸比)
const Q = 'SELECT tx_id FROM kaspa_tx_log k WHERE k.to_address = ? AND k.observed_at > ? ORDER BY k.observed_at DESC LIMIT 50';
const SINCE = '2026-09-04T00:00:00Z';
const plan = () => sqlite.prepare('EXPLAIN QUERY PLAN ' + Q).all('kaspatest:x', SINCE).map((r) => r.detail).join(' | ');

t('V1 缺索引 + 无 env ⇒ skipped: LOUD 警告一行, 不建(索引仍缺), 无 log', () => {
  const logs = [], warns = [];
  assert.equal(ensureKaspaTxLogToAddrObservedIndex(sqlite, { env: {}, log: (s) => logs.push(s), warn: (s) => warns.push(s) }), 'skipped');
  assert.equal(hasIdx(), false); assert.equal(logs.length, 0); assert.equal(warns.length, 1); assert.match(warns[0], /缺失.*不在 boot 自建/);
  assert.match(plan(), /TEMP B-TREE/);   // 无复合索引时 ORDER BY 走临时 B 树(schema-only 实录同形)
});
t('V2 缺索引 + KANET_MIGRATE_BUILD_HEAVY_INDEX=1 ⇒ built: 索引出现, EXPLAIN 走复合索引且无 TEMP B-TREE', () => {
  const logs = [];
  assert.equal(ensureKaspaTxLogToAddrObservedIndex(sqlite, { env: { KANET_MIGRATE_BUILD_HEAVY_INDEX: '1' }, log: (s) => logs.push(s), warn: () => {} }), 'built');
  assert.equal(hasIdx(), true); assert.equal(logs.length, 1); assert.match(logs[0], /在 boot 建完 \d+ ms/);
  const p = plan(); assert.match(p, /USING INDEX idx_kaspa_tx_log_to_addr_observed \(to_address=\? AND observed_at>\?\)/); assert.doesNotMatch(p, /TEMP B-TREE/);
  assert.deepEqual(sqlite.prepare(Q).all('kaspatest:x', SINCE).map((r) => r.tx_id), ['b', 'a']);   // 语义不变(observed_at DESC)
});
t('V3 索引已在 ⇒ present: 一行记账, 幂等(再跑还是 present, 不重建, env 无关)', () => {
  const logs = [];
  assert.equal(ensureKaspaTxLogToAddrObservedIndex(sqlite, { env: {}, log: (s) => logs.push(s), warn: () => { throw new Error('should not warn'); } }), 'present');
  assert.equal(ensureKaspaTxLogToAddrObservedIndex(sqlite, { env: { KANET_MIGRATE_BUILD_HEAVY_INDEX: '1' }, log: (s) => logs.push(s), warn: () => {} }), 'present');
  assert.equal(logs.length, 2); assert.match(logs[0], /记账通过/);
});

try { sqlite.close(); } catch { /* best-effort */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
