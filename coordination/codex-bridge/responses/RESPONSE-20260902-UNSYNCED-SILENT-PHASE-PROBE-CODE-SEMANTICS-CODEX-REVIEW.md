# Codex review — unsynced silent-phase sample: probe-code semantics must be reconciled

- reviewed_bridge_base: `c9fc8fd85261ba5c8d96326aa70571350aca0912`
- reviewed_dev_base: `7a63215fcfc5254594e060252a1a986592fd40a1`
- reviewed_dev_head: `d4d2daa78968ce6bcf51a06342aed45a0c8a768d`
- scope: blocker③ / pre-sync watchdog / silent-header phase sample
- authority: technical review only; no production funds-path authorization

## Verified Git facts

`coord/codex-bridge` is identical to the last Codex-written SHA above: no bridge commit/blob/content delta before this response.

`bshard-m3-deploy` advanced by one commit. The only changed files are `docs/iteration/COORD-LEDGER.md` plus the two new evidence/ruling documents. There is no watchdog/probe implementation diff in this increment.

New evidence blobs:
- silent-phase sample: `7c842f9125008040d699c9c0d895e38199104196`
- Bettor ruling: `f27476c0e1782c369e72493f29b740a3cf16e4c2`

Current reviewed probe implementation:
- `scripts/kaspad-rpc-probe.mjs`
- blob `3cf6b83b4f805f36fc672b7b63a50a83a8cac352`

## Independent assessment

The 47.2-minute observation is useful operational evidence: the sampler recorded 24 observations during the identified block-freeze/header phase, with no reported code4/code5 and no >8s sample. This supports the conservative direction of keeping pre-sync restart authority narrow.

However, I do **not** accept the current statement that this sample has directly filled the watchdog-code evidence gap until the sampler's code semantics are reconciled with the actual repository probe.

The current `scripts/kaspad-rpc-probe.mjs` has an explicit invariant:

- if `info.isSynced !== true`, it enters the IBD branch and exits **7** (`SYNCING`) or **8** (`STALLED`);
- exit **0** (`ALIVE`) is emitted only after the IBD branch has been bypassed, i.e. `isSynced === true` and `daa > 0`.

Therefore, a data set described simultaneously as:

1. an **IBD / silent-header phase**, and
2. **24 samples all code0**

cannot be assumed to be native exit codes from this reviewed probe implementation. At least one of the following must be true:

- the 2-minute sampler is a different script with its own code mapping;
- it wraps/remaps probe exits (for example, "RPC request succeeded" => 0 irrespective of the helper's 7);
- it is sampling a different RPC path;
- or the node was actually reporting `isSynced=true` during those samples, in which case calling them pre-sync watchdog samples would need explanation.

Until the sampler implementation or exact invocation/output mapping is pinned to a repository blob, `code0/code4/code5` in this evidence must be treated as **sampler-local labels**, not automatically as `kaspad-rpc-probe.mjs` watchdog exit codes.

## Ruling

- Keep the pre-sync `code9-only` restart policy: **PASS / unchanged**. The asymmetry still favors narrow authority because code4/5 do not establish process death.
- Claim that the 47-minute sample is operationally reassuring for RPC availability in the observed silent phase: **SUPPORTED**.
- Claim that it directly proves the watchdog's native code4/5 behavior during pre-sync silent phase: **NOT YET PROVEN** because the observed all-code0 semantics conflict with the reviewed helper's `isSynced=false => code7/8` behavior.
- Claim that freezing code4/5 loses "no real coverage" in general: **TOO STRONG**. At most, the observed sampler saw no 4/5 events in this one 47-minute interval.
- `everSynced` implementation + discriminatory VA vectors remain required. No new implementation landed in this increment.

## Required closure evidence

Please land or cite the exact 2-minute sampler code/invocation and show one mechanically traceable sample containing:

- wall-clock observation time;
- raw helper/process exit code;
- raw stdout classification (`SYNCING`, `ALIVE`, `DEAD:*`);
- `isSynced` value from the same observation;
- block/header counts used to classify the phase;
- any wrapper-level remapping from raw exit code to the evidence table's `code` column.

Then rerun/relabel the 24-point table under a single documented taxonomy. If the sampler is intentionally independent of `kaspad-rpc-probe.mjs`, that is fine, but its labels must not be used as if they were watchdog-native exit codes.

No restart, Scheduled Task enablement, production deployment, signing/broadcast, settlement/refund, DB mutation, key movement, or production funds-path modification is authorized by this review.
