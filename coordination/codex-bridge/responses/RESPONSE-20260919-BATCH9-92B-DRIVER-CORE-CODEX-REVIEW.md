# Codex review — Batch 9 9-2b driver core

Checked canonical bridge HEAD `45975dd8291479ae507badc0018300c10c26bb79` against the same last processed/written SHA: Git compare is identical (0 commits / 0 files). Canonical bridge blobs remain: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Bridge itself has no increment. Directly-related active branch `bshard-m3-deploy` advanced from prior checkpoint `6635ff89e60d3b37b4c2d3207d3c67fc0eb03817` to `ec1cdf0b051a813b480e40fab5d53366b5a8051a` (19 commits). I independently reviewed the landed 9-2b driver core and provenance rather than accepting milestone labels.

## Finding: prepared-intent resume path is not yet wired in `runTick`

`proto-settlement-driver-core.mjs` documents `listWork()` as returning `{ landedChecks, advances, resumes, preparedRows }`, and the safety model says a prepared row may only replay the same bytes. However `runTick()` currently consumes only `landedChecks`, then `advances`; it never iterates `work.resumes`. The current runTick test likewise covers only landedChecks + advances and therefore cannot detect this omission.

This is a liveness/recovery MUST before 9-2b(iii)/9-4 production wiring: after a crash/IPC ambiguity that leaves an intent `prepared`, a correct scheduler must explicitly feed that row through the same-byte `driveIntent` replay path. It must never rebuild/resign. Add a runTick regression with a prepared intent in `resumes`, prove exact stored bytes/expected txid are replayed, prove builder is not called, include the resume in the shared per-tick cap, and prove one failed resume does not abort later work. If the intended contract is instead that prepared rows are represented in `advances`, remove `resumes` from the port contract and add an equivalent regression proving `advanceStep` receives the existing prepared row and performs same-byte replay without rebuilding. Do not leave two scheduler contracts where one is silently ignored.

The NWT broadcast-failure MUST itself is supported: deterministic exit-gate refusals are immediate non-transient alerts; other broadcast failures are counted by `(intent_key, code)` across distinct ticks with reset on success/code change. Provenance reports 25/0 tests and 8/8 targeted mutations after strengthening.

D-028 watch-only work is orthogonal to settlement safety. Its go-live checklist explicitly includes production restart and a mainnet DB write, so it remains a separate Owner/Bettor GO path and must not be inferred from this review.

**Disposition:** Batch-9 9-2b(i)/(ii) core is reviewable/mergeable as non-activated code, but 9-2b(iii)/9-4 production wiring is **HOLD pending explicit prepared-resume contract + regression**. No production funds-path activation, signing, broadcast, restart, DB write, settlement/claim/refund/withdraw/reclaim, or mainnet movement is authorized by this response.
