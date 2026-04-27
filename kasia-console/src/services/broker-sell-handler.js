// broker-sell-handler.js — Phase 4 Round 3 SELL 入口 (T-NWT-08)
// 真人 DM "卖 X KAS" → broker 问 BSC 地址 → 用户 DM 0x... → broker INSERT retail_dex_orders + DM 转 KAS 指引
// 用户后续转 KAS → broker-intake-watcher (T-NWT-05/07) 自动 publish + 走 exchange protocol
// 不自建 exchange/订单状态机, 复用 retail_dex_orders + broker-intake-watcher.
// 镜像 broker-buy-handler.js 模式 (T-J2-08), 共用 conversations.js fork 路由.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
// T-J2-2026-04-27 v1.1: 真扩 SELL_REGEX 同 BUY_OVERRIDE_REGEX 模式 (Owner 25:21 钦定真扩同义词)
// 加 '想卖/要卖/出售/抛/想抛/想出/dump/cash out' — 真 deterministic fast path 跳 LLM 1-2s
const SELL_REGEX = /^\s*(?:卖|sell|想卖|要卖|出售|抛|想抛|想出|dump|cash\s*out|unload|offload)\s*(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*KAS\s*$/i;
// T-J1-19l (J1 dynamic e2e v3 撞墙真因): 用户在 sell _pending 状态发 "买 X KAS" 改主意,
// 之前 broker 顽固要 BSC 地址 → 用户卡住. 入口检测 buy intent override 自动 release pending.
const BUY_OVERRIDE_REGEX = /^\s*(?:买|buy|想买|要买|购买|想换|搞|弄|来点|想要|我要)\s*\d/i;
const EVM_ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CANCEL_WORDS = ['NO', 'no', 'n', '取消', '不要', '算了'];
const PENDING_TTL_MS = 30 * 60 * 1000;  // 30min 等用户回 BSC 地址
const FEE_KAS = 0.1;    // 默认 broker fee (与 broker-intake-watcher DEFAULT_FEE_KAS 一致)
const MID_PRICE_HINT = 0.034;   // 报价提示 (真挂单价由 broker-intake-watcher fetchKasPrice 决定)

const _pending = new Map();  // peer → {qty, expires_at, ask_state}

export function _testClearPending() { _pending.clear(); }
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

// T-NWT-2026-04-27 sellPreview() — 议 B SELL 路径 (J2 dc518ac7b1 + NWT 76d79578 收敛根因 + J2 60305722e3 接受分工)
// J2 8 探针 + NWT 1 探针 殊途同归: tool calling 没问题, 真根因是 sellPreview 没实现 LLM 第二轮没 fallback 指引.
// 仿 buyPreview 结构: 不真 INSERT retail_dex_orders, 不锁状态, 只算价 + 渲染 preview_text 让 LLM 转发.
// user YES → LLM 调 finalize_order(direction='sell') → finalizeSell 真 INSERT.
//
// 4 段补强: (A) broker 身份 (B) 价格对比 (C) 安全说明 (D) 历史链上记录 (跟 buyPreview 对称)
export async function sellPreview({ user_kasia, qty, recv_chain, recv_address }) {
  if (!user_kasia || !qty || qty <= 0 || !recv_chain || !recv_address) {
    return { ok: false, error: 'missing_fields', message: '缺字段: 数量/收 USDT 链/收款地址' };
  }
  if (qty <= FEE_KAS) {
    return { ok: false, error: 'qty_too_small', message: `太少了, 至少 ${FEE_KAS + 0.5} KAS (扣 ${FEE_KAS} KAS broker fee 后才有意义).` };
  }
  const chainNorm = String(recv_chain).toLowerCase();
  // EVM addr 验证 (BSC/POL/ETH 用 0x...42); SOL/TRON 留 finalizeSell 验
  if (chainNorm === 'bnb' || chainNorm === 'bsc' || chainNorm === 'polygon' || chainNorm === 'pol' || chainNorm === 'eth') {
    if (!EVM_ADDR_REGEX.test(recv_address)) {
      return { ok: false, error: 'invalid_evm_address', message: '收款地址格式不对, 应该是 0x 开头 42 位 (BSC/EVM).' };
    }
  }

  // 真价 + spread (broker 买 = user 卖, broker 用 mid * (1 - spread%) 报)
  let unitPrice = MID_PRICE_HINT;
  let midPrice = MID_PRICE_HINT;
  let priceCompare = '';
  try {
    const { fetchPrice } = await import('./price-oracle.js');
    const pr = await fetchPrice('KAS', 'USDT');
    if (pr.ok && pr.price > 0) {
      midPrice = pr.price;
      const SPREAD_PCT = 1;
      unitPrice = midPrice * (1 - SPREAD_PCT / 100);
      const spreadPct = ((unitPrice - midPrice) / midPrice * 100);
      priceCompare = `\n  (CEX 8 源中价 ${midPrice.toFixed(6)}, 本单 ${spreadPct.toFixed(2)}% spread, broker 买入价低于市价)`;
    }
  } catch (e) { /* 价格取不到不要紧 */ }

  const netKas = qty - FEE_KAS;
  const totalUsdt = +(netKas * unitPrice).toFixed(6);

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

  const recvChainDisplay = chainNorm.toUpperCase().replace('BNB', 'BSC');
  const preview_text = `📋 **卖单画像 (确认前)**

${trustCard}

* 方向: 卖 KAS
* 数量: ${qty} KAS (扣 ${FEE_KAS} KAS broker fee → 净 ${netKas} KAS)
* 收 USDT 链: ${recvChainDisplay}
* 单价: ${unitPrice.toFixed(6)} USDT/KAS${priceCompare}
* 你将收到: ${totalUsdt.toFixed(6)} USDT
* USDT 收件 (你的 ${recvChainDisplay}):
  \`${recv_address}\`
* 你需转: ${qty} KAS 到 broker (确认后 broker 给你转 KAS 地址)

🛡 **安全说明**
  · broker 收 KAS 后挂 SELL 单, 接单后 USDT 直付到你 ${recvChainDisplay} 地址
  · broker fee 0.1 KAS 固定 (无隐藏)
  · 2h 内无人接 → broker 自动退原 ${qty} KAS 给你
  · 跨链转账失败 → 自动 refund + dispute 通道
${historyLines}

⏰ 报价 30 分钟内有效 · broker 接单后跨链 1-3 分钟到账

确认下单回 **YES** · 修改回 '改 3 / 改 polygon / 改地址' · 取消回 **NO**`;

  return {
    ok: true,
    direction: 'sell',
    qty,
    fee_kas: FEE_KAS,
    net_kas: netKas,
    recv_chain: chainNorm,
    recv_address,
    unit_price_usdt: +unitPrice.toFixed(6),
    total_usdt: totalUsdt,
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
  // 不命中 SELL_REGEX → return null → conversations.js fork → broker-llm-agent 接管 LLM 自然语言.
  const m = SELL_REGEX.exec(trimmed);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (qty <= 0) return null;
  if (qty <= FEE_KAS) {
    _qDm(peerAddr, `太少了, 至少 ${FEE_KAS + 0.5} KAS (扣 ${FEE_KAS} KAS broker fee 后才有意义).`);
    return '';
  }

  _pending.set(peerAddr, { qty, expires_at: Date.now() + PENDING_TTL_MS, ask_state: 'pay_addr' });

  const netKas = qty - FEE_KAS;
  const estUsdt = (netKas * MID_PRICE_HINT).toFixed(4);
  _qDm(peerAddr,
    `📋 卖 ${qty} KAS 申请收到.\n` +
    `预估 ${netKas} KAS net (扣 ${FEE_KAS} KAS broker fee) → ~${estUsdt} USDT (~${MID_PRICE_HINT} USDT/KAS, 真价由 broker 挂单时锁定).\n\n` +
    `请回你的 BSC 钱包地址 (0x... 42 位) 接收 USDT. 30min 内回. 或回 NO 取消.`);
  return '';
}
