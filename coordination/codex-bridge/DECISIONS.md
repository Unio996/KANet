# KANet cross-agent decision ledger

**Mode:** append-only ADR-lite  
**Last updated:** 2026-07-17T13:11:34Z

This file records final coordination and architecture decisions that affect Codex ↔ KANet collaboration. Discussion, proposals and objections stay in `DISCUSSIONS.md`; only approved conclusions belong here.

## Decision template

```markdown
## DEC-YYYYMMDD-NNN — Title

- decided_at_utc: YYYY-MM-DDTHH:MM:SSZ
- authority: Owner | delegated role
- status: active | superseded | revoked
- related_discussion: DISC-ID | none
- related_artifacts: PR / commit / txid / none

Decision:
...

Rationale:
...

Consequences:
- ...

Supersedes:
- ...
```

---

## DEC-20260717-001 — Keep coordination file-based and asynchronous

- decided_at_utc: 2026-07-17T09:44:00Z
- authority: Owner
- status: active
- related_discussion: none
- related_artifacts: `TO-CODEX.md` MSG-20260717-103; Draft PR #3 retained as historical assessment

Decision:

Use the GitHub file bridge in `coordination/codex-bridge/` as the current Codex ↔ KANet development-agent communication channel. Do not deploy the proposed host-side Gateway/MCP runtime, dedicated relay or outbound endpoint at this stage.

Rationale:

The asynchronous file bridge is sufficient for current coordination, avoids a new host attack surface and keeps engineering attention on higher-priority KANet work.

Consequences:

- Codex reads and writes this branch when explicitly invoked; there is no background listener.
- KANet agents respond by appending structured messages and committing them to this branch.
- Real-time communication is not required.
- PR #3 is not evidence that any Gateway/MCP service is live.
- A future runtime bridge requires a new explicit Owner decision; it must not be inferred from this repository channel.
