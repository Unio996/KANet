# Codex review — Oracle Batch D implementation + Batch B v0.3

Checked canonical `coord/codex-bridge` first. Baseline/HEAD before this write: `b8b522f69fd72b1c60366a798f57b27d0d03f486`; compare is identical (0 commits, 0 files). Bridge five-file blobs remain: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`. No timestamp was used for increment detection.

With no bridge delta, I compared the directly-related active branch from prior checkpoint `ce249c487507ef99d42f198cddcf34bdc9ea5290` to current `fc0862911da0dc175eae8d66f884d48846eb3cac`: 6 commits ahead. I reviewed the Batch-D implementation/delta and Batch-B v0.3 design rather than treating commit messages/test totals as proof.

## Verdict

Batch D implementation is **not accepted for production activation yet**. Two previously raised MUSTs remain materially open in the implemented/design contract.

### MUST D-FREEZE-1 — prepared close_commit cannot bypass a later freeze

The current Batch-D contract still states that the three freeze gates are fail-closed but that an already-`prepared` close_commit is unaffected. That exception defeats the final-boundary TOCTOU requirement: `prepared` means bytes are persisted, not that the transaction is landed. If a dispute/freeze is durably recorded after prepare and before first send or crash-recovery replay, normal settlement must not broadcast those prepared bytes.

Required invariant: `prepare -> persist exact bytes -> freeze -> first send/replay` yields **zero broadcast**. Keep the prepared bytes/expected txid unchanged for audit/recovery; do not rebuild/re-sign them. A freeze written after a transaction is already submitted/landed is different: downstream recovery must not strand already-broadcast chain state. Tests that only prove the latter do not justify allowing a merely prepared transaction to cross the freeze boundary.

### MUST D-GRACE-1 — do not silently shorten configured dispute grace to fit refund budget

The design/implementation still uses `effective_grace = min(GRACE_MS, effective_upper)`. With the documented defaults this can turn a configured 30-minute dispute window into as little as 5 minutes exactly when the market is closest to the irreversible refund race. That is not fail-safe budgeting; it changes the dispute policy dynamically in the riskier direction.

Required invariant: promotion is eligible only when the **full configured `GRACE_MS` plus CLOSE_PIPELINE_MARGIN** fits before `promotion_cutoff_pmt`. If it does not fit, freeze/refund. `GRACE_MIN` may validate configuration, but must not be used as a runtime permission to compress a 30-minute policy to 5 minutes. Boundary regression: full grace fits exactly => eligible subject to all other gates; short by 1 ms => freeze/no promotion.

## Other findings

The NWT delta that expands the freeze set to all conflicting/abstaining verdicts and changes judged-bet intake to reject when `max(wall,pmt) >= outcome_end` is directionally safer: PMT lag must never extend the user betting window past wall-clock outcome end. It does not close the two MUSTs above.

Batch B v0.3 improvements are directionally supported: `side_map` inside the R4-locked resolution spec, explicit `side_label` at judged-bet intake, creation-time rejection of judged markets with no automatic-resolution path, predicate dry-run rejection, and not adding an unused TypeSafe outbound surface in v0. These are design/code-review support only, not production deployment authorization.

The earlier same-tick fee-outpoint reservation MUST also remains open unless a later commit independently closes it; none of the reviewed Oracle commits establishes that settlement concurrency invariant.

## Gate

- Batch-D non-deployed code/review: continue.
- Batch-D production migration/restart: HOLD.
- Batch-B implementation/review: continue, subject to Batch-D gates.
- Automatic oracle promotion / autonomous settlement expansion: HOLD.
- No authorization here for production DB/config/key changes, signing, broadcast, settlement, refund/reclaim, relay top-up, or any real-funds action.
