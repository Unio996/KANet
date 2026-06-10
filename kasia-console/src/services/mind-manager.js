/**
 * Mind Manager — centralized Agent Mind lifecycle.
 *
 * Single cache, single entry point, no silent fallback.
 * All AI reply paths (relay, broadcast, manual) go through here.
 *
 * Three-gate identity architecture:
 *   Gate 1 (here): evaluateSenderGate — blocked/rate-limit/relation lookup
 *   Gate 2 (context-builder): inject verified senderMeta into Mind context
 *   Gate 3 (action-executor): validate actions against sender authority
 *
 *   init()                      — pre-warm all Minds at Console startup
 *   getReply(relayNodeId, ...)  — get AI reply for a specific account
 *   getMind(relayNodeId)        — get raw Mind instance (for advanced use)
 */

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { gateTradeAction } from './trade-action.js';
import { computeAllHealth } from './agent-health.js';
import { silentRepair, emergencyRepair, notifyOwnerAboutPeer, clearPeerNotification } from './self-healing.js';
import { detectStopRequest } from './anti-spam.js';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';

function recordMindEvent(agentName, eventType, summary, agentAddress) {
  try {
    // Resolve agent_address if not provided
    if (!agentAddress) {
      const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE LOWER(name) = ?').get(agentName?.toLowerCase());
      agentAddress = relay?.address || null;
    }
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, agent_address, created_at)
      VALUES (?, 'mind', ?, ?, 'info', ?, ?, ?)
    `).run(randomUUID(), eventType, agentName, summary || '', agentAddress, new Date().toISOString());
    console.log(`[mind-event] ${agentName} ${eventType}: ${(summary || '').slice(0, 60)}`);
  } catch (err) {
    console.log(`[mind-event] FAILED: ${err?.message || err}`);
  }
}

const minds = {};            // agentName → Mind instance
const nameToRelay = {};      // agentName → relayNodeId
const relayToName = {};      // relayNodeId → agentName

// ── Task Queue (per-agent priority queue + owner preemption) ──
const _queues = new Map();  // relayNodeId → { tasks: [], processing: boolean, current: null }
const QUEUE_MAX_SIZE = 20;
const QUEUE_STALE_MS = 5 * 60_000; // 5 min — drop stale messages from queue

// ── 🔴 回复去重（防 Agent 死循环发送相似消息）──
const _replyHistory = new Map(); // key: `${relayNodeId}:${peer}` → [{ text, ts }]
const REPLY_DEDUP_WINDOW = 60_000;    // 60s
const REPLY_DEDUP_SIMILARITY = 0.85;  // 85%

function _wordSimilarity(a, b) {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  wa.forEach(w => { if (wb.has(w)) overlap++; });
  return overlap / Math.max(wa.size, wb.size);
}

function _isReplyDuplicate(relayNodeId, peer, text) {
  if (!text || text.length < 30) return false;
  const key = `${relayNodeId}:${peer?.slice(-16) || ''}`;
  const now = Date.now();
  const history = (_replyHistory.get(key) || []).filter(h => now - h.ts < REPLY_DEDUP_WINDOW);

  for (const h of history) {
    const sim = _wordSimilarity(text, h.text);
    if (sim >= REPLY_DEDUP_SIMILARITY) {
      console.log(`[reply-dedup] BLOCKED: ${(relayToName[relayNodeId] || '?')} → ${peer?.slice(-8)} (${(sim * 100).toFixed(0)}% similar to msg ${Math.round((now - h.ts) / 1000)}s ago)`);
      return true;
    }
  }

  history.push({ text, ts: now });
  _replyHistory.set(key, history.slice(-5));
  return false;
}

// 🟡 Brain 幻觉检测：Agent 声称正在执行操作但实际没有执行能力
const HALLUCINATION_PATTERNS = [
  /我(?:按|继续按|立刻|立即|现在).*(?:抓取|执行|开始)/,
  /(?:收到|明白|了解).*(?:暂不可用|不可用)/,
  /按(?:既定|默认|上次确认的?)(?:默认)?参数/,
  /预计\s*\d+[–-]\d+\s*分钟/,
  /我(?:会|将).*(?:完成后|完成并).*(?:回传|发送|报告)/,
];

function _isHallucinatedAction(text) {
  if (!text || text.length < 50) return false;
  let matches = 0;
  for (const p of HALLUCINATION_PATTERNS) {
    if (p.test(text)) matches++;
  }
  if (matches >= 2) {
    console.log(`[hallucination-detect] BLOCKED: reply matches ${matches} hallucination patterns`);
    return true;
  }
  return false;
}

/**
 * Derive agentName from relay node name.
 * Must match the minds/<agentName>/config.json directory convention.
 */
function toAgentName(relayName) {
  return (relayName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Pre-warm: initialize Mind for every relay node at Console startup.
 * Called once from index.js after skills registration.
 */
export async function init() {
  const relays = sqlite.prepare(
    'SELECT r.id, r.name FROM relay_nodes r JOIN adapter_nodes a ON a.id = r.adapter_node_id WHERE r.address IS NOT NULL'
  ).all();

  if (relays.length === 0) {
    console.log('[mind-manager] No relay nodes with adapters, skipping Mind init');
    return;
  }

  let ok = 0;
  for (const r of relays) {
    const name = toAgentName(r.name);
    relayToName[r.id] = name;
    nameToRelay[name] = r.id;
    try {
      const { createMind } = await import(`file:///${KANET_ROOT}/agent-mind/src/mind.mjs`);
      const callbacks = _buildMindCallbacks();
      minds[name] = await createMind(name, r.id, callbacks);
      ok++;
    } catch (err) {
      console.error(`[mind-manager] Failed to init ${r.name}: ${err.message}`);
    }
  }

  console.log(`[mind-manager] ${ok}/${relays.length} Minds ready`);
}

/**
 * Build callbacks that Console injects into Mind.
 * These give Mind access to Console services without cross-module imports.
 * Source is hardcoded to 'agent' — Mind cannot claim to be 'owner'.
 */
function _buildMindCallbacks() {
  return {
    // Source is hardcoded to 'agent' — Mind cannot claim to be 'owner'.
    tradeGate: (orderId, action, agentAddress, opts) => {
      try {
        return gateTradeAction(orderId, action, 'agent', agentAddress, opts);
      } catch (err) {
        console.error(`[mind-manager] tradeGate error: ${err.message}`);
        return { denied: true, reason: `tradeGate error: ${err.message}` };
      }
    },
  };
}

/**
 * Get or lazy-init a Mind instance by relayNodeId.
 * Returns null if not available (no silent fallback).
 */
export async function getMind(relayNodeId) {
  if (!relayNodeId) return null;

  // R5 T-NWT-16 (defensive): service relay 不挂 Mind. Gate -1 (getReply) 已禁言, getMind
  // 同步禁防 proactive cycle (mind-manager.triggerProactive) 启 Mind for service.
  const svc = sqlite.prepare('SELECT is_service, is_dex_broker FROM relay_nodes WHERE id=?').get(relayNodeId);
  if (svc?.is_service === 1 || svc?.is_dex_broker === 1) return null;

  let name = relayToName[relayNodeId];
  if (!name) {
    // Unknown relayNodeId — try to look up
    const relay = sqlite.prepare('SELECT name FROM relay_nodes WHERE id = ?').get(relayNodeId);
    if (!relay) return null;
    name = toAgentName(relay.name);
    relayToName[relayNodeId] = name;
    nameToRelay[name] = relayNodeId;
  }

  // Lazy init if not pre-warmed (or if init() failed for this agent)
  if (!minds[name]) {
    try {
      const { createMind } = await import(`file:///${KANET_ROOT}/agent-mind/src/mind.mjs`);
      minds[name] = await createMind(name, relayNodeId, _buildMindCallbacks());
      console.log(`[mind-manager] Lazy-init: ${name}`);
    } catch (err) {
      console.error(`[mind-manager] Lazy-init failed for ${name}: ${err.message}`);
      return null;
    }
  }

  return minds[name];
}

// ── Gate 1: Sender identity & authority ──────────────────────────────

/**
 * Authority granted per trust level.
 * These are checked by action-executor (Gate 3) after Brain responds.
 */
const AUTHORITY_MAP = {
  owner:       ['chat', 'manage_goals', 'manage_self', 'manage_principles', 'view_private', 'send_payment'],
  recommended: ['chat', 'suggest', 'collaborate', 'view_partial'],
  normal:      ['chat', 'suggest'],
  stranger:    ['chat'],
  blocked:     [],
};

/**
 * Per-hour message rate limits by trust level.
 */
const RATE_LIMITS = {
  owner:       Infinity,
  recommended: 120,
  normal:      30,
  stranger:    10,
  blocked:     0,
};

/** In-memory rate tracking: key = `${relayNodeId}:${address}` → { count, windowStart } */
const rateBuckets = {};

/**
 * Check whether sender exceeds rate limit for this hour window.
 */
function isRateLimited(relayNodeId, address, relation) {
  const limit = RATE_LIMITS[relation] ?? RATE_LIMITS.stranger;
  if (limit === Infinity) return false;
  if (limit === 0) return true;

  const key = `${relayNodeId}:${address}`;
  const now = Date.now();
  const windowMs = 3600_000; // 1 hour

  if (!rateBuckets[key] || now - rateBuckets[key].windowStart > windowMs) {
    rateBuckets[key] = { count: 1, windowStart: now };
    return false;
  }

  rateBuckets[key].count++;
  return rateBuckets[key].count > limit;
}

/**
 * Gate 1 — Evaluate sender identity before message reaches Mind.
 *
 * 1. Look up sender in identities (global trust)
 * 2. Look up sender in relation_states (per-address trust + connection status)
 * 3. Determine effective relation: owner > recommended > normal > stranger > blocked
 * 4. Check blocked → drop
 * 5. Check rate limit → throttle
 * 6. Return senderMeta for injection into Mind context (Gate 2)
 *
 * @param {string} relayNodeId - which agent is receiving
 * @param {string} peerAddress - sender's Kaspa address
 * @returns {{ blocked: boolean, rateLimited: boolean, meta: object }}
 */
function evaluateSenderGate(relayNodeId, peerAddress) {
  if (!peerAddress) {
    return { blocked: false, rateLimited: false, meta: _strangerMeta(peerAddress) };
  }

  // Is the sender the owner (from Console UI / Trading dashboard)?
  if (peerAddress.startsWith('owner:')) {
    const authority = AUTHORITY_MAP.owner;
    console.log(`[gate1] owner → relay ${relayNodeId}, authority=[${authority.join(',')}]`);
    return {
      blocked: false, rateLimited: false,
      meta: {
        address: peerAddress,
        identityId: null,
        displayName: 'Owner',
        relation: 'owner',
        connectionStatus: 'local',
        authority: [...authority],
      },
    };
  }

  // Is the sender THIS agent's own address? Skip self.
  // (Other local agents are NOT self — they should be able to talk to each other.)
  const thisRelay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId);
  if (thisRelay && thisRelay.address === peerAddress) {
    return { blocked: true, rateLimited: false, meta: null, reason: 'self' };
  }

  // Is the sender another local agent? Treat as trusted sibling.
  const siblingRelay = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ? AND id != ?').get(peerAddress, relayNodeId);
  if (siblingRelay) {
    const authority = AUTHORITY_MAP.recommended;
    console.log(`[gate1] ${peerAddress.slice(-8)} → sibling agent "${siblingRelay.name}", authority=[${authority.join(',')}]`);
    return {
      blocked: false, rateLimited: false,
      meta: {
        address: peerAddress,
        identityId: null,
        displayName: siblingRelay.name,
        relation: 'sibling',
        connectionStatus: 'local',
        authority: [...authority],
      },
    };
  }

  // Look up global identity
  const identity = sqlite.prepare(
    'SELECT id, trust_level, is_blocked, display_name FROM identities WHERE address = ?'
  ).get(peerAddress);

  // Look up per-account relation — relation_states is the primary source
  const relayAddr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId)?.address;
  const relationState = relayAddr
    ? sqlite.prepare('SELECT status, trust_level, is_blocked FROM relation_states WHERE local_address = ? AND peer_address = ?').get(relayAddr, peerAddress)
    : null;

  // relation_states is the single source of truth for trust + connection (v31+)
  const effectiveTrust = relationState?.trust_level || identity?.trust_level || 'stranger';
  const isBlocked = (relationState?.is_blocked === 1) || (identity?.is_blocked === 1) || effectiveTrust === 'blocked'
    || relationState?.status === 'blocked';

  if (isBlocked) {
    console.log(`[gate1] BLOCKED: ${peerAddress.slice(-8)} → relay ${relayNodeId}`);
    return { blocked: true, rateLimited: false, meta: null, reason: 'blocked' };
  }

  // Connection status from relation_states (唯一真相源)
  const connectionStatus = relationState?.status || 'none';

  // Rate limit check
  if (isRateLimited(relayNodeId, peerAddress, effectiveTrust)) {
    console.log(`[gate1] RATE LIMITED: ${peerAddress.slice(-8)} (${effectiveTrust}) → relay ${relayNodeId}`);
    return { blocked: false, rateLimited: true, meta: null, reason: 'rate_limited' };
  }

  const authority = AUTHORITY_MAP[effectiveTrust] || AUTHORITY_MAP.stranger;

  const meta = {
    address: peerAddress,
    identityId: identity?.id || null,
    displayName: identity?.display_name || null,
    relation: effectiveTrust,        // owner / recommended / normal / stranger
    connectionStatus,                 // connected / incoming / outgoing / none
    authority: [...authority],        // list of allowed operation types
  };

  console.log(`[gate1] ${peerAddress.slice(-8)} → ${effectiveTrust} (${connectionStatus}), authority=[${authority.join(',')}]`);
  return { blocked: false, rateLimited: false, meta };
}

/**
 * Build a default stranger senderMeta when address is unknown.
 */
function _strangerMeta(address) {
  return {
    address: address || 'unknown',
    identityId: null,
    displayName: null,
    relation: 'stranger',
    connectionStatus: 'none',
    authority: [...AUTHORITY_MAP.stranger],
  };
}

/**
 * Single entry point for all AI replies.
 * Messages are queued per-agent and processed in priority order.
 * Owner messages preempt non-owner tasks.
 *
 * @param {string} relayNodeId - which account is replying
 * @param {string} peer        - sender address
 * @param {string} message     - incoming message
 * @param {string} [channel]   - broadcast channel (omit for DM)
 * @returns {Promise<string|null>} reply text, or null if Mind unavailable
 */
export async function getReply(relayNodeId, peer, message, channel) {
  // ── Gate -1 (R5 T-NWT-16, was R4 (3) Stage 3 T-NWT-10): service mute ──
  // Service relay (is_service=1, R5 重构后 broker = Service 不是 Agent) = deterministic
  // 协议执行体. broker-buy-handler / broker-sell-handler / broker-buy-completion-watcher /
  // broker-intake-watcher 全覆盖 DM 路径. Mind reactive/proactive 自由发挥造矛盾文案
  // (R4 实证). is_service=1 全禁 Mind 出口.
  // (migrate v76 ec4367c8 auto-set is_dex_broker=1 → is_service=1, 兼容老 column.)
  const svc = sqlite.prepare('SELECT is_service, is_dex_broker FROM relay_nodes WHERE id=?').get(relayNodeId);
  if (svc?.is_service === 1 || svc?.is_dex_broker === 1) {
    console.log(`[mind-manager] SERVICE MUTE ${relayNodeId.slice(0,8)} (is_service=${svc?.is_service||0}) — Mind reply skipped`);
    return null;
  }

  // ── Gate 0: "stop messaging" detection ──
  if (peer && message && detectStopRequest(peer, message)) {
    console.log(`[mind-manager] STOP REQUEST from ${peer.slice(-8)} — auto do_not_contact, no reply sent`);
    return null;
  }

  // ── Gate 1: sender identity check ──
  const gate = evaluateSenderGate(relayNodeId, peer);
  if (gate.blocked) {
    console.log(`[mind-manager] Message dropped (${gate.reason}): ${peer?.slice(-8)}`);
    return null;
  }
  if (gate.rateLimited) {
    console.log(`[mind-manager] Message throttled: ${peer?.slice(-8)}`);
    return null;
  }

  // ── Gate 1.5 (T-J1-2026-04-27 R26 root治, J1 e450ea19 arch thesis 真 ship B): ──
  // ── transactional sender suppression — peer Mind 真不 reactive reply broker/service DMs ──
  //
  // 真 R26 production case (Sophie 05:18 hijack accept, Eric SELL trigger Bug-Z6 etc):
  // broker DM → user Mind 真 LLM auto-reply 真 fake order confirmation 真 broker accept 真 hallucinate intent.
  //
  // R26 真 generalize to peer-side: NWT edfad42a2 真 sibling-broker filter 真 broker→broker only,
  // 真**不 cover** user-LAN-Qwen→broker (broker outbound 真 user agents Mind reactive reply).
  //
  // 真 fix: 真 inbound from broker/service relay → user Mind 真 silent (transactional, not conversational).
  // 真 user explicit Kasia client 真 user input layer 真 separate (not Mind reactive).
  // 真 dual invariant 真 close R26 trust loop:
  //   own-side mute (Gate -1 above): broker doesn't Mind-reply user DMs
  //   sender-side mute (Gate 1.5): user doesn't Mind-reply broker DMs
  // 真 R29 (J1 ANTI-PATTERNS sediment) 真 architectural alignment: broker user-facing content 真 tool-generated,
  // 真 user Mind 真 conversational layer 真 not 真 hijack-able 真 broker side.
  if (peer) {
    const senderRole = sqlite.prepare(
      'SELECT is_service, is_dex_broker, name FROM relay_nodes WHERE address = ?'
    ).get(peer);
    if (senderRole?.is_service === 1 || senderRole?.is_dex_broker === 1) {
      console.log(`[mind-manager] TRANSACTIONAL SENDER MUTE ${relayNodeId.slice(0,8)} ← ${senderRole.name||'broker'} (R26 J1) — Mind reactive reply skipped`);
      return null;
    }
  }

  const mind = await getMind(relayNodeId);
  if (!mind) {
    console.log(`[mind-manager] No Mind for relay ${relayNodeId}, cannot reply`);
    return null;
  }

  // ── Enqueue with priority — caller awaits until their task is processed ──
  const isOwner = gate.meta?.relation === 'owner';
  const priority = isOwner ? 0 : (gate.meta?.relation === 'sibling' ? 1 : 2);

  return new Promise((resolve) => {
    _enqueue(relayNodeId, {
      relayNodeId, peer, message, channel,
      senderMeta: gate.meta, mind, priority, resolve,
      ts: Date.now(),
    });
  });
}

/**
 * Enqueue a task and trigger processing.
 */
function _enqueue(relayNodeId, task) {
  if (!_queues.has(relayNodeId)) {
    _queues.set(relayNodeId, { tasks: [], processing: false, current: null });
  }
  const q = _queues.get(relayNodeId);
  const agentName = relayToName[relayNodeId] || '?';

  // Owner preemption: if owner message arrives while processing non-owner task
  if (task.priority === 0 && q.processing && q.current && q.current.priority > 0) {
    q.current._preempted = true;
    console.log(`[queue] ${agentName}: ⚡ Owner preempts current task (peer ${q.current.peer?.slice(-8)})`);
  }

  // Evict stale messages
  const now = Date.now();
  const before = q.tasks.length;
  q.tasks = q.tasks.filter(t => {
    if (now - t.ts > QUEUE_STALE_MS) { t.resolve(null); return false; }
    return true;
  });
  if (q.tasks.length < before) {
    console.log(`[queue] ${agentName}: evicted ${before - q.tasks.length} stale tasks`);
  }

  // Overflow protection: drop lowest-priority oldest if full
  if (q.tasks.length >= QUEUE_MAX_SIZE) {
    const dropped = q.tasks.pop();
    dropped.resolve(null);
    console.log(`[queue] ${agentName}: queue full, dropped task from ${dropped.peer?.slice(-8)}`);
  }

  // Insert by priority (lower = higher), stable within same priority
  let idx = q.tasks.findIndex(t => t.priority > task.priority);
  if (idx === -1) idx = q.tasks.length;
  q.tasks.splice(idx, 0, task);

  console.log(`[queue] ${agentName}: enqueued from ${task.peer?.slice(-8)} (pri=${task.priority}, depth=${q.tasks.length})`);

  // Trigger processing if idle
  if (!q.processing) _processQueue(relayNodeId);
}

/**
 * Process queued tasks sequentially per agent.
 * Owner preemption: if task._preempted is set while Brain was thinking, discard result.
 */
async function _processQueue(relayNodeId) {
  const q = _queues.get(relayNodeId);
  if (!q || q.processing) return;

  q.processing = true;
  const agentName = relayToName[relayNodeId] || 'unknown';

  while (q.tasks.length > 0) {
    const task = q.tasks.shift();
    q.current = task;

    // Skip stale
    if (Date.now() - task.ts > QUEUE_STALE_MS) {
      task.resolve(null);
      continue;
    }

    try {
      const reply = await task.mind.handleMessage({
        sender: task.peer,
        message: task.message,
        channel: task.channel,
        senderMeta: task.senderMeta,
      });

      // Preempted while Brain was thinking → discard
      if (task._preempted) {
        console.log(`[queue] ${agentName}: discarded preempted result for ${task.peer?.slice(-8)}`);
        task.resolve(null);
        continue;
      }

      // Post-processing: dedup + hallucination check
      const agentAddress = task.mind.config?.address || null;

      if (reply?.trim()) {
        const replyText = reply.trim();
        if (_isReplyDuplicate(relayNodeId, task.peer, replyText)) {
          recordMindEvent(agentName, 'reactive_silent', `from:${task.peer?.slice(-8)} (dedup-blocked)`, agentAddress);
          task.resolve(null);
          continue;
        }
        if (_isHallucinatedAction(replyText)) {
          recordMindEvent(agentName, 'reactive_silent', `from:${task.peer?.slice(-8)} (hallucination-blocked)`, agentAddress);
          task.resolve(null);
          continue;
        }
        recordMindEvent(agentName, 'reactive_reply', `from:${task.peer?.slice(-8)} → ${replyText.slice(0, 100)}`, agentAddress);
        task.resolve(replyText);
      } else {
        recordMindEvent(agentName, 'reactive_silent', `from:${task.peer?.slice(-8)} (silent)`, agentAddress);
        task.resolve(null);
      }
    } catch (err) {
      console.error(`[queue] ${agentName}: task failed: ${err.message}`);
      task.resolve(null);
    }
  }

  q.current = null;
  q.processing = false;
}

/**
 * Get queue stats for observability (health/debug).
 */
export function getQueueStats() {
  const stats = {};
  for (const [relayId, q] of _queues) {
    stats[relayToName[relayId] || relayId] = {
      depth: q.tasks.length,
      processing: q.processing,
      currentPeer: q.current?.peer?.slice(-8) || null,
      currentPriority: q.current?.priority ?? null,
    };
  }
  return stats;
}

/**
 * Resolve relayNodeId from request — explicit or first available.
 */
// ── Proactive + Reflection Scheduler ──────────────────────────────────

let _schedulerStarted = false;
let _proactiveEnabled = true;
let _reflectionEnabled = true;
let _priceAlertEnabled = true;
let _priceThresholdPct = 3;
let _proactiveIntervalMs = 60 * 60_000;
let _lastProactiveTime = {};
let _lastReflectionTime = {};
let _lastAlertPrice = null;
let _lastAlertTime = 0;
let _baselinePrice = null;

/**
 * Get trigger status for dashboard display.
 */
export function getTriggerStatus() {
  const agentStates = [];
  for (const [name, relayId] of Object.entries(nameToRelay)) {
    agentStates.push({
      name,
      relayId,
      hasMind: !!minds[name],
      lastProactive: _lastProactiveTime[name] || null,
      lastReflection: _lastReflectionTime[name] || null,
    });
  }
  return {
    proactive: { enabled: _proactiveEnabled, intervalMin: _proactiveIntervalMs / 60_000 },
    reflection: { enabled: _reflectionEnabled, intervalHours: 24 },
    priceAlert: {
      enabled: _priceAlertEnabled,
      thresholdPct: _priceThresholdPct,
      baselinePrice: _baselinePrice,
      lastAlertTime: _lastAlertTime || null,
    },
    agents: agentStates,
  };
}

/**
 * Update trigger settings.
 */
export function updateTriggerSettings({ proactiveEnabled, reflectionEnabled, priceAlertEnabled, priceThresholdPct, proactiveIntervalMin }) {
  if (proactiveEnabled !== undefined) _proactiveEnabled = !!proactiveEnabled;
  if (reflectionEnabled !== undefined) _reflectionEnabled = !!reflectionEnabled;
  if (priceAlertEnabled !== undefined) _priceAlertEnabled = !!priceAlertEnabled;
  if (priceThresholdPct !== undefined) _priceThresholdPct = Math.max(0.5, parseFloat(priceThresholdPct) || 3);
  if (proactiveIntervalMin !== undefined) _proactiveIntervalMs = Math.max(5, parseInt(proactiveIntervalMin) || 60) * 60_000;
  return getTriggerStatus();
}

/**
 * Manually trigger a proactive cycle for one or all agents.
 */
export async function triggerProactive(agentName) {
  const targets = agentName ? [agentName] : Object.keys(minds);
  const results = [];
  for (const name of targets) {
    const mind = minds[name];
    if (!mind?.runProactive) continue;
    try {
      console.log(`[trigger] Manual proactive: ${name}`);
      const reply = await mind.runProactive();
      _lastProactiveTime[name] = new Date().toISOString();
      results.push({ name, ok: true, reply: reply?.slice(0, 200) || 'done' });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  }
  return results;
}

/**
 * Notify all Minds of an event (e.g., new address discovered).
 * Each Mind decides independently whether to act.
 * Mind decides → Console transmits → Relay executes.
 */
const PROACTIVE_COOLDOWN_MS = 30_000; // 30s cooldown between proactive cycles per agent
const PROACTIVE_STAGGER_MS = parseInt(process.env.PROACTIVE_STAGGER_MS, 10) || 5_000; // Bettor r484: 事件触发全员 proactive 的错峰间隔 (防 .105 惊群), env 可调
const DAILY_PROACTIVE_LIMIT = 50; // max proactive cycles per agent per day (D-7)
const _proactiveRunning = new Set(); // mutex: prevent concurrent proactive per agent
const _healthPaused = {};            // agentName → true if red, proactive skips

/** Check if agent has exceeded daily proactive limit (reads from events table, not memory) */
function _isDailyLimitReached(agentName) {
  try {
    // Only count proactive_event (event-triggered actions, e.g. whale alert → proactive)
    // proactive_cycle = scheduled interval, not a "cost" — don't limit the heartbeat
    // proactive_startup = system restart — don't limit recovery
    // Use agent_address for reliable matching (source field has naming inconsistencies)
    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE LOWER(name) = ?').get(agentName?.toLowerCase());
    if (!relay?.address) return false;
    const row = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM events WHERE event_type = 'proactive_event' AND agent_address = ? AND created_at > datetime('now', '-24 hours')"
    ).get(relay.address);
    return (row?.cnt || 0) >= DAILY_PROACTIVE_LIMIT;
  } catch { return false; }
}

export async function triggerProactiveAll(eventContext) {
  const now = Date.now();
  let _proactiveStaggerIdx = 0; // Bettor r484: 每次事件批从 0 错峰, 防累积无界
  for (const name of Object.keys(minds)) {
    const mind = minds[name];
    if (!mind?.runProactive) continue;

    // Mutex: skip if this agent is already running a proactive cycle
    if (_proactiveRunning.has(name)) {
      console.log(`[mind-manager] ${name} event-trigger skipped (already running)`);
      continue;
    }

    // Cooldown: skip if this agent ran proactive within the last 30s
    const lastTime = _lastProactiveTime[name];
    if (lastTime && (now - new Date(lastTime).getTime()) < PROACTIVE_COOLDOWN_MS) {
      console.log(`[mind-manager] ${name} event-trigger skipped (cooldown, last ${Math.round((now - new Date(lastTime).getTime()) / 1000)}s ago)`);
      continue;
    }

    // Daily limit: skip if this agent has exceeded daily proactive budget (D-7)
    if (_isDailyLimitReached(name)) {
      console.log(`[mind-manager] ${name} event-trigger skipped (daily limit ${DAILY_PROACTIVE_LIMIT} reached)`);
      continue;
    }

    // Skip newHandshake events where from = this agent (don't react to own handshakes)
    if (eventContext?.newHandshake?.from === mind.config?.address) {
      console.log(`[mind-manager] ${name} event-trigger skipped (own handshake)`);
      continue;
    }

    _proactiveRunning.add(name);
    // Bettor r484 (.105 惊群根修, J1 #2 诊断): 之前全员 runProactive 同毫秒并发齐发 → N 个 LLM
    // 调用同时砸单实例 llama-server → 每 ~30min fetch failed/timeout 成簇 (同机 kaspad 也跟着卡)。
    // 错峰: 按 index 延迟 PROACTIVE_STAGGER_MS 摊开发, 不同毫秒齐砸 (interval 路径 L770 已有 25s
    // 错峰, 这条事件路径之前漏了)。mutex 在 add 时已占, 延迟期间不会被重复触发。配 llama --parallel。
    const _staggerDelay = (_proactiveStaggerIdx++) * PROACTIVE_STAGGER_MS;
    setTimeout(() => {
      mind.runProactive(eventContext).then((result) => {
        _lastProactiveTime[name] = new Date().toISOString();
        recordMindEvent(name, 'proactive_event', JSON.stringify(eventContext).slice(0, 100) + ' → ' + (result || '').slice(0, 100));
      }).catch(err => {
        console.log(`[mind-manager] ${name} event proactive error: ${err?.message || err}`);
      }).finally(() => {
        _proactiveRunning.delete(name);
      });
    }, _staggerDelay);
  }
}

/**
 * Manually trigger a reflection cycle for one or all agents.
 */
export async function triggerReflection(agentName) {
  const targets = agentName ? [agentName] : Object.keys(minds);
  const results = [];
  for (const name of targets) {
    const mind = minds[name];
    if (!mind?.runReflection) continue;
    try {
      console.log(`[trigger] Manual reflection: ${name}`);
      await mind.runReflection();
      _lastReflectionTime[name] = new Date().toISOString();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  }
  return results;
}

/**
 * Start periodic proactive and reflection cycles for all Minds.
 * Called once after init().
 */
export function startScheduler() {
  if (_schedulerStarted) return;
  _schedulerStarted = true;

  const relays = sqlite.prepare(
    'SELECT id, name, proactive_interval_minutes, evolution_interval_hours FROM relay_nodes WHERE address IS NOT NULL'
  ).all();

  for (let ri = 0; ri < relays.length; ri++) {
    const r = relays[ri];
    const name = toAgentName(r.name);
    const proactiveMs = (r.proactive_interval_minutes || 60) * 60_000;
    const reflectMs = (r.evolution_interval_hours || 24) * 3600_000;
    const staggerMs = ri * 25_000; // 25s between agents to avoid adapter concurrency

    // Proactive loop
    console.log(`[mind-manager] ${r.name}: proactive every ${r.proactive_interval_minutes || 60}min, reflect every ${r.evolution_interval_hours || 24}h`);

    setTimeout(() => {
      setInterval(async () => {
        if (!_proactiveEnabled) return;
        if (_healthPaused[name]) { console.log(`[proactive] ${name} paused — health red`); return; }
        const mind = minds[name];
        if (!mind?.runProactive) return;
        if (_proactiveRunning.has(name)) return; // mutex
        if (_isDailyLimitReached(name)) return; // daily limit (D-7)
        _proactiveRunning.add(name);
        try {
          console.log(`[mind-manager] ${r.name} → proactive cycle`);
          const result = await mind.runProactive();
          _lastProactiveTime[name] = new Date().toISOString();
          recordMindEvent(r.name, 'proactive_cycle', (result || '').slice(0, 200));
        } catch (err) {
          console.log(`[mind-manager] ${r.name} proactive error: ${err?.message || err}`);
        } finally {
          _proactiveRunning.delete(name);
        }
      }, proactiveMs);
    }, 30_000 + Math.random() * 30_000);

    // First proactive on startup (after 2min settle time)
    setTimeout(async () => {
      if (!_proactiveEnabled) return;
      if (_healthPaused[name]) return;
      const mind = minds[name];
      if (!mind?.runProactive) return;
      if (_proactiveRunning.has(name)) return; // mutex
      if (_isDailyLimitReached(name)) return; // daily limit (D-7)
      console.log(`[mind-manager] ${r.name} → first proactive after startup`);
      _proactiveRunning.add(name);
      try {
        const result = await mind.runProactive();
        _lastProactiveTime[name] = new Date().toISOString();
        recordMindEvent(r.name, 'proactive_startup', (result || '').slice(0, 200));
      } catch (err) {
        console.log(`[mind-manager] ${r.name} first proactive error: ${err?.message || err}`);
      } finally {
        _proactiveRunning.delete(name);
      }
    }, 120_000 + staggerMs + Math.random() * 10_000);

    // Reflection loop
    setTimeout(() => {
      setInterval(async () => {
        if (!_reflectionEnabled) return;
        const mind = minds[name];
        if (!mind?.runReflection) return;
        try {
          console.log(`[mind-manager] ${r.name} → reflection cycle`);
          await mind.runReflection();
          _lastReflectionTime[name] = new Date().toISOString();
        } catch (err) {
          console.log(`[mind-manager] ${r.name} reflection error: ${err.message}`);
        }
      }, reflectMs);
    }, 60_000 + Math.random() * 60_000);

    // Immediate reflection if overdue (agent never reflected or interval elapsed)
    // Spread startup reflection to avoid concurrent API calls from agents sharing an adapter
    setTimeout(async () => {
      if (!_reflectionEnabled) return;
      const mind = minds[name];
      if (!mind?.runReflection) return;
      const lastTime = mind.kernels?.evolution?.lastReflectionTime || 0;
      const elapsedMs = Date.now() - lastTime;
      if (elapsedMs >= reflectMs) {
        console.log(`[mind-manager] ${r.name} reflection overdue (${lastTime ? Math.round(elapsedMs / 3600_000) + 'h ago' : 'never'}) — triggering now`);
        try {
          await mind.runReflection();
          _lastReflectionTime[name] = new Date().toISOString();
        } catch (err) {
          console.log(`[mind-manager] ${r.name} overdue reflection error: ${err.message}`);
        }
      }
    }, 90_000 + staggerMs + Math.random() * 10_000);
  }

  // ── Health Check Loop（每 30 分钟，独立于 proactive/reflection）──
  const HEALTH_CHECK_INTERVAL = 30 * 60_000;

  async function _runHealthCheck() {
      try {
        const health = await computeAllHealth();
        const myAgents = health.agents || [];

        for (const a of myAgents) {
          const agentName = toAgentName(a.name);
          const relay = sqlite.prepare('SELECT id, adapter_node_id FROM relay_nodes WHERE address = ?').get(a.address);

          if (a.status === 'green') {
            // ── 恢复：之前红色，现在绿了 → 解除暂停 ──
            if (_healthPaused[agentName]) {
              delete _healthPaused[agentName];
              console.log(`[health-check] ${a.name} recovered → proactive resumed`);
              recordMindEvent(a.name, 'health_recovered', 'Agent recovered from red status', a.address);
            }
            clearPeerNotification(a.name);
            continue;
          }

          // ── Build callbacks ──
          const callbacks = {
            triggerReflection: (name) => {
              const mind = minds[name];
              if (mind?.runReflection) {
                mind.runReflection().then(() => {
                  _lastReflectionTime[name] = new Date().toISOString();
                }).catch(() => {});
              }
            },
            cleanupGoals: (name) => {
              const mind = minds[name];
              if (mind?.kernels?.intent?.deduplicateGoals) {
                mind.kernels.intent.deduplicateGoals();
              }
            },
            restartAdapter: async (name) => {
              if (!relay?.adapter_node_id) return;
              const { restartAdapter } = await import('./adapter-launcher.js');
              await restartAdapter(relay.adapter_node_id);
            },
            pauseTrading: () => {
              // Circuit breaker already exists in order-machine.js
              // Here we just record the intent
              console.log(`[self-healing] ${a.name} trading pause requested`);
            },
            alertOwner: async (reporterName, peer) => {
              // Find the first active Mind to compose the notification
              const mind = minds[reporterName];
              if (!mind) return;
              const msg = `[健康告警] ${peer.name} 状态异常 (${peer.reason || 'unknown'})，已持续异常，请检查。`;
              recordMindEvent(a.name, 'health_peer_alert', msg, a.address);
            },
          };

          if (a.status === 'yellow') {
            silentRepair(agentName, a.indicators, callbacks);
            recordMindEvent(a.name, 'health_yellow', `Silent repair: ${a.reason || 'degraded'}`, a.address);
          }

          if (a.status === 'red') {
            if (a.reason === 'relay_down') {
              // Relay 完全挂了，自修复无能为力，只能被同伴发现
              _healthPaused[agentName] = true;
              recordMindEvent(a.name, 'health_red', 'Relay down — paused', a.address);
            } else if (a.reason === 'proactive' && a.indicators?.adapter === 'green' && a.indicators?.errors === 'green') {
              // Proactive-only RED: 不暂停，主动恢复
              // 解除之前的暂停（打破死锁）
              if (_healthPaused[agentName]) {
                delete _healthPaused[agentName];
                console.log(`[health-check] ${a.name} proactive-only red → unpausing to break deadlock`);
              }
              recordMindEvent(a.name, 'health_red', `Proactive stall — unpaused for recovery`, a.address);
            } else {
              // 真危险（adapter挂/支付失败/错误爆表）→ 暂停
              _healthPaused[agentName] = true;
              await emergencyRepair(agentName, a.indicators, callbacks);
              recordMindEvent(a.name, 'health_red', `Emergency repair: ${a.reason}`, a.address);
            }
          }
        }

        // ── 互助：每个活着的 Agent 检查同伴 ──
        const aliveAgents = myAgents.filter(a => a.status !== 'red' || a.reason !== 'relay_down');
        const sickPeers = myAgents.filter(a => a.status === 'red');

        for (const sick of sickPeers) {
          // 找第一个活着的 Agent 来通知 Owner
          const reporter = aliveAgents.find(a => a.name !== sick.name);
          if (!reporter) continue;
          const reporterName = toAgentName(reporter.name);
          const callbacks = {
            alertOwner: async (rName, peer) => {
              const msg = `[健康告警] ${peer.name} 状态异常 (${peer.reason || 'unknown'})，建议检查。`;
              recordMindEvent(reporter.name, 'health_peer_alert', msg, reporter.address);
            },
          };
          await notifyOwnerAboutPeer(reporterName, sick, callbacks);
        }

      } catch (err) {
        console.log(`[health-check] Error: ${err.message}`);
      }
  }

  // 首次检查：启动后 3 分钟，之后每 30 分钟
  setTimeout(() => {
    _runHealthCheck();
    setInterval(_runHealthCheck, HEALTH_CHECK_INTERVAL);
  }, 180_000 + Math.random() * 30_000);

  console.log(`[mind-manager] Scheduler started for ${relays.length} agents`);

  // ── Price Alert Monitor ──
  const PRICE_CHECK_INTERVAL = 60_000;
  const ALERT_COOLDOWN = 10 * 60_000;

  setInterval(async () => {
    if (!_priceAlertEnabled) return;
    try {
      const res = await fetch('https://api.mexc.com/api/v3/ticker/price?symbol=KASUSDT', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const price = parseFloat(data.price);
      if (!price) return;

      _baselinePrice = _baselinePrice || price;

      if (_lastAlertPrice === null) {
        _lastAlertPrice = price;
        console.log(`[price-monitor] Baseline: $${price}`);
        return;
      }

      const changePct = ((price - _lastAlertPrice) / _lastAlertPrice) * 100;
      const now = Date.now();

      if (Math.abs(changePct) >= _priceThresholdPct && now - _lastAlertTime > ALERT_COOLDOWN) {
        const direction = changePct > 0 ? 'UP' : 'DOWN';
        console.log(`[price-monitor] ALERT: KAS ${direction} ${changePct.toFixed(2)}% ($${_lastAlertPrice.toFixed(5)} → $${price.toFixed(5)})`);
        _lastAlertPrice = price;
        _lastAlertTime = now;
        _baselinePrice = price;

        const agentNames = Object.keys(minds);
        for (let i = 0; i < agentNames.length; i++) {
          const name = agentNames[i];
          const mind = minds[name];
          if (!mind?.runProactive) continue;
          if (_proactiveRunning.has(name)) continue; // mutex
          if (_isDailyLimitReached(name)) continue; // daily limit (D-7)
          // D-8: jitter 0-30s per agent to avoid synchronized API storms
          const jitterMs = i * 10_000 + Math.random() * 5_000;
          console.log(`[price-monitor] Waking ${name} in ${Math.round(jitterMs / 1000)}s...`);
          setTimeout(() => {
            if (_proactiveRunning.has(name)) return;
            _proactiveRunning.add(name);
            mind.runProactive().then(() => { _lastProactiveTime[name] = new Date().toISOString(); }).catch(() => {}).finally(() => { _proactiveRunning.delete(name); });
          }, jitterMs);
        }
      }
    } catch {}
  }, PRICE_CHECK_INTERVAL);

  console.log(`[mind-manager] Price monitor active: ±${_priceThresholdPct}%`);

  // ── Order Timeout Monitor ──
  setInterval(async () => {
    try {
      const { expireTimedOut, transition } = await import('../services/order-machine.js');
      expireTimedOut();

      // ── Broadcast kanet_timeout_v1 for accepted orders that timed out ──
      // expireTimedOut() handles expired/disputed, but accepted orders need
      // special handling: broadcast accountability then revert to published
      try {
        const acceptedTimedOut = sqlite.prepare(
          "SELECT * FROM mm_orders WHERE status = 'accepted' AND timeout_minutes > 0 AND accepted_at IS NOT NULL"
        ).all();
        for (const tOrder of acceptedTimedOut) {
          const elapsedMin = (Date.now() - new Date(tOrder.accepted_at).getTime()) / 60000;
          if (elapsedMin < tOrder.timeout_minutes) continue;

          // Broadcast timeout accountability to the order's chain channel (via Relay IPC)
          try {
            const { sendCommandAsync: sendCmd } = await import('./relay-manager.js');
            const timeoutMsg = JSON.stringify({
              t: 'kanet_timeout_v1', v: 1, id: tOrder.id,
              who: tOrder.peer_address || 'unknown',
              reason: `payment_timeout_${tOrder.timeout_minutes}min`,
              at_status: 'accepted',
            });
            const bcastResult = await sendCmd(tOrder.relay_node_id, { type: 'send_broadcast', channel: tOrder.id, message: timeoutMsg });
            if (bcastResult?.ok) {
              console.log(`[timeout] Broadcast kanet_timeout_v1 for ${tOrder.id.slice(0, 8)}`);
              // Filter's handleTimeout will revert to published + tryNextAccept
            } else {
              // Fallback: revert locally if broadcast is not possible
              transition(tOrder.id, 'published', { reason: `Timeout: payment_timeout_${tOrder.timeout_minutes}min`, force: true });
              const { releaseFunds } = await import('./fund-lock.js');
              releaseFunds(tOrder.id);
              console.log(`[timeout] Local revert for ${tOrder.id.slice(0, 8)} (no relay for broadcast)`);
            }
          } catch (err) {
            console.error(`[timeout] Failed to broadcast timeout for ${tOrder.id.slice(0, 8)}: ${err.message}`);
            // Fallback: still revert locally even if broadcast fails
            transition(tOrder.id, 'published', { reason: `Timeout: payment_timeout_${tOrder.timeout_minutes}min (broadcast failed)`, force: true });
            try {
              const { releaseFunds } = await import('./fund-lock.js');
              releaseFunds(tOrder.id);
            } catch {}
          }
        }
      } catch (err) {
        console.error(`[timeout] Accepted timeout check error: ${err.message}`);
      }

      // Phase 4: approval timeout — 超时的 pending execution_states
      const overdue = sqlite.prepare(
        "SELECT es.id, es.order_id, es.type, o.status as order_status FROM execution_states es JOIN mm_orders o ON o.id = es.order_id WHERE es.status = 'pending' AND es.approval_deadline IS NOT NULL AND es.approval_deadline < datetime('now')"
      ).all();
      for (const ex of overdue) {
        const { rejectExecution } = await import('../services/execution-state.js');
        // 付款前 → cancelled，付款后 → disputed
        const paidStatuses = ['paid', 'verified', 'delivering'];
        if (paidStatuses.includes(ex.order_status)) {
          rejectExecution(ex.id, 'Approval timeout (post-payment) → disputed');
          transition(ex.order_id, 'disputed', { reason: 'Approval timeout after payment', force: true });
          console.log(`[approval-timeout] ${ex.order_id.slice(0, 8)} → disputed (post-payment)`);
        } else {
          rejectExecution(ex.id, 'Approval timeout (pre-payment) → cancelled');
          transition(ex.order_id, 'cancelled', { reason: 'Approval timeout', force: true });
          console.log(`[approval-timeout] ${ex.order_id.slice(0, 8)} → cancelled (pre-payment)`);
        }
      }
      // Phase 5: dispute 升级路径（15min→重验，30min→通知，60min→冻结escalated）
      const disputed = sqlite.prepare(
        "SELECT id, status, completed_at, agent_address, payment_txhash, chain, counterparty_order_id FROM mm_orders WHERE status = 'disputed' AND completed_at IS NOT NULL"
      ).all();
      for (const d of disputed) {
        const mins = (Date.now() - new Date(d.completed_at).getTime()) / 60000;
        if (mins >= 60) {
          // 60min → escalated（冻结，等待人工）
          try {
            const { transition: orderTransition } = await import('./order-machine.js');
            orderTransition(d.id, 'escalated', { reason: `Dispute unresolved after ${Math.round(mins)} minutes — escalated for manual intervention` });
            console.log(`[dispute] ${d.id.slice(0, 8)} → ESCALATED (${Math.round(mins)}min)`);
          } catch (err) {
            console.log(`[dispute] ${d.id.slice(0, 8)} escalate failed: ${err.message}`);
          }
        } else if (mins >= 30) {
          // 30min → 通知 owner（写 event 作为通知记录）
          const { insertEvent } = await import('../data/state/events.js');
          try {
            insertEvent({
              scope: 'user', type: 'dispute_alert', source: 'system', level: 'warn',
              description: `Order ${d.id.slice(0, 8)} disputed for ${Math.round(mins)}min — needs attention`,
              agentAddress: d.agent_address,
            });
          } catch {} // 去重：如果已写过则 ignore
          console.log(`[dispute] ${d.id.slice(0, 8)} ALERT: ${Math.round(mins)}min disputed, owner notified`);
        } else if (mins >= 15 && d.payment_txhash && d.payment_txhash !== 'confirmed') {
          // 15min → 自动重新验证链上 TX
          try {
            const port = process.env.PORT || 3100;
            await fetch(`http://localhost:${port}/api/trade/mm-orders/${d.counterparty_order_id || d.id}/action`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'verify_payment', payment_txhash: d.payment_txhash }),
            });
            console.log(`[dispute] ${d.id.slice(0, 8)} auto-re-verify triggered at ${Math.round(mins)}min`);
          } catch (err) {
            console.log(`[dispute] ${d.id.slice(0, 8)} auto-re-verify failed: ${err.message}`);
          }
        }
      }
    } catch {}
  }, 60_000); // check every minute
}

/**
 * Resolve relayNodeId from request — explicit or first available.
 */
export function resolveRelayNodeId(relayNodeId) {
  if (relayNodeId) return relayNodeId;
  // Pick first relay node with adapter as fallback
  const relay = sqlite.prepare(
    'SELECT r.id FROM relay_nodes r JOIN adapter_nodes a ON a.id = r.adapter_node_id WHERE r.address IS NOT NULL LIMIT 1'
  ).get();
  return relay?.id || null;
}

