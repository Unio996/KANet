// 02_transfer_a_to_b.mjs — POSITIVE vector: Alice(checkSig, pubkey-owned) transfers her real KTT-A to Bob
// (still pubkey-owned). Real signature via createInputSignature, real broadcast.
import { readFileSync } from 'node:fs';
import { kaspa, computeKttV2TokenArtifact, getRpc, xOnlyPubkeyHex, FUND_PRIV_HEX, FUND_ADDR,
  combineKttV2ActionAndRedeem } from './common.mjs';
const { encodeKttV2TransferAction } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_ktt_panel/kasia-console/src/lib/kcc20-token/ktt-v2-transfer-witness.mjs');
const STATE_FIELDS = [{"name":"amount","type":{"kind":"int"}},{"name":"owner","type":{"kind":"fixed_bytes","len":32}},{"name":"owner_scheme","type":{"kind":"byte"}},{"name":"borrow_scheme","type":{"kind":"byte"}},{"name":"borrow_guard","type":{"kind":"fixed_bytes","len":32}},{"name":"extension_commitment","type":{"kind":"fixed_bytes","len":32}}];

const info = JSON.parse(readFileSync('./ktt_a_info.json', 'utf8'));
const alicePriv = new kaspa.PrivateKey(info.alicePrivHex);
const bobPriv = new kaspa.PrivateKey('bb'.repeat(32));
const bobXOnly = xOnlyPubkeyHex(bobPriv);
console.log('bob xOnly pubkey:', bobXOnly);

const rpc = await getRpc();
try {
  const ktScriptOnly = info.scriptPubKeyHex.slice(2);
  const ktSpk = new kaspa.ScriptPublicKey(0, ktScriptOnly);
  const ktAddr = kaspa.addressFromScriptPublicKey(ktSpk, 'simnet').toString();
  const { entries: ktEntries } = await rpc.getUtxosByAddresses({ addresses: [ktAddr] });
  if (!ktEntries.length) throw new Error('KTT-A UTXO not found — did mining confirm it?');
  const ktEntry = ktEntries[0];
  const ktAmount = BigInt(ktEntry.entry?.amount ?? ktEntry.amount ?? 0);
  console.log('KTT-A UTXO amount(native sompi):', ktAmount.toString());

  const fundPriv = new kaspa.PrivateKey(FUND_PRIV_HEX);
  const { entries: fundEntries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const dag = await rpc.getBlockDagInfo();
  const matureCutoff = dag.virtualDaaScore - 1000n; // coinbase maturity period(实测撞到, 见下方注释)
  // 🔴 实测发现: coinbase UTXO 有 1000 块成熟期, 上一次尝试选到刚挖出的 fee UTXO(daa=2971, 当前
  // daa=3088, 差 117<1000)被拒 "tried to spend coinbase outpoint...maturity period...hasn't passed"。
  // 改成显式挑一个 daaScore 足够老的。
  const feeUtxo = fundEntries.find(e => BigInt(e.entry?.amount ?? e.amount ?? 0) > 1_000_000n && BigInt(e.entry?.blockDaaScore ?? e.blockDaaScore ?? 0) < matureCutoff);
  if (!feeUtxo) throw new Error('no mature fee UTXO found');
  const feeUtxoAmount = BigInt(feeUtxo.entry?.amount ?? feeUtxo.amount ?? 0);
  // 实测(上一次尝试): compute mass 51636(checkSig 校验比 genesis 贵得多) -> 需要 5,163,600 sompi。
  const fee = 6_000_000n;
  const change = feeUtxoAmount - fee;
  if (change < 0n) throw new Error('fee UTXO too small');

  // KTT-B artifact: same State.amount(=full token conservation, sum_in==sum_out), owner=Bob(pubkey).
  const artB = computeKttV2TokenArtifact({ amount: Number(ktAmount), ownerScheme: 0, ownerBytesHex: bobXOnly });
  // 🔴 实测发现的真 bug(第一次尝试漏了这一步): continuation 输出必须显式声明 CovenantBinding, 延续
  // 输入 0(被消费的 KTT-A)的 covenant_id——否则这份产物落链后 covenant_id 是空的, 永久不可再花(下一次
  // 花费它时 kaspad 报 "covenant id 0000...0000 input 0 is out of bounds")。照抄本仓既有
  // PayoutShard/ShardLeaf continuation 先例(kasia-relay/src/lib/p2sh.mjs 多处
  // `new CovenantBinding(0, new Hash(psCovId))`——covId 取自被消费输入自己的 covenant_id, 不是新算一个,
  // "转账"是同一份代币实例的状态转移, 不是销毁重铸)。
  const ktInputCovId = String(ktEntry.entry.covenantId);
  console.log('KTT-A input covenant_id(continuing into Bob output):', ktInputCovId);
  const outputs = [
    new kaspa.TransactionOutput(ktAmount, new kaspa.ScriptPublicKey(0, artB.scriptPubKeyHex.slice(2)), new kaspa.CovenantBinding(0, new kaspa.Hash(ktInputCovId))),
    new kaspa.TransactionOutput(change, kaspa.payToAddressScript(new kaspa.Address(FUND_ADDR))),
  ];

  const mk = (sigScripts) => new kaspa.Transaction({
    version: 1,
    inputs: [
      { previousOutpoint: ktEntry.outpoint, signatureScript: sigScripts[0], sequence: 0n, sigOpCount: 0, computeBudget: 400, utxo: ktEntry.entry ?? ktEntry },
      { previousOutpoint: feeUtxo.outpoint, signatureScript: sigScripts[1], sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: feeUtxo.entry ?? feeUtxo },
    ],
    outputs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });

  const unsigned = mk(['', '']);
  const aliceSigRaw = kaspa.createInputSignature(unsigned, 0, alicePriv, kaspa.SighashType.All);
  const fundSigHex = kaspa.createInputSignature(unsigned, 1, fundPriv, kaspa.SighashType.All);
  // 🔴 实测发现(既有惯例, proto-tx-assembly-settlement.mjs:463-470 已记录, 本次直接复用不是现猜):
  // createInputSignature 输出 66 字节 = push-opcode 0x41 + 64 字节签名 + 1 字节 sighash 类型——ABI 的
  // 'sig' 类型只要后 65 字节真实 payload, 开头的 push-opcode 要去掉(编码器自己会重新 push 一遍)。
  const aliceSig65Hex = aliceSigRaw.slice(2);
  console.log('alice sig len(bytes) after stripping push-opcode:', Buffer.from(aliceSig65Hex, 'hex').length);

  // 🔴 第二处真 bug(与 CovenantBinding 同一根因链): 这不是"烧掉 KTT-A、什么续约都不产生"(那才该用
  // next_states=[]), 是"续约成 Bob 名下的新 State"——wrapper 的 cardinality 检查(DECL.md: "out_count
  // == new_states.length", 针对本 covenant 组自己的续约输出)要求 next_states 数组元素数与本组实际声明
  // 的续约输出数一致; 加了 CovenantBinding 后本组有 1 个续约输出, next_states 也必须是 1 个元素,
  // 不能再用 next_states=[] 的"清空"编码器。
  const nextStates = [{ amount: ktAmount, ownerHex: bobXOnly, ownerScheme: 0, borrowScheme: 0, borrowGuardHex: '00'.repeat(32), extensionCommitmentHex: '00'.repeat(32) }];
  const actionHex = encodeKttV2TransferAction(kaspa, info.entryAbi, STATE_FIELDS, nextStates, [0], [aliceSig65Hex]);
  const redeemBytes = Buffer.from(info.redeemScriptHex, 'hex');
  const sigScript0 = combineKttV2ActionAndRedeem(kaspa, actionHex, redeemBytes);

  const signedTx = mk([sigScript0, fundSigHex]);
  const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
  console.log('TRANSFER txid:', result.transactionId);
  console.log(JSON.stringify({ bobXOnly, bobPrivHex: bobPriv.toString(), amount: ktAmount.toString(), txid: result.transactionId, scriptPubKeyHex: artB.scriptPubKeyHex, redeemScriptHex: Buffer.from(artB.script).toString('hex') }));
} finally { await rpc.disconnect(); }
