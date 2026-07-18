# Codex ↔ KANet coordination status

Last updated: 2026-07-18T12:59:00Z

| Item | Owner | State | Current step | Next action | Blocker | Related |
|---|---|---|---|---|---|---|
| `KANET-CODEX-BOOTSTRAP-001` | Bettor (coordination) | `stood_down` | Owner decided to keep GitHub file coordination and not deploy the host Gateway/MCP runtime | None; retain PR #3 only as historical assessment | None | `DEC-20260717-001`, PR #3 |
| `DISC-20260717-001` / `KANET-ARCH-PRIORITY-001` | Codex (discussion initiator); KANet-side responder not yet named | `collecting_feedback` | No new code-grounded response was found in this check | A named KANet agent should append a code-grounded response to `DISCUSSIONS.md` and notify via `TO-CODEX.md`; a partial domain response is acceptable if scope and unknowns are explicit | No named evidence-producing responder has ACKed this discussion yet | `DISCUSSIONS.md`, `CONTEXT.md`, `FROM-CODEX.md` MSG-20260717-002 and MSG-20260717-003 |
| `DISC-20260717-002` / `KANET-COVENANT-DERIVATION-001` | Bettor (discussion owner); J2 + J1tn (SS evidence); Codex (external assessment) | `awaiting_authority_decision` | Byte-closure proof reproduced 8pson genesis redeem exactly through V2 (`PayoutShardV2.sil` / `SILVERC_ZK` / 27-param ctor). Root cause is confirmed: mutable `zk_native` family metadata diverged from immutable landed V2 covenant bytes, causing daemon V1 recompilation | Owner or explicitly delegated authority decides PS-FAMILY/K-18 invariant direction and red-team MUST-FIX acceptance criteria; keep 8pson stopped and separate any recovery/refund approval | No production fix, deployment, recovery or money movement authorized | `DISCUSSIONS.md` RESPONSE-002-003/004; `responses/RESPONSE-DISC-20260717-002-005.md`; commit `2976d95d74249a9ebed71748b139d7fbe40203e6`; tx `a7d67850...` |
| `KANET-JEPU1-STALE-SIG-RECOVERY-001` | Bettor (gate); J1tn (patch/design); NWT (red-team); Owner/delegate (money-path authority) | `awaiting_authority_and_manifest` | Shared safe-json authority landed in `d060e872`; repository scan/round-trip test landed in `b862c6e0` and caught a fifth raw signing site. Soft-invalidation design is directionally accepted | Commit a repository-visible pre-surgery manifest with full row IDs, market + tx/sighash identity, signer keys, input index, timestamps and payload hashes; obtain Owner/delegated approval; prove canonical console loaded both commits before re-signing | Full exact selector/audit manifest not yet in bridge; Owner 188 KAS authorization absent; canonical process not yet proven restarted on fixed HEAD | `responses/RESPONSE-DISC-20260717-002-007.md`; `responses/RESPONSE-DISC-20260717-002-008.md`; `docs/2026-07-18-jepu1-surgery-order.md`; commits `d060e872`, `b862c6e0`, `e849dfc5` |

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
- The jepu1 signing patch now covers the known cross-node path and an additional refund-disagreement path found by the new repository scan. The test is useful but should later be hardened from partly file-level checks to per-call-site/AST-level binding.
- jepu1 recovery remains unauthorized. No restart, database mutation, re-signing, rebroadcast, settlement or money movement was approved by Codex.