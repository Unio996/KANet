// estimate-genesis-mass-fee.mjs — Bettor 1383 裁定③: 落码前用 calculateTransactionMass 对真实
// tx 形状(genesis 1 输出 + 找零)离线算一遍 required_fee, 判断是否需要上调 ABS_FEE_CAP(0.05 KAS)。
//
// 完全离线: randomBytes(32) 生成一次性 throwaway 私钥(同 u1-registration.test.mjs:43 既有手法),
// 不碰任何 relay/生产私钥, 不连链, 不广播。ShardLeaf_direct genesis 输出脚本用真实
// compileSilV100 编译产物(占位 ctor 值——本次只关心脚本字节长度, 不关心 ctor 语义正确性)。
//
// Run(从 kasia-console 目录跑, 借它已装好的 kaspa-wasm):
//   cd kasia-console && node ../docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/estimate-genesis-mass-fee.mjs
// 🔴 第一版实验(已废弃, 教训记录见 README): 用 version:0 + 裸 payToScriptHashScript(不调
// populateGenesisCovenants) 构造"看起来像"genesis 输出, 产出荒谬的 required_fee(~100 KAS 量级)。
// 核对 kasia-relay/src/lib/p2sh.mjs:1856-1895(unlockBshardGenesisMintPayout, 生产真实 genesis 交易
// 构造代码)后发现: 真正的 covenant genesis 输出必须 ① version:1(TX_VERSION_TOCCATA, "covenant output
// 必需") ② 构造好 Transaction 后调用 t.populateGenesisCovenants([new GenesisCovenantGroup(authInputIdx,
// [outputIdx,...])]) 显式标记这些输出属于 genesis 组——没有这两步, mass 计算把这个输出当成"未声明用途
// 的巨型脚本 P2SH"套用严厉得多的 storage mass 公式(KIP-9 plurality p²/v 惩罚小额大脚本 UTXO)。本版本
// 照抄生产代码模式重做。
import { randomBytes } from 'node:crypto';

const { PrivateKey, Address, payToAddressScript, payToScriptHashScript, addressFromScriptPublicKey, createInputSignature, SighashType, Transaction, TransactionOutput, GenesisCovenantGroup, calculateTransactionMass } = await import('kaspa-wasm');
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('../../../kasia-console/src/lib/pool-bshard-artifacts.mjs');

const SHARDLEAF_SIL = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/src/lib/ShardLeaf_direct.sil';

// 占位 ctor(10 项, 顺序同 ShardLeaf_direct.sil 源码) —— 本次只要脚本字节长度, 具体值不影响长度。
const z32 = '00'.repeat(32);
const ctor = [
  ctorBytes32V100(z32),          // market_id
  ctorBytes32V100(z32),          // ps_tmpl_hash
  ctorBytes32V100(z32),          // shard_pool_id
  ctorIntV100(2),                // seal_count
  ctorIntV100(1),                // min_bet
  ctorBytes32V100(z32),          // rootclose_tmpl_hash
  ctorBytes32V100(z32),          // rootclose_init_payoutRoot
  ctorBytes32V100(z32),          // token_tmpl_hash
  ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), // init_local_yes/no/count/pool_value
];

console.log('=== ① 编译 ShardLeaf_direct(占位 ctor), 拿真实 redeem 脚本长度 ===');
const compiled = compileSilV100(SHARDLEAF_SIL, ctor, 'ShardLeaf_direct');
const redeemBytes = Buffer.from(compiled.script);
console.log('ShardLeaf_direct redeem 脚本长度(bytes):', redeemBytes.length);
const genesisSpkRaw = payToScriptHashScript(new Uint8Array(redeemBytes));
const genesisAddr = addressFromScriptPublicKey(genesisSpkRaw, 'mainnet').toString();
const genesisSpk = payToAddressScript(new Address(genesisAddr)); // 同 p2sh.mjs:1871/1876 生产手法(先转地址再转脚本, 供 populateGenesisCovenants 场景对齐)
console.log('genesis P2SH 地址:', genesisAddr);

console.log('\n=== ② 构造一个 throwaway 私钥模拟 relay 自己的 fee input + 找零地址 ===');
const priv = new PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = payToAddressScript(relayAddr);

// 假设一个"看起来真实"的 UTXO 金额(1 KAS, sompi) —— 具体金额不影响 mass(mass 由脚本大小/输入输出
// 数量决定, 不由金额数值决定), 只是要给一个合理的 previousOutpoint/utxo 结构。
const inputAmt = 10_000_000_000n; // 100 KAS(留足空间给下面扩大后的 genesisOutputValue 候选值做找零)
// sompi, 待校准的候选值(设计稿 §2 留白)——第一轮 1k/5k/10k 实测撞 KIP-9 storage mass p²/v 惩罚(大脚本
// 15687B + 极小额输出 ⇒ p≈158, p²/v 爆炸)。第二轮扩大范围后发现 required_fee ∝ 1/v(反比), 而
// net_loss(v) = v + required_fee(v) ≈ v + K/v 有理论最小值在 v=sqrt(K) 附近——生产代码
// pool-shard-register.mjs:85 SHARD_GENESIS_SEED=20_000_000(0.2 KAS,注释"KIP-9 safe")恰好接近这个
// 理论最优点, 补充这个精确值 + 附近几个点验证。
const genesisOutputCandidates = [1_000n, 10_000n, 100_000n, 1_000_000n, 5_000_000n, 10_000_000n, 15_000_000n, 20_000_000n, 25_000_000n, 30_000_000n, 50_000_000n, 100_000_000n];

const dummyOutpoint = { transactionId: 'aa'.repeat(32), index: 0 };
const COMPUTE_BUDGET = 70; // 同生产 _BSHARD_COMPUTE_BUDGET(kasia-relay/src/lib/p2sh.mjs:1831)

for (const genesisOutputValue of genesisOutputCandidates) {
  const changeAmt = inputAmt - genesisOutputValue - 10_000n; // 预留一点空间, 找零金额本身不影响 mass
  const mk = (ss) => {
    const t = new Transaction({
      version: 1, // 🔴 TX_VERSION_TOCCATA——covenant output 必需(同 p2sh.mjs:1880-1881 生产代码)
      inputs: [{
        previousOutpoint: dummyOutpoint, signatureScript: ss, sequence: 0n, sigOpCount: 0, computeBudget: COMPUTE_BUDGET,
        utxo: { outpoint: dummyOutpoint, amount: inputAmt, scriptPublicKey: relaySpk, blockDaaScore: 0n },
      }],
      outputs: [new TransactionOutput(genesisOutputValue, genesisSpk), new TransactionOutput(changeAmt, relaySpk)],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    t.populateGenesisCovenants([new GenesisCovenantGroup(0, [0])]); // input[0] 授权 genesis output[0]
    return t;
  };
  const sig = createInputSignature(mk(''), 0, priv, SighashType.All);
  const tx = mk(sig);
  tx.finalize();

  const mass = calculateTransactionMass('mainnet', tx);
  const requiredFeeSompi = BigInt(mass) * 100n;
  const ABS_FEE_CAP_SOMPI = 5_000_000n; // 0.05 KAS 既有硬顶
  const totalSpendFromRelay = genesisOutputValue + requiredFeeSompi; // net_loss 会包含 genesis output value 本身(§2 已指出)
  const feeCeiling = requiredFeeSompi * 2n < ABS_FEE_CAP_SOMPI ? requiredFeeSompi * 2n : ABS_FEE_CAP_SOMPI;

  console.log(`\n--- genesisOutputValue = ${genesisOutputValue} sompi ---`);
  console.log('mass:', mass.toString());
  console.log('required_fee (mass × 100 sompi/mass):', requiredFeeSompi.toString(), 'sompi');
  console.log('net_loss 会计入的量(genesisOutputValue + required_fee):', totalSpendFromRelay.toString(), 'sompi');
  console.log('fee_ceiling = min(required_fee×2, ABS_FEE_CAP=5,000,000):', feeCeiling.toString());
  console.log('net_loss <= fee_ceiling ?', totalSpendFromRelay <= feeCeiling);
}
