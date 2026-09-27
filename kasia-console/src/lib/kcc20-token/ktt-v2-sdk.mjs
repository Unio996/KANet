// ktt-v2-sdk.mjs — KanetTestTokenV2(KTT v2)铸币/转账交易构造, D-035 §②③④ 实现(J2, 2026-09-27)。
// 设计: docs/2026-09-27-j2-ktt-wallet-mint-panel-design-v0.1.md(NWT 审零 MUST)。
//
// 🔴 三条真实 simnet 广播撞出的坑(本模块把修法焊进函数本身, 不是留在 scratch 脚本里让下一个调用方
// 重新踩一遍——docs/provenance/2026-09-27-j2-ktt-v2-simnet/ 有完整 txid 证据链):
//   ① continuation 输出漏 CovenantBinding = 永久不可再花(kaspad 报 "covenant id 0000...0000 input 0
//      is out of bounds")——genesis 用 populateGenesisCovenants(全新身份), 续约/转账必须显式
//      `new CovenantBinding(authInputIdx, new Hash(继承的 covenant_id))`(同本仓既有 PayoutShard/
//      ShardLeaf continuation 先例, kasia-relay/src/lib/p2sh.mjs 多处 `new CovenantBinding(0, new
//      Hash(psCovId))`——不是新发明)。
//   ② KIP-9 storage mass: funding UTXO 价值与输出面值悬殊(大额输入拆成小额 covenant 输出+大额找零)
//      会被判"storage mass 超 500,000 硬上限"——genesis 铸币面值定得接近 funding 全额(不留大额找零)。
//   ③ createInputSignature 输出 66 字节(push-opcode 0x41 + 64 字节签名 + 1 字节 sighash 类型)——ABI
//      的 'sig' 类型只要后 65 字节, 开头 push-opcode 要去掉(同 proto-tx-assembly-settlement.mjs:463-470
//      已记录的既有惯例)。
import { computeKttV2TokenArtifact } from '../pool-bshard-artifacts.mjs';
import { encodeKttV2TransferAction, combineKttV2ActionAndRedeem } from './ktt-v2-transfer-witness.mjs';

const STATE_FIELDS = [
  { name: 'amount', type: { kind: 'int' } },
  { name: 'owner', type: { kind: 'fixed_bytes', len: 32 } },
  { name: 'owner_scheme', type: { kind: 'byte' } },
  { name: 'borrow_scheme', type: { kind: 'byte' } },
  { name: 'borrow_guard', type: { kind: 'fixed_bytes', len: 32 } },
  { name: 'extension_commitment', type: { kind: 'fixed_bytes', len: 32 } },
];
const TRANSFER_ENTRY_ABI = { dispatch_tag: 'd9a2b797' }; // KanetTestTokenV2.transfer, 真实编译产物固定值(合约字节码不变, dispatch_tag 不变)
export const KTT_V2_SCHEME_PUBKEY = 0;
export const KTT_V2_SCHEME_COVENANT_ID = 4;
const ZERO32 = '00'.repeat(32);

/** 65 字节 hex(sig ABI 类型) <- createInputSignature 的 66 字节原始输出(见头注③)。 */
export function toAbiSigHex(rawSigHex) {
  const noPrefix = rawSigHex.startsWith('0x') ? rawSigHex.slice(2) : rawSigHex;
  if (noPrefix.length !== 132) throw new Error(`toAbiSigHex: createInputSignature 输出长度异常, 期望 66 字节(132 hex), 实际 ${noPrefix.length / 2} 字节`);
  return noPrefix.slice(2);
}

/**
 * 构造铸币交易(genesis, D-035 §③): 任何人可铸任意数量到任意地址——owner_scheme 决定"地址"的含义
 * (0x04=covenant-id 在场证明, 0x00=普通钱包 pubkey 凭签名花费)。
 * @param {object} kaspa kaspa-wasm(注入)
 * @param {{outpoint, entry:object}} fundingUtxo 铸币者自己的 KAS UTXO(手续费+铸币面值都从这里出, 同
 *   Owner 原话"最多花一些转账gas")
 * @param {number|0|4} ownerScheme
 * @param {string} ownerBytesHex 32 字节 hex(0x04 时=目标 covenant-id, 0x00 时=目标钱包 x-only pubkey)
 * @param {bigint} [feeSompi] 默认 850_000n(实测 genesis compute mass ~7671, 需要 >=767,100; 留余量)
 * @returns {{unsignedTx, mkSigned:(sigHex:string)=>Transaction, amountSompi:bigint, artifact:object}}
 */
export function buildKttV2MintTx(kaspa, fundingUtxo, ownerScheme, ownerBytesHex, feeSompi = 850_000n) {
  const fundAmt = BigInt(fundingUtxo.entry.amount);
  // 坑②: 面值定得接近 funding 全额, 不留大额找零(避免大额输入/小额输出的 KIP-9 storage mass 惩罚)。
  const amountSompi = fundAmt - feeSompi;
  if (amountSompi <= 0n) throw new Error(`buildKttV2MintTx: funding UTXO(${fundAmt})不够付手续费(${feeSompi})`);
  const artifact = computeKttV2TokenArtifact({ amount: Number(amountSompi), ownerScheme, ownerBytesHex });
  const outputs = [new kaspa.TransactionOutput(amountSompi, new kaspa.ScriptPublicKey(0, artifact.scriptPubKeyHex.slice(2)))];
  const mk = (sigScript) => {
    const t = new kaspa.Transaction({
      version: 1,
      inputs: [{ previousOutpoint: fundingUtxo.outpoint, signatureScript: sigScript, sequence: 0n, sigOpCount: 0, computeBudget: 70, ...(sigScript === '' ? { utxo: fundingUtxo.entry } : {}) }],
      outputs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
    });
    t.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(0, [0])]);
    return t;
  };
  return { unsignedTx: mk(''), mkSigned: (sigHex) => mk(sigHex), amountSompi, artifact };
}

/**
 * 构造转账交易(D-035 §④): 钱包持有的 KTT(owner_scheme=0x00, pubkey-owned)转给另一地址 + 找零。
 * 只支持源 = 单个 pubkey-owned 输入(leader-of-one, 同 v1 kcc20-token/ktt-transfer-witness.mjs 的
 * 既有覆盖范围——多输入/covenant-owned 源见下方 buildKttV2GenericTransferTx)。
 * @param {object} kttUtxo { outpoint, entry } 被转账的 KTT UTXO(必须 owner_scheme=0x00)
 * @param {string} kttRedeemScriptHex 该 KTT 实例的完整 redeem script hex(genesis 时的 artifact.script)
 * @param {string} destOwnerBytesHex 目标 32 字节 hex(pubkey 或 covenant-id, 见 destOwnerScheme)
 * @param {number} destOwnerScheme 0x00 或 0x04
 * @param {{outpoint,entry}} feeUtxo 独立付手续费的 KAS UTXO(不动 KTT 本身面值, 找零回原地址)
 * @param {string} feeChangeAddress
 * @param {bigint} [feeSompi] 默认 6_000_000n(实测 checkSig 校验的 compute mass ~51636, 需要
 *   >=5,163,600; 留余量)
 * @returns {{unsignedTx, mkSigned:(sigs:{kttSigHex:string, feeSigHex:string})=>Transaction,
 *   destArtifact:object}}
 */
export function buildKttV2TransferTx(kaspa, kttUtxo, kttRedeemScriptHex, destOwnerBytesHex, destOwnerScheme, feeUtxo, feeChangeAddress, feeSompi = 6_000_000n) {
  const kttAmount = BigInt(kttUtxo.entry.amount);
  const kttCovId = String(kttUtxo.entry.covenantId);
  if (!kttCovId || kttCovId === 'undefined') throw new Error('buildKttV2TransferTx: 源 KTT UTXO 无 covenant_id(未正确续约的实例, 参见坑①——永久不可花, 不能作为转账源)');
  const feeAmount = BigInt(feeUtxo.entry.amount);
  const change = feeAmount - feeSompi;
  if (change < 0n) throw new Error(`buildKttV2TransferTx: fee UTXO(${feeAmount})不够付手续费(${feeSompi})`);

  const destArtifact = computeKttV2TokenArtifact({ amount: Number(kttAmount), ownerScheme: destOwnerScheme, ownerBytesHex: destOwnerBytesHex });
  // 坑①: continuation 输出必须显式 CovenantBinding, 延续源 UTXO 自己的 covenant_id(转账是同一份
  // 代币实例的状态转移, 不是销毁重铸——同本仓 PayoutShard continuation 先例)。
  const outputs = [
    new kaspa.TransactionOutput(kttAmount, new kaspa.ScriptPublicKey(0, destArtifact.scriptPubKeyHex.slice(2)), new kaspa.CovenantBinding(0, new kaspa.Hash(kttCovId))),
    new kaspa.TransactionOutput(change, kaspa.payToAddressScript(new kaspa.Address(feeChangeAddress))),
  ];
  const mk = (sigScripts) => new kaspa.Transaction({
    version: 1,
    inputs: [
      { previousOutpoint: kttUtxo.outpoint, signatureScript: sigScripts[0], sequence: 0n, sigOpCount: 0, computeBudget: 400, utxo: kttUtxo.entry },
      { previousOutpoint: feeUtxo.outpoint, signatureScript: sigScripts[1], sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: feeUtxo.entry },
    ],
    outputs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  const unsignedTx = mk(['', '']);
  const mkSigned = ({ kttSigHex, feeSigHex }) => {
    // kttSigHex: toAbiSigHex()处理过的 65 字节 checkSig 签名(见头注③)。
    const nextStates = [{ amount: kttAmount, ownerHex: destOwnerBytesHex, ownerScheme: destOwnerScheme, borrowScheme: 0, borrowGuardHex: ZERO32, extensionCommitmentHex: ZERO32 }];
    const actionHex = encodeKttV2TransferAction(kaspa, TRANSFER_ENTRY_ABI, STATE_FIELDS, nextStates, [0], [kttSigHex]);
    const sigScript0 = combineKttV2ActionAndRedeem(kaspa, actionHex, Buffer.from(kttRedeemScriptHex, 'hex'));
    return mk([sigScript0, feeSigHex]);
  };
  return { unsignedTx, mkSigned, destArtifact };
}
