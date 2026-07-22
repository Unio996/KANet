# Codex final technical review — modularization roadmap v0.4.2

## Verdict

**GREEN-with-notes.** This is a technical architecture verdict only. It does not freeze the roadmap or authorize implementation, deployment, database changes, signing, broadcasting, settlement, refunds, or fund movement. Owner/delegate authority remains required.

## Increment reviewed

- prior bridge cursor: `903fd919dda13675188e8ba57bb93c6a0166b6ba`
- new message: `MSG-20260723-115`
- `TO-CODEX.md` blob: `6df10ed6e56fa4658e10e39e50d0d977d8c5a7b2`
- roadmap commit: `72f7a40024c17813fcffc3dd4841fc79d696b639`
- roadmap blob: `ce5c3f5d4a4ef676f63034b3c84fccd8028a4328`
- containment design commit: `88054ad2`
- containment blob: `ea746ebe259275816e5456b719f588c757cbdec1`

## Three remaining MUST-FIX items

### MF1 — CLOSED

v0.4.2 adds M0c before M1 and before extracted applications may reach Relay. It now requires authenticated caller identity, default-deny exposure, capability-policy evaluation, caller-scoped resources, replay/idempotency protection, identity-bound audit receipts, and revocation without code deployment. Commands without a completed economic-effect verifier remain internal and cannot enter the public contract.

### MF2 — CLOSED at roadmap level

The roadmap now correctly treats the custodial subject-binding weakness as an active internal lateral-risk condition rather than only a future process-separation risk. The separate containment card requires server-verifiable caller-to-subject binding and a negative cross-subject authorization test. The containment remains separately governed and is not approved by this roadmap verdict.

### MF3 — CLOSED

M0a is now repository-wide and differential: existing raw-access debt is fingerprint-baselined, new occurrences fail by default, moves do not reset debt identity, and exceptions require explicit ownership and burn-down milestones.

## Notes that remain implementation gates

1. M0c batch sizes and semantic slices may remain TBD now, but must be completed after M-1 and before implementation authorization.
2. The containment card remains DRAFT and still requires red-team review, Owner/D-011 authority, implementation review, negative tests, and deployment evidence.
3. No extracted application may receive Relay access until M0c is implemented and denial, replay, scope, audit, and revocation tests pass.
4. Class-B exposure graduates only through per-command typed-intent/effect verification or retirement; caller allowlisting or template matching alone is insufficient.
5. Stale editorial status rows should be cleaned before Owner freeze so the frozen document has one current process state.

## Final judgment

The roadmap has advanced from directory modularization to capability-bounded modularization and is technically coherent enough for Owner freeze consideration. Every later implementation batch remains separately gated by design, review, tests, authority, and deployment evidence.
