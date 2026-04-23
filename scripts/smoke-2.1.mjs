// smoke-2.1.mjs — TASK 2.1 验证: selectBestOffer + computeQuote
// 用真实 console.db 插测试行, 跑完清理. 打印每 case 结果.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../kasia-console/package.json'));
const Database = require('better-sqlite3');
const DB = path.join(__dirname, '../kasia-console/data/console.db');

const db = new Database(DB);

// 先清上次残留
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();
// 暂时隐藏真实 open KAS/USDT 挂单, 避免干扰 selectBestOffer
const hiddenCount = db.prepare(
  "UPDATE exchange_offers SET protocol_status='smoke_paused' WHERE protocol_status='open' AND give_asset='KAS' AND want_asset='USDT'"
).run().changes;
console.log(`[smoke] 暂隐 ${hiddenCount} 条真实挂单`);

process.on('exit', () => {
  // 恢复真实挂单状态
  try {
    db.prepare("UPDATE exchange_offers SET protocol_status='open' WHERE protocol_status='smoke_paused'").run();
    db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();
  } catch {}
});

const { selectBestOffer, computeQuote } = await import('file:///' + path.join(__dirname, '../kasia-console/src/services/retail-dex.js').replace(/\\/g, '/'));

const now = new Date().toISOString();
const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 3600_000).toISOString();

function insert(id, overrides = {}) {
  const base = {
    id, maker: 'kaspa:test-maker', taker: null,
    broadcast_tx_id: 'test-btx-' + id, message_index: 0,
    give_asset: 'KAS', give_amount: '10',
    want_asset: 'USDT', want_amount: '1.7',
    verification: 'cross_chain_tx',
    protocol_status: 'open', is_fully_observed: 1,
    market_key: 'KAS|USDT', expires_at: FUTURE,
    verification_meta: JSON.stringify({
      accepted_chains: [{ chain: 'bnb', address: '0x1111111111111111111111111111111111111111' }],
      expected_asset: 'USDT',
    }),
    created_at: now, updated_at: now,
  };
  const o = { ...base, ...overrides };
  db.prepare(`INSERT INTO exchange_offers
    (id, maker, taker, broadcast_tx_id, message_index, give_asset, give_amount, want_asset, want_amount,
     verification, protocol_status, is_fully_observed, market_key, expires_at, verification_meta, created_at, updated_at)
    VALUES (@id,@maker,@taker,@broadcast_tx_id,@message_index,@give_asset,@give_amount,@want_asset,@want_amount,
            @verification,@protocol_status,@is_fully_observed,@market_key,@expires_at,@verification_meta,@created_at,@updated_at)`).run(o);
}

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r) { console.log(`  [PASS] ${name}`); pass++; }
    else { console.log(`  [FAIL] ${name} → assertion returned false`); fail++; }
  } catch (e) {
    console.log(`  [FAIL] ${name} → THROW: ${e.message}`);
    fail++;
  }
}

console.log('=== TASK 2.1 smoke: selectBestOffer + computeQuote ===\n');

// 清理后插入 fixtures
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();

// ─── case 1-3: 合法三链 offer → computeQuote ok + maker_pay_addr 对 ───
const offer_bnb = {
  id: 'test-2.1-bnb', give_amount: '10', want_amount: '1.7',
  verification_meta: JSON.stringify({ accepted_chains: [{ chain: 'bnb', address: '0xBNBADDR00000000000000000000000000000001' }] }),
};
const offer_eth = {
  id: 'test-2.1-eth', give_amount: '10', want_amount: '1.7',
  verification_meta: JSON.stringify({ accepted_chains: [{ chain: 'eth', address: '0xETHADDR00000000000000000000000000000002' }] }),
};
const offer_poly = {
  id: 'test-2.1-poly', give_amount: '10', want_amount: '1.7',
  verification_meta: JSON.stringify({ accepted_chains: [{ chain: 'polygon', address: '0xPOLYADDR0000000000000000000000000000003' }] }),
};
[offer_bnb, offer_eth, offer_poly].forEach(o => insert(o.id, o));

test('1. bnb offer computeQuote ok + addr match', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  const o = db.prepare("SELECT * FROM exchange_offers WHERE id=?").get('test-2.1-bnb');
  const q = computeQuote(order, o, null);
  return q.ok === true && q.maker_pay_addr === '0xBNBADDR00000000000000000000000000000001' && q.offer_id === 'test-2.1-bnb';
});
test('2. eth offer computeQuote ok + addr match', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'ETH' };
  const o = db.prepare("SELECT * FROM exchange_offers WHERE id=?").get('test-2.1-eth');
  const q = computeQuote(order, o, null);
  return q.ok === true && q.maker_pay_addr === '0xETHADDR00000000000000000000000000000002';
});
test('3. polygon offer computeQuote ok', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'polygon' };
  const o = db.prepare("SELECT * FROM exchange_offers WHERE id=?").get('test-2.1-poly');
  const q = computeQuote(order, o, null);
  return q.ok === true && q.maker_pay_addr === '0xPOLYADDR0000000000000000000000000000003';
});

// ─── case 4: accepted_chains 空 ───
test('4. accepted_chains 空 → error no_maker_addr', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  const o = { verification_meta: JSON.stringify({ accepted_chains: [] }), want_amount: '1.7', give_amount: '10' };
  const q = computeQuote(order, o, null);
  return q.error === 'no_maker_addr';
});

// ─── case 5: verification_meta 非法 JSON ───
test('5. 非法 JSON → error bad_meta 不 throw', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  const o = { verification_meta: '{not valid json', want_amount: '1.7', give_amount: '10' };
  const q = computeQuote(order, o, null);
  return q.error === 'bad_meta';
});

// ─── case 6: chain 大小写归一 ───
test('6. BSC ↔ bnb 归一匹配', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BEP20' };  // BEP20 → bnb
  const o = db.prepare("SELECT * FROM exchange_offers WHERE id=?").get('test-2.1-bnb');
  const q = computeQuote(order, o, null);
  return q.ok === true;
});

// ─── case 7: selectBestOffer 精确 qty=10 命中 ───
test('7. selectBestOffer 精确 qty=10 命中 bnb offer', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  const o = selectBestOffer(order);
  return o && o.id === 'test-2.1-bnb' && o.give_amount === '10';
});

// ─── case 8: fallback give_amount > qty ───
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();
insert('test-2.1-big', {
  id: 'test-2.1-big', give_amount: '50', want_amount: '8.5',
});
test('8. selectBestOffer fallback qty=10, offer give=50', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  const o = selectBestOffer(order);
  return o && o.id === 'test-2.1-big' && o.give_amount === '50';
});

// ─── case 9: 无挂单 ───
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();
test('9. 无挂单 → null', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  return selectBestOffer(order) === null;
});

// ─── case 10: chain 不匹配 ───
insert('test-2.1-eth-only', {
  id: 'test-2.1-eth-only',
  verification_meta: JSON.stringify({ accepted_chains: [{ chain: 'eth', address: '0xe' }] }),
});
test('10. offer 只接 eth, 用户 pay_chain=BSC → null', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  return selectBestOffer(order) === null;
});

// ─── case 11: expires_at 已过 ───
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();
insert('test-2.1-expired', { id: 'test-2.1-expired', expires_at: PAST });
test('11. offer 已过期 → null', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  return selectBestOffer(order) === null;
});

// ─── case 12: protocol_status=matched ───
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();
insert('test-2.1-matched', { id: 'test-2.1-matched', protocol_status: 'matched' });
test('12. offer 状态 matched → null (不是 open)', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  return selectBestOffer(order) === null;
});

// ─── bonus A: 两 offer 同 qty 不同价 → 选便宜 ───
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();
insert('test-2.1-cheap', { id: 'test-2.1-cheap', give_amount: '10', want_amount: '1.5' });
insert('test-2.1-exp', { id: 'test-2.1-exp', give_amount: '10', want_amount: '2.5' });
test('bonus-A: 两精确 offer 选便宜', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  const o = selectBestOffer(order);
  return o && o.id === 'test-2.1-cheap';
});

// ─── bonus B: verification_meta = null ───
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();
test('bonus-B: verification_meta = null → computeQuote 不崩', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  const o = { verification_meta: null, want_amount: '1.7', give_amount: '10' };
  const q = computeQuote(order, o, null);
  return q.error === 'no_maker_addr';
});

// ─── bonus C: 部分成交按比例算 quoted_usdt ───
insert('test-2.1-partial', { id: 'test-2.1-partial', give_amount: '50', want_amount: '8.5' });
test('bonus-C: 部分成交 give=50 want=8.5 qty=10 → quoted≈1.7', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'BSC' };
  const o = db.prepare("SELECT * FROM exchange_offers WHERE id=?").get('test-2.1-partial');
  const q = computeQuote(order, o, null);
  const quoted = parseFloat(q.quoted_usdt);
  return q.ok && Math.abs(quoted - 1.7) < 0.001;
});

// ─── bonus D: 归一异常 chain 返回 null (selectBestOffer) ───
test('bonus-D: pay_chain=unknown → selectBestOffer 归一可能返回 "unknown" 不崩', () => {
  const order = { side: 'buy_kas', qty: '10', pay_chain: 'unknown' };
  // 归一 "unknown" → "unknown" (不在 BSC/BNB/ETH/TRON/SOL 映射, 返小写)
  // selectBestOffer 会用 'unknown' 做匹配, 没对应链 → null
  const o = selectBestOffer(order);
  return o === null;  // 不崩即可
});

// ─── bonus E: SQL 注入测试 (prepare 参数化, 表没被 DROP) ───
test('bonus-E: qty 含 SQL 特殊字符 → 不 throw + exchange_offers 表仍在', () => {
  const order = { side: 'buy_kas', qty: "1'; DROP TABLE exchange_offers; --", pay_chain: 'BSC' };
  try {
    selectBestOffer(order);  // 不关心返什么 — 关键是不注入
  } catch (e) {
    return false;
  }
  // 验证表还在 (数落库还能查到 test-2.1-partial)
  const row = db.prepare("SELECT id FROM exchange_offers WHERE id='test-2.1-partial'").get();
  return !!row;
});

// ─── 清理 ───
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.1-%'").run();

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
db.close();
process.exit(fail === 0 ? 0 : 1);
