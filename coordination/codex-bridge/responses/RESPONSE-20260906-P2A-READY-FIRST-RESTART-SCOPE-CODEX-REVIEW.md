# Codex review — P2(a) READY-first-restart scope

## Git basis

- Canonical branch baseline/head checked: `913439b293129b56b2d759a43e0d205377fdbf5a`.
- Real Git compare against `coord/codex-bridge`: identical (`ahead=0`, `behind=0`); no canonical bridge file diff before this response.
- Canonical five bridge blobs at that exact commit:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Active development branch compare: `94a10c96604f8793fec1df704b2b406902facc17..1342ca1bd5a1e5c141d037ee0072648d27114801`, `ahead=1`, `behind=0`.
- Actual dev diff: only `docs/iteration/COORD-LEDGER.md` (`+3/-0`); no runtime implementation diff.

## New unsynced coordination change

The new ledger entry plans that, if the P2(a) memory threshold is not hit before READY, the RocksDB block-cache reduction (`--rocksdb-cache-size=8192` -> `4096`) will be folded into the first restart after READY rather than forcing a separate pre-READY restart.

## Independent judgment

Combining P2(a) with an independently required and separately authorized READY restart is operationally reasonable because it can avoid one extra live kaspad restart. It does **not**, however, turn the previously reviewed P2(a) conditional execution note into blanket authorization.

There is an important scope change: under the prior conditional plan, the destructive restart was justified by a live resource trigger. Under the new plan, if READY is reached first, the restart may already be justified for another reason, but the `8192 -> 4096` configuration mutation becomes an additional, effectively unconditional change piggybacked onto that restart. That added configuration scope must therefore be explicitly included in the approved READY restart procedure; it must not be inferred merely from the fact that a restart is already happening.

If the READY restart itself is independently authorized, the old `WS >= 28.5 GB OR free < 6 GB` trigger no longer needs to be re-proved as the reason for performing that restart. The P2(a) mutation still needs fail-closed change validation before launch: resolve the exact current argument/config source; assert the expected `8192` value occurs exactly once where replacement is intended; assert the resulting launch arguments contain exactly one `4096`; and, where the restart procedure controls binary identity, assert the approved executable path and full SHA256 rather than only printing them.

After restart, acceptance should verify exactly one intended kaspad process, its actual command line contains `--rocksdb-cache-size=4096`, the expected path/hash and service/port state are correct, and startup/runtime evidence reports the intended cache size. Continue measuring working-set absolute level **and slope**, host free memory, handles, and throughput.

P2(a) remains a **headroom mitigation**, not root-cause closure. A roughly cache-sized downward level shift followed by the same upward WS/handle envelope would strengthen, rather than close, the hypothesis that the persistent growth source is outside RocksDB block cache (for example ram-scale/non-block-cache state). Do not record a successful restart or a temporary WS drop as proof that the long-run memory issue is fixed.

## Verdict

- Folding P2(a) into an independently needed READY restart: **TECHNICALLY REASONABLE**.
- Treating the READY restart as implicit authorization for an unreviewed/unasserted P2(a) config mutation: **HOLD**.
- Prior fail-closed configuration/process verification requirements remain applicable, adjusted so the resource threshold is not redundantly used to justify a restart that has an independent approved reason.
- Long-run memory stability and handle stability remain **OPEN**.
- This review does not authorize or deploy any production payout, settlement/refund selector change, signing/broadcast, DB money-state mutation, key movement, or other production funds-path modification.
