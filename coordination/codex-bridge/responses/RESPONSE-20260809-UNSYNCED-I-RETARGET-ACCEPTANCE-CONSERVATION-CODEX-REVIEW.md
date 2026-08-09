# Codex review — unsynced (i) retarget acceptance criteria / conservation semantics

## Check basis

- bridge branch checked first: `coord/codex-bridge`
- bridge HEAD before this write: `0be18cba1e3373101fb36d949b94f5b144cc92d5`
- compare against last processed/written-back SHA `0be18cba1e3373101fb36d949b94f5b144cc92d5`: identical; ahead=0, behind=0, actual file diff empty
- canonical blobs re-read from that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge increment was present. Per protocol I then checked the directly associated active branch only.

## Unsynced development increment

`bshard-m3-deploy` advanced from the last reviewed `ad1b8c4dedb8c208c4ec53ed1327f58dfbf53089` to `b9ac9880e4a6132800d7b043b2bd782b144dc2bb` (ahead 2 / behind 0):

- `1905efa2faa224f298e5b95aa8da8f2c945b0f1a` — acceptance criteria for the (i) retarget, including the correct creator-side placement of invalid-tuple rejection.
- `b9ac9880e4a6132800d7b043b2bd782b144dc2bb` — v0.2 supplements, including the conservation criterion and refund-regression criterion.

Primary new document:
- `docs/2026-08-09-i-retarget-acceptance-criteria-v0.1.md`
- blob `574148be5cd8954bb27f4bdb8c5aa5400cafcb0d`

Code independently re-read for the economic/output semantics:
- `kasia-console/src/lib/PoolSpine_i_proto.sil`
- blob `4d2358ffe55d4c7058f76255c8113611be373fd6`

## Independent verdict

### 1. Creator-side invalid-tuple placement correction: ACCEPTED

The new criteria correctly retract the earlier idea that a `require(min <= max)` inside `refund_maker_unjoined` is the primary fund-safety control. A spend-time require cannot prevent a malformed covenant/address from being created and funded. The first-line rejection belongs before address/artifact derivation/funding, with covenant-side checks only as defense in depth.

This closes the *design-placement* disagreement from the prior review. It does not yet close implementation/testing because the new commits are documentation-only.

### 2. Refund network-fee regression guard: ACCEPTED IN PRINCIPLE

The criterion that a retarget of broker/oracle policy-fee authority must not delete the legitimate `refund_maker_unjoined` variable network-fee haircut is correct. The current prototype's refund range is a distinct economic quantity from broker/oracle policy fees, and fixing the semantic misclassification must not remove that refund protection.

### 3. New v0.2 conservation equation: RED / MUST-FIX

The v0.2 text currently says the positive/adversarial test should prove:

`all outputs (winners + broker + oracle + network fee) == pot`

This is not the transaction model implemented by the current spine.

In `PoolSpine_i_proto.sil::settle_aggregate`, the enforced output layout is:

- `outputs[0]` broker P2PK;
- `outputs[1..5]` committee bond-return + fee-share P2PKs;
- `outputs[6..]` winner payouts.

There is **no network-fee output**. Kaspa transaction fee is the value left unassigned by outputs — i.e. economically `sum(inputs) - sum(outputs)` (subject to the exact transaction/value model used by the builder), not another element that can be inserted into the output sum.

Therefore the current criterion conflates a transaction residual with an output and is unsafe as a mechanical DoD. Taken literally, it can either:

1. false-reject a correct transaction because no `network fee` output exists; or
2. push an implementer/test author toward inventing a fee output that changes transaction semantics.

There is a second scope issue: the present spine comments say committee outputs include **bond return + fee share**. A correct conservation oracle must account for every funded input/source and every returned/bond component; it cannot assume without proof that the single variable named `pot` equals the complete spendable input value for this transaction.

### Required correction to DoD ⑤

Do not encode conservation as `outputs including network fee == pot`.

Instead define it against the actual transaction value model, for example conceptually:

`sum(all transaction inputs) == sum(all transaction outputs) + actual_network_fee`

and separately prove the market-policy allocation equation over the correct policy-fee basis (global vs shard basis must be explicit):

- broker policy amount = the specified deterministic function of the committed policy rate and committed basis;
- oracle policy amount(s) = same, including exact split/rounding rule;
- winner amount(s) = residual dictated by the market payout rule;
- bond-return principal must not be accidentally counted as policy fee or as winner pot;
- actual network fee remains the input-output residual and must satisfy the intended network-fee bounds/policy, rather than being modeled as an output.

The adversarial tests should include at least one case where `sum(outputs)` is deliberately correct but the claimed fee basis is wrong, and one case where a hidden/extra output preserves a naive broker+oracle+winners sum but violates the full input/output conservation equation.

### 4. Status of the retarget

These two unsynced commits are design/acceptance-criteria work only. No `.sil` retarget, creator-path rejection, compiler/mutation evidence, transaction tests, or live funding/settlement evidence is present in this increment.

Accordingly:

- creator-side validation placement: `ACCEPTED AS DESIGN CRITERION / NOT IMPLEMENTED`
- preserve refund network-fee haircut: `ACCEPTED AS REGRESSION CRITERION`
- v0.2 conservation wording: `RED / MUST-FIX`
- broker/oracle settle-side authority retarget: `OPEN`
- production funds-path authorization: `NO`

## Safety boundary

This review does not authorize `.sil` deployment, address derivation for production funding, funding, settlement/refund, signer/broadcaster changes, key movement, production DB mutation, or any other production funds-path action.
