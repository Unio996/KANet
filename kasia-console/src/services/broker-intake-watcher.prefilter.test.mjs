// NWT (f) 边界向量: _scanExpiredBrokerOffers 预筛的 intent 排除条件 (30 min julianday) —— 从源文件【逐字抽出】该 NOT EXISTS 片段跑在真 schema 上,
// 保证向量绑定的是真实 SQL 文本, 不是复述。跑法: cd kasia-console && node src/services/broker-intake-watcher.prefilter.test.mjs
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'prefilter-'));
process.env.DB_PATH = join(dir, 't.db');
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'broker-intake-watcher.js'), 'utf8');
const m = src.match(/AND NOT EXISTS \(\s*SELECT 1 FROM broker_refund_intents i\s*WHERE i\.offer_id = exchange_offers\.id\s*AND \(i\.txid IS NOT NULL OR julianday\(i\.created_at\) > julianday\('now', '-30 minutes'\)\)[ \t]*(?:--[^\n]*)?\s*\)/);
t('X0 源文件含逐字 intent 排除片段 (julianday 形, 非 datetime 字符串比较)', () => { assert.ok(m, 'fragment not found verbatim'); assert.ok(!/i\.created_at > datetime\(/.test(src), '不得残留 datetime() 字符串比较'); });
const FRAG = m ? m[0].replace(/^AND /, '') : 'FALSE';
// exchange_offers 最小行 (DDL 解析 CHECK 枚举)
const en = (() => { const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='exchange_offers'`).get().sql; const o = {}; for (const x of sql.matchAll(/(\w+)\s+TEXT[^,]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)/g)) o[x[1]] = x[2].split(',')[0].trim().replace(/^'|'$/g, ''); return o; })();
let _mi = 0;   // exchange_offers UNIQUE(broadcast_tx_id, message_index) ⇒ 每行唯一
function mkOffer(id) { const cols = db.prepare(`PRAGMA table_info(exchange_offers)`).all(); const want = { id, created_at: new Date().toISOString(), broadcast_tx_id: 'btx_' + id, message_index: ++_mi }; for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = en[c.name] ?? (c.type === 'INTEGER' || c.type === 'REAL' ? 1 : 'x'); const names = Object.keys(want); db.prepare(`INSERT INTO exchange_offers (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n])); }
const iso = (minAgo) => new Date(Date.now() - minAgo * 60e3).toISOString();
const intent = (id, offerId, txid, minAgo) => db.prepare(`INSERT INTO broker_refund_intents (id, order_id, offer_id, user_addr, amount_kas, txid, created_at, updated_at) VALUES (?, NULL, ?, 'a', 1, ?, ?, ?)`).run(id, offerId, txid, iso(minAgo), iso(minAgo));
const kept = (offerId) => db.prepare(`SELECT count(*) AS n FROM exchange_offers WHERE id = ? AND ${FRAG}`).get(offerId).n;
for (const id of ['o29', 'o31', 'otx', 'onone']) mkOffer(id);
intent('i29', 'o29', null, 29);           // 29 min 内 INFLIGHT ⇒ 排除
intent('i31', 'o31', null, 31);           // 31 min 无 txid ⇒ 不排除 (stale 歧义交给 advanceToRefunded 的 classify/hold)
intent('itx', 'otx', 'a'.repeat(64), 600); // 有 txid (10 h 前) ⇒ 排除
t('X1 intent 29 min 内无 txid ⇒ 预筛排除 (kept=0)', () => assert.strictEqual(kept('o29'), 0));
t('X2 intent 31 min 无 txid ⇒ 预筛不排除 (kept=1) —— 由 advanceToRefunded 的 intent_stale_ambiguous ⇒ UNKNOWN hold 接手', () => assert.strictEqual(kept('o31'), 1));
t('X3 intent 有 txid(任意早) ⇒ 排除 (kept=0)', () => assert.strictEqual(kept('otx'), 0));
t('X4 无 intent ⇒ 不排除 (kept=1)', () => assert.strictEqual(kept('onone'), 1));
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`intake-prefilter: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
