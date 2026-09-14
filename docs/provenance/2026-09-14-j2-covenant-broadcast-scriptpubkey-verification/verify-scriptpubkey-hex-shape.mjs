// verify-scriptpubkey-hex-shape.mjs — 核 NWT 1355 接线 TODO(covenant-broadcast.mjs extractTxShape()
// 的 `.scriptPublicKey.toString()` 转 hex 假设，接线时"必做，第一件事")。之前 NWT 想用真实 wasm 对象
// 验但测试地址无效导致 wasm 崩溃，没条件验完；本次用离线生成的一次性 throwaway 私钥(见下)补验。
//
// 完全离线、零链上交互、零生产/relay 私钥: randomBytes(32) 生成一次性密钥(同
// kasia-console/src/lib/u1-registration.test.mjs:43 既有手法)，只用来拿一个格式合法的真实 mainnet
// 地址喂给 payToAddressScript()——不读取、不使用、不接触任何 relay 或生产环境的私钥。
//
// Run(从 kasia-console 目录跑，借它已装好的 kaspa-wasm):
//   cd kasia-console && node ../docs/provenance/2026-09-14-j2-covenant-broadcast-scriptpubkey-verification/verify-scriptpubkey-hex-shape.mjs
import { randomBytes } from 'node:crypto';

const {
  PrivateKey, Address, payToAddressScript, addressFromScriptPublicKey,
  Transaction, TransactionOutput,
} = await import('kaspa-wasm');

const priv = new PrivateKey(randomBytes(32).toString('hex'));
const addrA = priv.toPublicKey().toAddress('mainnet');
const priv2 = new PrivateKey(randomBytes(32).toString('hex'));
const addrB = priv2.toPublicKey().toAddress('mainnet'); // 第二把, 冒充"relay 自己的地址"做对照

console.log('=== ① payToAddressScript(addr).toString() 直接输出的形状 ===');
const spkA = payToAddressScript(addrA);
console.log('typeof spkA:', typeof spkA);
console.log('spkA.toString():', spkA.toString());
console.log('spkA.toString() 是否形如纯 hex(仅 0-9a-f):', /^[0-9a-f]+$/i.test(spkA.toString()));

console.log('\n=== ② 同一地址两次独立调用 payToAddressScript, toString() 是否恒等(可比对的前提) ===');
const spkA2 = payToAddressScript(new Address(addrA.toString()));
console.log('两次结果字符串相等:', spkA.toString() === spkA2.toString());

console.log('\n=== ③ addressFromScriptPublicKey(spk, networkId) 往回转地址, 是否与原地址一致(round-trip) ===');
try {
  const roundTrip = addressFromScriptPublicKey(spkA, 'mainnet').toString();
  console.log('round-trip 地址:', roundTrip);
  console.log('与原地址 addrA 相等:', roundTrip === addrA.toString());
} catch (e) {
  console.log('addressFromScriptPublicKey 抛错:', e.message);
}

console.log('\n=== ④ 包进真实 Transaction 对象后, tx.outputs[i]/tx.inputs[i].utxo 的 scriptPublicKey.toString() 是否与①直接调用结果一致 ===');
console.log('(这是 extractTxShape() 实际读取路径, 不是①那种直接调用——先证两者同源再算验完)');
try {
  const outA = new TransactionOutput(1000n, spkA);
  const outB = new TransactionOutput(2000n, payToAddressScript(addrB));
  const dummyOutpoint = { transactionId: '00'.repeat(32), index: 0 };
  const inpA = {
    previousOutpoint: dummyOutpoint, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: 70,
    utxo: { outpoint: dummyOutpoint, amount: 5000n, scriptPublicKey: spkA, blockDaaScore: 0n },
  };
  const tx = new Transaction({
    version: 0, inputs: [inpA], outputs: [outA, outB], lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
  console.log('tx.outputs[0].scriptPublicKey.toString() === spkA.toString():', tx.outputs[0].scriptPublicKey.toString() === spkA.toString());
  console.log('tx.inputs[0].utxo.scriptPublicKey.toString() === spkA.toString():', tx.inputs[0].utxo.scriptPublicKey.toString() === spkA.toString());

  console.log('\n=== ⑤ 核心问题: extractTxShape()+validateNetLoss() 实际依赖的比对——能否只用 toString() 直接字符串比对判断"这个输出是不是付回 addrB" ===');
  const relaySpkHex = payToAddressScript(addrB).toString(); // 模拟 relay 自己算出的 relayScriptPubKeyHex
  console.log('tx.outputs[1](付给addrB) .toString() === relay 自己算的 addrB spk .toString():', tx.outputs[1].scriptPublicKey.toString() === relaySpkHex);

  console.log('\n=== ⑥ 备选路径: addressFromScriptPublicKey(out.scriptPublicKey, networkId) 转回地址字符串直接比对地址, 不比 hex ===');
  const outBAddr = addressFromScriptPublicKey(tx.outputs[1].scriptPublicKey, 'mainnet').toString();
  console.log('tx.outputs[1] 转回的地址 === addrB:', outBAddr === addrB.toString());
} catch (e) {
  console.log('④ 构造/断言失败:', e.message);
  console.log(e.stack);
}
