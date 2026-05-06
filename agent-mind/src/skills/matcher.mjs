// agent-mind/src/skills/matcher.mjs
//
// 撮合官 (matcher) — KANet 上的 KAS / USDT 跨链撮合 Agent.
// class-based Skill, 走 registry.mjs:47-73 reactive free-form 路径 + base.mjs Skill base.
// LLM-driven intent extraction, 不走 keyword-based parseIntent (per MATCHER-ARCHITECTURE §4 + r109 verdict).
// HTTP API only data access via fetchJson(consoleUrl), 0 import sqlite (per r112 verdict, KANet skill convention 4 轴).
//
// T1 范围 (5/2 ship): listen + intent extract + 跟 user 对话, 不发 offer 不动钱.
// T2 范围 (5/3 ship): publishOffer to /api/exchange/publish + 反馈 user offer detail + stripMarkdown.

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

const CONSOLE_URL = process.env.KASIA_CONSOLE_URL || 'http://127.0.0.1:3100';

export class MatcherSkill extends Skill {
  constructor() {
    super('matcher', '撮合官 — KANet 上的 KAS / USDT 跨链撮合 Agent (T2 ship: 听懂 + 发 offer + 反馈关键节点)');
    this._senderAddress = '';
    this._inputMessage = '';
  }

  // 每 reactive message 命中 (LLM-driven free-form, keywords=[] 默认 _keywordsMatch pass-through)
  // 存 sender + input 给 gatherContext 用 (per mm-otc.mjs:51,62 convention)
  canActivate(taskType, context) {
    if (taskType !== 'reactive') return false;
    this._senderAddress = context?._senderAddress || '';
    this._inputMessage = context?._inputMessage || '';
    return true;
  }

  // T1.2 ship: KANet skill HTTP API convention (per r112 verdict, fetchJson via consoleUrl).
  // /api/agent/peer-context (conversations.js:524-598) 已 cover peer + chatHistory + recentBroadcasts + connectionStatus.
  //
  // M-wallet-inject fix (2026-05-04): 加 fetch /api/relay/:id/wallets 拿 broker 真 9 链钱包地址.
  // 真 e2e 暴露 Brain hallucinate 真 BSC 地址 (5/4 12:51 真截图: Brain 给 0xD8A87c1A4e9F2c3b1a5d6e7f8g9h0i...
  // 含非 hex 字符 g/h/i/j/k/l/m, 完全 invalid, 真 broker BSC 是 0xD8A87c1AfcFadAd46355c3d59377C9E6edf0da47).
  // 修法: gatherContext fetch broker 真钱包 + formatForBrain inject Brain prompt + publishOffer payload inject.
  async gatherContext(kernels, config) {
    // T1.5 装配 wire: 保存 config 给 formatForBrain 用 (Skill API formatForBrain 只接 gathered, 不接 kernels/config)
    this._config = config || {};
    // M-wallet-inject: fetch broker 真 9 链钱包地址 (跟 peer-context 并行 fetch, 不阻).
    this._walletAddresses = await this._fetchBrokerWallets(config);
    if (!this._senderAddress) {
      return { peer: null, history: [], broadcasts: [], connectionStatus: null, metadata: { historyCount: 0, degraded: false } };
    }
    const consoleUrl = config?.consoleUrl || 'http://localhost:3100';
    const myAddress = config?.address || '';
    const url = `${consoleUrl}/api/agent/peer-context?my_address=${encodeURIComponent(myAddress)}&peer_address=${encodeURIComponent(this._senderAddress)}&limit=50`;
    try {
      const ctx = await fetchJson(url);
      const fullHistory = ctx.chatHistory || [];
      // safety net: > 6000 tokens trim 30 (per MATCHER §4.2 + audit-2 informed top peer 24h 44 dm = 1056 tokens)
      const totalChars = fullHistory.reduce((s, m) => s + (m.text || '').length, 0);
      const estimatedTokens = totalChars / 3;
      let history = fullHistory;
      let degraded = false;
      if (estimatedTokens > 6000) {
        history = fullHistory.slice(-30);
        degraded = true;
        console.warn(`[matcher] gatherContext degraded: peer=${this._senderAddress.slice(-12)} tokens=${estimatedTokens.toFixed(0)} trimmed_to=30`);
      }
      // P0-1a (NWT r185 architect γ): stranger DM gate — early detect + cooldown check.
      // verified set: 'responsive_agent' (handshake done) / 'verified_agent' (trade completed).
      // stranger: classification null OR in {seen_candidate, declared_candidate} → record cooldown + 固定 reply OR cooldown_skip.
      const VERIFIED_CLASSIFICATIONS = new Set(['responsive_agent', 'verified_agent']);
      const peerClassification = ctx.peer?.classification || null;
      const isStranger = !peerClassification || !VERIFIED_CLASSIFICATIONS.has(peerClassification);
      // NWT r195 Issue #2 telemetry: classification mismatch 真 catch (DB row 真 responsive_agent 但 endpoint 真 return null).
      // 真 evidence: 5/4 09:56:35 NWT verified peer 真 fire matcher_stranger_rejected with classification=null.
      // 真 candidate: my_address 真 differs from DB local_address (format/case/encoding mismatch) OR endpoint 真 stale.
      this._reportPublishDecision(config, 'matcher_classification_check', {
        my_address_tail: myAddress.slice(-12),
        peer_address_tail: this._senderAddress.slice(-12),
        classification: peerClassification,
        is_stranger: isStranger,
        peer_obj_present: ctx.peer ? 'yes' : 'no',
      });
      let strangerReject = null;
      if (isStranger && myAddress) {
        const lastReject = ctx.peer?.lastStrangerRejectAt || null;
        const COOLDOWN_MS = 30 * 60 * 1000; // 30 min
        const inCooldown = lastReject && (Date.now() - new Date(lastReject).getTime() < COOLDOWN_MS);
        if (inCooldown) {
          strangerReject = { decision: 'cooldown_skip', classification: peerClassification, lastRejectAt: lastReject };
          this._reportPublishDecision(config, 'matcher_stranger_cooldown_skipped', { peer: this._senderAddress.slice(-12), classification: peerClassification || 'null' });
        } else {
          strangerReject = { decision: 'reject_with_reply', classification: peerClassification };
          this._reportPublishDecision(config, 'matcher_stranger_rejected', { peer: this._senderAddress.slice(-12), classification: peerClassification || 'null' });
          // Mark cooldown timestamp (fire-and-forget, 不阻 reply)
          fetchJson(`${consoleUrl}/api/agent/peer-relation/mark-stranger-cooldown`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ my_address: myAddress, peer_address: this._senderAddress }),
          }).catch(e => console.warn(`[matcher] mark-stranger-cooldown err: ${e.message}`));
        }
      }
      return {
        peer: ctx.peer || null,
        history,
        broadcasts: ctx.recentBroadcasts || [],
        connectionStatus: ctx.peer?.connectionStatus || null,
        _strangerReject: strangerReject,                                  // P0-1a: matcher 真 stranger gate signal
        metadata: { historyCount: history.length, degraded, estimatedTokens, classification: peerClassification, isStranger },
      };
    } catch (err) {
      console.warn(`[matcher] gatherContext fetchJson failed: ${err.message}`);
      return { peer: null, history: [], broadcasts: [], connectionStatus: null, metadata: { historyCount: 0, degraded: false, error: err.message } };
    }
  }

  // M-wallet-inject helper: fetch broker 真 9 链钱包地址 (BSC/ETH/POLYGON/SOL/TRON 等).
  // 返 { bnb: '0x...', eth: '0x...', polygon: '0x...', sol: '...', tron: 'T...' } only default wallets.
  // fail-closed: fetch err → 空 object, formatForBrain instructions 自然 skip wallet section.
  async _fetchBrokerWallets(config) {
    const consoleUrl = config?.consoleUrl || 'http://localhost:3100';
    const relayNodeId = config?.relayNodeId;
    if (!relayNodeId) return {};
    try {
      const res = await fetchJson(`${consoleUrl}/api/relay/${relayNodeId}/wallets`);
      const out = {};
      for (const c of (res?.chains || [])) {
        if (c.address && c.isDefault) out[c.chain] = c.address;
      }
      return out;
    } catch (err) {
      console.warn(`[matcher] _fetchBrokerWallets failed: ${err.message}`);
      return {};
    }
  }

  // T2/T3 wrapper: extractIntent extends T1 helper with publish trigger detection.
  // T3.1 (KI-19 fix): shouldPublish keyword regex → asyncShouldPublish LLM classify.
  // T3.2 (reactor): reactToChainEvents per-cycle snapshot of Trader-M's in-flight offers.
  async extractIntent(gathered, latestMessage, config) {
    const intent = await this._extractIntentT1(gathered, latestMessage, config);

    // T3.2: chain-event reactor (per-cycle snapshot, 0 own state per §9.5 #1)
    intent._reactor = await this.reactToChainEvents(config?.address, config);

    // T3.1: publish trigger via LLM classify (KI-19 fix replaces keyword regex)
    intent.should_publish = await this.asyncShouldPublish(intent, gathered.history || [], config);
    if (intent.should_publish) {
      try {
        const offerResult = await this.publishOffer(intent);
        intent._offerResult = offerResult;
      } catch (err) {
        console.error('[matcher] publishOffer failed:', err.message);
        intent._offerResult = null;
        intent._publishError = err.message;
        // 漏洞 M-3 fix (2026-05-04): publishOffer throw 加 events 表 telemetry (复用 M-1 helper).
        // 否则 publishOffer 失败真因死无对证 (跟 M-1 同款 silent 病根)。
        this._reportPublishDecision(config, 'publish_offer_failed', {
          error: err.message,
          intent_side: intent.side, intent_qty: intent.qty, intent_asset: intent.asset,
        });
      }
    }
    return intent;
  }

  // T1 logic preserved as helper (per architect v1.3 Option Y refactor).
  // Adapter pattern 同 mind.mjs:301-310 (mindSystem + mindUser + mindTask + brainCall).
  // Qwen Rule 11 kill switch 由 agent-adapter/src/providers/openai.mjs:238-242 自动 inject.
  async _extractIntentT1(gathered, latestMessage, config) {
    const adapterUrl = config?.adapterUrl;
    if (!adapterUrl) {
      return _intentFallback(latestMessage, 'adapter_unavailable');
    }

    const historyText = (gathered.history || [])
      .map(m => `[${m.ts || ''}] ${m.dir === 'in' ? 'user' : 'matcher'}: ${m.text || ''}`)
      .join('\n') || '(no history)';
    const peerName = gathered.peer?.name || gathered.peer?.address?.slice(-12) || 'unknown';
    const trustLevel = gathered.peer?.trustLevel || 'normal';

    const mindUser = [
      `Peer: ${peerName} (trust=${trustLevel})`,
      '',
      '24h 对话历史:',
      historyText,
      '',
      `User 最新消息: ${latestMessage}`,
      '',
      '请提炼意图返回 JSON.',
    ].join('\n');

    let response;
    try {
      response = await fetchJson(`${adapterUrl}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: this._senderAddress, mindSystem: MATCHER_INTENT_SYSTEM, mindUser, mindTask: true }),
        brainCall: true,
      });
    } catch (err) {
      console.warn(`[matcher] extractIntent adapter call failed: ${err.message}`);
      return _intentFallback(latestMessage, 'adapter_error', err.message);
    }

    const replyText = response?.reply || '';
    let intent;
    try {
      const cleaned = replyText.replace(/^```(?:json)?\s*|\s*```\s*$/gs, '').trim();
      intent = JSON.parse(cleaned);
    } catch (err) {
      console.warn(`[matcher] extractIntent JSON parse failed: "${replyText.slice(0, 100)}"`);
      return _intentFallback(latestMessage, 'intent_unclear', null, true);
    }

    if (!['buy', 'sell', 'query', 'cancel', 'none'].includes(intent.side)) {
      intent.side = 'none';
      intent.confidence = 'low';
    }
    // NWT r195 Issue #1 fix: NLU LLM 真 hallucinate missing_fields 真 unknown values
    // ('confirm_intent' / 'receive_address (kaspa)' / 'price' 真 NOT in prompt schema 但 LLM 真 add).
    // 真 deterministic gate Gate 2 真 reject on missing_fields 非空 → publish 0 fire.
    // post-process filter: missing_fields 真 keep only valid whitelist (matches prompt schema fields).
    const VALID_MISSING_FIELDS = new Set(['side', 'asset', 'qty', 'qty_unit', 'pay_chain', 'evm_address']);
    if (Array.isArray(intent.missing_fields)) {
      intent.missing_fields = intent.missing_fields.filter(f => {
        if (typeof f !== 'string') return false;
        const lower = f.toLowerCase();
        // exact match OR substring match (handles 'evm_address (BSC)' / 'pay_chain (kaspa)' variants)
        return [...VALID_MISSING_FIELDS].some(valid => lower === valid || lower.includes(valid));
      });
    }

    // T-J2-2026-05-06 BUY KAS evm_address skip (HANDOFF Priority 3 真因 fix):
    // BUY KAS 本来不需 user evm_address — broker 给 maker BSC addr, user 用自己 BSC 钱包付 USDT,
    // broker 收到 USDT 后给 KAS 到 user Kasia. user 给的 evm_address 是 user-pay-from (不是 user-receive),
    // broker 不验. 跟 broker-llm-agent.js:812 + broker-v2/state.js:38-39 _listMissing convention 对齐
    // (sell_kas 必 pay_address; buy_kas 不要 evm_address).
    //
    // 5/4 Phase A 4 cycle 0 deterministic_gate_pass 真根因 = LLM 漏识别 user-supplied evm_address →
    // missing_fields=['evm_address'] → gate_missing_fields fail → publish 0 fire. 5/6 NWT→Trader-M
    // 实测 0x... full hex 给齐 LLM 仍 missing → 设计上 BUY KAS 就不该 require, fix 在此.
    //
    // BUY USDC/USDT (stable swap) 仍 require evm_address (user 真收 stable 到自己 EVM addr) — 跟
    // broker-llm-agent.js:823 BUY-stable ask 文案 align. matcher 仅 BUY KAS skip.
    if (intent.side === 'buy' && (intent.asset === 'KAS' || intent.asset === null) &&
        Array.isArray(intent.missing_fields)) {
      intent.missing_fields = intent.missing_fields.filter(f => {
        const lower = (f || '').toLowerCase();
        return !lower.includes('evm_address') && !lower.includes('evm address');
      });
    }

    return intent;
  }

  // T3.5: 反馈 user 每 transition (KI-17 layer 3 — broker 真 ship Stage 4 missing UX piece).
  // Maps state transition pairs (oldState→newState) to user-friendly text + sends via actionExecutor.
  // Implementer authoritative reconciliation: actionExecutor passed as parameter (matching
  // replyToUser:468 export pattern), NOT this._actionExecutor (Skills don't hold it). spec line
  // `const msg = messages;` 修 to `messages[key]` per T3.4 same pattern (index access missing).
  async notifyTransition(offerId, peerAddress, oldState, newState, actionExecutor) {
    const messages = {
      'open→matched':         '✓ 已匹配 taker, 等付款 (30 分钟内).',
      'matched→verifying':    '💰 付款已收到, 验证跨链确认中...',
      'verifying→delivering': '✓ 付款验证通过, 发 KAS 中...',
      'delivering→completed': '🎉 KAS 已发出, 交易完成! 请查询钱包确认收款.',
      'open→timed_out':       '⏰ 30 分钟无 taker, 订单已 timeout. 退款已发.',
      'matched→disputed':     '⚠ 争议产生, 进入 dispute 流程. 等 resolver.',
      'verifying→disputed':   '⚠ 跨链验证争议, 进入 dispute 流程. 等 resolver.',
      'matched→cancelled':    '⊘ 订单已取消.',
    };
    const key = `${oldState}→${newState}`;
    const msg = messages[key];
    if (!msg || !peerAddress || !actionExecutor?.executeOne) return null;
    return await actionExecutor.executeOne({
      type: 'send_message',
      target: peerAddress,
      message: this.stripMarkdown(msg),
    });
  }

  // T3.3: emit chain TX via existing Relay send-command infra (NO new endpoint).
  // 决断 1 v1.1: 复用 /api/relay/:id/send-command + type='send_broadcast' + channel='kanet-exchange'.
  // Relay 真 broadcast chain TX, trade-protocol-filter 自动 handler dispatch.
  async emitChainProtocol(eventType, payloadObj) {
    const consoleUrl = this._config?.consoleUrl || CONSOLE_URL;
    const relayNodeId = this._config?.relayNodeId;
    if (!relayNodeId) throw new Error('emitChainProtocol: this._config.relayNodeId missing');
    const message = JSON.stringify({ t: eventType, ...payloadObj });
    return await fetchJson(`${consoleUrl}/api/relay/${relayNodeId}/send-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'send_broadcast', channel: 'kanet-exchange', message }),
    });
  }

  // T3.3: post EVM cross-chain proof verify (internal helper, NOT chain emit).
  // matcher 收 kanet_exchange_paid_v1 from taker → verify proof → log.
  // (chain emit by sendKaspa + emitDeliveryInitiated, NOT this method.)
  async emitPaymentVerified(offerId, paymentTx, evmAddress) {
    console.log(`[matcher] payment verified offer=${offerId} tx=${paymentTx} evm=${evmAddress}`);
    return { verified: true, offerId, paymentTx, evmAddress };
  }

  // T3.3: post sendKaspa, emit kanet_exchange_delivered_v1 chain TX.
  // event_type matches trade-protocol-filter EXCHANGE_MSG.DELIVERED constant.
  async emitDeliveryInitiated(offerId, kasAmount, userAddress, kasTxId) {
    return await this.emitChainProtocol('kanet_exchange_delivered_v1', {
      offer_id: offerId,
      delivery_tx: kasTxId,
      amount: kasAmount,
      to: userAddress,
    });
  }

  // T3.2: matcher reactor for chain-event in-flight offers (path b per task v1.1 §T3.2).
  // 0 own state (per INVARIANTS §9.5 #1) — fetch fresh snapshot 每 reactive cycle.
  // Limitation: Skill-instance fires per peer DM, NOT independent timer. trade-protocol-filter
  // server handlers already do heavy lifting (DB UPDATE / sendKas) — matcher reactor's role 是
  // user-facing T3.5 反馈 + T3.3 emit hooks per current state snapshot.
  async reactToChainEvents(myAddress, config) {
    if (!myAddress || !config?.consoleUrl) return { activeOffers: [], reason: 'no_address_or_console' };
    const ACTIVE_STATES = ['matched', 'verifying', 'delivering', 'disputed'];
    try {
      const url = `${config.consoleUrl}/api/exchange/offers?maker=${encodeURIComponent(myAddress)}&limit=20`;
      const data = await fetchJson(url);
      const offers = data?.offers || [];
      const activeOffers = offers.filter(o => ACTIVE_STATES.includes(o.protocol_status)).map(o => ({
        offer_id: o.id,
        protocol_status: o.protocol_status,
        maker: o.maker,
        taker: o.taker,
        give_asset: o.give_asset,
        give_amount: o.give_amount,
        want_asset: o.want_asset,
        want_amount: o.want_amount,
        taker_chain: o.taker_chain,
        payment_tx: o.payment_tx,
        delivery_tx: o.delivery_tx,
        broadcast_at: o.broadcast_at,
      }));
      return { activeOffers, fetchedAt: Date.now() };
    } catch (err) {
      console.warn(`[matcher] reactToChainEvents failed: ${err.message}`);
      return { activeOffers: [], error: err.message };
    }
  }

  // T3.1 (KI-19 fix): LLM intent classify replaces keyword regex.
  // Cheap gates first (intent shape) → LLM call only if obvious not-ready filtered.
  // Fail-closed: adapter unavailable / parse err → return false (per KI-22 sediment).
  // Implementer authoritative reconciliation: mindTask: true (boolean) per agent-adapter/index.mjs:79
  // canonical pattern (matcher.mjs:120 + 8 mind.mjs sites), spec line 161 'shouldPublish_classify' string
  // not adopted (adapter just truthy-checks, but 8 existing sites use boolean).
  //
  // 漏洞 M-1 fix (2026-05-04): 4 个早 return false 路径 + LLM success/fail 全加 events 表 telemetry。
  // 否则 publish 决策完全黑盒 — Brain 在 freestyle 演 broker, asyncShouldPublish 0 trace.
  // 跟握手系统漏洞 #3 同款修法 (silent catch → ingestEvent + reason 留痕)。
  // NWT r192 hybrid (Z + 变种 Y + verify) — Owner 5/4 architectural 钦定:
  // LLM = NLU only (extractIntent 真 NLU helper), Decision truth 真住 deterministic source.
  // 真 KANet 哲学一致 (chain_events = truth, deterministic source NOT LLM judgment).
  //
  // 真 deprecate (history): cheap_gate_confidence / M-confidence-relax / M-confidence-strict /
  // SHOULD_PUBLISH_SYSTEM LLM call — 全 LLM judgment 真 unreliable per-cycle non-determinism
  // (J2 5/4 12:50-13:34 6 turn + NWT r189 Phase A 实证).
  //
  // 真 AFTER deterministic gate:
  //   1. side ∈ {buy, sell} required
  //   2. missing_fields 真 deterministic derive (asset='KAS' / qty>0 / pay_chain ∈ valid set / evm_address regex)
  //   3. confirmation keyword grep: latest user message OR last 5 user messages 含 keyword
  //   4. publishOffer fire iff: side OK + missing_fields=[] + confirmation_keyword detected
  //
  // fail-closed safety:
  //   - LLM extract fail / parse fail → intent.missing_fields 全部 → reject
  //   - chat history 空 → no confirmation → reject
  //   - evm_address regex fail → missing_fields includes 'evm_address' → reject
  async asyncShouldPublish(intent, peerHistory, config) {
    // Gate 1: side check (cheap, deterministic)
    if (intent.side !== 'buy' && intent.side !== 'sell') {
      this._reportPublishDecision(config, 'gate_side', { side: intent.side });
      return false;
    }
    // Gate 2: missing_fields check (deterministic — NLU helper 真 fill, gate 真 verify)
    if (intent.missing_fields?.length > 0) {
      this._reportPublishDecision(config, 'gate_missing_fields', { missing_fields: intent.missing_fields, side: intent.side });
      return false;
    }
    // Gate 3: confirmation keyword grep (deterministic — Owner 5/4 钦定 expandable list)
    // 真 cycle-independent (NOT LLM judgment), 真 explicit user confirm 才 fire.
    const CONFIRMATION_KEYWORDS = [
      'ok', '好', '好的', '确认', '同意', '可以', '行', '发吧', '发布', 'publish', 'go', 'yes', '请发布', '请下单',
    ];
    const userMsgs = (peerHistory || []).filter(m => m.dir === 'in').slice(-5).map(m => (m.text || '').toLowerCase());
    const latestInputLower = (this._inputMessage || '').toLowerCase();
    const candidates = [latestInputLower, ...userMsgs];
    const hasConfirmation = candidates.some(text => CONFIRMATION_KEYWORDS.some(kw => text.includes(kw.toLowerCase())));
    if (!hasConfirmation) {
      this._reportPublishDecision(config, 'gate_no_confirmation', { side: intent.side, qty: intent.qty, latest_msg_first_60: (this._inputMessage || '').slice(0, 60) });
      return false;
    }
    // 全 deterministic gate 通过 — publish ready
    this._reportPublishDecision(config, 'deterministic_gate_pass', { side: intent.side, qty: intent.qty, asset: intent.asset });
    return true;
  }

  // 漏洞 M-1 fix helper: fire-and-forget POST /ingest/event 上报 publish 决策。
  // 不阻塞 publish 主路径 (决策已早 return), 单纯 events 表留痕给运维 trace。
  // 跟握手 rpc-listener.mjs outer catch ingestEvent 同款 pattern。
  async _reportPublishDecision(config, decision, details) {
    const consoleUrl = config?.consoleUrl;
    if (!consoleUrl) return;
    try {
      await fetchJson(`${consoleUrl}/ingest/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ingest-secret': process.env.INGEST_SECRET || '',
        },
        body: JSON.stringify({
          traceId: `matcher-publish:${(this._senderAddress || '').slice(-12)}:${Date.now()}`,
          eventScope: 'mind',
          eventType: 'matcher_publish_decision',
          source: 'matcher',
          level: decision === 'llm_ready_true' ? 'info' : 'warning',
          summary: `asyncShouldPublish ${decision}: ${JSON.stringify(details).slice(0, 200)}`,
          agentAddress: config?.address || null,
        }),
      });
    } catch {
      // fire-and-forget — telemetry 失败不阻 publish 决策
    }
  }

  // T2: 算定价 (T2 简化, T3 加 mid_price 来源 market-data)
  // T-J2-2026-05-06 BUY pricing 真 bug fix: 旧版 give_amount = qty/MID 算反 (user 买 17 KAS → give 425 KAS).
  // 真逻辑: user 买 X KAS, matcher 给 X KAS 收 X*MID USDT. 跟 SELL 对称.
  // (qty 单位 = KAS; intent.qty_unit 在 buy/sell 都是 'KAS' 当 user 用 KAS quantity 表达.)
  computePricing(intent) {
    const MID = 0.04;
    const qty = parseFloat(intent.qty);
    if (intent.side === 'buy') {
      // user 买 X KAS = matcher 卖 X KAS for X*MID USDT
      // give_amount = X KAS (matcher 给 KAS), want_amount = X*MID USDT (matcher 收 USDT)
      return {
        give_asset: 'KAS', give_amount: String(qty), give_chain: 'kaspa',
        want_asset: 'USDT', want_amount: String((qty * MID).toFixed(4)),
        want_chain: intent.pay_chain || 'BSC',
      };
    }
    // sell: user 卖 X KAS = matcher 买 X KAS, give X*MID USDT
    return {
      give_asset: 'USDT', give_amount: String((qty * MID).toFixed(4)), give_chain: intent.pay_chain || 'BSC',
      want_asset: 'KAS', want_amount: String(qty), want_chain: 'kaspa',
    };
  }

  // T2: publishOffer 调 KANet /api/exchange/publish endpoint.
  // M1: relayNodeId required (NOT maker, derived server-side).
  // M2: expires_minutes (NOT expires_in_minutes).
  // M4: res.ok (NOT res.success). M5: res.broadcast_tx (NOT broadcast_tx_id).
  async publishOffer(intent) {
    if (intent.side !== 'buy' && intent.side !== 'sell') {
      throw new Error('publishOffer: invalid intent.side');
    }
    if (!intent.qty || !intent.asset) {
      throw new Error('publishOffer: missing qty/asset');
    }
    const relayNodeId = this._config?.relayNodeId;
    if (!relayNodeId) {
      throw new Error('publishOffer: this._config.relayNodeId missing');
    }
    const pricing = this.computePricing(intent);
    const consoleUrl = this._config?.consoleUrl || CONSOLE_URL;
    // M-wallet-inject fix (2026-05-04): payload 真 inject verification_meta.accepted_chains.
    // 真 broker EVM 收款地址从 _walletAddresses (gatherContext fetch) 拿, 真 inject offer.
    // 不再让 Brain freestyle hallucinate (5/4 12:51 真 evidence: Brain 编 0xD8A87c1A4e9F2c3b1a5d6e7f8g... 含非 hex 字符).
    const acceptedChains = [];
    const w = this._walletAddresses || {};
    for (const chain of ['bnb', 'eth', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'base', 'sol', 'tron']) {
      if (w[chain]) acceptedChains.push({ chain, address: w[chain] });
    }
    const payload = {
      relayNodeId,
      ...pricing,
      verification: 'cross_chain_tx',
      verification_meta: {
        accepted_chains: acceptedChains,
        expected_asset: pricing.want_asset || 'USDT',
        receive_chain: pricing.want_chain || 'BSC',
      },
      expires_minutes: 30,
    };
    const res = await fetchJson(`${consoleUrl}/api/exchange/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res?.ok || !res?.offer_id) {
      throw new Error(`publishOffer: KANet rejected: ${JSON.stringify(res)}`);
    }
    console.log(`[matcher] publishOffer ok offer=${res.offer_id} tx=${res.broadcast_tx}`);
    return {
      offer_id: res.offer_id,
      broadcast_tx: res.broadcast_tx,
      expires_at: res.expires_at,
      payload,
      success: true,
    };
  }

  // T2: 反馈 offer detail (KI-17 layer 3 反馈关键节点)
  generateOfferFeedback(intent, offerResult) {
    const { offer_id, payload } = offerResult;
    const offer_short = offer_id.slice(-8);
    if (intent.side === 'buy') {
      return [
        `好的, 我已经为你发布报价 #${offer_short}.`,
        ``,
        `📋 报价详情:`,
        `  - 你付: ${payload.want_amount} ${payload.want_asset} (${payload.want_chain})`,
        `  - 你收: ${payload.give_amount} ${payload.give_asset}`,
        `  - 有效期: 30 分钟`,
        ``,
        `💸 下一步:`,
        `  请向 broker 钱包付款 (具体地址 KANet 给出).`,
        `  付款后 matcher 自动 verify 跨链确认.`,
        ``,
        `⚠️ T2 阶段 — offer 已发布上链.`,
        `  跨链 verify + 发 KAS 是 T3 范围.`,
      ].join('\n');
    }
    return [
      `好的, 我已经为你发布卖单 #${offer_short}.`,
      ``,
      `📋 报价详情:`,
      `  - 你付: ${payload.give_amount} KAS`,
      `  - 你收: ${payload.want_amount} ${payload.want_asset} (${payload.want_chain})`,
      `  - 有效期: 30 分钟`,
      ``,
      `⚠️ T2 阶段 — 卖单已上链, 完整交割 T3 范围.`,
    ].join('\n');
  }

  // T2: stripMarkdown — KANet user 通过 Kasia / 手机 app, 不假设 markdown 渲染.
  // BugFix-Bot 5/3 audit catch: T1 LLM reply 7/25 含 **bold** literal 透出 (28%). KI-18 sediment.
  stripMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')                              // **bold** → bold
      .replace(/(?<![\*\w])\*([^\*\n]+?)\*(?![\*\w])/g, '$1')        // *italic* → italic
      .replace(/^#+\s+/gm, '')                                       // # heading → heading (line start)
      .replace(/`([^`\n]+?)`/g, '$1')                                // `code` → code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');                      // [text](url) → text
  }

  // T2 wrapper: formatForBrain 1-arg signature (registry.mjs:160 兼容守, per NWT r153 reconciliation).
  // Implementer authoritative reconciliation: spec line 360 写 (intent, peerHistory) 2-arg, 但 registry 1-arg call.
  // Keep 1-arg, internally derive peerHistory + intent. Helper _formatForBrainT1 takes 2-arg per spec.
  async formatForBrain(gathered) {
    if (!gathered || !this._senderAddress) {
      return { name: this.name, description: this.description, data: { skipped: 'no_sender' }, instructions: '' };
    }
    // P0-1a (NWT r185 architect γ): stranger DM gate early return — skip extractIntent (省 LLM call).
    // _strangerReject set by gatherContext when peer.classification 不在 verified set.
    if (gathered._strangerReject) {
      const sr = gathered._strangerReject;
      if (sr.decision === 'cooldown_skip') {
        // 30min cooldown 内 — 真 silent skip (Brain reply 真空 instructions, 不 fire send)
        return {
          name: this.name,
          description: this.description,
          data: { skipped: 'stranger_cooldown', classification: sr.classification, lastRejectAt: sr.lastRejectAt },
          instructions: '',
        };
      }
      // 第一次 stranger DM — 固定 reply (KI-17 layer 3 反馈 + KI-18 NO markdown)
      const reply = '需要先建立 handshake 才能交易. 请通过 Kasia handshake 流程发送握手 TX 给我, 之后再来询单.';
      return {
        name: this.name,
        description: this.description,
        data: { skipped: 'stranger_first_reject', classification: sr.classification, suggestedReply: reply },
        instructions: this.stripMarkdown(reply),
      };
    }
    const config = this._config || {};
    const peerHistory = gathered.history || [];
    const latestMessage = this._inputMessage || '';
    const intent = await this.extractIntent(gathered, latestMessage, config);

    let reply;
    if (intent._offerResult) {
      reply = this.generateOfferFeedback(intent, intent._offerResult);
    } else if (intent._publishError) {
      reply = `抱歉, 发布报价时出错了 (${intent._publishError}). 我会反馈给开发者. 你可以稍后再试.`;
    } else {
      reply = await this._formatForBrainT1(intent, peerHistory);
    }

    // v1.3 KI-18 sediment: strip markdown across all reply paths
    const cleanedReply = this.stripMarkdown(reply);

    // M-wallet-inject fix (2026-05-04): instructions 真 prepend broker 真钱包地址,
    // Brain 看到真值不再 hallucinate (5/4 12:51 真截图 evidence: Brain 编 fake 地址含非 hex 字符).
    let walletInstr = '';
    const w = this._walletAddresses || {};
    if (Object.keys(w).length > 0) {
      const wLines = ['🔒 BROKER 真收款地址 (用户问转账地址必引用真值, 严禁编造或截断, 严禁说"出于安全省略"等借口):'];
      const labels = { bnb: 'BSC (BEP20) USDT', eth: 'ETH (ERC20) USDT', polygon: 'Polygon USDT', arbitrum: 'Arbitrum USDT', optimism: 'Optimism USDT', avalanche: 'Avalanche USDT', base: 'Base USDC', sol: 'Solana USDT', tron: 'TRON (TRC20) USDT' };
      for (const [chain, addr] of Object.entries(w)) {
        wLines.push(`- ${labels[chain] || chain}: ${addr}`);
      }
      walletInstr = wLines.join('\n') + '\n\n';
    }

    return {
      name: this.name,
      description: this.description,
      data: {
        peer: gathered.peer,
        history_count: peerHistory.length,
        connectionStatus: gathered.connectionStatus,
        intent,
        suggestedReply: cleanedReply,                      // T1 test compat (data.suggestedReply assertion)
        offerResult: intent._offerResult || null,
        publishError: intent._publishError || null,
        degraded: gathered.metadata?.degraded || false,
        walletAddresses: w,                                 // M-wallet-inject: 暴露给 data 层 verify
      },
      instructions: walletInstr + cleanedReply,
    };
  }

  // T1 reply gen logic preserved as helper (per architect v1.3 Option Y refactor).
  // Receives pre-computed intent + peerHistory (peerHistory currently unused, kept per spec sig for future T3 history-aware reply).
  async _formatForBrainT1(intent, peerHistory) {
    return generateReply(intent);
  }
}

// T3.1 (KI-19 fix): shouldPublish gate LLM classify prompt.
// 替 T2 keyword regex (CJK \b boundary 问题 + 实战 too strict).
const SHOULD_PUBLISH_SYSTEM = [
  '你是 broker 助手, 判断 user 是否准备好提交 offer 上链.',
  '',
  '判断标准 (binary):',
  '- ready=true: user 明确同意 publish (含: 完整意图 + 用户最近消息含 同意/确认/可以/发吧/OK 等),',
  '  AND user 已提供 evm_address (EVM/BSC 链 buy/sell scenarios required) OR intent.pay_chain=KASPA.',
  '- ready=false: 缺任一条件',
  '',
  '只返 JSON: { "ready": true|false, "reason": "..." }',
  '不要 markdown wrapper, 不要解释文本.',
].join('\n');

// matcher 撮合官 LLM persona + JSON schema (T1.3 inline prompt, per NWT r114 option i)
//
// M-confidence fix (2026-05-04, per Owner framework b 真因 cheap_gate_confidence):
// 真 e2e 暴露 LLM 默认给 confidence='medium' 永远 hit cheap gate, publishOffer 0 fire.
// 修法:
// 1. 加明确 confidence 判定规则 (字段齐 + user confirm → 必 high)
// 2. schema 加 evm_address 字段 (EVM/BSC 链 buy 时 user 提供, 当前 schema 漏)
// 3. missing_fields example 加 evm_address (LLM 知道 surface 它)
const MATCHER_INTENT_SYSTEM = [
  '你是 KANet 撮合官 (matcher), KAS / USDT 跨链撮合 Agent.',
  '',
  '任务: 从 user 消息提炼撮合意图, 返回严格 JSON. 不要任何 markdown wrapper 或解释文本.',
  '',
  'JSON schema:',
  '{',
  '  "side": "buy" | "sell" | "query" | "cancel" | "none",',
  '  "asset": "KAS" | "USDT" | null,',
  '  "qty": <number> | null,',
  '  "qty_unit": "KAS" | "USDT" | null,',
  '  "pay_chain": "BSC" | "ETH" | "POLYGON" | "TRON" | "SOL" | "KASPA" | null,',
  '  "evm_address": "0x[40 hex]" | null,',
  '  "confidence": "high" | "medium" | "low",',
  '  "missing_fields": [<string array, 列出 user 还没说清的字段例如 pay_chain / evm_address>],',
  '  "raw_intent_text": "<user 原话不改>"',
  '}',
  '',
  'confidence 必按下面规则判:',
  '- "high": side+asset+qty+pay_chain 全填 (非 null), AND user 最近消息含明确 confirm 意图 (同意/接受/OK/可以/发吧/确认/转了/付了)',
  '- "medium": user 意图清晰但还在补字段 (1+ missing) — 不要默认 medium, 字段齐 + confirm 必 high',
  '- "low": 用户意图不明 (e.g. 闲聊/单纯问价格 — 不是真买卖意图)',
  '',
  '⚠ 关键: 字段齐 + user confirm → 必返 "high". 这是 publish 触发信号. 默认 medium 会让 broker 永远不下单.',
  'EVM 链 (BSC/ETH/POLYGON/ARB 等) buy 时 user 必须提供 evm_address (0x... 40 hex), 否则 surface 进 missing_fields.',
  '',
  '只返回 JSON 对象本身, 一个字符不多.',
].join('\n');

// 漏洞 M-2 fix (2026-05-04): 删除 T1_DISCLAIMER (T1 阶段遗留, 现已 T3 阶段).
// 旧 disclaimer "T1 验证阶段, 暂时不能完成实际撮合" 跟 user 真在下单的对话矛盾,
// Brain 看 instructions 含此 disclaimer → 真信不过 matcher → freestyle 演 broker.
// 改 fall-through 文案: "缺 X 请补", 不 mock 阶段限制。
export function generateReply(intent) {
  if (!intent || intent.side === 'none' || intent.confidence === 'low') {
    return '抱歉, 我没完全听懂你的意图. 能更具体说一下你想做什么交易吗? 例如 "我要用 50 USDT 买 KAS, 用 BNB 链付款".';
  }
  if (intent.missing_fields && intent.missing_fields.length > 0) {
    const sideText = intent.side === 'buy' ? '购买' : intent.side === 'sell' ? '出售' : '了解';
    const assetText = intent.asset || '资产';
    return `我明白你想${sideText} ${assetText}. 还需要确认: ${intent.missing_fields.join(', ')}. 你能补充一下吗?`;
  }
  const qty = intent.qty != null ? `${intent.qty} ${intent.qty_unit || ''}` : '';
  const sideAction = intent.side === 'buy' ? `用 ${qty} 买入 ${intent.asset || ''}` : intent.side === 'sell' ? `卖 ${qty} 换 ${intent.asset || ''}` : `执行 ${intent.side}`;
  const chainText = intent.pay_chain ? `, 用 ${intent.pay_chain} 链` : '';
  return `好的, 我看到你想${sideAction}${chainText}. 准备出报价, 你确认就发布.`;
}

// T1.4 ship: ASCII safety (per ANTI-PATTERNS 陷阱 #3 + LLM 偶尔吐 unpaired surrogate).
export function ensureAsciiSafe(text) {
  if (!text) return '';
  return text.replace(/[\uD800-\uDFFF]/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
}

// T1.4 ship: 调 KANet ActionExecutor.executeOne 发 DM (不自造 send 路径, 不直碰 Relay).
export async function replyToUser(peerAddress, replyText, actionExecutor) {
  if (!peerAddress || !replyText || !actionExecutor?.executeOne) {
    return { ok: false, reason: 'replyToUser: missing required arg or actionExecutor lacks executeOne' };
  }
  const safeText = ensureAsciiSafe(replyText);
  return await actionExecutor.executeOne({
    type: 'send_message',
    target: peerAddress,
    message: safeText,
  });
}

function _intentFallback(latestMessage, missingTag, errMsg, parseError) {
  const result = {
    side: 'none', asset: null, qty: null, qty_unit: null, pay_chain: null,
    confidence: 'low', missing_fields: [missingTag],
    raw_intent_text: latestMessage,
  };
  if (errMsg) result._error = errMsg;
  if (parseError) result._parse_error = true;
  return result;
}
