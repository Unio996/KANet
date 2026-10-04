// seg4_post.mjs — claim 家族事后读回(按块 + 按 UTXO): node seg4_post.mjs <txid:payoutOrAmount:pool> …   例: <claimTx>:<amount>:<poolBefore>
//   对每笔: 找块 → 打印输入/输出(covenant id/authInput/预算) → 读回 新 KanetTokenClaim UTXO / 新 KTT(owner=claim cov, amount) / 剩余池代币(owner=self cov, amount=pool-amount) / self 续约 UTXO。
import { rpcConnect, kaspa } from './lib.mjs';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
process.env.KASPA_NETWORK ||= 'simnet'; process.env.DB_PATH ||= 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64);
process.env.SILVERC_V100_PATH ||= 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const art = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib/pool-bshard-artifacts.mjs').href);
const specs = process.argv.slice(2).map((a) => { const [txid, amount, pool, winner] = a.split(':'); return { txid, amount, pool, winner }; });
const rpc = await rpcConnect();
const dag = await rpc.getBlockDagInfo();
const found = {}; let cursor = dag.pruningPointHash;
for (let round = 0; round < 400 && Object.keys(found).length < specs.length; round++) {
  const r = await rpc.getBlocks({ lowHash: cursor, includeBlocks: true, includeTransactions: true });
  for (const b of r.blocks) for (const tx of b.transactions) { const id = tx.verboseData?.transactionId; if (specs.some((s) => s.txid === id)) found[id] = { b, tx }; }
  if (!r.blockHashes.length || r.blockHashes[r.blockHashes.length - 1] === cursor) break;
  cursor = r.blockHashes[r.blockHashes.length - 1];
}
const addrOf = (script) => kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(script)), 'simnet').toString();
const utxos = async (a) => (await rpc.getUtxosByAddresses([new kaspa.Address(a)])).entries.map((e) => `${e.outpoint.transactionId}:${e.outpoint.index}=${e.amount}`);
const out = {};
for (const s of specs) {
  const f = found[s.txid]; if (!f) { out[s.txid] = { error: 'not found' }; continue; }
  const { b, tx } = f;
  const outs = tx.outputs.map((x, k) => ({ idx: k, value: String(x.value), covenantId: x.covenant?.covenantId ? String(x.covenant.covenantId) : null, authInput: x.covenant?.authorizingInput ?? null }));
  const rec = { blockHash: b.verboseData?.hash, daa: String(b.header.daaScore), inputs: tx.inputs.map((i) => ({ prev: `${i.previousOutpoint.transactionId}:${i.previousOutpoint.index}`, sigLen: i.signatureScript.length / 2, budget: i.computeBudget })), outputs: outs };
  const covOuts = outs.filter((o) => o.covenantId);
  const isLast = BigInt(s.amount) === BigInt(s.pool);
  const selfOut = isLast ? null : outs[0], claimOut = outs[isLast ? 0 : 1];
  const selfCov = selfOut?.covenantId;   // partial: self 续约 cov == 输入 self cov; last: 取 claim 的 market_cov_id 不可从链读, 由调用方给 winner/… 此处仅 partial 校验 remain
  const tokArt = art.computeKttTokenArtifact({ amount: Number(s.amount), ownerCovIdHex: claimOut.covenantId });
  rec.tokOutUtxos = await utxos(addrOf(tokArt.script));
  if (!isLast) { const remainArt = art.computeKttTokenArtifact({ amount: Number(BigInt(s.pool) - BigInt(s.amount)), ownerCovIdHex: selfCov }); rec.remainTokenUtxos = await utxos(addrOf(remainArt.script)); }
  rec.isLast = isLast; rec.claimCovId = claimOut.covenantId; rec.selfCovId = selfCov ?? null;
  out[s.txid] = rec;
  console.log(s.txid.slice(0, 12), JSON.stringify({ isLast, daa: rec.daa, outputs: outs, tokOutUtxos: rec.tokOutUtxos, remainTokenUtxos: rec.remainTokenUtxos }));
}
writeFileSync('seg4_post.json', JSON.stringify(out, null, 1)); process.exit(0);
