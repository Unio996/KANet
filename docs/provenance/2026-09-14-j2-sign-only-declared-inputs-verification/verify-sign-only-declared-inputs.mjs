// 归档说明: 本文件从 kasia-console/scratch/ 迁入 docs/provenance/(避免被 scratch/ 的 .gitignore 吞掉),
// Run: cd kasia-console && node ../docs/provenance/2026-09-14-j2-sign-only-declared-inputs-verification/verify-sign-only-declared-inputs.mjs

// 一次性探测(scratch, 不入库): 验证"只签声明索引"在真实 kaspa-wasm 下到底该怎么做——
// p2sh.mjs 全部既有签名代码都是"构造时一次性带签名"模式(new Transaction({inputs:[{...signatureScript}]})),
// 从没有过对已构造 Transaction 对象原地追加签名的先例。这里验证：
//   ① createInputSignature(tx, idx, privKey, SighashType.All) 对"未签名 tx"调用是否可行
//   ② 原地赋值 tx.inputs[idx].signatureScript = sigHex 是否生效
//   ③ 若不生效，"重新构造一个新 Transaction，只替换该 input 的 signatureScript" 这条路径是否可行、
//      且不影响其他 input(模拟 covenant witness)保持原样
//   ④ finalize() 后 txid 确定性、可重复
// 全程 randomBytes(32) throwaway 私钥, 不碰生产/relay 私钥, 不连链不广播。
import { randomBytes } from 'node:crypto';

const {
  PrivateKey, Address, payToAddressScript, createInputSignature, SighashType,
  Transaction, TransactionOutput,
} = await import('kaspa-wasm');

const priv = new PrivateKey(randomBytes(32).toString('hex'));
const addr = priv.toPublicKey().toAddress('mainnet');
const spk = payToAddressScript(addr);

const dummyOutpointA = { transactionId: 'aa'.repeat(32), index: 0 };
const dummyOutpointB = { transactionId: 'bb'.repeat(32), index: 1 };

function buildUnsignedTx() {
  const inputA = { // relay 自己要签的输入
    previousOutpoint: dummyOutpointA, signatureScript: '', sequence: 0n, sigOpCount: 1, computeBudget: 70,
    utxo: { outpoint: dummyOutpointA, amount: 5_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n },
  };
  const inputB = { // 模拟 covenant 输入, 已经带自己的 witness(占位, relay 不该碰这个)
    previousOutpoint: dummyOutpointB, signatureScript: 'deadbeef', sequence: 0n, sigOpCount: 1, computeBudget: 70,
    utxo: { outpoint: dummyOutpointB, amount: 1_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n },
  };
  const outA = new TransactionOutput(4_000_000_000n, spk);
  const outB = new TransactionOutput(1_999_000_000n, spk);
  return new Transaction({
    version: 0, inputs: [inputA, inputB], outputs: [outA, outB], lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
}

console.log('=== ① createInputSignature 对未签名 tx 调用 ===');
const unsignedTx = buildUnsignedTx();
let sigHex;
try {
  sigHex = createInputSignature(unsignedTx, 0, priv, SighashType.All);
  console.log('sigHex 长度(hex chars):', sigHex.length, '(p2sh.mjs 注释预期 132 = 66 bytes push-encoded)');
  console.log('sigHex 前 10 字符:', sigHex.slice(0, 10));
} catch (e) {
  console.log('createInputSignature 抛错:', e.message);
}

console.log('\n=== ② 原地赋值 tx.inputs[0].signatureScript = sigHex 是否生效 ===');
try {
  unsignedTx.inputs[0].signatureScript = sigHex;
  console.log('赋值后读回 tx.inputs[0].signatureScript:', unsignedTx.inputs[0].signatureScript);
  console.log('是否等于 sigHex:', unsignedTx.inputs[0].signatureScript === sigHex);
} catch (e) {
  console.log('原地赋值抛错(或只读属性):', e.message);
}

console.log('\n=== ③ 重新构造新 Transaction, 只替换 input[0] 的 signatureScript, input[1] 保持原样 ===');
try {
  const freshTx = buildUnsignedTx(); // 全新对象, 干净基线
  const sig0 = createInputSignature(freshTx, 0, priv, SighashType.All);
  const newInputs = [
    { previousOutpoint: dummyOutpointA, signatureScript: sig0, sequence: 0n, sigOpCount: 1, computeBudget: 70,
      utxo: { outpoint: dummyOutpointA, amount: 5_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n } },
    { previousOutpoint: dummyOutpointB, signatureScript: 'deadbeef', sequence: 0n, sigOpCount: 1, computeBudget: 70, // 原样不变
      utxo: { outpoint: dummyOutpointB, amount: 1_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n } },
  ];
  const rebuiltTx = new Transaction({
    version: 0, inputs: newInputs, outputs: [new TransactionOutput(4_000_000_000n, spk), new TransactionOutput(1_999_000_000n, spk)],
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
  console.log('重建后 input[0].signatureScript === sig0:', rebuiltTx.inputs[0].signatureScript === sig0);
  console.log('重建后 input[1].signatureScript 保持不变(deadbeef):', rebuiltTx.inputs[1].signatureScript === 'deadbeef');

  console.log('\n=== ④ finalize() 后 txid 确定性/可重复 ===');
  rebuiltTx.finalize();
  const txid1 = rebuiltTx.id;
  console.log('txid:', txid1);
  // 用完全相同输入重新构造一遍, 期望同样的 txid(确定性)
  const rebuiltTx2 = new Transaction({
    version: 0, inputs: newInputs, outputs: [new TransactionOutput(4_000_000_000n, spk), new TransactionOutput(1_999_000_000n, spk)],
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
  rebuiltTx2.finalize();
  console.log('txid2 (重新构造同样字段):', rebuiltTx2.id);
  console.log('两次 txid 相等(确定性):', txid1 === rebuiltTx2.id);

  console.log('\n=== ⑤ 签名对签名前的 tx 快照敏感——如果签名后再改别的字段, sig 是否还对得上(sighash 覆盖范围探测) ===');
  // 换一个不同的 output 金额, 重新算一次 input 0 的签名, 看 sig 是否与③不同(证明 sighash 确实覆盖了 outputs)
  const freshTx2 = new Transaction({
    version: 0, inputs: [
      { previousOutpoint: dummyOutpointA, signatureScript: '', sequence: 0n, sigOpCount: 1, computeBudget: 70,
        utxo: { outpoint: dummyOutpointA, amount: 5_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n } },
      { previousOutpoint: dummyOutpointB, signatureScript: 'deadbeef', sequence: 0n, sigOpCount: 1, computeBudget: 70,
        utxo: { outpoint: dummyOutpointB, amount: 1_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n } },
    ],
    outputs: [new TransactionOutput(3_000_000_000n /* 金额换了 */, spk), new TransactionOutput(1_999_000_000n, spk)],
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
  const sig0Diff = createInputSignature(freshTx2, 0, priv, SighashType.All);
  console.log('output 金额换了之后, input0 的签名是否不同(证明 sighash 覆盖 outputs, 不能签完再改金额):', sig0Diff !== sig0);
} catch (e) {
  console.log('③-⑤ 失败:', e.message);
  console.log(e.stack);
}

console.log('\n=== ⑥ 关键复核: 原地赋值路径 finalize()+序列化后, 字节里是否真的带着新签名(不是JS属性表面假象) ===');
try {
  const t = buildUnsignedTx();
  const sig = createInputSignature(t, 0, priv, SighashType.All);
  t.inputs[0].signatureScript = sig;
  t.finalize();
  const txidAfterInplace = t.id;
  const json = t.serializeToSafeJSON ? t.serializeToSafeJSON() : JSON.stringify(t);
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  const serializedSigScript = parsed?.inputs?.[0]?.signatureScript ?? parsed?.transaction?.inputs?.[0]?.signatureScript;
  console.log('finalize 后 txid:', txidAfterInplace);
  console.log('序列化 JSON 里 inputs[0].signatureScript 是否等于我们赋的 sig:', serializedSigScript === sig, '(实际:', String(serializedSigScript).slice(0,20), ')');

  // 反序列化回来再读一次, 确认往返一致(同 replayPreparedTransactions 依赖的假设)
  const roundTrip = Transaction.deserializeFromSafeJSON(json);
  roundTrip.finalize();
  console.log('反序列化+finalize 后 txid 与原 txid 相等:', roundTrip.id === txidAfterInplace);
  console.log('反序列化后 inputs[0].signatureScript 仍等于 sig:', roundTrip.inputs[0].signatureScript === sig);
  console.log('反序列化后 inputs[1].signatureScript 仍是 deadbeef(covenant witness 未被误动):', roundTrip.inputs[1].signatureScript === 'deadbeef');
} catch (e) {
  console.log('⑥ 失败:', e.message);
  console.log(e.stack);
}

console.log('\n=== ⑦ 多个索引依次签名互不干扰(即使本次设计通常只签一个, 代码要通用遍历数组) ===');
try {
  // 两个都算"relay 自己的输入"
  const inputA2 = { previousOutpoint: dummyOutpointA, signatureScript: '', sequence: 0n, sigOpCount: 1, computeBudget: 70,
    utxo: { outpoint: dummyOutpointA, amount: 5_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n } };
  const inputC = { previousOutpoint: { transactionId: 'cc'.repeat(32), index: 2 }, signatureScript: '', sequence: 0n, sigOpCount: 1, computeBudget: 70,
    utxo: { outpoint: { transactionId: 'cc'.repeat(32), index: 2 }, amount: 2_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n } };
  const t2 = new Transaction({
    version: 0, inputs: [inputA2, inputC], outputs: [new TransactionOutput(6_900_000_000n, spk)],
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
  // 先单独算出两个"如果各自独立签, sig 应该是什么"作为基线(用全新未签 tx 算, 不受先后顺序影响)
  const baselineSig0 = createInputSignature(new Transaction({ version: 0, inputs: [inputA2, inputC], outputs: [new TransactionOutput(6_900_000_000n, spk)], lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' }), 0, priv, SighashType.All);
  const baselineSig1 = createInputSignature(new Transaction({ version: 0, inputs: [inputA2, inputC], outputs: [new TransactionOutput(6_900_000_000n, spk)], lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' }), 1, priv, SighashType.All);

  // 依次签: 先签 idx 0 并原地赋值, 再签 idx 1(此时 tx 里 idx0 的 signatureScript 已经不是空的了)
  const sig0First = createInputSignature(t2, 0, priv, SighashType.All);
  t2.inputs[0].signatureScript = sig0First;
  const sig1After = createInputSignature(t2, 1, priv, SighashType.All); // idx0 已经有签名的情况下算 idx1 的签名
  t2.inputs[1].signatureScript = sig1After;

  console.log('依次签名: sig0 与基线相同(顺序不影响 idx0):', sig0First === baselineSig0);
  console.log('依次签名: sig1 与基线相同(idx0 已填签名不影响 idx1 的 sighash):', sig1After === baselineSig1);
  t2.finalize();
  console.log('finalize 成功, txid:', t2.id);
} catch (e) {
  console.log('⑦ 失败:', e.message);
  console.log(e.stack);
}

console.log('\n=== ⑧ 排除混淆变量: 同一个 tx 对象、同一个 idx, 连续调用两次 createInputSignature, 结果是否一致(排除"签名算法本身带随机数"这个可能性) ===');
try {
  const tFixed = buildUnsignedTx();
  const sigX1 = createInputSignature(tFixed, 0, priv, SighashType.All);
  const sigX2 = createInputSignature(tFixed, 0, priv, SighashType.All); // 完全没改任何东西, 再签一次
  console.log('两次对同一个未改动 tx 的同一个 idx 签名, 结果相等(排除随机数假设):', sigX1 === sigX2);
} catch (e) {
  console.log('⑧ 失败:', e.message);
}

console.log('\n=== ⑨ 用 wasm 自带 signTransaction(tx, [priv], verify_sig=true) 做参考验证: 两个"relay自己的输入"都能被同一把私钥匹配签名, 若 verify_sig=true 跑通不抛错, 证明"依次对多个 input 签名"这条路径在协议层面自洽且通过验证 ===');
try {
  const { signTransaction } = await import('kaspa-wasm');
  const inputA3 = { previousOutpoint: dummyOutpointA, signatureScript: '', sequence: 0n, sigOpCount: 1, computeBudget: 70,
    utxo: { outpoint: dummyOutpointA, amount: 5_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n } };
  const inputC2 = { previousOutpoint: { transactionId: 'cc'.repeat(32), index: 2 }, signatureScript: '', sequence: 0n, sigOpCount: 1, computeBudget: 70,
    utxo: { outpoint: { transactionId: 'cc'.repeat(32), index: 2 }, amount: 2_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n } };
  const t3 = new Transaction({
    version: 0, inputs: [inputA3, inputC2], outputs: [new TransactionOutput(6_900_000_000n, spk)],
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
  const verified = signTransaction(t3, [priv], true); // verify_sig = true
  console.log('signTransaction(verify_sig=true) 未抛错, 说明 wasm 自己对"依次签两个 input"的结果做过验证且通过');
  console.log('结果 tx.inputs[0].signatureScript 非空:', !!verified.inputs[0].signatureScript);
  console.log('结果 tx.inputs[1].signatureScript 非空:', !!verified.inputs[1].signatureScript);
  verified.finalize();
  console.log('finalize txid:', verified.id);

  console.log('\n用我自己的"顶层 createInputSignature + 原地赋值"路径复刻同一笔 tx, 对比结构(除签名字节外)是否等价:');
  const manualInputA = { ...inputA3 };
  const manualInputC = { ...inputC2 };
  const tManual = new Transaction({ version: 0, inputs: [manualInputA, manualInputC], outputs: [new TransactionOutput(6_900_000_000n, spk)], lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
  const sigM0 = createInputSignature(tManual, 0, priv, SighashType.All);
  tManual.inputs[0].signatureScript = sigM0;
  const sigM1 = createInputSignature(tManual, 1, priv, SighashType.All);
  tManual.inputs[1].signatureScript = sigM1;
  tManual.finalize();
  console.log('我自己手动路径产出的 txid:', tManual.id, '(签名内容不同属正常——schnorr 随机数, 但两条路径都应该能各自独立 finalize 成功, 不抛错)');
} catch (e) {
  console.log('⑨ 失败:', e.message);
  console.log(e.stack);
}
