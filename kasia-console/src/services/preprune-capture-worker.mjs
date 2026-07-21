// preprune-capture-worker.mjs — K-17 Pre-Prune Capture 主动补齐 worker(2026-07-17, J2, docs/
// 2026-07-17-preprune-capture-invariant-k16-gate-design.md v1.1, NWT 红队 GREEN dd6496b0/369f6679)。
//
// 事故锚: j34vb-s0 8 条 side_lock_daa NULL 越过剪裁点物理不可逆(§1)——根因是捕获点2(lazy recapture,
// pool-market-settler.js:765 / bshard-close-transport.mjs:248)只在结算生命周期触发, 没有独立于结算、
// 在剪裁窗口内主动补齐的机制。本 worker 补上这条独立于结算触发的常驻扫描线。
//
// finality 门(NWT 发现A, MUST-FIX): 已在今天 d521fea8 落码验证过, 复用于 captureSideLockDaa()
// (trade-protocol-filter.js, CAPTURE_FINALITY_DEPTH=50)——recaptureSideLockDaaForMarket 内部调用
// captureSideLockDaa, 本 worker 直接复用, 不重做。
//
// 吞吐/safety_margin 设计说明(NWT 点②, 非重做而是记录论证): 本 worker 每 tick 对*所有*活跃 market
// 命中的 NULL 行都尝试补齐(非按紧迫度排队), recaptureSideLockDaaForMarket 单次调用是几个 RPC round-trip
// 级(秒级), 60s tick 内清完几十个市场的积压绰绰有余; TN12 剪裁窗口以小时/天计(远大于本 worker 的
// 单 tick/单次全量扫描耗时)。故不需要显式"最坏宕机时长×积压速率÷吞吐"排队逻辑——"扫描全量+不排队"
// 本身就已经满足该公式(排队延迟≈0), 除非未来活跃 NULL 行数量级增长到让单 tick 扫不完(那时才需要按
// deadline_daa 邻近剪裁 floor 优先排序, 当前规模下过早优化)。此论证留待 NWT 复核指正。
//
// 幂等(NWT 发现B): recaptureSideLockDaaForMarket 内部 UPDATE ... WHERE side_lock_daa IS NULL,
// 与结算时 lazy-recapture(pool-market-settler.js:765)/consolidateAndBuildPsState(bshard-settle-
// daemon.mjs)三条写路径共享同一张表同一个 WHERE 子句——先写者赢, 后写者 WHERE 落空 no-op, 不冲突。
import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_MS = 60 * 1000; // 镜像 spc_daa_index 巡检节拍(已验证过的量级)
// NWT 红队 MUST-FIX(docs/2026-07-18-NWT-redteam-k17-preprune-capture-worker-diff-verdict.md e91fcf51):
// 漏 'zk_settled'(bshard-settle-daemon.mjs:523, ZK 结算终态)——今天 ZK 结算密集产出会让这个缺口自然放大,
// 已终态的 ZK 盘不该继续被扫。
const TERMINAL_STATUSES = new Set(['cancelled', 'refunded', 'completed', 'settle_failed', 'zk_settled']);
const UNRECOVERABLE_EVENT_TYPE = 'side_lock_daa_unrecoverable';

let _interval = null;
let _running = false; // 防 tick 重入(recapture 涉及 RPC, 可能跨 tick 边界未完成)

function _coverageFloor() {
  try { return sqlite.prepare('SELECT MIN(start_daa) f FROM spc_daa_index_coverage').get()?.f ?? null; } catch { return null; }
}

// 解析 pool_bettor_sides.market_id(可能是 shard id 或非-bshard 的逻辑 id 本身)→ 所属逻辑 market 行。
function _resolveLogicalMarket(marketId) {
  const viaShard = sqlite.prepare('SELECT logical_market_id FROM market_shards WHERE shard_market_id = ?').get(marketId);
  const logicalId = viaShard?.logical_market_id || marketId;
  return sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(logicalId);
}

function _writeHeartbeat(scanned, recaptured) {
  sqlite.prepare(`
    INSERT INTO spc_prune_capture_heartbeat (id, tick_count, last_scanned_null_rows, last_recaptured, updated_at)
    VALUES (1, 1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      tick_count = tick_count + 1,
      last_scanned_null_rows = excluded.last_scanned_null_rows,
      last_recaptured = excluded.last_recaptured,
      updated_at = excluded.updated_at
  `).run(scanned, recaptured);
}

// 性能修复(J2 手工烟测撞见, 落码当晚发现): 若不跳过已确认结构性不可达的市场, 每 tick 都会对同一批
// 已知救不回的行重跑 recapture(每行一次 RPC backward-walk 直到 walk-exhausted 才放弃, 秒级到十秒级),
// 世界杯这批(aukqt 822 行/kr5l4 589 行等)会让单 tick 卡到几分钟甚至更久——不是"扫全量绰绰有余"这个
// 论证的反例(那条论证针对*活跃*/*可能恢复*的行), 而是漏了"已经放弃过的行不该重复烧同样的 RPC 成本"
// 这条优化。查"该 market 是否已经产出过 side_lock_daa_unrecoverable 事件"(不限时间窗, 一旦结构性不可达
// 就永远不可达, 跟第 76 行"一小时内只报一次"的告警去重是两回事——这里是"跳过重试"的持久判据)。
function _hasBeenMarkedUnrecoverable(logicalMarketId) {
  const row = sqlite.prepare(`
    SELECT id FROM events WHERE event_type = ? AND payload_json LIKE ? LIMIT 1
  `).get(UNRECOVERABLE_EVENT_TYPE, `%"marketId":"${logicalMarketId}"%`);
  return !!row;
}

// fail-loud①(设计§5): 某行 recapture 后仍 NULL, 且其市场 deadline_daa 已经落在 spc_daa_index 有史以来
// 最早覆盖点之前(= 结构性不可达, 同 unreachablePreGate 的 belowFloor 判据)→ 标'不可恢复', 供 j34vb 同款
// 替代结算路径识别(去重: 同一 market 一小时内只报一次, 不刷屏, 镜像 spc-daa-index-monitor.mjs 手法)。
function _markUnrecoverableIfBeyondFloor(logicalMarket, stillNullCount) {
  if (!logicalMarket || stillNullCount <= 0) return;
  const floor = _coverageFloor();
  if (floor == null || logicalMarket.deadline_daa == null) return;
  if (Number(logicalMarket.deadline_daa) >= Number(floor)) return; // 尚未确认结构性不可达, 下 tick 再看

  const recent = sqlite.prepare(`
    SELECT id FROM events WHERE event_type = ? AND payload_json LIKE ? AND created_at > datetime('now', '-1 hour') LIMIT 1
  `).get(UNRECOVERABLE_EVENT_TYPE, `%"marketId":"${logicalMarket.id}"%`);
  if (recent) return;

  sqlite.prepare(`
    INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
    VALUES (?, 'system', ?, 'preprune-capture-worker', 'warn', ?, ?, datetime('now'))
  `).run(
    randomUUID(), UNRECOVERABLE_EVENT_TYPE,
    `market=${String(logicalMarket.id).slice(-8)} 仍有 ${stillNullCount} 条 side_lock_daa NULL, deadline_daa(${logicalMarket.deadline_daa}) < spc_daa_index floor(${floor}) — 结构性剪裁不可达, 标'不可恢复'供替代结算识别(K-17 §5/§6)`,
    JSON.stringify({ marketId: logicalMarket.id, deadlineDaa: logicalMarket.deadline_daa, floor, stillNullCount }),
  );
}

export async function _tick() {
  if (_running) return { skipped: 'reentrant' };
  _running = true;
  try {
    const { recaptureSideLockDaaForMarket } = await import('./pool-market-settler-v06.mjs');
    const nullMarketIds = sqlite.prepare(`SELECT DISTINCT market_id FROM pool_bettor_sides WHERE side_lock_daa IS NULL`).all().map(r => r.market_id);

    let scanned = 0, recaptured = 0;
    const seenLogical = new Set();
    for (const marketId of nullMarketIds) {
      const logicalMarket = _resolveLogicalMarket(marketId);
      if (!logicalMarket) continue; // 孤儿 bettor row(市场已删), 不在本 worker scope
      if (TERMINAL_STATUSES.has(logicalMarket.protocol_status)) continue; // 非活跃, 数据丢失也不影响钱路
      if (_hasBeenMarkedUnrecoverable(logicalMarket.id)) continue; // 已确认结构性不可达, 不重烧 RPC walk 成本
      scanned++;
      let rc;
      try { rc = await recaptureSideLockDaaForMarket(marketId); }
      catch (e) { console.warn(`[preprune-capture-worker] recapture fail market=${String(marketId).slice(-8)} (non-fatal): ${e.message}`); continue; }
      recaptured += rc.recaptured;
      if (!seenLogical.has(logicalMarket.id)) {
        seenLogical.add(logicalMarket.id);
        _markUnrecoverableIfBeyondFloor(logicalMarket, rc.remaining);
      }
    }
    _writeHeartbeat(scanned, recaptured);
    if (scanned > 0) console.log(`[preprune-capture-worker] tick: scanned=${scanned} market(s) w/ NULL side_lock_daa, recaptured=${recaptured}`);
    return { scanned, recaptured };
  } catch (e) {
    console.warn(`[preprune-capture-worker] tick error (non-fatal): ${e.message}`);
    return { error: e.message };
  } finally {
    _running = false;
  }
}

export { _hasBeenMarkedUnrecoverable, _markUnrecoverableIfBeyondFloor, _coverageFloor, _resolveLogicalMarket };

export function startPrepruneCaptureWorker() {
  if (_interval) return;
  console.log(`[preprune-capture-worker] cron start, tick=${TICK_MS}ms (K-17)`);
  _interval = setInterval(_tick, TICK_MS);
  setTimeout(_tick, 5000); // startup pass, 同既有 cron 惯例
}
export function stopPrepruneCaptureWorker() { if (_interval) { clearInterval(_interval); _interval = null; } }
