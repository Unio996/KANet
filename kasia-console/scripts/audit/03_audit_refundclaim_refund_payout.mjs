// 03_audit_refundclaim_refund_payout.mjs — 账本1473 Step-0审计(续): RefundClaim.refund_payout
// full(无续约)与partial(有续约, readInputStateWithTemplate+内建validateOutputState同函数共存,
// 疑似V-T-8组合)真实cli-debugger执行对照。不广播、不碰生产库。Bettor(1476)明确要求补跑。
//
// 与RootClaim.claim_draw不同: refund_payout的partial分支【没有】手写AB11自续约, 直接用内建
// validateOutputState——这正是RootClaim.sil自己头注"含readInputStateWithTemplate+validateOutputState
// 同函数共存组合的入口一律AB11+实测"这条纪律要求回避的组合, 但RefundClaim.sil没有回避。本脚本要回答:
// 这个具体组合是(a)真的崩溃(V-T-8, "-N cannot be used as an array index"这类运行期panic)、
// (b)正常验证失败(script ran, but verification failed——同claim_draw那种"逻辑错"但不崩)、还是
// (c)真的能PASS(说明这条纪律对这个具体组合不适用)。三种结果对应不同的设计结论, 必须真跑才知道。
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { blake2b } = require('../../node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => Buffer.from(blake2b(Uint8Array.from(buf), { dkLen: 32 }));
const p2sh = (bc) => Buffer.concat([Buffer.from([0xaa, 0x20]), b2b(bc), Buffer.from([0x87])]);
const le8 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const asHex = (v) => '0x' + Buffer.from(v).toString('hex');
const fieldBytes32 = (b) => Buffer.concat([Buffer.from([32]), b]);
const fieldInt = (n) => Buffer.concat([Buffer.from([8]), le8(n)]);

if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
const kaspa = await import('kaspa-wasm');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../../src/lib/pool-bshard-artifacts.mjs');
const { loadProtocolConstants, computeKttGenesisArtifact } = await import('../../src/lib/proto-covenant-builder.mjs');
const { encodeEntryActionGeneric, combineActionAndRedeem } = await import('./generic-entry-witness.mjs');

const REFUND_CLAIM_SIL = new URL('../../src/lib/RefundClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KTC_SIL = new URL('../../src/lib/KanetTokenClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ANCHORS_JSON = new URL('../../scripts/proto-v0-template-anchors.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const anchors = JSON.parse(readFileSync(ANCHORS_JSON, 'utf8'));
const claimPrefixHex = '0x' + anchors.contracts.KanetTokenClaim.templatePrefixHex;
const claimSuffixHex = '0x' + anchors.contracts.KanetTokenClaim.templateSuffixHex;
const CLAIM_TMPL_HASH = anchors.contracts.KanetTokenClaim.claim_tmpl_hash;

const CLI_DEBUGGER = process.env.CLI_DEBUGGER_PATH || 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
function runDebugger(testFile, testName) {
  try {
    const out = execFileSync(CLI_DEBUGGER, [REFUND_CLAIM_SIL, '--run', '--test-name', testName, '--test-file', testFile], { encoding: 'utf8', timeout: 30000 });
    return { ok: /(^|\n)PASS/.test(out), out, crashed: false };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '') + e.message;
    // V-T-8的既有识别特征(账本1468/NWT既有review文档): rust panic文本, 不是silverscript自己的
    // "verification failed"这种正常拒绝——两者必须分开报, 混为一谈会让"崩溃"和"逻辑错"看起来一样。
    const crashed = /panic|cannot be used as an array index|unreachable|RUST_BACKTRACE|thread '.*' panicked/i.test(out);
    return { ok: false, out, crashed };
  }
}

const { ps_tmpl_hash, token_tmpl_hash, token_prefix, token_suffix, ps_prefix, ps_suffix } = loadProtocolConstants();
const MARKET_ID = 'ef'.repeat(32);

function compileRefundClaim({ pool_value, closed, winningSide, payoutRoot }) {
  const ctor = [
    ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(pool_value),
    ctorIntV100(closed), ctorIntV100(winningSide), ctorBytes32V100(payoutRoot.toString('hex')),
    ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(CLAIM_TMPL_HASH),
  ];
  const compiled = compileSilV100(REFUND_CLAIM_SIL, ctor, 'RefundClaim');
  return { script: Buffer.from(compiled.script), entryAbi: compiled._raw.contracts.RefundClaim.entries.refund_payout };
}

function kanetTokenClaimGenesisScript({ marketCovId, winnerPk, amount }) {
  const ctor = [ctorBytes32V100(marketCovId.toString('hex')), ctorBytes32V100(winnerPk.toString('hex')), ctorIntV100(amount), ctorBytes32V100(token_tmpl_hash)];
  const compiled = compileSilV100(KTC_SIL, ctor, 'KanetTokenClaim');
  return Buffer.from(compiled.script);
}

const PAYOUT_ROOT_PLACEHOLDER = randomBytes(32); // refund路径不用merkle, payoutRoot字段只是透传carry, 值本身不参与require
const BETTOR_PK = randomBytes(32);

async function runVariant({ label, pool_value, stake }) {
  const isPartial = pool_value !== stake;
  const { script, entryAbi } = compileRefundClaim({ pool_value, closed: 2, winningSide: 0, payoutRoot: PAYOUT_ROOT_PLACEHOLDER });

  // genesis covenant_id派生同01脚本(rusty-kaspa crypto/txscript/covenants.rs确认的公式: 每个
  // (授权input, 该输出)独立算, 不能多输出共享同一个值)。
  const zeroTxid = new kaspa.Hash('00'.repeat(32));
  const zeroOutpoint = { transactionId: zeroTxid, index: 0 };
  const activeUtxoScript = p2sh(script);
  const REFUNDCLAIM_COV_ID = Buffer.from(String(kaspa.covenantId(zeroOutpoint, [{ index: 0, output: { value: 10n, scriptPublicKey: { version: 0, script: activeUtxoScript } } }])), 'hex');

  const psPrefixBuf = Buffer.from(ps_prefix, 'hex'), psSuffixBuf = Buffer.from(ps_suffix, 'hex');
  const ticketStateBytes = Buffer.concat([fieldBytes32(BETTOR_PK), fieldInt(0), fieldInt(stake), fieldBytes32(Buffer.from(MARKET_ID, 'hex'))]);
  const ticketRedeem = Buffer.concat([psPrefixBuf, ticketStateBytes, psSuffixBuf]);
  const ticketSpk = p2sh(ticketRedeem);

  const tokenPrefixBuf = Buffer.from(token_prefix, 'hex'), tokenSuffixBuf = Buffer.from(token_suffix, 'hex');
  const ZERO32 = Buffer.alloc(32);
  const heldTokenStateBytes = Buffer.concat([
    fieldInt(pool_value), fieldBytes32(REFUNDCLAIM_COV_ID),
    Buffer.from([1, 0x04]), Buffer.from([1, 0x00]), fieldBytes32(ZERO32), fieldBytes32(ZERO32),
  ]);
  const heldTokenRedeem = Buffer.concat([tokenPrefixBuf, heldTokenStateBytes, tokenSuffixBuf]);
  const heldTokenSpk = p2sh(heldTokenRedeem);

  const claimGenesisScript = kanetTokenClaimGenesisScript({ marketCovId: REFUNDCLAIM_COV_ID, winnerPk: BETTOR_PK, amount: stake });
  const claimGenesisSpk = p2sh(claimGenesisScript);
  const CLAIM_OUT_COV_ID = Buffer.from(String(kaspa.covenantId(zeroOutpoint, [{ index: 1, output: { value: 10n, scriptPublicKey: { version: 0, script: claimGenesisSpk } } }])), 'hex');

  const tokenOutArtifact = computeKttGenesisArtifact({ amount: stake, ownerCovIdHex: CLAIM_OUT_COV_ID.toString('hex') });
  const TOKEN_OUT_COV_ID = Buffer.from(String(kaspa.covenantId(zeroOutpoint, [{ index: 2, output: { value: 10n, scriptPublicKey: { version: 0, script: Buffer.from(tokenOutArtifact.scriptPubKeyHex.slice(2), 'hex') } } }])), 'hex');

  let remainTokenArtifact = null, REMAIN_TOKEN_COV_ID = null, rootContScript = null;
  if (isPartial) {
    remainTokenArtifact = computeKttGenesisArtifact({ amount: pool_value - stake, ownerCovIdHex: REFUNDCLAIM_COV_ID.toString('hex') });
    REMAIN_TOKEN_COV_ID = Buffer.from(String(kaspa.covenantId(zeroOutpoint, [{ index: 3, output: { value: 10n, scriptPublicKey: { version: 0, script: Buffer.from(remainTokenArtifact.scriptPubKeyHex.slice(2), 'hex') } } }])), 'hex');
    // rootOutIdx续约: refund_payout partial分支用【内建validateOutputState】(不是手写AB11)——期望的
    // 新输出脚本 = 用新pool_value重新编译一次RefundClaim(同一套非state ctor字段不变)算出的P2SH,
    // 同RootClose.close_commit/refund_flip那种"clean"续约的标准算法, 不需要手动切字节。
    const { script: newScript } = compileRefundClaim({ pool_value: pool_value - stake, closed: 2, winningSide: 0, payoutRoot: PAYOUT_ROOT_PLACEHOLDER });
    rootContScript = newScript;
  }

  const argsByName = {
    rootOutIdx: 4, claimOutIdx: 1, tokenInIdx: 2, tokenOutIdx: 2, remainTokenOutIdx: 3,
    ticketInIdx: 1, ticket_prefix_len: psPrefixBuf.length, ticket_suffix_len: psSuffixBuf.length,
    tok_prefix: '0x' + token_prefix, tok_suffix: '0x' + token_suffix,
    claim_prefix: claimPrefixHex, claim_suffix: claimSuffixHex,
  };
  const action = encodeEntryActionGeneric(kaspa, entryAbi, argsByName);
  const fullSigScript = combineActionAndRedeem(kaspa, action, script);

  const outputs = [
    { value: 10, p2pk_pubkey: asHex(randomBytes(32)) }, // idx0: 占位
    { value: 10, covenant_id: asHex(CLAIM_OUT_COV_ID), script_hex: asHex(claimGenesisSpk) }, // idx1: claimOutIdx
    { value: 10, covenant_id: asHex(TOKEN_OUT_COV_ID), script_hex: tokenOutArtifact.scriptPubKeyHex }, // idx2: tokenOutIdx
  ];
  if (isPartial) {
    outputs.push({ value: 10, covenant_id: asHex(REMAIN_TOKEN_COV_ID), script_hex: remainTokenArtifact.scriptPubKeyHex }); // idx3: remainTokenOutIdx
    outputs.push({ value: pool_value - stake, covenant_id: asHex(REFUNDCLAIM_COV_ID), script_hex: asHex(p2sh(rootContScript)) }); // idx4: rootOutIdx(continuation, value必须严格等于pool_value-stake, 见sil:142 require(tx.outputs[rootOutIdx].value==pool_value-tk.stake))
  }

  const test = {
    name: `AUDIT_refund_payout_${label}`, function: 'refund_payout',
    constructor_args: [
      '0x' + ps_tmpl_hash, '0x' + MARKET_ID, 0, 0, 0, pool_value, 2, 0, asHex(PAYOUT_ROOT_PLACEHOLDER),
      '0x' + token_tmpl_hash, '0x' + CLAIM_TMPL_HASH,
    ],
    args: [argsByName.rootOutIdx, argsByName.claimOutIdx, argsByName.tokenInIdx, argsByName.tokenOutIdx, argsByName.remainTokenOutIdx,
      argsByName.ticketInIdx, argsByName.ticket_prefix_len, argsByName.ticket_suffix_len,
      '0x' + token_prefix, '0x' + token_suffix, claimPrefixHex, claimSuffixHex],
    expect: 'pass',
    tx: {
      active_input_index: 0,
      inputs: [
        process.env.AUDIT_STATE_MODE
          ? { utxo_value: 10, covenant_id: asHex(REFUNDCLAIM_COV_ID), state: { local_yes: 0, local_no: 0, count: 0, pool_value, closed: 2, winningSide: 0, payoutRoot: asHex(PAYOUT_ROOT_PLACEHOLDER) } }
          : { utxo_value: 10, utxo_script_hex: asHex(activeUtxoScript), covenant_id: asHex(REFUNDCLAIM_COV_ID), signature_script_hex: asHex(fullSigScript) },
        { utxo_value: 10, utxo_script_hex: asHex(ticketSpk), signature_script_hex: asHex(ticketRedeem) },
        { utxo_value: 10, utxo_script_hex: asHex(heldTokenSpk), signature_script_hex: asHex(heldTokenRedeem) },
      ],
      outputs,
    },
  };
  const dir = mkdtempSync(join(tmpdir(), 'j2-refundclaim-audit-'));
  const testFile = join(dir, `RefundClaim.${label}.test.json`);
  writeFileSync(testFile, JSON.stringify({ tests: [test] }, null, 2));
  console.log(`\n--- ${label} --- wrote ${testFile}`);
  const r = runDebugger(testFile, test.name);
  if (r.ok) console.log('✅ PASS');
  else if (r.crashed) console.log('💥 CRASH(疑似V-T-8: 运行期panic, 不是正常验证失败)');
  else console.log('❌ FAIL(正常验证失败, 不是崩溃)');
  if (!r.ok || process.env.VERBOSE) console.log(r.out.split('\n').slice(-25).join('\n'));
  return r;
}

console.log('=== RefundClaim.refund_payout 真实action witness cli-debugger审计(账本1473/1476 Bettor补跑要求) ===');
const fullResult = await runVariant({ label: 'full_no_continuation', pool_value: 5000, stake: 5000 });
const partialResult = await runVariant({ label: 'partial_with_continuation', pool_value: 5000, stake: 2000 });

console.log('\n=== 结论 ===');
console.log(`① full(pool_value==stake, 无续约): ${fullResult.ok ? 'PASS' : (fullResult.crashed ? 'CRASH' : 'FAIL')}`);
console.log(`② partial(pool_value≠stake, readInputStateWithTemplate+内建validateOutputState共存): ${partialResult.ok ? '✅ PASS——这个具体组合不触发V-T-8, RootClaim.sil头注那条纪律对本组合不适用(或本组合恰好不踩中触发条件), RefundClaim.sil当前代码可以安全用于partial退款' : partialResult.crashed ? '💥 CRASH——V-T-8真实存在于这个组合, RefundClaim.sil需要同RootClaim.claim_draw一样改AB11手写并同账本1469手法修own_redeem_len' : '❌ FAIL(正常验证失败, 非崩溃)——说明不是V-T-8问题, 是构造/逻辑本身有另一处不匹配, 需要进一步排查fixture或合约逻辑本身(不是self-splice offset类问题, 因为这条路径用的是内建validateOutputState不是手写slice)'}`);