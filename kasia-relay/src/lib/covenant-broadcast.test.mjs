// covenant-broadcast.test.mjs — §9.2 安全约束纯函数向量(J2 2026-09-14, NWT 1352/1353 打回后)。
// 纯函数, 零 DB/零 wasm/零网络。同 cltv-locktime.test.mjs 既有 t()/assert 手法。
// Run: cd kasia-relay && node src/lib/covenant-broadcast.test.mjs

import assert from 'node:assert';
import {
  validateSignedInputCeiling, validateNetLoss, computeRequiredFeeSompi, assertFinalTxid,
  signOnlyDeclaredInputs, canonicalScriptHex, GLOBAL_ABS_FEE_CAP_SOMPI, SIGNED_INPUT_CEILING_SOMPI, SOMPI_PER_MASS,
  validateFixedValueOutputs, GENESIS_OUTPUT_SOMPI, CONTINUATION_OUTPUT_SOMPI,
} from './covenant-broadcast.mjs';

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

const RELAY_SPK = 'aa'.repeat(35);
const OTHER_SPK = 'bb'.repeat(35);
// 🔴 Bettor 1386①: absFeeCapSompi 现在必填、按 kind 派生(无全局默认值)——测试里用一个假设的"某
// kind cap"常量(不代表任何真实 kind, 只用来测 validateNetLoss 的通用逻辑), 与 GLOBAL_ABS_FEE_CAP_SOMPI
// (1.0 KAS 全局硬顶)区分开, 专门测两层兜底各自生效。
const TEST_KIND_CAP_SOMPI = 5_000_000n; // 假设的 kind cap(0.05 KAS 量级, 沿用旧 NWT 1353 边界值方便复用既有测试数据)

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
t('SIC-7 🔴 NWT 1376 非阻断建议落地: signInputIndices 含重复索引 ⇒ 显式拒绝(不依赖"重复只会让总额变大更易拒"这条方向安全的隐性性质)', () => {
  const r = validateSignedInputCeiling({ inputs: [{ amountSompi: 1n }], signInputIndices: [0, 0] });
  assert.strictEqual(r.ok, false);
  assert.ok(/duplicate index 0/.test(r.reason), `reason 应指明重复索引(实际: ${r.reason})`);
});

// ── validateNetLoss ────────────────────────────────────────────────────────
t('NL-1 🔴 NWT 1352 绕过构造: 1 KAS 输入, 0.00001 KAS 回自己 + 0.99999 KAS 转走 ⇒ 必须拒(旧"存在性"表述挡不住的场景; 注: 1 KAS 输入在真实管线里会先被 SignedInputCeiling(0.5 KAS)拦下, 这里单独测 validateNetLoss 自身的逻辑, 见 NL-1b 测两道闸协同的真实场景)', () => {
  const oneK = 100_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: oneK, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: 1_000n, scriptPubKeyRaw: RELAY_SPK }, { valueSompi: oneK - 1_000n, scriptPubKeyRaw: OTHER_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: 3_000n, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
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
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: 3_000n, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
  });
  assert.strictEqual(r.ok, false, 'must still be rejected by validateNetLoss even though it survives SignedInputCeiling');
});
t('NL-2 正常 covenant 花费: net_loss 恰等于 required_fee ⇒ 放行(NWT 1353 边界要求)', () => {
  const requiredFee = 789_800n; // NWT 1353 实测 settle_consensual 真实量级
  const inputAmt = 10_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - requiredFee, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
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
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
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
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
  });
  assert.strictEqual(r.ok, true);
});
t('NL-5 required_fee 很大时改用 kind cap(取 min): required_fee×2 > absFeeCapSompi ⇒ 上限是 absFeeCapSompi(Bettor 1386①: 按 kind 派生, 不再是全局 ABS_FEE_CAP)', () => {
  const requiredFee = TEST_KIND_CAP_SOMPI; // ×2 会远超 kind cap
  const inputAmt = 100_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - TEST_KIND_CAP_SOMPI, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
  });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.feeCeilingSompi, TEST_KIND_CAP_SOMPI, 'ceiling should be capped at kind cap, not required_fee*2');
});
t('NL-5b 🔴 Bettor 1386①: absFeeCapSompi 缺失/非 bigint ⇒ 拒(不静默落到任何默认值——旧全局 ABS_FEE_CAP_SOMPI 已废弃)', () => {
  const r1 = validateNetLoss({
    inputs: [{ amountSompi: 10_000_000n, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: 9_999_000n, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: 1_000n, // absFeeCapSompi 缺失
  });
  assert.strictEqual(r1.ok, false);
  assert.ok(/absFeeCapSompi must be a non-negative bigint/.test(r1.reason), `实际: ${r1.reason}`);
  const r2 = validateNetLoss({
    inputs: [{ amountSompi: 10_000_000n, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: 9_999_000n, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: 1_000n, absFeeCapSompi: 5_000_000, // number, not bigint
  });
  assert.strictEqual(r2.ok, false);
  assert.ok(/absFeeCapSompi must be a non-negative bigint/.test(r2.reason), `实际: ${r2.reason}`);
});
t('NL-5c 🔴 Bettor 1386①: GLOBAL_ABS_FEE_CAP_SOMPI(1.0 KAS)兜底——即使某个 kind 的 absFeeCapSompi 被(疏忽或恶意)设得比全局硬顶还大, feeCeilingSompi 仍然被全局硬顶钳制, 不会被 kind cap 突破', () => {
  const hugeKindCap = GLOBAL_ABS_FEE_CAP_SOMPI * 10n; // 故意设一个远超全局硬顶的 kind cap
  const requiredFee = GLOBAL_ABS_FEE_CAP_SOMPI * 5n; // required_fee×2 也远超全局硬顶, 逼 feeCeiling 走到"该用 kind cap"这条分支
  const inputAmt = GLOBAL_ABS_FEE_CAP_SOMPI * 20n;
  const netLoss = GLOBAL_ABS_FEE_CAP_SOMPI + 1n; // 恰好比全局硬顶多 1 sompi
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: inputAmt - netLoss, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee, absFeeCapSompi: hugeKindCap,
  });
  assert.strictEqual(r.ok, false, 'net_loss 只比全局硬顶多 1 sompi, 即使 kind cap 本身远大于全局硬顶, 仍应被全局硬顶钳制拒绝');
  assert.strictEqual(r.feeCeilingSompi, GLOBAL_ABS_FEE_CAP_SOMPI, `feeCeilingSompi 应该被钳制到 GLOBAL_ABS_FEE_CAP_SOMPI, 不是 hugeKindCap(实际 ${r.feeCeilingSompi})`);
});
t('NL-6 scriptPubKeyRaw(纯 hex 形式)大小写不敏感比对(不因为大小写误判"没找到自己的找零")', () => {
  const requiredFee = 1_000n;
  const inputAmt = 10_000_000n;
  const r = validateNetLoss({
    inputs: [{ amountSompi: inputAmt, scriptPubKeyRaw: RELAY_SPK.toUpperCase() }],
    outputs: [{ valueSompi: inputAmt - requiredFee, scriptPubKeyRaw: RELAY_SPK.toLowerCase() }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK.toUpperCase(), requiredFeeSompi: requiredFee, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
  });
  assert.strictEqual(r.ok, true, r.reason);
});
t('NL-7 requiredFeeSompi 非 bigint(如误传 number) ⇒ 拒(不静默转型算出可能错误的值)', () => {
  const r = validateNetLoss({
    inputs: [{ amountSompi: 100n, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: 99n, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: 1000, absFeeCapSompi: TEST_KIND_CAP_SOMPI, // number, not bigint
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
      signInputIndices: [0], relayScriptPubKey: badKey, requiredFeeSompi: 1_000n, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
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
    signInputIndices: [0], relayScriptPubKey: malformedRelayKey, requiredFeeSompi: 1_000n, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
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
    signInputIndices: [0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: requiredFee, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
  });
  assert.strictEqual(r.ok, false, '畸形输出不被误判为找零, 全额算进 net_loss, 超出手续费上限应被拒');
  assert.strictEqual(r.netLossSompi, inputAmt, 'net_loss 应是全部输入(没有任何输出被正确识别为"付回自己"), 不是 0');
});
t('NL-12 🔴 NWT 1376 非阻断建议落地(与 SIC-7 同款): signInputIndices 含重复索引 ⇒ 显式拒绝', () => {
  const r = validateNetLoss({
    inputs: [{ amountSompi: 1_000_000n, scriptPubKeyRaw: RELAY_SPK }],
    outputs: [{ valueSompi: 999_000n, scriptPubKeyRaw: RELAY_SPK }],
    signInputIndices: [0, 0], relayScriptPubKey: RELAY_SPK, requiredFeeSompi: 1_000n, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
  });
  assert.strictEqual(r.ok, false);
  assert.ok(/duplicate index 0/.test(r.reason), `reason 应指明重复索引(实际: ${r.reason})`);
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
    signInputIndices: [0], relayScriptPubKey: relayAsWasmObj, requiredFeeSompi: requiredFee, absFeeCapSompi: TEST_KIND_CAP_SOMPI,
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

// ── signOnlyDeclaredInputs(2026-09-14 真实实现, 接线笔②, Bettor 1365) ────────
// 假 kaspa mock(同 computeRequiredFeeSompi 的 CRF-1..4 既有模式) —— 只测"只签声明索引/fail-fast/
// fail-loud"这些参数层逻辑；真实 wasm 签名机制本身的核验见
// docs/provenance/2026-09-14-j2-sign-only-declared-inputs-verification/(离线 throwaway 密钥 + 真实
// kaspa-wasm 核验过 createInputSignature + 原地赋值这条路径)。
function makeFakeTx(n) {
  return { inputs: Array.from({ length: n }, (_, i) => ({ signatureScript: `unsigned-${i}` })) };
}
function makeFakeKaspa({ throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    SighashType: { All: 'ALL' },
    createInputSignature: (tx, idx, privKey, sighashType) => {
      calls.push({ idx, privKey, sighashType });
      if (throwOn === idx) throw new Error(`simulated sign failure at idx ${idx}`);
      return `sig-for-${idx}`;
    },
  };
}
t('SOD-1 只签声明的索引, 其余 input 的 signatureScript 原样保留(不被误动)', () => {
  const tx = makeFakeTx(3);
  const fakeKaspa = makeFakeKaspa();
  signOnlyDeclaredInputs({ tx, signInputIndices: [1], privateKey: 'PK', kaspa: fakeKaspa });
  assert.strictEqual(tx.inputs[0].signatureScript, 'unsigned-0', 'idx0 未声明, 必须原样不变');
  assert.strictEqual(tx.inputs[1].signatureScript, 'sig-for-1', 'idx1 声明了, 必须被签');
  assert.strictEqual(tx.inputs[2].signatureScript, 'unsigned-2', 'idx2 未声明, 必须原样不变');
});
t('SOD-2 多个索引依次都被签, 调用参数(tx/idx/privateKey/sighashType)正确传递', () => {
  const tx = makeFakeTx(3);
  const fakeKaspa = makeFakeKaspa();
  signOnlyDeclaredInputs({ tx, signInputIndices: [0, 2], privateKey: 'MY_PK', kaspa: fakeKaspa });
  assert.strictEqual(tx.inputs[0].signatureScript, 'sig-for-0');
  assert.strictEqual(tx.inputs[1].signatureScript, 'unsigned-1', '未声明的 idx1 保持不变');
  assert.strictEqual(tx.inputs[2].signatureScript, 'sig-for-2');
  assert.strictEqual(fakeKaspa.calls.length, 2);
  assert.deepStrictEqual(fakeKaspa.calls.map(c => c.idx), [0, 2]);
  assert.ok(fakeKaspa.calls.every(c => c.privKey === 'MY_PK' && c.sighashType === 'ALL'), '每次调用都传了正确的 privateKey/sighashType');
});
t('SOD-3 signInputIndices 为空数组 ⇒ throw(不是静默不签)', () => {
  const tx = makeFakeTx(2);
  assert.throws(() => signOnlyDeclaredInputs({ tx, signInputIndices: [], privateKey: 'PK', kaspa: makeFakeKaspa() }), /non-empty array/);
});
t('SOD-4 signInputIndices 含越界索引 ⇒ fail-fast 全部拒签, 不留"签到一半"的半成品状态', () => {
  const tx = makeFakeTx(2);
  const fakeKaspa = makeFakeKaspa();
  assert.throws(() => signOnlyDeclaredInputs({ tx, signInputIndices: [0, 5], privateKey: 'PK', kaspa: fakeKaspa }), /out-of-range index 5/);
  assert.strictEqual(fakeKaspa.calls.length, 0, '越界校验必须在任何签名调用之前完成 —— 不能先签了 idx0 才发现 idx5 越界');
  assert.strictEqual(tx.inputs[0].signatureScript, 'unsigned-0', 'fail-fast: 校验失败时 tx 一个字节都没被动过');
});
t('SOD-5 kaspa.createInputSignature 不存在 ⇒ throw(fail-loud, 无 fallback, 同 computeRequiredFeeSompi CRF-2 既有纪律)', () => {
  const tx = makeFakeTx(1);
  assert.throws(() => signOnlyDeclaredInputs({ tx, signInputIndices: [0], privateKey: 'PK', kaspa: {} }), /createInputSignature not available/);
});
t('SOD-6 kaspa.createInputSignature 对某个索引抛错(如 wasm panic) ⇒ 直接抛出, 不吞掉不 fallback', () => {
  const tx = makeFakeTx(2);
  const fakeKaspa = makeFakeKaspa({ throwOn: 1 });
  assert.throws(() => signOnlyDeclaredInputs({ tx, signInputIndices: [0, 1], privateKey: 'PK', kaspa: fakeKaspa }), /simulated sign failure at idx 1/);
  assert.strictEqual(tx.inputs[0].signatureScript, 'sig-for-0', 'idx0 在 idx1 抛错前已经真的被签了(不回滚, 调用方需知道这一点——tx 对象是可变的, 抛错后仍可能是半签状态, 与 fail-fast 的"越界检查"阶段不同)');
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

// ── validateFixedValueOutputs(账本1425硬条件②) ──────────────────────────────
const mkOut = (v) => ({ valueSompi: v, scriptPubKeyRaw: '{"script":"aa","version":0}' });
t('FVO-1 空索引数组(两类都不声明) ⇒ no-op pass', () => {
  const r = validateFixedValueOutputs({ outputs: [mkOut(1n), mkOut(2n)], genesisOutputIndices: [], continuationOutputIndices: [] });
  assert.strictEqual(r.ok, true);
});
t('FVO-2 genesis 输出恰好等于 GENESIS_OUTPUT_SOMPI ⇒ pass', () => {
  const r = validateFixedValueOutputs({ outputs: [mkOut(GENESIS_OUTPUT_SOMPI), mkOut(1n)], genesisOutputIndices: [0] });
  assert.strictEqual(r.ok, true);
});
t('FVO-3 genesis 输出比常量少 1 sompi ⇒ fail(不接受"够接近")', () => {
  const r = validateFixedValueOutputs({ outputs: [mkOut(GENESIS_OUTPUT_SOMPI - 1n)], genesisOutputIndices: [0] });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /genesis output\[0\]/);
});
t('FVO-4 genesis 输出比常量多(比如误传了找零金额) ⇒ fail(不接受">=", 必须"恰好")', () => {
  const r = validateFixedValueOutputs({ outputs: [mkOut(GENESIS_OUTPUT_SOMPI + 1n)], genesisOutputIndices: [0] });
  assert.strictEqual(r.ok, false);
});
t('FVO-5 续约输出恰好等于 CONTINUATION_OUTPUT_SOMPI ⇒ pass', () => {
  const r = validateFixedValueOutputs({ outputs: [mkOut(CONTINUATION_OUTPUT_SOMPI)], continuationOutputIndices: [0] });
  assert.strictEqual(r.ok, true);
});
t('FVO-6 续约输出面值不对 ⇒ fail, reason 里带 "continuation" 标签(区分是哪一类不对)', () => {
  const r = validateFixedValueOutputs({ outputs: [mkOut(1000n)], continuationOutputIndices: [0] });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /continuation output\[0\]/);
});
t('FVO-7 genesis 与 continuation 混合声明, 各自用各自的常量核对(不是共用一个)', () => {
  const r = validateFixedValueOutputs({
    outputs: [mkOut(GENESIS_OUTPUT_SOMPI), mkOut(CONTINUATION_OUTPUT_SOMPI)],
    genesisOutputIndices: [0], continuationOutputIndices: [1],
  });
  assert.strictEqual(r.ok, true);
});
t('FVO-8 越界索引 ⇒ fail-loud, 不静默跳过', () => {
  const r = validateFixedValueOutputs({ outputs: [mkOut(1n)], genesisOutputIndices: [5] });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /out of bounds/);
});
t('FVO-9 GENESIS_OUTPUT_SOMPI 与 CONTINUATION_OUTPUT_SOMPI 当前数值相等(spec §9.6 明文——语义分开但数值相同, 不是巧合)', () => {
  assert.strictEqual(GENESIS_OUTPUT_SOMPI, CONTINUATION_OUTPUT_SOMPI);
  assert.strictEqual(GENESIS_OUTPUT_SOMPI, 20_000_000n);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
