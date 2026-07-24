// J2 2026-07-25 — G5 real_chain smoke: M0c-1 Path B pilot custodial_transfer 真链落地证明。
//
// 背景 (仿 RC_01 broker/RC_01_buy_kas_real_full.test.mjs 的约定精神, 非照搬其 declarative
// steps/action 字段——m0c1-gate 域全部现有 case 都是"直接 node 调用"的独立 harness 脚本, 没有
// broker 域那套 test.mjs --domain= 发现机制/action 词表, 见 g4-pilot-custodial-e2e.mjs/harness.mjs):
//
// G4(g4-pilot-custodial-e2e.mjs)已用 27/27 真对抗测试把 custodial_transfer 门控**机制**证到底
// (授权/scope/replay/吊销/taint/TTL/限流全覆盖)——但 G4 故意死端口 stub 链(KASPA_RPC_URL=
// ws://127.0.0.1:1, 见其文件头④, "零真链接触"是它的隔离铁律, 不是它的缺陷)。
// 本文件补 G4 唯一没证的那块 delta: 一笔合法请求打到**活的 Console 进程**, 经**真实 armed 的**
// capability 网关, 真广播到 testnet-12, 在链上独立可验证地落地。
//
// 🔴🔴 真钱预算: ≤2 KAS (硬编码 cap, 见 MAX_TRANSFER_KAS 常量, 请求金额超过直接 abort 不发送)。
// 🔴 manual only: 本文件用 `node <path>` 直接调用运行 (同域全部 case 都这样, 没有 cron/batch/CI
//    自动发现机制会碰到它), 但仍显式声明——不进任何自动巡检/回归批跑, 每次运行都是一次有意识的
//    人工触发(带 --confirm 才真发送, 见下方 CLI)。
//
// 🔴 本脚本不provision grant——m0c1_app_grants 写入方静态锚定为 scripts/m0c1-grant-provision.mjs
//    一处(见 m0c1-grant-registry-schema.js 头部, "任何其他写入=实现批 diff 审直接打回"), 且真实
//    grant 是 runbook §3.6 operator 离线步骤的产物、pilot 窗口内应该只有那一份、不该被"跑测试"
//    这个动作反复重新签发/膨胀。本脚本消费一个**已经存在**的 grant(--grant-id/--app-key-id/
//    --app-priv-key-file), 角色是 runbook §4.5"活人手敲 curl"那步的自动化替身, 不是新增授权入口。
//
// gate 条件(硬检查, 跑前必满足, 缺一 abort 不碰钱——非注释声明, 是下面 main() 真代码):
//   ① deployed_commit == 调用方传入的 --expect-package-commit (git rev-parse HEAD) **且**
//      working tree clean(git status --porcelain 非空直接 abort——KANet-UI 2026-07-25 抓到的
//      盲区: HEAD 对但树上有未 commit 改动, "不可变包"保证被绕过, 哪怕改的正是 capability.js 本身)
//   ② **live DB schema currency 预检**(Bettor 2026-07-25 判, 起因: Finding3 排查过程里三方独立
//      实测撞见 live console.db 停在 v190, v191/v192/v193 全没跑——deployed_commit 对(①)不代表
//      live DB schema 也追上了代码里定义的 migration, 这是"代码对"和"数据对"两件独立的事, 之前
//      被默认当一件事)。查 m0c1_app_grants 有 source_scope 列(v191)+tg_custodial_wallets 有
//      access_mode 列(v193)+pilot_rate_limit_log 表存在(v192), 缺一 abort——不满足直接停, 不
//      靠"custodial_transfer 会 fail-closed 恒拒"这种间接安全网(那是真的但不该是唯一防线, 应该
//      在 G5 自己这层就给出清晰诊断而非让 operator 去猜为什么网关一直拒)。
//   ③ grant 只读预检(POST 前先 SELECT m0c1_app_grants, 零写——Bettor 2026-07-25 判): 存在+未吊销
//      +在有效期+source_scope 含 candidate 地址+payee_scope 含 payee 地址+max_amount_sompi 够——
//      dry-run 阶段就能验 grant 是真的/scope 对得上, fail-fast 不用等真 POST 才 403
//   ④ candidate 钱包链上真实余额 ≥ 请求金额 + 预留 gas(0.05 KAS)
//   ⑤ 累计冒烟预算护栏(Bettor 判, 不新开专用 grant): sum 过往 g5 evidence log 里已 landed 的金额,
//      +本次 > SMOKE_BUDGET_KAS(5) 就 abort——防手工重跑把 pilot 唯一那份 grant 的限流/累计额度
//      在测试阶段就提前耗掉。单笔冒烟建议 ≤0.5 KAS(operator 层面的用量建议, 非本文件另立硬 cap)。
//   ⑥ --confirm 标志显式传入 (防误触发, 默认 dry-run 只做①②③④⑤不发送)
//
// 落链验证(HIGH 缺口修正, KANet-UI 2026-07-25 红队抓出+NWT 独立核实: 原版自己手写
// entries.some(txId matched) 即判 landed=true, 等价 p2sh.mjs checkUtxoLanded 的 minDepth=0
// "legacy first-seen"模式——TN12 实测 reorg ~26% 恒常发生, 历史上 first-seen 造成过 phantom-leaf
// 真实事故(hcxu3/clycz 两例, p2sh.mjs:1470-1476 注释), "跟 check_utxo_landed 同一验证语义"这句
// 原先不成立, 因为压根没调用它。修正: **直接 import p2sh.mjs 的 checkUtxoLanded() 本尊**, 传
// minDepth=20(relay.mjs 注释里"register land-gate"用的既有 reorg-safe 默认阈值), 复用它已经踩过
// 坑修好的 4 级字段 fallback(entry.blockDaaScore ?? entry.utxoEntry?.blockDaaScore ?? ...), 不在
// G5 自己代码里另写一份深度计算逻辑。也不读 kaspa_tx_log(本地 indexer 会漏块 + 命中≠仍 canonical,
// 见 memory reference-kaspa-tx-log-indexer-completeness-gap / reference-kaspa-tx-log-hit-is-not-
// canonical-chain-proof)。checkUtxoLanded 走自己的 connectRpc 独立查询, 不经 relay 子进程记账,
// 保住 G5"独立验证"的核心价值。
//
// 用法(KASPA_RPC_URL 必须指向真实 testnet-12 节点, --db 缺省用 live console.db):
//   KASPA_RPC_URL=<真实节点> node kasia-console/test-framework/cases/m0c1-gate/g5-pilot-custodial-real-chain-smoke.mjs \
//     --grant-id <uuid> --app-key-id <id> --app-priv-key-file <path> \
//     --candidate-address kaspatest:... --relay-id <custodial relay id> \
//     --amount-kas 0.5 --expect-package-commit <sha> [--db <path>] [--confirm]
//   缺 --confirm 时只跑①②③④⑤门检+打印将要发送的 envelope 摘要, 不 POST, 不动钱(dry-run 默认)。

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..'); // D:/kanet-tn12
const NETWORK = 'testnet-12';
const MAX_TRANSFER_KAS = 2; // 🔴 真钱预算硬 cap, 不可通过 CLI 参数绕过 (见下方校验)
const SMOKE_BUDGET_KAS = 5; // 🔴 累计护栏(gate④), 不新开 grant, 靠 sum 过往 evidence log 落地金额
const LANDED_MIN_DEPTH = 20; // 同 relay.mjs "register land-gate" 既有 reorg-safe 默认阈值
const GAS_RESERVE_KAS = 0.05;
const CONSOLE_BASE_URL = process.env.G5_CONSOLE_BASE_URL || 'http://127.0.0.1:3200';
const LOG_DIR = path.join(ROOT, 'logs/test-runs');
const LIVE_DB_PATH = path.join(ROOT, 'kasia-console/data/console.db');

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') { out.confirm = true; continue; }
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

function fail(msg) {
  console.error(`[G5] ABORT (gate 未过, 零动钱): ${msg}`);
  process.exit(1);
}

// gate② — live DB schema currency 预检(Bettor 2026-07-25 判, 见文件头背景)。🔴 只读: 三次
// PRAGMA table_info / sqlite_master 查询, 零写。
async function schemaCurrencyCheck(dbPath) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  try {
    const grantCols = db.pragma('table_info(m0c1_app_grants)').map((c) => c.name);
    if (!grantCols.includes('source_scope')) {
      return { ok: false, error: `m0c1_app_grants 缺 source_scope 列(migrate.js v191 未在这份 DB 跑过) — 需先干净重启 console 走完 runMigrations() 到最新版本, 不是本脚本能绕过的` };
    }
    const walletCols = db.pragma('table_info(tg_custodial_wallets)').map((c) => c.name);
    if (!walletCols.includes('access_mode')) {
      return { ok: false, error: `tg_custodial_wallets 缺 access_mode 列(migrate.js v193 未在这份 DB 跑过) — E 隔离(Codex MSG-125)在这份 DB 上形同虚设, 同样需要先重启迁移` };
    }
    const rateLimitTableExists = db.prepare(`SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='pilot_rate_limit_log'`).get().cnt > 0;
    if (!rateLimitTableExists) {
      return { ok: false, error: `pilot_rate_limit_log 表不存在(migrate.js v192 未在这份 DB 跑过) — 限流机制在这份 DB 上不可用(capability.js checkRateLimit 会 fail-closed 拒所有请求, 安全但功能不通), 需要先重启迁移` };
    }
    return { ok: true };
  } finally { db.close(); }
}

// gate③ — grant 只读预检(Bettor 2026-07-25 判: POST 前先验 grant 是真的+scope 对得上, fail-fast,
// 不用等真 POST 才 403)。🔴 必须只读零写——m0c1_app_grants 写入方静态锚定
// scripts/m0c1-grant-provision.mjs 一处, 本函数只 SELECT, 不建表不 INSERT。
async function grantPreCheck({ dbPath, grantId, candidateAddress, payeeAddress, amountSompi }) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT * FROM m0c1_app_grants WHERE grant_id = ?').get(grantId);
    if (!row) return { ok: false, error: `grant_id=${grantId} 不存在于 ${dbPath}` };
    if (row.revoked) return { ok: false, error: 'grant 已吊销(revoked)' };
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec < row.valid_from || nowSec > row.valid_until) {
      return { ok: false, error: `grant 不在有效期(valid_from=${row.valid_from} valid_until=${row.valid_until} now=${nowSec})` };
    }
    const sourceScope = row.source_scope ? JSON.parse(row.source_scope) : null;
    if (!sourceScope || !sourceScope.includes(candidateAddress)) {
      return { ok: false, error: `grant.source_scope(${row.source_scope}) 不含 candidate 地址 ${candidateAddress}` };
    }
    const payeeScope = row.payee_scope ? JSON.parse(row.payee_scope) : null;
    if (!payeeScope || !payeeScope.includes(payeeAddress)) {
      return { ok: false, error: `grant.payee_scope(${row.payee_scope}) 不含 payee 地址 ${payeeAddress}` };
    }
    if (row.max_amount_sompi != null && BigInt(row.max_amount_sompi) < amountSompi) {
      return { ok: false, error: `grant.max_amount_sompi(${row.max_amount_sompi}) < 请求量(${amountSompi})` };
    }
    return { ok: true };
  } finally { db.close(); }
}

// gate⑤ — 累计冒烟预算护栏(Bettor 判: 不新开 grant, 靠 sum 过往 g5 evidence log 里已 landed 的
// 金额, 防手工重跑把 pilot 唯一那份 grant 的限流/累计额度在测试阶段就提前耗掉)。
function sumPastLandedKas(logDir) {
  if (!existsSync(logDir)) return 0;
  let sum = 0;
  for (const f of readdirSync(logDir)) {
    if (!f.startsWith('g5-real-chain-smoke-') || !f.endsWith('.json')) continue;
    try {
      const ev = JSON.parse(readFileSync(path.join(logDir, f), 'utf8'));
      if (ev?.result?.landed) sum += Number(ev.run_params?.amount_kas || 0);
    } catch { /* 单条坏文件不影响累计, best-effort */ }
  }
  return sum;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['grant-id', 'app-key-id', 'app-priv-key-file', 'candidate-address', 'relay-id', 'amount-kas', 'expect-package-commit'];
  for (const k of required) if (!args[k]) fail(`缺必需参数 --${k}`);

  const amountKas = Number(args['amount-kas']);
  if (!Number.isFinite(amountKas) || amountKas <= 0) fail(`--amount-kas 非法: ${args['amount-kas']}`);
  // 🔴 单笔硬 cap(独立于 grant 自己的 max_amount_sompi scope + 独立于下面 gate④ 累计护栏——三层各
  //    管一件事, 不因为 grant 配置错误/累计还没超就能让本脚本单笔发超预算的量):
  if (amountKas > MAX_TRANSFER_KAS) fail(`--amount-kas ${amountKas} 超过硬 cap ${MAX_TRANSFER_KAS} KAS (真钱预算上限, 不可绕过)`);

  // ── gate① deployed_commit == expect-package-commit AND working tree clean ──
  let head;
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch (e) { fail(`git rev-parse HEAD 失败: ${e.message}`); }
  if (head !== args['expect-package-commit']) {
    fail(`deployed_commit(${head}) != --expect-package-commit(${args['expect-package-commit']}) — 本地 checkout 跟预期的 package commit 不一致, 拒绝在未知代码状态下发真钱`);
  }
  // KANet-UI 2026-07-25 抓的盲区: HEAD 对不代表树干净——脏树(哪怕改的是 capability.js 本身)也能
  // 让①字符串比对通过, "deployed==package 这个不可变包保证"被绕过。补 porcelain 检查堵死。
  let porcelain;
  try { porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { fail(`git status --porcelain 失败: ${e.message}`); }
  if (porcelain.trim() !== '') {
    fail(`working tree 不干净(有未 commit 改动) — HEAD SHA 对不代表实际跑的代码 == package_commit 那棵不可变树, 拒绝在未知代码状态下发真钱:\n${porcelain}`);
  }
  console.log(`[G5] gate① PASS — HEAD == expect-package-commit (${head}) 且 working tree clean`);

  // ── gate② live DB schema currency 预检 (Bettor 判, 见文件头背景——Finding3 排查过程撞见的
  //    真阻塞项: deployed code 对不代表 live DB schema 也追上了) ──
  const dbPath = args.db || LIVE_DB_PATH;
  if (!existsSync(dbPath)) fail(`--db 指向的文件不存在: ${dbPath}`);
  const schemaCheck = await schemaCurrencyCheck(dbPath);
  if (!schemaCheck.ok) fail(`gate② FAIL — live DB schema 未追上代码里定义的 migration: ${schemaCheck.error}`);
  console.log('[G5] gate② PASS — live DB 已有 source_scope(v191)/access_mode(v193)/pilot_rate_limit_log(v192)');

  // ── kaspa-wasm (同 relay 那份, 见 app-envelope-sdk.mjs 同款加载路径) ──
  const kaspa = await import(pathToFileURL(path.resolve(ROOT, 'kasia-relay/node_modules/kaspa-wasm/kaspa.js')).href);
  const { RpcClient, Encoding, Address } = kaspa;

  async function withRpc(fn) {
    // 🔴 直连 testnet-12 真实节点 (非 G4 的死端口 ws://127.0.0.1:1) —— G5 存在的唯一理由。
    // 用 KASPA_RPC_URL(不是自定义 G5_ 前缀变量)——p2sh.mjs connectRpc() 内部也直接读这同一个
    // env var(见下方落链验证阶段的 checkUtxoLanded 调用), 两处必须读同一份, 不能各自一套(同
    // pilot-wallet-policy.js 那次"两路各自解析漂移"教训, 这里在 RPC URL 这层也适用)。
    const rpcUrl = process.env.KASPA_RPC_URL;
    if (!rpcUrl || rpcUrl.includes('127.0.0.1:1')) {
      fail('未设 KASPA_RPC_URL (或误继承了 G4 风格死端口) — G5 必须连真实 testnet-12 节点, 不接受死端口/未设 (跟 checkUtxoLanded 内部 connectRpc 用同一个 env var, 不能只设片面的一半)');
    }
    const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: NETWORK });
    try {
      await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 8000))]);
      return await fn(rpc);
    } finally { try { await rpc.disconnect(); } catch {} }
  }

  // ── payee: FaucetRelay-tn (peers.mjs 单一真相源, 不硬编码长地址) ──
  const { relayAddr } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/test-framework/lib/peers.mjs')).href);
  const payee = relayAddr('faucetrelay-tn');
  if (!payee) fail("peers.mjs 缺 'faucetrelay-tn' alias (预期已由这次改动加入, 若报这个错说明改动没落地)");

  const amountSompi = BigInt(Math.round(amountKas * 1e8));

  // ── gate③ grant 只读预检 (Bettor 判, 见文件头) ──
  const grantCheck = await grantPreCheck({
    dbPath, grantId: args['grant-id'], candidateAddress: args['candidate-address'],
    payeeAddress: payee, amountSompi,
  });
  if (!grantCheck.ok) fail(`gate③ FAIL — grant 只读预检未过: ${grantCheck.error}`);
  console.log(`[G5] gate③ PASS — grant(${args['grant-id']}) 存在+未吊销+在有效期+scope 覆盖 candidate/payee+amount 在 cap 内`);

  // ── gate④ candidate 钱包链上真实余额 ≥ amount + gas ──
  const balanceSompi = await withRpc(async (rpc) => {
    const { entries } = await rpc.getUtxosByAddresses([new Address(args['candidate-address'])]);
    return (entries || []).reduce((s, e) => s + BigInt(e.amount ?? e.utxoEntry?.amount ?? 0), 0n);
  });
  const balanceKas = Number(balanceSompi) / 1e8;
  const neededKas = amountKas + GAS_RESERVE_KAS;
  if (balanceKas < neededKas) {
    fail(`candidate 钱包(${args['candidate-address']}) 链上真实余额 ${balanceKas} KAS < 需要 ${neededKas} KAS (amount+gas) — 独立于 relay/gateway 自己的余额检查(capability.js 目前没有事前余额校验, 这是本脚本自己的纵深防御门)`);
  }
  console.log(`[G5] gate④ PASS — candidate 余额 ${balanceKas} KAS >= 需要 ${neededKas} KAS`);

  // ── gate⑤ 累计冒烟预算护栏 (Bettor 判, 见文件头) ──
  const pastLandedKas = sumPastLandedKas(LOG_DIR);
  if (pastLandedKas + amountKas > SMOKE_BUDGET_KAS) {
    fail(`gate⑤ FAIL — 累计冒烟预算超限: 过往已 landed ${pastLandedKas} KAS + 本次 ${amountKas} KAS > 预算上限 ${SMOKE_BUDGET_KAS} KAS (防手工重跑耗光 pilot grant 额度, 不是新开 grant 而是攒计数)`);
  }
  console.log(`[G5] gate⑤ PASS — 累计冒烟预算 ${pastLandedKas} + ${amountKas} <= ${SMOKE_BUDGET_KAS} KAS`);

  // ── 构造+签名 envelope (复用 app-envelope-sdk.mjs, 跟 grant 签发端/relay 验证端同一份 canonical
  //    定义, 单一真相源——不是本脚本自己发明一套编码) ──
  const { buildAppCmd } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/test-framework/lib/app-envelope-sdk.mjs')).href);
  const appPrivHex = readFileSync(args['app-priv-key-file'], 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(appPrivHex)) fail('--app-priv-key-file 内容不是 64 位 hex 私钥 (格式不对, 拒绝往下走)');

  const intent = { fromAddress: args['candidate-address'], target: payee, amount: amountKas.toFixed(8), network: NETWORK };
  const cmd = buildAppCmd({
    type: 'custodial_transfer', intent,
    appKeyId: args['app-key-id'], grantId: args['grant-id'], relayId: args['relay-id'],
    network: NETWORK, privkeyHex: appPrivHex,
  });

  console.log(`[G5] envelope 构造完成: intent=${JSON.stringify(intent)} grant_id=${args['grant-id']} app_key_id=${args['app-key-id']}`);

  if (!args.confirm) {
    console.log('[G5] dry-run (未传 --confirm) — gate①②③④⑤已过, envelope 已构造但不发送. 加 --confirm 真执行.');
    process.exit(0);
  }

  // ── gate⑥: POST 真发。disabled/relay 未 armed/relay id 未配 这几种 pre-flight 拒绝(capability.js
  //    :218/243/249)目前都只有 { ok:false, error:<string> } 形状, 没有稳定的 reason_code 字段可判
  //    (NWT 2026-07-25 逐字核实确认)——Bettor 判: 与其猜文案正则(文案一改就静默误判), 不如干脆
  //    不区分"具体是哪种 pre-flight 拒绝", 任何非 200/非 ok 一律统一 abort(操作上这几种失败原因
  //    对本脚本而言结果都一样: 停, 不发钱), 原始 body 全量打印供人工诊断。 ──
  const res = await fetch(`${CONSOLE_BASE_URL}/api/capability/wallet/transfer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: cmd.envelope }),
    signal: AbortSignal.timeout(45000), // 同 portfolio.eta 转账调用惯例(真钱操作, 非查询级短 timeout)
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || !body.ok) {
    fail(`网关拒绝: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  // 成功响应形状(capability.js:298 逐字核过): { ok:true, txId, amount, target, fromAddress } — 扁平, 非嵌套 result。
  const txId = body.txId;
  if (!txId) fail(`网关返回 ok 但无 txId: ${JSON.stringify(body)}`);
  console.log(`[G5] 网关接受, txId=${txId}`);

  // ── 落链验证: 直接复用 p2sh.mjs 的 checkUtxoLanded() 本尊(minDepth=20), 不在本文件另写一份深度
  //    计算——HIGH 缺口修正, 见文件头 ──
  const { checkUtxoLanded } = await import(pathToFileURL(path.join(ROOT, 'kasia-relay/src/lib/p2sh.mjs')).href);
  let landed = false, landedDepth = null;
  for (let attempt = 0; attempt < 20 && !landed; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await checkUtxoLanded(payee, txId, NETWORK, LANDED_MIN_DEPTH);
    landed = r.landed;
    landedDepth = r.depth ?? null;
  }

  mkdirSync(LOG_DIR, { recursive: true });
  let sourceCommit = null, harnessBlobSha = null;
  try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
  try { harnessBlobSha = execFileSync('git', ['hash-object', fileURLToPath(import.meta.url)], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}

  const evidence = {
    harness: 'g5-pilot-custodial-real-chain-smoke.mjs',
    source_commit: sourceCommit,
    harness_blob_sha: harnessBlobSha,
    run_params: {
      network: NETWORK, amount_kas: amountKas, payee_alias: 'faucetrelay-tn', payee_address: payee,
      candidate_address: args['candidate-address'], grant_id: args['grant-id'], app_key_id: args['app-key-id'],
      expect_package_commit: args['expect-package-commit'], console_base_url: CONSOLE_BASE_URL,
    },
    result: {
      ok: landed, txId, landed, landed_depth: landedDepth, landed_min_depth: LANDED_MIN_DEPTH,
      landed_verification: 'p2sh.mjs checkUtxoLanded() 本尊(独立 RPC 查询, 非 relay 子进程记账), minDepth=20 reorg-safe, NOT kaspa_tx_log (indexer completeness gap + hit≠still-canonical)',
    },
  };
  const logPath = path.join(LOG_DIR, `g5-real-chain-smoke-${Date.now()}.json`);
  writeFileSync(logPath, JSON.stringify(evidence, null, 2));
  console.log(`\nevidence log: ${logPath}`);

  if (!landed) fail(`轮询 20 次(≥60s)未确认 txId=${txId} 在 payee(${payee}) 达到 minDepth=${LANDED_MIN_DEPTH} 的落地深度 — 可能广播成功但仍浅确认/mempool 慢/reorg 退回/真丢了, 需人工排查(evidence log 已写, landed_depth 字段记最后一次读到的深度)`);
  console.log(`[G5] PASS — txId=${txId} 已在 payee 真实 UTXO 集合中确认落地(depth=${landedDepth} >= minDepth=${LANDED_MIN_DEPTH})`);
}

main().catch((e) => { console.error('[G5] 异常:', e.stack || e.message); process.exit(1); });
