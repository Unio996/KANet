// delivery-buyer.test.mjs — 账本1877 步3: 买家侧核心逻辑 + v0.3 §3 断言 b(买家页所有网络请求 URL/参数零 nonce)。注入 fetch/rpc, 零网络。
// Run: cd kasia-console && node src/lib/delivery-buyer.test.mjs   (自举: 临时 migration 库, 因 console 侧推导依赖 DB 客户端的 import 链)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._DLVB_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_dlvb_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _DLVB_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet'; process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import * as kaspa from 'kaspa-wasm';
const SDK = await import('./commission-plan-sdk.mjs');
const Inv = await import('./delivery-invoice.mjs');
const X = await import('./checkout-static/delivery-crypto.js');
const B = await import('./checkout-static/delivery-buyer.js');
const RB = await import('./checkout-static/resolve-order-browser.js');
const FS = await import('./fee-split.mjs');
const { makeKaspaApiReader } = await import('./delivery-read-kaspa-api.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + String(e?.stack || e?.message || e).split('\n').slice(0, 3).join(' | ')); } };

const SHA = createHash('sha256').update(fs.readFileSync(new URL('./sil-v1/CommissionSplit.sil', import.meta.url))).digest('hex');
const addrOf = (hex) => new kaspa.PrivateKey(hex).toPublicKey().toAddress('simnet').toString();
const PROVIDER = addrOf('31'.repeat(32)), BROKER = addrOf('32'.repeat(32)), MPRIV = '21'.repeat(32);
const quote = SDK.signQuote({
  schema_v: 1, quote_id: 'qb-1', network: 'simnet', merchant_pubkey_hex: new kaspa.PrivateKey(MPRIV).toPublicKey().toString(), price_sompi: '300000000',
  canonical_rules: { schema_v: 1, roles: [{ name: 'provider', bps: 7000, address: PROVIDER }, { name: 'broker', bps: 500, address: BROKER }, { name: 'channel_1', bps: 2500, fold_to: 'provider' }] },
  unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now() - 1000, valid_until_ms: Date.now() + 86400000, channel_whitelist: null, require_channel_deposit: false,
  min_deposit_sompi: '100000000', max_split_fee_sompi: '40000000', max_refund_fee_sompi: '10000000', deadline_offset_ms: 259200000,
}, MPRIV);
const NONCE = '5e' + 'a1'.repeat(15);
const DL = Date.now() + 3 * 86400000;
const d = await Inv.deriveInvoiceOrder({ quote, orderNonceHex: NONCE, deadlineMs: DL });
const BASE = 'https://example.github.io/checkout/delivery.html';
const link = X.buildInvoiceLink({ baseUrl: BASE, publicParams: { q: Inv.encodeQuoteParam(quote) }, orderNonceHex: NONCE, deadlineMs: DL });
const u0 = new URL(link);
const mkLocation = () => ({ hash: u0.hash, search: u0.search, pathname: u0.pathname, href: link });
const PLAINTEXT = 'https://example.test/dl/BUYER-ACTIVATION-42';
const payloadHex = await X.encryptDeliverable({ orderNonceHex: NONCE, orderAddress: d.orderAddress, plaintext: PLAINTEXT });
const FUND = '66'.repeat(32), SPLIT = '88'.repeat(32), MBTX = '99'.repeat(32);

// 假读后端: 记录所有请求 URL
const mkWorld = (o = {}) => {
  const urls = [];
  const apiTx = (x) => ({ transaction_id: x.txid, payload: x.payload || '', block_time: Date.now() - 1000, is_accepted: x.accepted ?? true, accepting_block_blue_score: x.accepted === false ? null : (o.blue ?? 10_000) - (x.depth ?? 25), inputs: (x.ins || []).map((i) => ({ previous_outpoint_hash: i.txid, previous_outpoint_index: String(i.index) })), outputs: (x.outs || []).map((p) => ({ index: p.index, amount: p.amount, script_public_key_address: p.address })) });
  const fetchImpl = async (url) => {
    urls.push(String(url)); const u = String(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('virtual-chain-blue-score')) return json({ blueScore: o.blue ?? 10_000 });
    if (u.includes(`/addresses/${d.refundAddress}/`)) return json([]);
    if (u.includes(`/addresses/${d.orderAddress}/`)) return json(o.orderTxs || []);
    if (u.includes(`/addresses/${o.mailbox}/`)) return json(o.mailboxTxs || []);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { urls, fetchImpl, apiTx };
};
const derivedMailbox = async () => { const { mailboxPrivHex } = await X.deriveMailboxKey({ orderNonceHex: NONCE, orderAddress: d.orderAddress }); return X.mailboxAddress(kaspa, mailboxPrivHex, 'simnet'); };
const MAILBOX = await derivedMailbox();
const start = async (world) => B.startBuyerFlow({ location: mkLocation(), history: { replaceState: (...a) => (world.replaced = (world.replaced || []).concat([a])) }, kaspa, RB, feeSplitLib: FS, sourceSha256Hex: SHA, makeReader: () => makeKaspaApiReader({ fetchImpl: world.fetchImpl }) });
const leaks = (s) => X.leaksNonce(s, NONCE);

await t('推导: 买家页算出的订单地址/退款地址/信箱地址 = 商家 console 算出的(逐字一致); 退款私钥与 nonce 派生一致', async () => {
  const w = mkWorld({ mailbox: MAILBOX }); const flow = await start(w);
  assert.strictEqual(flow.derived.orderAddress, d.orderAddress); assert.strictEqual(flow.derived.refundAddress, d.refundAddress); assert.strictEqual(flow.derived.mailboxAddress, MAILBOX);
  assert.strictEqual(flow.derived.totalSompi, BigInt(d.totalSompi)); assert.strictEqual(flow.derived.redeemScriptHex, d.protocol.redeemScriptHex);
  assert.strictEqual(flow.derived.refundPrivHex, (await X.deriveRefundKey({ orderNonceHex: NONCE, network: 'simnet' })).refundPrivHex);
});
await t('买家页推出的 redeem 不含交付秘密(只含派生的合约 nonce)', async () => {
  const flow = await start(mkWorld({ mailbox: MAILBOX }));
  assert.ok(!leaks(flow.derived.redeemScriptHex)); assert.ok(flow.derived.redeemScriptHex.includes(await X.deriveOrderNonce({ orderNonceHex: NONCE })));
});
await t('COMMISSION_ENTRIES 与 SDK 编译产物一致(dispatch tag 随合约签名, 不随 ctor)', () => { assert.deepStrictEqual(JSON.parse(JSON.stringify(B.COMMISSION_ENTRIES)), JSON.parse(JSON.stringify(d.protocol.entries))); });
await t('读片段后立刻 replaceState(只一次, 新 URL 不含片段/nonce); 返回给 UI 的 derived 里没有 nonce', async () => {
  const w = mkWorld({ mailbox: MAILBOX }); const loc = mkLocation(); const flow = await B.startBuyerFlow({ location: loc, history: { replaceState: (...a) => (w.replaced = (w.replaced || []).concat([a])) }, kaspa, RB, feeSplitLib: FS, sourceSha256Hex: SHA, makeReader: () => makeKaspaApiReader({ fetchImpl: w.fetchImpl }) });
  assert.strictEqual(w.replaced.length, 1); assert.ok(!String(w.replaced[0][2]).includes('#') && !leaks(JSON.stringify(w.replaced[0])));
  assert.ok(!leaks(JSON.stringify(flow.derived, (k, v) => (typeof v === 'bigint' ? v.toString() : v))), 'derived 不含 nonce');
});
await t('取货: 信箱里有给本订单的密文且深度≥20 ⇒ delivered(明文=库存); 深度 19 ⇒ pending_depth; 他人密文/垃圾忽略', async () => {
  const w0 = mkWorld({ mailbox: MAILBOX, blue: 10_000 }); const mk = (depth, txid = MBTX) => w0.apiTx({ txid, payload: payloadHex, depth, outs: [{ index: 0, amount: 20000000, address: MAILBOX }] });
  const other = w0.apiTx({ txid: 'ab'.repeat(32), payload: await X.encryptDeliverable({ orderNonceHex: '00'.repeat(16), orderAddress: d.orderAddress, plaintext: 'not mine' }), depth: 50, outs: [{ index: 0, amount: 1, address: MAILBOX }] });
  const junk = w0.apiTx({ txid: 'cd'.repeat(32), payload: '00ff', depth: 50, outs: [{ index: 0, amount: 1, address: MAILBOX }] });
  const flow = await start(mkWorld({ mailbox: MAILBOX, mailboxTxs: [junk, other, mk(25)] }));
  assert.deepStrictEqual(await flow.check(), { status: 'delivered', txid: MBTX, plaintext: PLAINTEXT });
  const flow19 = await start(mkWorld({ mailbox: MAILBOX, mailboxTxs: [mk(19)] })); assert.strictEqual((await flow19.check()).status, 'pending_depth');
  const flow0 = await start(mkWorld({ mailbox: MAILBOX, mailboxTxs: [junk, other] })); assert.strictEqual((await flow0.check()).status, 'none');
});
await t('粘贴密文: 商家导出的 hex 本地解开; 改一位 / 他单密文 / 空 ⇒ null(同一 AEAD 校验)', async () => {
  const flow = await start(mkWorld({ mailbox: MAILBOX }));
  assert.strictEqual(await flow.paste(payloadHex), PLAINTEXT); assert.strictEqual(await flow.paste('  ' + payloadHex.toUpperCase() + '\n'), PLAINTEXT);
  assert.strictEqual(await flow.paste(payloadHex.slice(0, -2) + (payloadHex.endsWith('00') ? '01' : '00')), null); assert.strictEqual(await flow.paste(''), null);
  const otherOrder = await X.encryptDeliverable({ orderNonceHex: NONCE, orderAddress: d.orderAddress + 'x', plaintext: 'z' }); assert.strictEqual(await flow.paste(otherOrder), null);
});
await t('订单资金状态: 未付 / 已付未花 / 已被花费(split 或退款)', async () => {
  const w1 = mkWorld({ mailbox: MAILBOX }); const ordOut = { index: 0, amount: 300000000, address: d.orderAddress };
  assert.deepStrictEqual(await (await start(w1)).funds(), { funded: false, spent: false });
  const fundTx = w1.apiTx({ txid: FUND, outs: [ordOut] }); const splitTx = w1.apiTx({ txid: SPLIT, ins: [{ txid: FUND, index: 0 }], outs: [{ index: 0, amount: 1, address: PROVIDER }] });
  assert.deepStrictEqual(await (await start(mkWorld({ orderTxs: [fundTx] }))).funds(), { funded: true, spent: false, fundingTxid: FUND, spenderTxid: undefined });
  assert.deepStrictEqual(await (await start(mkWorld({ orderTxs: [splitTx, fundTx] }))).funds(), { funded: true, spent: true, fundingTxid: FUND, spenderTxid: SPLIT });
});
await t('断言 b: 全流程(推导/取货/查资金/粘贴/退款/清扫)中, 所有读后端 URL 与 rpc 调用参数都不含 nonce 的任何 8 位窗口; 只出现地址', async () => {
  const w = mkWorld({ mailbox: MAILBOX, mailboxTxs: [] });
  const rpcCalls = []; const rpc = {
    getUtxosByAddresses: async (a) => { rpcCalls.push(JSON.stringify(a)); return { entries: [] }; },
    getBlockDagInfo: async () => { rpcCalls.push('dag'); return { pastMedianTime: DL + 60_000 }; }, submitTransaction: async (x) => { rpcCalls.push('submit'); return { transactionId: 'aa'.repeat(32) }; },
  };
  const flow = await start(w);
  await flow.check(); await flow.funds(); await flow.paste(payloadHex);
  await assert.rejects(flow.refund(rpc), /UTXO/);                                  // 订单地址上没资金 ⇒ 抛, 但请求参数已发出
  const sw = await flow.sweepMailbox(rpc, addrOf('77'.repeat(32))); assert.strictEqual(sw.status, 'nothing');
  const sw2 = await flow.sweepRefund(rpc, addrOf('77'.repeat(32))); assert.strictEqual(sw2.status, 'nothing');
  const all = w.urls.join('\n') + '\n' + rpcCalls.join('\n');
  assert.ok(w.urls.length >= 4 && rpcCalls.length >= 3);
  assert.ok(!leaks(all), '请求里出现了 nonce 子串');
  assert.ok(w.urls.every((x) => /^https?:\/\//.test(x) && (x.includes('/addresses/') || x.includes('/info/'))), '只请求地址历史与链高度');
  // 阳性对照: 扫描方法必须抓得到
  assert.ok(leaks(all + `\nGET /pickup?n=${NONCE}`), '对照臂未命中 ⇒ 扫描器无效');
});
await t('到期退款: 构造零签名 refund(输出=nonce 派生的退款 P2PK, lockTime=deadline, sigScript 以订单 redeem 结尾); 未到期(PMT<deadline)抛; 订单地址 UTXO 数≠1 抛', async () => {
  const flow = await start(mkWorld({ mailbox: MAILBOX })); const subs = [];
  const utxo = { outpoint: { transactionId: FUND, index: 0 }, amount: '300000000' };
  const mkRpc = (pmt, entries = [utxo]) => ({ getUtxosByAddresses: async () => ({ entries }), getBlockDagInfo: async () => ({ pastMedianTime: pmt }), submitTransaction: async ({ transaction }) => { subs.push(transaction); return { transactionId: String(transaction.id) }; } });
  await assert.rejects(flow.refund(mkRpc(DL - 1)), /还没到期/); await assert.rejects(flow.refund(mkRpc(DL + 60_000, [])), /UTXO/); await assert.rejects(flow.refund(mkRpc(DL + 60_000, [utxo, utxo])), /UTXO/);
  const r = await flow.refund(mkRpc(DL + 60_000)); assert.match(r.txId, /^[0-9a-f]{64}$/); assert.strictEqual(subs.length, 1);
  const tx = subs[0]; assert.strictEqual(tx.outputs.length, 1); assert.strictEqual(BigInt(tx.lockTime), BigInt(DL)); assert.ok(String(tx.inputs[0].signatureScript).endsWith(d.protocol.redeemScriptHex));
  const refundSpk = kaspa.payToAddressScript(new kaspa.Address(d.refundAddress)); assert.strictEqual(String(tx.outputs[0].scriptPublicKey.script), String(refundSpk.script));
  assert.ok(BigInt(tx.outputs[0].value) < 300000000n && BigInt(tx.outputs[0].value) >= 300000000n - 10000000n);
});
await t('入口错误: 无 #n / 无 ?q / 报价被改 / 无 deadline / 网络 ⇒ 抛明确错误且不发请求', async () => {
  const w = mkWorld({ mailbox: MAILBOX }); const go = (loc) => B.startBuyerFlow({ location: loc, history: { replaceState() {} }, kaspa, RB, feeSplitLib: FS, sourceSha256Hex: SHA, makeReader: () => makeKaspaApiReader({ fetchImpl: w.fetchImpl }) });
  await assert.rejects(go({ ...mkLocation(), hash: '' }), /订单凭据/);
  await assert.rejects(go({ ...mkLocation(), search: '' }), /报价参数/);
  const bad = { ...quote, price_sompi: '1' }; await assert.rejects(go({ ...mkLocation(), search: '?q=' + encodeURIComponent(Inv.encodeQuoteParam(bad)) }), /验签/);
  await assert.rejects(go({ ...mkLocation(), hash: '#n=' + NONCE }), /截止时间/);
  assert.strictEqual(w.urls.length, 0);
});
await t('凭据文件(含秘密)不可能被现有"凭据救援退款"流程当订单凭据吞进去: kind 不同 ⇒ order-receipt.parseOrderReceipt 拒; 且结账页源码对 receipt 无任何网络发送', async () => {
  const { parseOrderReceipt } = await import('./checkout-static/order-receipt.js');
  const flow = await start(mkWorld({ mailbox: MAILBOX }));
  assert.throws(() => parseOrderReceipt(flow.credentialJson()), /凭据类型不符/);
  const cj = JSON.parse(flow.credentialJson()); assert.strictEqual(cj.kind, 'kanet-delivery-credential'); assert.strictEqual(cj.n, NONCE);
  const co = fs.readFileSync(new URL('./checkout-static/checkout.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  const recLines = co.split('\n').filter((l) => /receipt|Receipt/.test(l));
  assert.ok(recLines.length > 0 && !recLines.some((l) => /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.send/.test(l)), '结账页的凭据处理行里不应有任何网络发送');
  const pg = fs.readFileSync(new URL('./checkout-static/delivery-page.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/credentialJson\(\)[^;]*(fetch|post|send)/i.test(pg), '买家页只把凭据交给 Blob 下载, 不发送');
});
await t('静态: 买家核心 / 加密 模块无 fetch/XMLHttpRequest/WebSocket/console(副作用全注入); nonce 不与 URL 构造同表达式(lint R-DELIVERY-NONCE-IN-QUERY 同口径)', () => {
  for (const f of ['./checkout-static/delivery-buyer.js', './checkout-static/delivery-crypto.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|console\./.test(src), f);
  }
});
console.log(`\n${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0;
