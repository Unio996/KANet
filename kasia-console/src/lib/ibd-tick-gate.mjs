// ibd-tick-gate.mjs — M2 (2026-09-05, Owner 全批 ledger 880 · Bettor 派工 881 · NWT 预置 C1-C4): IBD 期跳过"读链或要广播"的结算类 tick。
// 用法(每个 tick 函数第一行, 在重入锁与任何 DB 扫描之前 —— Bettor 硬要求 1 / NWT C2: 门先于 `running = true`, 跳过的 return 不碰锁, 不会把站锁死):
//     if (await ibdGateSkip('settle.tick')) return;            // 或 return { skipped: true, reason: 'ibd' } 保持原早退形
// 门极性(NWT C1 / Bettor 881): **只在 gate.isSynced === false 时跳**(确认 IBD); null(rpc-fail / no-rpc-url / isSynced-unreadable)
//   / 读门抛错 / gate 缺失 ⇒ 不跳(fail-open 到原路径)。⚠ preprune-capture-worker 自己的门是 `synced !== true` 即跳(fail-closed),
//   那是它 08-30 单独批的口径, 本文件不复制。
// 判定复用 preprune-capture-worker.mjs 的 isNodeSyncedCached(权威源 getServerInfo().isSynced, TTL 30 s, 共享 RPC 单例)。
// 日志(NWT C3, 防 IBD 数日 × 15 站 × 30-60 s 灌十万行): 每站只在【状态翻转】时打一行 + 跳过态每 10 min 一行心跳; 与 preprune 同形便于 grep:
//     [<site>] skip: node not synced (isSynced=false, reason=<r>)        // 进入跳过态 / 10 min 心跳(带 heartbeat 标)
//     [<site>] resume: node synced (reason=<r>)                          // 离开跳过态
// 回滚: env IBD_TICK_GATE=0 ⇒ 永不跳且不读门(每次调用读 env, 不需重启改码)。
import { isNodeSyncedCached } from '../services/preprune-capture-worker.mjs';

const _state = new Map();   // site → { skipping: boolean, lastLogAt: ms }
const HEARTBEAT_MS = 10 * 60_000;

export function ibdGateEnabled(env = process.env) { return env.IBD_TICK_GATE !== '0'; }

/**
 * @param {string} site  站名(与 wrapTick 站名一致, 如 'settle.tick' / 'zk.closeTickV2')
 * @param {{read?:Function, now?:Function, log?:Function, heartbeatMs?:number, env?:object}} [deps]  测试注入
 * @returns {Promise<boolean>}  true = 本 tick 该跳过(节点确认未同步); false = 照常跑
 */
export async function ibdGateSkip(site, { read = isNodeSyncedCached, now = Date.now, log = console.log, heartbeatMs = HEARTBEAT_MS, env = process.env } = {}) {
  if (!ibdGateEnabled(env)) return false;
  let gate;
  try { gate = await read(); } catch { return false; }   // 读门抛错 = unknown ⇒ 不跳
  const skip = !!gate && gate.isSynced === false;        // 只认确认的 false
  try {
    const t = now();
    const st = _state.get(site) || { skipping: false, lastLogAt: 0 };
    if (skip) {
      if (!st.skipping) { log(`[${site}] skip: node not synced (isSynced=false, reason=${gate.reason || 'not-synced'})`); st.skipping = true; st.lastLogAt = t; }
      else if (t - st.lastLogAt >= heartbeatMs) { log(`[${site}] skip: node not synced (isSynced=false, reason=${gate.reason || 'not-synced'}, heartbeat)`); st.lastLogAt = t; }
    } else if (st.skipping) {
      log(`[${site}] resume: node synced (reason=${(gate && gate.reason) || 'unknown'})`); st.skipping = false; st.lastLogAt = t;
    }
    _state.set(site, st);
  } catch { /* 日志/状态失败不影响判定 */ }
  return skip;
}

export function _resetIbdGateState() { _state.clear(); }
