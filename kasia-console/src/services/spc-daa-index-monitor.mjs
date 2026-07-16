// spc-daa-index-monitor.mjs — spc_daa_index 完整性巡检 (J1tn 2026-07-16)
//
// docs/2026-07-08-backward-walk-daa-index-design.md §2.2 note①(Bettor 方向审 GREEN #o0056j):
// 9ez2u 的根因链第一层正是"索引停更没人知道"——常驻写入器本身也可能静默死，没有喊疼机制就是
// 把同族事故留给下一次。本模块定时比对 spc_daa_index 的最大 daa_score 与 relay 上报的 tip 心跳
// (spc_tip_heartbeat)，落后超阈值写 events 表(既有审计/告警表，同 Z20 熔断告警管道，不新开机制)。
//
// 架构边界(NWT 攻击面审 #o0056j 必须澄清项，Bettor 裁定): Console 不直连 kaspad RPC(Relay 唯一
// 链上出口, docs/KANet-Positioning.md) —— "当前 tip" 只能读 relay 上报的心跳表，不能自己查链。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_MS = 5 * 60 * 1000; // 5min，同 broker-intake-watcher 等既有 cron 量级
// TODO(J1tn, 明天): 占位阈值，NWT note——"宁紧勿松"，先用小阈值保证喊疼管线本身是通的，
// 明天用 spc_daa_index 实数据的相邻 daa_score 差值分布校准成精确值。
const STALE_THRESHOLD_DAA_PLACEHOLDER = 500;
const STALE_EVENT_TYPE = 'spc_daa_index_stale';

let _interval = null;

function _tick() {
  try {
    const heartbeat = sqlite.prepare(`SELECT daa_score, updated_at FROM spc_tip_heartbeat WHERE id = 1`).get();
    if (!heartbeat) return; // relay 还没发过心跳(刚启动/未升级) — 不是"停更"，是"还没开始"，不误报

    const indexed = sqlite.prepare(`SELECT MAX(daa_score) AS mx FROM spc_daa_index`).get();
    const maxIndexed = indexed?.mx;
    if (maxIndexed == null) return; // backfill/写入器都还没产出任何一行 — 同上，不在本次巡检 scope 内误报

    const gap = heartbeat.daa_score - maxIndexed;
    if (gap <= STALE_THRESHOLD_DAA_PLACEHOLDER) return;

    // 去重: 同一次"落后未恢复"期间只报一次，不每 5min 刷屏(镜像 Z20 circuit-break 的 streak 收敛思路，
    // 这里简化成"检查最近一条同类型 event 是否已覆盖当前 gap 量级")。
    const recent = sqlite.prepare(`
      SELECT id FROM events WHERE event_type = ? AND created_at > datetime('now', '-1 hour') LIMIT 1
    `).get(STALE_EVENT_TYPE);
    if (recent) return;

    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'spc-daa-index-monitor', 'warn', ?, ?, datetime('now'))
    `).run(
      randomUUID(),
      STALE_EVENT_TYPE,
      `spc_daa_index 落后 tip ${gap} DAA(阈值${STALE_THRESHOLD_DAA_PLACEHOLDER}, 占位值待明天校准) — 常驻写入器疑似停更, 9ez2u 同族根因防线触发`,
      JSON.stringify({ maxIndexed, tipDaaScore: heartbeat.daa_score, gap, heartbeatUpdatedAt: heartbeat.updated_at }),
    );
  } catch (e) {
    console.warn(`[spc-daa-index-monitor] tick error (non-fatal): ${e.message}`);
  }
}

export function startSpcDaaIndexStaleCheck() {
  if (_interval) return;
  console.log(`[spc-daa-index-monitor] cron start, tick=${TICK_MS}ms`);
  _interval = setInterval(_tick, TICK_MS);
  setTimeout(_tick, 5000); // startup pass，同既有 cron 惯例
}
export function stopSpcDaaIndexStaleCheck() { if (_interval) { clearInterval(_interval); _interval = null; } }
