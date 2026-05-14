/**
 * Sub P1 — broker-v3 MY_ORDERS UX gap fix regression (Tier 4 C1.6 NWT + J2 双 host reproduce).
 *
 * 5/14 NWT 9:46 + J2 9:54 Tier 4 实测: user publish offer 成功后 '5' MY_ORDERS 回 "0 active 订单".
 * 真因: broker-as-maker pattern (maker=broker_addr, user_id in metadata) → listOffers({ maker: peer })
 * 0 row. Owner 严训"用户不知挂单是否成功" → P1 fix scope.
 *
 * 修: state-machine.js 加 _publishedByUser Map<user_id, Map<offer_id, expires_at>>,
 * router.js _doPublish 后 record, _doMyOrders 走此 list + getOffer 拉详情.
 *
 * 跑法: node --test test-framework/cases/broker/bug_c_my_orders_p1_regression.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { addUserOffer, getUserOffers, _testResetUserOffers } from '../../../src/services/broker-v3/state-machine.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTER_JS = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');
const STATE_MACHINE_JS = readFileSync(join(__dirname, '../../../src/services/broker-v3/state-machine.js'), 'utf-8');

test('P1 — addUserOffer records offer_id under user_id', () => {
  _testResetUserOffers();
  addUserOffer('user-alice', 'offer-001');
  const list = getUserOffers('user-alice');
  assert.deepStrictEqual(list, ['offer-001']);
});

test('P1 — getUserOffers returns empty array for unknown user', () => {
  _testResetUserOffers();
  assert.deepStrictEqual(getUserOffers('unknown-user'), []);
});

test('P1 — multiple offers per user accumulate', () => {
  _testResetUserOffers();
  addUserOffer('user-bob', 'o-1');
  addUserOffer('user-bob', 'o-2');
  addUserOffer('user-bob', 'o-3');
  const list = getUserOffers('user-bob');
  assert.strictEqual(list.length, 3);
  assert.ok(list.includes('o-1') && list.includes('o-2') && list.includes('o-3'));
});

test('P1 — user isolation: alice + bob distinct registries', () => {
  _testResetUserOffers();
  addUserOffer('user-alice', 'a-1');
  addUserOffer('user-bob', 'b-1');
  assert.deepStrictEqual(getUserOffers('user-alice'), ['a-1']);
  assert.deepStrictEqual(getUserOffers('user-bob'), ['b-1']);
});

test('P1 — duplicate offer_id refresh TTL (Map.set semantics)', () => {
  _testResetUserOffers();
  addUserOffer('user-c', 'dup');
  addUserOffer('user-c', 'dup');  // Same offer_id — single entry, refreshed TTL
  assert.deepStrictEqual(getUserOffers('user-c'), ['dup']);
});

test('P1 — invalid args silently no-op', () => {
  _testResetUserOffers();
  addUserOffer(null, 'x');
  addUserOffer('user-d', null);
  addUserOffer('', '');
  assert.strictEqual(getUserOffers('user-d').length, 0);
});

test('P1 — router.js _doPublish records offer_id on success', () => {
  assert.match(ROUTER_JS, /addUserOffer\(peer,\s*r\.offer_id\)/, '_doPublish must call stateMachine.addUserOffer post publish success');
});

test('P1 — router.js _doMyOrders uses getUserOffers (not listOffers maker=peer)', () => {
  assert.match(ROUTER_JS, /stateMachine\.getUserOffers\(peer\)/, '_doMyOrders must call getUserOffers');
  // Verify old broken pattern NOT present in _doMyOrders
  const myOrdersBlock = ROUTER_JS.match(/async function _doMyOrders[\s\S]+?\n\}/);
  assert.ok(myOrdersBlock, '_doMyOrders block found');
  assert.doesNotMatch(myOrdersBlock[0], /await\s+client\.listOffers\(\{\s*maker:\s*peer/, '_doMyOrders must NOT invoke client.listOffers({maker:peer}) (broker-as-maker pattern)');
});

test('P1 — state-machine.js exports addUserOffer + getUserOffers', () => {
  assert.match(STATE_MACHINE_JS, /export function addUserOffer/, 'addUserOffer must be exported');
  assert.match(STATE_MACHINE_JS, /export function getUserOffers/, 'getUserOffers must be exported');
});
