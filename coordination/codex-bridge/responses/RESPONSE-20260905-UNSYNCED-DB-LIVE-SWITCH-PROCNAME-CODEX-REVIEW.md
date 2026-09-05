# Codex review — unsynced D-b live switch / process-name coupling

## Git/bridge basis

- canonical bridge start/head checked: `d714e82b71a37097954e5de9d88ccd3e73108708`
- previous processed/written basis: `d714e82b71a37097954e5de9d88ccd3e73108708`
- canonical compare: identical; no bridge commit/content delta before this response
- five canonical bridge blobs remain unchanged from the prior verified basis:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no delta, so I checked the active related branch. `bshard-m3-deploy` advanced from prior checkpoint `1bc72477d0d6edd5b2fcba795a660093f7bc6228` to `1dde1e7e3790efd70dacfa6a09ac8068c0583b29`: ahead 3 / behind 0. The relevant commits are `edf20ef6c603ac7db3c09975e02e0a8779896c51`, `0d698d6ba6be25da86418d38e46c3343cc23802b`, and `1dde1e7e3790efd70dacfa6a09ac8068c0583b29`.

## Independent code/state judgment

### 1. D-b is now a live fact, not a Codex authorization

The branch records an Owner-authorized live switch to the D-b executable and then a second restart after the first deployment filename changed the Windows process name. I record that as an observed operational state change. It does not retroactively turn the earlier Codex HOLD on privileged live deployment into an approval.

The final recorded live path is `D:\kaspad-live\db-4d0a9e30\kaspad.exe`, with D-a rollback at `D:\kaspad-live\da-1b3046fb\kaspad.exe`; the watchdog task is reported Disabled during the switch.

### 2. The extra restart exposed a real executable-name / liveness-identity coupling bug

The first D-b copy was named `kaspad-db-4d0a9e30.exe`. That changed the Windows process image name, so `Get-Process kaspad` and the watchdog's process gate no longer matched it. The current watchdog source confirms the coupling is structural: production `$procName` is hard-coded to `'kaspad.exe'`, and `Invoke-WatchdogTick` queries `Win32_Process -Filter "Name='$procName'"`.

This means the incident was not merely an operator typo. The deployment identity model currently assumes a fixed image filename. The move to versioned *directories* while preserving `kaspad.exe` is a valid immediate mitigation, but it is still a convention-based invariant.

Recommended hardening: derive the production process image name from the configured executable path rather than maintaining a second hard-coded identity. For example, derive the leaf filename from `$kaspadExe` and use that same value for the CIM process gate. This removes one duplicated configuration source. Keep TESTMODE overrides isolated exactly as today.

The stronger long-term identity check should still be path/hash-aware for deployment provenance; process name alone only proves that some `kaspad.exe` exists, not that it is the intended reviewed binary.

### 3. Watchdog executable-integrity binding is still open

The current source points to the versioned-directory D-b path, which is better than a mutable build-tree target. However, the expected SHA-256 remains a comment, not a startup precondition. The watchdog still does not fail closed if the file at that path is replaced while retaining the same filename/path.

So the prior finding remains OPEN: before the watchdog is re-enabled as an autonomous launcher, bind executable identity in executable logic (full SHA-256 or an equivalent immutable deployment mechanism), not only in comments/coordination prose.

### 4. D-b performance/correctness verdict is not yet earned by the switch itself

The switch commit explicitly says it is waiting for the planned §4 body-phase comparison and watches for `IncomingRouteCapacityReached`, `syncee inconsistency`, and expected-block mismatches. That is the correct boundary. A successful start/listen/IBD negotiation is not evidence that depth=2 improves throughput or preserves ordering under live load.

Required evidence before promoting D-b from experiment to accepted operating configuration remains:

- same-phase body-window comparison against the pre-switch baseline;
- no response-order/hash mismatch or route-capacity/timeout regressions;
- peer/session conditions recorded so a rate change is not misattributed;
- rollback if the planned inter-batch spacing/throughput criterion is not met or correctness signals fire.

The extra restart also contaminates the immediate post-switch window; do not use startup/header renegotiation time as a throughput comparison window.

## Safety boundary

No production payout, settlement/refund, signing/broadcast, DB money mutation, key movement, or other production funds-path change is authorized by this review. No additional privileged restart is authorized here. This response records and reviews changes that already occurred and defines evidence still required for D-b acceptance.
