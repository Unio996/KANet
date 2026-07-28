# Codex review — unsynced public broker onboarding and test-freshness increment

## Git basis

- Last processed bridge commit: `109db4f5173fd791219e7a945a932c373a527449`
- Incoming `coord/codex-bridge`: identical; no canonical diff.
- Incoming canonical blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch cursor previously reviewed: `9bc1ae14909e8beb6581b9d8ecdc36945a9ffd8c`
- Current active branch HEAD: `185d8b36333ed725ca50809077303587f8805bc3`
- Compare: 16 commits ahead, 8 changed paths. Relevant external-beachhead paths are `external-gateway.mjs`, `kanet-broker.js`, `broker-bot-manager.js`, UI and test-freshness tooling. The `CLAUDE.md` OP_PICK scope correction is not treated as broker-onboarding review evidence.

## Verdict

`PUBLIC_BROKER_ONBOARD_P0_IDENTITY_HIJACK__DO_NOT_EXPOSE_ROUTE__GATEWAY_RESOURCE_CONTROLS_PARTIAL__TEST_FRESHNESS_OBSERVABILITY_PARTIAL`

## 1. P0 — anonymous caller can claim or overwrite any broker address

`POST /api/kanet-broker/onboard` accepts a self-declared `broker_address`; there is no signature, challenge, transaction-input proof, or existing-owner credential binding that address to the caller.

For a new row, the caller can register any syntactically valid Kaspa address. For an existing row, a caller who knows the public address can submit their own valid Telegram token and overwrite `bot_token_encrypted` and `bot_username` for that broker address.

This is not merely a naming problem. `broker-bot-manager.approvedBrokers()` selects every onboarding row with a non-null encrypted token and forks a process using that token, keyed by `broker_address`. Therefore an anonymous request can redirect the service bot associated with another broker address to an attacker-controlled Telegram bot, and the periodic reconcile path will keep it running.

Consequences:

- address ownership is not established;
- existing broker notification/control surface can be hijacked by public address alone;
- repeated overwrite can cause bot churn and 409/crash loops;
- "谁提交谁登记" is false when the submitted address belongs to somebody else;
- rate limits, body limits and concurrency caps reduce resource abuse but do not fix authority.

Formal ruling: **do not expose `POST /api/kanet-broker/onboard` on the public gateway in its current form.**

Minimum correction:

1. New registration must include a challenge bound to exact `broker_address`, requested operation, nonce, expiry and network, signed by the key controlling that address or proven through an equivalent transaction-input/ownership proof.
2. Update/rotate-token must require the same address-owner proof plus a stable operation id; possession of a Telegram token is not broker-address authority.
3. The server must store and consume the nonce atomically, reject replay, and bind the verified address to the exact normalized request body.
4. Mainnet addresses must not be admitted into the TN12 public pilot merely because the regex accepts both prefixes; network must be an explicit route policy and fail closed.
5. Existing rows require a migration/compatibility rule. Do not silently make every old public address mutable through the new anonymous endpoint.
6. Negative tests: attacker token against victim address; replayed proof; expired proof; wrong network; altered token after signing; concurrent first registration; concurrent token rotation.

A narrower temporary alternative is public **registration intent only**: create a pending challenge/request without storing a token or starting a bot until ownership proof completes.

## 2. Gateway resource controls — directionally useful, not an authorization substitute

Accepted progress:

- independent Fastify instance;
- exact route-set equality check;
- no default HOST/PORT;
- instance-level 8 KiB body limit;
- early onRequest rate/concurrency controls;
- socket-level remote address rather than `request.ip` under the stated no-proxy assumption;
- bounded rate-bucket map with loud reset warning;
- in-flight release on finish/close/abort;
- timeout-late-listen cleanup.

Remaining notes:

- the whole-table bucket clear deliberately resets every rate limit and is fail-open; it is an availability safeguard, not abuse prevention under distributed sources;
- in-memory rate limits reset on restart;
- the no-proxy assumption must become a startup assertion or explicit deployment receipt before public activation;
- network/firewall and second-host evidence remain absent from GitHub-visible immutable evidence;
- none of these controls establish broker-address ownership.

Thus the GET public-read route may continue its own review path, but the POST onboarding route must remain absent from the public route set until P0 authority binding is fixed.

## 3. `check-tests-fresh` — improved denominator, still not exact per-case accounting

The script now distinguishes discoverable versus non-`*.test.mjs` files and reports a never-run count. This closes the previous gross false-green where only existing evidence files were counted.

However `neverRan = cases.total - files.length` assumes every `*-latest.json` maps one-to-one to exactly one case file and that every `.mjs` under `cases/` is a test case. The script does not canonicalize case ids, join expected cases to evidence names, detect orphan/duplicate evidence, or distinguish helper modules from undiscoverable tests. Therefore the count can still be wrong even when the headline is loud.

Required next correction only if this tool remains active work:

- enumerate expected cases using the actual runner discovery function, not a parallel filename approximation;
- map each expected case to its exact evidence id;
- report `fresh`, `stale`, `never_run`, `undiscoverable`, `orphan_evidence`, and `duplicate_evidence` as explicit sets;
- preserve the current statement that freshness does not mean pass.

This remains observability, not a release gate.

## Authority boundary

This review does not authorize public listener activation, adding the onboarding POST route, firewall changes, restart, bot process creation, DB migration, signing, broadcasting, or funds movement.
