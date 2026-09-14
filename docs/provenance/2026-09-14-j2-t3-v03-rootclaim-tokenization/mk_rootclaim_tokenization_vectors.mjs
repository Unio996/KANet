// RootClaim.claim_draw v0.3 §2/§3 代币化(ledger 1183): 派彩目的地改成新建 KanetTokenClaim 输出 + 代币
// owner 转移, 自续约改 AB11(同 RefundClaim.refund_payout/CloseZkV2.claim 形状, RootClaim 是"还没过任何
// 代币化"的第一处, 从一开始就用正确的 P13 witness+blake3 形 + AB11, 不会先犯 blake3/plain-validateOutputState
// 的错)。
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
const STUB = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/PoolSideStub.sil';
const RC = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/RootClaim.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const RC_COV = new Array(32).fill(0xbb);
const BETTOR_PK = new Array(32).fill(0x22);
const SHARD_POOL_ID = new Array(32).fill(0x37);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
const MERKLE_INDEX = 0;
const TREE_DEPTH = 1;
const WINNING_SIDE = 1;

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/RCLtok_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/RCLtok_${tag}.compiled.json`;
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
function compileTicket(bettorPk, direction, stake, shardPoolId, tag) {
  const ctor = [
    { kind: 'bytes', value: bettorPk }, { kind: 'int', value: direction },
    { kind: 'int', value: stake }, { kind: 'bytes', value: shardPoolId },
  ];
  return compileGeneric(STUB, ctor, `ticket_${tag}`);
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
const tokAnchor = compileKTT(RC_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;
const marketSuffixHash = [...blake3(Uint8Array.from(MARKET_TMPL_SUFFIX))];
const ticketAnchor = compileTicket(BETTOR_PK, WINNING_SIDE, 1, SHARD_POOL_ID, 'anchor');
const psTmplHash = ticketAnchor.templateHash;

function buildRootFor(payout, idx) {
  const leaves = {}; leaves[idx] = [...b2b([...BETTOR_PK, ...le8(payout)])];
  const levels = buildMerkle(TREE_DEPTH, leaves);
  const siblings = proveMerkle(levels, idx, TREE_DEPTH);
  return { treeRoot: root(levels, TREE_DEPTH), siblings };
}

function rclCtor({ pool_value, closed = 1, payoutRoot, claimed_bitmap = 0 }) {
  return [
    hex(psTmplHash), hex(SHARD_POOL_ID), 0, 0, 0, pool_value, closed, WINNING_SIDE, hex(payoutRoot), claimed_bitmap,
    hex(tokenTmplHash), hex(claimTmplHash), hex(marketSuffixHash),
  ];
}
function compileRCL(ctorOverrides, tag) {
  const ctor = rclCtor(ctorOverrides);
  return compileGeneric(RC, ctor.map((v) => {
    if (typeof v === 'number') return { kind: 'int', value: v };
    if (typeof v === 'string' && v.startsWith('0x')) return { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] };
    throw new Error('unexpected ctor value ' + v);
  }), `rcl_${tag}`);
}
function activeSelfInput(instance) { return { utxo_value: 1, covenant_id: hex(RC_COV), utxo_script_hex: instance.scriptHex, signature_script_hex: instance.fullBytecodeHex }; }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function ticketInput(t) { return { utxo_value: 1, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
const claimCovId = new Array(32).fill(0xdd);
function claimFillerInput() { return { utxo_value: 1, covenant_id: hex(claimCovId), signature_script_hex: '0x00ff' }; }

const tests = [];

function buildScenario({ pool_value, payout, tag, wrongClaimOut, wrongTokenOwner, wrongTokPrefix, wrongClaimPrefix }) {
  const { treeRoot, siblings } = buildRootFor(payout, MERKLE_INDEX);
  const ticket = compileTicket(BETTOR_PK, WINNING_SIDE, payout, SHARD_POOL_ID, `ticket_${tag}`);
  const heldTok = compileKTT(RC_COV, pool_value, `held_${tag}`);
  const realClaimOut = compileKTC({ marketCovId: RC_COV, winnerPk: BETTOR_PK, amount: payout, tokenTmplHash, marketSuffixHash }, `claimout_${tag}`);
  const claimOut = wrongClaimOut || realClaimOut;
  const tokenOutOwner = wrongTokenOwner || claimCovId;
  const tokenOutToClaim = compileKTT(tokenOutOwner, payout, `tokoutclaim_${tag}`);
  const exact = pool_value === payout;

  const ctorOverrides = { pool_value, payoutRoot: treeRoot, claimed_bitmap: 0 };
  const activeInstance = compileRCL(ctorOverrides, `active_${tag}`);

  const outputs = [];
  if (exact) {
    outputs.push({ value: 1, covenant_id: hex(RC_COV) }); // rootOutIdx unused in exact branch
  } else {
    const mask = 1; // merkle_index=0 -> mask=2^0=1
    const contInstance = compileRCL({ ...ctorOverrides, pool_value: pool_value - payout, claimed_bitmap: 0 + mask }, `cont_${tag}`);
    outputs.push({ value: 1000, script_hex: contInstance.scriptHex });
  }
  outputs.push({ value: 1, covenant_id: hex(claimCovId), authorizing_input: 3, script_hex: claimOut.scriptHex });
  outputs.push({ value: 1, script_hex: tokenOutToClaim.scriptHex });
  if (!exact) {
    const remainTokenOut = compileKTT(RC_COV, pool_value - payout, `remaintok_${tag}`);
    outputs.push({ value: 1, script_hex: remainTokenOut.scriptHex });
  } else {
    outputs.push({ value: 1, covenant_id: hex(RC_COV) });
  }

  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const claimPrefix = wrongClaimPrefix || ktcAnchor.prefix;

  return {
    function: 'claim_draw',
    constructor_args: rclCtor(ctorOverrides),
    args: [
      0, 1, 1, 2, 3,             // rootOutIdx, claimOutIdx, tokenInIdx, tokenOutIdx, remainTokenOutIdx
      payout, MERKLE_INDEX, TREE_DEPTH, siblings.map(hex),
      2, ticket.prefix.length, ticket.suffix.length,   // ticketInIdx, ticket_prefix_len, ticket_suffix_len
      hex(tokPrefix), hex(heldTok.suffix), hex(claimPrefix), hex(ktcAnchor.suffix),
    ],
    tx: {
      active_input_index: 0,
      inputs: [activeSelfInput(activeInstance), tokenInput(heldTok), ticketInput(ticket), claimFillerInput()],
      outputs,
    },
  };
}

tests.push({ name: 'V-RCL-TOK-1_pass_partial_with_remainder', expect: 'pass', ...buildScenario({ pool_value: 5000, payout: 2000, tag: '1' }) });
tests.push({ name: 'V-RCL-TOK-2_pass_exact_no_remainder', expect: 'pass', ...buildScenario({ pool_value: 5000, payout: 5000, tag: '2' }) });
{
  const fakeClaimOut = compileKTT(RC_COV, 1, 'fake_claim_shell');
  tests.push({ name: 'V-RCL-TOK-3_fail_destination_not_real_claim_template', expect: 'fail', ...buildScenario({ pool_value: 5000, payout: 2000, tag: '3', wrongClaimOut: fakeClaimOut }) });
}
tests.push({ name: 'V-RCL-TOK-4_fail_token_owner_diverted_to_stranger', expect: 'fail', ...buildScenario({ pool_value: 5000, payout: 2000, tag: '4', wrongTokenOwner: new Array(32).fill(0x99) }) });
tests.push({ name: 'V-RCL-TOK-5_fail_witness_wrong_tok_prefix', expect: 'fail', ...buildScenario({ pool_value: 5000, payout: 2000, tag: '5', wrongTokPrefix: [0xff] }) });
tests.push({ name: 'V-RCL-TOK-6_fail_witness_wrong_claim_prefix', expect: 'fail', ...buildScenario({ pool_value: 5000, payout: 2000, tag: '6', wrongClaimPrefix: [0xff] }) });

fs.writeFileSync('scratch/_t1v06_check/RootClaim.tokenization.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
