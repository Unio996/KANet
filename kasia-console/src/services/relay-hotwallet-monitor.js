// relay-hotwallet-monitor.js — NWT 2-1 v0.2 驻留期热钱包监控（docs/2026-09-14-nwt-mainnet-relay-
// hotwallet-cap-and-cold-hot-separation-spec-v0.2.md, Codex TOCTOU 审, Bettor 1150 派工）。
//
// 为什么需要这个独立文件（不是塞进 relay-health-monitor.js 的 tick）：v0.1 的三条准入检查
// （relay-manager.js:startRelay() 里的 checkHotwalletAdmission）只在【启动那一刻】生效——relay
// 一旦真的启动了，运行期间收到入账可以把余额推过上限，私钥仍在进程内存里，v0.1 完全没覆盖这个
// 窗口。本文件补上"进来之后被塞大了"这一半，结构镜像 relay-health-monitor.js（同款 setInterval/
// STARTUP_GRACE_MS/running 互斥重入防护，不发明新范式），但故意不复用它的 tick 本身——那个 tick
// 的存在意义是"进程死没死"，RH_OFF=1 是给调试用的已知开关；如果把资金监控也塞进同一个 tick，
// 任何人出于跟资金无关的理由设 RH_OFF=1 会连带把安全监控也关掉，这是一个不该存在的耦合。
//
// 🔴 只在设置了 v0.1 §3 的两个 cap（RELAY_HOTWALLET_PER_RELAY_MAX_KAS / RELAY_HOTWALLET_TOTAL_
// MAX_KAS）时才启动这个 tick——没设 cap 就没有"超限"这个概念，跟 checkHotwalletAdmission()"未设
// env=不启用该项检查"是同一个原则，不是这次新发明的例外。
//
// 🔴 关闭开关不叫 RH_OFF 或任何看起来像它的名字——HOTWALLET_MONITOR_OFF，且设置时打印 LOUD 警告
// （这是资金安全监控，不是调试便利开关，不该跟其它开关一样一行 env 就悄无声息关掉不留痕迹）。
//
// 🔴 超限处置只做一件事：kill 子进程（relay-manager.js 的 stopRelay 已经是既有可调用的 kill 路径，
// 不需要新写）——这是唯一真正解决"私钥在内存里"这件事的动作。不新增"隔离标记"字段：v0.1 §5 的
// 准入门已经是每一次启动尝试（不管谁触发）都要重新过一遍的检查，被杀掉的这一行只要余额仍然超限，
// 任何后续想拉起它的尝试都会在 startRelay() 那一步被同一条既有检查挡下来，不需要额外状态。
// 🔴 不自动转移超限资金——检测到超限=杀进程+响亮告警，钱原地不动，怎么处理这笔钱是 Owner 的决定，
// 不是这个监控脚本自己拍。

import { sqlite } from '../db/client.js';
import { getStatus, stopRelay } from './relay-manager.js';
import { getWorkingRpc } from './rpc-health.js';
import { randomUUID } from 'crypto';

const TICK_INTERVAL_MS = Number(process.env.RELAY_HOTWALLET_MONITOR_TICK_MS) || 30_000;
const STARTUP_GRACE_MS = 90_000;
// 同 relay-health-monitor.js 的 MAX_RESTART_PER_HOUR 用同一个"3次"量级——不是随手拍的数字，
// 避免因为单次 RPC 抖动就误杀，同时不允许无限期容忍查不到（NWT v0.2 §1 第 4 条原话）。
const MAX_CONSECUTIVE_QUERY_FAILURES = 3;

let timer = null;
let running = false;
const _failureCounts = new Map();   // relayNodeId → 连续查询失败次数（含余额查询失败 + 行/地址缺失）
const _prevBalances = new Map();    // relayNodeId → 上次 tick 成功查到的余额（KAS）, 用于归因总额超线的账
// 🔴 Codex 审 45594804 抓到的真缺口（Bettor 1154 核过）：resolveRpcUrl() 在 per-relay 的
// try/catch 之外，RPC 解析持续失败时只走外层 tick catch 打一行 "tick fail" 日志就 return——
// 不增任何 relay 的 failureCounts、不杀任何 relay，全局 RPC 中断下所有有资金 relay 的私钥
// 无限期驻留，违反 v0.2 "连续3次查不到=fail-closed"这条对整个 tick 前置条件同样成立的原则
// （不是只对"查到了但这一个relay余额取不到"成立，"根本拿不到任何relay的可信余额集"这个更上游
// 的失败一样要 fail-closed，而且更严重——影响的是全部relay不是一个）。用一个独立的全局连续
// 失败计数覆盖：rpcUrl 解析失败(抛错或返回空)、relay_nodes 行查询本身抛错，这两类"根本拿不到
// 可信余额集"的前置失败，跟"查到了集合但某一个relay查不到余额"的per-relay失败計数分开算，
// 各自独立达到阈值各自触发处置（不混在一起，一个全局失败不该稀释/污染某个relay自己的历史）。
const _globalPrecheckFailureCount = { value: 0 };

// 同 relay-manager.js:_queryBalanceKas 逐字同款实现（getSharedRpc + getBalancesByAddresses,
// 已验证过能工作的那段逻辑）——本文件是独立模块，不从 relay-manager.js 里 import 这个内部
// helper（那是模块私有函数，未导出），重复这几行比扩大 relay-manager.js 的导出面更干净。
async function _queryBalanceKas(address, network, rpcUrl) {
  const { Address } = await import('kaspa-wasm');
  const { getSharedRpc } = await import('../lib/kaspa-rpc-shared.mjs');
  const rpc = await getSharedRpc({ url: rpcUrl, networkId: network || 'mainnet' });
  const { entries } = await rpc.getBalancesByAddresses([new Address(address)]);
  return Number(entries?.[0]?.balance || 0n) / 1e8;
}

// 告警：kill 动作必须同时写一条到既有协调信道——本仓已有的团队可见机制是 events 表（DATABASE.md:
// "写入方=所有模块", oracle-voter-health-monitor.js 是最近的同类先例), 不新造通知渠道。
function _writeAlertEvent(relayNodeId, name, reason, detail) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'hotwallet_relay_killed', 'relay-hotwallet-monitor', 'error', ?, ?, datetime('now'))
    `).run(
      randomUUID(),
      `🔴 [热钱包监控] 已杀掉 relay "${name}"（${relayNodeId}）: ${reason}`,
      JSON.stringify({ relayNodeId, name, reason, detail })
    );
  } catch (e) {
    console.error(`[relay-hotwallet-monitor] events insert fail (non-fatal): ${e.message}`);
  }
}

async function _defaultKill(relayNodeId, name, reason, detail) {
  console.error(`[relay-hotwallet-monitor] KILLING ${name} (${relayNodeId}): ${reason}${detail ? ' — ' + JSON.stringify(detail) : ''}`);
  const result = await stopRelay(relayNodeId).catch((e) => ({ ok: false, reason: 'stop_threw', error: e.message }));
  _writeAlertEvent(relayNodeId, name, reason, { ...detail, stopResult: result });
  return result;
}

function _defaultGetRelayRows(ids) {
  const placeholders = ids.map(() => '?').join(',');
  return sqlite.prepare(`SELECT id, address, network FROM relay_nodes WHERE id IN (${placeholders})`).all(...ids);
}

/**
 * 单次 tick。第一参 `deps` 是可选依赖注入（同 checkHotwalletAdmission 那份既有 DI 约定——不是
 * `*ForTests` 专名导出，是默认走真实实现、测试可覆盖的普通可选参数），让测试在不连真实 RPC/DB/
 * 不起真实 relay 子进程的情况下验证 tick 判断逻辑本身：
 * - `listRunning()` 覆盖 getStatus()（默认）
 * - `getRelayRows(ids)` 覆盖对 relay_nodes 的地址/网络查询（默认真实 SELECT）
 * - `resolveRpcUrl()` 覆盖 getWorkingRpc()（默认）
 * - `queryBalanceKas(address, network, rpcUrl)` 覆盖真实链上余额查询（默认）
 * - `kill(relayNodeId, name, reason, detail)` 覆盖真正的 stopRelay+events 写入（默认）
 * - `failureCounts`/`prevBalances` 覆盖模块级状态 Map（默认用模块级单例——测试传入独立的新
 *   `Map()` 隔离状态，不污染真实监控的连续失败计数/上次余额记忆）
 * - `globalPrecheckFailureCount` 覆盖模块级 `{value}` 计数容器（同上, 测试传入独立对象隔离）
 * - `perRelayMaxCap`/`totalMaxCap` 覆盖两个上限 env（默认读 process.env）
 */
export async function relayHotwalletMonitorTick(deps = {}) {
  const {
    listRunning = getStatus,
    getRelayRows = _defaultGetRelayRows,
    resolveRpcUrl = async () => (await getWorkingRpc()).url,
    queryBalanceKas = _queryBalanceKas,
    kill = _defaultKill,
    failureCounts = _failureCounts,
    prevBalances = _prevBalances,
    globalPrecheckFailureCount = _globalPrecheckFailureCount,
    perRelayMaxCap = Number(process.env.RELAY_HOTWALLET_PER_RELAY_MAX_KAS),
    totalMaxCap = Number(process.env.RELAY_HOTWALLET_TOTAL_MAX_KAS),
  } = deps;

  if (running) return { skipped: true };
  if (!Number.isFinite(perRelayMaxCap) && !Number.isFinite(totalMaxCap)) {
    return { skipped: true, reason: 'no_cap_configured' };
  }
  running = true;
  const _tickStart = Date.now();

  async function killAndCleanup(relayNodeId, name, reason, detail) {
    const result = await kill(relayNodeId, name, reason, detail);
    failureCounts.delete(relayNodeId);
    prevBalances.delete(relayNodeId);
    return result;
  }

  // 全局前置失败处置：resolveRpcUrl()/getRelayRows() 任一失败都意味着"这一 tick 根本拿不到任何
  // relay 的可信余额集"——不是某一个relay的问题，是整个 tick 没法判断任何东西。连续 3 次（同一
  // 阈值，NWT v0.2 §1 第4条原话"连续3次"是唯一权威量级）后 fail-closed：杀掉当前所有正在跑的
  // relay（此刻唯一能确定的安全动作——不知道谁超限, 但知道"不知道"本身就该当超限处理）。
  async function _globalPrecheckFail(runningRelays, reason, err) {
    globalPrecheckFailureCount.value += 1;
    console.warn(`[relay-hotwallet-monitor] global precheck failed (${globalPrecheckFailureCount.value}/${MAX_CONSECUTIVE_QUERY_FAILURES}) reason=${reason}: ${err?.message || err}`);
    if (globalPrecheckFailureCount.value >= MAX_CONSECUTIVE_QUERY_FAILURES) {
      console.error(`[relay-hotwallet-monitor] global precheck persistently failed (${reason}) — fail-closed killing all ${runningRelays.length} running relay(s), 无法确认任何一个的余额是否安全`);
      for (const r of runningRelays) {
        await killAndCleanup(r.relayNodeId, r.name, `global_precheck_persistently_failed_fail_closed_${reason}`,
          { consecutiveGlobalFailures: globalPrecheckFailureCount.value });
      }
      globalPrecheckFailureCount.value = 0; // 杀完清零——杀光后下次要么无relay在跑直接短路, 要么是全新一轮
      return { ok: false, reason: `global_precheck_failed_all_killed_${reason}`, checked: runningRelays.length, killed: runningRelays.length };
    }
    return { ok: false, reason: `global_precheck_failed_${reason}`, consecutiveGlobalFailures: globalPrecheckFailureCount.value, checked: 0, killed: 0 };
  }

  try {
    const runningRelays = listRunning(); // [{relayNodeId, name, pid, ...}] — 当前"真的活着"的那些
    if (runningRelays.length === 0) {
      return { ok: true, checked: 0, killed: 0 };
    }

    // 🔴 两个前置步骤(rpcUrl 解析 / relay_nodes 行查询)共用同一个全局计数——只有【两步都成功】
    // 才清零，不能在某一步成功后就立即清零：如果只有其中一步持续失败、另一步每次都成功，"每步
    // 独立清零"会让每次成功的那一步把失败的那一步刚攒的计数抹掉，永远到不了阈值(本条是实测撞出
    // 来的：写完第一版负向量测试时 getRelayRows 持续抛错但 rpcUrl 总是先成功一步就把计数清零了,
    // 3 次调用后计数还停在 1，暴露了这个 bug，不是凭空想到要写这条注释)。
    let rpcUrl;
    try {
      rpcUrl = await resolveRpcUrl();
      if (!rpcUrl) throw new Error('resolveRpcUrl returned empty url');
    } catch (e) {
      return await _globalPrecheckFail(runningRelays, 'rpc_url_unavailable', e);
    }

    const ids = runningRelays.map((r) => r.relayNodeId);
    let rows;
    try {
      rows = getRelayRows(ids);
    } catch (e) {
      return await _globalPrecheckFail(runningRelays, 'relay_rows_query_threw', e);
    }
    globalPrecheckFailureCount.value = 0; // 两步都成功——现在才清零

    const byId = new Map(rows.map((r) => [r.id, r]));

    const killedThisTick = new Set();
    const currentBalances = new Map(); // relayNodeId → balance（只含这次查询成功的）

    // 1) 逐个查余额；per-relay 上限超线立即处置；查询失败计连续失败数，达阈值 fail-closed 处置。
    for (const r of runningRelays) {
      const row = byId.get(r.relayNodeId);
      if (!row?.address) {
        // 🔴 Bettor 1154 ②: 这不是"正常情况，跳过就好"——一个正在跑的 relay 理论上不可能没有
        // address（startRelay() 的 no_address 检查本该在它启动前就挡住这种情况），出现这个状态
        // 本身是数据不变量被破坏，必须 LOUD 报出来，且不能无限期静默 skip：计入该 relay 自己的
        // 连续失败计数，跟余额查询失败走同一条 fail-closed 路径，达阈值一样被杀。
        const failCount = (failureCounts.get(r.relayNodeId) || 0) + 1;
        failureCounts.set(r.relayNodeId, failCount);
        console.error(`[relay-hotwallet-monitor] 🔴 不变量违规: 正在跑的 relay "${r.name}"（${r.relayNodeId}）在 relay_nodes 里查不到行或没有 address（${failCount}/${MAX_CONSECUTIVE_QUERY_FAILURES}）——理论上不该发生, startRelay() 的 no_address 检查本该挡住。`);
        if (failCount >= MAX_CONSECUTIVE_QUERY_FAILURES) {
          await killAndCleanup(r.relayNodeId, r.name, 'relay_row_or_address_missing_invariant_violation_fail_closed',
            { consecutiveFailures: failCount });
          killedThisTick.add(r.relayNodeId);
        }
        continue;
      }
      let balance;
      try {
        balance = await queryBalanceKas(row.address, row.network, rpcUrl);
        failureCounts.set(r.relayNodeId, 0);
      } catch (e) {
        const failCount = (failureCounts.get(r.relayNodeId) || 0) + 1;
        failureCounts.set(r.relayNodeId, failCount);
        console.warn(`[relay-hotwallet-monitor] ${r.name} balance query failed (${failCount}/${MAX_CONSECUTIVE_QUERY_FAILURES}): ${e.message}`);
        if (failCount >= MAX_CONSECUTIVE_QUERY_FAILURES) {
          // NWT v0.2 §1 第4条原话: 查不到=当作可能超限处理, 不是当作没超限处理。
          await killAndCleanup(r.relayNodeId, r.name, 'balance_query_persistently_failed_fail_closed',
            { consecutiveFailures: failCount });
          killedThisTick.add(r.relayNodeId);
        }
        continue;
      }

      currentBalances.set(r.relayNodeId, balance);

      if (Number.isFinite(perRelayMaxCap) && balance > perRelayMaxCap) {
        await killAndCleanup(r.relayNodeId, r.name, 'per_relay_cap_exceeded_while_running',
          { balance, cap: perRelayMaxCap });
        killedThisTick.add(r.relayNodeId);
        currentBalances.delete(r.relayNodeId);
      }
    }

    // 2) 总额上限：只看这次 tick 还活着(没被步骤1杀掉)且余额查询成功的那些。
    if (Number.isFinite(totalMaxCap)) {
      const survivors = [...currentBalances.entries()].filter(([id]) => !killedThisTick.has(id));
      let total = survivors.reduce((sum, [, bal]) => sum + bal, 0);

      if (total > totalMaxCap) {
        // 按"这次比上次涨得最多的relay负责"排序——涨幅用本次减上次已知余额, 没有上次记录的算涨幅0
        // (不能把"第一次被本监控看到"就当成"它偷偷进账了全部余额", 那样会错误归罪于新出现的候选)。
        const withDelta = survivors.map(([id, bal]) => {
          const prev = prevBalances.has(id) ? prevBalances.get(id) : bal;
          return { id, bal, delta: bal - prev };
        });
        const anyPositiveDelta = withDelta.some((x) => x.delta > 0);

        if (!anyPositiveDelta) {
          // 无法归因(没有任何一个relay在这次tick比上次涨) —— 保守起见全部当前活着的relay都触发处置。
          console.error(`[relay-hotwallet-monitor] hotwallet_total_cap_exceeded (total=${total} cap=${totalMaxCap}), 无法归因到具体relay(无正向delta) — 保守全杀`);
          for (const { id, bal } of withDelta) {
            const r = runningRelays.find((x) => x.relayNodeId === id);
            await killAndCleanup(id, r?.name || id, 'hotwallet_total_cap_exceeded_unattributable_kill_all',
              { balance: bal, total, cap: totalMaxCap });
            killedThisTick.add(id);
          }
        } else {
          withDelta.sort((a, b) => b.delta - a.delta); // 涨幅从大到小
          for (const { id, bal, delta } of withDelta) {
            if (total <= totalMaxCap) break;
            const r = runningRelays.find((x) => x.relayNodeId === id);
            await killAndCleanup(id, r?.name || id, 'hotwallet_total_cap_exceeded_attributed_by_delta',
              { balance: bal, delta, total, cap: totalMaxCap });
            killedThisTick.add(id);
            total -= bal;
          }
        }
      }
    }

    // 3) 记住这次成功查到、且没被杀的余额，供下次 tick 归因用。
    for (const [id, bal] of currentBalances) {
      if (!killedThisTick.has(id)) prevBalances.set(id, bal);
    }
    // 被杀的行已经在 killAndCleanup 里从 prevBalances 删除了——不留陈旧余额干扰下次判断。

    if (killedThisTick.size > 0) {
      console.log(`[relay-hotwallet-monitor] tick checked=${runningRelays.length} killed=${killedThisTick.size}`);
    }
    console.log(`[diag:tick-duration] relayHotwalletMonitorTick ms=${Date.now() - _tickStart} checked=${runningRelays.length} killed=${killedThisTick.size}`);
    return { ok: true, checked: runningRelays.length, killed: killedThisTick.size, killedIds: [...killedThisTick] };
  } catch (e) {
    console.error('[relay-hotwallet-monitor] tick fail:', e.message);
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

function _capsConfigured() {
  const perRelayMax = Number(process.env.RELAY_HOTWALLET_PER_RELAY_MAX_KAS);
  const totalMax = Number(process.env.RELAY_HOTWALLET_TOTAL_MAX_KAS);
  return Number.isFinite(perRelayMax) || Number.isFinite(totalMax);
}

export function startRelayHotwalletMonitorCron() {
  if (timer) return;
  if (process.env.HOTWALLET_MONITOR_OFF === '1') {
    console.error('[relay-hotwallet-monitor] 🔴🔴🔴 HOTWALLET_MONITOR_OFF=1 — 资金监控已手动关闭。这不是调试便利开关，是关闭驻留期热钱包余额监控（relay 启动后收到入账被推过上限也不会被发现/处置）。确认这确实是你想要的。');
    return;
  }
  if (!_capsConfigured()) {
    console.log('[relay-hotwallet-monitor] RELAY_HOTWALLET_PER_RELAY_MAX_KAS / RELAY_HOTWALLET_TOTAL_MAX_KAS 均未设置 — 不启用该项检查（同 startRelay() 准入门"未设env=不启用"的既有原则），tick 不会启动。');
    return;
  }
  console.log(`[relay-hotwallet-monitor] started — tick=${TICK_INTERVAL_MS}ms grace=${STARTUP_GRACE_MS}ms max_consecutive_failures=${MAX_CONSECUTIVE_QUERY_FAILURES}`);
  setTimeout(() => {
    relayHotwalletMonitorTick().catch((e) => console.error('[relay-hotwallet-monitor] startup tick:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    relayHotwalletMonitorTick().catch((e) => console.error('[relay-hotwallet-monitor] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopRelayHotwalletMonitorCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
