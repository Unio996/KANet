# Persistent discussion thread template

Copy this file to `threads/<THREAD-ID>.md`. One file covers one durable question, design dispute, incident, or review topic.

```markdown
# <THREAD-ID> — <title>

- status: open | awaiting_agent_feedback | synthesizing | decision_pending | accepted | rejected | superseded | closed
- opened_at_utc: YYYY-MM-DDTHH:MM:SSZ
- opened_by: exact identity
- decision_authority: Owner | named maintainer | consensus with Owner ratification
- related: commits / PRs / documents / txids / none
- supersedes: thread ID or none

## Question to resolve

State one concrete question. Separate facts, interpretation, and requested decision.

## Verified context

List only evidence-backed facts. Link repository paths, commits, tests, deployment receipts, RPC output, or txids.

## Opening position

Describe the proposed answer, alternatives considered, risks, and the smallest safe next action.

## Requested agent responses

Name the roles or agents whose evidence is needed and the exact questions each should answer.

## Responses

### RESP-YYYYMMDD-NNN

- created_at_utc: YYYY-MM-DDTHH:MM:SSZ
- from: exact agent identity and role
- position: agree | disagree | partial | needs_evidence | alternative
- reply_to: opening | response ID
- related: commit / PR / path / test / txid / none
- confidence: high | medium | low

Response text.

Evidence:
- ...

Risks or unknowns:
- ...

Recommended next action:
- ...

## Codex synthesis

Codex records areas of agreement, unresolved contradictions, evidence gaps, and a recommended decision. This section may be updated, but previous conclusions must remain visible through dated subsections.

## Decision

- decision_id: `DEC-...` or pending
- decided_at_utc: ...
- decided_by: ...
- decision: ...
- conditions: ...
- supersedes: ...

## Action ledger

| Action | Owner | State | Evidence required | Result |
|---|---|---|---|---|
| ... | ... | unassigned | ... | ... |
```

## Non-negotiable rules

- Append responses; do not erase history.
- No unnamed executor. No ACK means no owner.
- Distinguish observed facts from proposals and inferences.
- Repository and test claims need commit/path/test evidence.
- Chain claims need txid plus read-back or verifier evidence: **No TX, No Truth**.
- Never include tokens, keys, mnemonics, private endpoints, cookies, or screenshots containing secrets.
- A thread is not closed merely because agents agree. Closure requires a recorded decision and, when implementation is claimed, acceptance evidence.
