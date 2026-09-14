// estimate-register-append-mass-fee.mjs — Bettor 1386③ mass 实验: bet_mint 步骤 B
// (ShardLeaf_direct.register_append, 花费+续约, 不是 genesis)。
//
// 🔴 按 Bettor 复核要求(2026-09-14): 用 T-KTT-BIN-TEMPLATE-LOCK-FIX 修法后的 KTT 设计跑(不是旧的
// sigScript 尾匹配设计)——KTT.transfer 现在需要 witness 供 mkt_prefix/mkt_suffix(市场的完整模板
// 前后段, 供 readInputStateWithTemplate 核对方), 这两个字节数组的真实大小直接来自 ShardLeaf_direct
// 自己的 extractTemplateArtifact 产物, 不是常量——本实验就是要把这个真实数量级测出来。
//
// 交易形状: 3 输入(ShardLeaf_direct 自己的 UTXO + KTT 的 UTXO + relay fee input) ×
//          4 输出(续约 ShardLeaf_direct + 新铸 PoolSideTicket + 续约 KTT + relay 找零)。
import { randomBytes } from 'node:crypto';

const { PrivateKey, Address, payToAddressScript, payToScriptHashScript, addressFromScriptPublicKey, createInputSignature, SighashType, Transaction, TransactionOutput, GenesisCovenantGroup, CovenantBinding, Hash, calculateTransactionMass } = await import('../../../kasia-console/node_modules/kaspa-wasm/kaspa.js');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../../../kasia-console/src/lib/pool-bshard-artifacts.mjs');
const { extractTemplateArtifact } = await import('../../../kasia-console/src/lib/pool-template-artifact.mjs');

const Z32 = '00'.repeat(32);
const byteN = (n) => ({ kind: 'byte', value: n });
const bytesN = (arr) => ({ kind: 'bytes', value: arr });

console.log('=== ① 编译真实 ShardLeaf_direct(代表性 ctor) / KTT(修法后设计) / PoolSideTicket ===');
const sldCtor = [
  ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
  ctorIntV100(2), ctorIntV100(100000),
  ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
  ctorIntV100(0), ctorIntV100(0), ctorIntV100(1), ctorIntV100(100000),
];
const sldCompiled = compileSilV100('./src/lib/ShardLeaf_direct.sil', sldCtor, 'ShardLeaf_direct');
const sldRedeem = Buffer.from(sldCompiled.script);
const sldArtifact = extractTemplateArtifact(sldCompiled);
console.log('ShardLeaf_direct redeem 长度:', sldRedeem.length, '| 真实 mkt_prefix 长度:', sldArtifact.templatePrefix.length, '| 真实 mkt_suffix 长度:', sldArtifact.templateSuffix.length);

// 修法后 KTT: 用 T-KTT-BIN-TEMPLATE-LOCK-FIX 的实验性副本(不是生产旧设计)
const KTT_FIXED_SIL = '../docs/provenance/2026-09-14-j2-ktt-template-lock-fix-bytebudget/KanetTestToken.experimental-fixed.sil';
const kttCtor = [ctorIntV100(100000), ctorBytes32V100(Z32), byteN(4), byteN(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32) /* market_tmpl_hash, State字段 */, ctorIntV100(3), ctorIntV100(3)];
const kttCompiled = compileSilV100(KTT_FIXED_SIL, kttCtor, 'KanetTestToken');
const kttRedeem = Buffer.from(kttCompiled.script);
console.log('KanetTestToken(修法后)redeem 长度:', kttRedeem.length);

const psCtor = [ctorBytes32V100(Z32), ctorIntV100(0), ctorIntV100(100000), ctorBytes32V100(Z32)];
const psCompiled = compileSilV100('./src/lib/sil-v1/PoolSideTicket.sil', psCtor, 'PoolSideTicket');
const psRedeem = Buffer.from(psCompiled.script);
console.log('PoolSideTicket redeem 长度:', psRedeem.length);

function p2shSpk(redeem) {
  const raw = payToScriptHashScript(new Uint8Array(redeem));
  const addr = addressFromScriptPublicKey(raw, 'mainnet').toString();
  return payToAddressScript(new Address(addr));
}
const sldSpk = p2shSpk(sldRedeem);
const kttSpk = p2shSpk(kttRedeem);
const psSpk = p2shSpk(psRedeem);

console.log('\n=== ② 构造 register_append 交易(3 输入 4 输出), KTT witness 携带真实 mkt_prefix/mkt_suffix ===');
const priv = new PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = payToAddressScript(relayAddr);

const dummyA = { transactionId: 'aa'.repeat(32), index: 0 };
const dummyB = { transactionId: 'bb'.repeat(32), index: 0 };
const dummyC = { transactionId: 'cc'.repeat(32), index: 0 };
const COMPUTE_BUDGET = 70;
const fake = (n) => Buffer.alloc(n, 0x11);

// leaf(ShardLeaf_direct)侧 register_append witness(粗略近似, 数量级真实): side/stake/leafOutIdx/psOutIdx(4 int)
// + bettorPk(32B) + ps_prefix/ps_suffix(真实 1B/33B, 见 anchors.json) + stakeInIdx/tok_out(2 int)
// + tok_prefix/tok_suffix(修法后 KTT 自己的 template, 需要另外测量, 这里先用旧设计基线量级 1B/33B 近似
//   ——KTT 自己的 prefix/suffix 供 ShardLeaf_direct 侧校验代币输入, 与本实验主角"mkt_prefix/suffix" 是
//   两回事, 数量级小很多不是本实验重点)。
const PS_PREFIX_LEN = 1, PS_SUFFIX_LEN = 33;
const leafWitnessApprox = 4 * 9 + 32 + (1 + PS_PREFIX_LEN) + (1 + PS_SUFFIX_LEN) + 2 * 9 + (1 + 1) + (1 + 33);
const leafSigScript = Buffer.concat([fake(leafWitnessApprox), Buffer.from('00', 'hex'), sldRedeem]);
console.log('leaf(ShardLeaf_direct) sigScript 总长度:', leafSigScript.length);

// KTT transfer 侧 witness: owner_input_idx/recv_idx(2 个 int 数组, 近似) + mkt_prefix/mkt_suffix(🔴 真实
// ShardLeaf_direct 的 template prefix/suffix, 修法核心新增开销) + redeem reveal。
const kttWitnessApprox = 2 * 9 + (1 + sldArtifact.templatePrefix.length) + (4 + sldArtifact.templateSuffix.length); // suffix 变长, 假设 4 字节长度前缀
const kttSigScript = Buffer.concat([fake(kttWitnessApprox), kttRedeem]);
console.log('KTT sigScript 总长度(含真实 mkt_suffix witness):', kttSigScript.length);

// 🔴 关键修正(自验证发现的构造 bug, 不是真实经济问题): 续约输出(leaf/KTT)必须带 CovenantBinding
// 声明(new CovenantBinding(authInputIdx, covId))——同 kasia-relay/src/lib/p2sh.mjs 生产代码里
// PayoutShard continuation 的既有手法(`new TransactionOutput(value, spk, new CovenantBinding(0, covId))`)。
// 漏掉这个声明会让 calculateTransactionMass 把"续约输出"当成"未声明用途的巨型脚本 P2SH"，产出荒谬的
// ~20 KAS 量级——这不是真实成本, 是我第一版实验漏加声明的构造错误(同本目录 market_genesis 实验
// 文件头注记录过的"第一版漏 populateGenesisCovenants"同一族教训, 这次是续约版本)。
// CovenantBinding/Hash 对象会被 move 进 Transaction, 不能跨构造复用, 每次都要 new 一份。
function mk(leafSs, kttSs, feeSs, leafOutVal, kttOutVal) {
  return new Transaction({
    version: 1,
    inputs: [
      { previousOutpoint: dummyA, signatureScript: leafSs, sequence: 0n, sigOpCount: 0, computeBudget: COMPUTE_BUDGET, utxo: { outpoint: dummyA, amount: 100_000n, scriptPublicKey: sldSpk, blockDaaScore: 0n } },
      { previousOutpoint: dummyB, signatureScript: kttSs, sequence: 0n, sigOpCount: 0, computeBudget: COMPUTE_BUDGET, utxo: { outpoint: dummyB, amount: 100000n, scriptPublicKey: kttSpk, blockDaaScore: 0n } },
      { previousOutpoint: dummyC, signatureScript: feeSs, sequence: 0n, sigOpCount: 0, computeBudget: COMPUTE_BUDGET, utxo: { outpoint: dummyC, amount: 10_000_000_000n, scriptPublicKey: relaySpk, blockDaaScore: 0n } },
    ],
    outputs: [
      new TransactionOutput(leafOutVal, sldSpk, new CovenantBinding(0, new Hash('dd'.repeat(32)))),
      new TransactionOutput(20_000_000n, psSpk),
      new TransactionOutput(kttOutVal, kttSpk, new CovenantBinding(1, new Hash('ee'.repeat(32)))),
      new TransactionOutput(10_000_000_000n - leafOutVal - 20_000_000n - kttOutVal - 30_000_000n, relaySpk),
    ],
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
}

console.log('\n=== ③ 修正后: 续约输出带 CovenantBinding + U 形最优值(20,000,000 sompi), 扫描 ps ticket genesis 声明 on/off ===');
const OPT = 20_000_000n;
for (const declarePsGenesis of [false, true]) {
  console.log(`\n--- ps ticket 输出是否声明 populateGenesisCovenants = ${declarePsGenesis} ---`);
  const t0 = mk('', '', '', OPT, OPT);
  if (declarePsGenesis) t0.populateGenesisCovenants([new GenesisCovenantGroup(0, [1])]);
  const sigFee = createInputSignature(t0, 2, priv, SighashType.All);
  const finalTx = mk(leafSigScript, kttSigScript, sigFee, OPT, OPT);
  if (declarePsGenesis) finalTx.populateGenesisCovenants([new GenesisCovenantGroup(0, [1])]);
  finalTx.finalize();
  try {
    const mass = calculateTransactionMass('mainnet', finalTx);
    const requiredFeeSompi = BigInt(mass) * 100n;
    console.log('mass:', mass.toString(), ' required_fee:', requiredFeeSompi.toString(), 'sompi (', (Number(requiredFeeSompi) / 1e8).toFixed(4), 'KAS)');
  } catch (e) {
    console.log('calculateTransactionMass 抛错:', e.message);
  }
}

console.log('\n=== ④ 对照组: 若沿用旧设计(已推翻)的 KTT sigScript 大小量级(仅供对比参考) ===');
{
  const kttWitnessOldApprox = 2 * 9 + 40;
  const oldKttRedeemApprox = 3471;
  console.log('旧设计 KTT sigScript 长度量级 ≈', kttWitnessOldApprox + oldKttRedeemApprox, '(不是本次采用的方案, 仅对比新设计因 mkt_suffix witness 多付出多少字节)');
}
