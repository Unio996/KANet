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

---

## DEC-20260719-001 — Adopt Settlement Evidence Continuity & Recoverability as top pre-feature priority

- decided_at_utc: 2026-07-19 (Owner instruction "剩两件收口: 授权!!! 干!!!" in dev-coord-testnet)
- authority: Owner
- status: active
- related_discussion: DISC-20260717-001 (KANET-ARCH-PRIORITY-001), Bettor+Codex consensus (RESPONSE-001-001/002/003/004)
- related_artifacts: `DISCUSSIONS.md` RESPONSE-001-001..003; `responses/RESPONSE-DISC-20260717-001-002.md`, `-004.md`; commits `ad7950cc`, `da0b139e`

Decision:

Adopt **"Settlement Evidence Continuity and Recoverability — lead with endBlock capture and restore proof"** as the highest-priority engineering work that precedes further feature expansion. Owner authorizes the two wrap-up items:

1. **This priority is now a formal decision** (proposed_decision → decided), superseding no prior decision; it sets sequencing, not implementation approval.
2. **Gate 0 (read-only evidence work) proceeds now** under ordinary technical delegation, owner = J2, target = before the WC-final settlement window (2026-07-19T19:00Z). Gate 0 must produce reproducible artifacts, not narrative:
   - a pruning-margin report for every non-terminal market (deadline_daa, endBlock-capture status, NULL `side_lock_daa` exposure, current pruning-point daa, remaining margin);
   - a disposable-copy `console.db` restore drill isolated from the live SQLite/WAL environment (no `backup()`/`VACUUM INTO` on the live file);
   - explicit provenance for any aggregate affected-value/user-count figure (replacing the unmeasured ~54,275 KAS / 1,526-user estimate).

Rationale:

The active liveness failure (`getBlockAtDaa` MAX_WALK exhaustion, VERIFIED at `kasia-relay/src/rpc-listener.mjs:262/284`) is the highest-urgency manifestation of missing evidence continuity: the consensus-critical committee endBlock is not durably captured before the reconstruction window closes, unlike `side_lock_daa` which has a full pre-prune capture stack. This is already stranding money-path state (half-final refund markets). Leading with endBlock capture + a proven restore path closes the class.

Consequences:

- Gate 0 is read-only; it does NOT authorize any production-state change.
- **Batch 1/2 (endBlock-capture code, pruning-point monitor, ZK `checkLanded` unification, backup/restore/replay infrastructure) remain gated: each requires design ownership + red-team review + explicit Owner money-path/production authority before implementation or deployment.** Owner's "干" authorizes items 1–2 only, per the scope Bettor stated on receipt.
- Bettor records Gate 0 artifact paths/commits in the bridge as they land and reports measured figures to Owner.
- `DISC-20260717-001` moves to `decided` (authority recorded here).

---

## DEC-20260725-001 — Freeze trunk roadmap v1.2 and grant full TN12 execution authority

- decided_at_utc: 2026-07-25T20:06:31Z
- authority: Owner
- status: active
- related_discussion: Issue #5 / v1.2 convergence review
- related_artifacts: `docs/2026-07-25-kanet-trunk-roadmap-modularization-and-external-access.md`; `FROM-CODEX.md` MSG-20260725-135

Decision:

Owner stated: “这本身就是测试网。全授权！”

This is recorded as four explicit approvals:

1. **A — yes:** run the user track and technical/safety track in parallel.
2. **B — yes:** freeze the minimal M0b contract-v1 scope stated in v1.2; Agent Card, Discovery and Trust Facts remain deferred to M5/contract v2.
3. **C — yes:** freeze KANet trunk roadmap v1.2 as `FROZEN-EXECUTING`, start §16.2 immediately, retain X2a as the covenant-native digital-asset ticket and keep X2b outside this execution line.
4. **D — yes:** within the v1.2 dependency graph, fully authorize TN12 code changes, testnet deploy/restart, test-asset money paths, chain writes, signing/broadcast, controlled privileged actions, fixes and rollback. No further per-package Owner request is required once the roadmap's technical gates are met.

The full authorization removes repeated Owner approval gates; it does **not** remove task dependencies, named ownership, design → NWT red-team → code → diff review → load order, fail-closed behavior, rollback or immutable evidence requirements. It excludes mainnet, fiat, real assets and product expansion outside v1.2.

Consequences:

- `T-authorize = 2026-07-25T20:06:31Z`.
- By `2026-07-25T21:06:31Z`, Bettor must issue named ACKs for both 0A cards `B0-O1-KILL-SWITCH-INTEGRITY` and `B0-O2-HEALTH-MONITOR`, or record the exact blocker, responsible party and next decision point.
- All eleven §16.2 cards enter Bettor manual intake now; before M0a is evidence-closed, no card is assigned without `MANUAL-INTAKE-PASS` plus a named DRI ACK.
- Later waves unlock by the dependencies and DoD in v1.2. Compliant TN12 execution does not return to Owner for repeated authorization.
- `BLOCKED_DO_NOT_RUN_G5` still blocks the known-bad package until its stated technical gates pass; full authorization is not permission to load a package that has failed or not yet passed its gates.
- This decision does not silently supersede unrelated recovery-specific decisions unless that work is explicitly admitted into the v1.2 task graph.

Supersedes:

- v1.2 `FREEZE-CANDIDATE / AWAITING-OWNER-A-B-C` status;
- the requirement for repeated per-package Owner approval for TN12 actions that are inside the v1.2 dependency graph and satisfy its execution gates.

