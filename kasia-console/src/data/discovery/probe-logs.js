import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

/**
 * Log a probe attempt.
 */
export function createProbe({ targetAddress, probeType = 'generic_probe', messageTemplate = null }) {
  const id = randomUUID();
  const now = nowIso();
  sqlite.prepare(`
    INSERT INTO probe_logs (id, target_address, sent_at, probe_type, message_template, result, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, targetAddress, now, probeType, messageTemplate, now);
  return id;
}

/**
 * Record a probe response.
 */
export function recordProbeResponse(probeId, { classification = 'unknown', result = 'success' }) {
  const now = nowIso();
  sqlite.prepare(`
    UPDATE probe_logs SET response_received = 1, response_at = ?, response_classification = ?, result = ?
    WHERE id = ?
  `).run(now, classification, result, probeId);
}

/**
 * Mark a probe as failed (no response after timeout).
 */
export function markProbeFailed(probeId) {
  sqlite.prepare(`UPDATE probe_logs SET result = 'ignored' WHERE id = ?`).run(probeId);
}

/**
 * Get latest probe for an address.
 */
export function getLatestProbe(targetAddress) {
  return sqlite.prepare(
    'SELECT * FROM probe_logs WHERE target_address = ? ORDER BY sent_at DESC LIMIT 1'
  ).get(targetAddress);
}

/**
 * Count probes by result for an address.
 */
export function getProbeStats(targetAddress) {
  return sqlite.prepare(`
    SELECT result, COUNT(*) as cnt FROM probe_logs
    WHERE target_address = ?
    GROUP BY result
  `).all(targetAddress);
}

/**
 * Get discovery funnel metrics.
 */
export function getFunnelMetrics() {
  const total = sqlite.prepare('SELECT COUNT(DISTINCT target_address) as n FROM probe_logs').get().n;
  const responded = sqlite.prepare('SELECT COUNT(DISTINCT target_address) as n FROM probe_logs WHERE response_received = 1').get().n;
  const byClass = sqlite.prepare(`
    SELECT response_classification as cls, COUNT(DISTINCT target_address) as n
    FROM probe_logs WHERE response_received = 1 AND response_classification IS NOT NULL
    GROUP BY response_classification
  `).all();
  const byResult = sqlite.prepare(`
    SELECT result, COUNT(*) as n FROM probe_logs GROUP BY result
  `).all();
  return {
    addresses_probed: total,
    addresses_responded: responded,
    probe_response_rate: total > 0 ? (responded / total) : 0,
    by_classification: Object.fromEntries(byClass.map(r => [r.cls, r.n])),
    by_result: Object.fromEntries(byResult.map(r => [r.result, r.n])),
  };
}

/**
 * List pending probes (for retry logic).
 */
export function listPendingProbes({ limit = 50 } = {}) {
  return sqlite.prepare(`
    SELECT * FROM probe_logs WHERE result = 'pending'
    ORDER BY sent_at ASC LIMIT ?
  `).all(limit);
}
