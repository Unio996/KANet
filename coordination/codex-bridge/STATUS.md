# Codex ↔ KANet coordination status

Last updated: 2026-07-17T17:01:58Z

| Item | Owner | State | Current step | Next action | Blocker | Related |
|---|---|---|---|---|---|---|
| `KANET-CODEX-BOOTSTRAP-001` | Bettor (coordination) | `stood_down` | Owner decided to keep GitHub file coordination and not deploy the host Gateway/MCP runtime | None; retain PR #3 only as historical assessment | None | `DEC-20260717-001`, PR #3 |
| `DISC-20260717-001` / `KANET-ARCH-PRIORITY-001` | Codex (discussion initiator); KANet-side responder not yet named | `collecting_feedback` | No new code-grounded response was found in this check | A named KANet agent should append a code-grounded response to `DISCUSSIONS.md` and notify via `TO-CODEX.md`; a partial domain response is acceptable if scope and unknowns are explicit | No named evidence-producing responder has ACKed this discussion yet | `DISCUSSIONS.md`, `CONTEXT.md`, `FROM-CODEX.md` MSG-20260717-002 and MSG-20260717-003 |
| `DISC-20260717-002` / `KANET-COVENANT-DERIVATION-001` | Bettor (discussion owner); J2 + J1tn (SS evidence); Codex (external assessment) | `proposed_decision` | Root cause code-grounded: 8pson minted V2 because omitted `zk_native` defaulted true, then a post-genesis flip to false made the daemon recompile V1. `payout_shards` has no immutable family discriminator, so mutable market metadata selected a family incompatible with landed covenant bytes | J2 records V2 self-recompile closure; design/red-team immutable mint metadata and fail-closed coherence gate; keep 8pson stopped pending separately approved recovery/refund | No production fix authorized; V2 closure probe and recovery design remain pending | `DISCUSSIONS.md` RESPONSE-002-002/003; `responses/RESPONSE-DISC-20260717-002-004.md`; commits `d154e9dc`, `22bf5f72eda3a71b9ff68084c8a5d6a9e67aebef`; tx `a7d67850...` |

## Verified facts

- The active persistent collaboration channel is `coordination/codex-bridge/` on branch `coord/codex-bridge`.
- The channel contains shared context, structured persistent discussion, directional mailboxes, canonical status and a final decision ledger.
- Codex has GitHub repository write access but no direct KANet-host access.
- The runtime Gateway/MCP deployment remains explicitly stood down by Owner decision.
- `DISC-20260717-001` is a proposal under review, not an implementation decision; no new KANet-side evidence response was present in this check.
- `DISC-20260717-002` is no longer an unresolved A-vs-B question. The incident is B-plus with a precise root: mutable `zk_native` family routing diverged from immutable V2 covenant bytes after genesis.
- V1 and V2 use different templates, constructor shapes and pinned compiler families. The 2614-byte G0/G1 difference is consistent with cross-family recompilation.
- The generic risk remains: any post-mint flag mutation, backfill, migration or partial repair can reproduce the mismatch unless covenant family and mint artifacts are bound immutably and checked before spend.
- No recovery, refund or production money-path change is approved by the discussion response.
