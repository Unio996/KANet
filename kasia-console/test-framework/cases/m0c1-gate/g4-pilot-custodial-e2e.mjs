// M0c-1 机制A — G4 pilot custodial_transfer 真 E2E harness（gateway→relay 全链路，非孤立单测）
// 设计: docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md §3 (与 runbook §4 激活验证判据共用)
//       docs/2026-07-23-m0c-1-path-b-pilot-containment-relay-side.md §5
// 派工: Bettor 工作流① J1 域最后一块。runbook §4 激活验证的"e2e 最小 smoke"直接引用本文件的最小
// 正向 LAND 用例（单一真相源，不建第二套 smoke——KANet-UI `bde13e51` 已锚定这个依赖方向）。
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

async function main() {
  // ── ① migrate: 建全部依赖表(relay_nodes/identities/m0c1_app_grants/tg_custodial_wallets 等) ──
  const migrateMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/migrate.js')).href);
  await migrateMod.runMigrations();

  const { sqlite } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/client.js')).href);
  const { encrypt } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/services/crypto.js')).href);
  const walletMod = await import(pathToFileURL(path.join(ROOT, 'kasia-relay/src/lib/wallet.mjs')).href);
  const { KaspaWallet } = walletMod;

  // ── ② relay_nodes: pilot relay 自身身份(privkey-backed, r281 模式) ──
  const relayPriv = randomBytes(32).toString('hex');
  const relayAddress = KaspaWallet.fromPrivateKey(relayPriv, NETWORK).getAddress();
  const nowIso = new Date().toISOString();
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, address, network, privkey_encrypted, poll_ms, is_service, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(RELAY_ID, 'g4-pilot-relay', relayAddress, NETWORK, encrypt(relayPriv), 999999, 0, nowIso, nowIso);

  // ── ③ tg_custodial_wallets: pilot 专用托管钱包(真加密助记词, 走真 decrypt+derive 路径) ──
  const { generateMnemonic, addressFromMnemonic } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/services/wallet.js')).href);
  const pilotMnemonic = generateMnemonic();
  const pilotAddress = addressFromMnemonic(pilotMnemonic, NETWORK);
  sqlite.prepare(`INSERT INTO tg_custodial_wallets (tg_user_id, kaspa_address, mnemonic_encrypted, network, created_at, updated_at)
    VALUES (?,?,?,?,?,?)`).run('g4-pilot-tg-user', pilotAddress, encrypt(pilotMnemonic), NETWORK, nowIso, nowIso);

  // ── ④ app 签名密钥 + pilot grant(source_scope 只含 pilotAddress·围栏核心) ──
  const kaspa = await import(pathToFileURL(path.resolve(ROOT, 'kasia-relay/node_modules/kaspa-wasm/kaspa.js')).href);
  const appPriv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
  const appPub = appPriv.toPublicKey().toXOnlyPublicKey().toString();
  const nowSec = Math.floor(Date.now() / 1000);
  const grantId = randomUUID();
  sqlite.prepare(`INSERT INTO m0c1_app_grants (
      grant_id, app_key_id, app_pubkey, allowed_commands, typed_intent_version, relay_scope, network,
      payee_scope, source_scope, max_amount_sompi, valid_from, valid_until, grant_version, created_at
    ) VALUES (@grant_id,@app_key_id,@app_pubkey,@allowed_commands,@typed_intent_version,@relay_scope,@network,
      @payee_scope,@source_scope,@max_amount_sompi,@valid_from,@valid_until,@grant_version,@created_at)`).run({
    grant_id: grantId, app_key_id: 'g4-pilot-app', app_pubkey: appPub,
    allowed_commands: JSON.stringify(['custodial_transfer']), typed_intent_version: 1,
    relay_scope: JSON.stringify([RELAY_ID]), network: NETWORK,
    payee_scope: JSON.stringify([DUMMY_TARGET]), source_scope: JSON.stringify([pilotAddress]),
    max_amount_sompi: 200000000, // 2 KAS (J1 数值提案·待 Bettor 最终 ratify, 此处用作 harness 默认)
    valid_from: nowSec, valid_until: nowSec + 7 * 86400, grant_version: 1, created_at: nowSec,
  });

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

  function buildSignedEnvelope({ intent, signPriv = appPriv, overrides = {} }) {
    const now = Date.now();
    const env = {
      protocol: ENVELOPE_PROTOCOL, domain: ENVELOPE_DOMAIN, version: ENVELOPE_VERSION,
      app_key_id: 'g4-pilot-app', grant_id: grantId, relay_id: RELAY_ID, network: NETWORK,
      intent_type: 'custodial_transfer', intent_version: 1, intent, intent_digest: intentDigestOf(intent),
      nonce: 'nonce-' + Math.random().toString(36).slice(2), issued_at: now, expires_at: now + 5 * 60 * 1000,
      signature: '00', ...overrides,
    };
    if (!overrides.signature) {
      env.signature = kaspa.signMessage({ message: envelopeSigningMessage(env), privateKey: signPriv });
    }
    return env;
  }

  // NWT note (20:16, non-blocker·打包前要 Bettor 钦定): evidence JSON 原只记 HTTP 层 detail(LAND①/
  // BUST①/③ 三条撞车成同一句通用 503, 具体拒绝原因只在 relay stdout 没进持久化 artifact——Codex/
  // Owner 光看 evidence 文件分不清每条 BUST 是不是被"对的"闸拦下的, 必须重新跑才能知道)。修法:
  // 每次 post 后立即读 relayManager.getStatus() 抓 lastLog(relay 侧 deny 是同步 log 后才 IPC 回执,
  // 时序上 HTTP 响应落地时该行大概率已刷新到 stdout), 存进 evidence 条目——非 100% 时序保证(极端
  // 情况 log flush 可能慢于 IPC 回执), 诚实标为"尽力捕获, 非强一致性保证"。
  function relayLastLog() {
    const st = relayManager.getStatus().find((r) => r.relayNodeId === RELAY_ID);
    return st?.lastLog || '(no relay log captured)';
  }

  async function post(envelope) {
    const res = await fastify.inject({ method: 'POST', url: '/api/capability/wallet/transfer', payload: { envelope } });
    let body; try { body = JSON.parse(res.body); } catch { body = { raw: res.body }; }
    return { status: res.statusCode, body, relayLastLog: relayLastLog() };
  }

  // ══ LAND: 最小正向用例(runbook §4 激活验证判据引用这一条) ══
  {
    const intent = { fromAddress: pilotAddress, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const { status, body, relayLastLog } = await post(buildSignedEnvelope({ intent }));
    // 🔴 断言收紧(不只"非 400/401/403"): 必须明确排除"relay 根本没起来"这类基础设施失败(500 +
    // 'Relay not running'/'timeout'类 sendCommandAsync 拒绝), 否则会跟"到达 relay 执行层, 因隔离
    // 死 RPC 端口连不上链才失败"(503, 预期证据)混为一谈——这正是本 harness 第一版踩过的假阳性坑
    // (见上方 KANET_ROOT 注释): 当时 relay 没启动, LAND① 因为凑巧不是 400/401/403 而"通过", 实际
    // 什么都没验证到。改为白名单式判定: 只有 txId 落地(真上链, 隔离环境理论不该发生但留口子)或
    // 503+'RPC down'/'relay 侧拒绝' 这个已知执行层失败签名才算 PASS。
    const infraFailure = status === 500 && /Relay not running|timeout/i.test(body?.error || '');
    const reachedExecutionLayer = (status === 200 && body?.ok && body?.txId) ||
      (status === 503 && /RPC down|relay 侧拒绝/.test(body?.error || ''));
    check('LAND① 最小正向: 到达 relay 执行层(非基础设施失败/非网关拒绝)', reachedExecutionLayer && !infraFailure,
      `status=${status} body=${JSON.stringify(body)} | relayLog=${relayLastLog}`);
  }

  // ══ BUST 1: 非白名单源地址(source_scope 不含) ══
  {
    const otherMnemonic = generateMnemonic();
    const otherAddress = addressFromMnemonic(otherMnemonic, NETWORK);
    sqlite.prepare(`INSERT INTO tg_custodial_wallets (tg_user_id, kaspa_address, mnemonic_encrypted, network, created_at, updated_at)
      VALUES (?,?,?,?,?,?)`).run('g4-other-tg-user', otherAddress, encrypt(otherMnemonic), NETWORK, nowIso, nowIso);
    const intent = { fromAddress: otherAddress, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const { status, body, relayLastLog } = await post(buildSignedEnvelope({ intent }));
    // 网关早拒验不查 source_scope(§2.1: 那是 relay 权威层职责, 网关只做 cheap 早拒+DoS 护栏)——
    // 网关会放过这条(签名/amount/payee 都合法), 期待在 relay 侧被 source_scope 维度拒。
    // 🔴 诚实边界(同 LAND① 教训): capability.js 把"relay 主动 deny"和"relay RPC 连不上"都映射成
    // 同一个通用 503"转账未上链", HTTP body 本身分不清"source_scope 精确拦下"vs"任意原因失败"——
    // 但 relayLastLog(NWT note 采纳, 20:16) 捕获了 relay 侧真实 log 行, evidence log 里能独立核实
    // 具体命中 source_scope(不用重跑)。断言仍只判"没被意外放行+基础设施正常"(双重: HTTP 层弱判据
    // 兜底 + evidence log 强证据人工可核), detail 里带 relayLog 供 Codex/Owner 独立核对具体原因。
    const infraFailure = status === 500 && /Relay not running|timeout/i.test(body?.error || '');
    const notWronglyAllowed = !(status === 200 && body?.ok && body?.txId);
    check('BUST① 非白名单源地址未被意外放行(且 relay 基础设施正常响应)', notWronglyAllowed && !infraFailure,
      `status=${status} body=${JSON.stringify(body)} | relayLog=${relayLastLog}`);
  }

  // ══ BUST 2: 超额度(amount 超 grant.max_amount_sompi=2 KAS) ══
  {
    const intent = { fromAddress: pilotAddress, target: DUMMY_TARGET, amount: '999', network: NETWORK };
    const { status, body, relayLastLog } = await post(buildSignedEnvelope({ intent }));
    // amount cap 是网关早拒验(§earlyRejectCheck)自己判的, HTTP status=403 本身就是精确证据(不依赖
    // relay 侧, relayLastLog 这条不适用——网关层直接拒, 请求根本没到 relay), 仍记 relayLastLog
    // 便于跟其它三条 evidence 条目格式一致(值应显示上一条请求残留的 log, 非本条产生)。
    check('BUST② 超额度被网关早拒(403)', status === 403, `status=${status} body=${JSON.stringify(body)} | relayLog(网关层拒·未到relay)=${relayLastLog}`);
  }

  // ══ BUST 3: 信封已过期(TTL 超窗) ══
  {
    const intent = { fromAddress: pilotAddress, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const now = Date.now();
    const env = buildSignedEnvelope({ intent, overrides: { issued_at: now - 20 * 60 * 1000, expires_at: now - 15 * 60 * 1000 } });
    const { status, body, relayLastLog } = await post(env);
    // 网关早拒验目前不查 TTL(§2.3 记录的诚实缺口, pilot 阶段待补)——relay 侧 verifyAppEnvelope
    // 会拒(过期)。同 BUST①诚实边界: 断言只判"没被意外放行+基础设施正常", relayLastLog 记进
    // detail 供独立核实具体命中"envelope 已过期"(NWT note 采纳)。
    const infraFailure = status === 500 && /Relay not running|timeout/i.test(body?.error || '');
    const notWronglyAllowed = !(status === 200 && body?.ok && body?.txId);
    check('BUST③ 过期信封未被意外放行(relay 侧兜底, 网关早拒验暂未查 TTL·诚实标已知缺口)', notWronglyAllowed && !infraFailure,
      `status=${status} body=${JSON.stringify(body)} | relayLog=${relayLastLog}`);
  }

  // ══ BUST 4: 掉包(签名意图 amount=1, 实际请求体 target 字段被篡改成别的地址, 签名对不上) ══
  {
    const intent = { fromAddress: pilotAddress, target: DUMMY_TARGET, amount: '1', network: NETWORK };
    const env = buildSignedEnvelope({ intent });
    // 偷签名不改签名字段, 只改 intent.target(掉包) —— intent_digest 会对不上, 网关早拒验目前不查
    // digest 自洽(那是 relay 侧 verifyAppEnvelope 的 step)——网关会转发, relay 侧拒。
    const tampered = { ...env, intent: { ...env.intent, target: 'kaspatest:qzevileviltargetaddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' } };
    const { status, body, relayLastLog } = await post(tampered);
    // 精确证据(不依赖 relayLastLog): 网关早拒验的签名检查直接判(body.error 里带具体文案"信封签名
    // 验证失败"), 请求根本没到 relay(掉包让签名对不上, 网关早拒验第一层就拦), status 本身是精确判据。
    const bust = status !== 200 || !body.ok;
    check('BUST④ intent 掉包(digest 自洽被破坏)被拦', bust, `status=${status} body=${JSON.stringify(body)} | relayLog(网关层拒·未到relay)=${relayLastLog}`);
  }

  await relayManager.stopRelay(RELAY_ID);

  const logPath = path.join(LOG_DIR, 'm0c1-g4-pilot-custodial-e2e-latest.json');
  writeFileSync(logPath, JSON.stringify({
    matrix_source: 'docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md §3 + relay-side §5',
    summary: { pass, fail }, evidence,
  }, null, 2));
  console.log(`\nevidence log: ${logPath}`);
  console.log(`\n== G4 pilot custodial e2e harness: PASS ${pass} / FAIL ${fail} ==`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('G4 harness 异常:', e.stack || e.message);
  process.exit(1);
});
