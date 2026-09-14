// mk_owner_unbound_vectors.mjs — 账本1436: stake 新铸筹码 owner=STAKE_CHIP_OWNER_UNBOUND(全零32字节)
// 的真实验证, 4条向量, 生产真实形状同一笔交易, 三脚本各执行一次(沿用2026-09-15-j2-register-append-
// full-tx-three-execution 的构造手法)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/node_modules/@noble/hashes/blake2b.js');
const kaspa = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/node_modules/kaspa-wasm/kaspa.js').href);

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
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console';
const SLD = `${CWD}/src/lib/ShardLeaf_direct.sil`;
const KTT = `${CWD}/src/lib/sil-v1/KanetTestToken.sil`;
const TICKET = `${CWD}/src/lib/sil-v1/PoolSideTicket.sil`;

const ZERO32 = new Array(32).fill(0);
const STAKE_CHIP_OWNER_UNBOUND = ZERO32; // 账本1436裁定值, 同 proto-covenant-builder.mjs 的具名常量
const SL_COV = new Array(32).fill(0x33);
const HELD_COV = new Array(32).fill(0x11);
const STAKE_COV = new Array(32).fill(0x22); // 只在③(回归固化的错误写法)里用作 stake.owner 的反例值
const FEE_PUBKEY = new Array(32).fill(0x88);

function compileGeneric(sil, ctor, tag) {
  const dir = 'scratch/_j2_ownerunbound_check';
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

function sldCtor(pool_value) {
  return [hex(marketId), hex(psTmplHash), hex(marketId), SEAL_COUNT, MIN_BET, hex(ZERO32), hex(ZERO32), hex(tokenTmplHash), 0, 0, 0, pool_value];
}

const STAKE = 20, SIDE = 0;
const bettorPk = new Array(32).fill(0x66);
const tests = [];

// ============ ①②③: 有 held 输入的常规场景(pool_value=100), 三种 stake.owner 写法对照 ============
// 交易结构固定: [0]leaf [1]held [2]stake [3]fee ; 输出 [0]leaf续约 [1]ticket [2]合并genesis [3]fee找零
function buildTxWithHeld({ tag, stakeOwner }) {
  const POOL_VALUE = 100;
  const ctorArgs = sldCtor(POOL_VALUE);
  const active = compileSLD(ctorArgs, `active_${tag}`);
  const heldTok = compileKTT(SL_COV, POOL_VALUE, `held_${tag}`);
  const stakeTok = compileKTT(stakeOwner, STAKE, `stake_${tag}`);
  const ticketOut = compileTicket({ bettorPk, direction: SIDE, stake: STAKE, shardPoolId: marketId }, `ticketout_${tag}`);

  const contCtor = sldCtor(POOL_VALUE);
  contCtor[8] = SIDE === 0 ? STAKE : 0;
  contCtor[9] = SIDE === 1 ? STAKE : 0;
  contCtor[10] = 1;
  contCtor[11] = POOL_VALUE + STAKE;
  const cont = compileSLD(contCtor, `cont_${tag}`);
  const mergedTok = compileKTT(SL_COV, POOL_VALUE + STAKE, `merged_${tag}`);

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
  const tx = { active_input_index: 0, inputs, outputs };
  const registerArgs = [SIDE, STAKE, 0, 1, hex(bettorPk), hex(ticketAnchor.prefix), hex(ticketAnchor.suffix), 2, 2, hex(tokAnchor.prefix), hex(tokAnchor.suffix)];
  return { ctorArgs, tx, registerArgs, stakeOwner };
}

// ①: stake.owner=ZERO32(STAKE_CHIP_OWNER_UNBOUND), owner_input_idx→fee输入(index3) ⇒ leaf/held/stake 全PASS
{
  const { ctorArgs, tx, registerArgs } = buildTxWithHeld({ tag: 'ok', stakeOwner: STAKE_CHIP_OWNER_UNBOUND });
  tests.push({ name: '①a_leaf_pass_owned_total_equals_pool_value', function: 'register_append', constructor_args: ctorArgs, args: registerArgs, expect: 'pass', tx: { ...tx, active_input_index: 0 } });
  tests.push({ name: '①b_held_transfer_zero_out_pass', function: 'transfer', constructor_args: [100, hex(SL_COV), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3], args: [[], '0x', [0]], expect: 'pass', tx: { ...tx, active_input_index: 1 } });
  tests.push({ name: '①c_stake_transfer_owner_unbound_via_fee_input_pass', function: 'transfer', constructor_args: [STAKE, hex(STAKE_CHIP_OWNER_UNBOUND), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3], args: [[], '0x', [3]], expect: 'pass', tx: { ...tx, active_input_index: 2 } });
}

// ②: stake.owner=ZERO32, 但 owner_input_idx 指向 leaf(index0, 有真实非零covenant_id) ⇒ stake 应该 FAIL(在场检查:84)
{
  const { tx } = buildTxWithHeld({ tag: 'wrongidx', stakeOwner: STAKE_CHIP_OWNER_UNBOUND });
  tests.push({ name: '②stake_transfer_owner_unbound_via_leaf_input_fail', function: 'transfer', constructor_args: [STAKE, hex(STAKE_CHIP_OWNER_UNBOUND), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3], args: [[], '0x', [0]], expect: 'fail', tx: { ...tx, active_input_index: 2 } });
}

// ③: 回归固化——stake.owner=leaf的covenant_id(SL_COV, 错误写法) ⇒ leaf 应该 FAIL(owned_total != pool_value)
{
  const { ctorArgs, tx, registerArgs } = buildTxWithHeld({ tag: 'regress', stakeOwner: SL_COV });
  tests.push({ name: '③leaf_fail_when_stake_owner_equals_leaf_cov_id_regression', function: 'register_append', constructor_args: ctorArgs, args: registerArgs, expect: 'fail', tx: { ...tx, active_input_index: 0 } });
}

// ============ ④: 第一笔下注(无 held 输入, pool_value=0) ⇒ leaf/stake PASS ============
// 交易结构改为: [0]leaf [1]stake [2]fee ; 输出 [0]leaf续约 [1]ticket [2]合并genesis(=纯stake,无held可并) [3]fee找零
{
  const POOL_VALUE = 0;
  const ctorArgs = sldCtor(POOL_VALUE);
  const active = compileSLD(ctorArgs, 'active_first');
  const stakeTok = compileKTT(STAKE_CHIP_OWNER_UNBOUND, STAKE, 'stake_first');
  const ticketOut = compileTicket({ bettorPk, direction: SIDE, stake: STAKE, shardPoolId: marketId }, 'ticketout_first');

  const contCtor = sldCtor(POOL_VALUE);
  contCtor[8] = SIDE === 0 ? STAKE : 0;
  contCtor[9] = SIDE === 1 ? STAKE : 0;
  contCtor[10] = 1;
  contCtor[11] = POOL_VALUE + STAKE;
  const cont = compileSLD(contCtor, 'cont_first');
  const mergedTok = compileKTT(SL_COV, POOL_VALUE + STAKE, 'merged_first');

  const inputs = [
    { utxo_value: 1000, covenant_id: hex(SL_COV), utxo_script_hex: active.scriptHex, signature_script_hex: active.fullBytecodeHex }, // 0: leaf
    { utxo_value: 10, covenant_id: hex(STAKE_COV), utxo_script_hex: stakeTok.scriptHex, signature_script_hex: stakeTok.fullBytecodeHex }, // 1: stake KTT(无held——第一笔下注)
    { utxo_value: 10_000_000_000, p2pk_pubkey: hex(FEE_PUBKEY) }, // 2: relay fee
  ];
  const mergedGenesisCovId = computeGenesisCovId(2, 2, 1, mergedTok.scriptHex.slice(2)); // authorizing_input=2(fee), output index=2(merged genesis 在 outputs[2])
  const outputs = [
    { value: 1000, covenant_id: hex(SL_COV), authorizing_input: 0, script_hex: cont.scriptHex }, // 0: leaf续约
    { value: 1, script_hex: ticketOut.scriptHex }, // 1: ticket genesis
    { value: 1, covenant_id: mergedGenesisCovId, authorizing_input: 2, script_hex: mergedTok.scriptHex }, // 2: 合并genesis(=纯stake, 无held可并)
    { value: 9_999_999_000, p2pk_pubkey: hex(FEE_PUBKEY) }, // 3: fee找零
  ];
  const tx = { active_input_index: 0, inputs, outputs };
  // register_append 参数序: side,stake,leafOutIdx,psOutIdx,bettorPk,ps_prefix,ps_suffix,stakeInIdx,tok_out,tok_prefix,tok_suffix
  // 无held ⇒ stakeInIdx=1(原held位置现在是stake), tok_out仍是2(合并genesis output index不变)
  const registerArgs = [SIDE, STAKE, 0, 1, hex(bettorPk), hex(ticketAnchor.prefix), hex(ticketAnchor.suffix), 1, 2, hex(tokAnchor.prefix), hex(tokAnchor.suffix)];

  tests.push({ name: '④a_leaf_first_bet_no_held_input_pass', function: 'register_append', constructor_args: ctorArgs, args: registerArgs, expect: 'pass', tx: { ...tx, active_input_index: 0 } });
  tests.push({ name: '④b_stake_first_bet_owner_unbound_via_fee_input_pass', function: 'transfer', constructor_args: [STAKE, hex(STAKE_CHIP_OWNER_UNBOUND), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3], args: [[], '0x', [2]], expect: 'pass', tx: { ...tx, active_input_index: 1 } });
}

fs.writeFileSync('../docs/provenance/2026-09-15-j2-stake-chip-owner-unbound-verification/owner_unbound_vectors.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
