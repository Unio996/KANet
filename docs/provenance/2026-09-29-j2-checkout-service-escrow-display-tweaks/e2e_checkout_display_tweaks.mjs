// e2e_checkout_display_tweaks.mjs — Owner 批的三处结账页展示层改动(2026-09-29): 服务订单页页头/
// 退款输入块/链接原文折叠+签名公钥, 即时分账页保持不回归。真浏览器(Playwright)各截一张图存证。
import { chromium } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const { PrivateKey, signMessage } = kaspa;

const BASE = 'http://127.0.0.1:8994';
const net = 'simnet';
const SDK = await import('file:///D:/kanet-tn12/scratch/_j2_wt_service_escrow_design/kasia-console/src/lib/commission-plan-sdk.mjs');
const OUT_DIR = 'D:/kanet-tn12/kasia-console/scratch/_j2_service_escrow_simnet_test';

let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } }

function xOnlyPk(priv) { const full = priv.toPublicKey().toString(); return full.length === 66 ? full.slice(2) : full; }

// ── ① 服务订单托管页(order_kind='service_escrow') ──
{
  const providerPriv = new PrivateKey(require('crypto').randomBytes(32).toString('hex'));
  const buyerPriv = new PrivateKey(require('crypto').randomBytes(32).toString('hex'));
  const providerAddr = providerPriv.toPublicKey().toAddress(net).toString();
  const buyerAddr = buyerPriv.toPublicKey().toAddress(net).toString();
  const MAX_SPLIT_FEE = 6_000_000n, MAX_REFUND_FEE = 6_000_000n;
  const providerFinalAmount = 200_000_000n;
  const protocol = SDK.createServiceEscrowProtocol({
    network: net, finalRoles: [{ amountSompi: providerFinalAmount, spk: SDK.spkBytesFromAddress(providerAddr) }],
    buyerRefundAddress: buyerAddr, providerPayoutAddress: providerAddr,
    deadlineDaa: 999999, maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE,
    buyerPubkeyHex: xOnlyPk(buyerPriv), providerPubkeyHex: xOnlyPk(providerPriv),
  });
  const expectedTotalSompi = providerFinalAmount + MAX_SPLIT_FEE;
  const spkHex = (buf) => Buffer.from(buf).toString('hex');
  const quoteWithoutSig = {
    order_kind: 'service_escrow', network: net, merchant_pubkey_hex: xOnlyPk(providerPriv),
    service_escrow: {
      address: protocol.address, redeem_script_hex: protocol.redeemScriptHex,
      entries: { timeout_default: protocol.entries.timeout_default },
      deadline_daa: protocol.deadlineDaa, timeout_buyer_bps: protocol.timeoutBuyerBps,
      max_refund_fee_sompi: protocol.maxRefundFeeSompi.toString(),
      provider_payout_spk_hex: spkHex(protocol.providerPayoutSpk), buyer_refund_spk_hex: spkHex(protocol.buyerRefundSpk),
      expected_total_sompi: expectedTotalSompi.toString(),
    },
  };
  const msgHex = SDK.canonicalQuoteBytes(quoteWithoutSig).toString('hex');
  const signature_hex = signMessage({ message: msgHex, privateKey: providerPriv });
  const quote = { ...quoteWithoutSig, signature_hex };
  const quoteB64 = Buffer.from(JSON.stringify(quote), 'utf8').toString('base64');

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 800, height: 1400 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {}); // headless Chromium 默认拒剪贴板权限, 不是本页代码的锅
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(`${BASE}/checkout.html?q=${encodeURIComponent(quoteB64)}`, { timeout: 60000 });
  await page.waitForFunction(() => (document.getElementById('quoteInfo')?.innerText || '').includes('验证通过'), null, { timeout: 60000, polling: 200 });

  const pageTitle = await page.title();
  check('① 页头 <title> 改为"服务订单托管"', pageTitle.includes('服务订单托管') && !pageTitle.includes('商品佣金计划'), pageTitle);
  const h1Text = await page.textContent('#pageTitle');
  check('① <h1> 页头文字同步改为"服务订单托管"', h1Text.includes('服务订单托管') && !h1Text.includes('商品佣金计划'), h1Text);

  const refundBoxDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('refundInputBox')).display);
  check('② 服务订单页隐藏"退款地址/推导订单地址"输入块', refundBoxDisplay === 'none', `display=${refundBoxDisplay}`);

  const linkInfoHtml = await page.evaluate(() => document.getElementById('linkInfo').innerHTML);
  check('③ 归因链接参数用 <details> 折叠(默认无 open 属性)', linkInfoHtml.includes('<details>') && !linkInfoHtml.includes('<details open'), linkInfoHtml.slice(0, 200));
  const detailsOpenAttr = await page.evaluate(() => document.querySelector('#linkInfo details')?.hasAttribute('open'));
  check('③ <details> 确实默认收起(open=false)', detailsOpenAttr === false, `open=${detailsOpenAttr}`);

  const quoteInfoText = await page.textContent('#quoteInfo');
  check('③ 报价表里显示了签名者公钥', quoteInfoText.includes(xOnlyPk(providerPriv)), quoteInfoText);
  check('③ 显示了"请与服务方事先公开的公钥核对"提示', quoteInfoText.includes('请与服务方事先公开的公钥核对'), quoteInfoText);
  // 复制按钮真实可点(不只是文案存在)
  await page.click('#seCopyPubkeyBtn');
  await page.waitForFunction(() => document.getElementById('seCopyPubkeyBtn')?.textContent === '已复制', null, { timeout: 5000 }).catch(() => {});
  const copyBtnText = await page.textContent('#seCopyPubkeyBtn');
  check('③ 公钥复制按钮真实可点击(clipboard 或至少不报错)', copyBtnText === '已复制' || copyBtnText === '复制', copyBtnText);

  const orderInfoText = await page.textContent('#orderInfo');
  check('订单地址仍正确展示(改动没破坏原有功能)', orderInfoText.includes(protocol.address), orderInfoText);

  await page.screenshot({ path: `${OUT_DIR}/screenshot-service-escrow-page.png`, fullPage: true });
  check('页面全程零 console/page 错误', consoleErrors.length === 0, JSON.stringify(consoleErrors));
  await browser.close();
}

// ── ② 即时分账页(CommissionSplit, order_kind 缺省/非 service_escrow)——不得回归 ──
{
  const merchantPriv = new PrivateKey(require('crypto').randomBytes(32).toString('hex'));
  const providerPriv = new PrivateKey(require('crypto').randomBytes(32).toString('hex'));
  const providerAddr = providerPriv.toPublicKey().toAddress(net).toString();

  const quote = {
    schema_v: 1, quote_id: 'q-display-tweak-' + Date.now(), merchant_pubkey_hex: null,
    price_sompi: String(Math.round(1 * 1e8)),
    canonical_rules: { schema_v: 1, roles: [{ name: 'provider', bps: 10000, address: providerAddr }] },
    unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now(), valid_until_ms: Date.now() + 30 * 86400000,
    channel_whitelist: null, require_channel_deposit: false, min_deposit_sompi: '100000000',
    max_split_fee_sompi: '40000000', max_refund_fee_sompi: '10000000', deadline_offset_ms: 259200000,
  };
  quote.merchant_pubkey_hex = merchantPriv.toPublicKey().toString();
  const signed = SDK.signQuote(quote, merchantPriv.toString());
  const quoteB64 = Buffer.from(JSON.stringify(signed)).toString('base64');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 1400 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(`${BASE}/checkout.html?q=${encodeURIComponent(quoteB64)}`, { timeout: 60000 });
  await page.waitForFunction(() => (document.getElementById('quoteInfo')?.innerText || '').includes('验证通过'), null, { timeout: 60000, polling: 200 });

  const pageTitle = await page.title();
  check('即时分账页标题保持"商品佣金计划"(未被服务订单改动污染)', pageTitle.includes('商品佣金计划'), pageTitle);
  const h1Text = await page.textContent('#pageTitle');
  check('即时分账页 <h1> 保持"商品佣金计划"', h1Text.includes('商品佣金计划'), h1Text);

  const refundBoxDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('refundInputBox')).display);
  check('即时分账页"退款地址/推导订单地址"输入块仍正常显示(不回归)', refundBoxDisplay !== 'none', `display=${refundBoxDisplay}`);

  const linkInfoText = await page.textContent('#linkInfo');
  check('即时分账页归因链接参数仍是原来的展开表格(没有被误套上折叠)', linkInfoText.includes('quote 引用') && !linkInfoText.includes('默认折叠'), linkInfoText);

  // 真实走一遍"填退款地址→推导订单地址"确认功能未受影响
  const { addr: refundAddr } = (() => { const p = new PrivateKey(require('crypto').randomBytes(32).toString('hex')); return { addr: p.toPublicKey().toAddress(net).toString() }; })();
  await page.fill('#refundAddr', refundAddr);
  await page.click('#resolveOrderBtn');
  await page.waitForFunction(() => { const t = document.getElementById('orderInfo')?.innerText || ''; return t.includes('收款地址') || t.includes('失败'); }, null, { timeout: 60000, polling: 200 });
  const orderInfoText = await page.textContent('#orderInfo');
  check('即时分账页订单地址推导仍正常工作(不回归)', orderInfoText.includes('收款地址'), orderInfoText);

  await page.screenshot({ path: `${OUT_DIR}/screenshot-instant-split-page.png`, fullPage: true });
  check('即时分账页全程零 console/page 错误', consoleErrors.length === 0, JSON.stringify(consoleErrors));
  await browser.close();
}

console.log(`\n=== 结账页三处展示改动(服务订单页+即时分账页不回归): ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
