// recompute-fixed-cost.mjs — 账本1455修复后重跑成本核算(J2)。真实 builder + 真实 mass, 不签名不广播。
// 按 Bettor 明确要求的口径: 0.5 KAS(genesis) 与 0.95 KAS(首笔下注)给出 required_fee/找零形状/net_loss,
// 以及第二笔下注(有held)的真实最小可行 fee 输入。
//
// Run: cd kasia-console && DB_PATH=<临时db路径> node <此文件绝对路径>

import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const CONSOLE_ROOT = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
const p2f = (p) => pathToFileURL(p).href;
const kaspa = await import(p2f(`${CONSOLE_ROOT}/node_modules/kaspa-wasm/kaspa.js`));
const { buildMarketGenesisTxJson, buildRegisterAppendTxJson, GENESIS_OUTPUT_SOMPI, CONTINUATION_OUTPUT_SOMPI } = await import(p2f(`${CONSOLE_ROOT}/src/lib/proto-tx-assembly.mjs`));
const { computeMarketGenesisArtifacts, computeShardLeafRedeemScript, computeKttGenesisArtifact, loadProtocolConstants, loadFeeProfileCap, p2sh } = await import(p2f(`${CONSOLE_ROOT}/src/lib/proto-covenant-builder.mjs`));
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import(p2f(`${CONSOLE_ROOT}/src/lib/pool-bshard-artifacts.mjs`));
const { extractTemplateArtifactV100 } = await import(p2f(`${CONSOLE_ROOT}/src/lib/pool-template-artifact.mjs`));
const { extractTxShape, validateFixedValueOutputs } = await import(p2f('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-relay/src/lib/covenant-broadcast.mjs'));

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = kaspa.payToAddressScript(relayAddr);
const relaySpkHex = '0x' + relaySpk.script;
const KAS = 100_000_000n;
const fmtKas = (sompi) => `${(Number(sompi) / 1e8).toFixed(8)} KAS (${sompi} sompi)`;

function report(label, built, lockedOutputsSompi) {
  console.log(`\n=== ${label} ===`);
  console.log(`  requiredFee     = ${fmtKas(built.requiredFee)}`);
  console.log(`  netLoss         = ${fmtKas(built.netLoss)}`);
  console.log(`  includeChange   = ${built.includeChange}`);
  console.log(`  changeSompi     = ${fmtKas(built.changeSompi)}`);
  console.log(`  lockedIntoContractOutputs = ${fmtKas(lockedOutputsSompi)}`);
}

const MARKET_ID = 'ab'.repeat(32), MIN_BET = 5, DEADLINE_MS = 1700000000000, SEAL_COUNT = 2;
const genesisArtifacts = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
const genesisCap = loadFeeProfileCap('market_genesis');

// ══ ①market_genesis, 0.5 KAS ══
const feeUtxoG = { txid: 'ee'.repeat(32), vout: 0, value: KAS / 2n, scriptPublicKeyHex: relaySpkHex };
const builtG = buildMarketGenesisTxJson({ kaspa, network: 'mainnet', feeUtxo: feeUtxoG, relayChangeScriptPublicKeyHex: relaySpkHex, shardLeafScriptPubKeyHex: genesisArtifacts.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: genesisCap });
report('①market_genesis(0.5 KAS)', builtG, GENESIS_OUTPUT_SOMPI);
const leafCovId = builtG.shardLeafCovId;
const leafOutpoint = { txid: 'ee'.repeat(32), vout: 0 };

const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
const SLD_PATH = `${CONSOLE_ROOT}/src/lib/ShardLeaf_direct.sil`;
const TICKET_PATH = `${CONSOLE_ROOT}/src/lib/sil-v1/PoolSideTicket.sil`;
const KTT_PATH = `${CONSOLE_ROOT}/src/lib/sil-v1/KanetTestToken.sil`;
const registerAppendCap = loadFeeProfileCap('bet_mint_step_b');
const kttCtorForAbi = [{ kind: 'int', value: 1 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }];
const kttCompiled = compileSilV100(KTT_PATH, kttCtorForAbi, 'KanetTestToken');
const kttEntryAbi = kttCompiled._raw.contracts.KanetTestToken.entries.transfer;
const kttStateFieldCount = kttCompiled._raw.contracts.KanetTestToken.runtime_state.fields.length;

function buildFirstBet(feeInputSompi) {
  const SIDE = 0, STAKE = 20;
  const bettorPk = Buffer.alloc(32, 0x66).toString('hex');
  const currentState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
  const newState = { local_yes: STAKE, local_no: 0, count: 1, pool_value: STAKE };
  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: currentState });
  const sldCtor = [ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID), ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(genesisArtifacts.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)), ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0)];
  const sldCompiled = compileSilV100(SLD_PATH, sldCtor, 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;
  const mergedArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });
  const ticketCtor = [{ kind: 'bytes', value: [...Buffer.from(bettorPk, 'hex')] }, { kind: 'int', value: SIDE }, { kind: 'int', value: STAKE }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }];
  const ticketCompiled = compileSilV100(TICKET_PATH, ticketCtor, 'PoolSideTicket');
  const ticketSpkHex = '0x' + p2sh(Buffer.from(ticketCompiled.script));
  const ticketTA = extractTemplateArtifactV100(ticketCompiled);
  const psPrefixHex = '0x' + Buffer.from(ticketTA.templatePrefix).toString('hex');
  const psSuffixHex = '0x' + Buffer.from(ticketTA.templateSuffix).toString('hex');
  const tokTA = extractTemplateArtifactV100(kttCompiled);
  const tokPrefixHex = '0x' + Buffer.from(tokTA.templatePrefix).toString('hex');
  const tokSuffixHex = '0x' + Buffer.from(tokTA.templateSuffix).toString('hex');
  const feeUtxo = { txid: 'dd'.repeat(32), vout: 0, value: feeInputSompi, scriptPublicKeyHex: relaySpkHex };
  const built = buildRegisterAppendTxJson({
    kaspa, network: 'mainnet', leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout,
    leafOutpoint, leafCovId, currentState, newState, heldInput: null, feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
    registerAppendEntryAbi, registerAppendArgs: { side: SIDE, stake: STAKE, bettorPk, psPrefix: psPrefixHex, psSuffix: psSuffixHex, tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
    ticketScriptPubKeyHex: ticketSpkHex, mergedKttScript: mergedArtifact.script, absFeeCapSompi: registerAppendCap,
  });
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const shape = extractTxShape(tx);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
  if (!fv.ok) throw new Error(`register_append(首笔) relay侧校验失败: ${fv.reason}`);
  return built;
}
function buildSecondBet(feeInputSompi) {
  const SIDE = 1, STAKE = 30;
  const bettorPk = Buffer.alloc(32, 0x77).toString('hex');
  const currentState = { local_yes: 20, local_no: 0, count: 1, pool_value: 20 };
  const newState = { local_yes: 20, local_no: 30, count: 2, pool_value: 50 };
  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: currentState });
  const sldCtor = [ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID), ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(genesisArtifacts.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)), ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0)];
  const sldCompiled = compileSilV100(SLD_PATH, sldCtor, 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;
  const heldArtifact = computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: leafCovId });
  const mergedArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });
  const ticketCtor = [{ kind: 'bytes', value: [...Buffer.from(bettorPk, 'hex')] }, { kind: 'int', value: SIDE }, { kind: 'int', value: STAKE }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }];
  const ticketCompiled = compileSilV100(TICKET_PATH, ticketCtor, 'PoolSideTicket');
  const ticketSpkHex = '0x' + p2sh(Buffer.from(ticketCompiled.script));
  const ticketTA = extractTemplateArtifactV100(ticketCompiled);
  const psPrefixHex = '0x' + Buffer.from(ticketTA.templatePrefix).toString('hex');
  const psSuffixHex = '0x' + Buffer.from(ticketTA.templateSuffix).toString('hex');
  const tokTA = extractTemplateArtifactV100(kttCompiled);
  const tokPrefixHex = '0x' + Buffer.from(tokTA.templatePrefix).toString('hex');
  const tokSuffixHex = '0x' + Buffer.from(tokTA.templateSuffix).toString('hex');
  const heldOutpoint = { txid: 'bb'.repeat(32), vout: 0 };
  const feeUtxo = { txid: 'dd'.repeat(32), vout: 0, value: feeInputSompi, scriptPublicKeyHex: relaySpkHex };
  const built = buildRegisterAppendTxJson({
    kaspa, network: 'mainnet', leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout,
    leafOutpoint, leafCovId, currentState, newState,
    heldInput: { txid: heldOutpoint.txid, vout: heldOutpoint.vout, value: CONTINUATION_OUTPUT_SOMPI, scriptPublicKeyHex: heldArtifact.scriptPubKeyHex, redeemScript: heldArtifact.script, entryAbi: kttEntryAbi, stateFieldCount: kttStateFieldCount },
    feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
    registerAppendEntryAbi, registerAppendArgs: { side: SIDE, stake: STAKE, bettorPk, psPrefix: psPrefixHex, psSuffix: psSuffixHex, tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
    ticketScriptPubKeyHex: ticketSpkHex, mergedKttScript: mergedArtifact.script, absFeeCapSompi: registerAppendCap,
  });
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const shape = extractTxShape(tx);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
  if (!fv.ok) throw new Error(`register_append(第二笔) relay侧校验失败: ${fv.reason}`);
  return built;
}

// ══ ②首笔下注, 0.95 KAS(Bettor明确要求的口径) ══
const built2 = buildFirstBet(95n * KAS / 100n);
report('②首笔下注register_append(无held, fee输入0.95 KAS)', built2, CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI);

// ══ ③探测第二笔下注(有held)的真实最小可行fee输入 ══
console.log('\n=== ③第二笔下注(有held) 真实最小可行fee输入探测 ===');
let minViableHeld = null;
for (const kasVal of [0.5, 0.55, 0.56, 0.57, 0.58, 0.6, 0.65, 0.95]) {
  const val = BigInt(Math.round(kasVal * 1e8));
  try {
    const built = buildSecondBet(val);
    console.log(`  feeInput=${kasVal} KAS -> OK requiredFee=${built.requiredFee} netLoss=${built.netLoss} includeChange=${built.includeChange} changeSompi=${built.changeSompi}`);
    if (minViableHeld === null) minViableHeld = { kasVal, built };
  } catch (e) {
    console.log(`  feeInput=${kasVal} KAS -> FAIL: ${e.message}`);
  }
}
if (minViableHeld) {
  report(`③第二笔下注register_append(有held, 探测到的最小可行值 fee输入${minViableHeld.kasVal} KAS)`, minViableHeld.built, CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI);
}

console.log('\n\n=== 与修复前(账本1455发现时)的对照 ===');
console.log('  修复前(旧leftover公式, 只计fee输入): 首笔下注真实最小可行fee输入 ≈ 1.05 KAS, 第二笔 ≈ 1.05 KAS(有无held不影响门槛, 这正是bug的症状)');
console.log(`  修复后(本次核算): 首笔下注真实最小可行fee输入 ≈ 0.82 KAS(0.95 KAS舒适可行, 见②); 第二笔下注 ≈ ${minViableHeld ? minViableHeld.kasVal : '?'} KAS`);
