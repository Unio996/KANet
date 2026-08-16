// 注册入口用例 —— 判据 = spec v1.2-rc 的 **V7 / V17 / V18**(+ N8 在入口层仍然把关)。
//
// 🔴 跑**真 migration**(不抄 DDL)+ 真 `relay_nodes` 形状, 临时库, 不碰 live。
//    离线用例必须用真 schema, 否则约束/触发器那一层根本没被测到(在册教训)。
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'u1-reg-'));
process.env.DB_PATH = join(dir, 'probe.db');

const { runMigrations } = await import('../db/migrate.js');
const { sqlite, dbPath } = await import('../db/client.js');
assert.ok(dbPath.startsWith(dir), `安全闸: 必须临时库, 实际 ${dbPath}`);
runMigrations();

const { Mnemonic, XPrv, PrivateKey, signMessage } = await import('kaspa-wasm');
const { deriveIdentityPubkey, rootFingerprint } = await import('./u1-same-origin.mjs');
const { buildPopPayload, popMessageHashHex } = await import('./u1-registration-pop.mjs');
const { registerIdentity, deriveCustody, REG_REJECT } = await import('./u1-registration.mjs');

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};

// ── 夹具: 造 relay_nodes 行(不同托管形态) + 一份身份 ─────────────────────────
function insRelay({ mnemonic = null, privkey = null }) {
  const id = randomUUID();
  // ⚠ `created_at` 是真 schema 里的 NOT NULL —— 第一版夹具漏了它, 七格当场红。
  //   这正是「离线用例必须跑真 migration」的价值: 抄一份简化 DDL 的话, 这里会绿, 而线上会炸。
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, privkey_encrypted, address, network, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 'testnet-12', datetime('now'), datetime('now'))`)
    .run(id, 'r-' + id.slice(0, 6), mnemonic, privkey, 'kaspatest:q' + id.slice(0, 20));
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
const okChallenge = (c) => ({ challenge: c, usedAt: null, expiresAt: Date.now() + 60_000 });
function submissionFor(relayId, id, challenge, extra = {}) {
  const payload = buildPopPayload({ rootFingerprint: rootFingerprint(id.rootXpub), identityIndex: 0, relayId, challenge });
  const signature = signMessage({ message: popMessageHashHex(payload), privateKey: new PrivateKey(id.privHex) });
  return { relayId, rootXpub: id.rootXpub, identityIndex: 0, identityPubkeyXOnly: id.pubkey, challenge, signature, ...extra };
}

// ── 前置: 合法路径先能过 ─────────────────────────────────────────────────────
await t('前置 · mnemonic 型 relay + 合法 PoP ⇒ 注册成功, 且 custody 落库为服务端派生值', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-ok';
  let consumed = null;
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch),
    now: Date.now(), consumeChallenge: (c) => { consumed = c; },
  });
  assert.strictEqual(r.ok, true, `合法路径必须过, 实际: ${r.code} ${r.reason}`);
  assert.strictEqual(consumed, ch, '成功后必须把挑战串交给调用方作废');
  const row = sqlite.prepare('SELECT custody, root_fingerprint FROM u1_identity_registration WHERE relay_id = ?').get(relayId);
  assert.strictEqual(row.custody, 'mnemonic');
  assert.strictEqual(row.root_fingerprint, rootFingerprint(id.rootXpub));
});

// ── V7 · privkey-only 不入委员 ───────────────────────────────────────────────
await t('V7 · privkey-only relay ⇒ 拒(fail-closed), 且理由可读', async () => {
  const relayId = insRelay({ privkey: 'enc-privkey-blob' });
  const id = makeIdentity();
  const ch = 'ch-v7';
  const r = await registerIdentity({ sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch), now: Date.now() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, REG_REJECT.CUSTODY_NOT_MNEMONIC, `实际 ${r.code}: ${r.reason}`);
  assert.match(r.reason, /不入委员/);
});

// ── 绑定闸(②)在入口层仍然把关(不是只在 u1-same-origin.mjs 里) ─────────────
// 🔴 本格是变异测试抓出来的洞, 不是想到的: 拆掉 registerIdentity() 里的 `if (!bind.ok) return ...`
//    后, 上面几格用例全绿——没有任何一格提交过一个绑定对不上的注册请求走完整入口流程。
await t('绑定闸 · identityPubkeyXOnly 与登记根派生的不一致 ⇒ 拒 BINDING_INVALID, 且不落库', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-bind';
  const sub = submissionFor(relayId, id, ch, { identityPubkeyXOnly: 'a'.repeat(64) });   // 声称的 pubkey 对不上派生结果
  const r = await registerIdentity({ sqlite, submission: sub, challengeRecord: okChallenge(ch), now: Date.now() });
  assert.strictEqual(r.ok, false, `绑定对不上还能过 ⇒ 派生证明没在入口层真的守着`);
  assert.strictEqual(r.code, REG_REJECT.BINDING_INVALID, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0,
    '绑定没过还落了库 = 最坏的那种失败');
});

// ── V17 · 提交方说谎 ⇒ 拒(服务端派生值说了算) ────────────────────────────────
await t('V17 · privkey-only relay 提交 custody:"mnemonic" ⇒ 仍必须拒(提交值不被采信)', async () => {
  const relayId = insRelay({ privkey: 'enc-privkey-blob' });
  const id = makeIdentity();
  const ch = 'ch-v17';
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch, { custody: 'mnemonic' }),   // ← 直接说谎
    challengeRecord: okChallenge(ch), now: Date.now(),
  });
  assert.strictEqual(r.ok, false, '提交方自陈 mnemonic 竟然过了 ⇒ 这一列退化成申报');
  assert.strictEqual(r.code, REG_REJECT.CUSTODY_NOT_MNEMONIC);
});

// ── V18 · 提交带 custody 字段时, 落库值仍是服务端自查结果 ────────────────────
await t('V18 · 合格 relay 但提交 custody:"privkey" ⇒ 落库仍为服务端派生的 mnemonic(提交值根本不读)', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-v18';
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch, { custody: 'privkey' }),    // ← 提交个错的
    challengeRecord: okChallenge(ch), now: Date.now(),
  });
  assert.strictEqual(r.ok, true, `提交值不该影响判定, 实际: ${r.code} ${r.reason}`);
  const row = sqlite.prepare('SELECT custody FROM u1_identity_registration WHERE relay_id = ?').get(relayId);
  assert.strictEqual(row.custody, 'mnemonic', '落库值必须是服务端自查结果, 不是提交值');
});

await t('V18-bis · 混合态(mnemonic 与 privkey 皆非空) ⇒ 拒, 不是"挑一个"', async () => {
  const relayId = insRelay({ mnemonic: 'enc-m', privkey: 'enc-p' });
  assert.strictEqual(deriveCustody(sqlite, relayId).code, REG_REJECT.CUSTODY_AMBIGUOUS);
});

await t('relay 不在 relay_nodes ⇒ 拒(不默认放行)', async () => {
  assert.strictEqual(deriveCustody(sqlite, 'no-such-relay').code, REG_REJECT.RELAY_UNKNOWN);
});

// ── N8 在入口层仍然把关(不是只在 pop 模块里) ────────────────────────────────
await t('入口层 · PoP 失败(挑战串没签发) ⇒ 拒, 且不落库', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const r = await registerIdentity({ sqlite, submission: submissionFor(relayId, id, 'ch-none'), challengeRecord: null, now: Date.now() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, REG_REJECT.POP_FAILED);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0,
    'PoP 没过还落了库 = 最坏的那种失败');
});

// ── N3 的最后一道: 即使前面都过, DB 约束仍拒同根第二身份 ────────────────────
await t('N3 兜底 · 同一个根注册到第二个 relay ⇒ 被【DB 约束】拒(不靠前面的检查)', async () => {
  const id = makeIdentity();
  const r1 = insRelay({ mnemonic: 'enc-m1' });
  const r2 = insRelay({ mnemonic: 'enc-m2' });
  const a = await registerIdentity({ sqlite, submission: submissionFor(r1, id, 'ch-n3-a'), challengeRecord: okChallenge('ch-n3-a'), now: Date.now() });
  assert.strictEqual(a.ok, true, `第一条应当成功: ${a.code} ${a.reason}`);
  const b = await registerIdentity({ sqlite, submission: submissionFor(r2, id, 'ch-n3-b'), challengeRecord: okChallenge('ch-n3-b'), now: Date.now() });
  assert.strictEqual(b.ok, false, '同根第二身份必须进不来');
  assert.strictEqual(b.code, REG_REJECT.CONSTRAINT, `应当是被 DB 约束拒, 实际 ${b.code}: ${b.reason}`);
});

sqlite.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-registration: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
