# Codex review — D-d syncer pruning-point lag tolerance / incident loop

## Git object baseline for this run

- canonical branch checked first: `coord/codex-bridge`
- canonical HEAD observed: `b42377409a85edbf05bdc2ea9cd241a43169a490`
- compare base: prior processed/writeback commit `b42377409a85edbf05bdc2ea9cd241a43169a490`
- Git compare: `identical`, ahead 0, behind 0, commits 0, files `[]`
- canonical blobs re-read at that exact HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No timestamp field was used for increment detection.

Because canonical bridge had no increment, I checked the directly corresponding active branch. `bshard-m3-deploy` advanced from prior checkpoint `18e2ddfa73ce29baf29ea380e56b52a0b4c5b533` to `2ed52de1a453e96a0b6248879482fd42a4113966`: ahead 11 / behind 0 / 11 commits. Actual diff is documentation/evidence only: `docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` +15, new `docs/2026-09-07-NWT-redteam-dd-syncer-pp-lag-tolerance-review-v0.1.md` +44, `docs/iteration/COORD-LEDGER.md` +32. There is no KANet runtime implementation-file diff in this compare.

## Independent technical judgment

### 1. The reported failure mechanism is technically consistent with upstream IBD code

I independently inspected public upstream `kaspanet/rusty-kaspa` `protocol/flows/src/ibd/flow.rs` at commit `c338d495...`. In `determine_ibd_type`, a peer whose pruning point is neither equal to ours nor ahead is classified `Lagging` only if its pruning point is found in `async_get_n_last_pruning_points(4)`; otherwise the flow returns `ProtocolError` (`syncer ... pruning point could not be easily recognized`). For `Lagging`, only the fully stable local-state arm proceeds as `IbdType::Sync`; the unstable arm rejects. The separate finality-conflict rejection remains outside that skew classification.

Therefore an observed local pruning-point jump that places an otherwise same-chain syncer beyond the hard-coded recent-4 window can indeed produce a repeat disconnect/reconnect IBD loop with zero body progress. This mechanism is **SUPPORTED**, assuming the reported peer/local pruning-point observations are accurate.

### 2. D-d `tolerance=16` is a bounded semantic widening, not a no-op recovery flag

The NWT artifact reports that the proposed implementation keeps default `4` behavior unchanged and, for a wider bounded value, requires both membership in the local historical pruning-point table and `is_chain_ancestor_of(syncer_pp, our_pp)` before treating the peer as lagging. That direction is technically coherent: it widens only the recency acceptance window while adding an explicit same-chain ancestry predicate for the newly accepted older points.

NWT reports direct tests at final code `3d017b6d`: `syncer_skew` 9 passed and D-c `self_trigger` 14 passed, plus the required rejection-path warning and help-text correction. The published artifact also records a pinned binary SHA256 `6d5bcebebd528862d6adbc28ba7baab6f21ea74c373325fef0e208fbd1d5106f` and provenance-manifest verification.

My verdict on the **design semantics** of starting at `16` is **GREEN-conditional / technically reasonable for a bounded incident-recovery trial**, subject to the runtime acceptance conditions below. It is not evidence that the node is generally healthy and it does not close D-c.

### 3. Important evidence boundary: the actual custom `3d017b6d` source object is not repository-readable from the current KANet branch

The new KANet commits contain the NWT review and ledger, but not the referenced custom rusty-kaspa patch/provenance directory itself. I attempted to read `docs/provenance/2026-09-07-kaspad-dd-syncer-pp-lag-tolerance/patch.diff` from `bshard-m3-deploy`; it is not present there. The custom `3d017b6d` commit is also not an object in `Unio996/KANet`.

Accordingly, I can independently verify the upstream baseline semantics and assess the described hunk/test logic, but I cannot truthfully claim a byte-level independent review of the actual `3d017b6d` custom source from the GitHub objects currently exposed through this repository. NWT's own hunk/patch comparison and test execution remain team evidence, not Codex-reproduced source verification. Do not collapse this distinction in STATUS or a closure claim.

### 4. `tolerance=0` must remain a separate HOLD

The proposed `0 = unlimited` mode materially expands the acceptance surface beyond the bounded recent-window case. Even with an ancestry check, it changes both trust/acceptance breadth and lookup cost. The NWT recommendation to start at 16 and only reconsider 0 if the new diagnostic proves the peer is outside that bounded window is correct.

Verdict: **16 bounded trial: reviewable**. **0/unlimited: HOLD pending separate evidence and explicit review**.

### 5. Runtime acceptance must prove recovery, not merely process startup

For any separately authorized incident-recovery switch, acceptance must include at minimum:

- exactly one intended kaspad process and expected executable identity/hash;
- command line contains cache 4096, D-c shadow disabled (`--ibd-self-trigger-lag-secs=0`) and D-d tolerance exactly 16;
- listener/RPC health;
- diagnostic line exposes the peer pruning point / window decision;
- the same peer or a clearly identified replacement completes the IBD attempt successfully;
- `Processed N blocks` has N > 0;
- sink/DAA lag measurably converges instead of merely resetting the loop;
- no finality-conflict, incoming-route-capacity, unexpected peer-classification or rollback signature;
- console restart does not reopen chain-dependent money paths on transient `isSynced=true` or RPC-unknown states; G-1 remains independently OPEN.

A one-minute rollback *capability* does not make a semantic widening safe by itself; the recovery verdict comes from the post-switch evidence above.

### 6. Do not convert an Owner silence window into a Codex technical authorization

Ledger item 980 says that if no Owner response arrives by 03:00Z, Bettor intends to execute step 1 under a prior general "full automation" authorization. That is an authorization interpretation by the operating team, not a technical fact established by D-d tests.

Codex does **not** grant or infer Owner authority from silence. In particular, previous D-a/D-b switches used explicit Owner GO, while D-d changes sync-peer acceptance semantics. Whether the prior delegated automation authority legally/operationally covers this incident switch is for the Owner/delegated governance path, not for this technical review to manufacture.

This response therefore **does not authorize deployment or execution**. If the team executes under its independently valid Owner/delegated authority, the technical acceptance/rollback constraints above apply.

## Current state

- IBD failure-loop mechanism due to hard-coded recent-4 syncer PP recognition: **SUPPORTED**.
- D-d bounded `tolerance=16` design direction: **TECHNICALLY REASONABLE / GREEN-conditional**.
- Actual custom `3d017b6d` source byte-level independent Codex verification: **NOT AVAILABLE from current GitHub objects**; team/NWT evidence only.
- D-d artifact identity as reported by NWT: **team-verified, not Codex-host-reproduced**.
- `tolerance=0` unlimited mode: **HOLD**.
- D-c production/self-trigger activation: **OPEN**.
- G-1 chain/money-path trust gating: **OPEN / HOLD** and unaffected by this node-recovery review.
- No production payout, settlement/refund selector switch, signing/broadcast, money-state DB mutation, key movement, or other production funds-path change is authorized by this response.
