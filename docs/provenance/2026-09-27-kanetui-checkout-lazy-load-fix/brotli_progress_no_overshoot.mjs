// D-034 §8 B段⑧d MUST-fix 复现验证——同 NWT j1-inbox/2026-09-27T12-23Z-nwt-VERDICT-...md 的方法:
// 真实 HTTP 服务器发 Content-Encoding: br + 压缩后 Content-Length(标准 CDN 预压缩行为), 真实 Chromium
// 访问, 采样下载期间 resolverStatus 的文本, 断言:①从不出现百分比数字("%") ②出现"已收到 X.X MB"这个
// 降级文案 ③下载完成后最终状态正确(sha256 核对通过, ✓)。
// 跑法: 先起 scratch/_kanetui_checkout_accept_test/server-brotli.mjs(带 Content-Encoding: br), 再跑本文件。
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8977';
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8, latency: 100 });

const samples = [];
const sampler = setInterval(async () => {
  try { samples.push(await page.evaluate(() => document.getElementById('resolverStatus')?.innerText || '')); } catch {}
}, 150);

await page.goto(`${BASE}/checkout.html`, { timeout: 60000 });
await page.waitForFunction(() => {
  const t = document.getElementById('resolverStatus')?.innerText || '';
  return t.includes('sha256 核对通过');
}, { timeout: 60000 });
clearInterval(sampler);
const finalText = await page.textContent('#resolverStatus');
await browser.close();

const pctSamples = samples.filter((s) => /\d+%/.test(s));
const mbSamples = samples.filter((s) => s.includes('已收到') && s.includes('MB'));
console.log('total samples:', samples.length);
console.log('samples containing a "N%" pattern (MUST be 0):', pctSamples.length);
if (pctSamples.length) console.log('OFFENDING SAMPLES:', JSON.stringify(pctSamples.slice(0, 5)));
console.log('samples using the "已收到 X.X MB" fallback (MUST be > 0, proves the fallback path fired):', mbSamples.length);
console.log('final state shows sha256 verified:', finalText.includes('sha256 核对通过'));
console.log(pctSamples.length === 0 && mbSamples.length > 0 && finalText.includes('sha256 核对通过') ? 'VERIFIED: MUST-fix holds under real br-compressed transfer' : 'FAIL');
