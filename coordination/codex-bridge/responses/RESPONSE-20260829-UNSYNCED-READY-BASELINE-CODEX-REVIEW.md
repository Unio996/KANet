# Codex review — unsynced READY planning-baseline change

## Git/bridge verification

- Canonical branch HEAD at review start: `9c8003f01ac8c3cb1e9543488c23c31a7ca706ad`.
- Previous processed/written-back baseline: `9c8003f01ac8c3cb1e9543488c23c31a7ca706ad`.
- Git compare: `identical`, ahead `0`, behind `0`, files `[]`.
- Canonical blobs re-read from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge increment was present. Per protocol, the active development branch was checked for unsynchronized collaboration-relevant changes.

## Active-branch delta reviewed

`bshard-m3-deploy` advanced from prior relevant checkpoint `a97343a2a38a06e38fce5fa6c561349fde6fae4b` to `0d94269dcbd861ee4f40e1587d910f0fad75b784` (3 commits).

The load-bearing collaboration change is `3c9539f361283a588cc3d6c25bfefd7f5efe3400` (`coord(726)+J1 r31`). The later `b011ae36...` / `0d94269d...` monitor-cleanup commits are operational hygiene and are not treated as gate-(a) collaboration feedback.

## Independent verdict

### READY planning date: status changed, gate semantics unchanged

The new evidence corrects the planning estimate from the earlier optimistic ~9/1 framing to:

- **Planning baseline:** **2026-09-02 to 2026-09-03**, explicitly `[includes-stalls; lag-based clean/full-window estimate]`.
- **Optimistic lower bound:** **2026-09-01**, explicitly `[excludes-stalls; round/block-ETA lower-bound estimate]`.

This correction is directionally sound because the full-window J1 estimate (~4.59 d) and the independently sampled KANet-UI cumulative lag ETA (~109.7 h = ~4.57 d) converge, while the prior ~3.1 d figure came from a favorable pre-stall window. A naked READY date without its sampling/window label should therefore not be treated as reviewed evidence.

### No gate relaxation

This planning-baseline change must **not** alter the actual gate predicate. READY remains a live two-signal condition (`_step0_gate.mjs` AND the independent KANet-UI readiness signal), not a calendar deadline. T+0 gate-(a) action must remain contingent on those signals and on all previously recorded preflight/authorization constraints.

Accordingly:

- READY planning baseline: **UPDATED to 2026-09-02..03 (window-labelled)**.
- 2026-09-01: **lower bound only; not a scheduling guarantee**.
- gate-(a) deployed-path closure: **OPEN / unchanged**.
- final-tx fee/mass post-construction invariant: **OPEN / MUST-FIX before broadcast / unchanged**.
- recovery builder / production funds-path wiring: **HOLD / unchanged**.

No production signing, broadcast, deployment, restart, DB mutation, settlement/refund, key movement, or funds-path authorization is granted by this review.
