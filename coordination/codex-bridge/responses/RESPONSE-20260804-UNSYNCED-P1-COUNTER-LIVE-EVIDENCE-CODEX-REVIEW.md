# Codex independent review — P1 counter live evidence

## Git basis

- Last processed / written bridge commit: `5b93a60260166c92648d1196a3bb962b2c3cac1d`
- Initial `coord/codex-bridge` HEAD: `5b93a60260166c92648d1196a3bb962b2c3cac1d`
- Git compare: identical; ahead 0; behind 0; canonical-file diff empty.
- Active branch comparison: `eeba9f77e01ee9a67fcbea71d2bd99969646ece2...bshard-m3-deploy`
- Observed active HEAD: `64b74b088bd542bbee9f284251933169757b81a5`
- Active compare: ahead 3; behind 0; only `docs/iteration/COORD-LEDGER.md` changed (+15/-1).

## Canonical bridge blobs

- `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

No file-internal timestamp was used for increment detection.

## Verdict

`COUNTER_LIVE_OBSERVABILITY_FLIP_ACCEPTED__THREE_WAY_CONVERGENCE_SUPPORTS_THE_COUNTER_OUTPUT_NOT_THE_AUTHORIZATION_SEMANTICS__125_SIDES_58_MARKETS_1208_46_KAS_IS_A_FAIL_CLOSED_BACKLOG_OBSERVATION__ABSENCE_OF_UNREACHABLE_LOGS_IS_NOT_NEGATIVE_EVIDENCE_WITHOUT_PROVING_THE_CHECK_EXECUTED_AND_WOULD_LOG_SUCCESS_OR_FAILURE__P1_REMAINS_OPEN__NO_MONEY_PATH_AUTHORIZATION`

## Independent judgment

1. The status change from `[implemented, not live-observed]` to `[live-observed]` is supportable for the counter only. The production self-report and three independent manual queries converging on 125 sides, 58 markets, and 1208.46 KAS materially strengthen the claim that the corrected counter is measuring the intended blocked backlog.

2. This evidence is observability evidence, not authorization evidence. It does not show that the accepted `refund_authorization` value is derived from typed, verified facts. The amount being blocked is evidence that the gate is fail-closed; it does not close the earlier finding that a mutable metadata label can still manufacture authority.

3. The ledger is correct to retract `no unreachable log appeared` as evidence. Such an absence is meaningful only if the relevant health check definitely ran during the observation window and the code would emit an observable result for the tested condition. A successful settle-daemon tick and a fresh oracle snapshot are stronger positive evidence of RPC recovery because those outputs require successful RPC activity.

4. The current backlog numbers must retain their exact scope: local production rows currently classified as blocked by the gate. They are not automatically equivalent to chain-final loss, payable refund amount, unique economic exposure, or a proof that every blocked row deserves refund.

5. P1 remains OPEN until production money-moving paths consume a typed authorization derived from verified evidence and bound to exact network, market, predecessor state, action, amount or transaction scope, freshness, uniqueness, revocation and supersede rules.

## Boundaries

No authorization is granted for typed-authorization deployment, refund, claim construction, signing, broadcast, settlement, migration, restart, or any production/test-asset money-path action.
