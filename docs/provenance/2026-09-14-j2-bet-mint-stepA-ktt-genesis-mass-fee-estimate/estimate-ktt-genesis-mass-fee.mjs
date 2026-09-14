// estimate-ktt-genesis-mass-fee.mjs — Bettor 1386③"不假设一样, 每 kind 单独跑一遍 mass 实验"：
// bet_mint 步骤 A(KanetTestToken genesis)的 required_fee/net_loss 实测, 同
// docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/ 的 ShardLeaf_direct 方法论。
//
// 🔴 provisional 声明: KTT 的 market_tmpl_suffix/market_tmpl_suffix_len 这套"sigScript 尾匹配"机制
// 正在被红队推翻重新设计(见 docs/2026-09-14-j2-proto-v0-covenant-construction-spec-v0.1.md §7
// T-PROTO-TEMPLATE-CONST-ASSUMPTION-CORRECTED + docs/provenance/2026-09-14-j2-template-tail-anchor-uniqueness/)。
// 本实验用**当前 KanetTestToken.sil 现状**(未改动)的 ctor 形状跑, market_tmpl_suffix 占位长度取
// 132 字节(此前唯一性研究里用过的具体数值, 仅作为"典型字节数量级"的代表, 不代表最终会采用这个机制)。
// 若修法后 ctor 形状改变(比如换成固定长度的 pubkey+sig witness 参数, market_tmpl_suffix 字段整个
// 消失), 脚本长度会变, 需要重跑本实验——本文档明确标注这个前提, 不假装现在的数字是最终数字。
//
// Run(从 kasia-console 目录跑):
//   cd kasia-console && node ../docs/provenance/2026-09-14-j2-bet-mint-stepA-ktt-genesis-mass-fee-estimate/estimate-ktt-genesis-mass-fee.mjs
import { randomBytes } from 'node:crypto';

// 🔴 相对路径直连 kaspa-wasm 的 main 入口(kaspa.js)——本文件位于 docs/provenance/, 不在
// kasia-console/ 的祖先链上, 裸 specifier 'kaspa-wasm' 走 Node ESM 包解析找不到
// kasia-console/node_modules/kaspa-wasm(向上遍历只到仓库根, 不会跨进 kasia-console/), 需绕开。
const { PrivateKey, Address, payToAddressScript, payToScriptHashScript, addressFromScriptPublicKey, createInputSignature, SighashType, Transaction, TransactionOutput, GenesisCovenantGroup, calculateTransactionMass } = await import('../../../kasia-console/node_modules/kaspa-wasm/kaspa.js');
const { compileSilV100 } = await import('../../../kasia-console/src/lib/pool-bshard-artifacts.mjs');

const KTT_SIL = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/src/lib/sil-v1/KanetTestToken.sil';

const Z32 = '00'.repeat(32);
const byteNode = (n) => ({ kind: 'byte', value: n });
const bytesNode = (arr) => ({ kind: 'bytes', value: arr });
const intNode = (n) => ({ kind: 'int', value: Number(n) });
const bytes32Node = (hex) => ({ kind: 'bytes', value: [...Buffer.from(hex, 'hex')] });

const MARKET_TMPL_SUFFIX_LEN = 132; // provisional, 见文件头注
const ctor = [
  intNode(0), bytes32Node(Z32), byteNode(4), byteNode(0), bytes32Node(Z32), bytes32Node(Z32),
  bytesNode(new Array(MARKET_TMPL_SUFFIX_LEN).fill(0)), intNode(MARKET_TMPL_SUFFIX_LEN),
  intNode(3), intNode(3),
];

console.log('=== ① 编译 KanetTestToken(占位 ctor, market_tmpl_suffix 占位长度', MARKET_TMPL_SUFFIX_LEN, '字节), 拿真实 redeem 脚本长度 ===');
const compiled = compileSilV100(KTT_SIL, ctor, 'KanetTestToken');
const redeemBytes = Buffer.from(compiled.script);
console.log('KanetTestToken redeem 脚本长度(bytes):', redeemBytes.length);
const genesisSpkRaw = payToScriptHashScript(new Uint8Array(redeemBytes));
const genesisAddr = addressFromScriptPublicKey(genesisSpkRaw, 'mainnet').toString();
const genesisSpk = payToAddressScript(new Address(genesisAddr));
console.log('genesis P2SH 地址:', genesisAddr);

console.log('\n=== ② throwaway 私钥模拟 relay 自己的 fee input + 找零地址 ===');
const priv = new PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = payToAddressScript(relayAddr);

const inputAmt = 10_000_000_000n; // 100 KAS, 留足空间给候选值做找零
const genesisOutputCandidates = [1_000n, 100_000n, 1_000_000n, 5_000_000n, 10_000_000n, 15_000_000n, 20_000_000n, 25_000_000n, 30_000_000n, 50_000_000n, 100_000_000n];

const dummyOutpoint = { transactionId: 'aa'.repeat(32), index: 0 };
const COMPUTE_BUDGET = 70;

for (const genesisOutputValue of genesisOutputCandidates) {
  const changeAmt = inputAmt - genesisOutputValue - 10_000n;
  const mk = (ss) => {
    const t = new Transaction({
      version: 1,
      inputs: [{
        previousOutpoint: dummyOutpoint, signatureScript: ss, sequence: 0n, sigOpCount: 0, computeBudget: COMPUTE_BUDGET,
        utxo: { outpoint: dummyOutpoint, amount: inputAmt, scriptPublicKey: relaySpk, blockDaaScore: 0n },
      }],
      outputs: [new TransactionOutput(genesisOutputValue, genesisSpk), new TransactionOutput(changeAmt, relaySpk)],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    t.populateGenesisCovenants([new GenesisCovenantGroup(0, [0])]);
    return t;
  };
  const sig = createInputSignature(mk(''), 0, priv, SighashType.All);
  const tx = mk(sig);
  tx.finalize();

  const mass = calculateTransactionMass('mainnet', tx);
  const requiredFeeSompi = BigInt(mass) * 100n;
  const totalSpendFromRelay = genesisOutputValue + requiredFeeSompi;

  console.log(`\n--- genesisOutputValue = ${genesisOutputValue} sompi ---`);
  console.log('mass:', mass.toString());
  console.log('required_fee (mass × 100 sompi/mass):', requiredFeeSompi.toString(), 'sompi');
  console.log('net_loss(genesisOutputValue + required_fee):', totalSpendFromRelay.toString(), 'sompi (', (Number(totalSpendFromRelay) / 1e8).toFixed(4), 'KAS)');
}
