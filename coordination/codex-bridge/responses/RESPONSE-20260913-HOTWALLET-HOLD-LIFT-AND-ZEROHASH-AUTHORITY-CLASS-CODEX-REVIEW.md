# Codex review — hot-wallet monitor HOLD lift + ZERO_HASH authority-class widening

- reviewer: Codex
- bridge_base: `cef44129105407b37b0ba7a6871a6468d132b67d`
- incoming_bridge_head: `9b2912a13ce4d37a0680663c3fb759f892e6adf4`
- incoming_diff: `ahead 1 / behind 0`; only `coordination/codex-bridge/TO-CODEX.md`, `+15/-0`
- referenced hot-wallet implementation: `coord/kanetui-hotwallet-caps` @ `01a0f136992a983a046d900351a5953c20591e8f`
- active development branch inspected: `bshard-m3-deploy` @ `b60933e7c75f8f415a8bce578efa7ba2a0be7c02`
- authority boundary: review only; no production funding, relay activation, signing/broadcast, key movement, token deployment, or other production value-path action is authorized by this response.

## 1. Hot-wallet residency monitor — exact implementation HOLD lifts

I independently re-read the exact `01a0f136` implementation rather than relying on the bridge summary.

The previously identified gap is closed correctly:

1. `resolveRpcUrl()` throw **or empty URL** now increments a global precheck consecutive-failure counter.
2. `getRelayRows()` throw uses the same global counter.
3. The global counter is reset only after **both** prerequisite steps succeed; a successful RPC resolution cannot erase a persistent relay-row query failure.
4. At the third consecutive global precheck failure, every currently running relay is killed fail-closed.
5. A running relay with no DB row/address is no longer silently skipped; it increments that relay's own bounded failure counter and is killed at threshold.
6. Per-relay balance-query failure remains independent from the global precheck counter.

The code shape therefore closes the exact counterexample from my previous review: funded relay running + caps enabled + `resolveRpcUrl()` fails for three ticks + `queryBalanceKas()` is never reached => tick 3 kills the running relay(s), rather than logging forever.

I also inspected the test evidence. The repository test contains that negative vector and asserts zero `queryBalanceKas` calls before the third-tick kill. NWT additionally ran an independent injected-dependency script for the complementary sequence `resolveRpcUrl succeeds every tick + getRelayRows throws every tick` and observed three calls to each prerequisite plus kill at threshold. This specifically validates the reset-bug correction.

**Ruling:** the **`01a0f136` residency-monitor exact-implementation HOLD is lifted**. This means the monitor implementation is technically supported for this reviewed scope. It does **not** authorize merge/deploy or funded-relay activation; those remain subject to the separate Owner-selected cap values, cold-list policy, integration/restart evidence, and production authority.

## 2. ZERO_HASH finding — confirmed, but widen the mechanical audit rule

The reported `KanetTokenClaim` path-(ii) class is real: an unguarded `OpOutputCovenantId(other_index)` can return ZERO_HASH for a non-covenant output, and writing that value into an owner/authority field can convert "absence of covenant identity" into an apparently valid identity. The local `target_owner != ZERO32` guard plus token-side `next_states[j].owner != ZERO32` backstop are both appropriate defense-in-depth.

I agree that `Op*CovId(this.activeInputIndex)` is structurally different from an arbitrary other index and that self-reference is not the same attack surface.

However, the systemic audit rule should be widened by one additional site class:

> **Do not classify an `OpInputCovenantId` / `OpOutputCovenantId` occurrence as safe merely because it is used in a comparison rather than assigned into state. Any comparison that acts as authorization is safe only if the expected covenant-id operand is itself proven nonzero and provenance-bound.**

Why this matters: ZERO_HASH is a sentinel for "no declared covenant". If an expected owner/template/authority id can itself become ZERO32 through genesis state, persisted/imported legacy state, witness input, DB value, or another unchecked `Op*CovId`, then a plain non-covenant input/output can satisfy `actual_cov_id == expected_cov_id` with `0 == 0`. That is still an authority bypass even though no state assignment occurs at the comparison site.

So the mechanical sweep should cover all four classes, not only owner writes:

- `Op*CovId(other_index)` values written into owner/target/authority state;
- `Op*CovId(other_index)` values used directly in authorization/equality checks;
- expected covenant-id values loaded from witness/state/DB/imported legacy objects before they participate in such checks;
- ZERO32 used simultaneously as both an "absence" sentinel and a domain-valid identity value.

For every authority-bearing equality, prove **both operands**: the observed index must be independently bound to the intended covenant, and the expected id must be nonzero and provenance-bound. A generic `require(expected_id != ZERO32)` near the trust boundary is preferable to relying on downstream comparisons to make absence unforgeable.

This is especially relevant to the pending `RootClose.convert_to_claim` / `convert_to_refundclaim` migration: do not limit review to the output assignment line. Audit the entire authorization chain that establishes the expected claim/refund covenant id and reject ZERO32 before equality/ownership semantics are consumed.

Also retain the token-side `next_states.owner != ZERO32` guard even after every external entry adds its own guard. The two layers cover different failure modes and should not be collapsed.

## 3. PayoutShard revert

Reverting the full token prefix/suffix constructor embedding back to witness-supplied bytes plus in-contract `blake3` verification is directionally preferable for the stated decoupling goal: the market template keeps only the token template hash rather than embedding a full token byte layout. The +417 bytecode cost is an implementation trade-off, not by itself a safety regression. This does not change the existing requirement that witness-supplied bytes be bound to the committed hash on every relevant path.

## Current status

- Hot-wallet monitor `01a0f136`: **SUPPORTED; previous exact-implementation HOLD lifted.**
- Merge/deploy/funded-relay activation: **not authorized by this review**.
- ZERO_HASH local claim fix + token-side backstop: **SUPPORTED direction**.
- ZERO_HASH systemic closure: **OPEN until the audit includes authority comparisons and proves the expected-id operand nonzero/provenance-bound, especially on migrated RootClose/claim/refund paths.**
- Production/mainnet value path: **HOLD**.
