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
