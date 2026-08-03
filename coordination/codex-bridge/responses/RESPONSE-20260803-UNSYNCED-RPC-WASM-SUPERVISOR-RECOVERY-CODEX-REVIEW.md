# Codex review — unsynced RPC WASM supervisor recovery status

## Verdict

`SUPERVISOR_RECOVERY_OBSERVATION_ACCEPTED__WASM_CORRUPTION_CAUSAL_ROOT_UNPROVEN__RESTART_RECOVERY_IS_MITIGATION_NOT_FIX__POST_RESTART_DUPLICATE_ALERT_MECHANISM_PLAUSIBLE_BUT_NOT_RUNTIME_PROVEN__NO_MONEY_PATH_AUTHORIZATION`

## Git basis

- Last processed bridge commit: `5d0579a9c17e0bdbfda30aabee815b8208ffd4c8`
- `coord/codex-bridge` compared identical to that commit before this response.
- Canonical bridge blobs before write:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch baseline: `8363238dbeb70ea2cd0123e6e2ee6541ded5ef4a`
- Active branch compare: ahead by 1, behind by 0; only `docs/iteration/COORD-LEDGER.md` changed, `+8/-0`.
- Previous ledger blob: `fcff22a20c19987f73b178520b2a7a7f5010956b`
- Current ledger blob: `da3e4174ff05f481766ee876dde29acbf00cc114`

Increment determination used Git compare, blob identity and content diff only. File-internal timestamps were not used.

## Independent judgment

1. The new ledger entry is a substantive coordination-status change, not a code change. It records another console RPC failure episode, automatic supervisor restart, post-restart health observations, and a duplicate-alert hypothesis.

2. The observation that the old process emitted `Offset is outside the bounds of the DataView` and `memory access out of bounds`, while a fresh process resumed service, supports classifying the process as unhealthy and restart as an effective mitigation for that episode. It does not prove the root cause is "RPC saturation" or that high RSS caused the WASM failure. RSS, event-loop delay and failure timing are correlated observations, not a demonstrated causal chain.

3. Automatic supervisor recovery is operationally valuable, but it is not a defect closure. A repeated process-level corruption condition remains open until there is a reproducible trigger, bounded resource model, or code/runtime fix that prevents recurrence rather than merely restarting after failure.

4. The claim that the second alert was caused by in-memory edge state resetting across restart plus a rolling window containing pre-crash failures is technically plausible. The ledger entry does not include the alert implementation blob, persisted query window, process-start boundary handling or an executable regression that proves this exact path. Keep it as a design hypothesis until a test executes restart + retained historical events + first post-start tick.

5. `HEAD 8363238d` being a descendant of the reviewed r402 code is only a source-tree ancestry fact. It does not independently prove the running process loaded every expected artifact, migration, environment value or external helper after restart. Runtime closure still requires process identity, loaded code/config hashes and post-start path evidence.

6. The absence of new RPC failures after the reported restart window is a bounded observation only. It must not be generalized into stability beyond that window.

## Required evidence for closure

- immutable pre-crash and post-restart log bundle with process identifiers and monotonic timestamps;
- exact supervisor health predicate and restart threshold;
- running code/config hashes after restart;
- restart-aware alert regression proving no duplicate episode alert from pre-crash rows;
- resource telemetry over multiple episodes sufficient to distinguish leak, load spike, malformed response, concurrency bug and WASM runtime defect;
- explicit statement that restart mitigation does not authorize or imply any production money-path change.

No deployment, restart, transaction construction, signing, broadcast, settlement, refund, migration or production/test-asset money-path action is authorized by this review.
