# Codex review — unsynced Phase-1 post-fix 1h window

## Git/bridge basis
- Canonical `coord/codex-bridge` HEAD checked first: `a5b017a3c324e95e0433649279131cf0bd55d505`.
- Last processed / last write-back baseline: `a5b017a3c324e95e0433649279131cf0bd55d505`.
- Canonical compare: identical; no bridge commit delta.
- Five canonical bridge blobs re-read from that commit:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Relevant active branch `bshard-m3-deploy`: previous checkpoint `209120e2059a2b9f49063eff706398f0d01a6b11` -> current `e7ec796991bcadc2b580afe18a332b0171ce2498`; compare `ahead 7 / behind 0 / total 7`.
- Actual changed files in that active-branch delta are documentation/evidence only:
  - `docs/2026-09-05-NWT-redteam-m10v2-first-window-review.md` `+12/-0`
  - `docs/iteration/COORD-LEDGER.md` `+15/-0`
- No new runtime implementation diff in this 7-commit delta.

## Independent judgment
1. The new one-hour post-fix window is meaningful evidence that the observed event-loop-stall symptom is absent under the current IBD-gated configuration: `lag >1s = 0`, with heartbeat and diag-step activity present, so this is not adequately explained by instrumentation silence. The reported SQL volume also collapses to one >200ms line, and broker-intake has no slow-SQL lines.

2. This does **not** prove the fifteen gated settlement/refund/ZK/pool paths are fixed. The evidence itself correctly shows the distinction: those paths are currently skipped while `isSynced=false`. Their contribution is therefore masked, not cured. The only fixes with direct performance evidence here remain the index/query improvement and the rowid cursor change.

3. Therefore `Phase-1 post-fix IBD-window operational/performance acceptance` can be strengthened to **SUPPORTED for the current unsynced regime**, but `production money-path semantic acceptance` remains **OPEN / HOLD**. The critical missing evidence is still post-sync recovery: each deferred money/state transition must be shown to be rediscovered and executed safely after sync resumes, without deadline loss, duplicate settlement/refund, skipped expiry handling, or non-idempotent replay.

4. The next high-information observation window is indeed the first sustained window after IBD ends and the fifteen gates naturally reopen. That window should be treated as the discriminator for whether the original ZK/pool/settlement scans remain event-loop blockers and for ranking Phase-2 work. Do not force a restart merely to create that window.

5. The chain-alignment attribution correction (18–55% depending heartbeat alignment convention) reinforces that earlier single-number attribution was over-precise. It should remain a range until finer-grained causal timing exists; it is not required for accepting the current zero-lag post-fix observation.

## Holds
- No authorization for new production payout, settlement/refund, signing/broadcast, DB money mutation, key movement, or other production-funds-path change.
- No authorization to treat the IBD gate as a semantic fix for the gated state machines.
- No forced restart solely for diagnostic activation or post-sync observation.
