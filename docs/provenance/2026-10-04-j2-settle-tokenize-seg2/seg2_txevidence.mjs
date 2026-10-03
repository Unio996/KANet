// seg2_txevidence.mjs — 读回链上交易原文(按块读): node seg2_txevidence.mjs <txid> [<txid>…]  (块哈希取自 console 的 kaspa_tx_log: relay 找零入账行)
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { rpcConnect } from './lib.mjs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64);
const { sqlite: db } = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/db/client.js').href);
const rpc = await rpcConnect();
const out = {};
for (const txid of process.argv.slice(2)) {
  const row = db.prepare('select block_hash from kaspa_tx_log where tx_id = ?').get(txid);
  if (!row) { out[txid] = { error: 'no kaspa_tx_log row (no change output to a watched address)' }; continue; }
  const b = await rpc.getBlock({ hash: row.block_hash, includeTransactions: true });
  const tx = b.block.transactions.find((t) => t.verboseData?.transactionId === txid);
  out[txid] = !tx ? { error: 'tx not in block' } : {
    blockHash: row.block_hash, daa: String(b.block.header.daaScore), version: tx.version,
    inputs: tx.inputs.map((i) => ({ prev: `${i.previousOutpoint.transactionId}:${i.previousOutpoint.index}`, sigScriptLen: i.signatureScript.length / 2, computeBudget: i.computeBudget ?? i.sigOpCount })),
    outputs: tx.outputs.map((o, k) => ({ idx: k, value: String(o.value), covenantId: o.covenant?.covenantId ? String(o.covenant.covenantId) : null, authInput: o.covenant?.authorizingInput ?? null })),
  };
}
console.log(JSON.stringify(out, null, 1));
writeFileSync('seg2_txevidence.json', JSON.stringify(out, null, 1));
process.exit(0);
