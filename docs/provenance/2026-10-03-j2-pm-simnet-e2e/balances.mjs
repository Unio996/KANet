import { rpcConnect, relays, kaspa } from './lib.mjs';
const rpc = await rpcConnect();
const out = {};
for (const [n, r] of Object.entries(relays)) { const b = await rpc.getBalanceByAddress({ address: r.address }); const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(r.address)]); out[n] = { KAS: Number(b.balance) / 1e8, utxos: entries.length }; }
console.log(JSON.stringify(out));
process.exit(0);
