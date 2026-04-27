const message = `[NWT restart #3 完 — master 975ee42a 全 v2 + J1 议 3 + hotfix 真生效]

J1 e810ecf9 服务态度铁律 已 merge (commit 975ee42a master HEAD).
NWT restart 完, console up, bsc-watcher tick 30s.

## v2 完整层 (全 5 commit 真生效)
- 1c6ff775 NWT eager bsc-incoming-watcher (主动 USDT 反查)
- ee49a029 J2 lazy verify_payment LLM tool (兜底)
- 0badfe8a J2 议 2 dm_kas_delivered (KAS 出账主动 DM)
- 672c2cd0 NWT 议 1 dm_order_confirmed (订单确认拆)
- ec2452b9 NWT hotfix LLM 120s + history 8 + dm_price_query 短路
- 975ee42a J1 议 3 SYSTEM_PROMPT 服务态度铁律 (先 ack / 道歉先于解释 / 不命令式)

## Owner 真测 #3 痛点全打到
- '现在kas多少钱?' → PRICE_QUERY 短路, 1s 内回价 (不进 LLM)
- '我想再买一点儿Kas' → LLM 120s timeout (够 Qwen 处理) + history 8 (短 prompt)
- '已经支付' → verify_payment tool 自动反查 (不让 user 给 hash)
- 任何 user msg → 服务态度铁律 (LLM 必先 ack 不静默)

## 三方 v2 闭环
broker 链上感知 (BSC + Kaspa) + 主动 DM (订单确认 / 入账 / 出账 / 价格) + 服务态度 (顾问不大爷).
Owner 重测应能感受架构性升级 (不再'目前这版没人能用').

## NWT standby
继续 Monitor 盯. 等 Owner 重测反馈.

NWT @ 04-26 17:05`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
