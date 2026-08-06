# Codex review — unsynced precondition 5 runnable red case

## Git basis

- bridge comparison base and initial HEAD: `93640606419ab21d49eb5843ecafad03c3764a03`
- bridge compare status: `identical` (`ahead=0`, `behind=0`)
- active branch previous reviewed HEAD: `c8b147358662222c32d3a8889280d041509d260d`
- active branch reviewed HEAD: `761aea3f8d050058678f7bdf4cd087dc781b6674`
- active compare: `ahead=4`, `behind=0`
- directly reviewed implementation commits: `c1db4c79cf561cbb2610d0d188108f121bac7aa3`, `2ac6d83ba6675ac96dafe8dc73d2a492a6042fe6`

Canonical bridge blobs remained unchanged:

- `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

No file-internal timestamp was used for increment detection.

## Verdict

`RUNNABLE_REAL_TICK_CASE_IS_A_MATERIAL_TESTING_GAIN__THE_CURRENT_RED_RESULT_IS_CORRECTLY_NOT_A_BEHAVIOR_PASS__A0_I0_AND_TARGET_STATE_ASSERTIONS_REMOVE_MULTIPLE_FALSE_GREEN_MODES__BUT_POOL_SETTLER_TICK_ALLOWLIST_NOW_EXECUTES_A_PRODUCTION_WORKFLOW_AND_KASPA_RPC_URL_POINTING_TO_AN_UNREACHABLE_ADDRESS_IS_NOT_STRUCTURAL_NETWORK_CONTAINMENT__THE_FOUR_FIELD_POSITIVE_CONTROL_IS_STRONGER_THAN_A_SINGLE_FIELD_OR_NOT_X_ASSERTION_BUT_REMAINS_FIXTURE_FORGEABLE_AND_THEREFORE_DOES_NOT_BY_ITSELF_PROVE_DISPATCH_REFUND_EXECUTED__PRECOND5_OPEN__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Accepted findings

1. The new case is a real implementation gain: it drives the production `poolSettlerTick`, asserts database effects, and contains A0/I0 checks that distinguish “the path was never reached” and “the observation query is blind” from genuine zero traces.
2. Correcting the positive control from `status != unresolved_needs_authorization` to an affirmative target state removes a real third-state false green (`cancelled/min_pot_undersize`).
3. Requiring the conjunction of `refund_authorization`, `refund_dispatched_at`, `refund_tx_obj`, and `protocol_status='refunding'` is materially stronger than checking one mutable field.
4. Keeping the case red until a genuine positive arm exists is correct. A named RED is evidence of an open prerequisite, not a behavior regression and not closure.

## Remaining blockers

### 1. Network containment is still not established

The runner guard that requires `KASPA_RPC_URL` to point to an unreachable endpoint prevents accidentally inheriting an obvious live URL, but it does not make outbound effects structurally impossible. DNS, proxying, routing changes, service reuse, or another reachable sink can invalidate the assumption; a failed response also does not prove a request had no remote effect.

Before this production tick is accepted as safely executable in the harness, outbound RPC/HTTP/relay access must be denied at the process or socket boundary, or redirected exclusively to authenticated local fakes with a complete request ledger. The test must fail before module import when that containment is absent.

### 2. Export allowlisting does not contain the downstream call graph

Adding only `poolSettlerTick` to the export allowlist prevents direct calls to sibling exports, but the permitted function can still reach production DB writers, relay clients, chain readers, signers, or broadcasters through internal calls. The allowlist therefore proves entry-point restriction, not side-effect restriction.

The case needs a machine-enforced sink registry or equivalent interception proving zero calls to claim construction, signing, broadcasting, production relay, and production chain endpoints for every negative arm.

### 3. The four-field positive state remains fixture-forgeable

The four-field conjunction prevents accidental single-field seeding, but all four fields can still be inserted by fixture SQL. Calling that deliberate does not turn the state into proof that `dispatchRefund` executed. The positive arm should additionally bind to an observation that only the target call path can produce under the harness, such as a local fake invocation ledger containing the expected canonical request, a branch-specific immutable event with correlation ID, or an instrumented seam whose producer identity is checked.

The positive proof must also show the tick reached the intended authorization branch rather than another writer producing the same terminal fields.

### 4. The current RED cannot close precondition 5

The repository now proves that the case runs and that several false-green mechanisms were detected and corrected. It does not yet prove:

- a genuine `bettors_absent` positive arm;
- a genuine `committee_affirmative_unjudgeable` positive arm;
- structural outbound containment;
- zero signer/broadcaster reachability;
- full retry/restart/idempotency lifecycle;
- an independently attributable target-path trace.

Therefore precondition 5 remains OPEN. P1 remains OPEN and D4 remains BLOCKED.

## Safety boundary

This review authorizes no production code change, production RPC access, refund construction, claim construction, signing, broadcasting, metadata backfill, deployment, restart, migration, or other production money-path action.
