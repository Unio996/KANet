# Codex review — unsynced gate-(a) broadcast-window / READY / retry contract

## Git basis

- canonical branch checked first: `coord/codex-bridge`
- prior processed/written baseline: `382c9cabd043256e5dcf0c0a935a82b41048afde`
- current canonical HEAD at start of review: `382c9cabd043256e5dcf0c0a935a82b41048afde`
- actual Git compare: `identical`, ahead 0, behind 0, files `[]`
- canonical five-file blobs at that HEAD:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamp was used for incremental detection.

Because canonical bridge had no increment, I checked the active branch corresponding to the open gate-(a)/A′ recovery work. `bshard-m3-deploy` is now at `1833dc4caec98275af4b367b184a75d2ba73a0aa`. I filtered for changes that materially alter the gate-(a) acceptance/execution contract rather than treating unrelated ops/IBD commits as bridge feedback.

## Reviewed unsynced source

Load-bearing source commit: `86d5e43f140377858ce03b4cb3b56b2860f52f1c`.

Reviewed files:
- `docs/2026-08-29-nwt-gate-a-onchain-acceptance-card.md` blob `b05b16bf8abfd256b8f569fd1d114f2d18808a09`
- `docs/2026-08-29-nwt-t0-dispatch-reconcile.md` blob `7a670bb7d64401c9c2d52fab144e57e3b9320af5`

The branch-head coordination commit `1833dc4c...` also records the proposed dust budget and the requirement that fee-floor wiring be fixed before execution; I treat those as planning/request state only, not authorization or chain evidence.

## Independent verdict

### 1. Read-only first-hour vs gate-(a) broadcast conflict: CLOSED at runbook/design layer

The revised card now correctly states that gate-(a) is a **write/broadcast round**, not read-only RPC: dust funding, N6-N9/P submission, and P landing require a signing/broadcast operator and explicit Owner dust-spend GO. It is explicitly separated from the read-only first-hour window, with ordering `read-only first hour -> gate-(a) broadcast round -> maintenance-window broker batch`.

This is a material correction. The previous wording could have been read as permitting gate-(a) inside a read-only window. That ambiguity is now removed.

**Important authority boundary:** the proposed `<=10 KAS` budget visible in coordination is only a request/plan. This Codex review does **not** authorize it, does not authorize signing/broadcast, and does not authorize any production/funds-path modification.

### 2. READY criterion: improved and accepted direction

The card no longer permits a single local READY signal. It requires agreement between J2 `_step0_gate.mjs` and the independently derived KANet-UI `getBlockDagInfo` signal; disagreement stops the run.

That is the right fail-closed shape for a live acceptance round. It does not by itself prove the node is suitable, but it prevents one stale/incorrect observer from unilaterally opening the broadcast window.

### 3. INCONCLUSIVE handling: improved and accepted direction

Each vector is capped at <=3 submissions, and a retry is allowed only after the preceding noise cause (fee/mass/standardness/orphan etc.) has actually been corrected. Three unresolved INCONCLUSIVE outcomes stop/escalate rather than looping or being promoted to PASS.

This preserves the existing rule that a generic node rejection is not covenant evidence.

### 4. N6-N9/P acceptance semantics: remain consistent with the A′ design contract

The revised card preserves the important distinctions:
- N6: `lockTime=E-1` must fail at the CLTV boundary;
- N7: time-domain lock value against DAA-domain covenant must fail as type/domain mismatch;
- N8/P: byte-identical transaction submitted before and after the DAA boundary, so timing—not rebuilt bytes—is the changing variable;
- N9: MAX sequence must not bypass CLTV;
- P: after `tip DAA > E`, the transaction must actually land and reach required depth.

The successor/provenance section still requires same-cid RPC/UTXO readback, actual successor depth, and redeem-script SHA binding to the reviewed probe artifact. Those remain necessary before gate-(a) can close.

### 5. Remaining HOLD is execution evidence, not another design reopening

I do **not** reopen Shape-B/A′ design on this unsynced change. The new material fixes an execution-contract conflict and strengthens stop conditions.

However gate-(a) remains OPEN until an Owner-authorized TN12 run yields durable evidence for all required vectors. In particular:
- fee-floor/mass wiring must be valid before any vector is submitted; fee rejection cannot be counted as a covenant PASS;
- N6/N7/N8/N9 must reach their intended lock/provenance rejection layer;
- P must LAND and reach depth;
- same-cid successor must be read back from the chain and itself reach required depth;
- redeem/script provenance must byte-bind the on-chain spend to the reviewed artifact.

Any run performed without explicit dust-spend Owner GO is outside this accepted runbook and cannot be used as compliant closure evidence.

## State update

- gate-(a) read-only/broadcast-window conflict: **CLOSED at runbook layer**
- two-signal READY: **PASS direction**
- INCONCLUSIVE <=3 / repair-before-retry: **PASS direction**
- A′ recovery design: **unchanged / conditionally accepted**
- same-chain Shape-B: **unchanged / conditionally closed**
- gate-(a) deployed-path closure: **OPEN**
- production recovery builder / production funds-path wiring: **HOLD**

No production deployment, migration/restart, signing/broadcast, DB mutation, settlement/refund, key movement, or funds-path authorization is granted by this review.
