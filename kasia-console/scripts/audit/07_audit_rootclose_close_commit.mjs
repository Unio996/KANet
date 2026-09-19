// 07_audit_rootclose_close_commit.mjs — 账本1473/1479 Step-0审计(续): RootClose.close_commit真实
// 签名验证。不广播、不碰生产库。close_commit需要5个checkSig通过——这是本轮审计唯一涉及真实签名的入口。
//
// 方法论: 为了让checkSig验证通过, 我签名用的kaspa.Transaction必须与debugger内部重建/验证时用的tx
// 在影响sighash的每一个字段上逐位一致: version, lock_time, 每个input的prevOutpoint/sequence/
// sigOpCount(compute_commit)、每个input的UtxoEntry(amount+scriptPublicKey)、每个output的value+
// scriptPublicKey。debugger对未显式给prev_txid的input用默认值(全0字节, 见main.rs default_prev_txid
// = [input_idx as u8; 32]); sequence默认0; sig_op_count默认100(但我们显式覆盖成70匹配v1约定)。
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('../../node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => Buffer.from(blake2b(Uint8Array.from(buf), { dkLen: 32 }));
const p2sh = (bc) => Buffer.concat([Buffer.from([0xaa, 0x20]), b2b(bc), Buffer.from([0x87])]);
const asHex = (v) => '0x' + Buffer.from(v).toString('hex');

if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
const kaspa = await import('kaspa-wasm');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../../src/lib/pool-bshard-artifacts.mjs');
const { loadProtocolConstants } = await import('../../src/lib/proto-covenant-builder.mjs');
const { encodeEntryActionGeneric, combineActionAndRedeem } = await import('./generic-entry-witness.mjs');

const ROOT_CLOSE_SIL = new URL('../../src/lib/RootClose.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CLI_DEBUGGER = process.env.CLI_DEBUGGER_PATH || 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
function runDebugger(testFile, testName) {
  try {
    const out = execFileSync(CLI_DEBUGGER, [ROOT_CLOSE_SIL, '--run', '--test-name', testName, '--test-file', testFile], { encoding: 'utf8', timeout: 30000 });
    return { ok: /(^|\n)PASS/.test(out), out };
  } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') + e.message }; }
}

const { token_tmpl_hash, token_prefix, token_suffix } = loadProtocolConstants();
const DEADLINE_MS = 1700000000000;
const CLAIM_TMPL_HASH = 'dd'.repeat(32), REFUNDCLAIM_TMPL_HASH = 'ee'.repeat(32);

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const pubkeyHex = priv.toPublicKey().toXOnlyPublicKey().toString(); // silverscript pubkey(32B) = x-only
const pubkeyBuf = Buffer.from(pubkeyHex, 'hex');
if (pubkeyBuf.length !== 32) throw new Error(`pubkey must be 32B, got ${pubkeyBuf.length} (${pubkeyHex})`);
const COMMITTEE_HASH = b2b(Buffer.concat([pubkeyBuf, pubkeyBuf, pubkeyBuf, pubkeyBuf, pubkeyBuf]));

const ctor = [
  ctorBytes32V100(COMMITTEE_HASH.toString('hex')), ctorIntV100(DEADLINE_MS),
  ctorBytes32V100(CLAIM_TMPL_HASH), ctorBytes32V100(REFUNDCLAIM_TMPL_HASH), ctorBytes32V100(token_tmpl_hash),
  ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ctorBytes32V100('00'.repeat(32)),
];
const compiled = compileSilV100(ROOT_CLOSE_SIL, ctor, 'RootClose');
const script = Buffer.from(compiled.script);
const entryAbi = compiled._raw.contracts.RootClose.entries.close_commit;

const zeroTxid = new kaspa.Hash('00'.repeat(32));
const activeUtxoScript = p2sh(script);
const ROOTCLOSE_COV_ID = Buffer.from(String(kaspa.covenantId({ transactionId: zeroTxid, index: 0 }, [{ index: 0, output: { value: 10n, scriptPublicKey: { version: 0, script: activeUtxoScript } } }])), 'hex');

const NEW_PAYOUT_ROOT = randomBytes(32);
// 新state: init_closed=1(close_commit结果), init_winningSide=0, init_payoutRoot=NEW_PAYOUT_ROOT
const newCtorFixed = [
  ctorBytes32V100(COMMITTEE_HASH.toString('hex')), ctorIntV100(DEADLINE_MS),
  ctorBytes32V100(CLAIM_TMPL_HASH), ctorBytes32V100(REFUNDCLAIM_TMPL_HASH), ctorBytes32V100(token_tmpl_hash),
  ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(1), ctorIntV100(0),
  ctorBytes32V100(NEW_PAYOUT_ROOT.toString('hex')),
];
const newCompiled = compileSilV100(ROOT_CLOSE_SIL, newCtorFixed, 'RootClose');
const newScript = Buffer.from(newCompiled.script);

const SIG_OP_COUNT = 70; // v1约定: computeBudget=70(经由compute_commit统一字段, 同sig_op_count JSON key)
const LOCK_TIME = DEADLINE_MS + 1000; // close_commit要求 tx.time >= temporal(deadline_ms)

// ── 构造真实kaspa.Transaction用于签名, 每个影响sighash的字段都对齐debugger默认值 ──
// 字段形状照抄production既有约定(proto-tx-assembly.mjs mkInput: utxo里必须重复outpoint字段, amount
// 不是value, 无isCoinbase)。
const outpointObj = { transactionId: '00'.repeat(32), index: 0 };
const activeUtxoSpkObj = new kaspa.ScriptPublicKey(0, activeUtxoScript.toString('hex'));
const txInput = {
  previousOutpoint: outpointObj, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: SIG_OP_COUNT,
  utxo: { outpoint: outpointObj, amount: 10n, scriptPublicKey: activeUtxoSpkObj, blockDaaScore: 0n },
};
const placeholderOutSpk = kaspa.payToAddressScript(priv.toPublicKey().toAddress('mainnet'));
const newScriptSpk = new kaspa.ScriptPublicKey(0, p2sh(newScript).toString('hex'));
const txOutputs = [
  new kaspa.TransactionOutput(10n, placeholderOutSpk), // idx0 占位
  new kaspa.TransactionOutput(1000n, newScriptSpk), // idx1 rootOutIdx续约
];
const unsignedTx = new kaspa.Transaction({
  version: 1, inputs: [txInput], outputs: txOutputs, lockTime: BigInt(LOCK_TIME),
  subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
});

const sig66 = kaspa.createInputSignature(unsignedTx, 0, priv, kaspa.SighashType.All);
console.log('sig66 hex length', sig66.length, 'value', sig66.slice(0, 20) + '...');
// createInputSignature返回push-encoded 66B([0x41][64sig][0x01])——entry参数的sig类型ABI要RAW 65B
// (push_fixed_bytes内部自己再包一层push), 需要去掉开头1字节push-opcode前缀。
const sig65Hex = sig66.slice(2); // 去掉开头"41"(1字节hex=2字符)
console.log('sig65 hex length', sig65Hex.length, '(应为130=65*2)');

const argsByName = {
  c0Pk: asHex(pubkeyBuf), c1Pk: asHex(pubkeyBuf), c2Pk: asHex(pubkeyBuf), c3Pk: asHex(pubkeyBuf), c4Pk: asHex(pubkeyBuf),
  c0Sig: '0x' + sig65Hex, c1Sig: '0x' + sig65Hex, c2Sig: '0x' + sig65Hex, c3Sig: '0x' + sig65Hex, c4Sig: '0x' + sig65Hex,
  rootOutIdx: 1, new_winningSide: 0, new_payoutRoot: asHex(NEW_PAYOUT_ROOT),
  tok_prefix: '0x' + token_prefix, tok_suffix: '0x' + token_suffix,
};
const actionHex = encodeEntryActionGeneric(kaspa, entryAbi, argsByName);
const fullSigScript = combineActionAndRedeem(kaspa, actionHex, script);

const test = {
  name: 'AUDIT_close_commit_basic', function: 'close_commit',
  constructor_args: [
    asHex(COMMITTEE_HASH), DEADLINE_MS, '0x' + CLAIM_TMPL_HASH, '0x' + REFUNDCLAIM_TMPL_HASH, '0x' + token_tmpl_hash,
    0, 0, 0, 0, 0, 0, '0x' + '00'.repeat(32),
  ],
  args: [asHex(pubkeyBuf), asHex(pubkeyBuf), asHex(pubkeyBuf), asHex(pubkeyBuf), asHex(pubkeyBuf),
    '0x' + sig65Hex, '0x' + sig65Hex, '0x' + sig65Hex, '0x' + sig65Hex, '0x' + sig65Hex,
    1, 0, asHex(NEW_PAYOUT_ROOT), '0x' + token_prefix, '0x' + token_suffix],
  expect: 'pass',
  tx: {
    version: 1, lock_time: LOCK_TIME, active_input_index: 0,
    inputs: [
      { utxo_value: 10, utxo_script_hex: asHex(activeUtxoScript), covenant_id: asHex(ROOTCLOSE_COV_ID), sequence: 0, sig_op_count: 0, signature_script_hex: asHex(fullSigScript) },
    ],
    outputs: [
      { value: 10, script_hex: '0x' + placeholderOutSpk.script }, // 🔴 placeholderOutSpk.script是hex字符串(kaspa-wasm既有坑,
      // 见generic-entry-witness.mjs同类修复注释)——之前这里用Buffer.from(...)把hex字符串当UTF8文本
      // 二次编码, 导致debugger内部构造的output[0]与签名时真实用的output[0]完全不同, 直接改变sighash
      // ——这正是close_commit checkSig失败的真根因, 用eprintln转储J2_TX_DEBUG output[0]比对发现。
      { value: 1000, covenant_id: asHex(ROOTCLOSE_COV_ID), script_hex: asHex(p2sh(newScript)) },
    ],
  },
};
const dir = mkdtempSync(join(tmpdir(), 'j2-rootclose-closecommit-'));
const testFile = join(dir, 'RootClose.close_commit.test.json');
writeFileSync(testFile, JSON.stringify({ tests: [test] }, null, 2));
console.log('wrote', testFile);
const r = runDebugger(testFile, test.name);
console.log(r.ok ? '✅ PASS' : '❌ FAIL');
console.log(r.out.split('\n').slice(-30).join('\n'));

console.log('=== MY SIGNED TX DUMP (for manual diff against J2_TX_DEBUG) ===');
console.log('unsignedTx.version', unsignedTx.version, 'lockTime', unsignedTx.lockTime);
for (let i = 0; i < unsignedTx.inputs.length; i++) {
  const inp = unsignedTx.inputs[i];
  console.log(`input[${i}] prevTxid=${inp.previousOutpoint.transactionId} prevIndex=${inp.previousOutpoint.index} sequence=${inp.sequence} sigOpCount=${inp.sigOpCount} computeBudget=${inp.computeBudget}`);
}
for (let i = 0; i < unsignedTx.outputs.length; i++) {
  const out = unsignedTx.outputs[i];
  console.log(`output[${i}] value=${out.value} spkVersion=${out.scriptPublicKey.version} spkScript=${out.scriptPublicKey.script}`);
}
