// u1-live-arms 自测(J2 2026-08-28 · NWT 两条件: ① 临时 fastify【只挂 registerIdentityRoutes】并机械证明无 money 路由 ② run-all FAIL 停时打印回滚 SQL)
// 🔴 零 live: mkdtemp 临时库 + 真 runMigrations + 假 relay 行(真地址钥) + 临时 fastify 随机端口; 八臂脚本作【子进程】跑(与 operator 用法同形)。
// 跑: cd kasia-console && node scripts/u1-live-arms/u1-live-arms.selftest.mjs
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'u1-live-arms-'));
const DB = join(dir, 'live.db');
process.env.DB_PATH = DB;
process.env.KASPA_NETWORK = 'testnet-12';   // 端点本地网络权威(kanet.env 同值)
const { runMigrations } = await import('../../src/db/migrate.js');
const { sqlite, dbPath } = await import('../../src/db/client.js');
assert.ok(resolve(dbPath).startsWith(dir), `安全闸: 必须临时库, 实际 ${dbPath}`);
runMigrations();
const k = await import('kaspa-wasm');
const { deriveIdentityPubkey, rootFingerprint } = await import('../../src/lib/u1-same-origin.mjs');
const { buildPopPayload, popMessageHashHex } = await import('../../src/lib/u1-registration-pop.mjs');
const { S10_DOMAIN, S10_VERSION, s10SignedMessage } = await import('../../src/lib/u1-s10-identity.mjs');

// ── ① 临时 fastify: 只挂 registerIdentityRoutes; onRoute 钩子枚举【全部】路由 ⇒ 机械证明无 money 路由 ──
const Fastify = (await import('fastify')).default;
const { registerIdentityRoutes } = await import('../../src/api/identities.js');
const app = Fastify({ logger: false });
const routes = [];
app.addHook('onRoute', (r) => routes.push(`${Array.isArray(r.method) ? r.method.join('|') : r.method} ${r.url}`));
await app.register(registerIdentityRoutes);
await app.listen({ port: 0, host: '127.0.0.1' });
const URL = `http://127.0.0.1:${app.server.address().port}`;
const MONEY = /pool|exchange|withdraw|faucet|bettor|broker|send-command|escrow|trading|payout|refund|relay\//i;
const routeOk = routes.length > 0 && routes.every((r) => /^\S+ (\/identities(\/|$)|\/api\/identity\/)/.test(r)) && !routes.some((r) => MONEY.test(r));

// ── 夹具 ──
const mkKey = (net = 'testnet-12') => { const p = new k.PrivateKey(randomBytes(32).toString('hex')); return { privHex: p.toString(), pubkey: p.toPublicKey().toXOnlyPublicKey().toString(), address: p.toPublicKey().toAddress(net).toString() }; };
const insRelay = (name, key) => { const id = randomUUID(); sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, privkey_encrypted, address, network, created_at, updated_at) VALUES (?,?,?,NULL,?,'testnet-12',datetime('now'),datetime('now'))`).run(id, name, 'enc', key.address); return id; };
const mkId = () => { const acct = new k.XPrv(new k.Mnemonic(k.Mnemonic.random().phrase).toSeed()).deriveChild(44, true).deriveChild(111111, true).deriveChild(0, true); const rootXpub = acct.toXPub().intoString('kpub'); const leaf = acct.deriveChild(0, false).deriveChild(0, false); const privHex = (typeof leaf.toPrivateKey === 'function' ? leaf.toPrivateKey() : k.PrivateKey.fromXPrv(leaf)).toString(); return { rootXpub, privHex, pubkey: deriveIdentityPubkey(rootXpub, 0) }; };
const issue = () => { const c = randomBytes(32).toString('hex'); sqlite.prepare('INSERT INTO u1_identity_challenge (challenge, used_at, expires_at) VALUES (?, NULL, ?)').run(c, Date.now() + 3600_000); return c; };
const buildSub = (relayId, id, challenge, signer, network = 'testnet-12') => {
  const payload = buildPopPayload({ rootFingerprint: rootFingerprint(id.rootXpub), identityIndex: 0, relayId, challenge });
  const signature = k.signMessage({ message: popMessageHashHex(payload), privateKey: id.privHex });
  const f = { domain: S10_DOMAIN, version: S10_VERSION, network, relayPubkeyXOnly: signer.pubkey, operation: 'register', epoch: challenge };
  return { relayId, rootXpub: id.rootXpub, identityIndex: 0, identityPubkeyXOnly: id.pubkey, challenge, signature, s10: { ...f, signature: k.signMessage({ message: s10SignedMessage(f), privateKey: signer.privHex }) } };
};
const file = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
function fixtureSet(tag) {
  const KB = mkKey(), KC = mkKey(), KX = mkKey();
  const B = insRelay(`B-${tag}`, KB), C = insRelay(`C-${tag}`, KC);
  const idB = mkId(), idC = mkId(), idX = mkId();
  const cB = issue(), cM = issue(), cX = issue(), cC = issue();
  return { B, C, KB, KC, KX, cB, cX, cC,
    subB: file(`subB-${tag}.json`, buildSub(B, idB, cB, KB)),
    subM: file(`subM-${tag}.json`, buildSub(B, idB, cM, KB, 'mainnet')),   // L6 反例: mainnet 域签名件(自测里造, 对应 live 上 builder KASPA_NETWORK=mainnet 产物, scratch 不入库)
    subX: file(`subX-${tag}.json`, buildSub(C, idX, cX, KX)),
    subC: file(`subC-${tag}.json`, buildSub(C, idC, cC, KC)) };
}
const counts = () => ({ a2: sqlite.prepare('SELECT COUNT(*) c FROM u1_identity_registration').get().c, id: sqlite.prepare('SELECT COUNT(*) c FROM u1_relay_identity').get().c, used: sqlite.prepare('SELECT COUNT(*) c FROM u1_identity_challenge WHERE used_at IS NOT NULL').get().c });
// 🔴 子进程必须【异步】起: 临时 fastify 跑在本进程, spawnSync 会堵死事件循环 ⇒ 子进程 fetch 永远得不到应答(首版实栽: 六臂 30s 超时 ⇒ PARSE)
const run = (arm, args) => new Promise((resolveRun) => {
  const c = spawn(process.execPath, [join(HERE, `${arm}.mjs`), ...args, '--db', DB, '--console-url', URL, '--out-dir', join(dir, 'out')], { env: { ...process.env } });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => {
    const last = stdout.trim().split('\n').filter(Boolean).pop();
    let o = null; try { o = JSON.parse(last); } catch { o = { verdict: 'PARSE', stdout: stdout.slice(-300), stderr: stderr.slice(-500) }; }
    resolveRun({ o, status, stderr });
  });
});

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

await t('① 临时 fastify 只挂 registerIdentityRoutes: 全部路由 ⊆ {/identities*, /api/identity/*}, 无 money 路由(路由表见下)', async () => { assert.ok(routeOk, JSON.stringify(routes)); });
console.log('   routes=' + JSON.stringify(routes));

const S1 = fixtureSet('s1');
await t('L8 库身份阳性对照 PASS, db = 临时库绝对路径, relay_nodes>0', async () => { const { o } = await run('L8', []); assert.strictEqual(o.verdict, 'PASS', JSON.stringify(o)); assert.strictEqual(resolve(o.db), resolve(DB)); assert.ok(o.evidence.relay_nodes > 0); });
await t('L1 schema PASS(v198 四约束 + 仅自动索引 + v196/v197 在)', async () => { const { o } = await run('L1', []); assert.strictEqual(o.verdict, 'PASS', JSON.stringify(o.evidence?.checks)); });
await t('run-all dry-run(全新夹具): 只读臂 PASS, 写臂 DRY, L6 PASS, 零写入', async () => {
  const c0 = counts();
  const { o, status } = await run('run-all', ['--submission', S1.subB, '--submission-mainnet', S1.subM, '--submission-x', S1.subX, '--submission-c', S1.subC, '--relay', S1.B]);
  assert.strictEqual(status, 0, JSON.stringify(o));
  const v = Object.fromEntries(o.results.map((r) => [r.arm, r.verdict]));
  assert.deepStrictEqual(v, { L8: 'PASS', L1: 'PASS', L4: 'DRY', L6: 'PASS', L2: 'DRY', L3: 'DRY', L5: 'DRY', L7: 'PASS' }, JSON.stringify(v));
  assert.deepStrictEqual(counts(), c0, 'dry-run 竟有写入');
});
await t('L4 --execute(在 L2 之前): 400 RELAY_NOT_OWNED, 挑战未消费, 零写入', async () => { const c0 = counts(); const { o } = await run('L4', ['--submission', S1.subB, '--execute']); assert.strictEqual(o.verdict, 'PASS', JSON.stringify(o.evidence)); assert.deepStrictEqual(counts(), c0); });
await t('L6 跨网负: 400 S10_INVALID/NETWORK_MISMATCH, 零写入', async () => { const c0 = counts(); const { o } = await run('L6', ['--submission', S1.subM]); assert.strictEqual(o.verdict, 'PASS', JSON.stringify(o.evidence)); assert.deepStrictEqual(counts(), c0); });
await t('L2 dry-run 零写入 ⇒ DRY', async () => { const c0 = counts(); const { o } = await run('L2', ['--submission', S1.subB]); assert.strictEqual(o.verdict, 'DRY'); assert.deepStrictEqual(counts(), c0); });
await t('L2 --execute: 200 + A2 行 + 身份行 = fromAddress(B) + 挑战消费', async () => { const { o } = await run('L2', ['--submission', S1.subB, '--execute']); assert.strictEqual(o.verdict, 'PASS', JSON.stringify(o.evidence)); assert.strictEqual(o.evidence.address_key, S1.KB.pubkey); });
await t('L3 --execute: 重放 400 CHALLENGE_ALREADY_USED, 行数不变', async () => { const { o } = await run('L3', ['--submission', S1.subB, '--execute']); assert.strictEqual(o.verdict, 'PASS', JSON.stringify(o.evidence)); });
await t('L4 顺序闸负例: L2 之后再 --execute ⇒ FAIL ORDER_GATE, 零 POST', async () => { const c0 = counts(); const { o, status } = await run('L4', ['--submission', S1.subB, '--execute']); assert.strictEqual(o.verdict, 'FAIL'); assert.strictEqual(o.evidence.code, 'ORDER_GATE'); assert.strictEqual(status, 1); assert.deepStrictEqual(counts(), c0); });
await t('L5 --execute 受控 R7: X 抢 C ⇒ RELAY_NOT_OWNED 零写入; C 自钥 ⇒ 200 + 行', async () => { const { o } = await run('L5', ['--submission-x', S1.subX, '--submission-c', S1.subC, '--execute']); assert.strictEqual(o.verdict, 'PASS', JSON.stringify(o.evidence)); assert.strictEqual(o.evidence.X.code, 'RELAY_NOT_OWNED'); assert.strictEqual(o.evidence.address_key, S1.KC.pubkey); });
await t('L7 legacy 对照: PASS, 代码零引用, evidence_kind=degraded(临时库 legacy 列为空)', async () => { const { o } = await run('L7', ['--relay', S1.B]); assert.strictEqual(o.verdict, 'PASS', JSON.stringify(o.evidence)); assert.strictEqual(o.evidence.evidence_kind, 'degraded'); assert.strictEqual(o.evidence.code_refs_to_ecdsa_col_in_u1_registration, 0); });
await t('L7 strong 档: relay 的 ecdsa_pubkey_xonly 填成他钥(临时库) ⇒ evidence_kind=strong 且仍 PASS', async () => { sqlite.prepare('UPDATE relay_nodes SET ecdsa_pubkey_xonly = ? WHERE id = ?').run(S1.KX.pubkey, S1.B); const { o } = await run('L7', ['--relay', S1.B]); assert.strictEqual(o.evidence.evidence_kind, 'strong'); assert.strictEqual(o.verdict, 'PASS'); });

// ── Codex 438e46e9 MUST-FIX(fail-open): 逐个省略必需参数 ⇒ exit≠0 且零执行零写; 期望映射严格 ──
await t('run-all 缺参 fail-closed: 五个必需参数逐个省略 ⇒ exit 2、verdict FAIL/MISSING_INPUT、results 空、零写入', async () => {
  const full = ['--submission', S1.subB, '--submission-mainnet', S1.subM, '--submission-x', S1.subX, '--submission-c', S1.subC, '--relay', S1.B];
  for (let i = 0; i < full.length; i += 2) {
    const args = full.filter((_, j) => j !== i && j !== i + 1); const c0 = counts();
    const { o, status } = await run('run-all', args);
    assert.strictEqual(status, 2, `省略 ${full[i]} 时 exit=${status}`); assert.strictEqual(o.verdict, 'FAIL'); assert.strictEqual(o.reason, 'MISSING_INPUT'); assert.deepStrictEqual(o.results, []);
    assert.deepStrictEqual(counts(), c0);
  }
  const { status: s2 } = await run('run-all', [...full.slice(0, 1), join(dir, 'nope.json'), ...full.slice(2)]); assert.strictEqual(s2, 2, '文件不存在也须拒');
});
await t('run-all 严格映射: 子进程输出被替换成非预期 verdict(伪造 arm 名不匹配) ⇒ PARSE_FAIL ⇒ exit 1', async () => {
  // 用 --out-dir 指向一个不可写路径不会造 verdict 差异; 这里用 --console-url 指向死端口让 L6 真 FAIL, 证明"非预期 verdict ⇒ 停 + exit 1"
  const { o, status } = await run('run-all', ['--submission', S1.subB, '--submission-mainnet', S1.subM, '--submission-x', S1.subX, '--submission-c', S1.subC, '--relay', S1.B]);
  assert.strictEqual(status, 1, '同夹具重跑(挑战已用) ⇒ 必停'); assert.ok(o.stopped_at); assert.strictEqual(o.verdict, 'FAIL');
});

const S2 = fixtureSet('s2');
await t('run-all --execute(全新夹具 s2): 八臂全 PASS, 顺序 L8→L1→L4→L6→L2→L3→L5→L7', async () => {
  const { o, status } = await run('run-all', ['--submission', S2.subB, '--submission-mainnet', S2.subM, '--submission-x', S2.subX, '--submission-c', S2.subC, '--relay', S2.B, '--execute']);
  assert.strictEqual(status, 0, JSON.stringify(o));
  assert.deepStrictEqual(o.results.map((r) => r.arm), ['L8', 'L1', 'L4', 'L6', 'L2', 'L3', 'L5', 'L7']);
  assert.ok(o.results.every((r) => r.verdict === 'PASS'), JSON.stringify(o.results));
});
await t('② run-all --execute 重跑同夹具 ⇒ L4 ORDER_GATE FAIL 即停, stderr 打印三行回滚 SQL(含 u1_relay_identity + 活算地址钥)', async () => {
  const { o, status, stderr } = await run('run-all', ['--submission', S2.subB, '--submission-mainnet', S2.subM, '--submission-x', S2.subX, '--submission-c', S2.subC, '--relay', S2.B, '--execute']);
  assert.strictEqual(status, 1); assert.deepStrictEqual(o.results.map((r) => r.arm), ['L8', 'L1', 'L4']); assert.strictEqual(o.results[2].verdict, 'FAIL');
  assert.ok(stderr.includes('DELETE FROM u1_identity_registration WHERE relay_id') && stderr.includes(`DELETE FROM u1_relay_identity        WHERE relay_pubkey_xonly = '${S2.KB.pubkey}'`) && stderr.includes('DELETE FROM u1_identity_challenge'), stderr.slice(-600));
  assert.ok(stderr.includes('须 Owner D-005 GO'));
});
console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-live-arms selftest: ${pass} PASS / ${fail} FAIL   (临时库 ${DB})`);
process.exitCode = fail ? 1 : 0;
await app.close();
try { sqlite.close(); } catch {}
try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) { console.warn(`⚠ 临时目录清理失败(不改判定): ${e?.message || e}`); }
