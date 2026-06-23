// pool-shard-register.mjs — (A)-model rolling-shard register orchestration (production register wiring (a), J2 2026-06-21).
//
// One logical market = N ShardLeaf shards, each consolidating into ONE production-shape PayoutShard covenant
// (predicate_commit ctor, cov_id-provenance). This module is the Console-side ORCHESTRATION over:
//   - shard-allocator       : allocateForRegister / registerShard / sealShard / onBettorRegistered (v172 续约列)
//   - pool-register-builder : buildRegisterWitness / buildRegisterCommand (register_append, cross-node 1000 已证兼容 (A) 4-field leaf)
//   - (d) genesis           : PayoutShard genesis-mint (production-shape) + ShardLeaf genesis (count=1 first-bet baked, payout_cov_id baked)
//
// Flow per bettor bet (stake in sompi):
//   allocateForRegister →
//     'use'      : register_append on the open shard's current leaf (current_leaf_outpoint/state) → onBettorRegistered
//     'open_new' : (首片) PayoutShard genesis-mint → ShardLeaf genesis (first bet baked count=1) → registerShard (+ sealShard prev)
//
// NO TX NO STATE: DB accounting (registerShard / onBettorRegistered / payout_shards insert) ONLY after the on-chain tx landed.
// determinism: all redeem compiled with canonical silverc (da9fc22); ShardLeaf bakes the per-market PayoutShard cov_id
//   (consolidate destination-bind). ps_tmpl_hash is bettor-INDEPENDENT (4 dust-ticket fields are State, spliced per register).
//
// Custody (testnet ramp): the gateway relay funds genesis + register from its balance; the bettor's stake is reconciled
//   via the bettor→gateway transfer the caller performs before invoking (custody-bound, like publish). mainnet: bettor-direct
//   funding input is a follow-up (TODO custody-hardening).

import { compileSil, computePoolSideArtifact, ctorBytes32, ctorInt } from './pool-bshard-artifacts.mjs';
import { buildRegisterWitness, buildRegisterCommand } from './pool-register-builder.mjs';
import { allocateForRegister, registerShard, sealShard, onBettorRegistered } from './shard-allocator.mjs';
import { blake2b } from '@noble/hashes/blake2b';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = dirname(fileURLToPath(import.meta.url));
const z32 = '00'.repeat(32);
const W17 = () => Array.from({ length: 17 }, () => ctorInt(0));
const MIN_BET = 100000;                                   // dust-ticket floor (sompi); matches (d)/helper
const TICKET_DUST = 20_000_000;                           // 0.2 KAS PoolSide dust ticket (KIP-9 safe, matches helper)
const PS_SEED = 20_000_000;                               // PayoutShard genesis seed (0.2 KAS sink, matches (d))
const SHARD_GENESIS_SEED = 20_000_000;                    // A(b): 空 ShardLeaf genesis seed (0.2 KAS, KIP-9 safe). 首注 register_append
                                                          //   spend 它+fund stake → output weld out==pool_value(0)+stake 过, seed 退 change (不进池, pool_value 起点=0)。

const hex32 = (s) => Buffer.from(blake2b(Buffer.from(s), { dkLen: 32 })).toString('hex');
const _i64LE = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };

// 周期 defrag (880-wall 防护, memory reference-consolidate-utxo-880-fix): 每注 gateway funding 自转账 → 碎片化 best UTXO,
// 持续 scale (2000+ tx) 必周期 consolidate_utxo 维持 best, 否则 register funding starvation. 每 DEFRAG_EVERY 注 best-effort 归集.
const DEFRAG_EVERY = 40;
let _regCount = 0;
async function _maybeDefrag(rc) {
  if (++_regCount % DEFRAG_EVERY !== 0) return;
  try { await rc({ type: 'consolidate_utxo' }); } catch { /* best-effort; health-monitor 兜底 */ }
}
const _push8 = (buf) => Buffer.concat([Buffer.from([buf.length]), buf]);   // PUSH<len> data

/**
 * Splice the (A) 4-field ShardLeaf state into a base (genesis) redeem — silverc-INDEPENDENT (no recompile at register
 * → immune to cross-node silverc build drift). state_layout: start=1, 4×PUSH8 = 36B. Byte-equal to recompile (J2 已验).
 */
export function spliceLeafState(baseRedeemHex, st) {
  const stateHex = Buffer.concat([_push8(_i64LE(st.local_yes)), _push8(_i64LE(st.local_no)), _push8(_i64LE(st.count)), _push8(_i64LE(st.pool_value))]);
  const redeem = Buffer.from(baseRedeemHex, 'hex');
  return Buffer.concat([redeem.slice(0, 1), stateHex, redeem.slice(1 + stateHex.length)]).toString('hex');
}

/**
 * Compile a production-shape PayoutShard redeem (22-param ctor incl predicate_commit 2nd).
 * @param {object} o { poolMerkleRoot(hex), predicateCommit(hex), consolidatedPool(int), closed(int), payoutRoot(hex), silverc }
 */
export function compilePayoutShardRedeem({ poolMerkleRoot, predicateCommit, consolidatedPool, closed = 0, payoutRoot = z32, silverc }) {
  const ctor = [ctorBytes32(poolMerkleRoot), ctorBytes32(predicateCommit), ctorInt(Number(consolidatedPool)), ctorInt(closed), ctorBytes32(payoutRoot), ...W17()];
  return Buffer.from(compileSil(join(LIB, 'PayoutShard.sil'), ctor, silverc).script).toString('hex');
}

/**
 * Compile a ShardLeaf redeem with the given (A) 4-field state baked.
 * @returns {{ redeemHex, psTmplHashHex }}
 */
export function compileShardLeafRedeem({ marketIdHash, psTmplHashHex, shardPoolId, sealCount, payoutCovId, deadline, localYes, localNo, count, poolValue, silverc }) {
  // ★件1(J1): deadline 加在常量区(payoutCovId 后, init State 前) — State 区仍 offset 1/4×PUSH8 不变 (spliceLeafState byte-equal 保持)。
  const ctor = [
    ctorBytes32(marketIdHash), ctorBytes32(psTmplHashHex), ctorBytes32(shardPoolId),
    ctorInt(sealCount), ctorInt(MIN_BET), ctorBytes32(payoutCovId), ctorInt(deadline),
    ctorInt(localYes), ctorInt(localNo), ctorInt(count), ctorInt(poolValue),
  ];
  return Buffer.from(compileSil(join(LIB, 'ShardLeaf.sil'), ctor, silverc).script).toString('hex');
}

/**
 * Ensure the per-logical-market PayoutShard covenant exists (genesis-mint once). Reads/writes payout_shards (v172).
 * @returns {{ payoutCovId, psAddr, psOutpoint, psRedeemGenesis }}
 */
export async function ensurePayoutShard({ db, rc, transfer, landed, p2sh, logicalMarketId, poolMerkleRoot, predicateCommit, relayAddr, silverc }) {
  const existing = db.prepare(`SELECT * FROM payout_shards WHERE logical_market_id = ?`).get(logicalMarketId);
  if (existing) return { payoutCovId: existing.payout_cov_id, psAddr: existing.payout_ps_addr, psOutpoint: existing.payout_ps_outpoint, psRedeemGenesis: existing.payout_redeem_hex };

  const redeem = compilePayoutShardRedeem({ poolMerkleRoot, predicateCommit, consolidatedPool: PS_SEED, closed: 0, payoutRoot: z32, silverc });
  const fundTx = await transfer(relayAddr, PS_SEED + 100_000_000);   // seed + headroom to gateway
  const gj = await rc({ type: 'bshard_genesis_mint_payout', payoutshard: { redeem_hex: redeem, seedSompi: String(PS_SEED) }, inputs: { funding: { address: relayAddr, outpointTxid: fundTx, index: 0 } }, outputs: { change_address: relayAddr } });
  const payoutCovId = gj.payoutCovId, psTx = gj.txId || gj.txid, psAddr = p2sh(redeem);
  if (!payoutCovId || payoutCovId === z32) throw new Error('PayoutShard genesis-mint cov_id 0 — covenant provenance fail');
  if (!await landed(psTx, psAddr)) throw new Error('PayoutShard genesis no land');

  db.prepare(`INSERT INTO payout_shards (logical_market_id, payout_cov_id, payout_ps_addr, payout_ps_outpoint, payout_redeem_hex, pool_merkle_root, predicate_commit, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(logicalMarketId, payoutCovId, psAddr, `${psTx}:0`, redeem, poolMerkleRoot, predicateCommit, Math.floor(Date.now() / 1000));
  return { payoutCovId, psAddr, psOutpoint: `${psTx}:0`, psRedeemGenesis: redeem };
}

/**
 * Register one bettor's bet into the (A)-model rolling-shard set. Core (a) orchestration.
 * @param {object} o {
 *   db, rc(cmd)→Promise, transfer(addr,sompi)→txid, landed(txid,addr)→bool, p2sh(redeemHex)→addr,
 *   logicalMarketId, poolMerkleRoot(hex), predicateCommit(hex), bettorPk(hex), direction(0|1), stakeSompi,
 *   relayAddr, silverc, sealCount, deadline(Unix ts; partial-shard sweep gate, ctor-baked 件1), createShardMarketRow(shardIndex, shardP2sh)→shardMarketId (pool_markets row for the shard),
 *   recordBettor({ shardMarketId, shardIndex, bettorPk, direction, stakeSompi, leafTx }) (pool_bettor_sides / shard bettor record)
 * }
 * @returns {{ action, shardIndex, shardMarketId, shardP2sh, leafTx, leafOutpoint, leafState, payoutCovId }}
 */
export async function registerBettorOnShard(o) {
  const {
    db, rc, transfer, landed, p2sh, logicalMarketId, poolMerkleRoot, predicateCommit,
    bettorPk, direction, stakeSompi, relayAddr, silverc, sealCount, deadline, createShardMarketRow, recordBettor,
  } = o;
  if (!Number.isFinite(Number(deadline)) || Number(deadline) <= 0) throw new Error(`registerBettorOnShard: deadline (Unix ts, ctor-baked partial-sweep gate) required, got ${deadline}`);
  if (direction !== 0 && direction !== 1) throw new Error(`direction must be 0|1, got ${direction}`);
  if (!(BigInt(stakeSompi) > 0n)) throw new Error(`stakeSompi must be > 0`);
  const stake = Number(stakeSompi);
  const marketIdHash = hex32(logicalMarketId);

  // Per-market PayoutShard (genesis-mint once at first shard) — the consolidation sink every ShardLeaf bakes by cov_id.
  const { payoutCovId } = await ensurePayoutShard({ db, rc, transfer, landed, p2sh, logicalMarketId, poolMerkleRoot, predicateCommit, relayAddr, silverc });

  const alloc = allocateForRegister(db, logicalMarketId, stake);

  // ── 'use': register_append on the open shard's current renewal leaf ────────────────────────────────────────
  if (alloc.action === 'use') {
    const shard = alloc.shard;
    if (!shard.current_leaf_outpoint || !shard.current_leaf_state) {
      throw new Error(`shard ${shard.shard_market_id} missing current_leaf_outpoint/state (v172) — cannot register_append`);
    }
    const st = JSON.parse(shard.current_leaf_state);                       // {local_yes, local_no, count, pool_value}
    const shardPoolId = hex32(`${logicalMarketId}-shard-${shard.shard_index}`);
    // bettor-independent ps template (4 dust-ticket fields are State, spliced per register)
    const psArtifact = computePoolSideArtifact(join(LIB, 'PoolSide_v08_shard.sil'), [ctorBytes32(bettorPk), ctorInt(direction), ctorInt(stake), ctorBytes32(z32)], silverc);
    // current leaf redeem: splice current state into the stored genesis redeem (silverc-INDEPENDENT, drift-safe).
    //   fail-closed (Bettor/NWT/UI convergent): shard_redeem_hex MUST be set at genesis (open_new). null = data-missing bug →
    //   THROW, never silent recompile (recompile bets determinism on Console silverc==canonical = drift risk).
    if (!shard.shard_redeem_hex) throw new Error(`shard ${shard.shard_market_id} missing shard_redeem_hex — genesis 应存; fail-closed 防 silverc-drift recompile (data-missing bug)`);
    const curRedeem = spliceLeafState(shard.shard_redeem_hex, st);
    const newState = { local_yes: st.local_yes + (direction === 0 ? stake : 0), local_no: st.local_no + (direction === 1 ? stake : 0), count: st.count + 1, pool_value: st.pool_value + stake };

    const [leafTxid] = String(shard.current_leaf_outpoint).split(':');
    const fundTx = await transfer(relayAddr, stake + 100_000_000);         // gateway funds stake-into-leaf + fee headroom
    const witness = buildRegisterWitness({ side: direction, stake: BigInt(stake), leafOutIdx: 0, psOutIdx: 1, bettorPk, psArtifact });
    const cmd = buildRegisterCommand({
      witness, leafOutpointTxid: leafTxid, leafRedeemHex: curRedeem, currentLeafState: st,
      bettorFunding: [{ outpointTxid: fundTx, address: relayAddr, index: 0 }], leafValueSompi: BigInt(st.pool_value),
      leafContinuationState: newState, ticketDustSompi: TICKET_DUST, shardPoolId, changeAddress: relayAddr,
    });
    const rj = await rc(cmd);
    const regTx = rj.txId || rj.txid;
    const leafContAddr = rj.leafContinuationAddress || p2sh(spliceLeafState(shard.shard_redeem_hex, newState));
    if (!regTx || !await landed(regTx, leafContAddr)) throw new Error(`register_append no land: ${JSON.stringify(rj).slice(0, 160)}`);

    if (recordBettor) await recordBettor({ shardMarketId: shard.shard_market_id, shardIndex: shard.shard_index, bettorPk, direction, stakeSompi: stake, leafTx: regTx });
    onBettorRegistered(db, shard.shard_market_id, { currentLeafOutpoint: `${regTx}:0`, currentLeafState: newState, nowSec: Math.floor(Date.now() / 1000) });
    await _maybeDefrag(rc);
    return { action: 'use', shardIndex: shard.shard_index, shardMarketId: shard.shard_market_id, shardP2sh: shard.shard_p2sh, leafTx: regTx, leafOutpoint: `${regTx}:0`, leafState: newState, payoutCovId };
  }

  // ── 'open_new' (A(b) 修, 2026-06-23 J2; 三方收敛 C1 安全洞修): genesis 一个【空】 ShardLeaf (count=0, maker seed, 非 bettor) ──
  //   再让【本注】落 'use' register_append 路 (count 0→1 + mint PoolSide ticket)。根除旧 open_new 的 C1 安全洞:
  //   旧版把首注 baked 进 genesis (count=1) 但【不 mint PoolSide ticket】(只 'use'/buildRegisterCommand psOutIdx:1 mint)
  //   → 每片首注无 per-bettor 链锚 (level2-B anti-swap BUST) + 无法 claim 奖金 (无 claim 票)。A(b) 统一全注走 use-branch。
  //   ★ Bettor 钉的测点: 空 genesis 地址 genAddr (= p2sh(genRedeem)) 必 == 后续 'use' 对 (0,0,0,0) state 的 leaf 地址
  //     (= p2sh(spliceLeafState(genRedeem,{0,0,0,0})))。compileShardLeafRedeem 烤的 (0,0,0,0) State 区 ==
  //     spliceLeafState 写的 (0,0,0,0) 4×PUSH8(i64LE 0) → byte-identical → 同址 (spliceLeafState byte-equal-to-recompile 已验)。
  //   leafValueSompi 起点: 'use' 传 st.pool_value=0 → buildRegisterCommand newLeafValue=0+stake=stake → 合约 weld
  //     out==pool_value(0)+stake 过; genesis seed (0.2KAS) 是 relay input, _appendChange 退 change (不进池)。
  const shardIndex = alloc.nextIndex;
  const shardPoolId = hex32(`${logicalMarketId}-shard-${shardIndex}`);
  // psArtifact = bettor-INDEPENDENT 模板 (4 dust-ticket 字段是 State, register 时 splice); ps_tmpl_hash 进 leaf ctor (bettorPk/dir/stake 只占位求模板, z32 占 shardPoolId 位)。
  const psArtifact = computePoolSideArtifact(join(LIB, 'PoolSide_v08_shard.sil'), [ctorBytes32(bettorPk), ctorInt(direction), ctorInt(stake), ctorBytes32(z32)], silverc);
  const genState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };  // 空 maker seed (非 bettor; level2-A Σcount==loaded 排除它)
  const genRedeem = compileShardLeafRedeem({ marketIdHash, psTmplHashHex: psArtifact.templateHashHex, shardPoolId, sealCount, payoutCovId, deadline, localYes: 0, localNo: 0, count: 0, poolValue: 0, silverc });
  const genAddr = p2sh(genRedeem);
  const genTx = await transfer(genAddr, SHARD_GENESIS_SEED);                // 空 genesis seed (dust, 非 bet stake)
  if (!await landed(genTx, genAddr)) throw new Error('ShardLeaf empty-genesis no land');

  // pool_markets row for this physical shard (UNIQUE shard_market_id in registry) — caller maps shard→market row.
  const shardMarketId = createShardMarketRow ? await createShardMarketRow(shardIndex, genAddr) : `${logicalMarketId}#${shardIndex}`;
  try {
    if (alloc.sealPrevId) sealShard(db, alloc.sealPrevId, Math.floor(Date.now() / 1000));
    registerShard(db, { logicalMarketId, shardIndex, shardMarketId, shardP2sh: genAddr, currentLeafOutpoint: `${genTx}:0`, currentLeafState: genState, shardRedeemHex: genRedeem, nowSec: Math.floor(Date.now() / 1000) });
  } catch (e) {
    // UNIQUE(logical_market_id, shard_index) race: another concurrent open_new won → retry the whole register.
    if (/UNIQUE/i.test(e.message)) { o._retry = (o._retry || 0) + 1; if (o._retry > 3) throw new Error('open_new race retry exhausted'); return registerBettorOnShard(o); }
    throw e;
  }
  // 空 genesis 【不】 recordBettor (它是 maker seed count=0, 非 bettor)。本注落 'use' register_append 路: 新空 shard 现 status=open
  //   有 room (count=0<32) → allocateForRegister 返 'use' → register_append (count 0→1 + mint ticket + recordBettor)。
  o._openedShard = (o._openedShard || 0) + 1;
  if (o._openedShard > 3) throw new Error('open_new→use loop guard (empty-genesis 未被 allocateForRegister 认出 open shard?)');
  return registerBettorOnShard(o);
}
