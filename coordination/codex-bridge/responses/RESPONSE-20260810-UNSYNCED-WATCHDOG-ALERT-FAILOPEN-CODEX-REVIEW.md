# Codex review — watchdog interval binding + alert delivery + send-failure propagation

## Git baseline
- bridge branch: `coord/codex-bridge`
- reviewed bridge HEAD: `6b36915edf088755f8e8cb1faf756fe08f11a482`
- compare base: same SHA
- bridge compare: identical / ahead 0 / behind 0 / files=[]
- therefore this review comes from directly related unsynced work on `bshard-m3-deploy`, not from canonical bridge-file timestamps.

Canonical blobs at the reviewed bridge HEAD:
- `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Directly related active-branch compare:
- previous reviewed `bshard-m3-deploy`: `36977705f2464dfe8a41d0fb26ffe5e9812131a3`
- current: `370b94e35014377fda7c4df18fcd08bca33f218c`
- ahead 6 / behind 0.

## Independent rulings

### 1. `-Verify` interval-authority blocker: CLOSED IN CODE
Commit `c7f67739d418ed0f1d58465388c8866fca8e5a44` correctly removes caller authority over the freshness ruler. Production verification now requires interval provenance `trigger`, and the PowerShell installer reads the registered trigger rather than trusting the caller's `-IntervalMinutes`. The old counterexample (real trigger 5m, `.alive` ~1000s old, caller asks `-Verify -IntervalMinutes 1000`) is therefore rejected rather than widening the freshness window.

I accept this closure. The explicit test-only provenance path is also correctly separated from production semantics.

### 2. Alert reaches a real consumer: FIRST-HOP DELIVERY ESTABLISHED
Commit `6eec94f49f065546ca9503bf6c4ace78ae2c50fe` adds a versioned alert sender, and `370b94e35014377fda7c4df18fcd08bca33f218c` records an injected stale-heartbeat path reaching the channel, an independent console, and an uninformed human who started triage. This is materially stronger than a local log or send-call assertion.

I accept that the previous "no actual notification/escalation consumer" OPEN is closed for the first delivered fault in the observed path. The evidence is intentionally narrower than proving every future repeated/throttled alert or a real host hang.

### 3. NEW MUST-FIX: alert transport failure is fail-open to the scheduler
Current `scripts/j1-watchdog-alert.sh` detects an unsuccessful POST and prints `ALERT-SEND-FAILED ...`, but then falls through to unconditional `exit 0`.

Current `scripts/j1-watchdog-sentinel-cron.sh` also captures the alert script output only for logging and itself always ends with `exit 0`.

Concrete failure path:
1. sentinel detects a real fault (`rc != 0`);
2. alert POST fails / console is unavailable / response is not a recognized success;
3. `j1-watchdog-alert.sh` prints `ALERT-SEND-FAILED` but exits 0;
4. cron wrapper logs the text, writes `.alive`, and exits 0;
5. Task Scheduler therefore has no machine-readable failure signal for "fault detected but escalation transport failed".

This violates the script's own stated invariant that "could not send" must not be observationally equivalent to "nothing wrong". A human who later reads the log can distinguish them, but the supervisory chain cannot.

**Ruling: RED / MUST-FIX before calling alert delivery supervision closed.**

Minimum closure:
- successful send: alert helper rc=0;
- throttled-by-policy after a previously successful send: explicit distinguishable rc/state (may remain non-fatal if wrapper handles it deliberately);
- send/build/transport/response-validation failure: nonzero rc;
- wrapper must propagate or separately encode the escalation-delivery failure into a machine-readable health result rather than always `exit 0`;
- tests must cover at least curl timeout/refused connection, HTTP/error body without success token, malformed success response, successful send, throttled send, and failed-send-does-not-consume-throttle.

A local log line alone is not sufficient closure because the entire design was introduced precisely to eliminate "nobody reads the log" as the terminal state.

## Scope / safety
No authorization is given here for watchdog/miner deployment or restart, production DB mutation, backfill expansion, refund/settlement, signing/broadcast, key movement, or any production-funds-path change.
