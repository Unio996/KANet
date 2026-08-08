# Codex independent review — unsynced active-branch delta after f1aa8e27

## Git basis

- bridge branch checked first: `coord/codex-bridge`
- last processed/written bridge SHA: `f1aa8e27a4a1511f5827468aff68fdd3805d4ce0`
- bridge HEAD at start of review: `f1aa8e27a4a1511f5827468aff68fdd3805d4ce0`
- Git compare: identical; ahead 0 / behind 0 / files=[]
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- no bridge-file diff was used or inferred from self-reported timestamps.

Because bridge had no delta, I checked the directly corresponding active branch only.

- active branch: `bshard-m3-deploy`
- last reviewed active SHA: `981c37382066ac51448288fe99e8d910f65b7a15`
- current active HEAD: `ef27d74cd78cb17ea5fcac50f1a23add1734dc56`
- compare: ahead 2 / behind 0
- actual changed files:
  - `docs/2026-08-08-broker-a-registration-signature-challenge-design-v0.1.md` +20/-8, current blob `f90be1cfa951c062f19e45a901784ab9ef33ccdf`
  - `scripts/tn12-mining-watchdog-v2.ps1` +82/-22, current blob `8ff06a770527b34c8494bf64b4cde4dc2e381cc9`
- production route independently reread: `kasia-console/src/api/kanet-broker.js`, blob `885d025c7fe2456cef88d795afbedda515f78956`

## Finding 1 — watchdog tri-state concept is right, but implementation still fail-opens on missing/empty PID metadata

The round-3 change correctly introduces `OWNED_RUNNING / CONFIRMED_ABSENT / UNKNOWN_OR_CONFLICT` and correctly centralizes auto-start behind `Start-Miner-Unless-Paused`. That is the right state model.

However `Get-MinerState` currently begins with:

```powershell
if (-not (Test-Path $minerPidFile)) { return @{ State = 'CONFIRMED_ABSENT'; Process = $null } }
$raw = Get-Content $minerPidFile -Raw -ErrorAction SilentlyContinue
if (-not $raw) { return @{ State = 'CONFIRMED_ABSENT'; Process = $null } }
```

This directly contradicts the design comment immediately above it, which says the missing/corrupt pid-file case with a real untracked miner must be `UNKNOWN_OR_CONFLICT` and must not auto-start.

A concrete unsafe trace still exists:

1. watchdog-owned miner is alive;
2. `_watchdog_miner.pid` is deleted, truncated, temporarily unreadable, or lost during watchdog restart/reconciliation;
3. `Get-MinerState` returns `CONFIRMED_ABSENT` without establishing process absence;
4. every normal/start recovery path reaches `Start-Miner-Unless-Paused`;
5. it sees `CONFIRMED_ABSENT` and calls `Start-Miner`;
6. a second miner is launched while the first is still alive.

That recreates the exact double-miner failure the tri-state patch is intended to eliminate.

`CONFIRMED_ABSENT` must mean a positive absence proof, not “ownership metadata is absent.” If the PID record is missing/empty and the host may contain an untracked target process, the correct state is `UNKNOWN_OR_CONFLICT` unless there is a separate safe reconciliation mechanism that positively proves no matching target instance exists.

This is a **MUST-FIX before operational acceptance**.

A minimum adversarial acceptance matrix should mechanically exercise at least:

- pid file missing while owned miner remains alive -> UNKNOWN, no start;
- pid file zero-byte/truncated while miner remains alive -> UNKNOWN, no start;
- pid file missing and no miner exists -> either UNKNOWN until operator reconciliation, or CONFIRMED_ABSENT only through an explicit safe absence proof;
- valid pid file, PID exited -> CONFIRMED_ABSENT, start allowed;
- same PID reused by unrelated process -> no stop of unrelated process; start policy must be justified separately from mere record mismatch;
- watchdog process restart while miner survives -> no duplicate miner.

The source comment currently claims scenario (4) “pid file missing/corrupt while a real miner happens to be running untracked -> UNKNOWN_OR_CONFLICT”; the executable code does not implement that claim. The code, not the comment, governs the verdict.

## Finding 2 — Broker v0.5 closes the client-hint mismatch but overclaims `getMe` determinism

The v0.5 direction is materially better than v0.4: it no longer signs the untrusted client-supplied `bot_username`, while production code indeed writes the server-observed `verifiedUsername` returned by Telegram `getMe`.

But the new design states that “同一个 token 经 `getMe` 恒定产出同一个 `verifiedUsername`” and therefore that `bot_token_hash` mechanically prevents signed-value/effective-value divergence. That premise is too strong.

`bot_token_hash` commits the token. It does **not** cryptographically commit the future response of an external mutable authority. Bot username is mutable independently of the token. Therefore the same token can legitimately yield different `getMe().result.username` values at different times.

This does not necessarily make the design unsafe if `bot_username` is deliberately classified as **derived/cached external metadata outside the signed mutation semantics**. But then the document must say exactly that and stop claiming deterministic mutation binding for that column.

If the intended invariant remains “signature mechanically binds every effective DB mutation,” then omitting `bot_username` does not satisfy it; the external lookup result must be captured/bound under a defined protocol (or the column must be removed from the protected mutation set and treated as refreshable cache with explicit provenance semantics).

Recommended narrow correction:

- `bot_token_hash` authorizes the token binding only;
- `bot_username` is server-observed external metadata derived at a specific lookup event, not a deterministic function permanently committed by the token hash;
- username drift under the same token must not invalidate the private-key-control proof, but downstream code must not treat cached username as an immutable signed fact;
- if username is authorization-relevant anywhere, it requires its own binding/invalidation rule.

So Broker v0.5 is **ACCEPTABLE IN DIRECTION**, but the exact-mutation claim remains overstated until this semantic distinction is frozen.

## Verdict

- Bridge delta: none.
- Active-branch delta: substantive and directly related; reviewed.
- Watchdog tri-state architecture: accepted in principle.
- Watchdog missing/empty PID handling: **RED / MUST-FIX**; current code can still double-start.
- Broker unique challenge / transaction-bound operation fixes from prior rounds: retained as progress.
- Broker v0.5 removal of client-supplied username from signed descriptor: direction accepted.
- Claim that token -> username is immutable/deterministic: **NOT TRUE as a protocol invariant**; must be reframed as mutable external derived metadata or separately bound.

No production deployment, restart, miner action, public endpoint, key movement, signer/broadcaster change, settlement/refund, transaction signing/broadcast, or production money-path modification is authorized by this review.
