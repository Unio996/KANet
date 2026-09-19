// proto-mass-ceiling.test.mjs — 构造期mass上限fail-closed断言单测(J2 2026-09-19, 账本1497 Bettor
// MUST第3条: "构造出一笔必然超限的形状...断言必须throw; 正常形状必须放行")。真kaspa-wasm, 零mock。
// Run: cd kasia-console && node src/lib/proto-mass-ceiling.test.mjs

const kaspa = await import('kaspa-wasm');
const { randomBytes } = await import('node:crypto');
const {
  assertMassWithinCeiling, handComputeStorageMass, handComputeComputeMass,
  MASS_CEILING_THRESHOLD, MASS_CEILING_MAX, MASS_CEILING_FRACTION,
} = await import('./proto-mass-ceiling.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const addr = priv.toPublicKey().toAddress('mainnet');
const spk = kaspa.payToAddressScript(addr);

function mkTx({ inputValue, outputValues }) {
  const outpoint = { transactionId: 'aa'.repeat(32), index: 0 };
  const input = {
    previousOutpoint: outpoint, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: 70,
    utxo: { outpoint, amount: inputValue, scriptPublicKey: spk, blockDaaScore: 0n },
  };
  const outputs = outputValues.map((v) => new kaspa.TransactionOutput(v, spk));
  return new kaspa.Transaction({
    version: 1, inputs: [input], outputs, lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
}

t('MASS_CEILING_THRESHOLD = 500000*0.95 = 475000', () => {
  if (MASS_CEILING_MAX !== 500_000) throw new Error(`MASS_CEILING_MAX=${MASS_CEILING_MAX}`);
  if (MASS_CEILING_FRACTION !== 0.95) throw new Error(`MASS_CEILING_FRACTION=${MASS_CEILING_FRACTION}`);
  if (MASS_CEILING_THRESHOLD !== 475_000) throw new Error(`MASS_CEILING_THRESHOLD=${MASS_CEILING_THRESHOLD}`);
});

t('handComputeStorageMass: 正常形状(大额输入输出)算出的storage mass远低于阈值', () => {
  const outputs = [{ plurality: 1n, amountSompi: 1_000_000_000n }, { plurality: 1n, amountSompi: 1_000_000_000n }];
  const inputs = [{ plurality: 1n, amountSompi: 2_005_000_000n }];
  const m = handComputeStorageMass(outputs, inputs);
  if (m >= 475_000n) throw new Error(`正常大额形状storage mass=${m}不应超阈值`);
});

t('handComputeStorageMass: 极小面值输出(p=2)必然爆炸(C·p²/amount随amount趋近0发散)', () => {
  // C=1e12, p=2 => C*p^2 = 4e12。amount=1 sompi时单这一项就是4e12, 远超500,000阈值——
  // 这正是Bettor要求的"刻意选极小面值制造巨大storage mass"那类形状(账本1497 MUST第3条)。
  const outputs = [{ plurality: 2n, amountSompi: 1n }];
  const inputs = [{ plurality: 1n, amountSompi: 1_000_000_000n }];
  const m = handComputeStorageMass(outputs, inputs);
  if (m < 475_000n) throw new Error(`极小面值输出的storage mass=${m}本该远超阈值, 公式算错了`);
});

t('handComputeComputeMass: 基本量纲(computeBudget是主项, ×100)', () => {
  const m = handComputeComputeMass(300, 100, [70]);
  // sizeMass=300*1 + spkMass=100*10=1000 + budgetMass=70*100=7000 → 300+1000+7000=8300
  if (m !== 8300n) throw new Error(`handComputeComputeMass算出${m}, 期望8300`);
});

t('assertMassWithinCeiling: 正常register_append量级形状放行(不throw)', () => {
  // 用与真实register_append相近的量级(账本provenance记录: 正常形状全部<500,000), 这里用简化的
  // 纯P2PK交易近似量级验证"不误杀正常形状"这一半断言。
  const tx = mkTx({ inputValue: 950_000_000n, outputValues: [20_000_000n, 20_000_000n, 900_000_000n] });
  const signals = assertMassWithinCeiling({ kaspa, network: 'mainnet', tx, inputPluralities: [1n], feeUtxoValueSompi: 950_000_000n, label: 'test_normal' });
  if (signals.localMass >= 475_000 || signals.handStorage >= 475_000 || signals.handCompute >= 475_000) {
    throw new Error(`正常形状被判定超阈值: ${JSON.stringify(signals)}`);
  }
});

t('assertMassWithinCeiling: 极小面值找零输出必然触发fail-closed throw', () => {
  // 故意把找零切到1 sompi(账本1497 MUST第3条要求的"必然超限的形状"), covenant-like场景通常p=2,
  // 这里用最保守的p=1场景(mkTx里的output是普通P2PK, hasCovenant=false)也应该在amount极小时爆炸——
  // 验证断言不依赖covenant标志就能拦下"面值太小"这类真实风险(NWT此前记忆reference-kip9-storage-
  // mass-plurality-is-not-one同族问题的另一面: 面值不是plurality, 但一样能把mass推爆)。
  const tx = mkTx({ inputValue: 950_000_000n, outputValues: [949_999_999n, 1n] });
  let threw = false, msg = '';
  try {
    assertMassWithinCeiling({ kaspa, network: 'mainnet', tx, inputPluralities: [1n], feeUtxoValueSompi: 950_000_000n, label: 'test_oversized' });
  } catch (e) { threw = true; msg = e.message; }
  if (!threw) throw new Error('极小面值输出的交易应当被fail-closed拒绝, 但没有throw');
  if (!msg.includes('test_oversized') || !msg.includes('950000000')) throw new Error(`错误文案缺少label或fee UTXO面值: ${msg}`);
});

t('assertMassWithinCeiling: inputPluralities长度不匹配立即fail-closed', () => {
  const tx = mkTx({ inputValue: 950_000_000n, outputValues: [900_000_000n] });
  let threw = false;
  try {
    assertMassWithinCeiling({ kaspa, network: 'mainnet', tx, inputPluralities: [1n, 1n], feeUtxoValueSompi: 950_000_000n, label: 'test_mismatch' });
  } catch (e) { threw = true; }
  if (!threw) throw new Error('inputPluralities长度与tx.inputs.length不符时应当throw');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail > 0 ? 1 : 0;
