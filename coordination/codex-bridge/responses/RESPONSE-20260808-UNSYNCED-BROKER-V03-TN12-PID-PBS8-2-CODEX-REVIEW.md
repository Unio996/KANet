# Codex review — unsynced active-branch changes after bridge baseline 8cb7bb7

## Git / bridge baseline

- Last processed / written-back bridge commit: `8cb7bb7ea7748801d22cfef37a905bb50b7db406`
- Bridge HEAD at start and pre-write recheck: `8cb7bb7ea7748801d22cfef37a905bb50b7db406`
- Git compare `8cb7bb7...8cb7bb7`: `identical`, ahead 0, behind 0, files `[]`.
- Canonical blobs:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No canonical-file diff. Increment decision is based only on Git/tree/blob/diff, not file timestamps.

Because bridge had no increment, I inspected the directly related active branch. `bshard-m3-deploy` advanced from the last reviewed `11491c1e969faba9dbdd4a982ce213918596cb69` to `b1b812cf1506d69bac9001227f8119049c491d7a` (`ahead 8 / behind 0`).

## 1. Broker challenge v0.3: transaction fix accepted, prior REDs still open

Commit `977bd053fa9e7c0769a2f9a1a17d6734fe138de8` correctly adds the requirement that nonce consumption, the `broker_onboarding` mutation, and proof archival commit in one SQLite transaction. This closes the split-state defect identified in the previous review.

However, the current design still says submission is only `broker_address + signature` while the nonce table may contain multiple live challenges. There is still no normative `challenge_id`/nonce returned and echoed to select exactly one challenge row. The server therefore still has to infer or scan candidate challenges. **MUST-FIX remains: one submission must identify exactly one persisted challenge row.**

The design also still leaves the descriptor input set open-ended ("具体字段…最终形态定"). That means the proof still does not mechanically bind the exact state mutation being authorized, especially token replacement / bot binding changes. **MUST-FIX remains: freeze a canonical mutation digest over the actual intended write (operation type + authoritative bot/endpoint/token-binding semantics + role/network/address as applicable) before implementation acceptance.**

Verdict: single-transaction rule **ACCEPTED**; Broker challenge overall remains **RED / NOT READY FOR IMPLEMENTATION ACCEPTANCE** until unique challenge addressing and mutation binding are closed.

## 2. TN12 watchdog PID fix: major improvement, but ownership test is still too weak

Commits `34a91a2448b08f88e30532a2ddd9cc97c480fcbc` and `7ff87a6b9f705e4f879b32b000b8a2fec71276fb` fix two real defects: the watchdog now records the PID it launches instead of killing every host-global `stratum-bridge`, and an operator pause sentinel prevents automatic resurrection after a deliberate stop. Those directions are correct.

But `Get-OwnedMinerProcess` currently validates only saved PID + executable `.Path == $bridgeExe`. That is not a sufficient identity check against PID reuse or another invocation of the same binary. A different `stratum-bridge.exe` process with the same executable path but different config / node / mining arguments can satisfy the current ownership test and be stopped as "owned".

**MUST-FIX before operational acceptance:** persist and verify a stronger launch identity, minimally expected command line/config identity in addition to PID+binary path, or use an OS service/job/process-group primitive whose ownership is unambiguous. The stop path must never act merely because the recycled PID now points to the same executable file.

The new deployment note is also correct that an in-place transition from the old watchdog can accidentally launch a second miner; keep that as an explicit deployment precondition rather than treating code replacement as safe hot reload.

Verdict: host-global process-name bug **FIXED IN PRINCIPLE**; operator-pause defect **FIXED IN PRINCIPLE**; exact process ownership remains **MUST-FIX**.

## 3. PB-S8-2: mechanism/test work is useful, but it is rejection-only compatibility evidence, not authorization evidence

Commits `af8eb3aac86e7dedbb73911cafa904d1d4f32a37` and `b1b812cf1506d69bac9001227f8119049c491d7a` add a pure `evaluateSignReqAnchors()` rejection function plus 17 direct tests and a real mutation probe. Keeping the function disconnected from `handlePoolOracleTxSignReq` is the correct boundary: wiring it into production would change money-path signing behavior and requires the separate Owner gate.

The implementation is also explicit that `ok:true` means only "none of these cheap rejection signals fired" and must never become an authorization condition. I accept that boundary.

The replay result is nevertheless important compatibility evidence: 26/159 observed requests would be rejected by the offline-decidable subset, all on `COMMINGLED_SPINE`, and 24 of those markets are currently `completed`. This does **not** prove the condition is wrong—the historical path may have accepted states the new safety rule intentionally forbids—but it proves that blanket enforcement is behavior-changing and cannot be described as a transparent extraction/refactor. Before any production wiring, the team needs an explicit disposition for existing commingled markets: unsupported legacy class, migration/version boundary, or another separately justified rule. Do not silently convert historical success into future rejection without that compatibility decision.

The 90% output floor is correctly labeled heuristic and the mutation test genuinely anchors the implementation of that heuristic. It still cannot be elevated into a payout-correctness or authorization proof, and its real chain-backed abstention/false-positive rate remains unmeasured for the 133 requests that reached the unavailable input-value gate.

Verdict: pure-function + negative/mutation tests **ACCEPTED AS MECHANISM/EVIDENCE**; production enforcement **NOT AUTHORIZED**; compatibility disposition for commingled legacy markets is **OPEN**.

## Current boundary

No authorization is given here for Broker endpoint exposure, TN12 deployment/restart, PB-S8-2 handler wiring, signer/broadcaster changes, key movement, settlement/refund, database mutation, or any other production money-path change.
