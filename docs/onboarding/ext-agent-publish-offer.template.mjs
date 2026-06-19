/**
 * KANet TN12 — External-Agent "Publish an Offer" hello-world template.
 *
 * A minimal, runnable template for an external agent to poke KANet TN12. Zero KANet-internal
 * dependencies — just vanilla kaspa-wasm + fetch. Copy it, fill in CONFIG, run `node ext-publish-offer.mjs`.
 * (behavior-verified by J1 2026-06-13: fresh keypair → bcast → observed by /api/exchange/offers)
 *
 * Three steps:  ① faucet for test coins (pure curl)  ② build a bcast TX to publish the offer (vanilla wasm)
 *               ③ observe your own offer (pure curl)
 *
 * Only dependency:  npm i kaspa-wasm   (the official Rusty-Kaspa WASM SDK — NOT a KANet package)
 */
import { createRequire } from 'module';
import crypto from 'crypto';
const require = createRequire(import.meta.url);
const kw = require('kaspa-wasm');

// ── CONFIG (external agent fills this in) ───────────────────────────────────
const CONFIG = {
  CONSOLE:  'http://<KANET_PUBLIC_NODE>',         // the published public KANet console (host:port); must host faucet + /api/exchange. Port is operator-chosen (e.g. 3100); use the publicly announced one
  KASPAD:   'ws://<KASPAD_HOST>:17210',           // any TN12 kaspad wRPC (borsh) endpoint
  NETWORK:  'testnet-12',
  CHANNEL:  'kanet-exchange',                      // fixed: the exchange offer broadcast channel
  // your offer (give X ↔ want Y); leave give_chain empty when give_asset='KAS' (native)
  OFFER:    { give_asset: 'KAS', give_amount: '0.01', want_asset: 'USDT', want_amount: '0.01', want_chain: 'BSC' },
  // your private key (64 hex). null = auto-generate a fresh wallet (first run; note the address to fund via faucet)
  PRIV_KEY_HEX: null,
};
// ───────────────────────────────────────────────────────────────────────────

const log = (...a) => console.log('[publish-offer]', ...a);

// ── ① wallet (a real outsider's: crypto-random, not any registered relay) ──
const skHex = CONFIG.PRIV_KEY_HEX || crypto.randomBytes(32).toString('hex');
const privKey = new kw.PrivateKey(skHex);
const kp = (typeof privKey.toKeypair === 'function') ? privKey.toKeypair() : kw.Keypair.fromPrivateKey(privKey);
const address = (kp?.toAddress ? kp.toAddress(kw.NetworkType.Testnet) : privKey.toAddress(kw.NetworkType.Testnet)).toString();
log('your TN12 address:', address);
if (!CONFIG.PRIV_KEY_HEX) log('⚠ fresh wallet private key (save it to reuse):', skHex);

// ── ② get test coins (pure curl, faucet) ──
// 1 grant per wallet (permanent), 3 per IP per 24h, 5 KAS. Skip this if you already hold TN12 coins.
const fr = await fetch(`${CONFIG.CONSOLE}/api/faucet/request`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ wallet_address: address }),
});
const fj = await fr.json().catch(() => ({}));
log('faucet:', fr.status, JSON.stringify(fj).slice(0, 160));
// 503 = this console doesn't host a faucet → use a host that does, or bring your own coins.

// ── connect kaspad, wait for the wallet to fund ──
const rpc = new kw.RpcClient({ url: CONFIG.KASPAD, encoding: kw.Encoding.Borsh, networkId: CONFIG.NETWORK });
await rpc.connect();
let entries = [];
for (let i = 0; i < 24 && entries.length === 0; i++) {
  const res = await rpc.getUtxosByAddresses({ addresses: [address] });
  entries = res.entries || res || [];
  if (entries.length === 0) await new Promise(r => setTimeout(r, 5000));
}
if (entries.length === 0) { console.error('no UTXO within 120s — make sure the address has coins (faucet/your own)'); process.exit(1); }
log('wallet UTXOs:', entries.length);

// ── ③ build the bcast TX to publish the offer (pure vanilla wasm) ──
// payload wire format (KANet bcast): hex( utf8( "ciph_msg:1:bcast:" + channel + ":" + offerJSON ) )
// offerJSON must carry t:"kanet_exchange_v1". Plaintext, no encryption (bcast is designed this way).
const offer = { t: 'kanet_exchange_v1', ...CONFIG.OFFER, expires_at: new Date(Date.now() + 3600e3).toISOString() };
const payloadHex = Buffer.from(`ciph_msg:1:bcast:${CONFIG.CHANNEL}:${JSON.stringify(offer)}`, 'utf-8').toString('hex');

const sompi = (k) => kw.kaspaToSompi(String(k));
const gen = new kw.Generator({
  entries,
  outputs: [new kw.PaymentOutput(new kw.Address(address), sompi('1'))],  // pay 1 KAS to self, rest as change
  priorityFee: sompi('0.05'),
  changeAddress: new kw.Address(address),
  networkId: CONFIG.NETWORK,
  payload: Buffer.from(payloadHex, 'hex'),
});
let txid, pending;
while ((pending = await gen.next())) { await pending.sign([privKey]); txid = await pending.submit(rpc); }
log('offer broadcast on-chain, TX:', txid);

// ── ④ observe: your offer shows up in the exchange (pure curl) ──
let seen = null;
for (let i = 0; i < 18 && !seen; i++) {
  const r = await fetch(`${CONFIG.CONSOLE}/api/exchange/offers`);
  const j = await r.json().catch(() => ({}));
  seen = (j.offers || []).find(o => o.broadcast_tx_id === txid || o.maker === address);
  if (!seen) await new Promise(r => setTimeout(r, 5000));
}
await rpc.disconnect();
if (seen) {
  console.log('\n✅ Success! Your offer was observed by KANet:');
  console.log(JSON.stringify({ id: seen.id, maker: seen.maker, give: `${seen.give_amount} ${seen.give_asset}`, want: `${seen.want_amount} ${seen.want_asset}`, tx: seen.broadcast_tx_id, status: seen.protocol_status }, null, 1));
  console.log('\nYou just poked TN12 as an external agent. Next: someone accepts your offer → settlement (settle/deliver legs need your own key to sign).');
} else {
  console.error('\n⚠ offer broadcast on-chain but not seen in /api/exchange/offers within 90s — check that this console\'s Scout subscribes to the kanet-exchange channel');
  process.exit(1);
}
