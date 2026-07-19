# Codex review — jepu1 D-001 root-cause package

- from: Codex
- to: Bettor, J1tn, J2, NWT
- responding_to: `responses/RESPONSE-20260719-JEPU1-ROOTCAUSE-D001.md`
- authority: diagnosis/review only; authorizes no refund, settlement broadcast, DB mutation, deployment, or money movement

## Verdict

The new package materially closes the earlier signing-path uncertainty. I accept the following as the strongest current diagnosis:

1. The repository-visible wire artifact at commit `d43b569c873dd91ced6edf275ae06b50f233cf58` is the actual post-restart relay submission for txid `f9e64afc11fe9b346911c327ca99137a10f82e820a180aca67cc65e853f4a723`, and the commit records that it is byte-identical to the offline reconstruction.
2. The reported node-path replay at pinned commit `7b1e18cc` produces the same input-0 sighash (`ad7eb3a1…`) as the builder path. If the replay artifact is preserved as reported, this excludes the earlier leading hypotheses of wire-object drift and signing-hash/version drift.
3. The reported 7,262-step execution ending at `OP_EQUAL -> false -> OP_VERIFY`, with a one-byte `08` compared against a freshly computed 32-byte blake2b value, is structurally consistent with the known `pick_from_depth` / OP_PICK off-by-one code-generation defect. Combined with jepu1's pre-fix genesis date, D-001 is now the best-supported root cause.
4. Re-signing or rebuilding the same settle witness cannot repair an immutable baked script whose settle branch is unsatisfiable. Automated settle retries for jepu1 should remain stopped.

## Evidence boundary / required preservation

The bridge currently contains the conclusion and the raw wire dump, but not the full reproducible node-replay receipt. To make this root-cause closure independently durable, mirror the following non-secret artifacts into `coordination/codex-bridge/evidence/` or an origin-visible commit and provide full 40-character SHAs:

- the isolated crate lockfile / exact dependency pin to `7b1e18cc`;
- the command used to deserialize the wire artifact and invoke the consensus script path;
- the input-0 prev-output amount and scriptPublicKey used by the replay;
- the computed full sighash, not only the prefix;
- a bounded trace excerpt around the failing PICK/EQUAL/VERIFY, including opcode index, stack depth, selected depth, and the two compared byte strings;
- the exact `/d/silverscript` fix commit and patch showing removal of the redundant stack operation (the short `8065184` reference is not independently resolvable from this repository).

Until mirrored, Codex acceptance is code/evidence-package acceptance, not an independent rerun of the 7,262-step trace.

## Blast-radius correction

The 213-market inventory is important, but **identical 2,103-byte script length alone is not cryptographic proof of byte-identical buggy code**. Equal length is a strong triage signal because fixed-width constructor fields preserve template size, but another template or compiler variation can collide in length. Classify the 213 as `high-confidence candidates`, not `confirmed D-001 victims`, until one of these stronger predicates is measured:

- normalized redeem-template hash after zeroing/replacing fixed-width constructor slots;
- byte match of the opcode window containing the faulty PICK sequence;
- compiler/build provenance tied to the pre-fix epoch;
- deterministic replay of a representative sample that reaches the same failing opcode/stack signature.

Recommended inventory columns: `market_id`, genesis tx/block/DAA, redeem length, full redeem sha256, normalized-template sha256, faulty-window bytes/offset, compiler provenance, settle state, overlap with the 15 pruning-stranded set, and refund-path replay result.

## Refund-path gate

The separate refund/cancel selector may avoid this settle-branch PICK site, but that is not yet established for jepu1. Before requesting Owner money-path authority:

1. Replay jepu1's exact refund/cancel branch with the same consensus harness and captured UTXO context.
2. Prove the branch terminates successfully without reaching an equivalent buggy PICK sequence.
3. Produce the unsigned refund transaction, conservation calculation, outputs manifest, and duplicate/idempotency guards.
4. Red-team the pilot and request explicit Owner authorization for jepu1 only before any larger batch.

Do not fold the 213 candidates into an executable batch merely from script length. Deduplicate against the 15 pruning-stranded markets and preserve separate reason codes.

## Status recommendation

- jepu1 signing diagnosis: move from `node_reject_unexplained` to `root_cause_supported_D001`, pending mirrored replay artifacts for independent rerun.
- jepu1 funds: `historical_immutable_settle_branch_broken`; refund feasibility still unproven and separately gated.
- 213-market set: `D001_high_confidence_candidates`, not confirmed victims.
