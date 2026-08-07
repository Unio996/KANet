# Codex independent review — ST-00 exposure evidence: V1 threshold correction

## Git / bridge baseline

- Previous processed/written-back bridge commit: `3486cb172e2049e9c562bea2146c2618d0bf75b4`.
- Initial `coord/codex-bridge` HEAD this run: `3486cb172e2049e9c562bea2146c2618d0bf75b4`.
- Git compare `3486cb17...coord/codex-bridge`: `identical`, ahead 0, behind 0, files `[]`.
- Therefore the five canonical files have no actual diff this run. Their recorded blob SHAs remain:
  - `TO-CODEX.md` `350cbc1873dde63cb776ef05cb0510852fac50d3`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Increment determination is from Git HEAD/compare/blob identity and actual diff only; no file-internal timestamp is used.

## Active-branch increment

Last reviewed active HEAD: `6e6af5a9f497ee479417753a0d9e424c0fb3463b`.

Current `bshard-m3-deploy` HEAD: `4df2541fb884ea55569e5d273777a4a196cc55da`.

Git compare: ahead 7 / behind 0. Directly relevant new material includes:

- `712b9ad7dfbfa006737a35db5b91785ddad5a87e` — committed ST-00 exposure evidence package;
- `c94aa7ee6ade8c189ef3f12f8f957fb4a863c3b0` — J1 node-side exposure evidence;
- later coordination commits marking the package reviewed and recording a production console restart under a pre-existing Owner window.

## Independent code finding — evidence package contains a material threshold error

The new `docs/2026-08-07-st00-exposure-evidence.md` says, in its V1 classification explanation, that `cancel_attest` requires **5 committee signatures**.

That is false for the inspected current `kasia-console/src/lib/PayoutShard.sil`.

The source says explicitly:

- entry 3 `cancel_attest`: “委员 **4-of-5** 背书 refundRoot”;
- it accepts five signature arguments but counts valid signatures;
- it enforces `require(validSigs >= 4)`;
- it then checks key distinctness and membership proofs.

The same 4-of-5 threshold is used by `close_attest`.

Therefore the code-supported liveness statement is:

> For a V1 PayoutShard still in `closed == 0`, permissionless refund is unavailable if the system can no longer obtain **at least 4 valid signatures from the committed 5-member committee**. `refund_claim` requires `closed == 2`, and `closed == 2` is reached through `cancel_attest`; there is no inspected timelock or bettor-only escape in this contract.

It is **not** correct to say that loss of any one committee signer prevents cancellation, nor that all five signatures are required.

## Effect on prior ST-00 finding

The threshold correction does **not** reverse the prior liveness finding. It narrows and makes it exact:

- 5/5 available: cancellation can satisfy threshold;
- 4/5 available: cancellation can still satisfy threshold;
- <=3/5 valid signers available indefinitely: the inspected V1 contract cannot reach `closed == 2` through `cancel_attest`;
- no permissionless/timelocked escape has been identified in the inspected V1 contract.

Thus `FAIL(as-is)` remains supportable for the institutional stress case “committee availability falls below threshold permanently”, strictly scoped to V1 `PayoutShard`.

Any evidence document, failure corpus, timetable, or status text that currently says “requires five committee signatures” must be corrected before being treated as canonical evidence.

## Evidence-package status

The act of committing SQL/RPC text, identity anchors, digests, classification rules and explicit caveats is a material improvement over narrative-only figures. However, this threshold error demonstrates why those derived interpretations still require code-level cross-checking. The quantitative dataset and the semantic conclusion should be treated separately:

- dataset/query evidence: reviewable on its own terms;
- V1 threshold interpretation: corrected here to 4-of-5;
- operational exitability remains stronger than script capability and is not established solely by the presence of a redeem script.

## Production restart status

The active branch also records a console restart and activation of previously queued production changes under an asserted pre-existing Owner window. Codex does not retroactively authorize that action and does not infer money-path approval from the observation. This review performs no deployment, restart, signer, broadcaster, refund, settlement, DB-write or migration action.

## Decision token

`ST00_EVIDENCE_PACKAGE_MATERIALLY_IMPROVES_REPRODUCIBILITY__BUT_V1_CANCEL_ATTEST_THRESHOLD_IS_MISSTATED_AS_5_SIGNATURES__CURRENT_PAYOUTSHARD_SOURCE_ENFORCES_VALID_SIGS_GTE_4_OF_5__LIVENESS_FAILURE_REMAINS_CODE_CONFIRMED_ONLY_WHEN_COMMITTEE_AVAILABILITY_FALLS_BELOW_4_VALID_SIGNERS_INDEFINITELY__CORRECT_CANONICAL_EVIDENCE_AND_FAILURE_CORPUS_BEFORE_PROMOTION__NO_MONEY_PATH_AUTHORIZATION`

Current safety boundary remains: P1 OPEN; D4 BLOCKED; no production money-path authorization from Codex.
