// ShardLeaf.consolidate_to_payout <-> PayoutShard.absorb hand-off MUST-FIX (NWT ledger 1196, Bettor 1197
// 批 (b)): consolidate_to_payout 不再自建 tokenOutIdx(owner=ps_cov)——那一步 relabel 完整交给 absorb 自己的
// tok_out 一步做完(结构上必须如此: KanetTestToken.transferPolicy 的 (b-in) 路由检查要求新输出 owner=X 时 X
// 的 covenant 输入须在同笔交易在场, 逼出 consolidate_to_payout 与 absorb 必须同笔原子; 若 consolidate_to_payout
// 自己再造一个 owner=ps_cov 的中间态输出, 要么时序不可能[本笔输出不能被本笔另一入口当输入读], 要么[若真同笔]
// 把 pool_value 这份钱在两个输出里各代表一次)。consolidate_to_payout 收窄为纯输入侧核对:
// scanOwnedTokenInputs()==pool_value, 证明"这就是 absorb 会读的 shardInIdx 那笔"。
//
// 跨合约验证形状: cli-debugger 一次只测一个合约的一个入口——用同一份 tx JSON 分别喂 ShardLeaf.sil(测
// consolidate_to_payout) 与 PayoutShard.sil(测 absorb), 两边各自独立 PASS, 等价于链上两个 covenant 各自
// 独立验证同一笔交易(真实共识模型本就是这样, 不是简化)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildMerkle, proveMerkle, root, hex, le8 } from '../2026-09-14-j2-t3-v03-drawdown-mustfix/merkle.mjs';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const SL = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/ShardLeaf.sil';
const PS = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/PayoutShard.sil';
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const TICKET = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/PoolSideStub.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const SL_COV = new Array(32).fill(0xee);
const PS_COV = new Array(32).fill(0xaa);
const STRANGER_COV = new Array(32).fill(0x99);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/HOF_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/HOF_${tag}.compiled.json`;
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

function slCtor({ pool_value, count = SEAL_COUNT }) {
  return [hex(marketId), hex(psTmplHash), hex(shardPoolId), SEAL_COUNT, MIN_BET, hex(PS_COV), DEADLINE, hex(tokenTmplHash), 0, 0, count, pool_value];
}
function toCtorObjs(arr) {
  return arr.map((v) => (typeof v === 'string' && v.startsWith('0x')) ? { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] } : { kind: 'int', value: v });
}
function compileSL(ctorArr, tag) { return compileGeneric(SL, toCtorObjs(ctorArr), `sl_${tag}`); }

function psCtor({ consolidated_pool, closed = 0, payoutRoot = ZERO32, w = new Array(17).fill(0) }) {
  return [hex(ZERO32), hex(ZERO32), hex(tokenTmplHash), consolidated_pool, closed, hex(payoutRoot), ...w, hex(ZERO32), hex(ZERO32)];
}
function compilePS(ctorOverrides, tag) { return compileGeneric(PS, toCtorObjs(psCtor(ctorOverrides)), `ps_${tag}`); }

function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }

// ---------------- Scenario builder ----------------
// Shared tx: inputs = [SL leaf covenant(0), SL held token owner=SL_COV(1), PS covenant(2), PS held token
// owner=PS_COV(3), optional extra(4)]; outputs = [PS state continuation(0), PS combined tok_out(1)].
function buildSharedTx({ tag, slPool = 50, psPool = 100, extraOwnedByPS, extraOwnedBySL, wrongTokOutAmount, wrongTokOutOwner, undercountShardAmount }) {
  const slActive = compileSL(slCtor({ pool_value: slPool }), `slactive_${tag}`);
  const slHeldTok = compileKTT(SL_COV, slPool, `slheld_${tag}`);
  const psActive = compilePS({ consolidated_pool: psPool }, `psactive_${tag}`);
  const psHeldTok = compileKTT(PS_COV, psPool, `psheld_${tag}`);

  const inputs = [
    { utxo_value: 1000, covenant_id: hex(SL_COV), utxo_script_hex: slActive.scriptHex, signature_script_hex: slActive.fullBytecodeHex },
    tokenInput(slHeldTok),
    { utxo_value: 1000, covenant_id: hex(PS_COV), utxo_script_hex: psActive.scriptHex, signature_script_hex: psActive.fullBytecodeHex },
    tokenInput(psHeldTok),
  ];
  if (extraOwnedByPS) {
    const extra = compileKTT(PS_COV, 1, `extraps_${tag}`);
    inputs.push(tokenInput(extra));
  }
  if (extraOwnedBySL) {
    const extra = compileKTT(SL_COV, 1, `extrasl_${tag}`);
    inputs.push(tokenInput(extra));
  }

  const shardAmountClaimed = undercountShardAmount !== undefined ? undercountShardAmount : slPool;
  const combinedAmount = wrongTokOutAmount !== undefined ? wrongTokOutAmount : (psPool + slPool);
  const tokOutOwner = wrongTokOutOwner || PS_COV;
  const psCont = compilePS({ consolidated_pool: psPool + slPool }, `pscont_${tag}`);
  const tokOut = compileKTT(tokOutOwner, combinedAmount, `tokout_${tag}`);

  const outputs = [
    { value: 1000, covenant_id: hex(PS_COV), authorizing_input: 2, script_hex: psCont.scriptHex },
    { value: 1, script_hex: tokOut.scriptHex },
  ];

  return {
    slHeldTok, psHeldTok,
    slArgs: [2, 0, hex(slHeldTok.prefix), hex(slHeldTok.suffix)],
    slCtorArgs: slCtor({ pool_value: slPool }),
    psArgs: [0, 1, 1, shardAmountClaimed, hex(psHeldTok.prefix), hex(psHeldTok.suffix)],
    psCtorArgs: psCtor({ consolidated_pool: psPool }),
    tx: { inputs, outputs },
  };
}

const slTests = [];
const psTests = [];

// ---- V-HOF-1: shared-tx cross-contract acceptance. Both sides independently PASS on the SAME tx data. ----
{
  const s = buildSharedTx({ tag: 'accept', slPool: 50, psPool: 100 });
  slTests.push({
    name: 'V-HOF-1_pass_shardleaf_side_consolidate_to_payout',
    function: 'consolidate_to_payout',
    constructor_args: s.slCtorArgs,
    args: s.slArgs,
    expect: 'pass',
    tx: { active_input_index: 0, ...s.tx },
  });
  psTests.push({
    name: 'V-HOF-1_pass_payoutshard_side_absorb_same_tx',
    function: 'absorb',
    constructor_args: s.psCtorArgs,
    args: s.psArgs,
    expect: 'pass',
    tx: { active_input_index: 2, ...s.tx },
  });
}

// ---- V-HOF-2: "next absorb" -- the just-merged token (now genuinely owned by PS_COV, amount=150) is
// correctly counted as PS's own held token in a SUBSEQUENT absorb call (owned_total==consolidated_pool). ----
{
  const psPool2 = 150;   // the merged total from V-HOF-1
  const psActive2 = compilePS({ consolidated_pool: psPool2 }, 'ps2active');
  const psHeldTok2 = compileKTT(PS_COV, psPool2, 'ps2held');   // this IS the V-HOF-1 tok_out, now an ordinary owned input
  const shard2 = compileKTT(new Array(32).fill(0x77), 20, 'ps2shard');   // a further new incoming shard
  const psCont2 = compilePS({ consolidated_pool: psPool2 + 20 }, 'ps2cont');
  const tokOut2 = compileKTT(PS_COV, psPool2 + 20, 'ps2tokout');
  const inputs2 = [
    tokenInput(psHeldTok2),
    { utxo_value: 1000, covenant_id: hex(PS_COV), utxo_script_hex: psActive2.scriptHex, signature_script_hex: psActive2.fullBytecodeHex },
    tokenInput(shard2),
  ];
  const outputs2 = [
    { value: 1000, script_hex: psCont2.scriptHex },
    { value: 1, script_hex: tokOut2.scriptHex },
  ];
  psTests.push({
    name: 'V-HOF-2_pass_next_absorb_correctly_counts_merged_token',
    function: 'absorb',
    constructor_args: psCtor({ consolidated_pool: psPool2 }),
    args: [0, 2, 1, 20, hex(psHeldTok2.prefix), hex(psHeldTok2.suffix)],
    expect: 'pass',
    tx: { active_input_index: 1, inputs: inputs2, outputs: outputs2 },
  });
}

// ---- V-HOF-3: negative -- smuggled second owned token on PS's side, not reflected in consolidated_pool. ----
{
  const s = buildSharedTx({ tag: 'smuggle', slPool: 50, psPool: 100, extraOwnedByPS: true });
  psTests.push({
    name: 'V-HOF-3_fail_smuggled_second_owned_token_uncounted',
    function: 'absorb',
    constructor_args: s.psCtorArgs,
    args: s.psArgs,
    expect: 'fail',
    tx: { active_input_index: 2, ...s.tx },
  });
}

// ---- V-HOF-4: negative -- shard_amount witness undercounts the real held-by-SL token amount. ----
{
  const s = buildSharedTx({ tag: 'undercount', slPool: 50, psPool: 100, undercountShardAmount: 30 });
  psTests.push({
    name: 'V-HOF-4_fail_shard_amount_undercount_mismatch',
    function: 'absorb',
    constructor_args: s.psCtorArgs,
    args: s.psArgs,
    expect: 'fail',
    tx: { active_input_index: 2, ...s.tx },
  });
}

// ---- V-HOF-5: ShardLeaf-side negative -- leaf's own scan doesn't match pool_value (smuggled extra on SL side). ----
{
  const s = buildSharedTx({ tag: 'slsmuggle', slPool: 50, psPool: 100, extraOwnedBySL: true });
  slTests.push({
    name: 'V-HOF-5_fail_shardleaf_smuggled_second_owned_token_uncounted',
    function: 'consolidate_to_payout',
    constructor_args: s.slCtorArgs,
    args: s.slArgs,
    expect: 'fail',
    tx: { active_input_index: 0, ...s.tx },
  });
}

// ================= Codex ledger 1198: five additional negative vectors =================

// ---- V-HOF-6: ShardLeaf-side negative -- psInIdx points at a FAKE PS (covenant id != payout_cov_id). ----
{
  const slPool = 50;
  const slActive = compileSL(slCtor({ pool_value: slPool }), 'fakeps_slactive');
  const slHeldTok = compileKTT(SL_COV, slPool, 'fakeps_slheld');
  const fakePsActive = compilePS({ consolidated_pool: 100 }, 'fakeps_active');   // real PS shape, but declared under a DIFFERENT covenant_id below
  const fakePsHeldTok = compileKTT(STRANGER_COV, 100, 'fakeps_held');
  const psCont = compilePS({ consolidated_pool: 150 }, 'fakeps_cont');
  const tokOut = compileKTT(PS_COV, 150, 'fakeps_tokout');
  const inputs = [
    { utxo_value: 1000, covenant_id: hex(SL_COV), utxo_script_hex: slActive.scriptHex, signature_script_hex: slActive.fullBytecodeHex },
    tokenInput(slHeldTok),
    { utxo_value: 1000, covenant_id: hex(STRANGER_COV), utxo_script_hex: fakePsActive.scriptHex, signature_script_hex: fakePsActive.fullBytecodeHex },   // FAKE: declares STRANGER_COV, not payout_cov_id=PS_COV
    tokenInput(fakePsHeldTok),
  ];
  const outputs = [
    { value: 1000, covenant_id: hex(STRANGER_COV), authorizing_input: 2, script_hex: psCont.scriptHex },
    { value: 1, script_hex: tokOut.scriptHex },
  ];
  slTests.push({
    name: 'V-HOF-6_fail_wrong_ps_covenant_id_fake_ps',
    function: 'consolidate_to_payout',
    constructor_args: slCtor({ pool_value: slPool }),
    args: [2, 0, hex(slHeldTok.prefix), hex(slHeldTok.suffix)],
    expect: 'fail',
    tx: { active_input_index: 0, inputs, outputs },
  });
}

// ---- V-HOF-7: PayoutShard-side negative -- duplicate shard-shaped token present; tok_out inflated as if
// crediting BOTH, while shard_amount/shardInIdx only proves ONE. ----
{
  const s = buildSharedTx({ tag: 'dupshard', slPool: 50, psPool: 100 });
  // Add a SECOND independent "shard-looking" token (same template, same amount, different/no owner) alongside
  // the real shardInIdx=1 token, then inflate tok_out's amount as if both were absorbed.
  const dup = compileKTT(new Array(32).fill(0x77), 50, 'dupshard_extra');
  const inputsWithDup = [...s.tx.inputs, tokenInput(dup)];
  const inflatedTokOut = compileKTT(PS_COV, 200, 'dupshard_inflated_tokout');   // 100 + 50 + 50, crediting the duplicate too
  const outputsInflated = [s.tx.outputs[0], { value: 1, script_hex: inflatedTokOut.scriptHex }];
  psTests.push({
    name: 'V-HOF-7_fail_duplicate_shard_token_inflated_output',
    function: 'absorb',
    constructor_args: s.psCtorArgs,
    args: [0, 1, 1, 50, hex(s.psHeldTok.prefix), hex(s.psHeldTok.suffix)],   // shard_amount still correctly 50 (only shardInIdx=1's real amount)
    expect: 'fail',
    tx: { active_input_index: 2, inputs: inputsWithDup, outputs: outputsInflated },
  });
}

// ---- V-HOF-8: PayoutShard-side negative -- tok_out amount just wrong (neither undercount-witness nor
// duplicate-credit framing, plain arithmetic mismatch on the combined total). ----
{
  const s = buildSharedTx({ tag: 'wrongamt', slPool: 50, psPool: 100, wrongTokOutAmount: 999 });
  psTests.push({
    name: 'V-HOF-8_fail_wrong_output_amount',
    function: 'absorb',
    constructor_args: s.psCtorArgs,
    args: s.psArgs,
    expect: 'fail',
    tx: { active_input_index: 2, ...s.tx },
  });
}

// ---- V-HOF-9: PayoutShard-side negative -- missing continuation (selfOutIdx's scriptPubKey does not match
// any valid PS continuation encoding -- AB11 hand-written comparison must reject). ----
{
  const s = buildSharedTx({ tag: 'missingcont', slPool: 50, psPool: 100 });
  const wrongCont = compilePS({ consolidated_pool: 999999 }, 'missingcont_wrong');   // does not match the real expected continuation (150)
  const outputsBad = [{ value: 1000, covenant_id: hex(PS_COV), authorizing_input: 2, script_hex: wrongCont.scriptHex }, s.tx.outputs[1]];
  psTests.push({
    name: 'V-HOF-9_fail_missing_continuation_scriptpubkey_mismatch',
    function: 'absorb',
    constructor_args: s.psCtorArgs,
    args: s.psArgs,
    expect: 'fail',
    tx: { active_input_index: 2, inputs: s.tx.inputs, outputs: outputsBad },
  });
}

fs.writeFileSync('scratch/_t1v06_check/ShardLeaf.handoff-fix.test.json', JSON.stringify({ tests: slTests }, null, 1));
fs.writeFileSync('scratch/_t1v06_check/PayoutShard.handoff-fix.test.json', JSON.stringify({ tests: psTests }, null, 1));
console.log('wrote', slTests.length, 'ShardLeaf vectors,', psTests.length, 'PayoutShard vectors');
