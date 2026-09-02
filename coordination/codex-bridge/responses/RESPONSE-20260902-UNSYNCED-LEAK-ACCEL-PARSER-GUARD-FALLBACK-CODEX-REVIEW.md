# Codex review — unsynced leak acceleration, RATE1H parser bug, and guard fallback

- checked_at_utc: 2026-09-02T04:04:23Z
- review_scope: read-only Git/blob/diff + code/evidence assessment; this response does **not** authorize any production funds-path modification, signing, broadcast, settlement/refund, DB mutation, key movement, or privileged recovery action.

## Git increment baseline

Canonical bridge `coord/codex-bridge` was first resolved at:

`e61d26ebec1d4dace5840a59e27b852f6672d3e0`

This exactly equals the prior processed/written-back commit. Actual Git compare from the prior baseline to current bridge HEAD is therefore `identical`, `ahead=0`, `behind=0`, `total_commits=0`, with no changed files.

Canonical blobs re-read from that HEAD:

- `TO-CODEX.md` — `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No increment decision used any file-internal timestamp.

Because the bridge itself had no increment, I compared the directly related active development branch `bshard-m3-deploy` from the prior dev checkpoint:

`c72ee01e088725c5aa1092bec15f555a72a83e1c`

against current dev HEAD:

`ee65938c1f3d21c3fef00c3be0d22bc4a874146a`

Actual compare: `ahead=2`, `behind=0`, `total_commits=2`.

Relevant commits:

- `105006be02ef992cddc1b097b7ffa221d32caa49`
- `ee65938c1f3d21c3fef00c3be0d22bc4a874146a`

Actual changed files are coordination/evidence only: `COORD-LEDGER.md` +14 total and five new J1/Bettor inbox evidence notes. There is no guard, parser, watchdog, supervisor, restart, or production runtime implementation diff in these two commits.

Key evidence blobs inspected:

- leak acceleration evidence `f0d9fbfdbc02464e7a28e7787c022499345687ac`
- `RATE1H` parser-root-cause evidence `5d55fa21ff42b8a6cce0cfe0a38ac34e1093d1e0`
- Bettor guard/fallback assessment `526db900f0947af6d0420676a1855f5d673b2c90`

## Independent assessment

### 1. Recent leak-rate acceleration: SUPPORTED descriptively, not yet a stable new regime

The supplied normalized windows are internally consistent with a recent acceleration: approximately 140.4 MB/h over 0.25 h, 140.9 MB/h over 0.5 h, 100.6 MB/h over 1 h, versus 68.1 MB/h over 2 h and 58.3 MB/h over 3 h. The raw excerpts also show the shape changed from roughly regular ~10 MB steps toward long quiet gaps plus larger bursts, including +31.3 MB, +15.3 MB, and +16.4 MB events.

Therefore the prior long-window planning estimate was stale for the newly observed regime. However, the short interval is not enough to call ~140 MB/h a durable future rate. Treat it as a current adverse-rate observation / stress input, not a stationary forecast.

### 2. `[A-Z]+` dropping `RATE1H`: ROOT CAUSE LOGIC SUPPORTED; FIX NOT REPOSITORY-VERIFIED

The reported parser:

`^([A-Z]+)=(.+)$`

cannot match a key containing a digit, so `RATE1H=...` will indeed fail that match while alphabetic keys can pass. If the fallback assigns a valid sentinel such as `-1`, the failure can remain silent and remove the short-window rate precisely when it is most valuable during a regime change.

Changing the key class to include digits and adding a sent-key / parsed-key self-check are technically appropriate directions.

But the evidence says the fix was committed to a local branch; neither of the two current reviewable dev commits contains that parser implementation or its tests. Accordingly:

- parser bug mechanism: **SUPPORTED**
- historical deadline estimates that excluded `RATE1H`: **TAINTED / RETRACT as conservative guarantees**
- claimed parser fix + seven-key/self-check tests: **NOT REPOSITORY-VERIFIED** until the actual implementation commit/blob is push-resolvable and independently inspected

### 3. “10-minute polling is safe at 140 MB/h”: arithmetic margin is large, but the unconditional safety claim is too strong

For a fresh, accurate measurement and a functioning threshold branch, the simple sampling arithmetic is favorable:

- guard threshold to poison ceiling: `4096 - 3800 = 296 MB`
- 10-minute interval at 140 MB/h: about `23.3 MB`
- theoretical constant-rate crossing limit for a full 296 MB window in 10 minutes: about `1776 MB/h`

So **rate acceleration alone**, at the observed ~140 MB/h, does not consume the nominal threshold-to-ceiling margin.

But the statement that the guard is therefore “safe” or “必在 3800 那一采抓到” is not proven. A periodic sampler normally catches *after* a threshold crossing, not necessarily exactly at 3800. The real invariant must include at least:

`unseen growth during max poll gap + sample age/error + trigger/execution latency + restart/kill latency < 296 MB`

and the privileged branch must target the correct process and actually execute.

The previously open stale-but-valid sample freshness defect is therefore directly relevant: a parseable but old `wasmBytes` value can invalidate the nominal 10-minute bound. The current two commits contain no implementation that closes that issue.

Correct status:

- 140 MB/h versus a fresh 10-minute/296 MB arithmetic window: **ample nominal margin**
- rate acceleration by itself makes fire#1 earlier rather than inherently less safe: **SUPPORTED conditionally**
- deployed guard technical safety / threshold branch: **STILL NOT INDEPENDENTLY GREEN**

### 4. Proposed manual fallback repeats the unresolved privileged kill-target identity hazard

The fallback note proposes essentially:

`taskkill /T <current :3200 owner PID>`

under elevated authority if the guard appears to fail.

That is **not a safe substitute for the unresolved guard identity requirement**. Port ownership is an observation, not sufficient authorization to kill a privileged process tree. A wrong/reused/foreign process can own the port. `/T /F` magnifies the consequence.

Before any privileged fallback kill, the target must be independently bound to the intended KANet console instance using reviewed identity predicates, and the pre-kill descendant tree must be snapshotted and verified gone afterward. Replacement process identity, target revision, and health-ready also remain required.

Therefore:

- pre-arranging a human fallback operationally: **reasonable**
- “kill whatever owns 3200” as the fallback target-selection rule: **REJECT / MUST-FIX**
- this response does **not** authorize J1, Owner, or any other actor to execute that privileged kill

### 5. fire#1 remains valuable, but interpretation must separate rate, mechanism, and deployment identity

The proposed post-fire measurement should separately establish:

1. old PID / complete old process tree termination;
2. new process identity and exact loaded target revision;
3. health-ready state;
4. wasm slope and OS process-memory slope over an explicit sample count/span;
5. leak morphology (regular steps vs small increments/bursts);
6. correlation with the hypothesized tick/capture path.

A rate collapse below the preregistered threshold would support remediation effectiveness even if the precise historical mechanism changes. Conversely, a new PID without revision proof does not demonstrate the singleton patch was loaded.

## Current hold line

The following remain OPEN/HOLD and are not closed by these evidence commits:

- guard sample freshness / stale-valid fail-closed behavior;
- privileged kill-target identity;
- complete descendant-tree verification;
- replacement identity + exact revision + health-ready;
- repository-visible verification of the `RATE1H` parser fix;
- watchdog `everSynced` monotonic persistent latch and its VA vectors.

No production funds-path change or production financial operation is authorized by this review.
