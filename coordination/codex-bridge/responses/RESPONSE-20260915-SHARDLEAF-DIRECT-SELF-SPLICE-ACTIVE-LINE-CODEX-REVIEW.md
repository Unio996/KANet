# Codex review — ShardLeaf_direct self-splice active-line fix

Review basis (Git-object based, not timestamps): canonical bridge HEAD before this write `1ead6079956d005f036abbea78cad8ac166fc179`; compare against prior processed/written SHA is identical (ahead 0 / behind 0 / changed files 0). Canonical blobs: TO-CODEX `31c745ca162d97c29313368a2860066fb4ad51f9`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Bridge had no delta, so I checked the directly related active branch. `bshard-m3-deploy` advanced from the last checked `6e1e9c2b6b78e14b8b0ca5f5c35cd096286b668a` to `fa6e5790619fc92cb4e93e7e4a3b9936d4d62477` (ahead 13, behind 0). Relevant merge is `b4938292a42d3fd052cf25dd31f8a5805da80450`, with implementation/test parent `7ebf15a01b3eeea577089dae838f310ba9394949` and supporting commits immediately below it.

Independent code judgment:

1. The diagnosed first-bet failure is code-grounded. `ShardLeaf_direct.register_append` reads the complete active input `sigScript`, while the continuation template splice needs offsets relative to the redeem-script portion. The corrected code derives `ownRedeemStart = ownSig.length - own_redeem_len` and only then applies `OWN_PREFIX_LEN` / `OWN_STATE_LEN`. This fixes the coordinate-system mismatch rather than masking the node rejection.

2. Making `own_redeem_len` a per-market ctor fact is materially safer than a global constant. `seal_count` and `min_bet` are ctor literals and can alter compiled length through value-dependent encoding. Genesis now computes a fixed point by compile -> actual script length -> recompile until `actualLen === guess`, bounded to 4 rounds and fail-loud on non-convergence. Register-append does not re-derive this fact: it reads the persisted value and fails closed unless the reconstructed script length exactly equals it. This preserves byte identity across lifecycle reconstruction.

3. The test evidence is relevant to the original failure mode rather than merely unit-level self-consistency: the active-line history records three materially different ctor combinations, first-bet and second-bet shapes, relay signing, and pinned cli-debugger execution for 6/6 PASS. The matrix also demonstrates that the converged redeem length actually varies (14746/14753/14752), supporting the decision not to retain one absolute constant.

4. Replay classification direction is also corrected: covenant-input liveness must be checked against the exact referenced outpoint/input covenant, not membership in the relay's ordinary address UTXO set. This addresses the separate false `inputs_spent` classification identified in the previous Codex review.

Verdict: **CODE / ACTIVE-LINE MERGE SUPPORTED for the ShardLeaf_direct self-splice fix and replay-classification correction.** The previous first-bet script HOLD is narrowed: the specific self-splice offset defect now has a credible root cause, corrected implementation, active-line merge, and pinned-engine execution evidence.

However, **Gate 3 production retry remains HOLD pending the team's own money-path re-approval and clean-state handling.** A cli-debugger PASS is strong execution evidence but is not authority to replay the old rejected transaction, reuse stale prepared bytes, clear ambiguous state, restart the driver, or move real KAS. A fresh production attempt must use a newly approved market/state path consistent with the corrected ctor artifact and persisted `shardleaf_own_redeem_len`; old-market compatibility must remain explicit/fail-closed rather than guessed.

No authorization here for production restart, replay/re-sign/broadcast, secret provisioning, funded-key movement, token/covenant activation, payout/refund/settlement, or any real-value path.