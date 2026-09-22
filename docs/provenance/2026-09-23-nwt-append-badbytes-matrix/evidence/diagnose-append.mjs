// diagnose-append.mjs — 账本1647(Bettor 转 Codex 111fd572)矩阵深挖: 对指定 bet 的 append 意图,
// 用【与生产 buildRegisterAppendAndBroadcast 完全同一批】只读派生函数(deriveLeafState/deriveLeafOutpoint/
// deriveHeldKttOutpoint/computeShardLeafRedeemScript/computeKttGenesisArtifact/loadProtocolConstants/
// compileSilV100),独立算出全部诊断字段 + 对节点做活查询(leaf/held outpoint 现在是否还在 UTXO 集里)。
// 只读, 不碰任何写路径, 不重新构造广播。
// 用法: node diagnose-append.mjs <marketId> <betId> <label>
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const RUN = 'D:/kanet-tn12/scratch/_nwt_append_badbytes_matrix';
const WT = 'D:/kanet-tn12/scratch/_nwt_wt_f1adv_review';
for (const line of fs.readFileSync(`${RUN}/kanet.simnet.env`, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (process.env.KASPA_NETWORK !== 'simnet' || !process.env.DB_PATH.includes('_nwt_append_badbytes_matrix')) { console.error('REFUSE: 不是隔离 simnet 配置'); process.exit(2); }
const state = JSON.parse(fs.readFileSync(`${RUN}/state.json`, 'utf8'));
const lib = (rel) => import(pathToFileURL(`${WT}/kasia-console/src/${rel}`).href);
const kaspa = createRequire(`${WT}/kasia-relay/`)('kaspa-wasm');
const { RpcClient, Encoding, Address } = kaspa;
const [marketId, betId, label] = process.argv.slice(2);
if (!marketId || !betId) { console.error('用法: node diagnose-append.mjs <marketId> <betId> <label>'); process.exit(2); }

const lc = (h) => String(h ?? '').replace(/^0x/i, '').toLowerCase();
const rpc = new RpcClient({ url: state.rpc, encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
if ((await rpc.getServerInfo()).networkId !== 'simnet') { console.error('REFUSE: networkId != simnet'); process.exit(3); }

const { sqlite } = await lib('db/client.js');
const { deriveLeafState, deriveLeafOutpoint, deriveHeldKttOutpoint } = await lib('lib/proto-leaf-state.mjs');
const { computeShardLeafRedeemScript, computeKttGenesisArtifact, loadProtocolConstants } = await lib('lib/proto-covenant-builder.mjs');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await lib('lib/pool-bshard-artifacts.mjs');

const scriptPublicKeyFromHexMod = await lib('lib/proto-tx-assembly.mjs');
const { scriptPublicKeyFromHex } = scriptPublicKeyFromHexMod;

// ── ①market/②seal 意图 ──
const m = sqlite.prepare('SELECT id,status,seal_count,shardleaf_cov_id,shardleaf_txid,shardleaf_vout,rootclose_txid,winning_side,min_bet,rootclose_tmpl_hash,shardleaf_own_redeem_len FROM proto_markets WHERE id=?').get(marketId);
const sealIntents = sqlite.prepare("SELECT step,status,prepared_txid,submitted_txid,landed_depth,created_at,updated_at FROM proto_settlement_intents WHERE subject_type='market' AND subject_id=?").all(marketId);
const betIntent = sqlite.prepare("SELECT bi.intent_key,bi.step,bi.status,bi.prepared_txid,bi.submitted_txid,bi.last_error,bi.prepared_tx_json,bi.created_at,bi.updated_at FROM proto_bet_intents bi WHERE bi.bet_id=?").get(betId);
const bet = sqlite.prepare('SELECT id,side,stake,status FROM proto_bets WHERE id=?').get(betId);
const allBets = sqlite.prepare('SELECT id,side,stake,status,created_at FROM proto_bets WHERE market_id=? ORDER BY created_at').all(marketId);

// ── ③currentState(deriveLeafState 用的是"已确认下注"的求和, 即 build 这笔 append 时刻的"旧状态") ──
let currentState = null, leafOutpoint = null, heldOutpointRaw = null, leafStateErr = null;
try { currentState = deriveLeafState(marketId); } catch (e) { leafStateErr = e.message; }
try { leafOutpoint = deriveLeafOutpoint(marketId); } catch (e) { leafStateErr = (leafStateErr ? leafStateErr + ' | ' : '') + 'leafOutpoint: ' + e.message; }
try { heldOutpointRaw = deriveHeldKttOutpoint(marketId); } catch (e) { leafStateErr = (leafStateErr ? leafStateErr + ' | ' : '') + 'heldOutpoint: ' + e.message; }

// ── ④leaf/held 现在节点侧是否还在 UTXO 集里(活查询,不是猜)──
async function nodeUtxoCheck(outpoint, label2) {
  if (!outpoint) return { present: null, note: 'outpoint 派生失败或不存在(比如首笔下注没有 held)' };
  // 用 get_utxos_by_addresses 反查不方便(不知道地址), 直接用 getUtxosByAddresses 配合我们能算出的地址;
  // 更直接: 用 rpc.getUtxosByAddresses 需要地址, 但我们有 txid/vout, 改用 rpc 的 mempool/UTXO 索引查询——
  // kaspa-wasm 没有直接"按 outpoint 查是否存在"的 RPC, 用 getUtxosByAddresses(leaf/held 各自地址) 后按 outpoint 过滤。
  return null; // 占位, 实际在下面按 leaf/held 分别算地址后调用
}

let leafAddress = null, leafUtxos = [], leafPresent = null;
let heldAddress = null, heldUtxos = [], heldPresent = null;
try {
  const leafRedeem = computeShardLeafRedeemScript({ marketId, minBet: m.min_bet, sealCount: m.seal_count, rootcloseTmplHash: lc(m.rootclose_tmpl_hash), state: currentState, ownRedeemLen: m.shardleaf_own_redeem_len });
  const leafSpk = scriptPublicKeyFromHex(kaspa, leafRedeem.scriptPubKeyHex);
  leafAddress = kaspa.addressFromScriptPublicKey(leafSpk, 'simnet').toString();
  leafUtxos = (await rpc.getUtxosByAddresses([new Address(leafAddress)])).entries || [];
  if (leafOutpoint) leafPresent = leafUtxos.some((e) => String(e.outpoint.transactionId) === lc(leafOutpoint.txid) && Number(e.outpoint.index) === Number(leafOutpoint.vout));
} catch (e) { leafStateErr = (leafStateErr ? leafStateErr + ' | ' : '') + 'leafAddress/utxo: ' + e.message; }
try {
  if (heldOutpointRaw) {
    const heldArtifact = computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: lc(m.shardleaf_cov_id) });
    const heldSpk = scriptPublicKeyFromHex(kaspa, heldArtifact.scriptPubKeyHex);
    heldAddress = kaspa.addressFromScriptPublicKey(heldSpk, 'simnet').toString();
    heldUtxos = (await rpc.getUtxosByAddresses([new Address(heldAddress)])).entries || [];
    heldPresent = heldUtxos.some((e) => String(e.outpoint.transactionId) === lc(heldOutpointRaw.txid) && Number(e.outpoint.index) === Number(heldOutpointRaw.vout));
  }
} catch (e) { leafStateErr = (leafStateErr ? leafStateErr + ' | ' : '') + 'heldAddress/utxo: ' + e.message; }

// ── ⑤covenant 入口参数(与生产 buildRegisterAppendAndBroadcast 逐字同一份计算) ──
let entryAbi = null, sldCtorDump = null;
try {
  const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
  const sldCtor = [
    ctorBytes32V100(marketId), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(m.seal_count), ctorIntV100(m.min_bet), ctorBytes32V100(lc(m.rootclose_tmpl_hash)), ctorBytes32V100('00'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(currentState.local_yes), ctorIntV100(currentState.local_no), ctorIntV100(currentState.count), ctorIntV100(currentState.pool_value),
    ctorIntV100(m.shardleaf_own_redeem_len),
  ];
  sldCtorDump = { seal_count: m.seal_count, min_bet: m.min_bet, local_yes: currentState.local_yes, local_no: currentState.local_no, count: currentState.count, pool_value: currentState.pool_value, own_redeem_len: m.shardleaf_own_redeem_len };
  const sldCompiled = compileSilV100(`${WT}/kasia-console/src/lib/ShardLeaf_direct.sil`, sldCtor, 'ShardLeaf_direct');
  entryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;
} catch (e) { leafStateErr = (leafStateErr ? leafStateErr + ' | ' : '') + 'entryAbi: ' + e.message; }

// ── ⑥⑦prepared_tx_json 反序列化(sighash 材料 + 最终交易) ──
let txDump = null;
if (betIntent?.prepared_tx_json) {
  try {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(JSON.parse(betIntent.prepared_tx_json)[0]);
    txDump = {
      txid: tx.id,
      inputs: tx.inputs.map((inp, idx) => ({ idx, prevTxid: String(inp.previousOutpoint.transactionId), prevIndex: Number(inp.previousOutpoint.index), sigScriptLen: String(inp.signatureScript || '').length / 2, sigOpCount: inp.sigOpCount })),
      outputs: tx.outputs.map((o, idx) => ({ idx, value: String(o.value), spkLen: String(o.scriptPublicKey.script).length / 2, hasCovenant: !!o.covenant, covenantId: o.covenant ? String(o.covenant.covenantId) : null })),
      lockTime: String(tx.lockTime),
    };
  } catch (e) { leafStateErr = (leafStateErr ? leafStateErr + ' | ' : '') + 'txDump: ' + e.message; }
}

const out = {
  label, marketId, betId,
  market: m, allBets, targetBet: bet, sealIntents, betIntent: betIntent ? { ...betIntent, prepared_tx_json: undefined } : null,
  currentStateAtBuildTime: currentState, leafOutpoint, heldOutpointRaw, leafStateErr,
  leafAddress, leafUtxoCount: leafUtxos.length, leafOutpointStillUnspent: leafPresent,
  heldAddress, heldUtxoCount: heldUtxos.length, heldOutpointStillUnspent: heldPresent,
  entryAbiArgs: sldCtorDump, entryAbiEntryFound: !!entryAbi,
  txDump,
};
fs.mkdirSync(`${RUN}/evidence`, { recursive: true });
fs.writeFileSync(`${RUN}/evidence/diagnose-${label}-${betId.slice(0, 8)}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await rpc.disconnect().catch(() => {});
process.exit(0);
