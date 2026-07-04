// Regression guard: #49 模块② UMA re-judge 退避表 (2026-07-04, docs/2026-07-04-daemon-error-handling-
// modular-design.md v2 §3.2, 数字基于真实查证的 UMA/Polymarket 协议参数).
//
// 测试 _umaBackoffAllowsRetryNow(纯函数, 只依赖传入的 marketRow.metadata, 不碰真实 DB/时钟之外的东西)。

import assert from 'node:assert/strict';
import { _umaBackoffAllowsRetryNow, UMA_REJUDGE_BACKOFF_TABLE, UMA_GENUINE_TIMEOUT_HOURS } from '../../../../src/services/bshard-settle-daemon.mjs';

function fakeMarket({ pendingSinceHoursAgo, lastAttemptMinutesAgo }) {
  const now = Date.now();
  const meta = {
    uma_pending_since: new Date(now - pendingSinceHoursAgo * 3_600_000).toISOString(),
    uma_last_attempt_at: new Date(now - lastAttemptMinutesAgo * 60_000).toISOString(),
  };
  return { metadata: JSON.stringify(meta) };
}

// ── 非 UMA-pending 市场(没有 uma_pending_since) → 一律放行, 不受退避表限制 ──
{
  const m = { metadata: JSON.stringify({}) };
  assert.equal(_umaBackoffAllowsRetryNow(m), true, 'markets without uma_pending_since metadata must not be constrained by the backoff table');
}

// ── 0-2h 档(15min 间隔): 刚尝试过(5min 前)→ 不该重试; 过了 15min → 该重试 ──
{
  const tooSoon = fakeMarket({ pendingSinceHoursAgo: 1, lastAttemptMinutesAgo: 5 });
  assert.equal(_umaBackoffAllowsRetryNow(tooSoon), false, '0-2h tier: 5min since last attempt < 15min interval, must not retry yet');

  const dueNow = fakeMarket({ pendingSinceHoursAgo: 1, lastAttemptMinutesAgo: 16 });
  assert.equal(_umaBackoffAllowsRetryNow(dueNow), true, '0-2h tier: 16min since last attempt >= 15min interval, must be due for retry');
}

// ── 2-6h 档(30min 间隔) ──
{
  const tooSoon = fakeMarket({ pendingSinceHoursAgo: 4, lastAttemptMinutesAgo: 20 });
  assert.equal(_umaBackoffAllowsRetryNow(tooSoon), false, '2-6h tier: 20min < 30min interval, must not retry yet');

  const dueNow = fakeMarket({ pendingSinceHoursAgo: 4, lastAttemptMinutesAgo: 31 });
  assert.equal(_umaBackoffAllowsRetryNow(dueNow), true, '2-6h tier: 31min >= 30min interval, must be due');
}

// ── 6-96h 档(120min 间隔) ──
{
  const tooSoon = fakeMarket({ pendingSinceHoursAgo: 24, lastAttemptMinutesAgo: 60 });
  assert.equal(_umaBackoffAllowsRetryNow(tooSoon), false, '6-96h tier: 60min < 120min interval, must not retry yet');

  const dueNow = fakeMarket({ pendingSinceHoursAgo: 24, lastAttemptMinutesAgo: 121 });
  assert.equal(_umaBackoffAllowsRetryNow(dueNow), true, '6-96h tier: 121min >= 120min interval, must be due');
}

// ── 边界: 恰好在 2h 门槛(<=2h 落 0-2h 档, 用 15min 间隔非 30min) ──
{
  const boundary = fakeMarket({ pendingSinceHoursAgo: 2, lastAttemptMinutesAgo: 16 });
  assert.equal(_umaBackoffAllowsRetryNow(boundary), true, 'exactly at 2h boundary must use the 0-2h tier (15min interval), inclusive per design table');
}

// ── 表本身的完整性: 三档, 数字跟设计文档一致(2h/15min, 6h/30min, 96h/120min) + genuine-timeout=96h ──
{
  assert.deepEqual(UMA_REJUDGE_BACKOFF_TABLE.map(t => [t.maxAgeHours, t.intervalMinutes]), [[2, 15], [6, 30], [96, 120]], 'backoff table values must match the design doc (real UMA protocol parameters, not arbitrary)');
  assert.equal(UMA_GENUINE_TIMEOUT_HOURS, 96, 'genuine-timeout must be 96h, matching UMA DVM voting cycle upper bound');
}

console.log('✅ uma_rejudge_backoff_regression: all cases pass — backoff tiers + boundary + genuine-timeout locked');
