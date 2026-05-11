// ════════════════════════════════════════════════════════════════
// broker-v2/router.js — 主 path 单一不分支
//
// Spec: docs/NEW-BROKER-PROPOSAL.md v2 §"router.js"
// Lock: 三方共识 7e776598dc + NWT v2 spec ecdd98874
//
// 主 path 顺序 (硬规则):
// 1. parser.extract → fields + intent (deterministic 必中)
// 2. state.setField for each field (R31/R33 SQL guard)
// 3. read state
// 4. lifecycle decision:
//    - intent cancel/reset → clearDraft OR cancel-refund (已 publish 路径)
//    - active order 已 publish → query status / LLM 自然对话
//    - draft complete + confirm → advance + order-book.publishOrder
//    - draft complete + 'aligning' → order-book.computePreview + advance 'preview_shown'
//    - draft 不全 → llm.render (含 profile + state inject)
// 5. post-LLM check tool_calls 写 state 后 re-check complete → preview
// ════════════════════════════════════════════════════════════════

import { sqlite } from '../../db/client.js';
import { extract } from './parser.js';
import * as state from './state.js';
import * as llm from './llm.js';
import * as orderBook from './order-book.js';

// parser fields → retail_dex_orders col name 映射.
// Note: 'asset' field 解 但不 setField — phase 1 hardcode KAS (retail_dex_orders 无 asset col).
// Phase 2 backlog: 加 retail_dex_orders.give_asset col 支持 USDT/USDC 多 asset trade.
const FIELD_MAP = {
  direction: 'side',          // buy → buy_kas / sell → sell_kas
  qty: 'qty',
  chain: 'pay_chain',
  pay_address: 'pay_address',
  price_pref: 'price',
};

const STATUS_QUERY_REGEX = /(?:查单|查我的单|订单状态|进度|已成多少|剩多少|什么情况)/i;

// T-J2-2026-05-07 r256 T1.5b: chain-truth grounding retrospective query (Owner 5/7 钦定 broker user-facing
// 必 deterministic + chain truth + TX evidence + explorer URL, 严禁 LLM hallucinate '已撤销' 假 ack).
// 此 regex 真 router.js 顶部 fire (在 hasPublished gate 之前), terminal state refunded/completed/expired
// 真 source-of-truth response, getActiveOrder filter 不返 terminal 真 unreachable issue 修.
const ORDER_STATUS_QUERY_REGEX = /(退款|退了吗|我钱呢|退回|凭证|证明|tx|查单|查我的单|订单状态|进度|已成多少|剩多少|什么情况|怎么样了)/i;

// T-J2-2026-05-09 T2.6 (Reading D ledger query + user-initiated withdraw):
// 跟 ORDER_STATUS_QUERY_REGEX 同款 deterministic pattern, 顶部 fire 严禁 LLM hallucinate (Owner 5/7 钦定 user-facing).
// BALANCE_QUERY: SQL aggregate user_ledger by asset → 模板.
// WITHDRAW_REQUEST: validate ledger ≥ amount + min ≥ chain threshold → cex-bridge.withdrawCex → ledger -.
// NWT r266 锁定 user-pay-fee 透明: ledger 扣 gross amount, chain TX 发 net (扣 Gate.io fee).
// ref: NWT r270 Reading D + cex-bridge T2.3 + user_ledger T2.4.
const BALANCE_QUERY_REGEX = /(余额|我有多少|账户|balance|查我钱|查账)/i;
// T-J2-2026-05-10 r227 T2.6.1 hotfix: 加 'withdraw' English alias.
// KI-29 第 3 次 DM Chinese encoding bug 真 production environment 真 chain DM '提' 字符可能损坏 (curl shell encoding GBK→UTF-8 conversion).
// 真 user 真 ASCII fallback 'withdraw N USDT BSC' 真 production-grade 真 deterministic match.
// 真 5/10 Step 7b verify 实证 ASCII 'withdraw 1 USDT BSC' 不 match → broker LLM dialog ask EVM addr fall, 真 cex-bridge.withdrawCex 漏 fire.
const WITHDRAW_REQUEST_REGEX = /(?:提|withdraw)\s*(\d+(?:\.\d+)?)\s*(USDT|KAS|usdt|kas)\s*(TRC20|BSC|TRX|BNB|ETH|trc|bsc|eth)?/i;
const CHAIN_MIN_THRESHOLDS = {
  USDT: { TRX: 10, BSC: 1, ETH: 5 },
  KAS:  { KASPA: 30 },
};
function _normalizeWithdrawChain(c) {
  if (!c) return null;
  const u = c.toUpperCase();
  if (['TRX','TRC20','TRON'].includes(u)) return 'TRX';
  if (['BSC','BNB','BEP20'].includes(u)) return 'BSC';
  if (['ETH','ERC20'].includes(u)) return 'ETH';
  return u;
}

// T-J2-2026-05-10 r230 T2.18 (NWT r294 Bug #14): broker-v2 internal chain → DB pay_chain mapping.
// 真因: DB retail_dex_orders.pay_chain 真 broker-sell-handler.js:129 真 'bsc'→'bnb' normalize storage.
// WITHDRAW SQL WHERE pay_chain = LOWER(wChain) 真 'bsc' 真 不 match DB 'bnb'. 修真 dbChain explicit map.
// CHAIN_MIN_THRESHOLDS keys 真 broker-v2 internal chain ('BSC'/'TRX'/'ETH'), DB schema 真 lowercased ('bnb'/'trx'/'eth').
// cex-bridge.js withdrawCex 真 接 'BSC' (Gate.io API expects), 真 cex-bridge normalizeChain 真 reuse.
function _payChainForDb(wChain) {
  if (wChain === 'BSC') return 'bnb';  // broker-sell-handler 真 bsc→bnb normalize storage
  if (wChain === 'TRX') return 'trx';   // direct lowercase
  if (wChain === 'ETH') return 'eth';
  return String(wChain || '').toLowerCase();
}

/**
 * Main entry — broker-v2 单一 user message 处理.
 * @param {string} peer - user kasia 地址
 * @param {string} msg - user 当前消息
 * @returns {Promise<string>} reply text 给 user
 */
export async function handleMessage(peer, msg) {
  if (!peer || !msg) return '我没收到内容, 你想买还是卖 KAS?';

  // 0. T-J2-2026-05-07 r256 T1.5b: chain-truth retrospective query (顶部 fire 真 bypass hasPublished gate).
  // user 真发 '退款' / '退了吗' / '我钱呢' / 'TX' 等 → SQL grep 最 recent 1 单 → 模板 deterministic reply.
  // 真 严禁 LLM inject reply (5/7 08:43 Owner '撤单' → LLM '已撤销' 假 ack 真 trust loss 教训).
  if (ORDER_STATUS_QUERY_REGEX.test(msg)) {
    const recent = sqlite.prepare(`
      SELECT id, side, qty, state, refund_tx_hash, deliver_tx_hash,
             datetime(created_at, '+7 hours') AS ct_local
      FROM retail_dex_orders
      WHERE user_kasia_address = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(peer);
    if (!recent) return '你没有订单记录. 想下新单告诉我.';
    const sideZh = recent.side === 'sell_kas' ? '卖' : '买';
    if (recent.state === 'refunded' && recent.refund_tx_hash) {
      return `✓ ${recent.ct_local} ${sideZh} ${recent.qty} KAS 已退\nTX: ${recent.refund_tx_hash.slice(0, 16)}...\n查看: https://explorer.kaspa.org/txs/${recent.refund_tx_hash}`;
    }
    if (recent.state === 'completed' && recent.deliver_tx_hash) {
      return `✓ ${recent.ct_local} ${sideZh} ${recent.qty} KAS 已成交\nTX: ${recent.deliver_tx_hash.slice(0, 16)}...\n查看: https://explorer.kaspa.org/txs/${recent.deliver_tx_hash}`;
    }
    if (recent.state === 'expired') {
      return `⏳ ${recent.ct_local} ${sideZh} ${recent.qty} KAS 真 TTL 过期, 等 broker 5min cron 自动退款 (chain-truth dedup 严守).`;
    }
    if (recent.state === 'cancelled' || recent.state === 'failed') {
      return `⊘ ${recent.ct_local} ${sideZh} ${recent.qty} KAS 已取消${recent.refund_tx_hash ? ` (退款 TX: ${recent.refund_tx_hash.slice(0, 16)}...)` : ''}`;
    }
    // active state — 进行中, 提示用 "查单" 看详情
    return `🔄 ${recent.ct_local} ${sideZh} ${recent.qty} KAS ${recent.state} 真进行中. 回 "查单" 看详情.`;
  }

  // 0b. T-J2-2026-05-09 T2.6 BALANCE_QUERY (顶部 fire deterministic, 跟 0a ORDER_STATUS 同款 pattern)
  if (BALANCE_QUERY_REGEX.test(msg)) {
    const balances = sqlite.prepare(`
      SELECT asset, SUM(balance_change) AS balance
      FROM user_ledger WHERE user_kasia_address = ?
      GROUP BY asset HAVING balance != 0
      ORDER BY asset
    `).all(peer);
    if (!balances.length) return '你的 broker 账户暂无余额. 卖 KAS 可累积 USDT 余额.';
    const lines = ['你的 broker 余额:'];
    for (const b of balances) {
      const bal = parseFloat(parseFloat(b.balance).toFixed(4));
      const thresholds = CHAIN_MIN_THRESHOLDS[b.asset] || {};
      const tHints = Object.entries(thresholds).map(([c, m]) => `${c}≥${m}`).join(', ');
      lines.push(`  ${b.asset}: ${bal}${tHints ? ` (提币阈值 ${tHints})` : ''}`);
    }
    lines.push('', '回 "提 N USDT TRC20" 提币.');
    return lines.join('\n');
  }

  // 0c. T-J2-2026-05-09 T2.6 WITHDRAW_REQUEST (用户主动提币, NWT r266 user-pay-fee 锁定)
  const withdrawMatch = msg.match(WITHDRAW_REQUEST_REGEX);
  if (withdrawMatch) {
    const wAmount = parseFloat(withdrawMatch[1]);
    const wAsset = withdrawMatch[2].toUpperCase();
    const wChain = _normalizeWithdrawChain(withdrawMatch[3]) || (wAsset === 'USDT' ? 'TRX' : 'KASPA');
    const cur = sqlite.prepare(
      `SELECT COALESCE(SUM(balance_change), 0) AS balance FROM user_ledger
       WHERE user_kasia_address = ? AND asset = ?`
    ).get(peer, wAsset);
    const balance = parseFloat(cur?.balance || 0);
    if (balance < wAmount) return `余额不足: ${wAsset} 现 ${balance.toFixed(4)}, 提 ${wAmount} 不够. 回 "余额" 查账.`;
    const minT = CHAIN_MIN_THRESHOLDS[wAsset]?.[wChain];
    if (minT && wAmount < minT) return `${wAsset} ${wChain} 提币最小 ${minT}, 你提 ${wAmount} 太少. fee 不划算, 累积再提.`;
    const dbChain = _payChainForDb(wChain);
    const payRow = sqlite.prepare(`
      SELECT pay_address FROM retail_dex_orders
      WHERE user_kasia_address = ? AND pay_chain = ? AND pay_address IS NOT NULL
        AND state NOT IN ('failed','refunded','cancelled')
      ORDER BY created_at DESC LIMIT 1
    `).get(peer, dbChain);
    if (!payRow?.pay_address) return `没记录你的 ${wChain} 收款地址. 先下个 SELL 单告诉我地址, 然后再提.`;
    // T-J2-2026-05-10 r233 T2.19 (NWT r296 ε.2): broker BSC wallet direct transfer (跳 Gate.io withdrawals API + 24h cooldown).
    // 真因 Bug #15: Gate.io API "only used addresses or verified addresses are allowed" → 24h cooldown 真 deployment-ops policy unavoidable.
    // 修法 ε.2: broker 真 internal BSC wallet (agent_wallets.privkey_encrypted) → evm-transfer.transferUsdt 真 user pay_address chain TX.
    // 跳 Gate.io withdrawals API 完全, 真 demand broker BSC USDT inventory funding (Owner production capital pool).
    // Phase 1 sustain: Owner 一次性 fund broker BSC ~100 USDT. Phase 2 β candidate: broker auto-rebalance Gate.io → BSC.
    const evmChainMap = { 'BSC': 'bnb', 'ETH': 'eth', 'TRX': 'tron' };
    const evmChain = evmChainMap[wChain];
    if (!evmChain) return `${wChain} chain 暂不支持 broker direct transfer (Phase 2 β candidate). 现 BSC/ETH/TRX 真 supported.`;
    const brokerWallet = sqlite.prepare(
      `SELECT privkey_encrypted, address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND privkey_encrypted IS NOT NULL LIMIT 1`
    ).get('0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0', evmChain);
    if (!brokerWallet?.privkey_encrypted) return `broker ${wChain} 钱包未配置, 联系 Owner. 你的余额仍在.`;
    const { transferUsdt } = await import('../evm-transfer.js');
    const wRes = await transferUsdt(evmChain, brokerWallet.privkey_encrypted, payRow.pay_address, wAmount);
    if (!wRes?.ok) return `提币失败: ${(wRes?.error || 'unknown').slice(0, 80)}. broker 余额未动, 5min 后可重试 OR 联系 Owner (broker 钱包 inventory 不足真 likely 真因).`;
    const balanceAfter = parseFloat((balance - wAmount).toFixed(4));
    const ledgerId = `ledger_withdraw_${peer.slice(-8)}_${Date.now()}`;
    sqlite.prepare(`
      INSERT INTO user_ledger (id, user_kasia_address, asset, chain, balance_change, balance_after, reason, ref_order_id, ref_tx_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'))
    `).run(ledgerId, peer, wAsset, wChain, -wAmount, balanceAfter, `withdraw_user_initiated:broker_direct:${wRes.txHash?.slice(0, 12)}`, wRes.txHash);
    const explorerMap = { 'bnb': 'https://bscscan.com/tx/', 'eth': 'https://etherscan.io/tx/', 'tron': 'https://tronscan.org/#/transaction/' };
    return [
      `✓ 提币成功 (broker direct, 跳 Gate.io)`,
      `  扣账户: ${wAmount} ${wAsset}`,
      `  到地址: ${payRow.pay_address.slice(0,10)}...${payRow.pay_address.slice(-6)}`,
      `  链: ${wChain}`,
      `  账户余额: ${balanceAfter} ${wAsset}`,
      `  chain TX: ${wRes.txHash}`,
      `  查看: ${explorerMap[evmChain] || ''}${wRes.txHash}`,
      ``,
      `链上 fee 由 broker 承担 (~${evmChain === 'bnb' ? '0.5' : evmChain === 'tron' ? '15 (TRX bandwidth/energy)' : '5-20 (ETH gas)'} USD), 你 1:1 收 ${wAmount} ${wAsset}.`,
    ].join('\n');
  }

  // 1. parser deterministic 提字段 + intent
  const { fields, intent } = extract(msg);

  // 2. 检查是否已 publish (非 'aligning' active order) — 决定路径分支
  const activeOrder = state.getActiveOrder(peer);
  const hasPublished = activeOrder && activeOrder.state !== 'aligning';

  // 3. cancel / reset 路径
  if (intent === 'cancel' || intent === 'reset') {
    // bug 4 fix (broker-v2 5 P0): state='paid' 不允 cancel (taker 已 matched/verifying, 反悔 risk taker loss).
    // broker-cancel-refund._findRefundableOffers 仅 'open'/'expired'/'timed_out' 退. state='paid' offer
    // protocol_status='matched'+, _findRefundableOffers 返 0 → handleCancelAndRefund 返 null →
    // 旧 router default '好的, 已取消未成交部分退回' false promise. 修: 直 ack 拒 cancel.
    if (hasPublished && activeOrder.state === 'paid') {
      // bug 4 v2 (J2 r21 cutover regression dig): 旧 wording '不允许取消' 不 match
      // lifecycle_paid_cannot_cancel test fixture (要求 reply_contains_one_of [已付款/已上链/无法取消/不能取消]).
      // 改 wording: 显式 '已付款' + '不能取消' (语义同, 测试 fixture pass).
      return '订单已付款, broker 验证中并准备发 KAS, 不能取消. 如未按时到账请联系 broker 走 dispute 流程.';
    }
    if (hasPublished && activeOrder.state === 'awaiting_payment') {
      // 已 publish 但未 paid — 走 advanceToRefunded refund unfilled portion (复用退款侧)
      try {
        const { handleCancelAndRefund } = await import('../broker-cancel-refund.js');
        const result = await handleCancelAndRefund(peer);
        return result || '好的, 已取消挂单, 未成交部分将退回. 想下新单的话告诉我.';
      } catch (e) {
        console.warn(`[broker-v2 router] cancel-refund err: ${e.message}`);
        return 'broker 卡了一下处理你的取消请求, 请稍后重试或联系 Owner.';
      }
    }
    // draft 阶段 cancel — 直接 clearDraft
    state.clearDraft(peer);
    // T-J2-2026-05-11 ABE-close β fix (NWT #26 dig persona_mind_changer): cancel + new_intent combo 支持。
    // 旧: cancel intent fire 后 clearDraft + return ack, 丢弃 message 余下新 intent params
    //     (user '不要了, 卖 3 KAS, BSC, 0x9405' → broker 仅 ack 取消, 后续 SELL 3 KAS 全丢)。
    // 新: cleardraft 后 message 含 new direction+qty → 不 return, fall through 继续 process 余下逻辑
    //     (draft seed + field set + preview)。无 new_intent (纯 cancel '不要了') → return ack 老行为。
    if (fields.direction && fields.qty) {
      console.log(`[broker-v2 router] cancel+new_intent combo: cleared draft, processing new ${fields.direction} ${fields.qty} (NWT #26 dig fix)`);
      // 不 return — fall through 进 L232 hasPublished (false post-clear) → L275 draft seed + field set + L380 preview
    } else {
      return '好的, 已取消. 想下新单的话告诉我.';
    }
  }

  // 4. 已 publish 路径 — query status / B1 PAID detect / LLM 自然对话
  if (hasPublished) {
    if (STATUS_QUERY_REGEX.test(msg)) {
      const status = orderBook.getOrderStatus(peer);
      return _formatStatus(status);
    }

    // B1 PAID detect (BUY post-publish): user '我付了 0xtxhash' OR '已付' 兜底
    // r6 共识: broker-v2 不 cover post-publish PAID 是 critical break (Q1). 加 detect → verifyPaymentForPeer.
    // D1 ride: remaining_picks=0 时 transition state='paid' (multi-maker partial paid 仍 'awaiting_payment').
    if (activeOrder.side === 'buy_kas' && ['awaiting_payment', 'paid'].includes(activeOrder.state)) {
      const { PAID_REGEX, PAID_NO_TX_REGEX, verifyPaymentForPeer } = await import('../broker-buy-handler.js');
      if (PAID_REGEX.test(msg) || PAID_NO_TX_REGEX.test(msg)) {
        try {
          const result = await verifyPaymentForPeer({ peer, chain: activeOrder.pay_chain });
          // D1: 全 paid (remaining_picks=0) → transition state='paid'
          if (result?.ok && result.remaining_picks === 0) {
            // D1 v2 fix (NWT a3334737 Medium 1): 加 created_at 时间窗防 multi row advance.
            // production grep 实证 retail_dex_orders awaiting_payment=223 rows — 同 user 历史多
            // 'awaiting_payment' row 不该一次全 advance 'paid'. 仅 advance latest active (2h 内).
            // lint-allow-state-update: PZ-STATE-T-BUY B1 PAID detect BUY 路径 awaiting_payment→paid (BUY user 付 USDT 给 maker, broker mark BUY 单 paid). v0.1 SELL_KAS scope 不 cover BUY 路径, phase 2 multi-asset 后置 transition() migrate.
            sqlite.prepare(`
              UPDATE retail_dex_orders
              SET state='paid', updated_at=datetime('now')
              WHERE user_kasia_address=? AND side='buy_kas' AND state='awaiting_payment'
                AND created_at > datetime('now', '-2 hours')
            `).run(peer);
          }
          return result?.user_msg || (result?.ok
            ? '✓ 已收到付款验证, broker 准备发 KAS'
            : `付款验证暂时失败 (${result?.reason || 'unknown'}). 请稍后重试或发 tx hash 0x...`);
        } catch (err) {
          console.warn(`[broker-v2 router B1] verifyPaymentForPeer err: ${err.message}`);
          return '付款验证暂时失败, 请稍后重试或发 tx hash 0x...';
        }
      }
    }

    // T-J2-2026-05-11 SC9 (triage T3): post-publish addr change attempt deterministic R31 lock。
    // broker-llm-agent.handleLlmDialog L890-898 R31 check 仅 'aligning' phase fire；
    // post-publish (awaiting_payment/paid/executing/refunding) 走 broker-v2/router.js 直 llm.render path
    // 之前漏 R31 deterministic check → LLM 行为 stochastic (echo addr → R19 wrap PASS / smart reject → no wrap → assertion miss)。
    // lifecycle_confirmed_cannot_change_addr test fixture L48-50 iter12 confess 已记录 production gap。
    try {
      const { detectAddrChangeAttempt } = await import('../broker-state-authority.js');
      const attempt = detectAddrChangeAttempt(peer, msg);
      if (attempt.attempt) {
        return `订单地址已锁定 ${attempt.locked}. 改地址请回 "NO" 取消订单, 重新下单告诉我新地址.`;
      }
    } catch (e) { console.warn(`[broker-v2 router R31 post-publish] err: ${e.message}`); }

    // 复合 intent / question / 自然对话 → LLM (含 state inject 知 phase)
    const reply = await llm.render(peer, msg, activeOrder, _loadProfile(peer), _loadContact(peer));
    return reply || '你的挂单还在跑. 想查状态回 "查单", 想取消回 "取消".';
  }

  // 5. draft 阶段 — seedDraft if needed (NWT critical fix vote A: caller 责任 seed)
  let draft = state.getActiveDraft(peer);
  if (!draft) {
    if (fields.direction) {
      const side = fields.direction === 'sell' ? 'sell_kas' : 'buy_kas';
      state.seedDraft(peer, side);
      draft = state.getActiveDraft(peer);
    } else {
      // 没 direction 不允许 INSERT (side NOT NULL). LLM 问 user.
      const profile = _loadProfile(peer);
      const contact = _loadContact(peer);
      const reply = await llm.render(peer, msg, null, profile, contact);
      return reply || '你想买还是卖 KAS?';
    }
  }

  // bug 3 R33 cover (J2 db649ba9 cross review catch — R33 direction flip 之前 silent fallthrough):
  // existing draft + parser fields.direction 跟 draft.side 不同 → user 试 direction flip → 直接 ack lock,
  // 不 fall through (避 LLM hallucinate '已改' OR fallback empty UX).
  if (draft && fields.direction) {
    const requestedSide = fields.direction === 'sell' ? 'sell_kas' : 'buy_kas';
    if (draft.side !== requestedSide) {
      const lockedSide = draft.side === 'sell_kas' ? '卖' : '买';
      return `订单已锁定 方向 ${lockedSide} KAS. 想改请回 "取消" 重新下单.`;
    }
  }

  // post-seedDraft: 写其他 fields (direction 已 seed 到 side col, 不重写)
  let fieldsWrittenThisTurn = false;
  let lockRejectReason = null;  // bug 3 fix: R31/R33 SQL guard reject 直接 ack 不 fallthrough LLM
  for (const [pname, pvalue] of Object.entries(fields)) {
    if (pname === 'direction') continue;  // already seeded into 'side' col
    const colName = FIELD_MAP[pname];
    if (!colName) continue;
    const r = state.setField(peer, colName, pvalue);
    if (r?.set) fieldsWrittenThisTurn = true;
    // bug 3 fix (broker-v2 5 P0): SQL guard reject (LOCKED_FIELDS=['side','pay_address'])
    // 直接 ack '已锁, 不允许改' 不 fallthrough LLM (LLM 易 hallucinate '已改' OR 空 fallback).
    if (r?.ok === false && r?.reason && /_locked$/.test(r.reason)) {
      lockRejectReason = r.reason;
    }
  }
  // bug 3 fix: R31/R33 reject 直接 user-facing ack
  if (lockRejectReason && draft) {
    const lockedField = lockRejectReason.replace('_locked', '');
    const lockedValue = draft[lockedField] || '';
    const fieldDisplay = lockedField === 'pay_address'
      ? `付款/收款地址 ${lockedValue}`
      : lockedField === 'side'
        ? `方向 ${lockedValue === 'sell_kas' ? '卖' : '买'}`
        : lockedField;
    return `订单已锁定 ${fieldDisplay}. 想改请回 "取消" 重新下单.`;
  }
  // direction 也算本 turn 写字段 (seedDraft 触发)
  if (fields.direction) fieldsWrittenThisTurn = true;

  draft = state.getActiveDraft(peer);

  // 6. confirm intent + draft complete (still 'aligning') → publishOrder + advance 'awaiting_payment'
  // 注: 不用 'preview_shown'/'confirming' intermediate state (schema CHECK 不含 'preview_shown';
  //   'aligning' state 含 "字段齐等 confirm" + "字段不齐字段收集中" 两情况, 由 draft.complete 区分).
  if (intent === 'confirm' && draft?.complete) {
    // T-J2-2026-05-05 R4 self-deal pre-publish guard (NWT r211 钦定 BUY/SELL 双 path consistent):
    // SELL post-publish R4 在 broker-intake-watcher.js:158-176 兜底 (KAS 已转 broker 后退回),
    // 此处 BUY pre-publish R4 早拦 (publish 前 reject + 显式提示 user 给的是 broker addr).
    // 双 path 行为一致 — 无论 BUY/SELL, user 给 broker wallet addr 当 pay_address 都 reject.
    if (draft.pay_address) {
      try {
        const selfDeal = sqlite.prepare(
          `SELECT 1 FROM agent_wallets WHERE relay_node_id = ? AND lower(address) = lower(?) LIMIT 1`
        ).get('0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0', draft.pay_address);
        if (selfDeal) {
          console.warn(`[broker-v2 R4] self-deal pre-publish blocked: peer=${peer.slice(-12)} pay_address=${draft.pay_address.slice(0,12)}... ∈ broker wallets`);
          return `挂单失败: 你给的地址 ${draft.pay_address.slice(0,10)}...${draft.pay_address.slice(-6)} 是 broker 自己的钱包(不是你的). BUY 流程是 you 付 USDT 到 broker 自挂 maker addr → broker 给 KAS 到 you Kasia. 请回**你自己的** EVM 钱包地址 (你能 send USDT from 这地址) — 不是 broker 或别人的. 想重新下单回 "取消" 后再发.`;
        }
      } catch (err) {
        console.warn(`[broker-v2 R4] self-deal check err: ${err.message}, skip guard`);
      }
    }
    try {
      const result = await orderBook.publishOrder(peer, draft);
      if (!result.ok) {
        return `挂单失败 (${result.error || 'unknown'}). 请稍后重试或回 "取消" 取消.`;
      }
      state.advance(peer, 'awaiting_payment');  // post-publish, schema CHECK OK
      // bug 7 fix (J2 r25 vote (b)): user-facing sync ack 必含关键词 (ux_p04_buy_confirm_sync_ack
      // 测要 reply 含 '收到'/'已建'/'订单'/'确认'/'付款'/'马上' 任一). prepend sync line, 业务 detail 跟后.
      // result.ack_text 可能 = "Broker self-quoted (...)." (无 sync 关键词) → 单独 fallback 不够.
      const syncAck = '✓ 收到, 订单已建. 付款指引马上发你, 自动检测付款.';
      const detail = result.ack_text || (result.offer_id ? `挂单 ID: ${result.offer_id.slice(0, 8)}` : '');
      return detail ? `${syncAck}\n\n${detail}` : syncAck;
    } catch (e) {
      console.error(`[broker-v2 router] publishOrder err: ${e.message}`);
      return `挂单失败 (${e.message}). 请稍后重试或回 "取消" 取消.`;
    }
  }

  // 7. confirm intent + draft 不全 → 提示缺啥
  if (intent === 'confirm' && draft && !draft.complete) {
    return `还差: ${_listMissing(draft)}. 告诉我后我会展示订单画像让你最后确认.`;
  }

  // 8. complete draft + 'aligning' + 本 turn 写了字段 → render preview
  // 仅本 turn 写字段时 re-render (user 改 qty 后 re-quote). 没写字段的 turn (复合 intent 'YES, 价格建议?'
  // 或者纯 question) 落 step 9 LLM, 防 step 8 拦截 LLM 答 question.
  if (draft?.complete && draft.state === 'aligning' && fieldsWrittenThisTurn) {
    try {
      const preview = await orderBook.computePreview(peer, draft);
      if (!preview.ok) {
        return `生成报价失败 (${preview.error || 'unknown'}). 请稍后重试或调整字段.`;
      }
      return preview.preview_text || '订单画像生成中... 请稍等';
    } catch (e) {
      console.warn(`[broker-v2 router] computePreview err: ${e.message}`);
      return `生成报价失败 (${e.message}). 请稍后重试或调整字段.`;
    }
  }

  // 9. draft 不全 OR 本 turn 没写字段 → LLM render (问字段 OR 答 question / 复合 intent)
  const completeBeforeLlm = !!draft?.complete;
  const profile = _loadProfile(peer);
  const contact = _loadContact(peer);
  const reply = await llm.render(peer, msg, draft, profile, contact);

  // 10. post-LLM: 仅 LLM tool_call 补全字段 (pre-LLM 不 complete → post-LLM complete) 时 render preview
  // 不重 render 已 complete draft (复合 intent 'YES, 价格建议?' LLM 答 question 不破 preview).
  draft = state.getActiveDraft(peer);
  if (!completeBeforeLlm && draft?.complete && draft.state === 'aligning') {
    try {
      const preview = await orderBook.computePreview(peer, draft);
      if (preview.ok) return preview.preview_text;
    } catch {
      // fall through to LLM reply
    }
  }

  return reply || `还需告诉我: ${_listMissing(draft)}.`;
}

function _listMissing(draft) {
  // post 3ce77b62f: 删 FIELD_MAP['asset'], retail_dex_orders 无 asset col, draft.asset 永 undefined.
  // phase 1 hardcode KAS only — 不再列 '资产' (NWT 4cbbaf78 critical fix).
  if (!draft) return '方向 (买/卖) + 数量 + 链 + 收款地址';
  const m = [];
  if (!draft.side) m.push('方向 (买/卖)');
  if (!draft.qty) m.push('数量');
  if (!draft.pay_chain) m.push('链 (BSC/Polygon/SOL/TRON)');
  if (draft.side === 'sell_kas' && !draft.pay_address) m.push('EVM 收款地址 (0x...)');
  return m.join(' / ');
}

function _formatStatus(status) {
  if (!status || !status.ok) return '没找到你的活跃挂单. 想下新单告诉我.';
  const { qty, filled_qty, expires_at, state: phase, exchange_offer_id } = status;
  const unfilled = parseFloat(qty || 0) - parseFloat(filled_qty || 0);
  // C3 (J2 broker-v2 phase 1 r6): UI infer derived 'published' display from exchange_offer_id NOT NULL.
  // 缓 broker-intake-watcher.js L209 'broadcast' silent fail bug (schema CHECK 拒) — state 不 advance,
  // exchange_offer_id 仍 set. UI infer 'published' 不需 schema enum 加. r6 共识 C3 vote.
  const phaseDisplay = exchange_offer_id
    ? `${phase} (链上挂单 published, offer ID ${exchange_offer_id.slice(0, 8)})`
    : phase;
  return `挂单状态:\n- 总量: ${qty} KAS\n- 已成交: ${filled_qty || 0} KAS\n- 未成交: ${unfilled.toFixed(4)} KAS\n- 状态: ${phaseDisplay}\n- 到期: ${expires_at || '无'}`;
}

function _loadProfile(peer) {
  return sqlite.prepare(`
    SELECT distilled_summary, preferred_chain, preferred_pay_address, tone_preference
    FROM retail_dex_user_memory WHERE user_kasia_address = ?
  `).get(peer);
}

function _loadContact(peer) {
  return sqlite.prepare(`
    SELECT their_alias, classification, trust_level, is_blocked
    FROM relation_states WHERE peer_address = ?
  `).get(peer);
}
