// PayoutShardV2.refund_claim v0.3 §2/§3 代币化(ledger 1183, claim 家族四处之四, 最后一处): 目的地重定向
// 到新建 KanetTokenClaim + AB11 自续约(同其余三处形状)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildMerkle, proveMerkle, root, hex, le8 } from '../2026-09-14-j2-t3-v03-drawdown-mustfix/merkle.mjs';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const { blake3 } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake3.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const KTC = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/KanetTokenClaim.sil';
const PSV2 = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/PayoutShardV2.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const PSV2_COV = new Array(32).fill(0xaa);
const BETTOR_PK = new Array(32).fill(0x22);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
const MERKLE_INDEX = 5;
const DEPTH = 10;

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/PSV2RFC_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/PSV2RFC_${tag}.compiled.json`;
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
function compileKTC({ marketCovId, winnerPk, amount, tokenTmplHash, marketSuffixHash }, tag) {
  const ctor = [
    { kind: 'bytes', value: marketCovId }, { kind: 'bytes', value: winnerPk }, { kind: 'int', value: amount },
    { kind: 'bytes', value: tokenTmplHash }, { kind: 'bytes', value: marketSuffixHash },
  ];
  return compileGeneric(KTC, ctor, `ktc_${tag}`);
}

const ktcAnchor = compileKTC({ marketCovId: ZERO32, winnerPk: ZERO32, amount: 0, tokenTmplHash: ZERO32, marketSuffixHash: ZERO32 }, 'anchor');
const claimTmplHash = ktcAnchor.templateHash;
const tokAnchor = compileKTT(PSV2_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;
const marketSuffixHash = [...blake3(Uint8Array.from(MARKET_TMPL_SUFFIX))];

function buildRootFor(amount, idx = MERKLE_INDEX) {
  const leaves = {}; leaves[idx] = [...b2b([...BETTOR_PK, ...le8(amount)])];
  const levels = buildMerkle(DEPTH, leaves);
  const siblings = proveMerkle(levels, idx, DEPTH);
  return { treeRoot: root(levels, DEPTH), siblings };
}
function nullifierWordsArray(merkleIndex) {
  const wordIdx = Math.floor(merkleIndex / 63);
  const w = new Array(17).fill(0); w[wordIdx] = 1 << (merkleIndex % 63);
  return w;
}

function psv2Ctor({ consolidated_pool, closed = 2, payoutRoot, w = new Array(17).fill(0) }) {
  return [
    hex(ZERO32), hex(ZERO32), hex(ZERO32), hex(tokenTmplHash),
    consolidated_pool, closed, hex(payoutRoot),
    ...w,
    -1, 0, hex(ZERO32), hex(ZERO32),
    hex(claimTmplHash), hex(marketSuffixHash),
  ];
}
function compilePSV2(ctorOverrides, tag) {
  const ctor = psv2Ctor(ctorOverrides);
  return compileGeneric(PSV2, ctor.map((v) => {
    if (typeof v === 'number') return { kind: 'int', value: v };
    if (typeof v === 'string' && v.startsWith('0x')) return { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] };
    throw new Error('unexpected ctor value ' + v);
  }), `psv2_${tag}`);
}
function activeSelfInput(instance) { return { utxo_value: 1, covenant_id: hex(PSV2_COV), utxo_script_hex: instance.scriptHex, signature_script_hex: instance.fullBytecodeHex }; }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
const claimCovId = new Array(32).fill(0xdd);
function claimFillerInput() { return { utxo_value: 1, covenant_id: hex(claimCovId), signature_script_hex: '0x00ff' }; }

const tests = [];

function buildScenario({ consolidated_pool, refund, tag, wrongClaimOut, wrongTokenOwner, wrongTokPrefix, wrongClaimPrefix }) {
  const { treeRoot, siblings } = buildRootFor(refund);
  const heldTok = compileKTT(PSV2_COV, consolidated_pool, `held_${tag}`);
  const realClaimOut = compileKTC({ marketCovId: PSV2_COV, winnerPk: BETTOR_PK, amount: refund, tokenTmplHash, marketSuffixHash }, `claimout_${tag}`);
  const claimOut = wrongClaimOut || realClaimOut;
  const tokenOutOwner = wrongTokenOwner || claimCovId;
  const tokenOutToClaim = compileKTT(tokenOutOwner, refund, `tokoutclaim_${tag}`);
  const exact = consolidated_pool === refund;

  const ctorOverrides = { consolidated_pool, closed: 2, payoutRoot: treeRoot };
  const activeInstance = compilePSV2(ctorOverrides, `active_${tag}`);

  const outputs = [];
  if (exact) {
    outputs.push({ value: 1, covenant_id: hex(PSV2_COV) });
  } else {
    const contInstance = compilePSV2({ ...ctorOverrides, consolidated_pool: consolidated_pool - refund, w: nullifierWordsArray(MERKLE_INDEX) }, `cont_${tag}`);
    outputs.push({ value: 1000, script_hex: contInstance.scriptHex });
  }
  outputs.push({ value: 1, covenant_id: hex(claimCovId), authorizing_input: 2, script_hex: claimOut.scriptHex });
  outputs.push({ value: 1, script_hex: tokenOutToClaim.scriptHex });
  if (!exact) {
    const remainTokenOut = compileKTT(PSV2_COV, consolidated_pool - refund, `remaintok_${tag}`);
    outputs.push({ value: 1, script_hex: remainTokenOut.scriptHex });
  } else {
    outputs.push({ value: 1, covenant_id: hex(PSV2_COV) });
  }

  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const claimPrefix = wrongClaimPrefix || ktcAnchor.prefix;

  return {
    function: 'refund_claim',
    constructor_args: psv2Ctor(ctorOverrides),
    args: [
      0, 1, 1, 2, 3,   // selfOutIdx, claimOutIdx, tokenInIdx, tokenOutIdx, remainTokenOutIdx
      hex(BETTOR_PK), refund, MERKLE_INDEX,
      ...siblings.map(hex),
      hex(tokPrefix), hex(heldTok.suffix), hex(claimPrefix), hex(ktcAnchor.suffix),
    ],
    tx: {
      active_input_index: 0,
      inputs: [activeSelfInput(activeInstance), tokenInput(heldTok), claimFillerInput()],
      outputs,
    },
  };
}

tests.push({ name: 'V-PSV2RFC-1_pass_partial_with_remainder', expect: 'pass', ...buildScenario({ consolidated_pool: 100, refund: 30, tag: '1' }) });
tests.push({ name: 'V-PSV2RFC-2_pass_exact_no_remainder', expect: 'pass', ...buildScenario({ consolidated_pool: 80, refund: 80, tag: '2' }) });
{
  const fakeClaimOut = compileKTT(PSV2_COV, 1, 'fake_claim_shell');
  tests.push({ name: 'V-PSV2RFC-3_fail_destination_not_real_claim_template', expect: 'fail', ...buildScenario({ consolidated_pool: 100, refund: 30, tag: '3', wrongClaimOut: fakeClaimOut }) });
}
tests.push({ name: 'V-PSV2RFC-4_fail_token_owner_diverted_to_stranger', expect: 'fail', ...buildScenario({ consolidated_pool: 100, refund: 30, tag: '4', wrongTokenOwner: new Array(32).fill(0x99) }) });
tests.push({ name: 'V-PSV2RFC-5_fail_witness_wrong_tok_prefix', expect: 'fail', ...buildScenario({ consolidated_pool: 100, refund: 30, tag: '5', wrongTokPrefix: [0xff] }) });
tests.push({ name: 'V-PSV2RFC-6_fail_witness_wrong_claim_prefix', expect: 'fail', ...buildScenario({ consolidated_pool: 100, refund: 30, tag: '6', wrongClaimPrefix: [0xff] }) });

fs.writeFileSync('scratch/_t1v06_check/PayoutShardV2.refundclaim.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
