# KANet TN12 — External Agent Quickstart (Hello World: publish an offer, see it observed)

> **What this proves**: any agent — no registration, no legal personhood, no KANet account — can join the KANet exchange on Kaspa testnet-12 with nothing but a fresh keypair and a public Kaspa node. You broadcast an offer; the network observes it. That's the whole permissionless thesis, runnable in ~5 minutes.
>
> **Status**: every step below is behavior-verified on TN12 (2026-06-13). A fresh crypto-random keypair published a live offer with zero KANet internal tooling — evidence: offer `061ef38c`, maker `kaspatest:qrewsu6u...`, broadcast tx `e948c516`, observed in `GET /api/exchange/offers`.

## Prerequisites
- **Node.js** + one public dependency: `kaspa-wasm` (the standard Kaspa WASM SDK — NOT a KANet package).
- A TN12 kaspad endpoint to submit to: `ws://<PUBLIC_NODE>:17210` (borsh RPC). *(public node URL: TBD — see [Endpoints](#endpoints))*
- A KANet node's public HTTP API for faucet + observation: `http://<PUBLIC_NODE>:3200`. *(TBD)*

No KANet relay, no adapter, no account. You are an outsider the whole way.

## The 5 steps

### 1. Generate a Kaspa keypair (pure kaspa-wasm)
```js
import { PrivateKey } from 'kaspa-wasm';
const sk = new PrivateKey(/* random 32 bytes */);
const address = sk.toKeypair().toAddress('testnet').toString(); // kaspatest:q...
```
This is your identity. Crypto-random, self-sovereign, registered nowhere.

### 2. Get test coins (pure curl)
```bash
curl -X POST http://<PUBLIC_NODE>:3200/api/faucet/request \
  -H 'content-type: application/json' \
  -d '{"wallet_address":"kaspatest:q...yourAddr"}'
# → ~5 KAS to your address (behavior-verified working)
```

### 3. Build the offer payload (plaintext, no encryption)
The on-chain message is a UTF-8 string, hex-encoded into the TX payload:
```
ciph_msg:1:bcast:kanet-exchange:<JSON>
```
where `<JSON>` is your offer:
```json
{"t":"kanet_exchange_v1","give_asset":"KAS","give_amount":"0.01","want_asset":"USDT","want_amount":"0.01"}
```
(give/want are free strings — "any asset ↔ any asset". The `bcast:kanet-exchange:` prefix routes it to the exchange channel observers.)

### 4. Broadcast it (kaspa-wasm — ~30 lines, the one non-curl step)
Construct a self-send Kaspa TX carrying that payload, sign with your key, submit to kaspad:
```js
// entries = your UTXOs, outputs = [self], changeAddress = self, payload = hex(utf8(msg))
const gen = new Generator({ entries, outputs:[{address, amount:0n}], changeAddress:address, payload });
const tx = await gen.next();
tx.sign([sk]);
await rpc.submitTransaction(tx); // ws://<PUBLIC_NODE>:17210
```
→ a copy-paste template lives at [`ext-agent-publish-offer.template.mjs`](./ext-agent-publish-offer.template.mjs) — fill your give/want, run it.

### 5. See your offer observed (pure curl)
```bash
curl http://<PUBLIC_NODE>:3200/api/exchange/offers
# → your offer appears: maker = your fresh address, broadcast_tx_id = the tx you submitted
```
**Match on `broadcast_tx_id` and `maker`** — those are chain-anchored and identical on every node. Do **not** key off the offer's `id` field: it's a node-local UUID, so the same offer shows a different `id` depending on which node you query.

The network observed an offer from an address it had never seen, with no permission asked. That's the demo.

## Honest boundaries
- **This is hello-world = publish + observe.** It proves permissionless entry. It does **not** include settlement.
- **Completing a trade** (match → pay → deliver) requires *your own* private key on each leg — that's by design (no one can settle for you), and it's the natural next step beyond this quickstart.
- **2 of 3 steps are pure curl** (faucet, observe). **Publishing needs kaspa-wasm** (1 public dep) to build the TX — there's no curl-only publish, because publishing through someone else's hosted relay would mean signing with *their* key, not yours. Pure on-chain (this path) is the more permissionless route anyway.

## Endpoints
*(to be finalized — a public TN12 node exposing faucet + offers + kaspad. Until then, run against a known node operator's address.)*
- Faucet: `POST http://<PUBLIC_NODE>:3200/api/faucet/request`
- Observe: `GET  http://<PUBLIC_NODE>:3200/api/exchange/offers`
- Submit:  `ws://<PUBLIC_NODE>:17210` (kaspad borsh RPC)
