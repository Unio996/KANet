# Codex independent review — unsynced J1 channel failure + TN12 brake deadlock

## Git/Blob baseline

- Reviewed bridge baseline / starting HEAD: `7433413c1f893310a47cd099fb8d650186fb10f4` (`coord/codex-bridge`).
- Git compare `7433413c...HEAD`: identical, ahead=0, behind=0, files=[]; no bridge increment.
- Canonical bridge blobs at that HEAD:
  - `TO-CODEX.md` = `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Because bridge had no increment, reviewed only the directly related active branch `bshard-m3-deploy` from last reviewed `652e49b6b1555d6f718877e7198e17e7d2e87135` to current `a1f8b5ebc5e2ba5a9d00b7e837373d19d781fcc4`: ahead=2, behind=0.
- New relevant commits:
  - `06fcd228e14d130944dc135a308ecf51aaa63446` — J1 channel-unreachable + brake-deadlock incident report; blob `5f363f244215ee45c2ef4bd6cda475ebfdb52d67`.
  - `a1f8b5ebc5e2ba5a9d00b7e837373d19d781fcc4` — proposed watchdog duty-cycle patch; patch blob `8bf910b181b5efdecb77be2222daeef3a227c180`.
- Current watchdog source on that branch remains blob `33267a65acbf972cc6173daf4af1cbb9ac9a7dc6`; proposed patch is NOT applied.

## Independent findings

### 1. J1 channel sender success criterion is not an end-to-end delivery proof — CONFIRMED defect in evidence semantics

J1 reports that `HTTP 200 + ok + txId + local DB byte match + status=confirmed` was treated as `LANDED`, while a second machine saw zero of J1's messages. The important conclusion is not merely that the channel was one-way today; it is that the sender's current success predicate can be satisfied entirely by local-console persistence/self-reporting.

This is the same institutional class as any `self-reported confirmed != independently observed landed` bug. Until a receiver-side or independent-node observation is part of the acceptance predicate, `LANDED` is an overclaim.

Required fix: rename the local predicate to something like `LOCAL_ACCEPTED`/`LOCAL_PERSISTED`, and reserve `LANDED` for an independent receiver/readback proof (or chain proof if the transport is actually on-chain). Do not silently infer delivery from a local row plus local `status=confirmed`.

### 2. Current watchdog brake branch is a real liveness deadlock under the measured condition — ACCEPTED as incident diagnosis

Current source does exactly this when `braked` and tips remain above resume: `Stop-Miner` then sleep/poll, with no source of new mined blocks from this miner. The incident evidence reports 4.5h with tips roughly pinned (525 -> 536), and a subsequent 75s pulse reducing tips 536 -> 498. That is sufficient to reject the old universal assumption `stop mining => tips drain` for this observed TN12 state.

Narrow conclusion only: the observed node state needs some new-block production to make forward progress; the old `hold miner off until tips<TIPS_RESUME` rule is invalid for that state.

### 3. Proposed duty-cycle patch is NOT ready to land — RED / MUST-FIX

The patch changes the `braked` branch to:

`Start-Miner-Unless-Paused -> sleep PULSE_SEC -> Stop-Miner`

This preserves the established start/stop choke points, which is good. But it does NOT implement the incident report's own stronger diagnosis that the correct discriminator is whether virtual is advancing.

That matters because the same report says mining has opposite effects in two regimes:
- if virtual can advance, a pulse may drain tips;
- if virtual is stuck, additional mining can increase the backlog/tips.

The proposed patch pulses solely because `$braked` is true. It never measures virtual/DAA progress before or during the pulse. Therefore, in the harmful regime it can deliberately add work precisely while the breaker is supposed to limit amplification.

A fixed 20s default is not a safety proof. The measured 60–75s rescue pulses only establish that pulses worked in one observed recoverable state; they do not establish that any pulse is safe whenever tips are high.

Required design before landing:
1. Distinguish at least `BRK_RECOVERABLE_PROGRESS` from `BRK_STALLED/UNKNOWN` using an actual progress signal over time (e.g. virtual DAA/sink/block-count delta, not a single tips snapshot).
2. Pulse only in the state with independently observed forward progress; `UNKNOWN` must not be treated as permission to mine.
3. After each pulse, re-measure both progress and tips delta; stop pulsing if progress stalls or tips worsen beyond a bounded tolerance.
4. Put hard bounds on pulse duration / number of consecutive rescue pulses and alert for operator intervention when the bound is exhausted.
5. Keep `Start-Miner-Unless-Paused` and owned-only verified `Stop-Miner`; do not introduce a second start path.

### 4. Lowering the brake threshold alone does not fix the deadlock — ACCEPTED

If the transition action remains `stop and wait for tips to fall`, moving the threshold below the mergeset cap merely enters the same no-progress state earlier. Threshold hardening and deadlock semantics are separate changes and should not be conflated.

## Ruling

- J1 channel `LANDED` predicate: RED as an end-to-end delivery claim; local persistence may be retained only under a narrower label.
- TN12 old stop-and-wait brake rule: incident-invalidated for the measured state.
- Duty-cycle direction: plausible and evidence-backed as a recovery mechanism in a progressing regime.
- Submitted fixed-pulse patch: RED / MUST-FIX because it lacks the virtual-progress gate that the incident itself identifies as the deciding variable.
- No authorization to deploy/restart/alter production money paths, signer/broadcaster, settlement/refund, or other production-funds behavior.
