// PayoutShardV2.zk_handoff v0.3 §2/§3 A 类代币转移向量(ledger 1170): 读本合约当前持有的代币, 全额转给
// 新建 CloseZkV2 实例的 covenant, 独立保留 closeZkTmplAnchor 全字节校验(不动)。
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
const PSV2 = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/PayoutShardV2.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const PSV2_COV = new Array(32).fill(0xaa);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
const splice = JSON.parse(fs.readFileSync('scratch/_t1v06_check/closezk_splice.json', 'utf8'));

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/ZKHO_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/ZKHO_${tag}.compiled.json`;
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

const tokAnchor = compileKTT(PSV2_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;

function psv2Ctor({ consolidated_pool, closed = 1, attestedAtMs = splice.attestedAtMs }) {
  return [
    hex(ZERO32), hex(ZERO32), splice.closeZkTmplAnchor, hex(tokenTmplHash),
    consolidated_pool, closed, hex(ZERO32),
    ...new Array(17).fill(0),
    -1, attestedAtMs, splice.betsRootBaked, splice.refundRootBaked,
  ];
}

// The genesis marker + STATE_BYTES construction inside zk_handoff hardcodes closed=1/payoutRootField=ZERO32/
// w0..16=0 for the NEW CloseZkV2 instance -- reconstruct the exact same bytes here to build the real target.
function closeZkGenesisBytes(consolidated_pool, attestedWinner) {
  const push8 = (n) => { const b = Buffer.alloc(8); const v = BigInt(n); if (v >= 0n) { b.writeBigUInt64LE(v); } else { const mag = Buffer.alloc(8); mag.writeBigUInt64LE(-v); mag[7] |= 0x80; return [8, ...mag]; } return [8, ...b]; };
  const push32 = (bytes) => [32, ...bytes];
  const zeroWord = [8, 0, 0, 0, 0, 0, 0, 0, 0];
  return [
    107, // genesisMarker
    ...push8(attestedWinner), ...push8(1), ...push32(ZERO32), ...push8(consolidated_pool),
    ...new Array(17).fill(zeroWord).flat(),
  ];
}
function realCloseZkInstance(consolidated_pool, attestedWinner) {
  const stateBytes = closeZkGenesisBytes(consolidated_pool, attestedWinner);
  const tA = Buffer.from(splice.templateA.slice(2), 'hex');
  const tB = Buffer.from(splice.templateB.slice(2), 'hex');
  const tC = Buffer.from(splice.templateC.slice(2), 'hex');
  const tD = Buffer.from(splice.templateD.slice(2), 'hex');
  const bets = Buffer.from(splice.betsRootBaked.slice(2), 'hex');
  const refund = Buffer.from(splice.refundRootBaked.slice(2), 'hex');
  const atMs = Buffer.concat([Buffer.from([6]), (() => { const b = Buffer.alloc(6); let v = BigInt(splice.attestedAtMs); for (let i = 0; i < 6; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; })()]);
  const full = Buffer.concat([Buffer.from(stateBytes), tA, bets, tB, atMs, tC, refund, tD]);
  const bc = [...full];
  return { bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

const claimCovId = new Array(32).fill(0xdd);
function claimFillerInput() { return { utxo_value: 1, covenant_id: hex(claimCovId), signature_script_hex: '0x00ff' }; }
function selfInput(pool) { return { utxo_value: 1, covenant_id: hex(PSV2_COV), state: undefined }; }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }

const tests = [];

function baseArgsAndTx({ consolidated_pool, wrongTemplateD, wrongTokPrefix, wrongTokenOwner, wrongZkOutput }) {
  const heldTok = compileKTT(PSV2_COV, consolidated_pool, `held_${consolidated_pool}`);
  const zkInstance = wrongZkOutput || realCloseZkInstance(consolidated_pool, -1);
  const zkCovId = wrongZkOutput ? new Array(32).fill(0xcc) : claimCovId; // wrongZkOutput scenario reuses a distinct filler
  const tokenOutOwner = wrongTokenOwner || claimCovId;
  const tokenOut = compileKTT(tokenOutOwner, consolidated_pool, `tokout_${consolidated_pool}_${wrongTokenOwner ? 'wrong' : 'ok'}`);
  const tokPrefix = wrongTokPrefix || tokAnchor.prefix;
  const templateD = wrongTemplateD || splice.templateD;
  return {
    constructor_args: psv2Ctor({ consolidated_pool }),
    args: [0, 1, 1, hex(tokPrefix), hex(tokAnchor.suffix), splice.templateA, splice.templateB, splice.templateC, templateD],
    tx: {
      active_input_index: 0,
      inputs: [{ utxo_value: 1, covenant_id: hex(PSV2_COV), state: {
        consolidated_pool, closed: 1, payoutRoot: ZERO32, w0: 0, w1: 0, w2: 0, w3: 0, w4: 0, w5: 0, w6: 0, w7: 0, w8: 0, w9: 0, w10: 0, w11: 0, w12: 0, w13: 0, w14: 0, w15: 0, w16: 0,
        attestedWinner: -1, attestedAtMs: splice.attestedAtMs, betsRootBaked: splice.betsRootBaked, refundRootBaked: splice.refundRootBaked,
      } }, tokenInput(heldTok), claimFillerInput()],
      outputs: [
        wrongZkOutput
          ? { value: 1000, script_hex: wrongZkOutput.scriptHex } // no covenant_id declared at all -> OpOutputCovenantId returns ZERO32
          : { value: 1000, covenant_id: hex(claimCovId), authorizing_input: 2, script_hex: zkInstance.scriptHex },
        { value: 1, script_hex: tokenOut.scriptHex },
      ],
    },
  };
}

tests.push({ name: 'V-ZKHO-1_pass_full_handoff', function: 'zk_handoff', expect: 'pass', ...baseArgsAndTx({ consolidated_pool: 100 }) });
tests.push({ name: 'V-ZKHO-2_fail_wrong_templateD_anchor_mismatch', function: 'zk_handoff', expect: 'fail', ...baseArgsAndTx({ consolidated_pool: 100, wrongTemplateD: '0x' + Buffer.from(splice.templateD.slice(2), 'hex').fill(0xff, 0, 4).toString('hex') }) });
tests.push({ name: 'V-ZKHO-3_fail_token_owner_diverted_to_stranger', function: 'zk_handoff', expect: 'fail', ...baseArgsAndTx({ consolidated_pool: 100, wrongTokenOwner: new Array(32).fill(0x99) }) });
tests.push({ name: 'V-ZKHO-4_fail_witness_wrong_tok_prefix', function: 'zk_handoff', expect: 'fail', ...baseArgsAndTx({ consolidated_pool: 100, wrongTokPrefix: [0xff] }) });
{
  const zkInstanceBareCov = realCloseZkInstance(100, -1);
  tests.push({ name: 'V-ZKHO-5_fail_zk_output_bare_no_covenant_id_zero32', function: 'zk_handoff', expect: 'fail', ...baseArgsAndTx({ consolidated_pool: 100, wrongZkOutput: zkInstanceBareCov }) });
}

fs.writeFileSync('scratch/_t1v06_check/PayoutShardV2.zkhandoff.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
