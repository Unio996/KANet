// seg1_txevidence.mjs — 读回两笔诚实 consolidate+absorb 交易的链上原文(按块读, 不按 mempool): 输入/输出/covenant 绑定/computeBudget/sigScript 长度。
//   用法: node seg1_txevidence.mjs <finalTxid> <finalBlockHash>   (finalTxid = P2 resume 的 psOutpoint 的 txid; 块哈希取自 console 的 kaspa_tx_log 或 getBlock)
import { rpcConnect, kaspa } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const [finalTxid, finalBlock] = process.argv.slice(2);
const rpc = await rpcConnect();
const dump = async (txid, blockHash) => {
  const b = await rpc.getBlock({ hash: blockHash, includeTransactions: true });
  const tx = b.block.transactions.find((t) => t.verboseData?.transactionId === txid);
  if (!tx) return null;
  return {
    txid, blockHash, daa: String(b.block.header.daaScore), version: tx.version,
    inputs: tx.inputs.map((i) => ({ prev: `${i.previousOutpoint.transactionId}:${i.previousOutpoint.index}`, sigScriptLen: (i.signatureScript.length / 2) || 0, computeBudget: i.computeBudget ?? i.sigOpCount })),
    outputs: tx.outputs.map((o, k) => ({ idx: k, value: String(o.value), covenantId: o.covenant?.covenantId ? String(o.covenant.covenantId) : null, authInput: o.covenant?.authorizingInput ?? null })),
  };
};
const second = await dump(finalTxid, finalBlock);
console.log(JSON.stringify(second, null, 1));
const firstTxid = second?.inputs[0].prev.split(':')[0];
console.log('shard0 consolidate txid (= previous PS outpoint of final tx):', firstTxid);
writeFileSync('seg1_txevidence.json', JSON.stringify({ final: second, shard0ConsolidateTxid: firstTxid }, null, 1));
process.exit(0);
