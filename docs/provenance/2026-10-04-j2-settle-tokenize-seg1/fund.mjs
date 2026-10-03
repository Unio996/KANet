// fund.mjs — 从银行密钥注资 relays.json 里的 11 个 relay(等 coinbase 成熟 1000 DAA)。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const WT = 'D:/kanet-tn12/scratch/_j2_wt_tokenize';
const SIM = 'D:/kanet-tn12/scratch/_j2_tok_sim';
const require = createRequire(`${WT}/kasia-relay/`);
const { RpcClient, Encoding, PrivateKey, Address, Generator, PaymentOutput } = require('kaspa-wasm');
const relays = JSON.parse(readFileSync(`${SIM}/relays.json`, 'utf8'));
const rpc = new RpcClient({ url: 'ws://127.0.0.1:29717', encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const bank = new PrivateKey(readFileSync(`${SIM}/bank.key`, 'utf8').trim());
const bankAddr = bank.toPublicKey().toAddress('simnet').toString();
const kas = { maker: 400, settler: 400, fee: 300, bettorA: 300, bettorB: 300 };
const outputs = [];
for (const [n, r] of Object.entries(relays)) {
  const amt = kas[n] ?? 50;
  for (let i = 0; i < 4; i++) outputs.push(new PaymentOutput(new Address(r.address), BigInt(Math.round(amt / 4 * 1e8))));
}
const { entries } = await rpc.getUtxosByAddresses([new Address(bankAddr)]);
const dag = await rpc.getBlockDagInfo();
const mature = entries.filter((e) => BigInt(e.blockDaaScore ?? e.utxoEntry?.blockDaaScore) + 1100n < dag.virtualDaaScore).slice(0, 80);
console.log('mature utxos', mature.length, 'daa', dag.virtualDaaScore);
if (mature.length < 10) throw new Error('not enough mature coinbase yet');
const gen = new Generator({ entries: mature, outputs, priorityFee: 0n, changeAddress: new Address(bankAddr), networkId: 'simnet' });
let p; const txs = [];
while ((p = await gen.next())) { await p.sign([bank]); txs.push(await p.submit(rpc)); }
console.log('funding txs:', txs.length, txs.join(','));
await new Promise((r) => setTimeout(r, 6000));
for (const [n, r] of Object.entries(relays)) { const b = await rpc.getBalanceByAddress({ address: r.address }); console.log(n, Number(b.balance) / 1e8, 'KAS'); }
await rpc.disconnect(); process.exit(0);
