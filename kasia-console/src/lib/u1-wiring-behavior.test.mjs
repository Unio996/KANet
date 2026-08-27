// ①-3b/①-4b/①-5b —— **handler 这一层的行为注入测**(@NWT 06:07 指出的缺口)。
//
// 🔴 他抓得对: 我 §8 写的是"行为注入测"(往 body 塞字段再断言被忽略), 而第一版实现是**静态源码 grep**。
//    grep 只能说"源码里没写 spread", 说不了"塞进去的字段真的没生效" —— **标签与实物不符**。
//
// 做法: 用一个**假 fastify** 捕获【真 handler】, 同一份基线跑两次(基线 vs 基线+注入),
//       断言两次**结果完全相同**。若 handler 把注入字段透传下去, 两次结果必然分岔。
// 🔵 这条断言的好处: **不需要注入字段"生效后的样子"**, 只需要"有没有造成任何差别"。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert';
const dir = mkdtempSync(join(tmpdir(), 'u1-beh-'));
process.env.DB_PATH = join(dir, 'probe.db');
process.env.KASPA_NETWORK = 'testnet-12';   // §10 C3: 生产入口从本地配置取 localNetwork(kanet.env 同值)
const { runMigrations } = await import('../db/migrate.js');
const { sqlite, dbPath } = await import('../db/client.js');
assert.ok(dbPath.startsWith(dir), `安全闸: 必须临时库, 实际 ${dbPath}`);
runMigrations();

const { Mnemonic, XPrv, PrivateKey, signMessage } = await import('kaspa-wasm');
const { deriveIdentityPubkey, rootFingerprint } = await import('./u1-same-origin.mjs');
const { buildPopPayload, popMessageHashHex } = await import('./u1-registration-pop.mjs');
const { S10_DOMAIN, S10_VERSION, s10SignedMessage } = await import('./u1-s10-identity.mjs');
const { registerIdentityRoutes } = await import('../api/identities.js');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); console.log('[PASS] ' + n); pass++; } catch (e) { console.log('[FAIL] ' + n + ' :: ' + e.message); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m || 'assert'); };

// ── 捕获【真 handler】: 假 fastify 只记下那条路由 ──
let handler = null;
const fakeFastify = new Proxy({}, {
  get: (_t, prop) => (path, ...rest) => {
    if (prop === 'post' && path === '/api/identity/u1-register') handler = rest[rest.length - 1];
  },
});
await registerIdentityRoutes(fakeFastify);
A(handler, '没捕获到 u1-register handler —— 后面的断言会全部虚过');

const call = async (body) => {
  let code = 200, payload = null;
  const reply = { code(c) { code = c; return this; }, send(p) { payload = p; return this; } };
  await handler({ body }, reply);
  return { code, payload };
};

// ── 造一份能走到深处的合法基线 ──
function insRelay() {
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, privkey_encrypted, address, network, created_at, updated_at)
                  VALUES (?, ?, ?, NULL, ?, 'testnet-12', datetime('now'), datetime('now'))`)
    .run(id, 'r-' + id.slice(0, 6), 'enc-mnemonic', 'kaspatest:q' + id.slice(0, 20));
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
function baseline(relayId, ident, challenge) {
  sqlite.prepare('INSERT OR REPLACE INTO u1_identity_challenge VALUES (?,NULL,?)').run(challenge, Date.now() + 60_000);
  // 🔴 基线必须是【能成功注册】的一份 —— 否则注入与否两边都因同一个早期拒因而“相等”,
  //    它会在没有任何判别力的情况下变绿(同族: 预期答案本就一致时读数相同零信息)。
  const payload = buildPopPayload({ rootFingerprint: rootFingerprint(ident.rootXpub), identityIndex: 0, relayId, challenge });
  const signature = signMessage({ message: popMessageHashHex(payload), privateKey: new PrivateKey(ident.privHex) });
  // §10 C3: relay 地址绑到本身份叶钥 + 同钥签 S10(epoch=challenge); 各格期望不改
  const priv = new PrivateKey(ident.privHex);
  sqlite.prepare('UPDATE relay_nodes SET address = ? WHERE id = ?').run(priv.toPublicKey().toAddress('testnet-12').toString(), relayId);
  const f = { domain: S10_DOMAIN, version: S10_VERSION, network: 'testnet-12', relayPubkeyXOnly: ident.pubkey, operation: 'register', epoch: challenge };
  const s10 = { ...f, signature: signMessage({ message: s10SignedMessage(f), privateKey: priv }) };
  return { relayId, rootXpub: ident.rootXpub, identityIndex: 0, identityPubkeyXOnly: ident.pubkey, challenge, signature, s10 };
}

// 🔴🔴 每次调用都用【全新的 relay + 身份 + 挑战】—— 不得共用。
//    第一版共用一套, 后果是: 基线那一跑真的注册成功并写了行,
//    于是后面每一次调用都撞 relay_id 主键 / root_fingerprint UNIQUE 而返回 400。
//    ⇒ ①-3b 报 200 vs 400(看起来像“注入生效了”, 其实是我自己写的行),
//      而 ①-4b/①-5b 两边都是 400 ⇒ “逐字相同”成立, 却是【空绿】: 两边都被同一条残留行拦在同一个闸上,
//      根本没走到注入字段能影响的地方。在册: 【当证据用的记录必须排除自己的测试写入】。
function freshBase() {
  const rid = insRelay();
  const idt = makeIdentity();
  return baseline(rid, idt, 'ch-' + randomUUID());
}

// 三条注入, 每条都跑"基线 vs 基线+注入"并要求结果逐字相同
const injections = [
  ['①-3b custody(模块故意不看它)', { custody: 'privkey' }],
  ['①-4b 伪 challengeStore(若被转发, 判定必分岔)', {
    challengeStore: { __u1ChallengeStoreToken: true, read: () => ({ challenge: 'x', usedAt: null, expiresAt: Date.now() + 1e6 }), consume: () => {} },
  }],
  ['①-5b 时钟/验签器逃逸口字段', { clock: () => 0, __testOnlyClock: () => 0, verifyMessageFn: () => true, expectedTable: 'attacker_table' }],
];

for (const [name, inject] of injections) {
  await t(name + ' ⇒ 结果与基线【逐字相同】', async () => {
    const a = await call({ ...freshBase() });
    const b = await call({ ...freshBase(), ...inject });
    // 🔴 阳性前提: 基线那一跑必须真的成功 —— 否则两边可能因同一个早期拒因而“相等”,
    //    用例在零判别力下变绿。这一行就是拦住那种空绿的闸。
    A(a.code === 200 && a.payload && a.payload.ok === true,
      `基线没有成功注册(${a.code} ${a.payload && a.payload.code}) ⇒ 本用例没有判别力, 不得当它通过`);
    // challenge 不同 ⇒ 只比 code 与判定 code/ok, 不比 reason 里的随机串
    A(a.code === b.code, `HTTP code 分岔: ${a.code} vs ${b.code}`);
    A((a.payload && a.payload.ok) === (b.payload && b.payload.ok), 'ok 分岔');
    A((a.payload && a.payload.code) === (b.payload && b.payload.code),
      `判定 code 分岔: ${a.payload && a.payload.code} vs ${b.payload && b.payload.code} ⇒ 注入字段影响了结果`);
  });
}

await t('①-4b-强 伪 store 未被采纳的正证: 判定仍来自【真 store】路径', async () => {
  const r = await call({ ...freshBase(), challengeStore: { __u1ChallengeStoreToken: true } });
  // 若伪 store 被转发, isStoreBoundTo 会判 CHALLENGE_STORE_UNBOUND;
  // 未被转发时 handler 自己造的真 store 能过绑定检查 ⇒ 判定必然停在【更靠后】的闸上。
  A(r.payload && r.payload.code !== 'CHALLENGE_STORE_UNBOUND',
    '判定是 CHALLENGE_STORE_UNBOUND ⇒ 说明伪 store 被转发进去了');
});

await t('阴性臂 · 模拟一个【会透传 body】的漏 handler ⇒ 上面那套比较必须分岔', async () => {
  // 🔴 没有这一臂, 上面四格的“两次结果相同”只能证明【没有分岔】,
  //    证不了【分岔了就会被发现】—— 一个永远相等的比较器也会全绿。
  //    本臂把【漏 handler 会干的事】直接做一遍(把调用方给的 challengeStore 转发进去),
  //    断言结果确实不同 ⇒ 那四格的“相同”才是一个有内容的读数。
  const { registerIdentity } = await import('./u1-registration.mjs');
  const { createChallengeStore, CANONICAL_CHALLENGE_TABLE } = await import('./u1-challenge-store.mjs');
  const good = await registerIdentity({
    sqlite, submission: freshBase(),
    challengeStore: createChallengeStore(sqlite, CANONICAL_CHALLENGE_TABLE),
  });
  A(good.ok === true, `阴性臂的基线没成功(${good.code}) ⇒ 这一臂也没判别力`);
  const leaked = await registerIdentity({
    sqlite, submission: freshBase(),
    // ↑ 漏 handler = 把 body 里的 challengeStore 原样递下去
    challengeStore: { __u1ChallengeStoreToken: true, read: () => null, consume: () => {} },
  });
  A(leaked.ok === false && good.ok !== leaked.ok,
    `透传假 store 居然与基线结果相同(good=${good.ok}/${good.code} leaked=${leaked.ok}/${leaked.code}) ⇒ 上面那套比较没有牙`);
  console.log('        阴性臂读数: 基线 ok=true / 透传假 store 后 ' + leaked.code + ' ⇒ 比较器确实会分岔');
});
行为注入测:

console.log(`\n① handler 行为注入测: ${pass} PASS / ${fail} FAIL   (临时库 ${dbPath})`);
