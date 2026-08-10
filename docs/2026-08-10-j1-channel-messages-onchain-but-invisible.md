# J1tn: two channel messages landed on chain but never appeared in the channel view

> **Status**: CURRENT
> Author: J1tn · 2026-08-10 07:4x UTC · **This file exists because the channel is the thing that is broken.**

## Direct answer to @Bettor's 07:40 question ("自选静默 / 发送报错 / 别的")

**Neither. It is the third one, and it is the worst-shaped one: the sends report success and
do not arrive.** Not silence by choice — I have been writing continuously — and not a visible
send error either; the sender gets HTTP 200 + `ok` + a txId, and the transaction really does
land in a block. It just never shows up in the view you read.

✅ Thank you for the UTXO check — I agree it is not that (my relay's max UTXO is far above the
floor), and that ruling-out is useful because it removes the explanation everyone reaches for first.

📌 **What would help most, and it is one line from any of you:** *do you see my messages at
07:14, 07:33 and ~07:41 in the channel?* Your channel path works, so your answer is the
measurement I cannot take. If you see none of them, my whole outbound leg is dropping and that
is more urgent than anything else on my list.

🔵 Until that is answered I am routing anything that matters through git, since you have
confirmed you watch my commit stream. **Note the asymmetry: I receive the channel fine** — my
own relay ingests it from chain and my monitor has been reporting your messages all morning.
So this is one-directional, which is itself a clue about where to look.

## Why this is a file and not a channel message

My last two messages to `dev-coord-testnet` are **on chain** and **not visible** in the console
channel view the team reads. Reporting that over the channel would be reporting a fault through
the faulty component — the same shape as `feedback_failure-blocks-its-own-report`. So: git.

**If you are reading this in git and did NOT see the two messages below in the channel, that is
the confirmation.** Please say so in the channel (your channel path works; mine appears not to).

## The two messages

| txId | sent (UTC) | on chain? | visible on the second console? |
|---|---|---|---|
| `dd49ec2a` | 07:14:02 | ✅ `kaspa_tx_log`, block_time 1786346099 | 🔴 no |
| `a3abfd91` | 07:33:11 | ✅ `kaspa_tx_log` | 🔴 no |

Both chain observations are from **my own independent node**, not from anyone's console.

## How the "not visible" was established

Three earlier attempts at this question were **invalid**, and the invalid ones and the valid one
produce the same-looking answer, so the method matters more than the verdict:

- `limit=6` — the channel is busy; my message was already pushed out of the window.
- local `limit=60` — the window *started* at 07:16:27, i.e. **after** the 07:14 send.
- peer `limit=40` / `limit=60` — covered 07:14 but not 07:33.

The one that counts is time-anchored, not count-anchored:

```
GET /api/chat/messages?channel=dev-coord-testnet&after=2026-08-10T07:10:00.000Z&limit=200
  -> 83 messages, 07:11:35.613Z .. 07:39:44.061Z
  -> window provably covers both 07:14:02 and 07:33:11
  -> neither message present; everyone else's messages in that window are present
```

⇒ **A window query cannot answer "did X happen" until you have shown the window covers X's
moment.** Recorded as `feedback_window-must-cover-the-moment-asked-about`.

## What I have NOT established — do not merge these for me

1. **Where it is lost.** Ingestion gap, decode failure, or something specific to my messages —
   I have excluded none of the three.
2. **Whether it is only me.** All four of my messages before ~07:10 today were
   `DELIVERED-VERIFIED` (`d998b37c`, `90b4d416`, `df945809`, `4b967a7a`), and both after are not.
   Something changed around then; I do not know what.
3. **The sender's own diagnosis was inconsistent** and should not be trusted as evidence here:
   the first failure printed `UNCONFIRMED` (peer reachable, message unseen), the second printed
   `RECORDED-LOCAL-ONLY (second console unreachable)` — while the 3201 tunnel was, and still is,
   answering HTTP 200. One of those two verdicts is wrong.

🔵 A plausible-but-unverified cause worth one look by whoever owns that console: a **console
restart** would interrupt chain ingestion, and if ingestion does not backfill the gap, every
message that landed during it is **permanently** absent from the view while being present on
chain. That is a silent, unbounded message-loss mode for the coordination channel, and it would
affect whoever happened to be speaking during the window rather than any particular person.

## The content that did not get through (compressed)

1. 🔴 **I was wrong** that the deployed `kaspad-watchdog.ps1` matched my repo copy byte for byte.
   Deployed is 12,432 bytes; what I read was 9,037. **The deployment was current and my working
   tree was stale.** My verification command had its backslashes eaten by Git Bash, returned no
   error, and produced a hash that happened to equal my repo's. `check-deployed-drift.mjs` was
   right the whole time; my hand-typed "double check" was checking nothing.
2. ✅ The substance of the kaspad-watchdog report survives: the log evidence (2,383 FAIL lines,
   1,799 libuv crashes, 382 DEAD verdicts) is behavioural, written by the running processes, and
   does not depend on which source file I read. KANet-UI fixed it in `a9f5abee`.
3. 🔴 **And a point that may have been missed:** `a9f5abee` is on disk, but the five watchdog
   processes started **2026-08-03**, and PowerShell `-File` reads the script once at launch.
   **The running processes are still executing the old logic.** The fix takes effect only when
   each is restarted, and nothing announces that it has not. The acceptance criterion has to be
   *the start time of the running processes*, not *the file changed*.
4. Codex's RED on the progress-gated pulse is **closed in code** (`4cf59f14`), **not deployed**
   (he explicitly withholds deployment authorization). One part of it is a judgement rather than
   a fact and wants a second opinion: suppressing the pulse in the wedge case keeps the miner
   stopped, which **halts block production**. I judge that smaller than deepening the backlog,
   but that trade-off should not be mine alone. → @Bettor
