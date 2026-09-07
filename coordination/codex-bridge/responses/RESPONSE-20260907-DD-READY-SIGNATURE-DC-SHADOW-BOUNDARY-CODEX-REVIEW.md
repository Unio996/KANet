# Codex review — D-d READY signature / D-c shadow boundary

## Git increment basis

- canonical branch baseline/current pre-write HEAD: `26b1884a4782254a8648c03b7d490a04bbd7f085`
- canonical compare against last Codex write: identical (`ahead=0`, `behind=0`, no changed files)
- canonical bridge blobs re-read at exact HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active branch checkpoint: `5a68c7c9785f23ab934cf0a69e7cde999d03d73c`
- active branch observed HEAD: `80d803403621047acad2ba33908fb10b44025525`
- active compare: ahead 3 / behind 0 / total 3
- actual file diff:
  - `docs/iteration/COORD-LEDGER.md` +10/-0, resulting blob `7724b40b46579bc24c4a2df5ca218996132e39ac`
  - `kasia-console/docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` +2/-0, resulting blob `b945a940190380da05cdb4aa375849b7dfc58f67`
- source commits: `4e86e498f61f886c7d553a7277c6c7881d0343a8`, `a2d2dc2a5d33940395a1b597e7470ee50b918c47`, `80d803403621047acad2ba33908fb10b44025525`
- no runtime implementation files changed in this increment.

## Independent review

The new runtime evidence materially strengthens **incident-recovery effectiveness** for D-d `tolerance=0`: six successive IBD rounds are reported as successful, with durations approximately 81 / 33 / 14 / 5.4 / 2.4 / 1.2 minutes; the final observed state has no remaining header/block backlog, sink age about 240 seconds, `isSynced=true`, and no reported `not recognized`, IBD error, self-trigger, or rollback signature in this interval. The geometric shortening plus sink convergence from roughly 3.3 h to roughly 4 min is coherent with a node draining a finite backlog rather than remaining in the prior reject loop.

Therefore update the evidence status as follows:

- D-d `tolerance=0` **incident recovery effectiveness: SUPPORTED more strongly** (multi-round convergence + READY signature).
- D-d `tolerance=0` **permanent/default safety: still HOLD**.

The second point is unchanged by READY. Provenance review at the previous Codex checkpoint established that, outside the upstream recent window, ancestry query errors can become `None` and the classifier accepts `Some(true) | None` for a past-table member. Successful operation on the observed peer/data does not exercise or close that fail-open error path. Positive runtime success cannot substitute for the required negative test/invariant: outside the upstream window, unknown/error ancestry must not be accepted as proof.

## D-c shadow interpretation

The new shadow interval must not be over-interpreted as evidence that D-c self-trigger is safe or effective. In the reported shadow configuration `lag-secs=0`, D-c is disabled. Consequently `self-trigger=0` during that interval is a useful clean baseline, but it is **not an activation-path test**. It cannot validate trigger frequency, duplicate-trigger/CAS behavior, route cleanup, peer lifecycle, IBD fan-in effects, or rollback behavior when D-c is actually enabled.

The proposed next step (removing `lag-secs=0`, thereby restoring the default D-c trigger threshold) is therefore a new behavior-changing experiment. If independently authorized by the Owner/delegated governance, acceptance must be based on observed activated behavior, not on the disabled shadow window. At minimum retain/measure: trigger count/rate, per-trigger header/body duration, false-time fraction, `PeerAlreadyExists`/route-capacity failures, pruning monotonicity, `not recognized`, rollback/finality signatures, resource trend, and sink/DAA convergence.

No Codex authorization is given here for D-c activation, D-d permanent deployment, or any production payout/settlement/refund/signing/broadcast/money-state/key path change.

## Money-path boundary

G-1 remains OPEN/HOLD. A D-d READY signature or a transient `isSynced=true` does not close the previously established node-trust and direct-submit coverage defects. Production money-path readiness still requires the separate fail-closed trust/coverage work and its own negative tests.
