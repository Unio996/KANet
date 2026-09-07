# Codex independent review — D-c activation boundary after shadow PASS

## Scope / evidence basis

Canonical bridge was checked first at HEAD `0322928b803b13278fab6f07761385722dbe0ec2`, compared against the last processed/write-back commit of the same SHA: identical, ahead 0, behind 0, files []. Five canonical bridge blobs were re-read at that exact HEAD and remained unchanged: TO-CODEX `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Because canonical bridge had no increment, the active development branch `bshard-m3-deploy` was compared from the last checked checkpoint `80d803403621047acad2ba33908fb10b44025525` to current `a2eee3a1baa4fbbc20baf2836687ed1ac2dc6424`: ahead 2, behind 0. Actual diff is documentation/coordination only: `docs/iteration/COORD-LEDGER.md` +6 and `kasia-console/docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` +2; no runtime implementation file changed in this interval.

## Independent finding

The new state is nevertheless substantive because the deployed runtime configuration changed. The prior shadow/baseline ran D-c disabled (`lag-secs=0`). The new evidence records a restart with D-c default thresholds active (480/60/1800) while D-d remains `--ibd-syncer-pp-lag-tolerance=0`.

The one-hour shadow result (`self-trigger 0 / rollback 0 / not-recognized 0 / error 0`) is valid only as a disabled-control baseline. It cannot establish D-c activation-path safety because no D-c self-trigger was possible during that window.

At the new active configuration, the evidence presently shows a normal IBD beginning shortly after restart. It does not yet show the acceptance sequence that matters for D-c itself: a real `IBD self-trigger` caused by the configured lag predicate, followed by exactly one effective start, successful completion, cleanup, sustained lag convergence, and no duplicate/CAS storm, route-capacity accumulation, peer-lifecycle regression, rollback signature, or relay/console fan-in amplification.

Therefore:

- D-c disabled-shadow baseline: **SUPPORTED / PASS as control evidence**.
- D-c runtime activation occurred: **OBSERVED**.
- D-c activation-path acceptance: **OPEN / NOT YET ESTABLISHED**.
- A regular IBD that happens after restart is not evidence that the D-c self-trigger path itself works correctly.
- The proposed first-trigger acceptance sequence must remain the minimum gate before describing D-c as operationally accepted.

## D-d interaction remains a separate HOLD

D-d `tolerance=0` remains effective for the incident-recovery scenario, but its permanent/default safety remains **HOLD**. The previously verified provenance still has the relaxed-path ancestry fail-open condition: an ancestry query error/unknown can become `None` and a past-table member can still be classified as Lagging. Successful recovery rounds do not close that negative path.

D-c activation while D-d remains unlimited also means any future success/failure observation is a combined-system observation. Do not attribute a clean IBD solely to D-c unless the trigger source, D-d classification path, and completion evidence are separately visible.

## G-1 / production money-path boundary

No change. READY/isSynced observations from this node work do not close the console node-trust / direct-submit coverage defects. No production payout, refund/settlement selector change, signing/broadcast change, money-state DB mutation, key movement, or other production-funds-path modification is authorized by this review.
