// 临时验证脚本(账本1436续, Bettor回执要求): 捕获真实 D-019 pin cli-debugger 对 held/stake 两个
// KTT 输入在 buildRegisterAppendTxJson 生产真实形状下的 transfer active_sigscript, 与
// encodeKttTransferZeroOutAction 独立编码的字节逐字节比对。覆盖两个此前未捕获的 owner_input_idx 取值:
//   A) held, owner_input_idx=[0](第二笔下注形状: leaf=0,held=1,stake=2,fee=3)
//   B) stake, owner_input_idx=[2](第一笔下注形状: leaf=0,stake=1,fee=2——修复前的bug错写成[0])
// (owner_input_idx=[3] 的 stake 情况已在 2026-09-15-j2-ktt-transfer-witness-abi-verification 捕获过)
import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/node_modules/@noble/hashes/blake2b.js');
const kaspa = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/node_modules/kaspa-wasm/kaspa.js').href);
const { encodeKttTransferZeroOutAction } = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/src/lib/proto-ktt-transfer-witness.mjs').href);
const { compileSilV100 } = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/src/lib/pool-bshard-artifacts.mjs').href);

function computeGenesisCovId(authInputIdx, outputIndex, valueSompi, scriptHexNo0x) {
  const byteHex = authInputIdx.toString(16).padStart(2, '0');
  const outpoint = { transactionId: byteHex.repeat(32), index: 0 };
  const spk = new kaspa.ScriptPublicKey(0, scriptHexNo0x);
  const output = new kaspa.TransactionOutput(BigInt(valueSompi), spk);
  return '0x' + String(kaspa.covenantId(outpoint, [{ index: outputIndex, output }]));
}
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const DEBUGGER = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/cli-debugger.exe';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console';
const SLD = `${CWD}/src/lib/ShardLeaf_direct.sil`;
const KTT = `${CWD}/src/lib/sil-v1/KanetTestToken.sil`;
const TICKET = `${CWD}/src/lib/sil-v1/PoolSideTicket.sil`;

const ZERO32 = new Array(32).fill(0);
const STAKE_CHIP_OWNER_UNBOUND = ZERO32;
const SL_COV = new Array(32).fill(0x33);
const HELD_COV = new Array(32).fill(0x11);
const STAKE_COV = new Array(32).fill(0x22);
const FEE_PUBKEY = new Array(32).fill(0x88);

function compileGeneric(sil, ctor, tag) {
  const dir = 'scratch/_j2_owneridx_check';
  fs.mkdirSync(dir, { recursive: true });
  const ctorPath = `${dir}/${tag}.ctor.json`, outPath = `${dir}/${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${sil}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}
function compileKTT(ownerCov, amount, tag) {
  const ctor = [
    { kind: 'int', value: amount }, { kind: 'bytes', value: ownerCov }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 },
  ];
  return compileGeneric(KTT, ctor, `ktt_${tag}`);
}
function compileTicket({ bettorPk, direction, stake, shardPoolId }, tag) {
  const ctor = [{ kind: 'bytes', value: bettorPk }, { kind: 'int', value: direction }, { kind: 'int', value: stake }, { kind: 'bytes', value: shardPoolId }];
  return compileGeneric(TICKET, ctor, `ticket_${tag}`);
}
function toCtorObjs(arr) { return arr.map((v) => (typeof v === 'string' && v.startsWith('0x')) ? { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] } : { kind: 'int', value: v }); }
function compileSLD(ctorArr, tag) { return compileGeneric(SLD, toCtorObjs(ctorArr), `sld_${tag}`); }

const tokAnchor = compileKTT(SL_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;
const shardPoolId = new Array(32).fill(0x44);
const ticketAnchor = compileTicket({ bettorPk: ZERO32, direction: 0, stake: 0, shardPoolId }, 'anchor');
const psTmplHash = ticketAnchor.templateHash;
const marketId = new Array(32).fill(0x55);
const SEAL_COUNT = 2, MIN_BET = 5;
function sldCtor(pool_value) { return [hex(marketId), hex(psTmplHash), hex(marketId), SEAL_COUNT, MIN_BET, hex(ZERO32), hex(ZERO32), hex(tokenTmplHash), 0, 0, 0, pool_value]; }
const STAKE = 20, SIDE = 0;
const bettorPk = new Array(32).fill(0x66);

function runDebugger(testJsonPath, testName) {
  const r = spawnSync(DEBUGGER, [KTT, '--test-file', testJsonPath, '--test-name', testName, '-r'], { cwd: CWD, env: { ...process.env, J2_DUMP_ACTIVE_SIGSCRIPT: '1' }, encoding: 'utf8' });
  const m = /J2_ACTIVE_SIGSCRIPT_HEX=([0-9a-f]+)/.exec(r.stderr || '');
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, capturedHex: m ? m[1] : null };
}

// ===== A) 第二笔下注形状: [0]leaf [1]held [2]stake [3]fee, active=held(1), owner_input_idx=[0] =====
{
  const POOL_VALUE = 100;
  const ctorArgs = sldCtor(POOL_VALUE);
  const active = compileSLD(ctorArgs, 'active_A');
  const heldTok = compileKTT(SL_COV, POOL_VALUE, 'held_A');
  const stakeTok = compileKTT(STAKE_CHIP_OWNER_UNBOUND, STAKE, 'stake_A');
  const ticketOut = compileTicket({ bettorPk, direction: SIDE, stake: STAKE, shardPoolId: marketId }, 'ticketout_A');
  const contCtor = sldCtor(POOL_VALUE); contCtor[8] = STAKE; contCtor[10] = 1; contCtor[11] = POOL_VALUE + STAKE;
  const cont = compileSLD(contCtor, 'cont_A');
  const mergedTok = compileKTT(SL_COV, POOL_VALUE + STAKE, 'merged_A');
  const inputs = [
    { utxo_value: 1000, covenant_id: hex(SL_COV), utxo_script_hex: active.scriptHex, signature_script_hex: active.fullBytecodeHex },
    { utxo_value: 10, covenant_id: hex(HELD_COV), utxo_script_hex: heldTok.scriptHex, signature_script_hex: heldTok.fullBytecodeHex },
    { utxo_value: 10, covenant_id: hex(STAKE_COV), utxo_script_hex: stakeTok.scriptHex, signature_script_hex: stakeTok.fullBytecodeHex },
    { utxo_value: 10_000_000_000, p2pk_pubkey: hex(FEE_PUBKEY) },
  ];
  const mergedGenesisCovId = computeGenesisCovId(3, 2, 1, mergedTok.scriptHex.slice(2));
  const outputs = [
    { value: 1000, covenant_id: hex(SL_COV), authorizing_input: 0, script_hex: cont.scriptHex },
    { value: 1, script_hex: ticketOut.scriptHex },
    { value: 1, covenant_id: mergedGenesisCovId, authorizing_input: 3, script_hex: mergedTok.scriptHex },
    { value: 9_999_999_000, p2pk_pubkey: hex(FEE_PUBKEY) },
  ];
  const test = { tests: [{ name: 'A_held_transfer_owner_idx0', function: 'transfer', constructor_args: [POOL_VALUE, hex(SL_COV), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3], args: [[], '0x', [0]], expect: 'pass', tx: { active_input_index: 1, inputs, outputs } }] };
  const p = 'scratch/_j2_owneridx_check/vectorA.test.json';
  fs.writeFileSync(p, JSON.stringify(test, null, 1));
  const { status, capturedHex, stdout } = runDebugger(p, 'A_held_transfer_owner_idx0');
  console.log('=== A) held owner_input_idx=[0] ===');
  console.log('debugger exit status:', status);
  console.log('stdout tail:', stdout.slice(-300));
  console.log('captured hex:', capturedHex);
  const compiled = compileSilV100(KTT, [{ kind: 'int', value: POOL_VALUE }, { kind: 'bytes', value: SL_COV }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }], 'KanetTestToken');
  const entryAbi = compiled._raw.contracts.KanetTestToken.entries.transfer;
  const stateFieldCount = compiled._raw.contracts.KanetTestToken.runtime_state.fields.length;
  const myHex = encodeKttTransferZeroOutAction(kaspa, entryAbi, stateFieldCount, [0]).replace(/^0x/, '');
  console.log('my encoder hex:', myHex);
  console.log('MATCH:', capturedHex && capturedHex.toLowerCase() === myHex.toLowerCase());
}

// ===== B) 第一笔下注形状: [0]leaf [1]stake [2]fee, active=stake(1), owner_input_idx=[2] =====
{
  const POOL_VALUE = 0;
  const ctorArgs = sldCtor(POOL_VALUE);
  const active = compileSLD(ctorArgs, 'active_B');
  const stakeTok = compileKTT(STAKE_CHIP_OWNER_UNBOUND, STAKE, 'stake_B');
  const ticketOut = compileTicket({ bettorPk, direction: SIDE, stake: STAKE, shardPoolId: marketId }, 'ticketout_B');
  const contCtor = sldCtor(POOL_VALUE); contCtor[8] = STAKE; contCtor[10] = 1; contCtor[11] = POOL_VALUE + STAKE;
  const cont = compileSLD(contCtor, 'cont_B');
  const mergedTok = compileKTT(SL_COV, POOL_VALUE + STAKE, 'merged_B');
  const inputs = [
    { utxo_value: 1000, covenant_id: hex(SL_COV), utxo_script_hex: active.scriptHex, signature_script_hex: active.fullBytecodeHex },
    { utxo_value: 10, covenant_id: hex(STAKE_COV), utxo_script_hex: stakeTok.scriptHex, signature_script_hex: stakeTok.fullBytecodeHex },
    { utxo_value: 10_000_000_000, p2pk_pubkey: hex(FEE_PUBKEY) },
  ];
  const mergedGenesisCovId = computeGenesisCovId(2, 2, 1, mergedTok.scriptHex.slice(2));
  const outputs = [
    { value: 1000, covenant_id: hex(SL_COV), authorizing_input: 0, script_hex: cont.scriptHex },
    { value: 1, script_hex: ticketOut.scriptHex },
    { value: 1, covenant_id: mergedGenesisCovId, authorizing_input: 2, script_hex: mergedTok.scriptHex },
    { value: 9_999_999_000, p2pk_pubkey: hex(FEE_PUBKEY) },
  ];
  const test = { tests: [{ name: 'B_stake_transfer_owner_idx2', function: 'transfer', constructor_args: [STAKE, hex(STAKE_CHIP_OWNER_UNBOUND), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3], args: [[], '0x', [2]], expect: 'pass', tx: { active_input_index: 1, inputs, outputs } }] };
  const p = 'scratch/_j2_owneridx_check/vectorB.test.json';
  fs.writeFileSync(p, JSON.stringify(test, null, 1));
  const { status, capturedHex, stdout } = runDebugger(p, 'B_stake_transfer_owner_idx2');
  console.log('=== B) stake(first-bet) owner_input_idx=[2] ===');
  console.log('debugger exit status:', status);
  console.log('stdout tail:', stdout.slice(-300));
  console.log('captured hex:', capturedHex);
  const compiled = compileSilV100(KTT, [{ kind: 'int', value: STAKE }, { kind: 'bytes', value: STAKE_CHIP_OWNER_UNBOUND }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }], 'KanetTestToken');
  const entryAbi = compiled._raw.contracts.KanetTestToken.entries.transfer;
  const stateFieldCount = compiled._raw.contracts.KanetTestToken.runtime_state.fields.length;
  const myHex = encodeKttTransferZeroOutAction(kaspa, entryAbi, stateFieldCount, [2]).replace(/^0x/, '');
  console.log('my encoder hex:', myHex);
  console.log('MATCH:', capturedHex && capturedHex.toLowerCase() === myHex.toLowerCase());
}

// ===== C(Bettor回执补: 修复后的生产builder在第二笔下注形状里, stake作active时实际会走的字节,
// 不能用修复前用另一个入口做的旧引用代替) =====
// 第二笔下注形状: [0]leaf [1]held [2]stake [3]fee, active=stake(2), owner_input_idx=[3](=feeIdx)
{
  const POOL_VALUE = 100;
  const ctorArgs = sldCtor(POOL_VALUE);
  const active = compileSLD(ctorArgs, 'active_C');
  const heldTok = compileKTT(SL_COV, POOL_VALUE, 'held_C');
  const stakeTok = compileKTT(STAKE_CHIP_OWNER_UNBOUND, STAKE, 'stake_C');
  const ticketOut = compileTicket({ bettorPk, direction: SIDE, stake: STAKE, shardPoolId: marketId }, 'ticketout_C');
  const contCtor = sldCtor(POOL_VALUE); contCtor[8] = STAKE; contCtor[10] = 1; contCtor[11] = POOL_VALUE + STAKE;
  const cont = compileSLD(contCtor, 'cont_C');
  const mergedTok = compileKTT(SL_COV, POOL_VALUE + STAKE, 'merged_C');
  const inputs = [
    { utxo_value: 1000, covenant_id: hex(SL_COV), utxo_script_hex: active.scriptHex, signature_script_hex: active.fullBytecodeHex },
    { utxo_value: 10, covenant_id: hex(HELD_COV), utxo_script_hex: heldTok.scriptHex, signature_script_hex: heldTok.fullBytecodeHex },
    { utxo_value: 10, covenant_id: hex(STAKE_COV), utxo_script_hex: stakeTok.scriptHex, signature_script_hex: stakeTok.fullBytecodeHex },
    { utxo_value: 10_000_000_000, p2pk_pubkey: hex(FEE_PUBKEY) },
  ];
  const mergedGenesisCovId = computeGenesisCovId(3, 2, 1, mergedTok.scriptHex.slice(2));
  const outputs = [
    { value: 1000, covenant_id: hex(SL_COV), authorizing_input: 0, script_hex: cont.scriptHex },
    { value: 1, script_hex: ticketOut.scriptHex },
    { value: 1, covenant_id: mergedGenesisCovId, authorizing_input: 3, script_hex: mergedTok.scriptHex },
    { value: 9_999_999_000, p2pk_pubkey: hex(FEE_PUBKEY) },
  ];
  const test = { tests: [{ name: 'C_stake_transfer_owner_idx3_second_bet', function: 'transfer', constructor_args: [STAKE, hex(STAKE_CHIP_OWNER_UNBOUND), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3], args: [[], '0x', [3]], expect: 'pass', tx: { active_input_index: 2, inputs, outputs } }] };
  const p = 'scratch/_j2_owneridx_check/vectorC.test.json';
  fs.writeFileSync(p, JSON.stringify(test, null, 1));
  const { status, capturedHex, stdout } = runDebugger(p, 'C_stake_transfer_owner_idx3_second_bet');
  console.log('=== C) stake(second-bet) owner_input_idx=[3] ===');
  console.log('debugger exit status:', status);
  console.log('stdout tail:', stdout.slice(-300));
  console.log('captured hex:', capturedHex);
  const compiled = compileSilV100(KTT, [{ kind: 'int', value: STAKE }, { kind: 'bytes', value: STAKE_CHIP_OWNER_UNBOUND }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 }, { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 }, { kind: 'int', value: 3 }, { kind: 'int', value: 3 }], 'KanetTestToken');
  const entryAbi = compiled._raw.contracts.KanetTestToken.entries.transfer;
  const stateFieldCount = compiled._raw.contracts.KanetTestToken.runtime_state.fields.length;
  const myHex = encodeKttTransferZeroOutAction(kaspa, entryAbi, stateFieldCount, [3]).replace(/^0x/, '');
  console.log('my encoder hex:', myHex);
  console.log('MATCH:', capturedHex && capturedHex.toLowerCase() === myHex.toLowerCase());
}
