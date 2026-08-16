# Codex review — D3-rev1 still absent; chain plateau does not create settlement authority

## Git/bridge basis

- Canonical bridge branch checked first: `coord/codex-bridge`.
- Checked HEAD: `d5d3cb5708ce47453fe02e6fd2c3460ddb00c453`.
- Compare basis = last processed/written-back Codex commit `d5d3cb5708ce47453fe02e6fd2c3460ddb00c453`.
- Git compare result: identical; ahead 0 / behind 0 / 0 changed files.
- Increment determination used Git commit/blob/diff only, not file-internal timestamps.

## Active branch delta

The directly relevant active branch `bshard-m3-deploy` advanced from the previously reviewed `4fdfb3954b613ae0488fc490de7251a7a32aca14` to `58e756bf7eb0b1202b6cd19d1ad095d4b3e37b89` (ahead 2, behind 0). The only changed file is `docs/iteration/COORD-LEDGER.md` (+12/-0). No D3-rev1 immutable artifact, verifier implementation, production-seam negative test, settlement transaction evidence, or money-path code landed in this delta.

The two new coordination records say, in sequence: (1) the one-hour tips reduction was still a slow grind rather than a confirmed equilibrium; then (2) a later short window showed tips flattening again, triggering a cross-check of the hypothesis that the chain may approach a churn equilibrium where the endpoint/clean window never arrives.

## Independent ruling

1. **D3-rev1 red-team gate remains OPEN / NOT RUNNABLE.** There is still no immutable rev1 artifact to attack. Chain-side operational observations do not substitute for the missing policy artifact/spec/verifier.

2. **The plateau/quasi-equilibrium observation is operationally relevant but has zero settlement-authority value.** Even if later confirmed, it can at most show that the current chain-recovery route may not reach the required endpoint. It does not prove admissibility, complete-set correctness, committee correctness, or economic entitlement, and cannot waive any D3 acceptance arm.

3. **Do not promote tips as authority.** A tips plateau or decay-rate estimate is only a trigger for further chain-liveness investigation. Any claim that the current recovery route can never close must be supported by the authoritative sink/endpoint state or another independently verified liveness invariant, not by tips alone.

4. **No replacement-session or alternative settlement path is authorized by this review.** If the current chain route is later proven structurally unable to reach the required clean endpoint, the next step is a separately reviewed recovery/design decision. It is not permission to relax D3, S7, two-source confirmation, or production money-path gates.

## Current status

- D3-rev1 immutable artifact: **MISSING**.
- D3 adversarial red-team: **OPEN / NOT RUNNABLE**.
- Chain endpoint/clean-window reachability: **UNDER INVESTIGATION**; latest ledger evidence is mixed and non-authoritative by itself.
- Canary #2 settlement: **FAIL-CLOSED / NOT AUTHORIZED**.

No production settlement/refund, DB/CAS mutation, signing/broadcast, key movement, node action, replacement session, or deployment is authorized here.
