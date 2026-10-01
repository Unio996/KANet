// e2e_receipt.mjs — 验收②: 真 Playwright Chromium + 真 simnet: 出单→下载凭据→关页→新页导入→同一地址→
// 到期退款真广播真入账; 反例: 篡改 nonce / deadline / 地址 / 退款地址 / 缺字段 / 错链接 / 错网络 / 错类型 的
// 凭据被拒且不放出按钮。基础设施复用 KANet-UI scratch/_kanetui_broadcast_simnet(simnet 节点 29935、
// funders、mint-quote.mjs)。静态服务器见同目录 static_server.mjs(指向本 worktree)。
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const DIR = 'D:/kanet-tn12/scratch/_kanetui_broadcast_simnet';
const { chromium } = createRequire(`${DIR}/`)('playwright');
const kaspa = createRequire('D:/kanet-tn12/kasia-console/')('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address } = kaspa;
const BASE = process.env.BASE || 'http://127.0.0.1:18777';
const RPC_URL = 'ws://127.0.0.1:29935';
const OUT = process.env.OUT || 'D:/kanet-tn12/scratch/_j2_receipt_e2e/out';
fs.mkdirSync(OUT, { recursive: true });
const merchantPriv = fs.readFileSync(`${DIR}/merchant-priv.txt`, 'utf8').trim();
const providerAddr = fs.readFileSync(`${DIR}/provider-addr.txt`, 'utf8').trim();
const FUNDER = Number(process.env.FUNDER || 3);

const mintQuoteB64 = (kas, off) => execFileSync('node', [`${DIR}/mint-quote.mjs`, String(kas), String(off), providerAddr, merchantPriv, '40000000', '10000000'], { encoding: 'utf8' }).trim();
const fundAddress = (addr, kas, idx) => execFileSync('node', [`${DIR}/fund-from.mjs`, String(idx), addr, String(kas)], { encoding: 'utf8', timeout: 600000 });
const newAddr = () => new PrivateKey(Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')).toPublicKey().toAddress('simnet').toString();
let rpc;
async function balanceKas(addr) {
  if (!rpc) { rpc = new RpcClient({ url: RPC_URL, encoding: Encoding.Borsh, networkId: 'simnet' }); await rpc.connect({}); }
  const { entries } = await rpc.getUtxosByAddresses([new Address(addr)]);
  return Number((entries || []).reduce((a, e) => a + BigInt(e.amount ?? e.entry?.amount ?? 0), 0n)) / 1e8;
}
async function waitFor(fn, ms, poll = 2000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = await fn(); if (r) return r; await new Promise(r2 => setTimeout(r2, poll)); }
  throw new Error(`waitFor 超时(${label})`);
}
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };

async function openPage(browser, url) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(url, { timeout: 60000 });
  await page.waitForFunction(() => { const t = document.getElementById('resolverStatus')?.innerText || ''; return t.includes('sha256 核对通过') || t.includes('✗'); }, null, { timeout: 60000, polling: 200 });
  return { ctx, page, errs };
}
async function importReceipt(page, file) {
  await page.setInputFiles('#receiptFile', file);
  await page.click('#importReceiptBtn');
  await page.waitForFunction(() => { const t = document.getElementById('orderInfo')?.innerText || ''; return t.includes('收款地址') || t.includes('✗'); }, null, { timeout: 60000, polling: 200 });
  return page.textContent('#orderInfo');
}

const browser = await chromium.launch();
const quoteB64 = mintQuoteB64(5, 15000); // deadline = 出单时刻+15s
const link = `${BASE}/checkout.html?q=${encodeURIComponent(quoteB64)}&rpcUrl=${encodeURIComponent(RPC_URL)}`;
const refundAddr = newAddr();

// ── 1. 出单 + 下载凭据 ──
const A = await openPage(browser, link);
await A.page.fill('#refundAddr', refundAddr);
await A.page.click('#resolveOrderBtn');
await A.page.waitForFunction(() => (document.getElementById('orderInfo')?.innerText || '').includes('收款地址'), null, { timeout: 60000, polling: 200 });
const orderAddress = await A.page.evaluate(() => document.querySelector('#orderInfo table code')?.textContent);
const panelText = await A.page.textContent('#receiptPanel');
check('出单后醒目展示"不保存就无法退款"提示', panelText.includes('不保存就无法退款'), panelText);
const shownNonce = await A.page.textContent('#receiptNonce');
const shownDeadline = await A.page.textContent('#receiptDeadline');
check('出单后展示 nonce(32 hex)', /^[0-9a-f]{32}$/.test(shownNonce), shownNonce);
check('出单后展示截止时间(ISO)', /^\d{4}-\d\d-\d\dT/.test(shownDeadline), shownDeadline);
const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('#downloadReceiptBtn')]);
const receiptFile = `${OUT}/receipt-good.json`;
await dl.saveAs(receiptFile);
const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
check('凭据 JSON: nonce 与页面展示一致', receipt.order_nonce_hex === shownNonce);
check('凭据 JSON: 地址与页面订单地址一致', receipt.order_address === orderAddress);
check('凭据 JSON: 含报价原文链接(q=)、退款地址、截止时间', receipt.link.includes('q=') && receipt.refund_address === refundAddr && Number.isSafeInteger(receipt.deadline_ms));
check('出单页零 console 错误', A.errs.length === 0, JSON.stringify(A.errs));
fundAddress(orderAddress, 5.001, FUNDER);
await waitFor(async () => { const t = await A.page.textContent('#monitorInfo').catch(() => ''); return (t.includes('已到账') || t.includes('超额')) ? t : null; }, 60000, 3000, '到账');
await A.ctx.close(); // 关页——此后只剩下载的凭据文件
console.log(`orderAddress=${orderAddress} nonce=${receipt.order_nonce_hex} deadline=${receipt.deadline_iso}`);

// ── 2. 反例(新页, 全部必须拒绝且不放出按钮) ──
async function rejected(name, mutate, expectRe) {
  const f = `${OUT}/receipt-bad-${name}.json`;
  const r = JSON.parse(JSON.stringify(receipt)); mutate(r);
  fs.writeFileSync(f, JSON.stringify(r));
  const { ctx, page } = await openPage(browser, link);
  const t = await importReceipt(page, f);
  const btn = await page.$('#triggerRefundBtn');
  const mon = (await page.textContent('#monitorInfo')).trim();
  check(`反例[${name}]: 被拒绝`, t.includes('✗') && expectRe.test(t), t);
  check(`反例[${name}]: 不出现订单/退款按钮/监控`, !t.includes('收款地址') && !btn && mon === '', mon);
  await ctx.close();
}
await rejected('nonce', r => { r.order_nonce_hex = '00'.repeat(16); }, /不一致/);
await rejected('deadline', r => { r.deadline_ms += 1; }, /不一致/);
await rejected('address', r => { r.order_address = r.refund_address; }, /不一致/);
await rejected('refund-addr', r => { r.refund_address = newAddr(); }, /不一致/);
await rejected('missing-nonce', r => { delete r.order_nonce_hex; }, /order_nonce_hex/);
await rejected('missing-deadline', r => { delete r.deadline_ms; }, /deadline_ms/);
await rejected('wrong-link', r => { r.link = r.link.replace(/q=[^&]*/, 'q=AAAA'); }, /不是同一份/);
await rejected('wrong-network', r => { r.network = 'testnet'; }, /网络/);
await rejected('bad-kind', r => { r.kind = 'x'; }, /类型/);

// ── 3. 新页导入好凭据 → 同一地址 → 到期退款 ──
const B = await openPage(browser, link);
const tB = await importReceipt(B.page, receiptFile);
const addrB = await B.page.evaluate(() => document.querySelector('#orderInfo table code')?.textContent);
check('新页导入: 重建出同一订单地址', addrB === orderAddress, `${addrB} vs ${orderAddress}`);
check('新页导入: 显示"地址与凭据逐字一致"', tB.includes('逐字一致'), tB);
await waitFor(async () => { const t = await B.page.textContent('#monitorInfo').catch(() => ''); return (t.includes('已到账') || t.includes('超额')) ? t : null; }, 60000, 3000, '新页识别到账');
check('新页导入: 到期退款按钮出现(监控已启动)', !!(await B.page.$('#triggerRefundBtn')));
let clicked = false, lastErr = '';
const clickDeadline = Date.now() + 600000;
while (!clicked && Date.now() < clickDeadline) {
  try { await B.page.click('#triggerRefundBtn', { timeout: 8000 }); clicked = true; } catch (e) { lastErr = e.message; await new Promise(r => setTimeout(r, 3000)); }
}
check('到期后退款按钮变可点并点击', clicked, lastErr);
const doneText = await waitFor(async () => { const t = await B.page.textContent('#monitorInfo').catch(() => ''); return (t.includes('订单已完成') || t.includes('失败')) ? t : null; }, 120000, 3000, '退款广播完成');
check('页面显示订单已完成(链上核实)', doneText.includes('订单已完成'), doneText);
const refundBal = await waitFor(async () => { const b = await balanceKas(refundAddr); return b > 0 ? b : null; }, 30000, 2000, '退款到账');
check('退款地址真实收到 ≈4.99 KAS', refundBal > 4.9, `${refundBal}`);
check('新页零 console 错误', B.errs.length === 0, JSON.stringify(B.errs));
await B.ctx.close(); await browser.close(); if (rpc) await rpc.disconnect().catch(() => {});
console.log(`\n=== 订单凭据 E2E(真浏览器+真 simnet): ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
