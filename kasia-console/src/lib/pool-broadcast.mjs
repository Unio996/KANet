// pool-broadcast.mjs — shared chunked broadcast helper for pool/oracle envelopes.
//
// Extracted from api/pool.js _sendBroadcastChunked (Bettor r128/r129 + J1 e67c9328 chunked v1).
// Used by both pool.js (_broadcastMarketPublished/_broadcastBetRegistered) and oracle-pool.js
// (_broadcastOracleStakeEnroll for Path A enroll-via-broadcast J2-tn r301).
//
// Chunk envelope: { t: 'pool_market_chunk_v1', hash, ord, total, data } — consumer reassembles
// in trade-protocol-filter handlePoolMarketChunk. SAFE_CHUNK_BUDGET 450 char + CHUNK_DATA_BUDGET 340.

import { createHash } from 'node:crypto';
import { sendCommandAsync } from '../services/relay-manager.js';

export const SAFE_CHUNK_BUDGET = 450;
export const CHUNK_DATA_BUDGET = 340;

export async function sendBroadcastChunked(relayId, channel, payloadStr) {
  if (payloadStr.length <= SAFE_CHUNK_BUDGET) {
    return await sendCommandAsync(relayId, { type: 'send_broadcast', channel, message: payloadStr });
  }
  const hash = createHash('sha256').update(payloadStr).digest('hex');
  const total = Math.ceil(payloadStr.length / CHUNK_DATA_BUDGET);
  const txIds = [];
  for (let ord = 0; ord < total; ord++) {
    const data = payloadStr.slice(ord * CHUNK_DATA_BUDGET, (ord + 1) * CHUNK_DATA_BUDGET);
    const chunkPayload = JSON.stringify({ t: 'pool_market_chunk_v1', hash, ord, total, data });
    const r = await sendCommandAsync(relayId, { type: 'send_broadcast', channel, message: chunkPayload });
    if (!r?.txId) throw new Error(`chunk ${ord+1}/${total} broadcast no txId: ${JSON.stringify(r).slice(0,200)}`);
    txIds.push(r.txId);
  }
  console.log(`[pool-broadcast] chunked ${payloadStr.length} chars → ${total} chunks hash=${hash.slice(0,8)} txIds=[${txIds.map(t=>t.slice(0,8)).join(',')}]`);
  return { ok: true, txId: txIds.join(','), chunks: total, hash };
}
