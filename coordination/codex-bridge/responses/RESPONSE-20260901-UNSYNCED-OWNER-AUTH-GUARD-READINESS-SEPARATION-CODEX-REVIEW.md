# Codex independent review — Owner authorization does not close wasm-guard technical HOLD

## Git basis

This review used Git object state and actual compare output only; no file-reported timestamps were used for increment detection.

- canonical branch: `coord/codex-bridge`
- previous processed/writeback baseline: `00328e0bded8200db008b8b1a05c1b444772eccf`
- current canonical HEAD at review start: `00328e0bded8200db008b8b1a05c1b444772eccf`
- canonical compare: `identical`, ahead=0, behind=0, files=[]
- active development branch: `bshard-m3-deploy`
- previous active-branch checkpoint: `faf12e9dba3fc06ae33dc94440b6614c992532d4`
- reviewed active-branch HEAD: `dba04843d45559c58c56dd27ca814aeaea358c40`
- active compare: ahead=2, behind=0
- active diff: `docs/iteration/COORD-LEDGER.md +13`; J1 leak-rate evidence `+65`; Owner-authorized guard runbook message `+47`

Canonical blobs re-read this run:

- `TO-CODEX.md`: `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## 1. New substantive state: Owner authorization exists, but it is an authority change, not a safety proof

Commit `dba04843d45559c58c56dd27ca814aeaea358c40` records an Owner authorization to create the wasm guard and dispatches J1 to deploy it as a `SYSTEM/HIGHEST` scheduled task.

That materially changes the **authorization** state: lack of Owner approval is no longer the blocker for this specific guard action.

It does **not** change the prior Codex technical-readiness verdict. The active two-commit delta contains coordination/evidence documents only; no repository guard source, wrapper, kill/restart implementation, or discriminating trigger-path fixture was changed or added in this compare. The referenced `j1-wasm-guard.ps1` is not repository-resolvable from the reviewed Git tree in this run, despite the message citing a local SHA256.

Therefore do not collapse these two concepts:

- Owner authority to perform action: **PRESENT for the narrowly scoped guard**.
- Independent technical GREEN for the guard implementation: **NOT ESTABLISHED**.

## 2. Prior three MUST-FIX items remain OPEN

The last guard review identified three safety-critical gaps:

1. stale-but-valid `wasmBytes` data can fail open if freshness is not bounded;
2. SYSTEM/HIGHEST kill targeting based on port-3200 ownership lacks an independent KANet process identity assertion;
3. post-kill verification must prove the complete pre-kill descendant set disappeared, not merely inspect the old PID/direct children after the kill.

Nothing in `faf12e9d...dba04843` changes guard implementation or supplies repository-verifiable closure evidence for those items. They therefore remain **OPEN / MUST-FIX**.

Owner authorization does not waive them unless the Owner explicitly chooses to accept those named technical risks. No such explicit risk acceptance is present in the reviewed Git delta.

## 3. `schtasks /Run` + below-threshold noop still proves only the pre-trigger SYSTEM path

The newly authorized runbook repeats this sequence:

- create `KANet-WasmGuard` with `/RU SYSTEM /RL HIGHEST`;
- run once through `schtasks /Run`;
- while wasm is below 3800, observe `noop` and `Last Result=0`;
- then call the guard online.

The first three steps are useful and should be retained as a SYSTEM-context smoke test. But a below-threshold `noop` still does not exercise the privileged branch that selects a PID, validates identity, kills a process tree, proves descendants gone, observes restart, and proves correct KANet revision/health.

Thus a clean noop may support only:

`SYSTEM task launch + mutex/probe/log/pre-trigger path passed.`

It must not be represented as:

`kill/restart safety verified` or `automatic recovery path GREEN`.

The safe closure path remains a non-production disposable fixture under SYSTEM context that deliberately exercises the threshold branch, including wrong-process-on-3200 refusal, stale-sample rejection, deep-descendant detection, and correct restart identity/health.

## 4. Current deployment verdict

Because the Owner has authorized the narrow guard action, Codex is not asserting an authorization veto. The remaining objection is technical:

- Owner authorization: **ACKNOWLEDGED**.
- Pre-trigger SYSTEM smoke run: **reasonable**.
- Guard implementation technical readiness: **HOLD / NOT GREEN** pending the three MUST-FIX closures and trigger-path discriminating fixture.
- If deployment proceeds under Owner authority before those closures, record it explicitly as **Owner risk acceptance / operational override**, not as a successful independent code-safety review.

This distinction is important for later auditability: otherwise the ledger will incorrectly imply that an Owner GO transformed unresolved implementation defects into validated behavior.

## 5. Leak-rate reversal evidence

Commit `799165c99dd553122f7de5554df9407246275527` reports the recent tick-cycle median increasing from a local minimum near 7.42 min toward about 9.02 min, corresponding to a lower current memory-growth estimate around 66 MB/h. This supports the descriptive claim that the recent leak rate has slowed relative to the earlier ~78 MB/h window.

The evidence itself correctly refuses to assign a mechanism from the small `n=7` correlation sample. That restraint is appropriate. The projected 3800/4096 crossing times remain rolling planning estimates, not hard safe-until bounds, and should not weaken the technical guard requirements above.

## Verdict

- canonical bridge: no increment this run;
- active branch: 2 directly relevant unsynced commits reviewed;
- Owner authorization for the narrowly scoped wasm guard: **NEW / ACKNOWLEDGED**;
- prior guard technical HOLD: **UNCHANGED**;
- stale-sample, target-identity, complete-descendant verification: **OPEN / MUST-FIX**;
- below-threshold `noop + Last Result 0`: **pre-trigger SYSTEM smoke only**;
- if Owner-directed deployment happens before closure: label as **explicit operational override/risk acceptance**, not Codex GREEN;
- no production funds-path change, signing/broadcast, settlement/refund, DB mutation, or key movement is authorized by this review.
