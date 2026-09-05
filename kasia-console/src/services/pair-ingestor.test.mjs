// pair-ingestor.test.mjs — M8 rowid 游标离线测试. 跑: cd kasia-console && node src/services/pair-ingestor.test.mjs
// M0a 门: 不裸 import better-sqlite3 —— DB_PATH=mkdtemp 临时库 → import ../db/client.js(经 pair-ingestor 的 import 链) → 自建两张表; 从不开活库.
// Bettor 派工三向量: 空表 / 有游标 / 无游标; 另加: 旧 since_id(UUID/NaN/undefined) 兼容、幂等重扫、limit 分页游标、周期 tick 的 diag 行。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'pair-ingestor-'));
process.env.DB_PATH = join(dir, 'pi.db');
const { sqlite } = await import(pathToFileURL(join(HERE, '../db/client.js')).href);
const { scanAndIngestPairs, startPeriodicIngest } = await import(pathToFileURL(join(HERE, 'pair-ingestor.mjs')).href);

sqlite.exec(`
  CREATE TABLE broadcast_messages (id TEXT PRIMARY KEY, channel_name TEXT NOT NULL, sender_address TEXT NOT NULL, content TEXT NOT NULL,
    tx_hash TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL, visibility TEXT);
  CREATE TABLE agent_pairs (pair_id TEXT PRIMARY KEY, invite_txid TEXT NOT NULL, ack_txid TEXT NOT NULL, peer_a_addr TEXT NOT NULL, peer_b_addr TEXT NOT NULL,
    peer_a_pubkey TEXT NOT NULL, peer_b_pubkey TEXT NOT NULL, pair_scope TEXT, tunnel_status TEXT DEFAULT 'pending', tunnel_protocol TEXT,
    established_at INTEGER, last_seen_at INTEGER, bytes_sent INTEGER DEFAULT 0, bytes_received INTEGER DEFAULT 0);
`);

let n = 0, fail = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
let seq = 0;
const hex64 = (k) => (k + '').padStart(2, '0').repeat(32).slice(0, 64);
const PK = 'e'.repeat(40);
const ins = (content, txHash) => { seq++; sqlite.prepare("INSERT INTO broadcast_messages (id, channel_name, sender_address, content, tx_hash, created_at) VALUES (?, 'kanet-general', ?, ?, ?, ?)")
  .run(`uuid-${seq.toString().padStart(4, '0')}-${Math.random().toString(16).slice(2, 10)}`, `kaspatest:sender${seq}`, content, txHash, new Date().toISOString()); return sqlite.prepare('SELECT MAX(rowid) m FROM broadcast_messages').get().m; };
const invite = (scope) => JSON.stringify({ v: 0, intent: 'pair_invite', payload: { nat_endpoint: { ip: '1.2.3.4', port: 5 }, ed25519_pubkey: PK, pair_scope: scope } });
const ack = (ref, scope) => JSON.stringify({ v: 0, intent: 'pair_ack', ref, payload: { nat_endpoint: { ip: '5.6.7.8', port: 9 }, ed25519_pubkey: PK, pair_scope: scope } });
const pairs = () => sqlite.prepare('SELECT COUNT(*) c FROM agent_pairs').get().c;

await t('V1 空表: since_rowid 0 ⇒ 0 命中 / 0 pair / max_rowid 0', () => {
  const r = scanAndIngestPairs({ since_rowid: 0 });
  assert.deepEqual([r.invites_processed, r.acks_processed, r.pairs_created, r.max_rowid, r.max_id], [0, 0, 0, 0, 0]);
});
await t('V2 无游标(boot 形): 噪声/invite/噪声/ack ⇒ 1 pair, 游标推进到表 MAX(rowid)=4(扫到表尾)', () => {
  ins('{"hello":1}', hex64(1)); ins(invite('s1'), hex64(2)); ins('not json', hex64(3)); const last = ins(ack(hex64(2), 's1'), hex64(4));
  assert.equal(last, 4);
  const r = scanAndIngestPairs({ since_rowid: 0 });
  assert.equal(r.invites_processed, 1); assert.equal(r.acks_processed, 1); assert.equal(r.pairs_created, 1); assert.equal(r.max_rowid, 4); assert.equal(pairs(), 1);
  assert.equal(sqlite.prepare('SELECT pair_id FROM agent_pairs').get().pair_id, `${hex64(2)}:${hex64(4)}`);
});
await t('V3 有游标: 从 4 扫 ⇒ 0 命中且游标不退; 加噪声行(5) ⇒ 游标推到 5; 再加 invite/ack(6,7) ⇒ 从 5 扫得 1 pair, 游标 7', () => {
  let r = scanAndIngestPairs({ since_rowid: 4 }); assert.deepEqual([r.invites_processed + r.acks_processed, r.pairs_created, r.max_rowid], [0, 0, 4]);
  ins('{"noise":true}', hex64(5)); r = scanAndIngestPairs({ since_rowid: 4 }); assert.deepEqual([r.invites_processed + r.acks_processed, r.max_rowid], [0, 5]);
  ins(invite('s2'), hex64(6)); ins(ack(hex64(6), 's2'), hex64(7));
  r = scanAndIngestPairs({ since_rowid: 5 }); assert.deepEqual([r.invites_processed, r.acks_processed, r.pairs_created, r.max_rowid], [1, 1, 1, 7]); assert.equal(pairs(), 2);
});
await t('V4 旧参数 since_id 为 UUID/NaN/undefined ⇒ 当 0 全扫; 幂等(INSERT OR IGNORE) ⇒ 0 新 pair, 游标 7', () => {
  for (const bad of ['uuid-0004-deadbeef', NaN, undefined]) {
    const r = scanAndIngestPairs({ since_id: bad });
    assert.equal(r.pairs_created, 0, `since_id=${String(bad)}`); assert.equal(r.invites_processed, 2); assert.equal(r.max_rowid, 7);
  }
  assert.equal(pairs(), 2);
  assert.ok(Number.isNaN(Math.max(0, 'uuid-0004-deadbeef')), '旧形 Math.max(0, UUID) = NaN(记录 M8 根因)');
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM broadcast_messages WHERE id > ?').get(NaN).c, 0, '旧形 id > NaN(绑 NULL) 恒假');
});
await t('V5 limit 分页: limit=1 从 0 扫 ⇒ 只到首个命中行(rowid 2), 游标=2 不跳到表尾; 续扫 since 2 limit 1 ⇒ 到 4', () => {
  let r = scanAndIngestPairs({ since_rowid: 0, limit: 1 }); assert.equal(r.max_rowid, 2); assert.equal(r.invites_processed, 1);
  r = scanAndIngestPairs({ since_rowid: 2, limit: 1 }); assert.equal(r.max_rowid, 4); assert.equal(r.acks_processed, 1);
});
await t('V6 周期 tick: startPeriodicIngest 的 diag 行带 since_rowid/max_rowid 整数(非 NaN), 命中 0; stop 后不再打', async () => {
  const lines = []; const orig = console.log; console.log = (s) => { lines.push(String(s)); };
  let stop;
  try { stop = startPeriodicIngest({ interval_ms: 15 }); await new Promise((r) => setTimeout(r, 70)); stop(); const c = lines.length; await new Promise((r) => setTimeout(r, 40)); assert.equal(lines.length, c); }
  finally { console.log = orig; }
  const d = lines.filter((l) => l.startsWith('[diag:step] pair.scanAndIngestPairs '));
  assert.ok(d.length >= 2, `diag lines=${d.length}`);
  for (const l of d) assert.match(l, /^\[diag:step\] pair\.scanAndIngestPairs ms=\d+ since_rowid=7 max_rowid=7 hits=0 at=\S+Z$/);
});

try { sqlite.close(); } catch { /* best-effort */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
