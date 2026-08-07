# Codex review — ST-00 4-of-5 correction accepted

## Git baseline

- last processed / written-back bridge commit: `d0133d19c8f184730107ac9268f3398d747f5e36`
- bridge HEAD at inspection start: `d0133d19c8f184730107ac9268f3398d747f5e36`
- compare: `identical` (`ahead_by=0`, `behind_by=0`, `files=[]`)
- canonical blobs verified directly from GitHub contents:
  - `TO-CODEX.md`: `350cbc1873dde63cb776ef05cb0510852fac50d3`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge-file increment existed, so the active development branch was checked.

## Active branch increment

- previously reviewed active HEAD: `4df2541fb884ea55569e5d273777a4a196cc55da`
- current `bshard-m3-deploy` HEAD: `e7be54805533aa82ea94349deb1bcd30231d923e`
- compare: `ahead 3 / behind 0`
- changed files are limited to:
  - `docs/2026-08-07-st00-claim-inventory-v0.1.md`
  - `docs/2026-08-07-st00-exposure-evidence.md`
  - `docs/iteration/COORD-LEDGER.md`

Relevant commits:
- `c2a87e0c3be9da655cba0886ee474fb1e1268599`
- `d7f6e2021fd063a14e6565cc8795909ffe880d5a`
- `e7be54805533aa82ea94349deb1bcd30231d923e`

## Independent code judgment

**ACCEPTED.** The ST-00 threshold correction now matches the code-level evidence.

`PayoutShard.sil` `cancel_attest` takes five signature parameters but enforces `validSigs >= 4`; therefore the correct liveness statement is 4-of-5, not 5-of-5. The same distinction is now carried into the exposure evidence and claim inventory. The severity correction is material: one failed committee member is tolerated; loss/non-cooperation of at least two members makes the threshold unreachable. The previously established absence of a permissionless/timelocked V1 escape remains the relevant liveness defect.

The associated spine wording was also independently checked against the v0.7.1 contract family: `settle_aggregate` likewise counts five signatures and requires `validSigs >= 4`. So changing the spine row from an ambiguous `5 committee` description to explicit `4-of-5` is code-supported.

No new production code, covenant, signer, broadcaster, RPC, database migration, settlement/refund logic, or deployment change is present in this increment. These commits are documentation/coordination corrections implementing the prior Codex finding rather than new money-path behavior.

## Boundary

- ST-00 V1 liveness failure: **CONFIRMED, with 4-of-5 threshold semantics**
- prior `5-of-5` / “one missing member locks funds” wording: **CORRECTED**
- current correction set: **ACCEPTED**
- P1: **OPEN**
- D4: **BLOCKED**
- no production money-path authorization is granted by this review
