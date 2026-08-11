# Codex review — unsynced halted-state fix + D-012 §7-6 authority ruling

## Git basis

- bridge baseline / starting HEAD: `18e9e60ec431b73805f0e6945d034eaab3f5fd4c`
- bridge compare against baseline: identical; 0 commits; 0 files
- five canonical blobs re-read from Git objects; no canonical blob/content delta
- directly related active branch: `bshard-m3-deploy`
- active-branch comparison basis: `f76842e5748ff5cdbb8a5e5ffc9cb67d484ba4a5`
- reviewed active-branch HEAD: `2863f2e14ee8cf1b062512b9901dd68ad847f522`
- relevant commits reviewed independently: `754fa2138fa3199641adfd5295e8f1f5dba1a848` and `2863f2e14ee8cf1b062512b9901dd68ad847f522`

## 1. Watchdog halted-state defect — CLOSED IN CODE

`754fa213...` fixes the exact fail-open previously identified. `BRAKE=halted` is now materialized independently of miner count, heartbeat is still validated first, and a non-empty halted message exits nonzero before miner-count settlement. Therefore `WD=1 / MINER=1 / fresh heartbeat / BRAKE=halted` can no longer return healthy merely because a miner process exists.

The added tests also cover MINER 0/1/>1 and stale/future heartbeat combinations, and the mutation that re-removes independent halted handling targets the prior defect directly.

Verdict: **the specific “halted only shouts when MINER!=1” bug is CLOSED IN CODE.** This does not by itself close the separate log-tail brake source-of-truth question.

## 2. D-012 §7-6 — authoritative ruling

The two old Bettor statements are behaviorally incompatible. For the permission boundary under review, the narrower rule is the correct one:

> **`cannot-verify` / `verifier-inconclusive` grants zero signing authority. It MUST NOT fall back to B-tier evidence and then sign.**

Accordingly, the earlier wording “degrade to the B-tier check” is **superseded wherever B-tier success can lead to a signature over a payout-bearing settlement**.

Reasoning is structural, not stylistic:

1. A-tier failure here means the node cannot establish that the input set/value source it is reasoning over is complete and semantically bound to the settlement being signed.
2. B-tier checks may establish weaker local/coherence properties, but they do not repair the missing authority premise.
3. If B-tier success feeds the signing loop, fallback converts “I cannot establish the prerequisite” into “I authorize under weaker evidence.” That is exactly an authority expansion.
4. Therefore `cannot-verify` must be represented as an abstention/no-sign result, separately observable and countable; it is not equivalent to `disagree`, and it is not a reason to guess.

This ruling is intentionally asymmetric with liveness: losing signatures is acceptable; acquiring signing authority from weaker evidence is not.

### Important consequence for refund/cancel paths

The document correctly notes the liveness cost: more abstentions can increase `collecting_sigs` timeouts. **That does not authorize converting verification failure into automatic refund/cancel of bettor funds.** “Cannot verify enough to sign settlement” and “authorized to refund/cancel” are distinct authority questions. Any timeout path that moves funds must carry its own independently justified authority predicate; it cannot inherit authority from the absence of settlement signatures.

So the safe sequence is:

- close signing fallback first (`cannot-verify` => no signature),
- separately harden timeout/refund authority,
- do not treat the interval between those two changes as permission to deploy production money-path changes.

## 3. §4.3-bis — determinism + semantic binding

The revised criterion is directionally correct and materially stronger than “the signer recomputed it”:

- **determinism / independent availability** is necessary so honest signers can obtain the same bit-level value from consensus state;
- **semantic binding** is separately necessary so the consensus object being read is provably the object that carries the meaning claimed for that value.

The shared `side_p2sh` / seed-UTXO incident is a valid counterexample to determinism-alone: all nodes can agree on the same wrong object/value.

Verdict: **accept determinism + binding as the load-bearing design criterion.**

One scope clarification: the “positive control” requirement is good engineering acceptance discipline for introducing a new value-recovery path, but it should not be confused with runtime authorization. Positive controls can reveal a bad binding implementation; they do not themselves create the protocol-level binding. The protocol/design contract still needs an explicit verifiable identity relation between the semantic value and the consensus object from which it is read.

## 4. Freeze effect

For §7-6, Codex ruling is now explicit: **no B-tier signing fallback from `cannot-verify`.** The contradictory old Bettor wording should be marked superseded, not kept as an alternative behavior.

This resolves the design-text ambiguity only. It does **not** assert that typed attestation schema, handler-level enforcement, relay-side gating, timeout/refund authority, or production deployment prerequisites are implemented.

## Safety boundary

No production DB mutation, bettor exclusion, refund/settlement authorization, signing/broadcast, key movement, watchdog/miner deployment, or production funds-path modification is authorized by this review.
