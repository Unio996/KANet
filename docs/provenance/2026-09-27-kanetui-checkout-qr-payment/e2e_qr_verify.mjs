// D-034 §8 B段⑤ 真实验证: 不只是"页面上出现了一个 <svg>"——真拿浏览器渲染出来的 QR 图像, 用一个
// 独立的 QR 解码库(jsqr, 跟 checkout.js 用的编码库 qrcode-generator 完全不是同一份实现)解出里面
// 编的字符串, 断言它跟页面自己算出来的 paymentUri 逐字相同。编码器和解码器不同源, 排除"两边同一个
// bug 互相抵消看起来对了"这种假阳性。
import { chromium } from 'playwright';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const BASE = 'http://127.0.0.1:8983';

async function run() {
  const kaspa = await import('kaspa-wasm');
  const priv = new kaspa.PrivateKey('0d'.repeat(32));
  const providerAddr = priv.toPublicKey().toAddress('simnet').toString();

  const browser = await chromium.launch();
  const setupPage = await browser.newPage();
  setupPage.on('pageerror', e => console.log('[setup pageerror]', e.message));
  // ⑤ 没碰 config.html/resolver.mjs, 直接用这个 worktree 里未改动的 config.html 签一份真实报价。
  await setupPage.goto(`${BASE}/config.html`);
  await setupPage.fill('#providerAddr', providerAddr);
  await setupPage.fill('#merchantPriv', priv.toString());
  await setupPage.fill('#priceKas', '73.5');
  await setupPage.fill('#channelBps', '10');
  await setupPage.fill('#maxChannels', '5');
  await setupPage.click('#genBtn');
  await setupPage.waitForFunction(() => document.getElementById('result').innerText.includes('已签名'), null, { timeout: 15000 });
  const linkHref = await setupPage.evaluate(() => [...document.getElementById('result').querySelectorAll('code')].find(c => c.textContent.startsWith('http'))?.textContent || '');
  await setupPage.close();
  console.log('[e2e-qr] minted link ok:', !!linkHref);

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(linkHref, { timeout: 60000 });
  await page.waitForFunction(() => {
    const t = document.getElementById('resolverStatus')?.innerText || '';
    return t.includes('sha256 核对通过') || t.includes('✗');
  }, null, { timeout: 60000, polling: 200 });

  const payerPriv = new kaspa.PrivateKey('0e'.repeat(32));
  const payerAddr = payerPriv.toPublicKey().toAddress('simnet').toString();
  await page.fill('#refundAddr', payerAddr);
  await page.click('#resolveOrderBtn');
  await page.waitForFunction(() => {
    const t = document.getElementById('orderInfo').innerText;
    return t.includes('收款地址') || t.includes('失败');
  }, null, { timeout: 60000, polling: 200 });

  const orderText = await page.textContent('#orderInfo');
  console.log('[e2e-qr] orderInfo excerpt:', orderText.replace(/\s+/g, ' ').slice(0, 220));

  // 页面自己算出来的 paymentUri, 从可见的付款链接 <code> 文本里取(不是从 JS 变量作弊读——就是用户
  // 真实会看到、会复制的那段文本)。
  const displayedUri = await page.evaluate(() => {
    const codes = [...document.querySelectorAll('#orderInfo code')];
    // 收款地址那个 code 不含 '?amount=', 付款链接那个含
    return codes.map(c => c.textContent).find(t => t.includes('?amount=')) || null;
  });
  console.log('[e2e-qr] displayed payment URI:', displayedUri);

  const svgExists = await page.evaluate(() => !!document.querySelector('#orderInfo svg'));
  console.log('[e2e-qr] svg element present:', svgExists);

  // 截图整个 QR 容器(真实浏览器渲染出来的像素, 不是拿 svg 字符串自己另外 rasterize)。
  const qrHandle = await page.$('#orderInfo svg');
  const screenshotBuf = await qrHandle.screenshot({ scale: 'device' });
  await browser.close();

  const png = PNG.sync.read(screenshotBuf);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

  console.log('[e2e-qr] jsQR decode result:', decoded ? decoded.data : null);

  const pass = decoded && displayedUri && decoded.data === displayedUri && svgExists && consoleErrors.length === 0;
  console.log('\n=== RESULT ===');
  console.log('displayedUri === decoded QR content:', decoded && displayedUri && decoded.data === displayedUri);
  console.log('svg present:', svgExists);
  console.log('console errors:', consoleErrors.length, consoleErrors.slice(0, 5));
  console.log('OVERALL PASS:', pass);
  if (!pass) process.exit(1);
}

await run();
