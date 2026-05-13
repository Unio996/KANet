/**
 * Source-pattern + integration regression — Sub #1.b multi-active dedup guards
 *
 * NWT spec 55cd7451 v0.2 Sub #1.b:
 * (1) broker-buy-handler.js finalizeBuy L603 加 existing_order_id 参数 mirror SELL L295 4/30 fix
 * (2) conversations.js seed_pending_accept INSERT 加 v3-active dedup guard
 * (3) broker-v2/state.js seedDraft 加 cross-version dedup (查 awaiting_payment/paid v3 row)
 *
 * Guards: source-pattern 守 3 处 dedup branch + finalizeBuy signature + _updateBuyOrder helper.
 * 防 v2/v3 path coexistence 触 SA-6 A1 multi-active violation.
 *
 * 跑法: node --test test-framework/cases/broker/invariants/peer_multi_active_dedup.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUY_HANDLER = readFileSync(join(__dirname, '../../../../src/services/broker-buy-handler.js'), 'utf-8');
const CONVERSATIONS = readFileSync(join(__dirname, '../../../../src/api/conversations.js'), 'utf-8');
const V2_STATE = readFileSync(join(__dirname, '../../../../src/services/broker-v2/state.js'), 'utf-8');
const SELL_HANDLER = readFileSync(join(__dirname, '../../../../src/services/broker-sell-handler.js'), 'utf-8');

test('broker-buy-handler.js exports _updateBuyOrder helper (mirror SELL _updateSellOrder)', () => {
  assert.match(BUY_HANDLER, /function\s+_updateBuyOrder\s*\(/, '_updateBuyOrder helper missing');
  // verify CAS pattern same as SELL: WHERE state='aligning' + transition
  assert.match(BUY_HANDLER, /_updateBuyOrder[\s\S]{0,800}WHERE\s+id\s*=\s*\?\s+AND\s+state\s*=\s*['"]aligning['"]/, 'UPDATE WHERE id+state=aligning CAS pattern missing in _updateBuyOrder');
  assert.match(BUY_HANDLER, /_updateBuyOrder[\s\S]{0,1500}transition\s*\(\s*\{[\s\S]{0,200}expectedFromState:\s*['"]aligning['"][\s\S]{0,100}toState:\s*['"]awaiting_payment['"]/, '_updateBuyOrder transition aligning→awaiting_payment CAS missing');
});

test('broker-buy-handler.js finalizeBuy signature has existing_order_id param', () => {
  assert.match(BUY_HANDLER, /export\s+async\s+function\s+finalizeBuy\s*\(\s*\{[\s\S]{0,300}existing_order_id\s*=\s*null/, 'finalizeBuy must accept existing_order_id param (mirror SELL L295)');
});

test('broker-buy-handler.js finalizeBuy v2 mutex branch — existing_order_id → _updateBuyOrder', () => {
  // early branch: if (existing_order_id) { _updateBuyOrder(...) }
  assert.match(BUY_HANDLER, /if\s*\(\s*existing_order_id\s*\)\s*\{[\s\S]{0,300}_updateBuyOrder/, 'finalizeBuy must call _updateBuyOrder when existing_order_id passed');
});

test('SELL handler L295 existing_order_id pattern still works (4/30 NWT fix preserved)', () => {
  // Backward sanity: 4/30 NWT SELL fix not regressed
  assert.match(SELL_HANDLER, /finalizeSell[\s\S]{0,500}existing_order_id\s*=\s*null[\s\S]{0,2000}_updateSellOrder/, 'broker-sell-handler finalizeSell existing_order_id mutex regressed');
});

test('conversations.js seed_pending_accept INSERT has v3-active dedup guard', () => {
  // Find the bv2_seed_ INSERT block in seed_pending_accept endpoint
  assert.match(CONVERSATIONS, /seed_pending_accept[\s\S]{0,1500}NOT\s+LIKE\s+'bv2_%'/, 'seed_pending_accept must check v3 active row (id NOT LIKE bv2_%) before INSERT');
  assert.match(CONVERSATIONS, /seed_pending_accept[\s\S]{0,2000}Sub\s+#1\.b\s+dedup/, 'Sub #1.b dedup guard annotation missing in seed_pending_accept');
});

test('broker-v2/state.js seedDraft has cross-version active dedup (awaiting_payment/paid v3 check)', () => {
  // After existing getActiveDraft check (aligning only), must also check non-bv2 active in advanced states
  assert.match(V2_STATE, /function\s+seedDraft\b[\s\S]{0,2000}awaiting_payment[\s\S]{0,400}NOT\s+LIKE\s+'bv2_%'/, 'seedDraft must check v3 awaiting_payment/paid before INSERT bv2_ (防 v2/v3 coexistence)');
  assert.match(V2_STATE, /function\s+seedDraft\b[\s\S]{0,2000}Sub\s+#1\.b\s+dedup/, 'Sub #1.b dedup guard annotation missing in seedDraft');
});

test('transition import in broker-buy-handler.js (for _updateBuyOrder CAS)', () => {
  assert.match(BUY_HANDLER, /import\s+\{\s*transition[\s\S]{0,100}from\s+['"]\.\/broker-state-machine\.js['"]/, 'broker-buy-handler must import transition from broker-state-machine.js');
});
