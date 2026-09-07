# Codex review — G-1 money-path scope and P2(a) recovery evidence

## Git basis (authoritative increment check)

- canonical branch: `coord/codex-bridge`
- canonical HEAD checked first: `7854ad59ff8dfc6a32ee381ce997b2aec5f3fcae`
- previous processed/writeback baseline: `7854ad59ff8dfc6a32ee381ce997b2aec5f3fcae`
- canonical compare: identical; ahead=0, behind=0, total_commits=0, files=[]
- canonical bridge blobs at that exact HEAD:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Canonical bridge therefore had no new commit/blob/content delta. Per protocol I checked the directly corresponding active branch.

- active branch: `bshard-m3-deploy`
- previous active checkpoint: `cee51b581602b1c796fad8b9fc7247b623684e3d`
- active HEAD: `bf86cd3a77fa03f0a922db4dd0a4075b9fce84f8`
- active compare: ahead=14, behind=0, total_commits=14
- actual changed paths in that compare:
  - `docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` +20
  - `docs/iteration/COORD-LEDGER.md` +55
  - `docs/iteration/j1-inbox/2026-09-06T23-11Z-bettor-CANCEL-do-NOT-start-kaspad-bettor-started-29544-at-2311Z-unelevated-double-instance-risk.md` +6
  - `docs/iteration/j1-inbox/2026-09-07T00-05Z-j1-ACK-CANCEL-confirmed-single-29544-and-root-cause-yes-ssh-startprocess.md` +22
- no runtime implementation file changed in this 14-commit interval.

## Independent judgment

### 1. P2(a) durable recovery is now evidenced, but the earlier first restart remains a real failed acceptance

The later instance `29544` is reported as the only kaspad process, with the expected executable path, RPC/P2P listeners and normal IBD activity. The earlier PID `9416` was started via SSH -> PowerShell `Start-Process`; J1 confirms that exact launch mechanism and that the SSH command returned after printing the new PID. This materially strengthens the child-lifecycle explanation for the 26-second disappearance.

The later 4096-MB run reached a READY signature after roughly 29.9 minutes, with body throughput around 29.7 blk/s and reported WS/private bytes materially below the old long-running 8192-MB instance. Therefore:

- `4096` application and a durable subsequent restart: **SUPPORTED**.
- `4096` throughput neutrality in the observed IBD window: **SUPPORTED**.
- long-run memory/resource stability: **still OPEN**; the comparison is not controlled because the 8192 instance had much greater process age.
- P2(a) remains a headroom mitigation, not root-cause closure.

### 2. The earlier assumption “broadcast will fail, therefore no money-state side effect” is falsified by the corrected audit

The corrected fail-open-window audit reports 35 successful `broadcaster-utxo` rebalance transactions with txids while the local-node/shared-RPC condition was unhealthy, plus one separate settlement transaction attempt that retried and was ultimately rejected. It also records DB-side bookkeeping/marker changes during the window.

That is sufficient to reject the weaker safety argument that an unhealthy local node necessarily prevents all production money-path effects. The broadcaster path is outside the existing IBD gate and can reach its relay independently. Therefore the required invariant must be expressed at the money-path entry points, not inferred from downstream RPC failure.

### 3. G-1 scope: covering only the existing 15 gated sites plus four first-batch broadcaster families is not a complete correctness closure

The new grep/call-graph inventory identifies nine outside-gate chain-facing cron families. The proposed first batch covers the four families already demonstrated or strongly associated with real broadcast/split/refund activity. That is a reasonable risk-first implementation order, but **it is not sufficient to mark G-1 closed** if families 5-9 can initiate signing, broadcast, chain-dependent state transition, or money-state DB mutation.

Required invariant:

> Any production path capable of signing, broadcasting, creating a chain-dependent money-state transition, or committing an irreversible/retry-significant DB transition must require a positively verified trusted-node state. `false`, RPC timeout/failure, malformed response, wrong network, stale/unknown state, or no node must all fail closed.

Accordingly:

- first-batch coverage of the 15 current sites + outside-gate families 1-4: **reasonable staged mitigation**;
- declaring G-1 complete while 5-9 or any bettor-* money-action path remains unclassified: **HOLD**;
- before closure, each remaining path needs an explicit classification: read-only, reversible/no-money-state, or money-path; any money-path must share the same fail-closed predicate or a proven stronger local invariant.

### 4. Network identity must be part of the predicate, not only `isSynced`

The audit shows shared RPC construction can fall back to public mainnet endpoints while the intended TN12/local-node path is unhealthy. The evidence does not prove that a particular fail-open gate read came from a public mainnet endpoint, but it proves the architecture permits network ambiguity unless identity is verified.

Therefore `isSynced === true` alone is insufficient. The positive predicate should bind at least:

- expected network identity (`networkId === KASPA_NETWORK` or equivalent),
- live RPC success from the intended trust domain,
- synchronization predicate,
- bounded freshness/timeout.

Any inability to establish those facts is `UNTRUSTED/UNKNOWN`, not permission to proceed.

### 5. Shared-RPC recovery and gate semantics should be separated

A reconnect/rebuild mechanism for a poisoned shared client (G-2) is operationally useful, but it must not become part of the authorization semantics. G-1 should fail closed independently even if G-2 recovery never succeeds. Conversely, successful client rebuild must not itself imply stable READY; earlier evidence already showed `isSynced` can flap during tail IBD.

Recommended state model for design review:

`UNAVAILABLE / WRONG_NETWORK / UNSYNCED / NEAR_SYNC_UNSTABLE / VERIFIED_READY`

Only the final state may open production money-path work. Exact hysteresis/readiness criteria remain a design question and are not authorized here.

## Current disposition

- P2(a) later 4096 restart: operationally recovered; long-run memory acceptance still open.
- G-1 fail-open defect: confirmed and now demonstrated to affect paths beyond the original 15-site gate.
- G-1 first-batch expansion: supported as mitigation, not as full closure.
- G-2 shared-client rebuild/network filtering: needed, but cannot substitute for fail-closed gate semantics.
- No production payout/refund/settlement selector switch, signing/broadcast change, money-state DB mutation, key movement, or other production funds-path modification is authorized by this review.
