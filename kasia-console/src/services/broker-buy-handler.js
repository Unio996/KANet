// ════════════════════════════════════════════════════════════════
// HIGH-RISK FILE (Critical 8 per docs/COLLAB-REFORM.md 规 10/13/15)
// 改前必跑: grep -nE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+' 本 file
// 改后 commit msg 必含: acknowledged: T-X-X (per surfaced anti-pattern)
// 关联 docs: ANTI-PATTERNS R37+ / DEVELOPER-GUIDE ch19
// 关键历史: T-J2-26 idempotency (Bug-B 重复 publish 防御) / Bug-Y wire (买 stable EVM addr)
//          / Bug-Z11 attack (address change attempt) / R33 b iter (multi-turn state)
// blast radius: BUY flow finalize / fund_lock / _pendingPreview state authority
// ════════════════════════════════════════════════════════════════
//
// broker-buy-handler.js — Phase 4 A 模式撮合 (T-J2-08, v2.1.1)
// 用户 DM "买 X KAS" → 选 best open offer → 报价 → 用户 YES → 广播 accept_v1
// 复用 exchange_offers + exchange-machine, 不自建状态机不自建订单表.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import {
  getConvoState,
  setConvoStateLock,
  resetConvoState,
  shouldDeterministicFire,
} from './broker-state-authority.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
// T-J2-2026-04-27 v1.1: 真扩 BUY_REGEX 同 BUY_OVERRIDE_REGEX (broker-sell-handler line 14) 模式
// + SELL_REGEX 真扩 (63a953de3) 对称真扩同义词 — 真 deterministic fast path 跳 LLM 1-2s
// 加 '想买/要买/购买/购/想换/搞/弄/来点/想要/我要/want/get/grab/take/need/cop/gimme/quiero'
// R33 b iter6 (NWT c5bda126 fuzz negative trace 实证): regex 加 optional sign capture, 后续代码
// 真**真**真 reject negative — 真**真**真 silent normalize '-5' → '+5' (production typo 真**真**charge mismatch).
const BUY_REGEX = /^\s*(?:买|buy|想买|要买|购买|购|想换|搞|弄|来点|想要|我要|want|get|grab|take|need|cop|gimme|fetch|quiero|necesito)\s*(-?\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*KAS\s*$/i;
// T-J1-19a (J2 probe-5a 暴露): broker dust 单接受漏洞 — finalizeBuy / _aggregateWithFallback
// 必须拒小于 MIN_QTY 的请求, 否则 broker 锁 fund_locks 浪费 broadcast tx + 用户 dust 被 broker fee 吃光.
const MIN_QTY_KAS = 1.0;
// R33 b iter7 (NWT 309b19af huge_qty trace 实证): upfront sanity check 拒 unreasonable qty.
// 99M / 1B KAS 真**真**unambiguously not real user intent + no maker inventory 真**真**真 publish-time fail.
// upfront 拒 + suggest 分批 = friendly + 不浪费 broker publish broadcast.
const MAX_QTY_KAS = 1_000_000;  // 1M KAS soft cap (beyond → upfront reject + suggest split).
// T-J2-12 真人 PAID 意图: "我付了 0xabc...", "已付 0x...", "paid 0x...", "pay 0x..."
// J2-r6 export — broker-v2/router B1 PAID detect 复用 (单 source regex)
export const PAID_REGEX = /(?:已付|付了|我付|paid|pay)[\s\S]{0,40}?\b(0x[a-fA-F0-9]{64})\b/i;
// T-J2-26 (Owner 真测 04-26 12:18): "已付!" 等支付完成意图 但无 tx hash → broker 必须主动引导发 tx
// 否则 LLM 误判走 finalize_order 重复下单 (Owner 这单实例: 43c0a4f8 已付后第 3 次 publish).
// T-J2-NWT-27c (Owner 真测 04-26 15:30 漏): "已经支付" 漏 → broker 静默 → Owner '请你们自己处理'.
// 扩 PAID_NO_TX 自然话变体 + 加 (?:了)? 完成态助词后缀 (J1 case 2 v6 '转完了 1/12 timeout' 真因).
export const PAID_NO_TX_REGEX = /^(?:已付|付了|已转|转完|已支付|已转账|已经支付|已经付款|付款了|支付了|支付完成|支付好了|完成|done|paid|sent|finished|转好了|付好了|搞定|ok 付了|已经付了)\s*(?:了)?\s*[!！。.…]*\s*$/i;
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
// T-NWT-2026-04-27 Bug 7 hotfix: preview 后 set, 'YES' confirm 真 deterministic finalizeBuy 真 propagate
// give_asset (LLM tool calling 真不可靠 — 真 USDC/USDT 真 LLM hallucinate "下单成功" 真 0 publish 真灾难).
// 跟 _quotes (KAS BUY_REGEX path) 同 pattern broker handler in-memory state.
const _pendingPreview = new Map();  // peer → {qty, pay_chain, give_asset, receive_address, expires_at}
const PENDING_PREVIEW_TTL_MS = 30 * 60 * 1000;  // 30min, same as _pendingAccepts
export function _setPendingPreview(peer, data) { _pendingPreview.set(peer, { ...data, expires_at: Date.now() + PENDING_PREVIEW_TTL_MS }); }
export function _getPendingPreview(peer) {
  const p = _pendingPreview.get(peer);
  if (!p || Date.now() >= p.expires_at) { _pendingPreview.delete(peer); return null; }
  return p;
}

// R-NWT-2026-04-28 (d) B phase 5: test-only — clear ALL per-peer Maps in this handler.
// 跟 broker-llm-agent.js _testClearPendingFields 同模式. production 不准 import (lint 守).
// J2 path B cross-peer race tests cleanup_peer_broker_state action 用此.
export function _testClearPeerState(peer) {
  if (peer) {
    _quotes.delete(peer);
    _pendingAccepts.delete(peer);
    _pendingPreview.delete(peer);
  } else {
    _quotes.clear();
    _pendingAccepts.clear();
    _pendingPreview.clear();
  }
}
export function _clearPendingPreview(peer) { _pendingPreview.delete(peer); }
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

function selectBestOffer(qtyKas, payChain, give_asset = 'KAS', want_asset = 'USDT') {
  // R5 T-J2-17 (Bug 10): broker 不 self-accept, 排除自己 maker 的 offer.
  // T-NWT-2026-04-27 v1.1 Phase A step 2: give_asset 参数化 (default 'KAS' 向后兼容).
  // T-J1-2026-04-27 v1.2 R30 Service primitive 真 align (NWT 5a9db463f generic 真 J1 own clean):
  //   want_asset 参数化 (default 'USDT' 向后兼容) — 真 cover USDC↔USDT pair / cross-stable
  //   future Service: KAS-USDC-BSC / USDC-USDT-Polygon / etc. 真 single SQL filter 真 generic.
  const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
  const brokerAddr = broker?.address || '';
  const rows = sqlite.prepare(`
    SELECT id, give_amount, want_amount, verification_meta, maker
    FROM exchange_offers
    WHERE protocol_status = 'open'
      AND give_asset = ? AND want_asset = ?
      AND CAST(give_amount AS REAL) >= ?
      AND maker != ?
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
    ORDER BY CAST(want_amount AS REAL) / CAST(give_amount AS REAL) ASC
    LIMIT 10
  `).all(give_asset, want_asset, qtyKas, brokerAddr);
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
export function selectBestOffers(qtyKas, payChain, give_asset = 'KAS', want_asset = 'USDT') {
  // T-NWT-2026-04-27 v1.1 Phase A step 2: give_asset 参数化 (default 'KAS' 向后兼容).
  // T-J1-2026-04-27 v1.2 R30 Service primitive align: want_asset 参数化 (default 'USDT').
  const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
  const brokerAddr = broker?.address || '';
  const rows = sqlite.prepare(`
    SELECT id, give_amount, want_amount, verification_meta, maker
    FROM exchange_offers
    WHERE protocol_status = 'open'
      AND give_asset = ? AND want_asset = ?
      AND maker != ?
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
    ORDER BY CAST(want_amount AS REAL) / CAST(give_amount AS REAL) ASC
    LIMIT 30
  `).all(give_asset, want_asset, brokerAddr);
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
async function _brokerPublishKasOffer(qtyKas, payChain, give_asset = 'KAS', want_asset = 'USDT') {
  // T-NWT-2026-04-27 v1.1 Phase A step 2: give_asset 参数化 (default 'KAS' 向后兼容).
  // T-J1-2026-04-27 v1.2 R30 Service primitive align (NWT 5a9db463f generic + J1 own clean):
  //   want_asset 参数化 (default 'USDT'). 真 future Service KAS-USDC-BSC / USDC-USDT-Polygon
  //   真 publish 真 stable-pair 真 generic. 真 broker accepts user pay 真 want_asset symbol 真 lowercase.
  // Idempotency: 5min 内同 chain + 同 qty + 同 asset 已挂 broker_dynamic_quote open → 复用
  const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
  if (broker?.address) {
    // T-J2-2026-04-27 v1.1 Bug 8 真 fix (J1 24:50 真测撞 老 expired offer 真因连锁):
    // idempotency reuse 加 expires_at > now check — 防 reuse 真 expired offer (虽然 5min window
    // 真已 narrow, 但 broker_dynamic_quote 60min expires 真长 — 5min idempotency 内 expired = 真不能 reuse).
    const existing = sqlite.prepare(`
      SELECT id, want_amount, verification_meta, created_at
      FROM exchange_offers
      WHERE maker = ? AND protocol_status = 'open'
        AND give_asset = ? AND CAST(give_amount AS REAL) = ?
        AND json_extract(metadata, '$.source') = 'broker_dynamic_quote'
        AND julianday(created_at) > julianday('now', '-5 minutes')
        AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
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
  // T-J2-2026-04-27 + T-J1-2026-04-27 v1.1 Bug 5+6 真 fix (NWT merge: J2 471c1a505 + J1 cf5e8d4f same fix):
  // 之前 fix 在 buyPreview line 271 (preview only), 真 publish path _brokerPublishKasOffer 仍 fetchKasPrice
  // hardcode → 任意 give_asset 真 publish use KAS 价 0.0342 = 真 production 灾难 (USDC/USDT 真上链
  // want=0.0171 = 真 100x 损). 真改 fetchPrice generic + Bug 6 publish body give_asset literal → 参数化.
  const { fetchPrice } = await import('./price-oracle.js');
  const priceResult = await fetchPrice(give_asset, want_asset);
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
  const wantAmount = (qtyKas * sellPrice).toFixed(4);
  const PORT = process.env.CONSOLE_PORT || 3100;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/exchange/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // T-J2-2026-04-27 Bug 6 真修: give_asset hardcode 'KAS' → 参数 (Bug 5 修了价 oracle, 但 publish body 还 hardcode KAS = generic 化半残)
        // T-J1-2026-04-27 v1.2 R30: want_asset 参数化 (USDT default → 真 USDC/DAI cross-stable expand).
        relayNodeId: BROKER_RELAY_ID,
        give_asset,  // T-J2 + T-J1 Bug 6 真修: literal 'KAS' → give_asset 参数
        give_amount: String(qtyKas),
        give_chain: give_asset === 'KAS' ? 'kaspa' : payChain,  // KAS 在 Kaspa, stable 在 EVM (同 payChain)
        want_asset,  // T-J1-2026-04-27 v1.2 R30: literal 'USDT' → want_asset 参数
        want_amount: wantAmount,
        verification: 'cross_chain_tx',
        verification_meta: { accepted_chains: [{ chain: payChain, address: wallet.address }], expected_asset: want_asset },
        expires_minutes: 60,  // R2 (J2 推): 30→60 防 25min 慢付 → broker cancel → 资金事故
        metadata: { source: 'broker_dynamic_quote', mid_price: midPrice, spread_pct: SPREAD_PCT, give_asset },
      }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: `publish: ${data.error || 'http_' + res.status}` };
    // T-J1-2026-04-27 v1.2 R30: want_usdt 字段名 retained for caller backward-compat (callers expect want_usdt in result).
    // 真 callers (line 534 take_usdt: pub.want_usdt) 真 not yet generic 真 deeper refactor — preserve key for compat.
    return { ok: true, offer_id: data.offer_id, want_usdt: wantAmount, maker_chain_addr: wallet.address, mid_price: midPrice, sell_price: sellPrice };
  } catch (e) {
    return { ok: false, error: `publish_exc: ${e.message}` };
  }
}

// R4 改造 (T-NWT-09 broker-action-queue): 不直接 sendCommandAsync, 进队列保 FIFO 单线.
async function _enqueue(kind, peer, payload) {
  const { enqueue } = await import('./broker-action-queue.js');
  return enqueue({ kind, peer, payload });
}

function _enqueueAccept(offerId, peerAddr, payChain, evmRecvAddr = null, opts = {}) {
  // T-J2-2026-04-27 v1.2 (c) — 加 evm_recv_address 字段, 解决 USDC delivery silent fail.
  // 老 receive_address = user kasia (KAS path 用), 新 evm_recv_address = user EVM (USDC/USDT path 用).
  // backward compat: 老 client 没 evm_recv_address → KAS path 仍 work.
  //
  // NWT 2026-04-29 broker-v2 阶段 2 task 3/7 — 加 amount + price chunk fields:
  // - amount (chunk_qty): 缺省 null = full give_amount (backward compat)
  // - price (chunk_price): 缺省 null = no tolerance check (receiver 跳过 1% 校验)
  // - exchange-machine.processAccept 5efa756a0 receiver 端已支持
  const payload = {
    t: 'kanet_exchange_accept_v1',
    offer_id: offerId,
    selected_chain: payChain,
    payment_asset: 'usdt',
    receive_address: peerAddr,
    evm_recv_address: evmRecvAddr || null,
  };
  if (opts.amount !== undefined && opts.amount !== null) {
    payload.amount = opts.amount;
  }
  if (opts.price !== undefined && opts.price !== null) {
    payload.price = opts.price;
  }
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
export async function buyPreview({
  user_kasia, qty, pay_chain, give_asset = 'KAS', receive_address = null,
  // R33 b iter3 (J1 NWT GAP B 修): user conditions, MUST handle (accept OR explicit reject)
  limit_price = null,
  refund_timeout_min = null,
}) {
  if (!user_kasia || !qty || qty <= 0 || !pay_chain) {
    return { ok: false, error: 'missing fields (user_kasia/qty/pay_chain)' };
  }
  // T-NWT-2026-04-27 v1.1 NLG receive_address fix (NWT 真测发现 USDC preview 显 'kaspa:' addr 真错):
  // KAS 真 receive 用 user_kasia (Kasia network). 非 KAS asset 真 receive 真要 user EVM/Sol/Tron addr.
  // receive_address 真省 (KAS default) → use user_kasia. 真 stable asset 真传 receive_address.
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
  // T-NWT-2026-04-27 generic化 (Owner 12:51 钦定 '任何资产能复用'): per-asset minQty 走 registry
  // 之前 MIN_QTY_KAS = 1.0 hardcoded 对所有 asset 用 → USDC/USDT (registry minQty 0.1) 被错拒
  // 跟 sellPreview 同范式 (giveMeta.minQty)
  const minQty = assetMeta.minQty || MIN_QTY_KAS;
  if (qty < minQty) {
    return { ok: false, error: `qty_too_small`, message: `最小买 ${minQty} ${give_asset} (broker fee + dust 保护). 改大点.` };
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
    // T-J2 + T-J1-2026-04-27 v1.1 Bug 3+5 真 fix (NWT merge same fix):
    // J2 #3 23:26 真测撞 USDT/USDC 价 = 0.0342 (KAS 价当 stable) — fetchPrice('KAS') hardcode 真错.
    // 老 hardcode → 任意 give_asset 真 query KAS 价 = 真 production 灾难 (user 'buy 1 USDC' 真转
    // 0.0342 USDT 真便宜 100x). 真 fix: fetchPrice(give_asset, 'USDT') generic.
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
  let totalUsdt = picks.reduce((s, p) => s + p.take_usdt, 0);
  let unitPrice = totalUsdt / cumKas;

  // R33 b iter3: user-supplied conditions handling — broker accept (within ±5% oracle) OR 明确 reject
  let conditionLines = '';
  if (limit_price !== null && limit_price > 0) {
    let oracleMid = unitPrice;
    try {
      const { fetchPrice } = await import('./price-oracle.js');
      const pr = await fetchPrice(give_asset, 'USDT');
      if (pr.ok && pr.price > 0) oracleMid = pr.price;
    } catch {}
    const dev = (limit_price - oracleMid) / oracleMid;
    if (Math.abs(dev) <= 0.05) {
      // broker accept user limit (BUY: user pays at limit_price, broker uses it for total)
      unitPrice = limit_price;
      totalUsdt = +(cumKas * unitPrice).toFixed(6);
      conditionLines += `\n* 用户限价: **${limit_price} USDT/${give_asset}** ✓ broker 接受 (CEX 中价 ${oracleMid.toFixed(6)}, 偏差 ${(dev*100).toFixed(2)}% 在 ±5% 内)`;
    } else {
      conditionLines += `\n* 用户限价: ${limit_price} USDT/${give_asset} ✗ broker **不接受** (CEX 中价 ${oracleMid.toFixed(6)}, 偏差 ${(dev*100).toFixed(2)}% 超 ±5%). 接受按市价 ${unitPrice.toFixed(6)} OR 取消重下.`;
    }
  }
  if (refund_timeout_min !== null && refund_timeout_min > 0) {
    if (refund_timeout_min < 120) {
      conditionLines += `\n* 退款时限请求: ${refund_timeout_min} 分钟 ✗ broker **不接受** (broker 退款最少 2h 即 120 分钟, chain confirmation + dispute window 需要). 接受 broker 默认 2h OR 取消重下.`;
    } else {
      conditionLines += `\n* 退款时限: ${refund_timeout_min} 分钟 ✓ broker 接受 (覆盖默认 2h)`;
    }
  }
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

  // T-NWT-2026-04-27 报价信息丰富化 (Owner 11:08 钦定: 信任+信息双不足是 production blocker)
  // 4 段补强: (A) broker 身份 (B) 价格对比 (C) 安全说明 (D) 历史链上记录
  let trustCard = '';
  try {
    const brokerRow = sqlite.prepare('SELECT name, created_at FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
    const completedCount = sqlite.prepare(
      `SELECT COUNT(*) as n FROM exchange_offers WHERE maker = ? AND protocol_status = 'completed'`
    ).get(brokerRow ? sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID)?.address : '')?.n || 0;
    const daysActive = brokerRow?.created_at
      ? Math.floor((Date.now() - new Date(brokerRow.created_at).getTime()) / 86400000)
      : '?';
    trustCard = `🏷 **${brokerRow?.name || 'KANet broker'}** · Kasia 注册 ${daysActive} 天 · 累计完成 **${completedCount}** 笔成交`;
  } catch (e) { trustCard = '🏷 KANet broker'; }

  // (B) 价格对比 — 跟 CEX 中价比 spread%
  let priceCompare = '';
  try {
    const { fetchPrice } = await import('./price-oracle.js');
    const pr = await fetchPrice(give_asset, 'USDT');
    if (pr.ok && pr.price > 0) {
      const spreadPct = ((unitPrice - pr.price) / pr.price * 100);
      const spreadSign = spreadPct >= 0 ? '+' : '';
      priceCompare = `\n  (CEX 8 源中价 ${pr.price.toFixed(6)}, 本单 ${spreadSign}${spreadPct.toFixed(2)}% spread)`;
    }
  } catch (e) { /* 价格取不到不要紧, 跳过 */ }

  // (D) 历史链上履历 — 最近 3 笔 completed
  let historyLines = '';
  try {
    const brokerAddr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID)?.address;
    if (brokerAddr) {
      const recent = sqlite.prepare(`
        SELECT broadcast_tx_id, give_amount, give_asset, completed_at
        FROM exchange_offers
        WHERE maker = ? AND protocol_status = 'completed' AND broadcast_tx_id IS NOT NULL
        ORDER BY completed_at DESC LIMIT 3
      `).all(brokerAddr);
      if (recent.length > 0) {
        historyLines = '\n📊 **broker 最近成交** (Kaspa explorer 可验):\n' + recent.map(r =>
          `  · ${r.give_amount} ${r.give_asset} → tx \`${r.broadcast_tx_id?.slice(0, 10)}...${r.broadcast_tx_id?.slice(-6)}\``
        ).join('\n');
      }
    }
  } catch (e) { /* 历史取不到不要紧 */ }

  const preview_text = `📋 **订单画像 (确认前)**

${trustCard}

* 方向: 买 ${give_asset}
* 数量: ${cumKas} ${give_asset}
* 付款链: ${payChain.toUpperCase()} (USDT)
* 单价: ${unitPrice.toFixed(6)} USDT/${give_asset}${priceCompare}
* 总额: ${totalUsdt.toFixed(6)} USDT${conditionLines}
${payLines}
* ${give_asset} 收件 (你的 ${recvNetwork}):
  \`${assetMeta.chain === 'kaspa'
      ? user_kasia
      : (receive_address ? `${receive_address.slice(0, 6)}...${receive_address.slice(-4)} (你提供的 ${recvNetwork} 钱包)` : '⚠ 缺 receive_address — buy stable 真要传 user EVM/Sol/Tron 收款地址')}\`

🛡 **安全说明**
  · USDT 直付 maker, broker 不托管你的钱
  · broker fee 0.1 KAS 固定 (无隐藏)
  · 30min 未付款 → 自动取消, 你 USDT 不动
  · 跨链验证失败 → 自动 refund + dispute 通道
${historyLines}

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
export async function finalizeBuy({ user_kasia, qty, pay_chain, give_asset = 'KAS', receive_address = null }) {
  // T-NWT-2026-04-27 v1.1 Phase A step 1: give_asset 参数化, default 'KAS' 向后兼容.
  // T-J1-2026-04-27 v1.1 Bug-Y wire: 真接 receive_address (买 stable 真 user EVM addr 真存 _pendingAccepts
  // 后 deliver 层真用; 买 KAS null OK 真 default 用 user_kasia 自动 resolve).
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

  // T-J2-2026-04-27 v1.2 (c): 真传 EVM addr (买 stable 真 user EVM 收款 addr) 进 accept_v1
  // 真 receive_address 真 backward compat (= user kasia, KAS path 真用), evm_recv_address 真 stable 真用.
  const evmRecvForAccept = (give_asset !== 'KAS' && receive_address && !receive_address.startsWith('kaspa:')) ? receive_address : null;
  for (const p of merged.picks) {
    await _enqueueAccept(p.id, user_kasia, payChain, evmRecvForAccept);
    _recordAccept({ offerId: p.id, userPeer: user_kasia, qty: p.take_qty, quotedUsdt: p.take_usdt.toFixed(6), payChain, acceptTx: null });
  }
  // T-J2-26 (Owner 真测 04-26 12:18 — Bug A 静默根修):
  // finalize_order tool 路径 (LLM 调) 也必须 set _pendingAccepts. 之前只有 BUY_REGEX → handleBuyIntent →
  // _quotes → YES → _pendingAccepts 路径会 set, LLM 自然语言 "我想买 X" 走 deterministic + finalize_order
  // tool 不 set, 导致后续 PAID_REGEX (line 316) 永远匹配不到, broker 自动闭环全断.
  // Owner 真测 '空不？我想买55个Kas' 撞这条: broker 报价 + 创 offer + 但 _pendingAccepts 没 set,
  // Owner '已付！' / '我付了 0x...' 都进不了 PAID_REGEX, broker 静默或乱调 finalize_order 又一单.
  // T-J1-2026-04-27 v1.1 Bug-Y wire: 真存 receive_address (deliver 层真用 — 买 stable 真 user EVM addr;
  // 买 KAS null → deliver 真 default user_kasia auto-resolve, backward compat).
  _pendingAccepts.set(user_kasia, {
    picks: merged.picks.map(p => ({ ...p, paid_tx: null })),
    total_kas: merged.total_kas,
    total_usdt: merged.total_usdt,
    pay_chain: payChain,
    receive_address,
    give_asset,
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
async function _qDm(kind, peerAddr, message, extra = {}) {
  // T-J2-14 队列位置: snap pre-enqueue queue depth → "前面 N 笔待处理" 嵌 message 末尾.
  // T-J2-15 (R4 Bug 9): broker DM 末尾必带 4 字符唯一 tag, 避 relay anti-spam 14min "100% similar"
  // dedup 拦. 同 offer 同 qty 反复触发会 100% 相似, 加 tag 后内容必不同.
  // T-J2-2026-04-28 Phase D P2 (γ): extra.freshness_args propagates to broker-action-queue
  // dm_quote handler for state-staleness check before chain DM fire.
  const { getQueueStats } = await import('./broker-action-queue.js');
  const stats = getQueueStats();
  const queuePart = stats.length > 0 ? `(前面 ${stats.length} 笔, ~${Math.ceil(stats.length * 5)}s) ` : '';
  const tag = `#${randomUUID().slice(0, 4)}`;
  const suffix = `\n\n${queuePart}${tag}`;
  return _enqueue(kind, peerAddr, { message: message + suffix, ...extra });
}

export async function handleBuyIntent(peerAddr, message) {
  const trimmed = (message || '').trim();

  // R33 b iter9 (J2 81f8f1d8 mid_flow_restart 实证): user explicit cancel-and-restart 真**真 reset state.
  // 真**真 detectResetIntent 真**真**真**真 fresh fields (含 new direction) 真**真**真 R33 sticky direction
  // lock 真 attack-rejection 误伤 legitimate restart.
  if (trimmed) {
    try {
      const { detectResetIntent, resetConvoState } = await import('./broker-state-authority.js');
      if (detectResetIntent(trimmed)) {
        resetConvoState(peerAddr, 'user_restart');
      }
    } catch { /* import 兜底 */ }
  }

  // Owner 02:23 钦定 cancel-refund policy: user 指示取消 → 检 broker 持的 active offer →
  // 如 protocol_status=open && taker=null → cancel 上链 + sendKas refund (扣 fee) + DM ack.
  // 命中 refundable → 返回 ack 立刻 reply (跳过后续 BUY/SELL 路径). 没命中 → null fall through.
  // matched/verifying/delivering 状态 → handleCancelAndRefund 不动, 走 dispute (不在本 helper).
  if (trimmed) {
    try {
      const { detectCancelIntent, handleCancelAndRefund } = await import('./broker-cancel-refund.js');
      if (detectCancelIntent(trimmed)) {
        const refundReply = await handleCancelAndRefund(peerAddr);
        if (refundReply) return refundReply;
      }
    } catch (e) { console.warn(`[broker-buy] cancel-refund check err: ${e.message}`); }
  }

  // R33 b iter5b (NWT 90b29e39 Bug-Z13 trace 实证扩): EARLIEST setConvoStateLock 加固.
  // iter5 加在 handleLlmDialog L580 处, 但 NWT trace 实证 T2 reply EMPTY 231ms 不**真**真**LLM,
  // 真 deterministic path (handleBuyIntent 路径) 中**真**真**早 return** 没经 handleLlmDialog.
  // 修: 真 handleBuyIntent 入口先**真**真 detect intent='buy', 真**就 setConvoStateLock**, 不**等** BUY_REGEX
  // hit (BUY_REGEX 真 strict, '想买 3 KAS, BSC' 真**真**真 not match, 但 _detectIntent 仍**真**真 'buy').
  if (trimmed) {
    try {
      // import 在 fn body 真**真**避免 circular (broker-llm-agent imports broker-buy-handler too)
      const { _detectIntent } = await import('./broker-llm-agent.js');
      const intent = _detectIntent(trimmed);
      if (intent === 'buy') {
        setConvoStateLock(peerAddr, { direction: 'buy', lifecycle_phase: 'fields_collection' });
      }
    } catch (e) {
      if (e.code === 'CONVO_STATE_DIRECTION_LOCK') {
        return `订单方向已锁定 ${e.locked_direction.toUpperCase()}. 改方向请回 "NO" 取消订单, 重新下单告诉我新方向.`;
      }
      // import 失败 (circular OR module not loaded) 兜底, 不阻塞
    }
  }

  // R31 P1.b attacker (NWT 33c0fb3a 30 probe FAIL multi-addr-plant + r19-strip-replant):
  // 真 locked addr 后, 真**真**真 '改地址' literal OR 提 differing 0x... → R31 lifecycle-lock 拒.
  // 真**真**真 LLM 自由 echo attacker addr OR silent swap.
  if (trimmed) {
    try {
      const { detectAddrChangeAttempt } = await import('./broker-state-authority.js');
      const attempt = detectAddrChangeAttempt(peerAddr, trimmed);
      if (attempt.attempt) {
        return `订单地址已锁定 ${attempt.locked}. 改地址请回 "NO" 取消订单, 重新下单告诉我新地址.`;
      }
    } catch { /* import 兜底 */ }
  }

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
  // R33: SELL flow 中问价不能给 BUY 引导, 给 SELL 视角 (broker 收购价 = mid - spread).
  // R33 b iter1 v2 (NWT 15:10 根因纠正后): sync return only, drop _qDm 避免 duplicate DM.
  // production 路径 = relay getAIReply 用 sync return → 包 Kasia chain DM 给 user (kasia-relay/src/ai.mjs).
  // _qDm 之前用是 redundant — 同内容两次 chain DM = 双 TX 双 fee + user 看两遍.
  if (PRICE_QUERY_REGEX.test(trimmed)) {
    if (!shouldDeterministicFire(peerAddr, 'PRICE_QUERY', trimmed)) {
      try {
        const { fetchKasPrice } = await import('./market-seeder.js');
        const p = await fetchKasPrice();
        return p && p > 0
          ? `KAS 现价 $${p.toFixed(6)} USDT/KAS\n· broker 收购价 (你卖) $${(p * 0.99).toFixed(6)} (含 1% spread)\n· 已锁定 SELL flow, 想确认下单回 YES`
          : `价格暂时拿不到 (上游 8 源全没响应), 稍等 1min 再问.`;
      } catch (e) {
        return `价格查询暂时失败 (${e.message?.slice(0, 40)}). 稍等再问.`;
      }
    }
    try {
      const { fetchKasPrice } = await import('./market-seeder.js');
      const p = await fetchKasPrice();
      return p && p > 0
        ? `KAS 现价 $${p.toFixed(6)} USDT/KAS\n· broker 自挂卖价 $${(p * 1.01).toFixed(6)} (含 1% spread)\n· 想买告诉我数量 + 链 (BSC/POL/SOL/TRON), 例: "买 50 KAS"`
        : `价格暂时拿不到 (上游 8 源全没响应), 稍等 1min 再问. 或直接告诉我数量我帮你查.`;
    } catch (e) {
      return `价格查询暂时失败 (${e.message?.slice(0, 40)}). 稍等再问.`;
    }
  }

  // T-NWT-2026-04-27 Bug 7 hotfix: 'YES' confirm 真 _pendingPreview deterministic shortcut
  // (LLM-driven preview 真不 set _quotes — broker LLM 真 'YES' 真 LLM hallucinate 不调 finalize_order tool).
  // 真 _pendingPreview 真 set by preview_order tool (broker-llm-agent.js _executeTool). 真 hit 真直 finalizeBuy.
  const pp = _getPendingPreview(peerAddr);
  // T-J1-2026-04-28 Layer 7: 仅 BUY pp 在此 finalize. SELL pp 让过 → 落 handleLlmDialog 的 pp shortcut → finalize_order tool routes finalizeSell.
  if (pp && pp.direction !== 'sell' && CONFIRM_WORDS.includes(trimmed)) {
    _clearPendingPreview(peerAddr);
    const r = await finalizeBuy({
      user_kasia: peerAddr, qty: pp.qty, pay_chain: pp.pay_chain,
      give_asset: pp.give_asset || 'KAS', receive_address: pp.receive_address || null,
    });
    if (r.ok) {
      const orderId = r.picks?.[0]?.offer_id?.slice(0,8) || randomUUID().slice(0,8);
      _qDm('dm_order_confirmed', peerAddr,
        `📋 订单已确认 #${orderId}\n· 买 ${r.total_kas} ${pp.give_asset || 'KAS'} / 付 ${r.total_usdt} USDT (${pp.pay_chain.toUpperCase()})\n· 我马上把付款地址发给你, 收到付款自动验证 + 自动 deliver, 全程不用你查链.`);
      const lines = r.picks.map((p, i) =>
        `${i+1}. ${p.qty_kas} ${pp.give_asset || 'KAS'} → 付 ${p.pay_usdt} USDT 到 ${p.maker_payment_address}`
      ).join('\n');
      _qDm('dm_pay_instr', peerAddr, `付款指引:\n${lines}\n\n付完不用回复, 自动检测.`);
      // T-J2-2026-04-27 P0-4 fix (NWT 真人 UX 抓): sync ack 立刻回, 真**真**真 _qDm DM async chain 1-2min 到, sync 空回真**真**真**用户疑神疑鬼.
      return `✓ 订单已确认 #${orderId} (买 ${r.total_kas} ${pp.give_asset || 'KAS'} / 付 ${r.total_usdt} USDT). 付款指引马上发你, 自动检测付款, 不用刷新.`;
    }
    _qDm('dm_failed', peerAddr, `下单失败: ${r.message || r.error}. 重试或回 NO 取消.`);
    return `❌ 下单失败 (${r.error || 'unknown'}). 请重试或回 "NO" 取消.`;
  }

  // T-NWT-2026-04-27 Bug-W deterministic preview path (J1 726cee54 + J2 1f51ade29a vote (b) approve)
  // T-NWT-2026-04-27 Bug-Z5 fix (J1 3c4a02216b 真测撞): parse current msg FIRST, history 真**只**填 missing fields
  // 真 root: Bug-W v1 真 took asset/qty from stale broker history (Eric 真 prior PASS '买 1 KAS' 真 first match)
  // → user '想买 0.5 USDC' 真 ignored, broker 真 hallucinate 'buy 1 KAS' (J1 03:56 LIVE 真撞).
  //
  // 真 Qwen3.6 LLM 真**永不** call preview_order tool — handler 真 deterministic mitigation.
  // 真 trigger: user msg 含 EVM addr OR chain word, 真 BUY_REGEX 真 miss.
  // 真 priority: current msg 真**最权威** (user explicit), 真 history fill ONLY missing fields.
  {
    const evmAddrMatch = trimmed.match(/0x[a-fA-F0-9]{40}/);
    const chainInMsgMatch = trimmed.match(/\b(BSC|BNB|Polygon|POL|SOL|Solana|TRON)\b/i);
    // T-NWT-2026-04-27 Bug-Z6 fix (J1 6a1a2d306e 真测撞): SELL keyword in current msg → skip Bug-W,
    // 让 broker-sell-handler 接管. 真 root: Bug-W 拿 broker 历史 BUY 反 fill SELL 请求, 撞 hallucinate
    // 跟 Bug-Z5 同 class — current msg 优先, SELL 是 explicit 拒绝信号 (绝不当 BUY 处理).
    const sellKeywordInMsg = /(?:卖|要卖|想卖|出售|抛|sell|dump|unload)/i.test(trimmed);
    const looksLikeFieldFollowup = (evmAddrMatch || chainInMsgMatch) && !BUY_REGEX.test(trimmed) && !sellKeywordInMsg;
    if (looksLikeFieldFollowup) {
      try {
        // T-NWT-2026-04-27 Bug-Z5 fix: parse current msg 真先 (user explicit asset/qty 真 trumps history)
        const buyMsgM = trimmed.match(/(?:买|想买|要买|购买|想换|换\s*\d|来点|要点|想要|我要|buy|want|get|grab|need|cop|comprar|quiero)\s*(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*(KAS|USDT|USDC)\b/i);
        let direction = null;
        let qty = null;
        let asset = null;
        if (buyMsgM) {
          direction = 'buy';
          qty = parseFloat(buyMsgM[1]);
          asset = buyMsgM[2].toUpperCase();
        }
        // History fallback ONLY for fields not in current msg
        if (!direction || !qty || !asset || !chainInMsgMatch) {
          const brokerInfo = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
          if (brokerInfo?.address) {
            const histRows = sqlite.prepare(`
              SELECT m.direction, m.content_text
              FROM messages m
              LEFT JOIN identities si ON si.id = m.sender_identity_id
              LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
              WHERE ((si.address = ? AND ri.address = ?) OR (si.address = ? AND ri.address = ?))
                AND m.message_type = 'text'
              ORDER BY m.created_at DESC LIMIT 6
            `).all(brokerInfo.address, peerAddr, peerAddr, brokerInfo.address);
            const brokerLastBuy = histRows.find(r =>
              r.direction === 'outbound' && /(?:买|buy)\s*\d+(?:\.\d+)?\s*(?:个|枚|只)?\s*(KAS|USDT|USDC)/i.test(r.content_text || '')
            );
            if (brokerLastBuy) {
              const histQtyM = brokerLastBuy.content_text.match(/(?:买|buy)\s*(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*(KAS|USDT|USDC)/i);
              if (!direction) direction = 'buy';
              if (!qty && histQtyM) qty = parseFloat(histQtyM[1]);
              if (!asset && histQtyM) asset = histQtyM[2].toUpperCase();
            }
          }
        }
        // chain: current msg first, history fallback
        let chainSrc = chainInMsgMatch?.[1];
        if (!chainSrc) {
          const brokerInfo2 = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
          if (brokerInfo2?.address) {
            const recent = sqlite.prepare(`
              SELECT m.content_text FROM messages m
              LEFT JOIN identities si ON si.id = m.sender_identity_id
              LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
              WHERE si.address = ? AND ri.address = ? AND m.direction='outbound' AND m.message_type='text'
              ORDER BY m.created_at DESC LIMIT 3
            `).all(brokerInfo2.address, peerAddr);
            for (const r of recent) {
              const m = (r.content_text || '').match(/\b(BSC|BNB|Polygon|POL|SOL|Solana|TRON)\b/i);
              if (m) { chainSrc = m[1]; break; }
            }
          }
        }
        const chainNorm = chainSrc
          ? chainSrc.toUpperCase().replace('BSC', 'BNB').replace('POLYGON', 'POL').replace('SOLANA', 'SOL').toLowerCase()
          : 'bnb';
        const recvAddr = evmAddrMatch?.[0] || null;
        if (direction === 'buy' && qty && qty > 0 && asset) {
          const previewResult = await buyPreview({
            user_kasia: peerAddr,
            qty, pay_chain: chainNorm,
            give_asset: asset,
            receive_address: asset === 'KAS' ? null : recvAddr,
          });
          // R33 b iter11 (NWT 2504b89f layer 2 dig + 三方 vote A): 跟 PRICE_QUERY iter1 v2 同模式 —
          // sync return preview_text, drop _qDm. production 路径 = relay getAIReply 用 sync return →
          // 包 Kasia chain DM (kasia-relay/src/ai.mjs sendMessage wrap, retry MAX_ATTEMPTS=4 保留).
          // 修 state_expire_boundary T1 sync EMPTY (test framework + production 同时 unblock).
          if (previewResult.ok) {
            _setPendingPreview(peerAddr, {
              qty, pay_chain: chainNorm,
              give_asset: asset, receive_address: asset === 'KAS' ? null : recvAddr,
            });
            // R33 b iter12 (J2 dec63bf5 confirmed_addr trace 实证): det-preview path 也要 setConvoStateLock
            // 真**真 recv_address — 真**真**真 detectAddrChangeAttempt 真**真**真 fire (前 iter5b EARLIEST 真**真
            // direction lock, 真**真**真 recv_address, 真**真**真 attacker '改地址 0xfake' 真**绕过).
            try {
              setConvoStateLock(peerAddr, {
                direction: 'buy',
                give_asset: asset,
                qty,
                pay_chain: chainNorm,
                recv_address: asset === 'KAS' ? null : recvAddr,
                // Phase D P1 真因 1 (J1-D-1, NWT 8b848a95 catch): BUY KAS 路径 lock user
                // T1-supplied EVM addr 进 evm_pay_address. broker functionally 不依赖 (broker scan
                // maker addr for USDT incoming, 不 filter by user-from), 但 R31 lock 提供 attacker
                // swap detection + user-facing 'addr locked' UX.
                evm_pay_address: asset === 'KAS' ? recvAddr : null,
                lifecycle_phase: 'preview_shown',
              });
            } catch (e) { /* lock violation 真**真 EARLIEST 已 handle */ }
            console.log(`[broker-buy] det-preview ${peerAddr.slice(-12)}: ${qty} ${asset} ${chainNorm}`);
            // T-J2-2026-04-28 Phase D P2 fix (NWT fad19de7 catch): chain DM mode 下 sync return only
            // 假设破 — mock peer 真 chain DM 时无 sync caller, preview 真 dropped. 加 _qDm fire
            // chain DM (sync HTTP path 仍 work, relay anti-spam dedup). freshness_args 让
            // dm_quote handler verify state 还 align (γ NWT 9a547e81 + J1 8513b019 propose).
            _qDm('dm_quote', peerAddr, previewResult.preview_text, {
              freshness_args: {
                qty, payChain: chainNorm, asset, direction: 'buy',
                recv_address: asset === 'KAS' ? null : recvAddr,
                evm_pay_address: asset === 'KAS' ? recvAddr : null,
              },
            });
            return previewResult.preview_text;
          }
          if (previewResult.message) {
            return `抱歉, ${previewResult.message}`;
          }
        }
      } catch (e) {
        console.warn(`[broker-buy] det-preview err: ${e.message}`);
      }
      // fall through to existing flow if det-preview didn't trigger
    }
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
      // T-J1-2026-04-27 P0-4 sync ack (NWT 17:34 UX P0): user '好' confirm 真**真不能** silent —
      // chain queue DM 真 1-3min 真到, sync 真**真**ack 立即. 真 user 真信任 broker 真**真**响应.
      // 真**真**block sync sync, chain queue 真 dm_order_confirmed + dm_pay_instr 真后续 detail.
      return `✓ 收到 YES, 订单已建 #${orderId}, 付款指引马上发你 (1-2 分钟到账, 不用刷新).`;
    }
    if (CANCEL_WORDS.includes(trimmed)) {
      _quotes.delete(peerAddr);
      resetConvoState(peerAddr, 'user_cancel');  // R33
      _qDm('dm_quote', peerAddr, `已取消报价. 重新下单回"买/卖 X KAS".`);
      return '已取消报价. 不锁资金, 随时回 "买/卖 X KAS" 重新下单.';
    }
  }

  // P0-3 CANCEL after confirm (NWT 17:34 UX 抓): user confirm 后想取消 → 必须能 cancel.
  // 合并 J1 logic (handle paid picks) + J2 fuzzy match (Owner 真测撞 '算了 NO' multi-token).
  // pre-fix: user '好' → _pendingAccepts.set, 然后 '算了 NO' fall LLM → finalize 拒 '已有 active 订单' = UX P0.
  // post-fix: cancel words 检测 (exact 或 fuzzy substring) → 看 paid picks:
  //   - 已 paid 笔 cannot cancel (USDT 上链), DM user 解释剩余 unpaid 等过期
  //   - 全 unpaid → release _pendingAccepts (zero on-chain action)
  const cancelable = _pendingAccepts.get(peerAddr);
  const cancelHit = CANCEL_WORDS.includes(trimmed) || /\b(NO|no|cancel)\b/i.test(trimmed) || /取消|不要|算了/.test(trimmed);
  if (cancelable && cancelHit) {
    if (Date.now() >= cancelable.expires_at) {
      _pendingAccepts.delete(peerAddr);
      return '订单已超时 (30min). 不锁资金, 重新下单回 "买 X KAS".';
    }
    const paidPicks = cancelable.picks.filter(p => p.paid_tx);
    if (paidPicks.length > 0) {
      const unpaidCount = cancelable.picks.length - paidPicks.length;
      return `${paidPicks.length}/${cancelable.picks.length} 笔已付款不能取消 (USDT 已上链, broker 自动 deliver KAS).${unpaidCount > 0 ? ` 未付的 ${unpaidCount} 笔等过期自动释放 (30min).` : ''} 有问题回我.`;
    }
    _pendingAccepts.delete(peerAddr);
    resetConvoState(peerAddr, 'user_cancel');  // R33
    _qDm('dm_quote', peerAddr, `✓ 订单已取消 (${cancelable.total_kas} KAS / ${cancelable.total_usdt.toFixed(6)} USDT). 不锁资金, 重新下单回 "买/卖 X KAS".`);
    return `✓ 订单已取消 (${cancelable.total_kas} KAS / 全 unpaid). 你 USDT 没动. 重新下单回 "买/卖 X KAS".`;
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
        // NWT ad8aafa6 Gap 2 fix (~1 LOC): sync return parity with cancel pattern.
        // 之前 return '' 让 /api/agent/reply sync 拿不到, 测试框架无法捕获 → 没 regression 守.
        // sync return + _qDm async 双发对齐 cancel 模式 (handleBuyIntent L1035), 测试可观测.
        const ack = `感谢. 请发你的 BSC tx hash (0x 开头 64 位 hex) — 系统自动上链验证 USDT 收款 + 自动发 KAS, 1-2 分钟到账. 格式例: "我付了 0xabc123..."`;
        _qDm('dm_paid_no_tx', peerAddr, ack);
        return ack;
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

  // R33: SELL flow active 时 BUY_REGEX 不 fire (B1/B3 fix - 防 cross-direction hallucinate)
  if (!shouldDeterministicFire(peerAddr, 'BUY_REGEX', trimmed)) {
    return null;  // SELL flow 中, fall to handleSellIntent OR LLM 处理 (LLM 看 state lock 系统 prompt)
  }

  // 解析买意图 → 拼单 + 报价 DM 入队
  const m = BUY_REGEX.exec(trimmed);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  // R33 b iter6 (NWT c5bda126 fuzz negative trace): 显式 reject negative — 真**真**fall LLM
  // 真 silent normalize, 用户 typo '-5' broker 真**真**真 charge mismatch.
  if (qty < 0) return `抱歉, ${m[1]} 是负数, 不能买负 KAS. 改正数, 例 "买 5 KAS".`;
  if (qty <= 0) return null;
  // R33 b iter7 (NWT 309b19af huge_qty trace): upfront sanity check, 不让 99M/1B publish-time fail.
  if (qty > MAX_QTY_KAS) return `抱歉, ${qty} KAS 超过单笔上限 ${MAX_QTY_KAS} KAS. 改小 OR 分批下单, 例 "买 100 KAS" 多次.`;
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
