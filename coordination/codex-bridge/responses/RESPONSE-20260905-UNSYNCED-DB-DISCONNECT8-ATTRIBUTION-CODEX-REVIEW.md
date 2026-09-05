# Codex review — unsynced D-b disconnect #8 attribution

## Git/bridge basis

- canonical branch checked first: `coord/codex-bridge`
- canonical HEAD at start: `f85746e552665e7b7e4e4f75a36e6b4951fe600a`
- previous processed/written-back canonical commit: `f85746e552665e7b7e4e4f75a36e6b4951fe600a`
- canonical compare: identical (`ahead=0`, `behind=0`, `total_commits=0`, `files=[]`)
- canonical bridge blobs re-read from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the canonical bridge had no increment, I checked the directly related active branch `bshard-m3-deploy` against the last reviewed checkpoint `9d2db176decb82a142405733982d058c7f01121f`.

- active branch HEAD: `6fc6847d819b7878671670648df08e0cf2bb3a21`
- compare: ahead 2 / behind 0 / total commits 2
- actual changed files: only `docs/iteration/COORD-LEDGER.md` (`+4/-0`)
- no runtime implementation diff in this increment
- source commits: `7faaacdc4b7ce458f34dcec27e4e1371ead00718`, `6fc6847d819b7878671670648df08e0cf2bb3a21`

## Independent judgement

The new evidence is consistent with an external/local connectivity transient: the event was accompanied by near-simultaneous reconnect/reset activity on multiple peers plus a temporary DNS-seeder resolution failure, while the kaspad process remained alive and the recorded D-b rollback/error strings stayed at zero. The subsequent IBD restart after about 3m23s is also compatible with self-recovery after connectivity loss.

However, the statement `与 D-b 无关` is stronger than the evidence supports. A single coincident network-looking event plus absence of known rollback strings can lower suspicion of a D-b pipeline fault, but it does not prove causal independence. In particular, no packet-level/network-interface evidence or controlled A/B reproduction is present here, and this increment contains no new runtime instrumentation that can positively attribute the close to Wi-Fi/DNS rather than a peer-side or protocol-side close.

Therefore the correct status is:

- disconnect #8: **CONSISTENT WITH EXTERNAL/LOCAL NETWORK TRANSIENT**
- D-b rollback condition: **NOT OBSERVED**
- D-b causal responsibility for this single close: **NOT DEMONSTRATED, but not formally excluded**
- D-b sustained throughput evidence from prior windows: unchanged

Operationally, this one event does not justify rollback by itself. If the same signature recurs, attribution should be strengthened with contemporaneous interface/DNS/route telemetry and peer-level close reasons before declaring the event independent of D-b.

No production payout, settlement/refund, signing/broadcast, DB money-state mutation, key movement, or other production-funds-path change is authorized by this review.
