# KANet Exchange: Two AI Nodes, Zero Servers, Cross-Chain Settlement in Seconds

> 2026-04-11. The first fully automated cross-node exchange on Kaspa.

---

## What We Wanted

A person running a Kaspa node in one country publishes an offer: "I sell 10 KAS for 0.33 USDT." Another person on a completely different node, with no shared server, no shared database, no website in between, accepts the offer. USDT flows one way on BNB Chain. KAS flows the other way on Kaspa. Both sides verify. Both sides settle. No human touches anything after the first click.

No exchange. No custodian. No middleman. Just two nodes talking through Kaspa's broadcast protocol.

## How We Did It

Two Claude Code instances — one on each KANet node — designed, debated, coded, tested, and fixed the system together. Their only communication channel: Kaspa on-chain broadcast messages. Every coordination message is a real Kaspa transaction. Every design decision is auditable on-chain.

The protocol is simple:

1. **Maker broadcasts an offer** (Kaspa TX). Any node scanning the chain sees it.
2. **Taker broadcasts acceptance** (Kaspa TX). Selects a payment chain (BNB/ETH/SOL/TRON).
3. **Taker auto-pays USDT** on the selected chain. Broadcasts proof (Kaspa TX).
4. **Maker verifies payment** on-chain (cross-chain verification, 15 confirmations on BNB).
5. **Maker auto-delivers KAS** to taker. Broadcasts delivery proof (Kaspa TX).
6. **Done.** Both sides have the assets. Every step has a TX on-chain.

Every state transition follows one iron rule: **NO TX, NO STATE CHANGE.** If the broadcast doesn't land on chain, local state doesn't advance. The chain is the only source of truth.

## What We Achieved

- **SELL path (KAS to USDT)**: 6 out of 6 trades completed automatically. ~70 seconds per trade (dominated by BNB's 15-confirmation requirement).
- **BUY path (USDT to KAS)**: 1 out of 1 completed. 7 seconds (same-chain Kaspa verification is instant).
- **Zero centralized infrastructure.** No server. No database shared between nodes. No API gateway. Each node is fully sovereign.
- **Zero human intervention after accept.** Auto-pay, auto-verify, auto-deliver, auto-complete.
- **Zero delay between consecutive transactions.** Pending UTXO tracking in memory eliminates the need for artificial waits between Kaspa TXs.

## The Bugs We Killed (And Why They Matter)

We found and fixed 7 critical bugs in one session. Every one of them was invisible in single-node testing. They only appeared when two independent nodes tried to trade for real:

- **Broadcast dedup blocked protocol retries** — the anti-spam system treated trade messages as spam.
- **State gate rejected valid payments** — the verifier expected "matched" but cross-chain offers skip to "verifying."
- **Optimistic writes** — local state advanced before the chain confirmed. Classic distributed systems mistake.
- **UTXO conflicts** — two rapid Kaspa TXs competed for the same unspent output. Fixed with in-memory pending tracking, not artificial delays.

The lesson: **cross-node testing is not optional. It is the test.**

## What This Means

KANet Exchange is not a DEX. It's not a website. It's not even a service.

It is a **protocol**. Two nodes agree on a format: "I give X, I want Y, verify me this way." The Kaspa broadcast layer carries the messages. The state machine on each node advances independently, driven by on-chain facts. If you can run a Kaspa node, you can trade. If you can broadcast a message, you have an offer on the market.

There is no server to shut down. There is no domain to seize. There is no database to hack. The offer exists because a TX exists. The trade completes because TXs confirm. That's it.

## What's Next

- **Any asset pair.** The protocol already supports free-form `give_asset` / `want_asset`. KAS/BTC, USDT/USDC, "10 hours of code review" / "500 KAS" — the state machine doesn't care what's being traded, only that verification passes.
- **Reputation on-chain.** Completed trades build verifiable history. No trust scores from a central authority — just TX count and dispute rate, readable by anyone.
- **Agent autonomy.** AI agents already execute these trades independently. The next step: agents discover opportunities, negotiate prices, and trade on behalf of their owners — all through the same broadcast protocol.
- **Network effect.** Every new node that runs KANet sees every offer ever broadcast. No liquidity fragmentation. No order book servers. The chain IS the order book.

---

*Built by two Claude Code instances coordinating through Kaspa on-chain broadcasts. 25 commits. 7 bugs found and fixed. 7 successful cross-node trades. Zero centralized infrastructure.*
