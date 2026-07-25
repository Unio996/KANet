// J2 2026-07-25 — G5 v2 real_chain smoke: M0c-1 Path B pilot custodial_transfer 真链落地证明。
//
// v2 全面重写（Codex RESPONSE-20260725-MSG131, origin/coord/codex-bridge, verdict=
// BLOCKED_DO_NOT_RUN_G5·6 P0+3 P1 全修）——v1（commit d725000c）被判"结构性缺口, 非小补丁能过"。
// 设计稿: scratch/j2-g5-v2-redesign-design.md（NWT+KANet-UI 双 GREEN + Bettor sign-off #zkip4w）。
//
// 背景: G4(g4-pilot-custodial-e2e.mjs) 27/27 已证 custodial_transfer 门控**机制**（隔离环境, 死端口
// stub 链）。G5 补的 delta: 一笔合法请求打到活的 Console 进程, 经真实 armed 网关, 真广播到
// testnet-12, 独立可验证落地——这是唯一没被机制测试覆盖的那块（真实身份/真实资金/真实链）。
//
// **external harness 模型**（P0-3, 跟 Bettor 对齐 #zkfi4w）: G5 自己独立证明 live Console 仍在
// accepted package（当前 5b804ed0）——不把 G5 并入 accepted package 本身（那会让"测试工具"跟
// "被测系统"共用一个身份, 制造混淆）。
//
// 🔴🔴 真钱预算: ≤2 KAS/单笔硬 cap（MAX_TRANSFER_KAS） + ≤5 KAS 累计护栏（SMOKE_BUDGET_KAS,
// 跨 journal 全状态计入, 见 P0-5）。
// 🔴 manual only: `node <path>` 直接调用, 无 cron/batch 自动发现机制。
// 🔴 不 provision grant: m0c1_app_grants 写入方静态锚定 scripts/m0c1-grant-provision.mjs 一处;
//    本脚本消费一个已存在的 grant, 是 runbook §4.5 人工步骤的自动化替身, 不是新增授权入口。
//
// gate 条件（硬检查, 跑前必满足, 缺一 abort 不碰钱——NWT 2026-07-25 抓的编号打架: 实际是 9 个
// 顺序检查, 原来 grant 只读预检没算进清单、误标成跟身份证据同一个编号, 现全部理顺):
//   ① 本地 checkout: git status --porcelain clean（working tree 未 commit 改动即拒——防"脏树
//      也能过 HEAD 检查"这个绕过口）
//   ② 授权快照（P0-6, --snapshot 必传）: 单一不可变 JSON, 每个字段跟运行时/请求值逐字符相等
//      （非成员检查）, enforce source_scope/payee_scope/relay_scope 长度==1, precheck
//      allowed_commands 恰好 ['custodial_transfer']、network 恰好 'testnet-12'
//   ③ 运行时身份双层证据（P0-1+P0-2, 见下方 verifyRuntimeIdentity()）: ①进程自证(loopback-only
//      查 runtime-identity 端点, 拒绝 git_commit/db_stat 为 null) ②磁盘 runtime-equivalence
//      （git diff RUNTIME_SCOPE_DIRS 范围空 或 commit 逐字相等）③ db_path/db_stat 逐字段比对
//      snapshot 声明值
//   ④ live DB schema currency（v1 遗留, 仍需要）: source_scope/access_mode/pilot_rate_limit_log
//      三项 migration 已应用
//   ⑤ grant 只读预检: 存在+未吊销+在有效期+scope 覆盖 candidate/payee 地址+max_amount_sompi 够
//   ⑥ OS 原子排他锁（P0-4）: fs.openSync(LOCK_PATH,'wx') 失败即 abort, 打印现存锁内容, 不自动
//      清理/不自动重试（stale 锁=信号, 需要人来看, 不是软件自己猜)——排在余额检查(⑧)之前, 本地纯
//      文件系统检查该先于真链 RPC 调用(cheap-to-expensive), 省得白打一次 RPC 才发现锁被占。
//   ⑦ 累计预算护栏（P0-5, 见 sumSpentKasAndFindAmbiguous()）: 扫全部 journal, 除 failed(从未真
//      提交)外全计入累计（非只算 landed——一笔钱一旦 submitted 就已经真花出去了) + 未 reconcile
//      的记录（state∈{prepared,submitted,ambiguous}, 写测试时自查发现 prepared/submitted 单独
//      被杀也是"结果未知"跟 ambiguous 同类, 三者统一拦, 非只拦 ambiguous）必须先 reconcile 才准
//      新 POST（P1-3）。POST 拿到 ok:true 但响应缺 txId 这种违反 capability.js 自身契约的边界情况
//      也标 ambiguous(非 failed)——不能假设"响应畸形=钱肯定没花"（Bettor 2026-07-25 追问抓到）。
//   ⑧ candidate 钱包链上真实余额 ≥ 请求金额 + 预留 gas(0.05 KAS)
//   ⑨ --confirm 显式传入（防误触发, 默认 dry-run）
//
// atomic journal（P0-5）: POST 前原子写 prepared（写临时文件+rename）; POST 响应后立刻更新
// submitted+txId（哪怕后面轮询进程被杀, 这条已经落盘); 轮询超时→ambiguous（非 failed, P1-3);
// 确认 landed→landed。**损坏/不可解析的 journal 文件 halt 整个预算门（不是 catch{} 跳过）**。
//
// 落链验证: 直接 import p2sh.mjs 的 checkUtxoLanded() 本尊（minDepth=20, reorg-safe), 不读
// kaspa_tx_log（本地 indexer 会漏块+命中≠仍 canonical）。
//
// 用法（KASPA_RPC_URL 必须指向真实 testnet-12 节点）:
//   KASPA_RPC_URL=<真实节点> node .../g5-pilot-custodial-real-chain-smoke.mjs \
//     --snapshot <授权快照路径> --app-priv-key-file <路径> --amount-kas 0.5 [--confirm]
//   缺 --confirm 时只跑①-⑧门检+打印将要发送的 envelope 摘要, 不 POST, 不动钱（dry-run 默认）。
//   --db 已移除（P0-1, 不再是可设参数——db 路径永远来自 runtime-identity 端点的权威读数）。

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync, openSync, closeSync, writeSync, lstatSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getRepoRoot } from '../../../src/lib/repo-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 🔴 改用 getRepoRoot() 共享 helper(向上 walk 找 .git 目录), 不再硬编码'../../../..'层数——
// 这类"每个文件各自数斜杠"的 bug 这轮在 health.js/reconcile 脚本连撞两次, G5 本身虽然算对了
// 也是手数斜杠蒙对的, 三方(Bettor/NWT/KANet-UI)独立收敛到同一个根治修法(2026-07-25 定案)。
const ROOT = getRepoRoot(HERE); // D:/kanet-tn12
const NETWORK = 'testnet-12';
const MAX_TRANSFER_KAS = 2; // 🔴 单笔硬 cap, 独立于 grant 自己的 max_amount_sompi + 独立于累计护栏
const SMOKE_BUDGET_KAS = 5; // 🔴 累计护栏(gate⑦), 跨全部 journal 状态计入(P0-5)
const LANDED_MIN_DEPTH = 20; // 同 relay.mjs "register land-gate" 既有 reorg-safe 默认阈值
const GAS_RESERVE_KAS = 0.05;
const CONSOLE_BASE_URL = process.env.G5_CONSOLE_BASE_URL || 'http://127.0.0.1:3200';
const LOCK_PATH = path.join(ROOT, 'scratch/g5.lock'); // 🔴 P0-4: single-pilot 简化假设——目前只
// 有一个 pilot grant, 全局单锁没问题; 以后若多个 pilot 并存, 这把全局锁会把互不相关的 pilot smoke
// 也串行化。现在不用改, 只标注这条隐含前提(KANet-UI 2026-07-25 提)。
const JOURNAL_DIR = path.join(ROOT, 'scratch/g5-journal'); // P0-5, 清理用独立脚本
  // m0c1-g5-journal-gc.mjs（不塞进本文件——"跑一次 smoke"和"清理历史 journal"保持两个独立可审动作)。
// P0-2 runtime-equivalence 范围(KANet-UI/NWT/Bettor 三方对齐 #zkip4w): package.json/
// package-lock.json 纳入(依赖改动确实影响 runtime, 加进去成本≈免费)。node_modules 太大且
// gitignore, 不纳入范围, 是已知局限如实标注(非隐藏)。
const RUNTIME_SCOPE_DIRS = ['kasia-console/src', 'kasia-relay/src', 'package.json', 'package-lock.json'];

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') { out.confirm = true; continue; }
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

// 🔴 NWT+KANet-UI 2026-07-25 code review 抓到的实 bug: 原来这里直接 process.exit(1)——Node.js
// 里 process.exit() 同步调用会跳过外层 try/finally 的 finally 块(独立验证过: try{process.exit(1)}
// finally{...} 那个 finally 永远不跑)。gate⑦拿到锁之后任何走 fail() 的路径(预算超限/网关拒绝/无
// txId/轮询超时ambiguous 等——都是常见路径, 非罕见)都会导致锁文件永久卡住, 不是"stale 锁=偶发
// 信号", 是"几乎每次非 happy-path 失败都卡锁"。修法: fail() 改成 throw, 让它像正常异常一样沿调用
// 栈往上走(finally 块会正常触发), 真正的 process.exit() 收拢到 main().catch() 这一个入口。
class GateFailError extends Error {}
function fail(msg) {
  throw new GateFailError(msg);
}

// ── canonical decimal amount 解析（P1-1）: 只接受 <=8 位小数十进制字符串, 手算 BigInt, 不过
//    Number()/浮点。同 m0c1-grant-provision.mjs kasToSompiInt() 惯用法。 ──
function kasToSompiBigInt(s) {
  const m = /^([0-9]+)(?:\.([0-9]{1,8}))?$/.exec(String(s).trim());
  if (!m) fail(`--amount-kas 非 canonical decimal 字符串(须 <=8 位小数, 收到: ${s})`);
  return BigInt(m[1]) * 100000000n + BigInt((m[2] || '').padEnd(8, '0'));
}

// ── P0-4: OS 原子排他锁 ──
function acquireLock() {
  mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  try {
    const fd = openSync(LOCK_PATH, 'wx'); // O_EXCL, 原子: 已存在则 throw EEXIST
    writeSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    closeSync(fd);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') {
      let existing = '(无法读取锁内容)';
      try { existing = readFileSync(LOCK_PATH, 'utf8'); } catch {}
      fail(`gate⑦ FAIL — 已存在锁 ${LOCK_PATH}: ${existing}。不自动清理/不自动重试(stale 锁=信号, 需人工判断是不是真并发还是残留, 确认安全后手动删除锁文件)`);
    }
    throw e;
  }
}
function releaseLock() { try { unlinkSync(LOCK_PATH); } catch {} }

// ── P0-5: atomic journal ──
function journalWriteAtomic(entry) {
  mkdirSync(JOURNAL_DIR, { recursive: true });
  const tmp = path.join(JOURNAL_DIR, `.tmp-${entry.id}-${Date.now()}`);
  const dest = path.join(JOURNAL_DIR, `${entry.id}.json`);
  writeFileSync(tmp, JSON.stringify(entry, null, 2));
  renameSync(tmp, dest); // 原子: 同文件系统内 rename 是 atomic 操作
  return dest;
}
// 扫全部 journal, prepared/submitted/ambiguous/landed 全部计入累计(一笔钱一旦 submitted 就已经
// 真花出去了, 不管有没有确认落地)。损坏/不可解析文件 halt 整个门, 不是 catch{} 跳过(P0-5 明确点名
// 的 v1 bug: fail-open for budget accounting)。
// 🔴 写测试时自查发现的补充缺口: 不只 'ambiguous'(轮询超时)需要 reconcile 才准新 POST——'prepared'
// (POST 前原子写完但进程在真正发出 fetch() 之前/期间被杀, 客户端无法区分"请求从没发出"跟"请求发出
// 了但响应从未收到")跟 'submitted'(POST 拿到响应+txId 但进程在落链轮询完成前被杀)同样是"结果未知
// 需要人核实"的状态——三者(prepared/submitted/ambiguous)统一归为 UNRECONCILED_STATES, 只有
// 'landed'/'failed'/'reconciled_spent_no_txid' 才是终态、可以放心跳过。这三个终态只由独立的
// m0c1-g5-journal-reconcile.mjs 脚本写入(G5 自己的 POST 响应处理只会写 prepared/submitted/
// ambiguous——2026-07-25 团队三方深审定案: 没有安全的 client 端"确定没花"判据, G5 不自己下结论)：
//   'landed'                    = checkUtxoLanded 确认落地(有 txId, 全自动)
//   'failed'                    = reconcile 脚本查完证据后, 操作者人工判定"确实没花"(无 txId)
//   'reconciled_spent_no_txid'  = 操作者人工判定"确实花了, 但没有 txId 可做链上落地证明"(无 txId,
//                                 仍计入预算——跟 'failed' 的唯一区别是预算记账方向)
const UNRECONCILED_STATES = ['prepared', 'submitted', 'ambiguous'];
function sumSpentKasAndFindAmbiguous() {
  if (!existsSync(JOURNAL_DIR)) return { spentKas: 0, ambiguous: [] };
  let spentKas = 0;
  const ambiguous = [];
  for (const f of readdirSync(JOURNAL_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('.tmp-')) continue;
    const full = path.join(JOURNAL_DIR, f);
    let entry;
    try { entry = JSON.parse(readFileSync(full, 'utf8')); }
    catch (e) { fail(`gate⑧ FAIL — journal 文件损坏无法解析: ${full} (${e.message})。不能静默跳过预算记账, 需人工排查这条记录到底代表什么状态后再继续`); }
    if (!['prepared', 'submitted', 'ambiguous', 'landed', 'failed', 'reconciled_spent_no_txid'].includes(entry.state)) {
      fail(`gate⑧ FAIL — journal ${full} state 字段非法: ${entry.state}`);
    }
    // 'failed' = 独立 m0c1-g5-journal-reconcile.mjs 脚本查完链后确认"这条确实没花钱"才会写的终态
    // (G5 自己的 POST 响应处理不再直接写 failed, 见上面 main() 里 2026-07-25 团队三方深审的定案
    // 注释——没有安全的 client 端"确定没花"判据)。failed 不占预算, 其余状态(含 prepared/submitted/
    // ambiguous/landed/reconciled_spent_no_txid)全计入, 保守假设"没证明没花=当花了算"直到 reconcile 澄清。
    // 🔴 NWT 2026-07-25 抓到的手滑 bug: 这行累加在前几轮改注释时被误删了, spentKas 永远是 0,
    // gate⑦ 的累计预算护栏形同虚设(SMOKE_BUDGET_KAS 检查永远通过)。补回来。
    if (entry.state !== 'failed') spentKas += Number(entry.amount_kas || 0);
    if (UNRECONCILED_STATES.includes(entry.state)) ambiguous.push({ file: full, txId: entry.txId || null, state: entry.state, entry });
  }
  return { spentKas, ambiguous };
}

// ── P0-6: 授权快照逐字段绑定 ──
function loadAndVerifySnapshot(snapshotPath, args, amountSompi) {
  if (!existsSync(snapshotPath)) fail(`--snapshot 指向的文件不存在: ${snapshotPath}`);
  const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const required = ['grant_id', 'app_key_id', 'relay_id', 'candidate_address', 'payee_address',
    'network', 'max_amount_sompi', 'valid_until', 'package_commit', 'db_path', 'db_stat',
    'source_scope', 'payee_scope', 'relay_scope', 'allowed_commands'];
  for (const k of required) if (snap[k] === undefined) fail(`授权快照缺字段: ${k}`);
  if (typeof snap.db_stat?.dev !== 'number' || typeof snap.db_stat?.ino !== 'number') {
    fail(`授权快照 db_stat 字段格式非法(须 {dev:number, ino:number}), 收到: ${JSON.stringify(snap.db_stat)}`);
  }
  // enforce singleton scopes(P0-6): 这份 pilot grant 设计上就该是单一确定的一组, 多值本身就是
  // 该被拒的信号(不是"不支持多值这个功能", 是"pilot 快照不该出现多值, 出现即视为配置错误")。
  for (const k of ['source_scope', 'payee_scope', 'relay_scope']) {
    if (!Array.isArray(snap[k]) || snap[k].length !== 1) fail(`快照 ${k} 必须是长度==1的数组(singleton scope enforce), 收到: ${JSON.stringify(snap[k])}`);
  }
  if (JSON.stringify(snap.allowed_commands) !== JSON.stringify(['custodial_transfer'])) {
    fail(`快照 allowed_commands 必须恰好 ['custodial_transfer'], 收到: ${JSON.stringify(snap.allowed_commands)}`);
  }
  if (snap.network !== NETWORK) fail(`快照 network(${snap.network}) != ${NETWORK}`);
  if (BigInt(snap.max_amount_sompi) < amountSompi) fail(`请求金额(${amountSompi} sompi) 超过快照 max_amount_sompi(${snap.max_amount_sompi})`);
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > Number(snap.valid_until)) fail(`快照 valid_until(${snap.valid_until}) 已过期(now=${nowSec})`);
  return snap;
}

// ── P0-1 + P0-2: 运行时身份双层证据 ──
async function verifyRuntimeIdentity(snap) {
  const url = new URL(CONSOLE_BASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    fail(`gate③ FAIL — G5_CONSOLE_BASE_URL host(${url.hostname}) 非 loopback, 拒绝(防止指向冒充身份的假服务器)`);
  }
  const res = await fetch(`${CONSOLE_BASE_URL}/api/system/runtime-identity`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) fail(`gate③ FAIL — runtime-identity 端点 HTTP ${res.status}`);
  const ri = await res.json();
  // ① 进程自证: git_commit/db_stat 为 null(端点自己 best-effort 失败)必须当身份证明失败直接
  //    abort, 不能"某字段缺失但其他检查还能过"(NWT 2026-07-25 code review 要求)。
  if (!ri.git_commit) fail('gate③ FAIL — runtime-identity 返回 git_commit=null(端点自己 git rev-parse 失败), 视为身份证明失败');
  if (!ri.db_stat) fail('gate③ FAIL — runtime-identity 返回 db_stat=null(端点自己 statSync 失败), 视为身份证明失败');

  // ② 磁盘 runtime-equivalence: commit 逐字相等 或 RUNTIME_SCOPE_DIRS 范围内 diff 为空。
  let diffOutput = '';
  if (ri.git_commit !== snap.package_commit) {
    try {
      diffOutput = execFileSync('git', ['diff', '--stat', snap.package_commit, ri.git_commit, '--', ...RUNTIME_SCOPE_DIRS], { cwd: ROOT, encoding: 'utf8' });
    } catch (e) { fail(`gate③ FAIL — git diff 比对 ${snap.package_commit}..${ri.git_commit} 失败: ${e.message}`); }
    if (diffOutput.trim() !== '') {
      fail(`gate③ FAIL — runtime 进程 commit(${ri.git_commit}) != accepted package(${snap.package_commit}), 且 RUNTIME_SCOPE_DIRS 范围内有真实差异(非等价):\n${diffOutput}`);
    }
  }

  // ③ db_path/db_stat 逐字段比对快照声明值。
  if (ri.db_path !== snap.db_path) fail(`gate③ FAIL — runtime db_path(${ri.db_path}) != 快照声明(${snap.db_path})`);
  if (ri.db_stat.dev !== snap.db_stat?.dev || ri.db_stat.ino !== snap.db_stat?.ino) {
    fail(`gate③ FAIL — runtime db_stat(${JSON.stringify(ri.db_stat)}) != 快照声明(${JSON.stringify(snap.db_stat)})`);
  }
  console.log(`[G5] gate③ PASS — runtime identity 双层证据全过(commit=${ri.git_commit}${diffOutput === '' && ri.git_commit !== snap.package_commit ? ' [runtime-equivalent to ' + snap.package_commit + ']' : ''}, db_path/db_stat 匹配)`);
  return ri;
}

// ── P1-2: 私钥文件卫生 ──
function readPrivKeySafely(keyFilePath) {
  const resolved = path.resolve(keyFilePath);
  if (resolved.startsWith(ROOT + path.sep)) {
    fail(`--app-priv-key-file 不可位于 repo 根目录树下(${resolved}), 防止误入 evidence/日志范围`);
  }
  let st;
  try { st = lstatSync(resolved); } catch (e) { fail(`--app-priv-key-file 不存在或不可访问: ${e.message}`); }
  if (st.isSymbolicLink()) fail('--app-priv-key-file 拒绝 symlink');
  let hex = readFileSync(resolved, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) fail('--app-priv-key-file 内容不是 64 位 hex 私钥');
  return hex; // 调用方用完置 null 释放引用(P1-2, Windows 权限强保证能力有限, 如实标注非 POSIX 强保证)
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const k of ['snapshot', 'app-priv-key-file', 'amount-kas']) if (!args[k]) fail(`缺必需参数 --${k}`);

  const amountSompi = kasToSompiBigInt(args['amount-kas']);
  const amountKas = Number(amountSompi) / 1e8;
  if (amountKas > MAX_TRANSFER_KAS) fail(`--amount-kas ${amountKas} 超过硬 cap ${MAX_TRANSFER_KAS} KAS(真钱预算上限, 不可绕过)`);

  // ── gate① working tree clean ──
  let porcelain;
  try { porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { fail(`git status --porcelain 失败: ${e.message}`); }
  if (porcelain.trim() !== '') fail(`working tree 不干净(有未 commit 改动):\n${porcelain}`);
  console.log('[G5] gate① PASS — working tree clean');

  // ── gate② 授权快照 ──
  const snap = loadAndVerifySnapshot(args.snapshot, args, amountSompi);
  console.log(`[G5] gate② PASS — 授权快照(${args.snapshot}) 字段齐全+singleton scope+network/amount/valid_until 全过`);

  // ── gate③ 运行时身份双层证据 ──
  const ri = await verifyRuntimeIdentity(snap);

  // ── gate④ live DB schema currency ──
  const { default: Database } = await import('better-sqlite3');
  {
    const db = new Database(ri.db_path, { readonly: true });
    try {
      const grantCols = db.pragma('table_info(m0c1_app_grants)').map((c) => c.name);
      if (!grantCols.includes('source_scope')) fail('m0c1_app_grants 缺 source_scope 列(v191 未跑)');
      const walletCols = db.pragma('table_info(tg_custodial_wallets)').map((c) => c.name);
      if (!walletCols.includes('access_mode')) fail('tg_custodial_wallets 缺 access_mode 列(v193 未跑)');
      const rl = db.prepare(`SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='pilot_rate_limit_log'`).get().cnt;
      if (rl === 0) fail('pilot_rate_limit_log 表不存在(v192 未跑)');
    } finally { db.close(); }
  }
  console.log('[G5] gate④ PASS — live DB 已有 source_scope(v191)/access_mode(v193)/pilot_rate_limit_log(v192)');

  // ── gate⑤ 只读 grant 预检(沿用 v1, 复用同一份 db_path)——NWT 2026-07-25 抓的编号打架: 这是
  //    实际第 5 个顺序检查, 之前误标成跟运行时身份证据同一个"gate③", 文件头 gate 清单已同步改成
  //    实际的 9 项(①-⑨), 不再漏标这条独立检查项。 ──
  {
    const db = new Database(ri.db_path, { readonly: true });
    let row;
    try { row = db.prepare('SELECT * FROM m0c1_app_grants WHERE grant_id = ?').get(snap.grant_id); }
    finally { db.close(); }
    if (!row) fail(`grant_id=${snap.grant_id} 不存在于 live DB`);
    if (row.revoked) fail('grant 已吊销(revoked)');
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec < row.valid_from || nowSec > row.valid_until) fail('grant 不在有效期');
    const sourceScope = row.source_scope ? JSON.parse(row.source_scope) : null;
    if (!sourceScope || !sourceScope.includes(snap.candidate_address)) fail(`grant.source_scope 不含快照 candidate 地址`);
    const payeeScope = row.payee_scope ? JSON.parse(row.payee_scope) : null;
    if (!payeeScope || !payeeScope.includes(snap.payee_address)) fail(`grant.payee_scope 不含快照 payee 地址`);
    if (row.max_amount_sompi != null && BigInt(row.max_amount_sompi) < amountSompi) fail('grant.max_amount_sompi 小于请求量');
    console.log('[G5] gate⑤ PASS — grant 只读预检(存在+未吊销+在有效期+scope 覆盖)');
  }

  // ── gate⑥ OS 原子排他锁（跟余额检查⑦对调顺序, 见下方"cheap-to-expensive"说明） ──
  // 🔴 锁(P0-4)职责单一, 只管并发(同一时刻只准一个 run)——run 结束(不管 landed/ambiguous/gate
  // 失败)无条件释放。防"带着未 reconcile 的 ambiguous 记录开新单"是 gate⑦ reconcile-gate 自己的
  // 职责(扫 UNRECONCILED_STATES, 有则直接 abort), 两道保护独立, 不让锁兼职 reconcile 的活
  // (Bettor 2026-07-25 一度想让锁在 ambiguous 时不释放, NWT+KANet-UI 指出这跟已 GREEN 的 F1 无条件
  // 释放冲突且是过度耦合, Bettor 认账撤回——解耦更干净: F1 不动, ambiguous journal 文件本身留在
  // 盘上就是信号, 下次 run 会被 gate⑦ 读到拦住, 不需要锁也扛这份责任)。
  acquireLock();
  let released = false;
  const releaseOnce = () => { if (!released) { released = true; releaseLock(); } };
  process.on('SIGINT', () => { releaseOnce(); process.exit(130); });
  process.on('SIGTERM', () => { releaseOnce(); process.exit(143); });
  console.log('[G5] gate⑥ PASS — 排他锁已取得');

  try {
    // ── gate⑦ 累计预算护栏 + reconcile 检查(P1-3) ──
    const { spentKas, ambiguous } = sumSpentKasAndFindAmbiguous();
    if (ambiguous.length > 0) {
      fail(`gate⑦ FAIL — 存在 ${ambiguous.length} 条未 reconcile 的 journal 记录(state∈{prepared,submitted,ambiguous}, txId=${ambiguous.map((a) => a.txId || '(无, 未到 submitted)').join(',')})——必须先手动 reconcile(有 txId 的直接查是否已 landed; 无 txId 的确认这笔请求确实从没发出去)才准发起新 POST`);
    }
    if (spentKas + amountKas > SMOKE_BUDGET_KAS) {
      fail(`gate⑦ FAIL — 累计冒烟预算超限: 已花 ${spentKas} KAS + 本次 ${amountKas} KAS > 预算上限 ${SMOKE_BUDGET_KAS} KAS`);
    }
    console.log(`[G5] gate⑦ PASS — 累计预算 ${spentKas} + ${amountKas} <= ${SMOKE_BUDGET_KAS} KAS, 无未 reconcile 的记录`);

    // ── gate⑧ candidate 钱包链上真实余额（cheap-to-expensive: 锁+预算这类本地纯文件系统检查排在
    //    真链 RPC 调用之前, 省得白打一次 RPC 才发现锁被占/预算超了) ──
    const kaspa = await import(pathToFileURL(path.resolve(ROOT, 'kasia-relay/node_modules/kaspa-wasm/kaspa.js')).href);
    const { RpcClient, Encoding, Address } = kaspa;
    async function withRpc(fn) {
      const rpcUrl = process.env.KASPA_RPC_URL; // 跟 checkUtxoLanded 内部 connectRpc 用同一个 env var
      if (!rpcUrl || rpcUrl.includes('127.0.0.1:1')) fail('未设 KASPA_RPC_URL(或误继承死端口) — G5 必须连真实 testnet-12 节点');
      const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: NETWORK });
      try {
        await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 8000))]);
        return await fn(rpc);
      } finally { try { await rpc.disconnect(); } catch {} }
    }
    const balanceSompi = await withRpc(async (rpc) => {
      const { entries } = await rpc.getUtxosByAddresses([new Address(snap.candidate_address)]);
      return (entries || []).reduce((s, e) => s + BigInt(e.amount ?? e.utxoEntry?.amount ?? 0), 0n);
    });
    const balanceKas = Number(balanceSompi) / 1e8;
    const neededKas = amountKas + GAS_RESERVE_KAS;
    if (balanceKas < neededKas) fail(`candidate 钱包链上真实余额 ${balanceKas} KAS < 需要 ${neededKas} KAS`);
    console.log(`[G5] gate⑧ PASS — candidate 余额 ${balanceKas} KAS >= 需要 ${neededKas} KAS`);

    // ── 构造+签名 envelope ──
    const { buildAppCmd } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/test-framework/lib/app-envelope-sdk.mjs')).href);
    let appPrivHex = readPrivKeySafely(args['app-priv-key-file']);
    const intent = { fromAddress: snap.candidate_address, target: snap.payee_address, amount: amountKas.toFixed(8), network: NETWORK };
    const cmd = buildAppCmd({
      type: 'custodial_transfer', intent,
      appKeyId: snap.app_key_id, grantId: snap.grant_id, relayId: snap.relay_id,
      network: NETWORK, privkeyHex: appPrivHex,
    });
    appPrivHex = null; // P1-2: 用完释放引用

    console.log(`[G5] envelope 构造完成: intent=${JSON.stringify(intent)}`);

    if (!args.confirm) {
      console.log('[G5] dry-run(未传 --confirm) — gate①-⑧已过, envelope 已构造但不发送. 加 --confirm 真执行.');
      return;
    }

    // ── journal: prepared(P0-5, POST 前原子写)——同时快照 candidate 钱包当前 UTXO outpoint 集合
    //    (Bettor 2026-07-25 拍板的 reconcile 判据: 无 txId 场景靠比对这份快照)。 ──
    const prepUtxoSnapshot = await withRpc(async (rpc) => {
      const { entries } = await rpc.getUtxosByAddresses([new Address(snap.candidate_address)]);
      return (entries || []).map((e) => {
        const op = e.outpoint ?? e.utxoEntry?.outpoint;
        return op ? `${op.transactionId}:${op.index}` : null;
      }).filter(Boolean).sort();
    });
    const journalId = randomUUID();
    const baseJournal = {
      id: journalId, state: 'prepared', amount_kas: amountKas,
      grant_id: snap.grant_id, candidate_address: snap.candidate_address, payee_address: snap.payee_address,
      package_commit: ri.git_commit, created_at: new Date().toISOString(),
      prepared_utxo_snapshot: prepUtxoSnapshot,
    };
    journalWriteAtomic(baseJournal);

    // ── POST(gate⑨ 隐含在 --confirm 分支) ──
    // 🔴 2026-07-25 团队三方深审定案(NWT 挖出 capability.js L295 那个"relay 已跑 sendCommandAsync
    // 但没 txId"的 503 场景, 跟 L249"armCheck 失败, 确定没到 broadcast"的 503 在 HTTP 层面完全同形,
    // client 侧任何"按状态码/reason_code 猜是不是 pre-broadcast"的分类都不安全——NWT 早前就警告过
    // 这类脆分类, 这次真在这撞上了）: 不再区分"这个拒绝是不是安全的"。**只有干净 200+ok+txId 才是
    // 'submitted'（确定钱已花)。其余一切（403/400/500/timeout/无 txId/任何未识别响应）一律
    // 'ambiguous'**——'failed' 这个状态本轮从 G5 自己的 POST 响应处理里取消(没有安全的 client 端
    // "确定没花"判据、留着就是给漏记 spend 开口子)。所有 ambiguous 记录靠独立的
    // m0c1-g5-journal-reconcile.mjs 脚本查链解决（有 txId 走 checkUtxoLanded；无 txId 比对
    // prepared_utxo_snapshot 判断这个钱包在这之后有没有真出账), 不是 G5 自己乐观猜。
    let res;
    try {
      res = await fetch(`${CONSOLE_BASE_URL}/api/capability/wallet/transfer`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ envelope: cmd.envelope }),
        signal: AbortSignal.timeout(45000),
      });
    } catch (e) {
      // fetch() 本身抛异常(网络错误/连接被拒/超时)——journal 停在 prepared(已经在
      // UNRECONCILED_STATES 里), 不额外写 ambiguous(prepared 本身已经是"结果未知"状态)。
      fail(`POST 请求本身失败(网络层, 非网关响应): ${e.message} — journal 停在 prepared, 下次跑前须 reconcile`);
    }
    const body = await res.json().catch(() => ({}));
    if (res.status !== 200 || !body.ok || !body.txId) {
      journalWriteAtomic({ ...baseJournal, state: 'ambiguous', txId: body.txId || null, response_note: `HTTP ${res.status} ${JSON.stringify(body)}` });
      fail(`网关未确认成功(HTTP ${res.status}, ${JSON.stringify(body)}) — 不假设钱没花, journal 已标 ambiguous, 下次跑前须先 reconcile: ${JSON.stringify(body)}`);
    }
    const txId = body.txId;

    // ── journal: submitted(P0-5, POST 响应后立刻持久化, 早于落链轮询) ──
    journalWriteAtomic({ ...baseJournal, state: 'submitted', txId });
    console.log(`[G5] 网关接受, txId=${txId}（journal 已持久化 submitted 状态）`);

    // ── 落链验证: 复用 p2sh.mjs checkUtxoLanded() 本尊 ──
    const { checkUtxoLanded } = await import(pathToFileURL(path.join(ROOT, 'kasia-relay/src/lib/p2sh.mjs')).href);
    let landed = false, landedDepth = null;
    for (let attempt = 0; attempt < 20 && !landed; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await checkUtxoLanded(snap.payee_address, txId, NETWORK, LANDED_MIN_DEPTH);
      landed = r.landed;
      landedDepth = r.depth ?? null;
    }

    if (!landed) {
      // P1-3: 超时未到 minDepth = ambiguous(非 failed), 重跑前必须先 reconcile 这条 txId。
      journalWriteAtomic({ ...baseJournal, state: 'ambiguous', txId, landed_depth: landedDepth });
      fail(`轮询 20 次(≥60s)未确认 txId=${txId} 达到 minDepth=${LANDED_MIN_DEPTH} — journal 已标 ambiguous, 下次跑前须先 reconcile 这个 txId(直接查是否已 landed), 不能当普通失败重跑`);
    }
    journalWriteAtomic({ ...baseJournal, state: 'landed', txId, landed_depth: landedDepth });
    console.log(`[G5] PASS — txId=${txId} 已在 payee 真实 UTXO 集合中确认落地(depth=${landedDepth} >= minDepth=${LANDED_MIN_DEPTH})`);
  } finally {
    releaseOnce();
  }
}

// 唯一的 process.exit() 出口(修复上面那个 finally 被跳过的 bug)。GateFailError(gate 检查主动
// fail())已经在各自的 try/finally 里正常触发过 releaseOnce()(现在能触发了, 因为 fail() 改 throw
// 不再直接 exit)——锁职责单一只管并发, 无条件释放(见 gate⑥ 那段注释: 防"带未清 ambiguous 开新单"
// 是 gate⑦ reconcile-gate 自己的活, 不是锁的责任, Bettor 一度想让两者耦合被 NWT+KANet-UI 指出
// 过度设计后撤回)。这里的 releaseLock() 是双保险(idempotent, 已释放的锁/不存在的锁都安全) ——真正
// "进程被 kill/掉电"这类完全绕开 JS try/finally 的场景, 锁不会被这里清, 仍然留作信号。
main().catch((e) => {
  if (e instanceof GateFailError) {
    console.error(`[G5] ABORT (gate 未过, 零动钱): ${e.message}`);
  } else {
    console.error('[G5] 异常(非预期):', e.stack || e.message);
  }
  releaseLock();
  process.exit(1);
});
