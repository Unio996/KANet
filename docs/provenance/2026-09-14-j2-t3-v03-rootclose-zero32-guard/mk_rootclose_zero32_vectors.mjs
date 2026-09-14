// RootClose.convert_to_claim / convert_to_refundclaim ZERO32 目的地守卫向量(ledger 1186, Codex/NWT
// 点名最高风险): 用真实编译的 RootClaim.sil(13参数 ctor)/RefundClaim.sil(12参数 ctor)当前形状构造
// target, 证明: (a) 正常桥接 pass; (b) 目的地脚本字节匹配但没声明 covenant_id -> ZERO32 -> 必须被新加
// 的 require(Op*CovId(...) != ZERO32) 挡下, 不能靠模板校验代付; (c) 假模板 shell(脚本字节都不对) fail。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const RC = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/RootClose.sil';
const ROOTCLAIM = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/RootClaim.sil';
const REFUNDCLAIM = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/RefundClaim.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const RC_COV = new Array(32).fill(0xcc);
const SHARD_POOL_ID = new Array(32).fill(0x37);
const DEADLINE_MS = 1700000000000;

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/RCZ_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/RCZ_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${sil}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

// RootClaim.sil 13-参数 ctor(v0.3 代币化后现形): ps_tmpl_hash, shard_pool_id, local_yes/no/count/
// pool_value/closed/winningSide, payoutRoot, claimed_bitmap, token_tmpl_hash, claim_tmpl_hash(KTC 的),
// market_suffix_hash。具体字段值不影响 template_hash/prefix/suffix(模板对 ctor 值不变性, 全程复用的性质)。
function compileRootClaimInstance({ local_yes = 0, local_no = 0, count = 0, pool_value = 100, closed = 1, winningSide = 0, payoutRoot = ZERO32, claimed_bitmap = 0 }, tag) {
  const ctor = [
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: SHARD_POOL_ID },
    { kind: 'int', value: local_yes }, { kind: 'int', value: local_no }, { kind: 'int', value: count },
    { kind: 'int', value: pool_value }, { kind: 'int', value: closed }, { kind: 'int', value: winningSide },
    { kind: 'bytes', value: payoutRoot }, { kind: 'int', value: claimed_bitmap },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
  ];
  return compileGeneric(ROOTCLAIM, ctor, `rootclaim_${tag}`);
}
// RefundClaim.sil 12-参数 ctor(v0.3 代币化后现形): ps_tmpl_hash, shard_pool_id, local_yes/no/count/
// pool_value/closed/winningSide, payoutRoot, token_tmpl_hash, claim_tmpl_hash, market_suffix_hash。
function compileRefundClaimInstance({ local_yes = 0, local_no = 0, count = 0, pool_value = 100, closed = 2, winningSide = 0, payoutRoot = ZERO32 }, tag) {
  const ctor = [
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: SHARD_POOL_ID },
    { kind: 'int', value: local_yes }, { kind: 'int', value: local_no }, { kind: 'int', value: count },
    { kind: 'int', value: pool_value }, { kind: 'int', value: closed }, { kind: 'int', value: winningSide },
    { kind: 'bytes', value: payoutRoot },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
  ];
  return compileGeneric(REFUNDCLAIM, ctor, `refundclaim_${tag}`);
}

const rootClaimAnchor = compileRootClaimInstance({}, 'anchor');
const claimTmplHash = rootClaimAnchor.templateHash;
const refundClaimAnchor = compileRefundClaimInstance({}, 'anchor');
const refundclaimTmplHash = refundClaimAnchor.templateHash;

const c0 = new Array(32).fill(0x01), c1 = new Array(32).fill(0x02), c2 = new Array(32).fill(0x03), c3 = new Array(32).fill(0x04), c4 = new Array(32).fill(0x05);
const committeeHash = [...b2b([...c0, ...c1, ...c2, ...c3, ...c4])];

function rootCloseCtor({ closed, pool_value = 100, payoutRoot = ZERO32 }) {
  return [hex(committeeHash), DEADLINE_MS, hex(claimTmplHash), hex(refundclaimTmplHash), 0, 0, 0, pool_value, closed, 0, hex(payoutRoot)];
}
const claimCovId = new Array(32).fill(0xdd);
function claimFillerInput() { return { utxo_value: 1, covenant_id: hex(claimCovId), signature_script_hex: '0x00ff' }; }
function selfInput(pool_value, closed) { return { utxo_value: 1, covenant_id: hex(RC_COV), state: { local_yes: 0, local_no: 0, count: 0, pool_value, closed, winningSide: 0, payoutRoot: hex(ZERO32) } }; }

const tests = [];

// ---------- convert_to_claim ----------
{
  const target = compileRootClaimInstance({ pool_value: 100, closed: 1, payoutRoot: ZERO32, claimed_bitmap: 0 }, 'pass');
  tests.push({
    name: 'V-RCLZ-1_pass_convert_to_claim_real_bridge',
    function: 'convert_to_claim',
    constructor_args: rootCloseCtor({ closed: 1, pool_value: 100 }),
    args: [0, hex(rootClaimAnchor.prefix), hex(rootClaimAnchor.suffix)],
    expect: 'pass',
    tx: {
      active_input_index: 0,
      inputs: [selfInput(100, 1), claimFillerInput()],
      outputs: [{ value: 100, covenant_id: hex(claimCovId), authorizing_input: 1, script_hex: target.scriptHex }],
    },
  });
}
{
  // Same real, script-byte-correct target -- but the output declares NO covenant_id at all (bare). The
  // template check (validateOutputStateWithTemplate) still passes (script bytes match exactly); only the
  // NEW require(OpOutputCovenantId != ZERO32) can catch this.
  const target = compileRootClaimInstance({ pool_value: 100, closed: 1, payoutRoot: ZERO32, claimed_bitmap: 0 }, 'bare');
  tests.push({
    name: 'V-RCLZ-2_fail_convert_to_claim_bare_output_no_covenant_id_zero32',
    function: 'convert_to_claim',
    constructor_args: rootCloseCtor({ closed: 1, pool_value: 100 }),
    args: [0, hex(rootClaimAnchor.prefix), hex(rootClaimAnchor.suffix)],
    expect: 'fail',
    tx: {
      active_input_index: 0,
      inputs: [selfInput(100, 1)],
      outputs: [{ value: 1, script_hex: target.scriptHex }],  // no covenant_id declared
    },
  });
}
{
  // Fake shell: script bytes don't match the real RootClaim template at all (wrong contract entirely).
  const fake = compileRefundClaimInstance({ pool_value: 100, closed: 2 }, 'fake_for_claim');
  tests.push({
    name: 'V-RCLZ-3_fail_convert_to_claim_fake_template_shell',
    function: 'convert_to_claim',
    constructor_args: rootCloseCtor({ closed: 1, pool_value: 100 }),
    args: [0, hex(rootClaimAnchor.prefix), hex(rootClaimAnchor.suffix)],
    expect: 'fail',
    tx: {
      active_input_index: 0,
      inputs: [selfInput(100, 1), claimFillerInput()],
      outputs: [{ value: 1, covenant_id: hex(claimCovId), authorizing_input: 1, script_hex: fake.scriptHex }],
    },
  });
}

// ---------- convert_to_refundclaim ----------
{
  const target = compileRefundClaimInstance({ pool_value: 100, closed: 2, payoutRoot: ZERO32 }, 'pass');
  tests.push({
    name: 'V-RCLZ-4_pass_convert_to_refundclaim_real_bridge',
    function: 'convert_to_refundclaim',
    constructor_args: rootCloseCtor({ closed: 2, pool_value: 100 }),
    args: [0, hex(refundClaimAnchor.prefix), hex(refundClaimAnchor.suffix)],
    expect: 'pass',
    tx: {
      active_input_index: 0,
      inputs: [selfInput(100, 2), claimFillerInput()],
      outputs: [{ value: 100, covenant_id: hex(claimCovId), authorizing_input: 1, script_hex: target.scriptHex }],
    },
  });
}
{
  const target = compileRefundClaimInstance({ pool_value: 100, closed: 2, payoutRoot: ZERO32 }, 'bare');
  tests.push({
    name: 'V-RCLZ-5_fail_convert_to_refundclaim_bare_output_no_covenant_id_zero32',
    function: 'convert_to_refundclaim',
    constructor_args: rootCloseCtor({ closed: 2, pool_value: 100 }),
    args: [0, hex(refundClaimAnchor.prefix), hex(refundClaimAnchor.suffix)],
    expect: 'fail',
    tx: {
      active_input_index: 0,
      inputs: [selfInput(100, 2)],
      outputs: [{ value: 1, script_hex: target.scriptHex }],
    },
  });
}
{
  const fake = compileRootClaimInstance({ pool_value: 100, closed: 1 }, 'fake_for_refundclaim');
  tests.push({
    name: 'V-RCLZ-6_fail_convert_to_refundclaim_fake_template_shell',
    function: 'convert_to_refundclaim',
    constructor_args: rootCloseCtor({ closed: 2, pool_value: 100 }),
    args: [0, hex(refundClaimAnchor.prefix), hex(refundClaimAnchor.suffix)],
    expect: 'fail',
    tx: {
      active_input_index: 0,
      inputs: [selfInput(100, 2), claimFillerInput()],
      outputs: [{ value: 1, covenant_id: hex(claimCovId), authorizing_input: 1, script_hex: fake.scriptHex }],
    },
  });
}

fs.writeFileSync('scratch/_t1v06_check/RootClose.zero32guard.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
