// pool-refund-builder.mjs — bshard refund_draw witness/command assembler (J2, 2026-06-15, integration builder 3/3b).
//
// Console-side assembly for a refund_draw TX (market cancelled/timed-out → bettor reclaims their own stake 1:1).
// Models PoolShard_fold refund_draw (b1e9ca14 entry 4, L202-238). The relay builds/signs/broadcasts:
//   - reveals the pool UTXO (refund_draw selector) + the bettor's PoolSide ticket (spent-once),
//   - pays the bettor P2PK(tk.bettorPk) = tk.stake,
//   - recreates the pool continuation: SAME address (template P2SH, state-excluded) + value = pool_value - stake,
//     with the State flipped closed=2 (F2 cancel latch) + pool_value -= stake (all other State fields unchanged).
//
// refund_draw witness order (b1e9ca14 L203-208): poolOutIdx, payoutOutIdx, ticketInIdx, ticket_prefix_len,
// ticket_suffix_len. refund is PERMISSIONLESS (no sig — anyone may trigger; funds go to the ticket's bettor via
// P2PK(tk.bettorPk)). ticket_prefix/suffix_len come from my per-market PoolSide artifact (same template as register).
//
// On-chain welds re-verified (b1e9ca14): L209 require(closed != 1) + L210 require(tx.time >= (deadline+7200)*1000)
// (timeout gate) + ticket shardPoolId == shard_pool_id + L238 weld5 require(out[poolOutIdx].value == pool_value - tk.stake).
// closed flips 0→2 (write-once latch): first refund implicit-cancels, blocking late close (require closed==0). See F2 fix.

import { blake2b } from '@noble/hashes/blake2b';

/**
 * Assemble the refund_draw witness, self-verified against the PoolSide ticket's baked ps_tmpl_hash.
 * @param {object} o {
 *   poolOutIdx, payoutOutIdx, ticketInIdx,                       // output/input positions
 *   psArtifact: { templatePrefix:Buffer, templateSuffix:Buffer, templateHashHex },  // PoolSide template (= register's)
 *   bettorPk(hex), stake(bigint) }                               // ticket fields (refund pays P2PK(bettorPk) = stake)
 * @returns {object} witness (ticket_prefix/suffix as Buffers) + bettorPk + stake
 */
export function buildRefundWitness(o) {
  const { poolOutIdx, payoutOutIdx, ticketInIdx, psArtifact, bettorPk, stake } = o;
  for (const [k, v] of [['poolOutIdx', poolOutIdx], ['payoutOutIdx', payoutOutIdx], ['ticketInIdx', ticketInIdx]]) {
    if (typeof v !== 'number' || v < 0) throw new Error(`${k} must be a non-negative int, got ${v}`);
  }
  if (!psArtifact || !Buffer.isBuffer(psArtifact.templatePrefix) || !Buffer.isBuffer(psArtifact.templateSuffix)) {
    throw new Error('psArtifact {templatePrefix, templateSuffix, templateHashHex} required (pool-bshard-artifacts.computePoolSideArtifact)');
  }
  if (!bettorPk || typeof bettorPk !== 'string') throw new Error('bettorPk (ticket owner, hex) required');
  if (!(BigInt(stake) > 0n)) throw new Error(`stake must be > 0, got ${stake}`);
  // self-verify: blake2b(prefix‖suffix) == ps_tmpl_hash (= the on-chain readInputStateWithTemplate(...,ps_tmpl_hash)
  // template check; a mismatch → the relay would build a refund TX the covenant rejects on the ticket read).
  const tmplHash = Buffer.from(blake2b(Buffer.concat([psArtifact.templatePrefix, psArtifact.templateSuffix]), { dkLen: 32 })).toString('hex');
  if (tmplHash !== psArtifact.templateHashHex) {
    throw new Error(`refund witness self-verify FAILED: blake2b(prefix‖suffix) ${tmplHash.slice(0, 12)} != ps_tmpl_hash ${psArtifact.templateHashHex.slice(0, 12)}`);
  }
  return {
    poolOutIdx, payoutOutIdx, ticketInIdx,
    ticket_prefix: psArtifact.templatePrefix, ticket_suffix: psArtifact.templateSuffix,
    ticket_prefix_len: psArtifact.templatePrefix.length, ticket_suffix_len: psArtifact.templateSuffix.length,
    ps_tmpl_hash: psArtifact.templateHashHex,
    bettorPk, stake: BigInt(stake),
  };
}

/**
 * Relay command for the refund_draw TX. The relay reveals the pool (refund_draw selector) + the PoolSide ticket,
 * pays the bettor (P2PK(bettorPk) = stake), and recreates the pool continuation (SAME address, value pool_value-stake,
 * State flipped closed=2 + pool_value-=stake). The new pool State region is given by `poolContinuationState` for the
 * relay to serialize (closed=2 latch + unchanged local_yes/no/count/winningSide/payoutRoot). value-conserve weld
 * (on-chain L238) self-checked here: payout(stake) + pool_out(poolValue-stake) == poolValue (no value created).
 * @returns {object} relay command (action='bshard_refund_cancelled')
 */
export function buildRefundCommand({ witness, poolOutpointTxid, poolRedeemHex, currentPoolState, ticketOutpointTxid, ticketRedeemHex, ticketState, poolValueSompi, bettorAddress, poolContinuationState, changeAddress }) {
  if (!poolOutpointTxid || !ticketOutpointTxid) throw new Error('poolOutpointTxid + ticketOutpointTxid required');
  if (!currentPoolState) throw new Error('currentPoolState (current pool 7-field state; relay computes current per-state pool address) required');
  if (!ticketState) throw new Error('ticketState {bettorPk, direction, stake, shardPoolId} (relay computes ticket address) required');
  if (!bettorAddress) throw new Error('bettorAddress (P2PK(bettorPk); refund recipient) required');
  if (poolValueSompi == null) throw new Error('poolValueSompi (current pool UTXO value) required');
  const poolValue = BigInt(poolValueSompi);
  const stake = BigInt(witness.stake);
  const poolOut = poolValue - stake;
  if (poolOut < 0n) throw new Error(`refund value-conserve FAILED: stake ${stake} > pool_value ${poolValue}`);
  // value-conserve self-check (mirrors on-chain weld5 + payout bind): payout + pool_out == pool_value.
  if (stake + poolOut !== poolValue) throw new Error('refund value-conserve self-check FAILED: payout + pool_out != pool_value');
  if (poolContinuationState && poolContinuationState.closed !== 2) {
    throw new Error(`refund pool continuation must set closed=2 (F2 cancel latch), got ${poolContinuationState.closed}`);
  }
  // relay handler (unlockBshardRefund) consumes: inputs.pool.{redeem_hex, current_state, outpointTxid},
  // inputs.ticket.{redeem_hex, state, outpointTxid}, witness.{ps_prefix_hex, ps_suffix_hex} (ticket-addr metadata);
  // computes per-state pool/ticket addr + change itself. (ps_prefix/suffix derived from the witness template buffers.)
  return {
    action: 'bshard_refund_cancelled',
    witness: {
      pool_out_idx: witness.poolOutIdx, payout_out_idx: witness.payoutOutIdx, ticket_in_idx: witness.ticketInIdx,
      ticket_prefix_len: witness.ticket_prefix_len, ticket_suffix_len: witness.ticket_suffix_len,
      ps_prefix_hex: witness.ticket_prefix.toString('hex'), ps_suffix_hex: witness.ticket_suffix.toString('hex'),
      bettor_pk: witness.bettorPk,
    },
    inputs: {
      pool: { outpointTxid: poolOutpointTxid, redeem_hex: poolRedeemHex, current_state: currentPoolState },
      ticket: { outpointTxid: ticketOutpointTxid, redeem_hex: ticketRedeemHex, state: ticketState },
    },
    // outputs: refund → bettor P2PK = stake; pool_continuation (relay computes per-state addr; value-=stake, closed=2); change (relay computes amount)
    outputs: {
      payout: { address: bettorAddress, amountSompi: stake.toString() },
      pool_continuation: { amountSompi: poolOut.toString(), state: poolContinuationState || null },
      change_address: changeAddress,
    },
  };
}
