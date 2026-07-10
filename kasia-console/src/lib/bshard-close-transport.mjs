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
// 🔴 fix (Bettor+NWT 2026-07-08 23:2x, uqmp8 fee-input churn 死锁 #ba7z2c/#ba8vcr, 3 处同 key 之①):
// payout_root 单独当匹配 key 会跨 propose 轮次(仅 fee input 换新, root 巧合不变)把旧 image 的签名收进新
// image 广播——SighashType.All 下 preimage 不同, 链上验签必败。加 attestedAtMs 参数收窄成 (root, attestedAtMs)
// 复合 key, 保证收上来的每个 sig 都是【同一次 propose request 实例】签的, 不会跨 image 混装。
// attestedAtMs 可选(向后兼容旧调用点/离线诊断脚本): 缺省时退化回旧的 root-only 行为(调用方需自知风险)。
export function collectCloseSigsV2(marketId, payoutRoot, attestedAtMs = null) {
  const rows = sqlite.prepare(`
    SELECT payload FROM chain_events WHERE event_type = 'bshard_close_sig_v2'
      AND payload LIKE ? AND payload LIKE ?
  `).all(`%"market_id":"${marketId}"%`, `%"payout_root":"${payoutRoot}"%`);
  const byPk = new Map();
  for (const r of rows) {
    let p; try { p = JSON.parse(r.payload); } catch { continue; }
    if (attestedAtMs != null && String(p?.attestedAtMs) !== String(attestedAtMs)) continue;   // 跨 image 的旧签, 不收
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

/**
 * buildProposeCloseRequestV2 — propose 驱动薄壳固化(缺件2, J2 2026-07-08。设计文档
 * docs/2026-07-08-closezkv2-claim-driver-design.md §3.D)。是 _j2_uqmp8_propose_v2.mjs/_j2_3o0a6_propose_v2.mjs
 * 已两次真实验证过的模式(committee re-derivation/fee-leaves/preimage 组装/publishCloseRequestV2 调用)固化成
 * 可复用函数——去掉那两份脚本里逐市场手搓的一次性硬编码(post-absorb outpoint 补丁/固定 poolSompi/block hash
 * STOP-check 字面量), 换成读 DB/链实况。
 *
 * ⚠ 范围边界(不越界): 本函数**不做судить(judge)**——winningDirection/endBlockHash 由调用方显式提供(该市场的
 * judge_type 对应的裁决已经做完, 例如 blockhash_parity 独立复核/ESPN judgeLine 等, 那是一套独立的裁决管线,
 * 不是"propose 薄壳"该重新发明的东西, 见设计文档§3.D"薄壳只固化调用面, 不含自治判定")。
 *
 * @param {string} marketId  logical market id
 * @param {{winningDirection:0|1, endBlockHash:string, settlerRelayId:string, feeUtxo?:{outpointTxid,index}}} judged
 *   - winningDirection/endBlockHash: 该市场judge_type对应裁决的产物(调用方负责, 不在本函数内推导)
 *   - settlerRelayId: 发 relay 命令用哪个 relay(镜像既有脚本 SETTLER_RELAY 常量, 不硬编码进本函数)
 *   - feeUtxo: 可选, 复用已 fund 好的 fee UTXO(省一次 transfer+landed 等待, 同既有脚本 REUSE_FEE_TX 用法); 缺省
 *     则本函数自己 transfer 0.5 KAS 给 relay 自己地址做 fee input
 * @returns {Promise<{ok:boolean, marketId:string, claimedPayoutRoot:string}>}
 */
export async function buildProposeCloseRequestV2(marketId, judged) {
  const { winningDirection, endBlockHash, settlerRelayId, feeUtxo } = judged || {};
  if (winningDirection !== 0 && winningDirection !== 1) throw new Error('buildProposeCloseRequestV2: judged.winningDirection must be 0|1(调用方裁决产物, 本函数不推导)');
  if (!endBlockHash) throw new Error('buildProposeCloseRequestV2: judged.endBlockHash 必需');
  if (!settlerRelayId) throw new Error('buildProposeCloseRequestV2: judged.settlerRelayId 必需');

  const { sendCommandAsync } = await import('../services/relay-manager.js');
  const { reDeriveCommittee } = await import('./bshard-close-enforce.mjs');
  const { computeCommitteePkHash } = await import('../services/bshard-close-voter.js');
  const { fetchEndBlockHashCanonical, loadPoolSnapshot, recaptureSideLockDaaForMarket } = await import('../services/pool-market-settler-v06.mjs');
  const { canonicalBetOrder, computeBetsRoot, payoutRoot: computeMerkleRoot } = await import('./pool-payout-root.mjs');
  const { computePariMutuelPayout, settlePayoutRoot, deriveSettlementFeeLeaves } = await import('./pool-shard-settle.mjs');
  const { buildPoolMerkleTree, getPoolMerkleProof } = await import('../services/pool-merkle-v06.mjs');

  const market = sqlite.prepare('SELECT id, deadline, deadline_daa, maker_pk, broker_pk, broker_fee_pct, pool_merkle_root, resolution_rule_spec, market_metadata_hash FROM pool_markets WHERE id = ?').get(marketId);
  if (!market) throw new Error(`buildProposeCloseRequestV2: market ${marketId} not found`);
  let ps = sqlite.prepare('SELECT payout_redeem_hex, payout_ps_outpoint, payout_cov_id, pool_merkle_root, predicate_commit FROM payout_shards WHERE logical_market_id = ?').get(marketId);
  if (!ps) throw new Error(`buildProposeCloseRequestV2: no payout_shards row for ${marketId}`);

  const loadBettorsFlat = () => {
    const shards = sqlite.prepare('SELECT shard_market_id FROM market_shards WHERE logical_market_id = ? ORDER BY shard_index ASC').all(marketId);
    const mids = shards.length ? shards.map(s => s.shard_market_id) : [marketId];
    const out = [];
    for (const mid of mids) {
      for (const r of sqlite.prepare('SELECT bettor_pk, direction, stake_amount, side_lock_daa, side_lock_tx FROM pool_bettor_sides WHERE market_id = ?').all(mid)) {
        out.push({ pk: String(r.bettor_pk).toLowerCase(), direction: Number(r.direction), stake: String(r.stake_amount), side_lock_daa: r.side_lock_daa, side_lock_tx: r.side_lock_tx });
      }
    }
    return out;
  };

  // recapture(同既有脚本纪律, mempool-NULL side_lock_daa 补齐, 否则 canonicalBetOrder fail-loud)
  const shardIds = sqlite.prepare('SELECT shard_market_id FROM market_shards WHERE logical_market_id = ? ORDER BY shard_index ASC').all(marketId).map(s => s.shard_market_id);
  for (const sid of (shardIds.length ? shardIds : [marketId])) await recaptureSideLockDaaForMarket(sid);

  const rc = async (cmd, t = 90000) => {
    const r = await sendCommandAsync(settlerRelayId, cmd, t);
    if (r?.ok === false) { const e = new Error(cmd.type); e.relayErr = r.error; throw e; }
    return r;
  };

  // 事故修复(2026-07-08, pxvml首次实战propose撞到委员C1 BUST): payout_shards.payout_redeem_hex 是
  // genesis-only 静态列, 从没被 UPDATE 过——若该市场的 shard 还没"absorb"(consolidateAllShards, 把 shard
  // leaf 折进 PayoutShard covenant on-chain), 这一列的 consolidated_pool 永远停在 genesis 的 PS_SEED,
  // 不管 bettor 实际下了多少注, 委员独立重算(PS_SEED+Σ已注册stake)会跟这个假值对不上, 正确 REFUSE。
  // 镜像 bshard-settle-daemon.mjs:155-184 consolidateAndBuildPsState 的 needConsolidate 判断: 只有当真
  // 需要 absorb 时才发起链上 splice tx(有成本), 已 consolidate 过则纯读, 不重复上链。
  {
    const { consolidateAllShards } = await import('./pool-shard-settle.mjs');
    const shardRows = sqlite.prepare('SELECT status FROM market_shards WHERE logical_market_id = ?').all(marketId);
    const needConsolidate = shardRows.some(s => s.status === 'sealed' || s.status === 'open');
    if (needConsolidate) {
      const relayAddrForConsolidate = (await rc({ type: 'get_pubkey' })).address;
      const kaspaForP2sh = await import('kaspa-wasm');
      const p2shFn = (redeemHex) => kaspaForP2sh.addressFromScriptPublicKey(kaspaForP2sh.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), relayAddrForConsolidate.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet').toString();
      const { transferAndConfirm } = await import('../services/relay-manager.js');
      const { REORG_SAFE_MIN_DEPTH } = await import('./pool-shard-register.mjs');
      const landedFn = async (txid, addr) => { for (let i = 0; i < 25; i++) { const j = await sendCommandAsync(settlerRelayId, { type: 'check_utxo_landed', address: addr, txid, minDepth: REORG_SAFE_MIN_DEPTH }, 20000); if (j.landed || j.found) return true; await new Promise(r => setTimeout(r, 2000)); } return false; };
      const transferFn = async (addr, sompi) => { const r = await transferAndConfirm(settlerRelayId, addr, (Number(sompi) / 1e8).toFixed(8), { minDepth: REORG_SAFE_MIN_DEPTH, maxWaitMs: 60000 }); return r.txId; };
      const consolidateRes = await consolidateAllShards({
        db: sqlite, rc, landed: landedFn, p2sh: p2shFn, logicalMarketId: marketId,
        payoutShard: { payout_redeem_hex: ps.payout_redeem_hex, payout_ps_outpoint: ps.payout_ps_outpoint, payout_cov_id: ps.payout_cov_id },
        relayAddr: relayAddrForConsolidate, transfer: transferFn, deadline: Number(market.deadline),
      });
      // 🔴 STOP修正(NWT红队抓到, 2026-07-08): 第一版这里错调了 compilePayoutShardRedeem(V1专属, silverc
      // 重新走ctor编译)——pxvml是V2市场, V1重编译出的redeem字节结构跟链上实际V2 P2SH对不上, 且V1编译器
      // 还会把V2专属状态字段(attestedWinner/attestedAtMs/betsRootBaked/refundRootBaked)全部按V1的genesis
      // 占位符清零重置, 抹掉可能已存在的attest状态。改法: 不重新编译, 直接照抄consolidateAllShards内部
      // (pool-shard-settle.mjs:304-305)自己的splice手法——在原始ps.payout_redeem_hex(V2字节, genesis-baked,
      // 版本无关地保留)上, 同一个固定offset(state_start=1的[2..9]字节=consolidated_pool i64LE)原位写入
      // 新值, 不碰其余任何字节(V1/V2差异全部在这个offset之外, 这个offset两版本通用)。
      const absorbedRedeemBuf = Buffer.from(ps.payout_redeem_hex, 'hex');
      absorbedRedeemBuf.writeBigInt64LE(BigInt(consolidateRes.consolidatedPool), 2);
      const absorbedRedeemHex = absorbedRedeemBuf.toString('hex');
      // 🔴 二次事故修复(2026-07-08, pqpt85ts/pqqqra89地址混淆撞出): 上面只更新了本次调用内的局部变量 ps,
      // 从没把 splice 后的 payout_redeem_hex 写回 DB——payout_shards.payout_redeem_hex 这一列本次仍停在
      // genesis 字节, 任何下游独立读这一列的代码(诊断脚本/committee voter 若也走 DB 重建)会算出错误的
      // genesis 地址(consolidated_pool=旧值), 找不到钱(钱其实在正确的 post-splice 地址, 一分没丢, 只是
      // 地址算错了)。必须把 absorbedRedeemHex 也 UPDATE 回表, 不能只更新 payout_ps_outpoint。
      try { sqlite.prepare('UPDATE payout_shards SET payout_redeem_hex = ?, payout_ps_outpoint = ? WHERE logical_market_id = ?').run(absorbedRedeemHex, consolidateRes.psOutpoint, marketId); } catch {}
      ps = { ...ps, payout_redeem_hex: absorbedRedeemHex, payout_ps_outpoint: consolidateRes.psOutpoint };
    }
  }
  // 🔴 STOP修正(第二次propose实战撞到, 2026-07-08): psTx/psIdxStr 必须从上面 consolidation 之后的 ps
  // (可能已被 absorb 更新 payout_ps_outpoint)派生, 不能在 consolidation 块之前提前解构——否则下游构造
  // close request 的 tx input 会引用consolidation花掉的旧 outpoint("UTXO not found"), 这正是刚撞到的坑。
  const [psTx, psIdxStr] = String(ps.payout_ps_outpoint).split(':');

  const chainReader = {
    async getCurrentDaaScore() { const r = await rc({ type: 'chain_get_current_daa_score' }); return Number(r.daa_score); },
    async getBlockAtDaa(minDaa) { const r = await rc({ type: 'chain_get_block_at_daa', min_daa_score: minDaa }, 300000); return { hash: String(r.hash), daaScore: Number(r.daaScore) }; },
  };
  const resolutionRuleSpec = JSON.parse(market.resolution_rule_spec || '{}');
  const enforceCtx = {
    deadlineDaa: Number(market.deadline_daa), resolutionRuleSpec, chainReader,
    fetchEndBlockHashCanonical: async (reader, daa) => (await fetchEndBlockHashCanonical(reader, daa)).hash,
    loadPoolSnapshot: async (mid) => {
      const s = loadPoolSnapshot(mid);
      const mrow = sqlite.prepare('SELECT maker_pk, broker_pk, deadline_daa FROM pool_markets WHERE id = ?').get(mid);
      return {
        pool_merkle_root: s.pool_merkle_root,
        members: s.pool_pks.map((pk, i) => ({ pk_hex: String(pk).toLowerCase(), stake_sompi: s.pool_stakes[i] })),
        maker_pk: mrow?.maker_pk ? String(mrow.maker_pk).toLowerCase() : null,
        broker_pk: mrow?.broker_pk ? String(mrow.broker_pk).toLowerCase() : null,
        deadline_daa: mrow?.deadline_daa != null ? Number(mrow.deadline_daa) : Number(market.deadline_daa),
      };
    },
    loadBettors: async () => loadBettorsFlat(),
  };
  const committeePks = await reDeriveCommittee(marketId, enforceCtx, ps.payout_redeem_hex);

  const snap = loadPoolSnapshot(marketId);
  const tree = buildPoolMerkleTree(snap.pool_pks);
  const committeeMeta = {};
  for (const pk of committeePks) {
    const idx = tree.sortedPks.indexOf(pk);
    if (idx < 0) continue;
    committeeMeta[pk] = { idx, siblings_hex: getPoolMerkleProof(tree, idx).map(s => s.toString('hex')) };
  }

  const bettors = loadBettorsFlat();
  const nullDaa = bettors.filter(b => b.side_lock_daa == null).length;
  if (nullDaa) throw new Error(`buildProposeCloseRequestV2: ${nullDaa}/${bettors.length} bettors 仍 side_lock_daa NULL — 不能继续`);
  const ordered = canonicalBetOrder(bettors);
  // betsRoot/refundRoot 从 bettors 链推导(Bettor #bk28lo③ 教训: 能便宜链推导的字段优先链推导, 不图省事直读 DB)
  const newBetsRoot = computeBetsRoot(ordered.map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction }))).toString('hex');
  const newRefundRoot = computeMerkleRoot(ordered.map(b => ({ pk: b.pk, amount: b.stake }))).toString('hex');
  const newAttestedAtMs = Date.now();

  // P4/D-008(2026-07-09, J2): fee 单源派生, pool 基数=链上 PS 实额(含 seed), 非 Σ注(7/8 门②三说法之一的
  // 病根)。verify-value-source: consolidated_pool 从当前活 redeem_hex 现读(不信 payout_shards 表可能过期的
  // 缓存字段) —— propose 侧独立链读路径(设计文档 docs/2026-07-09-fee-single-source-leaf-derivation-design.md
  // §2, 与 enqueue/委员 voter 两侧各自独立现读, 禁互相透传值)。
  const realConsolidatedPool = Buffer.from(ps.payout_redeem_hex, 'hex').readBigInt64LE(2).toString();
  const { feeLeaves } = deriveSettlementFeeLeaves({ brokerPk: market.broker_pk, brokerFeePctBps: market.broker_fee_pct }, realConsolidatedPool);
  const pm = computePariMutuelPayout({ bettors, winningDirection, poolTotalSompi: realConsolidatedPool, feeLeaves });
  if (pm.degenerate) throw new Error(`buildProposeCloseRequestV2: degenerate payout(${pm.reason})`);
  const claimedPayoutRoot = settlePayoutRoot(pm.payoutLeaves && pm.payoutLeaves.length ? pm.payoutLeaves : pm.winners);

  // 命门①(既有脚本纪律): market_metadata_hash 必须 == genesis redeem[642] baked 值, 不吻合拒绝继续
  const onChainCommitAtV2Offset = ps.payout_redeem_hex.slice(642 * 2, (642 + 32) * 2);
  if (market.market_metadata_hash && String(market.market_metadata_hash).toLowerCase() !== onChainCommitAtV2Offset) {
    throw new Error(`buildProposeCloseRequestV2: 命门①mismatch — market_metadata_hash ${market.market_metadata_hash} != genesis redeem[642] ${onChainCommitAtV2Offset}`);
  }

  const relayAddr = (await rc({ type: 'get_pubkey' })).address;
  const z32 = '00'.repeat(32);
  const currentState = { consolidated_pool: realConsolidatedPool, closed: 0, payoutRoot: z32, attestedWinner: -1, attestedAtMs: 0, betsRootBaked: z32, refundRootBaked: z32 };

  const landed = async (txid, address, n = 30) => {
    for (let i = 0; i < n; i++) { const j = await rc({ type: 'check_utxo_landed', address, txid }, 20000); if (j.landed || j.found) return true; await new Promise(r => setTimeout(r, 2000)); }
    return false;
  };
  let feeTx = feeUtxo?.outpointTxid;
  if (!feeTx) {
    feeTx = (await rc({ type: 'transfer', target: relayAddr, amount: 0.5 })).txId;
    if (!await landed(feeTx, relayAddr)) throw new Error(`buildProposeCloseRequestV2: close fee fund ${feeTx} no land`);
  }
  const closeInputs = {
    payoutshard: { redeem_hex: ps.payout_redeem_hex, outpointTxid: psTx, index: Number(psIdxStr), state: currentState, state_start: 1 },
    fee: { address: relayAddr, outpointTxid: feeTx, index: feeUtxo?.index ?? 0 },
  };

  const { Transaction, TransactionOutput, payToAddressScript, Address, CovenantBinding, Hash } = await import('kaspa-wasm');
  const pre = await rc({
    type: 'bshard_close_attest_v2', inputs: closeInputs,
    witness: { self_out_idx: 0, new_payout_root: claimedPayoutRoot, new_attested_winner: winningDirection, new_bets_root: newBetsRoot, new_refund_root: newRefundRoot, new_attested_at_ms: newAttestedAtMs, committee: [], committee_pk_hash: computeCommitteePkHash(committeePks) },
    outputs: { change_address: relayAddr },
  });
  if (!pre?.preimage) throw new Error(`buildProposeCloseRequestV2: pre.preimage missing — ${JSON.stringify(pre).slice(0, 300)}`);
  const preimg = pre.preimage;
  const un = new Transaction({
    version: 1,
    inputs: preimg.inputs.map(i => ({ previousOutpoint: { transactionId: i.previousOutpoint.transactionId, index: i.previousOutpoint.index }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: { outpoint: { transactionId: i.previousOutpoint.transactionId, index: i.previousOutpoint.index }, amount: BigInt(i.amountSompi), scriptPublicKey: payToAddressScript(new Address(i.address)), blockDaaScore: 0n } })),
    outputs: preimg.outputs.map(o => new TransactionOutput(BigInt(o.value), payToAddressScript(new Address(o.address)), o.covenantId ? new CovenantBinding(0, new Hash(o.covenantId)) : undefined)),
    lockTime: 0n, gas: 0n, subnetworkId: '0'.repeat(40), payload: '',
  });
  const txSafeJson = un.serializeToSafeJSON();

  const poolMembers = snap.pool_pks.map((pk, i) => ({ pk_hex: String(pk).toLowerCase(), stake_sompi: String(snap.pool_stakes[i]) }));
  // 事故修复(2026-07-08, pxvml实战撞到C1 anti-swap"per-ticket行数0!=链上Σcount2"): 上一版这里漏了
  // shard_pool_id/bettors 两个字段——按接口注释(本文件 L16-17)snapshot.shards[i] 本该带
  // {...,shard_pool_id, bettors:[{pk,direction,stake}]}, 委员 C1 用 sh.bettors 做 anti-swap 逐 ticket
  // 链锚(bshard-close-enforce.mjs:815-817); 漏了 bettors 就退到用 sh.shard_market_id 查 DB, 但那字段
  // 也没带, 两条路都空手, per-ticket 循环零迭代。committee 仍会独立 checkUtxoLanded 重验(snapshot 只指路
  // 不受信), 这里只是把"指路"信息补齐, 不影响链锚验证的独立性。
  const snapshot = {
    shards: sqlite.prepare('SELECT shard_market_id, shard_index, shard_redeem_hex, current_leaf_state, current_leaf_outpoint FROM market_shards WHERE logical_market_id = ? ORDER BY shard_index ASC').all(marketId)
      .map(s => ({
        // shard_pool_id 不在这里算: bshard-close-enforce.mjs 消费端本就有 fallback(sh.shard_pool_id ||
        // _hex32(`${marketId}-shard-${idx}`)), 省一份可能不一致的重复计算, 让唯一那份计算逻辑负责。
        shard_index: s.shard_index, shard_market_id: s.shard_market_id,
        shard_redeem_hex: s.shard_redeem_hex, current_leaf_state: s.current_leaf_state, current_leaf_outpoint: s.current_leaf_outpoint,
        // side_lock_tx 加 (2026-07-11, 28mln shard9 phantom-leaf recovery, docs/2026-07-10-shard9-recovery-
        //   design.md, Bettor审计抓漏): bshard-close-enforce.mjs 的 excludeSideLockTx 排除只在 side_lock_tx
        //   字段存在时才能生效——之前这里没带这一列, cross-node snapshot 分支(sh.bettors)结构性拿不到
        //   判别值, 排除会静默失效。只加 SELECT 列 + 透传, 不改现有字段/顺序 (向后兼容, 零行为变化)。
        bettors: sqlite.prepare('SELECT bettor_pk pk, direction, stake_amount stake, side_lock_tx FROM pool_bettor_sides WHERE market_id = ?').all(s.shard_market_id)
          .map(r => ({ pk: String(r.pk).toLowerCase(), direction: Number(r.direction), stake: String(r.stake), side_lock_tx: r.side_lock_tx })),
      })),
  };
  const req = {
    txSafeJson, predicate: null, proposed_evidence: null, claimedPayoutRoot, psRedeemHex: ps.payout_redeem_hex,
    committee_pks: committeePks, committee_meta: committeeMeta, snapshot, input_index: 0,
    broker_pk: market.broker_pk, introducer_pk: null, maker_pk: market.maker_pk,
    data_source_canonical: null, pool_members: poolMembers, end_block_hash: endBlockHash, deadline_daa: Number(market.deadline_daa),
    new_attestedWinner: winningDirection, new_betsRoot: newBetsRoot, new_refundRoot: newRefundRoot, new_attestedAtMs: newAttestedAtMs,
    closeInputs,
  };
  publishCloseRequestV2(marketId, req);
  return { ok: true, marketId, claimedPayoutRoot };
}

/**
 * buildZkHandoffRequestV2 — 门①(J1tn, 2026-07-08 市场5彩排): 触发 PayoutShardV2 → CloseZkRepro4 的
 *   zk_handoff(entry 4)。close_attest_v2 落链后(closed=1)才能调, prove worker 需要这一步产出的
 *   zk_continuation 才会真正跑 job(今晚 pxvml 实战撞出的缺环: propose→attest 走完但没人触发这步)。
 *   复用 readPayoutShardV2AttestedState(bshard-close-enforce.mjs, J1 已有切片) + computeCloseZkTmplAnchor
 *   (pool-shard-register.mjs, J1 已有切片)——不重新实现任何字节构造逻辑, 只是把已经存在的两个函数接到
 *   一次真实 relay 调用上(同 propose 那次 gap 的形状: 函数写好了零调用点)。
 * @param {string} marketId
 * @param {object} args { settlerRelayId, dryRun? }
 * @returns {object} relay 返回值(dryRun:true 时 broadcasted:false + 可核字段; 否则含 txId)
 */
export async function buildZkHandoffRequestV2(marketId, args) {
  // 🔴 NWT footgun catch(2026-07-08): 默认 dryRun=true(安全默认), 跟 admin endpoint 层的
  //   `dry_run !== false` 默认值方向对齐——本函数是 exported 的, 未来若有人绕过 endpoint 直接
  //   import 调用忘记传 dryRun, 也默认走安全的 dry-run 而非误触发真广播, 两层防御一致不单靠调用方记参。
  const { settlerRelayId, dryRun = true } = args || {};
  if (!settlerRelayId) throw new Error('buildZkHandoffRequestV2: settlerRelayId 必需');

  const { sendCommandAsync } = await import('../services/relay-manager.js');
  const { readPayoutShardV2AttestedState } = await import('./bshard-close-enforce.mjs');
  const { computeCloseZkTmplAnchor } = await import('./pool-shard-register.mjs');

  const market = sqlite.prepare('SELECT id FROM pool_markets WHERE id = ?').get(marketId);
  if (!market) throw new Error(`buildZkHandoffRequestV2: market ${marketId} not found`);
  // verify-value-source: PS 当前 redeem 现读(不信任何缓存字段, 今晚三次 stale-read 教训) — closed==1
  // 由 readPayoutShardV2AttestedState 内部 fail-closed 校验(不是 close_attest_v2 刚落链的窗口会直接拒绝)。
  const ps = sqlite.prepare('SELECT payout_redeem_hex, payout_ps_outpoint FROM payout_shards WHERE logical_market_id = ?').get(marketId);
  if (!ps) throw new Error(`buildZkHandoffRequestV2: no payout_shards row for ${marketId}`);
  const state = readPayoutShardV2AttestedState(ps.payout_redeem_hex);   // throws if closed != 1(还没 attest / 状态已推进)

  // gateTmplHash/closeZkSilPath 必须跟这个市场 genesis-mint 时烤入 closeZkTmplAnchor 用的同一份值
  // (pool.js:_resolveZkNativeCtorExtras 同源常量), 不能另起一份——否则四段模板跟链上已烤的 anchor 对不上。
  // 🔴 STOP修正(2026-07-08, Bettor #cb42af 顺手抓到的同族雷): 硬编码 fallback 默认值会悄悄过期(511b0ead
  // 是 repro4 时代旧值, env 现在设了才没炸)——"默认值从没跟上"是今晚已经点过名的病, 这两个值本身跟哪个
  // guest image_id 绑定是money-path正确性的一部分, 不该允许在 env 缺失时静默沿用一个可能早过期的猜测值。
  // 缺 env 直接 throw, 逼调用方显式配置, 不留"看起来能跑但值可能不对"的窗口。
  if (!process.env.ZK_GATE_TMPL_HASH) throw new Error('buildZkHandoffRequestV2: ZK_GATE_TMPL_HASH env 必需(不接受硬编码 fallback, 该值随 guest image 变化易过期)');
  if (!process.env.ZK_CLOSEZK_SIL_PATH) throw new Error('buildZkHandoffRequestV2: ZK_CLOSEZK_SIL_PATH env 必需(不接受硬编码 fallback, 路径随归位进度变化)');
  // 根修(2026-07-09, NWT finding①(b)HIGH·docs/2026-07-09-NWT-redteam-gate-tmplhash-live-derive-66de59c6.md):
  // 这是 zk_handoff 铸 CloseZkV2 genesis 的实际调用点——pxvml 出生缺陷的历史事发路径原文("错值经 kanet.env
  // 烤进 pxvml genesis")。之前的 guard 只在 prove/close(genesis 下游)检查, genesis 本身这个点从没验过。
  // force=true: 走到这里已经是真实 zk_handoff 广播准备, 非 ZK 节点根本不会调这个函数, flag 没有可用性意义。
  const { ZK_GATE } = await import('./zk-close-builder.mjs');
  const { ensureGateTmplHashFresh } = await import('./gate-tmpl-hash.mjs');
  const { kaspaZk } = await import('../services/zk-prove-worker.mjs');
  ensureGateTmplHashFresh(ZK_GATE, kaspaZk, { force: true });
  const gateTmplHash = process.env.ZK_GATE_TMPL_HASH;
  const closeZkSilPath = process.env.ZK_CLOSEZK_SIL_PATH;
  const { templateA, templateB, templateC, templateD } = computeCloseZkTmplAnchor(closeZkSilPath, gateTmplHash);

  const rc = (cmd, t = 90000) => sendCommandAsync(settlerRelayId, cmd, t);
  const relayAddr = (await rc({ type: 'get_pubkey' })).address;

  // fee input 必须精确 == consolidated_pool(unlockBshardZkHandoff 硬性要求, PS output 本身无余付空间) —
  // 先转账精确这个数额到 relay 自己地址, 深确认(REORG_SAFE_MIN_DEPTH)落地后才喂进去(NO TX NO STATE)。
  const { transferAndConfirm } = await import('../services/relay-manager.js');
  const { REORG_SAFE_MIN_DEPTH } = await import('./pool-shard-register.mjs');
  const feeSompi = state.consolidatedPool;
  const feeTx = await transferAndConfirm(settlerRelayId, relayAddr, (Number(feeSompi) / 1e8).toFixed(8), { minDepth: REORG_SAFE_MIN_DEPTH, maxWaitMs: 90000 });

  const [psTx, psIdxStr] = String(ps.payout_ps_outpoint).split(':');
  const cmd = {
    type: 'bshard_zk_handoff',
    dryRun: dryRun === true,
    inputs: {
      payoutshard: {
        redeem_hex: ps.payout_redeem_hex, outpointTxid: psTx, index: Number(psIdxStr),
        state: { consolidated_pool: state.consolidatedPool.toString(), attestedWinner: state.attestedWinner, attestedAtMs: state.attestedAtMs, betsRootBaked: state.betsRootHex, refundRootBaked: state.refundRootHex },
      },
      fee: { address: relayAddr, outpointTxid: feeTx.txId, index: 0 },
    },
    witness: {
      self_out_idx: 0,
      template_a_hex: templateA.toString('hex'), template_b_hex: templateB.toString('hex'),
      template_c_hex: templateC.toString('hex'), template_d_hex: templateD.toString('hex'),
    },
    outputs: { change_address: relayAddr },
  };
  const result = await rc(cmd, 90000);
  // 🔴 landed-gated 持久化(2026-07-09, J2·docs/2026-07-09-zk-autonomy-three-parts-design.md (a)): 原逻辑拿到
  //   relay 广播 ack(result.txId)就立即持久化, 是 RPC 提交成功 != 链上真落地(NO TX NO STATE 铁律)。改用
  //   check_utxo_landed(minDepth=20, 走 relay, 不碰链——Console 不直连链是既有铁律)确认——该 relay 命令内部
  //   用 getUtxosByAddresses(address 过滤)找 outpoint, 找到即隐含"该 UTXO 的 scriptPubKey 确实属于这个地址"
  //   (服务端按地址过滤, 不会返回属于别的地址的 UTXO), 天然是 spk 原像断言, 不需要额外再验一遍。
  if (!dryRun && result?.txId) {
    let landedOk = false;
    for (let i = 0; i < 30; i++) {
      const j = await rc({ type: 'check_utxo_landed', address: result.closeZkAddress, txid: result.txId, minDepth: 20 }, 20000);
      if (j.landed || j.found) { landedOk = true; break; }
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!landedOk) {
      console.error(`[buildProposeCloseRequestV2/handoff] 🔴 market=${marketId.slice(-8)} txId=${result.txId} 广播 OK 但 landed 确认超时 — 零持久化(#22 族纪律: 广播成功不等于落链), 需人工核实链上实况后再定`);
      return result;
    }
    const { writeZkContinuation } = await import('./closezk-v2-mint.mjs');
    writeZkContinuation(marketId, {
      outpointTxid: result.txId, outpointIndex: 0, redeemHex: result.closeZkRedeemHex,
      valueSompi: state.consolidatedPool, attestedWinner: state.attestedWinner, attestedAtMs: state.attestedAtMs,
      sourceCloseAttestTxid: psTx, sourceZkHandoffTxid: result.txId,
    });
  }
  return result;
}

export { QUORUM };
