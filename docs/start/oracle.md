# The Oracle: Making a Blockchain Believe "What Actually Happened"

> For developers / AI agents who have never seen KANet. We explain *why* it's designed this way first, then *how* to use it.
> 中文版见 [oracle.zh.md](./oracle.zh.md).

---

## 1. The problem it solves

A blockchain is great at exactly one thing: **enforcing rules that were written down, strictly**. But it has a built-in blind spot — **it cannot see the real world off-chain**.

Here's an example. Two people bet: "Will Argentina win the 2026 World Cup?" The money is locked in a smart contract. The match ends, Argentina wins — but **the contract itself has no idea**. It has no eyes, can't read the news, can't see the score.

This is where an **oracle** comes in: a bridge that safely carries "facts about the real world" onto the chain. Who won, what bitcoin costs right now, whether some event actually happened — the oracle's job is to give the blockchain a **trustworthy answer**, so the contract can pay the right person.

The hard part isn't "fetch some data." It's **"why should anyone trust that this answer wasn't tampered with."** This document is about how KANet's oracle makes "trustworthy" hold up.

> `[Diagram 1]` On one side, a smart contract (money locked, blindfolded). On the other, the real world (a ball game, coin prices, news). A bridge between them labeled "Oracle," with "delivers facts safely" written on it.

---

## 2. The single most important rule: if you can't tell, abstain (no guessing)

The foundation of KANet's oracle is one sentence:

> **If you can't get reliable evidence, honestly say "I don't know" (abstain). Never guess.**

This is called **abstain-not-guess**.

Why is this the most important rule? Because an oracle that **guesses** is more dangerous than no oracle at all — it confidently hands over a wrong answer, the contract pays the wrong person based on it, and nobody realizes it was just a coin flip.

So in KANet's design, every judgment has only three outcomes: **YES / NO / ABSTAIN**. When evidence can't be obtained, or what's obtained doesn't read out to a clear conclusion, the system **actively chooses ABSTAIN** and sends that market back (refund, or hand it to a backstop) instead of forcing a YES or NO.

This rule is what lets the oracle **grow up safely** — as we give it stronger abilities later, as long as it holds "if you can't tell, abstain," it will never wreck trust by *over-reaching to judge things it shouldn't*.

> `[Diagram 2]` A signpost with three exits: YES / NO / ABSTAIN. A judge reaches a fork where evidence is insufficient and clearly takes the ABSTAIN path, labeled "honest abstain > confidently wrong."

---

## 3. How it judges: not one party deciding, but a committee

If there were only one judge, a bribe or a single mistake would ruin the result. So KANet uses a **committee**.

When a prediction market expires, **several oracle committee members** (say, 5) **each judge the same question independently**. Each gives their own YES / NO / ABSTAIN.

Then we look at the **majority**: a threshold must be met (for example, **at least 4 of 5 agree**) for the result to count and for the contract to settle on it.

The key phrase is **"independently"**: each member runs their own judgment process, no copying answers. That way a single member, even if they want to cheat, can't move the majority.

> `[Diagram 3]` 5 judge figures each look at their own evidence and each raise a card (YES/YES/YES/YES/ABSTAIN). Below, a tally box: "4/5 agree → accept YES." Emphasize no lines between the judges (independent).

---

## 4. How it gathers evidence: go to a trusted source, take only the clean fact

Before judging, each member must **gather evidence**. KANet doesn't let an AI answer off the top of its head — it goes to a **designated trusted data source**, grabs the fact, and feeds the **clean result** to the judgment model.

Sources currently built in (this list keeps growing):

| Question type | Source | What it takes |
|---|---|---|
| Sports results | ESPN | the winner + final score |
| Crypto prices | CoinGecko | the real-time price |
| Some subjective/complex events | UMA and other backstops | see Section 6 |

Two details embody the "no guessing" discipline:

- **No final, no judgment**: for a sports event, evidence is produced only when the data source explicitly marks "game over"; if it isn't finished yet → evidence comes back empty → the member **abstains**.
- **Faithful extraction**: the fact taken (e.g. "BTC = 107000 USD") is fed to the judgment model **as-is**, without doing the semantic reasoning for it. Whether it's ≥ some threshold is for the model to judge against the real number, rather than the extraction step pre-deciding it.

> `[Diagram 4]` A pipeline: question → fetch page from ESPN/CoinGecko → extractor cuts out "one clean sentence of fact" → feed to the judge. Put a funnel between "fetch" and "extract," labeled "keep clean facts, drop the noise."

### A check-up before the market opens (pre-vet)

There's also a gate up front: **before a market is created**, the system **dry-runs its evidence extractor**. If the question simply can't yield judgeable evidence (source unsupported, format unreadable), it **rejects creating that market outright**.

This way, only **judgeable markets** ever appear on the platform — cutting off "a bet that can't be resolved" at the source.

---

## 5. How it prevents cheating

The core of trust is "cheating doesn't pay." KANet stacks several layers:

1. **Committee + majority threshold**: a single member can't move the result (Section 3).
2. **Independent judgment**: members don't copy each other, avoiding "one error dragging the rest off."
3. **Source anti-forgery**: evidence is only accepted from **whitelisted real domains**, with strict host-anchored matching, blocking attacks like `evil.com/espn.com…` that disguise a fake address as a real source (otherwise an attacker could fabricate evidence and rig the settlement).
4. **Staking + slashing**: members must post a deposit. Voting wrong or being lazy (not gathering evidence when they should, voting randomly) gets the deposit **slashed**. Honest work earns a reward; cheating or slacking loses money.
5. **Backstop arbitration (UMA)**: things the AI can't judge yet go to UMA-style "optimistic oracles" — propose an answer + a **challenge window**, and anyone who spots an error can dispute it within that window.

Put together: **cheating would require fooling a majority of independent members, bypassing the source whitelist, AND being willing to lose your stake** — the cost far exceeds the gain.

> `[Diagram 5]` An "anti-cheat onion" with five layers inside-out: ① majority threshold ② independent judgment ③ source whitelist ④ staking/slashing ⑤ UMA backstop. Outside, a thief holding fake evidence is blocked layer by layer.

---

## 6. It gets stronger over time (the North Star)

Today KANet's oracle mainly judges **structured, single-source** objective facts (game results, coin prices). What it can't judge, it honestly hands to the UMA backstop. But this is just the **starting point, not the ceiling**.

By design, its "judgment ability" is added **one tier at a time**:

```
Tier 0 (today): single source, single-page fact (ESPN / CoinGecko)
Tier 1: more structured sources (more sports / data APIs)
Tier 2: multi-source cross-confirmation (judge only when 2+ sources agree; if they disagree, abstain)
Tier 3: restricted web search (search within a whitelisted source set)
Tier 4: tool calls (on-chain queries / calculators / specialized APIs)
Tier 5: open web search (widest, and the most in need of strong abstain + pre-vet gating)
```

Each tier up makes the **set of judgeable questions larger, and the dependence on UMA smaller**. And every tier **always holds the iron rule from Section 2**: judge what you can, honestly abstain on what you can't.

> There is only one North Star: **get truer, more accurate information to judge with.** Evidence gathering, abstaining, the committee, the pre-open check-up, UMA, and future new skills all serve this single goal.

> `[Diagram 6]` A rising staircase, steps going from "single-page fact" to "open web search," getting wider the higher you go (the range it can judge grows). Each step has a small label on its side, "can't tell → abstain," to stress that ability grows but the bottom line stays.

---

## 7. If you want to use it

You don't need to run the oracle yourself — it's built into the platform. You'll meet it in two roles:

- **Market creator**: you propose a judgeable question (with its resolution criteria + data source). The system **pre-vets** it; only a passing market opens, and a failing one tells you "this question can't be judged right now."
- **Bettor / participant**: at expiry the committee automatically gathers evidence, votes, settles by majority, and pays the right side — **fully automatic, fully auditable** (every step has an on-chain record you can check).

If the system **abstains** on a market, the money is safely refunded / sent to backstop arbitration — **it is never swallowed by a guessed answer**. That's exactly the guarantee this whole design is meant to give you.

---

### In one sentence

KANet's oracle is a **trustworthy bridge that "honestly abstains when it can't tell, and when it can: multiple independent members gather evidence + a majority decides + cheating loses money"** — and the load this bridge can carry grows one tier at a time. The goal, always: **give the blockchain truer, more accurate real-world facts.**
