// 06_audit_rootclose_refund_flip.mjs — 账本1473/1479 Step-0审计(续): RootClose.refund_flip真实执行。
// 不广播、不碰生产库。refund_flip不需要签名(纯noTokenInput+内建validateOutputState), 但需要
// tx.time(=lock_time字段, 编译为OpCheckLockTimeVerify, 需要>=deadline_ms+7200000且是CLTV时间戳量级)。
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

const { ps_tmpl_hash, token_tmpl_hash, token_prefix, token_suffix } = loadProtocolConstants();
const MARKET_ID = 'cc'.repeat(32);
const DEADLINE_MS = 1700000000000;
const COMMITTEE_HASH = randomBytes(32); // refund_flip不读committee_hash(closed==0+noTokenInput+CLTV), 占位即可
const CLAIM_TMPL_HASH = 'dd'.repeat(32), REFUNDCLAIM_TMPL_HASH = 'ee'.repeat(32);

const ctor = [
  ctorBytes32V100(COMMITTEE_HASH.toString('hex')), ctorIntV100(DEADLINE_MS),
  ctorBytes32V100(CLAIM_TMPL_HASH), ctorBytes32V100(REFUNDCLAIM_TMPL_HASH), ctorBytes32V100(token_tmpl_hash),
  ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ctorBytes32V100('00'.repeat(32)),
];
const compiled = compileSilV100(ROOT_CLOSE_SIL, ctor, 'RootClose');
const script = Buffer.from(compiled.script);
const entryAbi = compiled._raw.contracts.RootClose.entries.refund_flip;

const zeroTxid = new kaspa.Hash('00'.repeat(32));
const activeUtxoScript = p2sh(script);
const ROOTCLOSE_COV_ID = Buffer.from(String(kaspa.covenantId({ transactionId: zeroTxid, index: 0 }, [{ index: 0, output: { value: 10n, scriptPublicKey: { version: 0, script: activeUtxoScript } } }])), 'hex');

// 新state(closed:2), 用于重建rootOutIdx续约输出的期望P2SH(标准recompile手法)
const newCtor = [
  ctorBytes32V100(COMMITTEE_HASH.toString('hex')), ctorIntV100(DEADLINE_MS),
  ctorBytes32V100(CLAIM_TMPL_HASH), ctorBytes32V100(REFUNDCLAIM_TMPL_HASH), ctorBytes32V100(token_tmpl_hash),
  ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(2), ctorIntV100(0),
  ctorBytes32V100('00'.repeat(32)),
];
const newCompiled = compileSilV100(ROOT_CLOSE_SIL, newCtor, 'RootClose');
const newScript = Buffer.from(newCompiled.script);

const argsByName = { rootOutIdx: 1, tok_prefix: '0x' + token_prefix, tok_suffix: '0x' + token_suffix };
const actionHex = encodeEntryActionGeneric(kaspa, entryAbi, argsByName);
const fullSigScript = combineActionAndRedeem(kaspa, actionHex, script);

// tx.time来自lock_time字段(CLTV), 必须>=deadline_ms+7200000且是时间戳量级(>=LOCK_TIME_THRESHOLD 5e11)
const LOCK_TIME = DEADLINE_MS + 7200000 + 1000;

const test = {
  name: 'AUDIT_refund_flip_basic', function: 'refund_flip',
  constructor_args: [
    asHex(COMMITTEE_HASH), DEADLINE_MS, '0x' + CLAIM_TMPL_HASH, '0x' + REFUNDCLAIM_TMPL_HASH, '0x' + token_tmpl_hash,
    0, 0, 0, 0, 0, 0, '0x' + '00'.repeat(32),
  ],
  args: [1, '0x' + token_prefix, '0x' + token_suffix],
  expect: 'pass',
  tx: {
    version: 1,
    lock_time: LOCK_TIME,
    active_input_index: 0,
    inputs: [
      { utxo_value: 10, utxo_script_hex: asHex(activeUtxoScript), covenant_id: asHex(ROOTCLOSE_COV_ID), sig_op_count: 70, signature_script_hex: asHex(fullSigScript) },
    ],
    outputs: [
      { value: 10, p2pk_pubkey: asHex(randomBytes(32)) }, // idx0: 占位
      { value: 1000, covenant_id: asHex(ROOTCLOSE_COV_ID), script_hex: asHex(p2sh(newScript)) }, // idx1: rootOutIdx续约
    ],
  },
};
const dir = mkdtempSync(join(tmpdir(), 'j2-rootclose-refundflip-'));
const testFile = join(dir, 'RootClose.refund_flip.test.json');
writeFileSync(testFile, JSON.stringify({ tests: [test] }, null, 2));
console.log('wrote', testFile);
const r = runDebugger(testFile, test.name);
console.log(r.ok ? '✅ PASS' : '❌ FAIL');
console.log(r.out.split('\n').slice(-25).join('\n'));
