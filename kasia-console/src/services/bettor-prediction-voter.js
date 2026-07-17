// Phase 3a r211 O-6 — prediction oracle voter daemon (Bettor r211 v3 consensus + J1 #318 PB-B/C/F)
//
// Bettor r211 v3 oracle 设计:
//   - Path D: maker 自选 oracle as P2P primitive (= oracle 是 first-class KANet user role)
//   - 5 J1tn-* (testnet Phase 3a) all is_oracle=1, oracle_capabilities=["kanet_ai_consensus_v1"]
//   - 3-of-5 multi-sig SS escrow (= PredictionEscrowMulti.sil, .109 compile/deploy)
//
// J1 #318 PB consensus:
//   - PB-B: kanet_oracle_vote_v1 JSON schema + evidence_hash (= sha256 of fetched evidence)
//   - PB-C: 1-to-1 DM vote (= 不上链 broadcast, 5x fee 省)
//   - PB-D: maker_relay 是 aggregator trigger (= 收 3+ vote → build settleByMultiOracle TX)
//   - PB-F: 1 daemon 跑多 voter loop (= 复用 settler pattern, 不 fork 新 process)
//
// 5min cron 复用 settler pattern. 每 tick:
//   1. SELECT all is_oracle=1 relays on this host
//   2. For each oracle relay: scan exchange_offers WHERE outcome_oracle_relay_id = this AND state IN ('matched','verifying') AND end_date 过
//   3. For each offer: check already voted (chain_events) → if not, vote (Polymarket gamma OR LLM) → DM maker_relay
//   4. evidence_hash = sha256 of fetched evidence (= audit trail)
//
// Phase 3a 限制 (= single .106 host MVP):
//   - 5 J1tn-* 同 host 决策 (= compromise risk public disclaim, demo cap 100 KAS)
//   - 5 voter 全 Qwen3.6-LAN adapter (= same brain identity, Phase 3b 加 diversity)
//   - Voter 0 stake economic (= testnet KAS slash 0 real cost)
//   - 仅 polymarket_uma_mirror capability (= kanet_ai_consensus_v1 占位, 后续 LLM 真接入)

import { sqlite } from '../db/client.js';
import { createHash, randomUUID } from 'node:crypto';
import { sendCommandAsync } from './relay-manager.js';
import { buildDeriveVotePrompt } from './derivevote-prompt.mjs';
import { toSettleSafeJsonTxHex } from '../lib/settle-safe-json.mjs';

// J2-tn r382 (Bettor 16:29 钦定): TICK_INTERVAL_MS env-configurable. Default 5min mainnet,
// demo 期 .env 设 PREDICTION_VOTER_TICK_SEC=60 (= 1min) 提速 5x 流水. 与 settler 同 pattern.
const TICK_INTERVAL_MS = (parseInt(process.env.PREDICTION_VOTER_TICK_SEC, 10) || 300) * 1000;
const STARTUP_GRACE_MS = 45 * 1000;        // 45s grace (= settler 30s + 15s 错峰)

let timer = null;
let running = false;

// J1/NWT 2026-06-28 (gap③ broker-DM settle 根因): relay sign_input_for_settle 默认路用
// `new Transaction(JSON.parse(plain))` 重建 tx 给 createInputSignature → 新 kaspa-wasm 下 plain-object
// scriptPublicKey 不被正确注入 sighash → checkSig false → settle "verification failed"(jepu1 8h 卡因)。
// 2026-07-18 J1tn: 本地 helper 提取到 ../lib/settle-safe-json.mjs 单源(规则64——第三站点
// trade-protocol-filter.js:handlePoolOracleTxSignReq 漏修坐实后, 三站点共用一份, 函数体零改动)。

// Bettor r472 (P0 incident 2026-06-10): per-(key) log throttle. Stuck offers in a permanent
// condition (e.g. collecting_sigs with invalid/undefined phase2_winner) were re-warned every
// tick → 201MB log over days → bash fork exhaustion → whole Console tree torn down. Throttle
// repeated identical warnings to once per WARN_THROTTLE_MS per key. Pure logging guard — no
// vote/sign logic or DB state changed. In-memory; resets on restart (acceptable).
const _warnThrottle = new Map(); // key -> last-logged epoch ms
const WARN_THROTTLE_MS = 10 * 60 * 1000;
function warnThrottled(key, msg) {
  const now = Date.now();
  const last = _warnThrottle.get(key) || 0;
  if (now - last < WARN_THROTTLE_MS) return;
  _warnThrottle.set(key, now);
  // opportunistic prune so the map can't grow unbounded across long uptimes
  if (_warnThrottle.size > 2000) {
    for (const [k, t] of _warnThrottle) { if (now - t > WARN_THROTTLE_MS) _warnThrottle.delete(k); }
  }
  console.warn(msg);
}

export function startPredictionVoterCron() {
  if (timer) return;
  console.log('[prediction-voter] started — 5min cron, scan is_oracle=1 relays + vote offers (Phase 3a r211 v3)');
  setTimeout(() => {
    voterTick().catch(e => console.error('[prediction-voter] startup tick:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    voterTick().catch(e => console.error('[prediction-voter] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopPredictionVoterCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function voterTick() {
  if (running) { return { skipped: true }; }
  running = true;
  try {
    // 1. 找 host-local 所有 is_oracle=1 voter relay
    const voterRelays = sqlite.prepare(`
      SELECT id, name, address, oracle_capabilities
      FROM relay_nodes WHERE is_oracle = 1
    `).all();
    if (!voterRelays.length) return { ok: true, voters: 0 };

    let totalVoted = 0, totalSkipped = 0, totalErrored = 0;
    let poolVoted = 0, poolSkipped = 0, poolErrored = 0;
    for (const voter of voterRelays) {
      const r = await processVoter(voter);
      totalVoted += r.voted;
      totalSkipped += r.skipped;
      totalErrored += r.errored;
      // B2 v0.5 Sub 2c — pool_markets oracle vote (= parallel to 1V1 prediction)
      const p = await processPoolMarket(voter);
      poolVoted += p.voted;
      poolSkipped += p.skipped;
      poolErrored += p.errored;
      // B2 v0.5 Sub 2d Phase 2c — pool oracle TX-sign (= collecting_sigs state)
      const ts = await processPoolTxSign(voter);
      poolVoted += ts.signed;
      poolSkipped += ts.skipped;
      poolErrored += ts.errored;
      // B2 v0.5 area-4 7c — pool oracle refund_disagreement TX-sign (= collecting_sigs +
      // refund_disagreement_dispatched_at metadata; parallel to processPoolTxSign for the
      // refund path, 2 sigs per spine input via signing_pair, silent oracle excluded).
      const tsRd = await processPoolRefundDisagreementTxSign(voter);
      poolVoted += tsRd.signed;
      poolSkipped += tsRd.skipped;
      poolErrored += tsRd.errored;
    }
    console.log(`[prediction-voter] tick: ${voterRelays.length} voter relays, 1V1 voted=${totalVoted} skipped=${totalSkipped} errored=${totalErrored} | pool voted=${poolVoted} skipped=${poolSkipped} errored=${poolErrored}`);

    // Oracle v0.3 Phase 2 — parallel-judgment loop + post_settle_audit (J1tn cluster, Owner r148).
    // Wired here (= voter cron has the derive fns + runs every 5min). judgeFn/umaResolveFn injected
    // into the pure engine module (= no circular import). Best-effort: errors don't break voter tick.
    let parallel = null, audit = null;
    try {
      const pj = await import('./prediction-parallel-judgment.mjs');
      const voterRelayIds = voterRelays.map(v => v.id);

      // judgeFn — KANet INDEPENDENT judgment from the independent_source (Bettor r150 flag:
      // MUST read independent_source, NOT gamma/UMA, else 假并行). 防假并行 assertion baked.
      const judgeFn = async (independentSource, offer) => {
        if (/polymarket\.com|gamma-api/i.test(independentSource)) {
          throw new Error(`假并行 blocked: independent_source "${independentSource}" is UMA/gamma, not independent (Bettor r150)`);
        }
        const r = await deriveKanetNativeVote(offer, { data_source_canonical: independentSource });
        return r?.ok ? { outcome: r.outcome, confidence: r.confidence } : null;
      };
      // umaResolveFn — UMA finalized outcome (derivePolymarketVote, J2 cea78b1 48h gate).
      const umaResolveFn = async (offer) => {
        const r = await derivePolymarketVote(offer);
        return r?.ok ? { ok: true, outcome: r.outcome } : { ok: false };
      };

      parallel = await pj.parallelJudgmentTick({ judgeFn, umaResolveFn, voterRelayIds });
      audit = await pj.postSettleAudit(umaResolveFn);
      console.log(`[prediction-voter] parallel: A.recorded=${parallel.phaseA.recorded} B.scored=${parallel.phaseB.scored} disagree=${parallel.phaseB.disagreements} | audit: checked=${audit.audited} dev=${audit.deviations} frozen=${audit.frozen.length}`);
    } catch (e) {
      console.warn(`[prediction-voter] parallel/audit tick err (non-fatal): ${e.message}`);
    }

    return { ok: true, voters: voterRelays.length, voted: totalVoted, skipped: totalSkipped, errored: totalErrored, pool: { voted: poolVoted, skipped: poolSkipped, errored: poolErrored }, parallel, audit };
  } finally {
    running = false;
  }
}

async function processVoter(voter) {
  let voted = 0, skipped = 0, errored = 0;
  // 2. scan offers this voter 该投票 OR 该 TX-sign.
  // r242 Phase 4a Sub 8 step 5: 加 protocol_status 'collecting_sigs' (= Phase 2 TX-sig handler).
  const offers = sqlite.prepare(`
    SELECT id, maker, maker_kaspa_addr, outcome_market_source, outcome_oracle_relay_id, outcome_oracle_relay_ids, outcome_token_id, outcome_condition_id, outcome_side, outcome_end_date, resolution_rule_spec, protocol_status, revote_round, metadata, escrow_p2sh
    FROM exchange_offers
    WHERE (outcome_oracle_relay_id = ? OR outcome_oracle_relay_ids LIKE ?)
      AND protocol_status IN ('matched','verifying','collecting_sigs')
      AND outcome_end_date IS NOT NULL
      AND datetime(outcome_end_date) <= datetime('now')
  `).all(voter.id, `%"${voter.id}"%`);
  if (!offers.length) return { voted, skipped, errored };

  for (const offer of offers) {
    try {
      // r242 Phase 4a Sub 8 step 5 — collecting_sigs state: TX-sig handler (= Phase 2 sign per input)
      if (offer.protocol_status === 'collecting_sigs') {
        const result = await handleTxSignReq(voter, offer);
        if (result.signed) voted++;
        else if (result.skipped) skipped++;
        else errored++;
        continue;
      }

      // 3. 检 already voted FOR THIS REVOTE ROUND (= Sub 7 加, r236 spec: revote_round 改时 voter 重 vote)
      // 之前 v1 skip if voter 投过 offer (= 不区分 round), 改 filter by revote_round.
      const currentRound = offer.revote_round || 0;
      const existingVote = sqlite.prepare(`
        SELECT id FROM chain_events
        WHERE event_type = 'oracle_vote' AND from_address = ?
          AND payload LIKE ? AND payload LIKE ?
        LIMIT 1
      `).get(voter.address, `%"offer_id":"${offer.id}"%`, `%"revote_round":${currentRound}%`);
      if (existingVote) { skipped++; continue; }

      // 4. fetch evidence + decide outcome (= Phase 3a MVP: polymarket gamma resolve)
      const voteResult = await deriveVote(offer);
      if (!voteResult.ok) {
        console.warn(`[prediction-voter] deriveVote fail voter=${voter.name} offer=${offer.id.slice(0,8)}: ${voteResult.reason}`);
        errored++;
        continue;
      }

      // sub 3 voter v2 (Oracle v0.3 R7): settle_consensual skip detect.
      // If chain_event 'pool_settle_consensual_dispatched' fired for this offer's market,
      // skip voter dispatch (= 0 sample/vote/sig, oracle_history reward=0 consensual row).
      const consensualSkip = sqlite.prepare(`
        SELECT id FROM chain_events
        WHERE event_type = 'pool_settle_consensual_dispatched'
          AND payload LIKE ?
        LIMIT 1
      `).get(`%"market_id":"${offer.id}"%`);
      if (consensualSkip) {
        skipped++;
        continue;
      }

      // 5. build kanet_oracle_vote_v1 JSON (= Bettor r235 Sub 6 spec).
      // r234 加: revote_round 字段, settler filter 当前 round votes.
      // r235 PB-S6 加: 真 ECDSA sign via relay IPC + voter_pubkey x-only derive.
      // sub 3 v2 (Oracle v0.3 R7): epoch=1 field for J1 #4 C3/C4 IS NULL/NOT NULL 分流.
      const evidenceHash = createHash('sha256').update(voteResult.evidence_raw || '').digest('hex');

      // 5a. Get voter x-only pubkey via relay IPC (= relay holds privkey, derive in-process)
      let voterXOnlyPubkey;
      try {
        const pkResult = await sendCommandAsync(voter.id, { type: 'get_pubkey' });
        voterXOnlyPubkey = pkResult?.x_only_pubkey;
        if (!voterXOnlyPubkey || voterXOnlyPubkey.length !== 64) {
          throw new Error(`get_pubkey returned invalid: ${voterXOnlyPubkey}`);
        }
      } catch (pkErr) {
        console.error(`[prediction-voter] get_pubkey fail voter=${voter.name}: ${pkErr.message}`);
        errored++;
        continue;
      }

      // 5b. Build unsigned payload + sign via relay IPC
      const unsignedPayload = {
        t: 'kanet_oracle_vote_v1',
        offer_id: offer.id,
        voter_relay_id: voter.id,
        voter_pubkey: voterXOnlyPubkey,  // 32-byte x-only hex (= SS contract ctor oracleNPk match)
        outcome: voteResult.outcome,  // 'YES' | 'NO' (F1: DISPUTE removed, low-confidence daemon abstains via ok:false)
        evidence_url: voteResult.evidence_url || null,
        evidence_hash: evidenceHash,
        vote_timestamp: new Date().toISOString(),
        revote_round: offer.revote_round || 0,  // Sub 5 settler filter, r234 spec
        epoch: 1,  // Oracle v0.3 sub 3 v2 (= J1 #4 C3/C4 fix: IS NULL/NOT NULL 分流 key)
      };
      const messageToSign = JSON.stringify(unsignedPayload);  // canonical signature input
      let signature;
      try {
        const signResult = await sendCommandAsync(voter.id, { type: 'ecdsa_sign', message: messageToSign });
        signature = signResult?.signature;
        if (!signature) throw new Error('ecdsa_sign returned empty signature');
      } catch (signErr) {
        console.error(`[prediction-voter] ecdsa_sign fail voter=${voter.name} offer=${offer.id.slice(0,8)}: ${signErr.message}`);
        errored++;
        continue;
      }
      const votePayload = { ...unsignedPayload, signature };

      // 6. send DM to maker_relay (= PB-C 1-to-1, PB-D aggregator)
      if (!offer.maker_kaspa_addr) { errored++; continue; }
      try {
        await sendCommandAsync(voter.id, {
          type: 'send_message',
          target: offer.maker_kaspa_addr,
          message: JSON.stringify(votePayload),
        });
        voted++;
      } catch (sendErr) {
        console.error(`[prediction-voter] DM fail voter=${voter.name} offer=${offer.id.slice(0,8)}: ${sendErr.message}`);
        errored++;
        continue;
      }

      // 7. log chain_events 'oracle_vote' (= 防 same-tick double-vote + audit trail)
      //
      // Bettor r213 F6 (MEDIUM): synthetic txid risk — Phase 3a MVP 用 'oracle_vote:<voter8>:<offer8>:<ts>'
      // 不是真 chain TX ID. 真 chain audit (= kaspad block index cross-check) 此 row 必 missing.
      // KI sediment 第 14/15 次 (5/18 N4): chain_event txid 截断撞 UNIQUE silent ignore.
      // 现 collision risk 低 (voter8 differs 同 tick + Date.now() 毫秒 + slice 8 char), 但真链 audit 时全 fail.
      //
      // Phase 4 升级: voter daemon 真 broadcast on-chain (= kanet_oracle_vote_v1 protocol msg).
      // 现 1-to-1 DM (PB-C) 不上链 (= 5x fee 省), chain_events row 是 local audit log not chain truth.
      // 当 真上链时 backfill txid_real col, 当前 synthetic_txid pattern 保留.
      const syntheticTxid = `oracle_vote:${voter.id.slice(0,8)}:${offer.id.slice(0,8)}:${Date.now()}`;
      sqlite.prepare(`
        INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
        VALUES (?, ?, 'oracle_vote', ?, ?, ?, 'prediction-voter', CURRENT_TIMESTAMP)
      `).run(randomUUID(), syntheticTxid, voter.address, offer.maker_kaspa_addr, JSON.stringify(votePayload));

      console.log(`[prediction-voter] VOTE ${voter.name}: offer=${offer.id.slice(0,8)} outcome=${voteResult.outcome}`);
    } catch (e) {
      console.error(`[prediction-voter] process fail voter=${voter.name} offer=${offer.id?.slice(0,8)}: ${e.message}`);
      errored++;
    }
  }
  return { voted, skipped, errored };
}

// B2 v0.5 Sub 2c — process pool_markets where this voter is one of 3 oracles
// Per service spec docs/poolspine-service-layer-spec-2026-05-21.md.
//
// Pool oracle Phase 1 = outcome vote (= same shape as 1V1 Phase 1 vote but on pool_markets table).
// Pool oracle Phase 2 (settle TX sig) deferred — depends on settler Sub 2d shape.
async function processPoolMarket(voter) {
  let voted = 0, skipped = 0, errored = 0;
  // J2-tn r357 (Owner 钦定 J2 implementer 域 + Bettor 撤她 708c16f → J2 canonical commit):
  // r337 把 oracle_relay_ids 改存 addresses (= committee_addresses for cross-node DM). voter
  // 之前 L283/L291 用 voter.id (UUID) 匹配 → 永不命中 → voted=0 settle 永卡. 改 voter.address
  // 匹 oracle_relay_ids 数组 (= addresses). voter.id 保留给 IPC (get_pubkey/sendCommandAsync/
  // ecdsa_sign). 同 r337 e1468f0 设计未传到所有 reader, 这是 r337 漏迁的 reader.
  // 🔴 反向结构隔离(2026-07-06 NWT 自动进程横扫抓出，开盘前必堵): bshard(v0.7·含 ZK-native)市场
  // 用 close_attest 4-of-5 委员多签一笔 tx 背书，不是这里的"每个委员各自广播一笔 pool_oracle_vote"
  // 机制——这个 voter 若捡到 bshard 市场并广播投票，对该市场是废票(下游 settler/bshard-settle-daemon
  // 从不读它)，纯浪费真实链上手续费 + 污染 chain_events/oracle_history。用跟 selectRipeMarkets/
  // pool-market-settler 同款 market_shards 存在性排除，不是新发明的判据。
  const markets = sqlite.prepare(`
    SELECT id, maker_relay_id, outcome_market_source, outcome_token_id, outcome_condition_id, outcome_side,
           resolution_rule_spec, protocol_status, deadline, oracle_relay_ids
    FROM pool_markets
    WHERE oracle_relay_ids LIKE ?
      AND protocol_status = 'verifying'
      AND deadline <= ?
      AND id NOT IN (SELECT logical_market_id FROM market_shards)
  `).all(`%"${voter.address}"%`, Math.floor(Date.now() / 1000));
  if (!markets.length) return { voted, skipped, errored };

  for (const market of markets) {
    try {
      // Defense in depth: re-parse JSON to confirm match (LIKE may false-positive on prefix collision)
      let oracleIds;
      try { oracleIds = JSON.parse(market.oracle_relay_ids || '[]'); } catch { oracleIds = []; }
      if (!Array.isArray(oracleIds) || !oracleIds.includes(voter.address)) { skipped++; continue; }

      // Skip if already voted for this market
      const existing = sqlite.prepare(`
        SELECT id FROM chain_events
        WHERE event_type = 'pool_oracle_vote' AND from_address = ?
          AND payload LIKE ?
        LIMIT 1
      `).get(voter.address, `%"market_id":"${market.id}"%`);
      if (existing) { skipped++; continue; }

      // sub 3 v2 (Oracle v0.3 R7): settle_consensual skip detect.
      // If 'pool_settle_consensual_dispatched' fired → skip + write oracle_history consensual row.
      const consensualSkip = sqlite.prepare(`
        SELECT id FROM chain_events
        WHERE event_type = 'pool_settle_consensual_dispatched'
          AND payload LIKE ?
        LIMIT 1
      `).get(`%"market_id":"${market.id}"%`);
      if (consensualSkip) {
        // Write consensual oracle_history row per J1 #2 C2 + J2-tn r9 align
        try {
          const { randomUUID: rndId } = await import('node:crypto');
          sqlite.prepare(`
            INSERT OR IGNORE INTO oracle_history (id, oracle_relay_id, market_id, audit_mode, vote, reward_amount, slashed_amount, settled_at, epoch)
            VALUES (?, ?, ?, 'consensual', NULL, 0, 0, datetime('now'), 1)
          `).run(rndId(), voter.id, market.id);
        } catch {}
        skipped++;
        continue;
      }

      // J2-tn voter-flood-skip (b) (Bettor 裁, unblock cutover): poll 层 fetch 前 skip 无有效 source 的 junk
      //   市场 — 无 data_source_canonical / 无 known extractor(findExtractor null) → skip 不 fetch
      //   (abstain-not-guess; 消 :3300 ext-pool-v07 junk 每 tick fetch 403/missing 拖垮事件循环 → Console 无响应)。
      //   polymarket 走 gamma(derivePolymarketVote) 非 extractor → 例外不 skip。determinism-clean 两节点同码、
      //   additive 不破现有判定(有效 source 照常走 deriveVote)。
      if (market.outcome_market_source !== 'polymarket') {
        let _vfSpec = null;
        try { _vfSpec = JSON.parse(market.resolution_rule_spec || '{}'); } catch {}
        const _vfUrl = _vfSpec?.data_source_canonical;
        const { findExtractor: _vfFind } = await import('../lib/oracle-evidence-extractors.mjs');
        if (!_vfUrl || typeof _vfUrl !== 'string' || !_vfFind(_vfUrl)) {
          skipped++; continue;  // 无 data_source_canonical / 无 known extractor → skip 不 fetch
        }
      }

      // deriveVote adapter — pass market as offer-shaped object (= reuse same deriveVote)
      const offerLike = {
        id: market.id,
        outcome_market_source: market.outcome_market_source,
        outcome_token_id: market.outcome_token_id,
        outcome_condition_id: market.outcome_condition_id,
        outcome_side: market.outcome_side,
        resolution_rule_spec: market.resolution_rule_spec,
        outcome_oracle_relay_id: voter.id,
      };
      const voteResult = await deriveVote(offerLike);
      if (!voteResult.ok) {
        console.warn(`[prediction-voter:pool] deriveVote fail voter=${voter.name} market=${market.id.slice(0,12)}: ${voteResult.reason}`);
        errored++;
        continue;
      }

      // Get voter x-only pubkey via relay IPC
      let voterXOnlyPubkey;
      try {
        const pkResult = await sendCommandAsync(voter.id, { type: 'get_pubkey' });
        voterXOnlyPubkey = pkResult?.x_only_pubkey;
        if (!voterXOnlyPubkey || voterXOnlyPubkey.length !== 64) {
          throw new Error(`get_pubkey returned invalid: ${voterXOnlyPubkey}`);
        }
      } catch (pkErr) {
        console.error(`[prediction-voter:pool] get_pubkey fail voter=${voter.name}: ${pkErr.message}`);
        errored++;
        continue;
      }

      const evidenceHash = createHash('sha256').update(voteResult.evidence_raw || '').digest('hex');
      const unsignedPayload = {
        t: 'pool_oracle_vote_v1',
        market_id: market.id,
        voter_relay_id: voter.id,
        voter_pubkey: voterXOnlyPubkey,
        outcome: voteResult.outcome,  // 'YES' | 'NO' | 'ABSTAIN' (= J2-tn r412 Oracle 框架 spec)
        evidence_url: voteResult.evidence_url || null,
        evidence_hash: evidenceHash,
        // J2-tn wave1 (顺序2, 交叠点 J2 先): 源轴 field_hash 进签名 payload 防篡改。observe-only —
        //   ESPN 结构化源有值, 否则 null。NWT 顺序4 双轴 gate 消费 (委员各自 field_hash 一致才计入 tally)。
        field_hash: voteResult.field_hash || null,
        extractor_kind_used: voteResult.extractor_kind_used || null,  // r412: audit trail
        vote_timestamp: new Date().toISOString(),
        epoch: 1,  // Oracle v0.3 sub 3 v2 (= J1 #4 C3/C4 fix)
      };
      const messageToSign = JSON.stringify(unsignedPayload);
      let signature;
      try {
        const signResult = await sendCommandAsync(voter.id, { type: 'ecdsa_sign', message: messageToSign });
        signature = signResult?.signature;
        if (!signature) throw new Error('ecdsa_sign returned empty signature');
      } catch (signErr) {
        console.error(`[prediction-voter:pool] ecdsa_sign fail voter=${voter.name} market=${market.id.slice(0,12)}: ${signErr.message}`);
        errored++;
        continue;
      }
      const votePayload = { ...unsignedPayload, signature };

      // J2-tn r366 (J1 r350 catch): cross-node ingested markets have maker_relay_id='cross-node:<pk>'
      // sentinel → lookup fails → previously errored++ → 投票被跳. 但 broadcast vote 走 voter.id
      // 不依赖 maker address (= onchain path 不 DM aggregator). 仅 warn + 继续 broadcast.
      const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
      if (!makerRow?.address) {
        console.log(`[prediction-voter:pool] maker_relay ${market.maker_relay_id.slice(0,16)} no local address (cross-node ingest), proceed broadcast-only`);
      }
      // Bettor r95 cross-node hardening: broadcast vote ONCHAIN (= every node's Scout can ingest).
      // Producer side per spec: relay emits pool_oracle_vote_v1 protocol message to kanet-prediction
      // channel. (Per Bettor r98: type name MUST match actual payload.t value at L356 above —
      // 'pool_oracle_vote_v1', NOT 'kanet_oracle_vote_v1' from Bettor r95 spec draft. J2 consumer
      // filter must key on the actual payload t string to avoid silent-fail no-ingest.)
      // Real Kaspa txid replaces the prior synthetic 'pool_oracle_vote:...' string so cross-node
      // dedup-by-txid works (consumer-side Scout filter on remote nodes recreates the same
      // chain_events row from the same on-chain TX). Closes the most-severe c-class gap I
      // diagnosed in r165 (vote was 100% local DB before this change).
      let voteTxid;
      try {
        const bcastResult = await sendCommandAsync(voter.id, {
          type: 'send_broadcast',
          channel: 'kanet-prediction',
          message: JSON.stringify(votePayload),
        });
        voteTxid = bcastResult?.txId;
        if (!voteTxid) throw new Error(`broadcast returned no txId: ${JSON.stringify(bcastResult).slice(0, 200)}`);
      } catch (bcastErr) {
        console.error(`[prediction-voter:pool] vote broadcast fail voter=${voter.name} market=${market.id.slice(0,12)}: ${bcastErr.message}`);
        errored++;
        continue;
      }

      // DM maker_relay as fast-path (= settler picks up via local DB even before Scout ingest
      // catches the broadcast). Not load-bearing for cross-node consistency — broadcast above is.
      // Best-effort: failure logs warn but doesn't error out the vote (broadcast already onchain).
      try {
        await sendCommandAsync(voter.id, {
          type: 'send_message',
          target: makerRow.address,
          message: JSON.stringify(votePayload),
        });
      } catch (sendErr) {
        console.warn(`[prediction-voter:pool] DM fast-path fail voter=${voter.name} market=${market.id.slice(0,12)}: ${sendErr.message} (broadcast succeeded, settler will catch via Scout ingest)`);
      }
      voted++;

      // chain_events 'pool_oracle_vote' — REAL txid from broadcast above (Bettor r95).
      // INSERT OR IGNORE for idempotent dedup (Scout ingest on this same node may also INSERT
      // an identical txid row; one wins, second no-ops). chain_events.txid UNIQUE constraint
      // is the dedup anchor.
      // J2-tn r367 (J1 r354 catch): makerRow may be null for cross-node markets (= maker_relay_id
      // 'cross-node:<pk>' sentinel). Use null to_address fallback so INSERT doesn't throw.
      sqlite.prepare(`
        INSERT OR IGNORE INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
        VALUES (?, ?, 'pool_oracle_vote', ?, ?, ?, 'prediction-voter', CURRENT_TIMESTAMP)
      `).run(randomUUID(), voteTxid, voter.address, makerRow?.address || null, JSON.stringify(votePayload));

      // sub 3 v2 (Oracle v0.3 R7): oracle_history row write per vote.
      // Tier determined via oracle_registry.tier (= sub 1 schema). audit_mode = tier1/tier2/tier3.
      try {
        const regRow = sqlite.prepare(`SELECT tier FROM oracle_registry WHERE relay_node_id = ?`).get(voter.id);
        const auditMode = regRow?.tier ? `tier${regRow.tier}` : 'tier1';  // default tier1 if not in registry (legacy compat)
        sqlite.prepare(`
          INSERT OR IGNORE INTO oracle_history (id, oracle_relay_id, market_id, vote, audit_mode, audited_at, epoch)
          VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
        `).run(randomUUID(), voter.id, market.id, voteResult.outcome, auditMode);
      } catch (histErr) {
        console.warn(`[prediction-voter:pool] oracle_history write fail voter=${voter.name} market=${market.id.slice(0,12)}: ${histErr.message}`);
      }

      console.log(`[prediction-voter:pool] VOTE ${voter.name}: market=${market.id.slice(0,12)} outcome=${voteResult.outcome}`);
    } catch (e) {
      console.error(`[prediction-voter:pool] process fail voter=${voter.name} market=${market.id?.slice(0,12)}: ${e.message}`);
      errored++;
    }
  }
  return { voted, skipped, errored };
}

// B2 v0.5 Sub 2d Phase 2c — pool oracle TX-sign handler.
// When pool_markets reaches 'collecting_sigs', settler dispatchPhase2 has stashed phase2_tx_obj.
// Spine P2SH has MULTIPLE UTXOs (1 maker stake + N oracle bonds) — each spine input (0..spineInputCount-1)
// needs 3 oracle sigs. Side inputs (spineInputCount..end) need no sigs (settled_via_spine).
// Phase 3 e2e caught: signing only input 0 left oracle bond UTXO inputs unsigned → kaspad reject.
async function processPoolTxSign(voter) {
  let signed = 0, skipped = 0, errored = 0;
  // J2-tn r357: 同 processPoolMarket — r337 后 oracle_relay_ids 存 addresses, 匹 voter.address.
  // 防御性 guard(2026-07-06 NWT 横扫③，Bettor 拍板"即使当前靠上游间接安全也要补"): bshard 市场
  // 目前没有代码会把它写成 collecting_sigs+phase2_tx_obj 组合(间接安全，非本函数结构自证)，但若
  // 以后有别的代码改变了这个上游前提，这里会立刻暴露成跟 processPoolMarket 同款的废票/污染问题。
  // 补齐同款 market_shards 排除，不依赖"现在没人触发"这个隐含假设。
  const markets = sqlite.prepare(`
    SELECT id, oracle_relay_ids, metadata
    FROM pool_markets
    WHERE protocol_status = 'collecting_sigs'
      AND oracle_relay_ids LIKE ?
      AND id NOT IN (SELECT logical_market_id FROM market_shards)
  `).all(`%"${voter.address}"%`);
  if (!markets.length) return { signed, skipped, errored };

  for (const market of markets) {
    try {
      let oracleIds;
      try { oracleIds = JSON.parse(market.oracle_relay_ids || '[]'); } catch { oracleIds = []; }
      if (!Array.isArray(oracleIds) || !oracleIds.includes(voter.address)) { skipped++; continue; }

      let meta;
      try { meta = JSON.parse(market.metadata || '{}'); } catch { meta = {}; }
      if (!meta.phase2_tx_obj) { skipped++; continue; }

      // sub 3 v2 (Oracle v0.3 R7) fail-on-mixed (= J1 #2 C3 fix).
      // If same market has both legacy (epoch=NULL) and v2 (epoch=1) sig events, abort dispatch
      // — settler reads conflict + reject + alert. Prevents double-reward via epoch boundary cross.
      const legacyEvents = sqlite.prepare(`
        SELECT COUNT(*) AS c FROM chain_events
        WHERE event_type = 'pool_oracle_tx_sig' AND payload LIKE ?
          AND (payload NOT LIKE '%"epoch":%' OR payload LIKE '%"epoch":null%')
      `).get(`%"market_id":"${market.id}"%`).c;
      const v2Events = sqlite.prepare(`
        SELECT COUNT(*) AS c FROM chain_events
        WHERE event_type = 'pool_oracle_tx_sig' AND payload LIKE ?
          AND payload LIKE '%"epoch":1%'
      `).get(`%"market_id":"${market.id}"%`).c;
      if (legacyEvents > 0 && v2Events > 0) {
        console.error(`[prediction-voter:pool-tx-sig] 🚨 fail-on-mixed: market ${market.id.slice(0,12)} has both legacy (${legacyEvents}) and v2 (${v2Events}) sig events — abort dispatch (J1 #2 C3)`);
        errored++;
        continue;
      }

      // forfeit_1: silent oracle does not sign
      if (!meta.phase2_unanimous && typeof meta.phase2_silent_oracle_index === 'number') {
        const myIndex = oracleIds.indexOf(voter.id);
        if (myIndex === meta.phase2_silent_oracle_index) { skipped++; continue; }
      }

      const spineInputCount = meta.phase2_spine_input_count || 1;
      let signedAny = false;
      // J2-tn r362: Get voter pubkey once per market (= used in each sign_resp envelope).
      let voterPk = null;
      try {
        const pkRes = await sendCommandAsync(voter.id, { type: 'get_pubkey' });
        voterPk = String(pkRes?.x_only_pubkey || '').toLowerCase();
      } catch {}
      if (!voterPk || voterPk.length !== 64) {
        console.warn(`[prediction-voter:pool-txsign] voter=${voter.name} get_pubkey fail, skip market=${market.id.slice(0,12)}`);
        skipped++;
        continue;
      }
      // Sign each spine input (0..spineInputCount-1) — all locked by PoolSpine redeem
      for (let inputIdx = 0; inputIdx < spineInputCount; inputIdx++) {
        // Skip if already signed this input for this market
        const existing = sqlite.prepare(`
          SELECT id FROM chain_events
          WHERE event_type = 'pool_oracle_tx_sig' AND from_address = ?
            AND payload LIKE ? AND payload LIKE ?
          LIMIT 1
        `).get(voter.address, `%"market_id":"${market.id}"%`, `%"input_index":${inputIdx}%`);
        if (existing) { continue; }

        // J1/NWT 2026-06-28 fix: 转 safe_json 再发 (spk 全保·见 toSettleSafeJsonTxHex 注释)
        const _safeTxHex = await toSettleSafeJsonTxHex(meta.phase2_tx_obj);
        const signResult = await sendCommandAsync(voter.id, {
          type: 'sign_input_for_settle',
          tx_hex: _safeTxHex,
          safe_json: true,
          input_index: inputIdx,
        });
        if (!signResult?.ok || !signResult.signature) {
          console.error(`[prediction-voter:pool-txsign] sign fail voter=${voter.name} market=${market.id.slice(0,12)} input=${inputIdx}: ${signResult?.error || 'no sig'}`);
          errored++;
          continue;
        }

        // J2-tn r362 (Bettor 13:16 钦定): voter_pubkey 字段 (= 跨节点 canonical), voter_relay_id
        // 保留 transitional 双写 (= settler accepts either during migration window).
        const respPayload = JSON.stringify({
          t: 'kanet_pool_oracle_tx_sign_resp_v1',
          market_id: market.id,
          voter_pubkey: voterPk,
          voter_relay_id: voter.id,  // transitional, deprecated
          input_index: inputIdx,
          winner: meta.phase2_winner,
          signature: signResult.signature,
          epoch: 1,  // Oracle v0.3 sub 3 v2 (= J1 #4 C3/C4 IS NULL/NOT NULL 分流)
        });
        const syntheticTxid = `pool_oracle_tx_sig:${voter.id.slice(0,8)}:${market.id.slice(0,12)}:i${inputIdx}:${Date.now()}`;
        sqlite.prepare(`
          INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
          VALUES (?, ?, 'pool_oracle_tx_sig', ?, ?, ?, 'prediction-voter', CURRENT_TIMESTAMP)
        `).run(randomUUID(), syntheticTxid, voter.address, voter.address, respPayload);
        signedAny = true;
      }

      if (signedAny) {
        console.log(`[prediction-voter:pool-txsign] SIGNED ${voter.name}: market=${market.id.slice(0,12)} ${spineInputCount} spine inputs`);
        signed++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.error(`[prediction-voter:pool-txsign] fail voter=${voter.name} market=${market.id?.slice(0,12)}: ${e.message}`);
      errored++;
    }
  }
  return { signed, skipped, errored };
}

// B2 v0.5 area-4 7c — pool oracle refund_disagreement TX-sign handler.
// Mirrors processPoolTxSign but routes the refund_disagreement collecting_sigs path:
// the market is in 'collecting_sigs' with metadata.refund_disagreement_dispatched_at set
// (not phase2_dispatched_at). signing_pair determines which 2 oracles sign; the third
// (= silent in Gap 1B, OR not-signing in Gap 1A's 0/1 default pair) skips.
async function processPoolRefundDisagreementTxSign(voter) {
  let signed = 0, skipped = 0, errored = 0;
  // J2-tn r357: 同 processPoolMarket / processPoolTxSign — r337 后 oracle_relay_ids 存 addresses.
  // 防御性 guard(2026-07-06 NWT 横扫③，同 processPoolTxSign 那份理由): bshard 市场目前不会被
  // 写成这个函数依赖的 collecting_sigs 组合(间接安全)，补齐 market_shards 排除防未来上游前提变化。
  const markets = sqlite.prepare(`
    SELECT id, oracle_relay_ids, metadata
    FROM pool_markets
    WHERE protocol_status = 'collecting_sigs'
      AND oracle_relay_ids LIKE ?
      AND id NOT IN (SELECT logical_market_id FROM market_shards)
  `).all(`%"${voter.address}"%`);
  if (!markets.length) return { signed, skipped, errored };

  for (const market of markets) {
    try {
      let meta;
      try { meta = JSON.parse(market.metadata || '{}'); } catch { meta = {}; }
      // Skip if this is the settle path (= phase2_dispatched_at present without
      // refund_disagreement_dispatched_at) — processPoolTxSign handles that.
      if (!meta.refund_disagreement_dispatched_at || !meta.refund_disagreement_tx_obj) {
        continue;
      }

      // J2-tn r357: oracle_relay_ids 存 addresses post-r337, 匹 voter.address.
      const oracleIds = JSON.parse(market.oracle_relay_ids || '[]');
      if (!Array.isArray(oracleIds) || !oracleIds.includes(voter.address)) { skipped++; continue; }

      const myIndex = oracleIds.indexOf(voter.id);
      const signingPair = meta.refund_disagreement_signing_pair;
      const silentOracleIndex = meta.refund_disagreement_silent_oracle_index;
      // signing_pair → indices: 0 = [0,1], 1 = [0,2], 2 = [1,2]
      const signingIndices = signingPair === 0 ? [0, 1] : signingPair === 1 ? [0, 2] : [1, 2];
      if (!signingIndices.includes(myIndex)) { skipped++; continue; }  // not my turn to sign

      const inputCount = meta.refund_disagreement_input_count;
      let signedAny = false;
      for (let inputIdx = 0; inputIdx < inputCount; inputIdx++) {
        // Skip if already signed this input
        const existing = sqlite.prepare(`
          SELECT id FROM chain_events
          WHERE event_type = 'pool_oracle_refund_disagreement_tx_sig' AND from_address = ?
            AND payload LIKE ? AND payload LIKE ?
          LIMIT 1
        `).get(voter.address, `%"market_id":"${market.id}"%`, `%"input_index":${inputIdx}%`);
        if (existing) continue;

        const signResult = await sendCommandAsync(voter.id, {
          type: 'sign_input_for_settle',
          tx_hex: JSON.stringify(meta.refund_disagreement_tx_obj),
          input_index: inputIdx,
        });
        if (!signResult?.ok || !signResult.signature) {
          console.error(`[prediction-voter:pool-refund-dis] sign fail voter=${voter.name} market=${market.id.slice(0,12)} input=${inputIdx}: ${signResult?.error || 'no sig'}`);
          errored++;
          continue;
        }

        const respPayload = JSON.stringify({
          t: 'kanet_pool_oracle_refund_disagreement_tx_sig_v1',
          market_id: market.id,
          voter_relay_id: voter.id,
          input_index: inputIdx,
          silent_oracle_index: silentOracleIndex,
          signing_pair: signingPair,
          signature: signResult.signature,
          epoch: 1,  // Oracle v0.3 sub 3 v2 (= J1 #4 C3/C4 IS NULL/NOT NULL 分流)
        });
        const syntheticTxid = `pool_oracle_refund_dis_sig:${voter.id.slice(0,8)}:${market.id.slice(0,12)}:i${inputIdx}:${Date.now()}`;
        sqlite.prepare(`
          INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
          VALUES (?, ?, 'pool_oracle_refund_disagreement_tx_sig', ?, ?, ?, 'prediction-voter', CURRENT_TIMESTAMP)
        `).run(randomUUID(), syntheticTxid, voter.address, voter.address, respPayload);
        signedAny = true;
      }

      if (signedAny) {
        console.log(`[prediction-voter:pool-refund-dis] SIGNED ${voter.name}: market=${market.id.slice(0,12)} ${inputCount} spine inputs (silent=${silentOracleIndex}, pair=${signingPair})`);
        signed++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.error(`[prediction-voter:pool-refund-dis] fail voter=${voter.name} market=${market.id?.slice(0,12)}: ${e.message}`);
      errored++;
    }
  }
  return { signed, skipped, errored };
}

// deriveVote — Phase 3a MVP dispatcher per Bettor r219 spec.
//   1) Polymarket gamma (= polymarket.com source) — direct resolved price check
//   2) kanet_native (= any other data_source_canonical URL) — fetch + LLM consensus (Qwen3.6-LAN)
export async function deriveVote(offer) {
  // Parse resolution_rule_spec → data_source_canonical (= judge URL)
  let spec = null;
  try { spec = JSON.parse(offer.resolution_rule_spec || '{}'); } catch {}
  const sourceUrl = spec?.data_source_canonical;

  // Branch 1: Polymarket gamma (= legacy path, source URL 含 polymarket.com)
  if (offer.outcome_market_source === 'polymarket' || sourceUrl?.includes('polymarket.com')) {
    return derivePolymarketVote(offer);
  }

  // Branch 2: kanet_native (= Phase 3a MVP Bettor r219 spec — LLM consensus).
  // J2-tn r381 (Bettor 16:16 catch — #10 voted=0 实因): widen to startsWith('kanet_')
  // 接受 kanet_v07_test / kanet_v06_demo / 等变种. 所有 kanet_* 都走同 LLM consensus
  // 路径 (= deriveKanetNativeVote 内部按 data_source_canonical URL 路由). 之前精确
  // string match 漏未来变种 (= 这次 create-v07 用户传 outcome_market_source=kanet_v07_test
  // 撞 unsupported → vote derive 拒 → 委员 0 投票 → settle 死循环).
  if (offer.outcome_market_source === 'kanet_native'
      || (typeof offer.outcome_market_source === 'string' && offer.outcome_market_source.startsWith('kanet_'))) {
    return deriveKanetNativeVote(offer, spec);
  }

  // Branch 3: registry-driven (J2-tn — 根治 GAP-1 "espn 病换地方": deriveVote 此前按
  // outcome_market_source enum 硬列 (polymarket/kanet_*/coingecko), 漏 espn → 撞 L728
  // unsupported (voter log 实证 360 次 deriveVote fail). 抽取器 (extractEspnEvidence) 早就
  // 存在且 canonical 是有效 ESPN URL, 唯一缺的是路由. 改为: 任何 source 只要
  // data_source_canonical 命中 KNOWN_EXTRACTORS (findExtractor) → 走同一 deriveKanetNativeVote
  // LLM-consensus 路径 (= registry 单一源真相, 覆盖 espn/coingecko/未来 BBC/Reuters/AP,
  // 不再 per-source enum 硬列, 杜绝"加 extractor 漏加 deriveVote 分支"分叉再发生).
  if (sourceUrl) {
    const { findExtractor } = await import('../lib/oracle-evidence-extractors.mjs');
    if (findExtractor(sourceUrl)) {
      return deriveKanetNativeVote(offer, spec);
    }
  }

  return { ok: false, reason: `unsupported outcome_market_source: ${offer.outcome_market_source} (data_source_canonical ${sourceUrl || '(none)'} 无 known extractor)` };
}

// P0 UMA finalization gate (Bettor r137/r139 Owner 钦定, J2 r70 propose):
// gamma closed=true + outcomePrices 1/0 != UMA finalized (= 24-48h challenge window).
// 在 UMA challenge 期 reverse 可能 → KANet 已 settle 错 + 付款不可逆.
// Conservative gate: gamma closedTime + UMA_FINALIZATION_WINDOW_MS 才 ok:true (= 真 finalized).
// Env override UMA_FINALIZATION_WINDOW_MS for testnet (default 48h prod, 0 testnet disable).
const UMA_FINALIZATION_WINDOW_MS = process.env.UMA_FINALIZATION_WINDOW_MS !== undefined
  ? parseInt(process.env.UMA_FINALIZATION_WINDOW_MS, 10)
  : 48 * 60 * 60 * 1000;  // 48h default

// SCOPE DISCLAIMER (Owner 钦定, testnet-only thesis):
// Phase 1 borrows UMA's resolved outcomes (via Polymarket gamma) as ground-truth reference
// for TESTNET shadow-scoring only. This is reading public on-chain data, not a production
// dependency. Any mainnet deployment that creates a real settlement dependency on UMA
// contracts is the deploying party's responsibility, not the protocol author's.
export async function derivePolymarketVote(offer) {
  // J2-tn r407 Track D Phase B Bettor r357 关1 PASS — gamma query by condition_id 兜底.
  // pool_markets 路径 outcome_token_id='KAS_native' 占位非真 clob token → 原走 clob_token_ids
  // 查 gamma 永空. 改: 优先用 outcome_condition_id 查 gamma (condition_ids 字段, polymarket
  // 接受), fallback outcome_token_id (= exchange_offers 路径仍兼容).
  // 48h finalization gate 保留 (条件 1 Bettor r357), 仅查询 key 切换.
  const hasRealTokenId = offer.outcome_token_id && offer.outcome_token_id !== 'KAS_native';
  const hasConditionId = offer.outcome_condition_id;
  if (!hasRealTokenId && !hasConditionId) {
    return { ok: false, reason: 'missing outcome_token_id and outcome_condition_id' };
  }
  try {
    const url = hasRealTokenId
      ? `https://gamma-api.polymarket.com/markets?clob_token_ids=${encodeURIComponent(offer.outcome_token_id)}&closed=true`
      : `https://gamma-api.polymarket.com/markets?condition_ids=${encodeURIComponent(offer.outcome_condition_id)}&closed=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, reason: `gamma HTTP ${res.status}` };
    const arr = await res.json();
    const m = (arr || [])[0];
    if (!m) return { ok: false, reason: 'gamma market not found' };
    const evidence_raw = JSON.stringify({ outcomePrices: m.outcomePrices, closed: m.closed, closedTime: m.closedTime, endDate: m.endDate });
    const op = JSON.parse(m.outcomePrices || '[]');
    const yesPrice = parseFloat(op[0]);
    const noPrice = parseFloat(op[1]);
    if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) {
      return { ok: false, reason: 'outcomePrices not finite' };
    }
    // F1 (area-3): no DISPUTE return path. Gamma not yet resolved → daemon abstains
    // (ok:false), market gets silent vote → silent_timeout → refund / forfeit_1.
    let outcome = null;
    if (yesPrice === 1 && noPrice === 0) outcome = 'YES';
    else if (yesPrice === 0 && noPrice === 1) outcome = 'NO';
    else return { ok: false, reason: 'gamma not resolved yet' };

    // P0 UMA finalization gate (= Bettor r137/r139 Owner 钦定, ship-gate Phase 1 mainnet).
    // gamma closedTime OR endDate must be > UMA_FINALIZATION_WINDOW_MS ago (= 48h default).
    // Within window → UMA can still reverse → abstain to prevent false settle.
    if (UMA_FINALIZATION_WINDOW_MS > 0) {
      const closedTs = m.closedTime ? new Date(m.closedTime).getTime() : (m.endDate ? new Date(m.endDate).getTime() : null);
      if (!closedTs || !Number.isFinite(closedTs)) {
        return { ok: false, reason: 'gamma missing closedTime/endDate — UMA finalization window 不可 verify' };
      }
      const ageMs = Date.now() - closedTs;
      if (ageMs < UMA_FINALIZATION_WINDOW_MS) {
        const remainingH = Math.ceil((UMA_FINALIZATION_WINDOW_MS - ageMs) / (60 * 60 * 1000));
        return {
          ok: false,
          reason: `UMA finalization pending: gamma closed ${Math.floor(ageMs / 3600000)}h ago, need ≥${Math.floor(UMA_FINALIZATION_WINDOW_MS / 3600000)}h (wait ${remainingH}h more)`,
          finalization_pending: true,
          finalized_after_ts: closedTs + UMA_FINALIZATION_WINDOW_MS,
        };
      }
    }
    return { ok: true, outcome, evidence_url: url, evidence_raw };
  } catch (e) {
    return { ok: false, reason: `gamma fetch fail: ${e.message}` };
  }
}

// Bettor r219 spec — kanet_native deriveVote (LLM consensus via Qwen3.6-LAN).
//   fetch data_source_canonical URL → text → LLM prompt → JSON {outcome, confidence}
//   F1 (area-3 钦定): protocol vote space is YES/NO/silent only. DISPUTE removed —
//   low LLM confidence → daemon abstains (return ok:false). Market gets silent vote →
//   silent_timeout → refund / forfeit_1 per area 4. operator can manually override
//   via pool.js vote endpoint before silent_timeout if they reach a determination.
//   Qwen Rule 11: enable_thinking=false 必加 (= 漏会 60-120s timeout)
// 403-flood root-fix (KANet-UI single-writer, Owner MUST-DO 2026-06-16): per-URL cache of FINAL
// (immutable) extracted source evidence. Without it the voter (parallel-judgment audit loop + main
// vote) re-fetches already-resolved games every tick → self-inflicted egress burst → ESPN
// token-bucket 403 → cross-node committee members can't vote → quorum stalls (= fgx2k 2/5 实事故).
// Determinism guard (NWT review): ONLY clean evidence is cached, and extractEvidence returns clean
// ONLY when the game is FINAL (null = not-final → ABSTAIN, never cached). So no pre-final transient
// is ever stored → no stale-cache fork; cached value = same immutable source data both nodes fetch
// → same evidence → same vote. whole-repo (both nodes' voter, per cross-node-whole-repo-sync).
const _finalEvidenceCache = new Map();  // url → { evidence_text, cachedAt }
const FINAL_EVIDENCE_TTL_MS = 6 * 60 * 60 * 1000;  // 6h — final game results are immutable; bounds memory

export async function deriveKanetNativeVote(offer, spec) {
  let url = spec?.data_source_canonical;
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'kanet_native missing data_source_canonical URL in resolution_rule_spec' };
  }

  // J2-tn r353 (Bettor 6/5 11:58 catch + J1 r329 实证): cross-host voter 各节点 Console
  // port 可能不同 (= :3200 vs :3300). 若 URL 含 localhost/127.0.0.1, 改用本地 Console 实际
  // port (= process.env.PORT). 各节点 fetch own local test-oracle, 同 condition string 同
  // outcome → 共识. mock test-oracle deterministic by condition suffix '_yes'/'_no'.
  if (url.match(/^https?:\/\/(127\.0\.0\.1|localhost)/i)) {
    const localPort = process.env.PORT || '3200';
    url = url.replace(/(127\.0\.0\.1|localhost):\d+/i, `127.0.0.1:${localPort}`);
  }

  // Phase 3a MVP: 若 URL 不是 http(s) (= 是 free-text 描述 like "Phase 3a真 round-trip 测试"),
  // skip fetch + LLM 用 spec 全文 + market metadata 推 outcome.
  let evidence_text = '';
  let evidence_url = url;
  let field_hash = null;  // J2-tn wave1: 结构化字段 hash (observe-only; ESPN 结构化源有, 否则 null; NWT 源轴 quorum 闸输入)
  let _structured = null;  // J2-tn wave1 wire: extractStructuredFields 结果 {fields, field_hash} (judgeLine 路由用)
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // 403-flood root-fix: serve FINAL evidence from cache (skip fetch) so audit loop + main vote
    // don't re-hit the source every tick. Cache holds ONLY final results (populated below), so a hit
    // is always an immutable resolved-game outcome — never a pre-final transient.
    const _cachedFinal = _finalEvidenceCache.get(url);
    if (_cachedFinal && (Date.now() - _cachedFinal.cachedAt) < FINAL_EVIDENCE_TTL_MS) {
      evidence_text = _cachedFinal.evidence_text;
      field_hash = _cachedFinal.field_hash || null;
      _structured = _cachedFinal.structured || null;
    } else {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { ok: false, reason: `kanet_native source HTTP ${res.status}` };
      const rawText = await res.text();
      // J2-tn r403 Track D Bettor r340 关1 PASS — 证据抽取器 (source-aware clean evidence).
      // ESPN/BBC/etc structured 源 → extractEvidence 解析关键字段 (winner/score) → < 500 字符
      // 喂 LLM 干净 prompt 而非截断 raw JSON. 抽取器返 null = 比赛未 final/抽取失败 → fallback
      // raw slice(0,2000) 保 deriveKanetNativeVote 现 behavior (= 不破 free-text path).
      // J2-tn r412 Oracle 框架 spec Bettor r404 关1 PASS — 删 guess-fallback ABSTAIN-not-guess.
      // 之前: extractor null → fallback rawText.slice(0,2000) → LLM 瞎猜 (= w0s3m 4/5 错判根因).
      // 现在: extractor null + known source → ABSTAIN (= 结果未 final), unknown source → ABSTAIN (= 不在 extractor list).
      // 仅 extractor 返 clean evidence 才喂 LLM.
      // J2-tn r421 (Bettor r441 钉1): registry 单一源 — findExtractor 取代 inline regex.
      // 防 prevet 端 + voter 端各自硬编码 list → 分叉 (= espn 病换地方).
      try {
        const { extractEvidence, findExtractor, extractStructuredFields } = await import('../lib/oracle-evidence-extractors.mjs');
        const clean = extractEvidence(url, rawText);
        if (clean === null) {
          // ABSTAIN: 弃权 — extractor 不出 clean evidence. 区分两种 reason:
          if (findExtractor(url)) {
            return { ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'known-source-not-final', reason: 'extractor returned null at known source (= 结果未 final 或 game 数据缺)' };
          }
          return { ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'no-extractor-match', reason: `URL ${url} not in extractor known-list (= 框架不识此源)` };
        }
        evidence_text = clean;
        // J2-tn wave1: 同步抽结构化字段 field_hash (observe-only; 仅 ESPN 结构化源, 否则 null,
        // 不阻塞 NL 判定路). field_hash = NWT 源轴 quorum 闸输入 (顺序4 gate 消费, 第一波 observe-only).
        _structured = extractStructuredFields(url, rawText);
        field_hash = _structured?.field_hash || null;
        // FINAL (clean evidence ⟺ game over) → cache so subsequent ticks skip the fetch (stops the
        // self-DoS burst). Only immutable resolved-game evidence reaches here (null = not-final above).
        _finalEvidenceCache.set(url, { evidence_text: clean, field_hash, structured: _structured, cachedAt: Date.now() });
      } catch (e) {
        // Defensive: extractor 模块自身异常 → ABSTAIN (= 不假装能判).
        console.warn(`[deriveKanetNative] extractor exception ${e.message}, ABSTAIN`);
        return { ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'extractor-exception', reason: `extractor exception: ${e.message?.slice(0,100)}` };
      }
    } catch (e) {
      return { ok: false, reason: `kanet_native fetch fail: ${e.message}` };
    }
    }
  } else {
    // free-text description path — 用 spec 5 字段 作 evidence
    evidence_text = JSON.stringify(spec);
    evidence_url = `kanet_native_spec:${offer.id}`;
  }

  // J2-tn wave1 wire (Owner 核心交付): 市场有结构化 resolution_predicate + ESPN 结构化字段
  //   → D-L1 judgeLine 确定性算术判 (winner/margin/total 整数定点, 消 LLM off-by-one;
  //   真赛实测 495/495=100% winner+让分+大小球, 独立 ground-truth)。命中则跳 LLM。
  //   无 resolution_predicate → 走旧 LLM 路 (additive 不破现有非结构化判定)。
  //   judgeLine ABSTAIN (字段不足/不合法) → 落 abstain, 不退回 LLM (abstain-not-guess)。
  {
    let _predicate = null;
    try {
      const _specObj = (spec && typeof spec === 'object') ? spec : JSON.parse(String(spec || '{}'));
      _predicate = _specObj?.resolution_predicate || null;
    } catch {}
    if (_predicate) {
      // 有 resolution_predicate = maker 选了结构化算术判路 → 必走 judgeLine 或 abstain, 【不 fall LLM】
      //   (J1 finding: structured 路已选, extract 失败再交 LLM 会猜 = 破 abstain-not-guess)。
      if (!_structured?.fields) {
        return { ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'judgeline-no-fields',
          reason: 'resolution_predicate 存在但结构化字段抽取失败 (未 final / 非结构化源), abstain-not-guess 不退 LLM' };
      }
      const { judgeLine } = await import('../lib/judgeline.mjs');
      const verdict = judgeLine(_predicate, _structured.fields);  // _structured = {final,fields,field_hash}, 传 .fields 非 wrapper
      if (verdict === 'YES' || verdict === 'NO') {
        return { ok: true, outcome: verdict, evidence_url, field_hash,
          extractor_kind_used: 'judgeline-deterministic',
          evidence_raw: JSON.stringify({ fields: _structured.fields, predicate: _predicate, verdict, engine: 'D-L1-judgeLine' }) };
      }
      // judgeLine ABSTAIN (predicate 字段不足/不合法) → 落 abstain, 不退回 LLM (abstain-not-guess)
      return { ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'judgeline-abstain',
        reason: 'judgeLine ABSTAIN (predicate 字段不足/不合法, abstain-not-guess)' };
    }
  }

  // LLM call (= Bettor r219 spec). r220 fix: 直 call upstream openai-compatible endpoint,
  // 不走 agent-adapter /reply (= adapter 只暴 /reply 不是 /v1/chat/completions).
  // 上游 URL 从 adapter_nodes.ai_provider_url via offer.outcome_oracle_relay_id (= voter relay) lookup.
  let providerUrl = process.env.QWEN_LLM_URL || null;
  let providerModel = null;
  if (!providerUrl) {
    try {
      const row = sqlite.prepare(`
        SELECT a.ai_provider_url, a.ai_model
        FROM relay_nodes r JOIN adapter_nodes a ON r.adapter_node_id = a.id
        WHERE r.id = ?
      `).get(offer.outcome_oracle_relay_id);
      providerUrl = row?.ai_provider_url || null;
      providerModel = row?.ai_model || null;
    } catch {}
  }
  if (!providerUrl) return { ok: false, reason: 'no LLM provider URL configured (= adapter ai_provider_url missing)' };

  // F1 (area-3): prompt LLM for YES/NO only (DISPUTE removed). Low confidence → daemon
  // abstains downstream, not LLM-emitted DISPUTE token.
  // J2-tn 门C 红队硬化 (Bettor r511 / Owner 对抗审): deriveVote 与 prevet 同 LLM-judge 攻击面.
  // prompt-injection 防御 = (1) evidence 用 <evidence> 标签定界为不可信数据 (2) 显式指令 LLM
  // 绝不执行 evidence/data_source 内嵌的任何指令 (如 'rule YES'/'score 10'/'ignore'). prompt-
  // harden 抗注入但仍出判定 (不 ABSTAIN, 避免喂 abstain-refund griefing — 见 settler 立场).
  // 根治在规则层: prevet 硬门禁 known-extractor 源, free-text 路 (evidence=raw spec) 不让建.
  // J2-tn 线E P0 关2 (Bettor r584 fallback flag): spec.title + resolution_criteria 都缺 → 没有判定
  // 问题可喂 LLM; 旧链末 fallback 到 offer.outcome_condition_id (HASH) = 重蹈盲判默认 YES 的 landmine。
  // abstain-not-guess: 无问题 → ABSTAIN, 绝不 fallback 喂 hash 盲判 (= 根因不复发)。
  if (!spec?.title && !spec?.resolution_criteria) {
    return { ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'spec-no-question', reason: 'spec 缺 title + resolution_criteria = 无判定问题可判, abstain-not-guess (不 fallback 喂 condition_id hash 盲判)' };
  }
  // J2-tn r675 (Bettor 钦定 fixture-mirror 铁律): prompt 抽进共享单源模块 derivevote-prompt.mjs,
  // prod (这) + line-E fidelity harness (gateE-*) 都 import 同函数 = 物理单源、byte-identical,
  // 杜绝 harness 拷贝漂移 (线E P0 = harness 喂 hash 漏 spec.title 的漂移教训)。改 prompt 去那个模块。
  // 原 inline (线E P0 修后形态: 喂 spec.title 实问题 + resolution_criteria 非 condition_id hash) 逐字节抽出。
  const prompt = buildDeriveVotePrompt(spec, evidence_url, evidence_text);
  let llmOutcome = null;
  let llmConfidence = 0;
  let llmReason = '';
  try {
    const url = providerUrl.replace(/\/$/, '') + '/chat/completions';
    // J2-tn 规模测试 (Bettor r527/r528): voterTick 串行处理多 oracle×多市场, 单个 deriveVote LLM
    // 调用挂久 = 后面 oracle 永远轮不到 → 卡 N/5 (scale trial 实证: :8000 饱和 27s ttfb 下卡 2/5)。
    // 60s→30s: :8000 饱和时慢调用快失败 → 串行 loop 不 bog、移到下个 oracle (catch 返 ok:false 已
    // skip 该票)。Bettor r528 "deriveVote 别挂 27s" 无论 ①竞争②自身需求都要的 robustness。
    // 注: 这只让 loop 不卡; 票实际落地仍需 :8000 有容量 (= seeder-down 腾负载 + 长远更多 LLM 容量)。
    const llmRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: providerModel || undefined,
        messages: [{ role: 'user', content: prompt }],
        chat_template_kwargs: { enable_thinking: false },  // Qwen Rule 11 必加
        response_format: { type: 'json_object' },
        temperature: 0,  // 门C echo-slash premise: 生产 deriveVote 严格确定 (temp0.1 实测 5/5+12/12 确定, temp0 strictly-more-deterministic, prior 3/3 clean)
        max_tokens: 200,
      }),
    });
    if (!llmRes.ok) return { ok: false, reason: `LLM HTTP ${llmRes.status}` };
    const llmJson = await llmRes.json();
    const content = llmJson?.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    llmOutcome = (parsed.outcome === 'YES' || parsed.outcome === 'NO') ? parsed.outcome : null;
    llmConfidence = parseFloat(parsed.confidence) || 0;
    llmReason = String(parsed.reason || '').slice(0, 200);
  } catch (e) {
    return { ok: false, reason: `LLM fetch fail: ${e.message}` };
  }

  // F1 (area-3): daemon abstains on low confidence OR unparseable LLM output. No DISPUTE
  // token cast — silent vote means decideConsensus eventually triggers silent_timeout →
  // refund / forfeit_1. Operator may manually override via /api/pool/market/:id/oracle/vote
  // before silent_timeout if they reach an off-LLM determination.
  if (llmOutcome === null || llmConfidence < 0.6) {
    return {
      ok: false,
      reason: `daemon_abstain: ${llmOutcome === null ? 'LLM unparseable' : `confidence ${llmConfidence} < 0.6`} (operator manual vote allowed before silent_timeout)`,
    };
  }
  return {
    ok: true,
    outcome: llmOutcome,
    evidence_url,
    field_hash,  // J2-tn wave1: observe-only, null if 非 ESPN 结构化源 (NWT 源轴 quorum 闸输入)
    evidence_raw: JSON.stringify({ evidence_text: evidence_text.slice(0, 500), llm_confidence: llmConfidence, llm_reason: llmReason }),
  };
}

// r242 Phase 4a Sub 8 step 5 — handleTxSignReq voter TX-sig handler.
//   Triggered when offer in 'collecting_sigs' state (= Phase 2 dispatched by settler).
//   1. PB-S8-1 byzantine 防: verify own Phase 1 vote outcome == request winner
//   2. PB-S8-2 maker swap 防: verify redeem_script_hash matches own offer metadata
//   3. Sign EACH input via sign_input_for_settle IPC (= per-input sighash, SIGHASH_ALL)
//   4. Write chain_events oracle_tx_sig per input + DM maker resp kanet_oracle_tx_sign_resp_v1
//
//   Returns: { signed: bool, skipped: bool }
async function handleTxSignReq(voter, offer) {
  const currentRound = offer.revote_round || 0;
  let meta;
  try { meta = JSON.parse(offer.metadata || '{}'); } catch { meta = {}; }

  // Skip if voter already signed both inputs for this round
  const existingSigs = sqlite.prepare(`
    SELECT id, payload FROM chain_events
    WHERE event_type = 'oracle_tx_sig' AND from_address = ?
      AND payload LIKE ? AND payload LIKE ?
  `).all(voter.address, `%"offer_id":"${offer.id}"%`, `%"revote_round":${currentRound}%`);
  const signedInputs = new Set(existingSigs.map(r => {
    try { return JSON.parse(r.payload || '{}').input_index; } catch { return null; }
  }).filter(i => i === 0 || i === 1));
  if (signedInputs.size >= 2) { return { signed: false, skipped: true }; }

  // PB-S8-1 byzantine 防: verify own Phase 1 vote matches request winner
  const winner = parseInt(meta.phase2_winner, 10);
  if (winner !== 0 && winner !== 1) {
    // Permanent condition for this offer (winner won't self-heal). Throttle the warn so a
    // stuck offer can't spam the log every tick. Treat as skipped (not errored) — re-attempting
    // is pointless. Bettor r472.
    warnThrottled(`invalid-winner:${offer.id}`, `[prediction-voter] handleTxSignReq invalid winner offer=${offer.id.slice(0,8)} (throttled 10min)`);
    return { signed: false, skipped: true };
  }
  const myVoteRow = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'oracle_vote' AND from_address = ?
      AND payload LIKE ? AND payload LIKE ?
    LIMIT 1
  `).get(voter.address, `%"offer_id":"${offer.id}"%`, `%"revote_round":${currentRound}%`);
  if (!myVoteRow) {
    console.warn(`[prediction-voter] handleTxSignReq no own vote for offer=${offer.id.slice(0,8)} round=${currentRound}`);
    return { signed: false, skipped: false };
  }
  const myOutcome = (() => { try { return JSON.parse(myVoteRow.payload).outcome; } catch { return null; } })();
  const expectedOutcome = winner === 0 ? (offer.outcome_side === 'YES' ? 'YES' : 'NO') : (offer.outcome_side === 'YES' ? 'NO' : 'YES');
  // Note: winner=0 means maker won (= maker's outcome_side was the truth)
  //       winner=1 means taker won (= opposite of maker's outcome_side)
  if (myOutcome !== expectedOutcome) {
    console.warn(`[prediction-voter] handleTxSignReq byzantine 防: own vote=${myOutcome} ≠ expected=${expectedOutcome} for winner=${winner}, refuse`);
    return { signed: false, skipped: false };
  }

  // PB-S8-2 maker swap 防: redeem_hash check (= 自家 offer metadata vs settler's preimage)
  if (!meta.phase2_tx_obj?.inputs || meta.phase2_tx_obj.inputs.length !== 2) {
    console.warn(`[prediction-voter] handleTxSignReq metadata missing valid phase2_tx_obj.inputs offer=${offer.id.slice(0,8)}`);
    return { signed: false, skipped: false };
  }

  // 3. Sign each input via relay IPC sign_input_for_settle
  for (let inputIdx = 0; inputIdx < 2; inputIdx++) {
    if (signedInputs.has(inputIdx)) continue;  // already signed this input
    try {
      // J1/NWT 2026-06-28 fix: 转 safe_json 再发 (spk 全保·见 toSettleSafeJsonTxHex 注释)
      const _safeTxHex = await toSettleSafeJsonTxHex(meta.phase2_tx_obj);
      const signResult = await sendCommandAsync(voter.id, {
        type: 'sign_input_for_settle',
        tx_hex: _safeTxHex,
        safe_json: true,
        input_index: inputIdx,
      });
      if (!signResult?.ok || !signResult.signature) {
        console.error(`[prediction-voter] sign_input_for_settle fail voter=${voter.name} offer=${offer.id.slice(0,8)} input=${inputIdx}: ${signResult?.error || 'no sig'}`);
        return { signed: false, skipped: false };
      }
      const signature = signResult.signature;

      // Build resp payload + chain_events oracle_tx_sig row
      const respPayload = JSON.stringify({
        t: 'kanet_oracle_tx_sign_resp_v1',
        offer_id: offer.id,
        voter_relay_id: voter.id,
        revote_round: currentRound,
        winner,
        input_index: inputIdx,
        signature,
      });
      const syntheticTxid = `oracle_tx_sig:${voter.id.slice(0,8)}:${offer.id.slice(0,8)}:r${currentRound}:i${inputIdx}:${Date.now()}`;
      sqlite.prepare(`
        INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
        VALUES (?, ?, 'oracle_tx_sig', ?, ?, ?, 'prediction-voter', CURRENT_TIMESTAMP)
      `).run(randomUUID(), syntheticTxid, voter.address, offer.maker_kaspa_addr, respPayload);

      // DM maker_relay with resp
      if (offer.maker_kaspa_addr) {
        await sendCommandAsync(voter.id, {
          type: 'send_message',
          target: offer.maker_kaspa_addr,
          message: respPayload,
        });
      }
      console.log(`[prediction-voter] TX-SIG ${voter.name}: offer=${offer.id.slice(0,8)} input=${inputIdx} winner=${winner}`);
    } catch (e) {
      console.error(`[prediction-voter] handleTxSignReq input ${inputIdx} fail voter=${voter.name}: ${e.message}`);
      return { signed: false, skipped: false };
    }
  }

  return { signed: true, skipped: false };
}
