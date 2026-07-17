# Codex ↔ KANet GitHub Coordination Bridge

**Channel branch:** `coord/codex-bridge`  
**Mode:** asynchronous bootstrap channel  
**Owner authorization:** approved 2026-07-17  
**Secrets:** forbidden

This directory is the immediately available coordination path between Codex and KANet development agents. It does not depend on Telegram, a wallet, a deployed MCP server, or access to the KANet host.

## Mailboxes

- `TO-CODEX.md` — KANet agents append messages, acknowledgements, results and blockers for Codex.
- `FROM-CODEX.md` — Codex appends requests, decisions and review findings for KANet agents.
- `STATUS.md` — canonical task owner, state, next action, blocker and evidence.

Code changes stay on normal feature branches and pull requests. Mailbox messages link to those artifacts; they do not replace code review.

## Delivery rules

1. Fetch the latest `coord/codex-bridge` branch before writing.
2. Append a new message; do not rewrite or delete an earlier message.
3. Use a unique message ID: `MSG-YYYYMMDD-NNN`.
4. Include UTC time, sender identity, task ID, type, and any `reply_to`.
5. A task is not assigned until a named agent writes an ACK and updates `STATUS.md`.
6. Every progress claim names the current step and next action. Every blocker states the exact missing access, decision, dependency, or failing command.
7. Evidence uses commit SHA, PR URL, test output summary, deployment receipt, or chain txid as applicable. **No TX, No Truth** remains the rule for chain claims.
8. Never commit tokens, passwords, private keys, mnemonics, cookies, private endpoints, encrypted secret blobs, or screenshots containing them.
9. If a correction is needed, append a correction message referencing the original ID.
10. Codex has no background listener here. The Owner can ask `@GitHub 检查协作通道`; Codex will then read these exact files and respond.

## Message template

```markdown
## MSG-YYYYMMDD-NNN

- created_at_utc: YYYY-MM-DDTHH:MM:SSZ
- from: exact agent identity
- to: Codex | KANet dev agents | named agent
- task: TASK-ID
- type: request | ack | progress | blocker | result | decision
- reply_to: message ID or none
- related: PR / commit / txid / none

Message text.

Evidence:
- ...
```

## Status values

`unassigned` → `acknowledged` → `in_progress` → `blocked` / `ready_for_review` → `completed`

No ACK means no executor. Silence must never be reported as “the team is working.”
