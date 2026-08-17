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
// 钩子用: 与 pop 模块默认路径同一个 verifyMessage(u1-registration-pop.mjs:123-125), 不自造验签
const { verifyMessage } = await import('kaspa-wasm');
const realVerifyMessage = (args) => verifyMessage(args);
const { deriveIdentityPubkey, rootFingerprint } = await import('./u1-same-origin.mjs');
const { buildPopPayload, popMessageHashHex } = await import('./u1-registration-pop.mjs');
const { registerIdentity, deriveCustody, REG_REJECT, __testOnlyRegisterIdentityWithInjections } = await import('./u1-registration.mjs');
const { createChallengeStore, CANONICAL_CHALLENGE_TABLE, isStoreBoundTo } = await import('./u1-challenge-store.mjs');

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
sqlite.exec(`CREATE TABLE IF NOT EXISTS u1_identity_challenge (
  challenge TEXT PRIMARY KEY, used_at INTEGER, expires_at INTEGER)`);
function chStore() {
  const st = createChallengeStore(sqlite, 'u1_identity_challenge');
  return {
    issue(c){ sqlite.prepare('INSERT OR REPLACE INTO u1_identity_challenge (challenge, used_at, expires_at) VALUES (?, NULL, ?)').run(c, Date.now()+60000); return this.read(c); },
    // 🔴 (374) 之后 token 上没有方法了; 夹具自己走 SQL 读写那张表(它本来就是测试夹具, 不是权威)
    read:(c)=>{const r=sqlite.prepare('SELECT challenge, used_at, expires_at FROM u1_identity_challenge WHERE challenge = ?').get(c); return r?{challenge:r.challenge,usedAt:r.used_at,expiresAt:r.expires_at}:null;},
    consume:(c)=>{const i=sqlite.prepare('UPDATE u1_identity_challenge SET used_at = ? WHERE challenge = ? AND used_at IS NULL').run(Date.now(), c); if(i.changes!==1) throw new Error('夹具消费失败');},
    typed: st,
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
    ...wire(st),
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
  const r = await registerIdentity({ sqlite, submission: submissionFor(relayId, id, ch) });
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
  const r = await registerIdentity({ sqlite, submission: sub });
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
    ...wire(stV18),
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
  const stNone = chStore();   // 有 store, 但【不 issue】这条挑战 ⇒ store 现读为 null
  const r = await registerIdentity({ sqlite, submission: submissionFor(relayId, id, 'ch-none'), ...wire(stNone) });
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
  const a = await registerIdentity({ sqlite, submission: submissionFor(r1, id, 'ch-n3-a'), ...wire(stN3) });
  assert.strictEqual(a.ok, true, `第一条应当成功: ${a.code} ${a.reason}`);
  const b = await registerIdentity({ sqlite, submission: submissionFor(r2, id, 'ch-n3-b'), ...wire(stN3) });
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
    sqlite, submission: submissionFor(relayId, id, ch),
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
    sqlite, submission: submissionFor(relayId, id, ch),
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
  const otherStore = createChallengeStore(other, 'u1_identity_challenge');
  // ⚠ 注意它是 createChallengeStore 造的【真】store, 行为无可挑剔 —— 唯一的问题是 handle 不同。
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch),
    challengeStore: otherStore,
  });
  other.close();
  assert.strictEqual(r.ok, false, '🔴 别的连接造的 store 过了 ⇒ 我持的锁管不到它, 原子性是假的');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_STORE_UNBOUND, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(B) 挑战未签发(store 里没有)⇒ 在 PoP 层就拒, 零落库', async () => {
  // 🔵 (359) 之后本格语义**前移**了: 以前调用方能递一个伪造 record 混过 PoP, 现在 record 只从 store 现读,
  //    没签发 = 读出 null ⇒ PoP 直接 CHALLENGE_UNKNOWN。**拒得更早不是退化, 是 authority 收回来的直接结果。**
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-not-issued';
  const st = chStore();          // 故意【不】 issue
  const r = await registerIdentity({ sqlite, submission: submissionFor(relayId, id, ch), ...wire(st) });
  assert.strictEqual(r.ok, false, '未签发的挑战竟然过了');
  assert.strictEqual(r.code, REG_REJECT.POP_FAILED, `实际 ${r.code}: ${r.reason}`);
  assert.match(r.reason, /CHALLENGE_UNKNOWN/, `拒因应为 CHALLENGE_UNKNOWN, 实际 ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(D) 🔴 真竞态: 另一连接在【PoP 读之后、事务之前】抢先消费 ⇒ 事务内前置读必须拦住', async () => {
  // 🔴 (359) 之后, 上一版 (D) 的构造(先让攻击者消费, 再注册)已经在 PoP 层就被拦下 —— 那证明不了事务内前置读。
  //    要真正打到前置读, 攻击必须发生在【store 读之后、事务之前】那个窗口里。
  //    🔨 用 verifyMessageFn 当钩子: 它由 PoP 在读完 record 之后调用, 正好落在那个窗口内, 且单线程可确定复现。
  const relayId = insRelay({ mnemonic: 'enc-m-race' });
  const id = makeIdentity();
  const ch = 'ch-race';
  const st = chStore(); st.issue(ch);

  let raced = false;
  const r = await __testOnlyRegisterIdentityWithInjections(
    { sqlite, submission: submissionFor(relayId, id, ch), ...wire(st) },
    { verifyMessageFn: (args) => {
      if (!raced) {   // 只抢一次
        raced = true;
        const attacker = new Database(dbPath);   // 真·另一个连接
        const info = attacker.prepare('UPDATE u1_identity_challenge SET used_at = ? WHERE challenge = ? AND used_at IS NULL').run(Date.now(), ch);
        attacker.close();
        assert.strictEqual(info.changes, 1, '前置条件: 攻击连接确实抢到了这次消费(否则本格什么也没测到)');
      }
      return realVerifyMessage(args);   // 签名照常验通过, 否则会在 PoP 而不是事务里红
    },
  });
  assert.ok(raced, '钩子没被调用 ⇒ 本格没测到那个窗口, 判据失效');
  assert.strictEqual(r.ok, false, '窗口内被抢走还注册成功 = 跨连接一次性不成立');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_ALREADY_USED, `必须由【事务内前置读】拦下, 实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(E-1) 🔴 (359) store 里挑战【已过期未用】⇒ 确定性拒 + 零 insert', async () => {
  const relayId = insRelay({ mnemonic: 'enc-m-exp' });
  const id = makeIdentity();
  const ch = 'ch-expired';
  const st = chStore(); st.issue(ch);
  // 把 store 里那条改成已过期(未用)
  sqlite.prepare('UPDATE u1_identity_challenge SET expires_at = ? WHERE challenge = ?').run(Date.now() - 60_000, ch);
  const r = await registerIdentity({ sqlite, submission: submissionFor(relayId, id, ch), ...wire(st) });
  assert.strictEqual(r.ok, false, '过期挑战竟然还能注册');
  assert.strictEqual(r.code, REG_REJECT.POP_FAILED, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
  assert.strictEqual(st.read(ch)?.usedAt, null, '拒的路径不该消费掉挑战');
});

await t('(E-2) 🔴 (359) 调用方【试图】塞一个未过期的伪造 record ⇒ 参数已删, store 说过期就是过期', async () => {
  // 🔴 这一格是 (359) 的核心断言: 以前调用方递什么 PoP 就信什么。现在这个参数**不存在** ——
  //    我照旧把它塞进去(模拟一个还按老 API 写的调用方 / 一个恶意调用方), 结果必须与 (E-1) 完全一致。
  const relayId = insRelay({ mnemonic: 'enc-m-forge' });
  const id = makeIdentity();
  const ch = 'ch-forged';
  const st = chStore(); st.issue(ch);
  sqlite.prepare('UPDATE u1_identity_challenge SET expires_at = ? WHERE challenge = ?').run(Date.now() - 60_000, ch);
  const forged = { challenge: ch, usedAt: null, expiresAt: Date.now() + 3_600_000 };   // ← 伪造: 声称还有一小时
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), ...wire(st),
    challengeRecord: forged,   // ← 老 API 的参数; 现在应当被【完全忽略】
  });
  assert.strictEqual(r.ok, false, '🔴 伪造的未过期 record 骗过了 PoP ⇒ 签发/过期 authority 还在调用方手上, (359) 没修好');
  assert.strictEqual(r.code, REG_REJECT.POP_FAILED, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(E-3) 🔴 (359) 过期发生在【PoP 之后、事务之前】⇒ 事务内那道 expiry 重检必须拦住', async () => {
  // 🔵 这一格钉的是"事务内除 usedAt 外还查 expiresAt"那条 —— 没有它, 记录在两次读之间被改过期就没人管。
  const relayId = insRelay({ mnemonic: 'enc-m-exp-race' });
  const id = makeIdentity();
  const ch = 'ch-exp-race';
  const st = chStore(); st.issue(ch);

  let raced = false;
  const r = await __testOnlyRegisterIdentityWithInjections(
    { sqlite, submission: submissionFor(relayId, id, ch), ...wire(st) },
    { verifyMessageFn: (args) => {
      if (!raced) {
        raced = true;
        const other = new Database(dbPath);
        other.prepare('UPDATE u1_identity_challenge SET expires_at = ? WHERE challenge = ?').run(Date.now() - 1000, ch);
        other.close();
      }
      return realVerifyMessage(args);
    } },
  );
  assert.ok(raced, '钩子没被调用 ⇒ 本格没测到那个窗口');
  assert.strictEqual(r.ok, false, '窗口内被改成过期仍注册成功 ⇒ 事务内 expiry 重检没在守');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_EXPIRED, `必须由事务内 expiry 重检拦下, 实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(C) 成功边界【之后】拿同一挑战重放 ⇒ 必拒(一次性的全部含义)', async () => {
  const id1 = makeIdentity(); const id2 = makeIdentity();
  const relay1 = insRelay({ mnemonic: 'enc-m-replay-1' });
  const relay2 = insRelay({ mnemonic: 'enc-m-replay-2' });
  const ch = 'ch-replay';
  const st = chStore(); st.issue(ch);

  const first = await registerIdentity({
    sqlite, submission: submissionFor(relay1, id1, ch), ...wire(st),
  });
  assert.strictEqual(first.ok, true, `第一次必须成功, 实际 ${first.code}: ${first.reason}`);
  assert.ok(st.read(ch)?.usedAt, '成功后存储里必须真的是 used');

  // 🔵 重放时挑战记录【从存储现读】—— 不是重新造一个 usedAt:null 的假记录,
  //    否则测的是"我喂了个 used 记录它会不会拒"(谓词), 而不是"上一次成功有没有真的把它用掉"(调用点)。
  const replay = await registerIdentity({
    sqlite, submission: submissionFor(relay2, id2, ch), ...wire(st),
  });
  assert.strictEqual(replay.ok, false, '同一挑战第二次仍能注册 = 一次性不成立');
  assert.strictEqual(replay.code, REG_REJECT.POP_FAILED, `期望 PoP 层 CHALLENGE_USED, 实际 ${replay.code}: ${replay.reason}`);
  assert.match(replay.reason, /CHALLENGE_USED/, `拒因应当是 CHALLENGE_USED, 实际: ${replay.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relay2).n, 0, '重放被拒但落了库');
});

await t('(F-1) 🔴 (364) 时钟不再由调用方给: 塞一个伪造的 now 也左右不了过期判定', async () => {
  // 🔴 这一格是 (364) 的核心断言 —— 与 (E-2) 同款手法, 只是换成时间维度:
  //    照老 API 硬塞一个远在过去的 `now`(想让"未过期"成立), 现在这个参数根本不存在 ⇒ 结果必须与不塞时一致。
  const relayId = insRelay({ mnemonic: 'enc-m-clock' });
  const id = makeIdentity();
  const ch = 'ch-forged-now';
  const st = chStore(); st.issue(ch);
  sqlite.prepare('UPDATE u1_identity_challenge SET expires_at = ? WHERE challenge = ?').run(Date.now() - 60_000, ch);
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), ...wire(st),
    now: Date.now() - 3_600_000,   // ← 老 API 的参数, 声称"一小时前", 那样这条挑战就还没过期
  });
  assert.strictEqual(r.ok, false, '🔴 伪造的 now 让过期挑战通过了 ⇒ 时钟 authority 还在调用方手上, (364) 没修好');
  assert.strictEqual(r.code, REG_REJECT.POP_FAILED, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(F-2) 🔴 (364) 时钟在事务内【重取】: 真实时间在请求内跨过 expiresAt 也拦得住', async () => {
  // 🔵 这一格闭掉的是我 (359) 稿里自己写下的那条残留:
  //    "事务内用同一个 now ⇒ 挡不住真实时间在本次请求内跨过 expiresAt"。
  //    把 now 换成内部时钟(函数)之后, 事务内可以重取, 而注入的时钟让它仍然确定 —— 残留因此消失。
  //    🔨 教训: 当时挡路的不是"重取"本身, 是我那个**收标量 now 的参数形状**。换形状, 限制就没了。
  const relayId = insRelay({ mnemonic: 'enc-m-clock-adv' });
  const id = makeIdentity();
  const ch = 'ch-clock-adv';
  const st = chStore();
  const base = Date.now();
  st.issue(ch);
  sqlite.prepare('UPDATE u1_identity_challenge SET expires_at = ? WHERE challenge = ?').run(base + 5_000, ch);   // 5 秒后过期

  let calls = 0;
  const r = await __testOnlyRegisterIdentityWithInjections(
    { sqlite, submission: submissionFor(relayId, id, ch), ...wire(st) },
    // 第 1 次(PoP 前)= 还没过期; 第 2 次(事务内)= 已经跨过 expiresAt
    { clock: () => { calls += 1; return calls === 1 ? base : base + 10_000; } },
  );
  assert.ok(calls >= 2, `时钟必须被取【两次】(PoP 前 + 事务内), 实际 ${calls} 次 ⇒ 事务内没重取, 本格判据失效`);
  assert.strictEqual(r.ok, false, '时间在请求内跨过 expiresAt 仍注册成功 ⇒ 事务内没重取时钟');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_EXPIRED, `必须由事务内 expiry 重检拦下, 实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
  assert.strictEqual(st.read(ch)?.usedAt, null, '拒的路径不该消费掉挑战');
});

await t('(F-3) 🔴 (366) 生产入口塞时钟【无效】: 这一格是 A-2 在时间维度上的对应物', async () => {
  // 🔴 @KANet-UI 点名的空缺: challengeStore 有 (A-2)「伪造的假 store 必须被拒」,
  //    而时钟这边**当时没有对应的一格** —— 所以 (364) 的  是纯命名约定, 没人测过它挡不挡。
  //    (366) 把逃逸口搬出生产签名之后, 这一格才有意义: 塞进去的字段【根本不会被读】。
  const relayId = insRelay({ mnemonic: 'enc-m-clock-esc' });
  const id = makeIdentity();
  const ch = 'ch-clock-escape';
  const st = chStore(); st.issue(ch);
  sqlite.prepare('UPDATE u1_identity_challenge SET expires_at = ? WHERE challenge = ?').run(Date.now() - 60_000, ch);
  let called = 0;
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), ...wire(st),
    // ← 模拟一个把 req.body 展开进来的粗心 handler / 故意构造这种输入的攻击者
    __testOnlyClock: () => { called += 1; return 0; },   // 想让永远没过期成立
  });
  assert.strictEqual(called, 0, '🔴 生产入口竟然调用了调用方给的时钟 ⇒ (364) 的洞换个名字又开着');
  assert.strictEqual(r.ok, false, '🔴 塞进来的时钟让过期挑战通过了');
  assert.strictEqual(r.code, REG_REJECT.POP_FAILED, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(F-4) 🔴 (368) 生产入口塞 verifier 【无效】: 伪造签名 + always-true 验证器仍须被拒', async () => {
  // 🔴 Codex bcc8dd28 抓的第六级, 与 (F-3) 同款手法换成验签维度:
  //    抄来的 root/xpub + 正确派生的 pubkey + 一个恒真的 verifyMessageFn ⇒ 若生产入口读它, N8 整层就没了。
  //    (368) 之后该参数【不在生产签名里】, 所以这一格断言的是: 它一次都没被调用。
  const relayId = insRelay({ mnemonic: 'enc-m-verifier' });
  const id = makeIdentity();
  const ch = 'ch-fake-verifier';
  const st = chStore(); st.issue(ch);
  // 签名故意做坏: 用另一个身份的私钥签, 真验签必拒
  const other = makeIdentity();
  const bad = submissionFor(relayId, other, ch);
  bad.rootXpub = id.rootXpub; bad.identityPubkeyXOnly = id.pubkey;   // root/pubkey 抄成受害者的
  let called = 0;
  const r = await registerIdentity({
    sqlite, submission: bad, ...wire(st),
    verifyMessageFn: () => { called += 1; return true; },   // ← 恒真验证器
  });
  assert.strictEqual(called, 0, '🔴 生产入口竟然调用了调用方给的验证器 ⇒ N8 可被一个字段关掉');
  assert.strictEqual(r.ok, false, '🔴 恒真验证器让伪造签名过了');
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
  assert.strictEqual(st.read(ch)?.usedAt, null, '拒的路径不该消费挑战');
});

await t('(G-1) 🔴 (370) 同一 handle、但 store 指向【调用方自己那张表】⇒ 必须被拒', async () => {
  // 🔴 Codex e008bbbc 第七级: 上一版绑定只记 handle, 不记表身份。
  //    持合法 handle 的调用方可以自建一张表, 塞一条【永不过期、永远 unused】的挑战, 造 store 指过去 ——
  //    handle 相同 ⇒ 旧的绑定检查照过 ⇒ 一次性与过期两道全部形同虚设。
  //    ⇒ 这一格就是那个攻击的直接复现。
  const relayId = insRelay({ mnemonic: 'enc-m-rogue-table' });
  const id = makeIdentity();
  const ch = 'ch-rogue-table';

  // 攻击者自建的表(同一个 handle, 完全合法的 SQLite 表)
  sqlite.exec('CREATE TABLE IF NOT EXISTS _rogue_challenge (challenge TEXT PRIMARY KEY, used_at INTEGER, expires_at INTEGER)');
  sqlite.prepare('INSERT OR REPLACE INTO _rogue_challenge (challenge, used_at, expires_at) VALUES (?, NULL, ?)')
    .run(ch, Date.now() + 10 * 365 * 24 * 3600 * 1000);   // 十年后过期 = 实质永不过期
  const rogue = createChallengeStore(sqlite, '_rogue_challenge');   // ← 真 store, 真工厂, 只是表不对

  const r = await registerIdentity({ sqlite, submission: submissionFor(relayId, id, ch), challengeStore: rogue });
  assert.strictEqual(r.ok, false, '🔴 指向调用方自建表的 store 过了 ⇒ 一次性/过期两道都被绕开, (370) 没修好');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_STORE_UNBOUND, `实际 ${r.code}: ${r.reason}`);
  assert.match(r.reason, /u1_identity_challenge/, '拒因里应指明规范表名, 便于排错');
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
  assert.strictEqual(sqlite.prepare('SELECT used_at FROM _rogue_challenge WHERE challenge = ?').get(ch).used_at, null,
    '拒的路径不该动那张表(证明它连读都没被当权威)');
});

await t('(G-2) 绑定两维缺一不可: 规范表 + 另一个 handle ⇒ 仍拒(表对了也不够)', async () => {
  // 🔵 与 (A-3) 互补: (A-3) 是"表对、handle 错"在旧版就该拒; 本格确认 (370) 加了表维之后**没有把 handle 维弄丢**。
  const relayId = insRelay({ mnemonic: 'enc-m-two-dim' });
  const id = makeIdentity();
  const ch = 'ch-two-dim';
  const st = chStore(); st.issue(ch);
  const other = new Database(dbPath);
  const otherStore = createChallengeStore(other, CANONICAL_CHALLENGE_TABLE);   // 表对, handle 不对
  const r = await registerIdentity({ sqlite, submission: submissionFor(relayId, id, ch), challengeStore: otherStore });
  other.close();
  assert.strictEqual(r.ok, false, '表名对了就放行 ⇒ handle 维被 (370) 改丢了');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_STORE_UNBOUND, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(G-3) 🔴 (372) 两参调用 isStoreBoundTo ⇒ 必须 throw, 不许静默退回只验 handle', () => {
  // 🔴 上一版 expectedTable 是可选的: 少传一个就静默只验 handle ⇒ (370) 那个洞原样回来, 且没有东西会喊。
  //    本格钉的就是「少传一个」这件事本身 —— 不是测判定结果对不对, 是测**这种调用形状根本不被允许**。
  //    🔨 它与 F-3/F-4 同一手法: 断言"那条路走不通", 而不是"走通了但结果恰好对"。
  const st = chStore();
  assert.throws(
    () => isStoreBoundTo(st.typed, sqlite),          // ← 只传两参
    /expectedTable 必填/,
    '两参调用没抛 ⇒ 少传一个仍会静默降级, (372) 没修好',
  );
  // 正向对照: 三参且都对 ⇒ true(证明 throw 没把正常路径一起弄坏)
  assert.strictEqual(isStoreBoundTo(st.typed, sqlite, CANONICAL_CHALLENGE_TABLE), true, '三参正常路径被误伤');
  // 反向对照: 三参但表不对 ⇒ false(而不是 throw) —— 真实不匹配仍走布尔语义
  assert.strictEqual(isStoreBoundTo(st.typed, sqlite, 'some_other_table'), false, '表不匹配应返回 false 而非抛');
});

await t('(H-1) 🔴 (374) 拿【真绑定】的 store 去换它的方法 ⇒ 无效(绑对象身份≠绑对象行为)', async () => {
  // 🔴 Codex 3ae9e7eb 第八级的直接复现:
  //    上一版 read/consume 挂在返回给调用方的对象上, 而 WeakMap 只绑对象身份 ⇒
  //    攻击者拿一个【真的】绑定 store, 把 read 换成"返回我挑的新鲜挑战"、consume 换成 no-op,
  //    再传回来 —— 绑定检查照过, 一次性与过期的权威被整个换掉。
  const relayId = insRelay({ mnemonic: 'enc-m-swap' });
  const id = makeIdentity();
  const ch = 'ch-swap';
  const st = chStore();
  // 注意: **故意不 issue** —— 真表里没有这条挑战。若攻击成功, 假 read 会让它"看起来存在且新鲜"。
  let fakeRead = 0; let fakeConsume = 0;
  try {
    st.typed.read = (c) => { fakeRead += 1; return { challenge: c, usedAt: null, expiresAt: Date.now() + 3_600_000 }; };
    st.typed.consume = () => { fakeConsume += 1; };
  } catch (e) { /* 冻结对象在 strict mode 下会抛 —— 这本身就是防线之一, 不影响下面的断言 */ }

  const r = await registerIdentity({ sqlite, submission: submissionFor(relayId, id, ch), challengeStore: st.typed });
  assert.strictEqual(fakeRead, 0, '🔴 我换上去的 read 被调用了 ⇒ 权威仍挂在调用方能改的对象上, (374) 没修好');
  assert.strictEqual(fakeConsume, 0, '🔴 我换上去的 consume 被调用了');
  assert.strictEqual(r.ok, false, '🔴 换掉方法后注册成功 ⇒ 一次性/过期两道权威被调用方接管');
  assert.strictEqual(r.code, REG_REJECT.POP_FAILED, `应当因真表里没这条挑战而在 PoP 层拒, 实际 ${r.code}: ${r.reason}`);
  assert.match(r.reason, /CHALLENGE_UNKNOWN/, `拒因应为 CHALLENGE_UNKNOWN(证明读的是真表不是假 read), 实际 ${r.reason}`);
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n, 0, '拒了却落了库');
});

await t('(H-2) token 上本来就没有 authority 方法(不是"改了会被发现", 是"没东西可改")', () => {
  // 🔵 与 H-1 互补: H-1 证"换了也没用", 本格证**那里本来就是空的** —— 这才是 (374) 的实际形状。
  const st = chStore();
  assert.strictEqual(typeof st.typed.read, 'undefined', 'token 上不该有 read —— 权威实现必须只活在模块私有 WeakMap 里');
  assert.strictEqual(typeof st.typed.consume, 'undefined', 'token 上不该有 consume');
  assert.ok(Object.isFrozen(st.typed), 'token 应当是冻结的(弱兜底, 非承重)');
});

sqlite.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-registration: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
