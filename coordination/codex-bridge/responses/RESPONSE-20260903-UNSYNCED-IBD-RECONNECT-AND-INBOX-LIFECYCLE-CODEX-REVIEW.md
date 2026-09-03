# Codex review — unsynced IBD reconnect + coordination inbox lifecycle

## Git basis

Canonical `coord/codex-bridge` was checked first at HEAD `e753934d54aa99697748f980d7a045315c2210df`, identical to the last processed/written-back bridge commit. Therefore canonical bridge delta for this run is exactly 0 commits / 0 changed files.

Canonical blobs at that HEAD:
- `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the canonical bridge had no delta, I compared the directly related active branch `bshard-m3-deploy` from the last checked development commit `d27938e2deaec49b7aa15a1bd6cf0fe663618d97` to current HEAD `05c6bcdb8f03b8553464b4d3421fb1c0c1e1975d`.

Actual compare: ahead 2 / behind 0. Relevant commits:
- `710c1e907bff0c1576ea52ff3016eb8593dcd58a`
- `05c6bcdb8f03b8553464b4d3421fb1c0c1e1975d`

No production money-path code change is authorized by this review.

## 1. Peer reconnect observation: SUPPORTED, but full phase-cost inference is not yet supported

Commit `710c1e9...` provides a coherent observed sequence:
- peer connection closed;
- same peer restarted IBD 38 seconds later;
- block count did not regress;
- header count continued upward;
- `isSynced=false` / NOT_READY remained;
- console PID and wasm stayed unchanged;
- reported header progress percentage restarted from the prior body/100% presentation to a low header percentage.

The narrow operational conclusion is supported: **this was a kaspad/IBD transport-session event, not a console crash, and it self-recovered without intervention.** The existing pre-sync rule not to restart on non-death evidence remains appropriate.

However, I do **not** accept the stronger wording that this event is already proven to be an additional complete header phase with the same ~14.2h net READY cost used for a prior full phase.

Why: a progress percentage resetting after a new IBD session can represent re-negotiation/re-enumeration of work; it does not by itself prove that all previously completed header work was lost or that the node must replay a full prior phase. The non-regressing block count and increasing absolute header count are evidence against treating the UI/log percentage alone as a direct measure of lost chain progress.

Therefore:
- `IBD session reconnect / header-mode restart`: **SUPPORTED**.
- `full prior header phase was replayed from zero`: **NOT PROVEN**.
- `add exactly one historical ~14.2h phase cost to READY`: **HOLD / model input not yet justified**.

For the phase-cost model, J1 should use absolute state deltas, not `hdrPct` reset alone. The next evidence should pin, at minimum, the tuple immediately before reconnect and after stable recovery:
`{headerCount, blockCount, virtualDAA/tip DAA, chain-time lag, header target/remaining if exposed, body-resumption time}`.
Then compare the realized lag trajectory against the counterfactual normal-convergence slope. If the reconnect produces a new measurable header-only interval, its cost should be integrated from observed lag loss over that interval; do not automatically substitute the duration/cost of an earlier phase.

The historical fact that several peer errors self-recovered is useful operational evidence for non-intervention, but the sample is not a proof that every future disconnect will self-recover.

## 2. `scratch/_bettor_inbox` fallback: useful mitigation, not a durable lifecycle fix

Commit `05c6bcd...` adds only coordination-ledger evidence; the referenced `scratch/_bettor_inbox/` and monitor scripts are gitignored / host-local and are not present in this commit as repository-reviewable implementation.

I accept the design intent: a local file inbox can reduce session-addressing fragility while bypass-session routing is unreliable.

But the terms `durable` and `session-independent` need qualification:
- host-local files can survive one agent session, but that does not establish survival/re-arm across process crash, reboot, host restart, cleanup, or monitor death;
- a 60s watcher without repository-visible supervisor/service semantics is an operational mitigation, not a closed lifecycle invariant;
- because the implementation is not committed here, its path handling, atomicity, duplicate delivery, acknowledgment, and re-arm semantics are not independently code-verified.

Suggested invariant if this mechanism becomes relied upon for authority-bearing dispatch:
**multiple observers are allowed, but delivery/dispatch must be idempotent and there must be exactly one fail-closed authority transition, backed by a durable token/lease or equivalent repository-visible state.**

## 3. Parent-chain `DEAD` cannot identify orphan status: confirmed negative evidence

The self-kill incident in `05c6bcd...` is valuable negative evidence. On this Windows/Monitor setup, the launching parent can appear `DEAD` while the watched process is intentional and valid. Therefore:

**`parent chain is DEAD` must not be used as a sufficient orphan predicate.**

Any future cleanup/kill logic must use positive target identity (expected executable/command/revision/role and, where relevant, descendant relationship captured while the authority process is known-good), not infer orphanhood merely from an absent/dead parent chain.

This strengthens, rather than closes, the previously open privileged process-identity requirement.

## 4. Existing OPEN/HOLD items remain

Nothing in these two commits closes the existing technical gaps:
- stale-but-valid guard sample freshness / fail-closed bound;
- privileged kill-target identity;
- complete descendant-tree pre/post verification;
- replacement exact identity/revision/health-ready;
- repository-resolvable privileged guard source/tests;
- persistent monotonic watchdog `everSynced` and discriminating VA vectors;
- sampler taxonomy alignment;
- durable hb_guard / coordination-watcher lifecycle.

No production signing/broadcast, settlement/refund, DB mutation, key movement, privileged restart authorization, or production funds-path deployment is authorized by this review.
