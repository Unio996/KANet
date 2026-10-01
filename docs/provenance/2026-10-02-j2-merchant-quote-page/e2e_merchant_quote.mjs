// e2e_merchant_quote.mjs — 第三步验收: 真 Chromium 打开控制台"商家建报价"页(serve_merchant_quote.mjs 起的最小控制台,
// 真路由+真模板), 建两种报价(即时分账 / 服务订单托管) → 复制出的链接在真结账页(checkout-static, 另一个静态服务)打开 →
// 验签通过、金额与比例对。反例: 价格过低 / 比例超限 / KTT 币种不可选 / 缺必填。
// 用法: node e2e_merchant_quote.mjs   (先起: serve_merchant_quote.mjs @18801 + 结账页静态服务 @18777; simnet)
import { createRequire } from 'node:module';
const DIR = 'D:/kanet-tn12/scratch/_kanetui_broadcast_simnet';
const { chromium } = createRequire(`${DIR}/`)('playwright');
const kaspa = createRequire('D:/kanet-tn12/scratch/_j2_wt_ktt_mint/kasia-console/package.json')('kaspa-wasm');
const CONSOLE = process.env.CONSOLE || 'http://127.0.0.1:18801';
const CHECKOUT = process.env.CHECKOUT || 'http://127.0.0.1:18777/checkout.html';
const RPC_URL = 'ws://127.0.0.1:29935';
const newAddr = () => new kaspa.PrivateKey(Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')).toPublicKey().toAddress('simnet').toString();
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const errs = [];
async function openConsole() {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('response', async r => { if (r.status() >= 400 && r.url().includes('/api/')) console.log('HTTP', r.status(), r.url(), (await r.text()).slice(0, 300)); });
  await page.goto(`${CONSOLE}/merchant/quote`);
  await page.waitForFunction(() => document.querySelector('[x-data]') && document.getElementById('mq-submit'), null, { timeout: 15000 });
  await page.waitForTimeout(500); // defaults 拉取
  return page;
}

// ── 0. 页面基本面 ──
let page = await openConsole();
check('页面标题/表单渲染', (await page.textContent('body')).includes('商家建报价'));
check('支付币种: KAS 可选, KTT 置灰(预留)', await page.$eval('#mq-currency option[value="KTT"]', o => o.disabled) === true);

// ── 1. 即时分账: 生成钥匙 → 填表 → 提交 ──
await page.click('#mq-keygen');
await page.waitForFunction(() => document.getElementById('mq-key').value.length === 64, null, { timeout: 10000 });
const providerAddr = await page.inputValue('#mq-provider');
check('生成钥匙自动填入私钥与收款地址(simnet 前缀)', providerAddr.startsWith('kaspasim:'), providerAddr);
const partnerAddr = newAddr();
await page.fill('#mq-price', '10');
await page.click('#mq-add-partner');
await page.fill('input[placeholder="名称(备注)"]', '推荐人');
await page.fill('input[placeholder="地址"]', partnerAddr);
await page.fill('input[placeholder="%"]', '5');
await page.fill('#mq-channel-pct', '25');
await page.fill('#mq-channels', '3');
await page.fill('#mq-base', CHECKOUT);
await page.click('#mq-submit');
await page.waitForSelector('#mq-result', { state: 'visible', timeout: 20000 });
const resText = await page.textContent('#mq-result');
check('即时分账: 出结果且标明已签名', resText.includes('报价已签名'), resText.slice(0, 200));
check('即时分账: 角色表含 你(70.01% 保底)/推荐人 5%/渠道 25%', resText.includes('70.01%') && resText.includes('5%') && resText.includes('25%') && resText.includes('推荐人'), resText);
const link1 = await page.inputValue('#mq-link');
check('即时分账: 生成结账链接(带 q=)', link1.startsWith(CHECKOUT + '?q='), link1.slice(0, 80));
check('即时分账: 二维码 SVG 出现', (await page.innerHTML('#mq-qr')).includes('<svg'));
await page.click('#mq-copy');
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check('即时分账: 复制按钮把链接放进剪贴板', clip === link1, clip.slice(0, 60));

// 在真结账页打开
const co1 = await ctx.newPage();
const coErrs = [];
co1.on('console', m => { if (m.type() === 'error') coErrs.push(m.text()); });
co1.on('pageerror', e => coErrs.push('pageerror: ' + e.message));
await co1.goto(`${link1}&rpcUrl=${encodeURIComponent(RPC_URL)}`, { timeout: 60000 });
await co1.waitForFunction(() => { const t = document.getElementById('quoteInfo')?.innerText || ''; return t.includes('商家签名'); }, null, { timeout: 60000, polling: 200 });
const quoteTxt = await co1.textContent('#quoteInfo');
check('结账页: 商家签名验证通过', quoteTxt.includes('验证通过'), quoteTxt);
check('结账页: 价格 = 1000000000 sompi(10 KAS)', quoteTxt.includes('1000000000'), quoteTxt);
await co1.fill('#refundAddr', newAddr());
await co1.click('#resolveOrderBtn');
await co1.waitForFunction(() => { const t = document.getElementById('orderInfo')?.innerText || ''; return t.includes('收款地址') || t.includes('失败'); }, null, { timeout: 90000, polling: 300 });
const orderTxt = (await co1.textContent('#orderInfo')).replace(/\s+/g, ' ');
check('结账页: 订单地址推导成功', orderTxt.includes('收款地址'), orderTxt);
check('结账页: 应付总额 10 KAS', /应付总额\s*10(\.0+)? KAS/.test(orderTxt) || orderTxt.includes('10 KAS') || orderTxt.includes('10.00000000 KAS'), orderTxt);
check('结账页: provider 9.5 KAS(70.01%+未推广渠道 25% 折回)', orderTxt.includes('provider') && /9\.5/.test(orderTxt), orderTxt);
check('结账页: partner_1 0.5 KAS(5%)', orderTxt.includes('partner_1') && /0\.5/.test(orderTxt), orderTxt);
check('结账页零 console 错误', coErrs.length === 0, JSON.stringify(coErrs));
await co1.close();

// ── 2. 服务订单托管 ──
await page.selectOption('#mq-kind', 'service_escrow');
await page.fill('#mq-price', '2.5');
await page.fill('#mq-buyer-refund', newAddr());
await page.fill('#mq-buyer-pk', 'ab'.repeat(32));
await page.fill('#mq-deadline-hours', '2');
await page.click('#mq-submit');
await page.waitForFunction(() => (document.getElementById('mq-r-price')?.textContent || '').includes('2.5') || (document.getElementById('mq-error')?.textContent || '').trim(), null, { timeout: 30000 });
const err2 = (await page.textContent('#mq-error')).trim();
check('服务订单: 无报错', err2 === '', err2);
check('服务订单: 链接过长无二维码时给出提示(不报错)', (await page.isVisible('#mq-qr-note')) || (await page.innerHTML('#mq-qr')).includes('<svg'));
const res2 = await page.textContent('#mq-result');
check('服务订单: 结果标明服务订单托管 + 价格 2.5 KAS', res2.includes('服务订单托管') && res2.includes('2.5 KAS'), res2.slice(0, 160));
const link2 = await page.inputValue('#mq-link');
const co2 = await ctx.newPage();
const co2Errs = [];
co2.on('console', m => { if (m.type() === 'error') co2Errs.push(m.text()); });
co2.on('pageerror', e => co2Errs.push('pageerror: ' + e.message));
console.log('link2=', String(link2).slice(0,60), 'errs=', JSON.stringify(errs.slice(-3)));
await co2.goto(`${link2}&rpcUrl=${encodeURIComponent(RPC_URL)}`, { timeout: 60000 });
await co2.waitForFunction(() => { const t = document.getElementById('quoteInfo')?.innerText || ''; return t.includes('验证') ; }, null, { timeout: 60000, polling: 200 });
await co2.waitForTimeout(1500);
const q2 = (await co2.textContent('body')).replace(/\s+/g, ' ');
check('服务订单结账页: 报价签名验证通过', /验证通过|✓/.test(q2) && !/验证失败|✗ 报价签名验证失败/.test(q2), q2.slice(0, 300));
check('服务订单结账页: 展示托管地址', /kaspasim:p[a-z0-9]{50,}/.test(q2), q2.slice(0, 300));
check('服务订单结账页: 展示金额 2.53 KAS(2.5 + 0.03 max_split_fee)', q2.includes('2.53'), q2.slice(0, 400));
check('服务订单结账页零 console 错误', co2Errs.length === 0, JSON.stringify(co2Errs));
await co2.close();

// ── 3. 反例 ──
await page.selectOption('#mq-kind', 'instant_split');
await page.fill('#mq-price', '0.01'); await page.fill('#mq-channel-pct', '25'); await page.fill('#mq-channels', '5');
await page.click('#mq-submit');
await page.waitForFunction(() => document.getElementById('mq-error')?.textContent.trim(), null, { timeout: 15000 });
check('反例: 价格太低 → 友好报错(不出签名)', /价格太低/.test(await page.textContent('#mq-error')) && !(await page.isVisible('#mq-result')), await page.textContent('#mq-error'));
await page.fill('#mq-price', '10'); await page.fill('#mq-channel-pct', '60');
await page.click('#mq-submit');
await page.waitForFunction(() => /比例|占/.test(document.getElementById('mq-error')?.textContent || ''), null, { timeout: 15000 });
check('反例: 渠道占比过高 → 拒绝', /50%|比例/.test(await page.textContent('#mq-error')), await page.textContent('#mq-error'));
await page.fill('#mq-channel-pct', '0'); await page.fill('#mq-key', '');
await page.click('#mq-submit');
await page.waitForFunction(() => /私钥/.test(document.getElementById('mq-error')?.textContent || ''), null, { timeout: 15000 });
check('反例: 缺签名私钥 → 拒绝', /私钥/.test(await page.textContent('#mq-error')));
const rKtt = await page.evaluate(async () => { const r = await fetch('/api/merchant/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'instant_split', currency: 'KTT' }) }); return [r.status, (await r.json()).error]; });
check('反例: API 层 KTT 币种被拒(预留未开放)', rKtt[0] === 400 && /KTT/.test(rKtt[1]), JSON.stringify(rKtt));
const rNet = await page.evaluate(async () => { const r = await fetch('/api/merchant/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'instant_split', price_kas: '10', provider_address: 'kaspa:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', signing_key_hex: '0b'.repeat(32) }) }); return [r.status, (await r.json()).error]; });
check('反例: 地址网络前缀与控制台网络(simnet)不符 → 拒绝', rNet[0] === 400 && /地址/.test(rNet[1]), JSON.stringify(rNet));
check('控制台页零 console 错误', errs.filter(e => !/Failed to load resource/.test(e)).length === 0, JSON.stringify(errs));
await browser.close();
console.log(`\n=== 商家建报价页 E2E(真浏览器): ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
