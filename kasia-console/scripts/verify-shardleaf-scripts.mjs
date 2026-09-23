// verify-shardleaf-scripts.mjs — D-020 移植到 ShardLeaf.sil 的决定性验证（Owner 批准 · NWT 攻击面审
// v0.1 通过 · MUST-1 量测缺口的落地）。
//
// 姊妹脚本 scripts/verify-shardleaf-direct-scripts.mjs 的同款方法论，改指向真正在生产路径上编译/使用的
// ShardLeaf.sil（不是 ShardLeaf_direct.sil——见 docs/iteration/j1-inbox/2026-09-23T14-38Z-j2-URGENT-...md，
// pool-shard-register.mjs 的 compileShardLeafRedeem 硬编码走 ShardLeaf.sil，两个文件是不同合约）。
//
// 为什么需要这个脚本（同姊妹脚本理由，不复述全文）：kaspa-wasm 不导出本地脚本执行引擎，JS 测试结构性地
// 无法验证"这笔真实构造出的交易，喂给真实 silverscript VM 执行 register_append 这条 covenant 逻辑，到底
// 会不会通过"——唯一能做到这件事、且跟节点 consensus 用同一份 kaspa-txscript 引擎的工具是 cli-debugger
// （D-019 pin 同一个 commit 3ed9733）。
//
// 🔴 NWT MUST-1（docs/iteration/j1-inbox/2026-09-23T16-14Z-nwt-VERDICT-...md）：OWN_PREFIX_LEN(=1)/
// OWN_STATE_LEN(=36) 两个常量必须按 ShardLeaf.sil *这份文件自己的* D-020 移植后编译产物重新量测，不能
// 沿用文档里写的旧数字（哪怕结构性推理认为大概率不变）。本脚本用 compileSilV100 真实编译（非猜测）取
// compiled.state_layout.{start,len}，打印实测值——与源码里手写的常量做交叉核对，不一致会在编译/执行阶段
// 直接暴露（redeem 地址算不对）。
//
// 🔴 proto-v0 依赖说明（读者/审阅者请先读这条，2026-09-23）：本脚本 import 了 proto-tx-assembly.mjs 的
// buildMarketGenesisTxJson/buildRegisterAppendTxJson 和 proto-covenant-builder.mjs 的
// computeKttGenesisArtifact/computeTicketGenesisArtifact/loadProtocolConstants——这些函数本身是
// **合约无关的通用交易组装/模板计算原语**（参数化接收 redeem 脚本/ABI/ctor，没有硬编码 ShardLeaf_direct
// 专属业务逻辑），跟姊妹脚本 verify-shardleaf-direct-scripts.mjs 复用它们的方式完全一致（既有先例，非本
// 脚本首创）。D-033 冻结的是"改动/审/测 proto-v0 本身"，不是禁止把它已验证过的通用工具函数当只读依赖用
// 在验证别的合约上——但 proto-v0 迟早整体删除（D-033），这份依赖是**一次性验证脚本的已知技术债**，不是
// 生产代码的依赖形状；生产代码（pool-shard-register.mjs/pool-register-builder.mjs/relay p2sh.mjs）不
// import 任何 proto-* 文件，各自独立实现（照抄同一套已验证的编码/组装模式，不共享导入）。
//
// 用法同姊妹脚本：
//   node scripts/verify-shardleaf-scripts.mjs                          # 只生成 .test.json，不跑 debugger
//   CLI_DEBUGGER_PATH=/d/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe \
//     node scripts/verify-shardleaf-scripts.mjs                        # 生成 + 真跑 debugger，断言 PASS

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2b';

if (!process.env.DB_PATH) process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'j2-sl-verify-')), 'console.db');
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
// 通用交易组装原语（proto-v0，只读复用，见上方"proto-v0 依赖说明"）。
const { buildMarketGenesisTxJson, buildRegisterAppendTxJson } = await import('../src/lib/proto-tx-assembly.mjs');
const { computeKttGenesisArtifact, computeTicketGenesisArtifact, loadProtocolConstants } = await import('../src/lib/proto-covenant-builder.mjs');
// ShardLeaf.sil 专属的 redeem/收敛逻辑——本仓自己实现（不 import proto-v0），见 pool-shard-register.mjs。
const { convergeShardLeafOwnRedeemLen, compileShardLeafRedeem } = await import('../src/lib/pool-shard-register.mjs');
const { signOnlyDeclaredInputs } = await import('../../kasia-relay/src/lib/covenant-broadcast.mjs');

const SIL_PATH = new URL('../src/lib/ShardLeaf.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

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

// 🔴 同姊妹脚本账本1469理由: 3 组 ctor 组合，覆盖 seal_count/min_bet 的不同 minimal-push 编码宽度门槛。
const CTOR_CASES = [
  { label: 'sc2_mb1', sealCount: 2, minBet: 1 },
  { label: 'sc1000_mb100000', sealCount: 1000, minBet: 100000 },
  { label: 'sc2_mb2p40', sealCount: 2, minBet: 2 ** 40 },
];

// debugger 的 ctor 参数顺序须与 ShardLeaf.sil 的 13-参数 ctor 逐一对应（本轮 D-020 移植新增 own_redeem_len
// 在末位；payout_cov_id/deadline 在 min_bet 之后、token_tmpl_hash 之前——与 ShardLeaf_direct 的
// rootclose_tmpl_hash/rootclose_init_payoutRoot 位置一致，语义不同）。
function debuggerCtorArgsFor({ marketId, sealCount, minBet, payoutCovId, deadline, ownRedeemLen }, state0) {
  return [
    '0x' + marketId, '0x' + ps_tmpl_hash, '0x' + marketId,
    sealCount, minBet, '0x' + payoutCovId, deadline,
    '0x' + token_tmpl_hash, state0.local_yes, state0.local_no, state0.count, state0.pool_value,
    ownRedeemLen,
  ];
}

async function buildAndVerifyBet({ ctorCase, label, leafOutpoint, leafCovId, currentState, side, stake, heldInput }) {
  const { marketId, sealCount, minBet, payoutCovId, deadline, ownRedeemLen } = ctorCase;
  const newState = {
    local_yes: currentState.local_yes + (side === 0 ? stake : 0),
    local_no: currentState.local_no + (side === 1 ? stake : 0),
    count: currentState.count + 1,
    pool_value: currentState.pool_value + stake,
  };
  const leafRedeemHex = compileShardLeafRedeem({
    marketIdHash: marketId, psTmplHashHex: ps_tmpl_hash, shardPoolId: marketId, sealCount, payoutCovId, deadline,
    localYes: currentState.local_yes, localNo: currentState.local_no, count: currentState.count, poolValue: currentState.pool_value,
    tokenTmplHash: token_tmpl_hash, ownRedeemLen,
  });
  const leafRedeem = Buffer.from(leafRedeemHex, 'hex');
  // 真实取 entryAbi: 用同一 ctor 重编一次(与 compileShardLeafRedeem 内部编译共享 silverc 磁盘 cache, 无额外真实开销)。
  const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../src/lib/pool-bshard-artifacts.mjs');
  const fullCtor = [
    ctorBytes32V100(marketId), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(sealCount), ctorIntV100(minBet), ctorBytes32V100(payoutCovId), ctorIntV100(deadline),
    ctorBytes32V100(token_tmpl_hash),
    ctorIntV100(currentState.local_yes), ctorIntV100(currentState.local_no), ctorIntV100(currentState.count), ctorIntV100(currentState.pool_value),
    ctorIntV100(ownRedeemLen),
  ];
  const compiled = compileSilV100(SIL_PATH, fullCtor, 'ShardLeaf');
  const registerAppendEntryAbi = compiled._raw.contracts.ShardLeaf.entries.register_append;
  const leafStateLayout = { start: compiled.state_layout.start, len: compiled.state_layout.len };
  const bettorPk = randomBytes(32).toString('hex');
  const ticketArtifact = computeTicketGenesisArtifact({ bettorPk, direction: side, stake, shardPoolId: marketId });
  const mergedKttArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });

  const built = buildRegisterAppendTxJson({
    kaspa, network: 'mainnet',
    leafRedeemScript: leafRedeem, leafStateLayout, leafOutpoint, leafCovId,
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
  const tokOutIdx = 2;
  const testName = `VERIFY_${label}`;
  const test = { tests: [{
    name: testName, function: 'register_append', constructor_args: debuggerCtorArgsFor(ctorCase, currentState),
    args: [side, stake, 0, 1, '0x' + bettorPk, '0x' + ps_prefix, '0x' + ps_suffix, tokOutIdx, '0x' + token_prefix, '0x' + token_suffix],
    expect: 'pass',
    tx: { active_input_index: 0, inputs: shape.inputs, outputs: shape.outputs },
  }] };
  const testFile = join(mkdtempSync(join(tmpdir(), 'j2-sl-verify-testjson-')), `ShardLeaf.${label}.test.json`);
  writeFileSync(testFile, JSON.stringify(test, null, 2));
  console.log(`[${label}] own_redeem_len=${ownRedeemLen} state_span={start:${leafStateLayout.start},len:${leafStateLayout.len}} wrote ${testFile} (ninputs=${shape.inputs.length}, noutputs=${shape.outputs.length})`);
  const result = runDebugger(testFile, testName);
  if (result) {
    console.log(result.ok ? `  ✅ [${label}] cli-debugger: PASS` : `  ❌ [${label}] cli-debugger: FAIL\n${result.out}`);
  }
  return { newState, built, result, leafStateLayout };
}

console.log('=== ShardLeaf.sil genesis + register_append 真实生产构造(D-020移植后, 3组ctor × 首笔/次笔) → cli-debugger 真执行验证 ===');
console.log(`silverc v1.0.0 pin: ${(await (await import('../src/lib/pool-bshard-artifacts.mjs')).assertSilvercV100Pinned(process.env.SILVERC_V100_PATH || 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe')).sha256}`);
console.log(`cli-debugger path: ${process.env.CLI_DEBUGGER_PATH || '(未设置, 只生成 test.json)'}`);

const allResults = [];
const allStateLayouts = [];
for (const c of CTOR_CASES) {
  const marketId = randomBytes(32).toString('hex');
  const payoutCovId = randomBytes(32).toString('hex');
  const deadline = 1700000000;
  const zeroState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
  const { ownRedeemLen } = convergeShardLeafOwnRedeemLen({
    marketIdHash: marketId, psTmplHashHex: ps_tmpl_hash, shardPoolId: marketId, sealCount: c.sealCount, minBet: c.minBet,
    payoutCovId, deadline, tokenTmplHash: token_tmpl_hash, state: zeroState,
  });
  const ctorCase = { ...c, marketId, payoutCovId, deadline, ownRedeemLen };
  console.log(`\n--- ctor组合 ${c.label}(seal_count=${c.sealCount}, min_bet=${c.minBet}) 收敛 own_redeem_len=${ownRedeemLen} ---`);

  const leafRedeemGenesisHex = compileShardLeafRedeem({
    marketIdHash: marketId, psTmplHashHex: ps_tmpl_hash, shardPoolId: marketId, sealCount: c.sealCount, payoutCovId, deadline,
    localYes: 0, localNo: 0, count: 0, poolValue: 0, tokenTmplHash: token_tmpl_hash, ownRedeemLen,
  });
  // P2SH scriptPubKey = OP_BLAKE2B(0xaa) PUSH32(0x20) <blake2b(redeem)> OP_EQUAL(0x87) — 同 proto-covenant-builder.mjs
  // 本地 p2sh() 一字不差的公式（1 行 blake2b 组装，不值得为此再 import 一个 proto-v0 文件）。
  const leafRedeemGenesisScriptPubKeyHex = '0x' + 'aa20' + Buffer.from(blake2b(Buffer.from(leafRedeemGenesisHex, 'hex'), { dkLen: 32 })).toString('hex') + '87';
  const genesis = buildMarketGenesisTxJson({
    kaspa, network: 'mainnet', feeUtxo: { txid: randomBytes(32).toString('hex'), vout: 0, value: 50_000_000n, scriptPublicKeyHex: relaySpkHex },
    relayChangeScriptPublicKeyHex: relaySpkHex, shardLeafScriptPubKeyHex: leafRedeemGenesisScriptPubKeyHex, absFeeCapSompi: 80_000_000n,
  });
  const genesisTx = kaspa.Transaction.deserializeFromSafeJSON(genesis.txJson);
  const leafOutpoint = { txid: genesisTx.id, vout: 0 };
  const leafCovId = genesis.shardLeafCovId;

  const first = await buildAndVerifyBet({
    ctorCase, label: `${c.label}_first_bet_no_held`, leafOutpoint, leafCovId,
    currentState: zeroState, side: 0, stake: c.minBet, heldInput: null,
  });
  allStateLayouts.push(first.leafStateLayout);

  const heldArtifact = computeKttGenesisArtifact({ amount: first.newState.pool_value, ownerCovIdHex: leafCovId });
  const second = await buildAndVerifyBet({
    ctorCase, label: `${c.label}_second_bet_with_held`, leafOutpoint, leafCovId,
    currentState: first.newState, side: 1, stake: c.minBet, heldInput: {
      txid: first.built.expectedTxid, vout: 2, value: 20_000_000n, scriptPublicKeyHex: heldArtifact.scriptPubKeyHex,
      redeemScript: heldArtifact.script, entryAbi: heldArtifact.entryAbi, stateFieldCount: heldArtifact.stateFieldCount,
    },
  });
  allStateLayouts.push(second.leafStateLayout);

  allResults.push(first.result, second.result);
}

console.log(`\n=== OWN_PREFIX_LEN/OWN_STATE_LEN 实测汇总(NWT MUST-1) ===`);
for (const sl of allStateLayouts) console.log(`  state_span.start=${sl.start} state_span.len=${sl.len}`);
const consistent = allStateLayouts.every(sl => sl.start === allStateLayouts[0].start && sl.len === allStateLayouts[0].len);
console.log(consistent
  ? `✅ 全部一致: OWN_PREFIX_LEN=${allStateLayouts[0].start}, OWN_STATE_LEN=${allStateLayouts[0].len} —— 与源码常量核对${allStateLayouts[0].start === 1 && allStateLayouts[0].len === 36 ? '一致(不用改)' : '不一致(必须改源码常量!)'}`
  : `❌ 不一致——不同 ctor 组合量出不同值，源码常量不能是单一字面量，需要按 ctor 现算`);

const anyRan = allResults.some(r => r !== null);
if (anyRan) {
  const allPass = allResults.every(r => r === null || r.ok);
  console.log(allPass ? '\n✅✅ ALL PASS(真实cli-debugger执行, 3组ctor × 首笔/次笔 共 6 次)' : '\n❌ 存在FAIL, 见上方输出');
  process.exit(allPass ? 0 : 1);
} else {
  console.log('\n(仅生成.test.json, 未设置CLI_DEBUGGER_PATH——未真实验证, 见上方各行"跳过真实执行"提示)');
}
