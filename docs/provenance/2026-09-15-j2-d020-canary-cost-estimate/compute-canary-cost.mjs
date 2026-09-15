// compute-canary-cost.mjs — 金丝雀执行页 §5 成本数字真实核算(账本1454, J2)。
// 纯离线计算: 真实 builder(buildMarketGenesisTxJson / buildRegisterAppendTxJson) + 真实
// kaspa.calculateTransactionMass, 不签名、不广播、不碰 DB/网络。构造出的三个场景与真实
// buildXxxAndBroadcast 生产代码路径完全同源(同一批函数), 只是没有走 relay IPC 那一步。
//
// 三个场景:
//   ① market_genesis, 种子输入 0.5 KAS
//   ② 首笔下注 register_append(无 held), fee 输入分别按 0.5 KAS 与 0.95 KAS 各算一次
//   ③ 第二笔下注 register_append(有 held), fee 输入 0.95 KAS
//
// 每个场景报告: requiredFee(真实mass×SOMPI_PER_MASS)、锁进合约的输出值合计(本笔交易里所有
// covenant 声明输出的面值之和)、netLoss(=Σ签名输入 − 回到relay自己的找零)、选中的找零形状。
//
// D-021 合规: 只用协议常量/测试面值(0.5/0.95/1.95 KAS 都是本次核算假设的种子面值, 不是任何真实
// 账户余额), 不写密钥/真实持仓。
//
// Run: node compute-canary-cost.mjs  (cwd 任意, 内部用绝对路径 import)

import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const CONSOLE_ROOT = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const p2f = (p) => pathToFileURL(p).href;
const kaspa = await import(p2f(`${CONSOLE_ROOT}/node_modules/kaspa-wasm/kaspa.js`));
const {
  buildMarketGenesisTxJson, buildRegisterAppendTxJson, GENESIS_OUTPUT_SOMPI, CONTINUATION_OUTPUT_SOMPI,
} = await import(p2f(`${CONSOLE_ROOT}/src/lib/proto-tx-assembly.mjs`));
const {
  computeMarketGenesisArtifacts, computeShardLeafRedeemScript, computeKttGenesisArtifact, computeTicketGenesisArtifact,
  loadProtocolConstants, loadFeeProfileCap, p2sh,
} = await import(p2f(`${CONSOLE_ROOT}/src/lib/proto-covenant-builder.mjs`));
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import(p2f(`${CONSOLE_ROOT}/src/lib/pool-bshard-artifacts.mjs`));
const { extractTemplateArtifactV100 } = await import(p2f(`${CONSOLE_ROOT}/src/lib/pool-template-artifact.mjs`));
const { extractTxShape, validateFixedValueOutputs } = await import(p2f('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-relay/src/lib/covenant-broadcast.mjs'));

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = kaspa.payToAddressScript(relayAddr);
const relaySpkHex = '0x' + relaySpk.script;

const KAS = 100_000_000n; // 1 KAS = 100,000,000 sompi
const fmtKas = (sompi) => `${(Number(sompi) / 1e8).toFixed(8)} KAS (${sompi} sompi)`;

function report(label, built, lockedOutputsSompi) {
  console.log(`\n=== ${label} ===`);
  console.log(`  requiredFee     = ${fmtKas(built.requiredFee)}`);
  console.log(`  netLoss         = ${fmtKas(built.netLoss)}`);
  console.log(`  includeChange   = ${built.includeChange}`);
  console.log(`  changeSompi     = ${fmtKas(built.changeSompi)}`);
  console.log(`  lockedIntoContractOutputs = ${fmtKas(lockedOutputsSompi)}`);
  return { label, requiredFee: built.requiredFee, netLoss: built.netLoss, includeChange: built.includeChange, changeSompi: built.changeSompi, lockedIntoContractOutputs: lockedOutputsSompi };
}

const results = [];

// ══════════════════════ ① market_genesis, 种子输入 0.5 KAS ══════════════════════
const MARKET_ID = 'ab'.repeat(32), MIN_BET = 5, DEADLINE_MS = 1700000000000, SEAL_COUNT = 2;
const genesisArtifacts = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
const genesisCap = loadFeeProfileCap('market_genesis');
{
  const feeUtxo = { txid: 'ee'.repeat(32), vout: 0, value: KAS / 2n, scriptPublicKeyHex: relaySpkHex }; // 0.5 KAS
  const built = buildMarketGenesisTxJson({
    kaspa, network: 'mainnet', feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
    shardLeafScriptPubKeyHex: genesisArtifacts.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: genesisCap,
  });
  // 校验: relay 真代码也认这笔交易(不是只有 console 自己觉得对)
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const shape = extractTxShape(tx);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
  if (!fv.ok) throw new Error(`①market_genesis relay侧校验失败: ${fv.reason}`);
  results.push(report('①market_genesis(种子0.5 KAS)', built, GENESIS_OUTPUT_SOMPI));
}
const leafCovId = (() => {
  // 用与①同一个 feeUtxo/构造重算一次, 只取 covId(独立于找零值, 见 proto-tx-assembly.mjs 注释)。
  const feeUtxo = { txid: 'ee'.repeat(32), vout: 0, value: KAS / 2n, scriptPublicKeyHex: relaySpkHex };
  const built = buildMarketGenesisTxJson({
    kaspa, network: 'mainnet', feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
    shardLeafScriptPubKeyHex: genesisArtifacts.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: genesisCap,
  });
  return built.shardLeafCovId;
})();
const leafOutpoint = { txid: 'ee'.repeat(32), vout: 0 }; // 占位: 只用于ctor/redeem脚本构造, 不影响mass/fee计算

const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
function compileEntryAbi(silPath, ctor, contractName) { return compileSilV100(silPath, ctor, contractName); }
const SLD_PATH = `${CONSOLE_ROOT}/src/lib/ShardLeaf_direct.sil`;
const TICKET_PATH = `${CONSOLE_ROOT}/src/lib/sil-v1/PoolSideTicket.sil`;
const KTT_PATH = `${CONSOLE_ROOT}/src/lib/sil-v1/KanetTestToken.sil`;
const registerAppendCap = loadFeeProfileCap('bet_mint_step_b');

// 唯一编一次 KTT(纯为拿 entries.transfer 的 entryAbi + runtime_state 字段数, 结构性质不依赖 owner 值)。
const kttCtorForAbi = [{ kind: 'int', value: 1 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'bytes', value: [...Buffer.alloc(32)] }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }];
const kttCompiled = compileEntryAbi(KTT_PATH, kttCtorForAbi, 'KanetTestToken');
const kttEntryAbi = kttCompiled._raw.contracts.KanetTestToken.entries.transfer;
const kttStateFieldCount = kttCompiled._raw.contracts.KanetTestToken.runtime_state.fields.length;

function buildFirstBetRegisterAppend(feeInputSompi) {
  const SIDE = 0, STAKE = 20;
  const bettorPk = Buffer.alloc(32, 0x66).toString('hex');
  const currentState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
  const newState = { local_yes: SIDE === 0 ? STAKE : 0, local_no: SIDE === 1 ? STAKE : 0, count: 1, pool_value: STAKE };
  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: currentState });
  const sldCtor = [
    ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(genesisArtifacts.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
  const sldCompiled = compileEntryAbi(SLD_PATH, sldCtor, 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;
  const mergedArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });
  const ticketCtor = [{ kind: 'bytes', value: [...Buffer.from(bettorPk, 'hex')] }, { kind: 'int', value: SIDE }, { kind: 'int', value: STAKE }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }];
  const ticketCompiled = compileEntryAbi(TICKET_PATH, ticketCtor, 'PoolSideTicket');
  const ticketSpkHex = '0x' + p2sh(Buffer.from(ticketCompiled.script));
  const ticketTemplateArtifact = extractTemplateArtifactV100(ticketCompiled);
  const psPrefixHex = '0x' + Buffer.from(ticketTemplateArtifact.templatePrefix).toString('hex');
  const psSuffixHex = '0x' + Buffer.from(ticketTemplateArtifact.templateSuffix).toString('hex');
  const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templatePrefix).toString('hex');
  const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templateSuffix).toString('hex');
  const feeUtxo = { txid: 'dd'.repeat(32), vout: 0, value: feeInputSompi, scriptPublicKeyHex: relaySpkHex };
  const built = buildRegisterAppendTxJson({
    kaspa, network: 'mainnet',
    leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout,
    leafOutpoint, leafCovId, currentState, newState,
    heldInput: null,
    feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
    registerAppendEntryAbi, registerAppendArgs: { side: SIDE, stake: STAKE, bettorPk, psPrefix: psPrefixHex, psSuffix: psSuffixHex, tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
    ticketScriptPubKeyHex: ticketSpkHex, mergedKttScript: mergedArtifact.script,
    absFeeCapSompi: registerAppendCap,
  });
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const shape = extractTxShape(tx);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
  if (!fv.ok) throw new Error(`register_append(首笔) relay侧校验失败: ${fv.reason}`);
  return built;
}

// ══════════════════════ ②a 首笔下注, fee输入 0.5 KAS ══════════════════════
let built2a;
try {
  built2a = buildFirstBetRegisterAppend(KAS / 2n);
  results.push(report('②a首笔下注register_append(无held, fee输入0.5 KAS)', built2a, CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI));
} catch (e) {
  console.log(`\n=== ②a首笔下注register_append(无held, fee输入0.5 KAS) ===\n  FAILED: ${e.message}`);
  results.push({ label: '②a首笔下注register_append(无held, fee输入0.5 KAS)', failed: true, error: e.message });
}

// ══════════════════════ ②b 首笔下注, fee输入 0.95 KAS ══════════════════════
let built2b;
try {
  built2b = buildFirstBetRegisterAppend(95n * KAS / 100n); // 0.95 KAS
  results.push(report('②b首笔下注register_append(无held, fee输入0.95 KAS)', built2b, CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI));
} catch (e) {
  console.log(`\n=== ②b首笔下注register_append(无held, fee输入0.95 KAS) ===\n  FAILED: ${e.message}`);
  results.push({ label: '②b首笔下注register_append(无held, fee输入0.95 KAS)', failed: true, error: e.message });
}

// ══════════════════════ ②c 补充: 首笔下注真实最小可行fee输入(1.05 KAS, 见run.log的探测记录) ══════════════════════
// 🔴 0.5/0.95 KAS 两个被要求的值都构造失败(见②a②b, 真实原因已如实记录, 不是脚本bug)——为了不让报告
// 停在"两个都失败", 额外探测出真实可行的最小量级面值, 让后面的预算核算有真实数字可用, 不是空对空。
let built2c;
try {
  built2c = buildFirstBetRegisterAppend(105n * KAS / 100n); // 1.05 KAS, 探测得到的真实可行最小量级(见run.log)
  results.push(report('②c首笔下注register_append(无held, fee输入1.05 KAS——补充探测的真实可行值)', built2c, CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI));
} catch (e) {
  console.log(`\n=== ②c首笔下注register_append(无held, fee输入1.05 KAS) ===\n  FAILED: ${e.message}`);
}

// ══════════════════════ ③ 第二笔下注(有held) ══════════════════════
function buildSecondBetRegisterAppend(feeInputSompi) {
  const SIDE = 1, STAKE = 30;
  const bettorPk = Buffer.alloc(32, 0x77).toString('hex');
  const currentState = { local_yes: 20, local_no: 0, count: 1, pool_value: 20 };
  const newState = { local_yes: currentState.local_yes, local_no: currentState.local_no + STAKE, count: currentState.count + 1, pool_value: currentState.pool_value + STAKE };
  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: SEAL_COUNT, rootcloseTmplHash: genesisArtifacts.rootCloseTmplHash, state: currentState });
  const sldCtor = [
    ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(SEAL_COUNT), ctorIntV100(MIN_BET), ctorBytes32V100(genesisArtifacts.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
  const sldCompiled = compileEntryAbi(SLD_PATH, sldCtor, 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;
  const heldArtifact = computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: leafCovId });
  const mergedArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });
  const ticketCtor = [{ kind: 'bytes', value: [...Buffer.from(bettorPk, 'hex')] }, { kind: 'int', value: SIDE }, { kind: 'int', value: STAKE }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }];
  const ticketCompiled = compileEntryAbi(TICKET_PATH, ticketCtor, 'PoolSideTicket');
  const ticketSpkHex = '0x' + p2sh(Buffer.from(ticketCompiled.script));
  const ticketTemplateArtifact = extractTemplateArtifactV100(ticketCompiled);
  const psPrefixHex = '0x' + Buffer.from(ticketTemplateArtifact.templatePrefix).toString('hex');
  const psSuffixHex = '0x' + Buffer.from(ticketTemplateArtifact.templateSuffix).toString('hex');
  const tokPrefixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templatePrefix).toString('hex');
  const tokSuffixHex = '0x' + Buffer.from(extractTemplateArtifactV100(kttCompiled).templateSuffix).toString('hex');
  const heldOutpoint = { txid: 'bb'.repeat(32), vout: 0 };
  const feeUtxo = { txid: 'dd'.repeat(32), vout: 0, value: feeInputSompi, scriptPublicKeyHex: relaySpkHex };
  const built = buildRegisterAppendTxJson({
    kaspa, network: 'mainnet',
    leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout,
    leafOutpoint, leafCovId, currentState, newState,
    heldInput: { txid: heldOutpoint.txid, vout: heldOutpoint.vout, value: CONTINUATION_OUTPUT_SOMPI, scriptPublicKeyHex: heldArtifact.scriptPubKeyHex, redeemScript: heldArtifact.script, entryAbi: kttEntryAbi, stateFieldCount: kttStateFieldCount },
    feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
    registerAppendEntryAbi, registerAppendArgs: { side: SIDE, stake: STAKE, bettorPk, psPrefix: psPrefixHex, psSuffix: psSuffixHex, tokPrefix: tokPrefixHex, tokSuffix: tokSuffixHex },
    ticketScriptPubKeyHex: ticketSpkHex, mergedKttScript: mergedArtifact.script,
    absFeeCapSompi: registerAppendCap,
  });
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const shape = extractTxShape(tx);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
  if (!fv.ok) throw new Error(`第二笔下注 relay侧校验失败: ${fv.reason}`);
  return built;
}
try {
  const built = buildSecondBetRegisterAppend(95n * KAS / 100n);
  results.push(report('③a第二笔下注register_append(有held, fee输入0.95 KAS)', built, CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI));
} catch (e) {
  console.log(`\n=== ③a第二笔下注register_append(有held, fee输入0.95 KAS) ===\n  FAILED: ${e.message}`);
  results.push({ label: '③a第二笔下注register_append(有held, fee输入0.95 KAS)', failed: true, error: e.message });
}
let built3b;
try {
  built3b = buildSecondBetRegisterAppend(105n * KAS / 100n); // 1.05 KAS, 探测得到的真实可行最小量级(见run.log)
  results.push(report('③b第二笔下注register_append(有held, fee输入1.05 KAS——补充探测的真实可行值)', built3b, CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI));
} catch (e) {
  console.log(`\n=== ③b第二笔下注register_append(有held, fee输入1.05 KAS) ===\n  FAILED: ${e.message}`);
}

// ══════════════════════ 金丝雀预算核算(1.95 KAS 种子, 建1个市场+下1笔) ══════════════════════
console.log('\n=== 金丝雀预算核算(种子面值 1.95 KAS = 195,000,000 sompi, 均为本次核算假设的测试面值) ===');
console.log('🔴 关键发现: ②a(0.5 KAS)与②b(0.95 KAS)两个被要求核算的fee输入面值, 对register_append首笔下注都真实构造失败(结构性/真实mass双重原因, 见上面②a②b的FAILED行与run.log)——不是脚本问题, 是这笔交易本身需要单个fee UTXO一次性垫付0.6 KAS的三个协议常量dust输出(leaf续约+ticket+合并KTT各0.2 KAS)加上真实mass费, 0.5/0.95都不够。已额外探测出真实可行的最小量级(约1.05 KAS, 见②c), 下面的预算核算改用这个真实可行值, 不是回避失败结果, 是给出"多少才够"的下一层答案。');
const SEED_TOTAL = 195n * KAS / 100n;
const genesisResult = results[0];

console.log(`  种子总额: ${fmtKas(SEED_TOTAL)}`);
console.log(`  market_genesis(0.5 KAS输入) net_loss = ${fmtKas(genesisResult.netLoss)}`);

if (built2c) {
  const totalConsumedFeeUtxoFaceValue = (KAS / 2n) + (105n * KAS / 100n);
  const totalNetLoss = genesisResult.netLoss + built2c.netLoss;
  const remaining = SEED_TOTAL - totalConsumedFeeUtxoFaceValue + (genesisResult.changeSompi || 0n) + (built2c.changeSompi || 0n);
  console.log(`\n  真实可行方案(首笔下注): genesis用0.5 KAS输入 + 首笔下注用1.05 KAS输入(②c):`);
  console.log(`    两笔fee UTXO面值合计消耗 = ${fmtKas(totalConsumedFeeUtxoFaceValue)}`);
  console.log(`    两笔net_loss合计(真正付给网络、一去不复返的部分) = ${fmtKas(totalNetLoss)}`);
  console.log(`    找零(genesis) = ${fmtKas(genesisResult.changeSompi || 0n)}, 找零(下注) = ${fmtKas(built2c.changeSompi || 0n)}`);
  console.log(`    1.95 KAS种子投入这两笔fee UTXO(0.5+1.05=1.55)后, 剩余未动用的种子 = ${fmtKas(SEED_TOTAL - totalConsumedFeeUtxoFaceValue)}`);
  console.log(`    relay侧最终可支配余额(剩余未动用种子 + 两笔找零) = ${fmtKas(remaining)}`);
} else {
  console.log('\n  ②c(1.05 KAS探测值)也未能构造成功, 无法给出可行预算方案——需要重新探测更大面值, 见run.log。');
}

console.log(`\n  结算入口(market_resolve/claim_draw/refund_payout)落地前取不回的金额(以首笔下注后的最终态计, 不重复计入被续约取代的旧genesis输出——leaf续约是genesis输出的延续, 同一份KAS滚动前进, 不是额外新增锁定):`);
console.log(`    leaf续约(继承自genesis, 同一份KAS滚动前进, 非新增锁定) = ${fmtKas(CONTINUATION_OUTPUT_SOMPI)}`);
console.log(`    新增: PoolSideTicket dust票据                        = ${fmtKas(GENESIS_OUTPUT_SOMPI)}`);
console.log(`    新增: 合并后的KanetTestToken genesis                 = ${fmtKas(GENESIS_OUTPUT_SOMPI)}`);
console.log(`    合计(建1个市场+下1笔后, 此刻锁在covenant里、无回收入口前取不回的KAS) = ${fmtKas(CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI)}`);
console.log(`\n  若再下第二笔(有held, ③b真实可行值fee输入1.05 KAS): 结算前取不回的金额结构不变仍是leaf续约+ticket+合并KTT三项各0.2 KAS = ${fmtKas(CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI)}(held被完全消费, next_states=[], 它原本锁着的0.2 KAS转移进了新的merged KTT输出里, 不是额外叠加锁定)。`);

console.log('\n\nJSON_RESULTS_BEGIN');
console.log(JSON.stringify(results, (k, v) => typeof v === 'bigint' ? v.toString() : v, 1));
console.log('JSON_RESULTS_END');
