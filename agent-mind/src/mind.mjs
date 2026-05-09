/**
 * Agent Mind — importable module
 *
 * Can be used two ways:
 *   1. Standalone: node src/index.mjs (proactive loop)
 *   2. Library: import { createMind } from './mind.mjs' (reactive calls from Console)
 *
 * This is the "soul" entry point — initializes kernels, skills, and provides
 * handleMessage() for reactive responses with full Mind context.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile, fetchJson } from './utils.mjs';
import { parseIntent, getFormatHint, getExecutor, checkPermission } from './intent-parser.mjs';
import { createConfirmToken } from './confirm-store.mjs';
import { getState, requestEscalation, confirmEscalation, checkDegradation, recordAction, recordNoToolCall, getAvailableTools } from './skills/code-ops/layer-engine.mjs';
import { detectIntent, checkSenderPermission } from './skills/code-ops/intent-detector.mjs';
import { buildDiagnosticPlan, executePlan, formatResultsForBrain } from './skills/code-ops/executor.mjs';
import { recommendBet } from './skills/bettor/kelly.mjs';

/**
 * Sanitize text before sending to AI providers.
 * Some providers (x.ai/Grok) parse JSON strictly and choke on lone \x, \u, \0 sequences
 * that appear in Kaspa addresses, Windows paths, or raw chain data.
 * Must run on EVERY context sent to Brain — context builder output changes each call.
 */
function sanitize(text) {
  if (!text || typeof text !== 'string') return text;
  // Clean lone escape sequences that strict JSON parsers (x.ai) choke on.
  // Adapter also sanitizes, but Mind sanitizes first as defense-in-depth.
  return text
    .replace(/\\x(?![0-9a-fA-F]{2})/g, '\\\\x')
    .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u')
    .replace(/\\0(?![0-7])/g, '\\\\0');
}
import { SelfKernel } from './kernels/self.mjs';
import { MemoryKernel } from './kernels/memory.mjs';
import { PerceptionKernel } from './kernels/perception.mjs';
import { IntentKernel } from './kernels/intent.mjs';
import { EvolutionKernel } from './kernels/evolution.mjs';
import { ContextBuilder } from './context-builder.mjs';
import { ActionExecutor } from './action-executor.mjs';
import { SkillRegistry } from './skills/registry.mjs';
import { verifyPayment } from './skills/cross-chain-verify.mjs';
import { mcpCall } from './skills/mcp-bridge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MINDS_DIR = path.join(PROJECT_ROOT, 'minds');

// ── Channel-based Episodes ──────────────────────────────────────────────
// Each sender address = one conversation channel. Natural isolation via
// blockchain address uniqueness. No keyword classification needed for routing.
//
// Channel: each peer (incl. owner:* surfaces) has its own. Owner-relation channels never expire.
// Channel 2+: on-chain address — Each peer gets their own channel.

const CHANNEL_TIMEOUTS = {
  owner:   Infinity,        // owner can always resume
  sibling: 30 * 60_000,    // 30 min
  peer:    10 * 60_000,    // 10 min
  stranger: 5 * 60_000,    // 5 min
};
const EPISODE_MAX_HISTORY = 20;

/**
 * Create a Mind instance for an agent.
 * Fetches config from Console API (DB-backed), falls back to static file.
 *
 * @param {string} agentName - 'martin' or 'kasia1'
 * @param {string} [relayNodeId] - optional, used to fetch config from Console API
 * @returns {{ handleMessage, config, kernels, skillRegistry }}
 */
export async function createMind(agentName, relayNodeId, callbacks = {}) {
  let config = null;

  // Try Console API first (DB-backed, always up to date)
  if (relayNodeId) {
    try {
      const consoleUrl = process.env.CONSOLE_URL || 'http://localhost:3100';
      config = await fetchJson(`${consoleUrl}/api/relay/${relayNodeId}/mind-config`);
      if (config) console.log(`[mind] ${agentName} config loaded from Console DB`);
    } catch (err) {
      console.log(`[mind] ${agentName} Console config fetch failed, falling back to file: ${err.message}`);
    }
  }

  // Fallback to static file
  if (!config) {
    const configPath = path.join(MINDS_DIR, agentName.toLowerCase(), 'config.json');
    config = await readJsonFile(configPath);
    if (config) console.log(`[mind] ${agentName} config loaded from static file`);
  }

  if (!config) throw new Error(`Mind config not found for ${agentName}`);

  // Make adapterUrl dynamic — re-reads from Console DB on each access
  // so UI adapter switches take effect without restarting Mind
  if (relayNodeId) {
    const consoleUrl = process.env.CONSOLE_URL || 'http://localhost:3100';
    const _configUrl = `${consoleUrl}/api/relay/${relayNodeId}/mind-config`;
    let _cachedAdapterUrl = config.adapterUrl;
    let _cacheTs = Date.now();
    const ADAPTER_CACHE_TTL = 30_000; // 30s
    Object.defineProperty(config, 'adapterUrl', {
      get() {
        // Return cached value synchronously, refresh in background if stale
        if (Date.now() - _cacheTs > ADAPTER_CACHE_TTL) {
          fetch(_configUrl, { signal: AbortSignal.timeout(3000) })
            .then(r => r.json())
            .then(c => { if (c?.adapterUrl) { _cachedAdapterUrl = c.adapterUrl; _cacheTs = Date.now(); } })
            .catch(() => {});
        }
        return _cachedAdapterUrl;
      },
      set(v) { _cachedAdapterUrl = v; _cacheTs = Date.now(); },
      enumerable: true,
    });
  }

  // Initialize kernels
  const kernels = {
    self: new SelfKernel(config),
    memory: new MemoryKernel(config, MINDS_DIR),
    perception: new PerceptionKernel(config),
    intent: new IntentKernel(config, MINDS_DIR),
    evolution: new EvolutionKernel(config, MINDS_DIR),
  };

  await Promise.all([
    kernels.memory.init(),
    kernels.intent.init(),
    kernels.evolution.init(),
  ]);

  // Discover and load skills (scoped to this agent's account)
  const skillRegistry = new SkillRegistry(config.consoleUrl, config.relayNodeId);
  await skillRegistry.autoDiscover();


  const contextBuilder = new ContextBuilder(kernels, skillRegistry, config);
  const actionExecutor = new ActionExecutor(config, kernels.memory, callbacks);

  // ── Channel-based Episode management (per-mind instance) ──
  const _channels = new Map();  // channelKey → { history, relation, createdAt, lastActiveAt }

  /**
   * Derive channel key from sender identity.
   * Each peer gets its own channel — including each owner:* surface
   * (owner:predictions / owner:debug / owner:chat / owner:portfolio …).
   * Owner-relation channels never expire (handled in _getOrCreateChannel via ch.relation).
   *
   * Bug history: previously all owner:* peers collapsed to a single 'console_owner'
   * channel, causing different UI surfaces' conversation history to bleed into each
   * other. Sophie answered "嗨 Sophie" with a continuation of an earlier BTC
   * prediction analysis from a different surface. Per-peer channels fix it.
   */
  function _channelKey(sender, senderMeta) {
    return sender || 'unknown';
  }

  function _channelTimeout(relation) {
    if (relation === 'owner') return CHANNEL_TIMEOUTS.owner;
    if (relation === 'sibling') return CHANNEL_TIMEOUTS.sibling;
    return CHANNEL_TIMEOUTS[relation] || CHANNEL_TIMEOUTS.stranger;
  }

  function _getOrCreateChannel(channelKey, relation) {
    const now = Date.now();

    // Clean expired channels (skip owner-relation channels — never expire)
    for (const [key, ch] of _channels) {
      if (ch.relation === 'owner') continue;
      const timeout = _channelTimeout(ch.relation);
      if (timeout !== Infinity && now - ch.lastActiveAt > timeout) {
        console.log(`[channel] ${config.name}: expired "${key.slice(-12)}" (${ch.history.length} turns, ${Math.round((now - ch.createdAt) / 60000)}min)`);
        _channels.delete(key);
      }
    }

    let ch = _channels.get(channelKey);
    if (!ch) {
      ch = { relation, history: [], createdAt: now, lastActiveAt: now };
      _channels.set(channelKey, ch);
      const label = relation === 'owner'
        ? `owner:${channelKey.split(':')[1] || 'main'} (never expires)`
        : `${channelKey.slice(-12)} (${relation}, ${Math.round(_channelTimeout(relation) / 60000)}min)`;
      console.log(`[channel] ${config.name}: opened ${label}`);
    }
    ch.lastActiveAt = now;
    return ch;
  }

  function _recordTurn(channel, role, text) {
    channel.history.push({ role, text: (text || '').slice(0, 500), ts: Date.now() });
    if (channel.history.length > EPISODE_MAX_HISTORY) {
      channel.history = channel.history.slice(-EPISODE_MAX_HISTORY);
    }
  }

  console.log(`[mind] ${config.name} initialized: ${skillRegistry.list().length} skills`);

  /**
   * Handle an incoming message through the full Mind pipeline.
   * Returns the AI's reply text (or null if silent).
   *
   * @param {object} params
   * @param {string} params.sender - sender address
   * @param {string} params.message - message content
   * @param {string} [params.channel] - broadcast channel name (if broadcast)
   * @param {object} [params.senderMeta] - system-verified sender identity from Gate 1
   * @returns {Promise<string|null>} reply text
   */
  async function handleMessage({ sender, message, channel, senderMeta }) {
    const startTime = Date.now();

    // ── Guard: silently absorb query_card JSON from siblings ──
    // Prevents ping-pong: Agent A sends query_card → Agent B parses keywords → responds → infinite loop
    if (message && /^\s*\{/.test(message) && message.includes('"query_card"') && senderMeta?.relation === 'sibling') {
      console.log(`[mind] ${config.name} absorbed query_card from sibling ${senderMeta.displayName || sender.slice(-8)}, no reply`);
      return null;
    }

    // ── Conversational Ops: check for deterministic intent ──
    const parsed = parseIntent(message);

    // ── Channel: route by sender address (blockchain-native isolation) ──
    const chKey = _channelKey(sender, senderMeta);
    const relation = senderMeta?.relation || 'stranger';
    const ch = _getOrCreateChannel(chKey, relation);
    _recordTurn(ch, 'user', message);

    // Owner channel with active conversation history → skip conv-ops shortcuts.
    // Per-peer channels: any owner-relation channel with > 2 turns counts as
    // "in the middle of a chat", so a keyword like "buy" doesn't get hijacked
    // by Conversational Ops mid-conversation.
    const ownerHasHistory = (relation === 'owner' && ch.history.length > 2);

    // Sibling agents: skip conv-ops entirely — prevents query_card ping-pong loops.
    // Siblings sending "query_system" / "query_balance" etc. should get a normal Brain reply, not structured query_card.
    const isSibling = senderMeta?.relation === 'sibling';

    if (parsed.intent && parsed.config && !ownerHasHistory && !isSibling) {
      // Permission check
      const senderRelation = senderMeta?.relation || 'stranger';
      const perm = checkPermission(senderRelation, parsed.config.category);
      if (perm === 'deny' || perm === 'silent_deny') {
        console.log(`[mind] ${config.name} intent ${parsed.intent} blocked: ${senderRelation} → ${perm}`);
        // Fall through to normal Brain (silent deny = no error, just ignore intent)
      } else {
        const intentLabel = parsed.config.label;
        const dims = parsed.config.dimensions;
        console.log(`[mind] ${config.name} intent matched: ${parsed.intent} (${intentLabel}) params=${JSON.stringify(parsed.params)}`);

        try {
          // Trigger intents: execute internal Mind function
          if (parsed.config.category === 'trigger') {
            if (parsed.intent === 'trigger_reflect') {
              console.log(`[mind] ${config.name} trigger_reflect requested`);
              runReflection().catch(err =>
                console.log(`[mind] ${config.name} reflection failed: ${err.message}`)
              );
              const reflectReply = `好的，我开始反思最近的行为和决策。结果会更新到我的进化记录里。`;
              _recordTurn(ch, 'agent', reflectReply);
              return reflectReply;
            }
          }

          // Execute intents: only generate confirm card if all required params present
          // If params incomplete → fall through to Brain (Brain will ask user to complete)
          if (parsed.config.category === 'execute') {
            const requiredParams = (parsed.config.params || []).filter(p => p.name !== 'fixId'); // fixId is optional
            const hasAllParams = requiredParams.length === 0 || requiredParams.every(p => parsed.params[p.name]);
            if (hasAllParams) {
              const token = createConfirmToken(
                parsed.intent, parsed.params, parsed.config, config.relayNodeId
              );
              const confirmCard = JSON.stringify({
                type: 'confirm',
                token,
                intent: parsed.intent,
                label: intentLabel,
                params: parsed.params,
                expiresIn: 30,
              });
              console.log(`[mind] ${config.name} execute intent → confirm card: ${parsed.intent}`);
              _recordTurn(ch, 'agent', `[confirm:${parsed.intent}]`);
              return confirmCard;
            }
            // Params incomplete → fall through to Brain with intent hint
            console.log(`[mind] ${config.name} execute intent ${parsed.intent} — incomplete params, falling through to Brain`);
          }

          // Query + Reputation intents: fetch data → Brain summarize
          const executor = getExecutor(parsed.config._skillId);
          if (!executor?.executeQuery) throw new Error(`No executor for skill: ${parsed.config._skillId}`);
          const queryData = await executor.executeQuery(parsed.intent, parsed.params, config);
          const formatHint = getFormatHint(dims);
          const task = await contextBuilder.buildQueryTask(intentLabel, queryData, formatHint, message);

          const brainResponse = await fetchJson(`${config.adapterUrl}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              peer: sender,
              mindSystem: sanitize(task.system),
              mindUser: sanitize(task.user),
              mindTask: true,
            }),
            brainCall: true,
          });

          let reply = brainResponse?.reply || '';
          reply = reply.replace(/\[ACTION:[^\]]*\]/g, '').trim();

          if (reply) {
            kernels.memory.recordEvent({
              type: 'query_reply',
              from: sender,
              to: config.address,
              summary: `Query [${parsed.intent}]: "${reply.slice(0, 80)}"`,
            });
            kernels.memory.save().catch(() => {});
            const elapsed = Date.now() - startTime;
            console.log(`[mind] ${config.name} query replied in ${elapsed}ms: "${reply.slice(0, 80)}"`);
            // Wrap multi-dimension replies with data card metadata
            if (dims === 'multi') {
              const cardReply = JSON.stringify({
                type: 'query_card',
                intent: parsed.intent,
                label: intentLabel,
                data: queryData,
                summary: reply,
              });
              _recordTurn(ch, 'agent', reply);
              return cardReply;
            }
            _recordTurn(ch, 'agent', reply);
            return reply;
          }
        } catch (err) {
          console.log(`[mind] ${config.name} query intent failed: ${err.message}, falling through to Brain`);
        }
      }
    }

    // Refresh perception
    await kernels.perception.refresh();

    // ── code-ops: layer engine check ──
    const sessionId = config.name?.toLowerCase() || 'default';
    const layerState = getState(sessionId);
    const senderPerm = checkSenderPermission(relation, 'L4');
    const intentResult = detectIntent(message, layerState.currentLayer, layerState._pendingConfirm, sender);
    let codeOpsResultContext = '';  // diagnostic results for Brain (not tool syntax)
    console.log(`[mind] ${config.name} code-ops: layer=${layerState.currentLayer} intent=${intentResult.category}→${intentResult.targetLayer} sender=${relation} perm=${senderPerm.allowed}`);

    // Handle pending confirmation response (non-owner L3/L4 confirmation flow)
    if (intentResult.isConfirmation && layerState._pendingConfirm) {
      const pending = layerState._pendingConfirm;
      const originalMsg = layerState._pendingOriginalMessage || message;
      confirmEscalation(sessionId, pending, relation === 'owner' ? 'owner' : 'system');
      layerState._pendingConfirm = null;
      layerState._pendingOriginalMessage = null;
      console.log(`[mind] ${config.name} layer escalated to ${pending} (confirmed)`);

      // Mind executes diagnostic plan using the ORIGINAL request (not "yes")
      const plan = buildDiagnosticPlan(layerState._pendingCategory || 'observe', originalMsg, pending);
      if (plan.length > 0) {
        console.log(`[mind] ${config.name} executing ${plan.length}-step diagnostic plan`);
        const results = await executePlan(plan, pending, getState(sessionId).activatedBy === 'system');
        codeOpsResultContext = formatResultsForBrain(results, originalMsg);
        results.forEach(() => recordAction(sessionId));
      }
    } else if (intentResult.targetLayer && intentResult.targetLayer !== 'L1' && intentResult.category !== 'deny') {
      // Escalation needed
      const activatedBy = relation === 'owner' ? 'owner' : relation;
      const esc = requestEscalation(sessionId, intentResult.targetLayer, activatedBy);

      if (esc.needsConfirm && senderPerm.allowed) {
        // Non-owner: store pending + original message, ask for confirmation
        layerState._pendingConfirm = esc.pendingLayer;
        layerState._pendingOriginalMessage = message;
        layerState._pendingCategory = intentResult.category;
        const confirmReply = esc.confirmPrompt;
        _recordTurn(ch, 'agent', confirmReply);
        console.log(`[mind] ${config.name} requesting layer escalation to ${esc.pendingLayer}`);
        return confirmReply;
      }

      if (esc.allowed) {
        // Owner auto-escalated (L3) — Mind executes diagnostic plan immediately
        const plan = buildDiagnosticPlan(intentResult.category, message, esc.newLayer);
        if (plan.length > 0) {
          console.log(`[mind] ${config.name} L3 auto-escalated, executing ${plan.length}-step diagnostic plan`);
          const results = await executePlan(plan, esc.newLayer, getState(sessionId).activatedBy === 'system');
          codeOpsResultContext = formatResultsForBrain(results, message);
          results.forEach(() => recordAction(sessionId));
        }
      }
    }

    // Check degradation
    const degradation = checkDegradation(sessionId);
    if (degradation.degraded) {
      console.log(`[mind] ${config.name} layer degraded: ${degradation.from} → L1 (${degradation.reason})`);
    }

    // Build reactive task with layered context (system + user)
    const input = {
      message: channel ? `[broadcast #${channel}] ${message}` : message,
      sender,
      channel: channel || 'dm',
      senderMeta: senderMeta || null,  // Gate 2: pass system-verified identity
      codeOpsResultContext,  // Diagnostic results from Mind-executed tools (not tool syntax)
    };
    const task = await contextBuilder.buildReactiveTask(input, sender, {
      episodeHistory: ch.history.slice(0, -1), // exclude current message (already in input)
      // Use peer suffix as topic label so different owner surfaces show distinctly
      // (e.g. "predictions" / "debug" / "chat") instead of collapsing to "owner".
      episodeIntent: senderMeta?.relation === 'owner'
        ? (sender?.split(':')[1] || 'general')
        : sender?.slice(-12),
    });

    // Call Brain via Adapter — send system and user as separate layers
    const sysLen = task.system?.length || 0;
    const usrLen = task.user?.length || 0;
    console.log(`[mind] ${config.name} reactive: sender=${sender?.slice(-8)} msg="${message.slice(0, 60)}" system=${sysLen}c${task.meta?.systemCacheHit ? '(cached)' : ''} user=${usrLen}c skills=[${(task.skills || []).map(s => s.name).join(',')}]`);

    let brainResponse;
    try {
      brainResponse = await fetchJson(`${config.adapterUrl}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peer: sender,
          mindSystem: sanitize(task.system),  // system role (cached by provider)
          mindUser: sanitize(task.user),      // user role (per-message)
          mindTask: true,
        }),
        brainCall: true,
      });
    } catch (err) {
      console.log(`[mind] ${config.name} brain call failed: ${err.message}`);
      return null;
    }

    let rawReply = brainResponse?.reply || '';

    // ── Action Loop: Brain can request actions, Mind executes and feeds back ──
    // SECURITY: Trade actions only execute if triggered by owner or proactive cycle.
    // External messages (stranger/normal) cannot trigger trade actions.
    const MAX_ACTION_ROUNDS = 10;
    const actionLog = [];
    const senderRelation = senderMeta?.relation || 'stranger';
    const TRADE_ACTIONS = new Set(['PLACE_ORDER', 'CANCEL_ORDER', 'CANCEL_ALL_ORDERS', 'CREATE_MM_ORDER', 'UPDATE_MM_ORDER', 'SEND_KAS', 'SEND_BROADCAST']);
    const canTrade = senderRelation === 'owner' || sender === config.address || sender?.startsWith('owner:');

    for (let round = 0; round < MAX_ACTION_ROUNDS; round++) {
      const actions = parseActions(rawReply);
      if (actions.length === 0) break; // No actions — Brain is done, has final text

      console.log(`[mind] ${config.name} action round ${round + 1}: ${actions.length} actions`);

      // Execute each action (with permission check for trade actions)
      const actionResults = [];
      for (const action of actions) {
        // Gate: trade/financial actions require owner permission
        if (TRADE_ACTIONS.has(action.type) && !canTrade) {
          console.log(`[mind] ${config.name} BLOCKED trade action ${action.type} from ${senderRelation} (${sender?.slice(-8)})`);
          actionResults.push({ action: action.type, params: action.params, result: { error: `Permission denied: ${action.type} requires owner authority, sender is ${senderRelation}` } });
          actionLog.push({ round: round + 1, blocked: true, ...actionResults[actionResults.length - 1] });
          continue;
        }
        let result;
        console.log(`[mind] ${config.name} executing: ${action.type} ${JSON.stringify(action.params).slice(0, 80)}`);
        result = await executeTradeAction(action, config);
        actionResults.push({ action: action.type, params: action.params, result });
        actionLog.push({ round: round + 1, ...actionResults[actionResults.length - 1] });
      }

      // Feed results back to Brain for next decision
      const feedbackMsg = actionResults.map(r =>
        `[ACTION_RESULT:${r.action}] ${JSON.stringify(r.result)}`
      ).join('\n');

      const userFollowup = `${task.user}\n\n--- ACTION RESULTS (round ${round + 1}) ---\n${feedbackMsg}\n\nBased on these results, decide your next action or give your final response to the owner. You may issue more actions or respond with text.`;

      try {
        brainResponse = await fetchJson(`${config.adapterUrl}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            peer: sender,
            mindSystem: sanitize(task.system),
            mindUser: sanitize(userFollowup),
            mindTask: true,
          }),
          brainCall: true,
        });
        rawReply = brainResponse?.reply || '';
      } catch (err) {
        console.log(`[mind] ${config.name} action loop brain call failed: ${err.message}`);
        break;
      }
    }

    if (actionLog.length > 0) {
      console.log(`[mind] ${config.name} completed ${actionLog.length} actions across ${new Set(actionLog.map(a => a.round)).size} rounds`);
    }

    // Extract plain text reply (strip any remaining action tags)
    let replyText = rawReply.replace(/\[ACTION:[^\]]*\]/g, '').trim();
    if (replyText.startsWith('{') || replyText.startsWith('```')) {
      try {
        const cleaned = replyText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        replyText = parsed.reply || parsed.text || parsed.message || replyText;
      } catch {}
    }

    // Handle silence — explicit [SILENT] or empty reply
    if (!replyText.trim() || replyText.trim() === '[SILENT]') {
      // If tools were executed but no final text, ask Brain for summary with results
      if (actionLog.length > 0) {
        const resultSummary = actionLog.map(a =>
          `[${a.action}] ${JSON.stringify(a.result || {}).slice(0, 500)}`
        ).join('\n');
        const summaryPrompt = `You executed ${actionLog.length} tool actions. Here are the results:\n\n${resultSummary.slice(0, 5000)}\n\nNow summarize your findings for the user in plain text. No ACTION tags.`;
        try {
          const summaryRes = await fetchJson(`${config.adapterUrl}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peer: sender, mindUser: summaryPrompt, mindSystem: sanitize(task.system), mindTask: true }),
            brainCall: true,
          });
          replyText = (summaryRes?.reply || '').replace(/\[ACTION:[^\]]*\]/g, '').trim();
          console.log(`[mind] ${config.name} tool summary: "${replyText.slice(0, 80)}"`);
        } catch {}
      }
      if (!replyText.trim()) {
        console.log(`[mind] ${config.name} chose to stay silent`);
        return null;
      }
    }

    // Record reply in episode
    _recordTurn(ch, 'agent', replyText);

    // Record in memory
    kernels.memory.recordEvent({
      type: 'reactive_reply',
      from: sender,
      to: config.address,
      summary: `Replied to ${sender?.slice(-8)}: "${replyText?.slice(0, 60)}"${actionLog.length ? ` (${actionLog.length} actions)` : ''}`,
    });

    // Post-conversation learning: extract insights from what they said
    extractConversationInsights(sender, message, replyText, kernels);

    // Save state (non-blocking)
    Promise.all([
      kernels.memory.save(),
      kernels.intent.save(),
    ]).catch(() => {});

    const elapsed = Date.now() - startTime;
    console.log(`[mind] ${config.name} replied in ${elapsed}ms: "${replyText?.slice(0, 80)}"`);

    return replyText?.trim() || null;
  }

  /**
   * Run a proactive cycle — Agent takes initiative.
   * Returns action JSON from Brain, or null.
   */
  async function runProactive(eventContext) {
    const startTime = Date.now();
    await kernels.perception.refresh();

    const task = await contextBuilder.buildProactiveTask(eventContext);
    console.log(`[mind] ${config.name} proactive: system=${task.system?.length || 0}c user=${task.user?.length || 0}c skills=[${(task.skills || []).map(s => s.name).join(',')}]`);

    try {
      const brainResponse = await fetchJson(`${config.adapterUrl}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peer: config.address,
          mindSystem: sanitize(task.system),
          mindUser: sanitize(task.user),
          mindTask: true,
        }),
        brainCall: true,
      });

      const rawReply = brainResponse?.reply || '';

      // ── Unified ACTION tag parsing (social + trade in same pipeline) ──
      const actions = parseActions(rawReply).slice(0, 3); // max 3 actions per proactive cycle

      if (actions.length > 0 && !(actions.length === 1 && actions[0].type === 'DO_NOTHING')) {
        // Proactive actions have no sender — set as agent with full authority
        actionExecutor.setSenderContext({
          relation: 'owner', authority: ['chat', 'suggest', 'manage_goals', 'manage_self', 'trade'],
        });

        // market_maker focus: hard-filter social actions — maker doesn't chat
        const SOCIAL_ACTIONS = new Set(['FOLLOW_UP', 'SEND_MESSAGE', 'INITIATE_HANDSHAKE', 'SEND_BROADCAST']);
        const isMaker = (config.focus || 'balanced') === 'market_maker';
        const filtered = actions.filter(a => {
          if (a.type === 'DO_NOTHING') return false;
          if (isMaker && SOCIAL_ACTIONS.has(a.type)) {
            console.log(`[mind] ${config.name} market_maker: blocked social action ${a.type}`);
            return false;
          }
          return true;
        });

        // Map ACTION tag types to executor-compatible format
        const mapped = filtered.map(a => ({
          type: a.type === 'FOLLOW_UP' ? 'follow_up'
            : a.type === 'SEND_MESSAGE' ? 'send_message'
            : a.type === 'INITIATE_HANDSHAKE' ? 'initiate_handshake'
            : a.type === 'SEND_BROADCAST' ? 'send_broadcast'
            : a.type, // PLACE_ORDER, CANCEL_ORDER, SEND_KAS pass through
          target: a.params.target || null,
          message: a.params.message || null,
          channel: a.params.channel || null,
          reason: a.params.reason || null,
          // Trade params pass through
          ...a.params,
        }));

        // ── Preflight: trade actions go through mode/limit/cooldown check ──
        const TRADE_PREFLIGHT = new Set(['PLACE_ORDER', 'SEND_KAS', 'publish_order', 'send_kas']);
        const preflighted = [];
        for (const action of mapped) {
          if (TRADE_PREFLIGHT.has(action.type)) {
            try {
              const pf = await fetchJson(`${config.consoleUrl}/api/trade/preflight`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  agentId: config.relayNodeId,
                  action: action.type,
                  amount: action.amount || action.qty || 0,
                  side: action.side || null,
                  market: action.market || 'exchange',
                }),
              });
              if (pf.denied) {
                console.log(`[mind] ${config.name} preflight DENIED: ${pf.reason} (${action.type} ${action.amount || ''})`);
                kernels.memory.recordEvent({
                  type: 'trade_blocked',
                  summary: `Proactive ${action.type} blocked: ${pf.reason}`,
                });
                continue; // skip this action
              }
              if (pf.pending) {
                console.log(`[mind] ${config.name} preflight PENDING approval: ${pf.executionId} (${action.type})`);
                kernels.memory.recordEvent({
                  type: 'trade_pending',
                  summary: `Awaiting approval: ${pf.summary || action.type}`,
                });
                continue; // don't execute, wait for human
              }
              // allowed → proceed
              console.log(`[mind] ${config.name} preflight ALLOWED: ${action.type} ${action.amount || ''}`);
            } catch (err) {
              console.log(`[mind] ${config.name} preflight failed (${err.message}), blocking trade for safety`);
              continue; // fail-closed: if preflight unreachable, don't trade
            }
          }
          preflighted.push(action);
        }

        const results = await actionExecutor.executeActions(preflighted);

        for (let i = 0; i < results.length; i++) {
          const actionResult = results[i];
          const actionOk = actionResult?.success;
          const actionType = mapped[i]?.type || 'unknown';
          console.log(`[mind] ${config.name} proactive action: ${actionType} → ${actionOk ? 'OK' : actionResult?.reason || 'failed'}`);

          // Goal execution feedback
          const matchedGoal = kernels.intent.findGoalForAction(actionType, mapped[i]?.target);
          if (matchedGoal) {
            if (actionOk) {
              kernels.intent.recordAttempt(matchedGoal.id, 'success');
            } else {
              const failReason = actionResult?.reason || actionResult?.error || 'unknown';
              const resultType = actionResult?.blocked ? 'blocked' : 'failed';
              kernels.intent.recordAttempt(matchedGoal.id, resultType, failReason);
            }
          }
        }

        const summary = mapped.map((a, i) => `${a.type}→${results[i]?.success ? 'OK' : 'FAIL'}`).join(', ');
        kernels.memory.recordEvent({
          type: 'proactive_action',
          summary: `${summary} | ${rawReply.replace(/\[ACTION:[^\]]*\]/g, '').trim().slice(0, 60)}`,
        });
      } else {
        // DO_NOTHING or no actions parsed
        const doNothing = actions.find(a => a.type === 'DO_NOTHING');
        const reason = doNothing?.params?.reason || rawReply.slice(0, 80);
        kernels.memory.recordEvent({
          type: 'proactive_cycle',
          summary: `do_nothing — ${reason}`.slice(0, 120),
        });

        // Fallback: try legacy JSON format for backward compat
        if (actions.length === 0) {
          try {
            const cleaned = rawReply.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const decision = JSON.parse(cleaned);
            if (decision.action && decision.action !== 'do_nothing') {
              actionExecutor.setSenderContext({
                relation: 'owner', authority: ['chat', 'suggest', 'manage_goals', 'manage_self', 'trade'],
              });
              const results = await actionExecutor.executeActions([{
                type: decision.action, target: decision.target,
                message: decision.message, reason: decision.reason,
              }]);
              const r = results[0];
              console.log(`[mind] ${config.name} proactive (legacy JSON): ${decision.action} → ${r?.success ? 'OK' : r?.reason || 'failed'}`);
              kernels.memory.recordEvent({
                type: 'proactive_action',
                summary: `${decision.action} → ${decision.target?.slice(-12) || 'none'}: ${decision.reason || ''}`.slice(0, 120),
              });
            }
          } catch {} // not valid JSON either — already recorded as do_nothing
        }
      }
      await Promise.all([
        kernels.memory.save(),
        kernels.intent.save(),
      ]).catch(() => {});

      const elapsed = Date.now() - startTime;
      console.log(`[mind] ${config.name} proactive done in ${elapsed}ms: "${rawReply?.slice(0, 80)}"`);
      return rawReply;
    } catch (err) {
      console.log(`[mind] ${config.name} proactive failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Run a reflection cycle — Agent reviews and evolves.
   * Returns reflection JSON from Brain, or null.
   */
  async function runReflection() {
    const startTime = Date.now();
    await kernels.perception.refresh();

    const task = await contextBuilder.buildReflectionTask();
    console.log(`[mind] ${config.name} reflect: system=${task.system?.length || 0}c user=${task.user?.length || 0}c`);

    try {
      const brainResponse = await fetchJson(`${config.adapterUrl}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peer: config.address,
          mindSystem: sanitize(task.system),
          mindUser: sanitize(task.user),
          mindTask: true,
        }),
        brainCall: true,
      });

      const rawReply = brainResponse?.reply || '';

      // Try to parse reflection as JSON and feed to Evolution Kernel
      try {
        const cleaned = rawReply.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const reflection = JSON.parse(cleaned);
        if (reflection.insight) {
          kernels.evolution.addReflection(reflection);
          await kernels.evolution.save();
          console.log(`[mind] ${config.name} evolved: "${reflection.insight?.slice(0, 60)}"`);
        }
        // Update goals if suggested
        if (reflection.suggestedGoals?.length) {
          for (const g of reflection.suggestedGoals) {
            kernels.intent.addGoal(g.text, g.priority || 5);
          }
          await kernels.intent.save();
        }
      } catch {
        // Not valid JSON — store as raw insight
        kernels.memory.recordEvent({
          type: 'reflection',
          summary: `Reflected: "${rawReply?.slice(0, 80)}"`,
        });
        await kernels.memory.save().catch(() => {});
      }

      // Always update lastReflectionTime — Brain responded, reflection attempted.
      // Prevents self-healing from re-triggering every 30 min when JSON parse fails.
      kernels.evolution.lastReflectionTime = Date.now();
      await kernels.evolution.save().catch(() => {});

      const elapsed = Date.now() - startTime;
      console.log(`[mind] ${config.name} reflection done in ${elapsed}ms`);
      return rawReply;
    } catch (err) {
      console.log(`[mind] ${config.name} reflection failed: ${err.message}`);
      return null;
    }
  }

  return { handleMessage, runProactive, runReflection, config, kernels, skillRegistry };
}

// ── Action Protocol: Brain → Mind → Console ─────────────────────────────────

const ACTION_RE = /\[ACTION:(\w+)\s+(.*?)\]/g;

/**
 * Parse action directives from Brain's response.
 * Format: [ACTION:type key=value key=value]
 */
function parseActions(text) {
  const actions = [];
  let match;
  while ((match = ACTION_RE.exec(text)) !== null) {
    const type = match[1];
    const rawParams = match[2];
    const params = {};
    // Parse key=value pairs
    for (const part of rawParams.match(/\w+=(?:"[^"]*"|\S+)/g) || []) {
      const [k, ...rest] = part.split('=');
      let v = rest.join('=');
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      params[k] = isNaN(v) || v === '' ? v : parseFloat(v);
    }
    actions.push({ type, params });
  }
  // Reset regex lastIndex for next call
  ACTION_RE.lastIndex = 0;
  return actions;
}

/**
 * Execute a trade action via Console API.
 */
async function executeTradeAction(action, config) {
  const consoleUrl = config.consoleUrl || 'http://localhost:3100';
  const { type, params } = action;

  try {
    switch (type) {
      case 'PLACE_ORDER': {
        const res = await fetchJson(`${consoleUrl}/api/trade/order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: params.symbol || 'KASUSDT',
            side: params.side,
            price: params.price,
            qty: params.qty,
            relayNodeId: config.relayNodeId, // Agent identity — for trade_log attribution
          }),
        });
        return res;
      }

      case 'CHECK_ORDER': {
        const res = await fetchJson(
          `${consoleUrl}/api/trade/order/${params.orderId}?symbol=${params.symbol || 'KASUSDT'}`
        );
        return res;
      }

      case 'CANCEL_ORDER': {
        const res = await fetchJson(
          `${consoleUrl}/api/trade/order/${params.orderId}?symbol=${params.symbol || 'KASUSDT'}`,
          { method: 'DELETE' }
        );
        return res;
      }

      case 'READ_ORDERBOOK': {
        const symbol = params.symbol || 'KASUSDT';
        const limit = params.limit || 20;
        const data = await fetchJson(`https://api.mexc.com/api/v3/depth?symbol=${symbol}&limit=${limit}`);
        const bids = (data.bids || []).slice(0, 10).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
        const asks = (data.asks || []).slice(0, 10).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
        return { bestBid: bids[0], bestAsk: asks[0], bids, asks };
      }

      case 'CHECK_OPEN_ORDERS': {
        const res = await fetchJson(
          `${consoleUrl}/api/trade/open-orders?symbol=${params.symbol || 'KASUSDT'}`
        );
        return { count: Array.isArray(res) ? res.length : 0, orders: res };
      }

      case 'CANCEL_ALL_ORDERS': {
        const res = await fetchJson(
          `${consoleUrl}/api/trade/open-orders?symbol=${params.symbol || 'KASUSDT'}`,
          { method: 'DELETE' }
        );
        return res;
      }

      case 'WAIT': {
        const ms = Math.min(params.ms || 3000, 10000); // max 10s
        await new Promise(r => setTimeout(r, ms));
        return { waited: ms };
      }

      // ── MM (Market Maker) Actions ───────────────────────────────────────

      case 'CREATE_MM_ORDER': {
        const res = await fetchJson(`${consoleUrl}/api/trade/mm-orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' },
          body: JSON.stringify({
            side: params.side,
            kasAmount: params.kasAmount,
            price: params.price,
            chain: params.chain,
            customerAddress: params.customerAddress,
            relayNodeId: config.relayNodeId,
          }),
        });
        console.log(`[mind] CREATE_MM_ORDER: side=${params.side} amount=${params.kasAmount} → ${res?.id || res?.error || 'unknown'}`);
        return res;
      }

      case 'UPDATE_MM_ORDER': {
        const updateBody = { status: params.status };
        if (params.payment_txhash) updateBody.payment_txhash = params.payment_txhash;
        if (params.kas_txhash) updateBody.kas_txhash = params.kas_txhash;
        if (params.customer_address) updateBody.customer_address = params.customer_address;
        if (params.customer_pay_address) updateBody.customer_pay_address = params.customer_pay_address;
        if (params.mm_receive_address) updateBody.mm_receive_address = params.mm_receive_address;

        const res = await fetchJson(`${consoleUrl}/api/trade/mm-orders/${params.orderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' },
          body: JSON.stringify(updateBody),
        });
        console.log(`[mind] UPDATE_MM_ORDER: ${params.orderId} → status=${params.status} ${res?.ok ? 'OK' : res?.error || ''}`);
        return res;
      }

      case 'VERIFY_PAYMENT': {
        const result = await verifyPayment({
          chain: params.chain,
          txHash: params.txHash,
          expectedAmount: params.expectedAmount,
          toAddress: params.toAddress,
        }, config);

        // Auto-update mm_orders on successful verification
        if (result.verified && params.orderId) {
          console.log(`[mind] VERIFY_PAYMENT success — updating mm_orders ${params.orderId} → verified`);
          try {
            await fetchJson(`${consoleUrl}/api/trade/mm-orders/${params.orderId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' },
              body: JSON.stringify({
                status: 'verified',
                payment_txhash: params.txHash,
              }),
            });
          } catch (err) {
            console.log(`[mind] VERIFY_PAYMENT mm_orders update failed: ${err.message}`);
            result.orderUpdateError = err.message;
          }
        }

        return result;
      }

      case 'SEND_KAS': {
        const relayId = config.relayNodeId;
        if (!relayId) return { error: 'No relayNodeId configured — cannot send KAS' };

        console.log(`[mind] SEND_KAS: to=${params.to} amount=${params.amount}`);
        const res = await fetchJson(`${consoleUrl}/api/relay/${relayId}/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: params.to,
            amount: params.amount,
          }),
        });

        // Auto-update mm_orders on successful send
        if (res?.ok && params.orderId) {
          console.log(`[mind] SEND_KAS success — updating mm_orders ${params.orderId} → completed`);
          try {
            await fetchJson(`${consoleUrl}/api/trade/mm-orders/${params.orderId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' },
              body: JSON.stringify({
                status: 'completed',
                kas_txhash: res.txId || '',
              }),
            });
          } catch (err) {
            console.log(`[mind] SEND_KAS mm_orders update failed: ${err.message}`);
            res.orderUpdateError = err.message;
          }
        }

        return res;
      }

      case 'SEND_BROADCAST': {
        const res = await fetchJson(`${consoleUrl}/api/chat/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: params.channel,
            message: params.message,
            relayNodeId: config.relayNodeId,
          }),
        });
        return res;
      }

      case 'MCP_CALL': {
        let args = params.args;
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        const result = await mcpCall(params.server, params.tool, args || {});
        return result;
      }

      // ── System Actions (白名单制) ──
      case 'SYSTEM_DOWNLOAD': {
        const res = await fetchJson(`${consoleUrl}/api/system/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionId: params.actionId }),
        });
        console.log(`[mind] SYSTEM_DOWNLOAD ${params.actionId}: ${res.ok ? 'OK ' + (res.size || '') + ' bytes' : res.error}`);
        return res;
      }

      case 'SYSTEM_RUN': {
        const res = await fetchJson(`${consoleUrl}/api/system/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: params.filePath }),
        });
        console.log(`[mind] SYSTEM_RUN: ${res.ok ? 'PID ' + res.pid : res.error}`);
        return res;
      }

      case 'SYSTEM_CHECK_PROCESS': {
        const res = await fetchJson(`${consoleUrl}/api/system/check-process?name=${encodeURIComponent(params.name || 'ibgateway')}`);
        console.log(`[mind] SYSTEM_CHECK_PROCESS ${params.name}: ${res.running ? 'RUNNING' : 'NOT RUNNING'}`);
        return res;
      }

      // ── code-ops tools ──
      case 'READ_FILE':
      case 'SEARCH_CODE':
      case 'HTTP_REQUEST':
      case 'WRITE_FILE':
      case 'RUN_COMMAND': {
        const { executeTool } = await import('./skills/code-ops/executor.mjs');
        const { getState, recordAction } = await import('./skills/code-ops/layer-engine.mjs');
        const sessionId = config.name?.toLowerCase() || 'default';
        const layerState = getState(sessionId);
        const isSelfHealing = layerState.activatedBy === 'system';
        const result = await executeTool(type, params || action, layerState.currentLayer, isSelfHealing);
        if (result.ok) recordAction(sessionId);
        return result.result || result;
      }

      // ── Bettor: deterministic Kelly + Bet Card ──
      case 'BET_PREDICT': {
        const inputs = {
          pMid: Number(params.pMid),
          sigma: Number(params.sigma) || 0,
          yesPrice: Number(params.yesPrice),
          bankroll: Number(params.bankroll) || 1000,
          infoGapMonths: Number(params.infoGapMonths) || 0,
          kellyFraction: Number(params.kellyFraction) || 0.25,
        };
        if (!Number.isFinite(inputs.pMid) || inputs.pMid < 0 || inputs.pMid > 1) {
          return { error: `BET_PREDICT: invalid pMid=${params.pMid}` };
        }
        if (!Number.isFinite(inputs.yesPrice) || inputs.yesPrice <= 0 || inputs.yesPrice >= 1) {
          return { error: `BET_PREDICT: invalid yesPrice=${params.yesPrice}` };
        }
        const rec = recommendBet(inputs);
        const market = (params.market || 'unnamed market').toString().slice(0, 80);
        const pct = (n) => `${(n * 100).toFixed(1)}%`;
        const usd = (n) => `$${n.toFixed(2)}`;
        const edge = rec.side === 'YES'
          ? Math.abs(inputs.pMid - inputs.yesPrice)
          : rec.side === 'NO'
            ? Math.abs((1 - inputs.pMid) - (1 - inputs.yesPrice))
            : 0;
        const betCard = [
          `Bet Card — ${market}`,
          `决策: ${rec.side === 'SKIP' ? 'SKIP' : `BUY ${rec.side}`}`,
          `edge: ${rec.side === 'SKIP' ? 'N/A' : pct(edge)}`,
          `仓位: ${pct(rec.fraction)} (${usd(rec.size)})`,
          `估值: pMid=${pct(inputs.pMid)}, σ=${pct(inputs.sigma)}, info gap=${inputs.infoGapMonths.toFixed(1)} 月`,
          `规则: 1/${(1 / inputs.kellyFraction).toFixed(0)} Kelly, edge<5pt skip, gap>1月折半, gap>3月跳过`,
          `推理: ${rec.reasoning.join(' | ')}`,
        ].join('\n');
        return {
          ok: true,
          decision: rec.side,
          fraction: rec.fraction,
          size: rec.size,
          edge,
          betCard,
          instruction: 'reply with betCard verbatim, no commentary',
        };
      }

      default:
        return { error: `Unknown action: ${type}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Post-conversation insight extraction (zero-cost, no AI call).
 * Analyzes both their message AND our reply to build meaningful relationship notes.
 *
 * v2: Extract what they WANT, what they KNOW, what they FEEL — not just topic tags.
 */
function extractConversationInsights(sender, message, replyText, kernels) {
  if (!sender || sender === 'owner' || sender.startsWith('owner:') || !message) return;

  const msg = message.toLowerCase();
  const parts = [];

  // 1. What are they interested in? (topic detection, more specific)
  if (/\b(buy|sell|long|short|pump|dump|bull|bear)\b/i.test(msg)) parts.push('active trader');
  else if (/\b(trade|trading|market|price)\b/i.test(msg)) parts.push('interested in markets');
  if (/\b(build|develop|code|github|dev|program|deploy|repo)\b/i.test(msg)) parts.push('developer');
  if (/\b(agent|kanet|kasia|autonomous|ai network)\b/i.test(msg)) parts.push('curious about KANet');
  if (/\b(otc|swap|liquidity|defi|bridge)\b/i.test(msg)) parts.push('into DeFi/OTC');
  if (/\b(mining|hashrate|miner|pool)\b/i.test(msg)) parts.push('miner');
  if (/\b(privacy|encrypt|secure|safe|trust)\b/i.test(msg)) parts.push('cares about privacy');

  // 2. What is their emotional state / attitude?
  if (/\b(thanks|thank you|great|awesome|nice|cool|perfect|love|appreciate)\b/i.test(msg)) parts.push('positive interaction');
  if (/\b(help|problem|issue|error|bug|fail|broken|stuck)\b/i.test(msg)) parts.push('needs help');
  if (/\b(who are you|what are you|are you ai|are you bot|are you real)\b/i.test(msg)) parts.push('questioning my nature');
  if (/\b(fuck|shit|scam|spam|stop|leave|go away)\b/i.test(msg)) parts.push('hostile — be careful');

  // 3. Did they ask a specific question? Capture it.
  if (/\?\s*$/.test(message.trim())) {
    // Extract the question (last sentence ending with ?)
    const questions = message.match(/[^.!?\n]*\?\s*$/);
    if (questions) {
      const q = questions[0].trim().slice(0, 60);
      parts.push(`asked: "${q}"`);
    }
  }

  // 4. Did they share personal info? (name, project, role)
  const nameMatch = message.match(/\b(?:I'm|I am|my name is|call me)\s+(\w+)/i);
  if (nameMatch) parts.push(`introduced as "${nameMatch[1]}"`);
  const projectMatch = message.match(/\b(?:working on|building|my project|I made)\s+(.{5,40})/i);
  if (projectMatch) parts.push(`working on: ${projectMatch[1].trim().slice(0, 40)}`);

  if (parts.length === 0) return;

  // Build a human-readable note (not just tags)
  const note = parts.join('; ');

  // Dedup: don't add if the last note for this peer is very similar
  const existing = kernels.memory.relationships[sender]?.notes || [];
  if (existing.length > 0) {
    const lastNote = existing[existing.length - 1].text;
    // Skip if >50% overlap with last note
    const lastWords = new Set(lastNote.toLowerCase().split(/\W+/));
    const newWords = note.toLowerCase().split(/\W+/);
    const overlap = newWords.filter(w => w.length > 3 && lastWords.has(w)).length;
    if (overlap > newWords.length * 0.5) return; // too similar, skip
  }

  kernels.memory.addRelationshipNote(sender, note);
}
