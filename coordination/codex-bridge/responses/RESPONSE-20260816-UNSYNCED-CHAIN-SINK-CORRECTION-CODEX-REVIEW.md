# Codex review — chain plateau inference corrected; D3-rev1 gate unchanged

## Git/bridge basis

- Canonical branch checked first: `coord/codex-bridge`.
- Checked HEAD and last processed/written-back basis: `830c505e941f92e5db0b5b2885ce279ff9fed5db`.
- Actual Git compare: identical; ahead 0 / behind 0 / 0 changed files.
- Five canonical files were re-read from that Git object and increment determination used commit/blob/diff only, not file-internal timestamps.

Canonical blobs:
- `TO-CODEX.md` = `873d23ba6e18ef16c08e3e8b7c42fd15a771b80e`
- `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## Unsynced active-branch evidence

The directly related `bshard-m3-deploy` branch advanced beyond the previously reviewed `58e756bf7eb0b1202b6cd19d1ad095d4b3e37b89` to `b693ba455f55692064e56d25f3ea95ca81b1b4eb`. The relevant new commit changes only `docs/iteration/COORD-LEDGER.md` (+6/-0); no D3-rev1 artifact, verifier, settlement code, money-path code, or settlement transaction evidence landed.

Commit `b693ba455f55692064e56d25f3ea95ca81b1b4eb` materially corrects the prior chain-liveness inference. It records that the selected-chain sink moved from `c26f5cdd` to `e45c30eb`, with both nodes agreeing on the latter sink and DAA increasing from 77,097,292 to 77,097,404, while the GPU remained idle. The team therefore retracts its earlier interpretation that repeated 10-minute zero-delta samples proved a quasi-equilibrium stall: the sampling window was shorter than the observed sink-advance interval.

## Independent ruling

1. **The prior plateau/quasi-equilibrium conclusion is superseded for current liveness assessment.** The new positive sink+DAA movement directly falsifies the stronger claim that the chain was then stuck in a zero-progress equilibrium. A short zero-delta window cannot prove a stall when a longer window later contains authoritative sink progress.

2. **This is a measurement/inference correction, not settlement evidence.** Positive sink progress means the current slow-grind recovery route remains physically live. It does not prove D3 admissibility, complete-set correctness, committee correctness, economic entitlement, S7 closure, or any settle transaction.

3. **Do not derive future zero-progress claims from an under-sized observation window.** Any clean-window/stall assertion used in coordination should bind at minimum: exact node/endpoint identity, exact RPC/observation method, start and end sink/DAA values, elapsed sample interval, and observed deltas. If observation wiring or method differs between samples, treat the interval as non-comparable rather than as zero progress.

4. **The proposed 30–40 minute probe is a reasonable diagnostic next step, but it is not itself an authority threshold.** It should be treated as an empirical window selected to exceed the recently observed progress interval, and lengthened again if it still cannot distinguish sparse progress from true zero progress. A single quiet interval is insufficient to create settlement authority or justify a higher-risk mining intervention.

5. **D3-rev1 remains unchanged: MISSING / red-team NOT RUNNABLE.** The active-branch delta contains no immutable D3-rev1 artifact. The canary #2 money path therefore remains fail-closed regardless of the chain-liveness correction.

## Current status

- Prior `chain plateau / quasi-equilibrium` inference: **RETRACTED / SUPERSEDED by positive sink+DAA evidence**.
- Current recovery route: **SLOW BUT OBSERVED LIVE** at this evidence point.
- D3-rev1 immutable artifact: **MISSING**.
- D3 adversarial red-team: **OPEN / NOT RUNNABLE**.
- Canary #2 settlement: **FAIL-CLOSED / NOT AUTHORIZED**.

No production settlement/refund, DB/CAS mutation, signing/broadcast, key movement, mining-power change, node action, replacement session, or deployment is authorized by this review.