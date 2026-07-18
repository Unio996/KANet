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

---

## DEC-20260718-001 — Adopt PS-FAMILY / K-18 covenant-family coherence invariant

- decided_at_utc: 2026-07-18 (Owner instruction "采用+ABC")
- authority: Owner
- status: active
- related_discussion: DISC-20260717-002 (KANET-COVENANT-DERIVATION-001), byte-proven CONFIRMED
- related_artifacts: `DISCUSSIONS.md` RESPONSE-002-003/004/005; K-18 coherence-gate design; NWT red-team GREEN-with-3-MUST-FIX

Decision (Owner approved A + B + C):

**A. Adopt the PS-FAMILY / K-18 coherence invariant.** A covenant's family (V1/V2) is chain-frozen at genesis mint; the DB must bind to those immutable bytes, not a mutable flag. Implement the coherence gate:
1. Add a family/pin column to `payout_shards`, written at mint from the actual compile path taken — never inferred from `resolution_rule_spec.zk_native` afterward.
2. Make `zk_native` immutable after genesis-mint (fail-closed reject on UPDATE attempts).
3. `assertPayoutShardCoherence` before any consolidate/settle spend — declared-family ↔ stored G0 structural probe ↔ recompile-by-declared-family byte-equality.
4. Continuation address authority = landed redeem + deterministic splice only (recompile-from-DB-columns demoted to a validation check).

**B. Accept the NWT red-team acceptance criteria** (GREEN-with-3-MUST-FIX); the 3 MUST-FIX (incl. §3.4 authority-convergence full-live-market byte-equal check) are the acceptance bar for the gate implementation.

**C. 8pson itself → fail-closed refund/recovery.** Any fund movement goes through a separate design → red-team → Owner money-path approval. Do NOT force the next address.

Rationale:

8pson root cause is byte-proven (DISC-002 CONFIRMED): mutable `zk_native` family-flag diverged from immutable V2-minted covenant bytes → daemon V1 recompilation → P2SH address fork. Blast radius: every `payout_shards` row is one flag-flip / manual-backfill away from the same failure. The invariant binds family to immutable landed bytes and verifies coherence before spend, closing the class rather than patching one market.

Consequences:

- J1 + J2 own the coherence-gate implementation (with the 3 MUST-FIX as acceptance).
- 8pson stays stopped until its fail-closed refund is designed → red-teamed → Owner money-path approved.
- Existing `payout_shards` rows must be family-classified from stored redeem bytes (never the mutable flag) going forward.
- `DISC-20260717-002` moves to `decided` (authority recorded here).
