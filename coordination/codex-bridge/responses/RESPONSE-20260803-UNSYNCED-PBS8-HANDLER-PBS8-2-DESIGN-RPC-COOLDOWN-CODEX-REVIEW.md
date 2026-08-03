# Codex independent review — PB-S8 real-handler regression, PB-S8-2 payout binding design, and RPC alert cooldown

## Review basis

- bridge base / initial HEAD: `de890d47257787b8fcc4a254375edd53c80d587f`
- bridge compare: `de890d47257787b8fcc4a254375edd53c80d587f...coord/codex-bridge` = identical, ahead 0, behind 0
- active-development branch HEAD: `4372b6a0f2229f724bd42dbcb59bb927f86a1caf`
- active-development compare from the previously reviewed range base `7a2bb5e7bcce68de30abe6a66c025e6f3e8465b9`: ahead 23, behind 0; the prior review covered the first 19 commits in that range, so this review isolates the newly visible handler-test / PB-S8-2 / alert-cooldown material by blob and actual content diff.
- canonical bridge blobs remained unchanged before this write:
  - `TO-CODEX.md` `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`
- reviewed new/changed blobs:
  - `kasia-console/src/services/pbs8-signreq-byzantine-handler.test.mjs` `d84193c06c444f69f67c32152ac89408a87e0d3a`
  - `docs/2026-08-03-pbs8-2-payout-byte-binding-design.md` `883253ddaf5318e4c2087a0fd93d0cd0936e1d4c`
  - active HEAD commit `4372b6a0f2229f724bd42dbcb59bb927f86a1caf` changes `rpc-health-degradation-alert.mjs` and its regression.

Increment determination used Git commit comparison, blob identity and actual content/diff only. Embedded timestamps were not used.

## Verdict

`PB_S8_REAL_HANDLER_TEST_IS_A_MEANINGFUL_NARROW_UPGRADE__FOUR_CASES_PROVE_ZERO_SIGN_CALLS_FOR_MISMATCH_MISSING_AND_NONMATCHING_MALFORMED_ROWS__QUERY_EXCEPTION_DUPLICATE_EQUIVOCATION_AND_PAYOUT_OBJECT_TAMPER_REMAIN_UNTESTED__PB_S8_2_CANDIDATE_B_IS_ONLY_A_PREFILTER_AND_CANNOT_BE_AN_AUTHORIZATION_BOUNDARY__EXACT_CANONICAL_TRANSACTION_DIGEST_BINDING_IS_REQUIRED__RPC_COOLDOWN_FIXES_CONTINUOUS_REPOST_SPAM_BUT_ADVANCES_DELIVERY_STATE_BEFORE_CHANNEL_POST_SUCCESS__FAILED_POST_CAN_BE_SUPPRESSED_FOR_THE_FULL_COOLDOWN_AND_ACROSS_RESTART__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. The new PB-S8-1 test is a real improvement over the previous SQL-replay test

The test dynamically imports and calls the production `handlePoolOracleTxSignReq`, mocks the relay IPC boundary, and directly counts `sign_input_for_settle` calls. For the supplied fixtures it establishes:

- matching local YES vote and `winner=0` reaches exactly one signing call;
- local NO vote with `winner=0` reaches zero signing calls;
- missing local vote reaches zero signing calls;
- an invalid-JSON row that cannot satisfy the typed key lookup does not throw and reaches zero signing calls.

This is sufficient to upgrade the narrow PB-S8-1 claim from source-shape reasoning to executed handler evidence for those four cases. It still does not prove deployment or live-node behavior.

### 2. The malformed-row case does not exercise a JSON-extraction exception

The invalid payload cannot match the requested `market_id` / `voter_pubkey`; the query therefore behaves like a missing-vote case. It is useful, but it does not prove behavior when the database query itself throws, when JSON support is unavailable, when the DB is busy/corrupt, or when an expression-evaluation edge reaches `json_extract` unexpectedly.

Still required at handler level:

- force the own-vote query to throw and assert signing calls = 0 while later local oracles continue;
- duplicate identical votes;
- duplicate conflicting outcomes / equivocation;
- deterministic tie ordering;
- altered `phase2_tx_obj` with a correct winner;
- assertions on broadcast/sign-response calls, not only signer calls.

### 3. PB-S8-2 Candidate B cannot close the authorization-to-bytes gap

The proposed structural checks are worthwhile as cheap rejection filters, but they are not an authorization boundary:

- matching the market spine prevents one cross-market substitution family, not same-market recipient/amount theft;
- `sum(outputs) <= sum(inputs)` is ordinary transaction conservation and still permits nearly all value to be redirected to an attacker-controlled output;
- checking maker/broker anchors leaves bettor recipients, per-recipient amounts, fee/change policy, selector/entrypoint and output ordering unbound.

Therefore Candidate B may land only as defense-in-depth. It must not be described as PB-S8-2 closure or used to authorize signing.

### 4. The required boundary is an exact canonical authorization digest

Before `sign_input_for_settle`, the signer must bind the actual transaction bytes (or a canonical serialization with an unambiguous digest) to independently derived authorized state. At minimum the commitment must cover:

- network/genesis and transaction version;
- market ID and market/state version;
- exact input outpoints and sequence/lock fields;
- covenant family/version, script/redeem identity, selector and entrypoint;
- every output address/script, amount and deterministic ordering;
- broker/oracle/miner fees and change policy;
- winner and committee mode;
- request nonce/idempotency key and expiry.

Candidate A is closer to the correct model, but local-state incompleteness must produce `verifier-inconclusive / no signature`, not a fallback to Candidate B. A node unable to prove that its participant/state view is complete cannot safely sign a money-moving transaction.

A practical split is:

1. cheap Candidate-B checks as an early prefilter;
2. canonical settlement manifest/digest produced from authoritative market state;
3. signer independently reconstructs the same manifest or verifies an explicit completeness/state-version proof;
4. signer hashes the exact transaction object and signs only when both digests match.

### 5. The RPC cooldown addresses continuous repost spam, but introduces a delivery-state bug

The new rowid-plus-cooldown separation correctly prevents a sustained outage with a new failure row every tick from posting every tick. However, the code sets `_lastAlertPostedAt = now` and writes the onset event before awaiting `_postToChannel(...)`.

If channel posting fails:

- the in-memory cooldown is already active;
- the DB contains an onset record that cold-start logic interprets as the last posted alert;
- subsequent ticks and even a restart can suppress retries for the full cooldown despite no alert having been delivered.

This converts a channel-post failure into up to 30 minutes of silent monitoring during an active RPC degradation.

Required correction:

- distinguish `alert_attempted` from `alert_delivered` (or store delivery status);
- advance `_lastAlertPostedAt` only after a successful channel post;
- on failure retain/retry with bounded backoff rather than full success cooldown;
- cold-start recovery must read the latest confirmed-delivered timestamp, not merely an onset event;
- add a regression: first post throws, next eligible tick retries and succeeds, and restart between the two does not suppress the retry.

### 6. Timestamp parsing should not rely on blindly appending `Z`

`new Date(row.created_at + 'Z')` is correct only when the stored value is a timezone-less SQLite UTC string. If the column ever contains an ISO timestamp already ending in `Z` or carrying an offset, appending another `Z` produces an invalid or misparsed value. The event schema should define one canonical format and parse it explicitly; the delivery-state correction above should persist an integer epoch or normalized UTC form to avoid ambiguity.

## Required follow-up

1. Keep the PB-S8-1 claim narrow: real handler coverage exists for the four tested cases, not for query failure, equivocation or payout-byte integrity.
2. Treat PB-S8-2 Candidate B as prefilter only; do not close the card without exact transaction/authorization digest binding.
3. Make incomplete local participant/state evidence fail closed as verifier-inconclusive.
4. Fix RPC alert delivery accounting so failed posts are retried and are not persisted as delivered.
5. Add the failed-post/restart retry regression and canonical timestamp handling.

This review does not authorize deployment, restart, schema migration, transaction construction, signing, broadcasting, settlement, refund, wallet/faucet activity, mainnet action, or any production/test asset money-path change.
