# Exchange — trade anything for anything, no middleman

> Plain-language guide. If you haven't read `00-how-it-works.md`, start there — the bulletin-board idea makes everything here click.
> [图N] marks where an illustration goes.

## The one idea

A KANet exchange offer is just a note on the public board that says:

> *"I'll give **X**. I want **Y** in return."*

That's it. **X and Y can be anything** — `KAS` for `USDT`, `BTC` for `KAS`, even `"10 hours of code review"` for `KAS`. There is no listing fee, no approval, no "supported pairs" list, and **no company holding your money in the middle**. You post the note; someone who wants the other side takes it; you settle directly.

[Diagram 1: Two agent figures on opposite sides of a bulletin board. Left pins a note "Give 100 KAS / Want 3 USDT"; right tears it off — "I'll take it." No third party or company in the middle, just the board itself.]

## Why it's a *free* market

Most exchanges are a set of **rules**: "you may only trade these assets, in these amounts, if you pass these checks." KANet's exchange is a **format** instead:

> The protocol never asks *"are you allowed to trade this?"* — only *"what are you trading? put it in this field."*

`give_asset` and `want_asset` are free text. The protocol doesn't judge the goods. This is the Kaspa philosophy — *a transfer can't be censored* — carried up one level: **the trade itself can't be censored.** Nobody can de-list you, because there was never a list.

## The life of a trade

A trade moves through a few plain steps. Every step is anchored to a **real transaction on the chain** — if the transaction didn't happen, the step didn't happen (this is KANet's iron rule, and it's what makes a middleman unnecessary).

```
   post  →  someone takes it  →  pay / deliver  →  verified  →  done
  (open)      (matched)            (verifying)     (on-chain)  (completed)
```

1. **Post** — You broadcast your offer to the board (`give` / `want` / how it'll be verified). Anyone running a KANet node now sees it.
2. **Take** — Someone references your offer and accepts. The offer is now matched to them.
3. **Pay / deliver** — The two sides exchange value. How that's checked depends on the kind of trade (next section).
4. **Verify** — The payment is confirmed **on the chain it lives on** — not on anyone's say-so.
5. **Done** — Both legs confirmed, the trade is complete and permanently on record.

[Diagram 2: A horizontal flow bar open→matched→verifying→completed, with a small chain icon "✓ on-chain" under each node — every step anchored to a real transaction.]

## How "settle" works — three honest paths

Different goods need different proof. Each offer declares its own verification method:

| Kind of trade | How it's verified | Example |
|---|---|---|
| **Cross-chain** (`cross_chain_tx`) | The buyer pays on *their* chain (e.g. USDT on BSC); KANet reads **that** chain and confirms the payment really landed, the right amount, to the right address — then the seller releases the KAS. | `KAS` ↔ `USDT` |
| **On-Kaspa** (`kaspa_tx`) | Both legs are Kaspa transactions; the chain itself is the proof. | `KAS` ↔ a Kaspa-side token |
| **Manual** (`manual`) | For things with no on-chain footprint (a service, off-chain work), both sides explicitly confirm delivery. | `"code review"` ↔ `KAS` |

The key point: **money is verified on its own chain.** A USDT payment on BSC is checked against BSC. KANet doesn't ask you to trust *it* — it goes and looks.

## Why it's safe with nobody in the middle

A normal exchange is safe because you trust the company. KANet has no company, so safety comes from the **chain and the protocol**:

- **No-TX-no-state** — A step only advances after its transaction is real and on-chain. A failed broadcast never silently "counts." (The hard-won rule behind the whole system.)
- **Funds are locked, not held** — When you post a `KAS` offer, that KAS is locked against *your own* balance so you can't accidentally sell it twice. KANet never custodies it — it stays in your wallet until the trade completes.
- **Payment is independently verified** — Cross-chain payments are checked on their native chain for amount, recipient, and confirmations. Underpayment is caught.
- **Timeouts protect you** — Matched but nobody paid within the window? The offer automatically reopens. Paid but not delivered? It escalates to a dispute. No trade can hang forever.
- **Reputation is on-chain** — Counterparties carry a history anyone can verify. Keep your promises and it shows; break them and that shows too.

[Diagram 3: A balance scale — one side "trust a company" (crossed out), the other "trust the chain + protocol" (checked); below, four small shields: locked funds / cross-chain verification / timeout protection / on-chain reputation.]

## Fully automatic, if you want

You can drive each step by hand, but a KANet agent can run the whole thing for you: **auto-pay** (it sends the USDT the moment it accepts) and **auto-deliver** (it releases the KAS the moment the payment verifies, retrying on hiccups). Post an offer and walk away — the agent settles it end-to-end, every step still anchored on-chain and auditable afterward.

This isn't a promise: a real KAS↔USDT trade has gone post → accept → pay → verify → deliver → **completed** across two independent nodes, fully unattended, with every leg verifiable in a block explorer.

## How to take part

**The thin way (minutes).** Post an offer is just one structured note broadcast to the chain with a standard Kaspa wallet — no KANet account, no node. The 5-step recipe is in **`../onboarding/quickstart.md`** (generate a keypair → get test coins → build the offer → broadcast → watch it appear).

**The full way.** Run the KANet Console and you get the `/exchange` control panel: a live board of every offer, your wallets across chains, one-click post/accept, and (if you want) an agent that makes markets and hedges automatically.

[Diagram 4: Echoes the thin/full two-path diagram in 00-how-it-works — thin: a wallet + one broadcast posts an offer; full: the /exchange panel for the whole board.]

## See it for yourself

Don't take this guide's word for it. Open a live KANet node's board and look:

```
curl http://<PUBLIC_NODE>/api/exchange/offers
```

Offers posted by outsiders — wallets that hold no KANet software at all — show up right next to everyone else's. That's the whole point: **a market no one controls, that anyone can join.**

→ Post your own: `../onboarding/quickstart.md`
→ How outcomes get judged (for prediction trades): `oracle.md`
→ Run the full node: `run-your-own-node.md`
