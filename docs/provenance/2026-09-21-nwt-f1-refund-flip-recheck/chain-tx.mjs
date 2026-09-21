// NWT 只读: 取指定 txid 的链上交易体(经其 accepting 块的 mergeset)。simnet only, 只调 get*。
import { createRequire } from 'node:module';
const kaspa = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-relay/')('kaspa-wasm');
const { RpcClient, Encoding } = kaspa;
const rpc = new RpcClient({ url: 'ws://127.0.0.1:28510', encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
if ((await rpc.getServerInfo()).networkId !== 'simnet') { console.error('REFUSE'); process.exit(3); }
const [acceptingPrefix, wantTx] = [process.argv[2], process.argv[3].toLowerCase()];
const dag = await rpc.getBlockDagInfo();
// 定位 accepting 块全哈希
let start = dag.pruningPointHash, accHash = null;
for (let p = 0; p < 400 && !accHash; p++) {
  const r = await rpc.getVirtualChainFromBlock({ startHash: start, includeAcceptedTransactionIds: true, minConfirmationCount: 0 });
  for (const a of r.acceptedTransactionIds || []) if ((a.acceptedTransactionIds || []).some((t) => String(t).toLowerCase() === wantTx)) accHash = String(a.acceptingBlockHash);
  const added = r.addedChainBlockHashes || []; if (!added.length) break; start = added[added.length - 1];
}
console.log('accepting', accHash);
const b0 = (await rpc.getBlock({ hash: accHash, includeTransactions: true })).block ?? null;
const hashes = [accHash, ...((b0?.verboseData?.mergeSetBluesHashes) || []).map(String), ...((b0?.verboseData?.mergeSetRedsHashes) || []).map(String)];
let hit = null;
for (const h of hashes) {
  const b = (await rpc.getBlock({ hash: h, includeTransactions: true })).block;
  for (const t of b.transactions || []) if (String(t.verboseData?.transactionId ?? '').toLowerCase() === wantTx) { hit = { h, t }; break; }
  if (hit) break;
}
if (!hit) { console.log('tx body not found in mergeset'); process.exit(0); }
const t = hit.t; console.log('found in block', hit.h.slice(0, 12), 'daa', String(hit.t.verboseData?.blockTime ?? ''), 'lockTime', String(t.lockTime), 'version', t.version);
for (const [i, inp] of t.inputs.entries()) console.log('in', i, 'prev', String(inp.previousOutpoint.transactionId).slice(0, 12) + ':' + inp.previousOutpoint.index, 'sequence', String(inp.sequence), 'sigScriptLen', String(inp.signatureScript ?? '').length / 2);
for (const [i, o] of t.outputs.entries()) console.log('out', i, 'value', String(o.value), 'spk', String(o.scriptPublicKey.script ?? o.scriptPublicKey).slice(0, 80), 'covenant', JSON.stringify(o.covenant ?? null, (k, v) => typeof v === 'bigint' ? String(v) : v));
await rpc.disconnect().catch(() => {}); setTimeout(() => process.exit(0), 200);
