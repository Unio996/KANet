// mk_full_tx_vectors.mjs — 账本1434②: register_append 生产真实形状的完整交易, 三个脚本(leaf/held/stake)
// 各自真实执行一次, 都要 PASS; 再加一个负向变体(合并输出 amount 少1 ⇒ leaf 执行失败, held/stake 照样 PASS)。
//
// 关键设计点(区别于 2026-09-14 既有14条向量——那批向量 active input 全是 leaf, held/stake 自己的脚本
// 从未真的执行过, 见 README): 合并输出改成【全新 genesis】(不是从 stakeInIdx 续约), owner=leaf 的
// covenant_id, authorizing_input 指向 fee 输入(账本1434③ 要求, 规避"authorizing input 本身是 covenant
// 输入"这个 debugger 未必完整模拟的未知项)。held/stake 的 owner_input_idx witness 参数指向 LEAF 的输入
// index(0), 不是它们自己的 index——因为 held/stake 的 State.owner 字段值是 leaf 的 covenant_id(bet_mint
// 步骤A ownerCovIdHex=shardLeafCovId 的既定设计), 不是它们自己的, 所以 OpInputCovenantId(owner_input_idx)
// 要读的是 leaf 那个 input 的 covenant_id 才能对上, 不是读它们自己的。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/node_modules/@noble/hashes/blake2b.js');
const kaspa = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/node_modules/kaspa-wasm/kaspa.js').href);

// 🔴 bisect 发现(2026-09-15): debugger 对"新建 genesis covenant 输出"是真消费 kaspa 共识层
// CovenantsContext 校验的(WrongGenesisCovenantId), 不能瞎填 covenant_id——必须用同一个纯函数
// kaspa.covenantId(authorizing_input 的 previous_outpoint, [{index, output}]) 现算出真实值。
// debugger 对没显式给 prev_txid 的输入用默认 outpoint = {transactionId: 32字节全为该输入index的
// 字节值, index:0}(main.rs:772-777 `default_prev_txid.fill(input_idx as u8)`)——第3号(fee)输入
// 因此默认 outpoint = {transactionId: '03'.repeat(32), index:0}, 与真实生产环境不同(生产环境是
// 真实 UTXO 的 outpoint), 但对"这个原语到底工作不工作"这个问题足够真实(用的是同一个consensus公式)。
function computeGenesisCovId(authInputIdx, outputIndex, valueSompi, scriptHexNo0x) {
  const byteHex = authInputIdx.toString(16).padStart(2, '0');
  const outpoint = { transactionId: byteHex.repeat(32), index: 0 }; // 32字节, 每字节=input_idx的原始字节值(main.rs:772-777)
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
const SL_COV = new Array(32).fill(0x33);      // leaf 自己的 covenant_id
const HELD_COV = new Array(32).fill(0x11);    // held 血统自己的 covenant_id(不同于 SL_COV, 不同于 STAKE_COV)
const STAKE_COV = new Array(32).fill(0x22);   // stake 血统自己的 covenant_id
const MERGED_COV = new Array(32).fill(0x99);  // 合并新代币自己的(全新)covenant_id

function compileGeneric(sil, ctor, tag) {
  const dir = 'scratch/_j2_fulltx_check';
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

const POOL_VALUE = 100, STAKE = 20, SIDE = 0;
const bettorPk = new Array(32).fill(0x66);

function buildFullTx({ tag, mergedAmountOffset = 0 }) {
  const ctorArgs = sldCtor(POOL_VALUE);
  const active = compileSLD(ctorArgs, `active_${tag}`);
  const heldTok = compileKTT(SL_COV, POOL_VALUE, `held_${tag}`);
  // 🔴 真实执行发现的设计更正(2026-09-15, 推翻本session更早对 computeKttGenesisArtifact 的假设):
  // stake 新铸筹码的 owner 字段绝不能等于 SL_COV——scanOwnedTokenInputs 是按 owner==SL_COV 扫描
  // 全部输入求和的, 若 stake.owner 也等于 SL_COV 会被同时计入(实测 owned_total=120=held100+stake20,
  // 而 require(owned_total==pool_value=100) 因此失败), 违反"新注 stakeTk 合法在场不计入"的设计原文
  // (ShardLeaf_direct.sil 头注)。正确设计: stake 自己 genesis 时 owner=STAKE_COV(自己的 covenant_id,
  // 自持有), 这样它自己的 transferPolicy 用 owner_input_idx=[自己的index]自证在场即可, 同时不会被
  // leaf 的 scanOwnedTokenInputs 计入(owner!=SL_COV)。bet_mint 步骤A(computeKttGenesisArtifact)的
  // ownerCovIdHex 参数因此不该照搬 shardLeafCovId——需要另开一票订正, 不在本笔范围内。
  const stakeTok = compileKTT(STAKE_COV, STAKE, `stake_${tag}`);
  const ticketOut = compileTicket({ bettorPk, direction: SIDE, stake: STAKE, shardPoolId: marketId }, `ticketout_${tag}`);

  const contCtor = sldCtor(POOL_VALUE);
  contCtor[8] = SIDE === 0 ? STAKE : 0;
  contCtor[9] = SIDE === 1 ? STAKE : 0;
  contCtor[10] = 1;
  contCtor[11] = POOL_VALUE + STAKE;
  const cont = compileSLD(contCtor, `cont_${tag}`);

  const mergedAmount = POOL_VALUE + STAKE + mergedAmountOffset;
  const mergedTok = compileKTT(SL_COV, mergedAmount, `merged_${tag}`); // 用来拿 scriptHex, ctor 里的 owner=SL_COV 即 State.owner

  // 🔴 bisect 发现(2026-09-15): held/stake 是 KanetTestToken 的输入, 被 ShardLeaf_direct 通过
  // readInputStateWithTemplate(foreign-template 内省)读取, 不是"本合约(ShardLeaf_direct)自己的
  // State"——如果给这些输入的 tx.inputs[i].state 字段传 KTT 的字段(amount/owner/...), 债务器会拿
  // 当前 active 合约(ShardLeaf_direct, State=local_yes/local_no/count/pool_value)的 struct 去解析,
  // 直接报 "struct field 'local_yes' must be initialized"——`state:` 这个测试 schema 糖只适用于
  // "本合约自己的续约 State"场景, 不适用于外部模板输入。foreign-template 输入必须像既有 14 条向量
  // 一样只给 utxo_script_hex/signature_script_hex(真实编译产物, 状态字节已经烤在里面), 让
  // readInputStateWithTemplate 自己去解析真实字节, 不要用 state: 语法糖。
  const inputs = [
    { utxo_value: 1000, covenant_id: hex(SL_COV), utxo_script_hex: active.scriptHex, signature_script_hex: active.fullBytecodeHex }, // 0: leaf
    { utxo_value: 10, covenant_id: hex(HELD_COV), utxo_script_hex: heldTok.scriptHex, signature_script_hex: heldTok.fullBytecodeHex }, // 1: held KTT(自己的血统 HELD_COV, State.owner=leaf 的 SL_COV, 已烤进 heldTok 真实编译产物)
    { utxo_value: 10, covenant_id: hex(STAKE_COV), utxo_script_hex: stakeTok.scriptHex, signature_script_hex: stakeTok.fullBytecodeHex }, // 2: stake KTT(自己的血统 STAKE_COV, State.owner=leaf 的 SL_COV, 同上已烤进真实编译产物)
    { utxo_value: 10_000_000_000, p2pk_pubkey: hex(new Array(32).fill(0x88)) }, // 3: relay fee(普通P2PK, 非covenant——账本1434③要求genesis authorizing input优先选这个)
  ];
  const mergedGenesisCovId = computeGenesisCovId(3, 2, 1, mergedTok.scriptHex.slice(2)); // authorizing_input=3(fee), output index=2, value=1
  const outputs = [
    { value: 1000, covenant_id: hex(SL_COV), authorizing_input: 0, script_hex: cont.scriptHex }, // 0: leaf 续约(CovenantBinding 到 leaf 自己)
    { value: 1, script_hex: ticketOut.scriptHex }, // 1: PoolSideTicket genesis(无covenant声明)
    { value: 1, covenant_id: mergedGenesisCovId, authorizing_input: 3, script_hex: mergedTok.scriptHex }, // 2: 合并 KTT genesis(真实consensus公式算出的covenant_id, authorizing_input=fee输入index3, 真实编译产物已烤 amount=mergedAmount/owner=leaf的SL_COV)
    { value: 9_999_999_000, p2pk_pubkey: hex(new Array(32).fill(0x88)) }, // 3: fee 找零
  ];

  const tx = { active_input_index: 0, inputs, outputs };
  const registerArgs = [SIDE, STAKE, 0, 1, hex(bettorPk), hex(ticketAnchor.prefix), hex(ticketAnchor.suffix), 2, 2, hex(tokAnchor.prefix), hex(tokAnchor.suffix)];
  return { ctorArgs, tx, registerArgs, heldTok, stakeTok, mergedTok };
}

const tests = [];

// ============ 正向(mergedAmountOffset=0, 三个脚本各自 PASS 一次) ============
{
  const { ctorArgs, tx, registerArgs } = buildFullTx({ tag: 'pos' });
  tests.push({
    name: '①leaf_register_append_pass', function: 'register_append', constructor_args: ctorArgs, args: registerArgs, expect: 'pass',
    tx: { ...tx, active_input_index: 0 },
  });
  tests.push({
    name: '②held_transfer_zero_out_pass', function: 'transfer',
    constructor_args: [POOL_VALUE, hex(SL_COV), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3],
    args: [[], '0x', [0]], expect: 'pass',
    tx: { ...tx, active_input_index: 1 },
  });
  tests.push({
    name: '③stake_transfer_zero_out_pass', function: 'transfer',
    constructor_args: [STAKE, hex(STAKE_COV), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3],
    args: [[], '0x', [2]], expect: 'pass',
    tx: { ...tx, active_input_index: 2 },
  });
}

// ============ 负向: 合并输出 amount 少 1 ⇒ leaf 执行失败; held/stake 照样 PASS ============
{
  const { ctorArgs, tx, registerArgs } = buildFullTx({ tag: 'neg', mergedAmountOffset: -1 });
  tests.push({
    name: '④leaf_register_append_wrong_merged_amount_fail', function: 'register_append', constructor_args: ctorArgs, args: registerArgs, expect: 'fail',
    tx: { ...tx, active_input_index: 0 },
  });
  tests.push({
    name: '⑤held_transfer_zero_out_still_pass_when_leaf_output_wrong', function: 'transfer',
    constructor_args: [POOL_VALUE, hex(SL_COV), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3],
    args: [[], '0x', [0]], expect: 'pass',
    tx: { ...tx, active_input_index: 1 },
  });
  tests.push({
    name: '⑥stake_transfer_zero_out_still_pass_when_leaf_output_wrong', function: 'transfer',
    constructor_args: [STAKE, hex(STAKE_COV), 4, 0, hex(ZERO32), hex(ZERO32), 3, 3],
    args: [[], '0x', [2]], expect: 'pass',
    tx: { ...tx, active_input_index: 2 },
  });
}

fs.writeFileSync('../docs/provenance/2026-09-15-j2-register-append-full-tx-three-execution/full_tx_vectors.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
