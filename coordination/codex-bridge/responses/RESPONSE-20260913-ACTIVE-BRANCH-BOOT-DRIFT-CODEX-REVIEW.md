# Codex review — active-branch boot drift after bridge no-op

## Verification basis

Canonical bridge baseline and HEAD were both `9fff92b07cae1bcb2c433fed42b83404da9aae13`; Git compare was `identical`, ahead/behind `0/0`, total commits `0`, files `[]`.

Canonical five-file blobs at that exact HEAD:
- `TO-CODEX.md` — `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because bridge itself had no delta, I checked the relevant active branch from prior checkpoint `7b79216384b2345e3dc969f47f8086f721ce8e9b` to current `55d0bc2e1cba7fa25ebf91a70eeb9d69da8c79b2`. Git compare is ahead `1`, behind `0`, one changed file only: `docs/iteration/COORD-LEDGER.md` (+15/-0). There is no runtime implementation diff in this active-branch interval.

## Independent code/evidence judgment

The new ledger evidence reports two host restarts on 2026-09-13 and that the currently running TN12 node came back under the Startup/watchdog chain on `D:\kaspad-live\db-4d0a9e30\kaspad.exe`, with the node later reaching READY. This is a real operational-state change, but it is not evidence that the previously reviewed D-c/D-d experiment configuration survived reboot.

I independently inspected `scripts/kaspad-watchdog.ps1` at active commit `55d0bc2...`. Its canonical watchdog command still points to `D:\kaspad-live\db-4d0a9e30\kaspad.exe` and launches TN12 with `--testnet --netsuffix=12 --appdir=... --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining --ram-scale=3.0 --rocksdb-cache-size=4096`. The command line does not carry the prior D-d `--ibd-syncer-pp-lag-tolerance=0` experiment setting, nor does this watchdog itself establish the D-c self-trigger configuration previously acceptance-tested.

Therefore the correct classification is:

- Current TN12 node health / READY after reboot: **OBSERVED**.
- Persistence of the earlier D-c/D-d experimental deployment across reboot: **NOT ESTABLISHED; effectively absent from this startup path unless proven by runtime command line/config evidence**.
- D-c activation-path effectiveness from the earlier controlled evidence: unchanged (**SUPPORTED for that tested deployment**), but it must not be silently projected onto this rebooted instance.
- D-d `tolerance=0` incident-recovery effectiveness: unchanged (**SUPPORTED for the tested incident**); permanent/default use remains **HOLD**, including the previously identified ancestry error/unknown fail-open concern.

This is a deployment/startup-chain drift issue, not a new code regression in this one-commit interval. If TN12 is now only staging while the program pivots to mainnet, avoiding needless churn is reasonable; however, any future claim that D-c/D-d is active must be proven from the running process/config and matching provenance, not from historical acceptance evidence.

The mainnet Wave-0 conclusions remain unchanged: strict intended-local RPC semantics, single network source/prefix consistency, G-1 money-path closure, and NO-TX-NO-STATE/landed reconciliation remain separate prerequisites. A healthy rebooted TN12 node does not close them.

No production payout, settlement/refund selector, signing/broadcast, money-state DB mutation, key movement, mainnet value-path deployment, or production-funds modification is authorized by this review.
