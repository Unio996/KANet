# Codex ↔ KANet coordination status

Last updated: 2026-07-18T18:25:34Z

| Item | Owner | State | Current step | Next action | Blocker | Related |
|---|---|---|---|---|---|---|
| `KANET-CODEX-BOOTSTRAP-001` | Bettor (coordination) | `stood_down` | Owner decided to keep GitHub file coordination and not deploy the host Gateway/MCP runtime | None; retain PR #3 only as historical assessment | None | `DEC-20260717-001`, PR #3 |
| `DISC-20260717-001` / `KANET-ARCH-PRIORITY-001` | Codex (discussion initiator); KANet-side responder not yet named | `collecting_feedback` | No new code-grounded response was found in this check | A named KANet agent should append a code-grounded response to `DISCUSSIONS.md` and notify via `TO-CODEX.md`; a partial domain response is acceptable if scope and unknowns are explicit | No named evidence-producing responder has ACKed this discussion yet | `DISCUSSIONS.md`, `CONTEXT.md`, `FROM-CODEX.md` MSG-20260717-002 and MSG-20260717-003 |
| `DISC-20260717-002` / `KANET-COVENANT-DERIVATION-001` | Bettor (discussion owner); J2 + J1tn (SS evidence); Codex (external assessment) | `awaiting_authority_decision` | Byte-closure proof reproduced 8pson genesis redeem exactly through V2 (`PayoutShardV2.sil` / `SILVERC_ZK` / 27-param ctor). Root cause is confirmed: mutable `zk_native` family metadata diverged from immutable landed V2 covenant bytes, causing daemon V1 recompilation | Owner or explicitly delegated authority decides PS-FAMILY/K-18 invariant direction and red-team MUST-FIX acceptance criteria; keep 8pson stopped and separate any recovery/refund approval | No production fix, deployment, recovery or money movement authorized | `DISCUSSIONS.md` RESPONSE-002-003/004; `responses/RESPONSE-DISC-20260717-002-005.md`; commit `2976d95d74249a9ebed71748b139d7fbe40203e6`; tx `a7d67850...` |

## Verified facts

- The active persistent collaboration channel is `coordination/codex-bridge/` on branch `coord/codex-bridge`.
- The channel contains shared context, structured persistent discussion, directional mailboxes, canonical status and a final decision ledger.
- Codex has GitHub repository write access but no direct KANet-host access.
- The runtime Gateway/MCP deployment remains explicitly stood down by Owner decision.
- `DISC-20260717-001` remains a proposal under review; no new KANet-side evidence response was present in this check.
- `DISC-20260717-002` is technically root-cause closed by byte-exact V2 reproduction, but no Owner/delegated architecture decision has yet been recorded in `DECISIONS.md`.
- V1 and V2 use different templates, constructor shapes and pinned compiler families. The observed 2614-byte G0/G1 difference is explained by cross-family recompilation.
- The generic risk remains: any post-mint flag mutation, backfill, migration or partial repair can reproduce the mismatch unless covenant family and mint artifacts are bound immutably and checked before spend.
- Existing rows must not be migrated by trusting current `zk_native` alone; family classification must be derived from stored redeem bytes and pinned-family checks.
- No recovery, refund or production money-path change is approved by the discussion response.
