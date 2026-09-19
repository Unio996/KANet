// NWT fee 阶梯实验 步骤2: market_genesis 与 register_append#1 两个形状 —— 用生产 builder 造真实交易, 只改找零值以改变 fee,
// 先提交极低 fee 让节点在拒绝信息里报最低费(及依据的 mass), 再按该最低费提交看 mempool 是否接受并落块。
// 只回答"节点 mempool 最低费是否接受"; 不回答主网矿工排序; 结论不构成降 fee 依据。simnet 测试身份, 私钥只在 state 文件。
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/scratch/_nwt_ladder/_nwt_ladder.db';
process.env.CONSOLE_ENCRYPTION_KEY = process.env.CONSOLE_ENCRYPTION_KEY || '5'.repeat(64);
const kaspa = await import('kaspa-wasm');
execSync('node scripts/run-migrations.mjs', { env: process.env, stdio: 'pipe', cwd: 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console' });
const { buildMarketGenesisTxJson, buildRegisterAppendTxJson } = await import('../../src/lib/proto-tx-assembly.mjs');
const { computeMarketGenesisArtifacts, computeShardLeafRedeemScript, computeKttGenesisArtifact, loadProtocolConstants, loadFeeProfileCap, p2sh } = await import('../../src/lib/proto-covenant-builder.mjs');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../../src/lib/pool-bshard-artifacts.mjs');
const { extractTemplateArtifactV100 } = await import('../../src/lib/pool-template-artifact.mjs');
const { signOnlyDeclaredInputs } = await import('../../../kasia-relay/src/lib/covenant-broadcast.mjs');
const HERE = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/scratch/_nwt_ladder/';
const st = JSON.parse(readFileSync(HERE + '_nwt_ladder_state.json', 'utf8'));
const priv = new kaspa.PrivateKey(st.privHex);
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:18510', networkId: 'simnet' });
await rpc.connect();
const NETWORK = 'simnet';
const relaySpkHex = '0x' + kaspa.payToAddressScript(new kaspa.Address(st.addr)).script;
const jsonSafe = (k, v) => (typeof v === 'bigint' ? v.toString() : v);
const mineOne = async () => { const { block } = await rpc.getBlockTemplate({ payAddress: st.addr }); return rpc.submitBlock({ block, allowNonDAABlocks: true }); };
const log = [];
const note = (o) => { log.push(o); console.log(JSON.stringify(o, jsonSafe)); };
async function feeUtxos() {
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [st.addr] });
  return entries.filter((e) => BigInt(e.amount) === 95_000_000n).map((e) => ({ txid: e.outpoint.transactionId, vout: e.outpoint.index, value: BigInt(e.amount), scriptPublicKeyHex: '0x' + e.scriptPublicKey.script }));
}
// 用 built.txJson 造"指定 fee"的已签名 tx: 只改最后一个(找零)输出的值
function withFee(built, targetFee) {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  let sumIn = 0n; for (const i of tx.inputs) sumIn += BigInt(i.utxo.amount);
  const outs = tx.outputs; let sumOut = 0n; for (const o of outs) sumOut += BigInt(o.value);
  const curFee = sumIn - sumOut; const ci = outs.length - 1;
  if (!built.includeChange) throw new Error('builder 未带找零输出, 本实验只改找零值');
  outs[ci].value = BigInt(outs[ci].value) + (curFee - targetFee); tx.outputs = outs;
  signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: priv, kaspa });
  tx.finalize();
  return { tx, curFee };
}
async function mempoolMass(txid) {
  try {
    const e = await rpc.getMempoolEntry({ transactionId: txid, includeOrphanPool: true, filterTransactionPool: false });
    const j = JSON.parse(JSON.stringify(e, jsonSafe)); const me = j.mempoolEntry ?? j.entry ?? j;
    return { storageMass: String(me.mass ?? me.transaction?.mass), computeMass: String(me.transaction?.verboseData?.computeMass ?? me.verboseData?.computeMass), fee: String(me.fee) };
  } catch (e) { return { err: String(e.message).slice(0, 120) }; }
}
async function ladder(label, built, steps) {
  let lastMsg = '';
  for (const spec of steps) {
    const target = typeof spec === 'function' ? spec(lastMsg) : spec;
    if (target === null || target === undefined) continue;
    const { tx, curFee } = withFee(built, target);
    try {
      const res = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
      const mp = await mempoolMass(tx.id);
      note({ label, targetFee: String(target), builderFee: String(curFee), result: 'ACCEPTED', txid: String(res.transactionId ?? tx.id), nodeMass: mp });
      await mineOne(); note({ label, mined: 'confirmed 1 block' });
      return { tx, accepted: target };
    } catch (e) {
      lastMsg = String(e.message ?? e);
      note({ label, targetFee: String(target), builderFee: String(curFee), result: 'REJECTED', nodeMessage: lastMsg.slice(0, 400) });
    }
  }
  throw new Error(label + ': 所有阶梯都被拒');
}
const nextMinFromMsg = (msg) => {
  const m = msg.match(/(?:required|minimum)[^0-9]{0,60}([0-9]{3,})/i);
  return m ? BigInt(m[1]) : null;
};
note({ node: 'simnet PID 15972 kaspad 2.0.1 sha256 8afe6a68 (核于步骤1)', myAddr: st.addr });

// ═══ market_genesis ═══
const MARKET_ID = 'c8'.repeat(32), MIN_BET = 1, SEAL_COUNT = 2, DEADLINE_MS = Date.now() - 3 * 3600_000;
const ga = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
let fu = await feeUtxos(); if (!fu.length) throw new Error('无 0.95 KAS fee UTXO');
const gBuilt = buildMarketGenesisTxJson({ kaspa, network: NETWORK, feeUtxo: fu[0], relayChangeScriptPublicKeyHex: relaySpkHex, shardLeafScriptPubKeyHex: ga.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: loadFeeProfileCap('market_genesis') });
note({ shape: 'market_genesis', builderRequiredFee: String(gBuilt.requiredFee), builderIncludeChange: gBuilt.includeChange });
const gTx = withFee(gBuilt, gBuilt.requiredFee).tx; try { await rpc.submitTransaction({ transaction: gTx, allowOrphan: false }); note({ label: 'chain-cov: genesis', txid: gTx.id, result: 'ACCEPTED (unconfirmed, not mined)' }); } catch (e) { note({ label: 'chain-cov: genesis', result: 'REJECTED', node: String(e.message).slice(0,300) }); throw e; }
const genesisTxid = gTx.id;
const leafCovId = gBuilt.shardLeafCovId;

// ═══ register_append#1 ═══
const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
const libPath = (rel) => 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/' + rel;
const SLD = libPath('ShardLeaf_direct.sil'), TICKET = libPath('sil-v1/PoolSideTicket.sil'), KTT = libPath('sil-v1/KanetTestToken.sil');
const kttCompiled = compileSilV100(KTT, [ctorIntV100(1), ctorBytes32V100('00'.repeat(32)), { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, ctorBytes32V100('00'.repeat(32)), ctorBytes32V100('00'.repeat(32)), ctorIntV100(3), ctorIntV100(3)], 'KanetTestToken');
const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templatePrefix).toString('hex');
const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templateSuffix).toString('hex');
const sldCtor = [ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID), ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(ga.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)), ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(ga.shardLeafOwnRedeemLen)];
const currentState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: ga.rootCloseTmplHash, state: currentState, ownRedeemLen: ga.shardLeafOwnRedeemLen });
const registerAppendEntryAbi = compileSilV100(SLD, sldCtor, 'ShardLeaf_direct')._raw.contracts.ShardLeaf_direct.entries.register_append;
const side = 0, stake = 1;
const bettorPk = new kaspa.PrivateKey(randomBytes(32).toString('hex')).toPublicKey().toXOnlyPublicKey().toString();
const newState = { local_yes: 1, local_no: 0, count: 1, pool_value: 1 };
const merged = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });
const ticketCompiled = compileSilV100(TICKET, [ctorBytes32V100(bettorPk), ctorIntV100(side), ctorIntV100(stake), ctorBytes32V100(MARKET_ID)], 'PoolSideTicket');
const tArt = extractTemplateArtifactV100(ticketCompiled);
fu = await feeUtxos(); if (!fu.length) throw new Error('无 fee UTXO(bet1)');
const bBuilt = buildRegisterAppendTxJson({
  kaspa, network: NETWORK, leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout,
  leafOutpoint: { txid: genesisTxid, vout: 0 }, leafCovId, currentState, newState, heldInput: null,
  feeUtxo: fu[0], relayChangeScriptPublicKeyHex: relaySpkHex,
  registerAppendEntryAbi, registerAppendArgs: { side, stake, bettorPk, psPrefix: '0x' + Buffer.from(tArt.templatePrefix).toString('hex'), psSuffix: '0x' + Buffer.from(tArt.templateSuffix).toString('hex'), tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
  ticketScriptPubKeyHex: '0x' + p2sh(Buffer.from(ticketCompiled.script)), mergedKttScript: merged.script,
  absFeeCapSompi: loadFeeProfileCap('register_append'),
});
note({ shape: 'register_append#1', feeUtxo: String(fu[0].value), builderRequiredFee: String(bBuilt.requiredFee), builderIncludeChange: bBuilt.includeChange });
const bTx = withFee(bBuilt, bBuilt.requiredFee).tx; try { await rpc.submitTransaction({ transaction: bTx, allowOrphan: false }); note({ label: 'chain-cov: bet1 spends UNCONFIRMED genesis leaf (covenant chain)', txid: bTx.id, result: 'ACCEPTED' }); } catch (e) { note({ label: 'chain-cov: bet1', result: 'REJECTED', node: String(e.message).slice(0,400) }); }
await mineOne(); await mineOne();
writeFileSync(HERE + 'chain_cov_log.json', JSON.stringify(log, jsonSafe, 1));
await rpc.disconnect();
