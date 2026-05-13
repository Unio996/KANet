/**
 * Source-pattern regression — scripts/test.mjs Sub #1.a synthetic peer cleanup hook
 *
 * NWT verdict 72e315db (cron baseline Sub #1 dig PASS + Option A 钦定) Sub #1.a:
 * test framework 跑完所有 case 后必 DELETE synthetic freshTestPeer 残留 active row,
 * 防 SA-6 A1 runtime invariant false-positive (prod 真守 active 单 row, 不豁免 invariant).
 *
 * Guard: scripts/test.mjs main() 末尾必含 _cleanupSyntheticActiveRows() 调用 +
 * 函数定义 + freshTestPeer 28-char repeat pattern detection (chars 7..34 === chars 39..66).
 *
 * 跑法: node --test test-framework/cases/system/test_runner_synthetic_peer_cleanup.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_RUNNER = readFileSync(join(__dirname, '../../../scripts/test.mjs'), 'utf-8');

test('scripts/test.mjs defines _cleanupSyntheticActiveRows function', () => {
  assert.match(TEST_RUNNER, /async\s+function\s+_cleanupSyntheticActiveRows\b/, 'cleanup function missing');
});

test('scripts/test.mjs calls cleanup after main loop', () => {
  // call must precede summary print '='.repeat(60)
  const callIdx = TEST_RUNNER.indexOf('_cleanupSyntheticActiveRows(quietFlag)');
  const summaryIdx = TEST_RUNNER.indexOf("'='.repeat(60)");
  assert.ok(callIdx > 0, 'cleanup call not found');
  assert.ok(summaryIdx > callIdx, 'cleanup must run BEFORE summary print (post-loop hygiene)');
});

test('cleanup filters by ACTIVE state set ({aligning, awaiting_payment, paid})', () => {
  assert.match(TEST_RUNNER, /state\s+IN\s*\(\s*['"]aligning['"]\s*,\s*['"]awaiting_payment['"]\s*,\s*['"]paid['"]\s*\)/, 'SQL pre-filter must match SA-6 A1 active state set');
});

test('cleanup detects freshTestPeer 28-char repeat pattern (chars 7..34 === 39..66)', () => {
  assert.match(TEST_RUNNER, /a\.slice\(7,\s*35\)\s*===\s*a\.slice\(39,\s*67\)/, 'freshTestPeer signature detection 28-char repeat missing');
});

test('cleanup only deletes synthetic, not real user rows', () => {
  // Negative guard: must NOT delete unconditionally — must check pattern first
  assert.doesNotMatch(TEST_RUNNER, /DELETE\s+FROM\s+retail_dex_orders\s+WHERE\s+state\s+IN/i, 'must not blanket-DELETE active rows — only synthetic-matching');
});

test('cleanup non-fatal — try/catch wraps DB ops', () => {
  // Cleanup failure must not break test summary output
  assert.match(TEST_RUNNER, /catch\s*\(\s*err\s*\)\s*\{[\s\S]{0,300}cleanup.*synthetic.*sweep\s+failed/i, 'cleanup must wrap in try/catch (non-fatal — summary must print even if cleanup fails)');
});
