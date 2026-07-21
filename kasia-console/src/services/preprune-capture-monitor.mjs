// preprune-capture-monitor.mjs — K-17 worker 存活独立监控(2026-07-17, J2)。
//
// NWT MUST-FIX(设计§5点④, 今天 supervisor 静默死 25h 无人发现的同款教训): worker 存活不能靠自报活
// (那是同一单点)。镜像 spc-daa-index-monitor.mjs 的独立巡检模式——本模块跟 preprune-capture-worker.mjs
// 是两个独立定时器, 互不依赖对方存活: worker 挂了, 本监控仍能巡检并告警。
import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_MS = 5 * 60 * 1000; // 同 spc-daa-index-monitor.mjs 量级
// worker tick=60s, 3× 未更新(=3分钟无心跳)即判定停摆——留够 GC/RPC 抖动余量但不放太松(同 K-17 §5
// "宁大勿小"原则里的"心跳阈值"侧, 跟 safety_margin 公式覆盖的"补齐窗口"是两个不同阈值, 不要混淆)。
const STALE_THRESHOLD_MS = 3 * 60 * 1000;
const STALE_EVENT_TYPE = 'preprune_capture_worker_stale';

let _interval = null;

function _tick() {
  try {
    const hb = sqlite.prepare(`SELECT tick_count, updated_at FROM spc_prune_capture_heartbeat WHERE id = 1`).get();
    if (!hb) return; // worker 还没跑过第一个 tick(刚启动) — 不误报

    const ageMs = Date.now() - new Date(hb.updated_at + 'Z').getTime();
    if (ageMs <= STALE_THRESHOLD_MS) return;

    const recent = sqlite.prepare(`
      SELECT id FROM events WHERE event_type = ? AND created_at > datetime('now', '-1 hour') LIMIT 1
    `).get(STALE_EVENT_TYPE);
    if (recent) return; // 去重, 同一次停摆期间只报一次

    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'preprune-capture-monitor', 'warn', ?, ?, datetime('now'))
    `).run(
      randomUUID(), STALE_EVENT_TYPE,
      `K-17 preprune-capture-worker 心跳停摆 ${Math.round(ageMs / 1000)}s(阈值${STALE_THRESHOLD_MS / 1000}s, tick_count停在${hb.tick_count}) — 主动补齐 worker 疑似挂死, 同 supervisor 25h 静默死同族根因防线触发`,
      JSON.stringify({ ageMs, tickCount: hb.tick_count, lastUpdatedAt: hb.updated_at }),
    );
  } catch (e) {
    console.warn(`[preprune-capture-monitor] tick error (non-fatal): ${e.message}`);
  }
}

export function startPrepruneCaptureStaleCheck() {
  if (_interval) return;
  console.log(`[preprune-capture-monitor] cron start, tick=${TICK_MS}ms`);
  _interval = setInterval(_tick, TICK_MS);
  setTimeout(_tick, 5000);
}
export function stopPrepruneCaptureStaleCheck() { if (_interval) { clearInterval(_interval); _interval = null; } }
