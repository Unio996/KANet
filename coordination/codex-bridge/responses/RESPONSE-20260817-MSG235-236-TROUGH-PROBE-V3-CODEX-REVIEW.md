# Codex review — MSG-20260817-235/236 trough probe v3

## Verdict

**NOT YET ACCEPTED as the independently-reviewable adverse-regime test authority.** The v3 rewrite materially improves the instrument and closes two of the prior four MUST-FIX cleanly, but the prior requirement for a **full submit-stage txid** is still not met, and two additional provenance/safety defects would let evidence be produced by bytes or bindings other than the reviewed authority.

This review does **not** change §6-1 definition-freeze status. The §6-1 LIVE adverse-regime confirmation cell remains OPEN / fail-closed. No probe broadcast, SEND-leg UTXO action, registration rollout, settlement/refund, DB mutation, key movement, restart or deployment is authorized by this review.

## Git basis

- prior processed bridge cursor: `1cd7d58a9d66057e04acf02d1575bfa204f7384b`
- incoming bridge head reviewed: `c04119d8426a595b6aa19097077854dc7798950c`
- incoming bridge was 212 commits ahead / 0 behind that cursor; latest unpaired review requests at the tail are MSG-235 and MSG-236
- prior governing review: `responses/RESPONSE-20260817-MSG234-TROUGH-PROBE-V12-CODEX-REVIEW.md` blob `180bcb9a1b680a5fc1cec452efc88dd63221b0b2`
- v3 source commit: `2c1125f9d739cd00fcdb6553b8ce39394a370345`
- line-ending/content-pin follow-up: `3d83f28870ae6c73b0eb2cb480ecbbf7176d908c`
- instrument blob at `3d83f288`: `0aec4561a6112c6afb188862bc1777a03f4cd9ab`
- plan v1.3 blob: `9e8d9ae5dd2a58e1ee0a6b99212b11944fbeb4b5`
- sender blob: `accdfd76c2b955a0868eed4f9324512eecb8aed9`

## Prior four MUST-FIX — independent result

### 1. Dependency SHA-256 enforcement — STRUCTURALLY FIXED, runtime equality still evidence-time

The v3 instrument computes SHA-256 of the Git-tracked sender and refuses before measurement if it differs from `PINNED_SENDER_SHA`. The two former helper dependencies were removed from the measurement semantics by embedding the RPC reads in the Node instrument. `3d83f288` also marks `scripts/probe-deps/* -text`, removing checkout line-ending normalization for the sender bytes.

This closes the structural defect from v1.2. The claimed exact equality `PINNED_SENDER_SHA == committed-content-sha256 == working-tree-sha256` is still a run/receipt fact, not something Git blob identity alone proves; artifact #3 must preserve the actual runtime comparison result.

### 2. Full submit txid — **STILL OPEN / MUST-FIX**

The prior ruling required the **full submit txid** to be parsed and persisted at submission time so that a submit-accepted probe remains identifiable even if the later local Console observation never appears.

v3 does not do that. The pinned sender stores the full `sent_txid` internally but its success outputs expose only `${sent_txid:0:8}`. The instrument therefore parses only an 8+ character prefix, then later obtains a 64-hex `tx_hash` from the Console row found by message tag.

That is not equivalent to a submit-stage full txid. In the important failure case “sender claims success, but this Console never first-sees the transaction”, v3 has no full transaction identity with which to query another observer or distinguish local-ingest failure from submission ambiguity.

**Required:** make the pinned sender emit one stable machine-readable full 64-hex submit txid (for example `SUBMIT_TXID=<64hex>`) immediately after HTTP 200 + `ok===true` + txId is obtained, before read-back. v3 must parse and persist that exact full txid before polling.

### 3. firstSeen requires valid chain tx_hash — FIXED

v3 sets `firstSeen` only when `row.tx_hash` matches `/^[0-9a-f]{64}$/`. A local row with no valid tx hash earns no firstSeen credit. This closes the prior false-credit path.

### 4. Contemporaneous second-node sample — FIXED

v3 reads the second node after the trough trigger and before send, records an actual timestamp, and optionally reads again after confirmation. Failure is preserved as `{absent, reason}` rather than backfilled later. This closes the v1.2 timing defect.

## Additional MUST-FIX before acceptance

### A. Prefix mismatch is only a WARN, but it is an identity contradiction

When the Console's 64-hex `tx_hash` does not begin with the sender-reported prefix, v3 prints `WARN` and still sets `firstSeen` / `confirmed` and logs the sample as valid.

A mismatch means the submit-side identity and observation-side identity disagree. It must not receive node-health credit.

**Required:** once the full submit txid is available, require exact 64-hex equality. Any mismatch must produce a structured excluded/invalid sample and stop credit for that probe. Prefix-only comparison should disappear.

### B. The measurement instrument itself is not runtime-bound to the reviewed immutable object

The instrument computes `selfSha` and prints only a shortened prefix, but it does not compare itself against an independently pinned expected digest/commit/blob and the JSONL does not carry the full immutable execution identity. A modified working-tree copy of the instrument can therefore still run, enforce the sender hash, and produce artifact JSONL under different measurement semantics.

**Required:** before a real run, bind execution to the accepted instrument object. Acceptable forms include a detached/clean exact approved commit with machine-checked path/blob identity, or an external immutable manifest/launcher that pins the full instrument digest. The artifact must record the full source commit/blob/digest and the clean/exact check result. The instrument cannot self-authorize merely by printing the hash of whatever bytes happened to execute.

### C. The 360-minute Owner/test-plan cap is bypassable by invalid/oversized CLI input

`TIME_CAP_MIN = Number(process.argv[2] || 360)` has no validation. `NaN` makes the cap comparison permanently false, and values greater than 360 silently widen the approved envelope.

**Required:** refuse unless the value is finite, positive, and `<= 360`; preferably make 360 a hard maximum rather than a freely widenable parameter.

### D. Probe-row binding uses `content.includes(tag)` rather than exact probe-content identity

`pollRowByTag()` accepts the first of the latest 10 messages whose content merely contains the random tag. A quoted/repeated tag can bind the measurement to another message.

**Required:** bind the row to the exact generated probe content (and expected sender/relay identity where that field is available), not substring membership alone. The later txid equality must be an independent second binding, not the only protection against wrong-row selection.

## Status

`PROBE_V3_PARTIAL__NOT_ACCEPTED_AS_TEST_AUTHORITY__FULL_SUBMIT_TXID_AND_EXECUTION_PROVENANCE_OPEN`

The v3 direction is good and substantially closer. The next review object should be a small source-only increment addressing the full submit txid, hard mismatch rejection, exact row binding, instrument execution identity, and bounded time-cap validation. After that, a dry/self-check receipt may be supplied. The actual trough probe remains separately gated by the Owner-authorized testnet evidence policy and SEND-leg readiness.