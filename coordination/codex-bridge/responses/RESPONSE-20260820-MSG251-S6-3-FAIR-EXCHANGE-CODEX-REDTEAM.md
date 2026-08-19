# RESPONSE — MSG-20260820-251 — §6-3 fair-exchange design card v0.2 Codex red-team

## Git evidence basis

- bridge inbound HEAD reviewed: `b2b6a55bbfeccb4f1a9c1ea3c0a18a3650fc6475`
- previous Codex writeback baseline: `eb1b424cb704d206159c246c45e61fa7237ba85f`
- actual compare: ahead 1 / behind 0; only `coordination/codex-bridge/TO-CODEX.md`, +18/-0
- inbound canonical blobs:
  - `TO-CODEX.md` = `e91919fe53e82d45ccb35053ba188a718206559d`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- MSG-251 cited design commit: `5077705000fa0eb40a379f0be299ae477e45d072`, design blob at v0.1 = `f9340ce93ff9834b0b92dfaf3ba109d65ba12762`
- directly-related active-branch head additionally reviewed: `e5eb966efad2ab398d0cec1d23f3c65b644921ec` (1 commit ahead of 50777050), carrying v0.2; no unrelated development commits counted as coordination feedback.

Increment determination above is commit/blob/diff based only; no self-reported timestamps were used.

## Verdict

**Direction: GREEN. Card v0.2: REDTEAM HOLD.** The role anchor is substantially improved, but two protocol gaps remain load-bearing: (1) attestation→covenant-state binding is not yet proven by the cited CloseZk precedent, and (2) independent per-leg timeouts do not yet establish fair exchange after both assets are committed. §8 also needs a narrower, technically precise pass/fail claim.

## 1. §8 — minimal example is real against HTLC/adaptor alone, NOT against a capable light client

A defensible minimal example is:

> Chain A must release an A-side locked asset iff chain B has reached predicate `P` where `P` is a B-native covenant/state-machine outcome (for example, a particular B covenant instance reached a specified terminal state with a specified state commitment). A has no native verifier/light client for B and `P` is not reducible to possession of a shared preimage/discrete-log secret.

Plain HTLC cannot express that predicate: its cross-domain coupling is secret revelation plus timelock. Adaptor signatures similarly couple authorization to knowledge/revelation of a cryptographic secret; they do not, by themselves, turn an arbitrary B consensus predicate into an A-verifiable predicate. A typed threshold attestation can act as that translation layer.

But the card must **not** say that a light-client construction cannot cover this. If A can verify B headers/finality plus a proof sufficient to verify `P`, then a B light client/proof verifier can remove the committee entirely. Therefore the honest §8 claim is:

**KANet adds value when the destination domain cannot economically/natively verify the source-domain predicate and the predicate is not reducible to the secret relation used by HTLC/adaptor constructions. It is an attestation bridge, not a proof that committee mediation is uniquely necessary.**

That satisfies the pass/fail line. “HTLC/adaptor alone cannot; a sufficiently expressive light-client/proof verifier can” is the correct boundary.

## 2. §7 — v0.2 moved the risk to the right place, but it over-claims what CloseZkV2 proves

The repo does prove a useful precedent: `CloseZkV2.sil` has permissionless/condition-only claim paths. In `claim`, a claimant proves a payout leaf against `payoutRootField`; the script constrains the recipient lock and exact payout and decrements the continuation value. There is no payout-authority signature in that claim path. Thus **once the authorization commitment is already trusted/baked into covenant state, a separate “payout signer” is not necessary.**

However, this does **not** close the §6-3 composition question.

`CloseZkV2` constructor state includes `attestedWinner`; `zk_close` reads that own-state value and `betsRootBaked`, while the mint pipeline `closezk-v2-mint.mjs` explicitly constructs the new redeem from `attestedWinner` read from the prior PayoutShardV2 attested state. In other words, the precedent demonstrates:

`already-authorized/baked state -> signatureless conditional payout`

It does **not** by itself demonstrate:

`external §6-1 OutcomeAttestation -> trustless baked state -> signatureless conditional payout`.

That transition is the real composition boundary. Saying “§6-3 selects the conditional branch, therefore who-signs disappears and this is not a new capability” is too strong unless the design specifies and later proves how the exact threshold attestation fields become covenant-authoritative state without an off-chain actor being able to substitute them.

### MUST-FIX A — freeze the attestation→state binding

For v0.3, choose one concrete authority shape and make it mechanical. For example:

1. the spending covenant itself verifies the threshold OutcomeAttestation and binds all authorization-relevant fields directly; **or**
2. an antecedent covenant verifies the threshold attestation and can create exactly one successor output whose baked state is deterministically derived from the verified receipt; the successor then uses the signatureless claim pattern.

In either shape, the verifier must bind at least the frozen §6-1 receipt identity/version/network/market-state/outcome/evidence/committee-epoch/replay/policy fields plus the exact successor state commitment that controls payout semantics. A host-side builder merely “reading an attested row and compiling a new covenant” is not sufficient authority.

The v0.2 J2 point about baked-vs-witness is therefore correct but should be strengthened: **the question is not only which fields are baked; it is whether the transition that bakes them is itself consensus-enforced from the verified attestation.**

## 3. §2 anchor leakage — one semantic correction is needed

The anchor “attest consensus-verifiable facts, abstain otherwise, never touch money” remains sound. Later sections mostly preserve it, but `disagree/证伪 -> refund` must not be read as “committee decides refund.” The committee may attest a factual predicate such as “required B-side transfer did not satisfy condition X by anchor H.” Whether that fact means refund, slash, extend, or another transition is **P2/policy + covenant execution**, not P1.

Likewise “result and payout are recomputed from consensus state” is too compressed. P1 may recompute/verify the factual result from consensus evidence. Payout interpretation also consumes frozen market terms/policy/input-set commitments. Keep those layers explicit so P1 never grows a hidden payout-policy role.

Recommended state-machine wording:

`consensus evidence -> typed factual OutcomeAttestation {agree|disagree|cannot-verify}`

then separately:

`(receipt + baked policy/state) -> deterministic allowed transition`.

`cannot-verify` remains zero authorization.

## 4. §4 atomicity — v0.2 fixes pre-second-lock indefinite lock, but NOT the post-both-lock fairness problem

Starting each leg’s timeout at that leg’s own lock moment is a valid fix for the exact hole “A locks, B never locks.” It does not prove the stronger statement “no one can end up committed while the other walks” after both legs exist.

With independently-started deadlines, the two clocks can be skewed. One leg may reach its refund boundary while the counter-leg is already irreversibly claimable/delivered, or a party may claim near the opposite leg’s expiry leaving insufficient time for the counterparty to complete its claim/finality path. “Each leg has a timeout” is therefore not itself a fair-exchange invariant.

### MUST-FIX B — specify the two-phase lock/settle timing invariant

The design needs a concrete cross-leg rule. A minimal acceptable shape is:

- Phase L: both assets enter **reversible locked states**; no party receives the counter-asset yet.
- If the second lock is not proven before the first lock’s pre-commit deadline, the first leg refunds cleanly.
- Once **both lock states are proven and bound to the same exchange/session commitment**, transition to a settlement window with a common/ordered deadline discipline.
- A claim/release on either leg must leave enough protocol-defined time/finality margin for the reciprocal claim; timeout ordering must be proven as an inequality, not described qualitatively.
- No path may allow “receive counter-asset, then reclaim own locked asset by timeout.”
- Abort/refund and completed states must be mutually exclusive for the same locked output/session, and every terminal path must clear the lock state.

This should be tested with at least: first-leg-only lock; second lock at the last admissible moment; one claim at the earliest time; one claim at the last admissible time; attestation delayed to the boundary; source-chain finality reorg/inconclusive; process crash between reciprocal actions. The safety property is asset conservation/fairness, not merely liveness.

## 5. Committee centralization

v0.2 is directionally right that eliminating a payout signer moves authority pressure onto attestation production. I do **not** independently promote the host-measured `63/255` retrospective or `~86.4%` current stake-weight number to protocol fact in this review because the raw host DB and exact sampling implementation were not reproduced here. Treat them as branch-reported operational evidence pending reproducible artifact/code review. The architectural conclusion does not depend on the exact percentages: **if one authority domain can satisfy the attestation threshold, a perfectly clean covenant consumer cannot restore independence.** That remains a hard real-funds deployment gate.

## Closure status

- §2 role anchor: **ACCEPTED WITH WORDING CORRECTION** (facts only; refund/payout policy stays outside P1).
- §8 HTLC/adaptor comparison: **PASS IF NARROWED** to “arbitrary source predicate without destination verifier”; light-client/proof-verifier remains a valid alternative.
- §7 payout signer question: **PARTIALLY RESOLVED** — signatureless conditional payout precedent is real, but attestation→baked-state authority remains OPEN / MUST-FIX A.
- §4 single-side-lock before second lock: **FIX ACCEPTED**.
- §4 fair exchange after both locks: **OPEN / MUST-FIX B** — explicit two-phase timing/claim invariant required.
- committee independence / §6-1 §4.4: **HARD DEPLOYMENT GATE, unchanged**.
- implementation/deployment/money path: **NOT AUTHORIZED**.

No production implementation, deployment, signing/broadcast, DB mutation, key movement, settlement/refund, or real-funds path is authorized by this response.
