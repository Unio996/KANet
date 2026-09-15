// 01_audit_rootclaim_claim_draw.mjs — 账本1473 Step-0只读审计: RootClaim.claim_draw partial分支
// (触发self-splice)与full分支(不触发)真实cli-debugger执行对照。不广播、不碰生产库。
//
// 方法论: 唯一让cli-debugger使用【我们自己构造】的active input字节(而非它自己合成的短见证——
// 这正是账本1468里掩盖bug 4次的那个机制)的办法是显式给active input传 signature_script_hex。
// 本脚本对claim_draw的16个真实witness参数(v0.3代币化后的当前版本, 非docs/provenance/2026-09-14-
// j2-t3-v03-drawdown-mustfix/里那份9参数、代币化前的旧版本——那份"4/4 PASS"的证据对当前合约不适用,
// 已在设计文档里单独记录)全部按真实ABI编码, tok_prefix/suffix、claim_prefix/suffix用真实协议常量
// (现实尺寸, 不是短占位), redeem reveal = 真实compileSilV100产物。
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

const ROOT_CLAIM_SIL = new URL('../../src/lib/RootClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KTC_SIL = new URL('../../src/lib/KanetTokenClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ANCHORS_JSON = new URL('../../scripts/proto-v0-template-anchors.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const anchors = JSON.parse(readFileSync(ANCHORS_JSON, 'utf8'));
const claimPrefixHex = '0x' + anchors.contracts.KanetTokenClaim.templatePrefixHex;
const claimSuffixHex = '0x' + anchors.contracts.KanetTokenClaim.templateSuffixHex;
const CLAIM_TMPL_HASH = anchors.contracts.KanetTokenClaim.claim_tmpl_hash;

const CLI_DEBUGGER = process.env.CLI_DEBUGGER_PATH || 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
function runDebugger(testFile, testName) {
  try {
    const out = execFileSync(CLI_DEBUGGER, [ROOT_CLAIM_SIL, '--run', '--test-name', testName, '--test-file', testFile], { encoding: 'utf8', timeout: 30000 });
    return { ok: /(^|\n)PASS/.test(out), out };
  } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') + e.message }; }
}

const { ps_tmpl_hash, token_tmpl_hash, token_prefix, token_suffix } = loadProtocolConstants();
const MARKET_ID = 'cd'.repeat(32);

function compileRootClaim({ pool_value, winningSide, payoutRoot, claimed_bitmap }) {
  const ctor = [
    ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(pool_value),
    ctorIntV100(1), ctorIntV100(winningSide), ctorBytes32V100(payoutRoot.toString('hex')), ctorIntV100(claimed_bitmap),
    ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(CLAIM_TMPL_HASH),
  ];
  const compiled = compileSilV100(ROOT_CLAIM_SIL, ctor, 'RootClaim');
  return { script: Buffer.from(compiled.script), entryAbi: compiled._raw.contracts.RootClaim.entries.claim_draw };
}

function kanetTokenClaimGenesisScript({ marketCovId, winnerPk, amount }) {
  const ctor = [ctorBytes32V100(marketCovId.toString('hex')), ctorBytes32V100(winnerPk.toString('hex')), ctorIntV100(amount), ctorBytes32V100(token_tmpl_hash)];
  const compiled = compileSilV100(KTC_SIL, ctor, 'KanetTokenClaim');
  return Buffer.from(compiled.script);
}

function merkleFor(bettorPk, payout, otherLeaf, index) {
  const leaf = b2b(Buffer.concat([bettorPk, le8(payout)]));
  const root = index === 0 ? b2b(Buffer.concat([leaf, otherLeaf])) : b2b(Buffer.concat([otherLeaf, leaf]));
  return { leaf, root, sibling: otherLeaf };
}

const BETTOR_PK = randomBytes(32);
const OTHER_LEAF = randomBytes(32);
// ticket输入用手写redeem(真实ps_prefix/ps_suffix+手写state, 见runVariant内联构造)——不需要额外的
// action前缀。readInputStateWithTemplate这个builtin按sigScript末尾往回算offset(源码
// silverscript-lang/src/compiler/compile/state.rs已读证实, 不受前置字节影响), 所以ticket输入
// 不需要真实entry调用的action前缀也能验证claim_draw自己的self-splice逻辑, 这不是走捷径, 是这条
// builtin本身的正确设计——本轮audit目标是claim_draw自己的AB11手写slice, 不是ticket读取正确性
// (那部分另有既有向量覆盖, 未在本次范围内重复验证)。

async function runVariant({ label, pool_value, payout, expectPass, useBuggyOffset = false }) {
  const isPartial = pool_value !== payout;
  const { leaf, root, sibling } = merkleFor(BETTOR_PK, payout, OTHER_LEAF, 0);
  const { script, entryAbi } = compileRootClaim({ pool_value, winningSide: 0, payoutRoot: root, claimed_bitmap: 0 });

  // debugger对active input(covenant session模式)要求covenant_id与"genesis"公式一致: 默认funding
  // outpoint = (txid=32字节全0, index=0)(源码default_prev_txid.fill(input_idx as u8), input_idx=0时全0)
  // + 本输出(index=0, scriptPublicKey=本input的P2SH)。kaspa.covenantId是consensus同款纯函数
  // (production代码proto-tx-assembly.mjs已在用, 见shardLeafCovId计算), 实测证实用它算出的值能过
  // WrongGenesisCovenantId检查(02_probe_genesis_covid.mjs探针确认)。
  const zeroTxid = new kaspa.Hash('00'.repeat(32));
  const activeUtxoScript = p2sh(script);
  const ROOTCLAIM_COV_ID = Buffer.from(String(kaspa.covenantId({ transactionId: zeroTxid, index: 0 }, [{ index: 0, output: { value: 10n, scriptPublicKey: { version: 0, script: activeUtxoScript } } }])), 'hex');

  const { ps_prefix, ps_suffix } = loadProtocolConstants();
  const psPrefixBuf = Buffer.from(ps_prefix, 'hex'), psSuffixBuf = Buffer.from(ps_suffix, 'hex');
  // ticket state: Tk{bettorPk, direction, stake, shardPoolId} — 4字段, 手写按established length-prefix编码拼进ticket redeem(prefix+state+suffix), 用真实ps_prefix/ps_suffix。
  const ticketStateBytes = Buffer.concat([fieldBytes32(BETTOR_PK), fieldInt(0), fieldInt(payout), fieldBytes32(Buffer.from(MARKET_ID, 'hex'))]);
  const ticketRedeem = Buffer.concat([psPrefixBuf, ticketStateBytes, psSuffixBuf]);
  const ticketSpk = p2sh(ticketRedeem);

  // token state(heldTk): amount=pool_value, owner=ROOTCLAIM_COV_ID, owner_scheme=0x04, borrow_scheme=0x00, borrow_guard/extension_commitment=ZERO32
  const tokenPrefixBuf = Buffer.from(token_prefix, 'hex'), tokenSuffixBuf = Buffer.from(token_suffix, 'hex');
  const ZERO32 = Buffer.alloc(32);
  const heldTokenStateBytes = Buffer.concat([
    fieldInt(pool_value), fieldBytes32(ROOTCLAIM_COV_ID),
    Buffer.from([1, 0x04]), Buffer.from([1, 0x00]), fieldBytes32(ZERO32), fieldBytes32(ZERO32),
  ]);
  const heldTokenRedeem = Buffer.concat([tokenPrefixBuf, heldTokenStateBytes, tokenSuffixBuf]);
  const heldTokenSpk = p2sh(heldTokenRedeem);

  // claimOutIdx期望输出: KanetTokenClaim genesis(market_cov_id=ROOTCLAIM_COV_ID, winner_pk=BETTOR_PK, amount=payout)
  const claimGenesisScript = kanetTokenClaimGenesisScript({ marketCovId: ROOTCLAIM_COV_ID, winnerPk: BETTOR_PK, amount: payout });
  const claimGenesisSpk = p2sh(claimGenesisScript);
  // 🔴 真正理解WrongGenesisCovenantId后订正: claimOutIdx自己的covenant_id是【独立于】ROOTCLAIM_COV_ID的
  // 一个新派生值(读rusty-kaspa crypto/txscript/src/covenants.rs:140-158确认: 每个genesis输出的
  // covenant_id = covenant_id(授权input的previous_outpoint, [(该输出index, 该输出)])——只含这一个
  // 输出自己, 不是任意值)。之前把claimOutIdx与tokenOutIdx的covenant_id都设成同一个随机CLAIM_COV_ID
  // 是构造错误(会被debugger当成"两个输出共享同一个genesis组"从而按两个输出一起重算hash, 而我给的
  // 值只按claimOutIdx一个输出算的, 对不上)。
  const zeroOutpoint = { transactionId: zeroTxid, index: 0 };
  const CLAIM_OUT_COV_ID = Buffer.from(String(kaspa.covenantId(zeroOutpoint, [{ index: 1, output: { value: 10n, scriptPublicKey: { version: 0, script: claimGenesisSpk } } }])), 'hex');

  // tokenOutIdx期望输出: KanetTestToken genesis(owner=CLAIM_OUT_COV_ID即claimOutIdx真实covenant_id, amount=payout) —— 复用生产函数
  const tokenOutArtifact = computeKttGenesisArtifact({ amount: payout, ownerCovIdHex: CLAIM_OUT_COV_ID.toString('hex') });
  const TOKEN_OUT_COV_ID = Buffer.from(String(kaspa.covenantId(zeroOutpoint, [{ index: 2, output: { value: 10n, scriptPublicKey: { version: 0, script: Buffer.from(tokenOutArtifact.scriptPubKeyHex.slice(2), 'hex') } } }])), 'hex');

  // remainTokenOutIdx(仅partial分支存在, 独立输出index=3): KanetTestToken剩余量续约, owner=
  // OpInputCovenantId(this.activeInputIndex)=ROOTCLAIM_COV_ID(RootClaim自己继续持有), amount=pool_value-payout。
  let remainTokenArtifact = null, REMAIN_TOKEN_COV_ID = null;
  if (isPartial) {
    remainTokenArtifact = computeKttGenesisArtifact({ amount: pool_value - payout, ownerCovIdHex: ROOTCLAIM_COV_ID.toString('hex') });
    REMAIN_TOKEN_COV_ID = Buffer.from(String(kaspa.covenantId(zeroOutpoint, [{ index: 3, output: { value: 10n, scriptPublicKey: { version: 0, script: Buffer.from(remainTokenArtifact.scriptPubKeyHex.slice(2), 'hex') } } }])), 'hex');
  }

  const argsByName = {
    rootOutIdx: 4, claimOutIdx: 1, tokenInIdx: 2, tokenOutIdx: 2, remainTokenOutIdx: 3,
    payout, merkle_index: 0, tree_depth: 1, siblings: [[...sibling]],
    ticketInIdx: 1, ticket_prefix_len: psPrefixBuf.length, ticket_suffix_len: psSuffixBuf.length,
    tok_prefix: '0x' + token_prefix, tok_suffix: '0x' + token_suffix,
    claim_prefix: claimPrefixHex, claim_suffix: claimSuffixHex,
  };
  const action = encodeEntryActionGeneric(kaspa, entryAbi, argsByName);
  const fullSigScript = combineActionAndRedeem(kaspa, action, script);

  let rootOutScriptPubKey = null;
  if (isPartial) {
    const OWN_PREFIX_LEN = 1, OWN_STATE_LEN = 96;
    const newMask = 1; // merkle_index=0 -> mask=1
    const stateBytesNew = Buffer.concat([
      fieldInt(0), fieldInt(0), fieldInt(0), fieldInt(pool_value - payout), fieldInt(1), fieldInt(0),
      fieldBytes32(root), fieldInt(newMask),
    ]);
    if (useBuggyOffset) {
      // 复现合约自己会算出的(bug)值: 从完整sigScript(含action witness前缀)的字节0切——同
      // RootClaim.sil当前代码`ownSig.slice(0, OWN_PREFIX_LEN)`逐字节复刻。
      const buggyPrefix = fullSigScript.subarray(0, OWN_PREFIX_LEN);
      const buggySuffix = fullSigScript.subarray(OWN_PREFIX_LEN + OWN_STATE_LEN, fullSigScript.length);
      const buggyHash = b2b(Buffer.concat([buggyPrefix, stateBytesNew, buggySuffix]));
      rootOutScriptPubKey = p2sh(buggyHash);
    } else {
      // "正确"offset(相对sigScript末尾, 同register_append已修复手法) —— 这是诚实backend若照抄已修的
      // register_append手法会自然构造出的值。
      const correctPrefix = script.subarray(0, OWN_PREFIX_LEN);
      const correctSuffix = script.subarray(OWN_PREFIX_LEN + OWN_STATE_LEN);
      const correctHash = b2b(Buffer.concat([correctPrefix, stateBytesNew, correctSuffix]));
      rootOutScriptPubKey = p2sh(correctHash);
    }
  }

  const outputs = [
    { value: 10, p2pk_pubkey: asHex(randomBytes(32)) }, // idx0: 占位(未用)
    { value: 10, covenant_id: asHex(CLAIM_OUT_COV_ID), script_hex: asHex(claimGenesisSpk) }, // idx1: claimOutIdx(covenant_id=独立派生, 见上方说明)
    { value: 10, covenant_id: asHex(TOKEN_OUT_COV_ID), script_hex: tokenOutArtifact.scriptPubKeyHex }, // idx2: tokenOutIdx(scriptPubKeyHex已带0x, 不再套asHex避免二次编码)
  ];
  if (isPartial) {
    outputs.push({ value: 10, covenant_id: asHex(REMAIN_TOKEN_COV_ID), script_hex: remainTokenArtifact.scriptPubKeyHex }); // idx3: remainTokenOutIdx
    outputs.push({ value: 10, covenant_id: asHex(ROOTCLAIM_COV_ID), script_hex: asHex(rootOutScriptPubKey) }); // idx4: rootOutIdx(self续约, covenant_id与input[0]相同=continuation, 不是genesis)
  }

  const test = {
    name: `AUDIT_claim_draw_${label}`, function: 'claim_draw',
    constructor_args: [
      '0x' + ps_tmpl_hash, '0x' + MARKET_ID, 0, 0, 0, pool_value, 1, 0, asHex(root), 0,
      '0x' + token_tmpl_hash, '0x' + CLAIM_TMPL_HASH,
    ],
    args: [argsByName.rootOutIdx, argsByName.claimOutIdx, argsByName.tokenInIdx, argsByName.tokenOutIdx, argsByName.remainTokenOutIdx,
      payout, 0, 1, [asHex(sibling)], argsByName.ticketInIdx, argsByName.ticket_prefix_len, argsByName.ticket_suffix_len,
      '0x' + token_prefix, '0x' + token_suffix, claimPrefixHex, claimSuffixHex],
    expect: expectPass ? 'pass' : 'fail',
    tx: {
      active_input_index: 0,
      inputs: [
        { utxo_value: 10, utxo_script_hex: asHex(activeUtxoScript), covenant_id: asHex(ROOTCLAIM_COV_ID), signature_script_hex: asHex(fullSigScript) },
        { utxo_value: 10, utxo_script_hex: asHex(ticketSpk), signature_script_hex: asHex(ticketRedeem) },
        { utxo_value: 10, utxo_script_hex: asHex(heldTokenSpk), signature_script_hex: asHex(heldTokenRedeem) },
      ],
      outputs,
    },
  };
  const dir = mkdtempSync(join(tmpdir(), 'j2-rootclaim-claimdraw-'));
  const testFile = join(dir, `RootClaim.${label}.test.json`);
  writeFileSync(testFile, JSON.stringify({ tests: [test] }, null, 2));
  console.log(`\n--- ${label} --- wrote ${testFile}`);
  const r = runDebugger(testFile, test.name);
  console.log(r.ok ? `✅ PASS` : `❌ FAIL`);
  if (!r.ok || process.env.VERBOSE) console.log(r.out.split('\n').slice(-25).join('\n'));
  return r.ok;
}

console.log('=== RootClaim.claim_draw 真实action witness(现实尺寸) cli-debugger审计(账本1473 Step-0) ===');
const fullResult = await runVariant({ label: 'full_no_continuation', pool_value: 5000, payout: 5000, expectPass: true });
const partialCorrectResult = await runVariant({ label: 'partial_correct_offset', pool_value: 5000, payout: 2000, expectPass: true, useBuggyOffset: false });
const partialBuggyResult = await runVariant({ label: 'partial_buggy_offset', pool_value: 5000, payout: 2000, expectPass: true, useBuggyOffset: true });

console.log('\n=== 结论 ===');
console.log(`① full(无自续约, 不触碰self-splice代码): ${fullResult ? 'PASS(符合预期——不经过bug代码路径)' : 'FAIL(意外! 需要重新检查fixture构造是否有误)'}`);
console.log(`② partial, 诚实backend"正确offset"(相对sigScript末尾, 同register_append已修复手法)构造: ${partialCorrectResult ? 'PASS(未复现bug——需要重新核实假设)' : 'FAIL(符合1468同类bug预期: 合约内部用ownSig.slice(0,...)从字节0切, 拒绝了诚实backend自然会产出的续约输出)'}`);
console.log(`③ partial, 复刻合约自己的"bug offset"(从完整sigScript字节0切)构造: ${partialBuggyResult ? 'PASS(证实合约本身只在偷偷复刻了它自己bug的情况下才通过——这正是1468同类defect的确诊标志: 正确构造被拒、错误构造被接受)' : 'FAIL(意外——若②③都FAIL需要重新检查fixture本身是否有其它构造错误)'}`);
