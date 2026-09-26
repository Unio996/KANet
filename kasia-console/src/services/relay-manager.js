/**
 * Relay Manager — spawns/stops relay child processes per account.
 *
 * Same pattern as scanner.js but per-account:
 *   startRelay(relayNodeId) — spawn one relay process
 *   stopRelay(relayNodeId)  — kill one relay process
 *   startAll()              — start relays for all accounts with mnemonic + adapter
 *   stopAll()               — kill all relay processes
 *   getStatus()             — which relays are running
 */

import { fork } from 'child_process';
import { resolve } from 'path';
import { sqlite } from '../db/client.js';
import { getConfig } from '../data/settings/configs.js';
import { getRelayMnemonic, getRelayPrivkey } from '../data/settings/relay-nodes.js';
// N5(A2 spec §N5): 密钥 env 的构造是【纯函数】, 抽在 lib 里 —— 这样用例引它不必裸 import 本文件
// (M0a 门: 新增裸 relay-manager import 即败, 那道闸是对的, 不绕)。
import { buildRelayKeyEnv } from '../lib/u1-relay-key-env.mjs';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const RELAY_DIR = resolve(process.env.RELAY_DIR || `${KANET_ROOT}/kasia-relay`);
const CONSOLE_PORT = process.env.PORT || '3100';

// relayNodeId → { child, pid, startedAt, lastLog }
const _relays = {};

// NWT 2-1 (docs/2026-09-14-nwt-mainnet-relay-hotwallet-cap-and-cold-hot-separation-spec-v0.1.md §5,
// Codex TOCTOU 审·Bettor 1138 裁两点调整): 冷清单 + per-relay 上限 + 热钱包总额上限, 三条【启动时】
// 准入检查的唯一实现。startRelay() 在私钥进子进程 env 之前调用它 —— 这是本会话反复确认过的唯一私钥
// 入内存前置点, 是安全边界本身。导入端点(api/relay.js POST /relays, POST /api/relay/import-privkey)
// 也调用同一份函数做"早失败"—— 那只是更友好, 不是边界, 边界只有这一处。缺两个上限 env = 该项检查不
// 启用(向后兼容现有行为); 余额查询失败 = fail-closed 拒绝, 绝不当 0 继续放行。日志只打地址与数值,
// 从不打印助记词/私钥/密文。
//
// 🔴 这是【启动时】准入门, 不是持续生效的硬上限——relay 一旦被放行启动, 运行期间余额如何变化(比如
// 收到新转账)不受这三条检查约束, 那是另一个问题(运行期监控, 见下方 onRelayAdmitted 挂钩点)。任何
// 引用本函数的文档不能把"准入门"写成"硬上限"这两者不是一回事。
//
// Codex TOCTOU 指出: 若不做任何串行化, 两个 startRelay() 并发调用可能各自查到同一个"当前运行总额",
// 各自判断"加上自己没超线"就都放行, 实际总额却超了。修法: _admissionLock 把每次 startRelay() 从
// "查总额"到"成功后登记进 _relays"这一段串行化(同一时刻只有一个准入判断在跑), 且总额查询不缓存
// (曾经的 30s TTL 缓存已按 Codex 意见去掉——缓存的陈旧总额本身就是让准入判断依据一个不再为真的数字,
// 跟"每次现查"要解决的问题矛盾)。
let _admissionLock = Promise.resolve();
function _withAdmissionLock(fn) {
  const run = _admissionLock.then(fn, fn);
  _admissionLock = run.then(() => {}, () => {}); // 链条本身永不因某次调用失败而断, 后续调用仍能排队
  return run;
}

async function _queryBalanceKas(address, network, rpcUrl) {
  const { Address } = await import('kaspa-wasm');
  const { getSharedRpc } = await import('../lib/kaspa-rpc-shared.mjs');
  const rpc = await getSharedRpc({ url: rpcUrl, networkId: network || 'mainnet' });
  const { entries } = await rpc.getBalancesByAddresses([new Address(address)]);
  return Number(entries?.[0]?.balance || 0n) / 1e8;
}

// 遍历当前"正在跑"(child 存在)的 relay, 各自查一次链上余额求和。【不缓存】——每次都是链上现查
// (Bettor 1138: 聚合上限检查不得用陈旧总额)。调用方(checkHotwalletAdmission 的总额分支)必须在
// _withAdmissionLock 保护下调用本函数, 否则并发场景下仍然是 TOCTOU。
async function _sumRunningRelayBalancesKas(network, rpcUrl, queryBalanceKas = _queryBalanceKas) {
  const runningIds = Object.entries(_relays).filter(([, s]) => s.child).map(([id]) => id);
  let total = 0;
  if (runningIds.length > 0) {
    const placeholders = runningIds.map(() => '?').join(',');
    const rows = sqlite.prepare(
      `SELECT address FROM relay_nodes WHERE id IN (${placeholders}) AND address IS NOT NULL`
    ).all(...runningIds);
    for (const row of rows) {
      total += await queryBalanceKas(row.address, network, rpcUrl);
    }
  }
  return total;
}

/**
 * 三条【启动时】准入检查(NWT 2-1 §5)。address/network/rpcUrl 都是公开信息, 函数内部从不接触密钥材料。
 * 返回 { ok: true, balance? } 或 { ok: false, reason, ...细节(从不含密钥) }。
 *
 * 🔴 本函数自己【不加锁】——总额检查的并发安全边界在调用方：`startRelay()` 把"本函数判断 → fork →
 * 登记进 `_relays`"整段包进 `_withAdmissionLock`（见下方 startRelay 内部），登记完成锁才释放, 下一个
 * 并发 startRelay() 的总额查询才会看到这一行。导入端点(api/relay.js)调用本函数做"早失败"提示时不
 * 经过这把锁——那条路径本来就不是安全边界, 真正把关的是 startRelay() 自己那次加锁的判断。
 *
 * 第二参 `deps` 是可选依赖注入(同 `kaspa-rpc-shared.mjs` 的 `getSharedRpc({url,networkId},{Ctor})`
 * 既有约定——不是 `*ForTests` 专名导出, 是默认走真实实现、测试可覆盖的普通可选参数)：
 * `queryBalanceKas(address, network, rpcUrl)` 覆盖单地址余额查询, `sumRunningRelayBalancesKas(network, rpcUrl)`
 * 覆盖"正在跑的 relay 余额总和"查询——测试借此在不连真实 RPC、不碰 `_relays`/DB 的情况下验证三条
 * 判断逻辑本身（含"总额刚好超线的第 N 个候选被拒"这类需要控制运行总额的场景）。
 */
export async function checkHotwalletAdmission({ address, network, rpcUrl }, deps = {}) {
  const queryBalanceKas = deps.queryBalanceKas || _queryBalanceKas;
  const sumRunningRelayBalancesKas = deps.sumRunningRelayBalancesKas
    || ((net, url) => _sumRunningRelayBalancesKas(net, url, queryBalanceKas));

  const coldList = (process.env.RELAY_HOTWALLET_COLD_ADDRESSES || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (coldList.includes(address)) {
    console.warn(`[relay-manager] hotwallet admission refuse ${address}: cold_address_denied`);
    return { ok: false, reason: 'cold_address_denied' };
  }

  const perRelayMax = Number(process.env.RELAY_HOTWALLET_PER_RELAY_MAX_KAS);
  const totalMax = Number(process.env.RELAY_HOTWALLET_TOTAL_MAX_KAS);
  if (!Number.isFinite(perRelayMax) && !Number.isFinite(totalMax)) {
    return { ok: true }; // 两个上限都未设 = 该项检查不启用, 向后兼容现有行为
  }
  if (!rpcUrl) {
    console.error(`[relay-manager] hotwallet admission refuse ${address}: no rpc url to query balance (fail-closed)`);
    return { ok: false, reason: 'balance_query_failed' };
  }

  let candidateBalanceKas;
  try {
    candidateBalanceKas = await queryBalanceKas(address, network, rpcUrl);
  } catch (err) {
    console.error(`[relay-manager] hotwallet admission refuse ${address}: candidate balance query failed (fail-closed): ${err.message}`);
    return { ok: false, reason: 'balance_query_failed' };
  }

  if (Number.isFinite(perRelayMax) && candidateBalanceKas > perRelayMax) {
    console.warn(`[relay-manager] hotwallet admission refuse ${address}: per_relay_cap_exceeded (balance=${candidateBalanceKas} cap=${perRelayMax})`);
    return { ok: false, reason: 'per_relay_cap_exceeded', balance: candidateBalanceKas, cap: perRelayMax };
  }

  if (Number.isFinite(totalMax)) {
    let runningTotal;
    try {
      runningTotal = await sumRunningRelayBalancesKas(network, rpcUrl);
    } catch (err) {
      console.error(`[relay-manager] hotwallet admission refuse ${address}: running total balance query failed (fail-closed): ${err.message}`);
      return { ok: false, reason: 'balance_query_failed' };
    }
    if (runningTotal + candidateBalanceKas > totalMax) {
      console.warn(`[relay-manager] hotwallet admission refuse ${address}: hotwallet_total_cap_exceeded (running=${runningTotal} candidate=${candidateBalanceKas} cap=${totalMax})`);
      return { ok: false, reason: 'hotwallet_total_cap_exceeded', running: runningTotal, candidate: candidateBalanceKas, cap: totalMax };
    }
  }

  return { ok: true, balance: candidateBalanceKas };
}

// 运行期监控挂钩点(NWT 2-1 v0.2 待定语义, Bettor 1138: 现在只留钩子, 不自己定语义)——relay 通过
// 准入门、实际启动成功后会调这里，传入当时核过的候选余额。**现在是空函数**：不做周期性复检、不做
// 超限自动停/隔离，那些行为的具体语义(检查频率/超限动作/隔离态如何表示等)由 NWT 2-1 v0.2 规格定，
// 这里只保证"关"这个动作以后接得进来"的调用点已经存在，不需要以后再去改 startRelay() 的调用方。
function onRelayAdmitted(relayNodeId, address, admittedBalanceKas) {
  // 有意留空——见上方注释。
}


/**
 * Start a relay process for a specific account.
 */
export async function startRelay(relayNodeId) {
  if (_relays[relayNodeId]?.child) {
    return { ok: false, reason: 'already_running', pid: _relays[relayNodeId].pid };
  }

  // Load account data
  const account = sqlite.prepare(
    `SELECT r.id, r.name, r.address, r.network, r.poll_ms, r.is_service, a.http_port as adapter_port
     FROM relay_nodes r
     LEFT JOIN adapter_nodes a ON a.id = r.adapter_node_id
     WHERE r.id = ?`
  ).get(relayNodeId);

  if (!account) return { ok: false, reason: 'account_not_found' };
  if (!account.address) return { ok: false, reason: 'no_address' };

  // (b) 网络单一源 I4 (设计 v0.2 §2.1 / F6): env KASPA_NETWORK 是唯一真相; relay_nodes.network 行值 ≠ env ⇒ 该 relay 不进 live 路径(不重映射)。
  //   D-017 主网过渡态: 32 行 testnet-12 relay 在 env=mainnet 下由此拒起 = TN12 退役的代码侧表达。
  //   同批: 原 `account.network || 'mainnet'` 给子进程的 KASPA_NETWORK 是默认漂移(R-NET-DEFAULT-DRIFT), 改 configuredNetwork()。
  const { configuredNetwork, rowNetworkMatches } = await import('../lib/kaspa-network.mjs');
  const net = configuredNetwork();
  if (account.network && !rowNetworkMatches(account.network, { network: net })) {
    console.warn(`[relay-manager] refuse start ${account.name}: relay_nodes.network=${account.network} != KASPA_NETWORK=${net} (I4: row network is not a second source)`);
    return { ok: false, reason: 'network_mismatch' };
  }
  // Ensure this agent's address is registered as 'local' identity
  // Without this, Scout won't recognize handshakes to this agent, and relation_states won't be created
  const existingId = sqlite.prepare('SELECT id, identity_type FROM identities WHERE address = ? AND network = ?').get(account.address, net);
  if (!existingId) {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO identities (id, network, address, display_name, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, 'local', ?, ?)").run(randomUUID(), net, account.address, account.name, now, now);
    console.log(`[relay-manager] Created local identity for ${account.name}`);
  } else if (existingId.identity_type !== 'local') {
    sqlite.prepare("UPDATE identities SET identity_type = 'local' WHERE id = ?").run(existingId.id);
    console.log(`[relay-manager] Fixed identity type for ${account.name}: ${existingId.identity_type} → local`);
  }

  // Resolve config
  // S5 (strict local-only, 2026-09-13 设计 v0.2 C4): 原 `getConfig('rpc_url') || env` = DB 优先于 env, 绕过 rpc-health ⇒ console 读数走本机而 relay 递交走 DB 端点(T2 split-brain)。
  //   现统一走 resolveChildRpcUrl: strict ⇒ 恒 env; 且 strict 下空值拒起(把 '' 递下去会触发 relay 侧 console-config → Resolver 公网链, T4)。
  // 🔴 NWT 1147: 这段挪到解密(getRelayPrivkey/getRelayMnemonic)之前——热钱包准入检查只需要
  // account.address + net + rpcUrl, 不需要密钥材料, 提前到这里让准入检查能在解密发生之前跑完。
  const { resolveChildRpcUrl, isStrictLocalOnly } = await import('./rpc-health.js');
  const rpcUrl = await resolveChildRpcUrl('relay-manager');
  if (isStrictLocalOnly() && !rpcUrl) return { ok: false, reason: 'no_rpc_url_strict' };

  // NWT 2-1 热钱包准入门 + Codex TOCTOU 修（Bettor 1138）：从"查总额判断"到"登记进 _relays"整段
  // 串行化——同一时刻只有一个 startRelay() 在做准入判断+登记，下一个并发调用的总额查询才能看到
  // 这一行已经算进去了，不会两个都各自查到"加上自己没超线"就一起放行。
  // 🔴 NWT 1147: 准入检查挪到解密之前——只用 account.address + net + rpcUrl（三者都是公开信息，
  // 不接触密钥材料）；被拒的候选在这里就 return，getRelayPrivkey/getRelayMnemonic 根本不会被调用，
  // 连解密动作本身都不发生（不只是"解密了但不用"）。
  return _withAdmissionLock(async () => {
    const admission = await checkHotwalletAdmission({ address: account.address, network: net, rpcUrl });
    if (!admission.ok) {
      console.warn(`[relay-manager] refuse start ${account.name}: hotwallet admission ${admission.reason}`);
      return admission;
    }

    // r281 (Owner P0): privkey-backed relay 优先 (无助记词只有裸 kaspa 私钥的地址,
    // 如 Owner 已绑 TG 的 qrymjvc). Wallet.mjs getWallet 优先读 KASPA_PRIVKEY env.
    // 助记词型 relay 保持原行为. 二者必至少一个.
    const privkey = getRelayPrivkey(relayNodeId);
    const mnemonic = privkey ? null : getRelayMnemonic(relayNodeId);
    if (!privkey && !mnemonic) return { ok: false, reason: 'no_key' };

    const relayMode = await getConfig('relay_mode') || process.env.RELAY_MODE || 'rpc';
    const ingestSecret = await getConfig('ingest_secret') || process.env.INGEST_SECRET || '';
    const adapterPort = account.adapter_port || 3010;

    const env = {
      ...process.env,
      CONSOLE_URL: `http://localhost:${CONSOLE_PORT}`,
      INGEST_SECRET: ingestSecret,
      RELAY_NODE_ID: relayNodeId,
      NETWORK: net,
      KASPA_NETWORK: net,   // (b) 单一源: env KASPA_NETWORK(已核 = relay_nodes.network)
      KASPA_RPC_URL: rpcUrl,
      RELAY_MODE: relayMode,
      POLL_MS: String(account.poll_ms || 2000),
      IS_SERVICE: account.is_service ? '1' : '0',  // R5 T-J2-16: Service 模式 relay (broker) 跳 anti-spam dedup
      // M0c-1 app provision: grant registry 只读路径 (relay 侧 authorizeAppCommand fresh 读,
      // grant-registry.mjs readOnly 直开)。console 侧解析成绝对路径 — relay cwd=RELAY_DIR, 相对路径会解错。
      M0C1_GRANT_DB_PATH: resolve(process.env.DB_PATH || './data/console.db'),
    };
    // r281: pass exactly one of KASPA_PRIVKEY / KASPA_MNEMONIC (privkey wins). wallet.mjs reads them.
    // 🔴 N5(A2 spec v1.2-rc · @J1tn 审视 8969aca7 · @Bettor 批B GO): **互斥必须双向 + 切断继承向**。
    //   见下方 buildRelayKeyEnv 的头注 —— 这三行是那份读数的落码, 别单独读。
    Object.assign(env, buildRelayKeyEnv({ privkey, mnemonic }));

    try {
      const child = fork('src/relay.mjs', [], {
        cwd: RELAY_DIR,
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });

      const state = {
        child,
        pid: child.pid,
        name: account.name,
        startedAt: new Date().toISOString(),
        lastLog: '',
        lastLogAt: 0,  // r216 bug fix: lastLog 是文本不能 new Date() 解析, 加独立 timestamp.
      };

      child.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line) console.log(`[relay:${account.name}] ${line}`);
        }
        state.lastLog = lines.pop() || state.lastLog;
        state.lastLogAt = Date.now();
      });
      child.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line) console.log(`[relay:${account.name}] ${line}`);
        }
        state.lastLog = lines.pop() || state.lastLog;
        state.lastLogAt = Date.now();
      });

      child.on('exit', (code) => {
        console.log(`[relay-manager] ${account.name} relay exited (code ${code})`);
        delete _relays[relayNodeId];
      });

      child.on('error', (err) => {
        console.error(`[relay-manager] ${account.name} relay error: ${err.message}`);
        delete _relays[relayNodeId];
      });

      _relays[relayNodeId] = state;
      console.log(`[relay-manager] Started ${account.name} relay (PID ${child.pid})`);
      onRelayAdmitted(relayNodeId, account.address, admission.balance);

      return { ok: true, pid: child.pid, name: account.name };
    } catch (err) {
      console.error(`[relay-manager] Failed to start ${account.name}: ${err.message}`);
      return { ok: false, reason: 'spawn_failed', error: err.message };
    }
  });
}

/**
 * Stop a specific relay process.
 */
export async function stopRelay(relayNodeId) {
  const state = _relays[relayNodeId];
  if (!state?.child) return { ok: false, reason: 'not_running' };

  try {
    state.child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { state.child.kill('SIGKILL'); } catch {}
        resolve();
      }, 3000);
      state.child.on('exit', () => { clearTimeout(timer); resolve(); });
    });
  } catch {}

  delete _relays[relayNodeId];
  console.log(`[relay-manager] Stopped ${state.name} relay`);
  return { ok: true };
}

/**
 * Start relays for all accounts that have (mnemonic OR privkey) + adapter configured.
 * r281 (Bettor 168965a): privkey-backed relays must also boot here. PR updated startRelay()
 * single-call path but missed this batch filter, so every Console restart left privkey
 * relays (e.g. Owner-qrymjvc-tn) down — operator hit it manually 2026-05-30 ~10:00.
 */
export async function startAll() {
  // 2026-07-04 (查漏补缺·qzdh7nar/KANet-UI): 原 INNER JOIN adapter_nodes 排除没绑 adapter 的 relay——
  // 但 startRelay() 本身(上方)用 LEFT JOIN，adapter 只是可选的 http_port 来源，不是启动必要条件。
  // 条件比实际需求严 = 无 adapter 的 relay 在 Console 重启后永远不会自动拉起(#34 挖矿 relay 撞过)。
  // 改成跟 startRelay() 资格条件一致，不要求 adapter。
  const accounts = sqlite.prepare(
    `SELECT r.id FROM relay_nodes r
     WHERE r.address IS NOT NULL
       AND (r.mnemonic_encrypted IS NOT NULL OR r.privkey_encrypted IS NOT NULL)`
  ).all();

  let started = 0;
  for (const a of accounts) {
    if (_relays[a.id]?.child) continue; // already running
    const result = await startRelay(a.id);
    if (result.ok) started++;
  }

  console.log(`[relay-manager] ${started}/${accounts.length} relays started`);
  return { started, total: accounts.length };
}

/**
 * Stop all relay processes.
 */
export async function stopAll() {
  const ids = Object.keys(_relays);
  for (const id of ids) {
    await stopRelay(id);
  }
  console.log(`[relay-manager] All relays stopped`);
}

/**
 * Get status of all relay processes.
 */
export function getStatus() {
  return Object.entries(_relays).map(([id, state]) => ({
    relayNodeId: id,
    name: state.name,
    pid: state.pid,
    startedAt: state.startedAt,
    lastLog: state.lastLog,
  }));
}

// r211 O-3 PB-A — oracle live check (= 防 ghost market: DB is_oracle=1 但 relay process dead).
//   bettor.js publish endpoint 调用 reject 死 oracle relay.
// r216 bug fix: lastLog 是日志文本不是 timestamp, 改 lastLogAt (= Date.now() 当 stdout/stderr 来).
//   首次 stdout/stderr 前 lastLogAt=0 → 用 startedAt fallback (= 刚 spawn 算 alive)。
//
// 🔴 2026-09-26 修复(账本1672/1674, Owner 亲批「修，派 KANet-UI 改」)：原判据"lastLogAt 距今
//   > freshnessMs(默认60s) ⇒ 死"把【空闲】(relay 没事可干就不会打日志, 完全正常)和【真死】混为一谈——
//   主网 18 个 relay 全部一分钟不打日志就被判死, relay-health-monitor 的 30s cron 因此对着全部活
//   relay 疯狂调 startRelay()(全部落空 already_running, 零真实重启), 只是在空耗 tick 与重启配额。
//   改为以进程真实存活信号为主, 不再用"多久没打日志"判死——三个信号全部是【已有的东西】, 不新增任何
//   心跳/ping 机制(relay 目前没有现成的 IPC ping, 没有就不造)：
//     ① child 的 exit/signal/killed 状态——`startRelay()` 里 `child.on('exit'/'error')` 早就在真死
//        时把 state 从 `_relays` 摘掉了(下面 `!state` 分支就是接的这个), 这里额外读 `exitCode`/
//        `signalCode`/`killed` 是防"事件还没来得及处理完但对象已经能读到退出信息"这类极短窗口；
//     ② `state.child.connected`——fork() 自带的 IPC 通道布尔状态, "IPC 断"直接读它, 不用发消息去试；
//     ③ `process.kill(pid, 0)`——Node/libuv 自带的"只探测存在性, 不真发信号"原语, 本仓
//        `tg-bot-manager.js:isBotAlive()` 已经在用同一个原语做同一件事(同一进程模型, 照抄而非新造)。
//   `deps` 第二参用于测试注入(覆盖 `_relays` 这个模块私有 map, 不用真 fork 一个 relay 子进程就能测
//   "空闲不判死"/"真退出判死"两种状态)——所有生产调用点(bettor.js/pool.js/pool-auto-better.js/
//   pool-house-agent.js/pool-market-settler.js/bettor-refund-claim-auto.mjs)全部单参调用, 没有一处
//   传过第二参数, 原先的 `freshnessMs` 默认值从未被任何生产调用覆盖过, 改签名不影响任何生产行为。
export function isRelayAlive(relayNodeId, deps = {}) {
  const { relays = _relays } = deps;
  const state = relays[relayNodeId];
  if (!state) return { alive: false, reason: 'no relay process (= not started)' };
  if (!state.child) return { alive: false, reason: 'child missing' };
  if (state.child.exitCode !== null || state.child.signalCode || state.child.killed) {
    return { alive: false, reason: `child already exited (code=${state.child.exitCode}, signal=${state.child.signalCode})` };
  }
  if (state.child.connected === false) return { alive: false, reason: 'IPC channel disconnected' };
  if (!state.pid) return { alive: false, reason: 'no pid' };
  try {
    process.kill(state.pid, 0);   // 同 tg-bot-manager.js isBotAlive() 的既有存在性探测手法
  } catch {
    return { alive: false, reason: `pid ${state.pid} not found (process exited)` };
  }
  // 进程真实存活即为 alive——空闲(久无日志)不再是死亡信号, ageMs 只作为诊断信息随返回值带出。
  const lastMs = state.lastLogAt || (state.startedAt ? new Date(state.startedAt).getTime() : 0);
  const ageMs = lastMs ? Date.now() - lastMs : 0;
  return { alive: true, ageMs, pid: state.pid };
}

/**
 * Send a command to a Relay child process.
 *
 * Architecture rule:
 *   Console → Relay: IPC (commands)
 *   Relay → Console: HTTP (reports)
 *
 * Supported commands:
 *   { type: 'handshake', target: 'kaspa:...' }
 *   { type: 'send_message', target: 'kaspa:...', message: '...' }
 *   { type: 'publish_card', params: { name, entityType, skills, ... } }
 *   { type: 'send_broadcast', channel: '...', message: '...' }
 *   { type: 'transfer', target: 'kaspa:...', amount: '0.2' }
 */
export function sendCommand(relayNodeId, command) {
  const state = _relays[relayNodeId];
  if (!state?.child?.send) return false;
  state.child.send(command);
  return true;
}

/**
 * 发送命令并等待 Relay 回传结果（请求-响应模式）。
 * 用于需要 txId 等执行结果的操作（transfer, handshake）。
 * @param {string} relayNodeId
 * @param {object} command - { type, target, amount, ... }
 * @param {number} [timeoutMs=30000] - 超时毫秒
 * @returns {Promise<{txId?, fee?, error?}>}
 */
/**
 * Wait until a relay child is running and ready to receive IPC commands.
 * Polls every 500ms up to timeoutMs. Returns when ready, throws on timeout.
 * Used by broker-action-queue to hold pump during console-restart relay race
 * (T-J2-24, J1 a242bfd5 R5: NWT 报 console restart ~10s 内 accept_v1 全 FAIL '
 * Relay not running' 因 retry 6s/12s/18s 总 36s 仍可能 race).
 */
export async function waitForRelay(relayNodeId, timeoutMs = 60000) {
  const POLL_MS = 500;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = _relays[relayNodeId];
    if (state?.child?.send) return;
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`waitForRelay: ${relayNodeId.slice(0, 8)} not ready after ${timeoutMs / 1000}s`);
}

// M0c-1 批A (origin 体系基础设施) — warn-first 去重: 每个未标 origin 的命令类型只 warn 一次, 避免高频 daemon tick 刷屏.
const _originWarnedTypes = new Set();

// M0c-1: origin ∈ {'internal','app','operator'} 由调用方显式传, 供 relay 侧 authorizeCommand gate (批E) 判别命令来源.
// 本批 (批A) relay 侧尚未读 __origin = 零行为变更 no-op; warn-first: 迁移期存量调用点未标 origin → 记 warn 不拒
// (立即 fail-closed 会断现网结算, 违反 NO TX NO STATE). 迁移收口 + gate armed 前置齐后, relay 侧才对缺失 origin fail-closed.
export function sendCommandAsync(relayNodeId, command, timeoutMs = 30000, origin) {
  const state = _relays[relayNodeId];
  if (!state?.child?.send) return Promise.reject(new Error('Relay not running'));

  if (origin === undefined) {
    const t = command?.type || '?';
    if (!_originWarnedTypes.has(t)) {
      _originWarnedTypes.add(t);
      console.warn(`[M0c-1 origin] sendCommandAsync(type=${t}) 未标 origin — 迁移批需补 origin 参数 (warn-first, 暂不拒)`);
    }
  }

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.child.removeListener('message', handler);
      reject(new Error('Relay command timeout after ' + (timeoutMs / 1000) + 's'));
    }, timeoutMs);

    function handler(msg) {
      if (msg?.requestId === requestId) {
        clearTimeout(timer);
        state.child.removeListener('message', handler);
        resolve(msg.result || {});
      }
    }
    state.child.on('message', handler);
    // __origin 由 origin 形参权威设置, 显式覆写/剥除 command 里可能夹带的同名字段 (防调用方经 command 伪造来源).
    const payload = { ...command, requestId };
    if (origin !== undefined) payload.__origin = origin;
    else delete payload.__origin;
    state.child.send(payload);
  });
}

/**
 * T-J2-2026-05-12 #3 — getRelayRpcState wrapper (UI 健康检测 P0, NWT spec sub #3/7).
 * Console UI/API 通过这个 read-only 探针看 relay child 内部 _rpc state (不是 console daemon 自己 RpcClient).
 * 5s timeout: relay 活时 IPC reply 应 <100ms; 不活 OR 卡 → 5s reject (UI 友好快错).
 * @returns {Promise<{ok:true, state:{...}}|{ok:false, error:string}>}
 */
export async function getRelayRpcState(relayNodeId) {
  try {
    // origin=legacy-unmigrated: 唯二调用方 api/relay.js:382/:418 UI 健康探针=请求触发(9c5f32db ⚠复核项④实核: 非 daemon), 过渡标
    const result = await sendCommandAsync(relayNodeId, { type: 'get_rpc_state' }, 5000, 'legacy-unmigrated');
    return result;  // 期望 {ok:true, state:{connected, reconnecting, attempt, currentUrl, lastConnectedAt, lastError}}
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * B2 v0.5 Phase 3 bug 7 fix — transfer + confirm the UTXO landed in the accepted UTXO set.
 *
 * "NO TX NO STATE CHANGE": a TX can be mempool-accepted (transfer returns a txId) yet lose
 * a double-spend race (is_accepted=false) → no UTXO. Callers MUST confirm before recording
 * success / advancing protocol state. This helper does transfer → poll check_utxo_landed.
 *
 * Cross-line shared (= pool.js + broker exchange-machine.js + 1V1 trading.js should adopt).
 *
 * @param {string} relayNodeId - the relay performing the transfer
 * @param {string} target - destination address (P2SH or P2PK)
 * @param {string} amount - KAS amount string
 * @param {object} [opts]
 * @param {number} [opts.pollIntervalMs=3000]
 * @param {number} [opts.maxWaitMs=30000]
 * @param {number} [opts.minDepth] - 事故硬化(2026-07-08, yxllc spine 100KAS 追踪战役): 不传时走
 *   check_utxo_landed 的默认(浅/mempool-accepted 级)确认——block 层面是 blue 不代表这笔 tx 本身赢了
 *   acceptance(同一源 UTXO 若被 gateway 自己另一笔并发 tx 竞争, 可能在 acceptance 层输掉, 但两笔都可能
 *   先后进过 mempool/被广播, 浅确认看不出来)。调用方在"这笔钱后续要落库当作权威真相"的场景(如 create-v07
 *   的 spine_lock_tx, DB INSERT 之前)必须显式传 minDepth(如 REORG_SAFE_MIN_DEPTH=20, 见
 *   pool-shard-register.mjs), 用更深的确认换更低的"落库了但链上其实没作数"风险。不传 = 原有行为不变
 *   (向后兼容, 不强改所有既有调用点的语义)。
 * @returns {Promise<{ ok: true, txId: string, landed: true }>} on confirmed landing
 * @throws if transfer fails OR the UTXO never lands within maxWaitMs
 */
export async function transferAndConfirm(relayNodeId, target, amount, opts = {}) {
  const pollIntervalMs = opts.pollIntervalMs || 3000;
  const maxWaitMs = opts.maxWaitMs || 30000;
  const minDepth = opts.minDepth;   // undefined = 原有浅确认行为, 不传不变
  // opts.origin 透传(9c5f32db ⚠复核项①实核: 共享钱路 helper 混合调用方——pool.js 请求触发路由+transport daemon,
  // 硬编码 internal=blanket-internal 病(请求触发面冒充 TCB), 由调用方声明; 不传=undefined→armed 下 fail-closed 逼声明。
  const origin = opts.origin;

  const result = await sendCommandAsync(relayNodeId, { type: 'transfer', target, amount }, undefined, origin);
  if (!result) throw new Error('relay not running');
  if (result.error) throw new Error(`transfer failed: ${result.error}`);
  const txId = result.txId;
  if (!txId) throw new Error('transfer returned no txId');

  // Poll until the UTXO from this txId appears at the target (= accepted UTXO set, at minDepth if given).
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    let check;
    try {
      const cmd = { type: 'check_utxo_landed', address: target, txid: txId };
      if (minDepth != null) cmd.minDepth = minDepth;
      check = await sendCommandAsync(relayNodeId, cmd, 10000, origin);
    } catch (e) {
      continue;  // transient RPC error — keep polling until deadline
    }
    if (check?.landed) return { ok: true, txId, landed: true };
  }
  throw new Error(`transfer ${txId} mempool-accepted but UTXO did not land at ${target} within ${maxWaitMs}ms${minDepth != null ? ` at minDepth=${minDepth}` : ''} (= likely lost a double-spend race, is_accepted=false)`);
}

