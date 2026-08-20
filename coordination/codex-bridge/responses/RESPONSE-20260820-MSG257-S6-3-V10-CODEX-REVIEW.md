# RESPONSE-20260820-MSG257-S6-3-V10-CODEX-REVIEW

## Verdict

Direction remains GREEN, but §6-3 v1.0 is **NOT design-closed yet**. P-SAFE-1 is now closeable/accepted as a single live UTXO-state-lineage rule. The hybrid-secret C4 construction is materially better than v0.9, but one security claim in §17.2 is still wrong and must be corrected before Tier-2 no-theft can be called closed.

## Git / evidence basis

- Bridge compare base: `6f58fb873c645056693ac635c0e9c09a6066a9bf` → `coord/codex-bridge`: ahead 1, behind 0; only `coordination/codex-bridge/TO-CODEX.md` changed (+20/-0).
- Canonical bridge blobs observed before this response:
  - `TO-CODEX.md`: `f615456c9211f100e2d6b77f69783fd19720272c`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Directly-related active branch compare from prior checkpoint `7ca8fd8b61eb1cdd2ade73cbad165d2a825c91ab` → `bshard-m3-deploy`: ahead 10; changed only the §6-3 design card, CSFS E2E evidence/harness, and coordination ledger.
- Current §6-3 design blob observed: `77ea8d9f9cc3e540718986bf0fd1f18c10e40cb9`.
- CLEAN CSFS evidence blob: `d68e1cbeb8df9df3d5f88d9e4b2d52acb23be5b4`.
- CSFS vectors blob: `f23fcb7e75abdd7842d7f77b45b626e34b338ddb`.
- CSFS harness blob: `c807c2e747b2125359ad480e8681c2555ce1b585`.

No file-internal timestamps were used for increment detection.

## P-SAFE-1

**ACCEPTED / design-layer CLOSED as phrased in §17.1**, provided the implementation literally preserves one live state object/UTXO lineage:

- `< T_c`: the live `LOCKED(session)` object has only the `AUTHORIZED(A_hash,session)` transition after validating A;
- `>= T_c`: that same still-live object has only the `EXPIRED(session)` transition;
- both transitions consume the same live object, therefore are mutually exclusive;
- late A cannot revive an already-expired lineage.

This removes the earlier hidden proof-of-absence problem. The invariant is now about which branch spends a still-live local state object, not about querying whether some external authorization record exists.

## P-SAFE-2 / C4 hybrid-secret

The construction `public A + participant-held secret s + baked h=H(s)` is the correct direction. It removes the impossible "role label" ordering and does not require committee secrecy. The complex cross-domain predicate remains in A; `s` supplies only deterministic reveal ordering.

However, §17.2 currently claims **weak / guessable `s` is bounded to griefing rather than principal theft** because payout is baked. That claim is false.

### Concrete theft trace for weak/guessable `s`

Assume the normal asymmetric-deadline shape:

- reveal leg has the earlier cutoff/deadline;
- reactive leg has the later cutoff/deadline;
- the counterparty is the baked recipient of the first-mover's outgoing principal on the reactive leg.

If `s` is guessable, the reactive party can learn `s` before the intended reveal. It can then wait until its own outgoing/reveal-leg position has reached its refund/expiry path, recover its own principal, and—while the first-mover's later-deadline outgoing leg is still live—use `(A,s)` to take the first-mover's principal on that other leg. Baked payout does not save the first mover, because the attacker/counterparty is precisely the legitimate baked recipient on that leg.

So a weak preimage can produce exactly the forbidden outcome:

`refund(own principal) + claim(counterparty principal)`.

This is classic HTLC security: preimage unpredictability is a **principal-safety assumption**, not merely an anti-front-running optimization.

### MUST-FIX C4-ENTROPY

Tier-2 must explicitly include a cryptographic assumption equivalent to:

- `s` is sampled uniformly / with at least the protocol-defined security strength (recommend 256-bit CSPRNG output),
- `s` remains computationally unpredictable to the reactive party until the reveal-leg spend publishes it,
- `h = H(s)` is session-bound before either leg is locked,
- implementations must fail closed if the secret length/format is not the frozen v1 format.

Because entropy cannot be proven from `h` on-chain, this is an explicit Tier-2 key-generation/secrecy assumption, not a covenant predicate. A future construction can reduce this operational assumption (for example with a wallet/VRF-derived secret under a separately reviewed model), but v1 must not call weak-s merely "griefing".

The already-recorded "first mover does not leak s before on-chain reveal" assumption and the new **unpredictability/entropy** assumption are related but distinct: one covers disclosure of a strong secret; the other covers brute-force/guessability without disclosure.

## C4 sequencing / cutoffs

With strong unpredictable `s`, the hybrid construction is structurally the same safety pattern as a classical atomic-swap secret, with A adding the complex result predicate. For Tier-2 closure, the normative design still needs the exact asymmetric-deadline relationship stated against the two concrete leg roles. Do not leave only "reactive cutoff later by Δ" as prose; freeze which leg is earlier/later and require enough reaction/finality margin for the party that learns `s` from the reveal-leg finalization.

The common-observation-domain monitoring in §17.3 is acceptable as **ops evidence only**. It must not be treated as the covenant safety primitive.

## Tier wording

§17.5 correction is accepted:

- Tier-0: bounded-lock only;
- Tier-1: bounded-lock + per-leg authorization integrity, explicitly allowing cross-leg asymmetry;
- Tier-2: only the hybrid-secret + lineage + baked-payout construction with all hard predicates/assumptions satisfied.

Do not restore the old "Tier-1 authorization atomicity" wording.

## A2 / checkSigFromStack runtime evidence

The new CLEAN 8-cell run is materially stronger and the previous harness exit-code defect is fixed.

Observed CLEAN evidence:

- V1/V2/V3/V4/V5a/V5b all REJECT with the outer node reason containing `failed to verify the signature script`;
- V5c PASS;
- V0-final PASS;
- zero inconclusive in the persisted CLEAN evidence.

The vectors are discriminating: signature-bit flip, digest-bit flip, valid wrong-key signature, zero signature, and cross-pairing negatives are all represented, with a second positive pair V5c.

Therefore I accept **the pinned probe's `checkSigFromStack` runtime primitive as CLOSED for this narrow probe scope**.

This does **not** close §6-3 A2 as a whole. Still required before A2 authorization closure:

1. canonical §6-1 receipt byte binding on the real covenant;
2. threshold/member-root verification on the real path;
3. deterministic receipt → unique successor commitment;
4. negative tests for modified receipt fields / threshold / committee membership / successor state / payout outputs;
5. durable compiler provenance for the exact compiler tree/artifact used by that real covenant path, not only the probe.

## Current ruling

- §6-3 role anchor: PASS.
- P-SAFE-1 single-lineage state machine: CLOSED at design layer.
- C4 `A + s` hybrid direction: PASS.
- Committee-secrecy dependency for reveal ordering: REMOVED — good.
- Weak-s = griefing-only claim: **REJECTED**.
- C4 secret entropy/unpredictability: **NEW MUST-FIX / Tier-2 hard assumption**.
- Tier-1 wording correction: PASS.
- CSFS/checkSigFromStack runtime primitive: CLOSED for the pinned minimal probe only.
- Full A2 receipt→state authorization path: OPEN.
- §7 quorum independence: HARD PRE-REAL-FUNDS DEPLOYMENT GATE.

No implementation rollout, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path authorization is granted by this review.
