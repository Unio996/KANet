// browser_e2e.mjs — 账本1877 步3: 买家页(delivery.html)在【真实 Chromium】里的端到端 + v0.3 §3 断言 b(浏览器真实发出的每一个请求都不含 nonce)。
//   网络全部拦截: api.kaspa.org 由本脚本伪造(返回给"信箱地址"的一笔真密文交易), 其它外网一律 abort; 不连任何真实节点/公共服务。
//   需要: playwright(仓库 node_modules)、Chrome、浏览器版 kaspa-wasm 产物(vendor/kaspa-web 被 gitignore, 从 KANet-UI 的发布包临时目录拷到本测试的临时站点, 不入库)。
// 用法: node browser_e2e.mjs <out.json>      (在 kasia-console 目录下用其 node_modules 解析 kaspa-wasm/playwright)
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, cpSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = resolve(HERE, '../../..');
const require = createRequire(join(ROOT, 'kasia-console/'));
const kaspa = require('kaspa-wasm'); const { chromium } = require('playwright');
const OUT = process.argv[2] || 'browser_e2e_result.json';
const imp = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const SDK = await imp('kasia-console/src/lib/commission-plan-sdk.mjs'); const Inv = await imp('kasia-console/src/lib/delivery-invoice.mjs'); const X = await imp('kasia-console/src/lib/checkout-static/delivery-crypto.js');
const R = { checks: [] }; const check = (n, c, extra = '') => { R.checks.push({ name: n, pass: !!c, extra: c ? undefined : String(extra).slice(0, 300) }); console.log(c ? 'PASS' : 'FAIL', n, c ? '' : String(extra).slice(0, 200)); };

// ── 临时站点 = checkout-static 源 + 浏览器版 kaspa-wasm ──
const WASM_SRC = process.env.KASPA_WEB_VENDOR || 'D:/kanet-tn12/kasia-console/scratch/_kanetui_checkout_v024_pkg_20261007/x/checkout-static/vendor/kaspa-web';
if (!existsSync(join(WASM_SRC, 'kaspa_bg.wasm'))) { console.error('缺少浏览器版 kaspa-wasm 产物: ' + WASM_SRC); process.exit(2); }
const site = mkdtempSync(join(tmpdir(), 'j2_delivery_site_'));
cpSync(resolve(ROOT, 'kasia-console/src/lib/checkout-static'), site, { recursive: true, filter: (s) => !/\.test\.mjs$/.test(s) });
cpSync(WASM_SRC, join(site, 'vendor/kaspa-web'), { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.sil': 'text/plain', '.json': 'application/json' };
const srv = createServer((req, res) => { const p = join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname)); try { const b = readFileSync(p); res.setHeader('content-type', types[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream'); res.end(b); } catch { res.statusCode = 404; res.end(); } });
await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}`;

// ── 主网形态的发票(只本地计算, 不触链): 报价/订单/信箱地址全是 kaspa: 前缀, 读后端 = api.kaspa.org(被拦截伪造) ──
const addrOf = (h) => new kaspa.PrivateKey(h).toPublicKey().toAddress('mainnet').toString();
const MPRIV = '21'.repeat(32);
const quote = SDK.signQuote({ schema_v: 1, quote_id: 'qbrowser-1', network: 'mainnet', merchant_pubkey_hex: new kaspa.PrivateKey(MPRIV).toPublicKey().toString(), price_sompi: '300000000',
  canonical_rules: { schema_v: 1, roles: [{ name: 'provider', bps: 7000, address: addrOf('31'.repeat(32)) }, { name: 'broker', bps: 500, address: addrOf('32'.repeat(32)) }, { name: 'channel_1', bps: 2500, fold_to: 'provider' }] },
  unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now() - 1000, valid_until_ms: Date.now() + 86400000, channel_whitelist: null, require_channel_deposit: false,
  min_deposit_sompi: '100000000', max_split_fee_sompi: '40000000', max_refund_fee_sompi: '10000000', deadline_offset_ms: 259200000 }, MPRIV);
const SECRET = '7f' + 'c3'.repeat(15); const DL = Date.now() + 3 * 86400000;
const d = await Inv.deriveInvoiceOrder({ quote, orderNonceHex: SECRET, deadlineMs: DL });
const link = X.buildInvoiceLink({ baseUrl: `${BASE}/delivery.html`, publicParams: { q: Inv.encodeQuoteParam(quote) }, orderNonceHex: SECRET, deadlineMs: DL });
const PLAINTEXT = 'https://example.test/dl/BROWSER-E2E-ACTIVATION-' + Date.now();
const payloadHex = await X.encryptDeliverable({ orderNonceHex: SECRET, orderAddress: d.orderAddress, plaintext: PLAINTEXT });
const { mailboxPrivHex } = await X.deriveMailboxKey({ orderNonceHex: SECRET, orderAddress: d.orderAddress }); const MAILBOX = X.mailboxAddress(kaspa, mailboxPrivHex, 'mainnet');

const apiTx = (txid, payload, depth, address) => ({ transaction_id: txid, payload, block_time: Date.now() - 1000, is_accepted: true, accepting_block_blue_score: 1_000_000 - depth, inputs: [{ previous_outpoint_hash: '44'.repeat(32), previous_outpoint_index: '0' }], outputs: [{ index: 0, amount: 20000000, script_public_key_address: address }] });
const browser = await chromium.launch({ channel: 'chrome' });
const run = async (name, { mailboxTxs }, actions) => {
  const reqs = []; const ctx = await browser.newContext(); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await ctx.route('**/*', async (route) => {
    const req = route.request(); const url = req.url(); reqs.push({ url, referer: req.headers()['referer'] || '', method: req.method(), post: req.postData() || '' });
    if (url.startsWith(BASE)) return route.continue();
    if (url.startsWith('https://api.kaspa.org/')) {
      const j = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
      if (url.includes('virtual-chain-blue-score')) return j({ blueScore: 1_000_000 });
      if (url.includes(`/addresses/${MAILBOX}/`)) return j(mailboxTxs); if (url.includes('/addresses/')) return j([]);
    }
    return route.abort();   // 其它外网一律拒绝
  });
  await page.goto(link);
  await actions(page);
  const hashAfter = await page.evaluate(() => location.hash); const urlAfter = page.url(); const bodyText = await page.evaluate(() => document.body.innerText);
  await ctx.close();
  return { reqs, errs, hashAfter, urlAfter, bodyText };
};

// 场景 1: 信箱里有给本订单的密文(深度 25)⇒ 页面自动取货
const s1 = await run('deliver', { mailboxTxs: [apiTx('99'.repeat(32), payloadHex, 25, MAILBOX), apiTx('98'.repeat(32), '00ff', 25, MAILBOX)] }, async (page) => { await page.waitForSelector('#deliveryBox:not([hidden]) code', { timeout: 120000 }); });
check('页面自动取到交付物(读链 + 本地解密)', s1.bodyText.includes(PLAINTEXT), s1.bodyText.slice(0, 200));
check('页面显示的订单地址 = 商家 console 推出的订单地址', s1.bodyText.includes(d.orderAddress));
check('读片段后地址栏片段已被抹掉(location.hash 为空, URL 不含 nonce)', s1.hashAfter === '' && !X.leaksNonce(s1.urlAfter, SECRET), s1.urlAfter);
check('页面文本里没有秘密', !X.leaksNonce(s1.bodyText, SECRET));
const allReq = s1.reqs.map((r) => `${r.method} ${r.url} ${r.post} ${r.referer}`).join('\n');
check('断言 b(真实浏览器): 页面发出的每个请求(含 Referer/POST 体)都不含秘密的任何 8 位窗口', !X.leaksNonce(allReq, SECRET), allReq.slice(0, 300));
const ext = s1.reqs.filter((r) => !r.url.startsWith(BASE)).map((r) => new URL(r.url).host);
check('外网请求只有读后端 api.kaspa.org', ext.length > 0 && ext.every((h) => h === 'api.kaspa.org'), JSON.stringify([...new Set(ext)]));
check('读后端请求只含地址/链高度路径', s1.reqs.filter((r) => r.url.startsWith('https://api.kaspa.org/')).every((r) => /\/addresses\/kaspa:[a-z0-9]+\/full-transactions\?|\/info\/virtual-chain-blue-score$/.test(r.url)), JSON.stringify(s1.reqs.filter((r) => r.url.includes('api.kaspa.org')).map((r) => r.url).slice(0, 3)));
check('页面无 JS 报错', s1.errs.length === 0, s1.errs.join(' | '));

// 场景 2: 信箱读不到(读后端无交易) ⇒ 粘贴商家导出的密文 hex 本地解密; 错的密文被拒
let failText = '';
const s2 = await run('paste', { mailboxTxs: [] }, async (page) => {
  await page.waitForSelector('#pasteBox:not([hidden]) textarea', { timeout: 120000 });
  await page.fill('#pasteBox textarea', payloadHex.slice(0, -2) + (payloadHex.endsWith('00') ? '01' : '00')); await page.click('#pasteBox button'); await page.waitForSelector('#pasteBox .bad'); failText = await page.textContent('#pasteBox .bad');
  await page.fill('#pasteBox textarea', payloadHex); await page.click('#pasteBox button'); await page.waitForSelector('#deliveryBox:not([hidden]) code', { timeout: 20000 });
});
check('粘贴路径: 改过的密文被拒、正确密文解出交付物', s2.bodyText.includes(PLAINTEXT) && failText.includes('无法解密'), failText);
check('粘贴场景同样零秘密外泄(所有请求)', !X.leaksNonce(s2.reqs.map((r) => `${r.url} ${r.post} ${r.referer}`).join('\n'), SECRET));

// 场景 3: 没有片段的链接 ⇒ 明确提示, 且不发任何读后端请求
{ const ctx = await browser.newContext(); const page = await ctx.newPage(); const reqs = []; await ctx.route('**/*', (r) => { reqs.push(r.request().url()); return r.request().url().startsWith(BASE) ? r.continue() : r.abort(); });
  await page.goto(link.split('#')[0]); await page.waitForFunction(() => /订单凭据/.test(document.getElementById('statusBox').innerText), null, { timeout: 120000 });
  check('缺少 #n 的链接: 提示订单凭据缺失且不发任何外网请求', reqs.every((u) => u.startsWith(BASE))); await ctx.close(); }

await browser.close(); srv.close(); rmSync(site, { recursive: true, force: true });
R.verdict = R.checks.every((c) => c.pass) ? 'PASS' : 'FAIL'; writeFileSync(OUT, JSON.stringify(R, null, 1)); console.log('VERDICT', R.verdict); process.exit(R.verdict === 'PASS' ? 0 : 1);
