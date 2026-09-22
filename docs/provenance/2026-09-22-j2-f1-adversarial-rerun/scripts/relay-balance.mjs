import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-relay/'); const { RpcClient, Encoding, Address } = require('kaspa-wasm');
const st = JSON.parse(fs.readFileSync('D:/kanet-tn12/scratch/_j2_f1adv_run/state.json', 'utf8'));
const rpc = new RpcClient({ url: st.rpc, encoding: Encoding.Borsh, networkId: 'simnet' }); await rpc.connect({});
const b = await rpc.getBalanceByAddress({ address: st.relayAddress }); const u = await rpc.getUtxosByAddresses([new Address(st.relayAddress)]);
console.log(JSON.stringify({ balanceKas: Number(b.balance) / 1e8, utxos: (u.entries || []).map((e) => Number(e.amount ?? e.utxoEntry?.amount) / 1e8) }));
await rpc.disconnect().catch(() => {}); process.exit(0);
