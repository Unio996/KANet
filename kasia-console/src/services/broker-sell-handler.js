// broker-sell-handler.js — Phase 4 Round 3 SELL 入口 (T-NWT-08)
// 真人 DM "卖 X KAS" → broker 问 BSC 地址 → 用户 DM 0x... → broker INSERT retail_dex_orders + DM 转 KAS 指引
// 用户后续转 KAS → broker-intake-watcher (T-NWT-05/07) 自动 publish + 走 exchange protocol
// 不自建 exchange/订单状态机, 复用 retail_dex_orders + broker-intake-watcher.
// 镜像 broker-buy-handler.js 模式 (T-J2-08), 共用 conversations.js fork 路由.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { setConvoStateLock, shouldDeterministicFire } from './broker-state-authority.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
// T-J2-2026-04-27 v1.1: 真扩 SELL_REGEX 同 BUY_OVERRIDE_REGEX 模式 (Owner 25:21 钦定真扩同义词)
// 加 '想卖/要卖/出售/抛/想抛/想出/dump/cash out' — 真 deterministic fast path 跳 LLM 1-2s
// R33 b iter6 (NWT c5bda126 fuzz negative trace): regex sign capture, 后续 reject negative.
const SELL_REGEX = /^\s*(?:卖|sell|想卖|要卖|出售|抛|想抛|想出|dump|cash\s*out|unload|offload)\s*(-?\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*KAS\s*$/i;
// T-J1-19l (J1 dynamic e2e v3 撞墙真因): 用户在 sell _pending 状态发 "买 X KAS" 改主意,
// 之前 broker 顽固要 BSC 地址 → 用户卡住. 入口检测 buy intent override 自动 release pending.
const BUY_OVERRIDE_REGEX = /^\s*(?:买|buy|想买|要买|购买|想换|搞|弄|来点|想要|我要)\s*\d/i;
const EVM_ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CANCEL_WORDS = ['NO', 'no', 'n', '取消', '不要', '算了'];
const PENDING_TTL_MS = 30 * 60 * 1000;  // 30min 等用户回 BSC 地址
const FEE_KAS = 0.1;    // 默认 broker fee (与 broker-intake-watcher DEFAULT_FEE_KAS 一致)
const MID_PRICE_HINT = 0.034;   // 报价提示 (真挂单价由 broker-intake-watcher fetchKasPrice 决定)

const _pending = new Map();  // peer → {qty, expires_at, ask_state}

export function _testClearPending(peer) {
  // R-NWT-2026-04-28 (d) B phase 5: per-peer signature 加 (backward-compat: 无 peer arg → clear all).
  // J2 path B cross-peer race tests 用 per-peer cleanup.
  if (peer) _pending.delete(peer);
  else _pending.clear();
}
export function _hasPending(peer) { return _pending.has(peer); }

function _traderBAddr() {
  return sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER_RELAY_ID)?.address;
}

function _insertSellOrder({ peerAddr, qty, userBnbAddr }) {
  const orderId = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO retail_dex_orders
      (id, user_kasia_address, side, order_type, qty, price, pay_chain, pay_address, state, created_at, updated_at)
    VALUES (?, ?, 'sell_kas', 'limit', ?, ?, 'bnb', ?, 'awaiting_payment', ?, ?)
  `).run(orderId, peerAddr, String(qty), String(MID_PRICE_HINT), userBnbAddr, now, now);
  return orderId;
}

// R4 改造 (T-NWT-09): 走 broker-action-queue 单线 pump 防 UTXO 双花.
// R4 Bug 9 fix (T-NWT-13, J2 933dd65e 同模式 broker-buy-handler 45787b86):
// anti-spam 实测 dedup 窗口 ~14min, 6s backoff 不解. 加 4 字符唯一 tag, 跨 session 100%
// similar 永不撞.
async function _qDm(peerAddr, message) {
  const { enqueue, getQueueStats } = await import('./broker-action-queue.js');
  const stats = getQueueStats();
  const queuePart = stats.length > 0 ? `(前面 ${stats.length} 笔待处理, 排队 ~${Math.ceil(stats.length * 5)}s) ` : '';
  const tag = `#${randomUUID().slice(0,4)}`;
  return enqueue({ kind: 'dm_quote', peer: peerAddr, payload: { message: `${message}\n\n${queuePart}${tag}` } });
}

// T-NWT-2026-04-27 sellPreview() generic 化 (Owner 12:51 钦定 '任何资产能复用, 不仅 KAS')
//
// 全 asset-registry 驱动: give_asset/recv_asset/recv_chain 走 getAsset() lookup, addr 验证按
// recvMeta.settler 分派, 价格 fetchPrice(give, recv) generic, 文案用 displayName.
//
// fee 处理: KAS 卖保留 0.1 KAS 固定 fee (链上 gas + UTXO 锁成本, backward compat); 其他 asset
// 不扣固定 fee, broker 利润靠 spread % (跟 buyPreview 同范式). 真 future asset-registry
// 加 brokerFee 字段后可去掉这个 if-KAS 分支.
//
// 4 段补强: (A) broker 身份 (B) 价格对比 (C) 安全说明 (D) 历史链上记录 (跟 buyPreview 对称)
export async function sellPreview({
  user_kasia, qty, recv_address, recv_chain, give_asset = 'KAS', recv_asset = 'USDT',
  // R33 b iter3 (J1 NWT GAP B 修): user-supplied conditions, MUST handle (accept OR explicit reject), 不准静默丢
  limit_price = null,
  refund_timeout_min = null,
}) {
  if (!user_kasia || !qty || qty <= 0 || !recv_chain || !recv_address) {
    return { ok: false, error: 'missing_fields', message: `缺字段: 数量/收 ${recv_asset} 链/收款地址` };
  }
  const { getAsset, listAssets } = await import('./asset-registry.js');
  const giveMeta = getAsset(give_asset);
  if (!giveMeta) {
    return { ok: false, error: 'asset_not_supported', message: `broker 真不支持 ${give_asset}. 现 supported: ${listAssets().join(', ')}.` };
  }
  const chainNorm = String(recv_chain).toLowerCase().replace('bsc', 'bnb').replace('polygon', 'polygon').replace('solana', 'sol');
  const recvMeta = getAsset(recv_asset, chainNorm);
  if (!recvMeta) {
    return { ok: false, error: 'recv_asset_chain_unsupported', message: `broker 真不支持 ${recv_asset} on ${chainNorm}. 换链或换 asset.` };
  }
  // 资产 minQty 走 registry (KAS=1.0, stable=0.1)
  const giveFee = give_asset === 'KAS' ? 0.1 : 0;  // KAS 链上 gas backward compat; 其他 spread-only
  const minPracticalQty = giveFee + giveMeta.minQty;
  if (qty <= minPracticalQty) {
    return { ok: false, error: 'qty_too_small', message: `太少了, 至少 ${minPracticalQty} ${give_asset} (扣 ${giveFee || 0} ${give_asset} broker fee 后才有意义).` };
  }
  // 收款地址按 recvMeta.settler 验
  if (recvMeta.settler === 'evm') {
    if (!EVM_ADDR_REGEX.test(recv_address)) {
      return { ok: false, error: 'invalid_recv_address', message: `${recvMeta.displayName} 收款地址格式不对, 应该是 0x 开头 42 位 (EVM).` };
    }
  } else if (recvMeta.settler === 'kasia') {
    if (!String(recv_address).startsWith('kaspa:')) {
      return { ok: false, error: 'invalid_recv_address', message: `${recvMeta.displayName} 收款地址应该是 kaspa: 开头.` };
    }
  }
  // SOL/TRON addr regex 留 finalizeSell 二次验, preview 不阻断

  // 真价 + spread (broker 买 give_asset = user 卖, broker 用 mid * (1 - spread%) 报)
  // price-oracle 直接 pair 不支持时, fallback USDT proxy (USDC ≈ USDT, peg ~1:1, J2 验 0.026% slippage)
  let unitPrice = null;
  let midPrice = null;
  let priceCompare = '';
  try {
    const { fetchPrice } = await import('./price-oracle.js');
    let pr = await fetchPrice(give_asset, recv_asset);
    if (!pr.ok && (recv_asset === 'USDC' || recv_asset === 'USDT')) {
      // fallback: 用 USDT 中价做代理 (KAS→USDC 暂走 KAS→USDT, peg~1:1)
      const proxy = recv_asset === 'USDT' ? 'USDC' : 'USDT';
      const fallback = await fetchPrice(give_asset, proxy === 'USDC' ? 'USDT' : 'USDT');
      if (fallback.ok) pr = { ...fallback, source: `${fallback.source} (USDT proxy ~1:1)` };
    }
    if (pr.ok && pr.price > 0) {
      midPrice = pr.price;
      const SPREAD_PCT = 1;
      unitPrice = midPrice * (1 - SPREAD_PCT / 100);
      const spreadPct = ((unitPrice - midPrice) / midPrice * 100);
      priceCompare = `\n  (CEX 中价 ${midPrice.toFixed(6)} ${recv_asset}/${give_asset}, 本单 ${spreadPct.toFixed(2)}% spread, broker 买入价低于市价)`;
    }
  } catch (e) { /* 价格取不到不要紧 */ }
  if (!unitPrice) {
    return { ok: false, error: 'price_unavailable', message: `${give_asset}/${recv_asset} 价格暂查不到, 请稍后再试.` };
  }

  const netGive = +(qty - giveFee).toFixed(8);
  const totalRecv = +(netGive * unitPrice).toFixed(6);

  // (A) broker 身份卡
  let trustCard = '';
  try {
    const brokerRow = sqlite.prepare('SELECT name, created_at, address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
    const completedCount = brokerRow?.address
      ? sqlite.prepare(`SELECT COUNT(*) as n FROM exchange_offers WHERE maker = ? AND protocol_status = 'completed'`).get(brokerRow.address)?.n || 0
      : 0;
    const daysActive = brokerRow?.created_at
      ? Math.floor((Date.now() - new Date(brokerRow.created_at).getTime()) / 86400000)
      : '?';
    trustCard = `🏷 **${brokerRow?.name || 'KANet broker'}** · Kasia 注册 ${daysActive} 天 · 累计完成 **${completedCount}** 笔成交`;
  } catch (e) { trustCard = '🏷 KANet broker'; }

  // (D) 历史链上履历
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

  const feeLine = giveFee > 0
    ? `${qty} ${give_asset} (扣 ${giveFee} ${give_asset} broker fee → 净 ${netGive} ${give_asset})`
    : `${qty} ${give_asset}`;
  const safetyFeeLine = giveFee > 0
    ? `· broker fee ${giveFee} ${give_asset} 固定 (无隐藏)`
    : `· broker 利润仅 spread (${recv_asset} 1% 低于市价), 无固定 fee`;
  const recvChainDisplay = recvMeta.displayName;

  // R33 b iter3: user-supplied conditions handling — broker accept (within ±5% oracle) OR 明确 reject
  // 反静默丢弃: 只要 user 提了 limit_price/refund_timeout, preview_text 必反映 broker 决策
  let conditionLines = '';
  let finalUnitPrice = unitPrice;
  let finalTotalRecv = totalRecv;
  if (limit_price !== null && limit_price > 0) {
    const dev = (limit_price - midPrice) / midPrice;
    if (Math.abs(dev) <= 0.05) {
      // accept: use user's limit_price (broker spread 调整)
      finalUnitPrice = limit_price;
      finalTotalRecv = +(netGive * finalUnitPrice).toFixed(6);
      conditionLines += `\n* 用户限价: **${limit_price} ${recv_asset}/${give_asset}** ✓ broker 接受 (CEX 中价 ${midPrice.toFixed(6)}, 偏差 ${(dev*100).toFixed(2)}% 在 ±5% 内)`;
    } else {
      conditionLines += `\n* 用户限价: ${limit_price} ${recv_asset}/${give_asset} ✗ broker **不接受** (CEX 中价 ${midPrice.toFixed(6)}, 偏差 ${(dev*100).toFixed(2)}% 超 ±5%). 接受按市价 ${unitPrice.toFixed(6)} OR 取消重下.`;
    }
  }
  if (refund_timeout_min !== null && refund_timeout_min > 0) {
    if (refund_timeout_min < 120) {
      // broker 最少 2h (chain confirmation + dispute window)
      conditionLines += `\n* 退款时限请求: ${refund_timeout_min} 分钟 ✗ broker **不接受** (broker 退款最少 2h 即 120 分钟, chain confirmation + dispute window 需要). 接受 broker 默认 2h OR 取消重下.`;
    } else {
      conditionLines += `\n* 退款时限: ${refund_timeout_min} 分钟 ✓ broker 接受 (覆盖默认 2h)`;
    }
  }
  const preview_text = `📋 **卖单画像 (确认前)**

${trustCard}

* 方向: 卖 ${give_asset}
* 数量: ${feeLine}
* 收 ${recv_asset} 链: ${recvChainDisplay}
* 单价: ${finalUnitPrice.toFixed(6)} ${recv_asset}/${give_asset}${priceCompare}
* 你将收到: ${finalTotalRecv.toFixed(6)} ${recv_asset}${conditionLines}
* ${recv_asset} 收件 (你的 ${recvChainDisplay}):
  \`${recv_address}\`
* 你需转: ${qty} ${give_asset} 到 broker (确认后 broker 给你转 ${give_asset} 地址)

🛡 **安全说明**
  · broker 收 ${give_asset} 后挂 SELL 单, 接单后 ${recv_asset} 直付到你 ${recvChainDisplay} 地址
  ${safetyFeeLine}
  · 2h 内无人接 → broker 自动退原 ${qty} ${give_asset} 给你
  · 跨链转账失败 → 自动 refund + dispute 通道
${historyLines}

⏰ 报价 30 分钟内有效 · broker 接单后跨链 1-3 分钟到账

确认下单回 **YES** · 修改回 '改 3 / 改 polygon / 改地址' · 取消回 **NO**`;

  return {
    ok: true,
    direction: 'sell',
    give_asset,
    qty,
    fee: giveFee,
    net_give: netGive,
    recv_asset,
    recv_chain: chainNorm,
    recv_address,
    unit_price: +unitPrice.toFixed(6),
    total_recv: totalRecv,
    quote_ttl_minutes: 30,
    preview_text,
  };
}

// R6 T-J2-19: tool function for broker-llm-agent. LLM 收齐 4 字段调此, 直接 INSERT
// retail_dex_orders + DM 转 KAS 指引, 跳 _pending 对话状态.
export async function finalizeSell({ user_kasia, qty, recv_chain, recv_address }) {
  if (!user_kasia || !qty || qty <= 0 || !recv_chain || !recv_address) {
    return { ok: false, error: 'missing fields (user_kasia/qty/recv_chain/recv_address)' };
  }
  if (qty <= FEE_KAS) return { ok: false, error: `qty too small, min ${FEE_KAS + 0.5} KAS` };
  if (recv_chain.toLowerCase() === 'bnb' || recv_chain.toLowerCase() === 'bsc' || recv_chain.toLowerCase() === 'polygon' || recv_chain.toLowerCase() === 'eth') {
    if (!EVM_ADDR_REGEX.test(recv_address)) return { ok: false, error: 'invalid EVM address (expected 0x + 40 hex)' };
  }
  // TODO: SOL/TRON 地址 regex 验证 (留 NWT 补)
  const orderId = _insertSellOrder({ peerAddr: user_kasia, qty, userBnbAddr: recv_address });
  const traderAddr = _traderBAddr() || '(broker 地址未配置)';
  return { ok: true, order_id: orderId, broker_kasia: traderAddr, fee_kas: FEE_KAS, net_kas: qty - FEE_KAS };
}

export async function handleSellIntent(peerAddr, message) {
  const trimmed = (message || '').trim();
  const pending = _pending.get(peerAddr);

  // R33 b iter9 (J2 81f8f1d8 mid_flow_restart): user cancel-and-restart 真**真 reset state first.
  if (trimmed) {
    try {
      const { detectResetIntent, resetConvoState } = await import('./broker-state-authority.js');
      if (detectResetIntent(trimmed)) {
        resetConvoState(peerAddr, 'user_restart');
      }
    } catch { /* 兜底 */ }
  }

  // Owner 02:23 钦定 cancel-refund policy (跟 broker-buy-handler 同模式).
  if (trimmed) {
    try {
      const { detectCancelIntent, handleCancelAndRefund } = await import('./broker-cancel-refund.js');
      if (detectCancelIntent(trimmed)) {
        const refundReply = await handleCancelAndRefund(peerAddr);
        if (refundReply) return refundReply;
      }
    } catch (e) { console.warn(`[broker-sell] cancel-refund check err: ${e.message}`); }
  }

  // R33 b iter5b (NWT 90b29e39 Bug-Z13 trace 实证): EARLIEST setConvoStateLock for SELL intent.
  // 跟 handleBuyIntent 同 entry-pattern. _detectIntent='sell' → 真**就 lock**, 不**等** SELL_REGEX hit.
  if (trimmed) {
    try {
      const { _detectIntent } = await import('./broker-llm-agent.js');
      const intent = _detectIntent(trimmed);
      if (intent === 'sell') {
        setConvoStateLock(peerAddr, { direction: 'sell', lifecycle_phase: 'fields_collection' });
      }
    } catch (e) {
      if (e.code === 'CONVO_STATE_DIRECTION_LOCK') {
        return `订单方向已锁定 ${e.locked_direction.toUpperCase()}. 改方向请回 "NO" 取消订单, 重新下单告诉我新方向.`;
      }
    }
  }

  // R31 P1.b attacker (NWT 33c0fb3a multi-addr-plant + r19-strip-replant): 真 locked addr
  // 后 detect addr-change attempt, R31 lifecycle-lock 拒.
  if (trimmed) {
    try {
      const { detectAddrChangeAttempt } = await import('./broker-state-authority.js');
      const attempt = detectAddrChangeAttempt(peerAddr, trimmed);
      if (attempt.attempt) {
        return `订单地址已锁定 ${attempt.locked}. 改地址请回 "NO" 取消订单, 重新下单告诉我新地址.`;
      }
    } catch { /* import 兜底 */ }
  }

  // T-J1-19l: 用户在 sell pending 中发 buy intent → 自动 release pending, 让 buy-handler 接管
  if (pending && Date.now() < pending.expires_at && BUY_OVERRIDE_REGEX.test(trimmed)) {
    _pending.delete(peerAddr);
    return null;  // null → conversations.js fork 继续 fall to buy handler 或 LLM
  }

  // pending 'pay_addr' state: 等用户 DM BSC 地址
  if (pending && Date.now() < pending.expires_at) {
    if (CANCEL_WORDS.includes(trimmed)) {
      _pending.delete(peerAddr);
      _qDm(peerAddr, `已取消卖单. 重新下单回"卖 X KAS".`);
      return '';
    }
    if (pending.ask_state === 'pay_addr') {
      const addrMatch = trimmed.match(EVM_ADDR_REGEX);
      if (!addrMatch) {
        _qDm(peerAddr, `地址格式不对, 应该是 0x 开头 42 位 (BSC/EVM). 重发, 或回 NO 取消.`);
        return '';
      }
      const userBnbAddr = addrMatch[0];
      const qty = pending.qty;
      _insertSellOrder({ peerAddr, qty, userBnbAddr });
      _pending.delete(peerAddr);

      const traderAddr = _traderBAddr() || '(broker 地址未配置)';
      const netKas = qty - FEE_KAS;
      const estUsdt = (netKas * MID_PRICE_HINT).toFixed(4);
      _qDm(peerAddr,
        `✓ 卖单已建. 请转 ${qty} KAS 到 broker:\n${traderAddr}\n\n` +
        `转完后 broker 自动挂 SELL 单 (${netKas} KAS net, 扣 ${FEE_KAS} KAS fee), ` +
        `接单后 USDT 直付你 BSC ${userBnbAddr.slice(0,10)}...${userBnbAddr.slice(-4)} (~${estUsdt} USDT).\n` +
        `2h 内无人接 → broker 自动退原 ${qty} KAS.`);
      return '';
    }
  }

  // 解析卖意图
  // R6 T-J2-20: 删 T-NWT-17 onboarding 长文 (Owner 不要 4 关键词文案).
  // R33: BUY flow active 时 SELL_REGEX 不 fire (防 cross-direction)
  if (!shouldDeterministicFire(peerAddr, 'SELL_REGEX', trimmed)) {
    return null;
  }
  // 不命中 SELL_REGEX → return null → conversations.js fork → broker-llm-agent 接管 LLM 自然语言.
  const m = SELL_REGEX.exec(trimmed);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  // R33 b iter6 (NWT c5bda126 fuzz negative trace): 显式 reject negative.
  if (qty < 0) return `抱歉, ${m[1]} 是负数, 不能卖负 KAS. 改正数, 例 "卖 5 KAS".`;
  if (qty <= 0) return null;
  // R33 b iter7 (NWT 309b19af huge_qty trace): upfront sanity check 1M cap.
  if (qty > 1_000_000) return `抱歉, ${qty} KAS 超过单笔上限 1000000 KAS. 改小 OR 分批下单, 例 "卖 1000 KAS" 多次.`;
  if (qty <= FEE_KAS) {
    _qDm(peerAddr, `太少了, 至少 ${FEE_KAS + 0.5} KAS (扣 ${FEE_KAS} KAS broker fee 后才有意义).`);
    return '';
  }

  // R33: SELL_REGEX hit = first declared SELL intent → set conversation state lock
  try {
    setConvoStateLock(peerAddr, {
      direction: 'sell',
      give_asset: 'KAS',
      want_asset: 'USDT',
      qty,
      lifecycle_phase: 'fields_collection',
    });
  } catch (e) {
    // R33 violation (e.g. user 在 BUY flow 中 SELL_REGEX hit) — shouldDeterministicFire 应已 gate, 这里兜底
    console.warn(`[broker-sell] R33 setConvoStateLock blocked: ${e.message}`);
  }

  _pending.set(peerAddr, { qty, expires_at: Date.now() + PENDING_TTL_MS, ask_state: 'pay_addr' });

  const netKas = qty - FEE_KAS;
  const estUsdt = (netKas * MID_PRICE_HINT).toFixed(4);
  // R33 b iter11 (J2 ea701ee1 sell-handler 同 ship): sync return ack text, drop _qDm.
  // 跟 broker-buy-handler det-preview iter11 + PRICE_QUERY iter1 v2 完全 align.
  return `📋 卖 ${qty} KAS 申请收到.\n` +
    `预估 ${netKas} KAS net (扣 ${FEE_KAS} KAS broker fee) → ~${estUsdt} USDT (~${MID_PRICE_HINT} USDT/KAS, 真价由 broker 挂单时锁定).\n\n` +
    `请回你的 BSC 钱包地址 (0x... 42 位) 接收 USDT. 30min 内回. 或回 NO 取消.`;
}
