// 真实浏览器(Playwright/Chromium)端到端测试: 建报价(config.html)→ 归因链接 → 结账页(checkout.html)
// → 浏览器原生验证(签名/签名链)→ 订单地址核验(经 resolver.mjs, silverc 原生编译)。
// D-034 §8 后续票③"任何人把这个文件夹放到任意静态托管即可用"的真实一次实测。
import { chromium } from 'file:///D:/kanet-tn12/kasia-console/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');

const BASE = 'http://127.0.0.1:8899';
const priv = new kaspa.PrivateKey('07'.repeat(32));
const providerAddr = priv.toPublicKey().toAddress('simnet').toString();

let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } }

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

// ── Step 1: config.html — 建报价 + 签名 ──
await page.goto(`${BASE}/config.html`);
await page.fill('#providerAddr', providerAddr);
await page.fill('#merchantPriv', priv.toString());
// 🔴 真实发现(E2E 第一轮实测坐实): config.html 表单默认值(10 KAS/10%渠道预算/5层, 且无 broker
// 角色)算出的每渠道份额远低于运营下限, 会被 validateQuoteMassFeasibility 正确拒签(MUST-1/MUST-2
// 安全闸真的在起作用, 不是摆设)——这不是 bug, 是这条门槛按设计生效; 但意味着 E2E 测试要用一个
// 真实 mass-feasible 的配置, 不能沿用表单默认值。价格调高到 200 KAS, 使 5 层×10%的单渠道份额
// (200×0.1/5=4 KAS/渠道)明显高于 N1 分档表门槛(约 0.158 KAS/渠道, 含 broker 场景), 真实可行。
await page.fill('#priceKas', '200');
await page.fill('#channelBps', '10');
await page.fill('#maxChannels', '5');
await page.click('#genBtn');
await page.waitForFunction(() => document.getElementById('result').innerText.includes('已签名') || document.getElementById('result').innerText.includes('✗'), { timeout: 15000 });
const resultText = await page.textContent('#result');
check('config.html: quote signed successfully', resultText.includes('已签名'), resultText);

const linkHref = await page.evaluate(() => {
  const codes = [...document.getElementById('result').querySelectorAll('code')];
  return codes.find(c => c.textContent.startsWith('http'))?.textContent || '';
});
check('config.html: produced a checkout link', linkHref.startsWith(`${BASE}/checkout.html?q=`), linkHref.slice(0, 100));

// ── Step 2: checkout.html — 浏览器原生验证 + 附加渠道 + 订单地址推导(D-034 §8 后续票①第二轮:
// 全部不再经过 resolver.mjs, 监听网络请求证明零调用) ──
const resolverCalls = [];
page.on('request', (req) => { if (req.url().includes('127.0.0.1:8787')) resolverCalls.push(req.url()); });

const ch1Priv = new kaspa.PrivateKey('08'.repeat(32));
const ch1Addr = ch1Priv.toPublicKey().toAddress('simnet').toString();
const checkoutUrl = linkHref + '&ch=' + encodeURIComponent(ch1Addr);
await page.goto(checkoutUrl);
try {
  // 🔴 真实发现(本轮 E2E 加入 silverc-wasm 后才显形, 不是猜测): #resolveOrderBtn 是 checkout.html 里
  // 的静态 HTML 元素, waitForSelector 对它成立跟 checkout.js 这个 module 有没有跑完毫无关系——module
  // 顶层要 await 两个 wasm 的异步 fetch+instantiate(kaspa-web 11.4MB + silverc-wasm 5.3MB)才会跑到
  // addEventListener 那一行。之前(a)方案(order-template.js 固定偏移覆写)没有第二个大 wasm, 走得够快,
  // 这个时序 bug 一直没有窗口暴露；加了 silverc-wasm 后 await 时间变长, 原来"按钮存在就点"的测试时序
  // 假设不再成立——点击发生在监听器挂上之前, 静默无效, 不是产品 bug。改成等 chainInfo(main() 里紧挨着
  // addEventListener 之前的最后一次 renderBox)出现非空内容, 才代表监听器已经挂上。
  await page.waitForFunction(() => {
    const el = document.getElementById('chainInfo');
    return el && el.innerText.trim().length > 0;
  }, { timeout: 20000 });
  const payerPriv = new kaspa.PrivateKey('09'.repeat(32));
  const payerAddr = payerPriv.toPublicKey().toAddress('simnet').toString();
  await page.fill('#refundAddr', payerAddr);
  await page.click('#resolveOrderBtn');
  await page.waitForFunction(() => {
    const el = document.getElementById('orderInfo');
    return el && el.innerText.length > 0;
  }, { timeout: 20000 });
} catch (e) {
  console.log('TIMEOUT — dumping current page state for diagnosis:');
  console.log('resolverStatus:', await page.textContent('#resolverStatus').catch(() => '(err)'));
  console.log('linkInfo:', await page.textContent('#linkInfo').catch(() => '(err)'));
  console.log('quoteInfo:', await page.textContent('#quoteInfo').catch(() => '(err)'));
  console.log('chainInfo:', await page.textContent('#chainInfo').catch(() => '(err)'));
  console.log('orderInfo:', await page.textContent('#orderInfo').catch(() => '(err)'));
  console.log('consoleErrors so far:', JSON.stringify(consoleErrors));
  await browser.close();
  process.exit(1);
}

const resolverStatusText = await page.textContent('#resolverStatus');
check('checkout.html: browser-native kaspa-wasm loaded + sha256 verified', resolverStatusText.includes('sha256 核对通过'), resolverStatusText);

const quoteInfoText = await page.textContent('#quoteInfo');
check('checkout.html: quote signature verified natively in-browser', quoteInfoText.includes('验证通过'), quoteInfoText);

const chainInfoText = await page.textContent('#chainInfo');
check('checkout.html: channel address parsed (no signature chain, dedup-cap path)', chainInfoText.includes('已解析'), chainInfoText);

const orderInfoText = await page.textContent('#orderInfo');
check('checkout.html: order address resolved natively in-browser', orderInfoText.includes('收款地址'), orderInfoText);
check('checkout.html: order address used the REAL silverc-wasm compiler (primary path, not the splice fallback)', orderInfoText.includes('真 silverc 编译器'), orderInfoText);
check('checkout.html: resolverStatus confirms silverc-wasm loaded as primary path', resolverStatusText.includes('真 silverc 编译器'), resolverStatusText);

check('checkout.html: zero console/page errors during full flow', consoleErrors.length === 0, JSON.stringify(consoleErrors));
check('checkout.html: ZERO network calls to resolver.mjs (D-034 §8 后续票①第二轮)', resolverCalls.length === 0, JSON.stringify(resolverCalls));

console.log('\n--- full page texts (for provenance) ---');
console.log('resolverStatus:', resolverStatusText);
console.log('quoteInfo:', quoteInfoText);
console.log('chainInfo:', chainInfoText);
console.log('orderInfo:', orderInfoText);

await browser.close();
console.log(`\n=== E2E (real Chromium via Playwright): ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
