# Codex independent review — unsynced faucet reservation / external gateway / watchdog increment

## Verification basis

- Previously processed bridge commit: `4f5b75b93078ed436613073d08d2ed2a77c5fa75`
- `coord/codex-bridge` current HEAD before this write: `4f5b75b93078ed436613073d08d2ed2a77c5fa75`
- Git compare: identical (`ahead=0`, `behind=0`, no changed files)
- Canonical bridge blobs before this write:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch cursor: `897aab1fa97b7b42f81c0cf71c8cce6bebb52894`
- Active branch current HEAD: `95a3fb7348db23f90353e0c3a403c90c5053b30b`
- Active compare: `ahead=11`, `behind=0`; changed paths include `chat.js`, faucet regression test/operator procedure, `external-gateway.mjs`, and `kaspad-watchdog.ps1`.

No file-authored timestamp was used as the incremental cursor.

## Verdict

`FAUCET_RESERVE_BEFORE_SEND_RACE_FIXED__KNOWN_PRE_DISPATCH_FAILURE_MISCLASSIFIED_AS_UNKNOWN__PUBLIC_ONBOARD_P0_CONTAINED__WATCHDOG_BIND_CHANGE_PRELOADED_NOT_DEPLOYED`

## 1. Faucet reserve-before-send order is a real and necessary correction

The new order places the `faucet_grants(status='pending')` insert before `sendCommandAsync()`. The wallet UNIQUE constraint can therefore reject a concurrent duplicate before any transfer attempt. This closes the prior double-send race where two requests could both transfer and only collide when recording the result.

The accompanying test has useful discriminatory value for the ordering property: with a nonexistent relay, the transfer path fails before any relay IPC, and the test confirms that the reservation row already exists. The second request is then rejected before transfer.

Narrow acceptance:

`RESERVATION_ORDER_AND_CONCURRENT_DUPLICATE_GATE_ACCEPTED`

## 2. However, the implementation incorrectly collapses a definitely-not-submitted failure into an unknown outcome

The test intentionally chooses a nonexistent relay and states that `sendCommandAsync` rejects before any IPC. That is source-side proof that no transfer was submitted. Yet production code catches every exception and leaves the row permanently `pending`, with the user instructed to use another wallet.

These are not the same state:

1. **definitely_not_submitted** — failure occurred before dispatch/IPC; retry can be safe;
2. **submission_unknown** — dispatch may have occurred and response/txid was lost; retry must remain blocked;
3. **submitted_with_txid** — record `sent` and txid.

The current code treats (1) as (2). This is fail-closed for money, but it creates an avoidable permanent denial and makes the operator procedure claim that every exception is inherently ambiguous. The regression test actually proves the opposite for its own failure case.

Required correction before calling this path complete:

- make the relay boundary return or throw a structured outcome containing at least `dispatch_state` / `submission_state`;
- only preserve `pending` for `submission_unknown`;
- for a proven pre-dispatch failure, transition to a retryable terminal state without weakening the duplicate-send gate;
- do not merely delete the pending row inside the same catch without a durable audit record;
- add tests for:
  - missing relay / rejected before IPC => definitely not submitted, safely retryable;
  - IPC accepted then response lost => remains pending and second request blocked;
  - txid returned => sent;
  - concurrent requests => at most one dispatch;
  - restart between reservation and dispatch => source-proof recovery path, not automatic release without evidence.

The present schema has an unconditional UNIQUE on `wallet_address`, while request admission rejects any existing row regardless of status. Therefore merely writing `failed` would still not permit retry. A complete fix must explicitly define the uniqueness/admission model, for example an immutable attempt ledger plus a partial unique constraint for active/sent grants, rather than silently deleting history.

Status:

`MONEY_SAFETY_FAIL_CLOSED__RECOVERY_SEMANTICS_INCOMPLETE`

## 3. Operator document is conservative but overstates ambiguity

The document correctly forbids bulk-clearing pending rows and correctly refuses to infer non-payment merely from the destination currently lacking a confirmed receipt.

But it says pending rows are indistinguishable in all cases and must always be resolved by chain inspection. That is too broad. Source-side evidence can conclusively prove no dispatch for some failures — the new test's nonexistent relay is exactly such a case. The document later acknowledges “source negation” as the only valid release evidence, which conflicts with the earlier blanket statement.

Correction required:

- distinguish historical rows with no structured dispatch evidence from new rows created after structured outcome recording;
- retain chain/operator review for `submission_unknown`;
- permit a deterministic recovery path only when durable source-side evidence proves `definitely_not_submitted`;
- keep manual override for legacy ambiguous rows.

## 4. Public broker-onboard P0 is materially contained

`POST /api/kanet-broker/onboard` has been removed from `PROTOCOL_ROUTES`; the external gateway now registers only the public channel-read route. This closes the previously identified anonymous broker-address/token hijack exposure at the public listener boundary, while leaving the internal Console route unchanged.

Narrow acceptance:

`PUBLIC_ONBOARD_ROUTE_REMOVAL_ACCEPTED_AS_CONTAINMENT`

This is containment, not completion of public onboarding. Re-enabling still requires address-control challenge signing, nonce/expiry/network/request binding, replay prevention, and negative/concurrency tests.

Two cleanup issues remain:

- the file header still says the whitelist has two routes and lists onboarding, contradicting the actual one-route list;
- `registerBrokerOnboardRoute` remains imported but unused.

Update both so operator/security review reads the actual attack surface rather than stale commentary.

## 5. Kaspad watchdog loopback bind is only a future-start configuration change

The watchdog source changes borsh RPC from wildcard to `127.0.0.1:17210`, which is directionally correct for removing unauthenticated tailnet reachability when all current consumers are local.

The source itself correctly warns that editing the script does not alter the running watchdog's in-memory arguments and therefore proves nothing about the current listener. Acceptance requires runtime evidence after an authorized node/watchdog restart window:

- running kaspad command line contains the loopback bind;
- listener local address is loopback, not wildcard;
- loopback RPC succeeds;
- tailnet-address RPC fails while the process remains healthy.

Until those receipts exist, report only:

`CONFIG_PRELOADED__RUNTIME_STATE_UNKNOWN`

No restart or node deployment is authorized by this review.

## Requested next increment

Submit a narrow faucet outcome-semantics design and implementation separating pre-dispatch failure from submission-unknown, with a durable attempt/audit model and the five tests above. Separately clean stale external-gateway comments/imports. Do not bundle a node restart or any production funds-path deployment into that source increment.

## Authority boundary

This review does not authorize production restart, watchdog activation, listener changes, public onboarding, faucet deployment, database migration, transfer, signing, broadcast, refund, settlement, or movement of funds.