# Codex independent review — unsynced precond4 / per-market fee authority

Baseline discipline for this review:

- bridge branch HEAD observed before review: `07f7812da1a9f71e0c2f1a0772c67169e595a5fa`
- bridge compare base: same SHA; GitHub compare result `identical`, ahead=0, behind=0, files=[]
- canonical bridge blobs observed at that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no delta, I checked the directly related active branch `bshard-m3-deploy`. Relative to the last reviewed active-branch point `677211986ec18fb951721201d8d761c700076c02`, current HEAD `652e49b6b1555d6f718877e7198e17e7d2e87135` is ahead by 5 commits. The relevant files are the D-012 precondition-4 handler measurement and the per-market fee-authority design/enumerator/mutation harness. No production wiring or money-path action is authorized here.

## 1. Precondition ④ handler measurement — ACCEPTED AS A RED MEASUREMENT, NOT AS A GATE IMPLEMENTATION

The new handler-level harness is valuable because it makes the required proposition falsifiable: a fake relay sink records whether `sign_input_for_settle` is actually invoked, and a positive control proves that the measurement path can observe a real signing call. On the current handler, the six covered negative transaction-shape cases each still reach signing, while the positive control also signs. That is meaningful evidence that the current handler does not enforce the requested shape/outpoint/amount/output-count gate before signing.

The file is also explicit that payout tampering is not covered. That is correct evidence hygiene. Therefore the current result is:

- six covered negative scenarios: current handler gap MEASURED;
- seventh payout-tamper scenario: still OPEN / NOT MEASURED;
- production PB-S8-2/handler wiring: NOT AUTHORIZED by this review.

Do not turn "the red harness is correct" into "precondition ④ is complete". The precondition text requires seven scenarios at zero sign calls; today the evidence demonstrates the opposite for six and leaves one unmeasured.

## 2. Fee mutation test — the compiler result is useful and I accept its narrow claim

`scripts/fee-mutation-test.mjs` has real positive controls and fails the run if no control executed or if a control failed to move. On the pinned legacy compiler, changing `oracleFeePct` / `brokerFeePct` while leaving the compiled redeem unchanged, while `minerFee` / `deadline` controls do change it, is good evidence for the narrow claim that those unused ctor fields are dropped from the redeem in the tested v0.6/v0.7 contracts.

Likewise, the v0.7 `market_id` mutation changing the redeem is useful confirmation that this field survives compilation in that tested contract.

But this is only two of the seven discovered spine contracts. It closes the compiler-behavior question for the tested subjects; it does not by itself establish a seven-contract acceptance result. Any DoD wording should preserve that scope.

## 3. Fee-authority enumerator has a mechanical false-positive risk — MUST-FIX before it is an acceptance oracle

The design says the enumerator mechanically answers: "for every money-moving entrypoint, where does this market's committed fee bind the actual spend?" The current implementation does not actually prove that proposition.

In `classify(line)`, any line containing a fee-ish ctor parameter plus `require(... == ...)` is classified `require-EQ`. Later, any such equality is enough to yield verdict `PER-MARKET(eq)`. There is no requirement that the same equality also constrains `tx.outputs[..].value`, transaction fee, or any other spend quantity.

So a future line such as:

`require(minerFee == maxAllowedFee);`

would be mechanically promoted to `PER-MARKET(eq)` even though it does not bind the transaction's actual spend at all. The code comment says "equality against a computed spend is the only form that binds the transaction", but the parser only checks `==`; the implementation is weaker than the stated invariant.

This matters because the script is being positioned as DoD ③/④ acceptance machinery. An acceptance oracle must not produce green merely because a fee parameter participates in an unrelated equality.

MUST-FIX: a `PER-MARKET(eq)` result must mechanically demonstrate both sides of the relationship: the market-committed fee/bound AND the spend-bearing expression (`tx.outputs[..].value` or another explicitly enumerated money-flow primitive) in the same enforced constraint, or use a small AST/data-flow analysis rather than line regex. Similar care is needed for range classifications if they are ever used as acceptance rather than diagnostics.

Until that is fixed, the script is useful as a diagnostic inventory but not strong enough to serve as the final mechanical acceptance gate it claims to be.

## 4. Design conclusion

The high-level design direction — keep fee flexibility but make the allowable bounds market-committed rather than global literals — is structurally reasonable and avoids simply restoring brittle v0.5-style exact-fee equality. However, this is money-path covenant design. Before any implementation or deployment, acceptance must prove separately that (a) the bound is compiled into the redeem, (b) every money-moving entrypoint constrains actual spend with that bound, and (c) the acceptance tool itself cannot green-light unrelated fee equalities.

Current ruling:

- precond4 red measurement: ACCEPTED as evidence of the existing gap; precondition itself remains OPEN;
- fee mutation result on v0.6/v0.7: ACCEPTED within tested scope;
- fee-authority design direction: ACCEPTED IN PRINCIPLE;
- `fee-authority-enumerate.mjs` as final DoD acceptance oracle: RED / MUST-FIX false-positive semantics;
- no covenant implementation, signer-handler wiring, deployment, production DB mutation, signing/broadcasting, settlement/refund, or other production money-path action is authorized by this review.
