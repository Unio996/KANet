// broker-fee-chain.mjs — 单一权威: broker fee 链验计算 (查漏补缺 2026-07-04)。
//
// Owner 撞见: 通过 @KANET_Broker_bot 押注测 broker 费用, 电报 DM 跟网页 UI 显示"完全不一样"。
// 查证根因: 系统里有 3 条并行、互不一致的 broker fee 计算路径——
//   ① broker-fee-emit.mjs(DM 单笔到账推送): 直接查 kaspa_tx_log 逐笔匹配 broker 地址, 唯一对的。
//   ② /api/kanet-broker/earnings/:relay_id(网页 UI): 靠 metadata.phase2_broker_fee_sompi(v0.6 老
//      settler 专属字段, bshard/v0.7 从没写过, #48 phase2_winner 同款坑第 3 次), 没有就回退
//      maker_stake×fee_pct 估算——bshard 盘永远显示假估算值。
//   ③ /api/kanet-broker/earnings-by-address/:address(/earnings 命令+/broker 卡片走这条): 靠
//      metadata.settle_evidence.fee_payouts, 这个字段从没被任何代码写过(幽灵字段, grep 全库零命中)。
//
// Owner 点破: "系统并不强壮, 程序散乱, 没有模块化! 一个功能可能有几个并行相似程序" ——这正是那个问题的
// 活案例。根治 = consolidate 成单一权威函数(这个文件), ①②③全部改调它, 不再各自维护一份"怎么算
// broker fee"的逻辑。
//
// 诚实口径(同 broker-fee-emit.mjs 铁律): realized 金额只信【链上 kaspa_tx_log 索引到的真实到账】,
// 禁 DB 估算冒充"已赚"; pending(还没结算)可以给 maker_stake×fee_pct 当"预计"(明确标注非确认值,
// 跟 bettor 端 payout_if_win projection 同一诚实等级——预测不是谎称已发生)。
import { sqlite } from '../db/client.js';

/**
 * computeMarketBrokerFee — 给一个 pool_markets 行 + broker 地址, 算出这盘的 broker fee 状态。
 * @param {object} marketRow  需要字段: settle_txid, refund_txid, protocol_status, maker_stake_amount, broker_fee_pct
 * @param {string} brokerAddress  broker 收 fee 的地址(kaspatest:.../kaspa:...)
 * @returns {{ status: 'settled'|'refunded'|string, feeSompi: bigint, chainVerified: boolean, estimated: boolean }}
 */
export function computeMarketBrokerFee(marketRow, brokerAddress) {
  const r = marketRow;
  let landedSompi = null;
  if (r.settle_txid && brokerAddress) {
    const txRow = sqlite.prepare('SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?').get(r.settle_txid);
    if (txRow?.outputs_json) {
      try {
        const outs = JSON.parse(txRow.outputs_json);
        const out = (outs || []).find((o) => (o.script_public_key_address || o.address) === brokerAddress);
        if (out) landedSompi = Number(out.amount ?? out.amount_sompi ?? 0);
      } catch { /* malformed outputs_json — treat as not-yet-verifiable */ }
    }
  }
  const isRealized = landedSompi != null && landedSompi > 0;
  const isRefunded = !!r.refund_txid && !isRealized;
  if (isRealized) {
    return { status: 'settled', feeSompi: BigInt(landedSompi), chainVerified: true, estimated: false };
  }
  if (isRefunded) {
    return { status: 'refunded', feeSompi: 0n, chainVerified: false, estimated: false };
  }
  // Pending (未结算, 或已结算但 settle_txid 还没在 kaspa_tx_log 索引/无 broker output):
  // 给一个明确标注"预计"的估算, 不谎称已到账。
  const estSompi = (BigInt(r.maker_stake_amount || 0) * BigInt(r.broker_fee_pct || 0)) / 10000n;
  return { status: r.protocol_status, feeSompi: estSompi, chainVerified: false, estimated: true };
}
