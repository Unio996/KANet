// e2e-v2-full.mjs — v0.2.0-test 发布包(解压到全新目录, 不是开发树)真实验证: 扫码/到账监视/split/refund。
import { chromium } from 'playwright';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8995';
const SIMDIR = 'D:/kanet-tn12/scratch/_kanetui_v2_simnet';
const merchantPriv = fs.readFileSync(`${SIMDIR}/miner-priv.txt`, 'utf8').trim(); // 随便一把私钥当商家, 只要能签名即可
const providerPriv = fs.readFileSync(`${SIMDIR}/miner-priv.txt`, 'utf8').trim();

function mintQuoteB64(priceKas, deadlineOffsetMs, providerAddr) {
  return execFileSync('node', [`${SIMDIR}/mint-quote.mjs`, String(priceKas), String(deadlineOffsetMs), providerAddr, merchantPriv, '40000000', '10000000'], { encoding: 'utf8' }).trim();
}
function fundAddress(addr, kas, funderIndex) {
  execFileSync('node', [`${SIMDIR}/fund-from.mjs`, String(funderIndex), addr, String(kas)], { encoding: 'utf8', timeout: 600000 });
}
function newSimnetAddr(kaspa) {
  const priv = new kaspa.PrivateKey(Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join(''));
  return { priv, addr: priv.toPublicKey().toAddress('simnet').toString() };
}
async function waitFor(fn, timeoutMs, pollMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const r = await fn(); if (r) return r; await new Promise(r2 => setTimeout(r2, pollMs)); }
  throw new Error(`waitFor 超时(${label})`);
}

const results = [];
function record(name, ok, detail) { results.push({ name, ok }); console.log(`\n=== ${name}: ${ok ? 'PASS' : 'FAIL'} ===\n${detail}`); }

async function openOrder(browser, kaspa, quoteB64) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(`${BASE}/checkout.html?q=${encodeURIComponent(quoteB64)}&rpcUrl=${encodeURIComponent('ws://127.0.0.1:29940')}`, { timeout: 60000 });
  await page.waitForFunction(() => { const t = document.getElementById('resolverStatus')?.innerText || ''; return t.includes('sha256 核对通过') || t.includes('✗'); }, null, { timeout: 60000, polling: 200 });
  const { addr: refundAddr } = newSimnetAddr(kaspa);
  await page.fill('#refundAddr', refundAddr);
  await page.click('#resolveOrderBtn');
  await page.waitForFunction(() => { const t = document.getElementById('orderInfo')?.innerText || ''; return t.includes('收款地址') || t.includes('失败'); }, null, { timeout: 60000, polling: 200 });
  const orderText = await page.textContent('#orderInfo');
  if (!orderText.includes('收款地址')) throw new Error(`订单地址推导失败: ${orderText}`);
  const orderAddress = await page.evaluate(() => document.querySelector('#orderInfo code')?.textContent);
  return { page, orderAddress, refundAddr, consoleErrors, orderText };
}

const kaspa = await import('kaspa-wasm');
const providerPrivObj = new kaspa.PrivateKey(providerPriv);
const providerAddr = providerPrivObj.toPublicKey().toAddress('simnet').toString();

const browser = await chromium.launch();

// ── ① 扫码付款(独立 jsqr 解码校验) ──
try {
  const quoteB64 = mintQuoteB64(7.5, 259200000, providerAddr);
  const { page, orderText, consoleErrors } = await openOrder(browser, kaspa, quoteB64);
  const displayedUri = await page.evaluate(() => [...document.querySelectorAll('#orderInfo code')].map(c => c.textContent).find(t => t.includes('?amount=')));
  const svgHandle = await page.$('#orderInfo svg');
  const screenshotBuf = await svgHandle.screenshot();
  const png = PNG.sync.read(screenshotBuf);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  const ok = !!decoded && decoded.data === displayedUri && consoleErrors.length === 0;
  await page.close();
  record('① 扫码付款(独立 jsqr 解码)', ok, `displayedUri=${displayedUri}\ndecoded=${decoded?.data}\nconsoleErrors=${consoleErrors.length}`);
} catch (e) { record('① 扫码付款', false, e.message); }

// ── ② 到账监视 + split ──
try {
  const quoteB64 = mintQuoteB64(9, 259200000, providerAddr);
  const { page, orderAddress, consoleErrors } = await openOrder(browser, kaspa, quoteB64);
  fundAddress(orderAddress, 9.02, 0);
  await waitFor(async () => { const t = await page.textContent('#monitorInfo').catch(() => ''); return (t.includes('已到账') || t.includes('超额')) ? t : null; }, 60000, 3000, '到账监视');
  await waitFor(async () => !(await page.getAttribute('#triggerSplitBtn', 'disabled')), 90000, 3000, '深确认');
  await page.click('#triggerSplitBtn');
  const finalText = await waitFor(async () => { const t = await page.textContent('#monitorInfo').catch(() => ''); return (t.includes('订单已完成') || t.includes('失败')) ? t : null; }, 90000, 3000, 'split 广播完成');
  await page.close();
  const ok = finalText.includes('订单已完成') && consoleErrors.length === 0;
  record('② 到账监视 + split', ok, `finalText=${finalText.replace(/\s+/g, ' ').slice(0, 200)}\nconsoleErrors=${consoleErrors.length}`);
} catch (e) { record('② 到账监视 + split', false, e.message); }

// ── ③ refund ──
try {
  const quoteB64 = mintQuoteB64(4, 15000, providerAddr);
  const { page, orderAddress, refundAddr, consoleErrors } = await openOrder(browser, kaspa, quoteB64);
  fundAddress(orderAddress, 4.001, 1);
  await waitFor(async () => { const t = await page.textContent('#monitorInfo').catch(() => ''); return (t.includes('已到账') || t.includes('超额')) ? t : null; }, 60000, 3000, 'refund 到账');
  let clicked = false, lastErr = '';
  const deadline = Date.now() + 420000;
  while (!clicked && Date.now() < deadline) {
    try { await page.click('#triggerRefundBtn', { timeout: 8000 }); clicked = true; }
    catch (e) { lastErr = e.message; await new Promise(r => setTimeout(r, 3000)); }
  }
  if (!clicked) throw new Error(`点击触发退款反复失败: ${lastErr}`);
  const finalText = await waitFor(async () => { const t = await page.textContent('#monitorInfo').catch(() => ''); return (t.includes('订单已完成') || t.includes('失败')) ? t : null; }, 90000, 3000, 'refund 广播完成');
  await page.close();
  const { entries } = await (async () => {
    const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:29940', encoding: kaspa.Encoding.Borsh, networkId: 'simnet' });
    await rpc.connect({});
    const r = await rpc.getUtxosByAddresses([new kaspa.Address(refundAddr)]);
    await rpc.disconnect();
    return r;
  })();
  const refundBal = (entries || []).reduce((a, e) => a + Number(e.amount ?? e.entry?.amount ?? 0), 0) / 1e8;
  const ok = finalText.includes('订单已完成') && refundBal > 3.9 && consoleErrors.length === 0;
  record('③ refund', ok, `finalText=${finalText.replace(/\s+/g, ' ').slice(0, 200)}\nrefundAddrBalance=${refundBal} KAS\nconsoleErrors=${consoleErrors.length}`);
} catch (e) { record('③ refund', false, e.message); }

await browser.close();

console.log('\n\n========== SUMMARY ==========');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
const allPass = results.every(r => r.ok);
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
