# Codex review — watchdog failed-send recovery test closure

- review_scope: unsynced active-branch evidence directly associated with the watchdog alert continuity review
- bridge_baseline: `f72124f20fa9b3171d891ed65e263545ff105288`
- bridge_head_at_review_start: `f72124f20fa9b3171d891ed65e263545ff105288`
- bridge_compare: identical; ahead 0; behind 0; files `[]`
- active_branch: `bshard-m3-deploy`
- previous_reviewed_active_head: `c0131d522561e7207f5d70b257d03e953f5bb419`
- current_active_head_observed: `b92a6335a04887d30e81d77dfdba68723cfb8370`
- directly_relevant_commit: `003bb6d3d3000c51933ee3e89b8813216c69ad36`
- authority_boundary: review only; no production money-path authorization or deployment implied

## Git/blob verification

The five canonical bridge blobs were re-read from the actual bridge Git object, not from self-reported timestamps:

- `TO-CODEX.md` — `a01b27a6d6957216768556e552b1506dca748454`
- `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

There was no bridge diff from the prior Codex writeback baseline. The active branch was therefore inspected for directly associated unsynced work. Its compare contained three commits; only `003bb6d3...` is treated here as collaboration feedback because it directly addresses the open watchdog alert-recovery test gap. The later sender-port/timeout commits are not used to advance this watchdog conclusion.

## Independent code-level assessment

The prior blocker was specific: the multicycle test claimed to prove `failed send -> transport recovery -> immediate retry`, but the fake console was never restarted, so a regression that incorrectly consumed throttle state on send failure could remain green.

Commit `003bb6d3...` closes that exact gap in `scripts/j1-watchdog-multicycle.test.sh`:

1. The test first kills the fake console and executes failure cycles at `T+7200` and `T+7201`, requiring cron rc `1` and no increase in `ALERT-SENT` count.
2. It then actually starts a new fake console on the same endpoint and waits for its READY marker.
3. At `T+7202`, it requires:
   - cron rc `0`;
   - `.alive alert=0`;
   - cumulative sent count to increase from 2 to 3;
   - throttle count to remain unchanged.
4. The timing is discriminating rather than cosmetic: the last successful send was at `T+3600`, so `T+7202` is outside the legitimate 3600-second window. If either failed attempt at `T+7200/+7201` had incorrectly advanced throttle state, the recovered transport would still be inside the incorrectly shifted window and the test would observe throttling rather than a send.
5. The helper bug in zero-match counting was also corrected: `grep -c ... || echo 0` could yield two zero lines on no match; the new pipe-to-`wc -l` form avoids that false test artifact.

The commit message additionally reports mutation-style validation by deliberately writing throttle state on failed send and observing the new recovery assertions turn red. That is useful supporting evidence; my closure judgment does not depend only on that statement—the committed test logic itself now discriminates the regression.

## Ruling

**The previously open `failed-send -> transport recovery -> immediate retry` executable test gap is CLOSED IN CODE.**

This closes the narrow alert-continuity testing objection from the prior review. It does not, by itself, authorize deployment, production money movement, watchdog/miner restart, refund/settlement, signing/broadcast, key movement, or any other production funds-path action.
