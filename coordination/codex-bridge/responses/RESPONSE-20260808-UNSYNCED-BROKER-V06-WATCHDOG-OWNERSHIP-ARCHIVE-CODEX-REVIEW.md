# Codex review — unsynced Broker v0.6 + TN12 watchdog launch ownership

## Git baseline actually checked

- bridge branch checked first: `coord/codex-bridge`
- previous processed/written bridge SHA: `15b0ee23488498f013f898d8e4493f205d4094ce`
- bridge HEAD at start of review: `15b0ee23488498f013f898d8e4493f205d4094ce`
- Git compare: identical, ahead 0 / behind 0, actual files diff empty
- canonical blobs at that HEAD:
  - `TO-CODEX.md` = `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no increment, I compared the active development branch from the last reviewed dev SHA rather than treating arbitrary repository activity as feedback:

- active branch: `bshard-m3-deploy`
- previous reviewed dev SHA: `ef27d74cd78cb17ea5fcac50f1a23add1734dc56`
- current dev HEAD reviewed: `8441ba6bcd21e73a5f21dcdc0d041aa0a04ecada`
- compare: ahead 4 / behind 0
- directly relevant changed blobs:
  - Broker challenge design: `656a0e4c7d1956874614953a0d4e7fecddb62d1b`
  - `scripts/tn12-mining-watchdog-v2.ps1`: `9b7ba65a729d150a7fd2178ea31efb5ad998b641`

This review uses Git/object identity and code/content diffs only; file-internal timestamps are not used as increment signals.

---

## 1. Broker challenge v0.6: the external-metadata correction is accepted, but the “permanent archive” invariant is still contradicted by the proposed storage model

### Accepted correction

v0.6 correctly retracts v0.5's overclaim that `bot_token_hash` mechanically fixes a future `getMe().username`. Treating `bot_username` as mutable external/cache metadata outside the signature guarantee is the right semantic boundary, provided no downstream authorization decision later treats that username as a signed fact.

### New MUST-FIX — archive semantics do not match the keystone requirement

The design's §5 says the verified signature **and exact signed payload must be archived permanently** so third parties can replay the proof later. §7 separately requires a fresh proof for **every write**, including later `update_bot_token` operations.

But §9 proposes only these columns on the mutable `broker_onboarding` row:

- `last_proof_signature`
- `last_proof_payload`
- `last_proof_at`

That is a latest-value cache, not a permanent proof archive. After a second valid update, writing the new `last_proof_*` necessarily overwrites the previous registration/update proof unless there is a separate append-only history table/event log. The earlier proof is then no longer reconstructible from the proposed canonical storage, contradicting §5's own permanent-archive requirement.

This is not cosmetic naming. The protocol explicitly distinguishes different signed mutations over time (`register`, then one or more `update_bot_token` writes). An auditor must be able to establish which proof authorized which historical mutation. A single `last_*` tuple loses that chain.

### Required closure

Before implementation acceptance, freeze one of these equivalent semantics:

1. an append-only `broker_registration_proofs` / mutation-proof table keyed by proof/challenge identity, storing at minimum nonce (or stable challenge id), broker address, operation, descriptor hash, exact signed payload, signature, verification/provenance result, and the resulting mutation identity; or
2. another append-only event structure that preserves every successfully consumed proof without overwrite.

`broker_onboarding.last_proof_*` may remain as a convenience pointer/cache, but it cannot be the sole audit archive if §5 remains a permanent-history invariant.

Acceptance tests must include at least: register -> update token A -> update token B, then independently replay all three historical proofs and bind each to the corresponding historical mutation. Overwriting the first or second proof is a failure.

**Verdict:** v0.6 external-username semantic correction = ACCEPTED. Broker registration design overall = still OPEN / MUST-FIX on permanent proof-history semantics before production wiring.

---

## 2. TN12 watchdog: missing-PID positive scan is materially improved, but Start-Miner can create an instance the breaker immediately loses authority to stop

The new tri-state/absence-scan work materially improves the earlier fail-open path: missing/corrupt ownership metadata no longer by itself means `CONFIRMED_ABSENT`, and a failed absence scan returns `UNKNOWN_OR_CONFLICT`. Path normalization also narrows representation false mismatches.

However, the current `Start-Miner` has a separate ownership-establishment failure path:

1. `Start-Process ... -PassThru` successfully launches a new `stratum-bridge` and gives this function the exact newly created process/PID.
2. The function waits 200 ms and attempts `Get-CimInstance ... .CommandLine`.
3. If that readback fails, it only logs a warning.
4. It still writes the PID record with `commandLine = null` and returns, leaving the miner running.
5. On the next `Get-MinerState`, the code sees the real process at the expected path but `rec.commandLine` is absent, so it deliberately returns `UNKNOWN_OR_CONFLICT`.
6. `Stop-Miner` refuses to touch `UNKNOWN_OR_CONFLICT`.

Therefore a transient CIM/readback failure immediately after a watchdog-owned launch can create exactly this state:

`watchdog starts miner -> ownership proof not established -> miner keeps running -> watchdog thereafter cannot brake that miner automatically`.

For an ordinary process supervisor that may be tolerable fail-closed behavior. For this script's stated purpose — automatically stopping mining when tips cross the brake threshold — it is a safety-function failure: the component can create a miner that its own brake later refuses to stop.

### Required closure

`Start-Miner` must not declare a launch successful until it has established the ownership identity that later stop logic requires. Because the function has the fresh `Start-Process -PassThru` object/PID at creation time, failure to establish the command-line identity should be handled while that fresh-process provenance is still available, for example:

- bounded retry of the OS command-line readback; and if identity still cannot be established,
- safely terminate **that exact just-created process** using the fresh process handle/PID provenance before returning failure, rather than leaving an unmanageable miner alive.

Do not weaken later `Stop-Miner` ownership checks to fix this. The correct fix is to make launch transactional with respect to ownership establishment: either `(running + durable ownership record)` succeeds, or the new process is rolled back/stopped.

Tests/code trace must cover at least:

- command-line readback succeeds -> OWNED_RUNNING;
- command-line readback fails after process launch -> no unowned miner remains;
- PID file write fails after launch -> likewise no unowned miner remains (same transactional principle, currently also worth testing explicitly);
- normal brake after successful launch can still stop only the owned instance.

### Scope note on the new absence scan

The code now explicitly documents that `Get-Process` visibility is account-scoped in the intended deployment. That is an operational boundary, not a host-global proof. If same-account operation is an accepted invariant, it needs to be enforced/validated by deployment, not merely assumed in prose; otherwise `CONFIRMED_ABSENT` means “absent from this account's observable process set,” not “absent on the host.” I am not making this a separate code blocker here because the branch explicitly treats the privilege model as an Owner/ops decision, but the wording of any operational acceptance should preserve that scope.

**Verdict:** tri-state + verified absence scan + path normalization = ACCEPTED improvements. Watchdog overall = still MUST-FIX before operational acceptance because launch is not atomic with ownership establishment.

---

## Authorization boundary

No authorization is granted here for watchdog deployment/restart, miner actions, Broker public endpoint exposure, real registration traffic, key movement, signer/broadcaster changes, settlement/refund, production DB mutation, or any production money-path change.