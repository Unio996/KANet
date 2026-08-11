# Codex review — unsynced watchdog halted-state handling

- review_basis_bridge_head: `c4fa5811bee8e4ed419ade7d07b35c5718f0678b`
- review_basis_dev_commit: `267815a120874d2240ff92992e18687fbd7faf69`
- reviewed_dev_head: `f76842e5748ff5cdbb8a5e5ffc9cb67d484ba4a5`
- scope: `scripts/j1-watchdog-alive-probe.mjs`, `scripts/j1-watchdog-sentinel-once.sh`, `scripts/j1-watchdog-sentinel.test.sh`, commit diff/evidence for `f76842e...`

## Independent judgment

The new `PULSE BUDGET EXHAUSTED` classification is directionally correct: if that marker is observed, it must never receive the ordinary brake exemption. The probe now maps that marker to `BRAKE=halted`, and when `MINER != 1` the sentinel emits a dedicated operator-action alert rather than mislabelling the condition as a stale brake marker.

However the implementation does **not** satisfy the commit's stronger claim that halted is a terminal state that "always shouts". The check is nested under:

```sh
if [ "$MN" != "1" ]; then
  if [ "$BR" = "halted" ]; then
    ... alert ...
```

So `WD=1 MINER=1 HB=fresh BRAKE=halted` bypasses the halted branch entirely. The committed test suite explicitly codifies that behavior as healthy:

```sh
run "矿机在跑时 halted 不出声" "WD=1 MINER=1 HB=30000 BRAKE=halted BRKAGE=30" 0 ""
```

That is a state-machine contradiction. If `PULSE BUDGET EXHAUSTED` means the watchdog has entered a terminal/manual-intervention state, the terminal state itself is the alert authority; current miner process count must not erase it. A miner can be present because of an external/manual restart, stale process accounting, or any future watchdog behavior change while the watchdog remains halted. In all such cases the watchdog is no longer in normal autonomous supervision and the sentinel must not report healthy merely because `MINER=1` at the sampling instant.

### Ruling

- `PULSE BUDGET EXHAUSTED` recognition in the probe: **ACCEPTED IN CODE**.
- Dedicated halted wording when `MINER != 1`: **ACCEPTED IN CODE**.
- Claim that halted "always shouts": **REJECTED by the current control flow**.
- `BRAKE=halted + MINER=1 + fresh heartbeat` currently returning rc=0: **RED / MUST-FIX**.

Minimum closure: evaluate `BRAKE=halted` independently of the miner-count branch and fail loudly whenever it is present, then test at least `MINER=0`, `MINER=1`, and unexpected multi-miner counts with fresh and stale heartbeat. Heartbeat should still be checked independently, so a halted state plus stale heartbeat may produce the same nonzero outcome but must not become silent.

## Evidence-level note on the 1800-second episode bound

The commit message cites host source `tn12-mining-watchdog-v2.ps1` lines around 913/929/983 to establish one ENGAGED/RELEASED pair per episode and the `pulseHalted` terminal path. That file/source is not present in the reviewed GitHub tree and repository search did not surface it, so Codex cannot independently promote those host-source claims above committed/gathered evidence in this run. The new sentinel behavior can be judged from committed code; the underlying host lifecycle proof still needs a committed source excerpt/artifact or other immutable evidence if it is to close the source-of-truth question.

No production watchdog/miner deployment, restart, DB mutation, refund/settlement, signing/broadcast, key movement, or production funds-path modification is authorized by this review.
