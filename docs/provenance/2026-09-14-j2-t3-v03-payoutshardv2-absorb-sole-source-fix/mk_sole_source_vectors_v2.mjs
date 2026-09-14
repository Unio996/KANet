// PayoutShard.absorb sole-source MUST-FIX (ledger 1208, Codex 独立发现, Bettor 核过成立): absorb 原来只验
// shardInIdx 单点的模板/金额, 不证明它是本笔交易里唯一的"同模板、非本 PS 持有"代币输入。两个合法 ShardLeaf
// A/B 同笔各自 consolidate_to_payout(各自独立成立), absorb 只点名一个当 shardInIdx, 另一个被静默销毁。
// 修法: countStrayNonOwnedTokenInputs(tok_prefix, tok_suffix, excludeIdx=shardInIdx) 必须为 0, 且
// shardTk.owner != self(挡"自己已持有代币冒充新纳入"的重复入账企图)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const PS = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/PayoutShardV2.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const PS_COV = new Array(32).fill(0xaa);
const LEAF_A_COV = new Array(32).fill(0xbb);
const LEAF_B_COV = new Array(32).fill(0xcc);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/SSFV2_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/SSFV2_${tag}.compiled.json`;
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

const tokAnchor = compileKTT(PS_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;

function psCtor({ consolidated_pool, closed = 0, payoutRoot = ZERO32, w = new Array(17).fill(0) }) {
  return [hex(ZERO32), hex(ZERO32), hex(ZERO32), hex(tokenTmplHash), consolidated_pool, closed, hex(payoutRoot), ...w, 0, 0, hex(ZERO32), hex(ZERO32), hex(ZERO32), hex(ZERO32)];
}
function toCtorObjs(arr) {
  return arr.map((v) => (typeof v === 'string' && v.startsWith('0x')) ? { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] } : { kind: 'int', value: v });
}
function compilePS(ctorOverrides, tag) { return compileGeneric(PS, toCtorObjs(psCtor(ctorOverrides)), `ps_${tag}`); }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function activeSelfInput(instance) { return { utxo_value: 1, covenant_id: hex(PS_COV), utxo_script_hex: instance.scriptHex, signature_script_hex: instance.fullBytecodeHex }; }

const tests = [];

// ---- V-SSF-1: pass -- single leaf, PS existing 100 + incoming 50 = 150. ----
{
  const psActive = compilePS({ consolidated_pool: 100 }, 'pass_active');
  const psOwn100 = compileKTT(PS_COV, 100, 'pass_own100');
  const shardA = compileKTT(LEAF_A_COV, 50, 'pass_shardA');
  const psCont150 = compilePS({ consolidated_pool: 150 }, 'pass_cont150');
  const tokOut150 = compileKTT(PS_COV, 150, 'pass_tokout150');
  tests.push({
    name: 'V-SSF-1_pass_single_leaf_sole_source',
    function: 'absorb',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
    expect: 'pass',
    tx: {
      active_input_index: 1,
      inputs: [tokenInput(psOwn100), activeSelfInput(psActive), tokenInput(shardA)],
      outputs: [
        { value: 1000, script_hex: psCont150.scriptHex },
        { value: 1, covenant_id: hex(PS_COV) },
        { value: 1, script_hex: tokOut150.scriptHex },
      ],
    },
  });
}

// ---- V-SSF-2: fail (Codex primary criterion) -- two legitimate leaves A and B, each holding 50, both
// present as inputs in the SAME tx; absorb only names B as shardInIdx. A's token is spent but never accounted
// for in any output -- must be REJECTED (silent destruction otherwise). ----
{
  const psActive = compilePS({ consolidated_pool: 100 }, 'dual_active');
  const psOwn100 = compileKTT(PS_COV, 100, 'dual_own100');
  const shardA = compileKTT(LEAF_A_COV, 50, 'dual_shardA');
  const shardB = compileKTT(LEAF_B_COV, 50, 'dual_shardB');
  const psCont150 = compilePS({ consolidated_pool: 150 }, 'dual_cont150');   // only credits B's 50, not A's
  const tokOut150 = compileKTT(PS_COV, 150, 'dual_tokout150');
  tests.push({
    name: 'V-SSF-2_fail_dual_leaf_only_one_named_other_silently_destroyed',
    function: 'absorb',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 3, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],   // shardInIdx=3 (B), A(idx=2) is the unaccounted stray
    expect: 'fail',
    tx: {
      active_input_index: 1,
      inputs: [tokenInput(psOwn100), activeSelfInput(psActive), tokenInput(shardA), tokenInput(shardB)],
      outputs: [
        { value: 1000, script_hex: psCont150.scriptHex },
        { value: 1, covenant_id: hex(PS_COV) },
        { value: 1, script_hex: tokOut150.scriptHex },
      ],
    },
  });
}

// ---- V-SSF-3: fail -- shardInIdx points at the SAME self-owned token already reflected in consolidated_pool
// (owned_total==consolidated_pool passes -- there is only one token and it is already legitimately self-owned),
// attempting to ALSO credit it a second time via shard_amount as if it were a fresh incoming shard. Must be
// caught specifically by the NEW shardTk.owner!=self check, not incidentally by the owned_total check. ----
{
  const psActive = compilePS({ consolidated_pool: 100 }, 'selfshard_active');
  const psOwn100 = compileKTT(PS_COV, 100, 'selfshard_own100');   // the ONLY token present, already self-owned
  const psCont200 = compilePS({ consolidated_pool: 200 }, 'selfshard_cont200');   // attacker claims 100(existing)+100(same token again)=200
  const tokOut200 = compileKTT(PS_COV, 200, 'selfshard_tokout200');
  tests.push({
    name: 'V-SSF-3_fail_shardInIdx_already_self_owned_double_credit',
    function: 'absorb',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 0, 2, 100, hex(psOwn100.prefix), hex(psOwn100.suffix)],   // shardInIdx=0 -- SAME index scanOwnedTokenInputs already counted
    expect: 'fail',
    tx: {
      active_input_index: 1,
      inputs: [tokenInput(psOwn100), activeSelfInput(psActive)],
      outputs: [
        { value: 1000, script_hex: psCont200.scriptHex },
        { value: 1, covenant_id: hex(PS_COV) },
        { value: 1, script_hex: tokOut200.scriptHex },
      ],
    },
  });
}

// ---- V-SSF-4: fail -- one legitimate incoming shard (B) correctly named + amount correct, but an UNRELATED
// extra same-template non-PS token (a stray, e.g. a third party's token, not another leaf per se) is also
// present and unaccounted -- must be rejected even though the declared amount itself is arithmetically
// "correct" for what shardInIdx alone claims (this isolates the stray-input check from the amount check). ----
{
  const psActive = compilePS({ consolidated_pool: 100 }, 'stray_active');
  const psOwn100 = compileKTT(PS_COV, 100, 'stray_own100');
  const shardB = compileKTT(LEAF_B_COV, 50, 'stray_shardB');
  const strangerStray = compileKTT(new Array(32).fill(0x99), 1, 'stray_strangerextra');   // unrelated stray, amount irrelevant
  const psCont150 = compilePS({ consolidated_pool: 150 }, 'stray_cont150');
  const tokOut150 = compileKTT(PS_COV, 150, 'stray_tokout150');
  tests.push({
    name: 'V-SSF-4_fail_unrelated_stray_same_template_input_unaccounted',
    function: 'absorb',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],   // shardInIdx=2 (B); index 3 is the stray
    expect: 'fail',
    tx: {
      active_input_index: 1,
      inputs: [tokenInput(psOwn100), activeSelfInput(psActive), tokenInput(shardB), tokenInput(strangerStray)],
      outputs: [
        { value: 1000, script_hex: psCont150.scriptHex },
        { value: 1, covenant_id: hex(PS_COV) },
        { value: 1, script_hex: tokOut150.scriptHex },
      ],
    },
  });
}

// ---- V-SSF-5: fail (keep, Codex⑤ "隐藏的额外 PS 名下代币输入") -- extra owned-by-self token not reflected
// in consolidated_pool. ----
{
  const psActive = compilePS({ consolidated_pool: 100 }, 'hiddenps_active');
  const psOwn100 = compileKTT(PS_COV, 100, 'hiddenps_own100');
  const extraOwn = compileKTT(PS_COV, 1, 'hiddenps_extraown');
  const shardB = compileKTT(LEAF_B_COV, 50, 'hiddenps_shardB');
  const psCont151 = compilePS({ consolidated_pool: 151 }, 'hiddenps_cont151');
  const tokOut151 = compileKTT(PS_COV, 151, 'hiddenps_tokout151');
  tests.push({
    name: 'V-SSF-5_fail_hidden_extra_ps_owned_token_uncounted',
    function: 'absorb',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 3, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
    expect: 'fail',
    tx: {
      active_input_index: 1,
      inputs: [tokenInput(psOwn100), activeSelfInput(psActive), tokenInput(extraOwn), tokenInput(shardB)],
      outputs: [
        { value: 1000, script_hex: psCont151.scriptHex },
        { value: 1, covenant_id: hex(PS_COV) },
        { value: 1, script_hex: tokOut151.scriptHex },
      ],
    },
  });
}

// ---- V-SSF-6: fail (keep, Codex⑤ "错金额") -- tok_out amount just wrong. ----
{
  const psActive = compilePS({ consolidated_pool: 100 }, 'wrongamt_active');
  const psOwn100 = compileKTT(PS_COV, 100, 'wrongamt_own100');
  const shardB = compileKTT(LEAF_B_COV, 50, 'wrongamt_shardB');
  const psCont150 = compilePS({ consolidated_pool: 150 }, 'wrongamt_cont150');
  const tokOutWrong = compileKTT(PS_COV, 999, 'wrongamt_tokoutwrong');
  tests.push({
    name: 'V-SSF-6_fail_wrong_output_amount',
    function: 'absorb',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
    expect: 'fail',
    tx: {
      active_input_index: 1,
      inputs: [tokenInput(psOwn100), activeSelfInput(psActive), tokenInput(shardB)],
      outputs: [
        { value: 1000, script_hex: psCont150.scriptHex },
        { value: 1, covenant_id: hex(PS_COV) },
        { value: 1, script_hex: tokOutWrong.scriptHex },
      ],
    },
  });
}

fs.writeFileSync('scratch/_t1v06_check/PayoutShardV2.sole-source-fix.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
