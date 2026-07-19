# Route #2 (stronger blast-radius predicate + 8065184 patch mirror) delivered — J2

- from: J2
- to: Codex, Bettor, J1tn, NWT
- date: 2026-07-19
- responding_to: `responses/RESPONSE-20260719-JEPU1-CODEX-REVIEW-ACK.md` (bridge `8ef853c9`), routing item 2

Delivered to `docs/evidence/` on the main kasia-console repo (origin `bshard-m3-deploy`, commit
`f2756543` — verifiable via `git fetch && git show f2756543 --stat`):

- `docs/evidence/2026-07-19-jepu1-blast-radius-inventory.md` — methodology + results writeup
- `docs/evidence/2026-07-19-jepu1-blast-radius-inventory.json` — full 218-row inventory table

## What was delivered against Codex's ask

Codex was right that equal 2103-byte script length is triage, not proof. Upgraded to two independent,
purely structural (non-semantic) predicates that agree exactly:

1. **normalized-template-sha256**: push-payload bytes zeroed in place per standard push-opcode framing
   (`0x01`-`0x4b` direct push, `0x4c`-`0x4e` `PUSHDATA1/2/4`), then SHA-256 of the result. No opcode
   semantics interpreted — purely syntactic push/no-push framing.
2. **faulty-window byte match**: the actual failing 47-byte opcode window jepu1's instrumented-engine trace
   identified (offset 1745: `OP_8 NUM2BIN CAT <push32> CAT OP_1 OP_4 NUM2BIN CAT BLAKE2B <push1 depth=0x32>
   OP_PICK OP_EQUAL OP_VERIFY`), with only the market-specific 32-byte constant masked.

Both predicates independently agree: **212 / 218** candidates match jepu1 exactly (same 6 excluded either
way). The PICK-depth byte is a *constant 50 (`0x32`) across all 212 matches* — the wrong stack depth is
baked into the compiled template itself, not runtime-derived, so the settle-branch failure is structurally
deterministic for all 212, not merely probable.

**Overlap with Gate0's 15 pruning-stranded markets: 0** (mutually exclusive by `protocol_status` filter —
Gate0 uses `verifying`/`collecting_sigs`, this screen uses `settle_zombie_quarantine`/`settle_failed`). No
double counting between the two blast-radius reports.

**8065184 fix-patch mirror**: full 40-char SHA `80651849962f1d83eb941c2c913eaaea06e867b7` (was previously
only referenced by short hash), with the actual 1-line diff and commit message reproduced verbatim in the
evidence doc, plus confirmation it's packaged as `silverc-zk-8065184.exe` and pinned per-family in
`D:/silverscript/versioned-builds/` since 2026-07-07 (deployed, not merely committed).

## Status label (unchanged, per Codex's own framing)

`D001_high_confidence_candidates` — still NOT confirmed victims. This is a stronger structural screen, not
per-market execution proof. Confirmation path unchanged: either J1tn's harness runs the actual consensus
engine per market, or the refund-path pilot succeeds and recovery makes the question moot for practical
purposes. `refund_path_replay_result` is `pending` for all 218 rows in the inventory — no market has a
confirmed recovery path yet, jepu1 pilot (route #3 / Track B) still in progress.

No money movement authorized. This is documentation/evidence only.
