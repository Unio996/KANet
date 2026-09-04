# Codex review — unsynced D-b / M10v2 evidence

## Git baseline

- canonical branch: `coord/codex-bridge`
- checked HEAD: `2011a5553ceff310302e847ae071efc6b90af165`
- previous processed/write-back baseline: `2011a5553ceff310302e847ae071efc6b90af165`
- bridge compare: identical; 0 commits; 0 changed files
- canonical blobs at checked HEAD:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## Unsynced active-branch compare

Relevant active branch `bshard-m3-deploy` advanced from prior checkpoint `29963ed37c60d8e018b74964474b0f1f8af4025e` to `8798b95efef6cc4807ceaa0d931c99a7cc0271fe`: ahead 17, behind 0.

Actual compare contains only six documentation/coordination paths: NWT acceleration precheck, new D-b red-team design/review docs, M10v2 first-window review, Bettor D-b design, `COORD-LEDGER.md`, and one J1 inbox file. There is **no runtime implementation diff in this 17-commit compare**.

## Independent findings

### 1. P1/B-prime cancellation is supported by the newer evidence state

The newer commits explicitly retract the earlier strong local-bottleneck story and cancel P1/B-prime. The reported clean windows remain roughly 12.4–13.6 blk/s versus the earlier ~14.4 blk/s baseline while host/DB overhead fell substantially under D-a. That combination supports the narrower conclusion that further local cache/fd reduction is not presently demonstrated to raise body throughput. It does **not** by itself prove a unique remote bottleneck, but it is sufficient to reject an immediate P1 downgrade as evidence-based acceleration.

### 2. D-b depth=2 is a reasonable experiment, not yet a production-authorized fix

The design claims an incoming-route capacity of 256 and worst-case two in-flight body batches of 99 each (198), with depth 3 exceeding capacity. If those constants and overflow semantics are correct, depth 2 is the only plausible bounded experiment among 2/3 under that model.

However, the safety argument depends critically on response-order semantics. The design itself acknowledges that responses carry a request/response id while the current client receive path does not match on it and instead relies on peer-side ordered servicing. Therefore correctness is conditional on strict in-order service for these requests. Any implementation must fail closed on reorder/mismatch/route-capacity error and must not broaden route capacity to make the experiment pass.

Most importantly, the coordination commits cite an implementation commit as short SHA `4d0a9e30`, but that commit is not resolvable through the canonical repository endpoint and the named `j2-db-ibd-pipeline` branch is not currently discoverable in the repository. Thus the claimed D-b code cannot be independently diff-reviewed from the repository in this run.

**Codex status:** design direction = `GREEN-CONDITIONAL`; implementation review = `HOLD / NOT REPOSITORY-RESOLVABLE`; deployment = `HOLD`.

Before any live switch, the full implementation commit SHA must be pushed to a repository-visible branch and independently checked for: exact request send/recv sequencing, response association, cancellation/error unwinding, timeout behavior, route-capacity handling, peer disconnect behavior, and unchanged non-v9/non-body paths.

### 3. M10v2 first-window evidence narrows attribution but does not justify a single-root-cause claim

The first-window review reports that only a minority of long lags can be attributed to named synchronous pre-await sites; `broker-intake.tick` is the strongest named synchronous contributor, with a `kaspa_tx_log` NOT EXISTS query reportedly showing ~5.5 s median duration every 60 s. Later alignment work maps many apparent settle/pool coincidences to the same-start broker-intake timer rather than settle/pool themselves.

This supports: `broker-intake.tick` synchronous DB work is a real event-loop blocker candidate and should be fixed/isolated.

It does **not** support: `broker-intake` explains the entire stall problem. The team's own accounting leaves most long-lag time beyond currently wrapped synchronous sites, especially after the first await in async ticks. M10 v3 step-level instrumentation is therefore justified.

For the DB query itself, an index hit in `EXPLAIN` does not make a multi-second synchronous query harmless. If the query returns/visits tens of thousands of historical rows from a multi-GB database, cold/random-page I/O or result materialization can still block the Node main thread even with a nominal index seek. A correct optimization must be judged by rows/pages touched and actual synchronous wall time, not merely by whether SQLite prints `SEARCH ... USING INDEX`.

### 4. Do not infer causality from timer co-start alone

The newest coordination notes correctly recognize that settle and broker-intake 60 s timers can start in the same millisecond. Therefore timestamp coincidence at tick start is insufficient to attribute a stall to settle/pool. Attribution should use nested/segment timing (`pre`, synchronous step spans, first-await boundary, post-await spans), not only outer tick timestamps.

## Required next evidence

1. Push the D-b implementation to a repository-visible branch with full commit SHA and build/provenance evidence.
2. For D-b, prove depth-2 boundedness against actual route capacity and demonstrate explicit behavior under response reorder, disconnect, timeout, and `IncomingRouteCapacityReached`.
3. For the broker-intake query, capture `EXPLAIN QUERY PLAN`, returned/visited row count, synchronous wall time, and before/after behavior for the proposed `(to_address, observed_at DESC)` or equivalent bounded-query change on a backup DB.
4. For M10 v3, keep query values sanitized; do not reintroduce raw query-string logging. Instrument synchronous SQLite / JSON parse segments after the first await so attribution is segment-based.
5. No production money-path authorization is implied by any of the above.

## Safety boundary

No production payout, settlement/refund, signing/broadcast, DB money mutation, key movement, or other production funds-path change is authorized by this review. No privileged live D-b deployment is authorized by this review.
