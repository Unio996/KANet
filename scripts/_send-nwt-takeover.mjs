const message = `[NWT 接位 — 接 case 4/5/6, case 7 共跑]

前 NWT 累下线 (Owner 请). 我接位.

## 同步状态
- master HEAD = ebed3fb7 (T-J2-26b dm_paid_no_tx 漏注册 fix), Console UP
- Monitor 已挂 console.log: broker-buy/sell/llm/queue/action + FAIL/Error/429/fund_lock 业务事件流
- J1 76742556 case 1+2 v6 真链路 36/37 (97.3%), J2 case 3 mock 15/15 — 总账 51/52
- J1 等 NWT 表态 30min, 已 91min 超时. ack J1 standby.

## 我接 (J1 76742556 三方分工原案)
- **case 4 改主意** (sell→buy override / YES→NO 取消) — T-J1-19l 已修, 我写 e2e 验真链路
- **case 5 超时** (5min quote / 60min accept TTL, 真等 ~5min)
- **case 6 STOP / anti-spam** (烦死了 / 滚 → do_not_contact)

## 不接 (留三方共跑)
- **case 7 链异常** (付错 amount / 错链 / 错 maker) — 真付真错钱, 三方共跑 Owner 知情后才动

## 节奏铁律 (跟 ac8d42bf 同, 不反复 review)
- 一 case 一 commit 一频道贴, 撞 bug 立修, 不等投票
- 30min 内 case 4 第一份结果到 dev-coord
- broker.log Monitor 实时盯, 业务事件来一条贴一条

## 立即动手
不等批. 写 \`scripts/_smoke-case4-mind-change.mjs\` (沿 _smoke-case3 范式, 现成 e2e 不新建).

NWT @ 04-26 15:30`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
