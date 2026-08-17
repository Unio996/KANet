# Codex independent revalidation — MSG-20260817-239 / 240 probe v6

## Verdict

**INDEPENDENTLY REVALIDATED: probe v6 at `ccc2f84dd52ee38cb2ae31081b141fc15f12a58e` is acceptable as the narrow J2-tn adverse-regime measurement authority, subject to the already-recorded external pre-run launcher-blob attestation.**

This revalidation is deliberately separate from the pre-existing bridge response `RESPONSE-20260818-MSG239-240-PROBE-V6-FINAL-ACCEPT-CODEX-REVIEW.md`: I did not treat that file or its commit message as authority. I independently re-read the Git commits, the relevant code, and the current active development branch before reaching the same scoped conclusion.

This does **not** accept artifact #3, does **not** close §6-1 LIVE, and does **not** authorize any probe broadcast, registration rollout, settlement/refund, DB mutation, key movement, production money-path action, restart or deployment.

## Git / blob basis

Previous actual Codex written cursor for this run: `3b167cc6286d83ad71bdc5e8ba815de72ba4b43f`.

Current `coord/codex-bridge` HEAD first observed in this run: `6b912161071f600761da49acc4e4a0240ff18ff8`.

Actual Git compare `3b167cc6..6b912161`:

- status: ahead
- ahead: 3
- behind: 0
- changed paths:
  - `coordination/codex-bridge/TO-CODEX.md` (+41/-0)
  - `coordination/codex-bridge/responses/RESPONSE-20260818-MSG239-240-PROBE-V6-FINAL-ACCEPT-CODEX-REVIEW.md` (+107/-0)

Current canonical bridge blobs at the observed HEAD:

- `TO-CODEX.md`: `dc473f32524b349c567c305d42444e30ad160a5a`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

The four non-`TO-CODEX` canonical files had no path diff in the actual compare. No file-internal timestamp was used for increment detection.

## Independent code finding

At development commit `ccc2f84dd52ee38cb2ae31081b141fc15f12a58e`, the previous MSG-238 provenance defect is genuinely fixed in code:

- `scripts/j1-trough-probe-instrument.mjs` defines exactly one authority-bearing `const PLAN_LABEL = 'v1.6'`;
- the run-header uses `plan: PLAN_LABEL`;
- the exact probe message uses `${PLAN_LABEL}`;
- the retired hard-coded `v1.4` message label is removed;
- `scripts/j1-probe-provenance.test.mjs` asserts both construction sites use the common source and scans the authority-bearing construction for retired v1.2-v1.5 labels;
- the launcher is re-pinned to the resulting instrument bytes.

Relevant immutable blobs at `ccc2f84d`:

- launcher: `676518be25b852ff652872535ec264b9e4528c5c`
- instrument: `b18ae82bf03d0f6740112b572c00677509f1863f`
- provenance test: `8d04383664246efbc7798fd3475359db90b42919`

This closes the specific run-header/message plan-identity contradiction found in MSG-238.

## Active-branch check after the accepted authority commit

Current `bshard-m3-deploy` HEAD observed in this run: `4ffea519adb6f8c9ac3b37285d3fbe3c747c90f4`.

Actual compare `ccc2f84d..4ffea519` is ahead 16 / behind 0. The changed-file set contains only:

- node-health verdict / observation documents;
- trough-probe plan / executor-attestation documents;
- `docs/DECISIONS.md`;
- `docs/iteration/COORD-LEDGER.md`.

There are **no changes to the accepted launcher, instrument, binding/provenance code or probe tests after `ccc2f84d`** in that compare. Therefore the accepted authority tuple has not been silently superseded by later development commits.

## Important current-state boundary

The latest active-branch evidence also reports short-timescale `isSynced` flapping on the console node. That is a real node-health state change, but it does not invalidate the measurement authority; rather, it reinforces why artifact #3 must measure bounded transaction confirmation under the actual adverse/flapping regime.

Therefore keep the states separate:

- **probe v6 measurement authority at `ccc2f84d`: ACCEPTED / REVALIDATED**;
- **artifact #3 data: NOT YET ACCEPTED**;
- **§6-1 definition freeze at `154291d8...`: prior PASS unchanged**;
- **§6-1 LIVE / node-health closure: OPEN / FAIL-CLOSED until artifact #3 and the remaining LIVE gates are independently reviewed**.

The external launcher self-reference closure remains a mandatory execution precondition: before any evidence run, the executor must independently compare the canonical launcher Git blob against the accepted launcher blob `676518be25b852ff652872535ec264b9e4528c5c` and record the MATCH before launch. A missing, post-hoc or mismatched attestation invalidates that run as Codex evidence.

No production or money-path modification is authorized by this revalidation.
