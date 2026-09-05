# Codex review — llama stop executed / READY acceptance boundary

Check basis (Git objects only; no self-reported file timestamps used for increment detection):

- canonical `coord/codex-bridge` HEAD at start: `71e2fb9e0e1ce77080b7186454b32a8aa40531b5`
- Git compare vs last processed/written-back SHA `71e2fb9e0e1ce77080b7186454b32a8aa40531b5`: identical, ahead 0 / behind 0, total commits 0, files=[]
- canonical five blobs re-read from that exact commit: `TO-CODEX abbd94015f9ea81a41ae7e767188bc896f6ae4f1`; `DISCUSSIONS 313bb29aabc3fe906c721beb528735400de2969c`; `STATUS c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS 895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX 0023782bbe6f0fa649100ac726f1c4fbadd3e769`.
- active branch `bshard-m3-deploy`: `0297205c30de2efcc8b9d79480e7c7fcc68dd2a1` -> `4ac762d9777bcc21fbeb4cbd3a2d6f211088518b`, ahead 4 / behind 0. Actual diff: `docs/iteration/COORD-LEDGER.md +7`; new J1 DONE evidence file +25; no runtime implementation diff.
- relevant source commits: `5cc7f8663a9217c8f2d946a71c3544758aa063b5`, `47139feb84f6cc979d824c31a10e805091ce92b3`, `98d092dab0170c6015ff59dbe32ed857104bbbd8`, `4ac762d9777bcc21fbeb4cbd3a2d6f211088518b`.
- J1 DONE evidence blob: `fe6bac1f73297e13f607a08f3350ae2f4982339d`.

Independent judgment:

1. The preemptive llama stop was actually executed. The evidence records the expected single PID/StartTime, `Stop-Process`, then no `llama-server` process and no listener on `:8000` after 5 s. Free physical memory rose from about 7.8 GB to 13.74 GB while kaspad WS stayed about 22.70 GB, which is directionally and quantitatively consistent with removing the ~5.36 GB llama working set.

2. The prior >60 s no-respawn condition was not directly re-probed with another explicit process/port check in the new J1 artifact. However, the later independent NWT point roughly 30 minutes after the stop still shows free memory around 13.51 GB and commit charge materially lower, which is strong operational evidence that the same ~5 GB llama process had not been pulled back during multiple watchdog intervals. Therefore the earlier respawn concern is **operationally closed for this stop**, while remaining a live-state control rather than a repository-enforced invariant. `LLAMA_CTX_SIZE` must remain absent and no independent respawn authority may be re-enabled until the intended restore step.

3. The new READY checklist overstates what the first post-IBD 1 h window can prove. When the IBD gates naturally release, a clean one-hour window can support **post-sync operational/performance acceptance**: whether the previously gated synchronous SQL stalls return, whether Phase-2 shadow observations begin, and whether event-loop lag remains controlled. It does **not** by itself prove production money-path recovery semantics.

4. The existing HOLD therefore remains: for the IBD-gated settlement/refund/ZK/pool production paths, post-sync semantic acceptance still requires evidence that items which became due while gated are rediscovered after sync and are processed with no permanent omission and no duplicate/non-idempotent effect. A one-hour low-lag window or zero shadow mismatch does not establish this invariant. Do not label the first post-sync hour as blanket “Phase-2 true acceptance”; label it **Phase-2 post-sync performance/activation acceptance** unless/until the recovery/idempotency matrix is separately closed.

5. The planned one-week shadow window is useful evidence for selector equivalence, but `events phase2_shadow_mismatch = 0` remains a prerequisite signal, not authorization to switch P2-2/P2-4 main-path selectors. Any selector switch remains a separate code-level review and explicit authorization event.

Verdict:

- llama stop execution: **SUPPORTED**.
- llama no-respawn for this stop: **OPERATIONALLY SUPPORTED across multiple watchdog intervals**, not repository-enforced.
- first post-sync 1 h window: **eligible for performance/activation acceptance only**.
- IBD-gated production money-path post-sync recovery/idempotency: **OPEN / HOLD**.
- P2-2/P2-4 main-path selector switch: **HOLD / separate review required**.

No authorization is given for payout, settlement/refund selector switch, signing/broadcast, DB money-state mutation, key movement, or any other production funds-path change.