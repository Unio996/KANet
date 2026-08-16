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

// ── (343) 挑战存储夹具 ───────────────────────────────────────────────────────
// 🔴 **故意用真 SQLite 表, 不用进程内 Map**: 契约的要害是"消费与落库同事务、要么都成要么都不成"。
//    Map 不参与 better-sqlite3 事务 ⇒ 回滚时 Map 里的 usedAt 还留着, **原子性那一格会假绿**。
//    (在册: 离线用例必须用真 schema, 否则约束/事务那一层根本没被测到。)
sqlite.exec(`CREATE TABLE IF NOT EXISTS _test_challenge (
  challenge TEXT PRIMARY KEY, used_at INTEGER, expires_at INTEGER)`);
function chStore() {
  return {
    issue(c) {
      sqlite.prepare('INSERT OR REPLACE INTO _test_challenge (challenge, used_at, expires_at) VALUES (?, NULL, ?)')
        .run(c, Date.now() + 60_000);
      return this.read(c);
    },
    read(c) {
      const r = sqlite.prepare('SELECT challenge, used_at, expires_at FROM _test_challenge WHERE challenge = ?').get(c);
      return r ? { challenge: r.challenge, usedAt: r.used_at, expiresAt: r.expires_at } : null;
    },
    consume(c) {
      const info = sqlite.prepare('UPDATE _test_challenge SET used_at = ? WHERE challenge = ? AND used_at IS NULL').run(Date.now(), c);
      if (info.changes !== 1) throw new Error(`挑战不可消费(不存在或已用): ${c}`);
    },
  };
}
// 成功路径的标准接线: 消费与重读都走上面那张真表
const wire = (st) => ({ consumeChallenge: (c) => st.consume(c), readChallenge: (c) => st.read(c) });
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

// ── (343) MUST-FIX: 一次性挑战消费契约 · @Bettor 点名三格 ────────────────────
// 判据来源: Codex a89919a0 抓出 consumeChallenge optional + non-atomic ⇒ 注册可重放。
// 🔴 这三格测的都是【调用点】, 不是谓词 —— 本次被抓的形状正是"谓词对, 但没有东西让它的前提成立"。

await t('(a) 省略消费能力 ⇒ 必须 fail-closed 拒, 且【一个字节都不落库】(不许静默成功)', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-omit';
  const st = chStore(); st.issue(ch);
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch), now: Date.now(),
    // ← 故意两个都不传
  });
  assert.strictEqual(r.ok, false, '不传消费能力竟然注册成功 = 一次性闸退化成可重放(本次 MUST-FIX 的原病)');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_CONSUME_MISSING, `期望 CHALLENGE_CONSUME_MISSING, 实际 ${r.code}: ${r.reason}`);
  const row = sqlite.prepare('SELECT 1 FROM u1_identity_registration WHERE relay_id = ?').get(relayId);
  assert.strictEqual(row, undefined, '拒了却落了库 = 拒得比不拒还糟');
  assert.strictEqual(st.read(ch)?.usedAt, null, '拒的路径不该动挑战状态');
});

await t('(a-bis) 只给 consumeChallenge 不给 readChallenge ⇒ 同样拒(没有重读就分不出空消费)', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-halfwire';
  const st = chStore(); st.issue(ch);
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch), now: Date.now(),
    consumeChallenge: (c) => st.consume(c),   // ← 只给一半
  });
  assert.strictEqual(r.ok, false, '半套接线就放行 = 后置条件形同虚设');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_CONSUME_MISSING, `实际 ${r.code}: ${r.reason}`);
});

await t('(b) 验证通过后消费【抛错】⇒ 整笔回滚: 不落库, 挑战仍 unused(原子性)', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-consume-throw';
  const st = chStore(); st.issue(ch);
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch), now: Date.now(),
    consumeChallenge: () => { throw new Error('存储层炸了'); },
    readChallenge: (c) => st.read(c),
  });
  assert.strictEqual(r.ok, false, '消费炸了却报注册成功 = 已注册但挑战可重放');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_CONSUME_FAILED, `实际 ${r.code}: ${r.reason}`);
  const row = sqlite.prepare('SELECT 1 FROM u1_identity_registration WHERE relay_id = ?').get(relayId);
  assert.strictEqual(row, undefined, '🔴 INSERT 没跟着回滚 = 非原子(这正是修前的形态: 先提交再消费)');
});

await t('(b-bis) 消费函数【什么也不做】⇒ 后置条件必须逮住它(空消费不算成功)', async () => {
  const relayId = insRelay({ mnemonic: 'enc-mnemonic-blob' });
  const id = makeIdentity();
  const ch = 'ch-noop-consume';
  const st = chStore(); st.issue(ch);
  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: okChallenge(ch), now: Date.now(),
    consumeChallenge: () => { /* 一声不吭, 也不抛 */ },
    readChallenge: (c) => st.read(c),
  });
  assert.strictEqual(r.ok, false, '空消费读成了成功 = 又一个恒真闸');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_NOT_CONSUMED, `实际 ${r.code}: ${r.reason}`);
  const row = sqlite.prepare('SELECT 1 FROM u1_identity_registration WHERE relay_id = ?').get(relayId);
  assert.strictEqual(row, undefined, '空消费却落了库 = 注册成立而挑战可重放');
});

await t('(c) 成功边界【之后】拿同一挑战重放 ⇒ 必拒(这是"一次性"这三个字的全部含义)', async () => {
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

  // 🔵 重放: 挑战记录【从存储现读】—— 不是重新造一个 usedAt:null 的假记录,
  //    否则测的是"我喂了个 used 记录它会不会拒"(谓词), 而不是"上一次成功有没有真的把它用掉"(调用点)。
  const replay = await registerIdentity({
    sqlite, submission: submissionFor(relay2, id2, ch), challengeRecord: st.read(ch), now: Date.now(), ...wire(st),
  });
  assert.strictEqual(replay.ok, false, '同一挑战第二次仍能注册 = 一次性不成立');
  assert.strictEqual(replay.code, REG_REJECT.POP_FAILED, `期望在 PoP 层被 CHALLENGE_USED 拦, 实际 ${replay.code}: ${replay.reason}`);
  assert.match(replay.reason, /CHALLENGE_USED/, `拒因应当是 CHALLENGE_USED, 实际: ${replay.reason}`);
  const row2 = sqlite.prepare('SELECT 1 FROM u1_identity_registration WHERE relay_id = ?').get(relay2);
  assert.strictEqual(row2, undefined, '重放被拒但落了库');
});

await t('(c-bis) 并发重放: 陈旧 challengeRecord + 非 CAS 的消费实现 ⇒ 必须被事务内前置重读拦住', async () => {
  // 🔴 这一格是我交付后自查补的, 不在 (343) 点名的三格里。
  //    形态: PoP 在事务【外】判, 用的是调用方递进来的记录 ⇒ 两个并发请求可以【都】拿着 usedAt=null 过验证。
  //    这里用"存储已 used, 而手上记录仍说 unused"来复现【第二个请求】的视角。
  const relayId = insRelay({ mnemonic: 'enc-m-concurrent' });
  const id = makeIdentity();
  const ch = 'ch-concurrent';
  const st = chStore(); st.issue(ch);
  const staleRecord = st.read(ch);          // ← 请求 B 早先读到的(那时确实 unused)
  st.consume(ch);                           // ← 请求 A 抢先提交了

  const r = await registerIdentity({
    sqlite, submission: submissionFor(relayId, id, ch), challengeRecord: staleRecord, now: Date.now(),
    // 🔴 故意用【非 CAS】的消费实现: 无条件 SET, 不看当前是不是 unused。
    //    没有前置重读的话, 它会把 used_at 再置一遍 ⇒ 后置条件也满足 ⇒ 同一挑战注册两次。
    consumeChallenge: (c) => { sqlite.prepare('UPDATE _test_challenge SET used_at = ? WHERE challenge = ?').run(Date.now(), c); },
    readChallenge: (c) => st.read(c),
  });
  assert.strictEqual(r.ok, false, '陈旧记录 + 非 CAS 消费竟然注册成功 = 同一挑战可用两次');
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_ALREADY_USED, `期望 CHALLENGE_ALREADY_USED, 实际 ${r.code}: ${r.reason}`);
  const row = sqlite.prepare('SELECT 1 FROM u1_identity_registration WHERE relay_id = ?').get(relayId);
  assert.strictEqual(row, undefined, '并发重放被拒但落了库');
});

sqlite.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-registration: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
