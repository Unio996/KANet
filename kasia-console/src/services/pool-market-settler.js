// B2 v0.5 Sub 2d Phase 1 — pool_markets settler service
//
// Per service spec docs/poolspine-service-layer-spec-2026-05-21.md Section 8 (settlement flow).
//
// Architecture: Hybrid Option D + Angle 2 (= per-bettor side P2SH + oracle aggregated settlement).
// Settler responsibilities:
//   1. Cron tick: SELECT pool_markets WHERE status='verifying' AND deadline passed
//   2. Aggregate 3 oracle votes (= chain_events 'pool_oracle_vote' filter by market_id)
//   3. Consensus check:
//      - 3-of-3 unanimous → entry 0 settle_unanimous
//      - 2-of-3 (1 silent past timeout, e.g. 30 min) → entry 1 settle_majority_forfeit_1
//      - 0/3 votes after timeout → entry 2 refund_unanimous_silent
//   4. Phase 2 (deferred this sub): build settle TX + request 3 oracle sigs + broadcast
//
// Sub 2d Phase 1 scope: cron + vote aggregation + consensus decision logging only.
//                       Actual TX construction + sig orchestration → Sub 2d Phase 2.

import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';
import { createHash } from 'node:crypto';

// J2-tn r382 (Bettor 16:29 钦定): TICK_INTERVAL_MS env-configurable. Default 5min mainnet,
// demo 期 .env 设 POOL_SETTLER_TICK_SEC=60 (= 1min) 提速 5x 整条流水.
const TICK_INTERVAL_MS = (parseInt(process.env.POOL_SETTLER_TICK_SEC, 10) || 300) * 1000;
const STARTUP_GRACE_MS = 60 * 1000;         // 60s grace (= 错峰 voter daemon 45s startup)

// Per Bettor r336 + v0.5 spec section 4.3: ORACLE_SILENT_TIMEOUT_MIN ENV var.
// Default 30 min OK for testnet rapid iteration. Mainnet deploy MUST set 1440 (= 24h 钢线).
const ORACLE_SILENT_TIMEOUT_MIN = parseInt(process.env.ORACLE_SILENT_TIMEOUT_MIN, 10) || 30;
const ORACLE_SILENT_TIMEOUT_MS = ORACLE_SILENT_TIMEOUT_MIN * 60_000;
// Area-7 T5 / area-4 Gap 6: DISAGREEMENT_TIMEOUT independent timer (= NOT ORACLE_SILENT_TIMEOUT
// reuse, different semantics — disagreement is info-complete, no value waiting 24h). testnet
// 5 min default, matches PoolSpine.sil refund_disagreement entry's `tx.time >= deadline + 300`
// SS-hardcoded value. Mainnet rebuild SS + Console with longer value (1-2h per area-7 T5).
const DISAGREEMENT_TIMEOUT_MIN = parseInt(process.env.DISAGREEMENT_TIMEOUT_MIN, 10) || 5;
const DISAGREEMENT_TIMEOUT_MS = DISAGREEMENT_TIMEOUT_MIN * 60_000;

// B2 v0.5 Phase 3 bug 8 — Kaspa Crescendo KIP-9 storage mass constraints.
// A pool settle TX with many small-value outputs blows the storage mass cap (= UAT cycle 3:
// 0.5 KAS bettor stakes → broker_fee 500k sompi → storage_mass 1.99M > 500k cap).
const KIP9_C = 1e12;                          // KIP-9 mass constant
const STORAGE_MASS_CAP = 500_000;             // kaspad standardness cap
// Bettor r349 catch (3l06n 实证): 400k = 20% buffer 过保守, 厚池 100+100 KAS est=449975 < 500k
// 实可 settle 但被 false cancel. Tune to 470k (= 6% margin) — est_storage_mass 估值通常偏保守
// (KIP-9 公式 Σ(1/v) 单调 + 离散累积 round-up), 实实 mass 大概率更低. 6% margin 防估值偏差.
const STORAGE_MASS_SAFE_THRESHOLD = 470_000;
const MIN_BROKER_FEE_SOMPI = 5_000_000;       // 0.05 KAS broker_fee floor (Bettor r370)

let timer = null;
let running = false;

/**
 * Estimate a transaction's KIP-9 storage mass.
 * storage_mass = C × max(0, Σ(1/output_value) − inputCount² / Σ(input_value))
 * Verified against UAT cycle 3 observed mass (1,991,668 ≈ computed).
 *
 * @param {number[]} inputValues - sompi values of each input UTXO
 * @param {number[]} outputValues - sompi values of each output
 * @returns {number} estimated storage mass
 */
export function estimateStorageMass(inputValues, outputValues) {
  const sumOutInv = outputValues.reduce((s, v) => s + (v > 0 ? 1 / v : 0), 0);
  const sumIn = inputValues.reduce((s, v) => s + v, 0);
  const inputsTerm = sumIn > 0 ? (inputValues.length * inputValues.length) / sumIn : 0;
  return Math.max(0, Math.round(KIP9_C * (sumOutInv - inputsTerm)));
}

/**
 * Parse a SQLite CURRENT_TIMESTAMP string as UTC.
 * SQLite stores 'YYYY-MM-DD HH:MM:SS' with no timezone — it IS UTC, but JS `new Date(str)`
 * on a space-separated string parses it as LOCAL time → 中国 host UTC+8 → 8h skew →
 * instant false ORACLE_SILENT_TIMEOUT. Phase 3 e2e caught this (= market false-refunded 3 min in).
 */
export function parseSqliteUtc(ts) {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime();
}

export function startPoolMarketSettlerCron() {
  if (timer) return;
  console.log(`[pool-settler] started — 5min cron, aggregate 3 oracle votes + consensus check, silent_timeout=${ORACLE_SILENT_TIMEOUT_MIN}min (Sub 2d Phase 1)`);
  if (ORACLE_SILENT_TIMEOUT_MIN < 1440) {
    console.warn(`[pool-settler] WARN: ORACLE_SILENT_TIMEOUT_MIN=${ORACLE_SILENT_TIMEOUT_MIN} < 1440 (= mainnet 24h 钢线 per v0.5 spec section 4.3). Set ORACLE_SILENT_TIMEOUT_MIN=1440 for mainnet.`);
  }
  setTimeout(() => {
    poolSettlerTick().catch(e => console.error('[pool-settler] startup tick:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    poolSettlerTick().catch(e => console.error('[pool-settler] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopPoolMarketSettlerCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function poolSettlerTick() {
  if (running) { return { skipped: true }; }
  running = true;
  try {
    // ── Deadline-watcher (Bettor P1 gap fix) ────────────────────────────────
    // pending_bettors markets past deadline had NO auto-advance: the /settle endpoint
    // (pool.js) was manual-only, never called by any cron/bot → markets stuck in
    // pending_bettors forever (22 observed), real users' stakes frozen, no settle/refund.
    // = root cause of "v0.6 unusable". Mirror the /settle transition here so every market
    // auto-advances to verifying at deadline; the loop below then settles / refunds / cancels
    // (0-bet → maker refund, thin → cancel-refund, healthy → committee settle).
    // Scope: ONLY v0.6/v0.7 committee markets — this settler's dispatchPhase2 is committee logic.
    // null/v0.5-version pending_bettors markets (legacy/other type) must NOT be force-advanced here
    // (would mis-route through committee settle). They are a separate concern (flagged, not touched).
    const nowSec = Math.floor(Date.now() / 1000);
    const dueMarkets = sqlite.prepare(`
      SELECT id FROM pool_markets
      WHERE protocol_status = 'pending_bettors' AND deadline <= ?
        AND protocol_version IN ('v0.6', 'v0.7')
    `).all(nowSec);
    if (dueMarkets.length) {
      for (const dm of dueMarkets) {
        sqlite.prepare('UPDATE pool_markets SET protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run('verifying', dm.id);
      }
      console.log(`[pool-settler] deadline-watcher: advanced ${dueMarkets.length} pending_bettors → verifying (deadline passed): ${dueMarkets.map(m => m.id.slice(-5)).join(',')}`);
    }

    // J2-tn r388 (#24 settler 饥饿根治 — Bettor 02:18 钦定 自治闭环地基):
    // ORDER BY updated_at DESC = 活跃市场优先 (= 新近活动 process 在前, stale markets 不阻塞 demo).
    const markets = sqlite.prepare(`
      SELECT id, maker_relay_id, spine_p2sh, spine_lock_tx, oracle1_pk, oracle2_pk, oracle3_pk,
             oracle_relay_ids, deadline, protocol_status, sides_merkle_root, broker_pk, broker_fee_pct, broker_relay_id,
             updated_at, maker_stake_amount, oracle_bond_amount, miner_fee, metadata,
             outcome_market_source, outcome_token_id, outcome_side, protocol_version, pool_merkle_root,
             deadline_daa
      FROM pool_markets
      WHERE protocol_status IN ('verifying', 'collecting_sigs', 'refunding')
        AND deadline <= ?
      ORDER BY updated_at DESC
    `).all(Math.floor(Date.now() / 1000));
    if (!markets.length) return { ok: true, processed: 0 };

    // J2-tn r388 #24 time-box: settler tick max duration 30s. Stale 死单 retry chain 若爆 30s,
    // break 让 active 市场下一 tick 仍有机会 process. log unprocessed count.
    const TICK_TIMEBOX_MS = parseInt(process.env.POOL_SETTLER_TIMEBOX_MS, 10) || 30_000;
    const tickStartMs = Date.now();

    let consensus = 0, pending = 0, refund = 0, errored = 0, doomed = 0, sampledCommittee = 0;
    let processedCount = 0;
    for (const market of markets) {
      // J2-tn r388 #24 time-box check: 处理超 30s 后 break (= 同 tick 内有 stale retry 不阻塞下个 tick).
      if (Date.now() - tickStartMs > TICK_TIMEBOX_MS) {
        const remaining = markets.length - processedCount;
        console.warn(`[pool-settler] tick time-box ${TICK_TIMEBOX_MS}ms hit after ${processedCount}/${markets.length} markets, ${remaining} deferred to next tick`);
        break;
      }
      processedCount++;
      // J2-tn r388 #24 exponential backoff: meta.skip_until_ms (epoch ms) set after repeated
      // sample failures. Skip if set + 未到. Active state (collecting_sigs / refunding +
      // refund_dispatched_at) 仍走原 handler 不 skip (= 完成中状态优先).
      let backoffMeta = {};
      try { backoffMeta = JSON.parse(market.metadata || '{}'); } catch {}
      if (backoffMeta.skip_until_ms && Date.now() < backoffMeta.skip_until_ms
          && market.protocol_status === 'verifying') {
        doomed++;
        continue;
      }
      try {
        // Phase 2b Ship #1 — doomed-market skip. A market marked needs_larger_pot can never
        // settle (settle TX storage mass exceeds the 500k cap). Without this skip dispatchPhase2
        // recomputes the same doomed mass every tick forever, starving healthy markets.
        let doomedMeta = {};
        try { doomedMeta = JSON.parse(market.metadata || '{}'); } catch {}
        if (doomedMeta.needs_larger_pot) {
          // Bettor r343 catch: active state machine 优先于 doomed-skip. ccvr9+unmfw 已 self-heal
          // dispatchRefund (refund_dispatched_at set) + status='refunding' 但 needs_larger_pot=true
          // 仍 set → 下次 tick L117 doomed-skip → handleRefunding (L141 之后) 永轮不到. 加 fall-through:
          // refunding / cancelled status 跳过 doomed-skip 继续走 handleRefunding (= 同 34a402b 模式).
          if (market.protocol_status === 'refunding' || market.protocol_status === 'cancelled') {
            // Fall through to L141 refunding/collecting_sigs handler. 不 continue.
          } else {
          // min-pot 选项 A (Bettor r339): v0.6/v0.7 anonymous-pool legacy needs_larger_pot markets
          // (= 7446fba 之前 marked, ccvr9 / unmfw / 等) 不该永远 skip 卡死. 同 storage-mass cap
          // 触发路径 → cancel-refund 全员 (= dispatchRefund maker + per-bettor 'bettor_refund_available').
          const isAnonymousPoolDoomed = market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7';
          if (isAnonymousPoolDoomed && !doomedMeta.refund_dispatched_at && market.protocol_status === 'verifying') {
            console.log(`[pool-settler] legacy needs_larger_pot doomed market=${market.id.slice(0,12)} pv=${market.protocol_version} → cancel-refund 自愈`);
            // Clear needs_larger_pot 标记 + Status. 防下次 tick L117 仍见 doomed=true + refund_dispatched_at 已设
            // → guard false → 'doomed++; continue' 死循环 → handleRefunding 永轮不到 (Bettor r341 catch).
            const cleanedMeta = { ...doomedMeta };
            delete cleanedMeta.needs_larger_pot;
            cleanedMeta.legacy_doomed_self_heal_at = new Date().toISOString();
            cleanedMeta.legacy_est_storage_mass = doomedMeta.est_storage_mass;
            sqlite.prepare('UPDATE pool_markets SET protocol_status = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run('cancelled', JSON.stringify(cleanedMeta), market.id);
            const cancelEventPayload = JSON.stringify({
              market_id: market.id,
              reason: 'legacy_doomed_needs_larger_pot_self_heal',
              est_storage_mass: doomedMeta.est_storage_mass,
              cancelled_at: new Date().toISOString(),
            });
            sqlite.prepare(`
              INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
              VALUES (lower(hex(randomblob(16))), ?, 'market_cancelled', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
            `).run(`market_cancelled:${market.id.slice(0,12)}:${Date.now()}`, cancelEventPayload);
            // Auto maker refund
            await dispatchRefund(market, {
              action: 'refund',
              reason: `legacy doomed self-heal: needs_larger_pot=true, est_mass=${doomedMeta.est_storage_mass}`,
            });
            // Per-bettor events
            const sides = sqlite.prepare(`
              SELECT bettor_pk, side_p2sh, side_lock_tx, stake_amount, direction
              FROM pool_bettor_sides WHERE market_id = ? AND side_lock_tx IS NOT NULL
            `).all(market.id);
            for (const side of sides) {
              const bettorRefundPayload = JSON.stringify({
                market_id: market.id,
                bettor_pk: side.bettor_pk,
                side_p2sh: side.side_p2sh,
                side_lock_tx: side.side_lock_tx,
                stake: side.stake_amount,
                direction: side.direction,
                reason: 'market_cancelled_legacy_doomed_self_heal',
                claim_entry: 'PoolSide_v07 entry 2 refund_market_cancelled',
              });
              sqlite.prepare(`
                INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
                VALUES (lower(hex(randomblob(16))), ?, 'bettor_refund_available', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
              `).run(`bettor_refund:${market.id.slice(0,12)}:${String(side.bettor_pk).slice(0,12)}:${Date.now()}`, bettorRefundPayload);
            }
            console.log(`[pool-settler] legacy doomed self-heal market=${market.id.slice(0,12)} CANCELLED + maker_refund dispatched + ${sides.length} bettor_refund_available events`);
            refund++;
            continue;
          }
          doomed++;
          continue;
          }  // end else (= not refunding/cancelled fall-through)
        }

        // G6 批 3 段① 0-bet PRE-sampling shortcut (Bettor r301 catch): committee sampling needs
        // pool_snapshot which may not exist (e.g. create-v07 ensurePoolSnapshot failed). 0-bet
        // markets have no votes coming, no winners to settle — directly refund. Skip sampling +
        // decideConsensus entirely. v0.6/v0.7 only (anonymous-pool committee model).
        // J2-tn r384 (J1 r303 root cause + Bettor 钦定): skip 0-bet shortcut for cross-node
        // markets where maker_relay_id is 'cross-node:<pk>' sentinel (= maker on remote host).
        // 否则 dispatchRefund 走到 L1354 silently 跳过 (= cross-node refund 必 producer node 干),
        // 既不 sample 又不 refund → 卡 status=verifying. #10 + #12 都撞这复发 bug.
        // 对 cross-node maker, local betCount=0 不代表市场无 bet (= 本节点 bet ingest 可能 lag);
        // 让市场继续 committee sample 路径, 委员 sample 不依赖 local bets (= 用 chain_view +
        // VRF + endBlockHash 跨节点 deterministic).
        if (market.protocol_status === 'verifying' &&
            (market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7')) {
          const isCrossNode = typeof market.maker_relay_id === 'string' && market.maker_relay_id.startsWith('cross-node:');
          if (!isCrossNode) {
            const betCount = sqlite.prepare('SELECT COUNT(*) as c FROM pool_bettor_sides WHERE market_id = ?').get(market.id)?.c || 0;
            if (betCount === 0) {
              // Skip if already dispatched.
              let meta0 = {};
              try { meta0 = JSON.parse(market.metadata || '{}'); } catch {}
              if (!meta0.refund_dispatched_at) {
                console.log(`[pool-settler] 0-bet pre-sample shortcut market=${market.id.slice(0,12)} pv=${market.protocol_version} → dispatchRefund (skip committee sampling + voting)`);
                await dispatchRefund(market, { action: 'refund', reason: '0-bet market, refund_maker_unjoined (pre-sample shortcut)' });
                refund++;
              } else {
                pending++;  // already dispatched, wait handleRefunding tick
              }
              continue;
            }
          }
        }

        // G6 批 3 段① T2 blocker3 (T2 9th attempt 实测): refunding state markets must skip
        // committee sampling. After dispatchRefund transitions status='refunding', the next
        // tick re-enters this loop. Without this early exit, sampling tries again (because
        // oracle_relay_ids is still '[]' — 0-bet shortcut never populated it) → fails on
        // missing pool_snapshot → continue → handleRefunding never reached. Move the
        // refunding handler ABOVE sampling.
        if (market.protocol_status === 'refunding') {
          await handleRefunding(market);
          continue;
        }
        if (market.protocol_status === 'collecting_sigs') {
          await handleCollectingSigs(market);
          continue;
        }

        // Bettor r172/r174 + J1 r205 ③ wire — v0.6 path A committee sampling. Idempotent: skip
        // if already sampled. Requires pool_snapshots row (created at market create-v06 per F-S3
        // anti-grinding). chainReader uses maker_relay_id (= already running). F-S1 finality_depth
        // failures are non-fatal: throw → log → continue → next tick retries until chain advances.
        // G6 批 3 段① extend committee sampling to v0.7. v0.7 同 v0.6 用 5-committee + poolMerkleRoot,
        // 只 SS bytecode 不同 (refund fee 范围). committee 抽样逻辑 reuse.
        if ((market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7') && (!market.oracle_relay_ids || market.oracle_relay_ids === '[]')) {
          const alreadySampled = sqlite.prepare('SELECT market_id FROM pool_committee WHERE market_id = ?').get(market.id);
          if (!alreadySampled) {
            try {
              const { createRelayChainReader } = await import('./relay-chain-reader.mjs');
              const { fetchEndBlockHashCanonical, sampleAndStoreCommittee } = await import('./pool-market-settler-v06.mjs');
              const { getStatus, isRelayAlive } = await import('./relay-manager.js');
              // Bettor r182/r183/r184: maker_relay_id may be remote (cross-node ingested market) →
              // local Console can't IPC to it. Use any locally-running relay for chainReader —
              // chain state is global, any alive relay sees the same DAA progression.
              // isRelayAlive returns {alive: bool, reason: string} not a bare boolean — must
              // read .alive (d4558dd silent bug: truthy object always selected maker_relay_id).
              let chainReaderRelayId = null;
              if (market.maker_relay_id) {
                const aliveCheck = isRelayAlive(market.maker_relay_id);
                if (aliveCheck?.alive) chainReaderRelayId = market.maker_relay_id;
              }
              if (!chainReaderRelayId) {
                const candidates = getStatus() || [];
                // getStatus rows have relayNodeId + pid set when process is up. Pick first w/ pid +
                // confirm IPC alive via isRelayAlive.alive (defense-in-depth vs stale state cache).
                const localAlive = candidates.find(r => r.pid && isRelayAlive(r.relayNodeId)?.alive);
                if (!localAlive) throw new Error(`no locally-alive relay for chainReader (checked ${candidates.length})`);
                chainReaderRelayId = localAlive.relayNodeId;
              }
              console.log(`[pool-settler] committee sample using relay=${chainReaderRelayId?.slice(0,8)} for market=${market.id.slice(0,12)}`);
              const chainReader = createRelayChainReader(chainReaderRelayId);
              // J2-tn r323 (Bettor 钦定 NWT+J1 合解): 优先 market.deadline_daa baked-at-create
              // (= 跨节点 envelope propagate 同字段). Wallclock estimate fallback 仅 legacy markets
              // 没 deadline_daa column (= 165 前 v0.6/v0.7 row). Anti-grinding: deadline_daa 是未来
              // daa, maker create 时 endBlockHash 不可知.
              let deadlineDaa = market.deadline_daa;
              if (!deadlineDaa) {
                // Legacy fallback: pre-v165 markets without deadline_daa column populated.
                const currentDaa = await chainReader.getCurrentDaaScore();
                const nowSec = Math.floor(Date.now() / 1000);
                deadlineDaa = Math.max(1, currentDaa - Math.max(0, (nowSec - market.deadline) * 10));
                console.log(`[pool-settler] market=${market.id.slice(0,12)} legacy fallback: estimate deadlineDaa=${deadlineDaa} (no deadline_daa col)`);
              }
              const endBlock = await fetchEndBlockHashCanonical(chainReader, deadlineDaa);
              const committee = sampleAndStoreCommittee(market.id, endBlock.hash);
              // Wire committee_relay_ids → pool_markets.oracle_relay_ids so voter scan picks up.
              sqlite.prepare('UPDATE pool_markets SET oracle_relay_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(JSON.stringify(committee.committee_relay_ids), market.id);
              sampledCommittee++;
              console.log(`[pool-settler] committee sampled market=${market.id.slice(0,12)} pks=${committee.committee_pks.length} endBlock=${endBlock.hash.slice(0,16)} daa=${endBlock.block_daa}`);

              // J2-tn r371 (Bettor 14:53 钦定): post-sample vote re-scan. broadcast_messages 含
              // 委员抽样前 / handler fix 前 (= 924b6a2) 已上链的 pool_oracle_vote_v1, 当时被旧
              // filter reject 或 race-skip → chain_events 没写. 现 committee 抽好 → replay via
              // onBroadcastWritten → idempotent (= chain_events.txid UNIQUE). 同 L502 bet H2 pattern.
              try {
                const { onBroadcastWritten } = await import('./trade-protocol-filter.js');
                const orphanVotes = sqlite.prepare(`
                  SELECT tx_hash, sender_address, channel_name, content, created_at
                  FROM broadcast_messages
                  WHERE channel_name = 'kanet-prediction'
                    AND content LIKE '%pool_oracle_vote_v1%'
                    AND content LIKE ?
                    AND tx_hash NOT IN (SELECT txid FROM chain_events WHERE event_type = 'pool_oracle_vote')
                  ORDER BY created_at ASC
                `).all(`%"market_id":"${market.id}"%`);
                if (orphanVotes.length > 0) {
                  console.log(`[pool-settler] post-sample vote re-scan market=${market.id.slice(0,12)}: ${orphanVotes.length} orphan vote(s) — replaying`);
                  for (const row of orphanVotes) {
                    try {
                      await onBroadcastWritten({
                        tx_hash: row.tx_hash, content: row.content, sender_address: row.sender_address,
                        channel_name: row.channel_name, created_at: row.created_at,
                      });
                    } catch (replayErr) {
                      console.warn(`[pool-settler] vote replay fail tx=${row.tx_hash.slice(0,16)}: ${replayErr.message}`);
                    }
                  }
                }
              } catch (rescanErr) {
                console.warn(`[pool-settler] post-sample vote re-scan fail market=${market.id.slice(0,12)}: ${rescanErr.message}`);
              }
            } catch (sampleErr) {
              // F-S1 finality not met / no blocks / snapshot missing → log + skip this tick.
              // J2-tn r388 #24 exp backoff: count failures + set skip_until_ms. After N
              // failures, settler 跳过 N ticks. mainnet: stale 死单不再 starve active markets.
              const cur = {};
              try { Object.assign(cur, JSON.parse(market.metadata || '{}')); } catch {}
              cur.sample_fail_count = (cur.sample_fail_count || 0) + 1;
              cur.sample_last_err = sampleErr.message?.slice(0, 200);
              // Exp backoff: 60s × 2^(N-1), cap 1h. After 10 fails (~17h cumulative) 退到 1h cap.
              const backoffSec = Math.min(60 * Math.pow(2, Math.max(0, cur.sample_fail_count - 1)), 3600);
              cur.skip_until_ms = Date.now() + backoffSec * 1000;
              sqlite.prepare('UPDATE pool_markets SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(JSON.stringify(cur), market.id);
              console.log(`[pool-settler] committee sample retry market=${market.id.slice(0,12)} fail#${cur.sample_fail_count} backoff=${backoffSec}s: ${sampleErr.message}`);
              pending++;
              continue;
            }
            // Re-load market with new oracle_relay_ids so downstream decideConsensus sees it.
            const reloaded = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(market.id);
            if (reloaded) Object.assign(market, reloaded);
          }
        }

        // (refunding + collecting_sigs handlers moved above sampling — see T2 blocker3 comment)

        // J2-tn r372 (Bettor 14:55 catch — 206b0a4 触发位置不对): vote re-scan 每 tick 跑
        // (= 不只 sample 那一刻). #9 12:36 votes broadcast at 13:57 sample (= 早于 924b6a2
        // filter fix) → broadcast_messages 有但 chain_events 没. 每 tick 扫 orphan vote
        // → replay → idempotent INSERT. 治存量 + 守未来.
        // J2-tn r374 (Bettor 15:02 catch): 同款 sign_resp re-scan 加 (= 同 vote pattern).
        if ((market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7')
            && (market.protocol_status === 'verifying' || market.protocol_status === 'collecting_sigs')) {
          try {
            const { onBroadcastWritten } = await import('./trade-protocol-filter.js');
            const orphanVotes = sqlite.prepare(`
              SELECT tx_hash, sender_address, channel_name, content, created_at
              FROM broadcast_messages
              WHERE channel_name = 'kanet-prediction'
                AND content LIKE '%pool_oracle_vote_v1%'
                AND content LIKE ?
                AND tx_hash NOT IN (SELECT txid FROM chain_events WHERE event_type = 'pool_oracle_vote')
              ORDER BY created_at ASC
            `).all(`%"market_id":"${market.id}"%`);
            if (orphanVotes.length > 0) {
              console.log(`[pool-settler] per-tick vote re-scan market=${market.id.slice(0,12)}: ${orphanVotes.length} orphan vote(s) — replaying`);
              for (const row of orphanVotes) {
                try {
                  await onBroadcastWritten({
                    tx_hash: row.tx_hash, content: row.content, sender_address: row.sender_address,
                    channel_name: row.channel_name, created_at: row.created_at,
                  });
                } catch (replayErr) {
                  console.warn(`[pool-settler] vote replay fail tx=${row.tx_hash.slice(0,16)}: ${replayErr.message}`);
                }
              }
            }
            // r374: orphan sign_resp ingest (= same pattern as vote re-scan).
            const orphanSigs = sqlite.prepare(`
              SELECT tx_hash, sender_address, channel_name, content, created_at
              FROM broadcast_messages
              WHERE channel_name = 'kanet-prediction'
                AND content LIKE '%kanet_pool_oracle_tx_sign_resp_v1%'
                AND content LIKE ?
                AND tx_hash NOT IN (SELECT txid FROM chain_events WHERE event_type = 'pool_oracle_tx_sig')
              ORDER BY created_at ASC
            `).all(`%"market_id":"${market.id}"%`);
            if (orphanSigs.length > 0) {
              console.log(`[pool-settler] per-tick sign_resp re-scan market=${market.id.slice(0,12)}: ${orphanSigs.length} orphan sig(s) — replaying`);
              for (const row of orphanSigs) {
                try {
                  await onBroadcastWritten({
                    tx_hash: row.tx_hash, content: row.content, sender_address: row.sender_address,
                    channel_name: row.channel_name, created_at: row.created_at,
                  });
                } catch (replayErr) {
                  console.warn(`[pool-settler] sig replay fail tx=${row.tx_hash.slice(0,16)}: ${replayErr.message}`);
                }
              }
            }
          } catch (rescanErr) {
            console.warn(`[pool-settler] per-tick re-scan fail market=${market.id.slice(0,12)}: ${rescanErr.message}`);
          }
        }

        const decision = decideConsensus(market);
        // 7b — first-detection stash for refund_disagreement timing (= area-4 Gap 6 dual-track).
        // Pure-function decideConsensus signals via stashDisagreementDetected flag; the write
        // side-effect lives here so decideConsensus stays free of DB mutation. The stash is
        // once-and-readonly: if disagreement_detected_at already set, this branch is bypassed
        // (decideConsensus only emits the flag on first detection per its read of metadata).
        if (decision.stashDisagreementDetected) {
          let meta = {};
          try { meta = JSON.parse(market.metadata || '{}'); } catch {}
          const detectedAt = new Date().toISOString();
          sqlite.prepare('UPDATE pool_markets SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(JSON.stringify({ ...meta, disagreement_detected_at: detectedAt }), market.id);
          // Dual-track per Owner: also write chain_event so the protocol fact is on-chain,
          // not only in internal DB state. Synthetic txid since this isn't a chain TX.
          const syntheticTxid = `disagreement_detected:${market.id.slice(0,12)}:${Date.now()}`;
          sqlite.prepare(`
            INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
            VALUES (lower(hex(randomblob(16))), ?, 'disagreement_detected', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
          `).run(syntheticTxid, JSON.stringify({ market_id: market.id, detected_at: detectedAt, silent_oracle_index: decision.silentOracleIndex }));
          console.log(`[pool-settler] DISAGREEMENT DETECTED market=${market.id.slice(0,12)} silentOracleIndex=${decision.silentOracleIndex} detected_at=${detectedAt}`);
          // After stash, fall through to pending++ for this tick — next tick decideConsensus
          // will use the stashed timestamp for timeout math.
        }

        if (decision.action === 'consensus') {
          consensus++;
          console.log(`[pool-settler] CONSENSUS market=${market.id.slice(0,12)} winner=${decision.winner} unanimous=${decision.unanimous} silent_oracle=${decision.silentOracleIndex ?? 'none'}`);
          // Phase 2a-2: skip if already dispatched (check metadata.phase2_dispatched_at)
          let meta = {};
          try { meta = JSON.parse(market.metadata || '{}'); } catch {}
          if (!meta.phase2_dispatched_at) {
            await dispatchPhase2(market, decision);
          }
        } else if (decision.action === 'refund') {
          refund++;
          console.log(`[pool-settler] REFUND market=${market.id.slice(0,12)} reason=${decision.reason}`);
          // Phase 2a-3: skip if already dispatched
          let meta = {};
          try { meta = JSON.parse(market.metadata || '{}'); } catch {}
          if (!meta.refund_dispatched_at) {
            await dispatchRefund(market, decision);
          }
        } else if (decision.action === 'refund_disagreement') {
          refund++;
          console.log(`[pool-settler] REFUND_DISAGREEMENT market=${market.id.slice(0,12)} silentOracleIndex=${decision.silentOracleIndex} reason=${decision.reason}`);
          let meta = {};
          try { meta = JSON.parse(market.metadata || '{}'); } catch {}
          if (!meta.refund_disagreement_dispatched_at) {
            await dispatchRefundDisagreement(market, decision);
          }
        } else {
          pending++;
        }
      } catch (e) {
        errored++;
        console.error(`[pool-settler] process fail market=${market.id?.slice(0,12)}: ${e.message}`);
      }
    }
    console.log(`[pool-settler] tick: ${markets.length} verifying markets, consensus=${consensus} refund=${refund} pending=${pending} doomed=${doomed} errored=${errored} sampledCommittee=${sampledCommittee}`);
    return { ok: true, processed: markets.length, consensus, refund, pending, doomed, errored };
  } finally {
    running = false;
  }
}

/**
 * Aggregate 3 oracle votes + decide settlement action.
 * @param {object} market — pool_markets row
 * @returns {{
 *   action: 'consensus' | 'refund' | 'pending',
 *   winner?: number,                       // 0 = YES wins, 1 = NO wins
 *   unanimous?: boolean,                   // 3-of-3 same outcome
 *   silentOracleIndex?: number,            // 0/1/2 for forfeit_1 entry (only when 2-of-3 + 1 silent past timeout)
 *   reason?: string,
 * }}
 */
export function decideConsensus(market) {
  // Bettor r197 P0 fix: v0.6 path A uses 5-committee 4-of-5 threshold (= committee-attest
  // model post P2 §5.3 LOCK). v0.5 legacy 3-oracle 3-of-3 path below unchanged.
  if (market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7') {
    return decideConsensusV06(market);
  }
  let oracleIds;
  try { oracleIds = JSON.parse(market.oracle_relay_ids || '[]'); } catch { oracleIds = []; }
  if (!Array.isArray(oracleIds) || oracleIds.length !== 3) {
    return { action: 'pending', reason: `invalid oracle_relay_ids (expected 3, got ${oracleIds?.length || 0})` };
  }

  // Collect votes per oracle (= chain_events 'pool_oracle_vote' from each oracle's relay address)
  const votes = []; // [{ oracleIndex, outcome, voter_relay_id, ts }]
  for (let i = 0; i < 3; i++) {
    const oracleRelayId = oracleIds[i];
    const row = sqlite.prepare(`
      SELECT payload, observed_at FROM chain_events
      WHERE event_type = 'pool_oracle_vote'
        AND payload LIKE ?
        AND payload LIKE ?
      ORDER BY observed_at ASC
      LIMIT 1
    `).get(`%"market_id":"${market.id}"%`, `%"voter_relay_id":"${oracleRelayId}"%`);
    if (!row) continue;
    let payload;
    try { payload = JSON.parse(row.payload); } catch { continue; }
    // F1 (area-3 钦定): protocol vote space is YES/NO/silent only. DISPUTE filtered out
    // (= chain_events with outcome=DISPUTE treated as no-vote / silent). pool.js vote
    // endpoint rejects DISPUTE pre-insert, but defensively filter here in case of legacy
    // chain_events with DISPUTE outcome from pre-F1 markets.
    if (payload.outcome !== 'YES' && payload.outcome !== 'NO') continue;
    votes.push({ oracleIndex: i, outcome: payload.outcome, voter_relay_id: oracleRelayId, ts: row.observed_at });
  }

  const verifyingSinceMs = parseSqliteUtc(market.updated_at);
  const ageMs = Date.now() - verifyingSinceMs;
  const pastSilentTimeout = ageMs >= ORACLE_SILENT_TIMEOUT_MS;

  // 7b helper: read disagreement_detected_at stash (= area-4 Gap 6 once-and-readonly). The
  // stash itself is written by poolSettlerTick on first detection (= side-effect kept out of
  // this pure function); decideConsensus only reads it for timeout math.
  let disagreementDetectedAtMs = null;
  try {
    const meta = JSON.parse(market.metadata || '{}');
    if (meta.disagreement_detected_at) disagreementDetectedAtMs = parseSqliteUtc(meta.disagreement_detected_at);
  } catch {}

  // Case 1: 3-of-3 outcomes (consensus or full dissent)
  if (votes.length === 3) {
    const outcomes = new Set(votes.map(v => v.outcome));
    if (outcomes.size === 1 && (outcomes.has('YES') || outcomes.has('NO'))) {
      const winner = votes[0].outcome === 'YES' ? 0 : 1;
      return { action: 'consensus', winner, unanimous: true };
    }
    // Gap 1A — 3 dissent (e.g. 2 YES + 1 NO or 1Y+1N+1other-YES/NO etc.). silentOracleIndex=-1.
    // On first detection: caller stashes disagreement_detected_at + writes chain_event. Once
    // stashed, after DISAGREEMENT_TIMEOUT we return refund_disagreement action with sIO=-1.
    if (!disagreementDetectedAtMs) {
      return { action: 'pending', reason: `disagreement (Gap 1A pending stash): ${[...outcomes].join(',')}`, stashDisagreementDetected: true, silentOracleIndex: -1 };
    }
    const disAgeMs = Date.now() - disagreementDetectedAtMs;
    if (disAgeMs >= DISAGREEMENT_TIMEOUT_MS) {
      return { action: 'refund_disagreement', silentOracleIndex: -1, reason: `Gap 1A: 3 dissent (${[...outcomes].join(',')}) past ${DISAGREEMENT_TIMEOUT_MIN}min` };
    }
    return { action: 'pending', reason: `Gap 1A: 3 dissent age ${Math.floor(disAgeMs/60000)}min < ${DISAGREEMENT_TIMEOUT_MIN}min` };
  }

  // Case 2: 2 votes + 1 silent (past silent timeout)
  if (votes.length === 2 && pastSilentTimeout) {
    const outcomes = new Set(votes.map(v => v.outcome));
    const signedIndices = new Set(votes.map(v => v.oracleIndex));
    const silentOracleIndex = [0, 1, 2].find(i => !signedIndices.has(i));
    if (outcomes.size === 1 && (outcomes.has('YES') || outcomes.has('NO'))) {
      // 2 same direction + 1 silent → forfeit_1 (existing settle path)
      const winner = votes[0].outcome === 'YES' ? 0 : 1;
      return { action: 'consensus', winner, unanimous: false, silentOracleIndex };
    }
    // Gap 1B — 2 split + 1 silent. silentOracleIndex identifies the silent oracle. On first
    // detection: stash disagreement_detected_at + chain_event. After DISAGREEMENT_TIMEOUT,
    // return refund_disagreement with silentOracleIndex = silent's index (silent bond burned).
    if (!disagreementDetectedAtMs) {
      return { action: 'pending', reason: `disagreement (Gap 1B pending stash): ${[...outcomes].join(',')} + oracle ${silentOracleIndex} silent`, stashDisagreementDetected: true, silentOracleIndex };
    }
    const disAgeMs = Date.now() - disagreementDetectedAtMs;
    if (disAgeMs >= DISAGREEMENT_TIMEOUT_MS) {
      return { action: 'refund_disagreement', silentOracleIndex, reason: `Gap 1B: 2 dissent + oracle ${silentOracleIndex} silent past ${DISAGREEMENT_TIMEOUT_MIN}min` };
    }
    return { action: 'pending', reason: `Gap 1B: mid-disagreement age ${Math.floor(disAgeMs/60000)}min < ${DISAGREEMENT_TIMEOUT_MIN}min` };
  }

  // Case 3: ≤1 vote past silent timeout → refund_all (= per Bettor r335: 1 vote insufficient majority)
  // v0.5 spec rejected "1 oracle 单独决定" in r317-321 adversarial dialogue. Must have ≥2 votes to settle.
  // Both 0/3 and 1/3 fall under refund_unanimous_silent SS entry (= all 3 oracle bonds forfeit to maker,
  // bettors self-refund via PoolSide refund_market_cancelled entry). 1 voter loses bond as v0.5 simplification.
  if (votes.length <= 1 && pastSilentTimeout) {
    return {
      action: 'refund',
      reason: votes.length === 0
        ? 'all 3 oracles silent past 30min timeout'
        : '1 vote insufficient majority + 2 silent past 30min timeout (v0.5 spec ≥2 vote requirement)',
    };
  }

  return { action: 'pending', reason: `votes=${votes.length}/3 age=${Math.floor(ageMs/60000)}min (timeout 30min)` };
}

// v0.6 path A consensus: 5-committee, 4-of-5 same-outcome threshold for consensus.
// No DISAGREEMENT_TIMEOUT branches (= committee model assumes Byzantine-1 fault tolerance
// inherently; 4-of-5 either reaches threshold or doesn't). Silent timeout → refund.
function decideConsensusV06(market) {
  // G6 批 3 段① 0-bet immediate refund short-circuit: if 0 bettor joined by deadline,
  // SS entry 2 refund_maker_unjoined applies (no votes needed). Skip 30min ORACLE_SILENT_TIMEOUT
  // wait — return refund immediately. Works for both v0.6 + v0.7.
  const betCount = sqlite.prepare('SELECT COUNT(*) as c FROM pool_bettor_sides WHERE market_id = ?').get(market.id)?.c || 0;
  if (betCount === 0) {
    return { action: 'refund', reason: `0-bet market past deadline (no votes possible, refund_maker_unjoined)` };
  }
  let oracleIds;
  try { oracleIds = JSON.parse(market.oracle_relay_ids || '[]'); } catch { oracleIds = []; }
  if (!Array.isArray(oracleIds) || oracleIds.length !== 5) {
    return { action: 'pending', reason: `v0.6/v0.7 invalid oracle_relay_ids (expected 5, got ${oracleIds?.length || 0})` };
  }

  // J2-tn r361 (Bettor 12:55 catch + r337 漏迁 reader 第 5 次): voter envelope 写
  // voter_relay_id=voter.id (UUID), 但 r337 后 oracle_relay_ids 存 addresses → 这 query
  // 永不命中 → 0 vote counted → consensus 0/5 → 30min timeout refund. fix: 改读
  // pool_committee.committee_pks (= 5 PKs, voter envelope 同样写 voter_pubkey 字段),
  // 用 voter_pubkey 匹 (= PK 跨节点 canonical, 不受 r337 地址迁移影响).
  let committeePks = [];
  try {
    const commRow = sqlite.prepare('SELECT committee_pks FROM pool_committee WHERE market_id = ?').get(market.id);
    committeePks = JSON.parse(commRow?.committee_pks || '[]').map(p => String(p).toLowerCase());
  } catch {}
  if (committeePks.length !== 5) {
    return { action: 'pending', reason: `v0.6/v0.7 pool_committee.committee_pks invalid (expected 5, got ${committeePks.length}) — committee not yet sampled` };
  }

  const votes = [];
  for (let i = 0; i < 5; i++) {
    const voterPk = committeePks[i];
    const row = sqlite.prepare(`
      SELECT payload, observed_at FROM chain_events
      WHERE event_type = 'pool_oracle_vote'
        AND payload LIKE ?
        AND payload LIKE ?
      ORDER BY observed_at ASC LIMIT 1
    `).get(`%"market_id":"${market.id}"%`, `%"voter_pubkey":"${voterPk}"%`);
    if (!row) continue;
    let payload;
    try { payload = JSON.parse(row.payload); } catch { continue; }
    if (payload.outcome !== 'YES' && payload.outcome !== 'NO') continue;
    votes.push({ oracleIndex: i, outcome: payload.outcome });
  }

  const yesCount = votes.filter(v => v.outcome === 'YES').length;
  const noCount = votes.filter(v => v.outcome === 'NO').length;
  // J2-tn r383 (Bettor 23:59 + 6/6 00:00 钦定 4-of-5 活性路单验): forfeit_1 path needs
  // silentOracleIndex set so dispatchPhase2 L1284 signingOracles 排除静默员, 否则全 5
  // 派签 (= 4 real + 1 will never come) → handleCollectingSigs spineRequiredSigs=5 卡
  // 永远不 settle. 静默 = 投票 ≠ winner direction OR 没投票的 committee_pks[i] 索引.
  // Mirror v0.5 path L556 logic (= 3-oracle) to 5-oracle.
  function _findSilentForWinner(winnerStr) {
    for (let i = 0; i < 5; i++) {
      const v = votes.find(vt => vt.oracleIndex === i);
      if (!v || v.outcome !== winnerStr) return i;
    }
    return null;  // unreachable for 4-of-5 (= one committee member must be silent/dissent)
  }
  if (yesCount >= 4) {
    const unanimous = yesCount === 5;
    return {
      action: 'consensus',
      winner: 0,
      unanimous,
      silentOracleIndex: unanimous ? null : _findSilentForWinner('YES'),
      vote_summary: `v0.6 ${yesCount}/5 YES`,
    };
  }
  if (noCount >= 4) {
    const unanimous = noCount === 5;
    return {
      action: 'consensus',
      winner: 1,
      unanimous,
      silentOracleIndex: unanimous ? null : _findSilentForWinner('NO'),
      vote_summary: `v0.6 ${noCount}/5 NO`,
    };
  }

  // Threshold not met → timeout → refund.
  const verifyingSinceMs = parseSqliteUtc(market.updated_at);
  const ageMs = Date.now() - verifyingSinceMs;
  if (ageMs >= ORACLE_SILENT_TIMEOUT_MS) {
    return { action: 'refund', reason: `v0.6 4-of-5 threshold unmet (YES=${yesCount} NO=${noCount} total=${votes.length}/5) past ${Math.round(ORACLE_SILENT_TIMEOUT_MS/60000)}min timeout` };
  }
  return { action: 'pending', reason: `v0.6 votes ${votes.length}/5 (YES=${yesCount} NO=${noCount}) age=${Math.floor(ageMs/60000)}min < timeout` };
}

/**
 * Pure function — compute pool payout amounts per Bettor r339 spec.
 * Extracted for testability (= no DB, no IPC).
 *
 * @param {object} args
 * @param {Array<{stake: number, direction: number, isMaker?: boolean}>} args.participants — maker + bettors
 * @param {number} args.winner — 0 or 1
 * @param {number} args.brokerFeePct — basis points (0-9999)
 * @param {number} args.oracleBond — sompi
 * @param {number} args.minerFee — sompi (= must subtract from output sum or kaspad rejects)
 * @param {boolean} args.unanimous
 * @param {?number} args.silentOracleIndex — 0/1/2 if forfeit_1 else null
 * @returns {{
 *   brokerFee: number,
 *   winnerPayouts: Array<{participantIndex: number, isMaker: boolean, amount: number}>,
 *   makerExtraOutput: ?number,
 *   oracleBondReturns: Array<{oracleIndex: number, amount: number}>,  // forfeit_1 silent excluded
 * }}
 */
export function computePoolPayouts(args) {
  const { participants, winner, brokerFeePct, oracleBond, minerFee, unanimous, silentOracleIndex } = args;
  // Bug 8: broker_fee floor — defaults to MIN_BROKER_FEE_SOMPI; tests may pass 0 to isolate proportional math.
  const minBrokerFee = (args.minBrokerFee === undefined) ? MIN_BROKER_FEE_SOMPI : args.minBrokerFee;
  if (!Number.isFinite(minerFee) || minerFee < 0) throw new Error('minerFee required (sompi int)');
  const winners = participants.map((p, i) => ({ ...p, idx: i })).filter(p => p.direction === winner);
  const losers = participants.filter(p => p.direction !== winner);
  if (!winners.length) throw new Error('no winners');

  const totalLoserStake = losers.reduce((s, p) => s + p.stake, 0);
  const totalWinnerStake = winners.reduce((s, p) => s + p.stake, 0);
  // Self-catch: subtract minerFee from losing pool (= same class as 1V1 settle TX fee bug observed
  // 5/21 in tn12 console.log "transaction has 10000 fees which is under the required amount of 13130").
  // Winners absorb fee. losingPool >= brokerFee + minerFee required else throws.
  const losingPool = Math.max(0, totalLoserStake - minerFee);
  if (totalLoserStake < minerFee) {
    throw new Error(`losing pool (${totalLoserStake}) less than minerFee (${minerFee}) — settle impossible without fee`);
  }
  // Bug 8: broker_fee floor MIN_BROKER_FEE_SOMPI (= 0.05 KAS) — a tiny broker output
  // dominates KIP-9 storage mass (Σ 1/output_value). Floored so the output isn't dust-small.
  const brokerFeeRaw = Math.floor(losingPool * brokerFeePct / 10000);
  const brokerFee = Math.max(brokerFeeRaw, minBrokerFee);
  if (losingPool < brokerFee) {
    throw new Error(`losing pool (${losingPool}) less than broker_fee floor (${brokerFee}) — pot too small to settle`);
  }
  // Bettor r355 — committee bond-floor reservation (qoyqv 'script ran, but verification failed').
  // PoolSpine_v0.6/v0.7 entry 0 require(output[1..N].value >= oracleBondAmount) — the SS demands
  // each committee output >= oracleBond even though committee posts NO on-chain bond (committeeMode).
  // The bond floor is paid FROM the losing pool; the min-pot LOCK (losingPool >= N×oracleBond +
  // broker + margin, Owner 6/1) exists precisely to guarantee this is affordable. So reserve
  // N×oracleBond off the distributable pool before computing winner shares. r230's bond=0 left
  // committee outputs = fee-share only → < oracleBond when fee thin → SS reject. v0.5 (real bonds
  // posted as inputs): no reservation, bond returned from the input UTXO.
  const oracleCountForBonds = Number.isInteger(args.oracleCount) ? args.oracleCount : 3;
  const committeeMode = !!args.committeeMode;
  const committeeBondReserve = committeeMode ? oracleCountForBonds * oracleBond : 0;
  const distributablePool = losingPool - brokerFee - committeeBondReserve;
  if (distributablePool < 0) {
    throw new Error(`distributable pool negative after committee bond reserve (losingPool=${losingPool} brokerFee=${brokerFee} committeeBond=${committeeBondReserve}) — min-pot guard should have prevented`);
  }

  // Forfeit_1 50/25/25 split per v0.5 spec section 4.4
  // W3 (area-5/6): the 4 floor calls (winner / maker / oracle × 2) can each shed 0-1 sompi
  // depending on oracleBond divisibility. Without explicit handling those sompi would leak
  // into minerFee (implicit). Explicitly fold the remainder into makerForfeitShare so
  // total_allocated == oracleBond (matches the W2 formula spec). area-10 outstanding may
  // revisit whether maker share belongs to maker at all (same +EV pattern as Gap 1B burn),
  // but until that decision the remainder follows the same destination as the 25% share.
  // J2-tn r385 (Bettor #3 设计问题 + #12 实证 overspend bug): v0.5 forfeit_1 redistribution
  // (50/25/25 split of silent's bond) ONLY applies when silent oracle's bond is forfeited
  // (= !committeeMode path). In committeeMode (v0.6/v0.7), L783-786 returns bond to ALL 5
  // committee including silent (= Bettor r355 SS L138 require all N outputs >= oracleBond).
  // Without committeeMode guard here, code: 5 × bond return + 50%+25%+25% redistribution =
  // overspend silent's bond TWICE → settle TX Σout > Σin → kaspad reject pre-submit invariant.
  // #12 实证: input 7 KAS, output 7.72 KAS (overspend 0.72 KAS) = redistribution adds up.
  // 设计上 committeeMode 静默员仍拿 oracleBond (Bettor 23:59 红线: '不卡主线 settle 照样落,
  // 主线证完起对抗讨论 KB 经济模型再定'). 此处守 settle 落链, 经济模型后续 retro.
  let winnerForfeitShare = 0, makerForfeitShare = 0, perOracleForfeitShare = 0;
  if (!unanimous && typeof silentOracleIndex === 'number' && !committeeMode) {
    winnerForfeitShare = Math.floor(oracleBond * 50 / 100);
    makerForfeitShare = Math.floor(oracleBond * 25 / 100);
    perOracleForfeitShare = Math.floor(oracleBond * 25 / 100 / 2);
    const totalAllocated = winnerForfeitShare + makerForfeitShare + perOracleForfeitShare * 2;
    const remainder = oracleBond - totalAllocated;
    makerForfeitShare += remainder;
  }

  const winnerPayouts = winners.map(w => {
    const winnerShare = totalWinnerStake > 0
      ? Math.floor((distributablePool + winnerForfeitShare) * w.stake / totalWinnerStake)
      : 0;
    let amount = w.stake + winnerShare;
    if (w.isMaker) amount += makerForfeitShare;
    return { participantIndex: w.idx, isMaker: !!w.isMaker, amount };
  });

  const isMakerWinner = winners.some(w => w.isMaker);
  const makerExtraOutput = (!isMakerWinner && makerForfeitShare > 0) ? makerForfeitShare : null;

  // Bettor r355 SUPERSEDES r230 (committeeMode bond=0): the deployed PoolSpine_v0.6/v0.7 entry 0
  // requires output[1..N] >= oracleBondAmount, so committeeMode MUST pay each committee >= oracleBond
  // (reserved off distributablePool above). qoyqv 实证: r230 bond=0 → committee fee-only 0.2 KAS <
  // 1 KAS oracleBond floor → SS 'verification failed'. Now committeeMode bond = oracleBond, merged
  // with oracleFee/N share in dispatchPhase2 → committee output = oracleBond + fee >= oracleBond ✓.
  // - v0.5: 3 oracle bond returns (+ forfeit redistribution) from real posted bonds.
  // - v0.6/v0.7: 5 committee members each get oracleBond (pool-funded) + oracleFee/5 share.
  // committeeMode NEVER skips a member (SS checks all N committee outputs c0..cN-1); the v0.5
  // forfeit_1 silent-skip applies only to non-committee markets.
  const oracleBondReturns = [];
  for (let i = 0; i < oracleCountForBonds; i++) {
    if (!committeeMode && !unanimous && silentOracleIndex === i) continue;
    const bondReturnAmount = committeeMode ? oracleBond : (oracleBond + perOracleForfeitShare);
    oracleBondReturns.push({ oracleIndex: i, amount: bondReturnAmount });
  }

  return { brokerFee, winnerPayouts, makerExtraOutput, oracleBondReturns };
}

/**
 * Phase 2a-2: dispatch settle TX preimage construction + DM oracles for sigs.
 * Only handles 'consensus' decisions (= unanimous OR majority_forfeit_1).
 * Refund branch handled separately in Phase 2a-3.
 *
 * Output layout per PoolSpine.sil entry 0 settle_unanimous:
 *   - outputs[0] = broker fee (P2PK brokerPk)
 *   - outputs[1..N] = N winner payouts (P2PK each winning bettor pubkey)
 *   - outputs[last 3] = oracle bond returns (P2PK each oraclePk)
 *
 * For forfeit_1 (1 silent oracle): silent oracle bond NOT returned (= forfeit),
 *   simplified to maker (Phase 2 KIP-10 loop refinement deferred).
 *
 * @param {object} market — pool_markets row
 * @param {{ winner: number, unanimous: boolean, silentOracleIndex?: number }} decision
 */
export async function dispatchPhase2(market, decision) {
  try {
    // 1. Read bettors from pool_bettor_sides
    const sides = sqlite.prepare(`
      SELECT bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index
      FROM pool_bettor_sides
      WHERE market_id = ?
        AND side_lock_tx IS NOT NULL
      ORDER BY merkle_index ASC
    `).all(market.id);

    // Bettor r293 Owner钦定: 0-bet shortcut. No bettor sides → no losing pool, no economics.
    // Route directly to dispatchRefund (refund_maker_unjoined) regardless of which side maker is on.
    // Avoids brittle error-string matching in catch (= ee92218 first attempt missed qlfpv case).
    if (sides.length === 0) {
      console.log(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} 0-bet shortcut → dispatchRefund`);
      await dispatchRefund(market, { action: 'refund', reason: '0-bet market (sides=0), refund_maker_unjoined' });
      return;
    }

    // Per Bettor r339: maker is a bettor (= not a seeder). maker direction = outcome_side mapping.
    const makerDirection = market.outcome_side === 'YES' ? 0 : 1;
    const makerStake = parseInt(market.maker_stake_amount, 10) || 0;

    // 2. Look up addresses
    // J2-tn r337 (Bettor 6/5 C2 实施): oracle_relay_ids field 复用存 addresses (= committee_addresses
    // 写入 by sampleAndStoreCommittee post-r337). dispatchPhase2 直接以 address 调 DM, 不查
    // relay_nodes (= peer-owned address 不在本地 relay_nodes 表).
    const oracleIds = JSON.parse(market.oracle_relay_ids || '[]');
    const oracleRows = oracleIds.map(addr => ({ id: null, address: addr }));
    if (oracleRows.some(r => !r?.address)) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} missing oracle addresses`);
      return;
    }
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (!makerRow?.address) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} no maker address`);
      return;
    }

    // r339 push 3: broker_relay_id required (= broker fee output dest, no longer placeholder).
    const brokerRow = market.broker_relay_id
      ? sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.broker_relay_id)
      : null;
    if (!brokerRow?.address) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} missing broker address (broker_relay_id=${market.broker_relay_id})`);
      return;
    }

    // Bettor addresses
    // Bettor r67 ACK + J1 r153 Owner P0 closed-loop back-half fix: external bettors
    // (bettor_relay_id NULL per register-external/v06 INSERT) derive payout address from
    // x-only bettor_pk via P2PK reconstruction (round-trip address→XOnlyPublicKey→address
    // verified PASS for standard P2PK wallet addresses). Relay-bound bettors continue
    // using relay_nodes.address. Edge case noted by Bettor r67: non-P2PK linkedAddr
    // (P2SH/multisig) would reconstruct to ≠ original; testnet standard wallets all P2PK
    // so acceptable for first-ship, /link endpoint hardening can validate-on-bind later.
    const kaspaWasm = await import('kaspa-wasm');
    const settleNetwork = market.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    const sideAddrs = sides.map(s => {
      if (s.bettor_relay_id) {
        const row = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(s.bettor_relay_id);
        return row?.address || null;
      }
      // External bettor: derive P2PK address from x-only bettor_pk.
      try {
        return new kaspaWasm.XOnlyPublicKey(s.bettor_pk).toAddress(settleNetwork).toString();
      } catch (e) {
        console.warn(`[pool-settler] external bettor pk→addr fail market=${market.id.slice(0,12)} bettor_pk=${String(s.bettor_pk).slice(0,8)}: ${e.message}`);
        return null;
      }
    });
    if (sideAddrs.some(a => !a)) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} missing bettor addresses`);
      return;
    }

    // 3. Build participants array (= maker + bettors), use pure function computePoolPayouts.
    const participants = [
      { addr: makerRow.address, stake: makerStake, direction: makerDirection, isMaker: true },
      ...sides.map((s, i) => ({ addr: sideAddrs[i], stake: parseInt(s.stake_amount, 10) || 0, direction: s.direction, isMaker: false })),
    ];

    // min-pot 选项 A 落地 (Owner 2026-06-01 终裁, docs/2026-06-01-min-pot-thin-market-refund-decision.md):
    // displayName=THIN-MARKET PRE-CHECK. 显式公式 boolean too_small, 禁 string-match throw catch.
    //
    // 真根因 (ccvr9 实证): 输方池 < N×oracleBondAmount + broker_floor + KIP-9 margin → settle TX
    // payout outputs 小 → Σ(1/output_value) 爆 KIP-9 storage mass cap → mempool reject. v0.6+v0.7
    // 都 anonymous-pool 5-committee 模式同 risk.
    //
    // Threshold = 5 × oracleBondAmount + MIN_BROKER_FEE_SOMPI + STORAGE_MASS_MARGIN.
    //   = 5 × 1 KAS + 0.05 KAS + 0.01 KAS = ~5.06 KAS losing-side floor for default 1 KAS bond.
    //
    // Cancel path (= N+1 退款 by Owner+J1 r245 LOCK):
    //   1. status='cancelled' + chain_event 'market_cancelled' (= audit trail)
    //   2. dispatchRefund(maker) → spine refund_maker_unjoined (v0.7 mass-aware byte-size 已 ship)
    //   3. emit 'bettor_refund_available' per bettor (= 通知 bettor client 自家 claim PoolSide
    //      entry 2 refund_market_cancelled, settler 不 sign because no bettor privkey)
    const isAnonymousPool0 = market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7';
    if (isAnonymousPool0) {
      const losingDirection = 1 - decision.winner;
      const losingPool = participants
        .filter(p => p.direction === losingDirection)
        .reduce((s, p) => s + p.stake, 0);
      const oracleBondAmount = parseInt(market.oracle_bond_amount, 10) || 100_000_000;
      const N_COMMITTEE = 5;
      const STORAGE_MASS_MARGIN = 1_000_000;  // 0.01 KAS headroom for KIP-9 numerical safety
      const thinThreshold = N_COMMITTEE * oracleBondAmount + MIN_BROKER_FEE_SOMPI + STORAGE_MASS_MARGIN;
      if (losingPool < thinThreshold) {
        console.log(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} THIN MARKET losing_pool=${losingPool} < threshold=${thinThreshold} (5×bond=${5*oracleBondAmount} + broker=${MIN_BROKER_FEE_SOMPI} + margin=${STORAGE_MASS_MARGIN}) → cancel + N+1 refund`);
        // 1. Status transition + audit event
        sqlite.prepare('UPDATE pool_markets SET protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run('cancelled', market.id);
        const cancelEventPayload = JSON.stringify({
          market_id: market.id,
          reason: 'thin_losing_side',
          losing_pool: losingPool,
          threshold: thinThreshold,
          losing_direction: losingDirection,
          winner: decision.winner,
          cancelled_at: new Date().toISOString(),
        });
        sqlite.prepare(`
          INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
          VALUES (lower(hex(randomblob(16))), ?, 'market_cancelled', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
        `).run(`market_cancelled:${market.id.slice(0,12)}:${Date.now()}`, cancelEventPayload);
        // 2. Auto maker refund (= spine refund_maker_unjoined via existing dispatchRefund path)
        await dispatchRefund(market, {
          action: 'refund',
          reason: `thin-market cancel: losing_pool=${losingPool} < threshold=${thinThreshold}`,
        });
        // 3. Per-bettor cancel events for client-side self-claim. settler can't sign because no privkey.
        for (const side of sides) {
          const bettorRefundPayload = JSON.stringify({
            market_id: market.id,
            bettor_pk: side.bettor_pk,
            side_p2sh: side.side_p2sh,
            side_lock_tx: side.side_lock_tx,
            stake: side.stake_amount,
            direction: side.direction,
            reason: 'market_cancelled_thin_losing_side',
            claim_entry: 'PoolSide_v07 entry 2 refund_market_cancelled',
          });
          sqlite.prepare(`
            INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
            VALUES (lower(hex(randomblob(16))), ?, 'bettor_refund_available', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
          `).run(`bettor_refund:${market.id.slice(0,12)}:${String(side.bettor_pk).slice(0,12)}:${Date.now()}`, bettorRefundPayload);
        }
        console.log(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} CANCELLED + maker_refund dispatched + ${sides.length} bettor_refund_available events emitted`);
        return;
      }
    }

    let payouts;
    // A批2 动态费 (Bettor r402 + r404 catch refinement): replace static Math.max(fee, 5_000_000) with
    // byte-mass-aware compute. Bettor r404 实证: qoyqv 实 mass=17136, 我 v1 估 10795 = 低估 1.6x
    // 因 spine scriptSig 实际 ~4KB (5sig+5pk+40siblings+redeem+selector OPs) NOT 2.5KB. 修正估算 +
    // 多 multiplier 安全余量.
    //
    // Spine scriptSig 拆解 (PoolSpine_v07 settle_aggregate):
    //   5 sigs push-encoded (66B each) = 330
    //   5 committee_pks push (33B each) = 165
    //   5 committee_indices push (small int ~2B each) = 10
    //   40 merkle siblings push (33B each) = 1320
    //   spine_redeem ~2100B (PoolSpine_v07 含 sharding)
    //   selector OP_0 + winner OP + sidesMerkleRoot push (~36B)
    //   v0.7 sharding extras (globalYes/No/commit_v2 ~60B)
    //   subtotal ~4021B (= Bettor r404 confirmed shape)
    let metaForFee = {};
    try { metaForFee = JSON.parse(market.metadata || '{}'); } catch {}
    const spineRedeemHex = metaForFee.spine_redeem_script_hex || '';
    const spineRedeemSize = spineRedeemHex ? Buffer.from(spineRedeemHex, 'hex').length : 2100;
    const SPINE_SIGS_PKS = 66 * 5 + 33 * 5;       // 5 sigs + 5 committee PKs push-encoded
    const SPINE_INDICES = 2 * 5;                  // 5 small int indices
    const SPINE_SIBLINGS = 33 * 40;                // 5 committee × 8 depth merkle siblings
    const SPINE_SELECTOR_WINNER_MERKLE = 36;       // OP_0 + winner OP + sidesMerkleRoot push
    const SPINE_V07_SHARDING = market.protocol_version === 'v0.7' ? 60 : 0;
    const SPINE_SCRIPTSIG_OVERHEAD = SPINE_SIGS_PKS + SPINE_INDICES + SPINE_SIBLINGS + SPINE_SELECTOR_WINNER_MERKLE + SPINE_V07_SHARDING;
    const spineInputSize = 45 + SPINE_SCRIPTSIG_OVERHEAD + spineRedeemSize;
    let sidesInputSize = 0;
    for (const s of sides) {
      const sideRedeemSize = s.side_redeem_script_hex ? Buffer.from(s.side_redeem_script_hex, 'hex').length : 2000;
      sidesInputSize += 45 + 4 + sideRedeemSize;  // input overhead + OP_0 selector + redeem (no PUSHDATA2 prefix needed for ≤520B but ~2KB → push prefix 3B included in 4)
    }
    const outputsCount = 1 + 5 + participants.filter(p => p.direction === decision.winner).length;  // broker + 5 committee + winners
    const outputsSize = outputsCount * 50;
    const txByteEstimate = spineInputSize + sidesInputSize + outputsSize + 80;
    // Bettor r404 catch: bump multiplier 2.5 → 3 for safety margin (= cover storage_mass component
    // KIP-9 + estimation slack). Real qoyqv 17136/6545 ≈ 2.62 ratio + storage_mass for thin markets
    // dominates → 3 covers both compute + storage portions.
    const MASS_MULTIPLIER_X10 = 30;
    const massEst = Math.ceil(txByteEstimate * MASS_MULTIPLIER_X10 / 10);
    const SETTLE_FEE_MIN = 2_000_000;  // 0.02 KAS floor (= settle 大 TX 起步 + Bettor r404 安全余量)
    const SETTLE_FEE_MAX = 100_000_000;  // 1 KAS cap defense
    let dynamicFee = Math.max(SETTLE_FEE_MIN, massEst * 110);
    if (dynamicFee > SETTLE_FEE_MAX) dynamicFee = SETTLE_FEE_MAX;
    console.log(`[pool-settler] settle mass-aware fee market=${market.id.slice(0,12)} txBytes≈${txByteEstimate} mass≈${massEst} fee=${dynamicFee} (sides=${sides.length}, winners=${outputsCount-6}, spineRedeem=${spineRedeemSize}B)`);
    try {
      const baseMinerFee = parseInt(market.miner_fee, 10) || 20_000;
      // DoD #1.2 sweep: v0.6 + v0.7 都是 anonymous-pool 5-committee 模式. v0.5 legacy 路径 keep
      // baseMinerFee 不动 (= 改 v0.6/v0.7 为 byte-mass dynamicFee, v0.5 不在 scope).
      const isAnonymousPool = market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7';
      const minerFeeFinal = isAnonymousPool ? dynamicFee : baseMinerFee;
      payouts = computePoolPayouts({
        participants,
        winner: decision.winner,
        brokerFeePct: parseInt(market.broker_fee_pct, 10) || 0,
        oracleBond: parseInt(market.oracle_bond_amount, 10) || 0,
        minerFee: minerFeeFinal,
        unanimous: decision.unanimous,
        silentOracleIndex: decision.silentOracleIndex ?? null,
        oracleCount: isAnonymousPool ? 5 : 3,
        committeeMode: isAnonymousPool,
      });
    } catch (e) {
      // Bettor r291/r293 Owner钦定 auto-refund: 0-bet markets fail computePoolPayouts via
      // multiple strings: 'no winners' (= side empty after vote winner determined), OR
      // 'losing pool (0) less than minerFee' (= 0 sides bet at all), OR
      // 'less than broker_fee'. All mean 0-economy → route to dispatchRefund.
      const msg = e.message || '';
      const is0Bet = msg.includes('no winners')
        || msg.includes('losing pool (0)')
        || msg.includes('less than minerFee')
        || msg.includes('less than broker_fee');
      if (is0Bet) {
        console.log(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} 0-bet (${msg.slice(0,80)}) → route to dispatchRefund`);
        await dispatchRefund(market, { action: 'refund', reason: '0-bet market, refund_maker_unjoined' });
        return;
      }
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} computePoolPayouts fail: ${e.message}`);
      return;
    }

    // 4. Build outputs per PoolSpine.sil entry 0 ordering:
    //    [broker, winner_1..winner_N, optional maker creator-fee output, oracle_bond_returns[+oracleFee/3]]
    //
    // Sub 5b (Oracle v0.3 J1 #21 critical gap fix): NWT sub 4 PoolSpine ctor 12 + outputs[last 3]
    // 合并 bond + oracleFee/3 per oracle (= 3 oracle outputs each get bond_return + oracleFee/3 share).
    // outputs.length 不变 (= PoolSpine 3 oracle), 但 amount 含 oracleFee share.
    const oracleFeePct = parseInt(market.oracle_fee_pct, 10) || 100;  // default 1% per Bettor r17 truth matrix
    const losingPoolForOracleFee = Math.max(0, parseInt(market.maker_stake_amount, 10) || 0); // approx; per NWT spec deviated
    // Per Bettor r17 truth matrix: oracleFee = oracleFeePct × losingPool (= same source as brokerFee).
    // computePoolPayouts didn't compute this; sub 5b adds explicitly.
    const totalLoserStake = participants.filter(p => p.direction !== decision.winner).reduce((s, p) => s + p.stake, 0);
    const baseMinerFeeSompi = parseInt(market.miner_fee, 10) || 20_000;
    // A批2 动态费 (Bettor r402 + Owner 钦定): v0.6+v0.7 用 dynamicFee 同 L798. v0.5 keep base.
    const isAnonymousPoolOutputs = market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7';
    const minerFeeSompi = isAnonymousPoolOutputs ? dynamicFee : baseMinerFeeSompi;
    const oracleLosingPool = Math.max(0, totalLoserStake - minerFeeSompi);
    const oracleFeeTotal = Math.floor(oracleLosingPool * oracleFeePct / 10000);
    const oracleFeeDivisor = isAnonymousPoolOutputs ? 5 : 3;
    const oracleFeePerSig = Math.floor(oracleFeeTotal / oracleFeeDivisor);
    // Spec note: oracleFeeTotal % 3 余数 (= 0-2 sompi) 留 brokerFee 端 (= 等同 W3 余数 maker pattern reuse).
    // Per J1 #4 fix: oracleFee deducted from broker pool? No — 跟 Bettor r17 truth matrix "brokerFeePct × losingPool" + "oracleFeePct × losingPool" 是 2 个独立 channel, 不 carved from broker.
    // Settler 必从 distributablePool 进一步扣除 oracleFeeTotal (= winner pool 减小). 这是 NWT sub 4 PoolSpine 改的 semantic.

    const outputs = [];
    if (payouts.brokerFee > 0) {
      outputs.push({ address: brokerRow.address, amountSompi: payouts.brokerFee.toString() });
    }
    // Bettor r277 layer-19: v0.6/v0.7 PoolSpine settle_aggregate fixed output layout:
    // [0]=broker, [1..5]=5 committee P2PKs (>= oracleBondAmount each), [6..]=winners.
    // v0.5 had [broker, winners, makerExtra, oracleBondReturns] — committee at end.
    // Reorder for v0.6/v0.7: insert oracleBondReturns (+ fee/N) BEFORE winners.
    if (isAnonymousPoolOutputs) {
      for (const r of payouts.oracleBondReturns) {
        const mergedAmount = r.amount + oracleFeePerSig;
        outputs.push({ address: oracleRows[r.oracleIndex].address, amountSompi: mergedAmount.toString() });
      }
    }
    // Winners reduced by oracleFeeTotal share — proportional to original share
    // (= 等同 W2 spec "distributablePool = losingPool − brokerFee" 加 minus oracleFeeTotal)
    let winnerOracleFeeDeducted = 0;
    for (const w of payouts.winnerPayouts) {
      // Pro-rata oracleFee deduction (= winner share scales linearly with stake)
      const winnerStake = participants[w.participantIndex].stake;
      const totalWinnerStake = payouts.winnerPayouts.reduce((s, p) => s + participants[p.participantIndex].stake, 0);
      const oracleFeeShareForWinner = totalWinnerStake > 0 ? Math.floor(oracleFeeTotal * winnerStake / totalWinnerStake) : 0;
      const adjustedAmount = Math.max(0, w.amount - oracleFeeShareForWinner);
      winnerOracleFeeDeducted += oracleFeeShareForWinner;
      outputs.push({ address: participants[w.participantIndex].addr, amountSompi: adjustedAmount.toString() });
    }
    if (payouts.makerExtraOutput) {
      outputs.push({ address: makerRow.address, amountSompi: payouts.makerExtraOutput.toString() });
    }
    if (!isAnonymousPoolOutputs) {
      // v0.5 legacy layout: bond returns at end
      for (const r of payouts.oracleBondReturns) {
        const mergedAmount = r.amount + oracleFeePerSig;
        outputs.push({ address: oracleRows[r.oracleIndex].address, amountSompi: mergedAmount.toString() });
      }
    }

    // 5. Build input outpoints. Spine P2SH has MULTIPLE UTXOs: 1 maker stake (spine_lock_tx) +
    //    N oracle bond deposits (= each oracle/deposit was a separate transfer → separate UTXO).
    //    Phase 3 e2e caught: settle TX missing oracle bond UTXOs → kaspad "spend > inputs".
    //    All spine-P2SH UTXOs need PoolSpine settle_unanimous scriptSig (3 sigs each).
    const depositRows = sqlite.prepare(`
      SELECT payload FROM chain_events
      WHERE event_type = 'pool_oracle_deposit' AND payload LIKE ?
    `).all(`%"market_id":"${market.id}"%`);
    const oracleDepositOutpoints = depositRows.map(r => {
      const p = JSON.parse(r.payload);
      return { outpointTxid: p.deposit_tx, outpointIndex: 0 };
    });
    // Spine inputs = maker stake UTXO + N oracle bond UTXOs (= all locked by PoolSpine redeem)
    const spineInputCount = 1 + oracleDepositOutpoints.length;
    const requiredInputOutpoints = [
      { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },  // maker stake
      ...oracleDepositOutpoints,                                  // N oracle bonds
      ...sides.map(s => ({ outpointTxid: s.side_lock_tx, outpointIndex: 0 })),  // N bettor sides
    ];

    // Bug 8: pre-settle KIP-9 storage mass check. A settle TX with too-small outputs blows
    // the kaspad storage mass cap (500k) → rejected forever. Abort + mark needs_larger_pot
    // rather than retry a doomed submit every tick.
    const inputValues = [
      parseInt(market.maker_stake_amount, 10) || 0,
      ...oracleDepositOutpoints.map(() => parseInt(market.oracle_bond_amount, 10) || 0),
      ...sides.map(s => parseInt(s.stake_amount, 10) || 0),
    ];
    const outputValues = outputs.map(o => parseInt(o.amountSompi, 10) || 0);
    const estMass = estimateStorageMass(inputValues, outputValues);
    if (estMass > STORAGE_MASS_SAFE_THRESHOLD) {
      // min-pot 选项 A (Bettor r337 实证 unmfw 50 KAS 输方仍触): storage-mass cap 是 KIP-9
      // pool-dependent (≈ 1/pool); 单纯 5×oracleBond pre-check 不充分. 真根因 = 任何
      // payout outputs 触 storage_mass > cap → 该走 cancel-refund 不是 needs_larger_pot
      // 永久标记 (= 钱永远卡 verifying 状态, 用户无法取). 改: 触 storage-mass cap → 跟
      // pre-check 同 cancel-refund 路径.
      const isAnonymousPoolCancel = market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7';
      if (isAnonymousPoolCancel) {
        console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} estimated storage mass ${estMass} > ${STORAGE_MASS_SAFE_THRESHOLD} (cap ${STORAGE_MASS_CAP}) → THIN-MARKET cancel-refund (= KIP-9 storage-mass post-build floor)`);
        sqlite.prepare('UPDATE pool_markets SET protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run('cancelled', market.id);
        const cancelEventPayload = JSON.stringify({
          market_id: market.id,
          reason: 'storage_mass_exceed_cap',
          est_storage_mass: estMass,
          cap: STORAGE_MASS_CAP,
          threshold: STORAGE_MASS_SAFE_THRESHOLD,
          winner: decision.winner,
          cancelled_at: new Date().toISOString(),
        });
        sqlite.prepare(`
          INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
          VALUES (lower(hex(randomblob(16))), ?, 'market_cancelled', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
        `).run(`market_cancelled:${market.id.slice(0,12)}:${Date.now()}`, cancelEventPayload);
        await dispatchRefund(market, {
          action: 'refund',
          reason: `thin-market cancel: est_storage_mass=${estMass} > cap=${STORAGE_MASS_CAP}`,
        });
        for (const side of sides) {
          const bettorRefundPayload = JSON.stringify({
            market_id: market.id,
            bettor_pk: side.bettor_pk,
            side_p2sh: side.side_p2sh,
            side_lock_tx: side.side_lock_tx,
            stake: side.stake_amount,
            direction: side.direction,
            reason: 'market_cancelled_storage_mass_exceed_cap',
            claim_entry: 'PoolSide_v07 entry 2 refund_market_cancelled',
          });
          sqlite.prepare(`
            INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
            VALUES (lower(hex(randomblob(16))), ?, 'bettor_refund_available', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
          `).run(`bettor_refund:${market.id.slice(0,12)}:${String(side.bettor_pk).slice(0,12)}:${Date.now()}`, bettorRefundPayload);
        }
        console.log(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} CANCELLED storage-mass + maker_refund dispatched + ${sides.length} bettor_refund_available events emitted`);
        return;
      }
      // v0.5 legacy 仍 mark needs_larger_pot (= 不变 legacy behavior, 待 owner spec).
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} estimated storage mass ${estMass} > ${STORAGE_MASS_SAFE_THRESHOLD} (cap ${STORAGE_MASS_CAP}) — v0.5 legacy mark needs_larger_pot`);
      let prevM = {};
      try { prevM = JSON.parse(market.metadata || '{}'); } catch {}
      sqlite.prepare('UPDATE pool_markets SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify({ ...prevM, needs_larger_pot: true, est_storage_mass: estMass }), market.id);
      return;
    }

    // 6. Call maker_relay 'prediction_settle_build_preimage' with multi-p2sh array.
    //    Spine P2SH appears once in p2sh list (= all its UTXOs fetched by that address).
    //    Phase 3 bug 5: per-input sigOpCount — spine inputs have 3 checkSig, sides 0.
    //    Preimage sigOpCount MUST match final settle TX (= Kaspa sighash includes sig_op_counts_hash).
    const p2shAddresses = [market.spine_p2sh, ...sides.map(s => s.side_p2sh)];
    // Bettor r271/r275 layer-16/18: budget formula 100k×N+9999. v0.6 used 510021,
    // sigOpCount=5 budget=509999 → 22 short. Bump 8 → 809999 (~59% margin).
    // sigOpCount IS in sighash → reset/re-collect on change.
    // DoD #1.2 sweep: v0.7 same as v0.6 sigOpCount budget (= same 5 committee sigs + selector args).
    // v0.7 sharding adds 3 extra args (globalYes/No/commit_v2) but those are byte[]/int pushes,
    // not checkSig opcodes — sigOpCount unchanged at 8.
    const spineSigOpCount = (market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7') ? 8 : 3;
    const sigOpCounts = requiredInputOutpoints.map((_, i) => (i < spineInputCount ? spineSigOpCount : 0));
    const preimage = await sendCommandAsync(market.maker_relay_id, {
      type: 'prediction_settle_build_preimage',
      p2sh_address: p2shAddresses,  // array — multi-p2sh extension Phase 2a-1
      required_input_outpoints: requiredInputOutpoints,
      outputs,
      sig_op_counts: sigOpCounts,
    });
    if (!preimage?.ok || !preimage.tx_obj) {
      console.error(`[pool-settler] dispatchPhase2 build_preimage fail market=${market.id.slice(0,12)}: ${preimage?.error}`);
      return;
    }

    // 7. Stash phase2_tx_obj + winner + silent_oracle_index in pool_markets.metadata
    // CRITICAL: spread prior metadata (= preserve spine_redeem_script_hex stashed at create time).
    // Phase 3 e2e caught: without ...prevMeta the create-time spine_redeem_script_hex got wiped →
    // handleCollectingSigs "missing meta.spine_redeem_script_hex" → settle TX cannot assemble.
    let prevMeta = {};
    try { prevMeta = JSON.parse(market.metadata || '{}'); } catch {}
    const newMeta = {
      ...prevMeta,
      phase2_tx_obj: preimage.tx_obj,
      phase2_winner: decision.winner,
      phase2_unanimous: decision.unanimous,
      phase2_silent_oracle_index: decision.silentOracleIndex ?? null,
      phase2_dispatched_at: new Date().toISOString(),
      phase2_input_count: requiredInputOutpoints.length,
      phase2_spine_input_count: spineInputCount,  // Phase 3 bug 4: spine has 1 maker + N oracle bond UTXOs
      phase2_output_count: outputs.length,
      phase2_outputs: outputs,  // Phase 2c step 2c: full outputs array for collecting_sigs handler IPC assembly
    };
    // J1 r221 + Bettor r218 ③ Layer-12: v0.6 settle_aggregate needs committee data — fetch
    // 5 committee pks + their indices in pool_snapshots + 5×8 merkle proofs + committee_pk_hash,
    // persist into meta so relay can assemble scriptSig per PoolSpine_v06.sil entry 0 spec.
    if (market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7') {
      try {
        const committeeRow = sqlite.prepare('SELECT committee_pks, committee_pk_hash FROM pool_committee WHERE market_id = ?').get(market.id);
        if (!committeeRow) throw new Error('pool_committee row missing');
        const committee_pks = JSON.parse(committeeRow.committee_pks);  // 5-element array, in selection order
        if (!Array.isArray(committee_pks) || committee_pks.length !== 5) throw new Error('committee_pks must be 5');
        const { loadPoolSnapshot } = await import('./pool-market-settler-v06.mjs');
        const snapshot = loadPoolSnapshot(market.id);
        const { buildPoolMerkleTree, getPoolMerkleProof } = await import('./pool-merkle-v06.mjs');
        // Bettor r221 hardening: buildPoolMerkleTree internally sorts. Use tree.sortedPks
        // for index resolution to guarantee alignment regardless of snapshot storage order.
        const tree = buildPoolMerkleTree(snapshot.pool_pks.map(p => String(p).toLowerCase()));
        const sortedPks = tree.sortedPks;
        const committee_indices = committee_pks.map(pk => {
          const i = sortedPks.indexOf(String(pk).toLowerCase());
          if (i < 0) throw new Error(`committee pk ${pk.slice(0,12)} not in pool snapshot`);
          return i;
        });
        const committee_merkle_proofs = committee_indices.map(idx =>
          getPoolMerkleProof(tree, idx).map(buf => buf.toString('hex'))
        );  // 5 arrays of 8 hex strings each = 40 sibling hashes total
        newMeta.phase2_committee_pks = committee_pks;
        newMeta.phase2_committee_indices = committee_indices;
        newMeta.phase2_committee_merkle_proofs = committee_merkle_proofs;
        newMeta.phase2_committee_pk_hash = committeeRow.committee_pk_hash;
        console.log(`[pool-settler] v0.6 committee data baked market=${market.id.slice(0,12)} indices=[${committee_indices.join(',')}]`);
      } catch (e) {
        console.error(`[pool-settler] dispatchPhase2 v0.6 committee data fail market=${market.id.slice(0,12)}: ${e.message}`);
        return;
      }
    }

    // Bettor r353 — v0.7 settle_aggregate sharding globals (qoyqv 实证 'pick at invalid location'):
    // PoolSpine_v07.sil settle_aggregate (L103-105) ADDS 3 args between indices and siblings:
    // globalYesTotal_sompi (int), globalNoTotal_sompi (int), global_commit_id (byte[32]).
    // SS require()s them (L298-315): globalYes/No >= 0, sum >= 1e10, losingPool>=5×bond.
    // v0.6 SS has NO these args (46f8a settled without) → bake ONLY for v0.7. Missing them =
    // scriptSig short 3 stack items → all sibling picks off-by-3 → 'pick at invalid location'.
    // direction 0=YES 1=NO (same convention as thin-check losingDirection above).
    if (market.protocol_version === 'v0.7') {
      const globalYes = participants.filter(p => p.direction === 0).reduce((s, p) => s + p.stake, 0);
      const globalNo = participants.filter(p => p.direction === 1).reduce((s, p) => s + p.stake, 0);
      // global_commit_id: SS L322-329 blake2b commit-check is INACTIVE (silverc int-to-byte
      // unconfirmed) → field is layout-only (attested via committee sighash, not require()'d).
      // Deterministic placeholder until J1 activates the cross-shard commit check.
      const crypto = await import('crypto');
      const globalCommitId = crypto.createHash('sha256').update(market.id).digest('hex');
      newMeta.phase2_global_yes_sompi = globalYes;
      newMeta.phase2_global_no_sompi = globalNo;
      newMeta.phase2_global_commit_id = globalCommitId;
      console.log(`[pool-settler] v0.7 sharding globals baked market=${market.id.slice(0,12)} globalYes=${globalYes} globalNo=${globalNo}`);
    }

    // 8. DM 3 oracle relays with kanet_pool_oracle_tx_sign_req_v1
    //    (= adapted from 1V1 kanet_oracle_tx_sign_req_v1, uses market_id instead of offer_id)
    const reqPayloadObj = {
      t: 'kanet_pool_oracle_tx_sign_req_v1',
      market_id: market.id,
      winner: decision.winner,
      unanimous: decision.unanimous,
      silent_oracle_index: decision.silentOracleIndex ?? null,
      input_count: requiredInputOutpoints.length,
      spine_input_count: spineInputCount,
      // J2-tn r377 (Bettor 15:12 catch): include phase2_tx_obj 跨节点 — :3300 委员收 sign_req
      // 不在本地 metadata 找不到 phase2_tx_obj → skip. 嵌入广播 payload (= chunked broadcast
      // SAFE_CHUNK_BUDGET 450 + sendBroadcastChunked 兜底). 各节点 handler 自取 phase2_tx_obj
      // → sign_input_for_settle IPC → sign_resp broadcast.
      phase2_tx_obj: newMeta.phase2_tx_obj,
    };
    const reqPayload = JSON.stringify(reqPayloadObj);
    // Persist payload for handleCollectingSigs re-DM (KANet-UI r387 follow-up).
    newMeta.phase2_request_payload = reqPayloadObj;
    sqlite.prepare('UPDATE pool_markets SET metadata = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(newMeta), 'collecting_sigs', market.id);

    // KANet-UI r386 Layer-9 KI 49: v0.6 5-oracle path. v0.5 hardcoded [0,1,2] missed 5-committee.
    // For v0.6 unanimous (5/5 same): all 5 sign. For v0.6 non-unanimous (4/5): exclude silent.
    const oracleN = oracleRows.length;
    const allIdx = Array.from({ length: oracleN }, (_, i) => i);
    const signingOracles = decision.unanimous
      ? allIdx
      : allIdx.filter(i => i !== decision.silentOracleIndex);
    // J2-tn r375 (Bettor 15:04 钦定): sign_req DM 改 broadcast (= 投票 proven pattern).
    // r377 (Bettor 15:12 catch): reqPayload 含 phase2_tx_obj 大概率 > SAFE_CHUNK_BUDGET →
    // chunked broadcast (= 同 _broadcastMarketPublished pattern). 各节点 handler 取
    // pool_market_chunk_v1 reassembly then dispatch sign_req.
    try {
      const { sendBroadcastChunked } = await import('../lib/pool-broadcast.mjs');
      await sendBroadcastChunked(market.maker_relay_id, 'kanet-prediction', reqPayload);
    } catch (err) {
      console.warn(`[pool-settler] sign_req broadcast fail market=${market.id.slice(0,12)}: ${err.message}`);
    }

    console.log(`[pool-settler] DISPATCHED Phase 2 market=${market.id.slice(0,12)} winner=${decision.winner} unanimous=${decision.unanimous} inputs=${requiredInputOutpoints.length} outputs=${outputs.length} sign_req → broadcast → collecting_sigs`);
  } catch (e) {
    console.error(`[pool-settler] dispatchPhase2 fail market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}

/**
 * Phase 2a-3: dispatch refund_unanimous_silent — maker single-sig refund TX.
 *
 * Per PoolSpine.sil entry 2 refund_unanimous_silent:
 *   - Maker single-sig (no oracle sigs needed)
 *   - require(tx.time >= deadline)
 *   - Maker recovers stake + 3 oracle bonds (= total forfeit to maker)
 *
 * Bettor sides separately refund via PoolSide.refund_market_cancelled entry 2.
 * For Phase 2a-3 first ship: only spine refund TX broadcast (= maker recover).
 * Bettor side refunds happen async via their own claim TX.
 *
 * @param {object} market — pool_markets row
 * @param {object} decision — { action: 'refund', reason: string }
 */
export async function dispatchRefund(market, decision) {
  try {
    const makerStake = parseInt(market.maker_stake_amount, 10) || 0;
    const oracleBond = parseInt(market.oracle_bond_amount, 10) || 0;

    // Look up maker address (needed for both fee compute + preimage outputs)
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (!makerRow?.address) {
      if (typeof market.maker_relay_id === 'string' && market.maker_relay_id.startsWith('cross-node:')) {
        console.log(`[pool-settler] dispatchRefund skip cross-node market ${market.id.slice(0,12)} (maker on remote host, refund must dispatch from producer node)`);
      } else {
        console.warn(`[pool-settler] dispatchRefund market=${market.id.slice(0,12)} no maker address`);
      }
      return;
    }
    const networkId = makerRow.address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';

    // Fee compute branches by protocol version:
    //   v0.5: legacy fixed minerFee from market row (SS 焊死, can't change here).
    //   v0.6: G2-B 二期 sediment — SS L281 require value==stake-ctor_minerFee, MUST use
    //         baseMinerFeeR (= same as ctor). 47ff13d not floor (qlfpv 实测).
    //   v0.7: G6 批3 段① — SS L372/373 fee 范围 [MIN_FEE=50_000, MAX_FEE=100M]. RED-LINE 2
    //         (Bettor r297): fee MUST be mass-aware dynamic, 不 static 常数. Compute via
    //         kaspa.calculateTransactionMass on a dummy signed-shape TX (= placeholder
    //         scriptSig with same byte layout as real → mass identical to real signed TX).
    const baseMinerFeeR = parseInt(market.miner_fee, 10) || 20_000;
    let minerFee;
    if (market.protocol_version === 'v0.7') {
      try {
        minerFee = await computeMassAwareV07RefundFee({
          market, makerStake, networkId, makerAddress: makerRow.address,
        });
        console.log(`[pool-settler] dispatchRefund v0.7 mass-aware fee market=${market.id.slice(0,12)} fee=${minerFee} (= mass × 110 sompi/mass + cap [50000, 1e8])`);
      } catch (massErr) {
        console.error(`[pool-settler] dispatchRefund v0.7 mass compute fail market=${market.id.slice(0,12)}: ${massErr.message}`);
        return;
      }
    } else {
      minerFee = baseMinerFeeR;
    }

    const isAnonymousPool = market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7';
    const makerRefundAmount = isAnonymousPool
      ? (makerStake - Number(minerFee))
      : (makerStake + oracleBond * 3 - Number(minerFee));  // v0.5: 3 bonds in spine
    if (makerRefundAmount <= 0) {
      console.warn(`[pool-settler] dispatchRefund market=${market.id.slice(0,12)} makerRefundAmount=${makerRefundAmount} ≤ 0, skip`);
      return;
    }

    // Build refund TX preimage — reuse 'prediction_settle_build_preimage' IPC with single-p2sh + 1 output
    const preimage = await sendCommandAsync(market.maker_relay_id, {
      type: 'prediction_settle_build_preimage',
      p2sh_address: market.spine_p2sh,
      required_input_outpoints: [
        { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },
      ],
      outputs: [
        { address: makerRow.address, amountSompi: makerRefundAmount.toString() },
      ],
    });
    if (!preimage?.ok || !preimage.tx_obj) {
      console.error(`[pool-settler] dispatchRefund build_preimage fail market=${market.id.slice(0,12)}: ${preimage?.error}`);
      return;
    }

    // 4. Stash refund metadata + transition to refunding (single-sig path skips collecting_sigs)
    let prevMeta = {};
    try { prevMeta = JSON.parse(market.metadata || '{}'); } catch {}
    const newMeta = {
      ...prevMeta,
      refund_tx_obj: preimage.tx_obj,
      refund_reason: decision.reason,
      refund_dispatched_at: new Date().toISOString(),
      refund_amount: makerRefundAmount,
    };
    sqlite.prepare('UPDATE pool_markets SET metadata = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(newMeta), 'refunding', market.id);

    // 5. Phase 2a-3 first ship: stash only. Phase 2b collecting_sigs handler will trigger maker sign + broadcast.
    //    For maker single-sig refund, simpler: maker_relay signs locally + broadcasts immediately (no DM needed).
    //    Future iteration: route through collecting_sigs handler for state machine consistency.
    console.log(`[pool-settler] DISPATCHED Refund market=${market.id.slice(0,12)} reason=${decision.reason} maker_refund=${makerRefundAmount} → refunding`);
  } catch (e) {
    console.error(`[pool-settler] dispatchRefund fail market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}

/**
 * G6 批 3 段① (Bettor r296/r297): compute v0.7 refund TX fee from real mass.
 *
 * Why mass-aware:
 *   - v0.7 PoolSpine_v07.sil refund_maker_unjoined (L370-373) uses fee 范围 [MIN_FEE=50_000,
 *     MAX_FEE=100M] NOT 焊死 ctor minerFee. SS accepts ANY fee in range; settler 必 pick
 *     fee >= mempool floor (mass × 100 sompi/mass) but not wastefully high.
 *   - Bettor 红线 2 (Bettor r239): fee = mass × rate, 禁静态常数. 5M floor (v0.6 sediment) 是
 *     overpay (~11x) violation of 红线 2.
 *
 * Algorithm:
 *   1. Build a fake signed TX with placeholder scriptSig (= same byte layout as real signed
 *      TX). makerSig is 66 bytes (push-encoded), OP_2 selector 1 byte, OP_PUSHDATA2 redeem
 *      push = 3 + redeem.length bytes. Total scriptSig size matches real TX.
 *   2. kaspa.calculateTransactionMass(networkId, fakeTx) → real mass.
 *   3. fee = max(mass × 110, MIN_FEE) (= 10% safety margin over mempool floor 100).
 *   4. Cap fee at MAX_FEE (= prevent runaway, defense against maker-rob-self attack).
 *
 * Returns: BigInt fee (sompi).
 */
async function computeMassAwareV07RefundFee({ market, makerStake, networkId, makerAddress }) {
  const V07_MIN_FEE = 50_000n;
  const V07_MAX_FEE = 100_000_000n;
  const SOMPI_PER_MASS = 110n;  // 10% margin over mempool floor 100 (qlfpv 实测 442000/4420=100)

  // Read v0.7 spine redeem from market metadata (stashed at create-v07 time).
  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch {}
  const spineRedeemHex = meta.spine_redeem_script_hex;
  if (!spineRedeemHex) throw new Error('market.metadata missing spine_redeem_script_hex');

  // G6 批 3 段① Bettor r311 hard-stop + r301 方案 (a): byte-size mass 估算, 完全绕开 WASM.
  // calculateTransactionMass 在 Console 端 (4 次 panic: Resolver/unreachable/outpoint/scriptPK)
  // 和 relay 端 (f4b74b0 仍 unreachable) 都失败. WASM 字段地狱无法稳, 退到 KIP-9 byte-size
  // 估算 — refund TX 是固定形状 (1 in 1 out + ~1942 byte redeem), byte size 可静态计算.
  //
  // Byte size 分解:
  //   input: 32 txid + 4 vout + sigScript_size + 8 seq + 1 sigOpCount ≈ 45 + sigScript
  //   sigScript: 66 sig push + 1 OP_2 + 3 PUSHDATA2 header + redeem_size = 70 + redeem_size
  //   output: ~50 (8 value + ~34 P2PK + headers)
  //   tx overhead: ~80 (version, locktime, gas, subnetwork, payload)
  //
  // qlfpv 实测 mass=4420 for ~2200 byte refund TX = ratio ~2.0. 用 2.5 + 100 overhead
  // 保守估算 cover variance + storage mass component.
  const redeemBytes = Buffer.from(spineRedeemHex, 'hex');
  const sigScriptSize = 70 + redeemBytes.length;  // 66 sig push + 1 OP_2 + 3 PUSHDATA2 header + redeem
  const inputSize = 45 + sigScriptSize;
  const outputSize = 50;
  const txOverhead = 80;
  const estimatedTxSize = inputSize + outputSize + txOverhead;
  const MASS_RATIO_BYTES_TO_MASS = 25n;  // 2.5x as BigInt (× 10 for integer math)
  const massEstimate = (BigInt(estimatedTxSize) * MASS_RATIO_BYTES_TO_MASS) / 10n;
  const mass = massEstimate;
  console.log(`[pool-settler] v0.7 byte-size mass estimate market=${market.id.slice(0,12)} txBytes≈${estimatedTxSize} mass≈${mass} (redeem ${redeemBytes.length}B, sigScript ${sigScriptSize}B, ratio 2.5)`);
  let dynamicFee = BigInt(mass) * SOMPI_PER_MASS;
  if (dynamicFee < V07_MIN_FEE) dynamicFee = V07_MIN_FEE;
  if (dynamicFee > V07_MAX_FEE) dynamicFee = V07_MAX_FEE;
  console.log(`[pool-settler] v0.7 mass-aware fee compute market=${market.id.slice(0,12)} mass=${mass} fee=${dynamicFee} (mass × ${SOMPI_PER_MASS} sompi/mass, cap [${V07_MIN_FEE}, ${V07_MAX_FEE}])`);
  return dynamicFee;
}

/**
 * G2-B 二期 (Bettor r263 钦点): handle protocol_status='refunding' markets.
 *
 * dispatchRefund stashed:
 *   meta.refund_tx_obj          — preimage TX object (1 input + 1 output, exact value)
 *   meta.refund_amount          — makerStakeAmount - minerFee (BigInt-as-Number)
 *   meta.spine_redeem_script_hex — PoolSpine_v06 compiled redeem (stashed at create-time)
 *
 * Steps:
 *   1. Look up maker address (maker_relay_id must be local — refund signs with maker privkey)
 *   2. IPC maker_relay 'pool_refund_maker_unjoined_tx' (= PoolSpine_v06.sil entry 2):
 *        scriptSig = [makerSig push] + OP_2 (selector) + [redeemScript push]
 *        lockTime = deadline * 1000 (ms, per SS L275 bug 10d sediment)
 *   3. Write refund_txid + status='refunded'
 *
 * Cross-node ingested markets are skipped (= maker has no local key, refund must run on
 * producer node — same pattern as dispatchRefund). qlfpv-shape markets refund here.
 */
async function handleRefunding(market) {
  // G2-B 二期 (v0.6) + G6 批3 段① (v0.7) cover PoolSpine entry 2 refund_maker_unjoined. v0.5
  // markets use a different SS (3 oracle bonds in spine, fee 焊死) — separate handler not in
  // scope. v0.6/v0.7 differ only at SS bytecode level (= different redeem), the IPC path is
  // identical because scriptSig layout is same ([makerSig push] + OP_2 + [redeemScript push]).
  if (market.protocol_version !== 'v0.6' && market.protocol_version !== 'v0.7') {
    console.log(`[pool-settler:refunding] skip non-v0.6/v0.7 market ${market.id.slice(0,12)} (protocol_version=${market.protocol_version})`);
    return;
  }
  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch {}
  if (!meta.refund_tx_obj) {
    console.warn(`[pool-settler:refunding] market=${market.id.slice(0,12)} missing meta.refund_tx_obj, skip (= dispatchRefund did not stash)`);
    return;
  }
  if (!meta.spine_redeem_script_hex) {
    console.warn(`[pool-settler:refunding] market=${market.id.slice(0,12)} missing meta.spine_redeem_script_hex (pre-v135 market), cannot assemble scriptSig`);
    return;
  }
  if (meta.refund_amount == null) {
    console.warn(`[pool-settler:refunding] market=${market.id.slice(0,12)} missing meta.refund_amount, skip`);
    return;
  }

  // Skip cross-node markets (maker_relay_id sentinel) — refund must run where maker key lives.
  if (typeof market.maker_relay_id === 'string' && market.maker_relay_id.startsWith('cross-node:')) {
    console.log(`[pool-settler:refunding] skip cross-node market ${market.id.slice(0,12)} (maker on remote host)`);
    return;
  }

  const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
  if (!makerRow?.address) {
    console.warn(`[pool-settler:refunding] market=${market.id.slice(0,12)} no maker address (maker_relay_id=${market.maker_relay_id?.slice(0,12)})`);
    return;
  }

  // PoolSpine_v06.sil L275 bug 10d: tx.time >= deadline * 1000 (ms semantics).
  const lockTime = BigInt(market.deadline) * 1000n;

  try {
    const submitResult = await sendCommandAsync(market.maker_relay_id, {
      type: 'pool_refund_maker_unjoined_tx',
      spine_p2sh_address: market.spine_p2sh,
      spine_redeem_script_hex: meta.spine_redeem_script_hex,
      required_input_outpoint: { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },
      output: { address: makerRow.address, amountSompi: String(meta.refund_amount) },
      lock_time: lockTime.toString(),
      tx_obj_preimage: meta.refund_tx_obj,
    });

    if (!submitResult?.ok || !submitResult.txId) {
      console.error(`[pool-settler:refunding] submit fail market=${market.id.slice(0,12)}: ${submitResult?.error}`);
      return;
    }

    sqlite.prepare('UPDATE pool_markets SET refund_txid = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(submitResult.txId, 'refunded', market.id);
    console.log(`[pool-settler:refunding] REFUNDED market=${market.id.slice(0,12)} refund_txid=${submitResult.txId.slice(0,16)} to=${makerRow.address.slice(0,20)} amount=${meta.refund_amount}`);
  } catch (e) {
    console.error(`[pool-settler:refunding] submit exception market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}

/**
 * 7b — dispatchRefundDisagreement: build settle TX preimage for the refund_disagreement SS
 * entry (area-4 + Owner Gap 1B burn). Mirrors dispatchPhase2 pattern but constructs the
 * refund_disagreement output layout:
 *   - silentOracleIndex === -1 (Gap 1A): 4 outputs = maker + 3 oracle bonds (all dissent)
 *   - silentOracleIndex === 0|1|2 (Gap 1B): 3 outputs = maker + 2 dissent oracle bonds
 *     (silent oracle's bond NOT in outputs → input/output difference burned per Owner)
 *
 * Output[0] = maker recovers (makerStakeAmount - minerFee) per area-4 Gap 9.
 * Output[1..N] = surviving oracle bond returns at oracleBondAmount each.
 *
 * Stashes refund_disagreement_tx_obj in metadata + transitions market to 'collecting_sigs'.
 * handleCollectingSigs aggregates the 2 oracle sigs (= per signingPair = 2 - silentOracleIndex
 * for Gap 1B, any pair for Gap 1A) and the relay IPC (= 7c) assembles + submits.
 *
 * @param {object} market — pool_markets row
 * @param {{ silentOracleIndex: number, reason: string }} decision
 */
export async function dispatchRefundDisagreement(market, decision) {
  try {
    const { silentOracleIndex } = decision;
    if (silentOracleIndex !== -1 && (silentOracleIndex < 0 || silentOracleIndex > 2)) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} invalid silentOracleIndex=${silentOracleIndex}`);
      return;
    }

    const makerStake = parseInt(market.maker_stake_amount, 10) || 0;
    const oracleBond = parseInt(market.oracle_bond_amount, 10) || 0;
    const minerFee = parseInt(market.miner_fee, 10) || 20_000;

    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (!makerRow?.address) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} no maker address`);
      return;
    }

    // J2-tn r337 (Bettor 6/5 C2 实施): oracle_relay_ids field 复用存 addresses (= committee_addresses
    // 写入 by sampleAndStoreCommittee post-r337). dispatchPhase2 直接以 address 调 DM, 不查
    // relay_nodes (= peer-owned address 不在本地 relay_nodes 表).
    const oracleIds = JSON.parse(market.oracle_relay_ids || '[]');
    const oracleRows = oracleIds.map(addr => ({ id: null, address: addr }));
    if (oracleRows.some(r => !r?.address)) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} missing oracle addresses`);
      return;
    }

    // Build outputs per silentOracleIndex
    const makerRefund = makerStake - minerFee;
    if (makerRefund <= 0) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} makerRefund=${makerRefund} <= 0`);
      return;
    }
    const outputs = [{ address: makerRow.address, amountSompi: makerRefund.toString() }];
    // For Gap 1A: include all 3 oracle bonds. For Gap 1B: skip the silent oracle.
    for (let i = 0; i < 3; i++) {
      if (silentOracleIndex === i) continue;
      outputs.push({ address: oracleRows[i].address, amountSompi: oracleBond.toString() });
    }
    // Sanity: outputs.length should match SS entry's strict equality check
    const expectedOutputCount = silentOracleIndex === -1 ? 4 : 3;
    if (outputs.length !== expectedOutputCount) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} outputs.length=${outputs.length} != expected ${expectedOutputCount}`);
      return;
    }

    // Inputs: spine (maker stake UTXO) + N oracle deposit UTXOs (= each oracle's bond UTXO)
    const depositRows = sqlite.prepare(`
      SELECT payload FROM chain_events
      WHERE event_type = 'pool_oracle_deposit' AND payload LIKE ?
    `).all(`%"market_id":"${market.id}"%`);
    const oracleDepositOutpoints = depositRows.map(r => {
      const p = JSON.parse(r.payload);
      return { outpointTxid: p.deposit_tx, outpointIndex: 0 };
    });
    const requiredInputOutpoints = [
      { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },
      ...oracleDepositOutpoints,
    ];

    // signingPair: Gap 1B forced to 2 - silentOracleIndex; Gap 1A defaults to 0 (oracle1+2)
    const signingPair = silentOracleIndex === -1 ? 0 : (2 - silentOracleIndex);
    const signingOracles = silentOracleIndex === -1
      ? [0, 1]   // Gap 1A: signingPair=0 → oracle1+2 sign
      : [0, 1, 2].filter(i => i !== silentOracleIndex);

    // 7d bug 10 fix: SS PoolSpine entry-4 require(tx.time >= deadline + 300) (OP_CHECKLOCKTIMEVERIFY).
    // tx.lockTime MUST be >= deadline_seconds + 300, AND preimage MUST carry the same lockTime
    // (Kaspa sighash binds tx.lockTime — oracle sigs over preimage.lockTime=0 would mismatch
    // a final TX with lockTime=deadline+300, so all 4 input sigs would invalidate).
    // 7d bug 10b fix (cycle 5 rerun #1 catch): column is `deadline` (sec int), NOT
    // `outcome_end_date`. Date.parse(undefined)=NaN → NaN+300=NaN → BigInt(NaN||0)=0n → same bug.
    // 7d bug 10c fix (cycle 5 rerun #2 catch via rusty-kaspa source): Kaspa LOCK_TIME_THRESHOLD =
    // 500_000_000_000 (500B), NOT Bitcoin's 500M. Values < 500B interpreted as DAA score, ≥ 500B
    // interpreted as Unix MILLISECONDS (not seconds). Setting lock_time = deadline_sec + 300
    // (~1.78B) → Kaspa reads as DAA score 1.78B; testnet current DAA ~10M → "tx input #0 is not
    // finalized" forever. Fix: multiply by 1000 → ms value ~1.78T > 500B → ms interpretation →
    // block_time_ms catches up immediately. SS OP_CLTV just does raw u64 compare so lock_time_ms
    // (1.78T) >= operand (deadline_sec + 300 = 1.78B) trivially passes. Console-level
    // DISAGREEMENT_TIMEOUT_MIN (5min) is the real time gate now; SS CLTV becomes a no-op.
    const deadlineSec = parseInt(market.deadline, 10);
    if (!Number.isFinite(deadlineSec) || deadlineSec <= 0) {
      console.error(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} invalid deadline=${market.deadline}`);
      return;
    }
    const refundLockTimeMs = (deadlineSec + 300) * 1000;

    // Build preimage via maker_relay (single-p2sh refund TX on spine inputs only)
    const preimage = await sendCommandAsync(market.maker_relay_id, {
      type: 'prediction_settle_build_preimage',
      p2sh_address: market.spine_p2sh,
      required_input_outpoints: requiredInputOutpoints,
      outputs,
      lock_time: refundLockTimeMs,
    });
    if (!preimage?.ok || !preimage.tx_obj) {
      console.error(`[pool-settler] dispatchRefundDisagreement build_preimage fail market=${market.id.slice(0,12)}: ${preimage?.error}`);
      return;
    }

    let prevMeta = {};
    try { prevMeta = JSON.parse(market.metadata || '{}'); } catch {}
    const newMeta = {
      ...prevMeta,
      refund_disagreement_tx_obj: preimage.tx_obj,
      refund_disagreement_silent_oracle_index: silentOracleIndex,
      refund_disagreement_signing_pair: signingPair,
      refund_disagreement_dispatched_at: new Date().toISOString(),
      refund_disagreement_outputs: outputs,
      refund_disagreement_input_count: requiredInputOutpoints.length,
      refund_disagreement_lock_time: refundLockTimeMs,
    };
    sqlite.prepare('UPDATE pool_markets SET metadata = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(newMeta), 'collecting_sigs', market.id);

    // DM the 2 signing oracles for refund_disagreement sigs (= 7c relay IPC schema handles
    // the unlock scriptSig assembly per signingPair).
    const reqPayload = JSON.stringify({
      t: 'kanet_pool_oracle_refund_disagreement_sign_req_v1',
      market_id: market.id,
      silent_oracle_index: silentOracleIndex,
      signing_pair: signingPair,
      input_count: requiredInputOutpoints.length,
    });
    Promise.allSettled(signingOracles.map(i =>
      sendCommandAsync(market.maker_relay_id, { type: 'send_message', target: oracleRows[i].address, message: reqPayload })
    )).catch(() => {});

    console.log(`[pool-settler] DISPATCHED RefundDisagreement market=${market.id.slice(0,12)} silentOracleIndex=${silentOracleIndex} signingPair=${signingPair} outputs=${outputs.length} signers=${signingOracles.join(',')} → collecting_sigs`);
  } catch (e) {
    console.error(`[pool-settler] dispatchRefundDisagreement fail market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}

/**
 * Phase 2b: handleCollectingSigs — scan chain_events for oracle sigs + assemble + broadcast settle TX.
 *
 * Pool sigs schema (= mirrors 1V1 'oracle_tx_sig' chain_events):
 *   payload.t = 'kanet_pool_oracle_tx_sign_resp_v1'
 *   payload.market_id = market.id
 *   payload.voter_relay_id
 *   payload.input_index (= 0..N for spine + N sides)
 *   payload.signature
 *
 * Required sigs per input: 3 if unanimous, 2 if forfeit_1.
 * When all inputs reach required sig count, submit settle TX via maker_relay IPC.
 *
 * @param {object} market — pool_markets row in 'collecting_sigs' state
 */
async function handleCollectingSigs(market) {
  let meta;
  try { meta = JSON.parse(market.metadata || '{}'); } catch { meta = {}; }
  // 7c: dispatchRefundDisagreement also transitions to collecting_sigs but stashes
  // different metadata (refund_disagreement_tx_obj instead of phase2_tx_obj). Delegate
  // to the dedicated handler before the settle-path metadata check would skip it.
  if (meta.refund_disagreement_dispatched_at && meta.refund_disagreement_tx_obj) {
    return handleCollectingSigsRefundDisagreement(market, meta);
  }
  if (!meta.phase2_tx_obj || !meta.phase2_input_count) {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} missing phase2 metadata, skip`);
    return;
  }
  // J2-tn r379 (TDZ fix from r378): hoist committeePksForSort lookup to top — re-broadcast
  // gate at L1790 references it but its `let` was at L1844 (= TDZ ReferenceError, original
  // 5min throttle masked this by usually finding signedSet via oracleArr fallback). r378
  // 90s throttle + #9 NEVER 触发 L1790 first iteration → silent fail blocked re-broadcast.
  let committeePksForSort = [];
  try {
    const commRow0 = sqlite.prepare('SELECT committee_pks FROM pool_committee WHERE market_id = ?').get(market.id);
    committeePksForSort = JSON.parse(commRow0?.committee_pks || '[]').map(p => String(p).toLowerCase());
  } catch {}
  const inputCount = meta.phase2_input_count;
  // Spine P2SH has MULTIPLE UTXOs (1 maker stake + N oracle bonds) — inputs 0..spineInputCount-1.
  // Each spine input needs PoolSpine settle_unanimous scriptSig (3 sigs unanimous / 2 forfeit_1).
  // Side inputs (spineInputCount..end) auto-unlock via [selector_0 + side_redeem_push] (no sigs).
  const spineInputCount = meta.phase2_spine_input_count || 1;
  // KANet-UI r386 Layer-9 KI 49: v0.6 5-oracle. v0.5 hardcoded [0,1,2] missed 5-committee.
  // unanimous = all sign; non-unanimous = exclude silent (= 4 sigs for v0.6, 2 for v0.5).
  let oracleArr = [];
  try { oracleArr = JSON.parse(market.oracle_relay_ids || '[]'); } catch {}
  const oracleNcollecting = oracleArr.length || 3;
  const allIdxC = Array.from({ length: oracleNcollecting }, (_, i) => i);
  const signingOracles = meta.phase2_unanimous
    ? allIdxC
    : allIdxC.filter(i => i !== meta.phase2_silent_oracle_index);
  const spineRequiredSigs = signingOracles.length;

  // Scan chain_events for sigs scoped to this market + spine input only
  const sigRows = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'pool_oracle_tx_sig'
      AND payload LIKE ?
  `).all(`%"market_id":"${market.id}"%`);

  // J2-tn r362 (Bettor 13:16 钦定 协议统一): sigsByInput dedupe + 验签 by voter_pubkey
  // (= PK 跨节点 canonical). r337 漏迁 reader 第6处 + J1 r343 catch (= pool-sign-handler vs
  // settler envelope schema 不接). voter L538 同步改 voter_pubkey field.
  const sigsByInput = Array.from({ length: inputCount }, () => []);
  const seenByInput = Array.from({ length: inputCount }, () => new Set());
  for (const row of sigRows) {
    try {
      const p = JSON.parse(row.payload || '{}');
      if (p.t !== 'kanet_pool_oracle_tx_sign_resp_v1') continue;
      const inputIdx = parseInt(p.input_index, 10);
      if (inputIdx < 0 || inputIdx >= inputCount) continue;
      // Accept new voter_pubkey OR legacy voter_relay_id during migration window.
      const signerKey = String(p.voter_pubkey || p.voter_relay_id || '').toLowerCase();
      if (!signerKey || !p.signature) continue;
      if (seenByInput[inputIdx].has(signerKey)) continue;
      seenByInput[inputIdx].add(signerKey);
      sigsByInput[inputIdx].push({ voter_pubkey: signerKey, signature: p.signature });
    } catch {}
  }

  // Gate on ALL spine inputs (0..spineInputCount-1) having required sig count.
  // Side inputs need no sigs (settled_via_spine entry).
  const spineMissing = [];
  for (let i = 0; i < spineInputCount; i++) {
    if (sigsByInput[i].length < spineRequiredSigs) {
      spineMissing.push(`input${i}=${sigsByInput[i].length}/${spineRequiredSigs}`);
    }
  }
  if (spineMissing.length > 0) {
    if (Math.random() < 0.1) {
      console.log(`[pool-settler:collecting] market=${market.id.slice(0,12)} waiting spine sigs: ${spineMissing.join(' ')}`);
    }
    // J2-tn r378 (Bettor 15:12 catch follow-up): re-broadcast missing oracle sign_req via
    // chunked broadcast (= 不再 send_message DM, DM cross-host 不通 = r360 已证). 同时 inject
    // 现在 meta.phase2_tx_obj 进 payload (= 治存量 #9 的 persisted phase2_request_payload
    // 早于 r377 没 phase2_tx_obj). Throttle 90s (= 缩短: 之前 5min 慢, 跨 host 节奏需密).
    try {
      const lastReDMms = meta.last_sign_req_redm_at ? new Date(meta.last_sign_req_redm_at).getTime() : 0;
      if (Date.now() - lastReDMms > 90_000 && meta.phase2_request_payload) {
        const signedSet = new Set();
        for (const s of sigsByInput[0] || []) signedSet.add(s.voter_pubkey);
        const missingOracles = signingOracles.filter(i => !signedSet.has(committeePksForSort[i] || oracleArr[i]));
        if (missingOracles.length > 0) {
          // Inject phase2_tx_obj if persisted payload预先没有 (= 存量 #9). New payload (post-r377)
          // 已含, 不影响 idempotent: 覆盖同字段同值.
          const rebroadcastPayload = {
            ...meta.phase2_request_payload,
            phase2_tx_obj: meta.phase2_tx_obj,
          };
          const { sendBroadcastChunked } = await import('../lib/pool-broadcast.mjs');
          await sendBroadcastChunked(market.maker_relay_id, 'kanet-prediction', JSON.stringify(rebroadcastPayload))
            .catch(err => console.warn(`[pool-settler:collecting] re-broadcast fail market=${market.id.slice(0,12)}: ${err.message}`));
          const newMeta = { ...meta, last_sign_req_redm_at: new Date().toISOString() };
          sqlite.prepare('UPDATE pool_markets SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(JSON.stringify(newMeta), market.id);
          console.log(`[pool-settler:collecting] re-broadcast sign_req market=${market.id.slice(0,12)} missing=${missingOracles.length} chunked`);
        }
      }
    } catch (e) {
      console.warn(`[pool-settler:collecting] re-broadcast fail market=${market.id.slice(0,12)}: ${e.message}`);
    }
    return;
  }

  // Spine has required sigs. Load side data for TX assembly (= side_redeem_script_hex needed per side, v136+).
  const sides = sqlite.prepare(`
    SELECT side_p2sh, side_lock_tx, side_redeem_script_hex FROM pool_bettor_sides
    WHERE market_id = ? AND side_lock_tx IS NOT NULL
    ORDER BY merkle_index ASC
  `).all(market.id);

  if (!meta.spine_redeem_script_hex) {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} missing meta.spine_redeem_script_hex (= pre-v135 market or create-time omission), cannot assemble TX`);
    return;
  }
  if (!Array.isArray(meta.phase2_outputs) || !meta.phase2_outputs.length) {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} missing meta.phase2_outputs (= pre-2c step 2c dispatched), cannot assemble TX`);
    return;
  }
  if (sides.some(s => !s.side_redeem_script_hex)) {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} some sides missing side_redeem_script_hex (= pre-v136 registered), cannot assemble TX`);
    return;
  }

  // Bettor r273 layer-17: sigs MUST be ordered to match committee_pks order so SS positional
  // checkSig(c_iSig, c_iPk) binds correctly. handleCollectingSigs scans chain_events by
  // observed_at → random order. Re-sort by oracle_relay_ids index (= committee order).
  //
  // qoyqv 实证 (Bettor r351 4/5 vote case): missing sig 不能 filter, 必 pad dummy 66B
  // zero-sig 占位. v0.6/v0.7 SS settle_aggregate checkSig 内 validSigs counter — dummy
  // sig 验失败 counter 不增, 但其他 4 sig PASS → counter=4 ≥ 4-of-5 threshold → SS accept.
  // Dummy sig 必 same byte format as real (= 41 + 00×64 + 01 push-encoded) 不破坏 sigOpCount/sighash.
  // J2-tn r386→r387 (Bettor 01:31 方案2 fallback): r386 OP_0 实证 SS 仍 reject
  // (scriptSig 3983B with `00` at c4 slot 实证, 但 'verification failed' 重现).
  // = Kaspa OpCheckSig 对 empty sig 也 abort (= 不返 false), 同 all-zero r=0 命运.
  //
  // 方案 2: structurally-valid sig with r=G.x (= secp256k1 generator x-coord, 必 lift_x
  // 成功 = G itself), s=arbitrary (= all 0x01). Sig 格式有效 → checkSig 算 verify →
  // 不通过 (= sig 不匹 message) → 返 false → validSigs counter skip c4 → counter=4 →
  // SS accept.
  //
  // G.x BIP340: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
  // s: 0x0101...01 (32 bytes, < curve order, valid scalar)
  // sighashType: 0x01
  // Total push: 0x41 + 32B Gx + 32B 0x01... + 0x01 = 66 bytes (same length as real sig).
  const DUMMY_SIG_PUSH_HEX = '41'
    + '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'  // r = G.x
    + '0101010101010101010101010101010101010101010101010101010101010101'  // s = 0x01...01
    + '01';  // sighashType SIGHASH_ALL
  // J2-tn r362 (now hoisted to top of handleCollectingSigs in r379): committeePksForSort
  // already loaded above for re-broadcast missing-oracle compare.
  const spineSigsByInput = [];
  for (let i = 0; i < spineInputCount; i++) {
    const bySender = new Map(sigsByInput[i].map(s => [s.voter_pubkey, s.signature]));
    // Pad missing positions with dummy sig (= same length as real, position-aware for SS positional checkSig).
    const ordered = committeePksForSort.map(pk => bySender.get(pk) || DUMMY_SIG_PUSH_HEX);
    spineSigsByInput.push(ordered);
  }

  // Bettor r283 G2-A: v0.5 phase2c-first-ship skipped non-unanimous (= forfeit_1 entry 1).
  // v0.6+v0.7 settle_aggregate has built-in 4-of-5 threshold counter (PoolSpine_v06/07.sil:79-83)
  // so 4 valid sigs settle without a separate forfeit entry. Skip only for v0.5 markets.
  // qoyqv 实证 (Bettor r351): 4/5 votes 4-of-5 path 触发 forfeit_1 skip 因 v0.7 漏 guard.
  if (!meta.phase2_unanimous && market.protocol_version !== 'v0.6' && market.protocol_version !== 'v0.7') {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} forfeit_1 entry 1 not yet supported in unlockPoolSpineP2SH (v0.5 only), skip until next iteration`);
    return;
  }

  // Rebuild full required_input_outpoints (= must match dispatchPhase2 ordering: spine + oracle bonds + sides)
  const depositRows = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'pool_oracle_deposit' AND payload LIKE ?
  `).all(`%"market_id":"${market.id}"%`);
  const oracleDepositOutpoints = depositRows.map(r => {
    const p = JSON.parse(r.payload);
    return { outpointTxid: p.deposit_tx, outpointIndex: 0 };
  });
  const requiredInputOutpoints = [
    { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },
    ...oracleDepositOutpoints,
    ...sides.map(s => ({ outpointTxid: s.side_lock_tx, outpointIndex: 0 })),
  ];

  console.log(`[pool-settler:collecting] market=${market.id.slice(0,12)} attempting settle TX submit (spine_inputs=${spineInputCount}, sides=${sides.length}, signers=${signingOracles.join(',')})`);

  // Bettor r354 — v0.7 settle_aggregate sharding globals, computed HERE (not just dispatchPhase2).
  // qoyqv 实证: markets dispatched before r353 are stuck in collecting_sigs and never re-run
  // dispatchPhase2, so meta.phase2_global_* is undefined → relay can't push globals → scriptSig
  // short 3 → 'pick at invalid location'. Compute fresh from DB (prefer meta when present).
  // direction 0=YES 1=NO (= same convention as dispatchPhase2 makerDirection/thin-check).
  let globalYesSompi = meta.phase2_global_yes_sompi;
  let globalNoSompi = meta.phase2_global_no_sompi;
  let globalCommitId = meta.phase2_global_commit_id;
  if (market.protocol_version === 'v0.7' && (globalYesSompi === undefined || globalYesSompi === null)) {
    const makerDir = market.outcome_side === 'YES' ? 0 : 1;
    const makerStk = parseInt(market.maker_stake_amount, 10) || 0;
    const betRows = sqlite.prepare(`SELECT direction, stake_amount FROM pool_bettor_sides WHERE market_id = ? AND side_lock_tx IS NOT NULL`).all(market.id);
    const allParts = [{ direction: makerDir, stake: makerStk }, ...betRows.map(b => ({ direction: b.direction, stake: parseInt(b.stake_amount, 10) || 0 }))];
    globalYesSompi = allParts.filter(p => p.direction === 0).reduce((s, p) => s + p.stake, 0);
    globalNoSompi = allParts.filter(p => p.direction === 1).reduce((s, p) => s + p.stake, 0);
    const crypto = await import('crypto');
    globalCommitId = crypto.createHash('sha256').update(market.id).digest('hex');
    console.log(`[pool-settler:collecting] v0.7 globals computed (meta fallback) market=${market.id.slice(0,12)} globalYes=${globalYesSompi} globalNo=${globalNoSompi}`);
  }

  try {
    // J1 r221 + Bettor r218 ③ Layer-12 + DoD #1.2 sweep: v0.6/v0.7 committee data extras for
    // settle_aggregate. v0.7 adds sharding globals (globalYes/No/commit) per PoolSpine_v07.sil
    // L103-105 — computed above (dispatchPhase2-baked meta OR fresh DB fallback).
    const isAnonymousPoolSettle = market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7';
    const v06Extras = isAnonymousPoolSettle ? {
      protocol_version: market.protocol_version,
      committee_pks: meta.phase2_committee_pks,
      committee_indices: meta.phase2_committee_indices,
      committee_merkle_proofs: meta.phase2_committee_merkle_proofs,
      committee_pk_hash: meta.phase2_committee_pk_hash,
      // Bettor r353/r354: v0.7 sharding globals. v0.6 markets: globalYesSompi stays undefined
      // (block above gated on v0.7) → relay skips pushing → v0.6 scriptSig byte-identical (46f8a).
      global_yes_total_sompi: globalYesSompi,
      global_no_total_sompi: globalNoSompi,
      global_commit_id: globalCommitId,
    } : {};
    const submitResult = await sendCommandAsync(market.maker_relay_id, {
      type: 'pool_settle_tx',
      spine_p2sh_address: market.spine_p2sh,
      side_p2sh_addresses: sides.map(s => s.side_p2sh),
      spine_redeem_script_hex: meta.spine_redeem_script_hex,
      side_redeem_script_hexes: sides.map(s => s.side_redeem_script_hex),
      required_input_outpoints: requiredInputOutpoints,
      outputs: meta.phase2_outputs,
      spine_input_count: spineInputCount,
      spine_sigs_by_input: spineSigsByInput,
      winner: meta.phase2_winner,
      sides_merkle_root: market.sides_merkle_root,
      unanimous: meta.phase2_unanimous,
      tx_obj_preimage: meta.phase2_tx_obj,
      ...v06Extras,
    });

    if (!submitResult?.ok || !submitResult.txId) {
      console.error(`[pool-settler:collecting] pool_settle_tx submit fail market=${market.id.slice(0,12)}: ${submitResult?.error}`);
      return;
    }

    sqlite.prepare('UPDATE pool_markets SET settle_txid = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(submitResult.txId, 'completed', market.id);
    console.log(`[pool-settler:collecting] SETTLED market=${market.id.slice(0,12)} settle_txid=${submitResult.txId.slice(0,16)} winner=${meta.phase2_winner}`);
  } catch (e) {
    console.error(`[pool-settler:collecting] settle submit exception market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}

/**
 * 7c — handleCollectingSigsRefundDisagreement: aggregate 2 oracle sigs per spine input + submit
 * pool_refund_disagreement_tx via maker_relay IPC. Mirrors handleCollectingSigs but tailored
 * to the refund_disagreement entry: spine-only TX (no side inputs), 2 sigs per input (not 3),
 * different chain_event payload type, different IPC command, no winner / sidesMerkleRoot.
 *
 * Sig schema:
 *   payload.t = 'kanet_pool_oracle_refund_disagreement_tx_sig_v1'
 *   payload.market_id = market.id
 *   payload.voter_relay_id
 *   payload.input_index (= 0..3 for 4 spine inputs)
 *   payload.signature
 *
 * The signing oracles are derived from signing_pair (= 2 - silentOracleIndex for Gap 1B, or 0
 * for Gap 1A defaulting to oracle1+2). Each input has its own sighash → its own sig pair.
 */
async function handleCollectingSigsRefundDisagreement(market, meta) {
  const silentOracleIndex = meta.refund_disagreement_silent_oracle_index;
  const signingPair = meta.refund_disagreement_signing_pair;
  const inputCount = meta.refund_disagreement_input_count;
  const expectedSigs = 2;

  // Signing oracles per signingPair (= same mapping the SS entry enforces):
  // signingPair 0 → oracle 1+2 (indices 0,1)
  // signingPair 1 → oracle 1+3 (indices 0,2)
  // signingPair 2 → oracle 2+3 (indices 1,2)
  const signingOracleIndices = signingPair === 0 ? [0, 1] : signingPair === 1 ? [0, 2] : [1, 2];
  const oracleIds = JSON.parse(market.oracle_relay_ids || '[]');
  const signingRelayIds = signingOracleIndices.map(i => oracleIds[i]);

  // Scan chain_events for refund_disagreement sigs scoped to this market
  const sigRows = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'pool_oracle_refund_disagreement_tx_sig'
      AND payload LIKE ?
  `).all(`%"market_id":"${market.id}"%`);

  // J2-tn r362: 同 settle path — voter_pubkey instead of voter_relay_id (UUID).
  const sigsByInput = Array.from({ length: inputCount }, () => []);
  const seenByInput = Array.from({ length: inputCount }, () => new Set());
  for (const row of sigRows) {
    try {
      const p = JSON.parse(row.payload || '{}');
      if (p.t !== 'kanet_pool_oracle_refund_disagreement_tx_sig_v1') continue;
      const inputIdx = parseInt(p.input_index, 10);
      if (inputIdx < 0 || inputIdx >= inputCount) continue;
      const signerKey = String(p.voter_pubkey || p.voter_relay_id || '').toLowerCase();
      if (!signerKey || !p.signature) continue;
      // signingRelayIds 现含 addresses (post-r337), 此处 best-effort 暂不强制 (= refund-disagree
      // 路径 demo 期非关键, 后续 NWT lint 加 PK 校验).
      if (seenByInput[inputIdx].has(signerKey)) continue;
      seenByInput[inputIdx].add(signerKey);
      sigsByInput[inputIdx].push({ voter_pubkey: signerKey, signature: p.signature });
    } catch {}
  }

  // Gate on ALL spine inputs having required sig count.
  const missing = [];
  for (let i = 0; i < inputCount; i++) {
    if (sigsByInput[i].length < expectedSigs) {
      missing.push(`input${i}=${sigsByInput[i].length}/${expectedSigs}`);
    }
  }
  if (missing.length > 0) {
    if (Math.random() < 0.1) {
      console.log(`[pool-settler:collecting-refund-dis] market=${market.id.slice(0,12)} waiting sigs: ${missing.join(' ')}`);
    }
    return;
  }

  // Order sigs per input to match signing_pair (oracleSig1 = lower index of the pair,
  // oracleSig2 = higher). SS entry's checkSig expects them in this order per signingPair case.
  const spineSigsByInput = sigsByInput.map(sigs => {
    const ordered = sigs.slice().sort((a, b) => {
      const ia = signingRelayIds.indexOf(a.voter_relay_id);
      const ib = signingRelayIds.indexOf(b.voter_relay_id);
      return ia - ib;
    });
    return ordered.map(s => s.signature);
  });

  // Rebuild required_input_outpoints (= spine_lock_tx + 3 oracle deposit outpoints, MUST
  // match dispatchRefundDisagreement ordering).
  const depositRows = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'pool_oracle_deposit' AND payload LIKE ?
  `).all(`%"market_id":"${market.id}"%`);
  const oracleDepositOutpoints = depositRows.map(r => {
    const p = JSON.parse(r.payload);
    return { outpointTxid: p.deposit_tx, outpointIndex: 0 };
  });
  const requiredInputOutpoints = [
    { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },
    ...oracleDepositOutpoints,
  ];

  console.log(`[pool-settler:collecting-refund-dis] market=${market.id.slice(0,12)} attempting refund_disagreement submit (silentOracleIndex=${silentOracleIndex}, signingPair=${signingPair})`);

  try {
    const submitResult = await sendCommandAsync(market.maker_relay_id, {
      type: 'pool_refund_disagreement_tx',
      spine_p2sh_address: market.spine_p2sh,
      spine_redeem_script_hex: meta.spine_redeem_script_hex,
      required_input_outpoints: requiredInputOutpoints,
      outputs: meta.refund_disagreement_outputs,
      spine_sigs_by_input: spineSigsByInput,
      silent_oracle_index: silentOracleIndex,
      signing_pair: signingPair,
      tx_obj_preimage: meta.refund_disagreement_tx_obj,
      // 7d bug 10 fix: pass lockTime for parity; unlockPoolSpineRefundDisagreement uses
      // txObjPreimage.lockTime (already deadline+300) but this keeps the IPC self-describing
      // in case future paths build the TX from scratch without preimage.
      lock_time: meta.refund_disagreement_lock_time || 0,
    });

    if (!submitResult?.ok || !submitResult.txId) {
      console.error(`[pool-settler:collecting-refund-dis] submit fail market=${market.id.slice(0,12)}: ${submitResult?.error}`);
      return;
    }

    sqlite.prepare('UPDATE pool_markets SET refund_txid = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(submitResult.txId, 'refunded', market.id);
    console.log(`[pool-settler:collecting-refund-dis] REFUNDED_DISAGREEMENT market=${market.id.slice(0,12)} refund_txid=${submitResult.txId.slice(0,16)} silentOracleIndex=${silentOracleIndex}`);
  } catch (e) {
    console.error(`[pool-settler:collecting-refund-dis] submit exception market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}
