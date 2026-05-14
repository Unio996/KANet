// ════════════════════════════════════════════════════════════════
// broker-v3/router.js — 主入口 dispatch (路 A 选择题 deterministic)
//
// Spec: docs/INVARIANTS-broker-dual-path-v0.4.md (v0.6 iterate per NWT r225)
//
// dispatch flow:
//   1. conversations.js POST /api/agent/reply → BROKER_V3_ENABLED check → handleMessage(peer, msg, opts)
//   2. handleMessage 调 state-machine.processInput(peer, msg, relayNodeId) → { reply, trigger flag, draft }
//   3. 按 trigger flag dispatch:
//      - triggerPublish → exchange-client.publishOffer + transition state
//      - triggerAccept → exchange-client.acceptOffer + reply payment_guide
//      - triggerCancel → exchange-client.cancelOffer
//      - triggerBrowse / triggerMyOrders / triggerOfferLookup / triggerOfferStatus → fetch + back-fill state
//   4. 自然语言 fallback (msg 非数字非 0x 非 'YES'/'NO' 等关键词) → return null (conversations.js fall 路 B matcher)
//
// 跟 broker-v2/router.js 不同: 0 LLM 依赖 (state-machine pure deterministic), 0 sqlite import (全 fetchJson HTTP API).
// ════════════════════════════════════════════════════════════════

import * as stateMachine from './state-machine.js';
import * as client from './exchange-client.js';
import { sqlite } from '../../db/client.js';

// T-J2-2026-05-12 Fix 2 (5/12 sediment §3.2 bsc-vs-bnb naming): chain normalize.
// BSC family 统一 'bnb' (DB-canonical, align agent_wallets.chain). 跟 api/exchange.js 同款.
// 复用候选 (future): 移 shared util, 先 duplicate 避新建 file (per feedback_no_new_build_iterate_first).
function normalizeChainKey(s) {
  if (!s) return s;
  const lower = String(s).toLowerCase();
  if (lower === 'bsc' || lower === 'bep20' || lower === 'binance-smart-chain') return 'bnb';
  if (lower === 'solana') return 'sol';
  if (lower === 'ethereum') return 'eth';
  return lower;
}

// J2 5/14 Sub Tier-2 (NWT 11:18 backlog ack): test-only export 供 functional regression
// 真 call normalizeChainKey + assert alias 行为. 跟 exchange.js 同款 (duplicate, future shared util refactor).
export const _testInternalsRouter = { normalizeChainKey };

// T-J2-2026-05-07 r259 T2.1b — Layer 2 Price Oracle Gap fix.
// MID_PRICE 改 dynamic /api/trade/kas-price (跟 market-seeder 同 source) — 替 hardcode 0.04 phase 1 placeholder.
// FALLBACK_MID_PRICE 真 oracle down 时 graceful 用 (不阻 publish).
const FALLBACK_MID_PRICE = 0.04;

/**
 * 主入口 — conversations.js BROKER_V3_ENABLED dispatch.
 * @param {string} peer - user kasia 地址 (future: canonical user_id)
 * @param {string} msg - user 当前 chat DM
 * @param {object} opts - { relayNodeId } broker (Trader-B) relay id
 * @returns {Promise<string|null>} reply text, OR null (fallback 路 B matcher)
 */
export async function handleMessage(peer, msg, opts = {}) {
  const relayNodeId = opts.relayNodeId;
  if (!relayNodeId) {
    console.warn('[broker-v3] handleMessage 缺 relayNodeId');
    return null;
  }

  // Phase A.2 (J2 #336 per NWT spec ffcd4778, Owner 5/13 钦定纯菜单, LLM 残留全删):
  // broker-v2 archive ✓, fall-through 到 v2 LLM path 全删. broker-v3 不识别 → return null,
  // conversations.js dispatch canned reply 提醒 user 用菜单 (NWT spec 替代 LLM fallback).
  // 自然语言 (非数字非 0x) + v3 不在 flow → return null fall canned.
  const trimmed = (msg || '').trim();
  if (!_isLanguageA(trimmed)) {
    return null;  // 自然语言 → canned reply (no LLM fallback)
  }

  const result = await stateMachine.processInput(peer, trimmed, relayNodeId);
  if (!result) return null;

  let reply = result.reply || '';

  // dispatch trigger flag
  try {
    // Bug H 5/14 candidate A v2 (Owner 12:05 钦定): triggerPublish → triggerQuote
    // (BUY/SELL CONFIRM 'YES' 改 generate quote, 等 user prepay 后才 publish via watcher hook).
    // 现 triggerPublish 仅 internal call from watcher post-prepay-detect (router.js 不 surface 给 state-machine).
    // Bug H 5/14 candidate A v2 (Owner 12:05 钦定): ESCROW_MODE 路径分
    // triggerQuote (escrow on) → _doQuote (新 quote + INSERT pending escrow row)
    // triggerPublish (escrow off, legacy) → _doPublish (broker-as-maker 旧 path, Owner Bug H surface 现 mode 但 ship 后 default off)
    if (result.triggerQuote) reply = await _doQuote(peer, result.draft, relayNodeId, reply);
    else if (result.triggerPublish) reply = await _doPublish(peer, result.draft, relayNodeId, reply);
    else if (result.triggerCheckPrepayStatus) reply = await _doCheckPrepayStatus(peer, result.draft, reply);
    else if (result.triggerAccept) reply = await _doAccept(peer, result.draft, relayNodeId, reply);
    else if (result.triggerCancel) reply = await _doCancel(peer, result.draft, relayNodeId, reply);
    else if (result.triggerBrowse) reply = await _doBrowse(peer, reply);
    else if (result.triggerBrowseNext) reply = await _doBrowseNext(peer, reply);
    else if (result.triggerMyOrders) reply = await _doMyOrders(peer, reply);
    else if (result.triggerOfferLookup) reply = await _doOfferLookup(peer, result.draft, reply);
    else if (result.triggerOfferStatus) reply = await _doOfferStatus(peer, result.draft, reply);
    // Phase B P1 (J2 #339 per NWT spec 4324dccc): WAIT_PAYMENT dispatch
    else if (result.triggerSubmitPayment) reply = await _doSubmitPayment(peer, result.draft, relayNodeId, reply);
    else if (result.triggerDispute) reply = await _doDispute(peer, result.draft, relayNodeId, reply);
  } catch (err) {
    console.error(`[broker-v3] trigger dispatch err: ${err.message}`);
    reply = `操作出错: ${err.message?.slice(0, 80) || 'unknown'}. 回 back 返回菜单.`;
  }

  return reply;
}

// 数字 / back / YES / NO / 0x... / offer_id-like → 进路 A. 其他 → 路 B fallback.
// T-J2-2026-05-06 r230 fix: 取 leading token (split on whitespace), 接受 trailing suffix.
// production user 单发 '1' 仍 work (subset of leading match), 测试加 salt '1 #v3-xxx' 也识别. 通用 + 测试友好.
function _isLanguageA(msg) {
  if (!msg) return false;
  const head = String(msg).trim().split(/\s+/)[0] || '';
  if (/^[1-6]$/.test(head)) return true;  // menu number
  if (/^(back|取消|返回|menu|next)$/i.test(head)) return true;  // 控制 keyword
  if (/^(yes|y|确认|ok|好|发布|算了|no|n|不)$/i.test(head)) return true;  // confirm/cancel
  if (/^0x[a-fA-F0-9]{40}$/.test(head)) return true;  // EVM addr
  if (/^[a-f0-9-]{8,}$/i.test(head)) return true;  // offer_id / uuid
  if (/^\d+(\.\d+)?$/.test(head)) return true;  // qty number
  return false;
}

// Bug H 5/14 candidate A v2 (Owner 12:05 钦定 broker-escrow custody):
// _doQuote — replaces _doPublish for BUY/SELL CONFIRM 'YES' trigger.
// 不直接 publish offer, 而是: (1) compute quote with deterministic noise via quote_seq,
// (2) lookup broker recv addr (broker BSC for BUY user prepay USDT; broker Kaspa for SELL user prepay KAS),
// (3) INSERT user_escrow_balances pending_prepay row, (4) reply user with quote + broker addr.
// Watcher post-prepay-detect → _doPublishAfterPrepay (separate trigger via watcher service).
import { randomUUID } from 'node:crypto';
async function _doQuote(peer, draft, relayNodeId, prevReply) {
  if (!draft) return prevReply + '\n\n(no draft, back 重来)';
  const qty = parseFloat(draft.qty);
  const isBuy = draft.side === 'buy_kas';
  const chainKey = normalizeChainKey(draft.pay_chain);

  // T-J2-2026-05-07 r259: live mid price oracle
  const livePrice = await client.getKasPrice();
  const midPrice = livePrice || FALLBACK_MID_PRICE;
  // Compute quote base amount (USDT for BUY, USDT for SELL since user receives USDT but prepays KAS)
  // BUY: user prepays USDT, receives KAS → quote_amount_usdt = qty * midPrice
  // SELL: user prepays KAS (qty itself), receives USDT → quote_amount_usdt (target) = qty * midPrice
  const baseQuoteUsdt = qty * midPrice;

  // Get broker recv addr:
  // BUY: user prepays USDT → broker addr on selected EVM chain (chainKey)
  // SELL: user prepays KAS → broker addr on Kaspa
  let brokerRecvAddr = null;
  let prepayAsset = isBuy ? 'USDT' : 'KAS';
  let prepayChain = isBuy ? chainKey : 'kaspa';
  // Base chain uses USDC instead of USDT
  if (isBuy && chainKey === 'base') prepayAsset = 'USDC';
  if (isBuy) {
    const w = sqlite.prepare(
      'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1'
    ).get(relayNodeId, chainKey)
      || sqlite.prepare(
        'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? LIMIT 1'
      ).get(relayNodeId, chainKey);
    if (!w?.address) {
      stateMachine.clearFlowState(peer);
      return `报价失败: broker 还没在 ${chainKey.toUpperCase()} 链配钱包. 联系 admin OR 选别链.`;
    }
    brokerRecvAddr = w.address;
  } else {
    // SELL: broker recv addr = broker's kaspa addr (relay address)
    const r = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ? LIMIT 1').get(relayNodeId);
    if (!r?.address) {
      stateMachine.clearFlowState(peer);
      return `报价失败: broker Kasia addr 找不到. 联系 admin.`;
    }
    brokerRecvAddr = r.address;
  }

  // Deterministic noise via quote_seq (NWT 12:12 反 push back J2 Q4: deterministic, NOT random):
  // amount = base + (seq % 9999) * 1e-6 USDT (1e-6 is BSC USDT smallest unit)
  // For SELL prepay KAS, noise applies to KAS amount instead.
  let nextSeq;
  try {
    const row = sqlite.prepare('SELECT COALESCE(MAX(quote_seq), 0) + 1 AS next_seq FROM user_escrow_balances').get();
    nextSeq = row?.next_seq || 1;
  } catch { nextSeq = Date.now() % 9999 + 1; }  // fallback if table not yet migrated
  const noiseUnit = isBuy ? 0.000001 : 0.0000001;  // USDT 6-decimal vs KAS 8-decimal
  const noise = (nextSeq % 9999) * noiseUnit;
  let amountQuoted;
  if (isBuy) {
    amountQuoted = (baseQuoteUsdt + noise).toFixed(6);
  } else {
    // SELL: amount = qty KAS + noise
    amountQuoted = (qty + noise).toFixed(8);
  }

  // target asset (what user receives after match)
  const targetAsset = isBuy ? 'KAS' : (chainKey === 'base' ? 'USDC' : 'USDT');
  const targetChain = isBuy ? 'kaspa' : chainKey;
  const targetAmount = isBuy ? String(qty) : (baseQuoteUsdt).toFixed(4);
  // user target addr — BUY: user kasia addr (peer); SELL: user pay_address (broker forwards USDT here)
  const userTargetAddr = isBuy ? peer : draft.pay_address;

  // Insert pending escrow record (5 min TTL for pending_prepay status)
  const escrowId = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  try {
    sqlite.prepare(`
      INSERT INTO user_escrow_balances (
        id, quote_seq, side, user_kasia_addr, asset, chain, amount_quoted,
        broker_recv_addr, target_amount, target_asset, target_chain, user_target_addr,
        status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_prepay', ?, datetime('now'), datetime('now'))
    `).run(escrowId, nextSeq, draft.side, peer, prepayAsset, prepayChain, amountQuoted,
           brokerRecvAddr, targetAmount, targetAsset, targetChain, userTargetAddr, expiresAt);
  } catch (e) {
    console.error(`[broker-v3 _doQuote] INSERT user_escrow_balances err: ${e.message}`);
    stateMachine.clearFlowState(peer);
    return `报价失败: 内部错误 (${e.message?.slice(0, 50)}). 回 back 重来.`;
  }

  // Reply text — quote + broker addr + amount + TTL
  return [
    `📋 报价 (${isBuy ? '买' : '卖'} ${qty} KAS, ${chainKey.toUpperCase()})`,
    '',
    `  KAS 中间价: ${midPrice.toFixed(6)} ${targetAsset}/KAS`,
    `  ${isBuy ? '你付' : '你收'}总额: ${(isBuy ? baseQuoteUsdt : baseQuoteUsdt).toFixed(4)} ${prepayAsset === 'KAS' ? targetAsset : prepayAsset}`,
    '',
    `💸 请真链 transfer 精确 ${amountQuoted} ${prepayAsset} 到 broker:`,
    `  地址: ${brokerRecvAddr}`,
    `  链: ${prepayChain.toUpperCase()}`,
    `  数量: ${amountQuoted} ${prepayAsset} (含 micro-noise ${(noise).toExponential(2)} for quote 匹配)`,
    '',
    `⏰ 5 分钟内 transfer 到账, 否则报价自动失效 + 不扣 fee.`,
    isBuy
      ? `✓ 到账后 broker 自动挂买单 + 成交后 deliver ${qty} KAS to 你 Kasia (${peer.slice(0, 18)}...).`
      : `✓ 到账后 broker 自动挂卖单 + 成交后 deliver ${(baseQuoteUsdt).toFixed(4)} ${targetAsset} to 你 (${userTargetAddr?.slice(0, 16) || '?'}...).`,
    '',
    '回 cancel 立即取消 / status 查 prepayment 状态.',
  ].join('\n');
}

async function _doCheckPrepayStatus(peer, draft, prevReply) {
  // Bug H 5/14 candidate A v2: query user_escrow_balances WHERE user=peer + status='pending_prepay'
  const rows = sqlite.prepare(`
    SELECT id, side, amount_quoted, asset, chain, broker_recv_addr, status, expires_at
    FROM user_escrow_balances
    WHERE user_kasia_addr = ? AND status = 'pending_prepay'
    ORDER BY created_at DESC LIMIT 1
  `).all(peer);
  if (rows.length === 0) {
    stateMachine.clearFlowState(peer);
    return '你当前无 active 报价. 回菜单重新下单.';
  }
  const r = rows[0];
  const remainingMs = new Date(r.expires_at).getTime() - Date.now();
  const remainingMin = Math.max(0, Math.round(remainingMs / 60000));
  return [
    `📋 报价状态: pending_prepay (等你真链 transfer)`,
    `  方向: ${r.side === 'buy_kas' ? '买 KAS' : '卖 KAS'}`,
    `  请 transfer: ${r.amount_quoted} ${r.asset} on ${r.chain.toUpperCase()}`,
    `  到: ${r.broker_recv_addr}`,
    `  剩余时间: ${remainingMin} min`,
    '',
    '回 cancel 立即取消 OR 等真链 transfer 到账 (5 min 超时自动失效).',
  ].join('\n');
}

// Bug H 5/14 candidate A v2 Sub #5.残: _doPublishAfterPrepay — escrow watcher service post-prepay-detect 调.
// 接 escrowRowId (user_escrow_balances pending_prepay row), 真 publish offer with 正确 BUY/SELL semantic:
// - BUY (user prepay USDT): give=USDT/USDC (escrow), want=KAS (user receives), accepted_chains.address=broker_kaspa_addr
// - SELL (user prepay KAS): give=KAS (escrow), want=USDT/USDC, accepted_chains.address=broker_evm_addr
// 不同 legacy _doPublish (broker-as-market-maker, give=KAS want=USDT for BOTH BUY+SELL — Bug H surface 现 mode).
// 修复后 update escrow status pending_prepay → active + offer_id backfill.
export async function _doPublishAfterPrepay(escrowRowId, relayNodeId) {
  const e = sqlite.prepare('SELECT * FROM user_escrow_balances WHERE id = ?').get(escrowRowId);
  if (!e) return { ok: false, error: `escrow row ${escrowRowId} not found` };
  if (e.status !== 'pending_prepay') return { ok: false, error: `escrow row status=${e.status}, expected pending_prepay` };

  const isBuy = e.side === 'buy_kas';
  const chainKey = isBuy ? e.chain : e.target_chain;  // EVM chain for both (BUY prepay chain = target taker pay, SELL target chain = USDT receive chain)

  // broker recv addr for the TAKER (where taker sends payment when accepting):
  // BUY (broker-as-maker, give USDT want KAS): taker sells KAS, taker sends KAS to broker_kaspa_addr
  // SELL (broker-as-maker, give KAS want USDT): taker buys KAS, taker sends USDT to broker_evm_addr
  let takerSendAddr = null;
  if (isBuy) {
    // taker delivers KAS to broker Kasia
    const r = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ? LIMIT 1').get(relayNodeId);
    takerSendAddr = r?.address;
  } else {
    // taker delivers USDT/USDC to broker EVM on chainKey
    const w = sqlite.prepare(
      'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1'
    ).get(relayNodeId, chainKey)
      || sqlite.prepare(
        'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? LIMIT 1'
      ).get(relayNodeId, chainKey);
    takerSendAddr = w?.address;
  }
  if (!takerSendAddr) return { ok: false, error: `broker addr lookup fail for chain ${chainKey}` };

  // Build publish body with CORRECT A v2 semantic (反 legacy _doPublish 现 mode):
  const body = isBuy
    ? {
        // BUY semantic: broker holds user USDT (escrow), wants KAS for user
        relayNodeId,
        give_asset: e.asset,                          // USDT or USDC (user prepaid)
        give_amount: String(e.target_amount),         // target qty * mid (USDT escrow amount)
        give_chain: e.chain,                          // EVM chain where escrow USDT sits
        want_asset: 'KAS',                            // broker wants KAS for user
        want_amount: String(e.target_amount),         // qty KAS user wants
        want_chain: 'kaspa',
        verification: 'cross_chain_tx',
        verification_meta: {
          accepted_chains: [{ chain: 'kaspa', address: takerSendAddr }],  // taker sends KAS here
          expected_asset: 'KAS',
          receive_chain: 'kaspa',
          escrow_id: e.id,
          escrow_user: e.user_kasia_addr,
          escrow_user_target: e.user_target_addr,  // user's kasia addr (where broker forwards KAS post-match)
        },
        expires_minutes: 30,
        metadata: { source: 'broker-v3-escrow', user_id: e.user_kasia_addr, side: 'buy_kas', escrow_id: e.id, hedge_enabled: false },
      }
    : {
        // SELL semantic: broker holds user KAS (escrow), wants USDT for user
        relayNodeId,
        give_asset: 'KAS',
        give_amount: String(e.amount_received || e.amount_quoted),  // qty KAS escrow
        give_chain: 'kaspa',
        want_asset: e.target_asset,                   // USDT or USDC (user receives)
        want_amount: String(e.target_amount),         // target USDT amount
        want_chain: e.target_chain,                   // EVM chain user wants USDT received
        verification: 'cross_chain_tx',
        verification_meta: {
          accepted_chains: [{ chain: chainKey, address: takerSendAddr }],  // taker sends USDT/USDC here
          expected_asset: e.target_asset,
          receive_chain: chainKey,
          escrow_id: e.id,
          escrow_user: e.user_kasia_addr,
          escrow_user_target: e.user_target_addr,  // user's EVM addr (where broker forwards USDT post-match)
        },
        expires_minutes: 30,
        metadata: { source: 'broker-v3-escrow', user_id: e.user_kasia_addr, side: 'sell_kas', escrow_id: e.id, hedge_enabled: false },
      };

  const r = await client.publishOffer(body);
  if (!r.ok) {
    console.error(`[broker-v3 _doPublishAfterPrepay] publishOffer fail for escrow ${e.id.slice(0, 8)}: ${r.error}`);
    return { ok: false, error: r.error || 'publish failed' };
  }

  // backfill offer_id + update status active
  if (r.offer_id) {
    sqlite.prepare(`
      UPDATE user_escrow_balances
      SET offer_id = ?, status = 'active', expires_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(r.offer_id, r.expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString(), e.id);
    // Also record offer in user's MY_ORDERS reverse index (P1 fix)
    stateMachine.addUserOffer(e.user_kasia_addr, r.offer_id);
  }

  return { ok: true, offer_id: r.offer_id, broadcast_tx: r.broadcast_tx, expires_at: r.expires_at };
}

// Bug H 5/14 candidate A v2: _doPublish 仍是 legacy broker-as-market-maker path.
// 用于 ESCROW_MODE=false (默认) 时 state-machine triggerPublish dispatch.
// Owner Bug H surface 现 mode 在此 — 但 user 已知不去用直 Owner 翻 flag.
// 注: Owner ack escrow stable + flag flip 后, 此 legacy _doPublish 可 sweep delete.
async function _doPublish(peer, draft, relayNodeId, prevReply) {
  if (!draft) return prevReply + '\n\n(no draft, back 重来)';
  const qty = parseFloat(draft.qty);
  const isBuy = draft.side === 'buy_kas';
  // T-J2-2026-05-07 r259 T2.1b — fetch live KAS mid price (graceful fallback to 0.04 if oracle down)
  const livePrice = await client.getKasPrice();
  const midPrice = livePrice || FALLBACK_MID_PRICE;
  const wantAmount = String((qty * midPrice).toFixed(4));

  // T-J2-2026-05-12 Fix 1 (5/12 sediment §3.1, NWT spec ea519032a §2.1):
  // BUY 分支也必含 accepted_chains. taker (买 USDT 给 broker 换 KAS 的人) 选链支付 → broker 的 USDT 收款 addr 必在 accepted_chains.
  // 跟 SELL 分支区别: SELL 的 accepted_chains[0].address = user 的 USDT 收款 addr (broker 发给 user);
  // BUY 的 accepted_chains[0].address = broker 自己 chain wallet (user 发给 broker).
  const chainKey = normalizeChainKey(draft.pay_chain);  // 'bsc' → 'bnb' 等, align DB agent_wallets.chain
  let brokerWalletAddr = null;
  if (isBuy) {
    const w = sqlite.prepare(
      'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1'
    ).get(relayNodeId, chainKey)
      || sqlite.prepare(
        'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? LIMIT 1'
      ).get(relayNodeId, chainKey);
    if (!w?.address) {
      stateMachine.clearFlowState(peer);
      return `挂单失败: broker 还没在 ${draft.pay_chain.toUpperCase()} 链配 USDT 收款地址. 联系管理员加 wallet OR 选别的链.`;
    }
    brokerWalletAddr = w.address;
  }

  // T-J2-2026-05-07 r259 T2.1c — Layer 4 Loop Closed: hedge_enabled flag 真 broker offer
  // hedge-eligible (executeHedge 真 trade-protocol-filter.js:836-848 真 opt-in gate, default skip).
  // Enable hedge 真 broker 真 fulfill via CEX (post Phase 1 cex-bridge ship).
  const body = isBuy
    ? {
        relayNodeId,
        give_asset: 'KAS', give_amount: String(qty), give_chain: 'kaspa',
        want_asset: 'USDT', want_amount: wantAmount,
        want_chain: chainKey,
        verification: 'cross_chain_tx',
        // Fix 1: accepted_chains 用 broker 自己 wallet addr (user 发 USDT 给 broker)
        verification_meta: {
          accepted_chains: [{ chain: chainKey, address: brokerWalletAddr }],
          expected_asset: 'USDT',
          receive_chain: chainKey,
        },
        expires_minutes: 30,
        metadata: { source: 'broker-v3', user_id: peer, side: 'buy_kas', hedge_enabled: true, mid_price_used: midPrice },
      }
    : {
        relayNodeId,
        give_asset: 'KAS', give_amount: String(qty), give_chain: 'kaspa',
        want_asset: 'USDT', want_amount: wantAmount,
        want_chain: chainKey,
        verification: 'cross_chain_tx',
        // SELL: accepted_chains 用 user 自己的 USDT 收款 addr (broker 发 USDT 给 user). chain normalize align.
        verification_meta: { accepted_chains: [{ chain: chainKey, address: draft.pay_address }], expected_asset: 'USDT' },
        expires_minutes: 30,
        metadata: { source: 'broker-v3', user_id: peer, side: 'sell_kas', hedge_enabled: true, mid_price_used: midPrice },
      };
  const r = await client.publishOffer(body);
  if (!r.ok) {
    stateMachine.clearFlowState(peer);
    return `挂单失败: ${r.error || 'unknown'}. 回 back 重来.`;
  }
  // P1 fix 5/14 (Tier 4 C1.6 UX gap): record offer → user so MY_ORDERS 看得见
  if (r.offer_id) stateMachine.addUserOffer(peer, r.offer_id);
  // ship 成功 — clear draft, return offer detail
  stateMachine.clearFlowState(peer);
  return [
    '✓ 挂单已上链.',
    '',
    `  offer_id: ${r.offer_id?.slice(0, 12)}`,
    `  广播 tx: ${r.broadcast_tx?.slice(0, 16)}`,
    `  到期: ${r.expires_at}`,
    '',
    '回 5 看我的订单 / back 返回菜单.',
  ].join('\n');
}

async function _doAccept(peer, draft, relayNodeId, prevReply) {
  if (!draft?.offer_id || !draft?.selected_chain) return prevReply + '\n\n(no draft, back 重来)';
  // Bug F 5/14 fix (NWT 10:53 选 A — broker-v3 mediator self-deal false-positive):
  // peer (user kasia addr) 反查 relay_nodes 得 user's local relay id. server accept API 用 user
  // relay 当 taker → 不撞 broker self-deal (maker === taker only when broker accepts own offer).
  // user 不在本节点有 relay 时 fallback: 返 explicit error (broker 无法代签 chain TX).
  let takerRelayId = null;
  try {
    const userRelay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ? LIMIT 1').get(peer);
    if (userRelay?.id) takerRelayId = userRelay.id;
  } catch (e) {
    console.warn(`[broker-v3 _doAccept] relay lookup err for peer ${peer?.slice(-12)}: ${e.message}`);
  }
  if (!takerRelayId) {
    stateMachine.clearFlowState(peer);
    return [
      '⚠ 接单失败: 你需在本节点有 relay 才能通过 broker 接单.',
      '',
      '解决:',
      '  1️⃣ 直接 curl POST /api/exchange/accept (用你自己 relay id) 接单 — 跳过 broker mediator',
      '  2️⃣ 联系 admin 在本节点注册你 relay (Kasia mnemonic)',
      '',
      '回 back 返回菜单.',
    ].join('\n');
  }
  const r = await client.acceptOffer({
    relayNodeId: takerRelayId,  // user relay (taker), 不是 broker relay
    offer_id: draft.offer_id,
    selected_chain: draft.selected_chain,
    payment_asset: 'usdt',
  });
  if (!r.ok) {
    stateMachine.clearFlowState(peer);
    return `接单失败: ${r.error || 'unknown'}. 回 back 重来.`;
  }
  // 进 WAIT_PAYMENT, fetch offer 详情看 maker BSC addr
  const offerR = await client.getOffer(draft.offer_id);
  const meta = (() => { try { return JSON.parse(offerR.offer?.verification_meta || '{}'); } catch { return {}; } })();
  // Bug C 5/14 fix (NWT C4.4 Tier 4 surface): chain === naked compare 漏 normalize, accepted_chains 元素 stored 'bnb'
  // (publish 已 normalize), draft.selected_chain='bsc' (broker-v3 menu label) → fail fallback receive_address.
  const selectedChainNormR = normalizeChainKey(draft.selected_chain);
  const makerAddr = meta.accepted_chains?.find(c => normalizeChainKey(c.chain) === selectedChainNormR)?.address || meta.receive_address || '?';
  const wantAmt = offerR.offer?.want_amount || '?';
  const wantAsset = offerR.offer?.want_asset || 'USDT';
  stateMachine.setFlowState(peer, { flow: 'WAIT_PAYMENT', step: 'PAID', draft: { offer_id: draft.offer_id, selected_chain: draft.selected_chain } });
  return [
    '✓ 接单成功!',
    '',
    `  offer_id: ${draft.offer_id.slice(0, 12)}`,
    `  接单 tx: ${r.accept_tx?.slice(0, 16)}`,
    '',
    '💸 请转 USDT 付款:',
    `  数量: ${wantAmt} ${wantAsset}`,
    `  链: ${draft.selected_chain.toUpperCase()}`,
    `  收款地址: ${makerAddr}`,
    '',
    '付完后 broker 自动验证 + 发 KAS 到你 Kasia. 回 5 查订单状态.',
    r.reputationWarning ? `\n⚠ ${r.reputationWarning.message || ''}` : '',
  ].filter(Boolean).join('\n');
}

// Phase B P1 (J2 #339 per NWT spec 4324dccc): WAIT_PAYMENT user 报告 payment tx → submit-payment
async function _doSubmitPayment(peer, draft, relayNodeId, prevReply) {
  if (!draft?.offer_id || !draft?.payment_tx) return prevReply + '\n\n(no draft, back 重来)';
  const chainKey = normalizeChainKey(draft.selected_chain || 'bnb');
  const r = await client.submitPayment({
    relayNodeId, offer_id: draft.offer_id,
    payment_tx: draft.payment_tx,
    payment_chain: chainKey,
  });
  if (!r.ok) return `提交付款证明失败: ${r.error || 'unknown'}. 检查 tx hash 是否对, 或回 "争议" 启 dispute.`;
  return [
    '✓ 付款证明已提交, broker 验证中.',
    '',
    `  offer_id: ${draft.offer_id.slice(0, 12)}`,
    `  payment_tx: ${draft.payment_tx.slice(0, 16)}...`,
    `  状态: ${r.status || 'verifying'}`,
    '',
    'broker cross-chain verify ~30-60s. 完成后自动发 KAS 到你 Kasia.',
    '回 5 查订单状态 / back 返回菜单.',
  ].join('\n');
}

// Phase B P1: WAIT_PAYMENT user 启 dispute (verify fail OR 卡死)
async function _doDispute(peer, draft, relayNodeId, prevReply) {
  if (!draft?.offer_id) return prevReply + '\n\n(no draft, back 重来)';
  const r = await client.disputeOffer({
    relayNodeId, offer_id: draft.offer_id,
    reason: 'broker-v3 menu user-initiated dispute',
  });
  if (!r.ok) return `发起争议失败: ${r.error || 'unknown'}. 联系 Owner.`;
  return [
    '⚠ 争议已发起.',
    '',
    `  offer_id: ${draft.offer_id.slice(0, 12)}`,
    `  状态: ${r.status || 'disputed'}`,
    '',
    'Owner / arbiter 会介入 resolve. 等通知.',
    '回 5 查订单状态 / back 返回菜单.',
  ].join('\n');
}

async function _doCancel(peer, draft, relayNodeId, prevReply) {
  if (!draft?.offer_id) return prevReply + '\n\n(no draft, back 重来)';
  const r = await client.cancelOffer({ relayNodeId, offer_id: draft.offer_id });
  stateMachine.clearFlowState(peer);
  if (!r.ok) return `取消失败: ${r.error || 'unknown'}. 回 back.`;
  return `✓ 已取消 offer ${draft.offer_id.slice(0, 12)} (cancel tx: ${r.cancel_tx?.slice(0, 16)}). 回 back 返回菜单.`;
}

async function _doBrowse(peer, prevReply) {
  const r = await client.listOffers({ status: 'open', limit: 5, offset: 0 });
  if (!r.ok || !r.offers?.length) return '当前无 active 挂单. 回 back 返回菜单.';
  const cur = stateMachine.getFlowState(peer) || {};
  stateMachine.setFlowState(peer, { ...cur, flow: 'BROWSE_MARKET', step: 'LIST', offers: r.offers, page: 0 });
  return _renderBrowseList(r.offers);
}

async function _doBrowseNext(peer, prevReply) {
  const cur = stateMachine.getFlowState(peer);
  const page = (cur?.page || 0) + 1;
  const r = await client.listOffers({ status: 'open', limit: 5, offset: page * 5 });
  if (!r.ok || !r.offers?.length) return '没更多挂单. 回 back 返回菜单.';
  stateMachine.setFlowState(peer, { ...cur, page, offers: r.offers });
  return _renderBrowseList(r.offers);
}

function _renderBrowseList(offers) {
  const lines = ['📋 市场挂单 (回 1-5 选, next 翻页, back 返回菜单):', ''];
  offers.forEach((o, i) => {
    lines.push(`${i + 1}️⃣ ${o.give_amount} ${o.give_asset} → ${o.want_amount} ${o.want_asset} (${o.want_chain || '?'})`);
    lines.push(`   id: ${o.id?.slice(0, 12)} · maker: ...${o.maker?.slice(-12)}`);
  });
  return lines.join('\n');
}

async function _doMyOrders(peer, prevReply) {
  // P1 fix 5/14 (Tier 4 C1.6 UX gap, NWT + J2 双 host reproduce): broker publishes offers
  // with maker = broker_addr (broker-as-maker pattern). 旧 listOffers({ maker: peer }) → 0 row.
  // Fix: 走 stateMachine.getUserOffers(peer) (publish 后 record) + getOffer 拉详情.
  const offerIds = stateMachine.getUserOffers(peer);
  if (offerIds.length === 0) return '你当前没 active 订单. 回 back 返回菜单.';
  // Fetch detail in parallel (≤ 50 ids cap by addUserOffer prune)
  const settled = await Promise.all(offerIds.slice(0, 5).map(id => client.getOffer(id)));
  const offers = settled.filter(s => s.ok).map(s => s.offer).filter(Boolean);
  if (offers.length === 0) return '你当前没 active 订单 (full expire). 回 back 返回菜单.';
  // Sort by created_at DESC (most recent first)
  offers.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const cur = stateMachine.getFlowState(peer) || {};
  stateMachine.setFlowState(peer, { ...cur, flow: 'MY_ORDERS', step: 'LIST', orders: offers });
  const lines = ['📋 我的订单 (回 1-5 看详情, back 返回菜单):', ''];
  offers.forEach((o, i) => {
    lines.push(`${i + 1}️⃣ [${o.protocol_status}] ${o.give_amount} ${o.give_asset} → ${o.want_amount} ${o.want_asset}`);
    lines.push(`   id: ${o.id?.slice(0, 12)}`);
  });
  return lines.join('\n');
}

async function _doOfferLookup(peer, draft, prevReply) {
  if (!draft?.offer_id) return '缺 offer_id, back 重来.';
  const r = await client.getOffer(draft.offer_id);
  if (!r.ok) return `查 offer 失败: ${r.error || 'not found'}. 回 back.`;
  return [
    `📋 offer ${r.offer.id?.slice(0, 12)} 详情:`,
    `  状态: ${r.offer.protocol_status}`,
    `  give: ${r.offer.give_amount} ${r.offer.give_asset}`,
    `  want: ${r.offer.want_amount} ${r.offer.want_asset} (${r.offer.want_chain || '?'})`,
    `  maker: ...${r.offer.maker?.slice(-12)}`,
    '',
    // Bug-D-residual 5/14 fix (NWT 11:04 surface, KI 第 N 次 复刻补丁漏一片):
    // b6a85af0e 修了 state-machine.js L256 CHAIN_SELECT error msg + chain list, 漏 _doOfferLookup
    // reply hint 仍 hardcoded "1-4". 改 dynamic ${SUPPORTED_CHAINS.length} 防 future drift.
    r.offer.protocol_status === 'open' ? `回 1-${stateMachine.SUPPORTED_CHAINS.length} 选支付链接单, OR back 取消.` : '订单状态非 open, 不可接单. back 返回菜单.',
  ].join('\n');
}

async function _doOfferStatus(peer, draft, prevReply) {
  if (!draft?.offer_id) return '缺 offer_id, back.';
  const r = await client.getOffer(draft.offer_id);
  if (!r.ok) return `查 offer 失败: ${r.error || 'not found'}. 回 back.`;
  const status = r.offer.protocol_status;
  const stageMap = {
    open: '⏳ 等接单',
    matched: '✓ 已接单, 等付款',
    verifying: '⏳ 付款验证中 (~1-3 min)',
    delivering: '⏳ 验证通过, 正在发 KAS',
    completed: '✓ 完成! KAS 已发到你 Kasia',
    cancelled: '⊘ 已取消',
    expired: '⏰ 已过期',
    disputed: '⚠ 争议中',
  };
  const stageText = stageMap[status] || `状态: ${status}`;
  return [
    `📋 offer ${r.offer.id?.slice(0, 12)} 状态:`,
    `  ${stageText}`,
    `  give: ${r.offer.give_amount} ${r.offer.give_asset} · want: ${r.offer.want_amount} ${r.offer.want_asset}`,
    '',
    status === 'completed' ? '交易完成! back 返回菜单.' : '回 5 再查 / back 返回菜单.',
  ].join('\n');
}
