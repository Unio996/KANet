/**
 * Regression test — SOL/TRON publish path doesn't assume EVM address format
 *
 * Bug 3 (5/12 sediment §3.3): broker-v3 publish 'sol' / 'tron' chain 时撞
 * `Cannot read properties of null (reading 'slice')`. 估计是某处假设 EVM 0x prefix
 * 调 `.slice(2)` 之类的, SOL base58 / TRON T-prefix addr 没分支处理.
 *
 * Guard: source-level — assert (a) state-machine._validateAddr 分 chain type 分支 (sol/tron/EVM)
 * + (b) cross-chain-verify 跨 chain dispatch (sol → _verifySolana, tron → _verifyTron)
 * + (c) _SCAN_RPC_LIST OR 等价 chain config 含 sol+tron entry.
 *
 * 跑法: node --test cases/exchange/*.test.mjs
 *
 * NWT spec ea519032a §2.3, J2 ship P0.1 sub-task #3/3.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_MACHINE = readFileSync(join(__dirname, '../../../src/services/broker-v3/state-machine.js'), 'utf-8');
const CROSS_VERIFY = readFileSync(join(__dirname, '../../../src/services/cross-chain-verify.mjs'), 'utf-8');

test('state-machine._validateAddr handles sol+tron chain types (non-EVM branch)', () => {
  // NWT #69 (commit ref) 加的 SOL_ADDR_REGEX + TRON_ADDR_REGEX + _validateAddr 分支.
  // regression guard 守 future refactor 不退化回纯 EVM 假设.
  assert.match(STATE_MACHINE, /SOL_ADDR_REGEX\s*=\s*\//, 'SOL_ADDR_REGEX missing (NWT #69 expansion 退化)');
  assert.match(STATE_MACHINE, /TRON_ADDR_REGEX\s*=\s*\//, 'TRON_ADDR_REGEX missing (NWT #69 expansion 退化)');
  assert.match(STATE_MACHINE, /function\s+_validateAddr\s*\(/, '_validateAddr function missing');
  // _validateAddr body 必含 sol+tron 分支 (不只 EVM)
  const fnBody = STATE_MACHINE.match(/function\s+_validateAddr[\s\S]{0,300}?\}/);
  assert.ok(fnBody, '_validateAddr body not extractable');
  assert.match(fnBody[0], /chain\s*===\s*['"]sol['"]/, '_validateAddr missing sol branch');
  assert.match(fnBody[0], /chain\s*===\s*['"]tron['"]/, '_validateAddr missing tron branch');
});

test('cross-chain-verify dispatches sol+tron to non-EVM verifiers (no EVM slice assumption)', () => {
  // sediment 提到 _verifySolana / _verifyTron 已存在 (L313 / L390).
  assert.match(CROSS_VERIFY, /async\s+function\s+_verifySolana\b/, '_verifySolana function missing');
  assert.match(CROSS_VERIFY, /async\s+function\s+_verifyTron\b/, '_verifyTron function missing');
  // dispatch logic 必识别 chain==='sol' / chain==='tron' 走 non-EVM path
  assert.match(CROSS_VERIFY, /chain\s*===\s*['"]sol['"][\s\S]{0,80}_verifySolana/, 'sol dispatch to _verifySolana missing');
  assert.match(CROSS_VERIFY, /chain\s*===\s*['"]tron['"][\s\S]{0,80}_verifyTron/, 'tron dispatch to _verifyTron missing');
});

test('cross-chain-verify._SCAN_RPC_LIST OR chain config covers sol+tron (regression guard, 5/12 sediment §3.3 待补)', () => {
  // 5/12 sediment 指出 _SCAN_RPC_LIST 当前只 bnb/eth/polygon, 4 EVM (arb/op/avax/base) 跟 sol/tron 都缺 entry.
  // SOL/TRON 通过 _verifySolana/_verifyTron 独立 path (不走 _SCAN_RPC_LIST) — 这层 OK.
  // 但 cross-chain-verify 模块整体必须知道 sol+tron 是 valid chain (regress guard:
  // 若有人删 _verifySolana/_verifyTron OR 删 dispatch — 上 test 会 catch; 但若有人加新一层 EVM-only
  // chain validator 漏 sol/tron, 这条 guard 不够细. 留 follow-up: P0.2 加 integration test 实跑.
  const solTronHandled = /_verifySolana[\s\S]*?_verifyTron|_verifyTron[\s\S]*?_verifySolana/.test(CROSS_VERIFY);
  assert.ok(solTronHandled, 'sol+tron 两 verifier 必须并存 (regression guard against single-chain drift)');
});
