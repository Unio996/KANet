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
 * publishCloseRequestV2 — settler 发布 PayoutShardV2(ZK-native) close_attest sign-request (W2, J2 2026-07-07)。
 * 镜像 publishCloseRequest, 但: (a) 存进独立 key `bshard_close_request_v2` (跟 V1 `bshard_close_request` 结构隔离,
 *   同 PayoutShardV2.sil 全拷贝哲学, 防两种 shape 混淆); (b) 多 4 个新字段 new_attestedWinner/new_betsRoot/
 *   new_refundRoot/new_attestedAtMs 的 PROPOSED 值 (委员通过 enforceCloseAttestV2 各自独立重算验证, 这里存的只是
 *   settler 提议值供 daemon 读取比对, 非权威 — 权威判定权全在委员侧, 同 V1 claimedPayoutRoot 的定位)。
 * @param {string} marketId
 * @param {object} req 同 publishCloseRequest 的字段 + { new_attestedWinner, new_betsRoot, new_refundRoot, new_attestedAtMs,
 *   closeInputs }。closeInputs (卡2③ submit 阶段必需, J2 2026-07-07): { payoutshard:{redeem_hex,outpointTxid,index,
 *   state,state_start}, fee:{address,outpointTxid,index} } — 跟 build txSafeJson 时用的【同一份】raw inputs, 原样存下
 *   供 submitCloseAttestV2 重放 (禁止 submit 阶段重新推导/猜这些值 — 必须 byte-exact 等于 propose 阶段委员已 enforce
 *   过 hash 的那份 inputs, 否则 submit 广播的 tx 可能跟委员签的不是同一笔)。
 */
export function publishCloseRequestV2(marketId, req) {
  if (!req?.txSafeJson || !req?.claimedPayoutRoot || !Array.isArray(req.committee_pks)) {
    throw new Error('publishCloseRequestV2: txSafeJson + claimedPayoutRoot + committee_pks 必需');
  }
  if (!req?.closeInputs?.payoutshard || !req?.closeInputs?.fee) {
    throw new Error('publishCloseRequestV2: closeInputs.payoutshard + closeInputs.fee 必需 (卡2③ submit 阶段依赖)');
  }
  if (req.new_attestedWinner == null || !req.new_betsRoot || !req.new_refundRoot || req.new_attestedAtMs == null) {
    throw new Error('publishCloseRequestV2: new_attestedWinner/new_betsRoot/new_refundRoot/new_attestedAtMs 必需 (W2 4 新字段)');
  }
  const row = sqlite.prepare('SELECT metadata, protocol_version FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) throw new Error(`publishCloseRequestV2: market ${marketId} 不存在`);
  if (row.protocol_version !== 'v0.7') throw new Error(`publishCloseRequestV2: 需 v0.7, got ${row.protocol_version}`);
  let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
  meta.bshard_close_request_v2 = {
    txSafeJson: req.txSafeJson,
    predicate: req.predicate ?? null,
    proposed_evidence: req.proposed_evidence ?? null,
    claimedPayoutRoot: String(req.claimedPayoutRoot),
    psRedeemHex: req.psRedeemHex,
    committee_pks: req.committee_pks.map(p => String(p).toLowerCase()),
    committee_meta: req.committee_meta || null,
    input_index: req.input_index ?? 0,
    broker_pk: req.broker_pk ? String(req.broker_pk).toLowerCase() : null,
    introducer_pk: req.introducer_pk ? String(req.introducer_pk).toLowerCase() : null,
    maker_pk: req.maker_pk ? String(req.maker_pk).toLowerCase() : null,
    data_source_canonical: req.data_source_canonical ?? null,
    snapshot: req.snapshot ?? null,
    pool_members: Array.isArray(req.pool_members) ? req.pool_members : null,
    end_block_hash: req.end_block_hash ?? null,
    deadline_daa: req.deadline_daa ?? null,
    published_at_daa: req.published_at_daa ?? null,
    // W2 新增 4 字段 (proposed, 非权威 — 委员各自重算+D2 splice 比对):
    new_attestedWinner: Number(req.new_attestedWinner),
    new_betsRoot: String(req.new_betsRoot),
    new_refundRoot: String(req.new_refundRoot),
    new_attestedAtMs: Number(req.new_attestedAtMs),
    closeInputs: req.closeInputs,   // raw inputs used to build txSafeJson — submit 阶段原样重放, 不重新推导。
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

/**
 * collectCloseSigsV2 — 同 collectCloseSigs, 读独立 event_type 'bshard_close_sig_v2'(跟 V1 结构隔离,防混淆)。
 * 额外带回 attestedWinner/betsRoot/refundRoot/attestedAtMs(委员各自独立重算确认过的值, 供 submit 时组装 witness)。
 */
export function collectCloseSigsV2(marketId, payoutRoot) {
  const rows = sqlite.prepare(`
    SELECT payload FROM chain_events WHERE event_type = 'bshard_close_sig_v2'
      AND payload LIKE ? AND payload LIKE ?
  `).all(`%"market_id":"${marketId}"%`, `%"payout_root":"${payoutRoot}"%`);
  const byPk = new Map();
  for (const r of rows) {
    let p; try { p = JSON.parse(r.payload); } catch { continue; }
    if (p?.committee_pk && p?.signature && !byPk.has(p.committee_pk)) {
      byPk.set(p.committee_pk, {
        committee_pk: p.committee_pk, signature: p.signature, idx: p.idx, siblings_hex: p.siblings_hex, verdict: p.verdict,
        attestedWinner: p.attestedWinner, betsRoot: p.betsRoot, refundRoot: p.refundRoot, attestedAtMs: p.attestedAtMs,
      });
    }
  }
  const sigs = [...byPk.values()];
  return { ready: sigs.length >= QUORUM, sigs, count: sigs.length, quorum: QUORUM };
}

/**
 * markSubmittedV2 — 卡2③ landed-check 超时 crash-recovery 修复 (NWT tree-diff 终审发现, 2026-07-07)。
 *   submitCloseAttestV2 广播成功拿到 txId 后立刻调用(不等 landed-check 窗口结束), 把 txId 持久化进
 *   metadata.bshard_close_request_v2.bshard_close_submit_v2_pending_txid — 若 30s 轮询窗口内没确认落链
 *   (可能只是 RPC 瞬时延迟 false-negative), 下次 tick 靠这个字段直接查这一笔的现状, 不重新走 collect+submit
 *   全流程(=不会又构造+广播一笔新 tx)。单条同步 SQLite UPDATE, 同 publishCloseRequestV2 的原子性纪律。
 */
export function markSubmittedV2(marketId, txid, psContAddress) {
  const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) return { ok: false };
  let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
  if (!meta.bshard_close_request_v2) return { ok: false, reason: 'no bshard_close_request_v2 in metadata' };
  meta.bshard_close_request_v2.bshard_close_submit_v2_pending_txid = { txid, psContAddress };
  sqlite.prepare(`UPDATE pool_markets SET metadata = ? WHERE id = ?`).run(JSON.stringify(meta), marketId);
  return { ok: true };
}

/**
 * clearCloseRequest — submit LANDED 后清 request + 推进 status (settled/refunding by caller)。
 * 通用函数 (2026-07-07 J2, NWT 卡2 red-team 抓出的发现): 同时删 V1 key `bshard_close_request` 和 V2 key
 * `bshard_close_request_v2` — 两个 key 结构隔离(各自 publishCloseRequest/publishCloseRequestV2 独立写),
 * 但清理时不需要调用方知道自己在清哪个版本, 双 key 都 delete 是幂等操作 (不存在的 key delete 无副作用)。
 */
export function clearCloseRequest(marketId, finalStatus = 'completed') {
  const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) return { ok: false };
  let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
  delete meta.bshard_close_request;
  delete meta.bshard_close_request_v2;
  sqlite.prepare(`UPDATE pool_markets SET metadata = ?, protocol_status = ? WHERE id = ?`).run(JSON.stringify(meta), finalStatus, marketId);
  return { ok: true, status: finalStatus };
}

export { QUORUM };
