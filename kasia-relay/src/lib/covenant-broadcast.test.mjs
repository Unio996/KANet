// covenant-broadcast.test.mjs — §9.2 安全约束纯函数向量(J2 2026-09-14, NWT 1352/1353 打回后)。
// 纯函数, 零 DB/零 wasm/零网络。同 cltv-locktime.test.mjs 既有 t()/assert 手法。
// Run: cd kasia-relay && node src/lib/covenant-broadcast.test.mjs

import assert from 'node:assert';
import {
  validateSignedInputCeiling, validateNetLoss, computeRequiredFeeSompi, assertFinalTxid,
  canonicalScriptHex, ABS_FEE_CAP_SOMPI, SIGNED_INPUT_CEILING_SOMPI, SOMPI_PER_MASS,
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
    inputs: [{ amountSompi: oneK, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: 1_000n, scriptPubKeyRaw: RELAY_SPK }, { valueSompi: oneK - 1_000n, scriptPubKeyRaw: OTHER_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: 3_000n,
  });
  assert.strictEqual(r.ok, false, 'must reject the bypass construction');
  assert.ok(r.netLossSompi > 90_000_000n, `net_loss should be ~0.99999 KAS, got ${r.netLossSompi}`);
});
t('NL-1b 🔴 NWT 1355 真实管线场景: 签名输入 ≤ 0.5 KAS(不会先被 SignedInputCeiling 拦下)时同款绕过构造仍必须被 validateNetLoss 拒——两道闸协同, 不是只测函数单独逻辑', () => {
  const halfK = SIGNED_INPUT_CEILING_SOMPI; // 恰好 0.5 KAS, 通过 SignedInputCeiling 检查
  const sic = validateSignedInputCeiling({ inputs: [{ amountSompi: halfK }], signInputIndices: [0] });
  assert.strictEqual(sic.ok, true, 'precondition: 0.5 KAS input must pass SignedInputCeiling in the real pipeline');
  const r = validateNetLoss({
    inputs: [{ amountSompi: halfK, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: 1_000n, scriptPubKeyRaw: RELAY_SPK }, { valueSompi: halfK - 1_000n, scriptPubKeyRaw: OTHER_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: 3_000n,
  });
  assert.strictEqual(r.ok, false, 'must still be rejected by validateNetLoss even though it survives SignedInputCeiling');
});
t('NL-2 正常 covenant 花费: net_loss 恰等于 required_fee ⇒ 放行(NWT 1353 边界要求)', () => {
  const requiredFee = 789_800n; // NWT 1353 实测 settle_consensual 真实量级
  const inputAmt = 10_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - requiredFee, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee,
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
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - netLoss, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.feeCeilingSompi, ceiling);
});
t('NL-4 net_loss = required_fee×2 恰好等于动态上限 ⇒ 放行(闭区间)', () => {
  const requiredFee = 789_800n;
  const inputAmt = 10_000_000n;
  const netLoss = requiredFee * 2n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - netLoss, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, true);
});
t('NL-5 required_fee 很大时改用 ABS_FEE_CAP(取 min): required_fee×2 > ABS_FEE_CAP ⇒ 上限是 ABS_FEE_CAP', () => {
  const requiredFee = ABS_FEE_CAP_SOMPI; // ×2 会远超 ABS_FEE_CAP
  const inputAmt = 100_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - ABS_FEE_CAP_SOMPI, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.feeCeilingSompi, ABS_FEE_CAP_SOMPI, 'ceiling should be capped at ABS_FEE_CAP, not required_fee*2');
});
t('NL-6 scriptPubKeyRaw(纯 hex 形式)大小写不敏感比对(不因为大小写误判"没找到自己的找零")', () => {
  const requiredFee = 1_000n;
  const inputAmt = 10_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK.toUpperCase() }],
    outputs: [{ valueSompi: inputAmt - requiredFee, scriptPubKeyRaw: RELAY_SPK.toLowerCase() }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK.toUpperCase(), requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, true, r.reason);
});
t('NL-7 requiredFeeSompi 非 bigint(如误传 number) ⇒ 拒(不静默转型算出可能错误的值)', () => {
  const r = validateNetLoss({
    inputs: [{ amountSompi: 100n, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: 99n, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: 1000, // number, not bigint
  });
  assert.strictEqual(r.ok, false);
  assert.ok(/must be a non-negative bigint/.test(r.reason));
});

t('NL-9 🔴 Bettor 1364 自查: relayScriptPubKey 缺失(null/undefined/空字符串) ⇒ 早退拒绝, 绝不会走到匹配逻辑算出 net_loss=0', () => {
  const inputAmt = 10_000_000n;
  for (const badKey of [null, undefined, '']) {
    const r = validateNetLoss({
      inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
      outputs: [{ valueSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }], // 全额"付回"某处, 若被误判会 net_loss=0 放行
      signInputIndices: [0], relayScriptPubKey: badKey, requiredFeeSompi: 1_000n,
    });
    assert.strictEqual(r.ok, false, `relayScriptPubKey=${JSON.stringify(badKey)} 必须被拒`);
    assert.ok(/relayScriptPubKey required/.test(r.reason), `reason 应指明缺 relayScriptPubKey(实际: ${r.reason})`);
  }
});
t('NL-10 🔴 Bettor 1364 自查核心场景: relayScriptPubKey 非空但归一化后是空字符串(畸形 JSON `{"script":"",...}`) ⇒ 必须拒, 不能跟 outputs 里缺失/畸形的 scriptPubKeyRaw(同样归一成空串)错误配成一对而把 net_loss 算小', () => {
  const inputAmt = 10_000_000n;
  const malformedRelayKey = JSON.stringify({ script: '', version: 0 }); // 通过 `!relayScriptPubKey` 闸(非空字符串), 但 canonicalScriptHex 会归一成 ''
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [
      { valueSompi: inputAmt, scriptPubKeyRaw: undefined }, // 畸形/缺失输出——canonicalScriptHex(undefined) 也是 ''
    ],
    signInputIndices: [0], relayScriptPubKey: malformedRelayKey, requiredFeeSompi: 1_000n,
  });
  assert.strictEqual(r.ok, false, '两个空值不能互相匹配算成"付回自己"');
  assert.ok(/canonicalized to an empty hex string/.test(r.reason), `reason 应指明空归一值被拒(实际: ${r.reason})`);
});
t('NL-11 对照: relayScriptPubKey 正常非空时, outputs 里缺失/畸形的 scriptPubKeyRaw 不会被误判成"付回自己"(canonicalScriptHex(undefined)="" 不等于正常非空 relayKeyNorm)', () => {
  const inputAmt = 10_000_000n;
  const requiredFee = 1_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - requiredFee, scriptPubKeyRaw: undefined }], // 畸形输出, 但 relay key 是正常值
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, false, '畸形输出不被误判为找零, 全额算进 net_loss, 超出手续费上限应被拒');
  assert.strictEqual(r.netLossSompi, inputAmt, 'net_loss 应是全部输入(没有任何输出被正确识别为"付回自己"), 不是 0');
});

// ── canonicalScriptHex(2026-09-14 补: NWT 1355 假设订正后新加, Bettor 裁定"现在改不留给接线笔") ──
// 参照 docs/provenance/2026-09-14-j2-covenant-broadcast-scriptpubkey-verification/run.log 里真实
// kaspa-wasm ScriptPublicKey.toString() 观测到的原始形状造 fixture, 不是凭空编的字符串。
const REAL_WASM_HEX = '203225beb2a059066ee0caf9e602bbc86d8a1663344223ffc056505b1f35a506ebac';
const REAL_WASM_JSON_STR = JSON.stringify({ script: REAL_WASM_HEX, version: 0 });

t('CSH-1 JSON 字符串输入(真实 wasm .toString() 形状)⇒ 取出 .script 并转小写', () => {
  assert.strictEqual(canonicalScriptHex(REAL_WASM_JSON_STR), REAL_WASM_HEX.toLowerCase());
});
t('CSH-2 纯 hex 字符串输入(非 JSON, 手写测试向量常见形状)⇒ JSON.parse 失败, 原样当 hex 用', () => {
  assert.strictEqual(canonicalScriptHex(RELAY_SPK), RELAY_SPK.toLowerCase());
});
t('CSH-3 大小写混合(JSON 内 script 字段大小写混合 + 纯 hex 大小写混合)都能归一到同一小写值', () => {
  const mixedJson = JSON.stringify({ script: REAL_WASM_HEX.toUpperCase(), version: 0 });
  assert.strictEqual(canonicalScriptHex(mixedJson), REAL_WASM_HEX.toLowerCase());
  assert.strictEqual(canonicalScriptHex(RELAY_SPK.toUpperCase()), RELAY_SPK.toLowerCase());
});
t('CSH-4 真实 wasm 对象形状(有 .toString() 而非字符串本身)⇒ 走同一条路径, 结果与直接传字符串相同', () => {
  const fakeWasmObj = { toString: () => REAL_WASM_JSON_STR }; // 模拟 ScriptPublicKey 对象, 不是字符串
  assert.strictEqual(canonicalScriptHex(fakeWasmObj), canonicalScriptHex(REAL_WASM_JSON_STR));
  assert.strictEqual(canonicalScriptHex(fakeWasmObj), REAL_WASM_HEX.toLowerCase());
});
t('CSH-5 null/undefined ⇒ 空字符串, 不 throw(fail-closed 交给上层"比不出相等"处理, 不在这层报错)', () => {
  assert.strictEqual(canonicalScriptHex(null), '');
  assert.strictEqual(canonicalScriptHex(undefined), '');
});

t('NL-8 端到端: relayScriptPubKey 传"真实 wasm 对象"形状, outputs.scriptPubKeyRaw 传 extractTxShape() 会产出的 JSON 字符串形状——两种不同表示形式仍能正确匹配(这正是 canonicalScriptHex 存在的理由: 不要求调用方先手动统一格式)', () => {
  const relayAsWasmObj = { toString: () => REAL_WASM_JSON_STR }; // 模拟 relay 自己地址算出的真实 ScriptPublicKey 对象, 未经手动转换
  const requiredFee = 1_000n;
  const inputAmt = 10_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: REAL_WASM_JSON_STR }], // extractTxShape() 实际会产出的形状
    outputs: [{ valueSompi: inputAmt - requiredFee, scriptPubKeyRaw: REAL_WASM_JSON_STR }],
    signInputIndices: [0], relayScriptPubKey: relayAsWasmObj, requiredFeeSompi: requiredFee,
  });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.netLossSompi, requiredFee, 'wasm 对象 vs JSON 字符串两种表示正确识别为"同一个脚本" ⇒ 找零被计入返还, net_loss 只剩手续费');
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
