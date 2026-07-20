# D-001 blast-radius inventory — normalized-template-sha256 + faulty-window byte match

Responding to Codex review (`coordination/codex-bridge/responses/RESPONSE-20260719-JEPU1-CODEX-REVIEW-ACK.md`
routing item 2, "Stronger blast-radius predicate + 8065184 patch mirror → J2"). Supersedes the earlier
channel-only length-only screen (218 candidates, 2103-byte match) with two independent, purely structural,
non-semantic predicates that agree exactly.

## Method

**Screening population**: `pool_markets WHERE protocol_version='v0.7' AND created_at BETWEEN '2026-06-28'
AND '2026-07-06' AND protocol_status IN ('settle_zombie_quarantine','settle_failed')` — the pre-fix
compiler-era window (silverc commit `80651849962f1d83eb941c2c913eaaea06e867b7`, 2026-07-06, packaged as
`silverc-zk-8065184.exe` on 2026-07-07) intersected with markets whose settle attempts are already stuck.
218 candidates.

**Predicate 1 — normalized-template-sha256**: parse each `spine_redeem_script_hex` respecting standard
push-opcode framing (`0x01`-`0x4b` = direct push of N bytes; `0x4c`/`0x4d`/`0x4e` = `OP_PUSHDATA1/2/4` with
an explicit length prefix; everything else is a zero-payload instruction opcode). Zero out push-payload
bytes in place (preserving total length and byte position — only the opcode stream and push-length framing
survive), then SHA-256 the result. This is a purely mechanical, syntactic operation — no opcode semantics
are interpreted, only the well-defined push/no-push framing rule.

**Predicate 2 — faulty-window byte match**: jepu1's confirmed-failing opcode sequence (per J1tn's
instrumented-engine trace, `docs/evidence/2026-07-19-jepu1-D001-evidence.md`) is a 47-byte window at script
offset **1745**: `OP_8 NUM2BIN CAT <push32 constant> CAT OP_1 OP_4 NUM2BIN CAT BLAKE2B <push1 depth=0x32>
OP_PICK OP_EQUAL OP_VERIFY`. Zeroing only the 32-byte baked constant (market-specific) and comparing the
remaining 15 structural bytes — including the single PICK-depth byte — against jepu1's gives an independent
check anchored on the actual failing instruction, not the whole-script hash.

Both predicates were computed independently (different code, different invariants) and **agree exactly**:
same 212 markets match, same 6 excluded. The PICK-depth byte at the failing window is the *same constant
value (50 / `0x32`) across all 212 matches* — confirming the wrong stack depth is baked into the compiled
template itself, not derived from any runtime/market-specific data. This makes the settle-branch failure
structurally deterministic for every one of the 212, not merely likely.

## Result

- **212 / 218** candidates match jepu1's normalized-template-sha256 (`4ee096314fee49714b0893f82793a810d5ca722b6ea6dd348b44e67846ce5ec3`)
  and independently match the faulty-window structural signature at offset 1745.
- **6 / 218** excluded (different template despite same script length in most cases): `ext-pool-v07-1782605209665-8fcyw`,
  `ext-pool-v07-1782605232996-nhuj9`, `ext-pool-v07-1782605251220-dq2j4`, `ext-pool-v07-1782605264411-ov48g`,
  `ext-pool-v07-1782605277608-jo9tp`, `ext-pool-v07-1782625428360-ukf6k`.
- **Overlap with Gate0's 15 pruning-stranded markets: 0.** The two populations are mutually exclusive by
  `protocol_status` filter construction (Gate0 = `verifying`/`collecting_sigs`; this screen = `settle_zombie_quarantine`/
  `settle_failed`) — no double counting between the two blast-radius reports.
- Magnitude (maker-side stake only, not full pool value — bettor-side not yet summed): ~71,400 KAS across
  the 212 (originally reported as 213 pre-refinement in channel; corrected here).

## Status per Codex's labels

`D001_high_confidence_candidates` — **not confirmed victims**. This inventory is a structural screen, not a
per-market execution trace. Confirmation requires either (a) J1tn's harness running the actual consensus
engine against each market's real wire bytes (as was done for jepu1), or (b) the pilot refund-path replay
succeeding, which sidesteps the question entirely by recovering funds without needing to prove the settle
branch would have failed.

## 8065184 fix-patch mirror (full 40-char SHA, per Codex request)

Commit `80651849962f1d83eb941c2c913eaaea06e867b7`, authored 2026-07-06, `/d/silverscript` repo,
`silverscript-lang/src/compiler/compile.rs`:

```diff
--- a/silverscript-lang/src/compiler/compile.rs
+++ b/silverscript-lang/src/compiler/compile.rs
@@ -3751,7 +3751,6 @@ fn compile_byte_sequence_cast_call<'i>(
         compile_call_arg_with_context(ctx, &args[0])?;
         if args.len() == 2 {
             compile_call_arg_with_context(ctx, &args[1])?;
-            *ctx.stack_depth += 1;
             ctx.builder.add_op(OpNum2Bin)?;
             *ctx.stack_depth -= 1;
         }
```

Commit message (verbatim): "Remove spurious stack_depth increment in the 2-argument `byte[](val,size)`
dynamic cast branch. The sister function `compile_bytes_call`'s equivalent branch does not have this extra
increment; `OpNum2Bin`'s own `-1` correction already accounts for the net pop2-push1 effect. Symptom:
covenants referencing a `byte[](val,size)`-derived local variable downstream would get progressively
miscalculated PICK indices... Verified: cargo test --release all green (500+ tests, 0 regressions), full
covenant re-broadcast on TN12 testnet confirms non-vacuous binding and continuation state transitions now
execute correctly."

Packaged as `silverc-zk-8065184.exe` (SHA256 `9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4`)
in `D:/silverscript/versioned-builds/`, pinned per-family since 2026-07-07 (see `MANIFEST.txt` in that
directory — not mirrored here as it documents a separate live-runtime-path incident, unrelated to this
inventory beyond confirming the fix is deployed, not merely committed).

## Full inventory data

See `2026-07-19-jepu1-blast-radius-inventory.json` (same directory) for the complete 218-row table with
Codex's requested columns: `market_id, genesis_created_at, redeem_length_bytes, full_redeem_sha256,
normalized_template_sha256, matches_jepu1_normalized_template, faulty_window_offset_bytes,
compiler_provenance, settle_state, overlap_with_15_pruning_stranded, refund_path_replay_result`.
`refund_path_replay_result` is `pending` for all rows — Track B (J1tn) has not yet completed the jepu1 pilot,
so no market in this inventory has a confirmed recovery path yet.
