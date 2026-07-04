// disk-space-alert.mjs — 查漏补缺 (2026-07-04 晚, J2 撞见 C 盘 0 字节可用·curl 报 'No space left on
// device'·Bettor 紧急清了 3 个 runaway launcher stdout log 解封): disk full 会静默拖垮全系统(curl/
// 工具全炸, 但 console 进程本身可能还在跑, 不会主动报错), 之前没有任何监控——这次全靠 J2 碰巧手动
// 撞见。跟 faucet-health/settle-failed-alert 同款模式: 纯只读监控+告警, 不做任何自动清理动作(删
// 文件这类操作风险高, 交给 operator 判断哪些安全删)。
import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TICK_INTERVAL_MS = Number(process.env.DISK_SPACE_ALERT_TICK_MS) || 300_000; // 5min (磁盘空间变化比 UTXO/settle 慢得多, 不用 1min 那么频繁)
const STARTUP_GRACE_MS = 30_000;
const LOW_SPACE_GB_THRESHOLD = Number(process.env.DISK_SPACE_ALERT_LOW_GB) || 15; // C 盘/D 盘剩余 < 此值告警
const DRIVES = (process.env.DISK_SPACE_ALERT_DRIVES || 'C,D').split(',').map((s) => s.trim()).filter(Boolean);

let timer = null;
let running = false;
const _alerted = new Set(); // 每个盘独立 de-dupe (跨 tick 只在首次跌破/恢复时各报一次)

function _writeAlertEvent(drive, freeGB, summary) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'disk_space_low', 'disk-space-alert', 'warn', ?, ?, datetime('now'))
    `).run(randomUUID(), summary, JSON.stringify({ drive, freeGB }));
  } catch (e) { console.warn(`[disk-space-alert] events insert fail (non-fatal): ${e.message}`); }
}

async function _freeSpaceGB(drive) {
  // Get-PSDrive 比 wmic 更现代/可靠(wmic 在新版 Windows 已弃用)。
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NonInteractive', '-NoProfile', '-Command',
    `(Get-PSDrive ${drive}).Free`,
  ], { timeout: 15_000 });
  const bytes = Number(String(stdout).trim());
  if (!Number.isFinite(bytes)) throw new Error(`unparseable Get-PSDrive output: ${stdout}`);
  return bytes / 1e9;
}

export async function diskSpaceAlertTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const results = [];
    for (const drive of DRIVES) {
      try {
        const freeGB = await _freeSpaceGB(drive);
        results.push({ drive, freeGB });
        if (freeGB < LOW_SPACE_GB_THRESHOLD) {
          if (!_alerted.has(drive)) {
            _alerted.add(drive);
            const summary = `${drive} 盘剩余空间 ${freeGB.toFixed(2)}GB < ${LOW_SPACE_GB_THRESHOLD}GB 告警线 — disk full 会让 curl/命令行工具静默失败(今天 J2 撞见的'No space left on device'), 需要 operator 清理(日志/缓存, 别删数据库/区块链数据)。`;
            console.warn(`[disk-space-alert] ALERT: ${summary}`);
            _writeAlertEvent(drive, freeGB, summary);
          }
        } else if (_alerted.has(drive)) {
          _alerted.delete(drive); // 恢复了, 下次再跌破会重新告警
        }
      } catch (e) {
        console.warn(`[disk-space-alert] ${drive} check fail (non-fatal): ${e.message}`);
        results.push({ drive, error: e.message });
      }
    }
    return { ok: true, results };
  } finally {
    running = false;
  }
}

export function startDiskSpaceAlertCron() {
  if (timer) return;
  console.log(`[disk-space-alert] started — tick=${TICK_INTERVAL_MS}ms drives=${DRIVES.join(',')} lowThresholdGB=${LOW_SPACE_GB_THRESHOLD} (只读监控, 不做任何清理动作)`);
  setTimeout(() => { diskSpaceAlertTick().catch((e) => console.error('[disk-space-alert] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { diskSpaceAlertTick().catch((e) => console.error('[disk-space-alert] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopDiskSpaceAlertCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
