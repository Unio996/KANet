# Codex review — unsynced M10 instrumentation + I2 payout idempotency design

## Check basis
- canonical branch checked: `coord/codex-bridge`
- branch HEAD at start: `1bd50d08ebea0941480fc79eb9173ab312407dcb`
- previous processed/written-back commit: `1bd50d08ebea0941480fc79eb9173ab312407dcb`
- Git compare: identical; ahead=0, behind=0, total_commits=0, files=[]
- canonical blobs re-read from Git tree:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no increment, I checked the directly related active branch `bshard-m3-deploy` from the prior development checkpoint `692d27cce805b20367ddf7c9471865ff4b18ddb1`.

Current active HEAD: `f26f8bbdb06a1327728265d522743dd08a05afa1`.

Actual Git compare: ahead=28, behind=0, total_commits=28. Changed files are not coordination-only: four design/audit docs plus `COORD-LEDGER.md` and real implementation changes in `discovery.js`, `index.js`, `http-big-response-observe.mjs` + tests, `bshard-settle-daemon.mjs`, `pair-ingestor.mjs`, and `pool-market-settler.js`.

## Independent code-level findings

### 1. M10 instrumentation: repository implementation exists; logical behavior preservation is mostly supported, but “zero expected behavior change” is too strong

Commit family around `03b4423fe26383c7064b20f972e3850b54ae8107` / `b29623875c9a657bc79ca2104a9cbc61eff2784c` adds timing/log-only instrumentation and the global Fastify large-response observer. The current observer is fail-soft in the correctness sense: the body is wrapped in `try/catch`, returns the original payload, skips streams/unknown payload types, and does not mutate status/headers/state.

However, for string payloads `defaultSizeOf()` calls `Buffer.byteLength(payload)`. That is O(n) over the complete response string. On the exact H3 workload under investigation (claimed 186–244 MB responses), the observer adds a full pass over a very large string on the main JS thread before response completion. Therefore it is not justified to call this hook “zero expected behavior change” in the performance sense. It can add latency / memory-bandwidth pressure and can perturb the event-loop stall it is trying to measure.

Verdict:
- response semantic preservation: SUPPORTED by code shape;
- observe-only state semantics: SUPPORTED;
- negligible timing perturbation for huge string payloads: NOT PROVEN;
- M10 measurements involving large string responses should record/benchmark observer overhead or switch to a size source that does not require rescanning the full body when such metadata is already available.

The offline tests described for the hook validate behavior/throw isolation, not the performance overhead on 100MB+ strings. Do not treat those tests as closing this measurement-bias risk.

### 2. L5 correction is materially better than the earlier “full-table settle scan” story

The new design correctly downgrades several earlier claims: current evidence says `selectRipeMarkets` on the DB copy can use `idx_pool_markets_status` and is ~1.2 ms, while the newly suspected pressure shifts toward repeated small reads / pair-ingestor / claim-auto / other synchronous work. This correction should replace the earlier simplified “settle SQL full-table scan is the main cause” narrative.

The pair-ingestor UUID cursor issue is a real correctness concern: ordering/filtering a random UUID TEXT primary key using `WHERE id > lastId ORDER BY id` cannot represent insertion order. A later inserted row whose UUID sorts below the current cursor can be permanently skipped. Moving to `rowid` is structurally sound only while the table remains a rowid table and rows are not deleted/replaced in a way that invalidates the monotone traversal assumption. The proposed negative vector with a lexicographically smaller UUID is appropriate.

### 3. Scanner watchdog diagnosis is now stronger, but the proposed synced gate remains a runtime policy change

The new observation explains a concrete false-stale mechanism: the scout writes a fresh checkpoint, then indexing IBD blocks can overwrite the timestamp basis with chain-time lag, after which the watchdog interprets that lag as process staleness and kills a process that is still doing useful work. The proposal to suppress watchdog kill only when `isNodeSyncedCached().isSynced === false`, while retaining existing behavior on unknown/RPC failure, is directionally fail-closed for watchdog availability.

But this is still a runtime behavior change and should keep its explicit negative vectors. `isNodeSyncedCached` itself becomes part of the safety argument; its freshness, cache key/network binding, and failure-mode semantics must be repository-tested rather than inferred from the design prose.

### 4. I2 payout-idempotency design correctly identifies a real double-pay class, but “GREEN-final” must not be read as production authorization

The design identifies a serious real path: a transfer can be broadcast by the relay, the console can time out before receiving the txId, and a blind retry can issue another transfer. Persisting an idempotency key before broadcast and making `inflight` fail-closed is the right direction.

The strongest part of v0.3 is the rule:
`unknown / inflight / relay unreachable => HOLD`, never “absence of evidence => never sent”.
That is the correct safety polarity.

But one unresolved boundary remains fundamental: after a crash in the interval between actual broadcast and durable transition from `inflight` to `submitted`, a relay generally cannot prove that a transfer was never broadcast merely because it is not yet visible in local RPC / mempool / `kaspa_tx_log`. The design partly recognizes this by allowing `inflight` to remain HOLD. That means the architecture can be fail-safe, but it cannot claim guaranteed automatic exactly-once recovery for this crash window without a stronger primitive (for example a deterministically precomputed txid / durable signed transaction or another broadcast-before-state reconciliation proof).

Required wording:
- duplicate prevention under same key after durable `submitted`: design-supported;
- crash-after-broadcast-before-submitted safety: fail-safe only if unresolved stays `inflight/HOLD` indefinitely;
- automatic proof of `never` after that crash: NOT ESTABLISHED;
- exactly-once automatic payout across all crash points: NOT YET PROVEN.

Also, if the dedicated idempotency store uses tmp+rename+fsync, durability must be tested on the actual host/filesystem. File fsync alone does not automatically establish directory-entry durability semantics on every platform. V13/V14 need real kill/restart persistence tests, not just unit mocks.

### 5. Do not merge “Owner approval” with technical green

The latest ledger says Phase 1 + I2 have been submitted for Owner approval and that I2 is NWT GREEN-final. Those are coordination facts, not a Codex production-money-path approval. No production signing/broadcast/settlement/refund/DB/key movement authorization is granted here.

For I2, code does not yet exist in this compare as the proposed relay idempotency storage + `transfer_status` + console reconciliation implementation; the branch currently contains the design/audit and M10 instrumentation. The later implementation must be reviewed as actual code and actual tests, in the promised separate relay-storage and console-settler commits, before any technical green can be assigned.

## Status changes from this review
- M10 instrumentation implementation: PRESENT; correctness-side fail-soft shape SUPPORTED; large-string measurement perturbation OPEN.
- Earlier “settle SQL full-table scan is the main blocker”: RETIRED / superseded by L5 evidence.
- pair-ingestor UUID cursor correctness bug: REPOSITORY-SUPPORTED; rowid repair direction reasonable, still requires implementation diff + negative vectors.
- scanner watchdog false-stale under IBD: STRONGLY SUPPORTED; synced-gate implementation/test still pending.
- I2 prediction payout duplicate-payment hazard: CODE-PATH/DESIGN-SUPPORTED as a real risk class.
- I2 v0.3 production readiness: HOLD pending actual implementation + V1–V15 evidence, especially crash-window reconciliation and durable-store kill/restart tests.

Existing OPEN items from previous Codex reviews remain open unless independently closed by repository-resolvable code/evidence: guard sample freshness, privileged kill target identity, descendant-tree pre/post verification, replacement exact revision/health-ready, durable monitor lifecycle, shared-heartbeat false-green, watchdog persistent monotonic `everSynced`/VA, and sampler taxonomy.

No production funds-path modification is authorized or deployed by this review.
