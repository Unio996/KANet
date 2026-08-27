// 注册入口用例 —— 判据 = spec v1.2-rc 的 **V7 / V17 / V18**(+ N8 在入口层仍然把关)。
//
// 🔴 跑**真 migration**(不抄 DDL)+ 真 `relay_nodes` 形状, 临时库, 不碰 live。
//    离线用例必须用真 schema, 否则约束/触发器那一层根本没被测到(在册教训)。
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'u1-reg-'));
process.env.DB_PATH = join(dir, 'probe.db');
// §10 C3: 生产入口从本地配置取 localNetwork(kanet.env KASPA_NETWORK=testnet-12); 离线用例显式钉同值, "未配置"那一格走 __testOnly 注入 null 单测。
process.env.KASPA_NETWORK = 'testnet-12';

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
const { S10_DOMAIN, S10_VERSION, s10SignedMessage } = await import('./u1-s10-identity.mjs');

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};

// ── 夹具: 造 relay_nodes 行(不同托管形态) + 一份身份 ─────────────────────────
// §10 C3: 每个 relay 行有自己的【地址钥】(与身份叶钥独立, 同协议形); relay_nodes.address = 该钥的 testnet-12 地址(真地址, 非占位串——
//         fromAddress 对占位串 throw), s10 默认由它签。⚠ relay_nodes.address 有 UNIQUE ⇒ 两行不能同地址(夹具第一版靠 UPDATE 绑身份钥, N3 当场撞 UNIQUE)。
const RELAY_KEY = new Map();   // relayId → { privHex, pubkey, address }
function makeRelayKey(network = 'testnet-12') {
  const priv = new PrivateKey(randomBytes(32).toString('hex'));
  return { privHex: priv.toString(), pubkey: priv.toPublicKey().toXOnlyPublicKey().toString(), address: priv.toPublicKey().toAddress(network).toString() };
}
function insRelay({ mnemonic = null, privkey = null, relayKey = makeRelayKey() }) {
  const id = randomUUID();
  // ⚠ `created_at` 是真 schema 里的 NOT NULL —— 第一版夹具漏了它, 七格当场红。
  //   这正是「离线用例必须跑真 migration」的价值: 抄一份简化 DDL 的话, 这里会绿, 而线上会炸。
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, privkey_encrypted, address, network, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 'testnet-12', datetime('now'), datetime('now'))`)
    .run(id, 'r-' + id.slice(0, 6), mnemonic, privkey, relayKey.address);
  RELAY_KEY.set(id, relayKey);
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
//
// 🔴 **v197 起: 本夹具【不再自带 DDL】 —— 那张表由上面的 `runMigrations()` 建, 即【生产迁移本身】。**
//    起因是我自己欠的一笔债: 生产把 `expires_at` 收紧成 NOT NULL, 而夹具那份没有
//    ⇒ 两者不再是同一张表, "用真 schema" 这句话就退化成了自我安慰。
//    ⇒ 现在**不存在"同步"这个动作**: 用例用的就是生产迁移建出来的表, 生产改什么它自动跟着改。
// 🔵 我第一版写的是"从 migrate.js 正则抽 DDL 原文再 exec" —— **那是多余的第二套弱机制**
//    (还得维护一个会被格式变化打断的正则)。**已有更强的那套就在上面: `runMigrations()`。**
//    判据: 加一层不如去掉一层 —— 能靠既有的强机制时, 别再造一个平行的弱机制。
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
// ── §10 C3 夹具: s10 默认由该 relay 行的地址钥签(RELAY_KEY); 攻击臂显式换 signer ──
//    🔴 既有各格【期望不改】: submissionFor 默认附上合法 s10 ⇒ 旧路径观察量不变(切片计划 C3 审点"三份夹具全补")。
const addrOf = (k) => new PrivateKey(k.privHex).toPublicKey().toAddress('testnet-12').toString();
function s10For(signer, challenge, over = {}) {
  const f = { domain: S10_DOMAIN, version: S10_VERSION, network: 'testnet-12', relayPubkeyXOnly: signer.pubkey, operation: 'register', epoch: challenge, ...over };
  return { ...f, signature: signMessage({ message: s10SignedMessage(f), privateKey: new PrivateKey(signer.privHex) }) };
}
function submissionFor(relayId, id, challenge, extra = {}, { s10Signer = RELAY_KEY.get(relayId) } = {}) {
  const payload = buildPopPayload({ rootFingerprint: rootFingerprint(id.rootXpub), identityIndex: 0, relayId, challenge });
  const signature = signMessage({ message: popMessageHashHex(payload), privateKey: new PrivateKey(id.privHex) });
  return { relayId, rootXpub: id.rootXpub, identityIndex: 0, identityPubkeyXOnly: id.pubkey, challenge, signature, s10: s10For(s10Signer, challenge), ...extra };
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

await t('(I-1) 🔴 (376) 模块导出面里【没有任何东西】能交出 read/consume 能力', async () => {
  // 🔴 Codex 80b34870 第九级: 上一版 getBoundOps 是 export 且交出 registration 正在用的那个可变 ops 对象。
  //    本格钉的不是"某个函数被删了", 而是**整个导出面上不存在能拿到能力的路径** ——
  //    否则下一个人换个名字重新导出一次, 洞就回来了, 而针对旧名字的测试仍然绿。
  const mod = await import('./u1-challenge-store.mjs');
  assert.strictEqual(typeof mod.getBoundOps, 'undefined', 'getBoundOps 不该还在(它交出的是可变 ops 对象)');
  const st = chStore(); st.issue('ch-leak-probe');
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== 'function' || name === 'createChallengeStore') continue;
    let out;
    try { out = fn(st.typed, sqlite, CANONICAL_CHALLENGE_TABLE, 'ch-leak-probe'); } catch { continue; }
    if (out && typeof out === 'object') {
      assert.strictEqual(typeof out.read, 'undefined', `导出 ${name} 交出了 read ⇒ 能力泄漏, (376) 没修好`);
      assert.strictEqual(typeof out.consume, 'undefined', `导出 ${name} 交出了 consume ⇒ 能力泄漏`);
      for (const v of Object.values(out)) {
        assert.notStrictEqual(typeof v, 'function', `导出 ${name} 的返回值里带函数 ⇒ 可能是伪装的能力泄漏`);
      }
    }
  }
});

await t('(I-2) 动词式导出: 绑定不符必抛, 且【消费真的落到规范表】(不是空转)', async () => {
  const { readBoundChallenge, consumeBoundChallenge } = await import('./u1-challenge-store.mjs');
  const st = chStore(); const ch = 'ch-verb'; st.issue(ch);

  // 绑定不符(表名不对)⇒ 两个动作都必须抛, 不是静默返回空
  assert.throws(() => readBoundChallenge(st.typed, sqlite, 'some_other_table', ch), /未绑定/, 'read 动作没验绑定');
  assert.throws(() => consumeBoundChallenge(st.typed, sqlite, 'some_other_table', ch), /未绑定/, 'consume 动作没验绑定');
  assert.strictEqual(st.read(ch)?.usedAt, null, '被拒的 consume 竟然动了表');

  // 正路: 读回的是纯数据(无函数), 消费真落库
  const rec = readBoundChallenge(st.typed, sqlite, CANONICAL_CHALLENGE_TABLE, ch);
  assert.ok(rec && rec.challenge === ch, '正路读不到记录');
  for (const v of Object.values(rec)) assert.notStrictEqual(typeof v, 'function', '读回的记录里不该有函数');
  consumeBoundChallenge(st.typed, sqlite, CANONICAL_CHALLENGE_TABLE, ch);
  assert.ok(st.read(ch)?.usedAt, 'consume 动作没有真的把它标成 used ⇒ 空转');
  // CAS: 第二次消费必抛(而不是静默成功)
  assert.throws(() => consumeBoundChallenge(st.typed, sqlite, CANONICAL_CHALLENGE_TABLE, ch), /不可消费/, '第二次消费没抛 ⇒ CAS 失守');
});

await t('(I-3) 工厂 fail-closed: 表不存在 ⇒ 必抛(不许造一个"每次都查空"的假 store)', () => {
  // 🔴 本格是 store 变异套抓出来的【真缺口】, 不是想到的:
  //    把工厂里 `if (!exists)` 拆掉后, 全套用例仍然全绿 —— 说明没有任何一格测过"表不存在"这条路。
  //    而它的后果很静: 造出来的 store 每次 read 都返回 null, 看起来像"挑战没签发", 排错会走到完全错的方向。
  assert.throws(
    () => createChallengeStore(sqlite, 'table_that_does_not_exist'),
    /不存在/,
    '表不存在却造出了 store ⇒ fail-closed 失守',
  );
  // 对照臂: 表存在时照常能造(证明上面那一抛不是把工厂整个弄坏了)
  assert.ok(createChallengeStore(sqlite, CANONICAL_CHALLENGE_TABLE), '规范表存在时应当能正常构造');
});

// ── ② deriveCustody TOCTOU: 事务内重派生(设计报告 §2 + §9-bis) ─────────────────
//
// 🔨 **怎么确定性地打中那个窗口**: 生产码里 `custodyPre` 在最前面派生, 事务在最后面开;
//    中间隔着 PoP 验签。`verifyMessageFn` 正好在这中间被调用 ⇒ 把变异写在它里面,
//    就落在【事务外已判 ok, 事务尚未开始】的那一刻, 且单线程可复现, 不靠竞态碰运气。
//    (同一钩子上面 :268 已用过, 这里沿用同一惯用法。)
//
// 🔴 每个阴性用例都先断言【变异之前 custodyPre 确实判 ok】—— 否则请求会在预筛就被拒,
//    用例仍然"红得好看"却**根本没走到事务内那次派生**, 变成一个测别的东西的空用例。

async function runWithMutation(mutate) {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-toctou-' + randomUUID().slice(0, 8);
  const st = chStore(); st.issue(ch);
  // 前提: 变异【之前】预筛必须是 ok, 否则本用例测不到事务内那次
  assert.strictEqual(deriveCustody(sqlite, relayId).ok, true, '前提不成立: 变异前预筛就已经拒了');
  let hookCalled = 0;
  const r = await __testOnlyRegisterIdentityWithInjections(
    { sqlite, submission: submissionFor(relayId, id, ch), ...wire(st) },
    { verifyMessageFn: (args) => { hookCalled += 1; mutate(relayId); return realVerifyMessage(args); } },
  );
  // 钩子没被调用 = 变异从未发生 ⇒ 后面的断言全部虚过, 必须显式挡掉
  assert.strictEqual(hookCalled, 1, '验签钩子没被调用 ⇒ 变异没发生, 本用例是空的');
  const row = sqlite.prepare('SELECT custody FROM u1_identity_registration WHERE relay_id = ?').get(relayId);
  return { r, row, ch, st, relayId };
}

await t('②-1 阳性对照 · 窗口内【不】变异 ⇒ 仍然注册成功(证明这套钩子本身不会把好路径弄红)', async () => {
  const { r, row, ch, st } = await runWithMutation(() => {});
  assert.strictEqual(r.ok, true, `阳性臂必须过, 实际: ${r.code} ${r.reason}`);
  assert.strictEqual(row?.custody, 'mnemonic');
  assert.ok(st.read(ch)?.usedAt, '成功路径挑战应已消费');
});

await t('②-2 🔴 窗口内改成混合态(补挂裸私钥) ⇒ 事务内重派生拒 CUSTODY_AMBIGUOUS, 整笔回滚', async () => {
  const { r, row, ch, st } = await runWithMutation((relayId) => {
    sqlite.prepare('UPDATE relay_nodes SET privkey_encrypted = ? WHERE id = ?').run('enc-privkey-blob', relayId);
  });
  assert.strictEqual(r.ok, false, '混合态必须拒');
  assert.strictEqual(r.code, REG_REJECT.CUSTODY_AMBIGUOUS, `拒因应为 CUSTODY_AMBIGUOUS, 实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(row, undefined, '🔴 拒了却有行落库 ⇒ 回滚失守(这正是 ② 之前会写进去的那个旧值)');
  assert.strictEqual(st.read(ch)?.usedAt, null, '整笔回滚 ⇒ 挑战不该被消费掉');
});

await t('②-3 🔴 窗口内清掉 mnemonic ⇒ 拒 CUSTODY_NOT_MNEMONIC, 整笔回滚', async () => {
  const { r, row, ch, st } = await runWithMutation((relayId) => {
    sqlite.prepare('UPDATE relay_nodes SET mnemonic_encrypted = NULL WHERE id = ?').run(relayId);
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, REG_REJECT.CUSTODY_NOT_MNEMONIC, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(row, undefined, '拒了却有行落库 ⇒ 回滚失守');
  assert.strictEqual(st.read(ch)?.usedAt, null, '整笔回滚 ⇒ 挑战不该被消费');
});

await t('②-4 🔴 窗口内整行删掉 ⇒ 拒 RELAY_UNKNOWN, 整笔回滚', async () => {
  const { r, row, ch, st } = await runWithMutation((relayId) => {
    sqlite.prepare('DELETE FROM relay_nodes WHERE id = ?').run(relayId);
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, REG_REJECT.RELAY_UNKNOWN, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(row, undefined, '拒了却有行落库 ⇒ 回滚失守');
  assert.strictEqual(st.read(ch)?.usedAt, null, '整笔回滚 ⇒ 挑战不该被消费');
});

await t('②-5 成功返回的 custody 来自【事务内实际写入的那个值】, 与落库行一致', async () => {
  const { r, row } = await runWithMutation(() => {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.custody, row.custody, '返回值与落库值不一致 ⇒ 返回的是事务外那次的旧结论');
});

await t('①-10c′ DB CHECK 兜底是【可达】的: custody 非 mnemonic 的插入必被约束拒 + 零写入', async () => {
  // 🔴 为什么这一格必须存在: ② 把“未来的保护”寄在了 v196 的 CHECK 上
  //    (② 删掉了那条死分支后, 它是 custody 取值的唯一兵器)。
  //    而【声称某个兜底存在】与【它真的会响】是两件事 —— 本仓已经吃过“闸建好了但没上膛”的亏。
  //    🔵 这里【不】给生产开测试后门来制造非法值(那正是 (364)/(366)/(368) 一路在堵的病),
  //       而是直接向真表发同一条 INSERT —— 被测对象就是约束本身。
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const before = sqlite.prepare('SELECT COUNT(*) c FROM u1_identity_registration').get().c;
  assert.throws(
    () => sqlite.prepare(`INSERT INTO u1_identity_registration
      (relay_id, root_fingerprint, root_xpub, identity_index, identity_pubkey_xonly, custody)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(relayId, rootFingerprint(id.rootXpub), id.rootXpub, 0, id.pubkey, 'privkey'),
    /CHECK constraint failed/,
    '🔴 custody=「privkey」 居然写进去了 ⇒ v196 的 CHECK 形同虚设, ② 所依赖的兜底不存在',
  );
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) c FROM u1_identity_registration').get().c, before,
    '约束拒了却有行落库');
  // 阳性对照: 合法值必须能写 —— 证明上面那一抛不是【这条 INSERT 本来就写不进去】
  sqlite.prepare(`INSERT INTO u1_identity_registration
    (relay_id, root_fingerprint, root_xpub, identity_index, identity_pubkey_xonly, custody)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(relayId, rootFingerprint(id.rootXpub), id.rootXpub, 0, id.pubkey, 'mnemonic');
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) c FROM u1_identity_registration').get().c, before + 1,
    '阳性对照没写进去 ⇒ 上面那一抛可能不是 CHECK 干的');
});

// ════════ §10 C3 臂 (D-013 §1; 切片计划 16ecff6d C3 列: R7/N4/N5/N11/E1/T1/U1/N12-反向 + N9 本地网络权威) ════════
const idRows = (pk) => sqlite.prepare('SELECT COUNT(*) n FROM u1_relay_identity WHERE relay_pubkey_xonly = ?').get(pk).n;
const a2Rows = (relayId) => sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration WHERE relay_id = ?').get(relayId).n;
const reg = (submission, st) => registerIdentity({ sqlite, submission, ...wire(st) });
const assertNothingWritten = (relayId, pk, st, ch) => {
  assert.strictEqual(a2Rows(relayId), 0, 'A2 表不得有行');
  assert.strictEqual(idRows(pk), 0, 'u1_relay_identity 不得有行');
  assert.strictEqual(st.read(ch)?.usedAt ?? null, null, '挑战不得被消费');
};

await t('S10-0 · 正向: relay-B 地址钥签 S10 ⇒ ok, u1_relay_identity 恰 1 行 = fromAddress(B.address), epoch=challenge, 返回 relayPubkeyXOnly', async () => {
  const B = insRelay({ mnemonic: 'enc-s10-pos' }); const idB = makeIdentity(); const ch = 'ch-s10-pos'; const KB = RELAY_KEY.get(B);
  const st = chStore(); st.issue(ch);
  const r = await reg(submissionFor(B, idB, ch), st);
  assert.strictEqual(r.ok, true, `${r.code}: ${r.reason}`);
  assert.strictEqual(r.relayPubkeyXOnly, KB.pubkey); assert.notStrictEqual(KB.pubkey, idB.pubkey, '夹具: relay 地址钥与身份叶钥应是两把钥');
  const row = sqlite.prepare('SELECT * FROM u1_relay_identity WHERE relay_pubkey_xonly = ?').get(KB.pubkey);
  assert.ok(row, '身份表无行'); assert.strictEqual(row.epoch, ch); assert.strictEqual(row.network, 'testnet-12'); assert.strictEqual(row.operation, 'register');
  const { XOnlyPublicKey, Address } = await import('kaspa-wasm');
  const addr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(B).address;
  assert.strictEqual(XOnlyPublicKey.fromAddress(new Address(addr)).toString(), row.relay_pubkey_xonly, '行 = 活算 fromAddress(B.address)');
  assert.ok(st.read(ch)?.usedAt, '挑战应被消费');
});

await t('R7 ⑦ 红臂 · 攻击者新钥 X + relayId=relay-B + 活挑战, PoP 与 s10 都由 X 合法签 ⇒ RELAY_NOT_OWNED, 零写入, 挑战未消费(对照: B 自钥 ⇒ ok)', async () => {
  const B = insRelay({ mnemonic: 'enc-s10-r7' }); const idB = makeIdentity(); const idX = makeIdentity(); const KB = RELAY_KEY.get(B);
  const ch = 'ch-s10-r7'; const st = chStore(); st.issue(ch);
  const r = await reg(submissionFor(B, idX, ch, {}, { s10Signer: idX }), st);   // X 的 PoP 合法, X 自签的 S10 合法, 但 X ≠ B 地址钥
  assert.strictEqual(r.ok, false, 'v1 前 scratch 自测这条是 PASS(抢注成立); §10 后必须拒');
  assert.strictEqual(r.code, REG_REJECT.RELAY_NOT_OWNED, `实际 ${r.code}: ${r.reason}`);
  assertNothingWritten(B, idX.pubkey, st, ch);
  const r2 = await reg(submissionFor(B, idB, ch), st);   // 对照: 同一活挑战, B 地址钥签
  assert.strictEqual(r2.ok, true, `对照臂应过: ${r2.code} ${r2.reason}`); assert.strictEqual(idRows(KB.pubkey), 1);
});

await t('N4 · 无 s10 ⇒ RELAY_NOT_OWNED(fail-closed 默认, 无旧路), 零写入', async () => {
  const B = insRelay({ mnemonic: 'enc-s10-n4' }); const idB = makeIdentity(); const ch = 'ch-s10-n4'; const st = chStore(); st.issue(ch);
  const sub = submissionFor(B, idB, ch); delete sub.s10;
  const r = await reg(sub, st);
  assert.strictEqual(r.code, REG_REJECT.RELAY_NOT_OWNED, `实际 ${r.code}: ${r.reason}`); assert.match(r.reason, /s10 缺失/);
  assertNothingWritten(B, RELAY_KEY.get(B).pubkey, st, ch);
  const r2 = await reg({ ...submissionFor(B, idB, ch), s10: 'not-an-object' }, st);   // 形状错 ⇒ 验证器 MALFORMED ⇒ S10_INVALID
  assert.strictEqual(r2.code, REG_REJECT.S10_INVALID, `实际 ${r2.code}: ${r2.reason}`); assert.match(r2.reason, /MALFORMED/);
});

await t('N5 · s10.relayPubkeyXOnly 声称 B 但由 X 签 ⇒ S10_INVALID(SIGNATURE_INVALID; 验签公钥取 payload 不取 DB)', async () => {
  const B = insRelay({ mnemonic: 'enc-s10-n5' }); const idB = makeIdentity(); const idX = makeIdentity(); const ch = 'ch-s10-n5'; const st = chStore(); st.issue(ch);
  const KB = RELAY_KEY.get(B);
  const sub = submissionFor(B, idB, ch, { s10: s10For(idX, ch, { relayPubkeyXOnly: KB.pubkey }) });
  const r = await reg(sub, st);
  assert.strictEqual(r.code, REG_REJECT.S10_INVALID, `实际 ${r.code}: ${r.reason}`); assert.match(r.reason, /SIGNATURE_INVALID/);
  assertNothingWritten(B, KB.pubkey, st, ch);
});

await t('N11 · legacy 中毒: relay_nodes.ecdsa_pubkey_xonly 填成 X 的钥, X 来抢 ⇒ 仍 RELAY_NOT_OWNED(权威只在地址活算, legacy 列不读)', async () => {
  const B = insRelay({ mnemonic: 'enc-s10-n11' }); const idX = makeIdentity();
  sqlite.prepare('UPDATE relay_nodes SET ecdsa_pubkey_xonly = ? WHERE id = ?').run(idX.pubkey, B);
  const ch = 'ch-s10-n11'; const st = chStore(); st.issue(ch);
  const r = await reg(submissionFor(B, idX, ch, {}, { s10Signer: idX }), st);
  assert.strictEqual(r.code, REG_REJECT.RELAY_NOT_OWNED, `实际 ${r.code}: ${r.reason}`);
  assertNothingWritten(B, idX.pubkey, st, ch);
});

await t('E1 · s10.epoch ≠ challenge(合法签名) ⇒ S10_INVALID, 零写入', async () => {
  const B = insRelay({ mnemonic: 'enc-s10-e1' }); const idB = makeIdentity(); const ch = 'ch-s10-e1'; const st = chStore(); st.issue(ch); const KB = RELAY_KEY.get(B);
  const r = await reg(submissionFor(B, idB, ch, { s10: s10For(KB, 'ch-s10-e1-other') }), st);
  assert.strictEqual(r.code, REG_REJECT.S10_INVALID, `实际 ${r.code}: ${r.reason}`); assert.match(r.reason, /epoch/);
  assertNothingWritten(B, KB.pubkey, st, ch);
});

await t('N9 · 本地网络权威: s10 合法签 network=mainnet 送 testnet-12 节点 ⇒ S10_INVALID(NETWORK_MISMATCH); 本地未配置(注入 null) ⇒ 同拒, 不回落 payload', async () => {
  const B = insRelay({ mnemonic: 'enc-s10-n9' }); const idB = makeIdentity(); const ch = 'ch-s10-n9'; const st = chStore(); st.issue(ch); const KB = RELAY_KEY.get(B);
  const r = await reg(submissionFor(B, idB, ch, { s10: s10For(KB, ch, { network: 'mainnet' }) }), st);
  assert.strictEqual(r.code, REG_REJECT.S10_INVALID, `实际 ${r.code}: ${r.reason}`); assert.match(r.reason, /NETWORK_MISMATCH/);
  const r2 = await __testOnlyRegisterIdentityWithInjections({ sqlite, submission: submissionFor(B, idB, ch), ...wire(st) }, { localNetwork: null });
  assert.strictEqual(r2.code, REG_REJECT.S10_INVALID, `未配置本地网络竟 ${r2.code}: ${r2.reason}`); assert.match(r2.reason, /NETWORK_MISMATCH/);
  assertNothingWritten(B, KB.pubkey, st, ch);
});

await t('N12-反向 · 合法 S10 签名当 A2 PoP 的 signature 提交 ⇒ POP_FAILED(两域消息空间不相交; NWT C3 审时闸)', async () => {
  const B = insRelay({ mnemonic: 'enc-s10-n12' }); const idB = makeIdentity(); const ch = 'ch-s10-n12'; const st = chStore(); st.issue(ch);
  const sub = submissionFor(B, idB, ch);   // s10 由 relay 钥签(合法, 预筛过) —— 只把 A2 位换成【身份叶钥对 S10 域消息】的合法签名
  const { signature: _drop, ...s10Fields } = sub.s10;
  sub.signature = signMessage({ message: s10SignedMessage(s10Fields), privateKey: new PrivateKey(idB.privHex) });   // S10 消息(KANET-U1-IDENTITY-v1|…)当 A2 PoP 签名
  const r = await reg(sub, st);
  assert.strictEqual(r.code, REG_REJECT.POP_FAILED, `实际 ${r.code}: ${r.reason}`); assert.match(r.reason, /SIGNATURE_INVALID/);
  assert.strictEqual(a2Rows(B), 0); assert.strictEqual(st.read(ch)?.usedAt ?? null, null);
});

await t('T1 · 预筛后事务前换 relay_nodes.address(PoP verifyMessageFn 钩子窗口) ⇒ 事务内重做绑定拒 RELAY_NOT_OWNED, 整笔回滚(A2 0 行/身份表 0 行/挑战未消费); 阴性对照: 同钩子不换地址 ⇒ ok', async () => {
  const B = insRelay({ mnemonic: 'enc-s10-t1' }); const idB = makeIdentity(); const idX = makeIdentity(); const ch = 'ch-s10-t1'; const st = chStore(); st.issue(ch); const KB = RELAY_KEY.get(B);
  let fired = 0;
  const swapHook = async (a) => { fired++; sqlite.prepare('UPDATE relay_nodes SET address = ? WHERE id = ?').run(addrOf(idX), B); return realVerifyMessage(a); };
  const r = await __testOnlyRegisterIdentityWithInjections({ sqlite, submission: submissionFor(B, idB, ch), ...wire(st) }, { verifyMessageFn: swapHook });
  assert.strictEqual(fired, 1, '钩子应恰被 PoP 调一次(S10 验签不走注入钩子)');
  assert.strictEqual(r.code, REG_REJECT.RELAY_NOT_OWNED, `实际 ${r.code}: ${r.reason}`); assert.match(r.reason, /事务内重做/);
  assertNothingWritten(B, KB.pubkey, st, ch);
  sqlite.prepare('UPDATE relay_nodes SET address = ? WHERE id = ?').run(KB.address, B);   // 复位地址
  const passHook = async (a) => realVerifyMessage(a);
  const r2 = await __testOnlyRegisterIdentityWithInjections({ sqlite, submission: submissionFor(B, idB, ch), ...wire(st) }, { verifyMessageFn: passHook });
  assert.strictEqual(r2.ok, true, `阴性对照应过: ${r2.code} ${r2.reason}`);
});

await t('U1 · 同 relay 钥 K 二次注册(不同 A2 根、不同挑战) ⇒ 第二次 CONSTRAINT(v198 PK)整笔回滚: A2 行 0, 身份表仍 1 行, 挑战未消费', async () => {
  // ⚠ 经入口到达 v198 PK 须先穿过 relay_nodes.address UNIQUE 与 A2 relay_id PK: 第二行用同钥的【mainnet 前缀地址】(字符串不同、x-only 相同)。
  //    这是为到达 v198 PK 的构造, 不是真实部署形(testnet 行挂 mainnet 地址); v198 PK 的直测在 ④-2。
  const K = makeRelayKey('testnet-12'); const Kmain = { ...K, address: new PrivateKey(K.privHex).toPublicKey().toAddress('mainnet').toString() };
  const r1 = insRelay({ mnemonic: 'enc-s10-u1-a', relayKey: K }); const r2 = insRelay({ mnemonic: 'enc-s10-u1-b', relayKey: Kmain });
  const id1 = makeIdentity(); const id2 = makeIdentity();
  const c1 = 'ch-s10-u1-a'; const c2 = 'ch-s10-u1-b'; const st = chStore(); st.issue(c1); st.issue(c2);
  const a = await reg(submissionFor(r1, id1, c1), st);
  assert.strictEqual(a.ok, true, `${a.code}: ${a.reason}`); assert.strictEqual(a.relayPubkeyXOnly, K.pubkey);
  const b = await reg(submissionFor(r2, id2, c2), st);
  assert.strictEqual(b.code, REG_REJECT.CONSTRAINT, `实际 ${b.code}: ${b.reason}`); assert.match(b.reason, /u1_relay_identity/);
  assert.strictEqual(a2Rows(r2), 0, '第二次的 A2 行必须随整笔回滚'); assert.strictEqual(idRows(K.pubkey), 1);
  assert.strictEqual(st.read(c2)?.usedAt ?? null, null, '第二次挑战不得被消费');
});

sqlite.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-registration: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
