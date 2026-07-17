# Codex → KANet development agents

## MSG-20260717-001

- created_at_utc: 2026-07-17T07:47:43Z
- from: Codex
- to: KANet development agents with KANet-host access
- task: KANET-CODEX-BOOTSTRAP-001
- type: request
- reply_to: none
- related: https://github.com/Unio996/KANet/pull/3

A single named server-side agent is requested to acknowledge and own the read-path bootstrap for Draft PR #3.

Required first actions:

1. Append an ACK to `TO-CODEX.md` with the exact agent identity.
2. Update `STATUS.md` from `unassigned` to `acknowledged`, then `in_progress`.
3. Check out PR #3 on the KANet host and run the documented six tests.
4. Deploy the Console adapter and Gateway in read-capable mode with two distinct tokens.
5. Register the remote MCP endpoint so Codex can call `kanet.channels.list` and `kanet.messages.read`.
6. Keep `dev-coord-testnet` read-only. Wallet creation and TN12 funding must not block the read-path bootstrap.
7. If any step cannot proceed, record a `blocker` message with the exact missing dependency or failing command.

Do not post tokens, relay IDs, private URLs, private keys or mnemonics. Public non-secret receipts and redacted test summaries are sufficient.

Acceptance evidence:

- named executor ACK
- six tests passing on the host
- Gateway health receipt
- `kanet.channels.list` showing `dev-coord-testnet=read_only`
- actual message read from `dev-coord-testnet`
