// pool-fold-builder.mjs — bshard fold witness/command assembler (J2, 2026-06-15; M3 e2e orchestration).
//
// Console-side assembly for a fold TX (k child pool-UTXOs → 1 parent pool-UTXO, value+account conserving covenant).
// Models PoolShard_fold fold (aa041d91 entry 1, #[covenant(binding=cov, from=max_fan_in, to=1)]; ABI __leader_fold[1]
// + __delegate_fold[2]). The relay (unlockBshardFold, J1) assembles the covenant scriptSig (leader provides
// new_states, delegates [] ; selectors OP_1/OP_2). This builder provides the k-child I/O spec + the parent State+value.
//
// fold covenant constraints (aa041d91): loop require(prev_states[i].closed==0) ; new_states[0].{local_yes==Σyes,
// local_no==Σno, count==Σcount, pool_value==Σvalue} ; closed==0 ∧ winningSide==0 ∧ payoutRoot==init_payoutRoot
// (canonical, committee-bypass fix) ; weld2 require(out[0].value == new_states[0].pool_value) ; if count==shard_count
// → blake2b(Σyes‖Σno‖market_id‖shard_count)==commit_v2.

import { foldRootCommitHex } from './pool-fold.mjs';

/**
 * Assemble the fold witness: the parent State (Σ child accounts + canonical zero outcome) + value-conserve checks.
 * @param {object} o {
 *   children: [{ value:bigint, state:{local_yes,local_no,count,pool_value,closed,winningSide,payoutRoot} }] (k children),
 *   initPayoutRoot(32B hex|Buffer),   // genesis ctor init_payoutRoot (canonical; fold pins parent.payoutRoot to it)
 *   shardCount, marketIdHex,          // for the root commit_v2 check (when Σcount==shardCount) }
 * @returns {{ parentState, parentValue:bigint, isRoot:boolean, rootCommitHex?:string }}
 */
export function buildFoldWitness(o) {
  const { children, initPayoutRoot, shardCount, marketIdHex } = o;
  if (!Array.isArray(children) || children.length < 2) throw new Error(`fold needs >= 2 children, got ${children && children.length}`);
  const initPayoutRootHex = Buffer.isBuffer(initPayoutRoot) ? initPayoutRoot.toString('hex') : initPayoutRoot;
  if (!initPayoutRootHex || Buffer.from(initPayoutRootHex, 'hex').length !== 32) throw new Error('initPayoutRoot must be 32B (genesis ctor canonical)');
  let yesSum = 0n, noSum = 0n, countSum = 0n, valueSum = 0n, childValueSum = 0n;
  for (const [i, c] of children.entries()) {
    if (!c.state) throw new Error(`child[${i}].state required`);
    if (c.state.closed !== 0) throw new Error(`child[${i}].closed must be 0 (fold rejects settled/cancelled children — loop require prev_states[i].closed==0)`);
    yesSum += BigInt(c.state.local_yes); noSum += BigInt(c.state.local_no);
    countSum += BigInt(c.state.count); valueSum += BigInt(c.state.pool_value);
    if (c.value == null) throw new Error(`child[${i}].value (UTXO value) required for weld2 conserve`);
    childValueSum += BigInt(c.value);
  }
  // weld2 mirror: parent.value == Σ child.value, AND pool_value accounting Σ == value Σ (induction: each child's
  // value==its pool_value by prior output-bind, so Σpool_value==Σvalue == parent.value==parent.pool_value).
  if (valueSum !== childValueSum) throw new Error(`fold conserve FAILED: Σchild.pool_value ${valueSum} != Σchild.value ${childValueSum} (a child UTXO value != its State pool_value — induction broken)`);
  const parentState = {
    local_yes: yesSum.toString(), local_no: noSum.toString(), count: countSum.toString(), pool_value: valueSum.toString(),
    closed: 0, winningSide: 0, payoutRoot: initPayoutRootHex, // canonical (committee-bypass fix: fold produces open pool only)
  };
  const isRoot = shardCount != null && countSum === BigInt(shardCount);
  const out = { parentState, parentValue: valueSum, isRoot };
  if (isRoot) {
    if (!marketIdHex) throw new Error('marketIdHex required for root fold (count==shardCount) commit_v2 check');
    out.rootCommitHex = foldRootCommitHex(yesSum, noSum, marketIdHex, Number(shardCount)); // == commit_v2 (on-chain blake2b check)
  }
  return out;
}

/**
 * Relay command for the fold TX. The relay (unlockBshardFold) reveals the k child UTXOs (covenant leader/delegate
 * scriptSig, selectors OP_1/OP_2 — J1 domain), and creates the parent continuation: relay computes per-state parent
 * P2SH from a child redeem + parentState, value = Σ child.value (weld2). All children are the same PoolShard_fold
 * template (same redeem modulo State), so the parent P2SH derives from any child's redeem + parentState.
 * @returns {object} relay command (type='bshard_fold')
 */
export function buildFoldCommand({ witness, children, fee, parentOutIdx = 0, changeAddress }) {
  if (!Array.isArray(children) || children.length < 2) throw new Error('children [{outpointTxid, redeem_hex}] (k >= 2) required');
  for (const [i, c] of children.entries()) {
    if (!c.outpointTxid || !c.redeem_hex) throw new Error(`child[${i}].{outpointTxid, redeem_hex} required (relay derives addr from redeem + reveals)`);
  }
  if (witness.parentState.closed !== 0 || witness.parentState.winningSide !== 0) {
    throw new Error('fold parent must be canonical open (closed=0, winningSide=0) — committee-bypass fix');
  }
  // fee = non-cov P2PK input for miner fee (children value Σ-conserved into parent by weld2 → no fee room in pool;
  // relay handler reads inputs.fee.{address, outpointTxid} optionally; without it the fold TX has no miner-fee source).
  return {
    action: 'bshard_fold', type: 'bshard_fold', // relay dispatches on cmd.type
    witness: {
      parent_out_idx: parentOutIdx,
      parent_state: witness.parentState, // new_states[0]; relay covenant verifies Σ + canonical outcome on-chain
      is_root: witness.isRoot, root_commit_hex: witness.rootCommitHex || null, // root fold → commit_v2 check
    },
    inputs: {
      // k covenant children; relay derives each addr from redeem_hex (per-state P2SH) + assembles leader/delegate scriptSig.
      children: children.map(c => ({ outpointTxid: c.outpointTxid, redeem_hex: c.redeem_hex })),
      fee: fee ? { outpointTxid: fee.outpointTxid, address: fee.address } : null, // P2PK miner-fee input (relay wallet-signs)
    },
    // outputs: parent_continuation — relay computes per-state addr from a child redeem + parent_state; value = Σ child.value (weld2).
    outputs: {
      parent_continuation: { amountSompi: BigInt(witness.parentValue).toString(), state: witness.parentState },
      change_address: changeAddress,
    },
  };
}
