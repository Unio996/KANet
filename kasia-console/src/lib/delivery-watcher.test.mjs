// delivery-watcher.test.mjs — 账本1877 步2: 数字商品交付 store + 状态机(注入式 ctx, 零链)。含 v0.3 §3 断言 e(日志/表扫描 + 阳性对照)。
// Run: cd kasia-console && node src/lib/delivery-watcher.test.mjs   (自举: 临时 migration 库)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._DLV_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_dlv_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _DLV_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet';
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
import assert from 'node:assert';
const { sqlite } = await import('../db/client.js');
const S = await import('./delivery-store.mjs');
const W = await import('./delivery-watcher.mjs');
const X = await import('./checkout-static/delivery-crypto.js');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };

const MERCHANT = 'kaspasim:qmerchant0000000000000000000000000000000000000000000000';
const OADDR = (n) => `kaspasim:qorderaddr${String(n).padStart(2, '0')}00000000000000000000000000000000000000`;
const TOTAL = '300000000', MAMT = '250000000';
const SECRET = 'ACTIVATION-CODE-0001-SECRET';
let addrSeq = 0;
const newOrder = (o = {}) => {
  const c = S.createOrder(sqlite, { network: 'simnet', skuId: o.sku || 'sku-a', totalSompi: TOTAL, merchantAddress: MERCHANT, merchantAmountSompi: MAMT, deadlineMs: o.deadlineMs ?? Date.now() + 3600_000 });
  const addr = OADDR(++addrSeq);
  assert.ok(S.registerOrderAddress(sqlite, c.id, addr));
  return { ...c, addr };
};
// 假链: 可变状态
const mkChain = (addr, o = {}) => ({ addr, blue: 10_000, txs: [], utxos: [], ...o });
const fund = (ch, { depth = 25, amount = TOTAL, txid = 'f'.repeat(64), idx = 0 } = {}) => { ch.txs.push({ txid, isAccepted: true, acceptingBlueScore: ch.blue - depth, blockTimeMs: Date.now() - 60_000, outputs: [{ index: idx, valueSompi: amount, address: ch.addr }], spentOutpoints: [] }); ch.utxos = [{ txid, index: idx, amountSompi: amount }]; return txid; };
const spend = (ch, fundTxid, { depth = 25, merchantAmt = MAMT, blockTimeMs = Date.now() - 30_000, accepted = true, txid = 'a'.repeat(64), idx = 0 } = {}) => { ch.txs.push({ txid, isAccepted: accepted, acceptingBlueScore: ch.blue - depth, blockTimeMs, outputs: [{ index: 0, valueSompi: merchantAmt, address: MERCHANT }], spentOutpoints: [{ txid: fundTxid, index: idx }] }); ch.utxos = []; return txid; };
const mkCtx = (ch, o = {}) => {
  const calls = []; const logs = [];
  const ctx = {
    calls, logs,
    readHistory: async () => ({ txs: ch.txs, currentBlueScore: ch.blue }),
    getUtxos: async () => ch.utxos,
    triggerSplit: o.triggerSplit || (async (ord, u) => { calls.push(['split', ord.id, u.txid]); return { txid: 'b'.repeat(64) }; }),
    sendMailbox: o.sendMailbox || (async (a) => { calls.push(['mailbox', a.target, a.amountKas, a.payloadHex]); return { txid: 'c'.repeat(64) }; }),
    mailboxAddress: (priv, net) => `kaspasim:q${priv.slice(0, 50)}`,
    mailboxLanded: o.mailboxLanded || (async () => true),
    nowMs: o.nowMs || (() => Date.now()),
    log: (m) => logs.push(m),
  };
  return ctx;
};
const row = (id) => S.getOrderPublic(sqlite, id);
const step = async (id, ctx) => W.tickOrder(sqlite, row(id), ctx);
const seedStock = (sku = 'sku-a', items = [SECRET]) => S.addStock(sqlite, sku, items);

// ───────── store ─────────
await t('createOrder: 返回 32 hex nonce; 库里没有明文 nonce(扫整行); 公开视图无 nonce_encrypted; 可解封回原值', () => {
  const c = S.createOrder(sqlite, { network: 'simnet', skuId: 's', totalSompi: TOTAL, merchantAddress: MERCHANT, merchantAmountSompi: MAMT, deadlineMs: Date.now() + 1e6 });
  assert.match(c.orderNonceHex, /^[0-9a-f]{32}$/);
  const raw = sqlite.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(c.id);
  assert.ok(!JSON.stringify(raw).toLowerCase().includes(c.orderNonceHex));
  assert.ok(!('nonce_encrypted' in S.getOrderPublic(sqlite, c.id)));
  assert.strictEqual(S.unsealNonceForDelivery(sqlite, c.id), c.orderNonceHex);
});
await t('createOrder: 非法输入 ⇒ 抛(金额/商家额>总额/过期 deadline/空 sku)', () => {
  const base = { network: 'simnet', skuId: 's', totalSompi: TOTAL, merchantAddress: MERCHANT, merchantAmountSompi: MAMT, deadlineMs: Date.now() + 1e6 };
  for (const bad of [{ totalSompi: '0' }, { totalSompi: '1.5' }, { merchantAmountSompi: '999999999999' }, { deadlineMs: Date.now() - 1 }, { skuId: '' }, { merchantAddress: '' }, { network: '' }]) assert.throws(() => S.createOrder(sqlite, { ...base, ...bad }), undefined, JSON.stringify(bad));
});
await t('registerOrderAddress: created→watching 仅一次; 重复登记 false; 地址被别单占用 ⇒ 抛(UNIQUE)', () => {
  const a = S.createOrder(sqlite, { network: 'simnet', skuId: 's', totalSompi: TOTAL, merchantAddress: MERCHANT, merchantAmountSompi: MAMT, deadlineMs: Date.now() + 1e6 });
  const b = S.createOrder(sqlite, { network: 'simnet', skuId: 's', totalSompi: TOTAL, merchantAddress: MERCHANT, merchantAmountSompi: MAMT, deadlineMs: Date.now() + 1e6 });
  assert.ok(S.registerOrderAddress(sqlite, a.id, 'kaspasim:qdupaddress0000000000')); assert.ok(!S.registerOrderAddress(sqlite, a.id, 'kaspasim:qother000000000000'));
  assert.throws(() => S.registerOrderAddress(sqlite, b.id, 'kaspasim:qdupaddress0000000000'));
  assert.strictEqual(row(a.id).state, 'watching'); assert.strictEqual(row(b.id).state, 'created');
});
await t('transition: 非法迁移被 CAS 拒(created→delivered / paid→mailbox_sent / delivered→任何); 不可 patch 的列抛', () => {
  const o = newOrder();
  assert.ok(!S.transition(sqlite, o.id, 'delivered')); assert.ok(!S.transition(sqlite, o.id, 'mailbox_sent'));
  const c0 = S.createOrder(sqlite, { network: 'simnet', skuId: 's', totalSompi: TOTAL, merchantAddress: MERCHANT, merchantAmountSompi: MAMT, deadlineMs: Date.now() + 1e6 });
  assert.ok(!S.transition(sqlite, c0.id, 'paid'), 'created 不能直接 paid'); assert.ok(!S.transition(sqlite, c0.id, 'split_done'), 'created 不能直接 split_done');
  assert.throws(() => S.transition(sqlite, o.id, 'paid', { state: 'delivered' }), /不可经 patch/);
  assert.throws(() => S.transition(sqlite, o.id, 'paid', { nonce_encrypted: 'x' }), /不可经 patch/);
  assert.throws(() => S.transition(sqlite, o.id, 'bogus'), /不允许迁入/);
});
await t('库存: 一码一单(两单抢一件只一个拿到); 幂等(同单再分配返回同一项); 无库存 ⇒ null; 明文不在库里', () => {
  const sku = 'sku-stock'; S.addStock(sqlite, sku, ['ONLY-ONE-CODE']);
  const mk = () => { const c = S.createOrder(sqlite, { network: 'simnet', skuId: sku, totalSompi: TOTAL, merchantAddress: MERCHANT, merchantAmountSompi: MAMT, deadlineMs: Date.now() + 1e6 }); return c.id; };
  const a = mk(), b = mk();
  const ra = S.assignStock(sqlite, a), rb = S.assignStock(sqlite, b);
  assert.ok(ra && ra.reused === false); assert.strictEqual(rb, null);
  assert.strictEqual(S.assignStock(sqlite, a).stockId, ra.stockId); assert.strictEqual(S.assignStock(sqlite, a).reused, true);
  assert.strictEqual(S.readStockPlaintext(sqlite, ra.stockId), 'ONLY-ONE-CODE');
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM delivery_stock').all()).includes('ONLY-ONE-CODE'));
  assert.throws(() => S.addStock(sqlite, sku, ['']), /非空/); assert.throws(() => S.addStock(sqlite, sku, ['x'.repeat(1025)]), /1024/);
});

// ───────── 状态机 ─────────
await t('主路径: watching→paid→split_done→mailbox_sent→delivered; 买家用 nonce 能从信箱密文解出同一交付物; 全程 split 一次、信箱一次', async () => {
  seedStock();
  const o = newOrder(); const ch = mkChain(o.addr); const ctx = mkCtx(ch);
  assert.strictEqual(await step(o.id, ctx), 'watching');                              // 还没付款
  const ft = fund(ch);
  assert.strictEqual(await step(o.id, ctx), 'paid'); assert.strictEqual(row(o.id).pay_txid, ft);
  assert.strictEqual(await step(o.id, ctx), 'paid'); assert.strictEqual(ctx.calls.filter((c) => c[0] === 'split').length, 1, '广播 split 一次');
  assert.strictEqual(await step(o.id, ctx), 'paid', '刚广播过 ⇒ 等它落链, 不重发'); assert.strictEqual(ctx.calls.filter((c) => c[0] === 'split').length, 1);
  assert.ok(!ctx.calls.some((c) => c[0] === 'mailbox'), 'split_done 之前绝不发信箱');
  spend(ch, ft, { txid: 'b'.repeat(64) });
  assert.strictEqual(await step(o.id, ctx), 'split_done'); assert.strictEqual(row(o.id).split_txid, 'b'.repeat(64));
  assert.strictEqual(await step(o.id, ctx), 'mailbox_sent');
  const mb = ctx.calls.find((c) => c[0] === 'mailbox'); assert.strictEqual(mb[2], W.MAILBOX_AMOUNT_KAS);
  const r1 = row(o.id); assert.strictEqual(r1.mailbox_txid, 'c'.repeat(64)); assert.strictEqual(r1.mailbox_payload_hex, mb[3]);
  const picked = await X.pickDeliverable({ orderNonceHex: o.orderNonceHex, orderAddress: o.addr, txs: [{ txid: 'c'.repeat(64), payloadHex: r1.mailbox_payload_hex, isAccepted: true, acceptingBlueScore: 100 }], currentBlueScore: 200 });
  assert.deepStrictEqual(picked, { status: 'delivered', txid: 'c'.repeat(64), plaintext: SECRET });
  assert.strictEqual(await step(o.id, ctx), 'delivered'); assert.ok(row(o.id).delivered_at);
});
await t('少付 ⇒ 不交付不推进; 深度 19 ⇒ 不推进, 20 ⇒ paid', async () => {
  const o = newOrder(); const ch = mkChain(o.addr); const ctx = mkCtx(ch);
  fund(ch, { amount: String(BigInt(TOTAL) - 1n) }); assert.strictEqual(await step(o.id, ctx), 'watching');
  const o2 = newOrder(); const ch2 = mkChain(o2.addr); const ctx2 = mkCtx(ch2);
  fund(ch2, { depth: 19 }); assert.strictEqual(await step(o2.id, ctx2), 'watching');
  ch2.blue += 1; assert.strictEqual(await step(o2.id, ctx2), 'paid');
});
await t('裁定②(买家抢先 split): 三条同时满足 ⇒ split_done 且我们不再广播 split', async () => {
  const o = newOrder(); const ch = mkChain(o.addr); const ctx = mkCtx(ch);
  const ft = fund(ch); spend(ch, ft, { txid: 'd'.repeat(64) });
  assert.strictEqual(await step(o.id, ctx), 'split_done'); assert.strictEqual(row(o.id).split_txid, 'd'.repeat(64)); assert.strictEqual(ctx.calls.length, 0);
});
await t('裁定②: (c)深度 19 ⇒ 等(不转人工), 20 ⇒ split_done', async () => {
  const o = newOrder(); const ch = mkChain(o.addr); const ctx = mkCtx(ch); const ft = fund(ch); spend(ch, ft, { depth: 19 });
  assert.strictEqual(await step(o.id, ctx), 'watching'); ch.blue += 1; assert.strictEqual(await step(o.id, ctx), 'split_done');
});
await t('裁定②: (b)商家金额差 1 sompi / 多 1 sompi ⇒ manual_review, 且绝不交付', async () => {
  for (const delta of [-1n, 1n]) {
    const o = newOrder(); const ch = mkChain(o.addr); const ctx = mkCtx(ch); const ft = fund(ch); spend(ch, ft, { merchantAmt: String(BigInt(MAMT) + delta) });
    assert.strictEqual(await step(o.id, ctx), 'manual_review'); assert.match(row(o.id).manual_reason, /精确金额/); assert.ok(!ctx.calls.some((c) => c[0] === 'mailbox'));
  }
});
await t('裁定②: (a)花费交易在 deadline 之后落链(= 退款) ⇒ expired, 不交付', async () => {
  const dl = Date.now() + 3600_000;
  const o = newOrder({ deadlineMs: dl }); const ch = mkChain(o.addr); const ctx = mkCtx(ch); const ft = fund(ch); spend(ch, ft, { blockTimeMs: dl + 1 });
  assert.strictEqual(await step(o.id, ctx), 'expired'); assert.ok(!ctx.calls.length);
  const o2 = newOrder({ deadlineMs: dl }); const ch2 = mkChain(o2.addr); const ctx2 = mkCtx(ch2); const ft2 = fund(ch2); spend(ch2, ft2, { blockTimeMs: dl - 1 });
  assert.strictEqual(await step(o2.id, ctx2), 'split_done', 'deadline 前一毫秒落链 ⇒ 满足(a)');
});
await t('裁定②: 花费交易未被接受 ⇒ 等; UTXO 没了但读后端给不出花费交易 ⇒ manual_review(不猜)', async () => {
  const o = newOrder(); const ch = mkChain(o.addr); const ctx = mkCtx(ch); const ft = fund(ch); spend(ch, ft, { accepted: false });
  assert.strictEqual(await step(o.id, ctx), 'watching');
  const o2 = newOrder(); const ch2 = mkChain(o2.addr); const ctx2 = mkCtx(ch2); fund(ch2); ch2.utxos = [];
  assert.strictEqual(await step(o2.id, ctx2), 'manual_review');
});
await t('paid: 距 deadline 不足安全窗口 ⇒ manual_review 不 split', async () => {
  const o = newOrder({ deadlineMs: Date.now() + W.SPLIT_SAFETY_MS - 1000 }); const ch = mkChain(o.addr); const ctx = mkCtx(ch); fund(ch);
  assert.strictEqual(await step(o.id, ctx), 'paid'); assert.strictEqual(await step(o.id, ctx), 'manual_review'); assert.ok(!ctx.calls.length);
});
await t('split 广播失败: 保持 paid 计数 +1, 达上限 ⇒ manual_review; 广播成功后超过重试间隔仍在 ⇒ 才再试', async () => {
  const o = newOrder(); const ch = mkChain(o.addr); let n = 0; const ctx = mkCtx(ch, { triggerSplit: async () => { n++; throw new Error('boom'); } }); fund(ch);
  await step(o.id, ctx);
  for (let i = 0; i < W.MAX_SPLIT_ATTEMPTS; i++) assert.strictEqual(await step(o.id, ctx), 'paid');
  assert.strictEqual(await step(o.id, ctx), 'manual_review'); assert.strictEqual(n, W.MAX_SPLIT_ATTEMPTS, '上限后不再广播');
  const o2 = newOrder(); const ch2 = mkChain(o2.addr); let clock = Date.now(); const ctx2 = mkCtx(ch2, { nowMs: () => clock }); fund(ch2);
  await step(o2.id, ctx2); await step(o2.id, ctx2); assert.strictEqual(ctx2.calls.filter((c) => c[0] === 'split').length, 1);
  clock += W.SPLIT_RETRY_AFTER_MS + 2000; sqlite.prepare("UPDATE delivery_orders SET updated_at = datetime('now','-10 minutes') WHERE id = ?").run(o2.id);
  await step(o2.id, ctx2); assert.strictEqual(ctx2.calls.filter((c) => c[0] === 'split').length, 2);
});
await t('无库存 ⇒ manual_review 且不发信箱; 补库存后(人工恢复)可继续', async () => {
  const o = newOrder({ sku: 'sku-empty' }); const ch = mkChain(o.addr); const ctx = mkCtx(ch); const ft = fund(ch); await step(o.id, ctx); spend(ch, ft); await step(o.id, ctx);
  assert.strictEqual(await step(o.id, ctx), 'manual_review'); assert.match(row(o.id).manual_reason, /库存不足/); assert.ok(!ctx.calls.some((c) => c[0] === 'mailbox'));
});
await t('信箱发送失败: 保持 split_done 且第二次仍分配到同一库存项(不二次分配); 达上限 ⇒ manual_review; 之后成功 ⇒ mailbox_sent', async () => {
  seedStock('sku-b', ['B-CODE-1', 'B-CODE-2']);
  const o = newOrder({ sku: 'sku-b' }); const ch = mkChain(o.addr); let fails = 1; const ctx = mkCtx(ch, { sendMailbox: async (a) => { if (fails-- > 0) throw new Error('relay down'); return { txid: 'e'.repeat(64) }; } });
  const ft = fund(ch); await step(o.id, ctx); spend(ch, ft); await step(o.id, ctx);
  assert.strictEqual(await step(o.id, ctx), 'split_done'); const sid = row(o.id).stock_id; assert.ok(sid);
  assert.strictEqual(await step(o.id, ctx), 'mailbox_sent'); assert.strictEqual(row(o.id).stock_id, sid);
  assert.strictEqual(sqlite.prepare("SELECT count(*) n FROM delivery_stock WHERE sku_id = 'sku-b' AND assigned_order IS NOT NULL").get().n, 1, '只占用 1 件库存');
  const o2 = newOrder({ sku: 'sku-b' }); const ch2 = mkChain(o2.addr); const ctx2 = mkCtx(ch2, { sendMailbox: async () => { throw new Error('always'); } });
  const ft2 = fund(ch2); await step(o2.id, ctx2); spend(ch2, ft2); await step(o2.id, ctx2);
  for (let i = 0; i < W.MAX_MAILBOX_ATTEMPTS - 1; i++) assert.strictEqual(await step(o2.id, ctx2), 'split_done');
  assert.strictEqual(await step(o2.id, ctx2), 'manual_review');
});
await t('mailbox_sent: 没落链 ⇒ 不写 delivered; 超过重发间隔 ⇒ 同一密文新交易重发; 次数用尽 ⇒ manual_review', async () => {
  seedStock('sku-c', ['C-CODE']);
  const o = newOrder({ sku: 'sku-c' }); const ch = mkChain(o.addr); let clock = Date.now(); let landed = false; let txn = 0;
  const ctx = mkCtx(ch, { nowMs: () => clock, mailboxLanded: async () => landed, sendMailbox: async () => ({ txid: String(++txn).padStart(64, '0') }) });
  const ft = fund(ch); await step(o.id, ctx); spend(ch, ft); await step(o.id, ctx); await step(o.id, ctx);
  assert.strictEqual(row(o.id).state, 'mailbox_sent'); const payload0 = row(o.id).mailbox_payload_hex;
  assert.strictEqual(await step(o.id, ctx), 'mailbox_sent'); assert.notStrictEqual(row(o.id).state, 'delivered', '未落链绝不 delivered');
  clock += W.MAILBOX_RESEND_AFTER_MS + 1000; sqlite.prepare("UPDATE delivery_orders SET mailbox_sent_at = datetime('now','-20 minutes') WHERE id = ?").run(o.id);
  assert.strictEqual(await step(o.id, ctx), 'mailbox_sent'); assert.strictEqual(row(o.id).mailbox_payload_hex, payload0, '同一密文'); assert.strictEqual(row(o.id).mailbox_txid, '0'.repeat(63) + '2'); assert.strictEqual(row(o.id).mailbox_attempts, 1);
  sqlite.prepare("UPDATE delivery_orders SET mailbox_sent_at = datetime('now','-20 minutes'), mailbox_attempts = ? WHERE id = ?").run(W.MAX_MAILBOX_ATTEMPTS - 1, o.id);
  assert.strictEqual(await step(o.id, ctx), 'manual_review');
  landed = true; const o2 = newOrder({ sku: 'sku-c' }); seedStock('sku-c', ['C2']); void o2;
});
await t('tick 永不抛: ctx 读链抛错 ⇒ 保持原状态, 不推进不误报 delivered', async () => {
  const o = newOrder(); const ch = mkChain(o.addr); const ctx = mkCtx(ch); ctx.readHistory = async () => { throw new Error('indexer 503'); };
  assert.strictEqual(await step(o.id, ctx), 'watching'); assert.ok(ctx.logs.some((l) => /tick 异常/.test(l)));
});
await t('deliveryTick: 串行推进所有活跃订单, 返回计数', async () => {
  const ctx = mkCtx(mkChain('x')); ctx.readHistory = async () => ({ txs: [], currentBlueScore: 1 }); ctx.getUtxos = async () => [];
  const r = await W.deliveryTick(sqlite, ctx); assert.ok(r.processed >= 1 && typeof r.byState === 'object');
});

// ───────── 断言 e: 日志/表扫描 + 阳性对照 ─────────
await t('断言 e: 全流程后, nonce 与明文交付物在【日志输出 + delivery_* 表 + events/chain_events】零命中; 阳性对照: 故意写入一行 ⇒ 扫描必须命中', async () => {
  seedStock('sku-e', ['E-SECRET-ACTIVATION-77']);
  const captured = []; const origLog = console.log, origWarn = console.warn;
  console.log = (...a) => { captured.push(a.join(' ')); }; console.warn = (...a) => { captured.push(a.join(' ')); };
  const o = newOrder({ sku: 'sku-e' }); const ch = mkChain(o.addr); const ctx = mkCtx(ch);
  try {
    const ft = fund(ch); for (let i = 0; i < 2; i++) await step(o.id, ctx); spend(ch, ft); for (let i = 0; i < 4; i++) await step(o.id, ctx);
  } finally { console.log = origLog; console.warn = origWarn; }
  assert.strictEqual(row(o.id).state, 'delivered');
  const dump = () => JSON.stringify([
    sqlite.prepare('SELECT * FROM delivery_orders').all(), sqlite.prepare('SELECT * FROM delivery_stock').all(),
    ...['events', 'chain_events'].map((tb) => { try { return sqlite.prepare(`SELECT * FROM ${tb}`).all(); } catch { return []; } }),
  ]).toLowerCase();
  const scan = (hay, nonce, plain) => {
    const h = hay.toLowerCase(); const hits = [];
    for (let i = 0; i + 12 <= nonce.length; i++) if (h.includes(nonce.slice(i, i + 12))) hits.push('nonce'); if (h.includes(plain.toLowerCase())) hits.push('plain'); return hits;
  };
  const hay = captured.join('\n') + '\n' + ctx.logs.join('\n') + '\n' + dump();
  assert.deepStrictEqual(scan(hay, o.orderNonceHex, 'E-SECRET-ACTIVATION-77'), [], '真实流程零命中');
  assert.ok(ctx.logs.length >= 3 && ctx.logs.every((l) => l.includes(o.id.slice(-8))), '日志只打订单末 8 位');
  // 阳性对照: 扫描器必须有力
  assert.ok(scan(hay + '\nDEBUG nonce=' + o.orderNonceHex, o.orderNonceHex, 'x').includes('nonce'), '对照臂(nonce)未命中 ⇒ 扫描器无效');
  assert.ok(scan(hay + '\nDEBUG code=E-SECRET-ACTIVATION-77', o.orderNonceHex, 'E-SECRET-ACTIVATION-77').includes('plain'), '对照臂(明文)未命中 ⇒ 扫描器无效');
  // 信箱密文本身是公开的: 表里存的是它(不是明文), 且它不含明文
  assert.ok(!row(o.id).mailbox_payload_hex.toLowerCase().includes(Buffer.from('E-SECRET').toString('hex')));
});
await t('静态: watcher/store 源码不 console.log nonce/明文, 不含 fetch/WebSocket(副作用全经 ctx), 只用 tag(订单末 8 位)记日志', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['./delivery-watcher.mjs', './delivery-store.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\bfetch\s*\(|WebSocket|XMLHttpRequest/.test(src), f);
    assert.ok(!/console\.(log|warn|error)\([^)]*(nonce|plaintext|payload_encrypted)/i.test(src), f);
  }
  const w = readFileSync(new URL('./delivery-watcher.mjs', import.meta.url), 'utf8');
  assert.ok(!/log\([^)]*(nonceHex|plaintext)/.test(w));
});
console.log(`\n${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0;
