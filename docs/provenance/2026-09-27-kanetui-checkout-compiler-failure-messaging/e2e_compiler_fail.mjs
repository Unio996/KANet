// D-034 §8 B段⑦ 真实验证: 用一个故意损坏的 silverc-wasm(sha256 对不上 pin)触发浏览器版编译器
// 加载失败真实路径(不是猜测/模拟错误对象), 确认: ①订单仍然能靠降级路径成功推导出地址(不冒充成功
// 也不整单失败) ②页面清楚展示失败原因+三条替代方案文案 ③resolveOrderBtn 之外(monitorInfo)同步
// 指向说明, 不重复整段长文案。
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8992';

async function run() {
  const kaspa = await import('kaspa-wasm');
  const priv = new kaspa.PrivateKey('0f'.repeat(32));
  const providerAddr = priv.toPublicKey().toAddress('simnet').toString();

  const browser = await chromium.launch();
  const setupPage = await browser.newPage();
  await setupPage.goto(`${BASE}/config.html`);
  await setupPage.fill('#providerAddr', providerAddr);
  await setupPage.fill('#merchantPriv', priv.toString());
  await setupPage.fill('#priceKas', '20');
  await setupPage.fill('#channelBps', '10');
  await setupPage.fill('#maxChannels', '5');
  await setupPage.click('#genBtn');
  await setupPage.waitForFunction(() => document.getElementById('result').innerText.includes('已签名'), null, { timeout: 15000 });
  const linkHref = await setupPage.evaluate(() => [...document.getElementById('result').querySelectorAll('code')].find(c => c.textContent.startsWith('http'))?.textContent || '');
  await setupPage.close();
  console.log('[test] minted link ok:', !!linkHref);

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(linkHref, { timeout: 60000 });
  await page.waitForFunction(() => {
    const t = document.getElementById('resolverStatus')?.innerText || '';
    return t.includes('sha256 核对通过') || t.includes('✗');
  }, null, { timeout: 60000, polling: 200 });

  const payerPriv = new kaspa.PrivateKey('10'.repeat(32));
  const payerAddr = payerPriv.toPublicKey().toAddress('simnet').toString();
  await page.fill('#refundAddr', payerAddr);
  await page.click('#resolveOrderBtn');
  await page.waitForFunction(() => {
    const t = document.getElementById('orderInfo')?.innerText || '';
    return t.includes('收款地址') || t.includes('失败');
  }, null, { timeout: 60000, polling: 200 });

  const orderText = await page.textContent('#orderInfo');
  const monitorText = await page.textContent('#monitorInfo');
  console.log('\n[test] orderInfo full text:\n', orderText);
  console.log('\n[test] monitorInfo full text:\n', monitorText);

  const hasFallbackAddress = orderText.includes('收款地址') && orderText.includes('固定偏移覆写降级路径');
  const hasFailureReason = orderText.includes('silverc 编译器') && orderText.includes('加载失败');
  const hasThreeAlternatives = orderText.includes('换一个支持 WebAssembly') && orderText.includes('GitHub Release') && orderText.includes('resolver.mjs');
  const hasNoOwnServiceMentioned = !orderText.includes('我们的服务器提供') && !orderText.includes('联系我们');
  const monitorPointsUp = monitorText.includes('详情与替代方式') || monitorText.includes('上方');

  console.log('\n=== CHECKS ===');
  console.log('降级路径成功给出订单地址:', hasFallbackAddress);
  console.log('展示了加载失败的原因:', hasFailureReason);
  console.log('展示了三条替代方案(换浏览器/GitHub Release/resolver.mjs):', hasThreeAlternatives);
  console.log('没有建议依赖我们自己的服务:', hasNoOwnServiceMentioned);
  console.log('monitorInfo 指向上方说明而非重复整段:', monitorPointsUp);
  console.log('consoleErrors:', consoleErrors.length, consoleErrors.slice(0, 5));

  await browser.close();
  const pass = hasFallbackAddress && hasFailureReason && hasThreeAlternatives && hasNoOwnServiceMentioned && monitorPointsUp && consoleErrors.length === 0;
  console.log('\nOVERALL:', pass ? 'PASS' : 'FAIL');
  if (!pass) process.exit(1);
}
await run();
