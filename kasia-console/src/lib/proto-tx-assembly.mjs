// proto-tx-assembly.mjs — market_genesis/bet_mint tx 组装的构造层守卫(J2, 账本1425续, Bettor向量①③④)。
//
// 三条各自独立的构造层守卫, 都不是 relay 侧检查的"影子"(relay 拦的是签名前那一层, 这里拦的是"构造出
// 来的值/输入/费用本身对不对", 两者必须都存在——一条被绕过, 另一条仍能拦):
//   ① assertFixedOutputValue: genesis/续约输出值必须是协议常量, 不允许算出来的近似值糊弄过去。
//   ③ assertKttOutpointRecorded: KTT 输入 outpoint 必须来自 proto_bets 记录, 不许链上扫描后自由选。
//   ④ computeRequiredFeeSompiOrThrow: mass 算不出来就是硬失败, 不许退化成估算值。
//
// 常量与 kasia-relay/src/lib/covenant-broadcast.mjs 的 GENESIS_OUTPUT_SOMPI/CONTINUATION_OUTPUT_SOMPI
// 数值必须保持一致(KIP-9 storage mass U 形曲线全局最优点, 20,000,000 sompi)——console 侧独立持有一份
// 而不是跨包 import relay 代码("Console 传导不碰链"角色分工铁律), 改动任一侧必须同步改另一侧。

import { sqlite } from '../db/client.js';

export const GENESIS_OUTPUT_SOMPI = 20_000_000n;
export const CONTINUATION_OUTPUT_SOMPI = 20_000_000n;
export const SOMPI_PER_MASS = 100n;

/**
 * ① 构造层守卫: 输出值必须逐位等于协议常量, 不接受"减法算出来接近但不精确相等"的值。
 * 与 relay 侧 validateFixedValueOutputs 是两条独立防线——这条在构造阶段、送进 covenant_broadcast
 * 的 cmd 之前就拦, relay 那条拦的是签名前最后一步; 两者故意不共享实现。
 */
export function assertFixedOutputValue(valueSompi, expectedSompi, label) {
  if (typeof valueSompi !== 'bigint') throw new Error(`assertFixedOutputValue(${label}): value must be bigint, got ${typeof valueSompi}`);
  if (valueSompi !== expectedSompi) {
    throw new Error(`assertFixedOutputValue(${label}): 输出值 ${valueSompi} != 协议常量 ${expectedSompi}(v0 只允许固定值, 不接受算出来的近似值)`);
  }
}

/**
 * ③ 构造层守卫: bet_mint 步骤 B(register_append)要花的 KTT 输入 outpoint, 必须逐字段等于该 bet 在
 * proto_bets 表里记录的 mint_txid/mint_vout(= 步骤 A 铸筹码的产出)——绝不允许"按 owner 扫链找一个
 * 看起来对的 UTXO"式的自由选择(那样会选到别的市场/别的 bet 的筹码, 或者一个已经被花过的旧筹码)。
 */
export function assertKttOutpointRecorded({ betId, txid, vout }) {
  if (!betId) throw new Error('assertKttOutpointRecorded: betId required');
  const row = sqlite.prepare('SELECT mint_txid, mint_vout FROM proto_bets WHERE id = ?').get(betId);
  if (!row) throw new Error(`assertKttOutpointRecorded: proto_bets 找不到 bet_id=${betId}`);
  if (!row.mint_txid || row.mint_vout === null || row.mint_vout === undefined) {
    throw new Error(`assertKttOutpointRecorded: bet_id=${betId} 的铸筹码步骤(A)尚未记录 outpoint(mint_txid/mint_vout 为空)——不能在 A 落地前花它`);
  }
  if (row.mint_txid !== txid || row.mint_vout !== vout) {
    throw new Error(`assertKttOutpointRecorded: 给定 outpoint ${txid}:${vout} 与 proto_bets 记录的 ${row.mint_txid}:${row.mint_vout} 不一致——拒绝使用未记录的 KTT 输入(反例: 按 owner 扫链选到的 UTXO)`);
  }
  return { txid: row.mint_txid, vout: row.mint_vout };
}

/**
 * ④ 构造层守卫: console 侧调用 calculateTransactionMass 必须 fail-loud——算不出来就是硬失败,
 * 绝不退化成一个估算值糊弄过去(relay 侧 covenant-broadcast-relay.mjs 的 CRF-2 只覆盖 relay 自己
 * 那次调用, 不覆盖 console 侧这次独立调用, 两处必须各自守住)。
 */
export function computeRequiredFeeSompiOrThrow(kaspa, network, tx) {
  if (!kaspa || typeof kaspa.calculateTransactionMass !== 'function') {
    throw new Error('computeRequiredFeeSompiOrThrow: kaspa.calculateTransactionMass 不可用(fail-loud, 不回退到估算值)');
  }
  let mass;
  try {
    mass = kaspa.calculateTransactionMass(network, tx);
  } catch (e) {
    throw new Error(`computeRequiredFeeSompiOrThrow: calculateTransactionMass 抛错(fail-loud, 不回退到估算值): ${e.message}`);
  }
  if (mass === undefined || mass === null) {
    throw new Error('computeRequiredFeeSompiOrThrow: calculateTransactionMass 返回空值(fail-loud, 不回退到估算值)');
  }
  return BigInt(mass) * SOMPI_PER_MASS;
}

/**
 * §9.5 fee-UTXO 选择器: 只选"单个够用的 UTXO", v0 明确不做自动拆分/合并(不做的范围, Bettor 1425 条件⑥认可)。
 * 找零形状必须是 0(全部耗尽)或 >= CONTINUATION_OUTPUT_SOMPI(留下的找零本身要能再花, 不留 dust 找零)。
 */
export function selectFeeUtxo(candidates, minRequiredSompi) {
  if (typeof minRequiredSompi !== 'bigint') throw new Error('selectFeeUtxo: minRequiredSompi must be bigint');
  const sufficient = (candidates || []).filter((u) => u.value >= minRequiredSompi);
  if (sufficient.length === 0) {
    throw new Error(`selectFeeUtxo: no_suitable_fee_utxo(没有单个 UTXO 够 ${minRequiredSompi} sompi, v0 不做自动拆分)`);
  }
  sufficient.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  return sufficient[0];
}

export function assertChangeShape(changeSompi) {
  if (changeSompi !== 0n && changeSompi < CONTINUATION_OUTPUT_SOMPI) {
    throw new Error(`assertChangeShape: 找零 ${changeSompi} sompi 既不是 0 也不 >= ${CONTINUATION_OUTPUT_SOMPI}(dust 找零, 拒绝)`);
  }
}

/**
 * 续约输出的唯一构造入口: 强制带 CovenantBinding 声明, 结构上不存在"忘记声明"这条代码路径
 * (省得下一个人手写 new TransactionOutput(...) 漏掉第三个参数——那会让 calculateTransactionMass
 * 把续约输出当成未声明用途的巨型脚本 P2SH, 实测量级可达 >10 倍真实 mass, 见 provenance 向量②)。
 */
export function buildContinuationOutput({ TransactionOutput, CovenantBinding, Hash }, valueSompi, scriptPublicKey, authInputIdx, covenantIdHex) {
  if (!covenantIdHex) throw new Error('buildContinuationOutput: covenantIdHex required(续约输出必须声明 CovenantBinding)');
  return new TransactionOutput(valueSompi, scriptPublicKey, new CovenantBinding(authInputIdx, new Hash(covenantIdHex)));
}

/** 把 '0x...' P2SH scriptPubKey hex(computeMarketGenesisArtifacts/computeKttGenesisArtifact 的返回形状)
 *  转成 kaspa-wasm ScriptPublicKey 对象(version=0, 标准脚本版本)。 */
export function scriptPublicKeyFromHex({ ScriptPublicKey }, hexStr) {
  const clean = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
  return new ScriptPublicKey(0, clean);
}

/**
 * market_genesis 的 tx_json 组装(不签名——relay 侧签 fee 输入): 1 个 relay fee 输入 + 2 个输出
 * [genesis ShardLeaf_direct(固定 GENESIS_OUTPUT_SOMPI) , 找零回 relay]。
 * mass 与输出【值】无关只与【结构】有关, 所以先拿一个占位找零值算一次 mass 拿到 requiredFee, 再拿真实
 * 找零值重建一次拿到最终 tx/txid(两遍构造, 标准做法——第一遍不能直接当成品广播, 找零值是错的)。
 * @param {object} o
 * @param {*} o.kaspa  kaspa-wasm 模块(注入, 供测试用假实现替换)
 * @param {string} o.network
 * @param {{txid:string, vout:number, value:bigint, scriptPublicKeyHex:string}} o.feeUtxo
 * @param {string} o.relayChangeScriptPublicKeyHex  relay 自己地址的 scriptPublicKey(找零去向)
 * @param {string} o.shardLeafScriptPubKeyHex  computeMarketGenesisArtifacts().shardLeafDirect.scriptPubKeyHex
 * @returns {{txJson:string, expectedTxid:string, signInputIndices:number[], genesisOutputIndices:number[], continuationOutputIndices:number[]}}
 */
export function buildMarketGenesisTxJson({ kaspa, network, feeUtxo, relayChangeScriptPublicKeyHex, shardLeafScriptPubKeyHex }) {
  const { Transaction, TransactionOutput } = kaspa;
  assertFixedOutputValue(GENESIS_OUTPUT_SOMPI, GENESIS_OUTPUT_SOMPI, 'market_genesis'); // 防未来重构悄悄换成算出来的值

  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);
  const genesisSpk = scriptPublicKeyFromHex(kaspa, shardLeafScriptPubKeyHex);
  const changeSpk = scriptPublicKeyFromHex(kaspa, relayChangeScriptPublicKeyHex);
  const outpoint = { transactionId: feeUtxo.txid, index: feeUtxo.vout };

  const mkInput = (sigScript) => ({
    previousOutpoint: outpoint, signatureScript: sigScript, sequence: 0n, sigOpCount: 1, computeBudget: 0,
    utxo: { outpoint, amount: feeUtxo.value, scriptPublicKey: feeUtxoSpk, blockDaaScore: 0n },
  });
  const mkTx = (changeSompi) => new Transaction({
    version: 1,
    inputs: [mkInput(new Uint8Array(0))],
    outputs: [
      new TransactionOutput(GENESIS_OUTPUT_SOMPI, genesisSpk),
      new TransactionOutput(changeSompi, changeSpk),
    ],
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });

  const draft = mkTx(feeUtxo.value - GENESIS_OUTPUT_SOMPI); // 占位找零, 只为量 mass(与结构无关不看值)
  draft.finalize();
  const requiredFee = computeRequiredFeeSompiOrThrow(kaspa, network, draft);
  const change = feeUtxo.value - GENESIS_OUTPUT_SOMPI - requiredFee;
  if (change < 0n) throw new Error(`buildMarketGenesisTxJson: insufficient fee UTXO(${feeUtxo.value} < genesis ${GENESIS_OUTPUT_SOMPI} + fee ${requiredFee})`);
  assertChangeShape(change);

  const final = mkTx(change);
  final.finalize();
  return {
    txJson: final.serializeToSafeJSON(),
    expectedTxid: final.id,
    signInputIndices: [0],
    genesisOutputIndices: [0],
    continuationOutputIndices: [],
  };
}
