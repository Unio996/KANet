/**
 * Confirmation Token Store — in-memory, one-time, 30s expiry.
 * Used by execute intents (send_kas, publish_order, cancel_order).
 * Token generated when intent matched → consumed when user clicks confirm.
 */

import { randomBytes } from 'node:crypto';

const _store = new Map();

/**
 * Create a confirmation token for a pending execute action.
 * @returns {string} token (32 hex chars)
 */
export function createConfirmToken(intent, params, config, agentId) {
  const token = randomBytes(16).toString('hex');
  _store.set(token, {
    intent, params, config, agentId,
    expiresAt: Date.now() + 30_000,
  });
  setTimeout(() => _store.delete(token), 35_000);
  return token;
}

/**
 * Consume a token — returns entry if valid, null if expired/invalid/wrong agent.
 * One-time use: deleted after consumption.
 */
export function consumeConfirmToken(token, agentId) {
  const entry = _store.get(token);
  if (!entry) return null;
  if (entry.agentId !== agentId) return null;
  if (Date.now() > entry.expiresAt) { _store.delete(token); return null; }
  _store.delete(token);
  return entry;
}
