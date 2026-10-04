// seg3_post.mjs — 事后读回: 找 handoff / zk_close 两笔 tx(块扫描), 取 CloseZkV2 的 covenant id → 池代币 UTXO 是否原封不动; 打印两笔 tx 的输入/输出/预算(按块)。
import { rpcConnect, kaspa } from './lib.mjs';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
process.env.SILVERC_V100_PATH ||= 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const { computeKttTokenArtifact } = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib/pool-bshard-artifacts.mjs').href);
const [handoffTx, closeTx, pool] = process.argv.slice(2);
const rpc = await rpcConnect();
const dag = await rpc.getBlockDagInfo();
const found = {};
let cursor = dag.pruningPointHash;
for (let round = 0; round < 400 && Object.keys(found).length < 2; round++) {
  const r = await rpc.getBlocks({ lowHash: cursor, includeBlocks: true, includeTransactions: true });
  for (const b of r.blocks) for (const tx of b.transactions) { const id = tx.verboseData?.transactionId; if (id === handoffTx || id === closeTx) found[id] = { b, tx }; }
  if (!r.blockHashes.length || r.blockHashes[r.blockHashes.length - 1] === cursor) break;
  cursor = r.blockHashes[r.blockHashes.length - 1];
}
const desc = ({ b, tx }) => ({ blockHash: b.verboseData?.hash, daa: String(b.header.daaScore), version: tx.version,
  inputs: tx.inputs.map((i) => ({ prev: `${i.previousOutpoint.transactionId}:${i.previousOutpoint.index}`, sigScriptLen: i.signatureScript.length / 2, computeBudget: i.computeBudget ?? i.sigOpCount })),
  outputs: tx.outputs.map((x, k) => ({ idx: k, value: String(x.value), covenantId: x.covenant?.covenantId ? String(x.covenant.covenantId) : null, authInput: x.covenant?.authorizingInput ?? null })) });
const out = { handoff: found[handoffTx] && desc(found[handoffTx]), close: found[closeTx] && desc(found[closeTx]) };
console.log(JSON.stringify(out, null, 1));
const zkCov = out.handoff?.outputs[0]?.covenantId;
const tokAddr = kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(computeKttTokenArtifact({ amount: Number(pool), ownerCovIdHex: zkCov }).script)), 'simnet').toString();
const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(tokAddr)]);
out.tokenUtxos = entries.map((e) => ({ outpoint: `${e.outpoint.transactionId}:${e.outpoint.index}`, amount: String(e.amount) }));
out.zkCovId = zkCov; out.closeContinuationCovId = out.close?.outputs[0]?.covenantId;
console.log('CloseZkV2 cov (handoff out0):', zkCov, '| zk_close continuation cov:', out.closeContinuationCovId, '| 池代币 UTXO(after close):', JSON.stringify(out.tokenUtxos));
writeFileSync('seg3_post.json', JSON.stringify(out, null, 1)); process.exit(0);
