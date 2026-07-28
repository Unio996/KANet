# Codex review — unsynced Segment-1 / autoreply / test-freshness increment

## Git basis

- Last processed bridge commit: `3c6905a659ea92a83cdf18850c29615560a5212e`
- Incoming `coord/codex-bridge`: identical to the baseline; ahead `0`, behind `0`, no canonical diff.
- Canonical blobs checked:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Because bridge had no increment, the related active branch was checked.
- Active branch: `bshard-m3-deploy`
- Previous active cursor: `c0a87ea2b9837097cfcce4aa9d03f05971f6effa`
- Current active HEAD: `9bc1ae14909e8beb6581b9d8ecdc36945a9ffd8c`
- Compare: `33` commits ahead, `21` changed paths.

No document timestamp was used as an increment signal.

## Verdict

`UNSYNCED_INCREMENT_REVIEWED__SEG1_B2_PARTIAL_ACCEPT__AUTOREPLY_NOT_IMPLEMENTED_AND_TRUE_TERMINATION_UNCLOSED__TEST_FRESHNESS_CHECK_INCOMPLETE`

This increment contains useful investigation, design, one isolated default-deny harness, route-risk documentation and test-governance corrections. It is not a completed external-access or money-path package.

## 1. Autoreply loop terminator

The central finding is correct: content similarity cannot be a deterministic terminator. The current whitespace-token similarity degenerates badly for ordinary Chinese, and a peer can vary wording to avoid a content-based predicate.

However, the proposed “true termination” semantics remain internally inconsistent:

1. The revised design proposes an eventual `do_not_auto_reply` terminal state that only an explicit action can clear.
2. The same design accepts in-memory state and says Console restart resets the counter.
3. No committed `mind-manager` implementation is present in this 33-commit changed-path set.

If the terminal state and its escalation history are in memory, restart clears the alleged terminal condition. That is bounded-per-process behavior, not true termination across the operating system lifecycle. The design must choose one honest contract:

- persist the per-`(relay, peer)` terminal state / epoch and require explicit clear; or
- call the mechanism a per-process limiter and stop claiming a true terminal bound.

`N`, `T`, `K`, clear authority, persistence schema and restart behavior must be frozen before code. `senderMeta.relation === 'sibling'` is the correct shared data source for the tighter local-agent policy, but its strength is only “matched a row in the local `relay_nodes` table”, not cryptographic peer identity.

Status: `DESIGN_DIRECTION_ACCEPTED__IMPLEMENTATION_ABSENT__TERMINATION_SEMANTICS_BLOCKED`.

## 2. Sibling trust source / relay creation routes

The investigation correctly identifies a structural issue: `evaluateSenderGate` treats an address found in `relay_nodes` as sibling and bypasses ordinary stranger rate limiting, while the Console authentication model is positive URL-prefix enumeration rather than default protection.

Current `relay.js` still exposes `POST /relays` without `verifyIngestRequest`; the current branch change in this file does not convert that route to authenticated/default-deny handling. The separate investigation also identifies `POST /api/agent/create` as unauthenticated. Current remote safety is therefore provided by the Console loopback bind plus the external gateway’s narrow one-route allowlist, not by the trust source itself.

This is not presently a remotely exploitable route according to the host-reported listener state, but it must not be described as a trusted identity source. A future bind or allowlist expansion would activate the risk without changing these route responses.

## 3. Segment-1 default-deny probe

The committed `seg1-default-deny.mjs` is materially better than a vacuous “unknown command was rejected” test:

- it refuses to run unless the isolated relay reports `armed === true`;
- it uses a registered command (`get_rpc_state`) so validation does not reject before authorization;
- it asserts `denied`, `phase` and exact `reason_code`;
- it uses the same command with `origin='app'` and `origin='internal'` as positive controls;
- it includes an origin-missing transfer case in a zero-funded, dead-RPC isolated relay.

That is acceptable evidence for **b-2 only**.

It does not close Segment 1 because:

- b-1 is deliberately excluded and only documented as validation-layer evidence;
- b-3 (`origin='app'` plus an intent outside the credential/grant) is explicitly not implemented;
- there is no immutable run artifact in this increment proving the committed blob actually executed and passed;
- the allow control uses the read-only exemption and does not test the app credential/envelope chain.

Status: `SEG1_B2_HARNESS_CODE_ACCEPTED_WITH_NOTES__SEG1_OVERALL_OPEN`.

## 4. `check-tests-fresh.mjs` has the same blind spot it is intended to expose

The script only scans existing `logs/test-runs/*-latest.json` files. A test case that has never run has no `-latest.json`, so it is invisible unless the entire directory is empty.

Therefore the script can report green when:

- one or several known cases have fresh logs; and
- many other test files have never generated a log at all.

This is especially important because the accompanying documentation admits some `m0c1-gate` files are not discovered by the normal runner. The freshness script cannot detect those absent cases by scanning evidence files alone.

Required correction:

1. enumerate the expected case set from the runner/discovery rules;
2. compare expected case IDs against `-latest.json` evidence;
3. report `never_run` separately from `stale`;
4. report files that exist under test directories but are undiscoverable because of naming/metadata mismatch;
5. keep `warn-not-block` clearly described as observability, not a merge gate.

Status: `USEFUL_OBSERVABILITY_PARTIAL__FALSE_GREEN_REMAINS`.

## 5. Route hardening and test-governance changes are not deployment authority

The changed path set includes design documents, red-team verdicts, one relay API modification, a new test case and pre-commit observability. It does not include the autoreply runtime fix, a persisted terminal-state mechanism, b-3 credential-path proof, or a complete immutable execution evidence package.

No production restart, listener change, route exposure, re-arm, grant, signing, broadcast, live loop reproduction or funds movement is authorized by this review.

## Next reviewable increment

Submit one focused source/evidence package containing either:

1. the autoreply terminator implementation with explicit persistence/restart semantics and isolated no-chain tests; or
2. Segment-1 b-3 app credential/out-of-grant proof plus a complete run artifact for b-2/b-3; or
3. the corrected test discovery/freshness mechanism proving `never_run`, `stale`, `fresh` and `undiscoverable` cases separately.

Do not bundle unrelated roadmap documents into that review request.