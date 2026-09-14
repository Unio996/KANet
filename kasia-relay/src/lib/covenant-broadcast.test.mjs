// covenant-broadcast.test.mjs — §9.2 安全约束纯函数向量(J2 2026-09-14, NWT 1352/1353 打回后)。
// 纯函数, 零 DB/零 wasm/零网络。同 cltv-locktime.test.mjs 既有 t()/assert 手法。
// Run: cd kasia-relay && node src/lib/covenant-broadcast.test.mjs

import assert from 'node:assert';
import {
  validateSignedInputCeiling, validateNetLoss, computeRequiredFeeSompi, assertFinalTxid,
  ABS_FEE_CAP_SOMPI, SIGNED_INPUT_CEILING_SOMPI, SOMPI_PER_MASS,
} from './covenant-broadcast.mjs';

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

const RELAY_SPK = 'aa'.repeat(35);
const OTHER_SPK = 'bb'.repeat(35);

// ── validateSignedInputCeiling ────────────────────────────────────────────
t('SIC-1 单输入在上限内 ⇒ ok', () => {
  const r = validateSignedInputCeiling({ inputs: [{ amountSompi: 1_000_000n }], signInputIndices: [0] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.signedInputTotalSompi, 1_000_000n);
});
t('SIC-2 恰好等于上限 ⇒ ok(闭区间)', () => {
  const r = validateSignedInputCeiling({ inputs: [{ amountSompi: SIGNED_INPUT_CEILING_SOMPI }], signInputIndices: [0] });
  assert.strictEqual(r.ok, true);
});
t('SIC-3 超过上限 1 sompi ⇒ 拒', () => {
  const r = validateSignedInputCeiling({ inputs: [{ amountSompi: SIGNED_INPUT_CEILING_SOMPI + 1n }], signInputIndices: [0] });
  assert.strictEqual(r.ok, false);
  assert.ok(/exceeds SIGNED_INPUT_CEILING/.test(r.reason));
});
t('SIC-4 多个签名输入求和后超限 ⇒ 拒(不是逐笔各自判定)', () => {
  const half = SIGNED_INPUT_CEILING_SOMPI / 2n + 1n;
  const r = validateSignedInputCeiling({ inputs: [{ amountSompi: half }, { amountSompi: half }], signInputIndices: [0, 1] });
  assert.strictEqual(r.ok, false);
});
t('SIC-5 signInputIndices 越界 ⇒ 拒(不是静默忽略)', () => {
  const r = validateSignedInputCeiling({ inputs: [{ amountSompi: 1n }], signInputIndices: [5] });
  assert.strictEqual(r.ok, false);
  assert.ok(/out-of-range/.test(r.reason));
});
t('SIC-6 未声明签名索引的输入不计入总额(只信声明,不猜)', () => {
  const r = validateSignedInputCeiling({ inputs: [{ amountSompi: 1n }, { amountSompi: SIGNED_INPUT_CEILING_SOMPI + 999n }], signInputIndices: [0] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.signedInputTotalSompi, 1n);
});

// ── validateNetLoss ────────────────────────────────────────────────────────
t('NL-1 🔴 NWT 1352 绕过构造: 1 KAS 输入, 0.00001 KAS 回自己 + 0.99999 KAS 转走 ⇒ 必须拒(旧"存在性"表述挡不住的场景; 注: 1 KAS 输入在真实管线里会先被 SignedInputCeiling(0.5 KAS)拦下, 这里单独测 validateNetLoss 自身的逻辑, 见 NL-1b 测两道闸协同的真实场景)', () => {
  const oneK = 100_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: oneK, scriptPubKeyHex: RELAY_SPK }],
    outputs: [{ valueSompi: 1_000n, scriptPubKeyHex: RELAY_SPK }, { valueSompi: oneK - 1_000n, scriptPubKeyHex: OTHER_SPK }],
    signInputIndices: [0], relayScriptPubKeyHex: RELAY_SPK, requiredFeeSompi: 3_000n,
  });
  assert.strictEqual(r.ok, false, 'must reject the bypass construction');
  assert.ok(r.netLossSompi > 90_000_000n, `net_loss should be ~0.99999 KAS, got ${r.netLossSompi}`);
});
t('NL-1b 🔴 NWT 1355 真实管线场景: 签名输入 ≤ 0.5 KAS(不会先被 SignedInputCeiling 拦下)时同款绕过构造仍必须被 validateNetLoss 拒——两道闸协同, 不是只测函数单独逻辑', () => {
  const halfK = SIGNED_INPUT_CEILING_SOMPI; // 恰好 0.5 KAS, 通过 SignedInputCeiling 检查
  const sic = validateSignedInputCeiling({ inputs: [{ amountSompi: halfK }], signInputIndices: [0] });
  assert.strictEqual(sic.ok, true, 'precondition: 0.5 KAS input must pass SignedInputCeiling in the real pipeline');
  const r = validateNetLoss({
    inputs: [{ amountSompi: halfK, scriptPubKeyHex: RELAY_SPK }],
    outputs: [{ valueSompi: 1_000n, scriptPubKeyHex: RELAY_SPK }, { valueSompi: halfK - 1_000n, scriptPubKeyHex: OTHER_SPK }],
    signInputIndices: [0], relayScriptPubKeyHex: RELAY_SPK, requiredFeeSompi: 3_000n,
  });
  assert.strictEqual(r.ok, false, 'must still be rejected by validateNetLoss even though it survives SignedInputCeiling');
});
t('NL-2 正常 covenant 花费: net_loss 恰等于 required_fee ⇒ 放行(NWT 1353 边界要求)', () => {
  const requiredFee = 789_800n; // NWT 1353 实测 settle_consensual 真实量级
  const inputAmt = 10_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyHex: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - requiredFee, scriptPubKeyHex: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKeyHex: RELAY_SPK, requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.netLossSompi, requiredFee);
});
t('NL-3 net_loss = required_fee×2 + 1 sompi ⇒ 拒(NWT 1353 边界要求)', () => {
  const requiredFee = 789_800n;
  const ceiling = requiredFee * 2n; // < ABS_FEE_CAP, 动态上限生效
  const inputAmt = 10_000_000n;
  const netLoss = ceiling + 1n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyHex: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - netLoss, scriptPubKeyHex: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKeyHex: RELAY_SPK, requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.feeCeilingSompi, ceiling);
});
t('NL-4 net_loss = required_fee×2 恰好等于动态上限 ⇒ 放行(闭区间)', () => {
  const requiredFee = 789_800n;
  const inputAmt = 10_000_000n;
  const netLoss = requiredFee * 2n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyHex: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - netLoss, scriptPubKeyHex: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKeyHex: RELAY_SPK, requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, true);
});
t('NL-5 required_fee 很大时改用 ABS_FEE_CAP(取 min): required_fee×2 > ABS_FEE_CAP ⇒ 上限是 ABS_FEE_CAP', () => {
  const requiredFee = ABS_FEE_CAP_SOMPI; // ×2 会远超 ABS_FEE_CAP
  const inputAmt = 100_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyHex: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - ABS_FEE_CAP_SOMPI, scriptPubKeyHex: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKeyHex: RELAY_SPK, requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.feeCeilingSompi, ABS_FEE_CAP_SOMPI, 'ceiling should be capped at ABS_FEE_CAP, not required_fee*2');
});
t('NL-6 scriptPubKeyHex 大小写不敏感比对(不因为大小写误判"没找到自己的找零")', () => {
  const requiredFee = 1_000n;
  const inputAmt = 10_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyHex: RELAY_SPK.toUpperCase() }],
    outputs: [{ valueSompi: inputAmt - requiredFee, scriptPubKeyHex: RELAY_SPK.toLowerCase() }],
    signInputIndices: [0], relayScriptPubKeyHex: RELAY_SPK.toUpperCase(), requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, true, r.reason);
});
t('NL-7 requiredFeeSompi 非 bigint(如误传 number) ⇒ 拒(不静默转型算出可能错误的值)', () => {
  const r = validateNetLoss({
    inputs: [{ amountSompi: 100n, scriptPubKeyHex: RELAY_SPK }],
    outputs: [{ valueSompi: 99n, scriptPubKeyHex: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKeyHex: RELAY_SPK, requiredFeeSompi: 1000, // number, not bigint
  });
  assert.strictEqual(r.ok, false);
  assert.ok(/must be a non-negative bigint/.test(r.reason));
});

// ── computeRequiredFeeSompi ────────────────────────────────────────────────
t('CRF-1 正常调用: mass × SOMPI_PER_MASS', () => {
  const fakeKaspa = { calculateTransactionMass: () => 7898n };
  const fee = computeRequiredFeeSompi({ kaspa: fakeKaspa, networkId: 'mainnet', signedTx: {} });
  assert.strictEqual(fee, 7898n * SOMPI_PER_MASS);
  assert.strictEqual(fee, 789_800n, 'matches NWT 1353 real-world settle_consensual figure');
});
t('CRF-2 calculateTransactionMass 不存在 ⇒ throw(fail-loud, 无 fallback)', () => {
  assert.throws(() => computeRequiredFeeSompi({ kaspa: {}, networkId: 'mainnet', signedTx: {} }), /not available/);
});
t('CRF-3 calculateTransactionMass 抛错(如 panic) ⇒ throw, 不吞掉不 fallback', () => {
  const fakeKaspa = { calculateTransactionMass: () => { throw new Error('wasm panic'); } };
  assert.throws(() => computeRequiredFeeSompi({ kaspa: fakeKaspa, networkId: 'testnet-12', signedTx: {} }), /calculateTransactionMass threw/);
});
t('CRF-4 缺 networkId ⇒ throw', () => {
  assert.throws(() => computeRequiredFeeSompi({ kaspa: { calculateTransactionMass: () => 1n }, signedTx: {} }), /networkId required/);
});

// ── assertFinalTxid ────────────────────────────────────────────────────────
t('AFT-1 txid 相符 ⇒ ok', () => {
  const r = assertFinalTxid({ id: 'abc123' }, 'abc123');
  assert.strictEqual(r.ok, true);
});
t('AFT-2 txid 不符 ⇒ 拒, 带 actualTxid 供上层分类(replay_txid_mismatch)', () => {
  const r = assertFinalTxid({ id: 'actual' }, 'expected');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.actualTxid, 'actual');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
