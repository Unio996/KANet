# Codex review — unsynced D-012 LIVE gate / harness wording

## Git basis

- `coord/codex-bridge` checked HEAD: `dcd2dc195f032b1c407817933de495e291046667`.
- Previous processed/written-back baseline: same SHA; compare is identical, zero bridge file diff.
- Directly related active branch `bshard-m3-deploy`: `c6187e218d63b10eecfa566dd477faec3b237632` → `2ec9ea41a7c67f8b9c3bb78c75a227c073a0762a`, ahead 10.

## Independent ruling

1. Mutation-runner evidence wording fix at `075fe7da910953255dcc930fbdfcd2db38cdff64` is **ACCEPTED**. Current code now says only what is actually measured: real source SHA-256 unchanged; `node_modules` top-level entry count unchanged / prior whole-directory-deletion shape not reproduced. It explicitly does **not** claim byte-level dependency-tree integrity. The reported three-arm selfcheck rerun is consistent with this being a wording-only correction. This does not alter the existing §6-1 definition-freeze PASS at `154291d8...` and does not confer LIVE authority.

2. The Owner decision recorded in `docs/DECISIONS.md` to remove the physical-isolation-machine prerequisite for TN12 is a **policy/risk-scope change only**. It may remove that specific testnet precondition, but it does not convert §6-1 into LIVE-ready status and does not grandfather mainnet.

3. The newly recorded local-node state (`isSynced=false`, large tips set) is a **functional LIVE blocker** for any path whose acceptance requires reliable chain confirmation. This is runtime state, not permission. The correct interpretation is therefore: physical-host prerequisite removed for TN12; LIVE remains fail-closed until node health/synchronization is independently demonstrated and the remaining post-land wiring/schema/TOCTOU gates are actually satisfied.

4. Do not promote a single `isSynced=false` snapshot or tips count into a unique root-cause diagnosis. Node-health closure should bind concrete endpoint/node identity, repeated sink/DAA progress and synchronization observations, and the chain-confirmation behavior required by the actual registration/settlement path. A recovered node does not itself authorize a production/testnet money-path change; it only removes a functional blocker.

5. The relay dedup / UTXO redundancy / change-index / mempool-reject findings in the same active-branch window remain separate, non-D-012 money-path work. They are not collaboration feedback for this §6-1 gate and are not authorized here.

## Status

- §6-1 definition freeze (`154291d8...`): **PASS unchanged**.
- Mutation-runner v2 wording boundary: **CLOSED / ACCEPTED**.
- TN12 physical-isolation-machine prerequisite: **REMOVED BY OWNER POLICY, TESTNET-SCOPED**.
- §6-1 LIVE: **NOT CLOSED / FAIL-CLOSED** pending node-health evidence plus remaining post-land implementation/wiring gates.
- No production or testnet registration rollout, settlement/refund, DB mutation, signing/broadcast, key movement, process action, or deployment is authorized by this review.
