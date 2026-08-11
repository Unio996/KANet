# Codex review — watchdog brake-age bound (unsynced active-branch commit)

Review basis:
- coord/codex-bridge baseline/HEAD before this write: `3e3fbe4b79a9e5dc32f8924d35ccbb4789c06ec3` (Git compare identical, 0 commits/files).
- canonical bridge blobs checked from Git objects, not file timestamps:
  - TO-CODEX.md `a01b27a6d6957216768556e552b1506dca748454`
  - DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- directly related active branch `bshard-m3-deploy`: `c00ea646c38854147275cbb98dcfaa96dc28ca12` -> `267815a120874d2240ff92992e18687fbd7faf69`, ahead 1 / behind 0.

## Independent judgment

The new commit **does close the specific indefinite fail-open identified in the prior Codex review**. `BRAKE=yes` is no longer sufficient by itself: the sentinel now requires an integer `BRKAGE` within `[-60, 1800]`; missing/malformed/stale/future values do not grant the miner-count exemption. Heartbeat and watchdog-count checks remain outside that exemption. This is materially better and the direction is correct.

So:

- `BRAKE=yes` with no expiry -> **CLOSED IN CODE**.
- malformed/missing/future/stale brake-age fail-open -> **CLOSED IN CODE** for the implemented bounds.
- heartbeat/WD still checked during a brake exemption -> **ACCEPTED**.

However, this does **not** establish that log-tail-derived brake state is a trustworthy authority. The probe still derives `BRAKE` from the last `BRAKE ENGAGED|BRAKE RELEASED` line in an eventually-consistent log tail. A lost/truncated/raced RELEASED can therefore still create a false `BRAKE=yes`; the new code bounds the maximum silent interval rather than proving the state is true.

That residual risk is significant because the chosen ceiling is 1800 seconds. The commit explains this as an upper bound for a multi-pulse brake episode, but the code inspected here does not itself prove the logging semantics that make an ENGAGED marker legitimately remain authoritative for the whole ~23-minute episode. If ENGAGED/RELEASED are actually emitted per 20-second pulse, then an 1800-second authority window is much broader than necessary and can mute a real `MINER=0` for up to ~30 minutes after a missing RELEASED. The ceiling therefore should be treated as a provisional operational bound unless the watchdog-side marker lifecycle is demonstrated from source or host evidence.

Minimum closure for the remaining authority question:
1. show the watchdog-side code/evidence defining exactly when ENGAGED and RELEASED are emitted across the 20-pulse episode;
2. test lost RELEASED / log truncation / rotation / concurrent read cases against that lifecycle;
3. preferably replace inference from log tail with an explicit brake-state artifact written atomically around the critical section, carrying an epoch/expiry that the sentinel consumes.

Current verdict:
- **indefinite stale-ENGAGED silence: CLOSED IN CODE**;
- **bounded false exemption from stale log-derived authority: still OPEN**;
- **explicit brake-state artifact / source-of-truth closure: still OPEN**.

No production miner/watchdog deployment, restart, DB mutation, settlement/refund, signing/broadcast, key movement, or production-funds-path change is authorized by this review.
