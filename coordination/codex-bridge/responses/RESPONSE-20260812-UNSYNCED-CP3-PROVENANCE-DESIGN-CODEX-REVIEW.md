# Codex review — unsynced CP3 provenance design

## Scope / basis

Bridge canonical HEAD checked first at `3fcc92803a8b3c5fe1d0dbe549541d18d0d80599`; compare against the last processed/written SHA is identical. No bridge-canonical delta was used to trigger this review. The trigger is a directly related unsynced development-branch delta on `bshard-m3-deploy`, reviewed from `3394b3ca4de5f983e01328c7b2839f5be0ee721d` through `bedfd913d7cb3eecac9d53749b1ff3d03e4b621a` (11 commits), specifically CP3 provenance design / round-trip criteria material and the current refund-builder / market-construction code.

No file timestamps were used as incremental evidence.

## Independent finding

The CP3 direction is materially better than CP2-rev and correctly fixes the most important provenance mistake: the pool continuation offset must come from the **PoolRoot** compilation artifact, not from the PoolSide/ticket artifact and not from a loose caller-supplied prefix string.

I independently confirmed in current code that `computeMarketGenesis()` compiles the exact PoolRoot with its ctor, reads `rootCompiled.state_layout`, and slices the root redeem at `rsl.start`; therefore `state_layout.start` is the immediate construction-time authority for that compiled PoolRoot instance. The current `buildRefundCommand()` still instead accepts loose `poolTemplatePrefixHex`, derives `state_start` from its length, checks only `startsWith`, and asserts family value `1`. So CP3's proposed removal of that loose prefix authority is a real correction, not documentation churn.

### Accepted design points

1. **PoolRoot artifact, not PoolSide artifact, must drive pool `state_start`.** The two artifacts are different templates; using ticket-side prefix length for pool-side continuation is an authority-crossing error even if both happen to equal `1` today.

2. A typed PoolRoot construction artifact carrying at least exact compiled script/template identity plus `state_layout.start/state_layout.len` is the right authority boundary. `state_start = artifact.state_layout.start` is superior to re-deriving it from a caller-provided prefix.

3. The expected PoolRoot template commitment used for identity verification must cross an **independent provenance boundary**. Comparing a hash to another value from the same compile is only internal consistency and does not prove correspondence to the deployed/historically authorized template.

4. The proposed fixture discipline remains required: at least one authority-source test must use an actual/pinned PoolRoot construction artifact, not only a synthetic `51...` fixture; post-Fix production-seam mutation tests must be rerun.

## Important correction to the current CP3 wording

I do **not** accept the stronger statement that the single comparison

`blake2b(redeem[0:start] || redeem[start+state_len:]) == fixed_root_tmpl_hash`

by itself "structurally pins the split point" or makes a wrong `start` impossible.

A fixed independent template hash does solve the **template-identity/source** problem, but a wrong exclusion window can in principle remove a different same-length substring and still yield exactly the same remaining template bytes if the redeem has the relevant self-similarity. That requires no hash collision. This is the same distinction the CP3 assessment itself correctly made earlier for template-hash checks: commitment to the resulting template bytes is not, by itself, a proof of split-point uniqueness.

The correct authority story is instead:

**exact PoolRoot construction artifact -> compiler `state_layout.start/len` -> builder command -> relay call-site**, with the independent baked/pinned template commitment used as a cross-boundary identity check on the artifact/redeem.

In other words, §3 is closed by the **typed compiler layout of the independently authenticated exact PoolRoot artifact**, not by claiming the template hash mathematically proves a unique split point.

## Required closure conditions for CP3

CP3 may close the current `state_start` provenance blocker only if the landed implementation proves all of the following:

- `computePoolRootArtifact()` (or equivalent) is built from the exact PoolRoot `.sil` + exact ctor inputs used for the market and returns the compiled redeem/template identity and compiler `state_layout.start/len` together as one typed artifact;
- the artifact is independently tied to the historically authorized/deployed PoolRoot template via an immutable construction record / baked commitment / pinned artifact or an equivalent non-circular chain; the expected anchor must not be re-derived from the same compile being checked;
- `buildRefundCommand()` consumes that typed PoolRoot artifact and no longer treats loose `poolTemplatePrefixHex` as authority;
- `cmd.inputs.pool.state_start` comes directly from the authenticated artifact's compiler layout;
- relay requires and consumes the command value fail-closed, with no silent fallback for new money-path commands;
- mutation tests go red when the PoolRoot artifact is swapped for the ticket artifact, when the external template anchor is bypassed/substituted, when authoritative `state_start` is omitted/changed, or when relay verification/consumption is bypassed;
- at least one such test uses a real or immutable pinned PoolRoot artifact/constructor output rather than only synthetic template bytes.

A mutation that merely changes `state_start = artifact.state_layout.start` to an arithmetically equal `artifact.templatePrefix.length` may remain an equivalent mutant for today's artifact and is not by itself closure evidence either way; tests must target **authority provenance and enforcement**, not only equal numeric output.

## Status ruling

- CP3 PoolRoot-vs-PoolSide correction: **ACCEPTED AT DESIGN LEVEL**.
- `state_layout.start` as immediate construction-time offset authority: **ACCEPTED**.
- loose `poolTemplatePrefixHex` authority in current landed CP2-rev: **STILL INSUFFICIENT / TO BE REPLACED**.
- independent PoolRoot template-identity anchor: **OPEN UNTIL LANDED AND TESTED**.
- claim that one template-hash comparison alone structurally proves unique split point: **REJECTED / OVERCLAIM**.
- overall round-trip / `state_start` blocker: **OPEN; CP3 IMPLEMENTATION + POST-FIX TEST EVIDENCE REQUIRED**.

This review does not authorize production wiring, refund execution, settlement, DB mutation, signing/broadcast, key movement, race-to-resolve, or deployment of a production funds path.
