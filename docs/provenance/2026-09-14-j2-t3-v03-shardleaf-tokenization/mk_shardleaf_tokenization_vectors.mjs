// ShardLeaf.sil T3 v0.3 §2 全 23 入口 A/B 落位表代币化(ledger 1188 批次④第二处): register_append(AB11
// 自续约, 归己既有持仓 scan + 新注 stakeTk 合法在场不计入)/ consolidate_to_payout(无续约, 全额转出真 PayoutShard)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const SL = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/ShardLeaf.sil';
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const TICKET = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/PoolSideStub.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const SL_COV = new Array(32).fill(0xee);
const PS_COV = new Array(32).fill(0xbb);
const STRANGER_COV = new Array(32).fill(0x99);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/SLT_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/SLT_${tag}.compiled.json`;
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
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'bytes', value: MARKET_TMPL_SUFFIX }, { kind: 'int', value: MARKET_TMPL_SUFFIX.length },
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

const tokAnchor = compileKTT(SL_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;
const shardPoolId = new Array(32).fill(0x33);
const ticketAnchor = compileTicket({ shardPoolId }, 'anchor');
const psTmplHash = ticketAnchor.templateHash;

const marketId = new Array(32).fill(0x11);
const SEAL_COUNT = 10;
const MIN_BET = 5;
const DEADLINE = 1700000000;

function slCtor(pool_value) {
  return [hex(marketId), hex(psTmplHash), hex(shardPoolId), SEAL_COUNT, MIN_BET, hex(PS_COV), DEADLINE, hex(tokenTmplHash), 0, 0, 0, pool_value];
}
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }

function toCtorObjs(arr) {
  return arr.map((v) => (typeof v === 'string' && v.startsWith('0x')) ? { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] } : { kind: 'int', value: v });
}
function compileSL(ctorArr, tag) { return compileGeneric(SL, toCtorObjs(ctorArr), `sl_${tag}`); }

const tests = [];

// ================= register_append =================
function buildRegisterScenario({ tag, pool_value = 0, side = 0, stake = 20, extraOwnedUncounted, divertOut, wrongOutAmount, belowDust, wrongField, wrongTokPrefix, wrongStakeAmount }) {
  const ctorArgs = slCtor(pool_value);
  const active = compileSL(ctorArgs, `active_${tag}`);
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

  // Continuation instance: a FRESH compiled ShardLeaf with ctor set to the new (post-register) state -- same
  // proven pattern as PayoutShard.absorb's psCont150/psCont150WrongClosed (compile the expected/wrong continuation
  // directly via ctor, use its real .scriptHex, never hand-reconstruct the P2SH bytes).
  const contCtor = slCtor(pool_value);
  contCtor[8] = (side === 0 ? stake : 0) + (wrongField === 'local_yes' ? 7 : 0);   // local_yes
  contCtor[9] = (side === 1 ? stake : 0) + (wrongField === 'local_no' ? 7 : 0);    // local_no
  contCtor[10] = wrongField === 'count' ? 999 : 1;                                 // count
  contCtor[11] = wrongField === 'pool_value' ? (pool_value + stake + 5) : (pool_value + stake);   // pool_value
  const cont = compileSL(contCtor, `cont_${tag}`);
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
tests.push({ name: 'V-register_append-2_pass_second_bet_nonzero_existing_pool', expect: 'pass', ...buildRegisterScenario({ tag: 'r2', pool_value: 100, side: 1, stake: 30 }) });
tests.push({ name: 'V-register_append-3_fail_smuggled_second_owned_token_uncounted', expect: 'fail', ...buildRegisterScenario({ tag: 'r3', pool_value: 100, side: 0, stake: 20, extraOwnedUncounted: true }) });
tests.push({ name: 'V-register_append-4_fail_output_diverted_to_stranger_owner', expect: 'fail', ...buildRegisterScenario({ tag: 'r4', pool_value: 100, side: 0, stake: 20, divertOut: true }) });
tests.push({ name: 'V-register_append-5_fail_output_wrong_amount', expect: 'fail', ...buildRegisterScenario({ tag: 'r5', pool_value: 100, side: 0, stake: 20, wrongOutAmount: true }) });
tests.push({ name: 'V-register_append-6_fail_self_output_below_dust_min', expect: 'fail', ...buildRegisterScenario({ tag: 'r6', pool_value: 100, side: 0, stake: 20, belowDust: true }) });
tests.push({ name: 'V-register_append-7_fail_self_continuation_wrong_count_field', expect: 'fail', ...buildRegisterScenario({ tag: 'r7', pool_value: 100, side: 0, stake: 20, wrongField: 'count' }) });
tests.push({ name: 'V-register_append-8_fail_self_continuation_wrong_pool_value_field', expect: 'fail', ...buildRegisterScenario({ tag: 'r8', pool_value: 100, side: 0, stake: 20, wrongField: 'pool_value' }) });
tests.push({ name: 'V-register_append-9_fail_witness_wrong_tok_prefix', expect: 'fail', ...buildRegisterScenario({ tag: 'r9', pool_value: 100, side: 0, stake: 20, wrongTokPrefix: [0xff] }) });
tests.push({ name: 'V-register_append-10_fail_stake_amount_mismatch', expect: 'fail', ...buildRegisterScenario({ tag: 'r10', pool_value: 100, side: 0, stake: 20, wrongStakeAmount: 21 }) });

// ================= consolidate_to_payout =================
function buildConsolidateScenario({ tag, pool_value = 300, count = SEAL_COUNT, sealed = true, extraOwnedUncounted, divertOut, wrongOutAmount, wrongTokPrefix }) {
  const ctorArgs = slCtor(pool_value).slice(); ctorArgs[8] = 0; ctorArgs[9] = 0; ctorArgs[10] = count; ctorArgs[11] = pool_value;
  const active = compileSL(ctorArgs, `caactive_${tag}`);
  const heldTok = compileKTT(SL_COV, pool_value, `cheld_${tag}`);
  const inputs = [
    { utxo_value: 1, covenant_id: hex(SL_COV), state: { local_yes: 0, local_no: 0, count, pool_value } },
    { utxo_value: 500, covenant_id: hex(PS_COV), signature_script_hex: '0x00' + 'ff'.repeat(20) },
    tokenInput(heldTok),
  ];
  if (extraOwnedUncounted) {
    const extra = compileKTT(SL_COV, 1, `cextra_${tag}`);
    inputs.push(tokenInput(extra));
  }
  const tokOutOwner = divertOut ? STRANGER_COV : PS_COV;
  const tokOut = compileKTT(tokOutOwner, wrongOutAmount ? pool_value + 1 : pool_value, `ctokout_${tag}`);
  const outputs = [
    { value: 1000, covenant_id: hex(PS_COV), authorizing_input: 1 },   // psOutIdx=0: PS's own state continuation, KAS dust only
    { value: 1, script_hex: tokOut.scriptHex },                        // tokenOutIdx=1: token transfer to PS's cov id
  ];
  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const tokSuffix = heldTok.suffix;
  const tx = { active_input_index: 0, inputs, outputs };
  if (!sealed) tx.lock_time = (DEADLINE + 1) * 1000;
  return {
    function: 'consolidate_to_payout',
    constructor_args: ctorArgs,
    args: [1, 0, 2, 1, hex(tokPrefix), hex(tokSuffix)],
    tx,
  };
}

tests.push({ name: 'V-consolidate_to_payout-1_pass_sealed_full_pool_transfer', expect: 'pass', ...buildConsolidateScenario({ tag: 'c1', pool_value: 300, count: SEAL_COUNT }) });
tests.push({ name: 'V-consolidate_to_payout-2_fail_outbind_token_diverted_to_stranger', expect: 'fail', ...buildConsolidateScenario({ tag: 'c2', pool_value: 300, count: SEAL_COUNT, divertOut: true }) });
tests.push({ name: 'V-consolidate_to_payout-3_fail_output_wrong_amount', expect: 'fail', ...buildConsolidateScenario({ tag: 'c3', pool_value: 300, count: SEAL_COUNT, wrongOutAmount: true }) });
tests.push({ name: 'V-consolidate_to_payout-4_fail_witness_wrong_tok_prefix', expect: 'fail', ...buildConsolidateScenario({ tag: 'c4', pool_value: 300, count: SEAL_COUNT, wrongTokPrefix: [0xff] }) });
tests.push({ name: 'V-consolidate_to_payout-5_fail_smuggled_second_owned_token_uncounted', expect: 'fail', ...buildConsolidateScenario({ tag: 'c5', pool_value: 300, count: SEAL_COUNT, extraOwnedUncounted: true }) });

fs.writeFileSync('scratch/_t1v06_check/ShardLeaf.tokenization.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
