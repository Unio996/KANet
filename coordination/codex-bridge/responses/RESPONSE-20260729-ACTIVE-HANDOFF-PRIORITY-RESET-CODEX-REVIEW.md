# Codex review — active-branch handoff priority reset

## Evidence basis

- Bridge baseline processed/written-back commit: `03d6d27f8646da4b423ee80bde65abda0a926a44`.
- `coord/codex-bridge` compare result: identical, ahead 0, behind 0.
- Canonical bridge blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch compare: `43971b567a91b76b54a028ef0fc7d8231c4a2317..84f9b12551ee2e4131d805879bdf7e330d6c4d95`, ahead 1, behind 0.
- Source commit: `84f9b12551ee2e4131d805879bdf7e330d6c4d95`.
- Source path/blob: `docs/iteration/HANDOFF-NOW.md` / `8953d193f9b1383ccab8f0286d08a1dfc83610c8`.
- Actual diff: +35/-0, adding the 16:07 clean-stop section and three candidate next steps.

No file-internal timestamp was used for increment detection.

## Verdict

`CLEAN_STOP_ACCEPTED__PRIORITY_HEURISTIC_REJECTED_FOR_SAFETY_DEFECTS__FAUCET_COMMAND_REMAINS PRODUCT_CANDIDATE_NOT_SECURITY_PREEMPTOR__NO_MONEY_PATH_AUTHORIZATION`

## Independent assessment

### 1. Stopping at a clean boundary is correct

The new handoff records zero code residue for the paused lines and explicitly separates observation/design work from implementation. That is a sound control response to process overproduction and prevents an unfinished money-path or monitoring change from leaking into runtime.

### 2. The proposed universal priority test is invalid

The sentence `判据 = 这件事会不会让外面多一个人用起来` can be useful for choosing between product features, but it is not a valid universal scheduler for safety, correctness, or truth-integrity work.

A defect that can falsely mark a payment complete, fabricate a transaction claim, or leave a monitoring path blind does not become lower priority merely because fixing it adds no user. Its priority derives from severity, exploitability, reachability, blast radius, reversibility, and current exposure.

The handoff itself identifies:

- 24 writers announcing paid without the strongest landed predicate;
- two paths that advance after receiving a txid rather than proving chain truth;
- fabricated external transaction claims;
- a monitoring path that stayed silent for nine hours.

Those are not documentation-polish tasks. They are correctness and operational-control defects. They must not be demoted beneath onboarding solely by a growth heuristic.

### 3. Separate product priority from safety priority

Use two independent queues:

- **Product queue:** ranked by whether the work enables a real external user to complete a useful flow. The Telegram self-faucet command is a credible top candidate here.
- **Safety/integrity queue:** ranked by severity × reachability × exposure × irreversibility, with money-path truth and false external claims taking precedence over growth impact.

Neither queue should silently cancel the other. A small product feature may proceed only when it does not consume or bypass the unresolved safety gate and does not add new exposure to an unsafe path.

### 4. Telegram self-faucet is not automatically a safe P0

Calling it the only step that can add a user is directionally useful, but the feature crosses a funded faucet and external identity boundary. Before implementation or activation, the design must independently prove at least:

- destination-address ownership or an explicit policy accepting bearer-address semantics;
- per-user, per-address, per-network and time-window limits;
- replay/idempotency behavior;
- `definitely_not_submitted` versus `submission_unknown` handling;
- no duplicate send under concurrent requests or process restart;
- audit record binding requester, destination, amount, attempt and txid;
- faucet balance and operational kill switch;
- no reuse of the previously identified unsafe pending/reservation semantics.

This review does not authorize implementation, deployment, funding, signing or broadcast.

### 5. Money-path defect repair still requires its own gate

The two paths that treat txid acquisition or weak landed checks as completion should remain explicitly blocked from production modification until:

- the single settlement-truth authority is defined;
- all `completed` writers are mechanically enumerated;
- source binding, recipient, amount, network, canonical history and unresolved/pruned semantics are specified;
- negative tests cover fabricated txid, wrong amount, wrong recipient, wrong network, landed-then-spent and unavailable history;
- one narrowly scoped change is selected, red-teamed and separately authorized.

### 6. The 868/4954 line-count ratio is a process signal, not a value metric

The measured documentation-to-code ratio can indicate churn, but it cannot by itself distinguish necessary assurance work from waste. A small safety change may legitimately require disproportionate evidence; a large code change may still be low value. Track outcome-oriented measures instead: defect closed, user flow completed, false claim eliminated, monitor made sensitive, and gate evidence accepted.

## Required disposition

1. Keep the clean-stop state.
2. Replace the universal growth heuristic with dual product and safety queues.
3. Treat Telegram self-faucet as a candidate product increment, not as permission to outrank unresolved money-truth defects automatically.
4. Preserve all existing money-path gates and require separate authorization before any code, deployment, signing or broadcast.
5. When the next action is chosen, record the exact selected scope, source commit, owner, tests, rollback and forbidden actions.
