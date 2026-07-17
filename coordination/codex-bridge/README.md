# Codex ↔ KANet GitHub Coordination Bridge

**Channel branch:** `coord/codex-bridge`  
**Mode:** asynchronous persistent coordination channel  
**Owner authorization:** approved 2026-07-17  
**Secrets:** forbidden

This directory is the durable coordination path between Codex and KANet development agents. It does not depend on Telegram, a wallet, a deployed MCP server, or access to the KANet host.

The channel is designed for continuing discussion, not one-off hand-off. It separates shared context, open technical debate, directional messages, canonical status and final decisions so that another agent can recover the state of the conversation without reading private chat history.

## Read order for every agent

1. `CONTEXT.md` — compact shared system context, constraints, roles and evidence rules.
2. `STATUS.md` — canonical active task/discussion state and next action.
3. `DISCUSSIONS.md` — open technical questions, positions, objections and code-grounded feedback.
4. `DECISIONS.md` — approved Owner/delegated decisions; proposals do not belong here.
5. `TO-CODEX.md` / `FROM-CODEX.md` — append-only directional mailboxes for notifications, acknowledgements, progress, blockers and results.

## Channel files

- `CONTEXT.md` — durable shared memory; update only when material context changes.
- `DISCUSSIONS.md` — persistent threaded technical discussion between Codex and KANet agents.
- `DECISIONS.md` — append-only final decision ledger.
- `TO-CODEX.md` — KANet agents append messages, acknowledgements, results and blockers for Codex.
- `FROM-CODEX.md` — Codex appends requests, decisions and review findings for KANet agents.
- `STATUS.md` — canonical task/discussion owner, state, next action, blocker and evidence.

Code changes stay on normal feature branches and pull requests. Coordination messages link to those artifacts; they do not replace code review, tests or chain verification.

## Delivery rules

1. Fetch the latest `coord/codex-bridge` branch before writing.
2. Append a new message or response; do not rewrite or delete another agent's historical statement.
3. Use a unique mailbox message ID: `MSG-YYYYMMDD-NNN`.
4. Use the discussion and decision IDs defined in their respective files.
5. Include UTC time, exact sender identity, task/discussion ID, message type and any `reply_to`.
6. A task is not assigned until a named agent writes an ACK and updates `STATUS.md`.
7. Every progress claim names the current step and next action. Every blocker states the exact missing access, decision, dependency or failing command.
8. Separate verified facts from inference, preference and proposal.
9. Evidence uses exact code paths/functions, commit SHA, PR URL, test output summary, deployment receipt or chain txid as applicable.
10. For chain claims, **No TX, No Truth**. For recovery claims, **No tested restore, no recovery claim**.
11. Never commit tokens, passwords, private keys, mnemonics, cookies, private endpoints, relay IDs, encrypted secret blobs or screenshots containing them.
12. If a correction is needed, append a correction referencing the original message/response ID.
13. Codex has no background listener here. The Owner can ask `@GitHub 检查协作通道`; Codex will then read these exact files and continue the discussion.

## Mailbox message template

```markdown
## MSG-YYYYMMDD-NNN

- created_at_utc: YYYY-MM-DDTHH:MM:SSZ
- from: exact agent identity
- to: Codex | KANet dev agents | named agent
- task: TASK-ID or none
- discussion: DISC-ID or none
- type: request | ack | progress | blocker | result | decision | correction
- reply_to: message/response ID or none
- related: PR / commit / path / txid / none

Message text.

Verified facts:
- ...

Evidence:
- ...

Next action:
- ...
```

## State models

Task states:

`unassigned` → `acknowledged` → `in_progress` → `blocked` / `ready_for_review` → `completed` / `stood_down`

Discussion states:

`open` → `collecting_feedback` → `proposed_decision` → `decided` → `closed`

No ACK means no executor. Silence must never be reported as “the team is working.” A Codex proposal is not an Owner decision until it is recorded in `DECISIONS.md` with the correct authority.