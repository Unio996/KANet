# Codex review — unsynced `call_module_export` production-tick allowlist expansion

## Git basis

- last processed / written-back bridge commit: `dd96eff10fdbcf09e01f3f0fb9e9af56b5a75bb6`
- bridge HEAD at review start: `dd96eff10fdbcf09e01f3f0fb9e9af56b5a75bb6`
- bridge compare: `identical` (`ahead=0`, `behind=0`, no changed paths)
- active branch previously reviewed HEAD: `18bc359b8903882efa97bc25dba73179c6e65e30`
- active branch reviewed HEAD: `208cdd8c72df0c3730cad190543e0e44017ba837`
- active compare: `ahead=6`, `behind=0`

Canonical bridge blobs remained unchanged:

- `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

Increment detection used only Git refs, compare metadata, blob identities, and actual path diffs. No file-internal timestamps were used.

## Reviewed unsynced changes

Directly relevant active-branch changes:

- `docs/2026-08-04-call-module-export-action-spec.md`: v3 proposal to add `pool-market-settler / poolSettlerTick` to the test-framework module allowlist;
- `docs/2026-08-06-precond5-verification-interrupt-no-autorefund-test-design-v0.1.md`: status and acceptance refinements;
- `docs/2026-08-06-nwt-seven-review-criteria-v1.0.md` and verdict document: review-artifact corrections;
- `docs/iteration/COORD-LEDGER.md`: current approval conditions and pre-code checklist.

The current implementation at active HEAD still exposes only three allowlist entries in `runner.mjs`; `poolSettlerTick` has not yet been added. Therefore this review concerns a design/approval state, not a landed implementation.

## Independent ruling

`ADDING_POOL_SETTLER_TICK_IS_A_SECURITY_BOUNDARY_EXPANSION_NOT_A_ROUTINE_ALLOWLIST_ENTRY__THE_CURRENT_PRECODE_CHECKLIST_CORRECTLY_RECOGNIZES_DB_WRITES_AND_EXTERNAL_CALLS_BUT_EXPECTING_OUTBOUND_CALLS_TO_FAIL_IS_NOT_A_CONTAINMENT_MECHANISM__TEST_EXECUTION_MUST_MAKE_NETWORK_AND_RELAY_SIDE_EFFECTS_STRUCTURALLY_IMPOSSIBLE_OR_ROUTE_THEM_TO_VERIFIED_LOCAL_FAKES__A_FAILED_EXTERNAL_CALL_MAY_STILL_HAVE_OCCURRED_OR_LEFT_REMOTE_OR_LOCAL_EFFECTS__MODULE_IMPORT_AND_TICK_EXECUTION_MUST_BE_PROVEN_TO_USE_ONLY_THE_ISOLATED_TEST_DB_AND_TEST_FIXTURE_SET__NO_PRODUCTION_TICK_ALLOWLIST_IMPLEMENTATION_SHOULD_BE_ACCEPTED_UNTIL_EFFECT_CONTAINMENT_AND_POSITIVE_NEGATIVE_CONTROLS_ARE_MACHINE_ENFORCED__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Findings

### 1. The proposed entry changes the action's trust class

The existing entries call a verifier, an automatic claim consumer, or a claim builder. The proposed entry invokes the production settlement tick, which can mutate lifecycle state and traverse relay, HTTP, and chain-reader paths.

That is not merely one more allowed export. It changes `call_module_export` from a narrowly bounded function-call seam into a test-controlled production workflow driver. The spec correctly acknowledges this distinction; it must also be reflected in code structure and acceptance tests, not only prose and review discipline.

### 2. “Outbound calls are expected to fail” is not safe isolation

A request can:

- reach a real endpoint before returning an error;
- write local state before the network failure;
- partially succeed remotely and fail during response handling;
- be retried or queued below the observed call site;
- contact a service accidentally available in the test environment;
- produce an ambiguous timeout after the remote side has acted.

Therefore the test must not depend on relay/HTTP/chain calls naturally failing. Failure is an observation, not containment.

Before `poolSettlerTick` is allowlisted, all effectful sinks reachable from the selected fixture must be either:

1. structurally disabled before module import and tick execution; or
2. redirected to explicit, verified local fakes whose address, process identity, and request ledger are asserted by the test.

An allowlist key alone does not constrain the downstream call graph.

### 3. Local-write-before-external-call ordering is a required control, not a later diagnostic

The ledger's A-F checklist correctly raises the possibility that a failed external action can still leave a local write. The test design must enumerate every reachable path for the selected fixture and classify ordering:

- local write before external call;
- external success before local write;
- transaction wrapping both local operations;
- error catch that converts failure into another persisted state.

The test's “zero refund trace” assertion is otherwise vulnerable to both false positives and false negatives. A fixture that never reaches the relevant branch can remain perfectly clean while proving nothing.

### 4. Test-DB isolation must be verified at the production module's actual DB client

The current runner guard checking both `DB_PATH` and `KANET_DB_PATH` before dynamic import is a real improvement. For `poolSettlerTick`, acceptance must additionally prove that the imported settler and every imported DB consumer resolve the exact same isolated database file.

Required evidence should include:

- canonical resolved path from the runner;
- canonical resolved path observed inside the production DB client;
- inode/file identity where the platform supports it, or equivalent byte-level marker proof;
- a sentinel row visible through the production module but absent from the production/default database;
- a negative control in which one environment variable is intentionally wrong and import is rejected before the module enters the ESM cache.

Checking environment strings alone is weaker than proving the actual opened database identity.

### 5. Fixture-scope proof must be mechanical

The condition “the tick processes only rows seeded by this test” cannot rely on an empty-table observation taken before execution. The harness must use a fresh isolated database or a unique run namespace and prove:

- exact candidate row set before tick;
- exact row set read/processed by the tick;
- no pre-existing eligible rows;
- no cross-test rows introduced concurrently;
- deterministic cleanup or disposable database destruction after the run.

A count of zero at one moment is not an invariant.

### 6. Import-time and background activity need explicit controls

The current grep finding that timers appear only in named cron functions narrows one risk shape but does not prove import purity or process quiescence. Acceptance should prove:

- importing the module alone performs no DB mutation or outbound operation;
- calling one exported tick does not register persistent timers, listeners, workers, or retry loops;
- the process exits naturally after the call;
- all handles after completion are expected and enumerated.

Behavioral controls are necessary because cross-module imports can create side effects without matching `setTimeout` or `setInterval` in the reviewed file.

### 7. Required adversarial controls before implementation acceptance

At minimum:

1. wrong `DB_PATH` or `KANET_DB_PATH` -> reject before import;
2. non-allowlisted export -> reject without module import;
3. import-only control -> zero writes, zero outbound attempts, natural process exit;
4. fixture not eligible -> tick reaches candidate scan but performs no refund-side transition;
5. verification-interrupted fixture -> stable blocked/frozen non-authorizing state, zero refund construction, zero signer, zero broadcast;
6. legal positive routing fixture -> proves the tick and observation seam are live without using production money-path endpoints;
7. outbound sink unexpectedly available -> harness still prevents real contact and fails loudly;
8. simulated external failure after a local pre-write -> test detects and classifies the persisted trace;
9. new or unclassified outcome -> exhaustive handler fails loudly;
10. repeated invocation -> idempotent lifecycle result and no duplicate economic action.

The positive control must not be a whitelist metadata label standing in for evidence-derived authorization.

## Status

- allowlist v3 design recognition of the trust-boundary expansion: accepted;
- current A-F pre-code checklist: useful but incomplete;
- “expected outbound failure” as isolation: rejected;
- production tick allowlist implementation: not yet landed and not authorized by this review;
- precondition 5 executable proof: still absent;
- P1: OPEN;
- D4: BLOCKED.

No refund, claim construction, signing, broadcasting, metadata backfill, deployment, restart, migration, production database write, or production money-path change is authorized.