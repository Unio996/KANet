// ingest-handshake-pending.test.mjs — V2b(握手自动接受开关设计 v0.4 §6.2 ⑤ / §7.6): console 侧现状钉住。
//
// 为什么这条在 console 里: 开关只关 relay 的"接受"动作; relay 关闭态仍会把入站握手交给 console 登记(step 4 ingestMessage)。
// 设计的两个前提都依赖 console 侧 handleIngestMessage 的这段现有行为——所以钉住它, 免得它悄悄变了、开关的"保留 pending 待人工/将来接手"语义就空了:
//   ① 入站握手 ⇒ 恰一行 pending_actions(action_type=handshake_accept, status=pending, direction=inbound);
//   ② 同一(本地, 对端)再来握手 ⇒ 不重复入队(幂等键 handshake_accept:<local>:<peer>);
//   ③ 已 active / 已接受过 ⇒ 不入队;
//   ④ 旧行 failed / expired ⇒ 重置为 pending(retry_count=0, error=NULL, trigger_txid 更新); executing / done ⇒ 静默跳过;
//   ⑤ 全库无按时间的过期机制这一事实的另一面: pending 行不会被本路径自己清掉(关闭期间累积的 pending 留到有人处置)。
// 真实迁移(runMigrations)建一个全新临时库, 调真实 handleIngestMessage。不碰真实库(DB_PATH 指向临时文件)。
// 跑: cd kasia-console && node src/services/ingest-handshake-pending.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'hs-pending-'));
process.env.DB_PATH = join(dir, 'hs-pending.db');
const { sqlite } = await import(pathToFileURL(join(HERE, '..', 'db', 'client.js')).href);
const { runMigrations } = await import(pathToFileURL(join(HERE, '..', 'db', 'migrate.js')).href);
runMigrations();
const { handleIngestMessage } = await import(pathToFileURL(join(HERE, 'ingest-service.js')).href);
const { observeHandshake } = await import(pathToFileURL(join(HERE, 'relation-state.js')).href);

let n = 0, fail = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };

const LOCAL = 'kaspa:qlocaltest0000000000000000000000000000000000000000000000000';
const peer = (i) => `kaspa:qpeertest${i}00000000000000000000000000000000000000000000000000`.slice(0, 63);
let seq = 0;
const ingest = (remote) => { const tx = `tx${++seq}`.padEnd(64, 'a'); return handleIngestMessage({ traceId: `handshake-in:${tx}`, network: 'mainnet', direction: 'inbound', localAddress: LOCAL, remoteAddress: remote, txid: tx, messageType: 'handshake', contentText: '', theirAlias: 'al' }).then((r) => ({ r, tx })); };
const rows = (remote) => sqlite.prepare("SELECT * FROM pending_actions WHERE action_type = 'handshake_accept' AND local_address = ? AND target_address = ?").all(LOCAL, remote);
// ingest-service 的 console.log 在这里是噪音, 静默掉(断言不依赖它)
// (但记下来: ②/④b 要断言"没有走到 INSERT 撞 UNIQUE 被 catch 吞掉"——幂等键 UNIQUE 是第二层保护, 只数行会把"代码层跳过"与"靠 DB 撞键兜底"混为一谈)
const origLog = console.log; const LOGS = []; const quiet = async (fn) => { console.log = (...a) => { LOGS.push(a.map(String).join(' ')); }; try { return await fn(); } finally { console.log = origLog; } };
const writeFailed = () => LOGS.filter((l) => l.includes('pending_actions write failed'));

await t('① 入站握手 ⇒ 恰一行 pending_actions(handshake_accept / pending / inbound / source=ingest, trigger_txid=该 txid, 幂等键固定形状); messages 里登记一条 handshake', async () => {
  const p = peer(1);
  const { tx } = await quiet(() => ingest(p));
  const r = rows(p);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'pending'); assert.equal(r[0].direction, 'inbound'); assert.equal(r[0].source, 'ingest');
  assert.equal(r[0].trigger_txid, tx); assert.equal(r[0].idempotent_key, `handshake_accept:${LOCAL}:${p}`);
  const m = sqlite.prepare("SELECT COUNT(*) c FROM messages WHERE message_type = 'handshake' AND source_txid = ?").get(tx);
  assert.equal(m.c, 1);
});
await t('② 同一对端再来握手(新 txid / 新 traceId) ⇒ 不重复入队, 仍恰一行(pending 行不被本路径清掉、不被覆盖)', async () => {
  const p = peer(1);
  const before = rows(p)[0];
  LOGS.length = 0;
  await quiet(() => ingest(p)); await quiet(() => ingest(p));
  assert.deepEqual(writeFailed(), [], '代码层就该跳过, 不该靠 UNIQUE 撞键兜底: ' + writeFailed().join(' | '));
  const r = rows(p);
  assert.equal(r.length, 1); assert.equal(r[0].id, before.id); assert.equal(r[0].status, 'pending'); assert.equal(r[0].trigger_txid, before.trigger_txid);
});
await t('③ 已 active ⇒ 不入队(relation_states 已 active 的对端来握手只是 ACK)', async () => {
  const p = peer(2);
  observeHandshake(LOCAL, p, 'seed-tx'.padEnd(64, 'b'), new Date().toISOString());
  const upd = sqlite.prepare("UPDATE relation_states SET status = 'active' WHERE local_address = ? AND peer_address = ?").run(LOCAL, p);
  assert.equal(upd.changes, 1, '种子行应存在');
  await quiet(() => ingest(p));
  assert.equal(rows(p).length, 0);
});
await t('③b 已接受过(handshake_accepted_at 非空)但 status 不是 active ⇒ 同样不入队', async () => {
  const p = peer(3);
  observeHandshake(LOCAL, p, 'seed3'.padEnd(64, 'c'), new Date().toISOString());
  sqlite.prepare("UPDATE relation_states SET handshake_accepted_at = ? WHERE local_address = ? AND peer_address = ?").run(new Date().toISOString(), LOCAL, p);
  await quiet(() => ingest(p));
  assert.equal(rows(p).length, 0);
});
for (const st of ['failed', 'expired']) {
  await t(`④ 旧行 ${st} ⇒ 重置为 pending(retry_count=0, error 清空, trigger_txid 更新), 仍恰一行`, async () => {
    const p = peer(st === 'failed' ? 4 : 5);
    await quiet(() => ingest(p));
    const id = rows(p)[0].id;
    sqlite.prepare("UPDATE pending_actions SET status = ?, retry_count = 3, error = 'boom' WHERE id = ?").run(st, id);
    const { tx } = await quiet(() => ingest(p));
    const r = rows(p);
    assert.equal(r.length, 1); assert.equal(r[0].id, id); assert.equal(r[0].status, 'pending'); assert.equal(r[0].retry_count, 0); assert.equal(r[0].error, null); assert.equal(r[0].trigger_txid, tx);
  });
}
for (const st of ['executing', 'done']) {
  await t(`④b 旧行 ${st} ⇒ 静默跳过(不重置、不新增)`, async () => {
    const p = peer(st === 'executing' ? 6 : 7);
    await quiet(() => ingest(p));
    const id = rows(p)[0].id;
    sqlite.prepare("UPDATE pending_actions SET status = ? WHERE id = ?").run(st, id);
    LOGS.length = 0;
    await quiet(() => ingest(p));
    assert.deepEqual(writeFailed(), [], '不该走到 INSERT 撞键: ' + writeFailed().join(' | '));
    const r = rows(p);
    assert.equal(r.length, 1); assert.equal(r[0].status, st);
  });
}
await t('⑤ 出站握手(direction=outbound)不入队 handshake_accept(由 action-executor 写)', async () => {
  const p = peer(8);
  const tx = 'outtx'.padEnd(64, 'd');
  await quiet(() => handleIngestMessage({ traceId: `handshake-out:${tx}`, network: 'mainnet', direction: 'outbound', localAddress: LOCAL, remoteAddress: p, txid: tx, messageType: 'handshake', contentText: '' }));
  assert.equal(rows(p).length, 0);
});

try { sqlite.close(); } catch {}
rmSync(dir, { recursive: true, force: true });
console.log(`\ningest-handshake-pending.test: ${n - fail} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
