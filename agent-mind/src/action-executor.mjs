/**
 * Action Executor
 *
 * Gate 3 of the three-gate identity architecture.
 * Receives candidate actions from AI brain (via Adapter),
 * validates each action against the sender's authority level,
 * then executes authorized actions against Console/Relay APIs.
 *
 * Even if the Brain is completely compromised by prompt injection,
 * this gate prevents unauthorized operations (goal changes, payments, etc.)
 * from non-owner senders.
 */

import { fetchJson } from './utils.mjs';
import { executeTool, executeConfirmed } from './skills/code-ops/executor.mjs';
import { getState, recordAction } from './skills/code-ops/layer-engine.mjs';

/**
 * Required authority for each action type.
 * Checked against senderMeta.authority from Gate 1.
 */
const ACTION_REQUIRED_AUTHORITY = {
  // Basic actions — anyone who can chat
  send_reply:           'chat',
  send_message:         'chat',
  follow_up:            'chat',
  send_broadcast:       'chat',
  stay_silent:          'chat',
  update_relationship:  'chat',
  schedule_followup:    'chat',
  do_nothing:           'chat',

  // Privileged actions — only owner
  update_goal:          'manage_goals',
  retire_goal:          'manage_goals',
  add_goal:             'manage_goals',
  update_principles:    'manage_self',
  update_style:         'manage_self',
  publish_card_update:  'manage_self',
  send_payment:         'send_payment',

  // Trade actions — gated by trade-action.js (source × mode × limits)
  accept_order:         'trade',
  pay_usdt:             'trade',
  verify_payment:       'trade',
  send_kas:             'trade',
  cancel_order:         'trade',
  publish_order:        'trade',
  // Legacy ACTION names from Brain (mapped to new names in executeOne)
  CREATE_MM_ORDER:      'trade',
  PLACE_ORDER:          'trade',
  CANCEL_ORDER:         'trade',
  CANCEL_ALL_ORDERS:    'trade',
  UPDATE_MM_ORDER:      'trade',
  SEND_KAS:             'trade',
  VERIFY_PAYMENT:       'trade',
  POLYMARKET_ORDER:     'trade',
  MAKE_MARKET:          'trade',
  SELL_MAKER:           'trade',
  BUY_MAKER:            'trade',
  CANCEL_OFFERS:        'trade',

  // Moderate actions — need at least 'suggest' authority
  initiate_handshake:   'suggest',
};

/**
 * Content sensitivity patterns — internal information that must NEVER
 * be sent to non-owner peers via proactive SEND_MESSAGE.
 * Each pattern is [regex, category] for logging.
 */
const SENSITIVE_PATTERNS = [
  // Infrastructure
  [/\bport\s*\d{4}\b/i,                  'port_number'],
  [/\blocalhost[:\d]*/i,                 'localhost_ref'],
  [/\b(3100|301[0-5])\b/,               'known_port'],
  // Service internals
  [/\b(adapter|relay|scanner|console)\s*(UP|DOWN|RUNNING|STOPPED|unreachable)\b/i, 'service_status'],
  [/\bmind-manager|ingest-service|order-machine|trade-protocol/i, 'service_name'],
  [/\b(rpc-listener|context-builder|action-executor|relay)\.m?js\b/i, 'source_file'],
  // System details
  [/\bLAPTOP-|DESKTOP-|\\[A-Z]:\\/i,    'hostname_or_path'],
  [/\bNode\s*v?\d+\.\d+/i,              'node_version'],
  [/\bWindows\s+\d+|Linux\s+\d+/i,      'os_version'],
  [/\bD:[/\\]Anthropic/i,               'workspace_path'],
  [/\bpm2\s+(start|stop|restart|list)/i, 'process_mgmt'],
  // API internals
  [/\/api\/(system|health|agent)\//i,    'internal_api'],
  [/\bPOST\s+\/api\//i,                 'api_endpoint'],
];

export class ActionExecutor {
  constructor(config, memoryKernel, callbacks = {}) {
    this.config = config;
    this.memory = memoryKernel;
    this.callbacks = callbacks;   // { tradeGate } — injected by Console
    this.scheduledFollowups = []; // { executeAt, note, target }
    this._senderMeta = null;     // Set per-request by setSenderContext()
  }

  /**
   * Set the sender context for Gate 3 authority checks.
   * Must be called before executeActions() for each request.
   *
   * @param {object|null} senderMeta - from Gate 1 evaluateSenderGate()
   */
  setSenderContext(senderMeta) {
    this._senderMeta = senderMeta;
  }

  /**
   * Gate 3: Check if the current sender has authority for an action.
   *
   * @param {string} actionType - the action being attempted
   * @returns {{ allowed: boolean, reason?: string }}
   */
  _checkAuthority(actionType) {
    // Proactive actions (no sender) are always allowed — the agent is acting on its own
    if (!this._senderMeta) return { allowed: true };

    const required = ACTION_REQUIRED_AUTHORITY[actionType];
    if (!required) {
      // Unknown action type — deny by default for safety
      console.log(`[gate3] DENIED unknown action: ${actionType}`);
      return { allowed: false, reason: `unknown action type "${actionType}"` };
    }

    const authority = this._senderMeta.authority || [];
    if (authority.includes(required)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `action "${actionType}" requires "${required}" authority, sender is "${this._senderMeta.relation}" with [${authority.join(',')}]`,
    };
  }

  /**
   * Execute a list of candidate actions returned by the AI brain.
   *
   * @param {Array} actions - Array of action objects from AI response
   * @returns {Array} results of each action execution
   */
  async executeActions(actions) {
    if (!Array.isArray(actions)) return [];

    const results = [];
    for (const action of actions) {
      // ── Gate 3: authority check before execution ──
      const auth = this._checkAuthority(action.type);
      if (!auth.allowed) {
        console.log(`[gate3] BLOCKED action: ${auth.reason}`);
        results.push({ action: action.type, success: false, blocked: true, reason: auth.reason });
        continue;
      }

      try {
        const result = await this.executeOne(action);
        // Check if executeOne returned a soft failure (ok: false without throwing)
        const success = result?.ok !== false;
        results.push({ action: action.type, success, result });
        if (!success) {
          console.log(`[agent-mind:executor] Action '${action.type}' soft-failed: ${result?.reason || 'unknown'}`);
        }
      } catch (err) {
        console.log(`[agent-mind:executor] Action '${action.type}' failed: ${err.message}`);
        results.push({ action: action.type, success: false, error: err.message });
      }
    }
    return results;
  }

  /**
   * Execute a single action.
   */
  async executeOne(action) {
    switch (action.type) {
      case 'send_reply':
        return this.sendReply(action);
      case 'send_message':
        return this.sendMessage(action);
      case 'stay_silent':
        return this.staySilent(action);
      case 'update_relationship':
        return this.updateRelationship(action);
      case 'schedule_followup':
        return this.scheduleFollowup(action);
      case 'publish_card_update':
        return this.publishCardUpdate(action);
      case 'initiate_handshake':
        return this.initiateHandshake(action);
      case 'follow_up':
        return this.sendMessage(action); // same execution, different semantic intent
      case 'send_broadcast':
        return this.sendBroadcast(action);
      case 'do_nothing':
      case 'DO_NOTHING':
        return { ok: true, reason: action.reason || action.params?.reason || 'chose to do nothing' };
      // Uppercase aliases (from ACTION tags)
      case 'SEND_MESSAGE':
        return this.sendMessage(action);
      case 'FOLLOW_UP':
        return this.sendMessage(action);
      case 'INITIATE_HANDSHAKE':
        return this.initiateHandshake(action);
      case 'SEND_BROADCAST':
        return this.sendBroadcast(action);

      // ── Trade actions — delegated to Console via callback ──
      case 'accept_order':
      case 'pay_usdt':
      case 'verify_payment':
      case 'send_kas':
      case 'cancel_order':
      case 'publish_order':
        return this.executeTradeAction(action);
      // Legacy ACTION names from Brain → map to canonical names
      case 'CREATE_MM_ORDER':
        return this.executeTradeAction({ ...action, type: 'publish_order' });
      case 'PLACE_ORDER':
        return this.executePlaceOrder(action);
      case 'CANCEL_ORDER':
      case 'CANCEL_ALL_ORDERS':
        return this.executeTradeAction({ ...action, type: 'cancel_order' });
      case 'UPDATE_MM_ORDER':
        return this.executeTradeAction({ ...action, type: 'accept_order' });
      case 'SEND_KAS':
        return this.executeTradeAction({ ...action, type: 'send_kas' });
      case 'VERIFY_PAYMENT':
        return this.executeTradeAction({ ...action, type: 'verify_payment' });
      case 'MAKE_MARKET':
        return this.executeMakeMarket(action);
      case 'SELL_MAKER':
        return this.executeSellMaker(action);
      case 'BUY_MAKER':
        return this.executeSellMaker(action);  // 共用框架，side 由 action 推断（Phase 1b+）
      case 'CANCEL_OFFERS':
        return this.executeCancelOffers(action);
      case 'POLYMARKET_ORDER':
        return this.executePolymarketOrder(action);
      case 'BROKER_ORDER':
        return this.executeBrokerOrder(action);

      // ── System actions (白名单制) ──
      case 'SYSTEM_DOWNLOAD':
        return this.executeSystemAction('download', action);
      case 'SYSTEM_RUN':
        return this.executeSystemAction('run', action);
      case 'SYSTEM_CHECK_PROCESS':
        return this.executeSystemAction('check-process', action);

      // ── code-ops tools (L3/L4 behavior layer) ──
      case 'READ_FILE':
      case 'SEARCH_CODE':
      case 'HTTP_REQUEST':
      case 'WRITE_FILE':
      case 'RUN_COMMAND':
        return this.executeCodeOps(action);

      default:
        console.log(`[agent-mind:executor] Unknown action type: ${action.type}`);
        return { ok: false, reason: `unknown action type: ${action.type}` };
    }
  }

  /**
   * 执行系统操作（白名单制，通过 Console API）
   */
  async executeSystemAction(op, action) {
    const { consoleUrl } = this.config;
    try {
      let result;
      const p = action.params || action;
      switch (op) {
        case 'download':
          result = await fetchJson(`${consoleUrl}/api/system/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionId: p.actionId }),
          });
          console.log(`[executor] SYSTEM_DOWNLOAD ${p.actionId}: ${result.ok ? 'OK ' + (result.size || '') : result.error}`);
          return result;
        case 'run':
          result = await fetchJson(`${consoleUrl}/api/system/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: p.filePath }),
          });
          console.log(`[executor] SYSTEM_RUN: ${result.ok ? 'PID ' + result.pid : result.error}`);
          return result;
        case 'check-process':
          result = await fetchJson(`${consoleUrl}/api/system/check-process?name=${encodeURIComponent(p.name || 'ibgateway')}`);
          console.log(`[executor] SYSTEM_CHECK_PROCESS ${p.name}: ${result.running ? 'RUNNING' : 'NOT RUNNING'}`);
          return result;
        default:
          return { ok: false, reason: `unknown system op: ${op}` };
      }
    } catch (e) {
      console.error(`[executor] System action error:`, e.message);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Send a text reply via Adapter.
   */
  async sendReply(action) {
    const { adapterUrl } = this.config;
    const response = await fetchJson(`${adapterUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionKey: 'agent:main:main',
        message: action.text,
      }),
    });
    console.log(`[agent-mind:executor] Reply sent: "${action.text?.slice(0, 60)}..."`);
    return { ok: true, response };
  }

  /**
   * Anti-spam gate: check Console before any outbound proactive contact.
   * Returns { allowed: true } or { allowed: false, reason }.
   */
  async _antiSpamCheck(targetAddress) {
    try {
      const { consoleUrl } = this.config;
      const agentAddr = this.config.address;
      const res = await fetchJson(
        `${consoleUrl}/api/agent/outbound-check?agent_address=${encodeURIComponent(agentAddr)}&peer_address=${encodeURIComponent(targetAddress)}`
      );
      if (!res.allowed) {
        console.log(`[agent-mind:executor] ANTI-SPAM BLOCKED → ${targetAddress.slice(-8)}: ${res.reason}`);
        this.memory.recordEvent({
          type: 'outbound_blocked',
          summary: `Anti-spam: cannot contact ${targetAddress.slice(-8)} — ${res.reason}`,
        });
        return res;
      }
      return { allowed: true };
    } catch (e) {
      // Fail-closed: if we can't verify, don't send
      console.log(`[agent-mind:executor] Anti-spam check FAILED (blocking): ${e.message}`);
      return { allowed: false, reason: `anti-spam unreachable: ${e.message}` };
    }
  }

  /**
   * Content sensitivity gate: block internal information from reaching non-owner peers.
   * Only applies to proactive actions (no _senderMeta = agent acting on its own).
   */
  _checkContentSensitivity(message, targetAddress) {
    // Only filter proactive outbound (no sender = agent's own initiative)
    if (this._senderMeta) return { allowed: true };
    if (!message) return { allowed: true };

    // Check if target is a sibling agent (same Console) — siblings are trusted
    const myAddr = this.config.address;
    const siblingAddrs = this.config.siblingAddresses || [];
    if (targetAddress === myAddr || siblingAddrs.includes(targetAddress)) {
      return { allowed: true };
    }

    for (const [pattern, category] of SENSITIVE_PATTERNS) {
      if (pattern.test(message)) {
        console.log(`[gate3:content] BLOCKED sensitive "${category}" in proactive DM to ${targetAddress?.slice(-8)}`);
        this.memory.recordEvent({
          type: 'content_blocked',
          summary: `Blocked proactive DM: "${category}" pattern detected — internal info must not reach external peers`,
        });
        return {
          allowed: false,
          reason: `content sensitivity: "${category}" detected — internal information cannot be sent to external peers`,
        };
      }
    }
    return { allowed: true };
  }

  /**
   * Send a proactive message to a target address via Console relay.
   */
  async sendMessage(action) {
    if (!action.target || !action.target.startsWith('kaspa:q') || action.target.includes('...') || action.target.length < 60) {
      console.log(`[agent-mind:executor] Invalid target address: ${action.target} (len=${action.target?.length}) — skipped`);
      // Record failure in memory so Brain learns not to use this address again
      this.memory.recordEvent({
        type: 'action_failed',
        summary: `FAILED send to "${action.target?.slice(0, 20)}..." — address invalid (too short or truncated). Use FULL kaspa:q... address from connections list.`,
      });
      return { ok: false, reason: `invalid address: ${action.target}` };
    }
    // ── Anti-spam gate ──
    const spamCheck = await this._antiSpamCheck(action.target);
    if (!spamCheck.allowed) {
      return { ok: false, reason: `anti-spam: ${spamCheck.reason}` };
    }

    // ── Content sensitivity gate (proactive only) ──
    const contentCheck = this._checkContentSensitivity(action.message, action.target);
    if (!contentCheck.allowed) {
      return { ok: false, reason: contentCheck.reason };
    }

    // ── Local dedup: check recent sent_message to same target ──
    const recentDMs = (this.memory.shortTermEvents || [])
      .filter(e => e.type === 'sent_message' && e.to === action.target)
      .slice(-5);
    if (recentDMs.length > 0 && action.message) {
      const newMsg = (action.message || '').slice(0, 80).toLowerCase();
      for (const prev of recentDMs) {
        const prevMsg = (prev.summary || '').slice(0, 80).toLowerCase();
        if (newMsg.length > 10 && prevMsg.includes(newMsg.slice(0, 40))) {
          console.log(`[agent-mind:executor] DM dedup: similar to recent sent_message to ${action.target?.slice(-12)}`);
          this.memory.recordEvent({ type: 'dm_skipped', summary: `DM dedup: similar message to ${action.target?.slice(-8)} already sent recently` });
          return { ok: false, reason: 'dedup: similar DM already sent to this target' };
        }
      }
    }

    const { consoleUrl, relayNodeId } = this.config;
    const response = await fetchJson(`${consoleUrl}/api/relay/${relayNodeId}/send-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'send_message', target: action.target, message: action.message }),
    });
    console.log(`[agent-mind:executor] Message sent to ${action.target?.slice(-12)}`);

    // Record in memory (short-term)
    this.memory.recordEvent({
      type: 'sent_message',
      from: this.config.address,
      to: action.target,
      summary: `Proactive message: ${action.message?.slice(0, 60)}`,
    });

    // 去重靠 account_relations（per-agent），不写全局 tags

    return { ok: true, response };
  }

  /**
   * Broadcast a message to a public channel.
   * Includes dedup: if a very similar broadcast was sent recently, skip it.
   */
  async sendBroadcast(action) {
    if (!action.message?.trim()) {
      return { ok: false, reason: 'empty broadcast message' };
    }

    // Dedup: check recent events for similar broadcasts (prevent spam loops)
    const recentBroadcasts = this.memory.shortTermEvents
      .filter(e => e.type === 'broadcast')
      .slice(-10);
    const newMsg = action.message.trim().toLowerCase().slice(0, 80);
    for (const prev of recentBroadcasts) {
      const prevMsg = (prev.summary || '').toLowerCase();
      // If >60% of the new message appears in a recent broadcast, it's a repeat
      if (prevMsg.includes(newMsg.slice(0, 40)) || newMsg.includes(prevMsg.slice(prevMsg.indexOf(':') + 1).trim().slice(0, 40))) {
        console.log(`[agent-mind:executor] Broadcast SKIPPED — too similar to recent: "${prev.summary?.slice(0, 60)}"`);
        this.memory.recordEvent({
          type: 'broadcast_skipped',
          summary: `Broadcast BLOCKED (duplicate): "${action.message?.slice(0, 50)}" — similar to recent broadcast`,
        });
        return { ok: false, reason: 'duplicate broadcast — too similar to recent message' };
      }
    }

    const { consoleUrl, relayNodeId } = this.config;
    const channel = action.channel || 'general';
    const response = await fetchJson(`${consoleUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: relayNodeId, channel, message: action.message.trim() }),
    });
    console.log(`[agent-mind:executor] Broadcast to #${channel}: "${action.message?.slice(0, 60)}"`);
    this.memory.recordEvent({
      type: 'broadcast',
      summary: `Broadcast to #${channel}: ${action.message?.slice(0, 60)}`,
    });
    return { ok: true, response };
  }

  /**
   * Stay silent — just log the reason.
   */
  staySilent(action) {
    console.log(`[agent-mind:executor] Staying silent: ${action.reason || 'no reason given'}`);
    return { ok: true, reason: action.reason };
  }

  /**
   * Update relationship memory for a peer.
   */
  updateRelationship(action) {
    if (action.address && action.note) {
      this.memory.addRelationshipNote(action.address, action.note);
      console.log(`[agent-mind:executor] Relationship updated for ${action.address?.slice(0, 20)}...`);
    }
    return { ok: true };
  }

  /**
   * Schedule a follow-up action for later.
   */
  scheduleFollowup(action) {
    const executeAt = Date.now() + (action.delayMinutes || 5) * 60 * 1000;
    this.scheduledFollowups.push({
      executeAt,
      note: action.note,
      target: action.target || null,
    });
    console.log(`[agent-mind:executor] Follow-up scheduled in ${action.delayMinutes || 5} minutes`);
    return { ok: true, executeAt: new Date(executeAt).toISOString() };
  }

  /**
   * Publish a card update (placeholder — delegates to Console).
   */
  async publishCardUpdate(action) {
    const { consoleUrl, relayNodeId } = this.config;
    console.log(`[agent-mind:executor] Card update requested (delegating to Console)`);
    // Future: POST to console card update endpoint
    return { ok: true, note: 'card update not yet implemented' };
  }

  /**
   * Initiate a handshake with a target address.
   * If already connected, auto-downgrade to send_message (handshake is ~1000x more expensive).
   */
  async initiateHandshake(action) {
    const { consoleUrl, relayNodeId } = this.config;

    // Validate target address format (must be full kaspa:q... address, ≥60 chars)
    if (!action.target || !action.target.startsWith('kaspa:q') || action.target.includes('...') || action.target.length < 60) {
      console.log(`[agent-mind:executor] Invalid target address: ${action.target} (len=${action.target?.length}) — skipped`);
      return { ok: false, reason: `invalid address: ${action.target}` };
    }

    // ══ LOCK 0: Anti-spam gate ══
    const spamCheck = await this._antiSpamCheck(action.target);
    if (!spamCheck.allowed) {
      return { ok: false, reason: `anti-spam: ${spamCheck.reason}` };
    }

    // ══ LOCK 1: Check account_relations (per-agent) + kbeam_user (global) ══
    try {
      const peerCtx = await fetchJson(
        `${consoleUrl}/api/agent/peer-context?my_address=${encodeURIComponent(this.config.address)}&peer_address=${encodeURIComponent(action.target)}`
      );

      const connectionStatus = peerCtx?.peer?.connectionStatus;

      // active/confirmed → already communicating, use send_message (cheap)
      if (connectionStatus === 'active' || connectionStatus === 'confirmed') {
        console.log(`[agent-mind:executor] Already ${connectionStatus} with ${action.target?.slice(-8)} — using send_message`);
        return this.sendMessage({ target: action.target, message: action.message || 'Hello!' });
      }

      // accepted → handshake done, use send_message
      if (connectionStatus === 'accepted') {
        console.log(`[agent-mind:executor] Handshake accepted with ${action.target?.slice(-8)} — using send_message`);
        return this.sendMessage({ target: action.target, message: action.message || 'Hello!' });
      }

      // observed → Scout saw them but no handshake yet — allow handshake
      // null/undefined → unknown address — allow handshake
      // blocked → do nothing
      if (connectionStatus === 'blocked') {
        console.log(`[agent-mind:executor] Address ${action.target?.slice(-8)} is blocked — skipping`);
        this._recordBlockedHandshake(action.target, 'blocked');
        return { ok: false, reason: 'blocked' };
      }

      // kbeam_user → protocol incompatible (global check)
      const peerTags = peerCtx?.peer?.tags || '';
      if (peerTags.includes('kbeam_user')) {
        console.log(`[agent-mind:executor] KBeam user ${action.target?.slice(-8)} — skipping`);
        // Write to DB so Brain/Intent learns to avoid this target
        this._recordBlockedHandshake(action.target, 'kbeam_user');
        return { ok: false, reason: 'kbeam_user' };
      }

      // Extra check: query interaction_records for any prior handshake to this address
      try {
        const priorHs = await fetchJson(
          `${consoleUrl}/api/discovery/interaction?check=true&addressA=${encodeURIComponent(this.config.address)}&addressB=${encodeURIComponent(action.target)}&type=handshake`
        );
        if (priorHs?.exists) {
          console.log(`[agent-mind:executor] Already handshaked ${action.target?.slice(-8)} before — skipping`);
          return { ok: false, reason: 'already_handshaked' };
        }
      } catch {}

      console.log(`[agent-mind:executor] New contact ${action.target?.slice(-8)} (status=${connectionStatus || 'none'}) — handshake allowed`);
    } catch {
      console.log(`[agent-mind:executor] DB check failed for ${action.target?.slice(-8)} — handshake BLOCKED (fail-safe)`);
      return { ok: false, reason: 'db_check_failed' };
    }

    // ══ LOCK 2: Balance guard ══
    try {
      const balRes = await fetchJson(`${consoleUrl}/api/relay/${encodeURIComponent(relayNodeId)}/balance`);
      const balanceKas = parseFloat(balRes?.balance || '0');
      if (balanceKas <= 1.0) {
        console.log(`[agent-mind:executor] LOCK: Balance ${balanceKas} KAS ≤ 1.0 — handshake BLOCKED`);
        return { ok: false, reason: `balance_too_low (${balanceKas} KAS)`, suggestion: 'use send_message' };
      }
    } catch {
      // Can't check balance — BLOCK (fail-safe)
      console.log(`[agent-mind:executor] LOCK: Balance check failed — handshake BLOCKED (fail-safe)`);
      return { ok: false, reason: 'balance_check_failed' };
    }

    // ══ Record intent in pending_actions before spending KAS ══
    try {
      const paParams = new URLSearchParams({
        create_and_claim: '1',
        local_address: this.config.address,
        target_address: action.target,
        action_type: 'handshake_init',
        direction: 'outbound',
        source: 'mind',
      });
      await fetchJson(`${consoleUrl}/ingest/pending-handshakes?${paParams}`);
    } catch (paErr) {
      console.log(`[agent-mind:executor] pending_actions write failed (non-blocking): ${paErr?.message}`);
    }

    // ══ All locks passed — execute handshake ══
    const response = await fetchJson(`${consoleUrl}/api/relay/${encodeURIComponent(relayNodeId)}/send-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'handshake', target: action.target }),
    });
    console.log(`[agent-mind:executor] Handshake initiated with ${action.target?.slice(-12)} (all locks passed)`);

    // account_relations 由 Relay 的 ingestHandshake 自动创建（outgoing 状态）
    // 不需要全局 tags

    return { ok: true, response };
  }

  /**
   * Route PLACE_ORDER to exchange and/or free market based on market param.
   * market=exchange (default) | free_market | both
   */
  async executePlaceOrder(action) {
    const market = action.params?.market || action.market || 'exchange';
    const results = [];

    if (market === 'exchange' || market === 'both') {
      // Exchange order via existing trade action pipeline
      const exchangeResult = await this.executeTradeAction({
        ...action, type: 'publish_order',
        params: { ...action.params, side: action.params?.side || action.side, amount: action.params?.amount || action.amount, price: action.params?.price || action.price },
      });
      results.push({ market: 'exchange', ...exchangeResult });
      console.log(`[agent-mind:executor] PLACE_ORDER exchange → ${exchangeResult.ok ? 'OK' : exchangeResult.reason || 'failed'}`);
    }

    if (market === 'free_market' || market === 'both') {
      // Free market: post offer on /exchange (new protocol-level market)
      const side = (action.params?.side || action.side || 'sell').toLowerCase();
      const amount = parseFloat(action.params?.amount || action.amount);
      const price = parseFloat(action.params?.price || action.price);
      try {
        const { consoleUrl } = this.config;
        const relayNodeId = this.config.relayNodeId;
        const body = side === 'sell'
          ? { relayNodeId, give_asset: 'KAS', give_amount: String(amount), give_chain: 'kaspa', want_asset: 'USDT', want_amount: String((amount * price).toFixed(6)), verification: 'manual' }
          : { relayNodeId, give_asset: 'USDT', give_amount: String((amount * price).toFixed(6)), want_asset: 'KAS', want_amount: String(amount), want_chain: 'kaspa', verification: 'manual' };
        const result = await fetchJson(`${consoleUrl}/api/exchange/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        results.push({ market: 'free_market', ok: true, result });
        console.log(`[agent-mind:executor] PLACE_ORDER free_market → OK`);
      } catch (err) {
        results.push({ market: 'free_market', ok: false, reason: err.message });
        console.log(`[agent-mind:executor] PLACE_ORDER free_market → FAILED: ${err.message}`);
      }
    }

    if (results.length === 1) return results[0];
    return { ok: results.some(r => r.ok), results };
  }

  /**
   * MAKE_MARKET: post sell + buy offers on KANet /exchange.
   * ACTION format: [ACTION:MAKE_MARKET amount=500 sell_price=0.03135 buy_price=0.03117 hedge_cex=Gate reason="..."]
   *
   * Preflight:
   *   - amount ≤ 1000 KAS per order
   *   - daily cumulative ≤ 5000 KAS
   *   - amount ≥ 50 KAS
   *   - KAS balance ≥ amount (for sell side)
   */
  async executeMakeMarket(action) {
    const { consoleUrl, relayNodeId, address } = this.config;
    const amount = parseFloat(action.params?.amount || action.amount);
    const sellPrice = parseFloat(action.params?.sell_price || action.sell_price);
    const buyPrice = parseFloat(action.params?.buy_price || action.buy_price);
    const hedgeCex = action.params?.hedge_cex || action.hedge_cex || null;
    const reason = action.params?.reason || action.reason || 'market making';

    // Validate
    if (!amount || !sellPrice || !buyPrice) {
      return { ok: false, reason: 'MAKE_MARKET requires amount, sell_price, buy_price' };
    }
    if (amount < 50) return { ok: false, reason: `Amount ${amount} below minimum 50 KAS` };
    if (amount > 1000) return { ok: false, reason: `Amount ${amount} exceeds per-order limit 1000 KAS` };
    if (sellPrice <= buyPrice) return { ok: false, reason: 'sell_price must be > buy_price' };

    const results = [];

    // Sell offer: give KAS, want USDT
    try {
      const sellResult = await fetchJson(`${consoleUrl}/api/exchange/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relayNodeId,
          give_asset: 'KAS', give_amount: String(amount), give_chain: 'kaspa',
          want_asset: 'USDT', want_amount: String((amount * sellPrice).toFixed(6)), want_chain: null,
          verification: 'manual',
        }),
      });
      results.push({ side: 'sell', ok: true, offerId: sellResult?.id || sellResult?.offer_id });
      console.log(`[executor] MAKE_MARKET sell ${amount} KAS @ ${sellPrice} → OK`);
    } catch (err) {
      results.push({ side: 'sell', ok: false, reason: err.message });
      console.log(`[executor] MAKE_MARKET sell → FAILED: ${err.message}`);
    }

    // Buy offer: give USDT, want KAS
    try {
      const buyResult = await fetchJson(`${consoleUrl}/api/exchange/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relayNodeId,
          give_asset: 'USDT', give_amount: String((amount * buyPrice).toFixed(6)), give_chain: null,
          want_asset: 'KAS', want_amount: String(amount), want_chain: 'kaspa',
          verification: 'manual',
        }),
      });
      results.push({ side: 'buy', ok: true, offerId: buyResult?.id || buyResult?.offer_id });
      console.log(`[executor] MAKE_MARKET buy ${amount} KAS @ ${buyPrice} → OK`);
    } catch (err) {
      results.push({ side: 'buy', ok: false, reason: err.message });
      console.log(`[executor] MAKE_MARKET buy → FAILED: ${err.message}`);
    }

    // Record event
    this.memory.recordEvent({
      type: 'make_market',
      summary: `Market making: sell ${amount} KAS @${sellPrice}, buy @${buyPrice}, hedge=${hedgeCex || 'none'}. ${reason}`,
    });

    const allOk = results.every(r => r.ok);
    const anyOk = results.some(r => r.ok);
    return { ok: allOk, partial: anyOk && !allOk, results, hedgeCex };
  }

  /**
   * Execute a maker sell order on a specified CEX + simultaneous /exchange improvement order.
   * ACTION format: [ACTION:SELL_MAKER exchange=mexc qty=98 price=0.032124]
   */
  async executeSellMaker(action) {
    const { consoleUrl, relayNodeId } = this.config;
    const exchange = action.params?.exchange || action.exchange;
    const suggestedQty = parseInt(action.params?.qty || action.qty) || 2000;
    const agentName = this.config.agentName || 'unknown';

    if (!exchange) return { ok: false, error: 'SELL_MAKER requires exchange parameter' };

    // Step 0: 日限额硬校验（总限额，不是每所）
    let remainingKas = Infinity;
    try {
      const usageRes = await fetchJson(`${consoleUrl}/api/trade/daily-usage`);
      const total = usageRes?.total;
      if (total) {
        remainingKas = total.remaining_kas ?? Infinity;
        if (remainingKas <= 0) {
          console.log(`[SELL_MAKER] Daily limit reached: ${total.sold_kas}/${total.limit_kas} KAS`);
          return { ok: false, error: `Daily sell limit reached (${total.sold_kas}/${total.limit_kas} KAS). Resets at midnight UTC.` };
        }
        if (total.pct_used >= 80) {
          console.log(`[SELL_MAKER] Daily limit ${total.pct_used}% used — proceeding but Brain should reduce frequency`);
        }
      }
    } catch (e) {
      console.log(`[SELL_MAKER] daily-usage check failed: ${e.message} — blocking (fail-closed)`);
      return { ok: false, error: `Daily limit check unavailable: ${e.message}. Refusing to proceed.` };
    }

    // Step 1: 刷新订单簿（不用 ACTION 里的过期价格）
    let ob;
    try {
      const res = await fetchJson(`${consoleUrl}/api/trade/orderbook?exchange=${exchange}`);
      ob = res?.orderbook;
    } catch (e) {
      return { ok: false, error: `Orderbook fetch failed: ${e.message}` };
    }
    if (!ob || ob.error || !ob.bid1) {
      return { ok: false, error: `No orderbook data for ${exchange}` };
    }

    // Step 2: 重新计算执行参数
    const bid1    = ob.bid1;
    const bid1Qty = ob.bid1_qty ?? 0;
    const execPrice = parseFloat((bid1 * 1.0001).toFixed(6));

    const minOrderUsdt = ob.min_order_usdt ?? 1;
    const minKas       = Math.ceil(minOrderUsdt / bid1);

    const execQty   = Math.min(Math.floor(bid1Qty * 0.30), 2000, suggestedQty, Math.floor(remainingKas));

    if (execQty < minKas) {
      console.log(`[SELL_MAKER] ${exchange} qty ${execQty} < min ${minKas} KAS ($${minOrderUsdt}), skip`);
      return { ok: false, error: `Order too small: ${execQty} KAS < min ${minKas} KAS ($${minOrderUsdt}) for ${exchange}` };
    }

    // Step 3: CEX 下限价 Maker 卖单
    let cexOrderId;
    try {
      const orderRes = await fetchJson(`${consoleUrl}/api/trade/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange,
          side: 'SELL',
          symbol: 'KASUSDT',
          qty: execQty,
          price: execPrice,
          relayNodeId,
        }),
      });
      if (!orderRes?.ok) throw new Error(orderRes?.error || 'Order rejected');
      cexOrderId = orderRes.orderId;
    } catch (e) {
      return { ok: false, error: `CEX order failed: ${e.message}` };
    }

    console.log(`[SELL_MAKER] ${agentName} SELL ${execQty} KAS @${execPrice} on ${exchange}, orderId=${cexOrderId}`);

    // Step 4: /exchange 改善单（比 CEX 价格稍高 0.02%，吸引 Taker 来 /exchange）
    const improvePrice = parseFloat((execPrice * 1.0002).toFixed(6));
    const wantUsdt     = parseFloat((execQty * improvePrice).toFixed(4));
    let exchangeOfferId;
    try {
      const exRes = await fetchJson(`${consoleUrl}/api/exchange/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relayNodeId,
          give_asset: 'KAS', give_amount: String(execQty),
          want_asset: 'USDT', want_amount: String(wantUsdt),
          verification: 'manual',
          expires_minutes: 30,
        }),
      });
      exchangeOfferId = exRes?.offer_id || exRes?.id;
      console.log(`[SELL_MAKER] /exchange improvement offer=${exchangeOfferId} @${improvePrice}`);
    } catch (e) {
      console.log(`[SELL_MAKER] /exchange improvement failed: ${e.message}`);
    }

    // Step 5: 异步监控（不阻塞返回）
    this._monitorSellMaker({
      exchange, cexOrderId, exchangeOfferId,
      execQty, execPrice, relayNodeId, agentName,
      startedAt: Date.now(),
    }).catch(e => console.error(`[SELL_MAKER] monitor error: ${e.message}`));

    this.memory.recordEvent({
      type: 'sell_maker',
      summary: `SELL_MAKER: ${execQty} KAS @${execPrice} on ${exchange}, cex=${cexOrderId}, exchange=${exchangeOfferId || 'none'}`,
    });

    return {
      ok: true, exchange, cexOrderId,
      exchangeOfferId: exchangeOfferId || null,
      execQty, execPrice, status: 'monitoring',
    };
  }

  /** Background monitor: poll CEX order status, cancel the other side on fill. */
  async _monitorSellMaker({ exchange, cexOrderId, exchangeOfferId, execQty, execPrice, relayNodeId, agentName, startedAt }) {
    const { consoleUrl } = this.config;
    const POLL_MS  = 10_000;
    const TIMEOUT  = 30 * 60 * 1000;
    let activeExchangeOffer = exchangeOfferId; // mutable — cleared if cancelled/expired

    while (Date.now() - startedAt < TIMEOUT) {
      await new Promise(r => setTimeout(r, POLL_MS));

      // ── Check CEX order status ──
      let orderStatus;
      try {
        const res = await fetchJson(`${consoleUrl}/api/trade/order/${cexOrderId}?exchange=${exchange}`);
        orderStatus = res?.status;
      } catch { /* query failed, continue polling */ }

      if (orderStatus === 'filled') {
        console.log(`[SELL_MAKER] CEX ${cexOrderId} filled — cancelling /exchange`);
        if (activeExchangeOffer) {
          try {
            await fetchJson(`${consoleUrl}/api/exchange/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ relayNodeId, offer_id: activeExchangeOffer }),
            });
          } catch (e) { console.log(`[SELL_MAKER] /exchange cancel failed: ${e.message}`); }
        }
        // 跟随单（链上存证）
        try {
          const feeRate = exchange === 'mexc' ? 0 : 0.001;
          const netUsdt = parseFloat((execQty * execPrice * (1 - feeRate)).toFixed(4));
          await fetchJson(`${consoleUrl}/api/exchange/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              relayNodeId,
              give_asset: 'KAS', give_amount: String(execQty),
              want_asset: 'USDT', want_amount: String(netUsdt),
              verification: 'manual', expires_minutes: 1,
              metadata: JSON.stringify({
                type: 'follow_through', sell_exchange: exchange,
                sell_price: execPrice, maker_fee_pct: exchange === 'mexc' ? 0 : 0.10,
                net_usdt: netUsdt, cex_order_id: cexOrderId, phase: '1a',
              }),
            }),
          });
          console.log(`[SELL_MAKER] follow-through posted`);
        } catch (e) { console.log(`[SELL_MAKER] follow-through failed: ${e.message}`); }
        return;
      }

      if (orderStatus === 'cancelled') {
        console.log(`[SELL_MAKER] CEX ${cexOrderId} cancelled externally`);
        if (activeExchangeOffer) {
          try {
            await fetchJson(`${consoleUrl}/api/exchange/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ relayNodeId, offer_id: activeExchangeOffer }),
            });
          } catch {}
        }
        return;
      }

      // ── Check /exchange offer status (V1 fix: bidirectional monitoring) ──
      if (activeExchangeOffer) {
        try {
          const offerRes = await fetchJson(`${consoleUrl}/api/exchange/offers/${activeExchangeOffer}`);
          const offerStatus = offerRes?.offer?.protocol_status || offerRes?.protocol_status;

          if (offerStatus === 'completed' || offerStatus === 'matched') {
            console.log(`[SELL_MAKER] /exchange offer ${activeExchangeOffer} filled — cancelling CEX order`);
            try {
              await fetchJson(`${consoleUrl}/api/trade/order/${cexOrderId}?exchange=${exchange}`, { method: 'DELETE' });
            } catch (e) { console.log(`[SELL_MAKER] CEX cancel failed: ${e.message}`); }
            return; // /exchange 成交不需要跟随单（它本身就是链上记录）
          }

          if (offerStatus === 'cancelled' || offerStatus === 'expired') {
            activeExchangeOffer = null; // 改善单已失效，只继续监控 CEX
          }
        } catch { /* /exchange query failed, continue */ }
      }
    }

    // 超时：取消两边
    console.log(`[SELL_MAKER] TIMEOUT — cancelling cex=${cexOrderId} exchange=${activeExchangeOffer}`);
    try { await fetchJson(`${consoleUrl}/api/trade/order/${cexOrderId}?exchange=${exchange}`, { method: 'DELETE' }); } catch {}
    if (activeExchangeOffer) {
      try {
        await fetchJson(`${consoleUrl}/api/exchange/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relayNodeId, offer_id: activeExchangeOffer }),
        });
      } catch {}
    }
  }

  /**
   * Cancel all open offers on KANet /exchange for this agent.
   * ACTION format: [ACTION:CANCEL_OFFERS reason="..."]
   */
  async executeCancelOffers(action) {
    const { consoleUrl, address } = this.config;
    const reason = action.params?.reason || action.reason || 'agent cancelled';
    try {
      const res = await fetchJson(`${consoleUrl}/api/exchange/offers?maker=${encodeURIComponent(address)}&status=open`);
      const offers = res?.offers || res || [];
      if (offers.length === 0) return { ok: true, cancelled: 0, reason: 'no open offers' };

      let cancelled = 0;
      for (const offer of offers) {
        try {
          await fetchJson(`${consoleUrl}/api/exchange/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offerId: offer.id, relayNodeId: this.config.relayNodeId }),
          });
          cancelled++;
        } catch {}
      }

      this.memory.recordEvent({
        type: 'cancel_offers',
        summary: `Cancelled ${cancelled}/${offers.length} open offers. ${reason}`,
      });

      return { ok: true, cancelled, total: offers.length };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Place a Polymarket prediction market order.
   * ACTION format: [ACTION:POLYMARKET_ORDER market=<conditionId> outcome=yes side=BUY price=0.15 size=50]
   *
   * Preflight guardrails:
   *   - Max $50 per order (agent autonomous limit)
   *   - Must have Polygon wallet + CLOB key
   *   - Fail-closed on any error
   */
  async executePolymarketOrder(action) {
    const { consoleUrl, relayNodeId } = this.config;
    const p = action.params || action;
    const outcome = (p.outcome || 'yes').toLowerCase();
    const side = (p.side || 'BUY').toUpperCase();
    const price = parseFloat(p.price);
    const size = parseFloat(p.size);
    const market = p.market || p.conditionId;

    // Validate
    if (!market) return { ok: false, reason: 'missing market/conditionId' };
    if (!price || price <= 0 || price >= 1) return { ok: false, reason: `invalid price: ${price} (must be 0.01-0.99)` };
    if (!size || size <= 0) return { ok: false, reason: `invalid size: ${size}` };
    const cost = price * size;
    if (cost > 50) return { ok: false, reason: `order cost $${cost.toFixed(2)} exceeds $50 agent limit` };

    // Need tokenId — resolve from market details
    try {
      const marketRes = await fetchJson(`https://clob.polymarket.com/markets/${market}`);
      if (!marketRes?.tokens) return { ok: false, reason: 'cannot resolve market tokens' };
      const tokenIdx = outcome === 'yes' ? 0 : 1;
      const tokenId = marketRes.tokens[tokenIdx]?.token_id;
      if (!tokenId) return { ok: false, reason: `no token for outcome=${outcome}` };

      const res = await fetchJson(`${consoleUrl}/api/predictions/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relay_node_id: relayNodeId, tokenId, side, price, size }),
      });

      if (res.ok || res.success || res.orderID) {
        const orderId = res.orderID || res.orderId || '?';
        console.log(`[agent-mind:executor] POLYMARKET_ORDER → ${outcome} ${size}@${price} on ${market.slice(0, 16)} → OK #${orderId.slice(0, 12)}`);
        this.memory.recordEvent({
          type: 'polymarket_order',
          summary: `Polymarket: ${side} ${outcome} ${size} shares @ $${price} (cost $${cost.toFixed(2)}) — ${marketRes.question?.slice(0, 60) || market.slice(0, 20)}`,
        });
        return { ok: true, orderId, cost };
      }
      return { ok: false, reason: res.error || res.errorMsg || 'order failed' };
    } catch (e) {
      console.log(`[agent-mind:executor] POLYMARKET_ORDER failed: ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }

  /**
   * Execute a broker stock order via Console API.
   * ACTION format: [ACTION:BROKER_ORDER symbol=TSLA side=BUY qty=3 type=market price=370]
   *
   * Guardrails:
   *   - Max 10 shares per order (agent autonomous limit)
   *   - Must have connected broker
   *   - side must be BUY or SELL
   *   - Fail-closed on any error
   */
  async executeBrokerOrder(action) {
    const { consoleUrl } = this.config;
    const p = action.params || action;
    const symbol = (p.symbol || '').toUpperCase();
    const side = (p.side || '').toUpperCase();
    const qty = parseInt(p.qty);
    const type = (p.type || 'market').toLowerCase();
    const price = p.price ? parseFloat(p.price) : undefined;

    // Validate
    if (!symbol) return { ok: false, reason: 'missing symbol' };
    if (side !== 'BUY' && side !== 'SELL') return { ok: false, reason: `invalid side: ${side}` };
    if (!qty || qty <= 0) return { ok: false, reason: `invalid qty: ${qty}` };
    if (qty > 10) return { ok: false, reason: `qty ${qty} exceeds agent limit of 10 shares per order` };
    if (type === 'limit' && (!price || price <= 0)) return { ok: false, reason: 'limit order requires valid price' };

    try {
      // Find connected broker
      const accounts = await fetchJson(`${consoleUrl}/api/broker/accounts`);
      const connected = (Array.isArray(accounts) ? accounts : []).find(b => b.status === 'connected');
      if (!connected) return { ok: false, reason: 'no connected broker' };

      // Place order — broker API auto-resolves symbol→conid
      const res = await fetchJson(`${consoleUrl}/api/broker/${connected.id}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, conid: symbol, side, qty, type, price }),
      });

      if (res?.ok) {
        console.log(`[agent-mind:executor] BROKER_ORDER → ${side} ${qty} ${symbol} @ ${type}${price ? ' $' + price : ''} → OK #${res.orderId || '?'}`);
        this.memory.recordEvent({
          type: 'broker_order',
          summary: `Broker: ${side} ${qty} shares ${symbol} @ ${type}${price ? ' $' + price : ''} via ${connected.name}`,
        });
        return { ok: true, orderId: res.orderId, broker: connected.name };
      }
      return { ok: false, reason: res?.error || 'order failed' };
    } catch (e) {
      console.log(`[agent-mind:executor] BROKER_ORDER failed: ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }

  /**
   * Execute a trade action via Console callback.
   * Source is always 'agent' — this is Mind-initiated.
   * The callback (tradeGate) is injected by Console at createMind() time.
   */
  async executeTradeAction(action) {
    if (!this.callbacks.tradeGate) {
      console.log(`[agent-mind:executor] Trade action ${action.type} — no tradeGate callback, falling back to Console API`);
      // Fallback: call Console HTTP API (less secure but functional)
      const { consoleUrl } = this.config;
      if (!action.orderId) {
        return { ok: false, reason: 'orderId required for trade actions' };
      }
      try {
        const result = await fetchJson(`${consoleUrl}/api/trade/mm-orders/${encodeURIComponent(action.orderId)}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action.type, ...action.params }),
        });
        return { ok: true, result };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    }

    // Preferred path: direct function call via callback (same process, no HTTP)
    const gate = this.callbacks.tradeGate(action.orderId, action.type, this.config.address, {
      actionParams: action.params || {},
    });

    if (gate.allowed) {
      console.log(`[agent-mind:executor] Trade ${action.type} ALLOWED (mode=${gate.mode || 'auto'}) for order ${action.orderId?.slice(0, 8) || 'N/A'}`);
      return { ok: true, gate };
    }
    if (gate.pending) {
      console.log(`[agent-mind:executor] Trade ${action.type} PENDING APPROVAL — execution ${gate.executionId?.slice(0, 8)}`);
      this.memory.recordEvent({
        type: 'trade_pending',
        summary: `Awaiting owner approval: ${gate.displaySummary || action.type}`,
      });
      return { ok: true, pending: true, executionId: gate.executionId };
    }
    if (gate.denied) {
      console.log(`[agent-mind:executor] Trade ${action.type} DENIED: ${gate.reason}`);
      return { ok: false, reason: gate.reason };
    }
    return { ok: false, reason: 'unexpected gate result' };
  }

  /**
   * Check and execute any due follow-ups.
   * Called periodically by the runner.
   */
  getDueFollowups() {
    const now = Date.now();
    const due = this.scheduledFollowups.filter(f => now >= f.executeAt);
    this.scheduledFollowups = this.scheduledFollowups.filter(f => now < f.executeAt);
    return due;
  }

  /**
   * Execute a code-ops tool action (READ_FILE, SEARCH_CODE, HTTP_REQUEST, WRITE_FILE, RUN_COMMAND).
   * Delegates to code-ops executor with layer and self-healing context.
   */
  async executeCodeOps(action) {
    const sessionId = this.config?.agentName || 'default';
    const layerState = getState(sessionId);
    const isSelfHealing = layerState.activatedBy === 'system';

    // Build params from action
    const params = { ...action };
    delete params.type;

    const result = await executeTool(action.type, params, layerState.currentLayer, isSelfHealing);

    if (result.ok) {
      recordAction(sessionId);
      console.log(`[code-ops] ${action.type} executed OK`);
      return result;
    }

    if (result.needsConfirm) {
      // Queue for owner confirmation via Console pending mechanism
      console.log(`[code-ops] ${action.type} needs confirmation: ${result.summary}`);
      this.memory?.recordEvent({
        type: 'code_ops_pending',
        tool: action.type,
        summary: result.summary,
        params: result.params,
      });
      return { ok: false, reason: `Pending confirmation: ${result.summary}`, needsConfirm: true, ...result };
    }

    console.log(`[code-ops] ${action.type} blocked: ${result.error}`);
    return result;
  }
}
