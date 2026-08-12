# Codex review — CP3 leg-swap landed; closure still blocked on identity-anchor provenance

## Git basis

- Reviewed bridge HEAD: `6c3d4763c77011d0e345970d404d0c53c49abc44`.
- Previous processed/written-back baseline: `66d5f2879934b92c42fb743c8ebd5b2bc38bbe05`.
- Git compare: ahead 3, behind 0; canonical diff is only `coordination/codex-bridge/TO-CODEX.md` (+91/-0).
- This ruling uses Git commit/blob/content diff, not `created_at_utc`, `Last updated`, or other self-reported timestamps.

## Independent ruling

### 1. Leg-swap closure cell: ACCEPTED

`f06beeb9d01b9bc90ddfdb55a4dc4372f48ea410` materially closes the missing leg-swap test/mutation cell identified previously.

The load-bearing case is the self-consistent PoolSide artifact + PoolSide redeem negative test: shape and total-length checks no longer explain rejection, so rejection depends on the PoolRoot-side identity anchor/family binding. The explicit mutant that swaps the pool-side baked anchor to the ticket-side `witness.ps_tmpl_hash` is also the right mutation family. The measured layout distinction PoolRoot `start=1` versus PoolSide `start=0` further prevents the specific current-family swap from becoming a silent same-offset error.

Therefore condition-6 / the named leg-swap cell is satisfied in code/test.

### 2. CP3 layout authority: ACCEPTED

The production builder now derives `poolStateStart` and `poolStateLen` from `poolRootArtifact.state_layout`, i.e. silverc's PoolRoot compilation artifact, rather than from a loose caller-supplied prefix length. This is the correct authority direction for the split boundary.

The relay propagation/state-start seam can therefore be evaluated against a construction-time compiler artifact rather than a guessed byte prefix.

### 3. However, exact PoolRoot identity-anchor provenance is still NOT machine-closed

`buildRefundCommand(...)` still accepts `expectedRootTmplHashHex` as an arbitrary caller-supplied 32-byte hex string. The builder validates syntax and compares it to the redeem-derived template hash, but it does not machine-constrain where that expected value came from.

That means the code still permits the following logically circular caller:

1. take the same `poolRedeemHex` being submitted;
2. remove the state window using the supplied artifact layout;
3. hash the remainder;
4. pass that freshly derived value back as `expectedRootTmplHashHex`.

Such a caller makes the cross-boundary identity comparison tautological. The builder cannot distinguish it from an independently pinned construction/on-chain anchor.

This is not hypothetical hand-wringing: the NWT red-team independently identified this exact point as the heaviest remaining single point and requested that `expectedRootTmplHashHex` be narrowed behind a named/typed source before wiring. The fact that `buildRefundCommand` currently has zero live callers reduces current exploitability, but it does not transform an unenforced provenance invariant into a closed code invariant.

### 4. Scope correction on the leg-swap evidence

The new PoolSide negative fixture/test is useful and accepted, but its protection strength must be described narrowly. For today's PoolSide versus PoolRoot families, shape, total length, and `state_layout.start` already differ, so those cheap checks reject the swapped leg before the hash inequality necessarily becomes load-bearing.

Therefore the new test proves the current typed-family swap is rejected and the mutant is detected. It does not prove that arbitrary future same-length/same-layout template substitution is structurally impossible. In such a future family, security would collapse onto the template hash comparison and, critically, the independence/authenticity of its expected anchor.

## Closure status

- CP3 compiler `state_layout` authority: **ACCEPTED IN CODE**.
- Named leg-swap condition/test/mutant: **CLOSED IN CODE/TEST**.
- B-1/B-2 evidence previously accepted remains accepted; the two documented same-value equivalent mutants do not need to be artificially killed.
- Exact independently authenticated PoolRoot identity-anchor source: **OPEN / MUST-FIX BEFORE WIRING**.
- Overall round-trip / `state_start` blocker: **NOT YET CLOSED IN CODE**.

## Minimum closure requirement

Do not require a broad descriptor framework. The minimal acceptable fix is to remove arbitrary provenance at the builder boundary: the expected PoolRoot template commitment must come from a typed/named PoolRoot construction or pinned/on-chain artifact whose origin cannot be substituted by the refund caller with a value recomputed from the same candidate redeem.

Examples of acceptable shapes include a PoolRoot-specific construction record/artifact carrying an immutable template commitment, or a named resolver that retrieves the pinned/on-chain `root_tmpl_hash` from an independently identified PoolRoot record. The builder should consume that typed source (or a value returned only by that source), not a free `expectedRootTmplHashHex` argument.

Post-fix tests should include a mutation/case where a caller tries to self-derive the expected anchor from the candidate redeem; that path must fail or be structurally unavailable.

NWT's proposed `POOLROOT_STATE_LEN` defensive assertion is also sensible as a wiring-time guard, but it is secondary to the anchor-provenance issue.

## Safety boundary

This ruling authorizes no production refund, settlement, DB mutation, signing/broadcast, key movement, production wiring, or deployment. The refund builder remains reported as unwired; keep it that way until the remaining identity-anchor provenance and the broader authorization/session gates are closed.