/**
 * Bug-D-residual + Bug G regression (NWT 11:04 Phase 2a surface).
 *
 * Bug-D-residual: b6a85af0e 修了 state-machine.js L256 CHAIN_SELECT error msg + chain list 6 chain,
 * 漏 _doOfferLookup router.js L352 reply hint 仍 hardcoded "1-4 选支付链". KI 第 N 次复刻补丁漏一片.
 *
 * Bug G: api/exchange.js accept route 缺 self-deal pre-check, 之前唯一 guard 在 exchange-machine.js
 * advance broadcast 层 (post-broadcast). self-accept 走 API → broadcast 已发 (花 fee) → exchange-machine
 * 拦 → 但 chain TX 已上链 + DB 双 path 不一致 (Bug F 真因之一). 加 API early reject.
 *
 * 跑法: node --test test-framework/cases/broker/bug_d_residual_bug_g_regression.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { SUPPORTED_CHAINS } from '../../../src/services/broker-v3/state-machine.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTER_JS = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');
const EXCHANGE_JS = readFileSync(join(__dirname, '../../../src/api/exchange.js'), 'utf-8');
const STATE_MACHINE_JS = readFileSync(join(__dirname, '../../../src/services/broker-v3/state-machine.js'), 'utf-8');

test('Bug-D-residual — SUPPORTED_CHAINS exported from state-machine.js', () => {
  assert.match(STATE_MACHINE_JS, /export const SUPPORTED_CHAINS\s*=/, 'SUPPORTED_CHAINS must be exported');
  assert.strictEqual(SUPPORTED_CHAINS.length, 6, 'SUPPORTED_CHAINS must be 6 chain');
  assert.deepStrictEqual(SUPPORTED_CHAINS, ['bsc', 'eth', 'polygon', 'arbitrum', 'optimism', 'base']);
});

test('Bug-D-residual — router.js _doOfferLookup reply hint uses dynamic length', () => {
  assert.match(ROUTER_JS, /回 1-\$\{stateMachine\.SUPPORTED_CHAINS\.length\}\s*选支付链/, 'reply hint must use template literal with SUPPORTED_CHAINS.length');
});

test('Bug-D-residual — old hardcoded "回 1-4" NOT present in router.js', () => {
  // Negative regression — hardcoded "1-4 选支付链" pattern must not return
  assert.doesNotMatch(ROUTER_JS, /['"]回 1-4 选支付链/, 'hardcoded "回 1-4 选支付链" must NOT exist');
});

test('Bug G — exchange.js accept route has early self-deal pre-check', () => {
  // Verify takerAddr === offer.maker comparison + return 400 before broadcast
  assert.match(EXCHANGE_JS, /if \(takerAddr === offer\.maker\)/, 'API must check takerAddr === offer.maker');
  assert.match(EXCHANGE_JS, /Cannot accept own offer \(self-deal\)/, 'API self-deal reject must have explicit error message');
});

test('Bug G — pre-check fires BEFORE broadcast (placement check)', () => {
  // Find self-deal check + first broadcast attempt — check order
  const selfDealIdx = EXCHANGE_JS.search(/if \(takerAddr === offer\.maker\)/);
  const broadcastIdx = EXCHANGE_JS.search(/NO TX NO STATE CHANGE.*\n.*Broadcast accept FIRST/s);
  assert.ok(selfDealIdx > 0 && broadcastIdx > 0, 'both markers found');
  assert.ok(selfDealIdx < broadcastIdx, 'self-deal pre-check must come BEFORE broadcast (placement check)');
});

test('Bug G — pre-check fires AFTER offer existence/status check (placement check)', () => {
  // self-deal check must come AFTER offer lookup so 'offer.maker' is defined
  const offerLookupIdx = EXCHANGE_JS.search(/const offer = sqlite\.prepare\('SELECT \* FROM exchange_offers WHERE id = \?'\)/);
  const selfDealIdx = EXCHANGE_JS.search(/if \(takerAddr === offer\.maker\)/);
  assert.ok(offerLookupIdx > 0 && selfDealIdx > offerLookupIdx, 'self-deal check must come after offer SELECT');
});
