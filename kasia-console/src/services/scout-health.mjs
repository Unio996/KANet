// scout-health.mjs — Scout ingest VISIBILITY layer (root-cure ③④, 2026-06-21 :3200 6h-silent-death incident).
//
// J1's 3 commits (c2f6bc8e heartbeat / 7066d46d auto-respawn / 8a24ef22 watchdog) make the scout
// AUTO-RECOVER — the "doesn't recover" half. This module adds the "and we KNOW" half (Owner:
// 死了也不知道 = 公开服务灾难). Both surfaces key on the SAME authoritative liveness signal J1's
// watchdog (8a24ef22) uses: scout_checkpoint._global_.last_block_time advancing.
//
//   ④ getScoutHealth()         — pull-based health metric for external monitoring. Robust: a pull
//                                 probe works even when the node can't push (push-from-a-dead-system
//                                 is the anti-pattern this avoids).
//   ③ startScoutHealthAlerter() — push: on a health TRANSITION (edge-triggered, not level), broadcast
//                                 to dev-coord so the team + Owner are notified. Rare (only on change)
//                                 so it never spams; each alert is one on-chain broadcast.

import { sqlite } from '../db/client.js';
import { getScannerStatus } from './scanner.js';
import { sendBroadcastChunked } from '../lib/pool-broadcast.mjs';

// Same threshold semantics as J1's watchdog (8a24ef22 SCAN_STALL_MS=120s). TN12 produces ~1 block/s,
// so a checkpoint that hasn't advanced for > STALE_MS means the scout is silently stuck (false-alive)
// or dead. env-overridable so ops can tune without a code change.
const STALE_MS = parseInt(process.env.SCOUT_STALE_MS, 10) || 120_000;
const ALERTER_INTERVAL_MS = parseInt(process.env.SCOUT_HEALTH_POLL_MS, 10) || 60_000;
const DEV_COORD_CHANNEL = process.env.DEV_COORD_CHANNEL || 'dev-coord-testnet';

/**
 * ④ Pull-based scout health. Reads the authoritative liveness signal (scout_checkpoint advancing)
 * + the scanner process status. Returns a plain object safe to expose via HTTP for external monitors.
 */
export function getScoutHealth() {
  let lastBlockTime = null;
  let lastScanAgeMs = null;
  try {
    const row = sqlite
      .prepare("SELECT last_block_time FROM scout_checkpoint WHERE address = '_global_'")
      .get();
    if (row?.last_block_time) {
      lastBlockTime = row.last_block_time;
      const t = new Date(row.last_block_time).getTime(); // last_block_time is an ISO string
      if (!Number.isNaN(t)) lastScanAgeMs = Date.now() - t;
    }
  } catch {
    // scout_checkpoint may not exist on a brand-new DB — treated as "no checkpoint" (warming) below.
  }

  const scanner = getScannerStatus() || {};
  const scannerRunning = !!scanner.running;
  const hasCheckpoint = lastScanAgeMs !== null;
  const fresh = hasCheckpoint && lastScanAgeMs <= STALE_MS;
  // A freshly (re)spawned scout is running but has not written a checkpoint yet — that is "warming",
  // not "unhealthy". Callers must not alert on warming (give the new scout time to write one).
  const warming = scannerRunning && !hasCheckpoint;
  const healthy = scannerRunning && fresh;

  return {
    healthy,
    scannerRunning,
    warming,
    lastScanAgeMs,
    lastBlockTime,
    staleThresholdMs: STALE_MS,
    checkedAt: new Date().toISOString(),
  };
}

let _alerterTimer = null;
let _lastHealthy = null; // null = baseline not yet established (first observation does not alert)

function describe(h) {
  const ageS = h.lastScanAgeMs == null ? 'n/a' : (h.lastScanAgeMs / 1000).toFixed(0) + 's';
  return h.healthy
    ? `✅ SCOUT 恢复健康: 跨节点 ingest 重新推进 (checkpoint age ${ageS}, running=${h.scannerRunning})。`
    : `🔴 SCOUT 异常: ingest 停止推进 (checkpoint age ${ageS}, running=${h.scannerRunning})。`
      + ` J1 watchdog 应 ~120s 内自动重拉; 若反复翻=crash-loop, 需人工查 scout 进程/节点。`;
}

/**
 * ③ Push alerter. Polls health; on a TRANSITION (healthy <-> unhealthy) broadcasts to dev-coord.
 * Edge-triggered so it never spams. "warming" (fresh scout, no checkpoint yet) is not a verdict and
 * is skipped. The broadcast goes out via the relay (independent of scout INGEST), so the alert still
 * sends even when the local scout is dead — other nodes receive it via their own scouts.
 */
export function startScoutHealthAlerter() {
  if (_alerterTimer) return;
  _alerterTimer = setInterval(async () => {
    try {
      const h = getScoutHealth();
      if (h.warming) return; // not a health verdict yet — wait for the first checkpoint
      const healthy = h.healthy;
      if (_lastHealthy === null) {
        _lastHealthy = healthy; // establish baseline silently
        return;
      }
      if (healthy === _lastHealthy) return; // no edge — nothing to announce
      _lastHealthy = healthy;

      const relayId = process.env.GATEWAY_RELAY_ID || '15593e10-fe63-4806-a7b5-cae062699de8';
      await sendBroadcastChunked(relayId, DEV_COORD_CHANNEL, `[scout-health] ${describe(h)}`).catch(
        (e) => console.error(`[scout-health] broadcast failed: ${e.message}`)
      );
      console.log(`[scout-health] transition alert sent: healthy=${healthy}`);
    } catch (e) {
      console.error(`[scout-health] alerter tick error: ${e.message}`);
    }
  }, ALERTER_INTERVAL_MS);
  if (_alerterTimer.unref) _alerterTimer.unref(); // never keep the process alive just for this poll
  console.log(`[scout-health] alerter started (poll ${ALERTER_INTERVAL_MS}ms, stale>${STALE_MS}ms)`);
}

export function stopScoutHealthAlerter() {
  if (_alerterTimer) {
    clearInterval(_alerterTimer);
    _alerterTimer = null;
  }
}
