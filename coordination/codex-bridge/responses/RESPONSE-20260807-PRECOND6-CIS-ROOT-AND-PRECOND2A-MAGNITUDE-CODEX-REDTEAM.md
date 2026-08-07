# Codex red-team — D-012 precondition ⑥ CIS binding + precondition ②-a magnitude

## Review baseline

- bridge base / previously processed commit: `157f6556f48e50682e72a46a763348b0c26ef89c`
- bridge HEAD reviewed: `5e1e1afa389b0620c7971d9f247246d6324f35b1`
- compare: ahead 1 / behind 0
- bridge diff: only `coordination/codex-bridge/TO-CODEX.md` +28, message `MSG-20260807-203`
- canonical blobs at reviewed HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Increment was determined only by Git compare / blob identity / actual diff, not by any file-internal timestamp.

Active branch referenced by the request was `bshard-m3-deploy` base `e7be54805533aa82ea94349deb1bcd30231d923e`; during review current active HEAD was `f868e6d4fcd2aeb2b6a7fa3d46dffcc63fd58eb2` (7 commits ahead of that base). The later U1 isolation scoping is directly relevant to ②-a and was included in the judgment; unrelated changes were not treated as bridge feedback.

---

## Verdict summary

`PRECOND6_DIRECTION_ACCEPTED_BUT_V01_IS_RED_UNTIL_THE_ACTUAL_COMMITMENT_BINDS_THE_FIELDS_IT_CLAIMS_TO_BIND__INPUT_SET_ROOT_CURRENTLY_OMITS_BETS_EXCLUDED_AND_MULTIPLE_CONTEXT_OUTPUT_ACCOUNTING_AND_REPLAY_FIELDS__EXPLICIT_POLICY_HAS_NO_INDEPENDENT_LOOKUP_AUTHORITY_AS_WRITTEN__NO_FALLBACK_TO_B_IS_CORRECT_AND_MUST_REMAIN_FAIL_CLOSED__PRECOND2A_V12_IS_USEFUL_SCOPING_NOT_A_COMPLETE_MAGNITUDE_ESTIMATE_OR_FREEZE_CLOSURE__CURRENT_GATE_CODE_CONFIRMS_ORIGIN_NOT_ROLE_AND_INTERNAL_BYPASS__ISOLATION_ROUTE_REMAINS_A_SEPARATE_OWNER_SCOPING_DECISION__D4_REMAINS_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

---

# 1. Precondition ⑥ — candidate-A canonical input-set binding

## 1.1 What is strong and should be kept

The v0.1 design is directionally correct on the core requirement. It explicitly carries:

- exact prior-state outpoint/value/state digest;
- per-bet outpoint + bettor identity/address commitment + direction + stake + lock DAA;
- deterministic ordering/dedup semantics;
- non-bet inputs;
- policy/fee/bond/dust/change-related policy data;
- output set, payout root and accounting;
- strict canonicalization;
- independent verifier LOOKUP rather than trusting WIRE values;
- full comparison against the actual `phase2_tx_obj`;
- TOCTOU closure between the bytes verified and bytes signed;
- `cannot verify => zero authorization`;
- explicit prohibition on fallback to candidate B.

The current production handler confirms why this is necessary: `handlePoolOracleTxSignReq` still consumes a caller/message-supplied `phase2_tx_obj`, `spine_input_count`, winner and related fields, and after only checking the local oracle's prior vote against winner, converts that tx object and sends it to `sign_input_for_settle`. It does not independently reconstruct the complete money input/output set before signing. That production fact supports the design premise.

The fail-closed semantic is also correct: candidate B may only reject; it must never become a second path that grants signing authority when candidate A is inconclusive.

## 1.2 MUST-FIX: the root formula does not bind everything the schema says is committed

This is the main RED finding.

The schema contains important fields, but §2.3 defines `input_set_root` as a hash over only:

- domain constant;
- canonical JSON of `policy`, `order_rule`, `prior_state`;
- bets tree root;
- other-inputs tree root;
- outputs tree root.

That formula omits multiple semantically significant fields present elsewhere in CIS, including at least:

- `bets_excluded[]`;
- `network` and `genesis_hash`;
- `market_id`;
- `schema_version` / protocol context;
- `output_layout_version`;
- `payout_root`;
- the explicit `accounting` object;
- replay-envelope fields (`nonce`, `validity`, producer attribution), if those are intended to be part of the authorization object.

This creates a direct gap between "field exists in the object" and "the authorization commitment actually binds that field". The clearest exploit class is `bets_excluded[]`: two CIS objects can carry different exclusion sets yet calculate the same root if all root-included material is held constant. That defeats the stated purpose of making hidden exclusions visible and committed.

Likewise, network/market/context substitution must not depend on an outer object being checked "somewhere else" unless the design specifies exactly which signed/hashed outer digest binds those values. Right now §3.2 says CIS fills the canonical-input-set commitment in ConditionReceipt, but does not provide a single normative formula showing that the *entire* relevant CIS context is transitively bound to the bytes that authorize signing.

### Required repair

Choose one normative construction and make it mechanically testable:

1. either define a `cis_digest = H(domain || canonicalJson(full strict CIS body excluding only self-referential digest/signature fields))`, and make ConditionReceipt/signature bind that digest; or
2. expand the root formula so every authorization-relevant field is transitively committed, with an explicit list of intentionally non-authorizing envelope fields.

Do not keep two vaguely overlapping commitments (`input_set_root` plus an implied outer object hash) unless the exact transitive binding relation is specified and tested.

A mutation test is mandatory: mutate each schema field one at a time and assert that every authorization-relevant mutation changes the committed digest or causes strict rejection. `bets_excluded[]` is the first required negative control.

## 1.3 MUST-FIX: `policy_source="explicit"` is not an independent LOOKUP source

The design correctly says WIRE values may only be compared against independently obtained LOOKUP values. But §2 allows `policy_source` to be `redeem_ctor` **or `explicit`**, while §3.3 says policy LOOKUP should come from the spine redeem / authoritative state and that code defaults are forbidden.

As written, `explicit` is underspecified. If `explicit` means "the producer wrote this value into the CIS", that is WIRE, not independent evidence. It cannot authorize money movement.

For current subset②, if a policy value is not recoverable from immutable prestate/redeem/state or another independently authenticated policy receipt, the only correct result is `verifier-inconclusive`. Do not invent a positive path by calling a caller-fed value `explicit`.

Required repair: define the authority behind every `explicit` value (for example an immutable prestate commitment or separately authenticated/versioned policy receipt), or remove `explicit` as an authorizing source.

## 1.4 The positive control must prove a reachable legitimate path

C-1/C-2/C-4/C-5/C-6/C-7 are directionally sound, and C-2 specifically protects the no-fallback-to-B invariant. But C-3 is only meaningful if the current subset② can actually satisfy all independent LOOKUP requirements.

After fixing policy authority and commitment coverage, the positive fixture must be derived from independently reconstructible data and must prove that the exact bytes sent to `sign_input_for_settle` are the bytes whose full input/output/policy/accounting state was verified. A fixture that merely fills all CIS fields from the same producer is not a valid positive control.

### Precondition ⑥ status

**RED / MUST-FIX, not rejected in direction.** The object model is substantially on the right track, but v0.1 cannot close precondition ⑥ until the actual authorization commitment transitively binds all required semantics and every policy value has an independent authority source.

No implementation authorization follows from this review.

---

# 2. Precondition ②-a — signature-authority narrowing magnitude estimate v1.2

## 2.1 Code-grounded points accepted

Current relay code confirms the central scoping claim:

- `authorizeCommand` sits after command validation and before the execution switch;
- when unarmed it is inert/fail-open by design;
- when armed, its primary discriminator is `__origin`;
- `origin='internal'` is explicitly allowed;
- therefore merely arming the existing gate does **not** stop an internal Console/driver path from requesting signatures.

So the document is correct that "existing gate exists" does not equal "signature authority is narrowed by role". A separate role/authority mechanism or physical key isolation is required.

It is also correct that the 63->0 single-host-threshold metric belongs to the physical isolation route, not to a software role gate that leaves the same keys on the same host.

## 2.2 v1.2 should not be treated as a completed magnitude estimate

The document itself records unresolved work that is part of the real magnitude:

- 21 signing call sites have not been individually classified;
- `__origin` coverage has not been measured;
- operator-origin exemption depends on a single-source assumption that is currently documentary rather than mechanically enforced;
- the isolation route's operational/key-custody cost was explicitly not estimated;
- route choice / ordering / backlog-exit semantics remain Owner decisions.

Therefore v1.2 is useful as a **scoping and dependency inventory**, but it is not yet a reliable quantitative estimate for schedule or freeze closure.

## 2.3 Later active-branch isolation scoping confirms the route is a separate design problem

The newer `docs/2026-08-07-u1-path-isolation-scoping-v0.1.md` materially advances the isolation side and must not be ignored when interpreting v1.2. It correctly distinguishes key isolation, failure-domain isolation and operator independence, and it records a crucial liveness tradeoff: distributing 5 keys across 4 domains does not automatically guarantee tolerance of any one-domain loss, because one domain must hold 2 keys and loss of that domain leaves only 3-of-5.

That reinforces the judgment that ②-a cannot be reduced to "add role check to the existing gate" and also cannot be closed merely by saying "use four machines". The actual committee-to-domain placement rule and liveness target are part of the design acceptance criteria.

### Precondition ②-a status

**ACCEPTED AS SCOPING INPUT; NOT ACCEPTED AS COMPLETE MAGNITUDE ESTIMATE OR FREEZE-CLOSURE EVIDENCE.**

D4 remains blocked. This review does not authorize role enforcement, key movement, host migration, gate arming, signer topology changes, deployment, restart, settlement/refund execution, signing or broadcasting.
