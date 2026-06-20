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
export function buildCloseCommitCommand({ witness, rootOutpointTxid, rootRedeemHex, rootValueSompi, fee, sigsHex, txObjPreimage, changeAddress, committeePks = null }) {
  if (!rootOutpointTxid) throw new Error('rootOutpointTxid (root pool UTXO txid) required');
  if (!rootRedeemHex) throw new Error('rootRedeemHex (root redeem; relay derives per-state addr + reveals) required');
  if (rootValueSompi == null) throw new Error('rootValueSompi (current root UTXO value; close keeps it unchanged) required');
  if (!witness.closeState || witness.closeState.closed !== 1) throw new Error('witness.closeState must be closed=1 (close sets settled)');
  if (sigsHex != null && (!Array.isArray(sigsHex) || sigsHex.length !== 5)) throw new Error('sigsHex must be 5 committee sig slots (4-of-5; missing → placeholder), got ' + (sigsHex && sigsHex.length));
  // committee 4-of-5: driver builds the close TX preimage (tx_obj_preimage), each committee member signs it with its
  // key, driver collects → sigs_hex (relay pushes 5 slots, >=4 valid). Mirrors v07 settle pattern.
  // committeePks (RootClose committee_hash lever): 5 委员 pubkey hex —— RootClose.close_commit witness 含 5 pubkey(声明序在
  //   sig 之前), 合约 require blake2b(c0‖c1‖c2‖c3‖c4)==committee_hash 再数签(R8 hash-anchor)。relay 在 sig 前 push 这 5 pubkey。
  //   不供(PoolRoot 旧路, pubkey baked 在 ctor)→ 兼容旧行为。
  if (committeePks != null && (!Array.isArray(committeePks) || committeePks.length !== 5)) throw new Error('committeePks must be 5 pubkey hex (RootClose committee_hash witness) or null (PoolRoot baked)');
  return {
    action: 'bshard_close_commit', type: 'bshard_close_commit', // relay dispatches on cmd.type
    witness: {
      root_out_idx: witness.rootOutIdx, new_winning_side: witness.new_winningSide, new_payout_root: witness.new_payoutRoot,
      sigs_hex: sigsHex || [], // 5 committee sigs (4-of-5; driver-gathered against tx_obj_preimage; relay pushes them)
      committee_pks: committeePks || null, // RootClose: 5 witness pubkey (relay 在 sig 前 push); null=PoolRoot baked
      close_selector: committeePks != null ? '00' : '00', // RootClose close_commit=abi entry 0=OP_0; PoolRoot 也 OP_0
    },
    inputs: {
      root: { outpointTxid: rootOutpointTxid, redeem_hex: rootRedeemHex },
      fee: fee ? { outpointTxid: fee.outpointTxid, address: fee.address } : null, // P2PK miner-fee input (close value unchanged → no fee room in pool)
    },
    tx_obj_preimage: txObjPreimage || null, // committee sighash consistency (relay requires; driver builds the preimage committee signs)
    // outputs: root_continuation — relay computes per-state addr from redeem + closeState (closed:1), value UNCHANGED (weld3).
    outputs: {
      root_continuation: { amountSompi: BigInt(rootValueSompi).toString(), state: witness.closeState },
      change_address: changeAddress,
    },
  };
}
