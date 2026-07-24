// M0c-1 机制A — G4 pilot custodial_transfer 真 E2E harness（gateway→relay 全链路，非孤立单测）
// 设计: docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md §3 (与 runbook §4 激活验证判据共用)
//       docs/2026-07-23-m0c-1-path-b-pilot-containment-relay-side.md §5
// 派工: Bettor 工作流① J1 域最后一块。runbook §4 激活验证的"e2e 最小 smoke"直接引用本文件的最小
// 正向 LAND 用例（单一真相源，不建第二套 smoke——KANet-UI `bde13e51` 已锚定这个依赖方向）。
//
// 🔴 v0.2(2026-07-24·Codex RED-not-ready 修正): v0.1 只有 5 用例(LAND①+BUST①②③④), 缺 replay/
// 吊销/taint/pilot专属TTL/限流覆盖(Bettor MSG-120 把设计稿声称的控制当已测试打包, Codex 抓出这是
// evidence-integrity 问题)。本版补齐 4 类缺口 + 把弱判据("没被 400/401/403 拒")升级为精确 reason
// 断言(读 relayLastLog 或 HTTP body 具体文案, 而非只判"没意外通过")。
//
// 🔴 v0.2 架构变化(每个需要触达 relay 的用例用独立 grant+wallet, 不共享): J2 落码的真实限流(每
// grant_id 每 60s ≤3 笔)生效后, v0.1 多个用例共享同一个 grantId 连续发请求, 会在同一 60s 窗口内
// 自己把自己的请求配额耗尽——后面的用例被限流拦下而非被"想测的那个原因"拦下(v0.2 首跑时发现的
// 真实测试设计缺陷, 非产品 bug, 记录见下方 freshGrantWallet 注释)。修法: 每个需要精确验证"是哪个
// 具体原因拒绝"的用例都用 freshGrantWallet() 拿一份全新的 grant+wallet, 各自独立的限流配额。
//
// 🔴 v0.3(2026-07-24·MF3 收口, relay 571441ea + gateway 82df7b4f 落地后): relayLastLog 正则猜测升级
// 为结构化 body.reason_code 判据(isRelayDeniedResponse/relayDenyPhase, 见下方定义)——body 有无
// reason_code 精确对应"这条响应是不是 relay denyResult 的拒绝分支"(capability.js:268-282, 只有
// 403 authorization / 503 infra_error 两个拒绝分支带 reason_code)。新增 BUST①-结构化(source_scope
// 不匹配, reason_code 精确命中) + META-CHECK(Bettor 06:35 mandate 落码为永久回归守卫: 把真实 auth
// 拒响应喂进 LAND①-精确同款判据, 亲眼验证判据本身正确判定 FAIL, 非只审断言代码写对) + BUST⑦
// (NWT 06:46 relay_id 不匹配场景移植进 G4 端到端)。旧 relayLastLog 断言保留作补充证据, 非主判据。
//
// 隔离架构（非 live 论证，同门⑤ harness 纪律）：
// ① 独立临时 DB（process.env.DB_PATH 指向 scratch，非 console.db；db/client.js 在 MODULE LOAD 时
//    一次性绑定路径，本文件在任何 import 触发 db/client.js 加载前先设好 env，保证绑定到隔离库）。
// ② 真实 fork 的 relay 子进程（relay-manager.js startRelay 用的同一份 kasia-relay/src/relay.mjs，
//    非 mock），但 KASPA_RPC_URL 指死端口 ws://127.0.0.1:1（零真链接触，同 relay-gate-driver.mjs）。
// ③ 真实 Fastify inject() 调 capability.js 注册的路由处理器（走完整 HTTP handler 代码路径，非直调
//    内部函数），ADMIN_CAPABILITY_GATEWAY_ENABLED=1 只在本进程 env 生效，不碰 live console 进程。
// ④ throwaway CONSOLE_ENCRYPTION_KEY + 一次性生成的 relay/custody 密钥，跑完整个 DB 文件留在
//    scratch/（gitignore 排除），不产生任何持久化副作用。
//
// 跑法(cwd=D:/kanet/kanet): node kasia-console/test-framework/cases/m0c1-gate/g4-pilot-custodial-e2e.mjs

import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB = path.join(ROOT, 'scratch/g4-pilot-e2e.db');
const LOG_DIR = path.join(ROOT, 'logs/test-runs');
const RELAY_ID = 'g4-pilot-relay-0001';
const NETWORK = 'testnet-12';
const DUMMY_TARGET = 'kaspatest:qpseh8ah3vjm5jc38cq0xy219kvctlfmyz8k5zj7v0nfj2lldkjfqf4ppy0f7';

for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
mkdirSync(LOG_DIR, { recursive: true });

// 🔴 顺序 load-bearing: env 必须在任何 db/client.js 触发导入之前设好(该模块 module-load 时一次性
// 绑定 DB_PATH, 后设无效)。本文件此刻还没 import 任何 kasia-console 内部模块, 安全。
process.env.DB_PATH = DB;
process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex'); // throwaway, 64-hex 符合 crypto.js 要求
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1'; // 死端口, 零真链接触(同 relay-gate-driver.mjs 隔离铁律)
process.env.CUSTODIAL_RELAY_ID = RELAY_ID;
process.env.ADMIN_CAPABILITY_GATEWAY_ENABLED = '1'; // 只在本进程 env 生效, 不碰 live console
process.env.ADMIN_M0C1_GATE_ARMED = '1';
// 🔴 relay-manager.js RELAY_DIR 依赖 KANET_ROOT(正常由启动脚本设置), 本脚本独立跑(非经 launcher)
// 必须自己设——踩过坑: 缺此行 relay-manager 用错误硬编码 fallback 'D:/Anthropic/kasia-relay'(不存在
// 的目录), fork() 的 child cwd 指向该目录导致 spawn ENOENT, relay 从未真正启动, 但 startRelay()
// 仍同步返回 {ok:true}(spawn 失败是 fork() 之后异步 'error' 事件, 不会让 startRelay 的 try 块本身
// 抛出)——第一次跑此 harness 时 5/5 全 PASS 但其中 3 条其实是 relay 未启动导致 sendCommandAsync
// 拒绝'Relay not running'(HTTP 500)误判为"未被 400/401/403 拒=通过"的假阳性, 读 evidence log 才
// 发现。这是本 harness 自己的坑, 已修, 记在此处防重踩。
process.env.RELAY_DIR = path.join(ROOT, 'kasia-relay');

const evidence = [];
let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  evidence.push({ label, ok, detail: detail ? String(detail).slice(0, 500) : undefined });
}

// Codex pre-activation D 项修正(2026-07-24)：旧版 reachedExecLayer 用 regex(/RPC down|relay 侧
// 拒绝/) 猜 body.error 文案判定"到达执行层"——这是弱判据本身: gateway 对任何未分类的无 txId 失败
// (含 validateCommandPayload 从没到执行层就被拒的情况)都回同一条固定通用文案"转账未上链（relay
// 无 txId，可能 RPC down 或执行失败）", 这条文案恰好含"RPC down"四字, 会被正则误判成"到达执行层
// 的真实 RPC 失败"。修法: capability.js fallback 分支现在把 relay 实际发的 phase 透传进 body(relay
// 侧 execution 分支本就带 phase:'execution', relay.mjs:1322/1331; validateCommandPayload 失败/
// IPC 超时都拿不到这个字段) —— 直接查 body.phase==='execution' 做精确判定, 不用再猜文案。
function reachedExecLayer(r) {
  const infra = r.status === 500 && /Relay not running|timeout/i.test(r.body?.error || '');
  const reached = (r.status === 200 && r.body?.ok && r.body?.txId) || (r.status === 503 && r.body?.phase === 'execution');
  return reached && !infra;
}
function notWronglyLanded(r) {
  return !(r.status === 200 && r.body?.ok && r.body?.txId);
}
function isInfraFailure(r) {
  return r.status === 500 && /Relay not running|timeout/i.test(r.body?.error || '');
}

// MF3 结构化字段判定(v0.3, Codex/Bettor 强制升级, 替换 v0.2 的 relayLog 正则猜测)。
// capability.js(82df7b4f) 按 relay 结构化 decision 的 phase 三档映射 HTTP 状态(J1 571441ea relay 侧
// + J2 82df7b4f gateway 侧)。deny 分支(403 authorization / 503 infra_error) 本身不直接回传 phase
// 字段(内部只用来选状态码, 不外泄), 但 body.reason_code 的"是否存在"本身就是精确判据: 只有 relay
// denyResult 的两个拒绝分支才带 reason_code; 成功(200)、gateway 早拒验(401/403/503 无 reason_code)
// 都不带。execution phase 失败(503 无 txId 无 reason_code) 现在改查 body.phase(见上方修正)。
function isRelayDeniedResponse(r) {
  return typeof r.body?.reason_code === 'string';
}
function relayDenyPhase(r) {
  if (!isRelayDeniedResponse(r)) return null;
  return r.status === 403 ? 'authorization' : (r.status === 503 ? 'infra_error' : 'unknown-status-with-reason_code');
}

async function main() {
  // ── ① migrate: 建全部依赖表(relay_nodes/identities/m0c1_app_grants/tg_custodial_wallets 等) ──
  const migrateMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/migrate.js')).href);
  await migrateMod.runMigrations();

  const { sqlite } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/client.js')).href);
  const { encrypt } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/services/crypto.js')).href);
  const walletMod = await import(pathToFileURL(path.join(ROOT, 'kasia-relay/src/lib/wallet.mjs')).href);
  const { KaspaWallet } = walletMod;
  const { generateMnemonic, addressFromMnemonic, privKeyHexFromMnemonic } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/services/wallet.js')).href);

  // ── ② relay_nodes: pilot relay 自身身份(privkey-backed, r281 模式) ──
  const relayPriv = randomBytes(32).toString('hex');
  const relayAddress = KaspaWallet.fromPrivateKey(relayPriv, NETWORK).getAddress();
  const nowIso = new Date().toISOString();
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, address, network, privkey_encrypted, poll_ms, is_service, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(RELAY_ID, 'g4-pilot-relay', relayAddress, NETWORK, encrypt(relayPriv), 999999, 0, nowIso, nowIso);

  const kaspa = await import(pathToFileURL(path.resolve(ROOT, 'kasia-relay/node_modules/kaspa-wasm/kaspa.js')).href);
  const appPriv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
  const appPub = appPriv.toPublicKey().toXOnlyPublicKey().toString();

  // 🔴 v0.2 隔离修法: 每个需要"到达 relay 精确验证具体拒绝原因"的用例都拿一份全新 wallet+grant,
  // 避免共享同一 grant_id 时限流配额(每 grant 每 60s ≤3 笔)被前面的用例耗尽, 导致后面用例被限流
  // 拒绝而非被想测的那个原因拒绝(v0.2 首跑时发现的真实测试设计缺陷, 见文件头注释)。
  const allowedAddresses = [];
  function refreshWhitelistEnv() {
    process.env.PILOT_WALLET_ADDRESSES = allowedAddresses.join(',');
  }
  function freshWallet(tgUserIdSuffix) {
    const mnemonic = generateMnemonic();
    const address = addressFromMnemonic(mnemonic, NETWORK);
    sqlite.prepare(`INSERT INTO tg_custodial_wallets (tg_user_id, kaspa_address, mnemonic_encrypted, network, created_at, updated_at)
      VALUES (?,?,?,?,?,?)`).run(`g4-${tgUserIdSuffix}`, address, encrypt(mnemonic), NETWORK, nowIso, nowIso);
    allowedAddresses.push(address); // 网关白名单准入(§2.1) — 累加, 不替换(此前 wallet 依然合法)
    refreshWhitelistEnv();
    return { mnemonic, address, privHex: privKeyHexFromMnemonic(mnemonic) };
  }
  function freshGrant({ walletAddress, maxAmountSompi = 200000000, allowedCommands = ['custodial_transfer'] }) {
    const nowSec = Math.floor(Date.now() / 1000);
    const grantId = randomUUID();
    sqlite.prepare(`INSERT INTO m0c1_app_grants (
        grant_id, app_key_id, app_pubkey, allowed_commands, typed_intent_version, relay_scope, network,
        payee_scope, source_scope, max_amount_sompi, valid_from, valid_until, grant_version, created_at
      ) VALUES (@grant_id,@app_key_id,@app_pubkey,@allowed_commands,@typed_intent_version,@relay_scope,@network,
        @payee_scope,@source_scope,@max_amount_sompi,@valid_from,@valid_until,@grant_version,@created_at)`).run({
      grant_id: grantId, app_key_id: 'g4-pilot-app', app_pubkey: appPub,
      allowed_commands: JSON.stringify(allowedCommands), typed_intent_version: 1,
      relay_scope: JSON.stringify([RELAY_ID]), network: NETWORK,
      payee_scope: JSON.stringify([DUMMY_TARGET]), source_scope: JSON.stringify([walletAddress]),
      max_amount_sompi: maxAmountSompi, valid_from: nowSec, valid_until: nowSec + 7 * 86400, grant_version: 1, created_at: nowSec,
    });
    return grantId;
  }
  /** 一份全新、独立限流配额的 wallet+grant 对(默认 grant 只授权这个新 wallet 的地址)。 */
  function freshGrantWallet(label) {
    const w = freshWallet(label);
    const grantId = freshGrant({ walletAddress: w.address });
    return { ...w, grantId };
  }

  // ── ⑤ 真 fork relay(startRelay, 同 relay-manager 生产路径) ──
  const relayManager = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/services/relay-manager.js')).href);
  const startResult = await relayManager.startRelay(RELAY_ID);
  evidence.push({ label: '(bootstrap) startRelay', ok: !!startResult.ok, detail: JSON.stringify(startResult) });
  if (!startResult.ok) { console.error('relay 启动失败:', startResult); process.exit(1); }
  await relayManager.waitForRelay(RELAY_ID, 20000);

  // ── ⑥ 真 Fastify inject 调 capability.js 路由 ──
  const Fastify = (await import('fastify')).default;
  const fastify = Fastify({ logger: false });
  const capMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/api/capability.js')).href);
  await capMod.registerCapabilityRoutes(fastify);

  const envSDK = await import(pathToFileURL(path.join(ROOT, 'kasia-relay/src/lib/app-envelope.mjs')).href);
  const { envelopeSigningMessage, intentDigestOf, ENVELOPE_PROTOCOL, ENVELOPE_DOMAIN, ENVELOPE_VERSION } = envSDK;

  function buildSignedEnvelope({ intent, grantId, signPriv = appPriv, overrides = {} }) {
    const now = Date.now();
    const env = {
      protocol: ENVELOPE_PROTOCOL, domain: ENVELOPE_DOMAIN, version: ENVELOPE_VERSION,
      app_key_id: 'g4-pilot-app', grant_id: grantId, relay_id: RELAY_ID, network: NETWORK,
      intent_type: 'custodial_transfer', intent_version: 1, intent, intent_digest: intentDigestOf(intent),
      nonce: 'nonce-' + Math.random().toString(36).slice(2), issued_at: now, expires_at: now + 4 * 60 * 1000,
      signature: '00', ...overrides,
    };
    if (!overrides.signature) {
      env.signature = kaspa.signMessage({ message: envelopeSigningMessage(env), privateKey: signPriv });
    }
    return env;
  }

  // NWT note (20:16, non-blocker·打包前要 Bettor 钦定): evidence JSON 原只记 HTTP 层 detail, 具体
  // 拒绝原因只在 relay stdout 没进持久化 artifact——Codex/Owner 光看 evidence 文件分不清每条 BUST
  // 是不是被"对的"闸拦下的, 必须重新跑才能知道。修法: 每次 post 后立即读 relayManager.getStatus()
  // 抓 lastLog(relay 侧 deny 是同步 log 后才 IPC 回执, 时序上 HTTP 响应落地时该行大概率已刷新到
  // stdout), 存进 evidence 条目——非 100% 时序保证, 是"尽力捕获, 非强一致性保证"。
  function relayLastLog() {
    const st = relayManager.getStatus().find((r) => r.relayNodeId === RELAY_ID);
    return st?.lastLog || '(no relay log captured)';
  }

  async function post(envelope) {
    const res = await fastify.inject({ method: 'POST', url: '/api/capability/wallet/transfer', payload: { envelope } });
    let body; try { body = JSON.parse(res.body); } catch { body = { raw: res.body }; }
    return { status: res.statusCode, body, relayLastLog: relayLastLog() };
  }

  // ══ LAND①: 最小正向用例(runbook §4 激活验证判据引用这一条) ══
  {
    const w = freshGrantWallet('land1');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const r = await post(buildSignedEnvelope({ intent, grantId: w.grantId }));
    check('LAND① 最小正向: 到达 relay 执行层(非基础设施失败/非网关拒绝)', reachedExecLayer(r),
      `status=${r.status} body=${JSON.stringify(r.body)} | relayLog=${r.relayLastLog}`);
    // v0.3 升级(Codex/Bettor 强制, 替换 relayLog 正则猜测): body 有无 reason_code 是"这条响应是不是
    // relay denyResult 拒绝分支"的精确结构化判据(非猜日志文本)。这条断言必须在真实 auth 拒场景下真
    // 会 FAIL(Bettor 06:35 mandate: "不再像旧版把 GATE DENY 也当 LAND 过")——下方 BUST① 里的
    // META-CHECK 直接把这个函数喂一份真实 deny 响应, 亲眼验证它确实 FAIL, 非只审断言代码写对。
    check('LAND①-精确 body 无 reason_code(证明真到达 relay 执行层, 非 relay denyResult 拒绝分支)',
      !isRelayDeniedResponse(r), `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // ══ BUST①: 非白名单源地址(grant.source_scope 不含·relay 权威层职责) ══
  {
    const scoped = freshGrantWallet('bust1-scoped');   // grant 只授权这个地址
    const unauthorized = freshWallet('bust1-unauth');  // 网关白名单里(能到 relay), 但不在这个 grant 的 source_scope
    const intent = { fromAddress: unauthorized.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const r = await post(buildSignedEnvelope({ intent, grantId: scoped.grantId }));
    check('BUST① 非白名单源地址(grant 层)未被意外放行(且 relay 基础设施正常响应)',
      notWronglyLanded(r) && !isInfraFailure(r), `status=${r.status} body=${JSON.stringify(r.body)} | relayLog=${r.relayLastLog}`);
    check('BUST①-精确 relay 日志精确命中 source_scope(非泛泛拒绝)', /source_scope/.test(r.relayLastLog), `relayLog=${r.relayLastLog}`);
    // v0.3 升级: 结构化断言取代纯日志正则(82df7b4f: gateway 纯按 relay phase 映射, body.reason_code
    // 透传)——这正是 J2 真对抗测试用的原场景(source_scope 不匹配, 网关早拒验不覆盖·唯 relay
    // checkIntentWithinGrant 权威拦), NWT 06:50 指定把它正式纳入 G4 端到端回归(非另起一套脚本重复
    // 造轮子)。
    check('BUST①-结构化 relay 权威闸真实拒绝(403·phase=authorization)+reason_code精确命中VALUE_NOT_IN_SCOPE_SOURCE',
      r.status === 403 && r.body?.reason_code === 'VALUE_NOT_IN_SCOPE_SOURCE',
      `status=${r.status} body=${JSON.stringify(r.body)}`);

    // ══ META-CHECK(Bettor 06:35 mandate 直接落码为永久回归守卫, 非一次性人工验证): 把这条真实 auth
    // 拒响应喂进 LAND①-精确 用的同一判据(isRelayDeniedResponse), 断言判据本身正确判定"这不是
    // landed"。这是"故意造一个 auth 拒喂进 LAND 用例·亲眼看它 FAIL"的字面落地——不是审断言代码写对,
    // 是拿真实 deny response 实测这个判据函数会不会被这类响应误判成 LAND 通过(v0.1/v0.2 的历史坑:
    // 旧版"没被 400/401/403 拒=通过"的弱判据会被 503+GATE DENY 伪装成基础设施失败的响应骗过)。 ══
    const wouldWronglyLandAsSuccess = r.status === 200 && r.body?.ok && r.body?.txId;
    check('META: LAND①判据在真实 auth 拒(source_scope不匹配)响应上正确判定为FAIL(非误判GATE DENY为LAND通过)',
      !wouldWronglyLandAsSuccess && isRelayDeniedResponse(r) && relayDenyPhase(r) === 'authorization',
      `用 BUST① 真实拒绝 response 喂入 LAND 判据: status=${r.status} 若误判landed=${wouldWronglyLandAsSuccess} isDenied=${isRelayDeniedResponse(r)} phase=${relayDenyPhase(r)}`);
  }

  // ══ BUST⑦(NWT 06:46 场景①移植进 G4 端到端: relay_id 不匹配。网关不校验 envelope.relay_id 字段
  // 内容, 只用它做路由(CUSTODIAL_RELAY_ID() 选转发到哪个 relay 进程), 真正的内容校验在 relay 侧
  // verifyAppEnvelope 权威做——全 E2E HTTP 路径下依然到达 relay 并被 relay 权威闸拦, 非网关早拒验
  // 覆盖场景, 同 BUST① 同款"网关放过·relay 兜底"结构) ══
  {
    const w = freshGrantWallet('bust7-relayid');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const env = buildSignedEnvelope({ intent, grantId: w.grantId, overrides: { relay_id: 'WRONG-RELAY-ID-' + randomUUID() } });
    const r = await post(env);
    check('BUST⑦ relay_id 不匹配被 relay 权威闸拒(403·phase=authorization)+reason_code精确命中RELAY_ID_MISMATCH',
      r.status === 403 && r.body?.reason_code === 'RELAY_ID_MISMATCH',
      `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // ══ BUST⑧(Codex pre-activation D 项·2026-07-24: relay validateCommandPayload 真实失败, 从没到
  // authorizeCommand/执行层就被拒·relay.mjs:340-347)。gateway 的信封结构校验只查 intent 顶层是
  // "object"(shared/lib/app-envelope-canonical.mjs ENVELOPE_FIELDS: intent:'object'), 不校验
  // intent 内部各字段的类型——省略 intent.amount 能骗过网关早拒验(amount cap 检查也只在
  // 'amount' in intent 时才跑, 省略等于跳过), 一路到 relay 才被 COMMAND_PAYLOAD_SCHEMA 的
  // typeof 检查拦下(commands.mjs:197 要求 amount 是 string|number)。这是"造一个畸形 cmd 喂穿
  // gateway 触 validateCommandPayload 失败"的真实端到端场景(非 relay 层直调模拟), 用来验证
  // reachedExecLayer 的 D 项修法是否真堵住了弱判据洞: 旧版正则(/RPC down|relay 侧拒绝/)会把
  // gateway 这条固定通用 503 文案误判成"到达执行层"(文案里恰好含"RPC down"四字), 新版查
  // body.phase==='execution' 应该正确判定 FAIL(relay 根本没跑到 phase='execution' 那步)。 ══
  {
    const w = freshGrantWallet('bust8-payload-invalid');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, network: NETWORK }; // 故意省略 amount
    const r = await post(buildSignedEnvelope({ intent, grantId: w.grantId }));
    check('BUST⑧ 省略 intent.amount 骗过网关早拒验、到达 relay 后被 validateCommandPayload 真实拒绝(非 200 落地)',
      notWronglyLanded(r), `status=${r.status} body=${JSON.stringify(r.body)} | relayLog=${r.relayLastLog}`);
    check('BUST⑧-D项核心攻击靶: reachedExecLayer 正确判定 FAIL(未到执行层, 非误判"到达执行层")——' +
      '旧版正则 /RPC down|relay 侧拒绝/ 会命中 gateway 固定通用文案里的"RPC down"四字, 把这条从没到 authorizeCommand 的响应误判成到达执行层',
      !reachedExecLayer(r), `status=${r.status} body=${JSON.stringify(r.body)} reachedExecLayer(旧regex会给true, 新版应给false)=${reachedExecLayer(r)}`);
    check('BUST⑧-结构化 body.phase 不是 execution(relay 从没跑到 authorizeCommand 后的 switch 执行分支)',
      r.body?.phase !== 'execution', `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // ══ BUST②: 超额度(amount 超 grant.max_amount_sompi=2 KAS·网关早拒验) ══
  {
    const w = freshGrantWallet('bust2');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '999', network: NETWORK };
    const r = await post(buildSignedEnvelope({ intent, grantId: w.grantId }));
    check('BUST② 超额度被网关早拒(403)', r.status === 403, `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // ══ BUST③: 信封已过期(TTL 超窗, 已在过去·relay 侧兜底) ══
  {
    const w = freshGrantWallet('bust3');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const now = Date.now();
    const env = buildSignedEnvelope({ intent, grantId: w.grantId, overrides: { issued_at: now - 20 * 60 * 1000, expires_at: now - 15 * 60 * 1000 } });
    const r = await post(env);
    check('BUST③ 过期信封未被意外放行(relay 侧兜底, 网关早拒验暂未查 TTL·诚实标已知缺口)',
      notWronglyLanded(r) && !isInfraFailure(r), `status=${r.status} body=${JSON.stringify(r.body)} | relayLog=${r.relayLastLog}`);
    check('BUST③-精确 relay 日志精确命中"已过期"(非泛泛拒绝)', /已过期/.test(r.relayLastLog), `relayLog=${r.relayLastLog}`);
  }

  // ══ BUST④: 掉包(intent.target 篡改, digest 自洽被破坏·网关早拒验签名检查直接判) ══
  {
    const w = freshGrantWallet('bust4');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const env = buildSignedEnvelope({ intent, grantId: w.grantId });
    const tampered = { ...env, intent: { ...env.intent, target: 'kaspatest:qzevileviltargetaddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' } };
    const r = await post(tampered);
    check('BUST④ intent 掉包(digest 自洽被破坏)被拦', r.status !== 200 || !r.body.ok,
      `status=${r.status} body=${JSON.stringify(r.body)}`);
    check('BUST④-精确 网关精确回"信封签名验证失败"(非泛泛拒绝)', /信封签名验证失败/.test(r.body?.error || ''), `body=${JSON.stringify(r.body)}`);
  }

  // ══ BUST⑤(Codex RED-not-ready 修正④): custodial 专属 pilot TTL(5min)——10min 跨度在旧全局 1h
  // 上限内合法, 但超 pilot 专属 5min 上限, 区别于 BUST③ 的"已过期"路径(本用例未过期, 只是跨度太长) ══
  {
    const w = freshGrantWallet('bust5');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const now = Date.now();
    const env = buildSignedEnvelope({ intent, grantId: w.grantId, overrides: { issued_at: now, expires_at: now + 10 * 60 * 1000 } });
    const r = await post(env);
    check('BUST⑤ 未过期但超 pilot 专属 5min TTL 上限未被意外放行',
      notWronglyLanded(r) && !isInfraFailure(r), `status=${r.status} body=${JSON.stringify(r.body)} | relayLog=${r.relayLastLog}`);
    check('BUST⑤-精确 relay 日志精确命中"pilot 专属上限"(区别于 BUST③ 的"已过期")', /pilot 专属上限/.test(r.relayLastLog), `relayLog=${r.relayLastLog}`);
  }

  // ══ BUST⑥(Codex RED-not-ready 修正④, Bettor 明确点名"限流超3笔→BUST"): 同一 grant_id 60s 内
  // 第 4 笔请求被网关限流拒绝(J2 checkRateLimit 落码, 每 grant_id 每 60s ≤3 笔) ══
  {
    const w = freshGrantWallet('bust6-ratelimit');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await post(buildSignedEnvelope({ intent, grantId: w.grantId })));
    }
    const first3AllPassedRateLimit = results.slice(0, 3).every((r) => r.status !== 429);
    check('BUST⑥-① 前 3 笔请求(60s 窗口内)未被限流拦(限流阈值刚好 3 笔/60s, 不误伤合法配额内请求)',
      first3AllPassedRateLimit, results.slice(0, 3).map((r) => r.status).join(','));
    const fourth = results[3];
    check('BUST⑥-② 第 4 笔请求(超过 3 笔/60s)被限流拒绝(429)', fourth.status === 429,
      `status=${fourth.status} body=${JSON.stringify(fourth.body)}`);
    check('BUST⑥-精确 网关精确回限流文案(非泛泛拒绝)', /限流/.test(fourth.body?.error || ''), `body=${JSON.stringify(fourth.body)}`);
  }

  // ══ REPLAY(Codex RED-not-ready 修正④): 同一份合法签名信封重放两次——记录已知残留风险(nonce
  // durable 去重归 M0c-3, 本 pilot 不实现, TTL 收窄到 5min 是唯一时间闸)。断言方向反着来: 不是
  // "证明拦住了", 是"证明这个洞确实存在"——第二次重放当前设计预期依然到达执行层, 这份 evidence
  // 是给 Owner 做风险接受决策的具体证据, 不能只在文档里写"诚实残留"没有实测证据。独立 grant(全新
  // 60s/3笔配额), 只发 2 笔, 不会撞上 BUST⑥ 的限流边界。 ══
  {
    const w = freshGrantWallet('replay');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const env = buildSignedEnvelope({ intent, grantId: w.grantId }); // 同一份合法信封, 复用两次(nonce 相同)
    const first = await post(env);
    const second = await post(env); // 原样字节不改, 第二次重放
    check('REPLAY-① 第一次合法信封到达执行层', reachedExecLayer(first), `status=${first.status} body=${JSON.stringify(first.body)}`);
    check('REPLAY-② 已知残留: 原样重放第二次当前设计下依然到达执行层(证明洞存在, 非证明被拦——nonce durable 归 M0c-3)',
      reachedExecLayer(second), `status=${second.status} body=${JSON.stringify(second.body)} | relayLog=${second.relayLastLog}`);
  }

  // ══ REVOCATION(Codex RED-not-ready 修正④): grant 随时吊销实测——用真实 provision.mjs revoke
  // 子命令(非手工 UPDATE DB, 贴近真实 operator 操作路径), 断言吊销后下一条同 grant_id 请求立即被拒,
  // 无缓存窗口(fresh-read-every-time 设计的直接验证) ══
  {
    const w = freshGrantWallet('revoke');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const before = await post(buildSignedEnvelope({ intent, grantId: w.grantId }));
    check('REVOCATION-① 吊销前请求到达执行层(证明吊销后的拒绝不是因为 grant 本来就无效)',
      reachedExecLayer(before), `status=${before.status} body=${JSON.stringify(before.body)}`);

    // 真实 operator 吊销路径(provision.mjs revoke, 非手工 UPDATE), 贴近真实操作。
    const revokeOut = execFileSync('node', [
      path.join(ROOT, 'kasia-console/scripts/m0c1-grant-provision.mjs'), 'revoke',
      '--grant-id', w.grantId, '--db', DB,
    ], { encoding: 'utf8' });

    // 立即(不等待/不重启任何进程)用同一个 grant_id 再发一次——必须被拒, 且精确命中"已吊销"。
    const after = await post(buildSignedEnvelope({ intent, grantId: w.grantId, overrides: { nonce: 'nonce-after-revoke-' + Math.random().toString(36).slice(2) } }));
    check('REVOCATION-② 吊销后立即用同一 grant_id 再发被拒(fresh-read 无缓存窗口)', notWronglyLanded(after),
      `status=${after.status} body=${JSON.stringify(after.body)}`);
    // 🔴 首跑发现自己的测试假设错误(记账): 原以为吊销拒绝发生在 relay 侧(该查 relayLastLog), 实际
    // grant.revoked 检查在网关 earlyRejectCheck 里(cheap-to-expensive 第一批, grant fresh 读那一步
    // 就查了 revoked 字段), 请求根本没到 relay——relayLastLog 会是上一条请求残留的陈旧值, 不是本次
    // 产生的。精确证据应该看 HTTP body(网关自己回的 error 文案), 不是 relayLastLog。
    check('REVOCATION-②-精确 网关早拒验精确回"grant 已吊销"(非泛泛拒绝, 401 状态码+body.error 双确认)',
      after.status === 401 && /grant 已吊销/.test(after.body?.error || ''),
      `revokeOut=${revokeOut.trim()} | status=${after.status} body=${JSON.stringify(after.body)}`);
  }

  // ══ TAINT(Codex RED-not-ready 修正④): exact-secret taint 测试(§8a 原方法论, 首次真落码到可
  // 执行测试)——不测"有没有任何 64-hex 形状的东西"(会被合法 intent_digest/签名/nonce 误伤), 测
  // "这个具体的、真实会被 deriveCustodialExecFields 派生出来的私钥值, 有没有出现在任何一处对外
  // 可见的输出里"(HTTP 回执 body + relay stdout 日志, 这两处是外部可观察面; envelope/intent 本身
  // 结构上不含 privkeyHex 字段, 在 relay 侧单测 scratch/j1-custodial-binder-smoketest.mjs 已验证
  // 过, 本处补的是 E2E 层面外部可观察输出的扫描, 不重复那部分) ══
  {
    const w = freshGrantWallet('taint');
    const intent = { fromAddress: w.address, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const r = await post(buildSignedEnvelope({ intent, grantId: w.grantId }));
    const bodyStr = JSON.stringify(r.body);
    const leakInBody = bodyStr.includes(w.privHex);
    const leakInRelayLog = r.relayLastLog.includes(w.privHex);
    check('TAINT-① HTTP 回执不含真实私钥值(exact-secret 扫描, 非形状匹配)', !leakInBody,
      leakInBody ? 'LEAK DETECTED IN BODY' : `body 干净(status=${r.status})`);
    check('TAINT-② relay 侧日志不含真实私钥值(exact-secret 扫描, 非形状匹配)', !leakInRelayLog,
      leakInRelayLog ? 'LEAK DETECTED IN RELAY LOG' : `relayLog 干净`);
  }

  await relayManager.stopRelay(RELAY_ID);

  // Codex note(非 activation blocker, J1 认领→J1 不在改派 J2): evidence 文件嵌自描述字段，让
  // 证据脱离 git 历史也能自证"是哪个 tip、哪版代码跑的"——sanitized evidence 发布进
  // docs/evidence/ 时经常被单独 fetch/引用，读者手头未必有本地 git checkout 去反查。
  //   - source_commit: 跑这次 harness 时 working tree 的 HEAD（git rev-parse HEAD）。
  //   - harness_blob_sha: 本文件自身内容的 git blob sha。
  //   - load_bearing_blobs: Codex MF1(v0.10 re-review) 升级要求——不止 harness 自身，全部
  //     load-bearing 代码文件（网关+relay 权威闸+grant provision）+ 两份治理文档（runbook/收据
  //     模板）各自的 blob_sha 都嵌进来，读者拿这份 evidence 就能逐一 `git cat-file blob <sha>`
  //     核对"证据对应的到底是哪个版本的每一份 load-bearing 文件"，不用另外去翻 manifest。
  // 全部 best-effort（git hash-object 用 git 自己的 blob 计算方式，非任意 sha256；跑在非 git
  // 环境时不让 evidence 生成本身失败——理论不会发生，防御性处理）。
  const LOAD_BEARING_FILES = {
    capability: 'kasia-console/src/api/capability.js',
    authorize: 'kasia-relay/src/lib/authorize.mjs',
    app_envelope: 'kasia-relay/src/lib/app-envelope.mjs',
    relay: 'kasia-relay/src/relay.mjs',
    grant_provision: 'kasia-console/scripts/m0c1-grant-provision.mjs',
    runbook: 'docs/2026-07-23-m0c-1-pilot-activation-runbook.md',
    receipt_template: 'docs/2026-07-24-m0c-1-pilot-activation-receipt-template.md',
  };
  let sourceCommit = null, harnessBlobSha = null;
  try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* best-effort */ }
  try { harnessBlobSha = execFileSync('git', ['hash-object', fileURLToPath(import.meta.url)], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* best-effort */ }
  const loadBearingBlobs = {};
  for (const [key, relPath] of Object.entries(LOAD_BEARING_FILES)) {
    try { loadBearingBlobs[key] = { path: relPath, blob_sha: execFileSync('git', ['hash-object', relPath], { cwd: ROOT, encoding: 'utf8' }).trim() }; }
    catch { loadBearingBlobs[key] = { path: relPath, blob_sha: null }; }
  }

  // Codex MF1 补项(v0.10 re-review 追加): evidence 除了 blob 指纹集, 还要显式记"跑这次 harness
  // 用的确切调用参数+隔离边界"——读者不能只看到"跑了什么代码", 还要能确认"是在什么条件下跑的"
  // (跟设计文档 §隔离架构 声称的隔离属性对得上, 非凭空信 harness 顶部注释)。这些隔离属性 harness
  // 本来就是这么跑的(见文件头 ①②③④ 注释), 这里只是把它们从"代码里隐含"显式搬进 evidence JSON。
  const runParams = {
    invocation: `node ${path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/')}`,
    cwd: ROOT,
    network: NETWORK,
    harness_path: path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/'),
    isolation: {
      db: 'independent scratch DB (process.env.DB_PATH, 非 console.db)',
      relay: 'real forked relay subprocess (relay-manager.js startRelay, 同生产路径代码, 非 mock)',
      rpc: 'dead port ws://127.0.0.1:1 (零真链接触)',
      keys: 'throwaway 一次性生成 relay/custody 密钥 (每次跑随机生成, 非复用任何真实密钥)',
      console_encryption_key: 'throwaway (randomBytes(32).toString(hex), 非复用 live console 的密钥)',
    },
  };

  const logPath = path.join(LOG_DIR, 'm0c1-g4-pilot-custodial-e2e-latest.json');
  writeFileSync(logPath, JSON.stringify({
    matrix_source: 'docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md §3 + relay-side §5',
    codex_remediation: 'RESPONSE-...PATHB-ACTIVATION(b93134e8) RED-not-ready 修正④: replay/吊销/taint/pilot专属TTL/限流 + 精确reason断言',
    mf3_remediation: 'MF3(relay 571441ea + gateway 82df7b4f): 结构化 body.reason_code 判据取代 relayLastLog 正则 + META-CHECK(真实auth拒response喂入LAND判据验证真FAIL) + BUST⑦(relay_id mismatch)',
    load_bearing_blobs: loadBearingBlobs,
    source_commit: sourceCommit,
    harness_blob_sha: harnessBlobSha,
    run_params: runParams,
    summary: { pass, fail }, evidence,
  }, null, 2));
  console.log(`\nevidence log: ${logPath}`);
  console.log(`\n== G4 pilot custodial e2e harness v0.3: PASS ${pass} / FAIL ${fail} ==`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('G4 harness 异常:', e.stack || e.message);
  process.exit(1);
});
