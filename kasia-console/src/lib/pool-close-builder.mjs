// pool-close-builder.mjs — bshard close_commit witness/command assembler (J2, 2026-06-15; M3 e2e orchestration).
//
// Console-side assembly for a close_commit TX (committee 4-of-5 attests the market outcome: sets the ROOT pool's
// closed=1 + winningSide + payoutRoot). Models PoolShard_fold close_commit (aa041d91 entry 2, OP_3). The relay
// (unlockBshardClose, J1) gathers the 4-of-5 committee signatures (cross-node) + reveals the root + recreates it.
//
// close_commit witness order (SS entry 2): c0Sig..c4Sig (committee, gathered by relay), rootOutIdx, new_winningSide,
// new_payoutRoot. This builder produces the non-sig fields + the root continuation (closed:1) State; the committee
// signatures are gathered at relay/committee-signing time (not by this builder). selector OP_3 (ABI slot 3; fold
// covenant occupies __leader_fold[1]/__delegate_fold[2]).
//
// On-chain (aa041d91): require(closed==0) + require(count==shard_count) [root only] + require(tx.time>=deadline) +
// 4-of-5 checkSig(c0-c4Pk) + validateOutputState(rootOutIdx, {...unchanged accounts, closed:1, winningSide, payoutRoot})
// + weld3 require(out[rootOutIdx].value == pool_value) [value UNCHANGED — close writes state, not money].

/**
 * Assemble the close_commit witness (non-sig) + root continuation State.
 * @param {object} o { rootOutIdx, winningSide(0|1), payoutRoot(32B hex|Buffer),
 *                     currentRootState: {local_yes, local_no, count, pool_value, closed, winningSide, payoutRoot} }
 * @returns {object} witness fields + closeState (7-field, closed:1) for the relay to compute the per-state root addr
 */
export function buildCloseCommitWitness(o) {
  const { rootOutIdx, winningSide, payoutRoot, currentRootState } = o;
  if (typeof rootOutIdx !== 'number' || rootOutIdx < 0) throw new Error(`rootOutIdx must be a non-negative int, got ${rootOutIdx}`);
  if (winningSide !== 0 && winningSide !== 1) throw new Error(`winningSide must be 0|1, got ${winningSide}`);
  const payoutRootHex = Buffer.isBuffer(payoutRoot) ? payoutRoot.toString('hex') : payoutRoot;
  if (!payoutRootHex || Buffer.from(payoutRootHex, 'hex').length !== 32) throw new Error('payoutRoot must be 32B (committee-attested merkle root)');
  if (!currentRootState || currentRootState.closed !== 0) throw new Error('currentRootState required + must be closed==0 (open root; close_commit gate require(closed==0))');
  // close writes outcome onto the root; accounts (local_yes/no/count/pool_value) UNCHANGED (weld3 value unchanged).
  const closeState = {
    local_yes: currentRootState.local_yes, local_no: currentRootState.local_no,
    count: currentRootState.count, pool_value: currentRootState.pool_value,
    closed: 1, winningSide, payoutRoot: payoutRootHex,
  };
  return { rootOutIdx, new_winningSide: winningSide, new_payoutRoot: payoutRootHex, closeState };
}

/**
 * Relay command for the close_commit TX. The relay (unlockBshardClose) reveals the root (close_commit OP_3 selector),
 * gathers the 4-of-5 committee signatures (cross-node), and recreates the root continuation: SAME address derivation
 * (relay computes per-state P2SH from redeem + closeState), value UNCHANGED (weld3), State closed:1.
 * @returns {object} relay command (type='bshard_close_commit')
 */
export function buildCloseCommitCommand({ witness, rootOutpointTxid, rootRedeemHex, rootValueSompi, changeAddress }) {
  if (!rootOutpointTxid) throw new Error('rootOutpointTxid (root pool UTXO txid) required');
  if (!rootRedeemHex) throw new Error('rootRedeemHex (root redeem; relay derives per-state addr + reveals) required');
  if (rootValueSompi == null) throw new Error('rootValueSompi (current root UTXO value; close keeps it unchanged) required');
  if (!witness.closeState || witness.closeState.closed !== 1) throw new Error('witness.closeState must be closed=1 (close sets settled)');
  return {
    action: 'bshard_close_commit', type: 'bshard_close_commit', // relay dispatches on cmd.type
    witness: {
      root_out_idx: witness.rootOutIdx, new_winning_side: witness.new_winningSide, new_payout_root: witness.new_payoutRoot,
      // c0Sig..c4Sig: gathered by relay/committee 4-of-5 signing (cross-node), NOT supplied by builder.
    },
    inputs: {
      root: { outpointTxid: rootOutpointTxid, redeem_hex: rootRedeemHex },
    },
    // outputs: root_continuation — relay computes per-state addr from redeem + closeState (closed:1), value UNCHANGED (weld3).
    outputs: {
      root_continuation: { amountSompi: BigInt(rootValueSompi).toString(), state: witness.closeState },
      change_address: changeAddress,
    },
  };
}
