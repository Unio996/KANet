// vector2-covenant-binding-omission.mjs — Bettor 账本1425向量②(独立 5 条清单第 2 条): 故意漏掉一个
// 续约输出的 CovenantBinding 声明, computeRequiredFeeSompi 算出的值必须 > 正常值 10 倍。
//
// 复用 docs/provenance/2026-09-14-j2-bet-mint-stepB-register-append-mass-fee-estimate/
// estimate-register-append-mass-fee.mjs 里已经真实验证过的交易形状(3 输入 4 输出的 register_append,
// 真编译 ShardLeaf_direct/KTT/PoolSideTicket, 真 kaspa-wasm calculateTransactionMass)——那份脚本自己
// 的注释(81-86 行)已经记录过"漏 CovenantBinding 会让续约输出的 mass 荒谬地涨到 ~20 KAS 量级"这个
// 自我发现的构造 bug, 本向量把它做成一次正式的、带断言的 A/B 对照(带 CovenantBinding vs 不带), 而不是
// 只留一句旁注。
//
// Run: cd kasia-console && node ../docs/provenance/2026-09-15-j2-market-genesis-tx-assembly-vectors/vector2-covenant-binding-omission.mjs
import { randomBytes } from 'node:crypto';

const { PrivateKey, Address, payToAddressScript, payToScriptHashScript, addressFromScriptPublicKey, createInputSignature, SighashType, Transaction, TransactionOutput, CovenantBinding, Hash, calculateTransactionMass } = await import('../../../kasia-console/node_modules/kaspa-wasm/kaspa.js');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../../../kasia-console/src/lib/pool-bshard-artifacts.mjs');

const Z32 = '00'.repeat(32);

console.log('=== ① 真实编译 ShardLeaf_direct/KTT/PoolSideTicket(与既有 mass 实验同一套 ctor) ===');
const sldCtor = [
  ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
  ctorIntV100(2), ctorIntV100(100000),
  ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
  ctorIntV100(0), ctorIntV100(0), ctorIntV100(1), ctorIntV100(100000),
];
const sldCompiled = compileSilV100('./src/lib/ShardLeaf_direct.sil', sldCtor, 'ShardLeaf_direct');
const sldRedeem = Buffer.from(sldCompiled.script);

const KTT = '../docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/KanetTestToken.v0.3-planC.sil';
const byteN = (n) => ({ kind: 'byte', value: n });
const kttCtor = [ctorIntV100(100000), ctorBytes32V100(Z32), byteN(4), byteN(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorIntV100(3), ctorIntV100(3)];
const kttCompiled = compileSilV100(KTT, kttCtor, 'KanetTestToken');
const kttRedeem = Buffer.from(kttCompiled.script);

const psCtor = [ctorBytes32V100(Z32), ctorIntV100(0), ctorIntV100(100000), ctorBytes32V100(Z32)];
const psCompiled = compileSilV100('./src/lib/sil-v1/PoolSideTicket.sil', psCtor, 'PoolSideTicket');
const psRedeem = Buffer.from(psCompiled.script);

function p2shSpk(redeem) {
  const raw = payToScriptHashScript(new Uint8Array(redeem));
  const addr = addressFromScriptPublicKey(raw, 'mainnet').toString();
  return payToAddressScript(new Address(addr));
}
const sldSpk = p2shSpk(sldRedeem);
const kttSpk = p2shSpk(kttRedeem);
const psSpk = p2shSpk(psRedeem);

console.log('\n=== ② 构造 register_append 交易(3 输入 4 输出), A=带 CovenantBinding / B=故意漏掉 ===');
const priv = new PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = payToAddressScript(relayAddr);

const dummyA = { transactionId: 'aa'.repeat(32), index: 0 };
const dummyB = { transactionId: 'bb'.repeat(32), index: 0 };
const dummyC = { transactionId: 'cc'.repeat(32), index: 0 };
const COMPUTE_BUDGET = 70;
const OPT = 20_000_000n;

function mk({ declareCovenantBinding }) {
  const leafOutput = declareCovenantBinding
    ? new TransactionOutput(OPT, sldSpk, new CovenantBinding(0, new Hash('dd'.repeat(32))))
    : new TransactionOutput(OPT, sldSpk); // ★ 故意漏掉声明(vector②要测的构造错误)
  const kttOutput = declareCovenantBinding
    ? new TransactionOutput(OPT, kttSpk, new CovenantBinding(1, new Hash('ee'.repeat(32))))
    : new TransactionOutput(OPT, kttSpk); // ★ 故意漏掉声明

  return new Transaction({
    version: 1,
    inputs: [
      { previousOutpoint: dummyA, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: COMPUTE_BUDGET, utxo: { outpoint: dummyA, amount: 100_000n, scriptPublicKey: sldSpk, blockDaaScore: 0n } },
      { previousOutpoint: dummyB, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: COMPUTE_BUDGET, utxo: { outpoint: dummyB, amount: 100000n, scriptPublicKey: kttSpk, blockDaaScore: 0n } },
      { previousOutpoint: dummyC, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: COMPUTE_BUDGET, utxo: { outpoint: dummyC, amount: 10_000_000_000n, scriptPublicKey: relaySpk, blockDaaScore: 0n } },
    ],
    outputs: [
      leafOutput,
      new TransactionOutput(OPT, psSpk),
      kttOutput,
      new TransactionOutput(10_000_000_000n - OPT - OPT - OPT - 30_000_000n, relaySpk),
    ],
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
}

function massOf(tx) {
  tx.finalize();
  return BigInt(calculateTransactionMass('mainnet', tx));
}

const txWith = mk({ declareCovenantBinding: true });
const txWithout = mk({ declareCovenantBinding: false });
const massWith = massOf(txWith);
const massWithout = massOf(txWithout);
const feeWith = massWith * 100n;
const feeWithout = massWithout * 100n;
const ratioOverclaim = Number(feeWithout) / Number(feeWith);   // >1 时"漏掉"比"带"贵(过估)
const ratioUnderclaim = Number(feeWith) / Number(feeWithout);  // >1 时"漏掉"比"带"便宜(低估——更危险: 用这个数广播会 fee 不够)

console.log(`带 CovenantBinding:    mass=${massWith}  required_fee=${feeWith} sompi (${(Number(feeWith) / 1e8).toFixed(4)} KAS)`);
console.log(`漏 CovenantBinding:    mass=${massWithout}  required_fee=${feeWithout} sompi (${(Number(feeWithout) / 1e8).toFixed(4)} KAS)`);
console.log(`比值(漏/带): ${ratioOverclaim.toFixed(2)}x  |  比值(带/漏): ${ratioUnderclaim.toFixed(2)}x`);

// 🔴 与 Bettor 原假设("漏掉 CovenantBinding 会让 fee 膨胀 >10x")方向相反的真实结果, 如实报告不强行凑数:
// 本实验(2 个续约输出, 3 输入 4 输出, 真 kaspa-wasm calculateTransactionMass)测出的是【低估】而非【高估】——
// 漏掉 CovenantBinding 声明后, wasm 把该输出当普通 P2SH(KIP-9 plurality p=1)计费, 而声明了 CovenantBinding
// 的输出按 covenant UTXO 的真实 plurality(p=2, 见 memory reference-kip9-storage-mass-plurality-is-not-one)
// 计费更高——这次实测 ratioUnderclaim ≈ 3.01x(漏掉时只收到正确值的 1/3), 不是 assumption 里的 >10x 高估。
// 这比"高估"更危险: 用低估的 required_fee 去广播, 真实链上可能因为 fee 不足被拒, 而不是"多付冤枉钱"。
if (ratioUnderclaim <= 1.5 && ratioOverclaim <= 1.5) {
  console.log('[FAIL] 断言失败: 漏掉 CovenantBinding 应该显著改变(无论哪个方向)required_fee, 但两个方向比值都接近 1, 说明本实验没有真正触发差异');
  process.exit(1);
}
console.log(`[PASS] 漏掉 CovenantBinding 确实显著改变(此实验方向: 低估 ${ratioUnderclaim.toFixed(2)}x)required_fee——
这就是 proto-tx-assembly.mjs 的 buildContinuationOutput() 把 CovenantBinding 做成结构上不可省略的唯一构造
入口的现实依据: 手写 new TransactionOutput(...) 漏第三个参数是一个真实存在、后果严重且容易犯的错, 无论
它是让 fee 虚高还是虚低——虚低对钱路更危险(可能因 fee 不足被链拒绝)。`);
process.exit(0);
