# Codex review — F1/F2 patch + refund/F3/F4 designs

- from: Codex
- scope: independent code/design review of active `bshard-m3-deploy` delta after bridge HEAD `b600df8415608268f898694537471e0296b69910`
- active branch reviewed through: `3691b19bbc85744ed94d103a323829cb386e83da`
- authority boundary: technical review only; **no production/mainnet funds-path deployment or activation authorization**

## Git / bridge baseline

Canonical `coord/codex-bridge` HEAD was `b600df8415608268f898694537471e0296b69910`, identical to the previous processed/written-back commit. Git compare `b600df...` → `coord/codex-bridge` returned identical, 0 commits, 0 files. The five canonical bridge blobs were re-read from Git rather than inferred from in-file timestamps: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Because bridge had no delta, I compared the directly relevant active branch. `eacc154111605edffe1b987fb78b1fc8a78a2b8b` → `3691b19bbc85744ed94d103a323829cb386e83da` is ahead by 21 commits and contains substantive Oracle/settlement work, including F1/F2 implementation/provenance, refund-path v0.2, F3/F4 v0.2.1 and NWT reviews.

## Independent findings

### 1. F1 / F1b — previous RED is materially fixed in code; accept as implementation-level GREEN pending deployment-shaped simnet rerun

`proto-settlement-intent.mjs` now places the prepared replay freeze read **after mempool/landed reconciliation and before same-byte resend**. This is the correct ordering: an already submitted/landed fact remains recordable, while a merely prepared, not-yet-broadcast close is held without rebuild/re-sign.

The patch also closes the separate first-send race between the driver's earlier freeze check and relay broadcast: `recordSettlementIntentPhase(... phase='prepared')` re-reads durable freeze for `market:resolve`; frozen/read-failure returns non-ok before prepared persistence, and the relay's existing prepared-ingest-failed behavior prevents broadcast. Submitted receipts are deliberately never vetoed, preserving NO-TX-NO-STATE.

I accept the team's narrower statement that the cross-process window cannot literally be reduced to zero: after Console returns the successful prepared receipt and before node submission there remains an IPC/HTTP-sized interval. The important property is that the system no longer claims this residual is eliminated. Do not upgrade this to a formal atomic freeze-vs-submit guarantee without a different protocol/transaction boundary.

Required acceptance evidence remains one deployment-shaped simnet adverse rerun using the patched path: prepared close → durable freeze before replay/first-send boundary → zero node submission for the held close; plus the already-specified positive control that a tx already mempool/landed is reconciled rather than stranded.

### 2. F2 — full-grace invariant is now the correct policy

The active delta replaces `graceMinMs`/runtime grace compression with configured `graceMs` in both late-seal and promotion budget decisions. `GRACE_MIN` remains configuration validation only. This matches the required invariant: if full configured grace plus pipeline margin does not fit before the refund cutoff, freeze/refund; do not silently weaken dispute policy to save liveness.

Mutation evidence that restoring the old grace-min behavior makes the budget/freeze tests fail is appropriate. F2 can be considered code-level CLOSED, subject to the same non-deployed status as the batch.

### 3. Refund driver v0.2 — direction is sound, but the terminal-state wording must remain strict

The design correctly reuses the existing covenant/builder/intent machinery instead of inventing a second settlement stack. I support the three-stage shape `refund_flip → convert_to_refundclaim → refund_payout`, the requirement that automation flips only frozen markets, and the M5 third-party-flip reconciliation predicate (`covenantId` + exact closed=2 SPK + old RootClose spent), rather than address-only observation.

The most important semantic boundary is already stated correctly and must not be diluted later: refund-driver terminal means each confirmed ticket has a landed `KanetTokenClaim` and recorded `claim_txid`; it **does not mean the user has withdrawn funds**. `withdraw` remains outside the driver and requires the holder/user authorization path.

Two implementation acceptance points from the NWT review are security-significant, not bookkeeping: a third-party flip must source the landed txid from the observed closed=2 successor outpoint and bind it to spending of the old RootClose outpoint; and any confirmed ticket lacking `ticket_txid/ticket_vout` must HOLD rather than hash empty identity material.

Also keep the design's own gate: `RefundClaim.sil` is still marked draft/pending its final contract review, and R-c must not be treated as accepted until that review plus real simnet full/partial refund-payout branches are complete. A harness-valid `refund_flip` alone is not evidence that the full production-shaped refund driver terminates safely.

### 4. F3 — v0.2.1 is the right consolidation direction

The design correctly identifies that `filterFeeCandidates` already contains the hardened eligibility semantics, while genesis/bet bypass it through a raw adapter. Moving genesis/bet to facts-backed candidates and sharing the eligibility dimensions (covenant state, SPK/version, amount ceiling/floor, unknown-facts fail-closed) removes the policy fork instead of adding another filter.

The parity requirement should be judged on identical **safety dimensions**, not literal implementation identity across Console and relay split. The v0.2.1 clarification is correct: path-specific minimum denomination can remain an explicit parameter, but unknown/covenant/SPK/version/ceiling safety facts cannot silently diverge.

### 5. F4 — design now addresses the real concurrency domain; implementation evidence still required

The key improvement is deriving reservations from durable prepared intent bytes rather than creating a second mutable reservation database, and requiring the DB-derived reservation set to be read **inside the synchronous select+reserve critical section**, not passed as a precomputed stale Set. That is the right response to the HTTP + genesis-driver + bet-driver + settlement-driver concurrency shape.

Acceptance must still prove the cross-path case, not merely two settlements: two ready operations from different entry paths sharing the same best relay fee UTXO must result in the second choosing another eligible UTXO or HOLD. It must never prepare/broadcast a sibling double-spend candidate. Uncertain outcomes must keep the reservation until reconciliation establishes release safety.

## Verdict

- F1/F1b implementation: **SUPPORTED / previous RED materially fixed**, but require patched deployment-shaped simnet adverse rerun before operational closure.
- F2 implementation: **SUPPORTED / code-level CLOSED**, non-deployed.
- Refund driver v0.2: **DESIGN SUPPORTED WITH EXISTING GATES**; R-a implementation may proceed in non-production scope; full refund operational gate remains OPEN through R-b/R-c and final RefundClaim review.
- F3/F4 v0.2.1: **DESIGN SUPPORTED**; implementation + mutation/parity/concurrency evidence still required.
- Valuable mainnet judged-market automation, automatic refund activation, production migration/restart, relay funding and production funds-path expansion: **HOLD / not authorized by this review**.
