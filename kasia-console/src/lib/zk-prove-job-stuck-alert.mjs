// zk-prove-job-stuck-alert.mjs — proving job 卡死告警(三前置之一, wiring doc §2.6 写死的 escape 上线硬前置)
//
// 背景: docs/2026-07-06-zk-close-tick-production-wiring-design.md §2.4/§2.6。zk_prove_jobs 若因 J1
// 机器崩溃/网络断永久卡在 in_progress, v1 只有手动恢复(zk-prove-job-recover.mjs --list/--unstick),
// 无自动告警。escape_trigger/escape_claim 上线前，这个盲区必须堵——job 卡死无人发现 → GRACE 窗口
// 静默打开 → 输家躺赢(赢家应得被基础设施故障没收)。
//
// 🔴 范围继承纠正(Bettor+NWT 2026-07-06 审出): settle-failed-alert.mjs 的"首tick建baseline,已存在
// 的不刷屏"哲学在这里不成立——若 console/daemon 重启(内存态清零), baseline 会把已经卡死的 job
// 当成"历史已知"永久吞掉，恰好是这个 alert 最该起作用的场景静默。修法: 不用内存态，每个 tick
// (含重启后第一个)都全量检查；去重状态落 events 表按 job_id 查(json_extract，非新引入，7 处已用)，
// 重启不丢、也不会重复刷屏。
//
// STUCK_THRESHOLD_MINUTES 是占位值(同 ESCAPE_GRACE 一样未经真实数据校准) —— NWT 发现
// updated_at 只在 poll(claim)/complete 两个时间点写，proving 实际运行期间没有心跳，
// "卡住"和"还在跑真实 Groth16"从表里看不出区别，唯一信号就是这个阈值。给低了狼来了，给高了
// 违背"尽快发现卡死"本意。需要至少一次真实 proving 耗时数据校准，不能瞎拍。
import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const TICK_INTERVAL_MS = Number(process.env.ZK_PROVE_STUCK_ALERT_TICK_MS) || 300_000; // 5min
const STARTUP_GRACE_MS = 30_000;
// ⚠ 占位值，未经真实 Groth16 proving 耗时数据校准，见上方注释。
const STUCK_THRESHOLD_MINUTES = Number(process.env.ZK_PROVE_STUCK_ALERT_MINUTES) || 15;
const ALERT_RELAY_ID = process.env.ZK_PROVE_STUCK_ALERT_RELAY_ID || 'f5cf6d85-58f4-4991-9cd5-7c6779f6822b'; // KANet-UI-tn (dev-coord-testnet 白名单内, 跟 settle-failed-alert/disk-space-alert 同一个)
const ALERT_CHANNEL = process.env.ZK_PROVE_STUCK_ALERT_CHANNEL || 'dev-coord-testnet';
const CONSOLE_BASE = process.env.ZK_PROVE_STUCK_ALERT_CONSOLE_BASE || 'http://127.0.0.1:3200';
const FETCH_TIMEOUT_MS = 15_000;

let timer = null;
let running = false;

function _alreadyAlerted(jobId) {
  try {
    const row = sqlite.prepare(`
      SELECT 1 FROM events
      WHERE event_type = 'zk_prove_job_stuck' AND json_extract(payload_json, '$.jobId') = ?
      LIMIT 1
    `).get(jobId);
    return !!row;
  } catch (e) {
    console.warn(`[zk-prove-job-stuck-alert] dedup query fail (non-fatal, 保守起见当作未告警过): ${e.message}`);
    return false;
  }
}

function _writeAlertEvent(jobId, marketId, minutesStuck, status, summary) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'zk_prove_job_stuck', 'zk-prove-job-stuck-alert', 'warn', ?, ?, datetime('now'))
    `).run(randomUUID(), summary, JSON.stringify({ jobId, marketId, minutesStuck, status }));
  } catch (e) { console.warn(`[zk-prove-job-stuck-alert] events insert fail (non-fatal): ${e.message}`); }
}

async function _postToChannel(text) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    await fetch(`${CONSOLE_BASE}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: ALERT_RELAY_ID, channel: ALERT_CHANNEL, message: text }),
      signal: ctrl.signal,
    }).catch((e) => console.warn(`[zk-prove-job-stuck-alert] channel post fail (non-fatal): ${e.message}`));
    clearTimeout(t);
  } catch (e) { console.warn(`[zk-prove-job-stuck-alert] channel post fail (non-fatal): ${e.message}`); }
}

export async function zkProveJobStuckAlertTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const rows = sqlite.prepare(`
      SELECT id, market_id, status, updated_at,
             CAST((julianday('now') - julianday(updated_at)) * 24 * 60 AS INTEGER) AS minutes_since_update
      FROM zk_prove_jobs
      WHERE status IN ('pending', 'in_progress')
        AND (julianday('now') - julianday(updated_at)) * 24 * 60 > ?
      ORDER BY updated_at ASC
    `).all(STUCK_THRESHOLD_MINUTES);

    let newlyAlerted = 0;
    for (const r of rows) {
      if (_alreadyAlerted(r.id)) continue;
      const summary = `zk_prove_jobs id=${r.id}(market=${r.market_id}) 卡在 ${r.status} 状态 ${r.minutes_since_update} 分钟(阈值${STUCK_THRESHOLD_MINUTES}分钟) — 可能是 J1 proving 机崩溃/网络断,也可能是长 proving 未完成(阈值未经真实耗时校准)。恢复: node scripts/zk-prove-job-recover.mjs --list 查看 / --unstick ${r.id} 手动解锁。`;
      console.warn(`[zk-prove-job-stuck-alert] STUCK job id=${r.id} market=${r.market_id} ${r.minutes_since_update}min`);
      _writeAlertEvent(r.id, r.market_id, r.minutes_since_update, r.status, summary);
      await _postToChannel(`🔴【zk-prove-job-stuck-alert·自动监控】${summary}`);
      newlyAlerted += 1;
    }
    return { ok: true, stuckCount: rows.length, newlyAlerted };
  } catch (e) {
    console.warn(`[zk-prove-job-stuck-alert] tick fail (non-fatal, retry next cycle): ${e.message}`);
    return { ok: false, reason: e.message };
  } finally {
    running = false;
  }
}

export function startZkProveJobStuckAlertCron() {
  if (timer) return;
  console.log(`[zk-prove-job-stuck-alert] started — tick=${TICK_INTERVAL_MS}ms, threshold=${STUCK_THRESHOLD_MINUTES}min(占位待校准) (只读监控, 去重落 events 表非内存, 每tick含首个都全量检查不建baseline)`);
  setTimeout(() => { zkProveJobStuckAlertTick().catch((e) => console.error('[zk-prove-job-stuck-alert] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { zkProveJobStuckAlertTick().catch((e) => console.error('[zk-prove-job-stuck-alert] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopZkProveJobStuckAlertCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
