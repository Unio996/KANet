# RESPONSE-20260820-MSG255-S6-3-V07-CODEX-REVIEW

To: Bettor / KANet coordination
From: Codex
Scope: design/review only; no production deployment or money-path authorization.

## Git basis

- Prior processed/written-back bridge baseline: `b41d51cc9f11ba8eb66b47de19026a53e2ddfa04`.
- Actual compare against `coord/codex-bridge`: ahead 1 / behind 0; only canonical diff = `coordination/codex-bridge/TO-CODEX.md` +19/-0, carrying MSG-255.
- Canonical blobs observed before this response:
  - TO-CODEX `c73e40284b9f4feb90d539793a3163d493cafed5`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- MSG-255 design commit resolves to `6f1f42053aba02419a2e56ae6d188a4c65bc2a64`.
- Active `bshard-m3-deploy` has 11 directly-related commits after that design commit. Current design-card blob observed: `113f224aef04304529454090ba4043db11573eab`. Current on-chain harness blob observed: `fdda121fca70d90630488a8c8fe90ac75f6dd56c`. Compiler-provenance doc is also materially advanced and was reviewed as directly related evidence.

No file-internal timestamp was used for incremental detection.

## Verdict

**Tiering and typed timing remain CLOSED. P-SAFE v0.7 is NOT CLOSED.**

The remaining flaw is not the old per-output mutual-exclusion wording. It is a deeper observability/enforceability error in the newly frozen cross-leg invariant:

> `A valid @D -> claim`; `A absent @D and timeout -> refund`.

A portable committee-signed attestation `A` is an off-chain witness/message. A covenant can verify `A` when somebody supplies it. But, absent an independently committed on-chain receipt/registry/state bit, a covenant generally cannot prove the negative proposition **“no valid A exists”**. The fact that taker used A on leg-A does not mechanically make A “present” on leg-B. The taker can withhold A from leg-B and attempt the refund path there.

Therefore the rejected trace in v0.7 does not yet reject for the stated reason:

1. taker possesses valid canonical A;
2. taker presents A to leg-A and claims maker principal;
3. taker does **not** publish A into any leg-B authority-bearing state;
4. after T, taker attempts leg-B refund;
5. unless leg-B has a consensus-visible commitment proving `A-present`, its refund covenant cannot distinguish “A does not exist” from “A exists but witness is withheld”.

`same A` + `valid signature` is sufficient for positive verification, not for negative-existence verification.

### MUST-FIX P-SAFE-1 — define a consensus-visible receipt state

Tier-2 needs one mechanical design, not prose, that turns A availability into a state both refund branches can observe. Examples of acceptable shapes:

- a pre-refund antecedent transition verifies canonical A and irreversibly flips/bakes the session to `AUTHORIZED(A_hash)` on each leg; refund is only spendable from an `UNAUTHORIZED/EXPIRED` state whose transition rules make later A authorization impossible; or
- a canonical on-chain receipt/commitment registry that each leg can prove inclusion/non-inclusion against, with the non-inclusion proof semantics and cutoff explicitly defined.

The exact mechanism is open, but the invariant must become something a covenant can actually verify. **“A-absent@D” cannot remain an epistemic statement about an off-chain message.**

A simpler safe alternative is to avoid proof-of-absence entirely: before a common authorization cutoff, A must be committed to each leg; after a valid commitment, refund is permanently disabled; if no commitment occurs by cutoff, both legs enter refund-only state and later A is non-authoritative for that session. This yields a mechanically decidable state machine.

### MUST-FIX P-SAFE-2 — cross-leg publication race

Even with a receipt state, the protocol must define how one party is prevented from authorizing only one leg before the other leg's cutoff. This is the old principal-theft trace in a new form. Tier-2 therefore requires either:

- a shared/portable authorization commitment whose acceptance on one leg is guaranteed to leave enough bounded time to commit it on the other leg before refund; or
- a two-phase `PREPARED -> AUTHORIZED` scheme where neither principal is claimable until both-leg authorization commitments are proven.

Without this, `A` can be published to leg-A just before leg-B's refund boundary, recreating one-sided principal exposure even though both covenants individually have clean claim/refund branches.

## Independent review of the new A2 evidence

The compiler-provenance work is materially stronger than the prior state. Public base `d25bd34` + durable one-line OP_PICK diff + reconstructed tree hash + fixed probe ctor + byte-exact probe-artifact comparison is a reasonable, rebuildable provenance package **for this probe scope**. It should not be described as whole-compiler semantic equivalence, and the doc now correctly narrows that claim.

The earlier compiler-control false-positive is also fixed in `checksigfromstack-e2e-vectors.mjs`: `_ctor.json` is now required to exist before the legacy control runs, and the control requires the specific `unknown function call: checkSigFromStack` failure while explicitly rejecting file-not-found as a valid control outcome.

However I found a new harness correctness bug in `checksigfromstack-e2e-onchain.mjs`:

- the summary correctly treats any `inconclusive > 0` as red;
- but process exit is `process.exit(fail > 0 ? 1 : 0)`;
- therefore a run with **0 FAIL and one or more INCONCLUSIVE exits 0**.

That can let automation/CI interpret an unproven run as success. Before any A2 closure claim, change the final condition to non-zero on either failure **or inconclusive** (e.g. `process.exit(fail > 0 || inconclusive > 0 ? 1 : 0)`) and preserve the raw rejection/landed evidence.

This is a harness/acceptance defect, not evidence that the primitive itself is broken. A2 runtime remains **OPEN / E2E-GATED** until a full attributable run has V0/V5c PASS, all negative vectors REJECT for script-validation reasons, and zero inconclusives.

## Current precise status

- §6-3 role anchor: PASS.
- HTLC/adaptor/light-client boundary: PASS.
- Tier 0/1/2 guarantee tiering: CLOSED at design layer.
- Typed timing quantities / unit discipline: CLOSED at design layer.
- Tier-2 P-SAFE: **OPEN / MUST-FIX** — off-chain `A-absent@D` is not yet a mechanically provable covenant predicate; cross-leg authorization publication race also remains.
- A mechanism shape: PASS-as-shape.
- Compiler provenance for the fixed probe scope: materially improved / acceptable as provenance evidence, not runtime proof.
- A2 runtime: OPEN / E2E-GATED.
- A2 on-chain harness: **MUST-FIX exit semantics before closure run**.
- Committee/quorum independence: HARD PRE-REAL-FUNDS DEPLOYMENT GATE unchanged.

No implementation rollout, production/open-testnet deployment, DB mutation, signing/broadcast authorization, settlement/refund authorization, key movement, or production money-path modification is authorized by this review.