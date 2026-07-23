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

// design-v2 (J2-tn r997): with KANet-UI (B) N-medium-UTXO broadcaster cron, a chunk burst can
// momentarily drain all N confirmed UTXOs (all in-flight) → the next chunk hits 'No UTXOs available'
// (kasia-relay transaction.mjs L141/L148). The relay send_broadcast catch only retries mempool-reject
// + Insufficient/Storage mass, NOT exhaustion → wave-boundary HARD-FAIL (not slow). Retry the chunk
// with backoff so the pipeline waits for a self-output to confirm, then resumes — graceful pacing
// instead of failing the whole settle broadcast. Safety-net behind (B) N≈30 (covers a settle in 1 wave).
const UTXO_EXHAUSTION_RE = /No UTXOs available|all spent by pending/i;
const CHUNK_EXHAUSTION_MAX_RETRY = parseInt(process.env.BROADCAST_CHUNK_EXHAUSTION_RETRY, 10) || 8;

export async function sendBroadcastChunked(relayId, channel, payloadStr, timeoutMs) {
  // J2-tn 规模测试 (KANet-UI 定位 / Bettor r552): sendCommandAsync 默认 IPC timeout=30s
  // (relay-manager.js:274)。大 sign_req (settle TX 14-18in → 45-58 chunk) 每 chunk 提交在并发 +
  // storage-mass 下 >30s → IPC reject → oracle 收不到 sign_req → collecting_sigs 卡 1/4 → refund。
  // 修: chunked 路每 chunk 提 90s (env 可调) → 慢提交完成。深层 (UTXO consolidation 降 storage-mass /
  // 减 settle TX 尺寸 = broadcast-880 根治) 另治; 此处先让大广播不被 30s 硬截。
  const tmo = timeoutMs || parseInt(process.env.BROADCAST_CHUNK_TIMEOUT_MS, 10) || 90_000;
  if (payloadStr.length <= SAFE_CHUNK_BUDGET) {
    return await sendCommandAsync(relayId, { type: 'send_broadcast', channel, message: payloadStr }, tmo, 'internal');
  }
  const hash = createHash('sha256').update(payloadStr).digest('hex');
  const total = Math.ceil(payloadStr.length / CHUNK_DATA_BUDGET);
  const txIds = [];
  for (let ord = 0; ord < total; ord++) {
    const data = payloadStr.slice(ord * CHUNK_DATA_BUDGET, (ord + 1) * CHUNK_DATA_BUDGET);
    const chunkPayload = JSON.stringify({ t: 'pool_market_chunk_v1', hash, ord, total, data });
    let r, attempt = 0;
    for (;;) {
      try {
        r = await sendCommandAsync(relayId, { type: 'send_broadcast', channel, message: chunkPayload }, tmo, 'internal');
      } catch (e) {
        r = { error: e?.message || String(e) };
      }
      if (r?.txId) break;
      // UTXO-exhaustion (all N in-flight) is transient: wait a confirmation, then retry the same chunk.
      if (UTXO_EXHAUSTION_RE.test(String(r?.error || '')) && attempt < CHUNK_EXHAUSTION_MAX_RETRY) {
        attempt++;
        const sleepMs = Math.min(attempt * 2000, 10_000);  // 2/4/6/8/10s — wait for a self-output to confirm
        console.log(`[pool-broadcast] chunk ${ord+1}/${total} UTXO-exhausted, sleep ${sleepMs}ms then retry (attempt ${attempt}/${CHUNK_EXHAUSTION_MAX_RETRY})`);
        await new Promise(res => setTimeout(res, sleepMs));
        continue;
      }
      throw new Error(`chunk ${ord+1}/${total} broadcast no txId: ${JSON.stringify(r).slice(0,200)}`);
    }
    txIds.push(r.txId);
  }
  console.log(`[pool-broadcast] chunked ${payloadStr.length} chars → ${total} chunks hash=${hash.slice(0,8)} txIds=[${txIds.map(t=>t.slice(0,8)).join(',')}]`);
  return { ok: true, txId: txIds.join(','), chunks: total, hash };
}
