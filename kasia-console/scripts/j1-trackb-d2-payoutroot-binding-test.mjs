// J1 offline teeth-test: D2 verify-value-source — verifyClosePayoutRootBinding (Track B, 2026-06-22).
//   验【被签 tx 实际 commit 的 payoutRoot】(continuation output P2SH-embedded, SIGHASH_ALL 覆盖) == re-derive,
//   不是 caller 旁路标量。这是 NWT 红队最承重 finding (D2)。
//
//   ⚠ 牙非 vacuous: 用【真 kaspa-wasm】createPayToScriptHashScript + serializeToSafeJSON 造 txSafeJson →
//   T1 honest PASS 即证【我 lib 的 _splice + _p2shSpkHex == 真 Kaspa P2SH scriptPubKey byte-equal】(2-impl byte-match);
//   T2 D2-attack(tx commit 别的根 + 匹配标量)必 REJECT = 修前漏过 / 修后真拒, 单变量 A/B。
//
//   独立 splice impl (test 侧 = "relay 侧" mimic, 跟 lib 内 _splicePayoutCloseRedeem 不同源 → cross-check)。
import { verifyClosePayoutRootBinding } from '../src/lib/bshard-close-enforce.mjs';
const W = await import('file:///D:/rusty-kaspa/wasm/nodejs/kaspa/kaspa.js');
const { Transaction, TransactionOutput, Address, payToAddressScript, ScriptBuilder, addressFromScriptPublicKey, CovenantBinding, Hash } = W;
const NET = 'testnet-12';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

const i64LE = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const push8 = (buf) => Buffer.concat([Buffer.from([0x08]), buf]);
const push32 = (buf) => Buffer.concat([Buffer.from([0x20]), buf]);
const z32 = Buffer.alloc(32);

// 造一个 PayoutShard-shape input redeem (state_start=1): [prefix 1B] [consolidated_pool] [closed=0] [payoutRoot=0] [w0..w16] [suffix].
function buildInputRedeem(poolSompi) {
  const prefix = Buffer.from([0x51]);                       // selector dispatch 前导 (state_start=1)
  const state = Buffer.concat([
    push8(i64LE(poolSompi)),                                // consolidated_pool
    push8(i64LE(0)),                                        // closed=0 (input 未关)
    push32(z32),                                            // payoutRoot=0
    ...Array.from({ length: 17 }, () => push8(i64LE(0))),   // w0..w16
  ]);
  const suffix = Buffer.from('ee'.repeat(300), 'hex');     // 合约 body (任意; D2 不碰它)
  return Buffer.concat([prefix, state, suffix]).toString('hex');
}

// "relay 侧" 独立 splice (mimic _continuationAddress 全 state 区替换; 与 lib _splicePayoutCloseRedeem 独立实现互证)。
const PS_STATE_START = 1, PS_STATE_LEN = 9 + 9 + 33 + 17 * 9;   // 204
function relaySpliceCont(inputRedeemHex, poolSompi, payoutRootHex) {
  const redeem = Buffer.from(inputRedeemHex, 'hex');
  const newState = Buffer.concat([
    push8(i64LE(poolSompi)),                                            // consolidated_pool 透传
    push8(i64LE(1)),                                                    // closed 0→1
    push32(Buffer.from(payoutRootHex, 'hex')),                         // payoutRoot 写入
    ...Array.from({ length: 17 }, () => push8(i64LE(0))),               // w0..w16 透传(全0)
  ]);
  return Buffer.concat([redeem.slice(0, PS_STATE_START), newState, redeem.slice(PS_STATE_START + PS_STATE_LEN)]).toString('hex');
}
const p2shAddr = (redeemHex) => addressFromScriptPublicKey(ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), NET).toString();

// 造 txSafeJson: PS continuation output(covenant-bound, spk=P2SH(contRedeem)) + change output(无 covenant)。
function buildTxSafeJson({ contRedeemHexes, covId = 'cd'.repeat(32), changeOnly = false }) {
  const change = new TransactionOutput(5_000_000n, payToAddressScript(new Address(p2shAddr('ff'.repeat(40)))));   // change(无 covenant)
  const outputs = changeOnly ? [change]
    : [...contRedeemHexes.map(h => new TransactionOutput(100_000_000n, payToAddressScript(new Address(p2shAddr(h))), new CovenantBinding(0, new Hash(covId)))), change];
  const un = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: 'ab'.repeat(32), index: 0 }, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: 70,
      utxo: { outpoint: { transactionId: 'ab'.repeat(32), index: 0 }, amount: 100_000_000n, scriptPublicKey: payToAddressScript(new Address(p2shAddr('aa'.repeat(40)))), blockDaaScore: 0n } }],
    outputs, lockTime: 0n, gas: 0n, subnetworkId: '0'.repeat(40), payload: '',
  });
  return un.serializeToSafeJSON();
}

const POOL = 120_000_000n;
const inputRedeem = buildInputRedeem(POOL);
const goodRoot = Buffer.from('11'.repeat(32), 'hex').toString('hex');
const badRoot = Buffer.from('22'.repeat(32), 'hex').toString('hex');
const goodContRedeem = relaySpliceCont(inputRedeem, POOL, goodRoot);
const badContRedeem = relaySpliceCont(inputRedeem, POOL, badRoot);

console.log('== T1: honest — tx commit goodRoot, re-derive goodRoot → ok (= 我 splice/spk == 真 Kaspa P2SH byte-equal) ==');
const t1 = verifyClosePayoutRootBinding({ txSafeJson: buildTxSafeJson({ contRedeemHexes: [goodContRedeem] }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
ok(t1.ok === true, `ok (matchedOutputs=${t1.matchedOutputs}, expectedSpk=${(t1.expectedSpk || '').slice(0, 18)}.. reason=${t1.reason || '-'})`);

console.log('== T2: 🦷 D2-attack — tx continuation output commit badRoot, re-derive goodRoot → REJECT ==');
const t2 = verifyClosePayoutRootBinding({ txSafeJson: buildTxSafeJson({ contRedeemHexes: [badContRedeem] }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
ok(t2.ok === false && /D2 REJECT/.test(t2.reason), `rejected: ${t2.reason}`);

console.log('== T3: 🦷 D2-attack decoy — 真 continuation=badRoot + decoy 加 goodRoot covenant output → REJECT(全 covenant out 必对) ==');
const t3 = verifyClosePayoutRootBinding({ txSafeJson: buildTxSafeJson({ contRedeemHexes: [badContRedeem, goodContRedeem] }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
ok(t3.ok === false && /D2 REJECT/.test(t3.reason), `rejected: ${t3.reason}`);

console.log('== T4: no covenant continuation output (change-only tx) → REJECT (非合法 close_attest) ==');
const t4 = verifyClosePayoutRootBinding({ txSafeJson: buildTxSafeJson({ changeOnly: true }), psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
ok(t4.ok === false && /无 covenant continuation/.test(t4.reason), `rejected: ${t4.reason}`);

console.log('== T5: txSafeJson 解析失败 → fail-loud ==');
const t5 = verifyClosePayoutRootBinding({ txSafeJson: 'not-json', psRedeemHex: inputRedeem, reDerivedRoot: goodRoot });
ok(t5.ok === false && /parse fail/.test(t5.reason), `fail-loud: ${t5.reason}`);

console.log('== T6: psRedeem 太短 (非 PayoutShard) → fail-loud ==');
const t6 = verifyClosePayoutRootBinding({ txSafeJson: buildTxSafeJson({ contRedeemHexes: [goodContRedeem] }), psRedeemHex: 'aa'.repeat(20), reDerivedRoot: goodRoot });
ok(t6.ok === false && /splice fail|太短/.test(t6.reason), `fail-loud: ${t6.reason}`);

console.log('== T7: 多 honest winner-set 变 root → 同一 tx 验另一个 root 必 REJECT (root 灵敏度) ==');
const otherRoot = Buffer.from('33'.repeat(32), 'hex').toString('hex');
const t7 = verifyClosePayoutRootBinding({ txSafeJson: buildTxSafeJson({ contRedeemHexes: [goodContRedeem] }), psRedeemHex: inputRedeem, reDerivedRoot: otherRoot });
ok(t7.ok === false && /D2 REJECT/.test(t7.reason), `rejected: ${t7.reason}`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
