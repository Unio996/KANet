// verify_checkout_real_entrypoint_channel_spks.mjs — 回归测试: 主网真实事故(checkout.js 的
// channelSpksHex 命名/hex 化 bug, 导致所有渠道 fold 给 provider, 主网实证 txid 24f07ace…)的
// 直接根治证明。
//
// 🔴 跟旧的 verify_resolve_order_browser_parity.mjs 的关键区别(Bettor 指出正是这点让旧测试没抓到
// 这个 bug): 旧测试在 line 71 手写 `{ ok: true, channelSpks: verified.channelSpks }`, 绕过了
// checkout.js 自己的 verifiedChain 构造代码, 测的是"resolve-order-browser.js 跟 commission-plan-
// sdk.mjs 的 resolveRulesForOrder 输出是否一致"——这个问题问得对, 但没有覆盖到"checkout.js 传给
// resolveRulesForOrder 的到底是不是它自称的那个东西"。
// 本测试改从 checkout.js 真正导出的入口函数(parseAttributionLink + buildVerifiedChain, 事故代码
// 本体, 不是仿写的平行实现)喂真实构造的归因链接 URL 进去, 一路跑到 resolve-order-browser.js 的
// resolveRulesForOrder, 断言角色表里渠道真的在场且金额正确(不是折给 provider)。
//
// Run: node docs/provenance/2026-09-28-j2-checkout-channel-spks-bugfix/verify_checkout_real_entrypoint_channel_spks.mjs

// ── checkout.js 顶层有 `await fetch('./vendor/kaspa-web/kaspa_bg.wasm')` 这类浏览器专属逻辑
// (真实产物: 相对路径 fetch 在 Node 下会同步抛 TypeError, 被它自己的 try/catch 捕获, 设 wasmLoadError,
// 不会让模块整体加载失败——这是它原有的、为"wasm 加载失败"设计的降级分支, 不是这里新加的绕过)。
// main() 走到 wasmLoadError 分支只会调用一次 renderBox('resolverStatus', ...), 需要一个最小 document
// 桩子, 仅此而已——我们不需要 main() 做任何有意义的事, 只需要模块顶层求值不崩, 拿到它导出的两个
// 真实函数(parseAttributionLink / buildVerifiedChain)。 ──
globalThis.document = { getElementById: () => ({ set innerHTML(_v) {}, addEventListener() {} }) };
globalThis.location = { href: 'http://localhost/checkout' };

const { createRequire } = await import('node:module');
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const { PrivateKey } = kaspa;
const blake2bNode = (await import('file:///D:/kanet-tn12/kasia-console/node_modules/@noble/hashes/blake2b.js')).blake2b;

const SDK = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_spks/kasia-console/src/lib/commission-plan-sdk.mjs');
const feeSplitLib = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_spks/kasia-console/src/lib/fee-split.mjs');
const RB = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_spks/kasia-console/src/lib/checkout-static/resolve-order-browser.js');
const CO = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_spks/kasia-console/src/lib/checkout-static/checkout.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } }

const merchantPriv = new PrivateKey('01'.repeat(32));
const brokerPriv = new PrivateKey('02'.repeat(32));
const net = 'testnet';
const addr = (priv) => priv.toPublicKey().toAddress(net).toString();

function buildQuote(trial) {
  const roles = [
    { name: 'provider', bps: 7000, address: addr(merchantPriv) },
    { name: 'broker', bps: 500, address: addr(brokerPriv) },
    { name: 'channel_1', bps: 1500, fold_to: 'provider' },
    { name: 'channel_2', bps: 1000, fold_to: 'provider' },
  ];
  const quoteBase = {
    schema_v: 1, quote_id: 'real-entrypoint-' + trial, merchant_pubkey_hex: merchantPriv.toPublicKey().toString(),
    price_sompi: '1000000000', canonical_rules: { schema_v: 1, roles },
    unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now(), valid_until_ms: Date.now() + 86400000,
    channel_whitelist: null, require_channel_deposit: false, min_deposit_sompi: '100000000',
    max_split_fee_sompi: '40000000', max_refund_fee_sompi: '10000000', deadline_offset_ms: 259200000,
  };
  return SDK.signQuote(quoteBase, merchantPriv.toString());
}

async function runThroughRealEntryPoint(url) {
  // checkout.js 的真实入口: parseAttributionLink(真实解析) → buildVerifiedChain(真实构造, 事故代码本体)
  const { quoteRef, rawChannelAddrs, chainEntries } = CO.parseAttributionLink(url);
  const quote = JSON.parse(atob(quoteRef)); // 逐字对应 checkout.js main() 里同一行
  const network = quote.network || 'testnet';
  const vr = CO.buildVerifiedChain(kaspa, blake2bNode, quote, chainEntries, rawChannelAddrs, network);
  if (!vr.ok) return { ok: false, reason: vr.reason };
  const verifiedChain = { ok: true, channelSpks: vr.channelSpks }; // 逐字对应 checkout.js main() 里同一行
  const resolved = RB.resolveRulesForOrder(kaspa, feeSplitLib, quote, verifiedChain);
  return { ok: true, quote, resolved };
}

// ── ① 签名链路径(sc=) ──
{
  const quote = buildQuote('chain');
  const channelPrivs = [new PrivateKey('10'.repeat(32)), new PrivateKey('11'.repeat(32))];
  let d = SDK.verifyChain(quote, [], net).chainDigest;
  const chainEntries = [];
  for (let i = 0; i < channelPrivs.length; i++) {
    const spk = SDK.spkBytesFromAddress(addr(channelPrivs[i]));
    const e = SDK.signChainEntry(d, i + 1, spk, channelPrivs[i].toString());
    chainEntries.push(e);
    const msg = Buffer.concat([d, Buffer.from([i + 1]), spk, e.signing_pubkey]);
    d = Buffer.from(blake2bNode(msg, { dkLen: 32 }));
  }
  const quoteRef = btoa(JSON.stringify(quote));
  const url = SDK.encodeAttributionLink('http://localhost/checkout', quoteRef, [], chainEntries);
  check('①签名链: URL 真实带 sc= 参数(走 checkout.js 真实 parseAttributionLink 解析这条链接)', url.includes('sc='), url);

  const r = await runThroughRealEntryPoint(url);
  check('①签名链: buildVerifiedChain 通过', r.ok, r.reason);
  if (r.ok) {
    const byName = Object.fromEntries(r.resolved.payoutLeaves.map(x => [x.name, x]));
    check('①签名链: channel_1 真实出现在角色表里(不是被 fold 掉)', !!byName.channel_1 && byName.channel_1.amountSompi > 0n, JSON.stringify(r.resolved.payoutLeaves.map(x => x.name)));
    check('①签名链: channel_2 真实出现在角色表里(不是被 fold 掉)', !!byName.channel_2 && byName.channel_2.amountSompi > 0n, JSON.stringify(r.resolved.payoutLeaves.map(x => x.name)));
    // 🔴 精确值断言, 不只是"存在"——这才是真正能分辨 bug 有没有复发的判据: provider(7000bps)=700000000,
    // broker(500bps, 独立角色, 有没有渠道都拿自己的份额)=50000000, channel_1(1500bps)=150000000,
    // channel_2(1000bps)=100000000。bug 复发时(channelSpks 读不到) channel_1/channel_2 会被 fold 给
    // provider, provider 会变成 950000000(=7000+1500+1000bps)而不是 700000000——这个数字差异
    // (700000000 vs 950000000)正是主网事故 txid 24f07ace… 的可观测特征本身(那笔是 provider 收了 100%
    // 减掉不存在渠道的份额, 这里用 950000000 vs 700000000 复现同一类偏差, 数值上更精确可断言)。
    check('①签名链: provider 精确等于 7000bps(700000000), 不是被折算后的 9500bps(950000000)', byName.provider.amountSompi === 700000000n, `provider=${byName.provider.amountSompi}`);
    check('①签名链: broker 精确等于 500bps(50000000)', byName.broker && byName.broker.amountSompi === 50000000n, `broker=${byName.broker?.amountSompi}`);
    check('①签名链: channel_1 精确等于 1500bps(150000000)', byName.channel_1.amountSompi === 150000000n, `channel_1=${byName.channel_1.amountSompi}`);
    check('①签名链: channel_2 精确等于 1000bps(100000000)', byName.channel_2.amountSompi === 100000000n, `channel_2=${byName.channel_2.amountSompi}`);
    const total = r.resolved.payoutLeaves.reduce((a, x) => a + x.amountSompi, 0n);
    check('①签名链: 角色金额总和 = 报价总额(无凭空产生/丢失)', total === 1000000000n, `total=${total}`);
  }
}

// ── ② 裸 &ch= 路径(无签名链背书) ──
{
  const quote = buildQuote('raw');
  const channelPrivs = [new PrivateKey('20'.repeat(32)), new PrivateKey('21'.repeat(32))];
  const channelAddrs = channelPrivs.map(addr);
  const quoteRef = btoa(JSON.stringify(quote));
  const url = SDK.encodeAttributionLink('http://localhost/checkout', quoteRef, channelAddrs, null);
  check('②裸ch=: URL 真实带 ch= 参数、不带 sc=', url.includes('ch=') && !url.includes('sc='), url);

  const r = await runThroughRealEntryPoint(url);
  check('②裸ch=: buildVerifiedChain 通过', r.ok, r.reason);
  if (r.ok) {
    const byName = Object.fromEntries(r.resolved.payoutLeaves.map(x => [x.name, x]));
    check('②裸ch=: channel_1 真实出现在角色表里(不是被 fold 掉)', !!byName.channel_1 && byName.channel_1.amountSompi > 0n, JSON.stringify(r.resolved.payoutLeaves.map(x => x.name)));
    check('②裸ch=: channel_2 真实出现在角色表里(不是被 fold 掉)', !!byName.channel_2 && byName.channel_2.amountSompi > 0n, JSON.stringify(r.resolved.payoutLeaves.map(x => x.name)));
    check('②裸ch=: provider 精确等于 7000bps(700000000), 不是被折算后的 9500bps(950000000)', byName.provider.amountSompi === 700000000n, `provider=${byName.provider.amountSompi}`);
    check('②裸ch=: broker 精确等于 500bps(50000000)', byName.broker && byName.broker.amountSompi === 50000000n, `broker=${byName.broker?.amountSompi}`);
    check('②裸ch=: channel_1 精确等于 1500bps(150000000)', byName.channel_1.amountSompi === 150000000n, `channel_1=${byName.channel_1.amountSompi}`);
    check('②裸ch=: channel_2 精确等于 1000bps(100000000)', byName.channel_2.amountSompi === 100000000n, `channel_2=${byName.channel_2.amountSompi}`);
    const total = r.resolved.payoutLeaves.reduce((a, x) => a + x.amountSompi, 0n);
    check('②裸ch=: 角色金额总和 = 报价总额(无凭空产生/丢失)', total === 1000000000n, `total=${total}`);
  }
}

// ── ③ 空链接(无 sc=、无 ch=): 应该正常走"无渠道"分支, 全部 fold 给 provider——这是唯一 provider
//    应该合法收全额的情况, 用来反向确认"provider 没收全额"这个断言不是恒真的空判据。 ──
{
  const quote = buildQuote('empty');
  const quoteRef = btoa(JSON.stringify(quote));
  const url = SDK.encodeAttributionLink('http://localhost/checkout', quoteRef, [], null);
  const r = await runThroughRealEntryPoint(url);
  check('③空链接(无渠道): buildVerifiedChain 通过(raw 模式, 0 个地址)', r.ok, r.reason);
  if (r.ok) {
    const byName = Object.fromEntries(r.resolved.payoutLeaves.map(x => [x.name, x]));
    // provider 拿自己的 7000bps + 两个渠道 fold 过来的 1500+1000bps = 9500bps(broker 500bps 是独立
    // 角色, 一直拿自己的份额, 不是"provider 没有 channel 就吞全部"——我第一版断言算错了这一点, 已改)。
    check('③空链接: 这种情况下 provider 合法收 9500bps(7000 自己的+1500+1000 两个渠道 fold 过来的), 不是 bug', byName.provider.amountSompi === 950000000n, `provider=${byName.provider.amountSompi}`);
    check('③空链接: channel_1/channel_2 不出现在角色表里(正确地被 fold 掉, 不是"能出现但没出现")', !byName.channel_1 && !byName.channel_2, JSON.stringify(r.resolved.payoutLeaves.map(x => x.name)));
  }
}

console.log(`\n=== checkout.js 真实入口(parseAttributionLink→buildVerifiedChain→resolveRulesForOrder) channelSpks 回归测试: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
