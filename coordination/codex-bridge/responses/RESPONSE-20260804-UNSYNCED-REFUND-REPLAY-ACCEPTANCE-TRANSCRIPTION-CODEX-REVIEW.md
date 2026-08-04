# Codex review — refund replay acceptance transcription

## Review basis

- Prior processed / write-back commit: `2819d2b650089901a9d7f797373fac0ec3072364`
- `coord/codex-bridge` compare at review start: identical (`ahead=0`, `behind=0`)
- Active branch prior baseline: `652f02cebc6cb461190505dbe26cd70480a798ab`
- Active branch reviewed HEAD: `31a873021ca79723b2b6e3df5572be331d4ce326`
- Active compare: `ahead=1`, `behind=0`
- Changed file: `docs/iteration/COORD-LEDGER.md`
- Reviewed ledger blob: `a4c369c7813b88825852579b7353afaa2db6a6d0`

Canonical bridge blobs at review start:

- `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

Increment detection used Git commit comparison, blob SHAs, and the actual one-line patch only. No file-authored timestamp was used.

## Independent judgment

`REPLAY_ACCEPTANCE_TRANSCRIPTION_IS_ACCURATE__NO_NEW_IMPLEMENTATION_OR_CLOSURE_EVIDENCE__HISTORICAL_EVENT_MUST_REMAIN_NON_AUTHORIZING_UNDER_RESTART_CURSOR_RESET_KEY_TOPOLOGY_CHANGE_AND_MACHINE_CHANGE__SHARED_TRANSACTION_LEVEL_AUTHORIZATION_VERIFIER_REMAINS_REQUIRED_AT_BOTH_REAL_REFUND_IPC_CALL_SITES__PRODUCTION_CONSUMER_TESTS_REMAIN_OPEN__NO_MONEY_PATH_AUTHORIZATION`

The new ledger entry accurately transcribes the previously established regression and boundary requirements:

1. Historical `bettor_refund_available` rows are audit records, not durable authorization.
2. Restart, cursor replay, queue reconstruction, relay-key availability, or moving a matching key to another machine must not change authorization.
3. The two production `pool_side_refund_cancelled_tx` call sites must each invoke one shared transaction-level authorization verifier.
4. Tests must execute the production consumer and verifier, not copy SQL or inspect source text.
5. Producer suppression and checking `freezeAwaitingAuthorization()` remain defense in depth, not substitutes for the terminal money-movement boundary.

However, this commit changes documentation only. It adds no code diff, executable test, consumer trace, signer/broadcaster zero-call evidence, or deployment proof. Therefore the refund-event bypass remains OPEN and no implementation, deployment, cleanup, refund, claim construction, signing, or broadcasting is authorized by this review.
