/**
 * UTXO Splitter — Relay-side implementation.
 *
 * Pre-splits UTXOs so an Agent can send several messages concurrently.
 * Reuses Relay's wallet (private key) and RPC connection.
 *
 * KIP-9 safe split count: N_max = floor(sqrt(1 + balance_sompi / 10^7)) - 1
 */

import * as kaspa from 'kaspa-wasm';
import { getWallet } from './wallet.mjs';
import { waitForRpc } from '../rpc-listener.mjs';
// design-v2 (B) risk#4 (Bettor r486): reuse the SAME wallet send mutex + pending-spent guards that
// sendKaspa uses, so a force-rebalance is atomically serialized against any in-flight settle broadcast
// (maker settle TX / committee sign_req / sign_resp — all go through send_broadcast → sendKaspa →
// withSendLock, verified pool-broadcast.mjs L44 + trade-protocol-filter.js L512). No settler-state
// query / no TOCTOU: the lock IS the mutual exclusion.
import { withSendLock, filterPendingUtxos, markUtxoSpent } from './transaction.mjs';

const { Generator, Encoding, Address, sompiToKaspaString, PaymentOutput } = kaspa;
const Resolver = kaspa.Resolver || null;

const MIN_BALANCE_FOR_SPLIT = 20_000_000n; // 0.2 KAS

async function resolveRpcUrl() {
  if (process.env.KASPA_RPC_URL) return process.env.KASPA_RPC_URL;
  if (process.env.RPC_URL) return process.env.RPC_URL;
  return null;
}

function maxSafeOutputs(balanceSompi) {
  const v = Number(balanceSompi);
  return Math.max(1, Math.floor(Math.sqrt(1 + v / 1e7)) - 1);
}

/**
 * Split UTXOs using Relay's own wallet.
 * @param {number} targetCount - Desired number of UTXOs (default 3)
 * @param {object} [opts]
 * @param {boolean} [opts.force] - design-v2 (B): REBALANCE mode. Without force, returns early when
 *   utxosBefore >= targetCount (the "enough count" heuristic). But for broadcaster-UTXO management
 *   (parallel chunk broadcast, J2 (A)) "enough count" is wrong: after a parallel broadcast the relay
 *   accumulates N small/dust changes (count >= N but each too small / unevenly sized to feed the next
 *   parallel batch). force=true ALWAYS rebalances ALL entries → N fresh equal medium UTXOs in one tx
 *   (the Generator consuming every entry = consolidate dust + split big), so the next parallel broadcast
 *   has N independent same-sized UTXOs and concurrent chunks never double-spend / starve on a change-chain.
 * @returns {{ ok, split, utxosBefore, utxosAfter, txId?, fee?, reason? }}
 */
export async function splitUtxosRelay(targetCount = 3, opts = {}) {
  const force = opts.force === true;
  const wallet = getWallet();
  const address = wallet.getAddress();
  // KANet-UI r55 Layer 4: testnet-12 → testnet-10 for Generator (vendored wasm string match).
  const networkId = wallet.getGeneratorNetworkId();

  const rpc = await waitForRpc();
  // withSendLock: serialize the whole rebalance against this relay's sendKaspa calls (settle chunk /
  // sign_req / sign_resp). A settle is a CHAIN of sendKaspa calls; the rebalance can only run when it
  // owns the lock, so it never interleaves a chunk mid-flight. filterPendingUtxos additionally skips
  // UTXOs a just-finished chunk marked pending (RPC still returns them as confirmed); markUtxoSpent on
  // the consumed entries makes the NEXT chunk skip the UTXOs this rebalance just spent. = no double-spend.
  return withSendLock(async () => {
    const { entries: rawEntries } = await rpc.getUtxosByAddresses([new Address(address)]);
    if (!rawEntries || rawEntries.length === 0) return { ok: false, reason: 'no_utxos' };
    const entries = filterPendingUtxos(rawEntries);
    if (entries.length === 0) return { ok: false, reason: 'no_utxos_all_pending' };

    const utxosBefore = entries.length;
    if (!force && utxosBefore >= targetCount) {
      return { ok: true, split: false, utxosBefore, utxosAfter: utxosBefore, reason: 'sufficient' };
    }

    const totalBalance = entries.reduce((sum, e) => sum + BigInt(e.amount), 0n);
    if (totalBalance < MIN_BALANCE_FOR_SPLIT) {
      return { ok: false, reason: 'balance_too_low', balance: sompiToKaspaString(totalBalance).toString() };
    }

    const maxN = maxSafeOutputs(totalBalance);
    const splitCount = Math.min(targetCount, maxN);
    if (splitCount <= 1) {
      return { ok: false, reason: 'balance_too_low_for_split', maxSafe: maxN };
    }

    // 5/29 NWT iter 5 (UI r85 BUG2 catch): pre-Toccata feeReserve=5000n + priorityFee=0n
    // 撞 kaspad v1.2.0 post-Toccata 100 sompi/mass standardness floor. split TX 1→N outputs mass ≈ N×~1500
    // → 3-split TX mass ~4500 → required fee ~450000 sompi. Hardcoded 5000n way under floor → "not standard" reject.
    // Fix: feeReserve floor = max(500k, N × 200k) covers structural overhead + per-output mass.
    // priorityFee floor 500_000n same pattern as transaction.mjs iter 4 (= bce1916).
    const feeReserve = BigInt(Math.max(500_000, splitCount * 200_000));
    const perOutput = (totalBalance - feeReserve) / BigInt(splitCount);
    const outputs = [];
    for (let i = 0; i < splitCount - 1; i++) {
      outputs.push(new PaymentOutput(new Address(address), perOutput));
    }

    const generator = new Generator({
      entries,
      outputs,
      priorityFee: 500_000n,
      changeAddress: new Address(address),
      networkId,
    });

    let pending, lastTxId = '';
    while ((pending = await generator.next())) {
      await pending.sign([wallet.getPrivateKey()]);
      lastTxId = await pending.submit(rpc);
    }

    if (!lastTxId) return { ok: false, reason: 'no_tx_produced' };
    const fee = sompiToKaspaString(generator.summary().fees).toString();

    // Mark every consumed UTXO pending so the next chunk's sendKaspa (after we release the lock) won't
    // reselect one this rebalance just spent before RPC reflects it (mirrors transaction.mjs L214).
    for (const e of entries) markUtxoSpent(e);

    return { ok: true, split: true, utxosBefore, utxosAfter: splitCount, txId: lastTxId, fee };
    // shared RpcClient managed by rpc-listener — do NOT disconnect from transaction layer
  });
}

/**
 * design-v2 (B) §2 ROOT-FIX (Bettor r627): consolidate a relay's fragmented UTXOs N→1 to keep its
 * `best` UTXO LARGE. The 880-wall is a function of `best`: a self-full broadcast (sign_req chunk /
 * comm) is 1-in-1-out picking `best`, mass ≈ C×feeReserve/best² — as `best` is ground down by
 * repeated self-sends, mass climbs quadratically until large payloads get throttled/dropped (the
 * qr733 committee-comms BLACKOUT root cause). Consolidation is KIP-9-CHEAP: N-in-1-out has
 * Σ(1/out)−Σ(1/in) ≤ 0 → clamped to 0 → near-zero mass (the inverse of split, which is the
 * expensive direction). This is the inverse of splitUtxosRelay.
 *
 * Hard points (design §5/§5b), satisfied here:
 * - §5 ATOMIC MERGE GUARD: runs under withSendLock — the SAME lock sendKaspa uses — so it never
 *   interleaves an in-flight settle chunk / sign_req / sign_resp (closes Race B build-window; same
 *   guard Bettor r489b APPROVED for splitUtxosRelay). filterPendingUtxos + markUtxoSpent mirror the
 *   sendKaspa RPC-confirm-lag guards. ⚠ Race A (inter-chunk, mid multi-chunk sequence) is shared
 *   with splitUtxosRelay's design — if a dedicated active-broadcast-sequence flag is wanted beyond
 *   the per-call lock, it applies to BOTH (out of scope of this function; flagged for review).
 * - §5b DISJOINT: getUtxosByAddresses([address]) scopes inputs to THIS relay's own P2PK address →
 *   structurally disjoint from the P2SH-spine POOL UTXOs a settle TX spends (different address type
 *   + derivation, P2SH-pool ∩ P2PK-relay = ∅, J2 r885) → settle TX bytes unchanged → cross-node
 *   determinism unaffected. Asserted below as a regression guard, not a discovery.
 * - PER-TX MASS BOUND: the Generator multi-rounds (the while loop) when inputs exceed a single TX's
 *   mass/size → each round's TX stays standard; rounds is reported.
 *
 * @param {object} [opts]
 * @param {number} [opts.minFragments=2] - skip if fewer than this many UTXOs (nothing to merge).
 * @returns {{ ok, consolidated, utxosBefore, rounds?, txId?, fee?, reason? }}
 */
export async function consolidateUtxosRelay(opts = {}) {
  const minFragments = Number.isFinite(opts.minFragments) ? opts.minFragments : 2;
  const wallet = getWallet();
  const address = wallet.getAddress();
  const networkId = wallet.getGeneratorNetworkId();
  const rpc = await waitForRpc();
  return withSendLock(async () => {
    const { entries: rawEntries } = await rpc.getUtxosByAddresses([new Address(address)]);
    if (!rawEntries || rawEntries.length === 0) return { ok: false, reason: 'no_utxos' };
    const entries = filterPendingUtxos(rawEntries);
    if (entries.length < minFragments) {
      return { ok: true, consolidated: false, reason: 'not_fragmented', utxosBefore: entries.length };
    }
    // §5b disjoint regression guard: every input MUST be from this relay's own P2PK address (the
    // query already scopes to it; assert so a future refactor that widens the input set is caught).
    const selfAddr = address.toString ? address.toString() : String(address);
    for (const e of entries) {
      const a = (e.address && (e.address.toString ? e.address.toString() : String(e.address)))
        || (e.entry && e.entry.address && String(e.entry.address)) || null;
      if (a && a !== selfAddr) {
        return { ok: false, reason: 'disjoint_violation', offending_address: a };
      }
    }
    const totalBalance = entries.reduce((s, e) => s + BigInt(e.amount), 0n);
    if (totalBalance < MIN_BALANCE_FOR_SPLIT) {
      return { ok: false, reason: 'balance_too_low', balance: sompiToKaspaString(totalBalance).toString() };
    }
    // 1-out consolidate: no explicit output → Generator routes all value (minus fee) to changeAddress
    // = one big consolidated UTXO. priorityFee floor mirrors splitUtxosRelay (post-Toccata standardness).
    const generator = new Generator({
      entries,
      outputs: [],
      priorityFee: 500_000n,
      changeAddress: new Address(address),
      networkId,
    });
    let pending, lastTxId = '', rounds = 0;
    while ((pending = await generator.next())) {
      await pending.sign([wallet.getPrivateKey()]);
      lastTxId = await pending.submit(rpc);
      rounds++;
    }
    if (!lastTxId) return { ok: false, reason: 'no_tx_produced' };
    const fee = sompiToKaspaString(generator.summary().fees).toString();
    // MASS CONSERVATION (design §2): out = Σin − fee; no value burned beyond fee. Generator enforces
    // this structurally (change = inputs − outputs − fee); we surface fee for the reviewer.
    for (const e of entries) markUtxoSpent(e);
    return { ok: true, consolidated: true, utxosBefore: entries.length, rounds, txId: lastTxId, fee };
  });
}
