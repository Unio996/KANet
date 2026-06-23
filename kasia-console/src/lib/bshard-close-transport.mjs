// bshard close_attest 自治-daemon transport (Track B · settler 侧).
//   settler 不再 inline 收 sig (driver-side) — 而是【发布 sign-request → 自治委员 daemon 各自 enforce+签 → settler 收 ≥4 sig → submit】。
//   配 daemon: src/services/bshard-close-voter.js (读端) + 接口档 docs/2026-06-22-bshard-enforce-in-daemon-interface.md。
//
// 零 schema churn: 请求存 pool_markets.metadata.bshard_close_request; sig 存 chain_events event_type='bshard_close_sig'。

import { sqlite } from '../db/client.js';

const QUORUM = 4;   // 4-of-5 committee (close_attest .sil require ≥4 distinct sig)

/**
 * publishCloseRequest — settler 发布 close_attest sign-request (委员 daemon 各自 pull+enforce+签)。
 * @param {string} marketId
 * @param {object} req { txSafeJson, predicate, proposed_evidence, claimedPayoutRoot, psRedeemHex, committee_pks[], input_index, idx, siblings_hex(per-committee map OR settler 注入), broker_pk, deadline_daa, data_source_canonical?, snapshot? }
 *   注: idx/siblings_hex 是 per-committee (各委员在 pool tree 的位置不同) → req.committee_meta = { <pk>: {idx, siblings_hex} }; daemon 按 voterPk 取。
 *   snapshot (J1 cross-node co-verify 接口 94cfef67, hint-only): { shards:[{shard_index, shard_redeem_hex, current_leaf_state,
 *     current_leaf_outpoint, shard_pool_id, bettors:[{pk,direction,stake}]}] }。委员 enforce 链锚验全部 (snapshot 只指路,
 *     state/Σ/ticket landed 全 re-derive 自链不信 snapshot 数) → cross-node 委员(无本地 market_shards)可跑 C1 verifyBettorsCompleteFromChain。
 *     :3200 本地委员 daemon 不需它 (lib 回退 listShards(db)); 它是给 :3300 跨节点委员的 hint。
 *   data_source_canonical (c77bb356 载重分离): wrapper-source 市场单独传源给 verifyFrozenEvidence; source-in-inner 市场 (如 2462l) 可省 (predicate 自带)。
 */
export function publishCloseRequest(marketId, req) {
  if (!req?.txSafeJson || !req?.claimedPayoutRoot || !Array.isArray(req.committee_pks)) {
    throw new Error('publishCloseRequest: txSafeJson + claimedPayoutRoot + committee_pks 必需');
  }
  const row = sqlite.prepare('SELECT metadata, protocol_version FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) throw new Error(`publishCloseRequest: market ${marketId} 不存在`);
  if (row.protocol_version !== 'v0.7') throw new Error(`publishCloseRequest: 需 v0.7, got ${row.protocol_version}`);
  let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
  meta.bshard_close_request = {
    txSafeJson: req.txSafeJson,
    predicate: req.predicate ?? null,
    proposed_evidence: req.proposed_evidence ?? null,
    claimedPayoutRoot: String(req.claimedPayoutRoot),
    psRedeemHex: req.psRedeemHex,
    committee_pks: req.committee_pks.map(p => String(p).toLowerCase()),
    committee_meta: req.committee_meta || null,   // { <pk>: {idx, siblings_hex} }
    input_index: req.input_index ?? 0,
    broker_pk: req.broker_pk ? String(req.broker_pk).toLowerCase() : null,
    introducer_pk: req.introducer_pk ? String(req.introducer_pk).toLowerCase() : null,
    maker_pk: req.maker_pk ? String(req.maker_pk).toLowerCase() : null,           // J1 cross-node: reDeriveCommittee exclude
    data_source_canonical: req.data_source_canonical ?? null,   // c77bb356: wrapper-source 市场单独传; source-in-inner 可省
    snapshot: req.snapshot ?? null,                              // 94cfef67 cross-node hint: {shards:[{...,bettors:[]}]}
    // J1 14:52 cross-node ctx (他 :3300 无本地 pool 数据): reDeriveCommittee 需全 pool members + endBlockHash。
    //   pool_members=全集 {pk_hex,stake_sompi}(selectCommittee + C2-anchor buildPoolMerkleTree==poolMerkleRoot);
    //   end_block_hash=deriveCommitteeSeed seed(at deadline_daa, settler 自算 pin 死跨节点确定性)。enforce 链锚验 poolMerkleRoot 从 psRedeem ctor 读, pool_members 只指路。
    pool_members: Array.isArray(req.pool_members) ? req.pool_members : null,
    end_block_hash: req.end_block_hash ?? null,
    deadline_daa: req.deadline_daa ?? null,
    published_at_daa: req.published_at_daa ?? null,
  };
  sqlite.prepare(`UPDATE pool_markets SET metadata = ?, protocol_status = 'collecting_sigs' WHERE id = ?`).run(JSON.stringify(meta), marketId);
  return { ok: true, market_id: marketId, committee: req.committee_pks.length, status: 'collecting_sigs' };
}

/**
 * collectCloseSigs — settler 收委员 daemon 写的 sig (chain_events 'bshard_close_sig')。
 * @returns {{ ready:bool, sigs: Array<{committee_pk, signature, idx, siblings_hex, verdict}>, count, quorum }}
 *   ready = count ≥ QUORUM (distinct committee_pk)。 settler ready 时组装 close_attest submit。
 */
export function collectCloseSigs(marketId, payoutRoot) {
  const rows = sqlite.prepare(`
    SELECT payload FROM chain_events WHERE event_type = 'bshard_close_sig'
      AND payload LIKE ? AND payload LIKE ?
  `).all(`%"market_id":"${marketId}"%`, `%"payout_root":"${payoutRoot}"%`);
  const byPk = new Map();
  for (const r of rows) {
    let p; try { p = JSON.parse(r.payload); } catch { continue; }
    if (p?.committee_pk && p?.signature && !byPk.has(p.committee_pk)) {
      byPk.set(p.committee_pk, { committee_pk: p.committee_pk, signature: p.signature, idx: p.idx, siblings_hex: p.siblings_hex, verdict: p.verdict });
    }
  }
  const sigs = [...byPk.values()];
  return { ready: sigs.length >= QUORUM, sigs, count: sigs.length, quorum: QUORUM };
}

/** clearCloseRequest — submit LANDED 后清 request + 推进 status (settled/refunding by caller)。 */
export function clearCloseRequest(marketId, finalStatus = 'completed') {
  const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) return { ok: false };
  let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
  delete meta.bshard_close_request;
  sqlite.prepare(`UPDATE pool_markets SET metadata = ?, protocol_status = ? WHERE id = ?`).run(JSON.stringify(meta), finalStatus, marketId);
  return { ok: true, status: finalStatus };
}

export { QUORUM };
