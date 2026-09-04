# Codex review — unsynced J2 session identity / READY wording

## Git/bridge verification

Canonical branch checked: `coord/codex-bridge`.

- prior processed/written-back commit: `0d1413388896c4dce4836e2b28fb4f6036b292bd`
- current canonical HEAD: `0d1413388896c4dce4836e2b28fb4f6036b292bd`
- Git compare: identical; ahead 0 / behind 0 / total commits 0 / changed files 0

Canonical blobs re-read from that exact HEAD:

- `coordination/codex-bridge/TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `coordination/codex-bridge/DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
- `coordination/codex-bridge/STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `coordination/codex-bridge/DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `coordination/codex-bridge/FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No timestamp field was used for increment detection.

## Active branch unsynced increment

Relevant active branch: `bshard-m3-deploy`.

- prior checked active-branch commit: `bc4d94b09d020aef726386be02a5a32fa4f189bd`
- current active-branch HEAD: `95906934aeb25b237234d82a0c2eb19ea11efc55`
- compare: ahead 1 / behind 0 / total commits 1
- actual diff: `docs/iteration/COORD-LEDGER.md` +5 / -0 only
- no runtime, guard, watchdog, restart, settlement, signing, broadcast, DB, or key-path implementation/test diff

The new ledger entry reports that Owner started a new J2 session, but the coordinator could not observe it in the local agent/process view and could not reach `J2` by SendMessage. It proposes a self-report handshake via SendMessage or `scratch/_bettor_inbox/`, and repeats a BOTH_READY gate before a T+0 read-only dispatch.

## Independent judgment

### 1. New J2 session identity is not yet verified

`Owner says a J2 session was started` is a coordination assertion, not an agent-identity proof. The same entry explicitly states that the new J2 session is not currently visible/reachable from the coordinator.

Therefore:

- new J2 session existence: **PLAUSIBLE / NOT YET INDEPENDENTLY VERIFIED**
- new J2 session identity/address: **OPEN**
- dispatch authority to that session before a successful identity handshake: **HOLD**

A self-report containing last known ledger block, READY wording, and a session address is useful liveness evidence, but it should be cross-checked against an independently observable session/address or an existing durable dispatch token before authority-bearing work is assigned. Multiple observers are acceptable; only one fail-closed dispatch writer should exist.

The proposed first-hour task is described as read-only and explicitly excludes money path/miner/watchdog changes. That boundary is acceptable, but only after the session identity/authority handoff itself is verified.

### 2. `~09-09 下界` is a wording regression and should not be propagated

The ledger again labels `READY ~09-09` as a lower bound. That remains unsupported by the measured model.

The most recent reviewed model treated ~09-09 as a conditional planning center derived from observed convergence plus assumptions about future phase count/cost. Convergence rate, future phase count, reconnect/header episodes, and lag measurement can all move the date earlier or later. The later 3.73h reconnect evidence further showed that an observed phase cost must be measured rather than mechanically copied from a previous episode.

So the allowed wording remains:

- `~09-09` = **conditional planning center / current estimate**
- `~09-08..09-11` = **working scenario range if the stated assumptions are retained**
- `~09-09 hard/lower bound` = **REJECTED / NOT ESTABLISHED**

BOTH_READY should continue to be determined from actual gate state plus current KANet-UI readiness observation, not from a forecast date.

### 3. No prior technical OPEN item is closed by this commit

This coordination-only increment supplies no new repository-level implementation or VA evidence for the previously open guard/watchdog/lifecycle items. In particular, stale-valid sample freshness, privileged kill-target positive identity, complete descendant-tree pre/post verification, replacement exact identity/revision/health-ready, repository-resolvable guard source/tests, persistent monotonic `everSynced` + discriminating VA, sampler taxonomy alignment, and durable monitor lifecycle remain OPEN/HOLD.

## Safety boundary

No production-funds-path modification, signing/broadcast, settlement/refund execution, DB mutation, key movement, privileged restart, or deployment is authorized by this review.
