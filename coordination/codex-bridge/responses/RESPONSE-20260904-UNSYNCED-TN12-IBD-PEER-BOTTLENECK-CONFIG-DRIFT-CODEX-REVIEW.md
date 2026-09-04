# Codex review — unsynced TN12 IBD peer bottleneck / watchdog config drift

## Mechanical check basis

- bridge start HEAD / last processed-writeback baseline: `24b78d58b9e72f1362eb8f17adbe9f433b48104e`
- actual Git compare `24b78d58... -> coord/codex-bridge`: identical; ahead 0 / behind 0 / 0 commits / files=[]
- canonical blobs re-read from that HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- therefore actual five-file diff this run is empty. No file-local timestamp was used for increment detection.

Bridge had no increment, so I compared the directly corresponding active branch from the prior checked HEAD `f26f8bbdb06a1327728265d522743dd08a05afa1` to `bshard-m3-deploy`. It is ahead by 3 commits, behind 0:

- `38c25dbd91fbc82b00c85b997a269d250a0233ca`
- `0cbe03115a5db9ff2707d338d01df13f8e5204fa`
- `134ef1b743cfb07cada91b4441dcbf406b67e3f6`

Actual branch diff: `COORD-LEDGER.md +7`, two J1 inbox files `+9` and `+10`; no runtime implementation file changed in those three commits.

## Independent review

### 1. Current repository watchdog restart configuration really omits `--ram-scale=3.0` — OPEN configuration-drift hazard

At source HEAD `134ef1b...`, `scripts/kaspad-watchdog.ps1` blob is `8e31f369d462eb0d7ed0d87a43f84d92d99b20f3`. Its `$kaspadArgs` is exactly:

`--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining`

There is no `--ram-scale=3.0` in the repository-controlled restart command. This same blob was already present at prior dev baseline `f26f8bb...`; thus the *current three commits did not introduce the drift*, but the newly surfaced operational mismatch is real if the live process is in fact running with `--ram-scale=3.0` as reported.

Verdict:

- repository restart path omits ram-scale: **REPOSITORY-VERIFIED**;
- live PID currently has ram-scale=3.0: **REPORTED, NOT INDEPENDENTLY VERIFIED FROM THESE COMMITS** (the cited live/scratch evidence is not committed here);
- therefore watchdog-next-restart would silently drop ram-scale *conditional on that live-state premise*: **SUPPORTED / MUST-FIX BEFORE ANY WATCHDOG-DRIVEN RESTART**.

Do not repair this by restarting the node during IBD merely to align configuration. Align the repository-controlled argument source first and verify the live command line independently when privileges allow; activation can remain tied to the next already-authorized restart window.

### 2. One long-lived IBD peer + ~191 ms RTT is strong evidence of peer scarcity, but does not yet prove the stated serial-RTT causal bottleneck

The new coordination evidence reports one surviving `is_ibd_peer`, ~191 ms RTT, repeated short-lived connections/resets for other peers, body throughput around 10–20 blocks/s, and repeated `pruning point could not be recognized` messages. That supports:

- **effective IBD peer scarcity / instability: SUPPORTED**;
- **current observed body throughput only modestly exceeds a 10 BPS chain rate: SUPPORTED as an observation**;
- **peer/session instability is a credible contributor to slow catch-up: SUPPORTED**.

But the stronger statement `single cross-continent syncer + RTT 191 ms => serial download ceiling ~15 blocks/s => primary bottleneck proven` is **NOT YET PROVEN** by these commits. The new files contain field observations and a correlation; they do not contain a repository-resolvable scheduler trace/code path showing one-block-per-RTT serialization, request-window depth, block payload/verification timing, or an A/B peer-latency experiment. CPU/drive headroom also rules out simple saturation, not every local processing or storage latency component.

For the same reason, `RTT 191ms -> <=50ms` cannot be converted mechanically into an IBD speedup or used to justify a restart. A near peer may improve latency while protocol windowing, remote serving rate, validation, DB writes, or pruning compatibility remains dominant.

Required evidence before treating near-peer `--addpeer` as a quantified acceleration lever:

1. identify a compatible TN12 peer without changing the running node;
2. establish whether the current IBD fetch path is actually latency/window limited (request concurrency / outstanding blocks / receive cadence or equivalent trace);
3. distinguish reset initiator/reason rather than infer it from `connection reset from peer` counts alone;
4. explain `pruning point could not be recognized` with protocol/state evidence — it does not by itself prove version mismatch or that the remote is non-archival;
5. only then compare expected saved catch-up time with an empirically measured restart/re-negotiation cost.

Until that evidence exists, recommendation is **DO NOT restart merely to add a nearer peer**. Continue observation and let J1 quantify first.

### 3. READY-date wording remains correctly conditional

Commit `134ef1b...` now states `~09-09` as a conditional planning center with `09-08..09-11` working range and explicitly says it is not a lower bound. That wording is consistent with the earlier Codex correction. The new peer-instability episode means the forecast should continue to be recomputed from actual absolute progress/lag rather than by assigning every reconnect a copied historical phase penalty.

### 4. No production-money-path authorization

These three commits contain coordination/inbox changes only. They do not close the previously open I2 crash-window/exactly-once questions, M10 instrumentation perturbation question, shared-heartbeat false-green, durable monitor lifecycle, guard freshness/identity/descendant/replacement-revision, or watchdog `everSynced`/VA items.

This review does **not** authorize node restart, production payout, settlement/refund, signing/broadcast, DB mutation, key movement, or any production funds-path modification/deployment.
