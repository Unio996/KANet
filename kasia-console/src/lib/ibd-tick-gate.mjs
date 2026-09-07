// ibd-tick-gate.mjs — M2 (2026-09-05, Owner 全批 ledger 880 · Bettor 派工 881 · NWT 预置 C1-C4): IBD 期跳过"读链或要广播"的结算类 tick。
// 用法(每个 tick 函数第一行, 在重入锁与任何 DB 扫描之前 —— Bettor 硬要求 1 / NWT C2: 门先于 `running = true`, 跳过的 return 不碰锁, 不会把站锁死):
//     if (await ibdGateSkip('settle.tick')) return;            // 或 return { skipped: true, reason: 'ibd' } 保持原早退形
// 门极性 —— 🔴 G-2 改口径(2026-09-07, 设计 docs/2026-09-07-j2-g1-g2-node-trust-gate-and-console-rpc-selfheal-design-v0.1.md v0.2 §3.1/§4 G2-5 · NWT GREEN-final · Bettor GO):
//   **只有 gate.isSynced === true 才放行**; false / null(rpc-fail / no-rpc-url / isSynced-unreadable / network-mismatch) / 读门抛错 / gate 缺失 ⇒ 都跳(fail-closed)。
//   原 M2 口径是"只在确认 false 时跳、unknown 不跳(fail-open)"——2026-09-06 22:55Z kaspad 重启后 12 站点同刻 `resume … reason=rpc-fail` 放行,
//   门读数又被 rpc-health 回退到的公网 mainnet 节点喂成 synced(ledger 967/974, jepu1 页 §3): fail-open + 错节点 = 门等于没有。
//   与 preprune-capture-worker 自己的门(`synced !== true` 即跳, 08-30 批)口径统一。
// 判定复用 preprune-capture-worker.mjs 的 isNodeSyncedCached(权威源 = 本机 KASPA_RPC_URL 的 getServerInfo(): isSynced ∧ networkId===KASPA_NETWORK, TTL 30 s, 共享 RPC 单例)。
// 日志(NWT C3, 防 IBD 数日 × 15 站 × 30-60 s 灌十万行): 每站只在【状态翻转】时打一行 + 跳过态每 10 min 一行心跳; 与 preprune 同形便于 grep:
//     [<site>] skip: node not synced (isSynced=<v>, reason=<r>)                              // 进入跳过态
//     [<site>] skip: node not synced (isSynced=<v>, reason=<r>, heartbeat, streak=<n>, since=<iso>)   // 10 min 心跳(G-2 NWT SHOULD: 防 fail-closed 后静默停摆, streak/since 可 grep)
//     [<site>] resume: node synced (reason=<r>)                                             // 离开跳过态
//   canonical 前缀 `skip: node not synced (` / `resume: node synced (` 不变(全站监控按行 grep)。
// 回滚: env IBD_TICK_GATE=0 ⇒ 永不跳且不读门(每次调用读 env, 不需重启改码)。
import { isNodeSyncedCached } from '../services/preprune-capture-worker.mjs';

const _state = new Map();   // site → { skipping: boolean, lastLogAt: ms, streak: n, since: ms }
const HEARTBEAT_MS = 10 * 60_000;

export function ibdGateEnabled(env = process.env) { return env.IBD_TICK_GATE !== '0'; }

/**
 * @param {string} site  站名(与 wrapTick 站名一致, 如 'settle.tick' / 'zk.closeTickV2')
 * @param {{read?:Function, now?:Function, log?:Function, heartbeatMs?:number, env?:object}} [deps]  测试注入
 * @returns {Promise<boolean>}  true = 本 tick 该跳过(节点未确认同步/不可信); false = 照常跑(gate.isSynced === true)
 */
export async function ibdGateSkip(site, { read = isNodeSyncedCached, now = Date.now, log = console.log, heartbeatMs = HEARTBEAT_MS, env = process.env } = {}) {
  if (!ibdGateEnabled(env)) return false;
  let gate;
  try { gate = await read(); } catch (e) { gate = { synced: false, isSynced: null, reason: `read-error: ${String(e?.message || e).slice(0, 80)}` }; }   // G-2: 读门抛错 = unknown ⇒ 跳
  const skip = !gate || gate.isSynced !== true;           // G-2: 只认确认的 true
  try {
    const t = now();
    const st = _state.get(site) || { skipping: false, lastLogAt: 0, streak: 0, since: 0 };
    const isSyncedStr = gate ? String(gate.isSynced) : 'absent';
    const reason = (gate && gate.reason) || (gate ? 'not-synced' : 'gate-absent');
    if (skip) {
      st.streak++;
      if (!st.skipping) { st.since = t; log(`[${site}] skip: node not synced (isSynced=${isSyncedStr}, reason=${reason})`); st.skipping = true; st.lastLogAt = t; }
      else if (t - st.lastLogAt >= heartbeatMs) { log(`[${site}] skip: node not synced (isSynced=${isSyncedStr}, reason=${reason}, heartbeat, streak=${st.streak}, since=${new Date(st.since).toISOString()})`); st.lastLogAt = t; }
    } else {
      if (st.skipping) { log(`[${site}] resume: node synced (reason=${reason})`); st.skipping = false; st.lastLogAt = t; }
      st.streak = 0; st.since = 0;
    }
    _state.set(site, st);
  } catch { /* 日志/状态失败不影响判定 */ }
  return skip;
}

export function _resetIbdGateState() { _state.clear(); }
