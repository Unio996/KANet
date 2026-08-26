#!/usr/bin/env node
// u1-build-submission.mjs — §6-1 Track-A E2E: 用【本机 relay 自己的钥】构造一份注册 submission(报备层 · 2026-08-27 · J2)
//
// 🔴 NWT 预注册四审点(逐条对应):
//   ① 助记词 / 私钥 / xprv【绝不落盘、绝不打印】: 进程内 decrypt → 派生 → 签 → 只输出六字段 JSON → 退出。
//      console.log 只走 emit(), 它对输出对象做白名单过滤(六字段 + 非密钥元数据), 任何别的键都进不去。
//   ② 派生路径与 kasia-relay/src/lib/wallet.mjs:39-48 逐字一致: XPrv(seed).deriveChild(44,true).deriveChild(111111,true)
//      .deriveChild(0,true) = 账户层(= U1_ACCOUNT_PATH m/44'/111111'/0'), 再 deriveChild(0,false).deriveChild(0,false) = 叶。
//      ⇒ 注册的 identityPubkeyXOnly = relay 现用地址钥, 不是新造钥; 脚本用 XOnlyPublicKey.fromAddress(relay.address) 反核, 不等即拒。
//   ③ PoP 不自造签名字节: payload = buildPopPayload(生产), hash = popMessageHashHex(生产), 签 = kaspa-wasm signMessage(与 NWT 行为测试同构);
//      输出前用生产 verifyRegistrationPop 离线自证一次(喂一条未用未过期的临时 record, 只在内存), 不过即拒绝输出。
//   ④ 输出六字段皆非密钥: relayId / rootXpub(账户层 xpub, 公开) / identityIndex / identityPubkeyXOnly / challenge / signature。
// 🔴 challenge 在消费前是活 bearer(runbook 首段): 本脚本输出含它 ⇒ 输出只给 operator 当场 POST 用, 不贴频道、不进证据(消费后再记)。
// 🔴 dry-run 与 --commit 只差一件事: 是否把六字段写进 --out 文件(默认 scratch/u1-e2e/submission.json)。两者都会真解密真签(用真钥)。
// 🔴 handle 经 DB_PATH + src/db/client.js(M0a 合规, 无裸 sqlite import); decrypt 经 src/services/crypto.js(读进程的 CONSOLE_ENCRYPTION_KEY, 与 console 同一把)。
//
// 用法(kasia-console 目录):
//   node scripts/u1-build-submission.mjs --relay <relay_id> --challenge <hex>            # dry-run: 打印六字段(不写文件)
//   node scripts/u1-build-submission.mjs --relay <relay_id> --challenge <hex> --commit   # 写 --out 文件
//   可选: --db <console.db>  --out <path>  --json
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const COMMIT = argv.includes('--commit');
const JSON_OUT = argv.includes('--json');
const RELAY = arg('--relay', '');
const CHALLENGE = String(arg('--challenge', '')).trim();
const DB = arg('--db', 'D:/kanet-tn12/kasia-console/data/console.db');
const OUT = arg('--out', 'D:/kanet-tn12/scratch/u1-e2e/submission.json');
const die = (m, code = 2) => { console.error(`🔴 ${m}`); process.exit(code); };

// ① 输出白名单: 除这些键, 任何东西都不会被打印/写文件
const SUBMISSION_KEYS = ['relayId', 'rootXpub', 'identityIndex', 'identityPubkeyXOnly', 'challenge', 'signature'];
const META_KEYS = ['mode', 'relay_name', 'relay_address', 'address_key_matches_identity', 'offline_pop_selfcheck', 'out'];
const emit = (o) => {
  const safe = {};
  for (const k of [...META_KEYS, ...SUBMISSION_KEYS]) if (k in o) safe[k] = o[k];
  console.log(JSON_OUT ? JSON.stringify(safe) : Object.entries(safe).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
  return safe;
};

if (!RELAY) die('用法: --relay <relay_id> --challenge <hex> [--commit] [--db path] [--out path] [--json]');
if (!/^[0-9a-f]{64}$/i.test(CHALLENGE)) die('--challenge 必须是 64 hex(u1-issue-challenge.mjs 的输出); 形状不对 = 大概率贴错了');
if (!existsSync(DB)) die(`DB 不存在: ${DB}`);
if (!process.env.CONSOLE_ENCRYPTION_KEY) die('CONSOLE_ENCRYPTION_KEY 未设: 本脚本要用 console 同一把密钥解密 relay 助记词(set -a; . ./kanet.env), 否则 decrypt 必失败');

process.env.DB_PATH = resolve(DB);
const { sqlite, dbPath } = await import('../src/db/client.js');
if (resolve(dbPath) !== resolve(DB)) die(`client.js 打开的库(${dbPath})不是 --db 指定的(${DB}) — 停`);
const { decrypt } = await import('../src/services/crypto.js');
const { deriveCustody } = await import('../src/lib/u1-registration.mjs');
const { rootFingerprint, deriveIdentityPubkey } = await import('../src/lib/u1-same-origin.mjs');
const { buildPopPayload, popMessageHashHex, verifyRegistrationPop } = await import('../src/lib/u1-registration-pop.mjs');
const kaspa = await import('kaspa-wasm');

// relay 前置: 与注册端点同一谓词(混合态 / privkey-only / 不存在 ⇒ 注册必拒 ⇒ 不签)
const custody = deriveCustody(sqlite, RELAY);
if (!custody.ok) die(`relay 不合注册前置(deriveCustody): ${custody.code} — ${custody.reason}`);
const relay = sqlite.prepare('SELECT id, name, address, mnemonic_encrypted FROM relay_nodes WHERE id = ?').get(RELAY);
if (!relay?.mnemonic_encrypted) die('relay 无 mnemonic_encrypted');

// ── 密钥区: 从这里到 zero() 之间的变量绝不进 emit ─────────────────────────────
// 🔴 throw 路径也不许带密钥(NWT 打点 1): 密钥区内任何异常一律换成【固定文案】再 die, 不转发 e.message / e.stack ——
//    kaspa-wasm 的错误文本可能回显入参(助记词/xprv 片段), 未经证实就按"会回显"处理(fail-closed)。整区包一层 try, 不留裸抛。
// 🔴 zero() 的诚实边界(NWT 打点 2): JS 字符串不可变, zero() 只是【清引用】不是【清内存】——助记词/私钥字节在 GC 前仍可能留在堆里;
//    本脚本的缓解 = 进程短命(签完即退)、不 fork、不写 heap dump、不进 emit。暴露窗 = 进程生命期, 不是"零"。
let phrase = null, acct = null, leaf = null, priv = null, rootXpub = null, identityPubkeyXOnly = null, signature = null, matches = false, addrKey = null;
const zero = () => { phrase = null; acct = null; leaf = null; priv = null; };
try {
  try { phrase = decrypt(relay.mnemonic_encrypted); } catch { throw new Error('decrypt 失败(CONSOLE_ENCRYPTION_KEY 不是 console 那把?)'); }
  if (typeof phrase !== 'string' || phrase.trim().split(/\s+/).length < 12) throw new Error('解密结果不像助记词(词数 < 12), 拒绝继续');
  let seed, xprv;
  try {
    seed = new kaspa.Mnemonic(phrase).toSeed();
    xprv = new kaspa.XPrv(seed);
    acct = xprv.deriveChild(44, true).deriveChild(111111, true).deriveChild(0, true);        // ② = wallet.mjs:44-46, accountIndex=0
    leaf = acct.deriveChild(0, false).deriveChild(0, false);                                  // ② = wallet.mjs:47-48
    priv = typeof leaf.toPrivateKey === 'function' ? leaf.toPrivateKey() : kaspa.PrivateKey.fromXPrv(leaf);
  } catch { throw new Error('派生失败(路径 m/44h/111111h/0h/0/0; 原始错误文本不转发)'); } finally { seed = null; xprv = null; }
  rootXpub = acct.toXPub().intoString('kpub');                                                 // 账户层 xpub(公开), = U1_ACCOUNT_PATH
  identityPubkeyXOnly = String(deriveIdentityPubkey(rootXpub, 0)).toLowerCase();               // 生产派生, 非自算
  // ② 反核: 身份钥必须 == relay 现用地址钥; 不等 = 派生路径漂了或 relay 被换钥, 拒
  addrKey = kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(relay.address)).toString().toLowerCase();
  matches = addrKey === identityPubkeyXOnly;
  if (!matches) throw new Error(`identityPubkeyXOnly(${identityPubkeyXOnly.slice(0, 12)}…) != relay 地址钥(${addrKey.slice(0, 12)}…) — 派生路径或 relay 钥不一致, 拒`);
  // ③ PoP: 生产 payload + 生产 hash + kaspa-wasm signMessage(NWT 行为测试同构)
  const payload = buildPopPayload({ rootFingerprint: rootFingerprint(rootXpub), identityIndex: 0, relayId: RELAY, challenge: CHALLENGE });
  signature = kaspa.signMessage({ message: popMessageHashHex(payload), privateKey: priv.toString() });
} catch (e) {
  zero();
  die(String(e && e.message || '密钥区未知错误(文本不转发)'));   // 只有本区自造的固定文案能到这里; 上面两处 catch 已把外部错误文本换掉
} finally { zero(); }
// ── 密钥区结束 ───────────────────────────────────────────────────────────────

const submission = { relayId: RELAY, rootXpub, identityIndex: 0, identityPubkeyXOnly: String(identityPubkeyXOnly).toLowerCase(), challenge: CHALLENGE, signature };
// ③ 离线自证: 喂一条只在内存里的"未用未过期"record 给生产验证器; 不过即拒绝输出(仪器先自证, 再交给端点)
const self = await verifyRegistrationPop({ submission, challengeRecord: { challenge: CHALLENGE, usedAt: null, expiresAt: Date.now() + 60_000 }, now: Date.now() });
if (!self.ok) die(`离线 PoP 自证不过(${self.code}: ${self.reason}) — 不输出 submission`);

const meta = { mode: COMMIT ? 'COMMIT(写 --out)' : 'DRY-RUN(不写文件)', relay_name: relay.name, relay_address: relay.address, address_key_matches_identity: matches, offline_pop_selfcheck: 'PASS', out: COMMIT ? resolve(OUT) : '(未写)' };
if (COMMIT) { mkdirSync(dirname(resolve(OUT)), { recursive: true }); writeFileSync(resolve(OUT), JSON.stringify(submission, null, 1)); }
emit({ ...meta, ...submission });
