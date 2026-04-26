// broker-buy-handler.js — Phase 4 A 模式撮合 (T-J2-08, v2.1.1)
// 用户 DM "买 X KAS" → 选 best open offer → 报价 → 用户 YES → 广播 accept_v1
// 复用 exchange_offers + exchange-machine, 不自建状态机不自建订单表.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const BUY_REGEX = /^\s*(?:买|buy)\s*(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*KAS\s*$/i;
// T-J1-19a (J2 probe-5a 暴露): broker dust 单接受漏洞 — finalizeBuy / _aggregateWithFallback
// 必须拒小于 MIN_QTY 的请求, 否则 broker 锁 fund_locks 浪费 broadcast tx + 用户 dust 被 broker fee 吃光.
const MIN_QTY_KAS = 1.0;
// T-J2-12 真人 PAID 意图: "我付了 0xabc...", "已付 0x...", "paid 0x...", "pay 0x..."
const PAID_REGEX = /(?:已付|付了|我付|paid|pay)[\s\S]{0,40}?\b(0x[a-fA-F0-9]{64})\b/i;
// T-J2-26 (Owner 真测 04-26 12:18): "已付!" 等支付完成意图 但无 tx hash → broker 必须主动引导发 tx
// 否则 LLM 误判走 finalize_order 重复下单 (Owner 这单实例: 43c0a4f8 已付后第 3 次 publish).
// T-J2-NWT-27c (Owner 真测 04-26 15:30 漏): "已经支付" 漏 → broker 静默 → Owner '请你们自己处理'.
// 扩 PAID_NO_TX 自然话变体 + 加 (?:了)? 完成态助词后缀 (J1 case 2 v6 '转完了 1/12 timeout' 真因).
const PAID_NO_TX_REGEX = /^(?:已付|付了|已转|转完|已支付|已转账|已经支付|已经付款|付款了|支付了|支付完成|支付好了|完成|done|paid|sent|finished|转好了|付好了|搞定|ok 付了|已经付了)\s*(?:了)?\s*[!！。.…]*\s*$/i;
// T-NWT-V2-hotfix (Owner 真测 #3 撞 LLM 60s timeout 多次): 询价 deterministic 短路, 不进 LLM.
// "现在 KAS 多少钱?" / "什么价?" / "现价" / "报价啊" / "多少钱" — 直接 fetchKasPrice 立刻 DM 价格.
// T-J2-V2-realtest: 真用户表达扩 — "啥价位" / "什么价位" / "kas 价位" / "kas 行情" / "市价" / 单 "价位" / "行情"
const PRICE_QUERY_REGEX = /^\s*(?:现在\s*kas\s*多少钱|kas\s*现在\s*多少钱|kas\s*(?:多少钱|价位|价|行情|市价|价格)|(?:什么|啥|多少)\s*(?:价位|价|行情|价钱|价格)|现价|现在价|市价|价位|行情|报报?价啊?|价格(?:多少|是多少|是)?|多少钱|how\s*much|price\??)\s*[?？!！.…]*\s*$/i;
// T-NWT-2026-04-26 case 6 (J1 76742556 任务面): STOP intent deterministic 短路.
// user 烦了 / 想退出 → broker 立刻 ack 告别, 不进 LLM 也不啰嗦. _pendingAccepts 不动 (订单生命周期独立).
// 完整 do_not_contact 跨 system (connection/Mind/relay anti-spam) 留 v1.1, 这里只 broker 层短路.
// T-J2-V2-realtest (J1 e5aca4c3 review 反对 [\s\S]* 启发式; J2 真测发现 STOP_LED 也撞 false pos
// "烦死了, 帮帮我"). 最严: 单 anchor STOP_HARD + 完整 keyword 列举 (含 "我" / "再联系我" / "联系我" 等真用户表达).
// 真 STOP 单短句, 复杂句子求助 fall LLM 判 sentiment.
const STOP_HARD_REGEX = /^\s*(?:烦死了?|烦人|滚开?|走开|别(?:再)?(?:烦|找|发|联系|打扰|dm)\s*我?\s*了?|不要(?:再)?(?:发|联系|找|dm|打扰)\s*我?\s*了?|不想聊|不聊了?|stop\s*(?:bothering|messag\w*)?(?:\s+me)?|leave\s+me\s+alone|fuck\s*off|go\s*away|don't\s+(?:bother|message|contact)\s*(?:me)?|bye|再见|结束|不需要了?|算了不要了?)\s*[!！。.…,，]*\s*(?:了|啦|啊|呀)?\s*[!！。.…]*\s*$/i;
function _isStopIntent(s) { return STOP_HARD_REGEX.test(s); }
const CONFIRM_WORDS = ['YES', 'yes', 'y', '确认', '好', '行', 'OK', 'ok'];
const CANCEL_WORDS  = ['NO', 'no', 'n', '取消', '不要', '算了'];
const QUOTE_TTL_MS = 5 * 60 * 1000;
const PENDING_ACCEPT_TTL_MS = 30 * 60 * 1000;  // 真人付款窗口 30min

const _quotes = new Map();  // peer → {offer_id, qty, quoted_usdt, pay_chain, maker_addr, expires_at}
const _pendingAccepts = new Map();  // peer → {offer_id, qty, quoted_usdt, pay_chain, maker_addr, accept_tx, expires_at}
let _sendOverride = null;
let _publishOverride = null;  // T-J1-19b: unit test inject for _brokerPublishKasOffer
let _scanOverride = null;     // T-J2-V2: unit test inject for scanRecentTransfers
export function _testInjectScan(fn) { _scanOverride = fn; }
export function _testResetScan() { _scanOverride = null; }

export function _testInjectSendCommand(fn) { _sendOverride = fn; }
export function _testResetSendCommand() { _sendOverride = null; }
export function _testInjectPublishOffer(fn) { _publishOverride = fn; }
export function _testResetPublishOffer() { _publishOverride = null; }
// T-J1-19c TTL test helpers — inject quote/pendingAccept with arbitrary expires_at.
export function _testSetQuote(peer, data) { _quotes.set(peer, data); }
export function _testSetPendingAccept(peer, data) { _pendingAccepts.set(peer, data); }
export function _clearQuotes() { _quotes.clear(); }
export function _hasQuote(peer) { return _quotes.has(peer); }
export function _clearPendingAccepts() { _pendingAccepts.clear(); }
export function _hasPendingAccept(peer) { return _pendingAccepts.has(peer); }
// T-NWT-V2: bsc-incoming-watcher 枚举所有 active peer, 对每个调 verifyPaymentForPeer (J2 lazy 路径).
export function _pendingPeers() { return [..._pendingAccepts.keys()]; }
// T-NWT-V2: watcher 拿 accept 详情 (DM 主动汇报含 amount/chain). expires_at < now → 跳过.
export function _getPendingAccept(peer) { return _pendingAccepts.get(peer); }

async function _send(relayId, cmd) {
  if (_sendOverride) return _sendOverride(relayId, cmd);
  const { sendCommandAsync } = await import('./relay-manager.js');
  return sendCommandAsync(relayId, cmd);
}

function selectBestOffer(qtyKas, payChain, give_asset = 'KAS') {
  // R5 T-J2-17 (Bug 10): broker 不 self-accept, 排除自己 maker 的 offer.
  // T-NWT-2026-04-27 v1.1 Phase A step 2: give_asset 参数化 (default 'KAS' 向后兼容).
  const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
  const brokerAddr = broker?.address || '';
  const rows = sqlite.prepare(`
    SELECT id, give_amount, want_amount, verification_meta, maker
    FROM exchange_offers
    WHERE protocol_status = 'open'
      AND give_asset = ? AND want_asset = 'USDT'
      AND CAST(give_amount AS REAL) >= ?
      AND maker != ?
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
    ORDER BY CAST(want_amount AS REAL) / CAST(give_amount AS REAL) ASC
    LIMIT 10
  `).all(give_asset, qtyKas, brokerAddr);
  for (const o of rows) {
    let meta;
    try { meta = JSON.parse(o.verification_meta || '{}'); } catch { continue; }
    const chains = Array.isArray(meta.accepted_chains) ? meta.accepted_chains : [];
    const match = chains.find(c => c && String(c.chain).toLowerCase() === payChain);
    if (match) return { ...o, maker_addr: match.address };
  }
  return null;
}

// R7 路径 C: 拼现成单聚合. selectBestOffer 找不到 single ≥ qty 时, 累加多个小单
// (从最便宜的起) 直到满足 qty. 返回 [{offer, take_qty, take_usdt, maker_addr}]
// take_qty 可能 < offer.give_amount (最后一个会"切薄" 用户只买部分).
// **协议含义**: exchange-machine accept_v1 必须 take 整笔 give_amount, 不支持部分成交.
// 因此最后一笔会"过买" (take 整笔 offer 即使 cum > qty), broker 多收的 KAS 后续退回用户
// 或下次抵扣. 第一版简化处理: 累加到 cum >= qty 就停, 最后一笔 take 整笔, 用户实收 cum KAS.
export function selectBestOffers(qtyKas, payChain, give_asset = 'KAS') {
  // T-NWT-2026-04-27 v1.1 Phase A step 2: give_asset 参数化 (default 'KAS' 向后兼容).
  const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
  const brokerAddr = broker?.address || '';
  const rows = sqlite.prepare(`
    SELECT id, give_amount, want_amount, verification_meta, maker
    FROM exchange_offers
    WHERE protocol_status = 'open'
      AND give_asset = ? AND want_asset = 'USDT'
      AND maker != ?
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
    ORDER BY CAST(want_amount AS REAL) / CAST(give_amount AS REAL) ASC
    LIMIT 30
  `).all(give_asset, brokerAddr);
  const picks = [];
  let cum = 0;
  for (const o of rows) {
    let meta;
    try { meta = JSON.parse(o.verification_meta || '{}'); } catch { continue; }
    const chains = Array.isArray(meta.accepted_chains) ? meta.accepted_chains : [];
    const match = chains.find(c => c && String(c.chain).toLowerCase() === payChain);
    if (!match) continue;
    const give = parseFloat(o.give_amount);
    if (!(give > 0)) continue;
    picks.push({ ...o, maker_addr: match.address, take_qty: give, take_usdt: parseFloat(o.want_amount) });
    cum += give;
    if (cum >= qtyKas) break;
  }
  if (cum < qtyKas) return { ok: false, available: cum, picks };
  return { ok: true, total_kas: cum, total_usdt: picks.reduce((s, p) => s + p.take_usdt, 0), picks };
}

// T-NWT-22 (broker 库存自挂): 没现成 maker / 拼不够 deficit 时, broker 用自己 KAS
// 库存 + 当前市价 spread 1% 调 /api/exchange/publish 挂 SELL 单. 返回 offer_id +
// want_usdt + maker_chain_addr, finalizeBuy / handleBuyIntent 用此 build pick 加进 picks[].
//
// T-J1-19n (Owner 真测 Bug B fix): idempotency check — 同 chain + qty 5min 内已挂
// broker_dynamic_quote → 直接复用现有 offer_id 不重 publish. 防 multi-turn finalize_order
// 反复触发 publish 创 N 个 open offer (Owner 真测看到 3 个 55 KAS 重复).
async function _brokerPublishKasOffer(qtyKas, payChain, give_asset = 'KAS') {
  // T-NWT-2026-04-27 v1.1 Phase A step 2: give_asset 参数化 (default 'KAS' 向后兼容).
  // Idempotency: 5min 内同 chain + 同 qty + 同 asset 已挂 broker_dynamic_quote open → 复用
  const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
  if (broker?.address) {
    const existing = sqlite.prepare(`
      SELECT id, want_amount, verification_meta, created_at
      FROM exchange_offers
      WHERE maker = ? AND protocol_status = 'open'
        AND give_asset = ? AND CAST(give_amount AS REAL) = ?
        AND json_extract(metadata, '$.source') = 'broker_dynamic_quote'
        AND julianday(created_at) > julianday('now', '-5 minutes')
      ORDER BY created_at DESC LIMIT 1
    `).get(broker.address, give_asset, qtyKas);
    if (existing) {
      try {
        const meta = JSON.parse(existing.verification_meta || '{}');
        const chains = Array.isArray(meta.accepted_chains) ? meta.accepted_chains : [];
        const match = chains.find(c => c && String(c.chain).toLowerCase() === payChain);
        if (match) {
          console.log(`[broker-buy] T-J1-19n idempotent: reuse open offer ${existing.id.slice(0,8)} (${qtyKas} KAS ${payChain})`);
          return { ok: true, offer_id: existing.id, want_usdt: existing.want_amount, maker_chain_addr: match.address, reused: true };
        }
      } catch {}
    }
  }
  // T-J2-2026-04-27 Bug 5 真定位错 — 之前 fix 在 buyPreview line 271 (preview only),
  // 真 publish path 在此 (_brokerPublishKasOffer 真 publish 真上链). 真 fix:
  // fetchKasPrice → fetchPrice(give_asset, 'USDT') generic. KAS=CMC, USDC/USDT=peg 1.0.
  const { fetchPrice } = await import('./price-oracle.js');
  const priceResult = await fetchPrice(give_asset, 'USDT');
  if (!priceResult.ok) return { ok: false, error: priceResult.error };
  const midPrice = priceResult.price;
  if (!midPrice || midPrice <= 0) return { ok: false, error: 'price_unavailable' };
  const wallet = sqlite.prepare(`
    SELECT chain, address FROM agent_wallets
    WHERE relay_node_id = ? AND chain = ? AND is_default = 1
  `).get(BROKER_RELAY_ID, payChain);
  if (!wallet?.address) return { ok: false, error: `broker no ${payChain} wallet` };
  const SPREAD_PCT = 1;
  const sellPrice = midPrice * (1 + SPREAD_PCT / 100);
  const wantUsdt = (qtyKas * sellPrice).toFixed(4);
  const PORT = process.env.CONSOLE_PORT || 3100;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/exchange/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // T-J2-2026-04-27 Bug 6 真修: give_asset hardcode 'KAS' → 参数 (Bug 5 修了价 oracle, 但 publish body 还 hardcode KAS = generic 化半残)
        relayNodeId: BROKER_RELAY_ID,
        give_asset,
        give_amount: String(qtyKas),
        give_chain: give_asset === 'KAS' ? 'kaspa' : payChain,  // KAS 在 Kaspa, stable 在 EVM (同 payChain)
        want_asset: 'USDT',
        want_amount: wantUsdt,
        verification: 'cross_chain_tx',
        verification_meta: { accepted_chains: [{ chain: payChain, address: wallet.address }], expected_asset: 'USDT' },
        expires_minutes: 60,  // R2 (J2 推): 30→60 防 25min 慢付 → broker cancel → 资金事故
        metadata: { source: 'broker_dynamic_quote', mid_price: midPrice, spread_pct: SPREAD_PCT, give_asset },
      }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: `publish: ${data.error || 'http_' + res.status}` };
    return { ok: true, offer_id: data.offer_id, want_usdt: wantUsdt, maker_chain_addr: wallet.address, mid_price: midPrice, sell_price: sellPrice };
  } catch (e) {
    return { ok: false, error: `publish_exc: ${e.message}` };
  }
}

// R4 改造 (T-NWT-09 broker-action-queue): 不直接 sendCommandAsync, 进队列保 FIFO 单线.
async function _enqueue(kind, peer, payload) {
  const { enqueue } = await import('./broker-action-queue.js');
  return enqueue({ kind, peer, payload });
}

function _enqueueAccept(offerId, peerAddr, payChain) {
  const payload = {
    t: 'kanet_exchange_accept_v1',
    offer_id: offerId,
    selected_chain: payChain,
    payment_asset: 'usdt',
    receive_address: peerAddr,
  };
  return _enqueue('accept_v1', peerAddr, { channel: 'kanet-exchange', message: JSON.stringify(payload) });
}

// T-J2-12 真人付款后由 broker 代广播 paid_v1 (真人 Kasia 客户端不发协议消息).
function _enqueuePaid(offerId, paymentTx, payChain, peerAddr) {
  const payload = {
    t: 'kanet_exchange_paid_v1',
    offer_id: offerId,
    payment_tx: paymentTx,
    payment_chain: payChain,
  };
  return _enqueue('paid_v1', peerAddr, { channel: 'kanet-exchange', message: JSON.stringify(payload) });
}

// 议 B (Owner 19:55+ 钦定): buyPreview — 字段齐时调, **不真 publish 不 set _pendingAccepts**.
// 同 _aggregateWithFallback 算 picks/价/maker, broker_dynamic_quote case 算 fetchKasPrice + spread
// 但不调 /api/exchange/publish (preview only). LLM 拿到 preview 数据自然话渲染完整画像 DM
// 让 user 最后 YES → 才调 finalizeBuy 真 publish.
//
// 防 hallucinate "已下单" — LLM 只能用 preview 真数据 (含 user_kasia_address / unit_price /
// total_usdt / maker_payment_address) 不能编. user reject "NO" 路径无 state cleanup (没 set 任何).
export async function buyPreview({ user_kasia, qty, pay_chain, give_asset = 'KAS' }) {
  if (!user_kasia || !qty || qty <= 0 || !pay_chain) {
    return { ok: false, error: 'missing fields (user_kasia/qty/pay_chain)' };
  }
  // T-NWT-2026-04-27 + T-J1-2026-04-27 v1.1 Phase A merged (Owner 22:54 钦定 '不要假, 真刀实枪'):
  // generic asset 路径前真 validate. NWT step 5 saves assetMeta for NLG asset.chain (Bug 4 修),
  // J1 4184ff75 ship listAssets() in error message. merge both.
  const { getAsset, listAssets } = await import('./asset-registry.js');
  const assetMeta = getAsset(give_asset);
  if (!assetMeta) {
    return {
      ok: false, error: 'asset_not_supported',
      message: `broker 真不支持 ${give_asset}. 现 supported: ${listAssets().join(', ')}.`,
    };
  }
  if (qty < MIN_QTY_KAS) {
    return { ok: false, error: `qty_too_small`, message: `最小买 ${MIN_QTY_KAS} ${give_asset} (broker fee + dust 保护). 改大点.` };
  }
  const existing = _pendingAccepts.get(user_kasia);
  if (existing && Date.now() < existing.expires_at) {
    const remaining = existing.picks.filter(p => !p.paid_tx).length;
    return { ok: false, error: 'already_in_pending_accept',
      message: `你已有 ${existing.total_kas} ${give_asset} active 订单 (${remaining} 待付). 先完成或等 30min 过期.` };
  }
  const payChain = String(pay_chain).toLowerCase();
  // T-NWT-2026-04-27 v1.1 Phase A step 2: give_asset 参数 propagation 到 selectBestOffers.
  const sel = selectBestOffers(qty, payChain, give_asset);
  let picks = sel.picks ? [...sel.picks] : [];
  let cumKas = picks.reduce((s, p) => s + p.take_qty, 0);

  // broker_dynamic_quote 价格 (但不 publish)
  if (cumKas < qty) {
    const deficit = qty - cumKas;
    // T-J2-2026-04-27 v1.1 Phase A NWT bug 3 + 真 generic asset_pair 真 fix:
    // J2 真测撞 USDT/USDC 价 = 0.0342 (KAS 价当 stable) — fetchPrice('KAS') hardcode 真错.
    // 真 fix: fetchPrice(give_asset, 'USDT') generic — KAS=0.0342, USDC=1.0 peg, USDT=1.0.
    const { fetchPrice } = await import('./price-oracle.js');
    const priceResult = await fetchPrice(give_asset, 'USDT');
    if (!priceResult.ok) return { ok: false, error: priceResult.error, message: `价格暂查不到 (${priceResult.error}), 请稍后再试.` };
    const midPrice = priceResult.price;
    if (!midPrice || midPrice <= 0) return { ok: false, error: 'price_unavailable', message: '价格暂查不到, 请稍后再试.' };
    const wallet = sqlite.prepare(`
      SELECT chain, address FROM agent_wallets
      WHERE relay_node_id = ? AND chain = ? AND is_default = 1
    `).get(BROKER_RELAY_ID, payChain);
    if (!wallet?.address) return { ok: false, error: 'no_broker_wallet', message: `broker 暂无 ${payChain} 收款钱包, 换链.` };
    const SPREAD_PCT = 1;
    const sellPrice = midPrice * (1 + SPREAD_PCT / 100);
    const wantUsdt = +(deficit * sellPrice).toFixed(4);
    picks.push({
      id: 'preview-broker-dynamic',
      take_qty: deficit,
      take_usdt: wantUsdt,
      maker_addr: wallet.address,
      broker_dynamic: true,
    });
    cumKas += deficit;
  }
  const totalUsdt = picks.reduce((s, p) => s + p.take_usdt, 0);
  const unitPrice = totalUsdt / cumKas;
  // T-J2-V2-realtest-critfix (J1 67903c5b 真测撞 LLM 编 fake 地址 0x1234... bug):
  // 生成 deterministic preview_text 完整画像字串. LLM 必须**原样转发**, 不让 LLM 自己渲染
  // 地址 (LLM 会按 SYSTEM_PROMPT 例子编 placeholder = user 真转 USDT 到 fake 地址 = 钱丢).
  // T-NWT-2026-04-27 v1.1 Phase A step 5: NLG asset.chain 真接 J1 asset-registry (Bug 4 修).
  // assetMeta.chain = 'kaspa' (KAS) / 'bnb' (USDT-bsc) / 'eth' (USDT-eth).
  // 真用户收 KAS → Kasia network 地址; 收 USDT-bnb → BSC 地址; 收 BTC → BTC network 地址.
  const recvNetwork = assetMeta.chain === 'kaspa' ? 'Kasia' : assetMeta.chain.toUpperCase();
  const payLines = picks.map((p, i) => {
    const tag = p.broker_dynamic ? '(broker 自挂)' : '(maker)';
    return `  ${i+1}. ${p.take_qty} ${give_asset} → 付 ${(+p.take_usdt).toFixed(6)} USDT 到\n     \`${p.maker_addr}\` ${tag}`;
  }).join('\n');
  const preview_text = `📋 **订单画像 (确认前)**

* 方向: 买 ${give_asset}
* 数量: ${cumKas} ${give_asset}
* 付款链: ${payChain.toUpperCase()} (USDT)
* 单价: ${unitPrice.toFixed(6)} USDT/${give_asset}
* 总额: ${totalUsdt.toFixed(6)} USDT
${payLines}
* ${give_asset} 收件 (你的 ${recvNetwork}):
  \`${user_kasia}\`

⏰ 订单 30 分钟内付款有效 · 跨链验证 1-3 分钟

确认下单回 **YES** · 修改回 '改 3 / 改 polygon / 改地址' · 取消回 **NO**`;
  return {
    ok: true,
    direction: 'buy',
    qty: cumKas,
    pay_chain: payChain,
    payment_currency: 'USDT',
    unit_price_usdt: +unitPrice.toFixed(6),
    total_usdt: +totalUsdt.toFixed(6),
    picks: picks.map(p => ({
      qty_kas: p.take_qty,
      pay_usdt: +p.take_usdt.toFixed(6),
      maker_payment_address: p.maker_addr,
      broker_dynamic: !!p.broker_dynamic,
    })),
    n_payments: picks.length,
    user_kasia_address: user_kasia,
    quote_ttl_minutes: 30,
    verify_window_text: '⏰ 订单 30 分钟内付款有效 · 跨链验证 1-3 分钟',
    preview_text,  // ← LLM 必须原样转发此字串 (含真 maker_addr + user_kasia 不让 LLM 渲染)
  };
}

// R6 T-J2-19: tool function for broker-llm-agent. LLM 收齐 user/qty/payChain 调此.
// R7 三层 fallback (J1+NWT 合并):
//   1. 路径 C (J1): selectBestOffers 拼现成 maker (greedy cheapest)
//   2. 路径 B (NWT T-NWT-22): 拼不够时 broker 自挂 deficit (用自己 KAS 库存)
//   3. broker 也无库存/价格 → 真 fail (极端)
// 返回 picks[] 含每个 maker + 付款金额 + 收款地址 (含 broker_dynamic 标记区分).
export async function finalizeBuy({ user_kasia, qty, pay_chain, give_asset = 'KAS' }) {
  // T-NWT-2026-04-27 v1.1 Phase A step 1: give_asset 参数化, default 'KAS' 向后兼容.
  if (!user_kasia || !qty || qty <= 0 || !pay_chain) {
    return { ok: false, error: 'missing fields (user_kasia/qty/pay_chain)' };
  }
  // T-NWT-2026-04-27 v1.1 Phase A step 5 (cont): asset validation 用 asset-registry (跟 buyPreview 同).
  const { getAsset: getAssetF } = await import('./asset-registry.js');
  const assetMetaF = getAssetF(give_asset);
  if (!assetMetaF) {
    return { ok: false, error: 'asset_not_supported',
      message: `broker 不支持 ${give_asset} (asset-registry 未注册). v1.2 加 entry 后启用.` };
  }
  if (qty < MIN_QTY_KAS) {
    return { ok: false, error: `qty too small: ${qty} < min ${MIN_QTY_KAS} KAS (broker fee + dust protection)` };
  }
  // T-J2-26 (Owner 真测 04-26 12:18 — bug B 重复 publish 修, 入口层 idempotent):
  // peer 已有 _pendingAccepts 未过期 → 拒绝重复. LLM 收 error 自然引导 "你已经有单, 请发 tx hash 完成或等过期".
  // 跟 T-J1-19n (publish 层 5min 同 chain+qty 复用) 互补 belt-and-suspenders.
  const existing = _pendingAccepts.get(user_kasia);
  if (existing && Date.now() < existing.expires_at) {
    const totalKas = existing.total_kas;
    const remaining = existing.picks.filter(p => !p.paid_tx).length;
    return { ok: false, error: 'already_in_pending_accept',
      message: `Peer already has active order: ${totalKas} KAS, ${remaining} payment(s) pending. Pay first (send "我付了 0x<txhash>"), or wait for it to expire.` };
  }
  const payChain = String(pay_chain).toLowerCase();
  // T-NWT-2026-04-27 v1.1 Phase A step 2: give_asset 参数 propagation 到 _aggregateWithFallback.
  const merged = await _aggregateWithFallback(qty, payChain, give_asset);
  if (!merged.ok) return { ok: false, error: merged.error, available: merged.available };

  for (const p of merged.picks) {
    await _enqueueAccept(p.id, user_kasia, payChain);
    _recordAccept({ offerId: p.id, userPeer: user_kasia, qty: p.take_qty, quotedUsdt: p.take_usdt.toFixed(6), payChain, acceptTx: null });
  }
  // T-J2-26 (Owner 真测 04-26 12:18 — Bug A 静默根修):
  // finalize_order tool 路径 (LLM 调) 也必须 set _pendingAccepts. 之前只有 BUY_REGEX → handleBuyIntent →
  // _quotes → YES → _pendingAccepts 路径会 set, LLM 自然语言 "我想买 X" 走 deterministic + finalize_order
  // tool 不 set, 导致后续 PAID_REGEX (line 316) 永远匹配不到, broker 自动闭环全断.
  // Owner 真测 '空不？我想买55个Kas' 撞这条: broker 报价 + 创 offer + 但 _pendingAccepts 没 set,
  // Owner '已付！' / '我付了 0x...' 都进不了 PAID_REGEX, broker 静默或乱调 finalize_order 又一单.
  _pendingAccepts.set(user_kasia, {
    picks: merged.picks.map(p => ({ ...p, paid_tx: null })),
    total_kas: merged.total_kas,
    total_usdt: merged.total_usdt,
    pay_chain: payChain,
    expires_at: Date.now() + PENDING_ACCEPT_TTL_MS,
  });
  return {
    ok: true,
    picks: merged.picks.map(p => ({
      offer_id: p.id,
      qty_kas: p.take_qty,
      pay_usdt: p.take_usdt.toFixed(6),
      maker_payment_address: p.maker_addr,
      broker_dynamic: !!p.broker_dynamic,
    })),
    total_kas: merged.total_kas,
    total_usdt: merged.total_usdt.toFixed(6),
    pay_chain: payChain,
    n_payments: merged.picks.length,
    broker_dynamic_quote: merged.picks.some(p => p.broker_dynamic),
    note: merged.picks.length > 1
      ? `User must send ${merged.picks.length} separate USDT payments (one per maker, ${merged.picks.filter(p=>p.broker_dynamic).length} of which is broker self-quoted).`
      : (merged.picks[0]?.broker_dynamic ? 'Broker self-quoted (no maker available, broker uses own KAS inventory).' : 'Single maker, one USDT payment.'),
  };
}

// T-J2-V2 (Owner 真测 #2 退场后立项): broker 主动反查 BSC USDT 入账, 不让 user 手贴 tx hash.
// LLM tool verify_payment 调此. 兜底/lazy 路径, 主路径是 NWT bsc-incoming-watcher (eager 后台监听).
//
// 流程: peer 已 _pendingAccepts → 扫 broker BSC 钱包近 5min 收款 → 匹 amount 任一 unpaid pick ± 1%
//   tolerance + (若知 taker_payment_address) 匹 from → 找到 → 调 _enqueuePaid 推 paid_v1 协议 →
//   exchange-machine processPaymentSubmit → cross-chain-verify → 自动 deliver KAS.
//
// 找不到 → return ok:false reason='no_match', LLM 拿到自然回 user '没查到, 麻烦发 tx hash 或截图'.
export async function verifyPaymentForPeer({ peer, chain }) {
  if (!peer) return { ok: false, reason: 'missing_peer' };
  const accept = _pendingAccepts.get(peer);
  if (!accept) return { ok: false, reason: 'no_active_order', user_msg: '没查到 active 订单. 你下过单吗? 先告诉我数量 + 链.' };
  if (Date.now() >= accept.expires_at) {
    _pendingAccepts.delete(peer);
    return { ok: false, reason: 'order_expired', user_msg: '订单已超时 (30min). 重新下单回 "买 X KAS".' };
  }
  const payChain = String(chain || accept.pay_chain).toLowerCase();
  // T-J1-2026-04-27 v1.1: 真扩 SUPPORTED_EVM_CHAINS from cross-chain-verify.EVM_RPC (7 chain)
  // 老 hardcode ['bnb','eth','polygon'] 真过保守 — scanRecentTransfers 已 generic.
  const { EVM_RPC: _EVM_RPC } = await import('./cross-chain-verify.mjs');
  const supportedEvmChains = Object.keys(_EVM_RPC || {});
  if (!supportedEvmChains.includes(payChain)) {
    return { ok: false, reason: 'unsupported_chain', user_msg: `${payChain} 暂不支持自动反查 (现 supported: ${supportedEvmChains.join('/')}). 麻烦发 tx hash 或截图.` };
  }
  // broker BSC 钱包 (collected_to)
  const wallet = sqlite.prepare(`SELECT address FROM agent_wallets WHERE relay_node_id=? AND chain=? AND is_default=1`).get(BROKER_RELAY_ID, payChain);
  if (!wallet?.address) return { ok: false, reason: 'no_broker_wallet', user_msg: `broker 这边没 ${payChain} 收款地址, 等等.` };

  const scanRes = _scanOverride
    ? await _scanOverride({ chain: payChain, recipient: wallet.address, span_blocks: 1500 })
    : await (await import('./cross-chain-verify.mjs')).scanRecentTransfers({ chain: payChain, recipient: wallet.address, span_blocks: 1500 });
  if (!scanRes.ok) return { ok: false, reason: 'scan_failed', error: scanRes.error, user_msg: `链上反查暂时失败 (${scanRes.error}). 麻烦发 tx hash, 我帮核对.` };

  // 找未付 pick 匹 amount ± 1% tolerance
  const tolerance = 0.01;
  const matched = [];
  for (const pick of accept.picks.filter(p => !p.paid_tx)) {
    const expected = pick.take_usdt;
    const found = scanRes.events.find(e => {
      const diff = Math.abs(e.amount - expected) / expected;
      return diff <= tolerance;
    });
    if (found) matched.push({ pick, event: found });
  }
  if (matched.length === 0) {
    return {
      ok: false, reason: 'no_match',
      scanned_events: scanRes.events.length,
      pending_amount_usdt: accept.picks.filter(p => !p.paid_tx).reduce((s, p) => s + p.take_usdt, 0).toFixed(4),
      user_msg: scanRes.events.length === 0
        ? `broker BSC 收款地址 ${wallet.address.slice(0,8)}... 近 75min 没看到任何 USDT 入账. 你 tx 可能还没确认 (BSC 通常 ~30s 出块, 满 15 conf 才扫得到, 等 1-2min 再问我?). 或者发 tx hash 0x...`
        : `近 75min ${scanRes.events.length} 笔 USDT 入账, 但金额都不匹你单子 (期望 ${accept.picks.filter(p=>!p.paid_tx).reduce((s,p)=>s+p.take_usdt,0).toFixed(4)} USDT). 麻烦发 tx hash 我精确核对.`,
    };
  }
  // 找到 → push paid_v1 + 标记 pick paid_tx (走跟 PAID_REGEX 同样的代发协议路径)
  const results = [];
  for (const { pick, event } of matched) {
    pick.paid_tx = event.tx_hash;
    _enqueuePaid(pick.id, event.tx_hash, payChain, peer);
    results.push({ offer_id: pick.id, payment_tx: event.tx_hash, amount: event.amount });
  }
  const remaining = accept.picks.filter(p => !p.paid_tx).length;
  if (remaining === 0) _pendingAccepts.delete(peer);
  return {
    ok: true,
    matched: results,
    remaining_picks: remaining,
    user_msg: remaining === 0
      ? `✓ 链上找到你 ${matched.length} 笔 USDT 入账 (tx ${matched[0].event.tx_hash.slice(0,12)}...). 自动验证中, ~30-60s 后我发 KAS 到你 Kasia.`
      : `✓ 找到 ${matched.length} 笔, 还差 ${remaining} 笔. 已发的会自动确认.`,
  };
}

// 三层 fallback 合并器: 拼现成 + broker 自挂补 deficit. 给 finalizeBuy/handleBuyIntent 复用.
// 返回 { ok, total_kas, total_usdt, picks: [{id, take_qty, take_usdt, maker_addr, broker_dynamic?}] }
// 单测可用 _testInjectPublishOffer 注入 mock _brokerPublishKasOffer.
export async function _aggregateWithFallback(qty, payChain, give_asset = 'KAS') {
  // T-NWT-2026-04-27 v1.1 Phase A step 2: give_asset 参数化 propagation 到 selectBestOffers + _brokerPublishKasOffer (default 'KAS' 向后兼容).
  const sel = selectBestOffers(qty, payChain, give_asset);
  let picks = sel.picks ? [...sel.picks] : [];
  let cumKas = picks.reduce((s, p) => s + p.take_qty, 0);

  if (cumKas < qty) {
    // 拼现成不够, broker 自挂补 deficit
    const deficit = qty - cumKas;
    const pub = _publishOverride ? await _publishOverride(deficit, payChain) : await _brokerPublishKasOffer(deficit, payChain, give_asset);
    if (!pub.ok) {
      // 全失败: broker 也无价格 / 无库存 / publish 失败 → 真 fail
      return { ok: false, available: cumKas, picks, error: `aggregation insufficient (${cumKas}/${qty} from makers) + broker self-quote failed: ${pub.error}` };
    }
    picks.push({
      id: pub.offer_id,
      take_qty: deficit,
      take_usdt: parseFloat(pub.want_usdt),
      maker_addr: pub.maker_chain_addr,
      broker_dynamic: true,
    });
    cumKas += deficit;
  }

  const totalUsdt = picks.reduce((s, p) => s + p.take_usdt, 0);
  return { ok: true, total_kas: cumKas, total_usdt: totalUsdt, picks };
}

// T-J2-09 broker_accept_record — completion-watcher 用此查 (offer_id → user) 关联
function _recordAccept({ offerId, userPeer, qty, quotedUsdt, payChain, acceptTx }) {
  try {
    sqlite.prepare(`
      INSERT INTO chain_events (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
      VALUES (?, ?, ?, 'broker_accept_record', ?, 'broker-buy-handler', datetime('now'))
    `).run(
      `broker_accept_${acceptTx || offerId}`,
      BROKER_RELAY_ID, userPeer,
      JSON.stringify({ offer_id: offerId, user_kasia_address: userPeer, qty, quoted_usdt: quotedUsdt, pay_chain: payChain, accept_tx: acceptTx })
    );
  } catch (e) { console.warn(`[broker-buy] record err: ${e.message}`); }
}

// R4 改造: handler 不直接发 reply DM (会撞 UTXO), 而是 enqueue 让 broker-action-queue 单线 pump.
// handler return '' 让 conversations.js → relay reply 路径变 silent (relay 看 reply='' = no DM).
// 用户视角: 自己发 "买 X KAS" → 几秒后从队列收到 broker 报价 DM.
async function _qDm(kind, peerAddr, message) {
  // T-J2-14 队列位置: snap pre-enqueue queue depth → "前面 N 笔待处理" 嵌 message 末尾.
  // T-J2-15 (R4 Bug 9): broker DM 末尾必带 4 字符唯一 tag, 避 relay anti-spam 14min "100% similar"
  // dedup 拦. 同 offer 同 qty 反复触发会 100% 相似, 加 tag 后内容必不同.
  const { getQueueStats } = await import('./broker-action-queue.js');
  const stats = getQueueStats();
  const queuePart = stats.length > 0 ? `(前面 ${stats.length} 笔, ~${Math.ceil(stats.length * 5)}s) ` : '';
  const tag = `#${randomUUID().slice(0, 4)}`;
  const suffix = `\n\n${queuePart}${tag}`;
  return _enqueue(kind, peerAddr, { message: message + suffix });
}

export async function handleBuyIntent(peerAddr, message) {
  const trimmed = (message || '').trim();

  // T-NWT-2026-04-26 case 6 STOP intent deterministic 短路 — user 烦了 / 想退出.
  // broker 立刻 ack 告别 (服务态度: 不啰嗦不命令式), 不进 LLM. 跟 PRICE_QUERY 同模式优先级最前.
  // _pendingAccepts 不动 (订单生命周期独立, 30min TTL 自动过期; user 想退也只是不想聊 broker, 已下单照走).
  if (_isStopIntent(trimmed)) {
    _qDm('dm_stop', peerAddr, '好的, 不打扰你了. 想买卖 KAS 随时回我 "买/卖 X KAS".');
    return '';
  }

  // T-NWT-V2-hotfix (Owner 真测 #3 实战修): 询价 deterministic 短路, 不进 LLM (60s timeout).
  // 询价是高频 deterministic 场景 — broker 知现价, 不需要 LLM 推理.
  // 放最前: 即使 user 在 _quotes / _pendingAccepts 状态, 询价也优先回价 (中途想再问也 OK).
  if (PRICE_QUERY_REGEX.test(trimmed)) {
    try {
      const { fetchKasPrice } = await import('./market-seeder.js');
      const p = await fetchKasPrice();
      const msg = p && p > 0
        ? `KAS 现价 $${p.toFixed(6)} USDT/KAS\n· broker 自挂卖价 $${(p * 1.01).toFixed(6)} (含 1% spread)\n· 想买告诉我数量 + 链 (BSC/POL/SOL/TRON), 例: "买 50 KAS"`
        : `价格暂时拿不到 (上游 8 源全没响应), 稍等 1min 再问. 或直接告诉我数量我帮你查.`;
      _qDm('dm_price_query', peerAddr, msg);
    } catch (e) {
      _qDm('dm_price_query', peerAddr, `价格查询暂时失败 (${e.message?.slice(0, 40)}). 稍等再问.`);
    }
    return '';
  }

  const pending = _quotes.get(peerAddr);

  // 用户确认 pending quote → 多笔 enqueue accept_v1 + 一条聚合 dm_pay_instr 列出所有 maker 付款指引
  if (pending && Date.now() < pending.expires_at) {
    if (CONFIRM_WORDS.includes(trimmed)) {
      _quotes.delete(peerAddr);
      // R7 路径 C: pending.picks 是数组. 给每个 pick enqueue accept + 跟踪 paid 状态
      _pendingAccepts.set(peerAddr, {
        picks: pending.picks.map(p => ({ ...p, paid_tx: null })),
        total_kas: pending.total_kas,
        total_usdt: pending.total_usdt,
        pay_chain: pending.pay_chain,
        expires_at: Date.now() + PENDING_ACCEPT_TTL_MS,
      });
      for (const p of pending.picks) {
        await _enqueueAccept(p.id, peerAddr, pending.pay_chain);
        _recordAccept({ offerId: p.id, userPeer: peerAddr, qty: p.take_qty, quotedUsdt: p.take_usdt.toFixed(6), payChain: pending.pay_chain, acceptTx: null });
      }
      // T-NWT-V2 议 1 (Owner 要求 #1: 起码的订单确认 UX): 拆 2 条 DM —
      // 第 1 条 dm_order_confirmed 明确告诉 user "订单已确认", 第 2 条 dm_pay_instr 纯付款指引.
      // 之前一条混 "✓ 已接单. 请付:" user 不知道是 "确认了" 还是 "马上要付". 拆开心里有底.
      // FIFO 单线 pump 保证 user 先收订单确认, 后收付款指引.
      const orderId = pending.picks[0].id.slice(0, 8) + (pending.picks.length > 1 ? `+${pending.picks.length - 1}` : '');
      const orderType = pending.picks.length === 1
        ? (pending.picks[0].broker_dynamic ? 'broker 自挂' : '单 maker')
        : `拼 ${pending.picks.length} 笔`;
      _qDm('dm_order_confirmed', peerAddr,
        `📋 订单已确认 #${orderId}\n· 买 ${pending.total_kas} KAS / 付 ${pending.total_usdt.toFixed(6)} USDT (${pending.pay_chain.toUpperCase()})\n· ${orderType}\n· 我马上把付款地址发给你, 收到付款自动验证 + 自动发 KAS, 全程不用你查链.`);
      const lines = pending.picks.map((p, i) =>
        `${i+1}. ${p.take_qty} KAS → 付 ${p.take_usdt.toFixed(6)} USDT 到 ${p.maker_addr?.slice(0,22)||'?'}...${p.maker_addr?.slice(-6)||''}`
      ).join('\n');
      const note = pending.picks.length > 1
        ? `\n\n注意: 共 ${pending.picks.length} 笔 USDT 转账 (拼单聚合). 付完不用回复, 我会自动检测; 慢则 1-2min, 快则 30s. 想加速可回 "我付了 0xTX".`
        : `\n\n付完不用回复, 我会自动检测; 慢则 1-2min, 快则 30s. 想加速可回 "我付了 0xTX".`;
      _qDm('dm_pay_instr', peerAddr,
        `请 30min 内付:\n${lines}${note}`);
      return '';
    }
    if (CANCEL_WORDS.includes(trimmed)) {
      _quotes.delete(peerAddr);
      _qDm('dm_quote', peerAddr, `已取消报价. 重新下单回"买 X KAS".`);
      return '';
    }
  }

  // PAID intent: 用户回 "我付了 0xtx..." → 一次匹配一个 unpaid pick (FIFO)
  const accept = _pendingAccepts.get(peerAddr);
  if (accept) {
    if (Date.now() >= accept.expires_at) {
      _pendingAccepts.delete(peerAddr);
    } else {
      // T-J2-26 (Owner 真测 04-26 12:18 — Bug A 引导): "已付!" / "paid" / "搞定" 等无 tx hash 的支付完成信号
      // → 主动引导发 BSC tx hash, 截胡 LLM 防误判调 finalize_order 重复下单.
      // 必须放在 PAID_REGEX (含 0x hex) 检测之前 — 但只在 message 不含 0x hex 时触发.
      if (PAID_NO_TX_REGEX.test(trimmed)) {
        _qDm('dm_paid_no_tx', peerAddr,
          `感谢. 请发你的 BSC tx hash (0x 开头 64 位 hex) — 系统自动上链验证 USDT 收款 + 自动发 KAS, 1-2 分钟到账. 格式例: "我付了 0xabc123..."`);
        return '';
      }
      const pm = PAID_REGEX.exec(trimmed);
      if (pm) {
        const paymentTx = pm[1];
        const nextUnpaid = accept.picks.find(p => !p.paid_tx);
        if (!nextUnpaid) {
          _qDm('dm_completion', peerAddr, `所有 ${accept.picks.length} 笔已确认, 无待付项.`);
          return '';
        }
        nextUnpaid.paid_tx = paymentTx;
        _enqueuePaid(nextUnpaid.id, paymentTx, accept.pay_chain, peerAddr);
        const remaining = accept.picks.filter(p => !p.paid_tx).length;
        if (remaining === 0) {
          _pendingAccepts.delete(peerAddr);
          _qDm('dm_completion', peerAddr,
            `✓ 全部 ${accept.picks.length} 笔付款已收 (最后 tx ${paymentTx.slice(0,12)}...). Maker 验证后陆续发 ${accept.total_kas} KAS 到你 Kasia.`);
        } else {
          _qDm('dm_completion', peerAddr,
            `✓ 付款 ${paymentTx.slice(0,12)}... 已确认 (#${accept.picks.findIndex(p => p.paid_tx === paymentTx)+1}/${accept.picks.length}). 还差 ${remaining} 笔.`);
        }
        return '';
      }
    }
  }

  // 解析买意图 → 拼单 + 报价 DM 入队
  const m = BUY_REGEX.exec(trimmed);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (qty <= 0) return null;
  // T-J1-19a + T-J2-20 合并: dust qty / 拼单+自挂全失败 → return null 让 broker-llm-agent
  // 接管 LLM 友好拒. handler 不发静态 DM 避免截胡 LLM.
  if (qty < MIN_QTY_KAS) {
    return null;  // LLM 用自然语言告知 dust 限制 (broker fee + 最小 1 KAS)
  }

  const payChain = 'bnb';
  const merged = await _aggregateWithFallback(qty, payChain);
  if (!merged.ok) {
    return null;  // LLM 接管: 现 maker 不够 + 自挂也失败, LLM 友好回 "暂无报价, 等等 / 改小 / 别的链"
  }
  const unit = merged.total_usdt / merged.total_kas;
  _quotes.set(peerAddr, {
    picks: merged.picks,
    total_kas: merged.total_kas,
    total_usdt: merged.total_usdt,
    pay_chain: payChain,
    expires_at: Date.now() + QUOTE_TTL_MS,
  });
  const dynamicCount = merged.picks.filter(p => p.broker_dynamic).length;
  const breakdown = merged.picks.length === 1
    ? (merged.picks[0].broker_dynamic ? `· broker 自挂 (无 maker)` : `· 1 个 maker (单笔)`)
    : `· 拼 ${merged.picks.length} 笔: ${merged.picks.map(p => `${p.take_qty}${p.broker_dynamic?'(broker)':''}`).join('+')} = ${merged.total_kas} KAS`;
  const dynNote = dynamicCount > 0
    ? `\n· 含 broker 自挂 ${dynamicCount} 笔 (市价+1% spread, broker 用自己 KAS 库存)`
    : '';
  _qDm('dm_quote', peerAddr,
    `📋 买 ${qty} KAS 报价:\n${breakdown}${dynNote}\n· 实成交: ${merged.total_kas} KAS\n· 平均单价 ${unit.toFixed(6)} USDT/KAS\n· 你付总: ${merged.total_usdt.toFixed(6)} USDT (${payChain.toUpperCase()}, 分 ${merged.picks.length} 笔)\n\n确认回 YES (5min). 取消回 NO.`);
  return '';
}
