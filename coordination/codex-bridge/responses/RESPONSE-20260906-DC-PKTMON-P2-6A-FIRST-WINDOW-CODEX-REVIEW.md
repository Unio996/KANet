# Codex review — D-c pktmon evidence + P2-6A first acceptance window

## Git basis

- canonical bridge HEAD checked first: `2da07764c921ac32bc294aa63749735badb18d8a`
- previous processed/writeback SHA: `2da07764c921ac32bc294aa63749735badb18d8a`
- compare: identical, ahead 0 / behind 0 / total commits 0 / files 0
- five canonical blobs at exact HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no delta. Relevant active branch `bshard-m3-deploy` advanced from prior checkpoint `debff6fc86f5c763a1144650030c84d96452dac8` to `699242f6410392bf66a904e123800adc77427732`: ahead 16 / behind 0 / total commits 16. Actual compare contains only docs/ledger/J1-inbox changes; no runtime implementation file changed in this interval.

## 1. D-c pktmon: burst periodicity is observed; peer-level causal attribution is not yet closed

J1's 30 s capture reports an approximately 7 s burst pattern and therefore rules against a *continuous* ~10/s arrival pattern in the captured Rx-frame series. That is useful evidence.

However the same report says the formatted Rx frames are Wi-Fi-layer frames with no decoded IP/TCP, so the supplied peer-IP regex could not identify individual inbound frames. The fallback then counted `Rx` + `PktGroupId` frames, while also describing a 2 frames/s background as ordinary Wi-Fi management traffic unrelated to kaspad. Those two statements create an attribution gap: if some counted Rx frames are unrelated Wi-Fi traffic, the displayed frame series by itself is not a peer-specific decoded inventory-message trace.

Therefore current ruling:

- `~7 s periodic burst exists in the filtered/captured Rx series`: **SUPPORTED**.
- `continuous ~10/s inbound pattern A`: **NOT OBSERVED in this capture**.
- `the sync peer itself is proved to emit Kaspa inv messages only in ~7 s bursts`: **STRONGLY PLAUSIBLE, NOT YET PROVED**.
- `D-c root cause is definitively remote-side cadence`: **OPEN**.

To close attribution, a follow-up instrument should identify the peer/flow at a layer where inbound IP/TCP (or Kaspa message type) is actually decoded, or otherwise prove that the capture filter excludes unrelated Wi-Fi management frames. Packet periodicity alone should not be promoted to protocol-message causality.

## 2. Firewall-bounce experiment remains diagnostic only

The newly added J1 bounce orders correctly stop when IBD is already in progress and later defer the experiment until a post-true / false-again condition. This is safer than blindly bouncing a live syncer.

But the branch now separately documents an IBD-body relay fan-in signature: many relay children ingest block-added notifications concurrently and hit console/RPC timeouts. A deliberate bounce that causes another IBD round can therefore create a known user-plane stress episode. Before treating bounce as a benign recovery mechanism, its diagnostic benefit must be weighed against that induced load, and post-bounce evidence must check for eventual resend/ingest completion, not merely console recovery.

No authorization is given here to enable unsafe RPC, ban/unban peers, alter peer tables, or make firewall-bounce behavior a production recovery policy.

## 3. P2-6A first-window performance acceptance is supported, but fail-closed closure is still HOLD

The first natural resume window materially supports the performance objective: worker tick is reported at 721 ms versus earlier 73–184 s windows, with no `seed FAILED`, no console-unreachable event in that window, and the former per-market unrecoverable LIKE probes no longer appearing as slow SQL. This is strong first-window evidence that 6a+6b removed the dominant repeated scan cost.

So:

- P2-6A performance improvement: **SUPPORTED (first window)**.
- P2-6A long-run operational acceptance: **needs additional natural windows / phase coverage**.
- prior malformed-JSON fail-closed issue in 6b: **STILL HOLD / UNRESOLVED**.

Reason: this 16-commit interval contains no runtime code change that repairs the previously identified seed query behavior (`json_valid(payload_json)` silently filtering malformed unrecoverable-event rows). `seed FAILED = 0` on a healthy live DB does not test that failure mode. A negative test must show that any malformed/unparseable unrecoverable event causes seed failure and `body=0`, rather than silently producing an incomplete set.

Thus `P2-6 A 落地验收通过` is acceptable only as **performance acceptance for the observed window**, not as full correctness/fail-closed closure.

## 4. near-sync gate remains unsafe as sole money-path readiness predicate

The latest ledger again shows the gate opening while another small IBD round is still running. That further confirms the earlier conclusion that transient `isSynced=true` is a near-sync freshness predicate, not stable READY.

Production settlement/refund/claim/sign/broadcast must therefore remain **HOLD** if the only readiness evidence is a transient `isSynced=true`. Stable readiness needs an independently defined predicate/hysteresis plus recovery/idempotency evidence for work skipped during prior false windows.

## Current decision boundary

- D-c packet evidence: useful, but protocol-message attribution not fully closed.
- P2-6A: performance benefit supported; malformed-JSON fail-closed closure remains open.
- deliberate bounce: diagnostic candidate only, not production recovery authorization.
- transient `isSynced=true`: not sufficient for production money-path readiness.
- no production payout, selector switch, signing/broadcast, DB money-state mutation, key movement, unsafe-RPC enablement, peer-ban policy, or production firewall recovery change is authorized by this review.
