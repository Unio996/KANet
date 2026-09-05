# Codex review — llama preemptive stop / respawn closure

Check basis (Git objects only; no file self-timestamps used for increment detection):

- canonical `coord/codex-bridge` HEAD at start: `0002dc439b7831bc2ebbc9c8bbc35e9bddae0f3d`
- compare vs last processed/written-back SHA `0002dc439b7831bc2ebbc9c8bbc35e9bddae0f3d`: identical, ahead 0 / behind 0, files=[]
- canonical five blobs unchanged: `TO-CODEX abbd94015f9ea81a41ae7e767188bc896f6ae4f1`; `DISCUSSIONS 313bb29aabc3fe906c721beb528735400de2969c`; `STATUS c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS 895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX 0023782bbe6f0fa649100ac726f1c4fbadd3e769`.
- active branch `bshard-m3-deploy`: `e0e251503cd4e9db40096a3cc5ce7052bafb4efd` -> `0297205c30de2efcc8b9d79480e7c7fcc68dd2a1`, ahead 3 / behind 0. Actual diff: `docs/iteration/COORD-LEDGER.md +5`; one new J1 execute note +10; no runtime implementation diff.

Independent code-level judgment:

1. Previous concern is partially closed. Current `kanet-start-headless.sh` reloads `kanet.env` on each invocation and refuses llama spawn when `LLAMA_CTX_SIZE` is absent. Therefore, once the line is actually commented/removed in the live env file, a later console-supervisor-triggered headless restart does not itself respawn llama.

2. `scripts/llm-watchdog.mjs` remains an independent respawn authority. Its `spawnLlama()` reads `process.env.LLAMA_CTX_SIZE`; an already-running watchdog can retain a previously inherited value even after `kanet.env` is edited. The new execute note states NWT observed that `llm-watchdog.mjs` is not running, which addresses the previously identified immediate condition, but this is live-state evidence rather than a repository-enforced invariant.

3. The execute note still has a TOCTOU gap: its pre-stop commands verify only the llama PID/StartTime; they do not re-check immediately before `Stop-Process` that `llm-watchdog.mjs` (or another scheduled/service respawn authority) is absent. A process/task could appear after NWT's earlier check. For robust closure, the executor should include an immediate pre-stop respawn-authority check and then verify after the stop that port 8000 stays down across at least one watchdog interval (>60s), not merely 5s. This changes no production money path.

4. The note's `LLAMA_CTX_SIZE` mechanism is structurally sound for headless restarts because the headless script parses the env file fresh per invocation. The console supervisor itself only invokes headless; it does not directly spawn llama.

Verdict:

- `LLAMA_CTX_SIZE absent => headless path does not respawn llama`: **SUPPORTED**.
- `current NWT observation: llm-watchdog not running`: **EVIDENCE RECEIVED, not repository-enforced**.
- proposed preemptive llama stop: **NO CODE-LEVEL OBJECTION, CONDITIONAL on immediate pre-stop respawn-authority re-check + >60s post-stop no-respawn verification**.
- previous blanket HOLD based solely on the known watchdog path can be narrowed to the above execution-time condition; Codex does not itself authorize or execute the stop.

No authorization is given here for payout, settlement/refund, signing/broadcast, DB money-state mutation, key movement, or any other production funds-path change.