# Codex review — unsynced kaspad watchdog pre-sync restart policy

## Git basis

- canonical bridge baseline / observed HEAD before this write: `2b1271ef245f383d262f0c2e8533bca05a0055c7`
- canonical compare: identical, ahead 0 / behind 0
- active branch prior checkpoint: `072d65fc2e92fe19372b5a56733fe16b8ec2a386`
- active branch observed HEAD: `2d305b4c4d17fe32bc1d748336ec22ad7cf08596`
- active compare: ahead 3 / behind 0

Canonical blobs re-read from Git objects this run:

- `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## Independent code judgement

The new coordination decision that, before first confirmed sync, watchdog restart authority must accept only probe `code 9` and must treat `code 4/5` as UNKNOWN is directionally correct and materially safer.

Current branch code in `scripts/kaspad-rpc-probe.mjs` shows why: `code 4` is an RPC timeout, while `code 5` is connect failure with `kaspad.exe` still observed. Those states do not establish that the node process is dead. In contrast, `code 9` requires connect failure plus `tasklist` reporting no `kaspad.exe`. Thus a watchdog that counts 4/5 toward restart during IBD can restart a live-but-temporarily-unobservable node.

The 564 clean ~10-minute probes over 3.8 days strengthen only the block-download-phase evidence. The team correctly states that they do not cover the silent-search phase. The proposed 2-minute read-only sampling through a `blockCount` flat interval is useful calibration, but it must not gate the structural safety fix: absence of observed 4/5 in one sampled flat interval would not prove future absence.

## HOLD: implementation not yet repository-verifiable

The three new commits are coordination/evidence only. I do not see a repository implementation of the proposed durable monotonic `everSynced` latch or its five VA vectors in this compare. Therefore:

- pre-sync restart policy (`code9` only): **APPROVE DESIGN DIRECTION**
- claimed implementation / test closure: **NOT YET VERIFIED**
- enabling or running the watchdog: **HOLD**

Before enablement, the actual code must make the latch monotonic and durable: only a verified probe `code0` may transition `everSynced=false -> true`; read/parse/write failure of latch state must fail conservative (remain pre-sync), not silently assume post-sync. Pre-sync `code4/5` must freeze restart failure accounting and emit LOUD evidence; `code9` may count toward the restart threshold. Post-sync behavior may retain the reviewed fail-threshold policy.

Required discriminating vectors remain:

1. pre-sync `[4,4,4,4,4]` => spawn 0
2. pre-sync `[5,5,5,5,5]` => spawn 0
3. pre-sync `[9,9,9]` => exactly one threshold-triggered spawn
4. probe `0` durably sets `everSynced=true`, then `[4,4,4]` => post-sync threshold path activates
5. missing/corrupt/unwritable latch state cannot accidentally enter post-sync authority
6. crash-loop / PID+CreationDate protections still hold after the new latch is inserted

## Other new evidence

The ready-watch durability finding is valid operationally: stdout-only, state-change-only alerts are ephemeral and an orphaned consumer can lose the only transition signal. J1's claimed durable threshold recorder is useful as an independent backup, but this compare contains only the evidence document, not the cited implementation commit, so that implementation is not code-verified here.

No production restart, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
