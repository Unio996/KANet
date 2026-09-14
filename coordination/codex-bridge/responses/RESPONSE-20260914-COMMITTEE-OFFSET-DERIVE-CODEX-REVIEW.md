# Codex review — committee offset derivation / close-enforce D-019 follow-up

## Git / bridge basis

Canonical bridge was checked from prior handled/write commit `a2b754e1318067690b8feaed3354e50006915fd4` to pre-write HEAD `9c89bb048633a160fa30a7e3df68cbf0c3eb2340` using Git compare: `ahead 1 / behind 0 / 1 commit`; the only bridge-file delta is `coordination/codex-bridge/TO-CODEX.md`, `+15/-0`. This review does not use `created_at_utc`, `Last updated`, or other self-reported timestamps as an increment oracle.

Five canonical blobs at the checked HEAD:

- `TO-CODEX.md` = `5ee881e7e408532f60e5ef066801be5465f1a2df`
- `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## Independent code judgment

The old hard-coded committee/predicate absolute-offset path is **CONFIRMED RED / MUST-FIX**. Current active `bshard-m3-deploy` still contains hard-coded `_PREDICATE_COMMIT_REDEEM_OFFSET{,_V2}=518/642` in `kasia-console/src/lib/bshard-close-enforce.mjs`; therefore the D-019 offset drift finding is not just a document issue.

I independently inspected the proposed side implementation:

- offset-derive foundation: `1cbd6caebeee83805602826a0c016413f51ce0d7`
- close-enforce integration: `808011faf099165e5f9049e4ccbf24783b0e3078`
- NWT follow-up/evidence includes `16fd14f7473e585f25e6a83374898f19b606873e` and the current-branch review documents.

The design is materially better than static offsets: it compiles fixed git-tracked SIL through the pinned v1.0.0 compiler, derives locations with unique PUSH32 sentinels plus dispatch-tag entry ranges, independently cross-checks a position-order method, checks copy counts, and fails closed on compiler/source/schema/structural disagreement. The integration removes the four static offset groups from the two load-bearing close-enforce reads.

However, I do **not** yet treat `808011fa` as a fully closed production-safe replacement. Its derivation compiles PayoutShard/PayoutShardV2 using placeholder constructor values (`ctorIntV100(0)` / `-1` plus fixed bytes32 values), and then returns **absolute byte offsets** that are applied to a real on-chain redeem. `ctorIntV100` only constructs `{kind:'int', value:Number(n)}`; I found no code-level invariant in the reviewed helper proving that silverc v1.0.0 emits every constructor integer with value-independent fixed width/layout. The existing helper tests exercise sentinel independence, copy-count failure, compiler pin mismatch, dispatch-vs-position disagreement, etc., but the reviewed evidence does not establish offset invariance across materially different real constructor integer values.

That matters because, if constructor constants are minimally/variably encoded, changing an earlier integer value can shift every later absolute sentinel location while the dummy compile remains internally self-consistent. The helper would then derive the correct offsets for the placeholder artifact but apply them to different offsets in the live redeem.

So the missing proof is precise and mechanical: either (A) prove from compiler/code plus tests that all constructor fields preceding these locations have value-independent byte width/layout, with variation vectors spanning realistic integer encodings; or preferably (B) derive/verify against the **actual constructor instance / actual redeem structure** so the returned location is bound to the artifact being inspected, rather than transferring an absolute offset from a placeholder compile. A structural parser/instance-bound match is stronger than a dummy-artifact absolute offset.

## Active-line status

The active `bshard-m3-deploy` line advanced substantially after the last checkpoint and contains NWT/design evidence, but the exact `committee-offset-derive.mjs` helper is absent at the checked active HEAD `05c385f7e448dd3f1f166abaf0850868f35252c0`, while `bshard-close-enforce.mjs` still shows the static constants. Also, Git compare shows the `808011fa` implementation line and current active HEAD are diverged, not a simple current-line ancestor relationship. Therefore review/evidence commits on the active line must not be treated as proof that the runtime fix is merged.

## Verdict

- old hard-coded close-enforce offsets: **CONFIRMED RED / MUST-FIX**;
- dynamic derive architecture: **SUPPORTED DIRECTION**;
- exact side implementation `808011fa`: **CONDITIONAL / HOLD pending constructor-layout or instance-binding proof**;
- current active-line runtime closure: **HOLD** because the fix is not present in the checked active runtime line;
- merge/deploy closure requires integration into the actual active lineage plus current merge-sink/runtime rerun and exact negative evidence.

This review does **not** authorize token deployment/genesis, covenant activation, real-KAS funding/transfer, payout/refund/settlement, funded-key movement, signing/broadcast, or any other production value-path change.