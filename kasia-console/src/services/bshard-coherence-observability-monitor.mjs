// bshard-coherence-observability-monitor.mjs — K-18 §3.3 门禁事件"喊疼"巡检(J1tn 2026-07-21)
//
// docs/2026-07-21-p2-batch2-coherence-gate-wiring-design.md §1(Bettor 方向审 #uhke6f.1/.2 note②,
// "最实质"的一条,NWT diff 审用实证坐实): non-blocking gate 写 `events` 表这件事本身不构成"有观察者"——
// K-18 §3.4 的 P0 先例事件 `ps_redeem_recompile_mismatch`(bshard-settle-daemon.mjs:305)全库 grep 只有
// 写入这一处,零处读取/消费/监控,是"牙建好没人看"这类坑(memory `reference-trustless-teeth-built-not-armed`)
// 的活标本——本模块把这个洞连同新引入的 `ps_coherence_gate_fail`(K-18 §3.3 门禁本批新写)一起补上真正
// 的观察者,不留半吊子(NWT 原话)。
//
// 架构镜像 `spc-daa-index-monitor.mjs`(同一 J1tn 2026-07-16 先例,已 NWT 攻击面审过的成熟模式):
// tick 定时读 events 表统计 + 去重(同一窗口只报一次,不刷屏)+ 写一条更高层级的汇总事件,把"某个具体
// 事件类型是否需要人关注"这件事从"被动写入表等人主动来查"升级成"主动定期喊话"。
//
// 观察窗设计(呼应 v185 endpoint_hit_counters 的 7 天 observe-only 窗先例,Bettor 明确点名同款不重新发明):
// 每次 tick 统计过去 24h 的两类事件计数,分桶(已知 78 行 unknown 桶 vs 未归因)——未归因数量非零才升级写汇总
// 事件(已知桶数量再多也不算"新问题",只是背景噪音,K-18 §3.1 backfill 报告已经交代过)。
//
// **domain 归属(Bettor 要求写明,不留"以后有人会记得看"这种自觉性假设)**: J1(K-18/bshard covenant 域)
// 是这条巡检信号的责任方——收到 `ps_coherence_observability_digest`(level != 'info' 时)事件即视为需要
// J1 介入核实。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_MS = 60 * 60 * 1000; // 1h tick,统计过去 24h 窗口(比纯 24h 一 tick 更快发现问题,同时仍是"日级"粒度的观察)
const WINDOW_HOURS = 24;
const DIGEST_EVENT_TYPE = 'ps_coherence_observability_digest';
const WATCHED_TYPES = ['ps_redeem_recompile_mismatch', 'ps_coherence_gate_fail'];

// 已知桶(K-18 §3.1 batch1 backfill dry-run 报告,2026-07-21,721 行里 78 行 unknown = refunded 63 +
// pruned_expired_waived 15,全部已归因、非在途盘)——summary/payload 里出现这两类状态名之一的事件视为
// "已知背景噪音",不触发升级;出现其它内容才是"未归因",才是本巡检真正要抓的信号。
const KNOWN_BUCKET_MARKERS = ['refunded', 'pruned_expired_waived'];

let _interval = null;

function _isKnownBucket(row) {
  const text = `${row.summary || ''} ${row.payload_json || ''}`;
  return KNOWN_BUCKET_MARKERS.some(m => text.includes(m));
}

function _tick() {
  try {
    const placeholders = WATCHED_TYPES.map(() => '?').join(',');
    const rows = sqlite.prepare(`
      SELECT event_type, summary, payload_json FROM events
       WHERE event_type IN (${placeholders}) AND created_at > datetime('now', ?)
    `).all(...WATCHED_TYPES, `-${WINDOW_HOURS} hours`);

    if (rows.length === 0) return; // 过去 24h 零事件 — 静默(不刷屏"一切正常", 同 spc-daa-index-monitor 只在有信号时才写)。

    const byType = {};
    let unattributed = 0;
    for (const r of rows) {
      byType[r.event_type] = (byType[r.event_type] || 0) + 1;
      if (!_isKnownBucket(r)) unattributed++;
    }

    // 去重: 同一 unattributed>0 状态下, 1h 内只报一次(镜像 spc-daa-index-monitor 的收敛思路)。
    const recent = sqlite.prepare(`
      SELECT id FROM events WHERE event_type = ? AND created_at > datetime('now', '-55 minutes') LIMIT 1
    `).get(DIGEST_EVENT_TYPE);
    if (recent) return;

    const level = unattributed > 0 ? 'warn' : 'info';
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'bshard-coherence-observability-monitor', ?, ?, ?, datetime('now'))
    `).run(
      randomUUID(), DIGEST_EVENT_TYPE, level,
      unattributed > 0
        ? `过去${WINDOW_HOURS}h K-18 coherence 事件 ${rows.length} 条(${JSON.stringify(byType)}), 其中 ${unattributed} 条未归因(不在已知 refunded/pruned_expired_waived 桶内) — 需要 J1 域核实, 不是背景噪音`
        : `过去${WINDOW_HOURS}h K-18 coherence 事件 ${rows.length} 条(${JSON.stringify(byType)}), 全部落在已知桶内(refunded/pruned_expired_waived), 无需介入`,
      JSON.stringify({ byType, total: rows.length, unattributed, windowHours: WINDOW_HOURS }),
    );
  } catch (e) {
    console.warn(`[bshard-coherence-observability-monitor] tick error (non-fatal): ${e.message}`);
  }
}

export function startBshardCoherenceObservabilityMonitor() {
  if (_interval) return;
  console.log(`[bshard-coherence-observability-monitor] cron start, tick=${TICK_MS}ms, window=${WINDOW_HOURS}h`);
  _interval = setInterval(_tick, TICK_MS);
  setTimeout(_tick, 5000); // startup pass, 同既有 cron 惯例
}
export function stopBshardCoherenceObservabilityMonitor() { if (_interval) { clearInterval(_interval); _interval = null; } }
