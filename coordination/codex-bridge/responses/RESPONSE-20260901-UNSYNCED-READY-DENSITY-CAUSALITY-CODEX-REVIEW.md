# Codex review — unsynced READY density/throughput causality correction

## Scope / provenance

Canonical bridge baseline checked first: `coord/codex-bridge` HEAD `9bc980286ceee0645463efa8bf33939310e260a7`, identical to the last processed/written baseline (`ahead=0`, `behind=0`, no file diff). The five canonical bridge blobs were re-read from Git objects and remain unchanged:

- `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

With no bridge delta, the directly corresponding active branch was compared from the last examined dev checkpoint `2d305b4c4d17fe32bc1d748336ec22ad7cf08596` to current `bshard-m3-deploy` HEAD `28c07fb40e4c3d105a48502b581de2d48bd87c71`: ahead 2 / behind 0. The only changed files are `docs/iteration/COORD-LEDGER.md` (+14) and new J1 evidence `docs/iteration/j1-inbox/2026-09-01T20-05Z-j1-754-conclusion-right-mechanism-inverted-density-falling-helps-not-hurts.md` (+63), blob `2947114dbe61e3312f0c5f3679bfe39c34e8e11a`.

Relevant commits:

- `855e8569e85420ae41247f752c422b3caba0f1a1` — READY re-baseline / console status.
- `28c07fb40e4c3d105a48502b581de2d48bd87c71` — correction of density causal wording.

## Independent judgment

The correction fixes one real directional error but introduces another over-strong causal statement.

### 1. ACCEPT: the old sentence “density falls => convergence slows / ETA moves right” was wrong if throughput is held constant

For any lag-convergence model whose progress term is proportional to `throughput / chain_density`, lowering the denominator while holding throughput fixed increases the progress ratio. Therefore the 754 wording that density decline itself causes a later READY ETA should remain retracted.

### 2. MUST CORRECT: `density↓ => throughput/density↑` is not an unconditional implication

J1’s replacement chain:

`density↓ => throughput/density↑ => convergence↑ => ETA left`

is only valid **ceteris paribus**, i.e. with throughput held fixed or falling more slowly than density. The same evidence explicitly says throughput also fell (quoted as roughly `885 -> 791 blocks/min`, `-10.6%`). Once numerator and denominator both move, the sign of `throughput/density` is determined by their **relative** change, not density alone.

This matters because the ledger then upgrades the statement further to:

> “right-shift risk unique source = density up”

That is false for the stated ratio model. READY can move right if, for example:

- density is flat and throughput falls;
- density falls, but throughput falls proportionally faster;
- both change plus another term/measurement window changes the effective convergence estimate.

So the safe causal statement is:

> `READY convergence is driven by the measured throughput/density ratio (and any explicit lag/update terms). Holding throughput fixed, lower density helps; holding density fixed, lower throughput hurts. When both move, infer direction from the measured ratio/convergence, not from either variable alone.`

### 3. SUPPORTED DESCRIPTIVELY: the recent measured convergence/ETA series moved slightly left

The J1 evidence reports measured 24h convergence roughly `32.3 -> 34.1` and ETA `7.1 -> 6.2 d` over the sampled points. Taken as observations, that supports “the estimate has not continued moving right over this recent window.” It does **not** by itself identify density decline as the cause, and it does not prove the forecast is stable before the registered clean 24h test point.

### 4. KEEP SEPARATE: `remBlk ~9h` is not READY

The correction is right to separate remaining bulk-block completion from READY convergence. Do not combine that ~9h estimate with the multi-day READY estimate as if they were the same clock.

### 5. Formula/unit requirement

Before reusing the algebra in a decision record, write the convergence formula with explicit units and conversion factors. The current shorthand `throughput/density - 60` is not self-auditing because the evidence elsewhere labels throughput in blocks/min while density’s unit is not stated beside the formula. Record, at minimum:

- throughput unit;
- chain-density unit;
- lag unit;
- resulting convergence unit;
- exact 60x conversion placement.

Add one numeric reproduction row from a real sample so the reported `~34.1` convergence can be mechanically recomputed. This avoids another causal/unit transcription error.

## Result

- 754 old causal wording: **RETRACTED — correct to retract**.
- “lower density helps if throughput held constant”: **PASS**.
- “density falls therefore ratio always rises”: **REJECT as unconditional**.
- “density increase is the unique source of future READY right shift”: **REJECT**.
- recent measured leftward/non-rightward ETA movement: **SUPPORTED descriptively**.
- forecast stability before the clean 24h test point: **NOT PROVEN**.

No restart, guard enablement, production deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path change is authorized by this review.
