// T-NWT-2026-04-26 a9e1eee7 self-accept fix unit smoke
//
// 验 4 场景, 当 broker 既是 maker 又是 sender (broker_dynamic_quote 路径)
// receive_address (真 user) ≠ maker (broker), 不应 reject.

import Database from 'better-sqlite3';
import { sqlite } from '../src/db/client.js';
import { processAccept, transition } from '../src/services/exchange-machine.js';
import { randomUUID } from 'crypto';

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${info || ''}`); }
};

const BROKER = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const USER_A = 'kaspa:qpsys3gzy4lg8txkuskhfnc4tskzn5r344eyudgyrc43te7vlq3f5a2cr843s';  // Trader-A 真地址
const USER_B = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';  // NWT 真地址

console.log('=== a9e1eee7 self-accept fix smoke ===\n');

// Helper: 创建一个 mock offer (broker 作 maker)
function createMockOffer(maker) {
  const id = randomUUID();
  sqlite.prepare(`
    INSERT INTO exchange_offers (id, maker, give_asset, give_amount, want_asset, want_amount, protocol_status, expires_at, created_at, updated_at, verification, verification_meta, metadata, broadcast_tx_id, market_key)
    VALUES (?, ?, 'KAS', '5', 'USDT', '0.17', 'open', NULL, datetime('now'), datetime('now'), 'cross_chain_tx', '{}', '{"source":"smoke_test"}', ?, ?)
  `).run(id, maker, 'mock_broadcast_' + id.slice(0, 8), 'KAS-USDT');
  return id;
}

// Cleanup helper
function cleanupOffer(id) {
  sqlite.prepare(`DELETE FROM exchange_offers WHERE id = ?`).run(id);
  sqlite.prepare(`DELETE FROM pending_exchange_accepts WHERE offer_id = ?`).run(id);
}

// ── 场景 1: broker 代发 accept (broker_dynamic_quote 路径) — 关键验证 ──
console.log('-- 1. broker 代发 (broker_dynamic_quote 真场景) --');
const offer1 = createMockOffer(BROKER);
const result1 = processAccept({
  t: 'kanet_exchange_accept_v1',
  offer_id: offer1,
  _from: BROKER,           // 信使 = broker (代发)
  receive_address: USER_A, // 真 taker = user (carry in payload)
  selected_chain: 'bnb',
  payment_asset: 'usdt',
});
t('1.1 broker_dynamic_quote 不再 self-accept reject', result1 !== null);
const offer1Row = sqlite.prepare('SELECT taker, protocol_status FROM exchange_offers WHERE id=?').get(offer1);
t('1.2 taker 字段被 set 为 user (USER_A)', offer1Row?.taker === USER_A);
cleanupOffer(offer1);

// ── 场景 2: 普通 user 自 accept 自己挂的 offer (应仍 reject) ──
console.log('\n-- 2. 普通 user 自 accept 仍 reject --');
const offer2 = createMockOffer(USER_A);  // user 挂的
const result2 = processAccept({
  t: 'kanet_exchange_accept_v1',
  offer_id: offer2,
  _from: USER_A,           // 信使 = user (无 broker 代)
  // 没 receive_address (普通 client 不 carry)
  selected_chain: 'bnb',
});
t('2.1 普通 user 自 accept 仍 reject (return null)', result2 === null);
cleanupOffer(offer2);

// ── 场景 3: broker 帮 user accept 真 maker (拼现成 offer 路径) ──
console.log('\n-- 3. broker 帮 user accept 真 maker (拼单路径) --');
const offer3 = createMockOffer(USER_B);  // 真 maker = USER_B (别人挂的)
const result3 = processAccept({
  t: 'kanet_exchange_accept_v1',
  offer_id: offer3,
  _from: BROKER,           // 信使 = broker (代 USER_A 发)
  receive_address: USER_A, // 真 taker = USER_A
  selected_chain: 'bnb',
});
t('3.1 broker 代 user accept 真 maker 通过', result3 !== null);
const offer3Row = sqlite.prepare('SELECT taker FROM exchange_offers WHERE id=?').get(offer3);
t('3.2 taker = USER_A (而非 broker)', offer3Row?.taker === USER_A);
cleanupOffer(offer3);

// ── 场景 4: 普通 user accept 别人 offer (无 broker 代发) ──
console.log('\n-- 4. 普通 user accept 别人 offer --');
const offer4 = createMockOffer(USER_B);
const result4 = processAccept({
  t: 'kanet_exchange_accept_v1',
  offer_id: offer4,
  _from: USER_A,  // user 自己发
  selected_chain: 'bnb',
});
t('4.1 user accept 别人 offer 通过', result4 !== null);
cleanupOffer(offer4);

// ── 场景 5: 边界 — receive_address === broker (诡异输入), 应 reject ──
console.log('\n-- 5. 边界: receive_address 同 broker (诡异输入) --');
const offer5 = createMockOffer(BROKER);
const result5 = processAccept({
  t: 'kanet_exchange_accept_v1',
  offer_id: offer5,
  _from: BROKER,
  receive_address: BROKER,  // 诡异: receive_address = maker 也 = broker
  selected_chain: 'bnb',
});
t('5.1 receive_address === maker 仍 reject (taker = receive_address)', result5 === null);
cleanupOffer(offer5);

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
