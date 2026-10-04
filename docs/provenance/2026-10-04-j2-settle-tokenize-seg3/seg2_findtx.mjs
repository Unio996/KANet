// seg2_findtx.mjs — 从已知块哈希起向前扫块(getBlocks)找某笔 tx, 打印其输入/输出(含 covenant 绑定): node seg2_findtx.mjs <lowBlockHash> <txid>
import { rpcConnect } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const [low, txid] = process.argv.slice(2);
const rpc = await rpcConnect();
let cursor = low, found = null;
for (let round = 0; round < 200 && !found; round++) {
  const r = await rpc.getBlocks({ lowHash: cursor, includeBlocks: true, includeTransactions: true });
  for (const b of r.blocks) { const tx = b.transactions.find((t) => t.verboseData?.transactionId === txid); if (tx) { found = { b, tx }; break; } }
  if (!r.blockHashes.length || r.blockHashes[r.blockHashes.length - 1] === cursor) break;
  cursor = r.blockHashes[r.blockHashes.length - 1];
}
if (!found) { console.log('NOT FOUND'); process.exit(1); }
const { b, tx } = found;
const o = { txid, blockHash: b.verboseData?.hash, daa: String(b.header.daaScore), version: tx.version,
  inputs: tx.inputs.map((i) => ({ prev: `${i.previousOutpoint.transactionId}:${i.previousOutpoint.index}`, sigScriptLen: i.signatureScript.length / 2, computeBudget: i.computeBudget ?? i.sigOpCount })),
  outputs: tx.outputs.map((x, k) => ({ idx: k, value: String(x.value), covenantId: x.covenant?.covenantId ? String(x.covenant.covenantId) : null, authInput: x.covenant?.authorizingInput ?? null })) };
console.log(JSON.stringify(o, null, 1)); writeFileSync('seg2_handoff_tx_onchain.json', JSON.stringify(o, null, 1)); process.exit(0);
