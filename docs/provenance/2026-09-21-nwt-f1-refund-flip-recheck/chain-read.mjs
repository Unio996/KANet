// NWT 只读链读回(simnet only)。只调 get* RPC;拒绝非 simnet;不广播、不写库。
import { createRequire } from 'node:module';
const kaspa = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-relay/')('kaspa-wasm');
const { RpcClient, Encoding } = kaspa;
const rpc = new RpcClient({ url: 'ws://127.0.0.1:28510', encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const si = await rpc.getServerInfo();
if (si.networkId !== 'simnet') { console.error('REFUSE networkId', si.networkId); process.exit(3); }
const dag = await rpc.getBlockDagInfo();
console.log('server', JSON.stringify({ v: si.serverVersion, net: si.networkId, isSynced: si.isSynced, utxoIndex: si.hasUtxoIndex }), 'daa', String(dag.virtualDaaScore), 'pmt', Number(dag.pastMedianTime), 'sink', dag.sink);
const targets = new Map(JSON.parse(process.argv[2]).map((t) => [t.toLowerCase(), 0]));
let start = dag.pruningPointHash; const found = {};
const bhCache = new Map();
for (let page = 0; page < 400 && targets.size; page++) {
  const r = await rpc.getVirtualChainFromBlock({ startHash: start, includeAcceptedTransactionIds: true, minConfirmationCount: 0 });
  const added = r.addedChainBlockHashes || [];
  for (const a of r.acceptedTransactionIds || []) {
    for (const t of a.acceptedTransactionIds || []) { const k = String(t).toLowerCase(); if (targets.has(k)) found[k] = String(a.acceptingBlockHash); }
  }
  if (added.length === 0) break;
  start = added[added.length - 1];
  if (Object.keys(found).length === targets.size) break;
}
for (const t of targets.keys()) {
  const ab = found[t];
  if (!ab) { console.log(t.slice(0, 12), 'NOT ACCEPTED in virtual chain'); continue; }
  const b = await rpc.getBlock({ hash: ab, includeTransactions: false });
  console.log(t.slice(0, 12), 'accepted by chain block', ab.slice(0, 12), 'daa', String((b.block??b).header.daaScore), "timestamp", new Date(Number((b.block??b).header.timestamp)).toISOString());
}
await rpc.disconnect().catch(() => {});
setTimeout(() => process.exit(0), 200);
