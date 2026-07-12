// notify.mjs — B线落3: notify 层泛化(设计 docs/2026-07-12-fee-split-phase3-package-notify-design.md v1.2,
// Bettor GREEN-with-notes 四注 + NWT GREEN-with-notes G1/G2 全折入)。
//
// 泛化自 kasia-console/src/services/broker-fee-emit.mjs 的"landed 后单点 emit"模式(2026-06-28 设计,
// 2026-07-11 live 验证过)——原逻辑硬编码"只找 broker 地址的 output",本模块把它泛化成"给定任意 fee-split
// 角色地址集,逐一匹配链上 output"。**复用既有蓝本的骨架(按地址匹配+幂等标记), 非新造订阅/轮询机制**
// (Owner 2026-07-12 直令"不要重复造轮子,重在梳理和接通")。
//
// 边界(spec §3.2, 三好用层 NWT 边界修正持续持有): 本文件零链依赖、零副作用——不碰链、不碰 DB、不发网络
// 请求。调用方(如 kasia-console)负责①从链读到 outputs ②注入 onLanded 投递方式 ③持久化去重状态。
//
// 🔴 landed 前提(NWT G2, MUST 警示, 防第三方误用出"假 landed 通知"):
//   `outputs` 参数必须是调用方已确认【终审】的输出(建议深度 ≥N 的 confirmed UTXO/output 集,
//   禁止直喂 mempool-accepted 或单次 RPC 查询结果)。本模块不做终审判定,信任调用方喂入的数据
//   (garbage-in-garbage-out,零链依赖包的必然边界)。KANet 团队自己在真实事故里学到的教训(kaspa_tx_log
//   命中 ≠ canonical / landed 浅确认可被 reorg 撤销)对第三方集成方同样成立——喂入未终审数据会产出
//   "通知用户收到钱了但链上其实还没定案"的假通知。

/**
 * matchLandedFeeOutputs — 把 fee-split 的 feeLeaves 与链上真实 output 集逐一匹配。
 *
 * 🔴 outputs 前提: 调用方已确认终审的输出列表(见文件头 landed 前提),本函数不做终审判定。
 *
 * 匹配规则(Bettor 注3, MUST, 纯函数正确性承重):
 *   (i)  地址匹配 + amount 断言 —— output 金额必须 == leaf.amount 才算 'matched'。地址对但金额不对
 *        是显式 'mismatch'(非静默当 matched),同 thread-walk H2 断言家族:"找到地址"不等于"这就是那笔钱"。
 *   (ii) 每个 output 至多配一个 leaf —— 防同地址多角色场景一个 output 被两个 leaf 重复认领。同一地址
 *        对应多个 leaf(committee 均分等罕见场景)时,按 leaf 数组顺序逐个消费未被占用的候选 output,
 *        不重复配对同一个 output index。
 *
 * @param {Array<{address:string, amount:string|number|bigint, txid?:string}>} outputs 调用方已从链读到的
 *   真实终审输出集(txid 可选,若提供会透传进 emitLandedNotification 的 payload)
 * @param {Array<{pk:string, amount:string, type:string}>} feeLeaves fee-split.mjs feeSplit() 产出的
 *   feeLeaves——地址派生(pk→address)是链特定操作, 调用方需自行做好后把 {address, amount, type, pk} 形状
 *   的候选传入(见下方 leafAddresses 参数, 与 feeLeaves 一一对应)
 * @param {Array<string>} leafAddresses 与 feeLeaves 等长、一一对应的已派生地址数组(本函数零链依赖,
 *   地址派生留给调用方)
 * @returns {Array<{leaf:object, output?:object, outputIndex?:number, state:'matched'|'mismatch'|'unmatched'}>}
 */
export function matchLandedFeeOutputs(outputs, feeLeaves, leafAddresses) {
  if (feeLeaves.length !== leafAddresses.length) {
    throw new Error(`matchLandedFeeOutputs: feeLeaves(${feeLeaves.length}) 与 leafAddresses(${leafAddresses.length}) 长度不符`);
  }
  const claimed = new Set();   // output index 已被占用(注3-ii: 每个 output 至多配一个 leaf)
  const results = [];
  for (let i = 0; i < feeLeaves.length; i++) {
    const leaf = feeLeaves[i];
    const addr = leafAddresses[i];
    let matchedIdx = -1;
    for (let j = 0; j < outputs.length; j++) {
      if (claimed.has(j)) continue;
      if (outputs[j].address === addr) { matchedIdx = j; break; }   // 地址匹配即取(第一个未占用的候选)
    }
    if (matchedIdx < 0) { results.push({ leaf, state: 'unmatched' }); continue; }
    const output = outputs[matchedIdx];
    const amountMatches = String(output.amount) === String(leaf.amount);
    if (!amountMatches) {
      // 注3-i: 地址对金额不对 → 显式 mismatch, 不占用这个 output(可能是巧合命中别的支付, 留给别的 leaf 或报告)
      results.push({ leaf, output, outputIndex: matchedIdx, state: 'mismatch' });
      continue;
    }
    claimed.add(matchedIdx);
    results.push({ leaf, output, outputIndex: matchedIdx, state: 'matched' });
  }
  return results;
}

/**
 * emitLandedNotification — 对 matchLandedFeeOutputs 产出的 'matched' 条目逐一投递通知。
 *
 * 🔴 去重契约(Bettor 注2, 诚实口径): 本函数本身只能保证"给定一次调用内、给定 matched 集合的
 * at-most-once"(同一批 matched 条目里同一个 leaf 不会被 emit 两次)。**真正跨多次调用的"恰好一次"依赖
 * 调用方自行持久化 idempotencyKey**(同 broker-fee-emit.mjs 现状: metadata 标记落 DB)——本函数不持状态,
 * 不做跨调用去重。文档/命名按此实际契约,不 overclaim exactly-once。
 *
 * @param {Array<{leaf:object, output:object, outputIndex:number, state:string}>} matched matchLandedFeeOutputs 产出
 * @param {{onLanded: function(payload:object):void}} o 调用方注入投递函数(DM/webhook/事件流,本函数不关心投递方式)
 * @returns {number} 实际投递的通知数(只处理 state==='matched' 的条目)
 */
export function emitLandedNotification(matched, { onLanded }) {
  let emitted = 0;
  for (const m of matched) {
    if (m.state !== 'matched') continue;
    onLanded({
      role: m.leaf.type,
      address: m.output.address,
      amountSompi: m.leaf.amount,
      txid: m.output.txid ?? null,
      outputIndex: m.outputIndex,
      landedAt: new Date().toISOString(),
    });
    emitted++;
  }
  return emitted;
}
