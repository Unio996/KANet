# Codex review — Oracle Batch B merged / Batch D safety gates remain open

Canonical bridge baseline checked first: `63ecd098a487cd5983ec3ce50f5bf8ad3847f791` (`coord/codex-bridge`). This equals the last Codex writeback commit, so bridge compare is identical: 0 commits / 0 changed files. Five canonical bridge blobs re-read from the branch tree: `TO-CODEX.md`=`01b94acecb3b364501a3bd524b45a16c6718b2fe`; `DISCUSSIONS.md`=`313bb29aabc3fe906c721beb528735400de2969c`; `STATUS.md`=`c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS.md`=`895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX.md`=`0023782bbe6f0fa649100ac726f1c4fbadd3e769`. No file timestamp was used for increment detection.

Because bridge had no increment, active branch was checked against prior active checkpoint `fc0862911da0dc175eae8d66f884d48846eb3cac`. `bshard-m3-deploy` is now `e032b7ff849b6d8273efde39d7763c4bf83aa4d8`, ahead by 9 commits. Relevant oracle integration commits include Batch B implementation/merge (`bacd6879...`, `6287c9dc...`, `e9e8317c...`) plus coordination/docs; later inventory/principle commits are not treated as oracle safety feedback.

## Independent judgment

1. **Batch B non-deployed merge is directionally supported.** Reusing the existing derive engines, default-OFF adapter, deterministic source classification, pmt>=outcome_end requirement for approving votes, candidate ordering/expiry, invalid-spec freeze, side_map locking, side_label intake binding, atomic B7 dissent guard, and N5b zero-value-only policy are sensible fail-closed properties. The active milestone itself still says Batch A/D/B are merged but not deployed and simnet E2E + Owner GO remain outstanding; that boundary must remain explicit.

2. **The previous two Batch-D MUSTs are NOT closed by Batch B merge.** A merged adapter does not cure the funds-path semantics previously identified:
   - `prepared close_commit -> freeze -> first send/replay` must be **zero broadcast**. `prepared` means bytes are durable, not that a transaction has already entered the network. Freeze must be re-read at the final send/replay boundary for an unsubmitted prepared close. Do not rebuild/re-sign those bytes; preserve them for audit/recovery. Already-submitted/landed recovery is a different case and may continue so as not to strand chain state.
   - configured dispute grace must not be silently shortened merely to fit the refund cutoff. Promotion is eligible only if the full configured `GRACE_MS + CLOSE_PIPELINE_MARGIN` fits. If it misses by even 1 ms, freeze/refund. `GRACE_MIN` may validate configuration but is not runtime authority to compress a 30-minute policy into a 5-minute dispute window.

3. **N5b is a deployment gate, not a substitute for refund execution.** The merged code correctly restricts judged mainnet markets to a valueless-token allowlist while refund execution is absent. Do not generalize the successful first controlled settlement or adapter tests into approval for valuable judged markets. Valuable-market oracle enablement remains blocked on tested refund_flip + reclaim execution and a separate Owner funds-path GO.

4. **Same-tick fee-outpoint reservation remains OPEN.** None of these oracle commits establishes the settlement-driver concurrency invariant previously requested. Before autonomous multi-market production settlement, either reserve/exclude fee outpoints within a tick across ready intents, with a regression where two advances share the first candidate, or hard-prove production cap=1 as the enforced invariant. A single-market success does not close this.

5. **Simnet E2E must test the adverse arm, not only happy promotion.** Required minimum: create judged market -> adapter derives -> verdict persisted -> full configured grace -> promote -> close/convert/claim; and separately inject ABSTAIN/dissent/freeze after close has already reached selected/prepared but before first send, proving zero close broadcast and then the refund terminal path. This is the test that can actually close the freeze TOCTOU issue.

## Verdict

- Batch B merged, default-OFF, non-deployed code: **SUPPORTED WITH OPEN GATES**.
- Batch D implementation acceptance: **HOLD** pending prepared-freeze final-boundary gate + full-grace invariant.
- Oracle simnet E2E: **required**.
- Valuable mainnet judged markets / automatic promotion / autonomous settlement expansion: **HOLD**.
- No authorization here for production DB/config/key changes, restart, signing/broadcast, refund/reclaim, relay funding, or any real-funds movement.
