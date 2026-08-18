// NWT independent behavioral injection suite for POST /api/identity/u1-register.
// Distinct implementation from u1-wiring-behavior.test.mjs (KANet-UI/J2, dd36e7ef) —
// two independently-written suites converging on the same result is stronger evidence
// than one; this one is not a replacement, per the same rationale that file states.
//
// Real fastify.inject() calls through the actual handler (no port bind, no live console.db) —
// this is the suite that first caught 43411464's "route lands outside the function, import
// crashes" structural bug (NWT 06:12), which the purely-static ①-series accept script (10 PASS)
// could not see because it never actually imports the module.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'nwt-behav-'));
process.env.DB_PATH = join(dir, 'probe.db');
const { runMigrations } = await import('../db/migrate.js');
const { sqlite, dbPath } = await import('../db/client.js');
assert.ok(dbPath.startsWith(dir), '安全闸: 必须临时库, 实际 ' + dbPath);
runMigrations();

const { Mnemonic, XPrv, PrivateKey, signMessage } = await import('kaspa-wasm');
const { deriveIdentityPubkey, rootFingerprint } = await import('./u1-same-origin.mjs');
const { buildPopPayload, popMessageHashHex } = await import('./u1-registration-pop.mjs');

const Fastify = (await import('fastify')).default;
const { registerIdentityRoutes } = await import('../api/identities.js');

const app = Fastify({ logger: false });
await app.register(registerIdentityRoutes);
await app.ready();

function insRelay() {
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, privkey_encrypted, address, network, created_at, updated_at)
                  VALUES (?, ?, 'x', NULL, ?, 'testnet-12', datetime('now'), datetime('now'))`)
    .run(id, 'r-' + id.slice(0, 6), 'kaspatest:q' + id.slice(0, 20));
  return id;
}
function makeIdentity() {
  const acct = new XPrv(new Mnemonic(Mnemonic.random().phrase).toSeed())
    .deriveChild(44, true).deriveChild(111111, true).deriveChild(0, true);
  const rootXpub = acct.toXPub().intoString('kpub');
  const leaf = acct.deriveChild(0, false).deriveChild(0, false);
  const privHex = (typeof leaf.toPrivateKey === 'function' ? leaf.toPrivateKey() : PrivateKey.fromXPrv(leaf)).toString();
  return { rootXpub, privHex, pubkey: deriveIdentityPubkey(rootXpub, 0) };
}
function issueChallenge(c) {
  sqlite.prepare('INSERT INTO u1_identity_challenge (challenge, used_at, expires_at) VALUES (?, NULL, ?)').run(c, Date.now() + 60000);
}
async function buildSubmission({ relayId, id, challenge }) {
  const fp = rootFingerprint(id.rootXpub);
  const payload = buildPopPayload({ rootFingerprint: fp, identityIndex: 0, relayId, challenge });
  const hashHex = popMessageHashHex(payload);
  const priv = new PrivateKey(id.privHex);
  const signature = signMessage({ message: hashHex, privateKey: priv.toString() });
  return { relayId, rootXpub: id.rootXpub, identityIndex: 0, identityPubkeyXOnly: id.pubkey, challenge, signature };
}

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); console.log('[PASS] ' + n); pass++; } catch (e) { console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message)); fail++; } };

// 每条用例都用全新 relay/身份/挑战, 避免共享基线残留造成"两边都被同一个闸拦住"的假阴性
// (同族坑, dd36e7ef 的作者独立撞过一次)。

await t('NWT-control: 干净submission经真HTTP注册成功', async () => {
  const relayId = insRelay();
  const id = makeIdentity();
  const ch = 'ctrl-' + randomUUID();
  issueChallenge(ch);
  const sub = await buildSubmission({ relayId, id, challenge: ch });
  const res = await app.inject({ method: 'POST', url: '/api/identity/u1-register', payload: sub });
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.custody, 'mnemonic');
});

await t('NWT-1: 注入custody字段全链路被忽略(真POST落库核实, 非源码grep)', async () => {
  const relayId = insRelay();
  const id = makeIdentity();
  const ch = 'inj-custody-' + randomUUID();
  issueChallenge(ch);
  const sub = await buildSubmission({ relayId, id, challenge: ch });
  const res = await app.inject({ method: 'POST', url: '/api/identity/u1-register', payload: { ...sub, custody: 'privkey' } });
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  assert.strictEqual(body.custody, 'mnemonic', '注入的 custody:"privkey" 不得反映到返回值');
  const row = sqlite.prepare('SELECT custody FROM u1_identity_registration WHERE relay_id=?').get(relayId);
  assert.strictEqual(row.custody, 'mnemonic', '落库行必须是服务端派生值, 不是注入值');
});

await t('NWT-2: 伪造challengeStore字段零效果(注册仍正常走通)', async () => {
  const relayId = insRelay();
  const id = makeIdentity();
  const ch = 'inj-store-' + randomUUID();
  issueChallenge(ch);
  const sub = await buildSubmission({ relayId, id, challenge: ch });
  const evilStore = { read: () => ({ challenge: ch, usedAt: null, expiresAt: Date.now() + 999999999 }), consume: () => {} };
  const res = await app.inject({ method: 'POST', url: '/api/identity/u1-register', payload: { ...sub, challengeStore: evilStore } });
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  assert.strictEqual(body.ok, true);
});

await t('NWT-3: clock/verifier逃逸口字段名零效果(过期挑战仍用真服务端时钟拒)', async () => {
  const relayId = insRelay();
  const id = makeIdentity();
  const ch = 'inj-clock-' + randomUUID();
  issueChallenge(ch);
  sqlite.prepare('UPDATE u1_identity_challenge SET expires_at=? WHERE challenge=?').run(Date.now() - 60000, ch);
  const sub = await buildSubmission({ relayId, id, challenge: ch });
  const res = await app.inject({
    method: 'POST', url: '/api/identity/u1-register',
    payload: { ...sub, clock: 'FAKE', __testOnlyClock: 'FAKE', verifyMessageFn: 'FAKE', expectedTable: 'attacker_table' },
  });
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 400, `expected 400 (expired, real clock used), got ${res.statusCode}: ${res.body}`);
  assert.strictEqual(body.code, 'POP_FAILED', `unexpected top-level code ${body.code}`);
  assert.match(body.reason, /CHALLENGE_EXPIRED/, `期望真时钟判过期落在 reason 里, 实得: ${body.reason} —— 伪造 clock 字段可能被采纳了`);
});

console.log(`\nNWT behavioral suite: ${pass} PASS / ${fail} FAIL`);
await app.close();
process.exitCode = fail ? 1 : 0;
