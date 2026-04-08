/**
 * layer-engine.mjs — Agent behavior layer state machine.
 *
 * L1 Social  → no tools
 * L2 Task    → no tools, text output only (patch/command/plan)
 * L3 Observe → read_file, search_code, http_get
 * L4 Act     → write_file, run_command, http_mutate
 *
 * Default L1. Agent never self-escalates.
 * Escalation requires owner intent + two-step confirmation (L3/L4).
 * Degradation: idle timeout / max duration / semantic drift.
 */

const LAYERS = ['L1', 'L2', 'L3', 'L4'];

const L3_IDLE_MS = 10 * 60_000;   // 10 min
const L4_IDLE_MS = 5 * 60_000;    // 5 min
const L4_MAX_MS  = 30 * 60_000;   // 30 min absolute cap
const DRIFT_THRESHOLD = 3;        // 3 consecutive messages with no tool call

// Per-conversation state storage (in-memory, keyed by conversationId or agentName)
const _states = new Map();

/**
 * Get current layer state for a conversation.
 * @param {string} sessionId — conversationId or agentName
 * @returns {object} state
 */
export function getState(sessionId) {
  if (!_states.has(sessionId)) {
    _states.set(sessionId, _newState());
  }
  return _states.get(sessionId);
}

/**
 * Attempt to escalate to a target layer.
 * Returns { allowed, needsConfirm, confirmPrompt, newLayer }.
 *
 * @param {string} sessionId
 * @param {string} targetLayer — 'L2' | 'L3' | 'L4'
 * @param {string} activatedBy — 'owner' | 'system'
 * @returns {object}
 */
export function requestEscalation(sessionId, targetLayer, activatedBy = 'owner') {
  const state = getState(sessionId);
  const targetIdx = LAYERS.indexOf(targetLayer);
  const currentIdx = LAYERS.indexOf(state.currentLayer);

  // Already at or above target
  if (currentIdx >= targetIdx) {
    return { allowed: true, needsConfirm: false, newLayer: state.currentLayer };
  }

  // Non-owner cannot reach L4
  if (activatedBy !== 'owner' && activatedBy !== 'system' && targetLayer === 'L4') {
    return { allowed: false, needsConfirm: false, reason: 'Only owner can enter L4' };
  }

  // L2: safe, no tools — auto-escalate
  if (targetLayer === 'L2') {
    _setLayer(state, 'L2', activatedBy);
    return { allowed: true, needsConfirm: false, newLayer: 'L2' };
  }

  // L2→L4 jump (user confirmed patch/plan from L2)
  if (state.currentLayer === 'L2' && targetLayer === 'L4') {
    return {
      allowed: false,
      needsConfirm: true,
      confirmPrompt: 'Ready to apply the changes. Proceed?',
      pendingLayer: 'L4',
    };
  }

  // L3: owner auto-escalates (owner said "check logs" — just do it, don't ask)
  if (targetLayer === 'L3' && activatedBy === 'owner') {
    _setLayer(state, 'L3', activatedBy);
    return { allowed: true, needsConfirm: false, newLayer: 'L3' };
  }

  // L3 non-owner / L4: two-step confirmation
  const prompts = {
    L3: 'I need to check system files and logs. Shall I proceed?',
    L4: 'I need to modify files or run commands. Shall I proceed?',
  };

  return {
    allowed: false,
    needsConfirm: true,
    confirmPrompt: prompts[targetLayer] || `Escalate to ${targetLayer}?`,
    pendingLayer: targetLayer,
  };
}

/**
 * Confirm a pending escalation (user said "yes").
 * @param {string} sessionId
 * @param {string} targetLayer
 * @param {string} activatedBy
 */
export function confirmEscalation(sessionId, targetLayer, activatedBy = 'owner') {
  const state = getState(sessionId);
  _setLayer(state, targetLayer, activatedBy);
  return { allowed: true, newLayer: targetLayer };
}

/**
 * Record an ACTION execution (resets idle timer and drift counter).
 * @param {string} sessionId
 */
export function recordAction(sessionId) {
  const state = getState(sessionId);
  state.lastSensitiveActionAt = Date.now();
  state.noToolCallCount = 0;
}

/**
 * Record a message with no tool call (drift detection).
 * @param {string} sessionId
 */
export function recordNoToolCall(sessionId) {
  const state = getState(sessionId);
  state.noToolCallCount = (state.noToolCallCount || 0) + 1;
}

/**
 * Check if degradation should occur. If yes, degrades and returns the reason.
 * Call this per-message before Brain invocation.
 *
 * @param {string} sessionId
 * @returns {{ degraded: boolean, reason?: string, from?: string }}
 */
export function checkDegradation(sessionId) {
  const state = getState(sessionId);
  if (state.currentLayer === 'L1') return { degraded: false };

  const now = Date.now();

  // L4 max duration
  if (state.currentLayer === 'L4' && state.activatedAt && now - state.activatedAt > L4_MAX_MS) {
    const from = state.currentLayer;
    _setLayer(state, 'L1', null);
    return { degraded: true, reason: 'L4 max duration (30min)', from };
  }

  // Idle timeout
  const lastAction = state.lastSensitiveActionAt || state.activatedAt || now;
  const idleMs = state.currentLayer === 'L4' ? L4_IDLE_MS : L3_IDLE_MS;
  if (now - lastAction > idleMs) {
    const from = state.currentLayer;
    _setLayer(state, 'L1', null);
    return { degraded: true, reason: `Idle timeout (${idleMs / 60000}min)`, from };
  }

  // Semantic drift (3 consecutive messages with no tool call)
  if (state.noToolCallCount >= DRIFT_THRESHOLD && (state.currentLayer === 'L3' || state.currentLayer === 'L4')) {
    const from = state.currentLayer;
    _setLayer(state, 'L1', null);
    return { degraded: true, reason: 'Semantic drift (3 msgs no tool)', from };
  }

  return { degraded: false };
}

/**
 * Get available tools for the current layer.
 * @param {string} sessionId
 * @param {boolean} isSelfHealing — if true, L4 tools are restricted
 * @returns {string[]} tool names available
 */
export function getAvailableTools(sessionId, isSelfHealing = false) {
  const state = getState(sessionId);

  if (state.currentLayer === 'L1' || state.currentLayer === 'L2') return [];

  const l3Tools = ['READ_FILE', 'SEARCH_CODE', 'HTTP_REQUEST_GET'];

  if (state.currentLayer === 'L3') return l3Tools;

  // L4
  if (isSelfHealing) {
    // Self-healing L4: no write_file, no mutating http, only whitelisted commands
    return [...l3Tools, 'RUN_COMMAND_RESTRICTED'];
  }

  return [...l3Tools, 'WRITE_FILE', 'RUN_COMMAND', 'HTTP_REQUEST_MUTATE'];
}

/**
 * Force degrade to L1 (e.g., conversation ended).
 * @param {string} sessionId
 */
export function forceDegrade(sessionId) {
  const state = getState(sessionId);
  _setLayer(state, 'L1', null);
}

/**
 * Clean up old sessions (call periodically).
 */
export function cleanup() {
  const cutoff = Date.now() - 60 * 60_000; // 1h
  for (const [id, state] of _states) {
    if ((state.activatedAt || 0) < cutoff && state.currentLayer === 'L1') {
      _states.delete(id);
    }
  }
}

// ── Internal ────────────────────────────────────────────────────────────

function _newState() {
  return {
    currentLayer: 'L1',
    activatedBy: null,
    activatedAt: null,
    lastSensitiveActionAt: null,
    noToolCallCount: 0,
  };
}

function _setLayer(state, layer, activatedBy) {
  state.currentLayer = layer;
  state.activatedBy = activatedBy;
  state.activatedAt = layer === 'L1' ? null : Date.now();
  state.lastSensitiveActionAt = null;
  state.noToolCallCount = 0;
}
