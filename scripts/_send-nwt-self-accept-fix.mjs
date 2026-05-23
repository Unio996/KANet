const message = `[NWT 自治裁决 — self-accept 真因修 + ANTI-PATTERNS R13]

Owner "A. 自主裁决" 不等. 立刻调查 + 修.

## 真因 (Owner 已确认 'trade-B')
hy65lxur9c5l = **Trader-B (broker 自己)**.
broker_dynamic_quote 路径必撞:
1. broker 自挂 SELL offer (maker = broker)
2. broker 代 user 发 accept_v1 (msg._from = broker, payload.receive_address = user)
3. exchange-machine processAccept 检 msg._from === offer.maker → 撞 self-accept reject
4. user 拼单不够 broker 自挂补 deficit 必撞 — 不是偶发是结构性

## 修 (commit a9e1eee7, 5 LOC)
exchange-machine.js processAccept:
\`\`\`js
const taker = msg.receive_address || msg._from;
if (taker && taker === offer.maker) reject;
\`\`\`
- 普通 user 自 accept (无 receive_address): _from = user = maker → 仍 reject ✓
- broker 代 accept (有 receive_address): taker = user, _from = broker, maker = broker → user !== broker → 通过 ✓

不动 broker-buy-handler payload (已 carry receive_address line 187).

## ANTI-PATTERNS 加 R13
"协议消息 self-accept 检不能只靠 _from (broker 代发场景)"
- 适用 accept_v1 / paid_v1 / delivered_v1 等所有 broker 代发协议
- 校验必区分 "信使 (sender)" vs "实际方 (在 payload)"
- broker 代发场景全炸 = 协议设计盲区

## Restart #5 完
- master HEAD = a9e1eee7
- bsc-watcher started, tick=30s ✓
- self-accept fix 生效, broker_dynamic_quote 路径解锁

## 累积 NWT 接位 9 commit (15:25 → 18:00, 2.5h)
1. dcf0b6a7 case 4 改主意 smoke
2. e74de22b PAID_NO_TX 扩 6 变体
3. 1c6ff775 T-NWT-V2 bsc-incoming-watcher
4. 672c2cd0 议 1 订单确认 DM 拆
5. ec2452b9 hotfix LLM 120s + history 8 + PRICE_QUERY
6. c300e6e0 Rule 11 kill switch (broker LLM 60s+ → 1-3s)
7. 96d04a4c ANTI-PATTERNS R9-R12 + lint-kanet + pre-commit hook
8. a9e1eee7 self-accept fix
+ J2: ee49a029 lazy verify_payment + 0badfe8a 议 2 KAS deliver DM
+ J1: e810ecf9 议 3 SYSTEM_PROMPT 服务态度

## 真链路验证 (Sophie e2e + Owner 真测)
- ✓ broker LLM 1-3s 响应
- ✓ 议 1 dm_order_confirmed FIFO 顺序 (连续 2+ 次 100%)
- ✓ bsc-watcher 真 BSC 0.1726 USDT 自动检测 + paid_v1 + dm_auto_payment_detected (peer qqjdpjp0ts...)
- ✓ self-accept reject 已解 (新 commit 后)
- ⏳ exchange-machine 验证 → sendKas → dm_kas_delivered (J2 议 2 验证最后一段)

NWT 自治模式持续. Monitor 干净 (排 NWT-brain 429 噪音).

NWT @ 04-26 18:00`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
