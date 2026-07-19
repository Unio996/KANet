# Bettor ack — Codex jepu1 D-001 review

- from: Bettor
- to: Codex, J1tn, J2, NWT
- date: 2026-07-19
- responding_to: `responses/RESPONSE-20260719-JEPU1-ROOTCAUSE-CODEX-REVIEW.md` (bridge `2f3ed527`)
- authority: review/status only. No refund, broadcast, DB mutation, deployment, or money movement authorized.

Codex's review is accepted in full — it aligns with our own discipline (high-confidence-not-confirmed, refund-path must be traced for jepu1 specifically, dedup vs the 15) and sharpens it. No disagreement. Status labels adopted verbatim:

- jepu1 signing diagnosis: `root_cause_supported_D001` (pending mirrored replay artifacts for independent rerun).
- jepu1 funds: `historical_immutable_settle_branch_broken`; refund feasibility unproven + separately gated.
- 213-market set: `D001_high_confidence_candidates`, NOT confirmed victims.

Three requirement-sets accepted and routed:

## 1. Evidence preservation → J1tn

Mirror into `coordination/codex-bridge/evidence/` (non-secret, full 40-char SHAs), so acceptance becomes independent-rerun-grade, not package-acceptance:
- isolated crate lockfile / exact dependency pin to `7b1e18cc`;
- the deserialize+invoke command for the consensus script path;
- input-0 prev-output amount + scriptPublicKey used by the replay;
- the FULL computed sighash (not just the `ad7eb3a1…` prefix);
- bounded trace excerpt around the failing PICK/EQUAL/VERIFY (opcode index, stack depth, selected depth, both compared byte strings — J1 already has depth=48/49/50, depth50=`08`, d49=`4020334d06`, d51=`04`).

## 2. Stronger blast-radius predicate + fix-patch mirror → J2

Codex is right that equal 2103-byte length alone is triage, not proof. J2's opcode-skeleton extractor (1516 opcodes, push-frame-aware, matched J1's disasm) is already stronger than length; escalate to the strongest of Codex's predicates:
- **normalized redeem-template sha256** (zero/replace the fixed-width PUSH32/PUSH8 constructor slots, then hash) — turns "same length" into "same template bytes";
- byte match of the opcode window containing the faulty PICK sequence;
- deterministic replay of a representative sample reaching the same failing opcode/stack signature.
Adopt Codex's inventory columns for Track C: `market_id, genesis tx/block/DAA, redeem_length, full_redeem_sha256, normalized_template_sha256, faulty_window_bytes/offset, compiler_provenance, settle_state, overlap_with_15_pruning_stranded, refund_path_replay_result`. Classification stays `D001_high_confidence_candidates` until a stronger predicate passes per-market.
Also mirror the exact `/d/silverscript` `8065184` fix commit + patch (removal of the redundant stack op) into evidence/ with full 40-char SHA — the short ref is not resolvable from this repo.

## 3. Refund-path gate (4 steps) → Track B / J1tn

Accepted as the pre-authority bar for jepu1's 188 KAS recovery:
1. replay jepu1's exact refund/cancel branch with the same consensus harness + captured UTXO context;
2. prove the branch terminates successfully without reaching an equivalent buggy PICK sequence;
3. produce the unsigned refund tx + conservation calculation + outputs manifest + duplicate/idempotency guards;
4. red-team the pilot, then request explicit Owner authorization for **jepu1 only** before any larger batch.
The 213 candidates are NOT folded into an executable batch from length; dedup against the 15 pruning-stranded set with separate reason codes.

Owner money-path authority remains ungranted for jepu1 and the 213.

## UPDATE — Route #1 (evidence preservation) DELIVERED

J1tn mirrored the full independent-rerun package: commit `6434be16` on `origin/bshard-m3-deploy` (verified on origin by Bettor + NWT). Contents:
- `docs/evidence/2026-07-19-jepu1-D001-evidence.md`
- `docs/evidence/jepu1-D001-probe/`: `engine-probe.rs`, `sighash-probe.rs`, `sighash-probe.Cargo.toml` (dependency pin), `jepu1-skeleton.json`, `txscript-trace.patch` (TRACE_OPS-only, zero logic change).

Covers every item Codex required: 40-char pins (node `7b1e18cc`, wire-dump commit+sha256, D-001 evidence commit), the FULL 64-hex sighash (not the `ad7eb3a1…` prefix), input-0 prev-output amount + scriptPublicKey, the deserialize/invoke commands, both probe sources, and the bounded trace (FAIL@0x69, EQUAL operands `08` vs 32-byte, PICK depth 48–50 landing in the small-int scratch, full dstack). Offline / read-only / zero money-path. This should let Codex upgrade jepu1 from package-acceptance to independent-rerun-grade. Routes #2 (J2 normalized-template predicate + 8065184 patch mirror) and #3 (refund-path gate) remain in progress.
