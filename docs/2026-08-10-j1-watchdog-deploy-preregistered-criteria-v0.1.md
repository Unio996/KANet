# Pre-registered acceptance criteria — TN12 mining-watchdog deployment

> **Status**: CURRENT
> Author: J1tn · 2026-08-10 · **Written BEFORE deployment, on purpose.**
> Covers: `68d552fc` (level backstop 500→220 + misconfiguration guard) and
> `4cf59f14` + `5d44706b` (progress-gated pulse, pay-for-itself rule).
> Review state: both PASS by @KANet-UI, independently re-run with self-generated mutants.
> 🔴 **Deployment is NOT authorized.** Codex withholds it; @Bettor's endorsement covers the
> logic direction only. This file exists so that the bar is fixed before anyone can see results.

## Why pre-register at all

Because of what the machine is doing right now. Since 18:47:04Z on 08-09 the braking machine has
run **tips ≡ 1 for over 13 hours** with ~13,000 blocks/hour arriving and lag 0. The brake has not
engaged once in that time.

⇒ **After this deployment, "no alerts fired" will be the most likely outcome, and it will prove
nothing.** It is equally consistent with "the new gate works" and with "the new gate is broken in
a way only load would reveal". Anyone reading a quiet log as a pass is reading the absence of
load, not the presence of correctness. That sentence is the reason this file is written first.

## A. Deployment-moment criteria (checkable within 5 minutes, all must hold)

| # | Criterion | How, exactly |
|---|---|---|
| A1 | The deployed bytes equal the reviewed bytes | `node scripts/check-deployed-drift.mjs` with `DRIFT_SSH` — content hash, **not** mtime, and not a hand-typed `Get-FileHash` (mine had its backslashes eaten by Git Bash today and silently returned a plausible wrong number) |
| A2 | Startup banner reads the new constants | `_watchdog.log` shows `brake>220 resume<50 ... cliff=248` |
| A3 | The misconfiguration guard stays silent | no `MISCONFIGURED BACKSTOP` line (it fires at ≥248; 220 must not trip it) |
| A4 | Exactly one watchdog instance | process list shows one `tn12-mining-watchdog-v2.ps1`; the old one is confirmed gone, not assumed gone |
| A5 | The miner is running afterwards | deployment restarts the watchdog while braked-state is lost; the miner must end up started, not stopped |

🔴 **A4 is not boilerplate.** That host currently carries five stale `kaspad-watchdog.ps1`
instances from 08-03. A deployment that leaves two mining watchdogs would give two processes
racing to start and stop the same miner, and the second one is invisible in the log because both
write the same file.

## B. What counts as SUCCESS — and what explicitly does not

✅ Success requires **at least one brake episode observed under real load**, showing:

- `BRAKE ENGAGED` on `diagnosis=overproduction` (the derivative), not on the level threshold;
- pulses logged with `daa <pre> -> <post>` where post > pre;
- `BRAKE RELEASED` with tips < 50 and streak 0.

🔴 **Not success:** a quiet log. If no brake episode occurs, the correct report is
**"not yet exercised"**, and this file forbids upgrading that to a pass. If the DAG stays at
tips ≡ 1 indefinitely, the honest options are to keep waiting or to open a controlled window
deliberately (Bettor's call, not mine) — not to relabel silence.

## C. Falsifiers — any one of these means stop and roll back

| # | Reading | Why it falsifies |
|---|---|---|
| F1 | `BRAKE ENGAGED: tips=NNN > 220` while `diagnosis` was never `overproduction` | the level backstop is firing on its own; measured max in normal operation is 155, so this means 220 sits inside the healthy band after all |
| F2 | `PULSE DID NOT PAY FOR ITSELF` while tips are visibly falling across the same window | the DAA reading is wrong, not the DAG — the gate would be halting a working drain |
| F3 | Miner stopped > 10 minutes with no `PULSE`/`BRAKE`/`HALTED` line explaining it | something stopped the miner outside the state machine |
| F4 | `PULSE OUTCOME UNKNOWN` on the first pulse of every episode | the extra post-pulse probe call is failing systematically; the gate degrades to one-pulse-then-stop |
| F5 | Two `BRAKE ENGAGED` lines with no intervening `RELEASED` | two instances (see A4) |

## D. Pre-registered as EXPECTED, so nobody reports it as a regression

1. **One wasted pulse at the advancing→wedged transition.** Mechanically bounded at one and
   documented in the code. If the chain wedges, the log will show exactly one pulse and then
   `PULSE DID NOT PAY FOR ITSELF`. **That is the design working, not a fault.**
2. **Block production stops while a wedge is suppressed.** @Bettor endorsed this trade-off on
   the record: block stoppage is a recoverable state with an SOP; deepening the mergeset backlog
   is what wedged the chain for 17h. Expect a loud alert and a stopped miner, and expect it to
   need a human.
3. **The probe is called once more per pulse** (the post-pulse DAA read), so `risingStreak`
   climbs faster during braking. Known, and harmless because the diagnosis no longer drives an
   action once braked.

## E. What this deployment does NOT cover

- The five stale `kaspad-watchdog.ps1` instances, and the fact that they are still executing
  pre-`a9f5abee` logic because PowerShell `-File` reads the script once at launch. Separate
  owner, separate card.
- `RISE_FLOOR` (150), which is what actually determines how early the brake speaks. Unchanged
  here and blocked on @J2's provenance for the 9→191 refill figure.
- Any claim about whether 220 is the right backstop under load. It has never fired; its
  justification is structural (it must sit below the 248 cliff) plus a measured zero
  false-positive cost across 18.7h in which it also never fired.
