// delivery-page.js — 数字商品交付买家页的 DOM 薄壳(逻辑全在 delivery-buyer.js / delivery-crypto.js, 已有 Node 单测与断言 b)。
//   加载 kaspa-wasm(与 checkout.js 同一份产物与 sha256 pin)→ 读发票(片段 + 查询串)→ 推导 → 轮询取货 / 粘贴 / 到期退款 / 清扫。
//   🔴 全部用户可见文案在 delivery-copy.js(占位, 待 Owner 批); 动态内容一律 textContent(交付物是商家给的字符串, 不进 innerHTML)。
//   🔴 本页不向任何地方发送 nonce/秘密: 只有读后端(api.kaspa.org)请求与节点 rpc, 参数只含地址; <meta name="referrer" content="no-referrer">。非主网时读后端地址可由 ?api= 覆盖(同 monitor.js 的 ?rpcUrl= 规则: 主网一律忽略)。
import { COPY } from './delivery-copy.js';
import * as RB from './resolve-order-browser.js';
import * as feeSplitLib from './vendor/fee-split-browser.mjs';
import { startBuyerFlow } from './delivery-buyer.js';
import { makeKaspaApiReaderBrowser } from './delivery-read.js';
import { connectMonitorRpc, resolveRpcUrlOverride } from './monitor.js';

const EXPECTED_KASPA_WASM_SHA256 = '732bdaa3ee8353c026654e9c7dd729674eb1bd064e8a0b8927b4cfb7df859e51';   // 同 checkout.js(pin 同步纪律见该文件)
const $ = (id) => document.getElementById(id);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };
const show = (id, ...nodes) => { const b = $(id); b.replaceChildren(...nodes); b.hidden = false; };
const kas = (s) => { const n = BigInt(s); const w = n / 100000000n; const f = (n % 100000000n).toString().padStart(8, '0').replace(/0+$/, ''); return w + (f ? '.' + f : ''); };

document.title = COPY.title; $('pageTitle').textContent = COPY.title;
show('statusBox', el('span', { textContent: COPY.loading }));

async function boot() {
  const wasmBytes = await (await fetch('./vendor/kaspa-web/kaspa_bg.wasm')).arrayBuffer();
  const sha = hex(await crypto.subtle.digest('SHA-256', wasmBytes));
  if (sha !== EXPECTED_KASPA_WASM_SHA256) throw new Error('kaspa_bg.wasm sha256 不符 pin — 拒绝初始化');
  const mod = await import('./vendor/kaspa-web/kaspa.js');
  await mod.default({ module_or_path: await WebAssembly.compile(wasmBytes) });
  const silSha = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await (await fetch('./vendor/sil-source/CommissionSplit.sil')).text())));

  const apiOverride = new URLSearchParams(location.search).get('api');
  const flow = await startBuyerFlow({
    location, history, kaspa: mod, RB, feeSplitLib, sourceSha256Hex: silSha,
    makeReader: (network) => makeKaspaApiReaderBrowser(network, network === 'mainnet' ? undefined : apiOverride),
  });
  const d = flow.derived;
  show('orderBox', el('h3', { textContent: COPY.orderBox.heading }),
    el('div', {}, COPY.orderBox.address + ': ', el('code', { textContent: d.orderAddress })),
    el('div', { textContent: `${COPY.orderBox.total}: ${kas(d.totalSompi)} KAS` }),
    el('div', { textContent: `${COPY.orderBox.deadline}: ${new Date(d.deadlineMs).toISOString()}` }),
    el('p', { textContent: COPY.orderBox.payHint }));
  const dl = el('button', { textContent: COPY.credential.button, onclick: () => { const a = el('a', { href: URL.createObjectURL(new Blob([flow.credentialJson()], { type: 'application/json' })), download: 'delivery-credential.json' }); a.click(); } });
  show('credentialBox', el('h3', { textContent: COPY.credential.heading }), el('p', { textContent: COPY.credential.body }), dl);

  // 取货轮询(读失败 ⇒ 提示后继续, 不当作"没有货"); 30 秒一次, 出错退避到 60 秒
  let delay = 5000; let done = false;
  const tick = async () => {
    if (done) return;
    try {
      const r = await flow.check();
      if (r.status === 'delivered') { done = true; show('statusBox', el('span', { className: 'ok', textContent: COPY.status.delivered })); showDeliverable(r.plaintext); return; }
      const f = await flow.funds();
      show('statusBox', el('span', { textContent: r.status === 'pending_depth' ? COPY.status.pendingDepth : f.funded ? COPY.status.paidWaitingDelivery : COPY.status.waitingPayment }));
      delay = 30000;
    } catch (e) { show('statusBox', el('span', { className: 'warn', textContent: COPY.status.readError(e.message) })); delay = 60000; }
    setTimeout(tick, delay);
  };
  const showDeliverable = (text) => {
    const code = el('code', { textContent: text });
    show('deliveryBox', el('h3', { textContent: COPY.deliverable.heading }), code, el('button', { textContent: COPY.deliverable.copy, onclick: () => navigator.clipboard?.writeText(text) }));
  };
  tick();

  // 粘贴密文兜底
  const ta = el('textarea', { rows: 3, placeholder: COPY.paste.placeholder }); const pmsg = el('div');
  show('pasteBox', el('h3', { textContent: COPY.paste.heading }), ta, el('button', { textContent: COPY.paste.button, onclick: async () => {
    const pt = await flow.paste(ta.value);
    if (pt === null) { pmsg.className = 'bad'; pmsg.textContent = COPY.paste.fail; return; }
    pmsg.className = 'ok'; pmsg.textContent = COPY.paste.ok; done = true; showDeliverable(pt);
  } }), pmsg);

  // 退款 + 清扫(需要节点 rpc; 非主网可用 ?rpcUrl= 覆盖)
  const rpcOf = async () => (await connectMonitorRpc(mod, { network: d.network, rpcUrl: resolveRpcUrlOverride(d.network, new URLSearchParams(location.search).get('rpcUrl')) })).rpc;
  const rmsg = el('div');
  show('refundBox', el('h3', { textContent: COPY.refund.heading }), el('p', { textContent: COPY.refund.body }), el('button', { textContent: COPY.refund.button, onclick: async () => {
    try { const r = await flow.refund(await rpcOf()); rmsg.className = 'ok'; rmsg.textContent = COPY.refund.done(r.txId); } catch (e) { rmsg.className = 'warn'; rmsg.textContent = String(e.message).includes('还没到期') ? COPY.refund.notYet : e.message; }
  } }), rmsg);
  const addr = el('input', { type: 'text', placeholder: COPY.sweep.addrLabel }); const smsg = el('div');
  const sweep = (which) => async () => {
    try { const r = await (which === 'mailbox' ? flow.sweepMailbox : flow.sweepRefund)(await rpcOf(), addr.value.trim()); smsg.className = r.status === 'sent' ? 'ok' : 'warn'; smsg.textContent = r.status === 'sent' ? COPY.sweep.sent(r.count, r.txIds.join(',')) : COPY.sweep.nothing; }
    catch (e) { smsg.className = 'bad'; smsg.textContent = /地址/.test(e.message) ? COPY.sweep.badAddr : e.message; }
  };
  show('sweepBox', el('h3', { textContent: COPY.sweep.heading }), el('p', { textContent: COPY.sweep.body }), addr, el('button', { textContent: COPY.sweep.mailboxButton, onclick: sweep('mailbox') }), el('button', { textContent: COPY.sweep.refundButton, onclick: sweep('refund') }), smsg);
}

boot().catch((e) => show('statusBox', el('span', { className: 'bad', textContent: /订单凭据/.test(e.message) ? COPY.noInvoice : COPY.loadFailed(e.message) })));
