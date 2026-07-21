// settle-failed-alert.mjs — 查漏补缺 (Owner 2026-07-04 追问"以后新盘会不会也卡死"·团队诚实答:
// daemon 的失败恢复设计是"同 tick 内重试 3 次(几秒)→不成永久标 settle_failed→SQL 永久排除",
// 靠"人工 operator review"救——但今天证明这个人工环节实际上从没真正发生过(99 个历史老盘悄悄
// 堆了好几天没人管，是 Owner 自己撞见才发现)。
//
// 这个 monitor 不改 daemon 核心逻辑(守"不造新机制"令，跨 tick 自动重试是另一条待 Owner 批的
// 根治线) — 只做一件事: 一有市场新进入 settle_failed 状态，立刻写 events 表 + 发频道通知，
// 让 operator 第一时间知道，不用再等事后翻查/公开用户投诉/Owner 自己撞见。
import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const TICK_INTERVAL_MS = Number(process.env.SETTLE_FAILED_ALERT_TICK_MS) || 60_000; // 1min, 跟 settle daemon 同频
const STARTUP_GRACE_MS = 30_000;
const ALERT_RELAY_ID = process.env.SETTLE_FAILED_ALERT_RELAY_ID || 'f5cf6d85-58f4-4991-9cd5-7c6779f6822b'; // KANet-UI-tn (dev-coord-testnet 白名单内)
const ALERT_CHANNEL = process.env.SETTLE_FAILED_ALERT_CHANNEL || 'dev-coord-testnet';
const CONSOLE_BASE = process.env.SETTLE_FAILED_ALERT_CONSOLE_BASE || 'http://127.0.0.1:3200';
const FETCH_TIMEOUT_MS = 15_000;

let timer = null;
let running = false;
// in-memory 已知 settle_failed 集合(启动时先快照一次现存的, 避免把历史欠账当"新增"刷屏)。
let _knownFailedIds = null;

function _writeAlertEvent(marketId, summary) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'settle_failed_onset', 'settle-failed-alert', 'warn', ?, ?, datetime('now'))
    `).run(randomUUID(), summary, JSON.stringify({ marketId }));
  } catch (e) { console.warn(`[settle-failed-alert] events insert fail (non-fatal): ${e.message}`); }
}

async function _postToChannel(text) {
  try {
    const ctrl = new AbortController();
    const timer2 = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    await fetch(`${CONSOLE_BASE}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: ALERT_RELAY_ID, channel: ALERT_CHANNEL, message: text }),
      signal: ctrl.signal,
    }).catch((e) => console.warn(`[settle-failed-alert] channel post fail (non-fatal): ${e.message}`));
    clearTimeout(timer2);
  } catch (e) { console.warn(`[settle-failed-alert] channel post fail (non-fatal): ${e.message}`); }
}

export async function settleFailedAlertTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const rows = sqlite.prepare("SELECT id FROM pool_markets WHERE protocol_status = 'settle_failed'").all();
    const currentIds = new Set(rows.map((r) => r.id));
    if (_knownFailedIds === null) {
      // 首次 tick: 只建立基线快照, 不对现存历史欠账逐个告警(那批已知记录在 #21 gap 清单里,
      // 这个 monitor 的价值是抓"以后新出现的", 不是重复刷历史)。
      _knownFailedIds = currentIds;
      return { ok: true, baseline: currentIds.size };
    }
    const newlyFailed = [...currentIds].filter((id) => !_knownFailedIds.has(id));
    for (const marketId of newlyFailed) {
      const summary = `市场 ${marketId.slice(-12)} 新进入 settle_failed 状态 — 结算重试(同tick内3次)全部失败, 现按当前设计永久排除出daemon下次自动扫描, 需要 operator 人工判断(瞬态→改状态重试 / 真拒→走 #47 手动 runbook)。`;
      console.warn(`[settle-failed-alert] NEW settle_failed: ${marketId}`);
      _writeAlertEvent(marketId, summary);
      await _postToChannel(`🔴【settle-failed-alert·自动监控】新盘卡进 settle_failed: ${marketId}\n${summary}`);
    }
    _knownFailedIds = currentIds;
    return { ok: true, newlyFailed: newlyFailed.length, totalFailed: currentIds.size };
  } catch (e) {
    console.warn(`[settle-failed-alert] tick fail (non-fatal, retry next cycle): ${e.message}`);
    return { ok: false, reason: e.message };
  } finally {
    running = false;
  }
}

export function startSettleFailedAlertCron() {
  if (timer) return;
  console.log(`[settle-failed-alert] started — tick=${TICK_INTERVAL_MS}ms (只读监控, 不改daemon逻辑, 新增settle_failed立刻写events表+发${ALERT_CHANNEL}频道)`);
  setTimeout(() => { settleFailedAlertTick().catch((e) => console.error('[settle-failed-alert] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { settleFailedAlertTick().catch((e) => console.error('[settle-failed-alert] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopSettleFailedAlertCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
