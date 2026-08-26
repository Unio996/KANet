// u1 in-tx CAS 并发防御层 · 运行时证明(J2 2026-08-27 · Bettor 派工 (11) · NWT 预注册审点 ①-⑥)
//
// 🔴 CAS 的【定义态】= 两条 flow 都在 used_at=null 时先跑完 verifyRegistrationPop(都见 null), 然后才让两个 runTx 竞 .immediate。
//    顺序 POST 两次不是并发: 第二次在 pop.mjs:95(CHALLENGE_USED)就被前置层拦下, 根本到不了 registration.mjs:253。
//    ⇒ 本用例用 __testOnlyRegisterIdentityWithInjections 注入的 verifyMessageFn 做【屏障】: 两路都到 PoP 才一起放行,
//       并在屏障处直接 SELECT used_at 证明两者都见 null; 之后两路依次进 runTx, 第二路必在 :253 被【事务内重读】抓住。
//    better-sqlite3 同步 ⇒ 单进程做不到真并行, 这是 NWT 接受的【编排复现】; 双进程 SQLite 锁那层由臂 C 盖(spawn 两个子进程, 文件屏障)。
// 判据(NWT ②③): 第二笔 code 必须 === CHALLENGE_ALREADY_USED(:253, 事务内路), 不是 POP_FAILED(:95 前置层); 恰一笔 ok, reg 恒 1 行, used_at 单次置。
// 🔴 只 scratch 临时库(真 runMigrations), 不碰 live。store 与身份表同一 sqlite handle(isStoreBoundTo)+ .immediate, 不用 mock。
// 反向臂在 u1-cas-concurrent.mutants.mjs(mutate-a-copy): 改 .immediate / 去 isStoreBoundTo / 去 in-tx 重读 ⇒ 本用例必须变红。
//
// 跑: cd kasia-console && node src/lib/u1-cas-concurrent.test.mjs   (输出末行 "N/N PASS"; 证据落 logs/test-runs/u1-cas-concurrent-<ts>.log 由跑手 tee)
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKER = process.argv.includes('--worker');
const dir = WORKER ? process.env.U1_CAS_DIR : mkdtempSync(join(tmpdir(), 'u1-cas-'));
process.env.DB_PATH = join(dir, 'cas.db');

const { runMigrations } = await import('../db/migrate.js');
const { sqlite, dbPath } = await import('../db/client.js');
assert.ok(dbPath.startsWith(dir), `安全闸: 必须临时库, 实际 ${dbPath}`);
if (!WORKER) runMigrations();
const { Mnemonic, XPrv, PrivateKey, signMessage, verifyMessage } = await import('kaspa-wasm');
const { deriveIdentityPubkey, rootFingerprint } = await import('./u1-same-origin.mjs');
const { buildPopPayload, popMessageHashHex } = await import('./u1-registration-pop.mjs');
const { REG_REJECT, __testOnlyRegisterIdentityWithInjections } = await import('./u1-registration.mjs');
const { createChallengeStore, CANONICAL_CHALLENGE_TABLE } = await import('./u1-challenge-store.mjs');
const T = CANONICAL_CHALLENGE_TABLE;
const realVerify = (a) => verifyMessage(a);

function insRelay() {
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, privkey_encrypted, address, network, created_at, updated_at)
                  VALUES (?, ?, 'enc', NULL, ?, 'testnet-12', datetime('now'), datetime('now'))`).run(id, 'r-' + id.slice(0, 6), 'kaspatest:q' + id.slice(0, 20));
  return id;
}
function makeIdentity() {
  const acct = new XPrv(new Mnemonic(Mnemonic.random().phrase).toSeed()).deriveChild(44, true).deriveChild(111111, true).deriveChild(0, true);
  const rootXpub = acct.toXPub().intoString('kpub');
  const leaf = acct.deriveChild(0, false).deriveChild(0, false);
  const privHex = (typeof leaf.toPrivateKey === 'function' ? leaf.toPrivateKey() : PrivateKey.fromXPrv(leaf)).toString();
  return { rootXpub, privHex, pubkey: deriveIdentityPubkey(rootXpub, 0) };
}
const issue = (ttlMs = 60_000) => { const c = randomBytes(32).toString('hex'); sqlite.prepare(`INSERT INTO ${T} (challenge, used_at, expires_at) VALUES (?, NULL, ?)`).run(c, Date.now() + ttlMs); return c; };
const usedAt = (c) => sqlite.prepare(`SELECT used_at FROM ${T} WHERE challenge = ?`).get(c)?.used_at ?? null;
const regRows = () => sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration').get().n;
function submissionFor(relayId, id, challenge) {
  const payload = buildPopPayload({ rootFingerprint: rootFingerprint(id.rootXpub), identityIndex: 0, relayId, challenge });
  const signature = signMessage({ message: popMessageHashHex(payload), privateKey: id.privHex });
  return { relayId, rootXpub: id.rootXpub, identityIndex: 0, identityPubkeyXOnly: id.pubkey, challenge, signature };
}
const reg = (submission, inj = {}) => __testOnlyRegisterIdentityWithInjections(
  { sqlite, submission, challengeStore: createChallengeStore(sqlite, T) },
  { verifyMessageFn: inj.verifyMessageFn || realVerify, clock: inj.clock, expectedTable: T });

// ── worker 模式(臂 C 双进程): 各自独立连接同一临时库, 在 PoP 处等文件屏障, 然后竞 runTx ──
if (WORKER) {
  const sub = JSON.parse(readFileSync(process.env.U1_CAS_SUB, 'utf8'));
  const go = join(dir, 'go');
  const barrier = async (a) => { const ok = realVerify(a); while (!existsSync(go)) await new Promise(r => setTimeout(r, 5)); return ok; };
  const seenNull = usedAt(sub.challenge) === null;
  const r = await reg(sub, { verifyMessageFn: barrier });
  process.stdout.write(JSON.stringify({ ok: r.ok, code: r.code || null, seenNullBeforePop: seenNull }) + '\n');
  process.exit(0);
}

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`[PASS] ${name}`); } catch (e) { fail++; console.log(`[FAIL] ${name} — ${e.message}`); } };

// ── 臂 A: 单进程编排复现 —— 同一活挑战, 两路在 PoP 屏障处都见 used_at=null, 然后依次竞 runTx ──
async function orchestratedRace(subA, subB) {
  let arrived = 0; const observed = [];
  let release; const gate = new Promise(r => { release = r; });
  const barrier = async (a) => {
    observed.push(usedAt(a && subA.challenge));   // 到达 PoP 时实读 used_at(两路都应为 null)
    if (++arrived === 2) release();
    await gate;                                     // 两路都到了才一起放行 ⇒ 之后依次进 runTx
    return realVerify(a);
  };
  const [ra, rb] = await Promise.all([reg(subA, { verifyMessageFn: barrier }), reg(subB, { verifyMessageFn: barrier })]);
  return { ra, rb, observed };
}
// 🔴 实测发现(2026-08-27, 本用例第一版把它当 :253 写, 红了): 事务内顺序是 :227 custody2 → :237 INSERT → :251 挑战重读。
//    【同一 submission】重放时, 第二笔在 :237 就撞 v196 UNIQUE(root_fingerprint / relay_id / identity_pubkey_xonly, N3 锁)
//    ⇒ 走不到 :253, 拒因 = CONSTRAINT(UNIQUE)。exactly-one 与整笔回滚仍成立(同一 IMMEDIATE 事务内), 但守门的是 N3 UNIQUE 不是挑战 CAS。
//    ⇒ :253 那道闸只对【同挑战、不同身份】暴露(A2/C1)。两者都要测, 判据不同, 不许混。
await t('A1 同一 submission 两路并发: 恰一 ok; 另一在事务内 :237 撞 N3 UNIQUE(CONSTRAINT)先于 :253; reg=1, used_at 单次', async () => {
  const relay = insRelay(); const id = makeIdentity(); const c = issue(); const sub = submissionFor(relay, id, c);
  const rows0 = regRows();
  const { ra, rb, observed } = await orchestratedRace(sub, sub);
  assert.deepStrictEqual(observed, [null, null], `屏障处两路都应见 used_at=null, 实际 ${JSON.stringify(observed)} —— 否则没复现 CAS 定义态`);
  const oks = [ra, rb].filter(r => r.ok); const rejs = [ra, rb].filter(r => !r.ok);
  assert.strictEqual(oks.length, 1, `期望恰一笔 ok, 实际 ${oks.length}: ${JSON.stringify([ra, rb])}`);
  assert.strictEqual(rejs[0].code, REG_REJECT.CONSTRAINT, `同 submission 第二笔应在 INSERT 撞 UNIQUE, 实际 code=${rejs[0].code} reason=${rejs[0].reason}`);
  assert.ok(/UNIQUE constraint failed: u1_identity_registration/.test(rejs[0].reason), `拒因应是 v196 UNIQUE, 实际: ${rejs[0].reason}`);
  assert.strictEqual(regRows() - rows0, 1, 'reg 应恰增 1 行');
  assert.ok(usedAt(c) !== null, 'used_at 应已置(由成功那笔)');
});
await t('A2 同一 challenge、两个不同身份/relay 的 submission 并发: 仍恰一 ok, 另一 :253', async () => {
  const c = issue();
  const subA = submissionFor(insRelay(), makeIdentity(), c), subB = submissionFor(insRelay(), makeIdentity(), c);
  const rows0 = regRows();
  const { ra, rb, observed } = await orchestratedRace(subA, subB);
  assert.deepStrictEqual(observed, [null, null]);
  const rejs = [ra, rb].filter(r => !r.ok);
  assert.strictEqual([ra, rb].filter(r => r.ok).length, 1, JSON.stringify([ra, rb]));
  assert.strictEqual(rejs[0].code, REG_REJECT.CHALLENGE_ALREADY_USED, `实际 ${rejs[0].code}: ${rejs[0].reason}`);
  assert.strictEqual(regRows() - rows0, 1);
});
await t('A3 对照(顺序两次, 非并发): 第二次应在前置层 :95 被拦(code=POP_FAILED), 证明 A1/A2 的 :253 不是顺序效应', async () => {
  const relay = insRelay(); const id = makeIdentity(); const c = issue(); const sub = submissionFor(relay, id, c);
  const r1 = await reg(sub); assert.ok(r1.ok, JSON.stringify(r1));
  const r2 = await reg(sub);
  assert.strictEqual(r2.code, REG_REJECT.POP_FAILED, `顺序第二次应是前置层 POP_FAILED(CHALLENGE_USED), 实际 ${r2.code}`);
  assert.notStrictEqual(r2.code, REG_REJECT.CHALLENGE_ALREADY_USED, '顺序重放不应到 :253 —— 到了说明前置层失效');
});

// ── 臂 B: 过期 in-tx(:269) —— PoP 见未过期, 事务内重读见已过期 ──
await t('B1 时钟跨过 expiry: PoP(clock#1)未过期放行, 事务内重读(clock#2)过期 ⇒ code=CHALLENGE_EXPIRED(:269, 非前置层), 零落库', async () => {
  const relay = insRelay(); const id = makeIdentity(); const c = issue(60_000); const sub = submissionFor(relay, id, c);
  const rows0 = regRows(); let n = 0;
  const clock = () => (++n === 1 ? Date.now() : Date.now() + 120_000);   // 第 1 次(PoP :215)未过期, 第 2 次(in-tx :266)已过期
  const r = await reg(sub, { clock });
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_EXPIRED, `实际 ${r.code}: ${r.reason}`);
  assert.ok(/事务内重读/.test(r.reason), `须出自事务内路, 实际: ${r.reason}`);
  assert.strictEqual(regRows(), rows0, '整笔回滚, reg 不增');
  assert.strictEqual(usedAt(c), null, '回滚后挑战仍未消费');
});
await t('B2 对照: 一开始就过期 ⇒ 前置层 POP_FAILED(:95 族), 不到 :269', async () => {
  const relay = insRelay(); const id = makeIdentity(); const c = issue(60_000); const sub = submissionFor(relay, id, c);
  const r = await reg(sub, { clock: () => Date.now() + 120_000 });
  assert.strictEqual(r.code, REG_REJECT.POP_FAILED, `实际 ${r.code}`);
});

// ── 臂 C: 双进程 —— 两个独立连接同一临时库, 文件屏障后竞 BEGIN IMMEDIATE(SQLite 锁层) ──
await t('C1 双进程同挑战·不同身份: 恰一 ok, 另一 CHALLENGE_ALREADY_USED(:253, 经 .immediate 排队后事务内重读), reg=1', async () => {
  const c = issue();
  const subA = submissionFor(insRelay(), makeIdentity(), c), subB = submissionFor(insRelay(), makeIdentity(), c);   // 不同身份 ⇒ 不撞 N3 UNIQUE, :253 才是唯一守门
  const pA = join(dir, 'subA.json'), pB = join(dir, 'subB.json'); writeFileSync(pA, JSON.stringify(subA)); writeFileSync(pB, JSON.stringify(subB));
  const rows0 = regRows();
  const self = fileURLToPath(import.meta.url);
  const spawnWorker = (subPath) => new Promise((res, rej) => {
    const p = spawn(process.execPath, [self, '--worker'], { env: { ...process.env, U1_CAS_DIR: dir, U1_CAS_SUB: subPath }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', () => { try { res(JSON.parse(out.trim().split('\n').pop())); } catch { rej(new Error('worker 无 JSON 输出: ' + (out + err).slice(-300))); } });
  });
  const w1 = spawnWorker(pA), w2 = spawnWorker(pB);
  await new Promise(r => setTimeout(r, 2500));      // 让两个子进程都跑到 PoP 屏障(都已读到 used_at=null)
  writeFileSync(join(dir, 'go'), '1');
  const [r1, r2] = await Promise.all([w1, w2]);
  assert.ok(r1.seenNullBeforePop && r2.seenNullBeforePop, `两进程 PoP 前都应见 null: ${JSON.stringify([r1, r2])}`);
  const oks = [r1, r2].filter(r => r.ok), rejs = [r1, r2].filter(r => !r.ok);
  assert.strictEqual(oks.length, 1, `期望恰一 ok: ${JSON.stringify([r1, r2])}`);
  assert.strictEqual(rejs[0].code, REG_REJECT.CHALLENGE_ALREADY_USED, `第二进程应由事务内重读拒, 实际 ${rejs[0].code}(若是 CONSTRAINT/database is locked = 没拿到 IMMEDIATE 锁而是撞 BUSY)`);
  assert.strictEqual(regRows() - rows0, 1);
});

// ── 臂 D: 事务域绑定 —— 别的连接造的 store 必须被拒(反向臂"去 isStoreBoundTo"靠它变红) ──
await t('D1 别的 sqlite 连接造的 store ⇒ CHALLENGE_STORE_UNBOUND, 零落库', async () => {
  // 不裸 import better-sqlite3(M0a 门, 不新增 manifest 例外): 用生产 handle 的构造器再开一条连接
  const other = new sqlite.constructor(dbPath);
  const relay = insRelay(); const id = makeIdentity(); const c = issue(); const sub = submissionFor(relay, id, c);
  const rows0 = regRows();
  const r = await __testOnlyRegisterIdentityWithInjections({ sqlite, submission: sub, challengeStore: createChallengeStore(other, T) }, { verifyMessageFn: realVerify, expectedTable: T });
  other.close();
  assert.strictEqual(r.code, REG_REJECT.CHALLENGE_STORE_UNBOUND, `实际 ${r.code}: ${r.reason}`);
  assert.strictEqual(regRows(), rows0);
});

console.log(`\n${pass}/${pass + fail} PASS   (临时库 ${dbPath})`);
process.exit(fail ? 1 : 0);
