# Codex ruling — `state_start` authoritative source / Fix arm

## Ruling

**Do not treat a single global `_POOL_STATE_START = 1` plus equality tests as the authoritative source required to close the Fix arm.** It is acceptable as an immediate deduplication / risk-reduction step, but it only proves **consistency**, not **correctness**. The repository's own implementation shows `state_start` is template-dependent: PoolRoot/PoolLeaf multi-entry layouts use `start=1`, while single-entry no-selector continuations can use `start=0`. A global value therefore cannot by itself authorize the offset for an arbitrary money-path command.

The minimum required closure is narrower than “build a universal descriptor framework now”: **machine-bind the offset to the exact covenant/template identity used by this money path.** For the current refund path, a minimal PoolRoot-specific descriptor/registry entry is sufficient if it binds at least the exact template/covenant identity (or an equally strong redeem/template commitment) to `state_start=1`, and the builder verifies/derives from that binding before emitting the command. This may later generalize into the full per-template descriptor system; that generalization is a follow-on, not a prerequisite to this cell.

A transitional exported `_POOL_STATE_START` may be reused as the value inside that PoolRoot binding, but it is **not itself the authority**. The authority is the machine-verifiable relation: `exact template identity -> state_start`.

## Independent code findings

1. J2's correction is accepted. At current `bshard-m3-deploy`, `unlockBshardClaim` reads `cmd.inputs.root.state_start ?? _POOL_STATE_START`, but the current claim/refund builders do not populate that field. Therefore the previous shared statement “claim propagates an authoritative state_start, refund does not” was wrong at the builder boundary; both currently fall back to the default value. Refund is worse only in that its production call site does not even read the command field.

2. The current `_POOL_STATE_START = 1` is documented next to PoolLeaf/PoolRoot layouts where `state_layout.start=1`. That makes `1` correct for the current PoolRoot refund path, but only because the path is known to be PoolRoot. The constant has no machine binding to that identity today.

3. `pool-refund-builder.mjs` still emits `inputs.pool` with `{outpointTxid, redeem_hex, current_state}` only. No `state_start` or template identity binding is carried into the command.

## B-1 / B-2 status

**B-2 is accepted as meaningful differential evidence.** It demonstrates that `start=0` vs `start=1` is observable in continuation derivation and therefore the default cannot be treated as semantically inert.

**The current B-1 artifact is accepted as production-seam sensitivity evidence:** it runs the real `unlockBshardRefund` path under hermetic RPC, reaches transaction construction, observes the continuation output before real broadcast, and kills explicit wrong-start mutations at the real call site.

However, B-1 must be rerun against the **post-Fix seam** before final closure. The current mutant starts from today's call site, which has no command-propagated `state_start`. After Fix, the decisive mutant must break the actual authority propagation/consumption path (for example, ignore or alter the builder-emitted PoolRoot-bound `cmd.inputs.pool.state_start`) and the designated test must fail for the expected continuation mismatch. Otherwise B-1 proves parameter sensitivity but not that the new authoritative source reaches production execution.

## Minimum Fix closure

For this cell, the Fix arm may close without building a universal descriptor architecture if all of the following are true:

- a machine-readable PoolRoot template/covenant identity is bound to `state_start=1` (not merely a free global literal);
- refund builder derives/looks up `state_start` through that exact identity and writes it into the command;
- builder fails closed if the exact template identity cannot produce a valid offset;
- `unlockBshardRefund` requires and explicitly consumes `cmd.inputs.pool.state_start` for newly generated money-path commands; missing/invalid values do not silently fall back to `_POOL_STATE_START`;
- the relay or an upstream command validator prevents a command from claiming an offset inconsistent with the bound PoolRoot identity;
- A uses the same production binding and exact historical continuation artifact, rather than a test literal;
- B-1 is rerun as a mutation-kill test of the **fixed** propagation seam;
- B-2 remains green for the intended `start=0/1` differential fixtures.

If the team instead only centralizes the three literals into one exported constant and tests that all sites equal it, classify that as **LITERAL-DIVERGENCE CLOSED / FIX-AUTHORITY OPEN**, not `CLOSED IN CODE/TEST` for this round-trip/state_start cell.

No production refund, settlement, DB mutation, signing/broadcast, key movement, deployment, or other production funds-path action is authorized by this ruling.