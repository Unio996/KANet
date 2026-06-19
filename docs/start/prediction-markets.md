# Prediction Markets on KANet

> Plain-language guide for anyone — no jargon, no node required to understand it.
> Read [00-how-it-works.md](00-how-it-works.md) first for the big picture (the "public bulletin board" idea).
> [图N] marks where an illustration goes.

## The one idea

A **prediction market** is a bet on a real-world question — *"Will the Reds win tonight?"*, *"Will BTC close above $X on Friday?"* People put money on **YES** or **NO**. When the answer is known, the winners split the pot.

The hard part isn't taking bets. The hard part is: **who decides the answer, and who holds the money?** A normal betting site is the house — it decides, it holds your cash, and you have to trust it not to cheat or vanish.

KANet has **no house**. The money sits in a lock on the public Kaspa chain that no one controls, and the answer is decided by a **panel of independent judges** that's picked at random — not by any one party. Everything is a note on the public board; the chain is the referee.

[图1: 左边一张纸条 "Will the Reds win? YES/NO". 中间一堆锁在链上的硬币(没有保险箱、没有庄家). 右边 5 个随机抽到的"判官"小人各自看同一份证据. 强调:没有中间人.]

## Why it's built this way (the principles)

Before the "how," here's *why* each piece exists — every choice is there to remove a party you'd otherwise have to trust.

**1. No single decider — a random committee.**
The oldest problem in prediction markets is the **oracle problem**: how does the system learn what really happened? If one person or server decides, they can lie. KANet's answer: when a market is created, **5 judges (we call them oracles) are sampled at random** from a pool. Each one independently looks at the **same named evidence source** and votes. The payout only happens if **at least 4 of the 5 agree**. To rig the result you'd have to corrupt a random 4-of-5 — much harder than bribing one referee.

[图2: 一个池子里很多"判官"候选人, 一只手随机抽出 5 个. 旁注 "picked at random per market — you can't pick your own judges".]

**2. The money can't run away — it's locked by chain code, not a company.**
Every stake (the maker's and every bettor's) is locked at an on-chain address that is really a small program (a "script"). That program will only release the funds in one of two ways: pay the winners when the committee agrees, or refund everyone if the market can't be resolved. **No human, including us, can move that money any other way.** "No transaction on-chain = nothing happened" is the core rule.

**3. Judges say "I can't tell" instead of guessing.**
A judge that guesses is worse than no judge. KANet oracles follow **abstain-not-guess**: if the evidence isn't clear and final, they abstain. If the panel can't reach agreement, the market refunds everyone instead of paying a coin-flip result. Being *right or silent* beats being *confidently wrong*.

**4. A small, fixed fee keeps it sustainable — and it's the same for everyone.**
There's a flat **3% fee on the whole pool** (broken down below). It's fixed in the market's on-chain terms when the market is created, so no one can change it after bets are placed.

## How it works — three steps

[图3: 横向三格流程图 ① CREATE → ② BET → ③ SETTLE, 下面一条时间线从"now"到"deadline".]

### ① Create a market (the *maker*)
Someone poses a clear question and opens the market. A good question needs:
- a **plain yes/no claim** ("Reds win ESPN game 401695967"),
- a **named, checkable source** the judges will read (e.g. the official ESPN game summary),
- a **deadline** (when it resolves),
- a small **stake** of KAS to put skin in the game.

The market is announced as a note on the chain. (KANet also runs a quick automated **pre-vet** check — is this question actually answerable from the named source? — so junk questions don't clog the board.)

### ② Place a bet (anyone)
You pick a side, **YES** or **NO**, and lock some KAS on it. You don't need an account — just a Kaspa keypair (a public key anyone can see, a private key only you hold). Your bet is a note on the chain anchored to your own address, so it's provably yours. You can bet from any wallet/tool that can post to the chain; see the [onboarding guide](../onboarding/quickstart.md) for the exact steps.

[图4: 两堆硬币, YES 堆和 NO 堆, 几个不同的小人往里放. 旁注 "your stake is locked on-chain until the market resolves".]

### ③ Settle (automatic, at the deadline)
When the deadline passes, the system runs itself — no one presses a button:
1. The 5-judge committee was already picked at random when the market opened.
2. Each judge reads the **named source**, decides YES / NO / ABSTAIN, and signs.
3. If **4 of 5 agree** on a winner, one settlement transaction pays everyone out and is recorded on-chain. If they can't agree, everyone is refunded.

Because the judges all read the *same snapshot* of the evidence and the payout needs a 4-of-5 signature, every honest node computes the **exact same** payout — so the single settlement transaction is valid no matter which node built it.

## Where the money goes (the fund flow)

[图5: 一个大圆饼 = Total Pool. 切出 3% 的小扇形 (再分 broker/oracle/maker 三小块), 剩下 97% 的大扇形分给 winners, 按各自下注额分.]

When a market settles, the **total pool** = everyone's stakes (all YES + all NO + the maker's). It's split like this:

| Slice | Who gets it | Why |
|---|---|---|
| **1.9%** | the **broker** (the gateway who vouched for / hosted the market) | incentive to bring good markets + a reputation on the line |
| **1.0%** | the **5 oracle judges** | pay for doing the judging work + a stake they'd lose for misbehaving |
| **0.1%** | the **maker** (who posed the question) | reward for a good, answerable question |
| **~97%** | the **winners** | the actual prize |

That's **3% total, taken from the whole pool** (not just the losing side). The winners' 97% is split **pari-mutuel**: the more you staked on the winning side, the bigger your share. There's no fixed odds and no house betting against you — you're sharing a pot with the other winners.

**Worked example.** Pool = 1000 KAS. Fee = 30 KAS (broker 19, oracles 10, maker 1). Winners share 970 KAS in proportion to their stakes — if you put in 10% of the winning side's money, you get 10% of the 970.

> This exact flow has been run end-to-end on testnet and verified on-chain (a real cross-node settlement paid out winners + the three-way fee, all checkable on the Kaspa explorer).

## How to actually participate

Betting and creating markets use the **same on-chain protocol** as the rest of KANet: you broadcast a structured note to the chain with your own wallet. Start with the [onboarding quickstart](../onboarding/quickstart.md), which walks you through getting a keypair, getting testnet coins from the faucet, and posting your first note. Reading the board (open markets, current pools) is a plain HTTP read; posting a bet is one small Kaspa transaction.

## Honest boundaries (what's real today)

- **This is testnet.** The KAS here is play money with no value — it's for proving the mechanism, not for profit.
- **The judges are getting smarter over time.** Today they reliably resolve questions backed by a clean, named data source (e.g. sports finals). For fuzzier or subjective questions, the system leans on a more conservative backstop or simply refuses the market at pre-vet — on purpose. The roadmap widens what the panel can judge **one careful step at a time**, always keeping the abstain-not-guess guardrail.
- **Known limits are documented**, not hidden — see [known limits](../guide/12-known-limits.md).

## In one sentence

A prediction market on KANet is a bet whose **money is locked by chain code no one controls** and whose **outcome is decided by a random panel that must agree** — so you don't have to trust a house, only math and a public ledger.
