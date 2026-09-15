// verify-shardleaf-direct-scripts.mjs — 账本1465/1468(闸3两次中止)修复后的永久性节点脚本执行验证。
//
// 背景(为什么需要这个脚本, 不是"加几条JS单测"就够): kaspa-wasm不导出任何本地脚本执行引擎(账本1465已
// 核实, 全部导出符号检索零命中 TxScriptEngine/checkScripts 等), calculateTransactionMass只算字节数公式
// 不执行脚本逻辑——这意味着proto-tx-assembly.mjs/proto-tx-assembly-register-append.test.mjs等现有JS测试
// 无论写多少条, 都【结构性地】无法验证"这笔真实构造出的交易, 喂给真实silverscript VM执行register_append
// 这条covenant逻辑, 到底会不会通过"——它们只能验证JS自己的内部一致性(construct出的值自己对不对得上自己),
// 和relay侧extractTxShape/validateFixedValueOutputs这类"检查输出值形状"的浅层逻辑, 从未真正执行过
// ShardLeaf_direct.sil自己的require()链。
//
// 账本1465(sig_op_count)和账本1468(register_append自续约偏移计算)两次真实故障, 都是"本地构造+relay
// 签名+txid核对全部通过, 真广播到主网节点才被拒"——因为拒绝发生在【节点执行脚本】这一层, 而不是JS能
// 触及的任何一层。唯一能在不广播的前提下真实执行到这一层的工具是 silverscript 的 cli-debugger(D-019 pin
// 同一个commit 3ed9733——见README `docs/DEVELOPER-GUIDE.md`/账本1394登记), 它内嵌了跟节点consensus
// 同一份kaspa-txscript(cargo pin同一个rev)真实脚本引擎。
//
// 本脚本做的事: 用proto-tx-assembly.mjs/proto-covenant-builder.mjs的【真实生产函数】(不是重新写一遍逻辑)
// 构造两种真实交易形状(market_genesis + 首笔/次笔register_append, 全部协议常量/合成随机值, D-021安全),
// relay侧真签名, 导出成cli-debugger认识的.test.json协议(tx.inputs[i].signature_script_hex直接喂我们
// 真实产出的字节, 不用debugger自己的witness构造器——这样测的是"我们真实产出的字节能不能过", 不是"debugger
// 会不会自己造出能过的字节"这种同义反复), 再(可选)调用本机的cli-debugger二进制真跑一遍。
//
// 用法:
//   node scripts/verify-shardleaf-direct-scripts.mjs                    # 只生成 .test.json, 不跑debugger
//   CLI_DEBUGGER_PATH=/d/silverscript-debugger-3ed9733/target/release/cli-debugger.exe \
//     node scripts/verify-shardleaf-direct-scripts.mjs                  # 生成 + 真跑debugger, 断言PASS
//
// cli-debugger二进制不随本仓分发(它是silverscript那个独立仓库的构建产物, 见D-019 pin/账本1394)——
// 没有设置CLI_DEBUGGER_PATH时本脚本只生成.test.json文件到scratch并如实打印"跳过真实执行"，不假装验证过。

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

if (!process.env.DB_PATH) process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'j2-sld-verify-')), 'console.db');
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { buildMarketGenesisTxJson, buildRegisterAppendTxJson } = await import('../src/lib/proto-tx-assembly.mjs');
const {
  computeMarketGenesisArtifacts, computeShardLeafRedeemScript, loadProtocolConstants,
  computeKttGenesisArtifact, computeTicketGenesisArtifact,
} = await import('../src/lib/proto-covenant-builder.mjs');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../src/lib/pool-bshard-artifacts.mjs');
const { signOnlyDeclaredInputs } = await import('../../kasia-relay/src/lib/covenant-broadcast.mjs');

const SIL_PATH = new URL('../src/lib/ShardLeaf_direct.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function asHex(v) { if (typeof v === 'string') return v.startsWith('0x') ? v : '0x' + v; return '0x' + Buffer.from(v).toString('hex'); }
function txToDebuggerShape(tx, activeIdx, covenantIdHex) {
  const inputs = [];
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    const entry = { utxo_value: Number(inp.utxo.amount), utxo_script_hex: asHex(inp.utxo.scriptPublicKey.script), signature_script_hex: asHex(inp.signatureScript) };
    if (i === activeIdx && covenantIdHex) entry.covenant_id = '0x' + covenantIdHex;
    inputs.push(entry);
  }
  const outputs = [];
  for (let i = 0; i < tx.outputs.length; i++) {
    const out = tx.outputs[i];
    outputs.push({ value: Number(out.value), script_hex: asHex(out.scriptPublicKey.script) });
  }
  return { inputs, outputs };
}

function runDebugger(testFile, testName) {
  const debuggerPath = process.env.CLI_DEBUGGER_PATH;
  if (!debuggerPath) {
    console.log(`  [跳过真实执行] CLI_DEBUGGER_PATH 未设置, 只生成了 ${testFile} —— 如实说明: 本次未真正验证, 不假装通过。`);
    return null;
  }
  try {
    const out = execFileSync(debuggerPath, [SIL_PATH, '--run', '--test-name', testName, '--test-file', testFile], { encoding: 'utf8', timeout: 30000 });
    return { ok: /(^|\n)PASS/.test(out), out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') + e.message };
  }
}

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = kaspa.payToAddressScript(relayAddr);
const relaySpkHex = '0x' + relaySpk.script;
const { ps_tmpl_hash, token_tmpl_hash, ps_prefix, ps_suffix, token_prefix, token_suffix } = loadProtocolConstants();

const MARKET_ID = randomBytes(32).toString('hex');
const artifacts = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: 1, deadlineMs: 1700000000000 });

// ── market_genesis(单输入 fee, 无covenant读写自己以外的逻辑——主要覆盖账本1465的sig_op_count规则) ──
const genesis = buildMarketGenesisTxJson({
  kaspa, network: 'mainnet', feeUtxo: { txid: randomBytes(32).toString('hex'), vout: 0, value: 50_000_000n, scriptPublicKeyHex: relaySpkHex },
  relayChangeScriptPublicKeyHex: relaySpkHex, shardLeafScriptPubKeyHex: artifacts.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: 80_000_000n,
});
const genesisTx = kaspa.Transaction.deserializeFromSafeJSON(genesis.txJson);
const leafOutpoint = { txid: genesisTx.id, vout: 0 };
const leafCovId = genesis.shardLeafCovId;

function sldCtorFor(state0 = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }) {
  return [
    ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(2), ctorIntV100(1), ctorBytes32V100(artifacts.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(state0.local_yes), ctorIntV100(state0.local_no), ctorIntV100(state0.count), ctorIntV100(state0.pool_value),
  ];
}
const debuggerCtorArgsFor = (state0) => [
  '0x' + MARKET_ID, '0x' + ps_tmpl_hash, '0x' + MARKET_ID,
  2, 1, '0x' + artifacts.rootCloseTmplHash, '0x' + '00'.repeat(32),
  '0x' + token_tmpl_hash, state0.local_yes, state0.local_no, state0.count, state0.pool_value,
];

async function buildAndVerifyBet({ label, currentState, side, stake, heldInput }) {
  const newState = {
    local_yes: currentState.local_yes + (side === 0 ? stake : 0),
    local_no: currentState.local_no + (side === 1 ? stake : 0),
    count: currentState.count + 1,
    pool_value: currentState.pool_value + stake,
  };
  const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: 1, sealCount: 2, rootcloseTmplHash: artifacts.rootCloseTmplHash, state: currentState });
  const sldCompiled = compileSilV100(SIL_PATH, sldCtorFor(currentState), 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;
  const bettorPk = randomBytes(32).toString('hex');
  const ticketArtifact = computeTicketGenesisArtifact({ bettorPk, direction: side, stake, shardPoolId: MARKET_ID });
  const mergedKttArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });

  const built = buildRegisterAppendTxJson({
    kaspa, network: 'mainnet',
    leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout, leafOutpoint, leafCovId,
    currentState, newState, heldInput,
    feeUtxo: { txid: randomBytes(32).toString('hex'), vout: 0, value: 95_000_000n, scriptPublicKeyHex: relaySpkHex },
    relayChangeScriptPublicKeyHex: relaySpkHex,
    registerAppendEntryAbi,
    registerAppendArgs: { side, stake, bettorPk: '0x' + bettorPk, psPrefix: '0x' + ps_prefix, psSuffix: '0x' + ps_suffix, tokPrefix: '0x' + token_prefix, tokSuffix: '0x' + token_suffix },
    ticketScriptPubKeyHex: ticketArtifact.scriptPubKeyHex, mergedKttScript: mergedKttArtifact.script, absFeeCapSompi: 100_000_000n,
  });

  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: priv, kaspa });
  tx.finalize();
  const shape = txToDebuggerShape(tx, 0, leafCovId);
  const tokOutIdx = heldInput ? 2 : 2; // REGISTER_APPEND_TOK_OUT_INDEX 恒为2(见proto-tx-assembly.mjs)
  const testName = `VERIFY_${label}`;
  const test = { tests: [{
    name: testName, function: 'register_append', constructor_args: debuggerCtorArgsFor(currentState),
    args: [side, stake, 0, 1, '0x' + bettorPk, '0x' + ps_prefix, '0x' + ps_suffix, tokOutIdx, '0x' + token_prefix, '0x' + token_suffix],
    expect: 'pass',
    tx: { active_input_index: 0, inputs: shape.inputs, outputs: shape.outputs },
  }] };
  const testFile = join(mkdtempSync(join(tmpdir(), 'j2-sld-verify-testjson-')), `ShardLeaf_direct.${label}.test.json`);
  writeFileSync(testFile, JSON.stringify(test, null, 2));
  console.log(`[${label}] wrote ${testFile} (ninputs=${shape.inputs.length}, noutputs=${shape.outputs.length})`);
  const result = runDebugger(testFile, testName);
  if (result) {
    console.log(result.ok ? `  ✅ [${label}] cli-debugger: PASS` : `  ❌ [${label}] cli-debugger: FAIL\n${result.out}`);
  }
  return { newState, built, result };
}

console.log('=== market_genesis + register_append 真实生产构造 → cli-debugger 真执行验证(账本1465/1468) ===');
const first = await buildAndVerifyBet({ label: 'first_bet_no_held', currentState: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }, side: 0, stake: 5, heldInput: null });

// 第二笔(有held)——held的outpoint/covId不需要真实链上存在, 我们直接构造一个合成的heldInput对象喂给
// buildRegisterAppendTxJson(它只是把这个值原样嵌进tx.inputs[1], 不校验它是否真实存在于任何UTXO集——
// 那是proto-leaf-state.mjs的assertHeldKttOutpointMatchesChain的职责, 不是这个函数的职责)。
const heldArtifact = computeKttGenesisArtifact({ amount: first.newState.pool_value, ownerCovIdHex: leafCovId });
const second = await buildAndVerifyBet({
  label: 'second_bet_with_held', currentState: first.newState, side: 1, stake: 3,
  heldInput: {
    txid: first.built.expectedTxid, vout: 2, value: 20_000_000n, scriptPublicKeyHex: heldArtifact.scriptPubKeyHex,
    redeemScript: heldArtifact.script, entryAbi: heldArtifact.entryAbi, stateFieldCount: heldArtifact.stateFieldCount,
  },
});

const anyRan = [first.result, second.result].some(r => r !== null);
if (anyRan) {
  const allPass = [first.result, second.result].every(r => r === null || r.ok);
  console.log(allPass ? '\n✅✅ ALL PASS(真实cli-debugger执行)' : '\n❌ 存在FAIL, 见上方输出');
  process.exit(allPass ? 0 : 1);
} else {
  console.log('\n(仅生成.test.json, 未设置CLI_DEBUGGER_PATH——未真实验证, 见上方各行"跳过真实执行"提示)');
}
