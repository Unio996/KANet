# Codex ↔ KANet coordination status

Last updated: 2026-07-17T15:22:00Z

| Item | Owner | State | Current step | Next action | Blocker | Related |
|---|---|---|---|---|---|---|
| `KANET-CODEX-BOOTSTRAP-001` | Bettor (coordination) | `stood_down` | Owner decided to keep GitHub file coordination and not deploy the host Gateway/MCP runtime | None; retain PR #3 only as historical assessment | None | `DEC-20260717-001`, PR #3 |
| `DISC-20260717-001` / `KANET-ARCH-PRIORITY-001` | Codex (discussion initiator); KANet-side responder not yet named | `collecting_feedback` | Codex checked the canonical branch after Owner forwarded the request; no ACK, structured response, blocker or evidence submission is present yet | A named KANet agent should append a code-grounded response to `DISCUSSIONS.md` and notify via `TO-CODEX.md`; a partial domain response is acceptable if scope and unknowns are explicit | No named evidence-producing responder has ACKed this discussion yet | `DISCUSSIONS.md`, `CONTEXT.md`, `FROM-CODEX.md` MSG-20260717-002 and MSG-20260717-003 |
| `DISC-20260717-002` / `KANET-COVENANT-DERIVATION-001` | Bettor (discussion owner); J2 (SS evidence owner); Codex (external assessment) | `collecting_feedback` | Codex completed first code-grounded assessment: B-plus is most likely — hand-built constructor/redeem coherence breach plus a missing general invariant gate; not enough evidence for final classification | J2 runs the four-value byte probe and identifies the direct API write path; Bettor clarifies the zero-UTXO queried address; add one normal-flow control market | Full addresses/script bytes and four-value reproduction are not yet committed | `DISCUSSIONS.md` RESPONSE-DISC-20260717-002-001; `FROM-CODEX.md` MSG-20260717-005; tx `a7d67850...` |

## Verified facts

- The active persistent collaboration channel is `coordination/codex-bridge/` on branch `coord/codex-bridge`.
- The channel contains shared context, structured persistent discussion, directional mailboxes, canonical status and a final decision ledger.
- Codex has GitHub repository write access but no background listener and no direct KANet-host access.
- The runtime Gateway/MCP deployment remains explicitly stood down by Owner decision.
- `DISC-20260717-001` is a proposal under review, not an implementation decision.
- As of 2026-07-17T15:22:00Z, no KANet agent response to `DISC-20260717-001` has been committed to the canonical channel or found elsewhere in repository search.
- `DISC-20260717-002` has a real KANet-side request and a Codex code-grounded response; final classification is gated on byte-level reproduction and a normal-flow control.
