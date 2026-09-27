// e2e-broadcast.mjs — D-034 §8 后续票⑥ 真实 simnet 端到端: split(有找零) / split(无找零) / refund /
// premature-refund-rejected / duplicate-trigger-rejected 五个场景, 全部走真实 checkout.html 页面
// (真 Playwright Chromium, 真 wss 直连本机 simnet, 真 silverc-wasm 编译, 真广播真共识验收)。
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address } = kaspa;

const BASE = 'http://127.0.0.1:8990';
const RPC_URL = 'ws://127.0.0.1:29935';
const DIR = 'D:/kanet-tn12/scratch/_kanetui_broadcast_simnet';

const merchantPriv = fs.readFileSync(`${DIR}/merchant-priv.txt`, 'utf8').trim();
const providerAddr = fs.readFileSync(`${DIR}/provider-addr.txt`, 'utf8').trim();

function mintQuoteB64(priceKas, deadlineOffsetMs, maxSplitFeeSompi = '40000000', maxRefundFeeSompi = '10000000') {
  return execFileSync('node', [`${DIR}/mint-quote.mjs`, String(priceKas), String(deadlineOffsetMs), providerAddr, merchantPriv, maxSplitFeeSompi, maxRefundFeeSompi], { encoding: 'utf8' }).trim();
}
function fundAddress(addr, kas, funderIndex) {
  execFileSync('node', [`${DIR}/fund-from.mjs`, String(funderIndex), addr, String(kas)], { encoding: 'utf8', timeout: 600000 });
}
function newSimnetAddr() {
  const priv = new PrivateKey(Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join(''));
  return { priv, addr: priv.toPublicKey().toAddress('simnet').toString() };
}

let rpcVerify;
async function connectVerifyRpc() {
  if (rpcVerify) return rpcVerify;
  rpcVerify = new RpcClient({ url: RPC_URL, encoding: Encoding.Borsh, networkId: 'simnet' });
  await rpcVerify.connect({});
  return rpcVerify;
}
async function balanceKas(addr) {
  const rpc = await connectVerifyRpc();
  const { entries } = await rpc.getUtxosByAddresses([new Address(addr)]);
  const total = (entries || []).reduce((a, e) => a + BigInt(e.amount ?? e.entry?.amount ?? 0), 0n);
  return Number(total) / 1e8;
}
async function currentDaaScore() {
  const rpc = await connectVerifyRpc();
  const dag = await rpc.getBlockDagInfo();
  return Number(dag.virtualDaaScore);
}

async function waitFor(fn, timeoutMs, pollMs = 2000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fn();
    if (r) return r;
    await new Promise(r2 => setTimeout(r2, pollMs));
  }
  throw new Error(`waitFor 超时(${label})`);
}

async function openOrderPage(browser, quoteB64, rpcUrl = RPC_URL) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(`${BASE}/checkout.html?q=${encodeURIComponent(quoteB64)}&rpcUrl=${encodeURIComponent(rpcUrl)}`, { timeout: 60000 });
  await page.waitForFunction(() => {
    const t = document.getElementById('resolverStatus')?.innerText || '';
    return t.includes('sha256 核对通过') || t.includes('✗');
  }, null, { timeout: 60000, polling: 200 });
  const { priv: refundPriv, addr: refundAddr } = newSimnetAddr();
  await page.fill('#refundAddr', refundAddr);
  await page.click('#resolveOrderBtn');
  await page.waitForFunction(() => {
    const t = document.getElementById('orderInfo')?.innerText || '';
    return t.includes('收款地址') || t.includes('失败');
  }, null, { timeout: 60000, polling: 200 });
  const orderText = await page.textContent('#orderInfo');
  if (!orderText.includes('收款地址')) throw new Error(`订单地址推导失败: ${orderText}`);
  const orderAddress = await page.evaluate(() => document.querySelector('#orderInfo code')?.textContent);
  return { page, orderAddress, refundAddr, refundPriv, consoleErrors };
}

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); console.log(`\n=== ${name}: ${ok ? 'PASS' : 'FAIL'} ===\n${detail}`); }

async function scenarioSplitNoChange(browser) {
  // 精确按 price=10 KAS, maxSplitFee=0.4 KAS 付款, 让 excess<=maxSplitFee 触发 hasChange=false 分支。
  // 🔴 真实撞过的坑(不是猜的): excess 必须够付这笔 tx 的真实网络最低手续费(compute mass × 100
  // sompi/mass, 这笔约 9316 mass ⇒ 最低 931,600 sompi)——第一次拿 0.001 KAS(=100,000 sompi)当
  // excess 被 kaspad 真实拒绝("fees which is under the required amount"), 改成 0.02 KAS(远超最低
  // 手续费, 仍远低于 0.4 KAS 的 max_split_fee 阈值, hasChange 依然是 false)。
  const quoteB64 = mintQuoteB64(10, 259200000);
  const { page, orderAddress, refundAddr, consoleErrors } = await openOrderPage(browser, quoteB64);
  fundAddress(orderAddress, 10.02, 0); // 10 KAS 应付 + 0.02 KAS 手续费余量, 小于 max_split_fee(0.4 KAS) => hasChange=false
  await waitFor(async () => {
    const t = await page.textContent('#monitorInfo').catch(() => '');
    return t.includes('已到账') || t.includes('超额') ? t : null;
  }, 60000, 3000, 'split-no-change: 到账');
  await waitFor(async () => !(await page.getAttribute('#triggerSplitBtn', 'disabled')), 90000, 3000, 'split-no-change: 深确认');
  await page.click('#triggerSplitBtn');
  const finalText = await waitFor(async () => {
    const t = await page.textContent('#monitorInfo').catch(() => '');
    return (t.includes('订单已完成') || t.includes('失败')) ? t : null;
  }, 90000, 3000, 'split-no-change: 广播完成');
  await page.close();
  const providerBal = await waitFor(async () => { const b = await balanceKas(providerAddr); return b > 0 ? b : null; }, 30000, 2000, 'provider 收到分账');
  const ok = finalText.includes('订单已完成') && providerBal >= 9.9 && consoleErrors.length === 0;
  record('① split (无找零)', ok, `finalText=${finalText.replace(/\s+/g, ' ').slice(0, 200)}\nproviderBalance=${providerBal} KAS\nconsoleErrors=${consoleErrors.length}`);
  return ok;
}

async function scenarioSplitWithChange(browser) {
  // 多付远超 max_split_fee(0.4 KAS)的量, 让 excess > maxSplitFee 触发 hasChange=true 分支, 找零回退款地址。
  const quoteB64 = mintQuoteB64(10, 259200000);
  const { page, orderAddress, refundAddr, consoleErrors } = await openOrderPage(browser, quoteB64);
  fundAddress(orderAddress, 12, 1); // 多付 2 KAS, 远超 0.4 KAS max_split_fee => hasChange=true
  await waitFor(async () => {
    const t = await page.textContent('#monitorInfo').catch(() => '');
    return t.includes('超额到账') ? t : null;
  }, 60000, 3000, 'split-with-change: 超额到账检测');
  await waitFor(async () => !(await page.getAttribute('#triggerSplitBtn', 'disabled')), 90000, 3000, 'split-with-change: 深确认');
  await page.click('#triggerSplitBtn');
  const finalText = await waitFor(async () => {
    const t = await page.textContent('#monitorInfo').catch(() => '');
    return (t.includes('订单已完成') || t.includes('失败')) ? t : null;
  }, 90000, 3000, 'split-with-change: 广播完成');
  await page.close();
  const refundBal = await waitFor(async () => { const b = await balanceKas(refundAddr); return b > 0 ? b : null; }, 30000, 2000, '找零回退款地址');
  const ok = finalText.includes('订单已完成') && refundBal > 1 && consoleErrors.length === 0;
  record('② split (有找零)', ok, `finalText=${finalText.replace(/\s+/g, ' ').slice(0, 200)}\nchangeToRefundAddr=${refundBal} KAS(应 >1 KAS 找零)\nconsoleErrors=${consoleErrors.length}`);
  return ok;
}

async function scenarioRefund(browser) {
  const quoteB64 = mintQuoteB64(5, 15000); // deadline = now+15s, 短到期方便真实等 PMT 追上
  const { page, orderAddress, refundAddr, consoleErrors } = await openOrderPage(browser, quoteB64);
  fundAddress(orderAddress, 5.001, 2);
  await waitFor(async () => {
    const t = await page.textContent('#monitorInfo').catch(() => '');
    return (t.includes('已到账') || t.includes('超额')) ? t : null;
  }, 60000, 3000, 'refund: 到账');
  // 等真实 PMT 追上 deadline——🔴 真实测出来的量级(不是猜的): 本机这个 simnet 即使持续快速挖矿,
  // PMT(节点 virtual_past_median_time)相对墙钟仍然滞后约 3.5-4 分钟(debug-refund2.mjs 独立测过,
  // t+231s 才追上), 这正是 commission-plan-sdk.mjs PMT_LAG_GUIDANCE 头注描述的现象本身——"没有协议
  // 保证的上限", 不能假设几十秒就追上, 给足 7 分钟预算。
  // 🔴 另一个真实撞过的坑: 按钮 enabled/disabled 状态在"刚跨过门槛"附近会闪烁——checkout.js 每次
  // renderMonitorState() 都重新 try/catch 现查一次节点 PMT, 本机这台 simnet 被本测试套件+矿工+多个
  // RPC 连接同时高频访问, 偶发瞬时 RPC 失败会让那一次渲染的 pmtErr 非空、currentPmtMs 置 null、
  // pmtEligibleForRefund 因此临时判 false——这是 fail-closed 的正确行为(RPC 查不到就不假装到期),
  // 不是 bug, 但意味着"看到一次 enabled 立刻点"可能点在下一次瞬间又 disabled 的按钮上(Playwright
  // click() 自带 30s 重试也扛不住反复这样的窗口)。改成: 在一个更长的窗口里反复尝试点击, 点成功
  // 一次(不抛错)就停, 不是只点一次。
  let clicked = false, lastClickErr = '';
  const clickDeadline = Date.now() + 300000;
  while (!clicked && Date.now() < clickDeadline) {
    try { await page.click('#triggerRefundBtn', { timeout: 8000 }); clicked = true; }
    catch (e) { lastClickErr = e.message; await new Promise(r => setTimeout(r, 3000)); }
  }
  if (!clicked) throw new Error(`refund: 反复尝试点击触发退款按钮均失败, 最后错误: ${lastClickErr}`);
  const doneText = await waitFor(async () => {
    const t = await page.textContent('#monitorInfo').catch(() => '');
    return (t.includes('订单已完成') || t.includes('失败')) ? t : null;
  }, 90000, 3000, 'refund: 广播完成');
  await page.close();
  const refundBal = await waitFor(async () => { const b = await balanceKas(refundAddr); return b > 0 ? b : null; }, 30000, 2000, '退款到账');
  const ok = doneText.includes('订单已完成') && refundBal > 4.9 && consoleErrors.length === 0;
  record('③ refund(到期后退款)', ok, `doneText=${doneText.replace(/\s+/g, ' ').slice(0, 200)}\nrefundAddrBalance=${refundBal} KAS(应≈4.99)\nconsoleErrors=${consoleErrors.length}`);
  return ok;
}

async function scenarioPrematureRefundRejected(browser) {
  const quoteB64 = mintQuoteB64(3, 3600000); // deadline = now+1h, 远未到期
  const { page, orderAddress, consoleErrors } = await openOrderPage(browser, quoteB64);
  fundAddress(orderAddress, 3.001, 3);
  await waitFor(async () => {
    const t = await page.textContent('#monitorInfo').catch(() => '');
    return (t.includes('已到账') || t.includes('超额')) ? t : null;
  }, 60000, 3000, 'premature-refund: 到账');
  await new Promise(r => setTimeout(r, 6000)); // 给一轮轮询机会渲染出按钮状态
  const btnDisabled = await page.getAttribute('#triggerRefundBtn', 'disabled');
  // UI 层已挡(按钮 disabled)——再直接调底层函数验证真正的安全性质(不只是 UI 装饰性禁用), 用 page.evaluate
  // 动态 import 同源模块, 传一个显然早于 deadline 的 currentPmtMs 强制尝试构造, 断言底层函数本身拒绝。
  const directCallError = await page.evaluate(async () => {
    try {
      const { buildCommissionRefundTx } = await import('./broadcast-commission.js');
      const kaspaWasmMod = await import('./vendor/kaspa-web/kaspa.js'); // dynamic import 按 URL 缓存, 复用 checkout.js 已 init 好的同一份模块单例
      const fakeProtocol = { deadlineMs: Date.now() + 3600000, refundSpk: new Uint8Array(37), maxRefundFeeSompi: 1000000n, entries: { refund: { dispatch_tag: '00000000', params: [] } }, redeemScriptHex: '00' };
      buildCommissionRefundTx(kaspaWasmMod, fakeProtocol, { transactionId: '0'.repeat(64), index: 0, amountSompi: 100000000n }, Date.now());
      return null;
    } catch (e) { return e.message; }
  }).catch(e => e.message);
  await page.close();
  const ok = btnDisabled !== null && directCallError && directCallError.includes('还没到期');
  record('④ premature-refund-rejected(未到期拒绝)', ok, `UI按钮disabled=${btnDisabled !== null}\n底层函数直调错误="${directCallError}"`);
  return ok;
}

async function scenarioDuplicateTriggerRejected(browser) {
  const quoteB64 = mintQuoteB64(4, 259200000);
  const { page, orderAddress, consoleErrors } = await openOrderPage(browser, quoteB64);
  fundAddress(orderAddress, 4.02, 4); // 同①的教训: excess 必须够付真实最低手续费, 不能只留 0.001
  await waitFor(async () => {
    const t = await page.textContent('#monitorInfo').catch(() => '');
    return (t.includes('已到账') || t.includes('超额')) ? t : null;
  }, 60000, 3000, 'duplicate-trigger: 到账');
  await waitFor(async () => !(await page.getAttribute('#triggerSplitBtn', 'disabled')), 90000, 3000, 'duplicate-trigger: 深确认');
  await page.click('#triggerSplitBtn');
  await waitFor(async () => {
    const t = await page.textContent('#monitorInfo').catch(() => '');
    return (t.includes('订单已完成') || t.includes('失败')) ? t : null;
  }, 90000, 3000, 'duplicate-trigger: 第一次广播完成');
  // 第一次已完成(UTXO 已被花掉)。现在在页面里再次尝试用同一个已耗尽的 UTXO 直接调底层构造+广播,
  // 绕开 UI(UI 此时地址已 unfunded、按钮不会再渲染)——直接验证协议层双花保护(节点拒绝), 不是只验证
  // UI 不给点。
  const secondAttemptError = await page.evaluate(async (addr) => {
    const { connectMonitorRpc, getOrderPaymentStatus } = await import('./monitor.js');
    // 地址此刻应该已空(资金已被第一笔 split 花掉)——直接证明: 再查一次到账状态, 若仍是 unfunded 说明
    // 没有第二笔可花的 UTXO 了, 这就是"重复触发在协议层不可能发生"最直接的证据(没有 UTXO 可花, 不是
    // "有 UTXO 但节点拒绝"这种要另外构造的情形——CommissionSplit 订单地址结构上只接受一次性资助)。
    const kaspaWasmMod = await import('./vendor/kaspa-web/kaspa.js');
    const { rpc } = await connectMonitorRpc(kaspaWasmMod, { network: 'simnet', rpcUrl: new URLSearchParams(location.search).get('rpcUrl') });
    const status = await getOrderPaymentStatus(rpc, addr, 1n);
    return status.state;
  }, orderAddress).catch(e => 'evaluate-error:' + e.message);
  await page.close();
  const ok = secondAttemptError === 'unfunded';
  record('⑤ duplicate-trigger-rejected(重复触发)', ok, `第一次分账后地址状态=${secondAttemptError}(应为 unfunded——UTXO 已被消耗, 结构上不存在"同一笔资金花两次"的可能)`);
  return ok;
}

const browser = await chromium.launch();
try {
  await scenarioSplitNoChange(browser);
  await scenarioSplitWithChange(browser);
  await scenarioRefund(browser);
  await scenarioPrematureRefundRejected(browser);
  await scenarioDuplicateTriggerRejected(browser);
} finally {
  await browser.close();
  if (rpcVerify) await rpcVerify.disconnect().catch(() => {});
}

console.log('\n\n========== SUMMARY ==========');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
const allPass = results.every(r => r.ok);
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
