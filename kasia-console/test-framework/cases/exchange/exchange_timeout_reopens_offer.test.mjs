/**
 * P0.2 §3.5 — timeoutVerifying timer-driven function 存在 + 阈值守门
 *
 * NWT spec ea519032a v0.2 §3.5, J2 ship P0.2 sub #6/9.
 *
 * 设计选择: timeout 是 timer-driven (无 HTTP API), 在 cron 内 fire. Runner-format
 * 测真实 timer 跑代价高 + 依赖时间. 改 static source assertion (跟 P0.1 同款), 守
 * timeoutVerifying 函数存在 + verifying_started_at 阈值不被改坏 + 重开 offer 路径完整.
 *
 * 跑法: node --test cases/exchange/exchange_timeout_reopens_offer.test.mjs
 * (framework runner scripts/test.mjs SKIP — 无 default export)
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXCHANGE_MACHINE = readFileSync(join(__dirname, '../../../src/services/exchange-machine.js'), 'utf-8');

test('timeoutVerifying function exists in exchange-machine.js (regression guard)', () => {
  assert.match(EXCHANGE_MACHINE, /export\s+async\s+function\s+timeoutVerifying\s*\(/, 'timeoutVerifying export missing — protocol 7 message timeout handler broken');
});

test('timeoutVerifying uses verifying_started_at threshold (~30 min) for state filter', () => {
  // 拿 timeoutVerifying body, 找下个 export 作 delimiter
  const fnMatch = EXCHANGE_MACHINE.match(/export\s+async\s+function\s+timeoutVerifying\s*\(\s*\)[\s\S]*?(?=^export\s|^\}[\r\n])/m);
  assert.ok(fnMatch, 'timeoutVerifying body not extractable');
  const body = fnMatch[0];
  // 应含 verifying_started_at 字段 reference (4/11 修法 sediment: timeoutVerifying 改用 verifying_started_at, 不是 expires_at)
  assert.match(body, /verifying_started_at/, 'timeoutVerifying must filter by verifying_started_at (4/11 fix sediment, not expires_at)');
  // 应有 30 min 阈值 (1800 sec OR 30 min OR -30 minutes-style SQL/date 算)
  const hasMinThreshold = /'-30\s*minutes'|30\s*\*\s*60|1800/.test(body);
  assert.ok(hasMinThreshold, "timeoutVerifying threshold 30 min ('-30 minutes' SQL OR 1800 sec OR 30*60) missing");
});

test('timeoutVerifying broadcasts timeout_v1 + transitions reopens (per 4/11 KI-20 sediment)', () => {
  const fnMatch = EXCHANGE_MACHINE.match(/export\s+async\s+function\s+timeoutVerifying\s*\(\s*\)[\s\S]*?(?=^export\s|^\}[\r\n])/m);
  const body = fnMatch[0];
  // 4/11 J2 V5 fix sediment: timeoutVerifying emit timeout_v1 chain TX 前 transition (KI-20)
  assert.match(body, /timeout_v1|kanet_exchange_timeout_v1/, 'timeoutVerifying must broadcast timeout_v1 message');
  assert.match(body, /transition\s*\(/, 'timeoutVerifying must call transition() (state machine CAS, 守 R26 单源)');
});
