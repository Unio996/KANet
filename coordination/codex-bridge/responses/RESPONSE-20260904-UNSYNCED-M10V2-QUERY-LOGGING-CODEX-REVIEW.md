# Codex review — unsynced M10 v2 diagnostics / P1 gate

## Git/Blob baseline

- canonical branch HEAD checked first: `0260325bc00df7942891dcf1e420f57f4d843a55`
- last Codex processed/written commit: `0260325bc00df7942891dcf1e420f57f4d843a55`
- Git compare baseline...HEAD: `identical`, ahead 0 / behind 0 / total commits 0 / files `[]`
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no canonical increment, so I checked the directly related active branch only.

`bshard-m3-deploy` checkpoint `40abbfe9ac11bab13868fc0101ffa9d8325e188c` → current `29963ed37c60d8e018b74964474b0f1f8af4025e`: ahead 17 / behind 0 / 17 commits. This is a substantive runtime diff, not coordination-only: M10 v2 adds `diag-step.mjs`, changes the global HTTP observer, and wraps many console interval/subprocess sites. Source implementation commits include `ea3fc2f896128f23635e2c1388df757f0dfa6569` (M10 v2 patch 1) and `685b924362f57440d4a0e6c6364281086328d523` (patch 2). Current relevant blobs include `diag-step.mjs` = `e298ae83cc76d54584b116245dd2d6e41bcf1c41` and `http-big-response-observe.mjs` = `ed9c007115fef73f417fea6e9cf911d3aba08445`.

## Independent findings

### 1. M10 v2 HTTP query logging is a new security/observability leak surface — MUST FIX

`requestFields()` takes `request.url`, slices everything after `?`, truncates it to 48 characters, and emits it verbatim as `q=` in every `http.slow` / large-response diagnostic line.

That is not a safe default. Query strings are uncontrolled caller input and can contain bearer-like tokens, signed URLs, API keys, invitation/auth codes, wallet/transaction identifiers, user PII, or other values that should not be copied to persistent logs. Truncation is not redaction; the first 48 characters may contain the complete secret or its useful prefix.

**Ruling:**
- HTTP timing/route/method/status/size instrumentation: acceptable observe-only direction.
- raw `q=<query-string-prefix>` logging: **HOLD / MUST FIX**.
- preferred fix: do not log query values. If caller discrimination is needed, log a fixed allowlist of non-sensitive key *names* only, or an irreversible keyed/ephemeral correlation tag whose key is not persisted with the log. Never log Authorization/cookie material, and do not treat query strings as non-secret metadata.
- add a regression vector such as `?token=SECRET123&x=1` proving the emitted line contains neither `SECRET123` nor any raw query value.

This is especially important because M10 v2 is already live according to the active-branch evidence; existing logs produced since activation should be treated as potentially containing query-derived sensitive material and should not be copied into bridge evidence without sanitization.

### 2. `wrapTick` is operationally low-risk in the current setInterval use, but its “return value identity / pure passthrough” claim is technically too strong

`wrapTick()` returns `r.then(...)` for thenables. Therefore the wrapper returns a **new promise**, not the original promise object. Its `_isThenable()` probe also evaluates `.then`; an exotic thenable getter can itself throw where the unwrapped callback would merely return that object.

For the current patch-2 use sites this is mostly harmless because `setInterval` discards callback return values, and the wrapped closures generally return ordinary promises whose rejection has already been handled. So I do **not** see a money-path behavior regression from this alone.

But the helper contract/comments/tests should not claim universal byte-for-byte / identity-preserving return semantics. Accurate wording is: same synchronous scalar/object return for non-thenables; for thenables, same fulfillment value/rejection reason but different promise identity. Keep this helper restricted to return-value-ignored scheduling sites unless a caller-specific review proves identity is unobservable.

### 3. Current evidence does NOT satisfy the stated P1 downgrade trigger yet

The active HEAD commit subject says in effect “two clean windows still low and reads >=5k ⇒ branch 3 P1 GO”, but the actual ledger at the same HEAD says the opposite precondition state: post-reconnect compaction buckets are still `30/16/36/30` versus the clean-window requirement of returning to single digits, and explicitly records **“window not open”**. The J1 instruction file is also conditional and says not to act until an explicit `P1 GO` is written.

Therefore the commit subject must not be treated as authority-bearing evidence.

**Ruling:** P1 downgrade/restart remains **HOLD** until the documented clean-window gate is actually met and two non-overlapping comparable windows are recorded. No restart should be triggered from the current branch-head subject alone.

### 4. D-a throughput conclusion remains observational, not causal closure

The active evidence continues to show the valuable distinction already established: D-a reduced CPU / kernel / I/O overhead substantially, while post-switch block throughput has so far remained below the old baseline in contaminated windows. The subsequent pruning/compaction/reconnect sequence is heavily confounded. Do not re-label D-a as harmful or ineffective until the clean-window experiment is complete.

## Safety boundary

This review does **not** authorize or deploy a privileged kaspad restart, P1 downgrade, payout, settlement/refund, production signing/broadcast, DB money mutation, key movement, or any other production funds-path change.
