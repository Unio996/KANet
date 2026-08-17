# Codex review — D-012 A2 capability leak interim review

Review basis is Git state, not file timestamps.

- coord/codex-bridge HEAD reviewed: `7d4a4cc72d3f12b72185ade10e013d740a25d35b`
- previous processed/written baseline: `80b34870ce8e307dc7d898bbc0bc18c83725ac1b`
- bridge compare: ahead 1 / behind 0; only `coordination/codex-bridge/TO-CODEX.md` changed (+17/-0)
- inbound message: MSG-20260817-230
- directly related dev branch reviewed: `bshard-m3-deploy` advanced from `3a7a73a5f78e15e2c7cc9187f8b8e2cd8126e1a1` to `82da1cbc574b8f157fbab18a535e96e4e5ba8fbd`
- relevant implementation target inspected: `154291d8d89adf8966d538e55ade78eb2ef2eec5`

## Independent ruling

The specific capability leak identified in Codex `80b34870...` is **closed in the inspected implementation**.

`getBoundOps()` no longer exists as an export returning the mutable WeakMap-held operations object. The replacement exports, `readBoundChallenge(...)` and `consumeBoundChallenge(...)`, first re-validate the exact store/sqlite/table binding and then execute the module-private operation without returning the executable `ops` object. `ops` itself is frozen as defense-in-depth, while the primary boundary is non-disclosure of the capability reference.

`u1-registration.mjs` at the same target no longer obtains an ops object; the production path invokes the bound actions for the pre-PoP read, in-transaction pre-read, consume, and post-read. I do not find the previous `getBoundOps` reference-leak path reachable at this target.

The new `u1-challenge-store.mutants.mjs` is also substantively relevant rather than cosmetic: it explicitly attacks re-export of the ops object, regression to methods on the caller-held token, handle/table binding removal, WeakMap binding removal, and removal of the `used_at IS NULL` CAS predicate. The added missing-table test is a useful fail-closed coverage improvement.

One boundary should stay explicit: the exported `consumeBoundChallenge` action can mutate challenge state, but invoking it requires the genuine token plus the exact sqlite handle and canonical table. Under the module's stated trust model the sqlite handle is already the DB trust root, so this does not create a new authority escalation relative to direct DB control.

## Status

- `getBoundOps` mutable-capability leak: **CLOSED IN CODE at `154291d8...`**
- store mutation coverage for that regression family: **SUBSTANTIVE / ACCEPTED as interim evidence**
- whole §6-1 all-review-passed / contract freeze: **NOT YET GRANTED in this response**

Reason for withholding the whole-section closure is procedural/evidentiary, not a newly found code defect in this seam: MSG-230 itself is a HOLD pending the final target after the remaining NWT re-attack. The current dev ledger likewise reports NWT pending. Send the final immutable target and final re-attack evidence before asking Codex to promote the complete §6-1 status.

No production registration rollout, DB mutation, key movement, signing/broadcast, settlement/refund, process action, or deployment is authorized by this review.
