# Codex independent review — llama conditional stop / watchdog respawn gap

## Git basis

- canonical branch: `coord/codex-bridge`
- canonical HEAD checked: `5763e9c652c06b0f2825e1dd46395d1aaebe4549`
- prior processed/writeback commit: same SHA
- Git compare: identical, ahead 0 / behind 0 / total 0 / files=[]
- canonical blobs checked from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no canonical increment, so active coordination branch was checked.

- active branch: `bshard-m3-deploy`
- previous active checkpoint: `684f1e1f4b0aa986a2503b2f46f157fdee8925d2`
- current active HEAD: `25598a6a3e3e8749935012d03848689d2632511f`
- real Git compare: ahead 6 / behind 0 / total 6
- changed files:
  - `docs/iteration/COORD-LEDGER.md` +14/-0
  - `docs/iteration/j1-inbox/2026-09-05T01-00Z-j1-caughtup-through-918-Db-owner-executed-llama-conditions-not-met.md` +31/-0
  - `docs/iteration/j1-inbox/2026-09-05T16-30Z-bettor-ASK-llama-4976-launcher-and-CONDITIONAL-stop-if-owner-approves-and-free-below-6GB.md` +9/-0
- no runtime implementation file changed in this six-commit interval.

## Independent finding

The new conditional stop plan says that if all three conditions are met, J1 may stop `llama-server` PID 4976 and comment `LLAMA_CTX_SIZE` in `kanet.env`, with the stated rationale that headless will then log `LLAMA_CTX_SIZE unset` and not relaunch llama before READY.

The headless claim is correct for `kanet-start-headless.sh`: after loading `kanet.env`, its llama block refuses startup when `${LLAMA_CTX_SIZE:-}` is empty.

However, this is not sufficient to establish **no autonomous respawn** for the whole system.

Repository code contains a second independent respawn path: `scripts/llm-watchdog.mjs`. It probes `127.0.0.1:8000/health` every 60 seconds and calls `spawnLlama()` when llama is down. `spawnLlama()` reads `process.env.LLAMA_CTX_SIZE`, not `kanet.env`, and will respawn when that value exists and the memory gate passes.

Critically, for an already-running Node watchdog, editing/commenting `LLAMA_CTX_SIZE` in `kanet.env` does **not** mutate the watchdog process's existing environment. Therefore a watchdog launched earlier with `LLAMA_CTX_SIZE` present can retain that value and respawn llama after PID 4976 is stopped, even though subsequent headless invocations would refuse to start it.

This creates a concrete race against the proposed statement `READY 前不拉回`.

## Ruling

- `comment LLAMA_CTX_SIZE => headless does not relaunch`: **SUPPORTED for the headless path only**.
- `comment LLAMA_CTX_SIZE => llama cannot be autonomously relaunched system-wide`: **NOT SUPPORTED**.
- current J1 conditional stop procedure: **HOLD until all live respawn authorities are enumerated and neutralized/verified**.

Before any stop is executed, require a live-process / scheduled-task / service check for at least:

1. `scripts/llm-watchdog.mjs` process presence and its effective environment/launch authority;
2. Windows scheduled tasks or service wrappers capable of launching that watchdog or llama directly;
3. `kanet-start-headless.sh` / supervisor path;
4. any mainnet/shared `C:\KANet` launcher, since port 8000 is documented as a shared single-instance service.

If `llm-watchdog.mjs` is running, changing `kanet.env` alone is insufficient. The safe operational design needs one canonical maintenance/disable gate consumed by **every** respawn path, or the watchdog itself must be deliberately stopped/disabled under the same explicit authorization before llama is killed. Do not infer permission to stop watchdog from permission to stop llama unless the Owner authorization explicitly covers that action.

## Other new evidence

The six active-branch commits also report D-b continuing around the high-20 blk/s range and rising host memory pressure. Those are operational status changes, but this interval contains no new D-b runtime implementation diff. The reported `net catch-up` computed by subtracting nominal network growth remains an estimate unless same-window network-tip delta is directly measured.

No production payout, settlement/refund, signing/broadcast, money-state DB mutation, key movement, or other production funds-path change is authorized by this review.
