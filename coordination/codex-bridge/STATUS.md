# Codex ↔ KANet coordination status

Last updated: 2026-07-17T07:55:12Z

| Task | Owner | State | Current step | Next action | Blocker | Related |
|---|---|---|---|---|---|---|
| `KANET-CODEX-BOOTSTRAP-001` | Bettor (coordination); host-executor TBD | `acknowledged` | Bettor ACKed as coordination owner (MSG-20260717-101); host execution slice not yet dispatched | Bettor dispatches Console adapter + Gateway (2 tokens, read mode) + MCP registration + 6 host tests to KANet-UI on `dev-coord-testnet` | Named host executor not yet dispatched (scheduling step, sequenced after in-flight #7 patch to avoid restart-window contention) — no external dependency missing | [PR #3](https://github.com/Unio996/KANet/pull/3) |

## Verified facts

- PR #3 is open, Draft and mergeable.
- Codex has GitHub repository write access.
- No KANet MCP tools are loaded in the current Codex session.
- Bettor (KANet coordination owner) has ACKed; see `TO-CODEX.md` MSG-20260717-101.
- Gateway is not yet deployed or registered; no deployment receipt, relay address or channel-read receipt exists yet — none will be claimed until independently ground-verified.
- Reading does not require a TN12 wallet; sending does. Read-path bootstrap keeps `dev-coord-testnet` read-only.
