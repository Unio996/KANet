# Codex review — trough census / Owner evidence-policy boundary

## Git basis
- `coord/codex-bridge` checked HEAD: `b6f6d53f2396c40a18fa149ce1d9285051e22430`
- prior processed/written-back SHA: `b6f6d53f2396c40a18fa149ce1d9285051e22430`
- bridge compare: identical; ahead=0; behind=0; changed files=[]
- canonical blobs re-read from Git objects:
  - `TO-CODEX.md` `845b744c327202a32db77b580f6ba52ca9e522e8`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## Unsynced directly-related development delta
`bshard-m3-deploy`: `ed57af6931add19409d827b82e5ebef7889f81a3` -> `27f15103362d852f34379f3b68f257ae9bf1aa72`, ahead 4 / behind 0. Changed set is limited to:
- `docs/2026-08-17-j1-nodehealth-evidence-window-2-trough-census.md` (+36)
- `docs/iteration/COORD-LEDGER.md` (+23)

No runtime registration, relay, settlement, refund, signing, DB, or deployment code changed in this delta.

Evidence artifact blob: `f3c30c7d7f3baff65a905dae17f32f71e7cc7055`.

## Independent ruling
The new trough census is substantive and internally careful. Seven observed low-production intervals are all <=75 s, four contemporaneous two-node samples converge to a 142-DAA gap with both nodes synced, and the passive-traffic calculation correctly explains why 0/22 natural messages landed inside a trough. This materially weakens the hypothesis that the node suffers long or unbounded adverse-phase stalls.

However, the artifact itself correctly labels the <=3 min confirmation bound as an argument, not a measured in-trough confirmation. Therefore the adverse-regime confirmation cell remains **OPEN** under the previously adopted evidence policy. The census does not by itself justify upgrading §6-1 LIVE to closed.

The current decision point is now genuinely an **Owner evidence-policy decision**, not a missing-data interpretation issue:

1. Keep the current policy and continue passive waiting; or
2. explicitly authorize a narrowly scoped, reviewable, non-money-path testnet probe plan; or
3. explicitly risk-accept the bounded-stall argument for testnet go while leaving the adverse confirmation cell formally open.

Codex does **not** choose or authorize option 2 or 3. In particular, this review does not authorize a probe transaction, signing/broadcast, UTXO split, registration rollout, settlement/refund, or any money-path action.

## Current status
- §6-1 definition freeze: prior PASS unchanged.
- measured-regime ingest/liveness: strong positive evidence.
- adverse/trough confirmation: OPEN.
- §6-1 LIVE: OPEN / fail-closed under current evidence policy.
- passive 0-in-trough result: not negative evidence against confirmation capability; collision probability is too low.
- <=3 min worst-case confirmation: useful bounded-stall argument, not measurement.
