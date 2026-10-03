// setup.mjs — 建 simnet 彩排库:跑生产 migrations,用生产 createRelayNode 建 11 个 relay(simnet 地址),
// 密钥只落 scratch(D:/kanet-tn12/scratch/_j2_pm_e2e_sim/relays.json), 并从银行密钥注资。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
const WT = 'D:/kanet-tn12/scratch/_j2_wt_pm_e2e';
const SIM = 'D:/kanet-tn12/scratch/_j2_pm_e2e_sim';
for (const l of readFileSync(`${WT}/docs/provenance/2026-10-03-j2-pm-simnet-e2e/env.simnet.template`, 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) process.env[m[1]] = m[2];
}
for (const s of ['', '-wal', '-shm']) { if (existsSync(process.env.DB_PATH + s)) unlinkSync(process.env.DB_PATH + s); }
const require = createRequire(`${WT}/kasia-relay/`);
const { RpcClient, Encoding, PrivateKey, Address, Generator, PaymentOutput } = require('kaspa-wasm');
const imp = (p) => import(pathToFileURL(p).href);
const { runMigrations } = await imp(`${WT}/kasia-console/src/db/migrate.js`);
runMigrations();
const { createRelayNode } = await imp(`${WT}/kasia-console/src/data/settings/relay-nodes.js`);
const names = ['maker', 'settler', 'fee', 'bettorA', 'bettorB', 'oracle-1', 'oracle-2', 'oracle-3', 'oracle-4', 'oracle-5', 'oracle-6'];
const relays = {};
for (const n of names) {
  const hex = randomBytes(32).toString('hex');
  const pk = new PrivateKey(hex);
  const address = pk.toPublicKey().toAddress('simnet').toString();
  const xonly = pk.toPublicKey().toXOnlyPublicKey().toString();
  const id = createRelayNode({ name: `e2e-${n}`, privkey: hex, address, network: 'simnet', adapterNodeId: null, pollMs: 2000 });
  relays[n] = { id, address, xonly, priv: hex };
}
writeFileSync(`${SIM}/relays.json`, JSON.stringify(relays, null, 1));
console.log('relays:', Object.entries(relays).map(([k, v]) => `${k}=${v.id.slice(0, 8)} ${v.address.slice(0, 24)}… x=${v.xonly.slice(0, 8)}`).join('\n'));
// 注资:银行 → 每个 relay(3 笔 UTXO 各 amount, 避免 pendingSpent 窗口卡单 UTXO)
const rpc = new RpcClient({ url: process.env.KASPA_RPC_URL, encoding: Encoding.Borsh, networkId: 'simnet' });
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
const mature = entries.slice(0, 80);
const gen = new Generator({ entries: mature, outputs, priorityFee: 0n, changeAddress: new Address(bankAddr), networkId: 'simnet' });
let p, txs = [];
while ((p = await gen.next())) { await p.sign([bank]); txs.push(await p.submit(rpc)); }
console.log('funding txs:', txs.length, txs.join(','));
await new Promise((r) => setTimeout(r, 6000));
for (const [n, r] of Object.entries(relays)) { const b = await rpc.getBalanceByAddress({ address: r.address }); console.log(n, Number(b.balance) / 1e8, 'KAS'); }
await rpc.disconnect(); process.exit(0);
