// e2e_3way_split.mjs — D-034 checkout.js channelSpks bug 修复的真实 simnet 端到端证明: 真浏览器
// (Playwright Chromium)打开真结账页(我的 worktree, 已修 channelSpksHex→channelSpks), 走真实
// "&ch=<channel1地址>"链接(裸渠道路径, 就是主网事故 txid 24f07ace… 撞的那条路径), 真广播一笔
// provider(70%)+broker(5%)+channel_1(25%)三方分账, 真查三个地址链上余额确认各方都真的到账。
// 基础设施复用 KANet-UI docs/provenance/2026-09-27-kanetui-checkout-broadcast-commission/ 的手法
// (同一个 simnet 节点/funders, 我自己起了指向我 worktree 的静态服务器, 没有动 KANet-UI 的文件)。
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address } = kaspa;

const BASE = 'http://127.0.0.1:8991'; // 我自己的静态服务器, 指向 _j2_wt_checkout_spks worktree
const RPC_URL = 'ws://127.0.0.1:29935'; // 复用 KANet-UI 那台 simnet 节点(重启后 node-data 原样, funders 仍有余额)
const SHARED_DIR = 'D:/kanet-tn12/scratch/_kanetui_broadcast_simnet';
const MY_DIR = 'D:/kanet-tn12/scratch/_j2_checkout_spks_e2e';

const merchantPriv = fs.readFileSync(`${SHARED_DIR}/merchant-priv.txt`, 'utf8').trim();
const providerAddr = fs.readFileSync(`${SHARED_DIR}/provider-addr.txt`, 'utf8').trim();

function newSimnetAddr() {
  const priv = new PrivateKey(Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join(''));
  return { priv, addr: priv.toPublicKey().toAddress('simnet').toString() };
}
const { addr: brokerAddr } = newSimnetAddr();
const { addr: channel1Addr } = newSimnetAddr();

function mintQuoteB64(priceKas, deadlineOffsetMs) {
  return execFileSync('node', [`${MY_DIR}/mint-quote-3way.mjs`, String(priceKas), String(deadlineOffsetMs), providerAddr, brokerAddr, merchantPriv], { encoding: 'utf8' }).trim();
}
function fundAddress(addr, kas, funderIndex) {
  execFileSync('node', [`${SHARED_DIR}/fund-from.mjs`, String(funderIndex), addr, String(kas)], { encoding: 'utf8', timeout: 600000 });
}

let rpc;
async function connectRpc() { if (rpc) return rpc; rpc = new RpcClient({ url: RPC_URL, encoding: Encoding.Borsh, networkId: 'simnet' }); await rpc.connect({}); return rpc; }
async function balanceKas(addr) {
  const r = await connectRpc();
  const { entries } = await r.getUtxosByAddresses([new Address(addr)]);
  const total = (entries || []).reduce((a, e) => a + BigInt(e.amount ?? e.entry?.amount ?? 0), 0n);
  return Number(total) / 1e8;
}
async function waitFor(fn, timeoutMs, pollMs = 2000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const r = await fn(); if (r) return r; await new Promise(r2 => setTimeout(r2, pollMs)); }
  throw new Error(`waitFor 超时(${label})`);
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } }

console.log(`providerAddr=${providerAddr}`);
console.log(`brokerAddr=${brokerAddr}`);
console.log(`channel1Addr=${channel1Addr}`);
const providerBalBefore = await balanceKas(providerAddr);
const brokerBalBefore = await balanceKas(brokerAddr);
const channel1BalBefore = await balanceKas(channel1Addr);
console.log(`余额(分账前): provider=${providerBalBefore} broker=${brokerBalBefore} channel_1=${channel1BalBefore}`);

const quoteB64 = mintQuoteB64(10, 259200000); // 10 KAS, deadline 3 天(同 KANet-UI 精确按同款价格档验证过 mass-feasible)
console.log(`quote minted (base64 len=${quoteB64.length})`);

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

// 🔴 关键: &ch=<channel1Addr> —— 裸渠道路径(无签名链), 就是主网真实事故(txid 24f07ace…)撞的那条路径,
// 也是 checkout.js buildVerifiedChain() 的 dedupAndCapChannelSpks 分支。
const checkoutUrl = `${BASE}/checkout.html?q=${encodeURIComponent(quoteB64)}&rpcUrl=${encodeURIComponent(RPC_URL)}&ch=${encodeURIComponent(channel1Addr)}`;
console.log(`checkout URL: ${checkoutUrl.slice(0, 150)}...`);
await page.goto(checkoutUrl, { timeout: 60000 });
await page.waitForFunction(() => {
  const t = document.getElementById('resolverStatus')?.innerText || '';
  return t.includes('sha256 核对通过') || t.includes('✗');
}, null, { timeout: 60000, polling: 200 });
const resolverStatusText = await page.textContent('#resolverStatus');
check('kaspa-wasm 加载+sha256核对通过', resolverStatusText.includes('sha256 核对通过'), resolverStatusText);

const chainInfoText = await page.textContent('#chainInfo');
check('渠道地址已解析(裸ch=路径, 无签名链背书——就是事故那条路径)', chainInfoText.includes('已解析'), chainInfoText);

const { addr: refundAddr } = newSimnetAddr();
await page.fill('#refundAddr', refundAddr);
await page.click('#resolveOrderBtn');
await page.waitForFunction(() => {
  const t = document.getElementById('orderInfo')?.innerText || '';
  return t.includes('收款地址') || t.includes('失败');
}, null, { timeout: 60000, polling: 200 });
const orderInfoText = await page.textContent('#orderInfo');
check('订单地址推导成功', orderInfoText.includes('收款地址'), orderInfoText);
// 🔴 这是本次修复要证的核心事实之一: 角色表里真的列出了 channel_1(不是只有 provider)。
check('订单角色表里真实列出 channel_1(不是被 fold 掉——事故的直接反面)', orderInfoText.includes('channel_1'), orderInfoText);
check('订单角色表里真实列出 broker', orderInfoText.includes('broker'), orderInfoText);
const orderAddress = await page.evaluate(() => document.querySelector('#orderInfo code')?.textContent);
console.log(`orderAddress=${orderAddress}`);
console.log(`orderInfo 原文(供 provenance 存档):\n${orderInfoText}`);

fundAddress(orderAddress, 10.02, 5); // funder#5, 10 KAS 应付 + 0.02 手续费余量(同 KANet-UI①同款档位, hasChange=false 分支)
await waitFor(async () => {
  const t = await page.textContent('#monitorInfo').catch(() => '');
  return (t.includes('已到账') || t.includes('超额')) ? t : null;
}, 60000, 3000, '付款到账检测');
await waitFor(async () => !(await page.getAttribute('#triggerSplitBtn', 'disabled')), 90000, 3000, '深确认(triggerSplitBtn 可点)');
await page.click('#triggerSplitBtn');
const finalText = await waitFor(async () => {
  const t = await page.textContent('#monitorInfo').catch(() => '');
  return (t.includes('订单已完成') || t.includes('失败')) ? t : null;
}, 90000, 3000, '分账广播完成');
console.log(`monitorInfo 最终原文(供 provenance 存档):\n${finalText}`);
await page.close();

check('浏览器分账广播完成("订单已完成")', finalText.includes('订单已完成'), finalText);
check('页面全程零 console/page 错误', consoleErrors.length === 0, JSON.stringify(consoleErrors));

// ── 真实链上核实三方到账(不是只信页面文案) ──
const providerBal = await waitFor(async () => { const b = await balanceKas(providerAddr); return b > providerBalBefore ? b : null; }, 30000, 2000, 'provider 到账');
const brokerBal = await waitFor(async () => { const b = await balanceKas(brokerAddr); return b > brokerBalBefore ? b : null; }, 30000, 2000, 'broker 到账');
const channel1Bal = await waitFor(async () => { const b = await balanceKas(channel1Addr); return b > channel1BalBefore ? b : null; }, 30000, 2000, 'channel_1 到账');
console.log(`余额(分账后): provider=${providerBal} broker=${brokerBal} channel_1=${channel1Bal}`);

// 10 KAS 总额按 7000/500/2500 bps 精确应为 provider=7.0 broker=0.5 channel_1=2.5(±极小误差, 无凭空产生/丢失)
check('provider 到账 ≈7.0 KAS(70%)', Math.abs(providerBal - providerBalBefore - 7.0) < 0.01, `provider净收=${(providerBal - providerBalBefore).toFixed(4)}`);
check('broker 到账 ≈0.5 KAS(5%)——broker 是独立角色, 不是渠道, 一直都该收到', Math.abs(brokerBal - brokerBalBefore - 0.5) < 0.01, `broker净收=${(brokerBal - brokerBalBefore).toFixed(4)}`);
check('🔴 channel_1 真实到账 ≈2.5 KAS(25%)——这就是主网事故里没发生、现在真实发生了的那件事', Math.abs(channel1Bal - channel1BalBefore - 2.5) < 0.01, `channel_1净收=${(channel1Bal - channel1BalBefore).toFixed(4)}`);

await browser.close();
if (rpc) await rpc.disconnect().catch(() => {});

console.log(`\n=== 三方分账真实 simnet E2E(worktree=_j2_wt_checkout_spks, 已修 channelSpks bug): ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
