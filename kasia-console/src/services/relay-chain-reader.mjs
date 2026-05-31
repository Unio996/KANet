// relay-chain-reader.mjs — chainReader adapter for fetchEndBlockHashCanonical.
//
// Bettor r170 ③ 接线 line-2 (J1 scope). Wraps 2 IPC commands exposed by kasia-relay:
//   chain_get_current_daa_score      → tip virtualDaaScore via getBlockDagInfo
//   chain_get_blocks_from_daa_score  → recent-blocks ring buffer filtered to daaScore >= minDaa
//
// fetchEndBlockHashCanonical (pool-market-settler-v06.mjs) expects:
//   { getBlocksFromDaaScore: (minDaa) => Promise<[{ hash, daaScore }]>,
//     getCurrentDaaScore: () => Promise<number> }
//
// Console NEVER touches chain directly (CLAUDE.md "Relay 是唯一链上出口"). All chain
// reads must go through a relay process via sendCommandAsync IPC.

import { sendCommandAsync } from './relay-manager.js';

export function createRelayChainReader(relayId) {
  if (!relayId) throw new Error('createRelayChainReader: relayId required');
  return {
    async getCurrentDaaScore() {
      const r = await sendCommandAsync(relayId, { type: 'chain_get_current_daa_score' });
      if (!r?.ok) throw new Error(`chain_get_current_daa_score (relay ${relayId.slice(0,8)}) failed: ${r?.error || 'no response'}`);
      const n = Number(r.daa_score);
      if (!Number.isFinite(n) || n < 0) throw new Error(`chain_get_current_daa_score returned invalid daa_score: ${r.daa_score}`);
      return n;
    },
    async getBlocksFromDaaScore(minDaa) {
      if (!Number.isFinite(minDaa) || minDaa < 0) throw new Error('getBlocksFromDaaScore: minDaa must be non-negative number');
      const r = await sendCommandAsync(relayId, {
        type: 'chain_get_blocks_from_daa_score',
        min_daa_score: minDaa,
      });
      if (!r?.ok) throw new Error(`chain_get_blocks_from_daa_score (relay ${relayId.slice(0,8)}) failed: ${r?.error || 'no response'}`);
      const blocks = Array.isArray(r.blocks) ? r.blocks : [];
      // Normalize daaScore to number (IPC may serialize bigint)
      return blocks.map(b => ({ hash: String(b.hash), daaScore: Number(b.daaScore) }));
    },
  };
}
