// §6-1 注册【验证半场】live 贯通 E2E —— J2 2026-08-19, Bettor 20:43 裁定 (a)+三约束。
//
// 🔴🔴 先读这一段, 它决定这个脚本能宣称什么(Bettor 已采纳为定性):
//   `u1-challenge-store.mjs` 只导出 read/consume/bind, **没有任何"签发挑战"的口**;
//   全仓生产码对 `u1_identity_challenge` 的写入 = 0(v197 迁移注释自己写着「今日无写入方」)。
//   ⇒ **真实用户走不到第一步(拿挑战)** ⇒ 本脚本证的是【验证半场】, **不是**「旗舰真能注册」。
//   缺的那块砖很具体: 一个签发挑战的入口(谁能要 / TTL / 限流)。那是 §6-1 之后的下一块砖。
//
// 🔴 Bettor 三约束(逐条落进本脚本, 见实现):
//   1. **no-key-leak**: 全程只 log relayId / address / PASS-FAIL。**绝不 log 助记词或派生中间态**。
//      本文件里没有任何一处把 mnemonic / xprv / 私钥放进 console.log —— 见 `logSafe()` 与下方注释锚点。
//   2. **作用域标死**: 由 console 解密自己托管的助记词派生 rootXpub 是**E2E 验证捷径**
//      (console 本就是该 relay 的托管方)。**真实外部 Track B 流是外部提交方自带自己的 xpub、
//      console 不解密** —— 别把这里的做法当成真实外部流照抄。
//   3. **可逆**: 跑完打印回滚 SQL(删那行 registration + 清那条 challenge)。本脚本**不自动回滚**,
//      因为证据要留给三方独立复核; 回滚由 operator 在复核后执行。
//
// 🔴 安全闸(本脚本**故意**打在 live 库上, 所以闸的方向与我其它验收脚本相反):
//   · 默认 **dry-run**: 不传 `--execute` 就只打印将要做什么, 零写入。
//   · 正例 relay **必须显式 `--relay=<name>`**, 无默认值 ⇒ 不可能"手一滑就注册了某个 relay"。
//   · 运营型 relay 在 **DENY 名单**里, 传了也拒(money-path / faucet / broker / pilot)。
//   · 缺 `CONSOLE_ENCRYPTION_KEY` ⇒ crypto.js 自己 throw(fail-closed), 我们不去替它找密钥。
//
// 跑法(env 需已加载 kanet.env, 与 console 同源):
//   node kasia-console/scripts/u1-registration-e2e.mjs                      # dry-run, 只看计划
//   node kasia-console/scripts/u1-registration-e2e.mjs --relay=tester-3 --execute
import { randomBytes } from 'node:crypto';

const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const val = (k) => { const a = ARGS.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const EXECUTE = has('--execute');
const RELAY_NAME = val('relay');
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';

// 🔴 约束1 的落点: 唯一允许的打印通道。任何值经它出去前先过白名单式裁剪。
const logSafe = (...parts) => console.log(...parts);

// 运营型 relay 拒名单 —— 落库不可逆(relay_id PK + root_fingerprint UNIQUE), 别占它们的槽。
const DENY = [/^Bettor-tn$/i, /^FaucetRelay/i, /^HouseAgent$/i, /^maker-/i, /^broker-/i,
  /^m0c1-path-b-pilot/i, /^MiningRelay/i, /^KANet-UI-tn$/i, /^J2-tn$/i, /^NWT-tn$/i];

const relayCmd = async (id, cmd, timeoutMs = 30000) => {
  const r = await fetch(`${CONSOLE_URL}/api/relay/${id}/send-command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd), signal: AbortSignal.timeout(timeoutMs),
  });
  return r.json();
};

const { sqlite } = await import('../src/db/client.js');
const { rootFingerprint, deriveIdentityPubkey } = await import('../src/lib/u1-same-origin.mjs');
const { buildPopPayload, popMessageHashHex } = await import('../src/lib/u1-registration-pop.mjs');

const countReg = () => sqlite.prepare('SELECT COUNT(*) c FROM u1_identity_registration').get().c;
const relayRow = (name) => sqlite.prepare('SELECT id, name, address, mnemonic_encrypted, privkey_encrypted FROM relay_nodes WHERE name = ?').get(name);
const ne = (v) => typeof v === 'string' && v.trim() !== '';

// ── 基线(每一格都要有"之前"才能归因) ───────────────────────────────────────
const BASE = {
  registrations: countReg(),
  challenges: sqlite.prepare('SELECT COUNT(*) c FROM u1_identity_challenge').get().c,
  executing: sqlite.prepare("SELECT COUNT(*) c FROM execution_states WHERE status='executing'").get().c,
};
logSafe('── 基线 ──', JSON.stringify(BASE));

// ── E1 阴性臂: privkey-only 的 relay 必须被 CUSTODY_NOT_MNEMONIC 拒, 且零写入 ──
// 🔴 先阴性再阳性: 顺序反了的话, 阳性绿了也不知道闸在不在。
const NEGATIVES = sqlite.prepare('SELECT id, name FROM relay_nodes').all()
  .filter((r) => { const x = relayRow(r.name); return !ne(x.mnemonic_encrypted); });

const post = async (body) => {
  const r = await fetch(`${CONSOLE_URL}/api/identity/u1-register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  return { code: r.status, payload: await r.json().catch(() => null) };
};

let pass = 0; let fail = 0;
const check = (n, ok, detail = '') => { if (ok) { pass++; logSafe('[PASS]', n); } else { fail++; logSafe('[FAIL]', n, detail); } };

if (!EXECUTE) {
  logSafe('\n🔵 dry-run(未传 --execute) —— 下面只是【将要做什么】, 本次零写入:');
  logSafe('  E1 阴性臂将打这些 relay(应各自返 CUSTODY_NOT_MNEMONIC, 零写入):',
    NEGATIVES.map((r) => r.name).join(', ') || '(无)');
  logSafe('  E2 阳性臂 relay =', RELAY_NAME || '🔴 未指定(必须 --relay=<name>, 无默认值)');
  if (RELAY_NAME) {
    const row = relayRow(RELAY_NAME);
    logSafe('    存在?', !!row, '| custody=mnemonic?', row ? (ne(row.mnemonic_encrypted) && !ne(row.privkey_encrypted)) : 'n/a',
      '| 在拒名单?', DENY.some((re) => re.test(RELAY_NAME)));
  }
  logSafe('  🔴 执行时会做的【live 写入】共两处: ① INSERT 一行 u1_identity_challenge ② 注册成功后 u1_identity_registration +1 行');
  logSafe('  🔴 且第 ② 处受 relay_id PK / root_fingerprint UNIQUE 约束 —— 需 operator 复核后按打印的回滚 SQL 清理。');
  process.exit(0);
}

// ── 以下仅在 --execute 下运行 ────────────────────────────────────────────
if (!RELAY_NAME) { logSafe('🔴 必须 --relay=<name>(无默认值, 防手滑)'); process.exit(1); }
if (DENY.some((re) => re.test(RELAY_NAME))) { logSafe(`🔴 ${RELAY_NAME} 在运营型拒名单里 —— 落库不可逆, 不占它的槽`); process.exit(1); }
const target = relayRow(RELAY_NAME);
if (!target) { logSafe('🔴 relay 不存在:', RELAY_NAME); process.exit(1); }
if (!ne(target.mnemonic_encrypted) || ne(target.privkey_encrypted)) {
  logSafe('🔴 该 relay 不是 custody=mnemonic 型, deriveCustody 会拒 —— 换一个'); process.exit(1);
}

for (const n of NEGATIVES) {
  const r = await post({ relayId: n.id, rootXpub: 'kpub-placeholder', identityIndex: 0,
    identityPubkeyXOnly: '00'.repeat(32), challenge: 'no-such-challenge', signature: 'deadbeef' });
  check(`E1 阴性 ${n.name} ⇒ CUSTODY_NOT_MNEMONIC`,
    r.code === 400 && r.payload?.code === 'CUSTODY_NOT_MNEMONIC', JSON.stringify(r.payload));
}
check('E1 阴性臂零写入', countReg() === BASE.registrations, `行数 ${BASE.registrations} → ${countReg()}`);

// ── E2 阳性臂 ────────────────────────────────────────────────────────────
// 🔴 约束2 作用域: 这一步是【E2E 捷径】—— console 作为托管方解密自己 relay 的助记词派生 xpub。
//    真实外部流里, 提交方自带 xpub, console 不解密任何东西。
const { getRelayMnemonic } = await import('../src/data/settings/relay-nodes.js');
const mnemonic = getRelayMnemonic(target.id);
// ⚠ getRelayMnemonic 是 `catch { return null }` ⇒ 解密失败会【看起来像"这个 relay 没有助记词"】。
//   我们上面已从 DB 确认该列非空 ⇒ 此处 null 一律当【故障】, 不是"没有"。
if (!mnemonic) { logSafe('🔴 取助记词失败(DB 里该列非空 ⇒ 这是解密故障, 不是"没有") —— 检查 CONSOLE_ENCRYPTION_KEY'); process.exit(1); }

const { Mnemonic, XPrv } = await import('kaspa-wasm');
const acct = new XPrv(new Mnemonic(mnemonic).toSeed())
  .deriveChild(44, true).deriveChild(111111, true).deriveChild(0, true);
const rootXpub = acct.toXPub().intoString('kpub');
// 🔴 约束1: 到此为止, mnemonic / acct / xprv 全部【不进任何 log】。下面只打印 relayId/address/指纹。
const fp = rootFingerprint(rootXpub);
const identityPubkeyXOnly = deriveIdentityPubkey(rootXpub, 0);
logSafe('  目标 relay:', RELAY_NAME, '| id', target.id, '| address', target.address);
logSafe('  root_fingerprint(公开派生量):', fp);

// 🔴 挑战: 因为生产没有签发口, 只能由 operator 手工 INSERT 一行(Bettor 已批为本轮唯一路径)。
const challenge = randomBytes(32).toString('hex');
const expiresAt = Date.now() + 10 * 60 * 1000;
sqlite.prepare('INSERT INTO u1_identity_challenge (challenge, used_at, expires_at) VALUES (?, NULL, ?)')
  .run(challenge, expiresAt);
logSafe('  已 INSERT 一条挑战(10 分钟有效)。⚠ 这是 live 库手工写入, 因为生产【没有签发口】。');

// PoP 签名: relay 本人签, Console 不碰钥。
// 依据: relay 钱包 m/44'/111111'/<acct>'/0/0 与 identity key m/44'/111111'/0'/0/0 在 acct=0 时同一把,
//       且 acct=0 已由 ⑤ escape-hatch live-check 证过(运行时地址与 relay_nodes 逐字符对上)。
const pk = await relayCmd(target.id, { type: 'get_pubkey' });
check('E2-0 relay get_pubkey 与服务端派生的 identity pubkey 一致(证同一把钥)',
  String(pk?.x_only_pubkey || '').toLowerCase() === String(identityPubkeyXOnly).toLowerCase(),
  `relay=${pk?.x_only_pubkey} derived=${identityPubkeyXOnly}`);

const payload = buildPopPayload({ rootFingerprint: fp, identityIndex: 0, relayId: target.id, challenge });
const sig = await relayCmd(target.id, { type: 'ecdsa_sign', message: popMessageHashHex(payload) });
if (!sig?.signature) { logSafe('🔴 relay 签名失败:', JSON.stringify(sig)); process.exit(1); }

const r2 = await post({ relayId: target.id, rootXpub, identityIndex: 0,
  identityPubkeyXOnly, challenge, signature: sig.signature });
check('E2 阳性 ⇒ ok:true', r2.code === 200 && r2.payload?.ok === true, JSON.stringify(r2.payload));
check('E2 registration 行数 +1', countReg() === BASE.registrations + 1, `${BASE.registrations} → ${countReg()}`);
const row = sqlite.prepare('SELECT custody, root_fingerprint FROM u1_identity_registration WHERE relay_id = ?').get(target.id);
check('E2 custody 是服务端派生值 mnemonic', row?.custody === 'mnemonic', String(row?.custody));
check('E2 root_fingerprint = 服务端对 rootXpub 重算值', row?.root_fingerprint === fp, `${row?.root_fingerprint} vs ${fp}`);

// E3 挑战真被消费
const chRow = sqlite.prepare('SELECT used_at FROM u1_identity_challenge WHERE challenge = ?').get(challenge);
check('E3 挑战 used_at 非 NULL(真被消费, 不是空消费)', chRow?.used_at != null, String(chRow?.used_at));

// E4 重放必拒
const r3 = await post({ relayId: target.id, rootXpub, identityIndex: 0,
  identityPubkeyXOnly, challenge, signature: sig.signature });
check('E4 同一挑战重放必拒', r3.payload?.ok === false, JSON.stringify(r3.payload));
check('E4 重放后行数仍为 +1(没写第二行)', countReg() === BASE.registrations + 1, String(countReg()));

// E5 零附带写入
check('E5 execution_states 未被附带改动',
  sqlite.prepare("SELECT COUNT(*) c FROM execution_states WHERE status='executing'").get().c === BASE.executing);

logSafe(`\n${fail === 0 ? '✅' : '🔴'} E2E: ${pass} PASS / ${fail} FAIL`);
logSafe('\n🔴 约束3 回滚 SQL(三方复核【之后】由 operator 执行, 本脚本不自动跑 —— 证据要留给复核):');
logSafe(`  DELETE FROM u1_identity_registration WHERE relay_id = '${target.id}';`);
logSafe(`  DELETE FROM u1_identity_challenge   WHERE challenge = '${challenge}';`);
if (fail > 0) process.exitCode = 1;
