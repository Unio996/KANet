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
const { default: Database } = await import('better-sqlite3');
assert.ok(dbPath.startsWith(dir), `安全闸: 必须临时库, 实际 ${dbPath}`);
runMigrations();

const { Mnemonic, XPrv, PrivateKey, signMessage } = await import('kaspa-wasm');
const { deriveIdentityPubkey, rootFingerprint } = await import('./u1-same-origin.mjs');
const { buildPopPayload, popMessageHashHex } = await import('./u1-registration-pop.mjs');
const { registerIdentity, deriveCustody, REG_REJECT } = await import('./u1-registration.mjs');
const { createChallengeStore } = await import('./u1-challenge-store.mjs');

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

// ── (343) 挑战存储夹具 ───────────────────────────────────────────────────────
// 🔴 **故意用真 SQLite 表, 不用进程内 Map**: 契约的要害是"消费与落库同事务、要么都成要么都不成"。
//    Map 不参与 better-sqlite3 事务 ⇒ 回滚时 Map 里的 usedAt 还留着, **原子性那一格会假绿**。
//    (在册: 离线用例必须用真 schema, 否则约束/事务那一层根本没被测到。)
sqlite.exec(`CREATE TABLE IF NOT EXISTS _test_challenge (
  challenge TEXT PRIMARY KEY, used_at INTEGER, expires_at INTEGER)`);
function chStore() {
  const st = createChallengeStore(sqlite, '_test_challenge');
  return {
    issue(c){ sqlite.prepare('INSERT OR REPLACE INTO _test_challenge (challenge, used_at, expires_at) VALUES (?, NULL, ?)').run(c, Date.now()+60000); return st.read(c); },
    read:(c)=>st.read(c), consume:(c)=>st.consume(c), typed: st,
  };
}
// 成功路径的标准接线: 消费与重读都走上面那张真表
const wire = (st) => ({ challengeStore: st.typed });
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
  const st = chStore(); st.issue(ch);
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch),
    now: Date.now(), ...wire(st),
  });
  assert.strictEqual(r.ok, true, `合法路径必须过, 实际: ${r.code} ${r.reason}`);
  assert.ok(st.read(ch)?.usedAt, '成功后挑战必须【真的】落成 used(读存储, 不读回调有没有被叫过)');
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
  const stV18 = chStore(); stV18.issue(ch);
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch, { custody: 'privkey' }),    // ← 提交个错的
    challengeRecord: okChallenge(ch), now: Date.now(), ...wire(stV18),
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
  const stN3 = chStore(); stN3.issue('ch-n3-a'); stN3.issue('ch-n3-b');
  const a = await registerIdentity({ sqlite, submission: submissionFor(r1, id, 'ch-n3-a'), challengeRecord: okChallenge('ch-n3-a'), now: Date.now(), ...wire(stN3) });
  assert.strictEqual(a.ok, true, `第一条应当成功: ${a.code} ${a.reason}`);
  const b = await registerIdentity({ sqlite, submission: submissionFor(r2, id, 'ch-n3-b'), challengeRecord: okChallenge('ch-n3-b'), now: Date.now(), ...wire(stN3) });
  assert.strictEqual(b.ok, false, '同根第二身份必须进不来');
  assert.strictEqual(b.code, REG_REJECT.CONSTRAINT, `应当是被 DB 约束拒, 实际 ${b.code}: ${b.reason}`);
});

// ── (343)+(354) 一次性挑战契约 · 结构绑定事务域 ──────────────────────────────
// (343) Codex a89919a0: consumeChallenge optional + non-atomic ⇒ 可重放。
// (354) Codex c0a1f50c: 光"必传+同事务"不够 —— **事务域出处**才是要害;
//        `.immediate` 只序列化身份表那个连接, 存储若在别的连接/库, 我的锁管不到它。
// 🔴 所以下面几格里有三格测的是【结构上进不来】, 不是【运行时被检查出来】——
//    区别在于: 后者可以被一个长得像 store 的对象绕过, 前者不能。

await t('(A-1) 省略 challengeStore ⇒ fail-closed 拒, 且【一个字节都不落库】', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-omit';
  const st = chStore(); st.issue(ch);
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch), now: Date.now(),
    // ← 故意不传
  });
  assert.strictEqual(r.ok, false, '不给存储竟然注册成功 = 一次性闸退化成可重放');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_CONSUME_MISSING, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
  assert.strictEqual(st.read(ch)?.usedAt, null, '拒的路径不该动挑战状态');
});

await t('(A-2) 🔴 伪造一个长得一模一样的 store(裸对象带 read/consume)⇒ 结构上被拒', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-fake-store';
  const st = chStore(); st.issue(ch);
  // 🔴 这个假 store 的行为**完全正确**(真的读真表、真的 CAS 消费) —— 它唯一的问题是
  //    **不是 createChallengeStore 造的**, 因而没有任何东西担保它绑在本次的事务域上。
  //    ⇒ 若这一格能过, 说明我们守的是"长得像不像"(可伪造), 不是"是不是同一个事务域"。
  const fake = {
    read: (c) => st.read(c),
    consume: (c) => st.consume(c),
  };
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch), now: Date.now(),
    challengeStore: fake,
  });
  assert.strictEqual(r.ok, false, '🔴 鸭子类型的假 store 过了 ⇒ 守的是形状不是事务域, (354) 没修好');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_STORE_UNBOUND, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(A-3) 🔴 绑在【另一个 sqlite handle】上的真 store ⇒ 也必须拒(这正是 Codex 说的跨事务域)', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-other-handle';
  const st = chStore(); st.issue(ch);
  // 另开一个连接(**同一个库文件**, 但不同 handle ⇒ 不同事务域)
  const other = new Database(dbPath);
  const otherStore = createChallengeStore(other, '_test_challenge');
  // ⚠ 注意它是 createChallengeStore 造的【真】store, 行为无可挑剔 —— 唯一的问题是 handle 不同。
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch), now: Date.now(),
    challengeStore: otherStore,
  });
  other.close();
  assert.strictEqual(r.ok, false, '🔴 别的连接造的 store 过了 ⇒ 我持的锁管不到它, 原子性是假的');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_STORE_UNBOUND, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(B) 消费失败(挑战不在表里)⇒ 整笔回滚, 不落库', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-not-issued';
  const st = chStore();          // ← 故意【不】 issue, 表里没有这条
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch), now: Date.now(), ...wire(st),
  });
  assert.strictEqual(r.ok, false, '消费不成立却报注册成功');
  // 前置读先发现"记录不存在" ⇒ ALREADY_USED 分支(理由串里写明 record-missing); 两者都必须【不落库】。
  assert.ok([REG_REJECT.CHALLENGE_ALREADY_USED, REG_REJECT.CHALLENGE_CONSUME_FAILED].includes(r.code),
    `期望前置读或消费失败其一, 实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0,
    '🔴 INSERT 没跟着回滚 = 非原子');
});

await t('(C) 成功边界【之后】拿同一挑战重放 ⇒ 必拒(一次性的全部含义)', async () => {
  const id1 = makeIdentity(); const id2 = makeIdentity();
  const relay1 = insRelay({ mnemonic: 'enc-m-replay-1' });
  const relay2 = insRelay({ mnemonic: 'enc-m-replay-2' });
  const ch = 'ch-replay';
  const st = chStore(); st.issue(ch);

  const first = await registerIdentity({
    sqlite, submission: submissionFor(relay1, id1, ch), challengeRecord: st.read(ch), now: Date.now(), ...wire(st),
  });
  assert.strictEqual(first.ok, true, `第一次必须成功, 实际 ${first.code}: ${first.reason}`);
  assert.ok(st.read(ch)?.usedAt, '成功后存储里必须真的是 used');

  // 🔵 重放时挑战记录【从存储现读】—— 不是重新造一个 usedAt:null 的假记录,
  //    否则测的是"我喂了个 used 记录它会不会拒"(谓词), 而不是"上一次成功有没有真的把它用掉"(调用点)。
  const replay = await registerIdentity({
    sqlite, submission: submissionFor(relay2, id2, ch), challengeRecord: st.read(ch), now: Date.now(), ...wire(st),
  });
  assert.strictEqual(replay.ok, false, '同一挑战第二次仍能注册 = 一次性不成立');
  assert.strictEqual(replay.code, REG_REJECT.POP_FAILED, `期望 PoP 层 CHALLENGE_USED, 实际 ${replay.code}: ${replay.reason}`);
  assert.match(replay.reason, /CHALLENGE_USED/, `拒因应当是 CHALLENGE_USED, 实际: ${replay.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relay2).n, 0, '重放被拒但落了库');
});

await t('(D) 🔴 真【两连接】并发: 另一个连接抢先消费 ⇒ 事务内前置读必须拦住', async () => {
  // 🔴 这一格补的是 Codex c0a1f50c 对我上一版 (c-bis) 的批评:
  //    上一版是"顺序造 stale 记录 + 同连接跑", 只证明了前置读会触发,
  //    **没证明跨连接时它仍然拦得住**。这里用第二个【真连接】写, 才是那个断言。
  const relayId = insRelay({ mnemonic: 'enc-m-2conn' });
  const id = makeIdentity();
  const ch = 'ch-2conn';
  const st = chStore(); st.issue(ch);
  const staleRecord = st.read(ch);        // 请求 B 早先读到的(那时确实 unused)

  // 另一个连接(真·不同 handle)抢先把它用掉 —— 模拟并发的请求 A 已提交
  const attacker = new Database(dbPath);
  const info = attacker.prepare('UPDATE _test_challenge SET used_at = ? WHERE challenge = ? AND used_at IS NULL').run(Date.now(), ch);
  attacker.close();
  assert.strictEqual(info.changes, 1, '前置条件: 另一连接确实抢到了这次消费(否则本格什么也没测到)');

  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: staleRecord, now: Date.now(), ...wire(st),
  });
  assert.strictEqual(r.ok, false, '另一连接已用掉, 这边仍注册成功 = 跨连接一次性不成立');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_ALREADY_USED, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

sqlite.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-registration: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
