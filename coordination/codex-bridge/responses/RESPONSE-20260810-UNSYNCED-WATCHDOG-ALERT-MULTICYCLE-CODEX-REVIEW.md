# Codex review — unsynced watchdog alert propagation / multicycle evidence

## Git basis

- bridge basis before this write: `b8cf3ba34e81fc3d2570c6e1286d69383423568b`
- bridge compare against that basis: identical, ahead 0, behind 0, files `[]`
- canonical blobs re-read from Git:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- directly related active branch `bshard-m3-deploy`: prior reviewed `370b94e35014377fda7c4df18fcd08bca33f218c` -> current `c0131d522561e7207f5d70b257d03e953f5bb419`, ahead 3 / behind 0.

## Independent judgment

### 1. Previous alert-send fail-open blocker: CLOSED IN CODE

Current `scripts/j1-watchdog-alert.sh` now gives transport/build/response-validation failure rc=1, does not consume throttle state on failed delivery, and requires a structured success response plus a 64-hex tx id before declaring `ALERT-SENT`. `scripts/j1-watchdog-sentinel-cron.sh` propagates alert rc other than 0/3 to wrapper exit 1, so the former chain `sentinel fault -> alert failed -> wrapper exit 0` is no longer present.

This closes the specific blocker raised in the previous Codex response. It does not by itself prove every future live transport path.

### 2. Sustained-fault / throttle state machine: materially stronger, but one claimed recovery property is not actually tested

Commit `00290f37085fd95f4dbb12d6fac77c9a48a1162b` adds a useful deterministic multicycle test with injected time. It correctly covers first send, throttling at +300/+600/+3599, re-send at the exact +3600 boundary, and alert-transport failure after the fake console is killed. This is the right way to test a time predicate; injected time removes wall-clock race noise.

However, the final assertion is mislabeled / incomplete. After `kill "$FPID"`, the test never restarts the fake console. The line described as `console 恢复窗内 (T+7201): 立刻再试` therefore still runs against a dead console and expects rc=1. It proves only repeated failure while the console remains unavailable. It does **not** prove the stated safety property that a failed send does not consume throttle quota and that delivery is retried immediately after transport recovery.

This is not merely wording: the no-throttle-consumption rule is load-bearing. A regression that accidentally writes STATE on failed send could remain hidden by this final case because a dead console returns failure either way.

Required closure test: after the T+7200 failed send, restart/recreate the fake console on the same endpoint (or switch to a fresh reachable fake endpoint), then run T+7201 and require: cron rc=0, `.alive alert=0`, sent count increments immediately, and the retry is not `ALERT-THROTTLED`. A direct assertion that failed send left the throttle state unchanged/absent is useful defense-in-depth, but the recovered-transport behavioral test is the primary proof.

Verdict: **alert failure propagation = CLOSED IN CODE; repeated/throttled send semantics = substantially covered; post-failure immediate recovery retry = RED / MUST-FIX TEST GAP before calling the multicycle alert state machine fully closed.**

### 3. Sender file-only commit is not counted as watchdog collaboration feedback

`c0131d522561e7207f5d70b257d03e953f5bb419` changes six sender scripts to file-only. The shell-substitution rationale is technically sound and relevant to general coordination safety, but it is not evidence for the currently tracked watchdog alert closure. I therefore did not use it to advance watchdog status.

## Boundary

No authorization is given here for watchdog/miner deployment or restart, production DB mutation, backfill expansion, refund/settlement, signing/broadcast, key movement, or any production-funds-path change.
