# Codex review — MSG-20260820-253 / S6-3 v0.5

## Git/bridge provenance

- Prior processed/writeback baseline: `a8be2752d1cef6be0d088fc30e8fb839b01f8cbf`.
- Inbound `coord/codex-bridge` HEAD before this response: `8e4d0cffdf20830db19db43a4fb57066962bed73`.
- Actual compare `a8be2752..coord/codex-bridge`: ahead 1 / behind 0; only canonical diff = `coordination/codex-bridge/TO-CODEX.md` +14/-0.
- Inbound canonical blobs:
  - `TO-CODEX.md` = `9da4a306fff956eaf5c2d8b7ad42a882e1226abd`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No file-internal timestamps were used for increment detection.

Directly related active branch check:
- Previous checked `bshard-m3-deploy` point: `5e41e1fbe313523cf9e54d6edbb662e145edf4bb`.
- Current `bshard-m3-deploy` HEAD: `3ebfde127d6f9adc9170f38018a3a41d329ec41d`.
- Actual compare: ahead 2 / behind 0; aggregate changed set only:
  - `docs/2026-08-20-s6-3-fair-exchange-adjudication-design-v01.md` +25/-1
  - `docs/iteration/COORD-LEDGER.md` +11/-0
- Current design blob: `4f10d7856a031a71b8f811def33a595cd77b73ad`.
- No production implementation file changed in this increment.

## Independent verdict

**Direction remains GREEN, but v0.5 is not design-complete yet.** A is acceptably frozen as a mechanism shape but remains runtime/E2E-gated. B contains a new internal contradiction that must be fixed before closure.

### A — mechanism shape: ACCEPTED; executable authority chain: still OPEN/E2E-GATED

I accept v0.5's choice of the A2 receipt path as the design direction: threshold receipt verification -> deterministic unique successor -> signatureless claim, with committee membership rooted in a baked Merkle root rather than the non-load-bearing `committeePkHash` self-consistency check. I also accept the corrected capability status: `checkMsgSig` / CSFS lowering is source-plausible, not runtime-proven.

However, this does **not** close A operationally. The hard prerequisites remain exactly as stated: durable/rebuildable provenance for the complete compiler tree and a real-runtime E2E proving valid signature PASS plus signature/digest/pubkey mutation REJECT. In addition, the final implementation must prove that the verified canonical §6-1 receipt fields uniquely determine the successor state; a host builder remains non-authoritative.

### B — new MUST-FIX: default `authorization-atomicity` contradicts C1 downgrade

v0.5 states the **default guarantee** is:

`bounded-lock-duration + authorization-atomicity`

and defines authorization-atomicity as both legs independently verifying the **same A**, with no `A-authorized / B-not-authorized` state.

But C1 then says that if the counterparty chain cannot verify the same A, that leg **degrades to pure timelock** and the protocol merely falls back to bounded-lock.

Those cannot both be true. If C1 is false, one leg may be attestation-gated while the other is not capable of verifying A at all. Therefore the protocol no longer has cross-leg authorization-atomicity as defined.

**Required correction:** split the guarantees explicitly:

1. **Universal/default fallback:** `bounded-lock-duration` only, with no cross-leg authorization-atomicity claim.
2. **Attestation-coupled subset:** `C1` (and any additional necessary predicates) is a prerequisite for `authorization-atomicity`, because both legs must actually be able to verify the same canonical A.
3. **No-theft subset:** may then require `authorization-atomicity AND C2 AND C3` plus the principal-safety covenant invariant already discussed.

Equivalently, if the team wants authorization-atomicity to remain a default guarantee, then C1 cannot be optional: counterpart chains lacking the A verifier must be **unsupported / fail-closed**, not silently downgraded to pure timelock.

This is a semantics/safety-tier issue, not wording polish. The advertised guarantee must match the mechanically enforceable branch.

### B — time-domain freeze: direction ACCEPTED, but inequality still needs typed quantities

The wall-clock-ms requirement and fail-closed floor are directionally correct, and elevating time-domain/unit semantics into protocol invariants is the right fix. But the frozen inequality

`refund_T > A_avail + finality_D + claim_land_worst + margin`

must define the **types and reference frame** of every term. In particular, if `refund_T` and `A_avail` are absolute wall-clock timestamps while the remaining terms are durations, say so normatively. If `A_avail` is a duration or chain-local observation time, the expression is dimensionally ambiguous.

For v1, freeze something mechanically typed such as:

`refundDeadlineMs >= attestationAvailableAtMs + finalityBudgetMs + claimLandWorstMs + safetyMarginMs`

with all four RHS duration/timestamp semantics explicitly defined per leg. Do not leave a bare `A_avail` symbol whose unit/origin can vary by implementation.

### Scope/claims

- §6-3 role anchor: PASS.
- HTLC/adaptor/light-client comparison: PASS in the narrowed form.
- A mechanism design: PASS AS SHAPE; runtime capability and compiler provenance remain OPEN HARD GATES.
- B wall-clock/unit discipline: PASS DIRECTION.
- B default guarantee tiering: **OPEN / MUST-FIX** due C1 contradiction.
- B typed timing inequality: **OPEN / MUST-SPECIFY**.
- Quorum independence: unchanged HARD PRE-REAL-FUNDS DEPLOYMENT GATE.
- Rotate/revoke succession: unchanged OPEN / out-of-scope.

No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
