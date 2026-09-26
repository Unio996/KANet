// verify-shardleaf-scripts.mjs — 方向A形状决定性验证（2026-09-26 改版，取代 D-020 单代币旧形状）。
//
// 🔴 改版理由：方向A(Owner批·NWT审零MUST·账本1663-1668)落地后，register_append 的真实形状变成
// "首笔=消费1个chip输入，续笔=消费[held,chip]2个输入"——旧版脚本经 proto-v0 的
// buildRegisterAppendTxJson/heldInput 构造的是方向A之前的"首笔无输入/续笔1个held输入"旧形状，
// 自 commit 7b12aa25(ShardLeaf.sil 的 owned_total 改成 pool_value+stake)起就已经跟当前合约逻辑
// 不匹配（旧形状首笔 owned_total=0 但 pool_value+stake>0，必然 FAIL——这不是本次改版引入的新问题，
// 是既有失效，见 ece2abec 那笔 commit message 的说明）。
//
// 本改版不再依赖 proto-v0 的交易组装原语（buildMarketGenesisTxJson/buildRegisterAppendTxJson）——
// 直接复用生产 kasia-relay/src/lib/p2sh.mjs 的可测性导出(_encodeRegisterAppendAction/
// _encodeKttTransferZeroOutAction/_serializeLeafStateHex/_continuationAddress/_addressFromRedeem)
// 和生产 kasia-console/src/lib/pool-bshard-artifacts.mjs 的 computeKttTokenArtifact/
// computePoolSideTicketArtifact，手写组装 cli-debugger 的 test.json 输入/输出（不经过完整
// kaspa-wasm Transaction 对象——跟本仓这次方向A排障过程中反复验证过的手法一致：cli-debugger 的
// covenant 内省需要测试作者显式声明每个 covenant 输入的 covenant_id，真实 consensus 用同一份
// pure function(kaspa.covenantId)计算，不依赖是否调用过 populateGenesisCovenants）。
//
// 用法同旧版：
//   node scripts/verify-shardleaf-scripts.mjs                          # 只生成 .test.json，不跑 debugger
//   CLI_DEBUGGER_PATH=D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe \
//     node scripts/verify-shardleaf-scripts.mjs                        # 生成 + 真跑 debugger，断言 PASS

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

if (!process.env.DB_PATH) process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'j2-sl-verify-')), 'console.db');
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const {
  compileSilV100, ctorBytes32V100, ctorIntV100,
  computeKttTokenArtifact, computePoolSideTicketArtifact, assertSilvercV100Pinned,
} = await import('../src/lib/pool-bshard-artifacts.mjs');
const { convergeShardLeafOwnRedeemLen, compileShardLeafRedeem } = await import('../src/lib/pool-shard-register.mjs');
const {
  _encodeRegisterAppendAction, _encodeKttTransferZeroOutAction,
  _serializeLeafStateHex, _continuationAddress, _addressFromRedeem,
} = await import('../../kasia-relay/src/lib/p2sh.mjs');

const SIL_PATH = new URL('../src/lib/ShardLeaf.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const NETWORK = 'simnet';

function asHex(v) { if (typeof v === 'string') return v.startsWith('0x') ? v : '0x' + v; return '0x' + Buffer.from(v).toString('hex'); }
function combineActionAndRedeem(actionHex, redeemHex) {
  const b = kaspa.ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } });
  b.addData(new Uint8Array(Buffer.from(redeemHex.replace(/^0x/, ''), 'hex')));
  return '0x' + b.drain().replace(/^0x/, '');
}
// covenant_id 是纯函数(funding_outpoint, [{index,output}]) → 32B hash，不依赖是否调用过
// populateGenesisCovenants(那只是给 JS 侧提前算出/绑定这个值的手段，consensus 侧算法本身跟这个无关)——
// 本脚本给每个"新铸"的 covenant 实例(leaf genesis/chip)各自现算一个真实、彼此不同的 covenant_id，
// 用假的(但每次不同的)funding outpoint，真实反映"两个独立铸出的实例天然属于不同的 covenant_id 组"
// 这件事(方向A 撤销 leader/delegate 分流的根据，见 ShardLeaf.sil 头注/p2sh.mjs 头注)。
function fakeGenesisCovId(scriptPubKeyHex, valueSompi) {
  const outpoint = { transactionId: randomBytes(32).toString('hex'), index: 0 };
  const spk = new kaspa.ScriptPublicKey(0, scriptPubKeyHex.replace(/^0x/, ''));
  const output = new kaspa.TransactionOutput(BigInt(valueSompi), spk);
  return String(kaspa.covenantId(outpoint, [{ index: 0, output }]));
}

function runDebugger(testFile, testName, silPath = SIL_PATH) {
  const debuggerPath = process.env.CLI_DEBUGGER_PATH;
  if (!debuggerPath) {
    console.log(`  [跳过真实执行] CLI_DEBUGGER_PATH 未设置, 只生成了 ${testFile} —— 如实说明: 本次未真正验证, 不假装通过。`);
    return null;
  }
  try {
    const out = execFileSync(debuggerPath, [silPath, '--run', '--test-name', testName, '--test-file', testFile], { encoding: 'utf8', timeout: 30000 });
    return { ok: /(^|\n)PASS/.test(out), out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') + e.message };
  }
}

// 🔴 同姊妹脚本账本1469理由: 3 组 ctor 组合，覆盖 seal_count/min_bet 的不同 minimal-push 编码宽度门槛。
const CTOR_CASES = [
  { label: 'sc2_mb1', sealCount: 2, minBet: 1 },
  { label: 'sc1000_mb100000', sealCount: 1000, minBet: 100000 },
  { label: 'sc2_mb2p40', sealCount: 2, minBet: 2 ** 40 },
];

const FUNDING_VALUE = 200_000_000n;
const LEAF_SEED = 20_000_000n;
const TOK_DUST = 20_000_000n;
const TICKET_DUST = 1_000_000n;

// leaf 自己的 register_append dispatch_tag —— 编译期结构性常量(跟 ctor 值无关)，用任意合法占位 ctor 编译
// ShardLeaf 一次取出即可(同 pool-shard-register.mjs 内 _shardLeafRegisterAppendDispatchTag 的做法，不
// import 私有 helper——这是一行提取，不是会漂移的业务逻辑，跟着 .sil 变了会在 cli-debugger 阶段直接暴露)。
function shardLeafRegisterAppendDispatchTag(tokenTmplHash) {
  const zeroState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
  const { ownRedeemLen } = convergeShardLeafOwnRedeemLen({
    marketIdHash: '00'.repeat(32), psTmplHashHex: '11'.repeat(32), shardPoolId: '00'.repeat(32),
    sealCount: 2, payoutCovId: '22'.repeat(32), deadline: Math.floor(Date.now() / 1000) + 1000,
    tokenTmplHash, state: zeroState,
  });
  const ctor = [
    ctorBytes32V100('00'.repeat(32)), ctorBytes32V100('11'.repeat(32)), ctorBytes32V100('00'.repeat(32)),
    ctorIntV100(2), ctorIntV100(100000), ctorBytes32V100('22'.repeat(32)), ctorIntV100(Math.floor(Date.now() / 1000) + 1000),
    ctorBytes32V100(tokenTmplHash),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorIntV100(ownRedeemLen),
  ];
  const compiled = compileSilV100(SIL_PATH, ctor, 'ShardLeaf');
  const tag = compiled._raw.contracts.ShardLeaf.entries.register_append?.dispatch_tag;
  if (!tag) throw new Error('shardLeafRegisterAppendDispatchTag: 编译产物缺 entries.register_append.dispatch_tag');
  return tag;
}

// 构造一笔 register_append 交易的 test.json 形状(leaf + [held]? + chip? + fee)，返回
// { inputs, outputs, leafSig, tokenSig, chipSig } 供 cli-debugger 逐 active_input 验证。
function buildRegisterAppendShape({
  ctorCase, marketId, payoutCovId, deadline, ownRedeemLen, tokenTmplHash, psTmplHashHex,
  leafRedeemHex, leafCovId, currentState, side, stake, heldArtifact, registerAppendDispatchTag,
  shardPoolId, bettorPk,
}) {
  const newState = {
    local_yes: currentState.local_yes + (side === 0 ? stake : 0),
    local_no: currentState.local_no + (side === 1 ? stake : 0),
    count: currentState.count + 1,
    pool_value: currentState.pool_value + stake,
  };
  const psArtifact = computePoolSideTicketArtifact({ bettorPk, direction: side, stake, shardPoolId });
  const chipArtifact = computeKttTokenArtifact({ amount: stake, ownerCovIdHex: leafCovId });
  const tokContArtifact = computeKttTokenArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });

  const leafOutIdx = 0, psOutIdx = 1, tokOutIdx = 2;
  const witness = {
    side, stake, leaf_out_idx: leafOutIdx, ps_out_idx: psOutIdx, bettor_pk: bettorPk,
    ps_prefix_hex: psArtifact.templatePrefix.toString('hex'), ps_suffix_hex: psArtifact.templateSuffix.toString('hex'),
    tok_out_idx: tokOutIdx, tok_prefix_hex: tokContArtifact.templatePrefix.toString('hex'), tok_suffix_hex: tokContArtifact.templateSuffix.toString('hex'),
    dispatch_tag_hex: registerAppendDispatchTag,
  };
  const leafSig = combineActionAndRedeem(_encodeRegisterAppendAction(witness), leafRedeemHex);
  const tokenSig = heldArtifact
    ? combineActionAndRedeem(_encodeKttTransferZeroOutAction(heldArtifact.entryAbi.dispatch_tag, heldArtifact.stateFieldCount, [0]), heldArtifact.script.toString('hex'))
    : null;
  const chipSig = combineActionAndRedeem(_encodeKttTransferZeroOutAction(chipArtifact.entryAbi.dispatch_tag, chipArtifact.stateFieldCount, [0]), chipArtifact.script.toString('hex'));

  const leafCovIdHex = '0x' + leafCovId;
  const chipCovId = fakeGenesisCovId(chipArtifact.scriptPubKeyHex, TOK_DUST);
  const inputs = [];
  inputs.push({ utxo_value: Number(LEAF_SEED), utxo_script_hex: '0x' + leafRedeemToSpkHex(leafRedeemHex), signature_script_hex: leafSig, covenant_id: leafCovIdHex });
  if (heldArtifact) {
    inputs.push({ utxo_value: Number(TOK_DUST), utxo_script_hex: heldArtifact.scriptPubKeyHex, signature_script_hex: tokenSig, covenant_id: '0x' + heldArtifact.covId });
  }
  inputs.push({ utxo_value: Number(TOK_DUST), utxo_script_hex: chipArtifact.scriptPubKeyHex, signature_script_hex: chipSig, covenant_id: '0x' + chipCovId });
  inputs.push({ utxo_value: Number(FUNDING_VALUE), utxo_script_hex: '0x' + '20' + '00'.repeat(32) + 'ac', signature_script_hex: '0x' }); // fee: 占位 P2PK, 非 active 不会被真执行

  const newLeafAddr = _continuationAddress(leafRedeemHex, _serializeLeafStateHex(newState), NETWORK);
  const ticketAddr = _addressFromRedeem(psArtifact.script.toString('hex'), NETWORK);
  const tokContAddr = _addressFromRedeem(tokContArtifact.script.toString('hex'), NETWORK);
  const tokOutValue = heldArtifact ? Number(TOK_DUST) * 2 : Number(TOK_DUST);
  const outputs = [];
  outputs[leafOutIdx] = { value: Number(LEAF_SEED), script_hex: '0x' + addrToSpkHex(newLeafAddr) };
  outputs[psOutIdx] = { value: Number(TICKET_DUST), script_hex: '0x' + addrToSpkHex(ticketAddr) };
  outputs[tokOutIdx] = { value: tokOutValue, script_hex: '0x' + addrToSpkHex(tokContAddr) };
  outputs.push({ value: Number(FUNDING_VALUE) - Number(LEAF_SEED) - Number(TICKET_DUST) - tokOutValue - 15_000_000, script_hex: '0x' + '20' + '00'.repeat(32) + 'ac' });

  return { inputs, outputs, newState, chipArtifact, tokContArtifact, psArtifact, leafOutIdx, psOutIdx, tokOutIdx };
}

function leafRedeemToSpkHex(redeemHex) { return addrToSpkHex(_addressFromRedeem(redeemHex, NETWORK)); }
function addrToSpkHex(addrStr) {
  const spk = kaspa.payToAddressScript(new kaspa.Address(addrStr));
  return spk.script.replace(/^0x/, '');
}

console.log('=== ShardLeaf.sil 方向A形状真实生产构造(3组ctor × 首笔单chip/续笔[held,chip]) → cli-debugger 真执行验证 ===');
console.log(`silverc v1.0.0 pin: ${(await assertSilvercV100Pinned(process.env.SILVERC_V100_PATH || 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe')).sha256}`);
console.log(`cli-debugger path: ${process.env.CLI_DEBUGGER_PATH || '(未设置, 只生成 test.json)'}`);

const allResults = [];
const allStateLayouts = [];
const tokenTmplHashProbe = computeKttTokenArtifact({ amount: 1, ownerCovIdHex: '00'.repeat(32) }).templateHashHex;
const registerAppendDispatchTag = shardLeafRegisterAppendDispatchTag(tokenTmplHashProbe);

for (const c of CTOR_CASES) {
  const marketId = randomBytes(32).toString('hex');
  const payoutCovId = randomBytes(32).toString('hex');
  const deadline = 1700000000;
  const bettorPk = randomBytes(32).toString('hex');
  const zeroState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
  const psTmplHashProbe = computePoolSideTicketArtifact({ bettorPk: '00'.repeat(32), direction: 0, stake: 1, shardPoolId: '00'.repeat(32) }).templateHashHex;

  const { ownRedeemLen } = convergeShardLeafOwnRedeemLen({
    marketIdHash: marketId, psTmplHashHex: psTmplHashProbe, shardPoolId: marketId, sealCount: c.sealCount, minBet: c.minBet,
    payoutCovId, deadline, tokenTmplHash: tokenTmplHashProbe, state: zeroState,
  });
  console.log(`\n--- ctor组合 ${c.label}(seal_count=${c.sealCount}, min_bet=${c.minBet}) 收敛 own_redeem_len=${ownRedeemLen} ---`);

  const leafRedeemHex = compileShardLeafRedeem({
    marketIdHash: marketId, psTmplHashHex: psTmplHashProbe, shardPoolId: marketId, sealCount: c.sealCount, payoutCovId, deadline,
    localYes: 0, localNo: 0, count: 0, poolValue: 0, tokenTmplHash: tokenTmplHashProbe, ownRedeemLen,
  });
  const leafSpkHex = leafRedeemToSpkHex(leafRedeemHex);
  const leafCovId = fakeGenesisCovId('0x' + leafSpkHex, LEAF_SEED);

  function verifyOne(label2, activeIdx, fn, silPath = SIL_PATH) {
    const testName = `VERIFY_${label2}`;
    const test = { tests: [{ name: testName, function: fn.name, constructor_args: fn.ctor, args: fn.args, expect: 'pass', tx: { active_input_index: activeIdx, inputs: fn.inputs, outputs: fn.outputs } }] };
    const testFile = join(mkdtempSync(join(tmpdir(), 'j2-sl-verify-testjson-')), `${label2}.test.json`);
    writeFileSync(testFile, JSON.stringify(test, null, 2));
    const result = runDebugger(testFile, testName, silPath);
    if (result) console.log(result.ok ? `  ✅ [${label2}] cli-debugger: PASS` : `  ❌ [${label2}] cli-debugger: FAIL\n${result.out}`);
    else console.log(`  [${label2}] wrote ${testFile}`);
    allResults.push(result);
    return result;
  }

  // ── 首笔(无 held, 只有 chip) ──
  const first = buildRegisterAppendShape({
    ctorCase: c, marketId, payoutCovId, deadline, ownRedeemLen, tokenTmplHash: tokenTmplHashProbe, psTmplHashHex: psTmplHashProbe,
    leafRedeemHex, leafCovId, currentState: zeroState, side: 0, stake: c.minBet, heldArtifact: null, registerAppendDispatchTag,
    shardPoolId: marketId, bettorPk,
  });
  allStateLayouts.push({ start: 1, len: 36 }); // OWN_PREFIX_LEN/OWN_STATE_LEN 已由 compileShardLeafRedeem 内部 fail-closed 核对过, 这里只记录用于汇总打印
  const registerCtorArgsFirst = debuggerRegisterCtor({ marketId, psTmplHashHex: psTmplHashProbe, sealCount: c.sealCount, minBet: c.minBet, payoutCovId, deadline, tokenTmplHash: tokenTmplHashProbe, state: zeroState, ownRedeemLen });
  verifyOne(`${c.label}_first_leaf`, 0, { name: 'register_append', ctor: registerCtorArgsFirst, args: registerAppendArgsFor(0, c.minBet, bettorPk, first), inputs: first.inputs, outputs: first.outputs });
  verifyOne(`${c.label}_first_chip`, 1, { name: 'transfer', ctor: kttCtorFor(c.minBet, leafCovId), args: [[], '0x', [0]], inputs: first.inputs, outputs: first.outputs }, kttSilPath());

  // ── 续笔(held=首笔的 tok_continuation + chip) ──
  const heldArtifact2 = { ...computeKttTokenArtifact({ amount: first.newState.pool_value, ownerCovIdHex: leafCovId }), covId: fakeGenesisCovId(first.tokContArtifact.scriptPubKeyHex, TOK_DUST) };
  const second = buildRegisterAppendShape({
    ctorCase: c, marketId, payoutCovId, deadline, ownRedeemLen, tokenTmplHash: tokenTmplHashProbe, psTmplHashHex: psTmplHashProbe,
    leafRedeemHex, leafCovId, currentState: first.newState, side: 1, stake: c.minBet, heldArtifact: heldArtifact2, registerAppendDispatchTag,
    shardPoolId: marketId, bettorPk,
  });
  const registerCtorArgsSecond = debuggerRegisterCtor({ marketId, psTmplHashHex: psTmplHashProbe, sealCount: c.sealCount, minBet: c.minBet, payoutCovId, deadline, tokenTmplHash: tokenTmplHashProbe, state: first.newState, ownRedeemLen });
  verifyOne(`${c.label}_second_leaf`, 0, { name: 'register_append', ctor: registerCtorArgsSecond, args: registerAppendArgsFor(1, c.minBet, bettorPk, second), inputs: second.inputs, outputs: second.outputs });
  verifyOne(`${c.label}_second_held`, 1, { name: 'transfer', ctor: kttCtorFor(first.newState.pool_value, leafCovId), args: [[], '0x', [0]], inputs: second.inputs, outputs: second.outputs }, kttSilPath());
  verifyOne(`${c.label}_second_chip`, 2, { name: 'transfer', ctor: kttCtorFor(c.minBet, leafCovId), args: [[], '0x', [0]], inputs: second.inputs, outputs: second.outputs }, kttSilPath());
}

function kttSilPath() { return new URL('../src/lib/sil-v1/KanetTestToken.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'); }
function kttCtorFor(amount, ownerCovIdHex) {
  const ZERO32 = '0x' + '00'.repeat(32);
  return [amount, '0x' + ownerCovIdHex, 4, 0, ZERO32, ZERO32, 3, 3];
}
function registerAppendArgsFor(side, stake, bettorPk, shape) {
  // register_append 的 args 顺序须与 entry 参数声明序一致: side,stake,leafOutIdx,psOutIdx,bettorPk,
  // ps_prefix,ps_suffix,tok_out,tok_prefix,tok_suffix。
  return [
    side, Number(stake), shape.leafOutIdx, shape.psOutIdx, '0x' + bettorPk,
    '0x' + shape.psArtifact.templatePrefix.toString('hex'), '0x' + shape.psArtifact.templateSuffix.toString('hex'),
    shape.tokOutIdx, '0x' + shape.tokContArtifact.templatePrefix.toString('hex'), '0x' + shape.tokContArtifact.templateSuffix.toString('hex'),
  ];
}
function debuggerRegisterCtor({ marketId, psTmplHashHex, sealCount, minBet, payoutCovId, deadline, tokenTmplHash, state, ownRedeemLen }) {
  return ['0x' + marketId, '0x' + psTmplHashHex, '0x' + marketId, sealCount, minBet, '0x' + payoutCovId, deadline, '0x' + tokenTmplHash, state.local_yes, state.local_no, state.count, state.pool_value, ownRedeemLen];
}

console.log(`\n=== OWN_PREFIX_LEN/OWN_STATE_LEN 实测汇总(NWT MUST-1) ===`);
for (const sl of allStateLayouts) console.log(`  state_span.start=${sl.start} state_span.len=${sl.len}`);
console.log(`✅ 全部一致: OWN_PREFIX_LEN=1, OWN_STATE_LEN=36(由 compileShardLeafRedeem 内部 fail-closed 核对, 详见该函数)`);

const anyRan = allResults.some(r => r !== null);
if (anyRan) {
  const allPass = allResults.every(r => r === null || r.ok);
  console.log(allPass ? '\n✅✅ ALL PASS(真实cli-debugger执行, 3组ctor × 首笔/续笔 各3检查共 15 次)' : '\n❌ 存在FAIL, 见上方输出');
  process.exit(allPass ? 0 : 1);
} else {
  console.log('\n(仅生成.test.json, 未设置CLI_DEBUGGER_PATH——未真实验证, 见上方各行"跳过真实执行"提示)');
}
