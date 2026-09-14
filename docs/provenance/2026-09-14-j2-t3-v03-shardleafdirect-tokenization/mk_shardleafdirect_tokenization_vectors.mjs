// ShardLeaf_direct.sil T3 v0.3 §2 全 23 入口 A/B 落位表代币化(ledger 1188 批次④第三处, "同 RootClose 形"):
// register_append(同 ShardLeaf.sil AB11 处置) / convert_to_rootclose(同 RootClose.convert_to_claim ZERO32
// 目的地守卫 + A 类全池转出, 新建 RootClose 实例)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const SLD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/ShardLeaf_direct.sil';
const RC = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/RootClose.sil';
// 🔴 更新(2026-09-15, 账本 1408/1409/1410/1413, Owner 裁定撤销 H1(b)"代币就是代币"·v0.3 方案C): 原先指向的
// KTT 是删除前的旧设计(10 ctor 字段, 含 market_tmpl_suffix/market_tmpl_suffix_len)——那个机制已被 Owner
// 撤销、NWT 终核 GREEN、批准落生产。改指向 v0.3(方案C)副本(8 ctor 字段, 已用真实 cli-debugger 验证过 2
// 条 KTT 向量 + 4 条 KanetTokenClaim 端到端向量, 见同目录 provenance)。ShardLeaf_direct/RootClose 这两份
// T3 文件本身不需要改(token_tmpl_hash 留 ctor 是 Owner 1408 裁定的既定方向, 没有变), 只是它们读的外部
// KTT 模板形状变了, 必须用新形状重新编译取新的 template_hash 并重跑这批向量, 否则向量验证的是一个已经
// 不存在的旧协议形状。
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/KanetTestToken.v0.3-planC.sil';
const TICKET = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/PoolSideStub.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const SL_COV = new Array(32).fill(0xee);
const STRANGER_COV = new Array(32).fill(0x99);

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/SLD_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/SLD_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${sil}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}
// v0.3(方案C) ctor: 8 字段, market_tmpl_suffix/market_tmpl_suffix_len 已删除(H1(b) 撤销)。
function compileKTT(ownerCov, amount, tag) {
  const ctor = [
    { kind: 'int', value: amount }, { kind: 'bytes', value: ownerCov }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'int', value: 3 }, { kind: 'int', value: 3 },
  ];
  return compileGeneric(KTT, ctor, `ktt_${tag}`);
}
function compileTicket({ bettorPk = ZERO32, direction = 0, stake = 0, shardPoolId }, tag) {
  const ctor = [
    { kind: 'bytes', value: bettorPk }, { kind: 'int', value: direction }, { kind: 'int', value: stake }, { kind: 'bytes', value: shardPoolId },
  ];
  return compileGeneric(TICKET, ctor, `ticket_${tag}`);
}
// RootClose.sil 12-参数 ctor(v0.3 代币化后现形): committee_hash, deadline_ms, claim_tmpl_hash,
// refundclaim_tmpl_hash, token_tmpl_hash, init_local_yes/no/count/pool_value, init_closed, init_winningSide,
// init_payoutRoot。
function compileRootCloseInstance({ local_yes = 0, local_no = 0, count = 0, pool_value = 0, closed = 0, winningSide = 0, payoutRoot = ZERO32 }, tag) {
  const ctor = [
    { kind: 'bytes', value: ZERO32 }, { kind: 'int', value: 1700000000000 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'int', value: local_yes }, { kind: 'int', value: local_no }, { kind: 'int', value: count },
    { kind: 'int', value: pool_value }, { kind: 'int', value: closed }, { kind: 'int', value: winningSide },
    { kind: 'bytes', value: payoutRoot },
  ];
  return compileGeneric(RC, ctor, `rc_${tag}`);
}

const tokAnchor = compileKTT(SL_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;
const shardPoolId = new Array(32).fill(0x33);
const ticketAnchor = compileTicket({ shardPoolId }, 'anchor');
const psTmplHash = ticketAnchor.templateHash;
const rcAnchor = compileRootCloseInstance({}, 'anchor');
const rootcloseTmplHash = rcAnchor.templateHash;

const marketId = new Array(32).fill(0x11);
const SEAL_COUNT = 1;   // DoD single-shard
const MIN_BET = 5;

function sldCtor(pool_value) {
  return [hex(marketId), hex(psTmplHash), hex(shardPoolId), SEAL_COUNT, MIN_BET, hex(rootcloseTmplHash), hex(ZERO32), hex(tokenTmplHash), 0, 0, 0, pool_value];
}
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function toCtorObjs(arr) {
  return arr.map((v) => (typeof v === 'string' && v.startsWith('0x')) ? { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] } : { kind: 'int', value: v });
}
function compileSLD(ctorArr, tag) { return compileGeneric(SLD, toCtorObjs(ctorArr), `sld_${tag}`); }

const tests = [];

// ================= register_append (byte-identical processing to ShardLeaf.sil) =================
function buildRegisterScenario({ tag, pool_value = 0, side = 0, stake = 20, extraOwnedUncounted, divertOut, wrongOutAmount, belowDust, wrongField, wrongTokPrefix, wrongStakeAmount }) {
  const ctorArgs = sldCtor(pool_value);
  const active = compileSLD(ctorArgs, `active_${tag}`);
  const heldTok = compileKTT(SL_COV, pool_value, `held_${tag}`);
  const bettorPk = new Array(32).fill(0x44);
  const ticketOut = compileTicket({ bettorPk, direction: side, stake, shardPoolId }, `ticketout_${tag}`);
  const stakeAmountWitness = wrongStakeAmount !== undefined ? wrongStakeAmount : stake;
  const stakeTok = compileKTT(new Array(32).fill(0x77), stakeAmountWitness, `stake_${tag}`);

  const activeSelfInput = { utxo_value: 1000, covenant_id: hex(SL_COV), utxo_script_hex: active.scriptHex, signature_script_hex: active.fullBytecodeHex };
  const inputs = [activeSelfInput, tokenInput(heldTok), tokenInput(stakeTok)];
  if (extraOwnedUncounted) {
    const extra = compileKTT(SL_COV, 1, `extra_${tag}`);
    inputs.push(tokenInput(extra));
  }

  const newPoolValueForOut = wrongOutAmount ? (pool_value + stake + 1) : (pool_value + stake);
  const tokOutOwner = divertOut ? STRANGER_COV : SL_COV;
  const tokOut = compileKTT(tokOutOwner, newPoolValueForOut, `tokout_${tag}`);

  const contCtor = sldCtor(pool_value);
  contCtor[8] = (side === 0 ? stake : 0) + (wrongField === 'local_yes' ? 7 : 0);
  contCtor[9] = (side === 1 ? stake : 0) + (wrongField === 'local_no' ? 7 : 0);
  contCtor[10] = wrongField === 'count' ? 999 : 1;
  contCtor[11] = wrongField === 'pool_value' ? (pool_value + stake + 5) : (pool_value + stake);
  const cont = compileSLD(contCtor, `cont_${tag}`);
  const leafValue = belowDust ? 1 : 1000;

  const outputs = [
    { value: leafValue, script_hex: cont.scriptHex },
    { value: 1, script_hex: ticketOut.scriptHex },
    { value: 1, script_hex: tokOut.scriptHex },
  ];

  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const tokSuffix = heldTok.suffix;

  return {
    function: 'register_append',
    constructor_args: ctorArgs,
    args: [side, stake, 0, 1, hex(bettorPk), hex(ticketAnchor.prefix), hex(ticketAnchor.suffix), 2, 2, hex(tokPrefix), hex(tokSuffix)],
    tx: { active_input_index: 0, inputs, outputs },
  };
}

tests.push({ name: 'V-register_append-1_pass_first_bet_zero_existing_pool', expect: 'pass', ...buildRegisterScenario({ tag: 'r1', pool_value: 0, side: 0, stake: 20 }) });
tests.push({ name: 'V-register_append-2_fail_smuggled_second_owned_token_uncounted', expect: 'fail', ...buildRegisterScenario({ tag: 'r2', pool_value: 100, side: 0, stake: 20, extraOwnedUncounted: true }) });
tests.push({ name: 'V-register_append-3_fail_output_diverted_to_stranger_owner', expect: 'fail', ...buildRegisterScenario({ tag: 'r3', pool_value: 100, side: 0, stake: 20, divertOut: true }) });
tests.push({ name: 'V-register_append-4_fail_output_wrong_amount', expect: 'fail', ...buildRegisterScenario({ tag: 'r4', pool_value: 100, side: 0, stake: 20, wrongOutAmount: true }) });
tests.push({ name: 'V-register_append-5_fail_self_output_below_dust_min', expect: 'fail', ...buildRegisterScenario({ tag: 'r5', pool_value: 100, side: 0, stake: 20, belowDust: true }) });
tests.push({ name: 'V-register_append-6_fail_self_continuation_wrong_pool_value_field', expect: 'fail', ...buildRegisterScenario({ tag: 'r6', pool_value: 100, side: 0, stake: 20, wrongField: 'pool_value' }) });
tests.push({ name: 'V-register_append-7_fail_witness_wrong_tok_prefix', expect: 'fail', ...buildRegisterScenario({ tag: 'r7', pool_value: 100, side: 0, stake: 20, wrongTokPrefix: [0xff] }) });
tests.push({ name: 'V-register_append-8_fail_stake_amount_mismatch', expect: 'fail', ...buildRegisterScenario({ tag: 'r8', pool_value: 100, side: 0, stake: 20, wrongStakeAmount: 21 }) });

// ================= convert_to_rootclose (ZERO32 guard + A-class full-pool transfer, new RootClose genesis) =================
const rcCovId = new Array(32).fill(0xdd);
function rcFillerInput() { return { utxo_value: 1, covenant_id: hex(rcCovId), signature_script_hex: '0x00ff' }; }

function buildConvertScenario({ tag, pool_value = 100, divertOut, wrongOutAmount, wrongTemplate, bareOutput, wrongTokPrefix, extraSmuggled }) {
  const ctorArgs = sldCtor(pool_value).slice(); ctorArgs[8] = 0; ctorArgs[9] = 0; ctorArgs[10] = SEAL_COUNT; ctorArgs[11] = pool_value;
  const active = compileSLD(ctorArgs, `caactive_${tag}`);
  const heldTok = compileKTT(SL_COV, pool_value, `cheld_${tag}`);
  const realTarget = compileRootCloseInstance({ count: SEAL_COUNT, pool_value, closed: 0, winningSide: 0, payoutRoot: ZERO32 }, tag);
  const fakeTarget = wrongTemplate ? compileTicket({ shardPoolId }, `faketmpl_${tag}`) : null;   // wrong-shape stand-in (not a real RootClose)
  const target = fakeTarget || realTarget;

  const activeSelfInput = { utxo_value: 1000, covenant_id: hex(SL_COV), utxo_script_hex: active.scriptHex, signature_script_hex: active.fullBytecodeHex };
  const inputs = [activeSelfInput, rcFillerInput(), tokenInput(heldTok)];
  let tokenInIdx = 2;
  if (extraSmuggled) {
    const extra = compileKTT(SL_COV, 1, `extra_${tag}`);
    inputs.push(tokenInput(extra));
  }

  const tokOutOwner = divertOut ? STRANGER_COV : rcCovId;
  const tokOut = compileKTT(tokOutOwner, wrongOutAmount ? pool_value + 1 : pool_value, `ctokout_${tag}`);

  const outputs = [];
  if (bareOutput) {
    outputs.push({ value: 1000, script_hex: target.scriptHex });
  } else {
    outputs.push({ value: 1000, covenant_id: hex(rcCovId), authorizing_input: 1, script_hex: target.scriptHex });
  }
  outputs.push({ value: 1, script_hex: tokOut.scriptHex });

  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const tokSuffix = heldTok.suffix;

  return {
    function: 'convert_to_rootclose',
    constructor_args: ctorArgs,
    args: [0, hex(rcAnchor.prefix), hex(rcAnchor.suffix), tokenInIdx, 1, hex(tokPrefix), hex(tokSuffix)],
    tx: { active_input_index: 0, inputs, outputs },
  };
}

tests.push({ name: 'V-convert_to_rootclose-1_pass_real_bridge_full_pool_token_out', expect: 'pass', ...buildConvertScenario({ tag: 'pass', pool_value: 100 }) });
tests.push({ name: 'V-convert_to_rootclose-2_fail_bare_output_no_covenant_id_zero32', expect: 'fail', ...buildConvertScenario({ tag: 'bare', pool_value: 100, bareOutput: true }) });
tests.push({ name: 'V-convert_to_rootclose-3_fail_fake_template_shell', expect: 'fail', ...buildConvertScenario({ tag: 'fake', pool_value: 100, wrongTemplate: true }) });
tests.push({ name: 'V-convert_to_rootclose-4_fail_outbind_token_diverted_to_stranger', expect: 'fail', ...buildConvertScenario({ tag: 'divert', pool_value: 100, divertOut: true }) });
tests.push({ name: 'V-convert_to_rootclose-5_fail_witness_wrong_tok_prefix', expect: 'fail', ...buildConvertScenario({ tag: 'wtok', pool_value: 100, wrongTokPrefix: [0xff] }) });
tests.push({ name: 'V-convert_to_rootclose-6_fail_smuggled_second_owned_token_uncounted', expect: 'fail', ...buildConvertScenario({ tag: 'smuggle', pool_value: 100, extraSmuggled: true }) });

fs.writeFileSync('scratch/_t1v06_check/ShardLeafDirect.tokenization.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');

// ---------- mass/witness quantification for the README (Bettor 1190/1191 ask) ----------
const rcPrefixLen = rcAnchor.prefix.length, rcSuffixLen = rcAnchor.suffix.length;
const totalWitnessBytes = rcPrefixLen + rcSuffixLen;
console.log(JSON.stringify({ rootclose_bytecode_length: rcAnchor.bc.length, rc_prefix_len: rcPrefixLen, rc_suffix_len: rcSuffixLen, total_witness_bytes: totalWitnessBytes }));
