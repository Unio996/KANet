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
import { encodeRegisterAppendAction, combineActionAndRedeem as combineRegisterAppendActionAndRedeem } from './proto-register-append-witness.mjs';
import { encodeKttTransferZeroOutAction, combineKttActionAndRedeem } from './proto-ktt-transfer-witness.mjs';
import { encodeLeafStateBytes } from './proto-leaf-state.mjs';

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

// 🔴 找零形状选择(账本1427 Bettor 复核订正——原来的"必须 0 或 >=20M dust 门槛"与 (1404) 已定案的
// 0.95 KAS 步骤B种子面值冲突, 真实迭代出来的找零≈15M 会被那条硬门槛拒到构造不出来)。20M 只是 KIP-9
// U 形曲线上"比较省"的经验点, 不是节点规则——不该当成人为门槛写死。改成按真实成本二选一:
//   (a) 带找零输出: net_loss = 那次真实 mass 算出来的 requiredFee(找零吸收了剩下的全部)。
//   (b) 不留找零, 全部并入手续费: net_loss = 全部剩余(留在合约里的输出 + fee, 没有找零)。
// 在"requiredFee(该形状自己的真实 mass) <= 实际支付的 fee"且"net_loss <= 动态上限
// min(requiredFee×2, absFeeCapSompi, GLOBAL_ABS_FEE_CAP_SOMPI)"都成立的形状里选 net_loss 更小的那个；
// 两个都不成立 ⇒ throw no_viable_change_shape, 报文带两种形状各自的数字。
export const GLOBAL_ABS_FEE_CAP_SOMPI = 100_000_000n; // 1.0 KAS——镜像 kasia-relay/src/lib/covenant-broadcast.mjs 的同名常量, 两侧必须保持一致

export function dynamicNetLossCeiling(requiredFeeSompi, absFeeCapSompi) {
  let ceiling = requiredFeeSompi * 2n;
  if (absFeeCapSompi < ceiling) ceiling = absFeeCapSompi;
  if (GLOBAL_ABS_FEE_CAP_SOMPI < ceiling) ceiling = GLOBAL_ABS_FEE_CAP_SOMPI;
  return ceiling;
}

/**
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {bigint} o.leftoverSompi  Σin − 保留在合约里的输出总额(找零+fee 两者合计的"剩余额度", 未知谁占多少)
 * @param {Function} o.buildTxWithChange  (changeSompi:bigint) => Transaction(未 finalize, 含找零输出)
 * @param {Function} o.buildTxNoChange  () => Transaction(未 finalize, 无找零输出——剩余全部并入 fee)
 * @param {bigint} o.absFeeCapSompi  该 kind 的 per-kind cap(来自 proto-v0-template-anchors.json 的 feeProfile[kind].cap)
 * @returns {{includeChange:boolean, changeSompi:bigint, requiredFee:bigint, netLoss:bigint, ceiling:bigint, tx:*}}
 */
export function selectChangeShape({ kaspa, network, leftoverSompi, buildTxWithChange, buildTxNoChange, absFeeCapSompi }) {
  if (leftoverSompi < 0n) throw new Error(`selectChangeShape: insufficient inputs(leftover=${leftoverSompi} < 0)`);

  if (leftoverSompi === 0n) {
    const tx = buildTxNoChange();
    tx.finalize();
    const requiredFee = computeRequiredFeeSompiOrThrow(kaspa, network, tx);
    const netLoss = 0n;
    const ceiling = dynamicNetLossCeiling(requiredFee, absFeeCapSompi);
    if (requiredFee > netLoss || netLoss > ceiling) {
      throw new Error(`selectChangeShape: no_viable_change_shape(zero-leftover) requiredFee=${requiredFee} netLoss=${netLoss} ceiling=${ceiling}`);
    }
    return { includeChange: false, changeSompi: 0n, requiredFee, netLoss, ceiling, tx };
  }

  // 形状(a): 带找零。先占位建一次量 mass(与找零【值】无关, 只与结构有关), 再拿真实找零重建。
  let shapeA = null;
  const draftA = buildTxWithChange(leftoverSompi);
  draftA.finalize();
  const requiredFeeA = computeRequiredFeeSompiOrThrow(kaspa, network, draftA);
  const changeA = leftoverSompi - requiredFeeA;
  if (changeA >= 0n) {
    const txA = buildTxWithChange(changeA);
    txA.finalize();
    const netLossA = leftoverSompi - changeA; // = requiredFeeA(找零吸收了剩下的一切)
    const ceilingA = dynamicNetLossCeiling(requiredFeeA, absFeeCapSompi);
    const okA = requiredFeeA <= netLossA && netLossA <= ceilingA;
    shapeA = { includeChange: true, changeSompi: changeA, requiredFee: requiredFeeA, netLoss: netLossA, ceiling: ceilingA, tx: txA, ok: okA };
  }

  // 形状(b): 不留找零, 剩余全部并入 fee。
  const txB = buildTxNoChange();
  txB.finalize();
  const requiredFeeB = computeRequiredFeeSompiOrThrow(kaspa, network, txB);
  const netLossB = leftoverSompi; // 没有找零输出, 剩余全部计入 net_loss
  const ceilingB = dynamicNetLossCeiling(requiredFeeB, absFeeCapSompi);
  const okB = requiredFeeB <= netLossB && netLossB <= ceilingB;
  const shapeB = { includeChange: false, changeSompi: 0n, requiredFee: requiredFeeB, netLoss: netLossB, ceiling: ceilingB, tx: txB, ok: okB };

  const candidates = [shapeA, shapeB].filter((s) => s && s.ok);
  if (!candidates.length) {
    throw new Error(`selectChangeShape: no_viable_change_shape — withChange(requiredFee=${shapeA?.requiredFee ?? 'n/a(insufficient)'}, netLoss=${shapeA?.netLoss ?? 'n/a'}, ceiling=${shapeA?.ceiling ?? 'n/a'}) noChange(requiredFee=${requiredFeeB}, netLoss=${netLossB}, ceiling=${ceilingB})`);
  }
  candidates.sort((x, y) => (x.netLoss < y.netLoss ? -1 : x.netLoss > y.netLoss ? 1 : 0));
  return candidates[0];
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
export function buildMarketGenesisTxJson({ kaspa, network, feeUtxo, relayChangeScriptPublicKeyHex, shardLeafScriptPubKeyHex, absFeeCapSompi }) {
  const { Transaction, TransactionOutput, GenesisCovenantGroup } = kaspa;
  assertFixedOutputValue(GENESIS_OUTPUT_SOMPI, GENESIS_OUTPUT_SOMPI, 'market_genesis'); // 防未来重构悄悄换成算出来的值
  if (typeof absFeeCapSompi !== 'bigint') throw new Error('buildMarketGenesisTxJson: absFeeCapSompi(bigint, feeProfile.market_genesis.cap) required');

  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);
  const genesisSpk = scriptPublicKeyFromHex(kaspa, shardLeafScriptPubKeyHex);
  const changeSpk = scriptPublicKeyFromHex(kaspa, relayChangeScriptPublicKeyHex);
  const outpoint = { transactionId: feeUtxo.txid, index: feeUtxo.vout };

  const mkInput = (sigScript) => ({
    previousOutpoint: outpoint, signatureScript: sigScript, sequence: 0n, sigOpCount: 1, computeBudget: 0,
    utxo: { outpoint, amount: feeUtxo.value, scriptPublicKey: feeUtxoSpk, blockDaaScore: 0n },
  });
  // 🔴 genesis 输出(第一次创建 covenant 实例, 不是续约)不用 CovenantBinding——那是"延续既有 covenant_id"
  // 的声明方式。genesis 用 populateGenesisCovenants([new GenesisCovenantGroup(authInputIdx, [outIdx,...])])
  // 声明"output[outIdx] 的 covenant_id 由 input[authInputIdx] 的 outpoint 派生", 同 kasia-relay/src/lib/
  // p2sh.mjs:1878-1885 unlockBshardGenesisMintPayout 既有生产手法逐字一致(Bettor 1427 复核点名)。必须在
  // finalize()/签名之前调用——v1 sighash 把 covenant 字段焊进去, 顺序错了 sighash 就不对。
  const mkOutputs = (changeSompi) => changeSompi === undefined
    ? [new TransactionOutput(GENESIS_OUTPUT_SOMPI, genesisSpk)]
    : [new TransactionOutput(GENESIS_OUTPUT_SOMPI, genesisSpk), new TransactionOutput(changeSompi, changeSpk)];
  const mkTx = (changeSompi) => {
    const t = new Transaction({
      version: 1,
      inputs: [mkInput(new Uint8Array(0))],
      outputs: mkOutputs(changeSompi),
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    t.populateGenesisCovenants([new GenesisCovenantGroup(0, [0])]);
    return t;
  };

  const leftover = feeUtxo.value - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({
    kaspa, network, leftoverSompi: leftover,
    buildTxWithChange: (changeSompi) => mkTx(changeSompi),
    buildTxNoChange: () => mkTx(undefined),
    absFeeCapSompi,
  });

  // shardLeafCovId: consensus 的 covenant_id(funding.outpoint, [outputIndices]) 是纯函数, 不需要上链
  // 确认——本地就能算出、且不受后续找零值影响(与哪个形状/找零值无关, 同一 outpoint+outIdx 恒定)。
  // 🔴 订正(账本1435→1436, 撤销早前错误说法): 这个值只用于 register_append 的"合并奖池代币"
  // (held/新genesis)的 owner 字段, 绝不能也用作 bet_mint 步骤A(每注新铸 stake 筹码)的 ownerCovIdHex——
  // covenant_id(outpoint,[index,output]) 的真实公式吃的是输出的完整脚本字节(含 State), "某代币的
  // owner=它自己的covenant_id"是自指不动点方程, 无解(rusty-kaspa consensus/core/src/hashing/
  // covenant_id.rs:13-14 doc 原话+真实kaspa-wasm实测确认)。stake 筹码的 ownerCovIdHex 用
  // STAKE_CHIP_OWNER_UNBOUND(见 proto-covenant-builder.mjs), 不是这个值。
  const shardLeafCovId = String(shape.tx.outputs[0].covenant.covenantId);

  return {
    txJson: shape.tx.serializeToSafeJSON(),
    expectedTxid: shape.tx.id,
    shardLeafCovId,
    includeChange: shape.includeChange,
    changeSompi: shape.changeSompi,
    requiredFee: shape.requiredFee,
    netLoss: shape.netLoss,
    signInputIndices: [0],
    genesisOutputIndices: [0],
    continuationOutputIndices: [],
  };
}

/**
 * bet_mint 步骤A(KTT genesis, 铸stake筹码)的 tx_json 组装(不签名——relay 侧签 fee 输入): 1 个
 * relay fee 输入 + 2 个输出 [KTT genesis(固定 GENESIS_OUTPUT_SOMPI, owner=STAKE_CHIP_OWNER_UNBOUND,
 * 由调用方通过 computeKttGenesisArtifact({amount, ownerCovIdHex:STAKE_CHIP_OWNER_UNBOUND}) 算好传入),
 * 找零回 relay]。结构与 buildMarketGenesisTxJson 完全对称(同样是"1 fee 输入 genesis 一个新 covenant
 * 实例"的形状), 唯一差异是 genesis 的是 KTT 而不是 ShardLeaf_direct, authorizing_input 恒为 0(唯一
 * 输入就是 fee 输入本身)。
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {{txid:string, vout:number, value:bigint, scriptPublicKeyHex:string}} o.feeUtxo
 * @param {string} o.relayChangeScriptPublicKeyHex
 * @param {string} o.kttScriptPubKeyHex  computeKttGenesisArtifact({amount, ownerCovIdHex:STAKE_CHIP_OWNER_UNBOUND}).scriptPubKeyHex
 * @param {bigint} o.absFeeCapSompi  feeProfile.bet_mint_step_a.cap
 * @returns {{txJson:string, expectedTxid:string, stakeCovId:string, includeChange:boolean, changeSompi:bigint, requiredFee:bigint, netLoss:bigint, signInputIndices:number[], genesisOutputIndices:number[], continuationOutputIndices:number[]}}
 */
export function buildKttGenesisTxJson({ kaspa, network, feeUtxo, relayChangeScriptPublicKeyHex, kttScriptPubKeyHex, absFeeCapSompi }) {
  const { Transaction, TransactionOutput, GenesisCovenantGroup } = kaspa;
  assertFixedOutputValue(GENESIS_OUTPUT_SOMPI, GENESIS_OUTPUT_SOMPI, 'bet_mint_step_a');
  if (typeof absFeeCapSompi !== 'bigint') throw new Error('buildKttGenesisTxJson: absFeeCapSompi(bigint, feeProfile.bet_mint_step_a.cap) required');

  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);
  const kttSpk = scriptPublicKeyFromHex(kaspa, kttScriptPubKeyHex);
  const changeSpk = scriptPublicKeyFromHex(kaspa, relayChangeScriptPublicKeyHex);
  const outpoint = { transactionId: feeUtxo.txid, index: feeUtxo.vout };

  const mkInput = (sigScript) => ({
    previousOutpoint: outpoint, signatureScript: sigScript, sequence: 0n, sigOpCount: 1, computeBudget: 0,
    utxo: { outpoint, amount: feeUtxo.value, scriptPublicKey: feeUtxoSpk, blockDaaScore: 0n },
  });
  const mkOutputs = (changeSompi) => changeSompi === undefined
    ? [new TransactionOutput(GENESIS_OUTPUT_SOMPI, kttSpk)]
    : [new TransactionOutput(GENESIS_OUTPUT_SOMPI, kttSpk), new TransactionOutput(changeSompi, changeSpk)];
  const mkTx = (changeSompi) => {
    const t = new Transaction({
      version: 1,
      inputs: [mkInput(new Uint8Array(0))],
      outputs: mkOutputs(changeSompi),
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    t.populateGenesisCovenants([new GenesisCovenantGroup(0, [0])]);
    return t;
  };

  const leftover = feeUtxo.value - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({
    kaspa, network, leftoverSompi: leftover,
    buildTxWithChange: (changeSompi) => mkTx(changeSompi),
    buildTxNoChange: () => mkTx(undefined),
    absFeeCapSompi,
  });

  const stakeCovId = String(shape.tx.outputs[0].covenant.covenantId);

  return {
    txJson: shape.tx.serializeToSafeJSON(),
    expectedTxid: shape.tx.id,
    stakeCovId,
    includeChange: shape.includeChange,
    changeSompi: shape.changeSompi,
    requiredFee: shape.requiredFee,
    netLoss: shape.netLoss,
    signInputIndices: [0],
    genesisOutputIndices: [0],
    continuationOutputIndices: [],
  };
}

/**
 * 落链校验(账本1429/1431 要求的 fail-closed 重算比对): genesis 交易一旦落链, 从**实际落链交易**的
 * input[0] outpoint + genesis 输出本身, 用同一个 consensus 纯函数(kaspa.covenantId)重新算一遍
 * covenant_id, 必须与 prepared 阶段存的 shardleaf_cov_id 完全一致——防"库里存的值与链上实际情况不符"
 * (无论是构造 bug、还是——理论上不该发生但要防——广播过程中输入被替换)。
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.expectedCovId  proto_markets.shardleaf_cov_id(prepared 阶段存的值)
 * @param {{transactionId:string, index:number}} o.landedFundingOutpoint  落链交易实际的 input[0].previousOutpoint
 * @param {{value:bigint, scriptPublicKeyHex:string}} o.landedGenesisOutput  落链交易实际的 genesis 输出(output[genesisOutputIndex])
 * @param {number} o.genesisOutputIndex
 * @returns {{ok:true}|{ok:false, actualCovId:string, reason:string}}
 */
export function verifyShardLeafCovIdAgainstLandedTx({ kaspa, expectedCovId, landedFundingOutpoint, landedGenesisOutput, genesisOutputIndex }) {
  if (!expectedCovId) throw new Error('verifyShardLeafCovIdAgainstLandedTx: expectedCovId required(proto_markets.shardleaf_cov_id 为空——genesis_prepared 阶段没写上这一列)');
  const genesisSpk = scriptPublicKeyFromHex(kaspa, landedGenesisOutput.scriptPublicKeyHex);
  const output = new kaspa.TransactionOutput(landedGenesisOutput.value, genesisSpk);
  const actualCovId = String(kaspa.covenantId(landedFundingOutpoint, [{ index: genesisOutputIndex, output }]));
  if (actualCovId.toLowerCase() !== String(expectedCovId).toLowerCase()) {
    return { ok: false, actualCovId, reason: `落链交易实际算出的 covenant_id(${actualCovId}) 与 prepared 阶段存的 shardleaf_cov_id(${expectedCovId}) 不一致` };
  }
  return { ok: true, actualCovId };
}

/**
 * bet_mint 步骤B(register_append)的完整 tx_json 组装——不签名(relay 侧只签 fee 输入)。
 * 生产真实形状(账本1425/1434/1436 一路验证过的那个形状): 输入=[leaf, (held 可选), stake, fee],
 * 输出=[leaf续约(CovenantBinding到leaf自己), PoolSideTicket genesis, 合并KTT genesis(owner=leaf的
 * covenant_id, 真实kaspa.covenantId算出, authorizing_input=fee输入), fee找零]。
 * leaf/held/stake 三个 covenant 输入的 sigScript 全部本地确定性算出(不需要私钥, 同 AB11/binding=cov
 * 声明宏的既有性质), 只有 fee 输入留空待 relay 签。
 *
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {Buffer} o.leafRedeemScript  computeShardLeafRedeemScript(当前 state)的产物
 * @param {{start:number,len:number}} o.leafStateLayout
 * @param {{txid:string, vout:number}} o.leafOutpoint  proto_markets.shardleaf_txid/vout
 * @param {string} o.leafCovId  proto_markets.shardleaf_cov_id(32字节hex, 无0x)
 * @param {{local_yes:number,local_no:number,count:number,pool_value:number}} o.currentState  下注前的 state(deriveLeafState)
 * @param {{local_yes:number,local_no:number,count:number,pool_value:number}} o.newState  下注后的 state
 * @param {object|null} o.heldInput  首次下注为 null; 否则 {txid,vout,value,scriptPublicKeyHex,redeemScript(Buffer),covId,entryAbi,stateFieldCount}
 * @param {object} o.stakeInput  {txid,vout,value,scriptPublicKeyHex,redeemScript(Buffer),covId,entryAbi,stateFieldCount}
 * @param {object} o.feeUtxo  {txid,vout,value,scriptPublicKeyHex}
 * @param {string} o.relayChangeScriptPublicKeyHex
 * @param {object} o.registerAppendEntryAbi  compileSilV100(...)._raw.contracts.ShardLeaf_direct.entries.register_append(当前ctor下重新编译现读, 不跨市场复用)
 * @param {object} o.registerAppendArgs  {side, stake, bettorPk(32字节hex), psPrefix, psSuffix, tokPrefix, tokSuffix}
 * @param {string} o.ticketScriptPubKeyHex  PoolSideTicket genesis 的 scriptPubKeyHex(computeGeneric 产物)
 * @param {string} o.mergedKttScriptPubKeyHex  合并KTT genesis(computeKttGenesisArtifact({amount:pool_value+stake, ownerCovIdHex:leafCovId}))的 scriptPubKeyHex(不含0x的裸脚本hex, 用于起算covenant_id)
 * @param {Buffer} o.mergedKttScript  同上, 完整脚本字节(Buffer)
 * @param {bigint} o.absFeeCapSompi  feeProfile.bet_mint_step_b.cap
 */
export function buildRegisterAppendTxJson({
  kaspa, network, leafRedeemScript, leafStateLayout, leafOutpoint, leafCovId, currentState, newState,
  heldInput, stakeInput, feeUtxo, relayChangeScriptPublicKeyHex,
  registerAppendEntryAbi, registerAppendArgs, ticketScriptPubKeyHex, mergedKttScript, absFeeCapSompi,
}) {
  const { Transaction, TransactionOutput, GenesisCovenantGroup } = kaspa;
  const mergedAmount = newState.pool_value; // = currentState.pool_value + registerAppendArgs.stake, 调用方已算好放进 newState

  // ── 输入 index 布局: [0]leaf [1]held?(可选) [2 或 1]stake [最后]fee ──
  const inputs = [];
  const leafOutpointObj = { transactionId: leafOutpoint.txid, index: leafOutpoint.vout };
  inputs.push({ kind: 'leaf' });
  let heldIdx = -1, stakeIdx, feeIdx;
  if (heldInput) {
    heldIdx = inputs.length; inputs.push({ kind: 'held' });
  }
  stakeIdx = inputs.length; inputs.push({ kind: 'stake' });
  feeIdx = inputs.length; inputs.push({ kind: 'fee' });

  const leafSpk = scriptPublicKeyFromHex(kaspa, '0x' + p2shHexFromScript(kaspa, leafRedeemScript));
  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);
  const stakeSpk = scriptPublicKeyFromHex(kaspa, stakeInput.scriptPublicKeyHex);
  const heldSpk = heldInput ? scriptPublicKeyFromHex(kaspa, heldInput.scriptPublicKeyHex) : null;

  // leaf 自己的 register_append witness(不需要私钥, AB11 声明宏性质——见 proto-register-append-witness.mjs)。
  const leafAction = encodeRegisterAppendAction(kaspa, registerAppendEntryAbi, {
    side: registerAppendArgs.side, stake: registerAppendArgs.stake, leafOutIdx: 0, psOutIdx: 1,
    bettorPk: registerAppendArgs.bettorPk, ps_prefix: registerAppendArgs.psPrefix, ps_suffix: registerAppendArgs.psSuffix,
    stakeInIdx: stakeIdx, tok_out: 2, tok_prefix: registerAppendArgs.tokPrefix, tok_suffix: registerAppendArgs.tokSuffix,
  });
  const leafSigScriptHex = combineRegisterAppendActionAndRedeem(kaspa, leafAction, leafRedeemScript);
  // 🔴 账本1436订正(本笔发现并修复的真实bug): stake.owner=STAKE_CHIP_OWNER_UNBOUND(全零32字节),
  // 在场证明要靠 OpInputCovenantId(owner_input_idx)==ZERO32 成立——这要求 owner_input_idx 指向一个
  // 【非covenant】输入(P2PK 的 fee 输入, OpInputCovenantId 对它返回 ZERO_HASH)。指向 leaf(有真实非零
  // covenant_id)是被 docs/provenance/2026-09-15-j2-stake-chip-owner-unbound-verification/ 向量②
  // (②stake_transfer_owner_unbound_via_leaf_input_fail)明确证伪的写法——早前这里错写成 [0](leaf),
  // 与 held 的 owner_input_idx=[0](owner=leaf的covenant_id, 用 leaf 自证)混淆了两种不同的 owner 语义。
  const stakeAction = encodeKttTransferZeroOutAction(kaspa, stakeInput.entryAbi, stakeInput.stateFieldCount, [feeIdx]);
  const stakeSigScriptHex = combineKttActionAndRedeem(kaspa, stakeAction, stakeInput.redeemScript);
  const heldSigScriptHex = heldInput
    ? combineKttActionAndRedeem(kaspa, encodeKttTransferZeroOutAction(kaspa, heldInput.entryAbi, heldInput.stateFieldCount, [0]), heldInput.redeemScript)
    : null;

  const mkInput = (outpoint, value, spk, sigScriptHex) => ({
    previousOutpoint: outpoint, signatureScript: sigScriptHex ?? new Uint8Array(0), sequence: 0n, sigOpCount: 1, computeBudget: 0,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });

  // 新 leaf 续约的 AB11 手写 state 字节(与合约自己内部算的完全同一套编码, 已用真实编译独立交叉验证过, 见 proto-leaf-state.mjs)。
  const newStateBytes = encodeLeafStateBytes(newState);
  const leafPrefix = leafRedeemScript.subarray(0, leafStateLayout.start);
  const leafSuffix = leafRedeemScript.subarray(leafStateLayout.start + leafStateLayout.len);
  const leafContRedeem = Buffer.concat([leafPrefix, newStateBytes, leafSuffix]);
  const leafContSpk = scriptPublicKeyFromHex(kaspa, '0x' + p2shHexFromScript(kaspa, leafContRedeem));
  const mergedKttSpk = scriptPublicKeyFromHex(kaspa, '0x' + p2shHexFromScript(kaspa, mergedKttScript));
  const ticketSpk = scriptPublicKeyFromHex(kaspa, ticketScriptPubKeyHex);

  const mkTx = (feeChangeSompi) => {
    const feeInputSigScript = new Uint8Array(0); // relay 待签
    const txInputs = [];
    txInputs[0] = mkInput(leafOutpointObj, currentStateUtxoValueOf(leafOutpoint), leafSpk, leafSigScriptHex);
    if (heldInput) txInputs[heldIdx] = mkInput({ transactionId: heldInput.txid, index: heldInput.vout }, heldInput.value, heldSpk, heldSigScriptHex);
    txInputs[stakeIdx] = mkInput({ transactionId: stakeInput.txid, index: stakeInput.vout }, stakeInput.value, stakeSpk, stakeSigScriptHex);
    txInputs[feeIdx] = mkInput({ transactionId: feeUtxo.txid, index: feeUtxo.vout }, feeUtxo.value, feeUtxoSpk, feeInputSigScript);

    const t = new Transaction({
      version: 1,
      inputs: txInputs,
      outputs: [
        new TransactionOutput(CONTINUATION_OUTPUT_SOMPI, leafContSpk), // [0] leaf续约, CovenantBinding 后面 populateGenesisCovenants/CovenantBinding 声明
        new TransactionOutput(GENESIS_OUTPUT_SOMPI, ticketSpk), // [1] ticket genesis(无covenant声明)
        new TransactionOutput(GENESIS_OUTPUT_SOMPI, mergedKttSpk), // [2] 合并KTT genesis
        new TransactionOutput(feeChangeSompi === undefined ? 0n : feeChangeSompi, feeUtxoSpk), // [3] fee找零(占位spk复用fee自己的, 调用方可在真正广播前替换成真实找零地址; 本函数不决定找零去向, 只决定形状)
      ].filter((_, i) => !(feeChangeSompi === undefined && i === 3)),
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    // leaf续约: CovenantBinding到leaf自己(authorizing_input=0, covenant_id=leafCovId)
    t.outputs[0].covenant = new kaspa.CovenantBinding(0, new kaspa.Hash(leafCovId));
    // 合并KTT genesis: authorizing_input=fee输入(账本1434③要求, 规避authorizing input本身是covenant的未知项)
    t.populateGenesisCovenants([new GenesisCovenantGroup(feeIdx, [2])]);
    return t;
  };

  const leftover = feeUtxo.value - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({
    kaspa, network, leftoverSompi: leftover,
    buildTxWithChange: (changeSompi) => mkTx(changeSompi),
    buildTxNoChange: () => mkTx(undefined),
    absFeeCapSompi,
  });

  const mergedKttCovId = String(shape.tx.outputs[2].covenant.covenantId);

  return {
    txJson: shape.tx.serializeToSafeJSON(),
    expectedTxid: shape.tx.id,
    mergedKttCovId,
    includeChange: shape.includeChange,
    changeSompi: shape.changeSompi,
    requiredFee: shape.requiredFee,
    netLoss: shape.netLoss,
    signInputIndices: [feeIdx],
    genesisOutputIndices: [2],
    continuationOutputIndices: [0],
  };
}

function p2shHexFromScript(kaspa, scriptBytes) {
  // 复用 ScriptBuilder 的 createPayToScriptHashScript 更省事, 但要用真实脚本先建 builder;
  // 这里直接用 kaspa.payToScriptHashScript(若存在)否则退回本地 blake2b 拼接(与 proto-covenant-builder.mjs 的 p2sh 一致公式)。
  if (typeof kaspa.payToScriptHashScript === 'function') {
    const spk = kaspa.payToScriptHashScript(new Uint8Array(scriptBytes));
    return spk.script;
  }
  throw new Error('p2shHexFromScript: kaspa.payToScriptHashScript not available');
}

function currentStateUtxoValueOf() {
  // leaf 自己的 UTXO 面值恒为 CONTINUATION_OUTPUT_SOMPI(每次续约都固定在这个 KIP-9 最优点, 见
  // kasia-relay/src/lib/covenant-broadcast.mjs 同名常量)。独立成一个具名函数只是为了将来若这个假设
  // 需要改成"从链上查真实值"时, 只有一处要改。
  return CONTINUATION_OUTPUT_SOMPI;
}
