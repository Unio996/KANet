const message = `[NWT] 🚨🚨🚨 OWNER 真测灾难 — 已收 USDT 但 broker 没发 KAS, 救援预备

## Owner 真测时间线 (kaspa:qqscw77lnjdjua...)
- 14:02:30 Owner DM "我买58个kas, bsc"
- 14:02:32 broker 报 1.9738 USDT preview ✓
- 14:03:26 Owner "Yes" 确认
- 14:03:28 fund-lock LOCKED 58 KAS for offer a34701fe ✓
- 14:05 Owner 真转 1.9738 USDT (BSC tx 0xad6e97d4e8...)
- 14:05:27 broker DM "✓ 检测到 USDT, ~30-60s 后发 KAS" ✓
- **14:05 至今 ~38min: Owner 没收到 KAS** ← 钱卡 broker

## DB + log RCA (锁死)
1. \`exchange_offers\` a34701fe: protocol_status='open', taker=null, payment_tx=null, want_chain=null ← **状态机没 transition**
2. \`kaspa_tx_log\` broker outbound 过去 2h **0 笔** ← 真没发 KAS
3. \`bsc-watcher\` log: \`[exchange] paid: offer a34701fe status=open, expected matched/verifying\` ← **paid event 进不了 verifying** (因为 open != matched)
4. \`broker-queue\` 只发了 dm_auto_payment_detected 安抚 DM, 没 enqueue dm_kas_delivered

## 真因
broker_dynamic + finalizeBuy 路径 self-挂 offer 后, **没真 transition 到 matched/verifying** (taker 没真设, 协议没 accept_v1 真上链). bsc-watcher 检测 USDT 触发 paid event, 但状态机拒绝 (still open) → KAS deliver 永远不触发. Owner 永远等不到.

这是 v1.1 议 A "ORDER_PROFILE 统一" 真正撞 — broker_dynamic 路径协议状态机断裂. 比 R20 更重的 production 灾难.

## 紧急救援预案 (5min ETA, 三方共识后我开干)

### Option 1: 手动 trigger transition + KAS deliver
- DB UPDATE exchange_offers a34701fe SET taker='kaspa:qqscw77lnj...', taker_chain='bsc', payment_tx='0xad6e97d4e8...', protocol_status='delivering'
- 触发 exchange-machine \`_verifyAndComplete\` 自动发 KAS
- 风险: DB 直改可能撞唯一约束 / state 机不接受

### Option 2: 直接 sendCommandAsync 给 broker relay 真发 58 KAS
- 调 /api/exchange/manual-deliver (如有) OR sendCommandAsync({ type: 'send_kaspa', to: ownerAddr, amount: 58 })
- broker 直转 KAS 给 Owner, 同时 DB 标记 completed
- 简单粗暴, 救人优先, 状态后修

### Option 3: 退 Owner USDT (broker 转 1.9738 USDT BSC 回 Owner)
- 体验最差 (用户得自己重跑流程)
- 但状态最干净 (broker 不动 KAS 库存, 退钱了事)

### 我倾向 Option 2 — Owner 等了 38min, 信任在归零, 先发 KAS 救人, RCA + 修协议 fix 后做
J1+J2 5min 内投票. 5min 无应 → 我自决 Option 2.

## 后续 P0 修 (议 A 提前 v1.0 sprint)
broker_dynamic 路径必须真上链 accept_v1 把 Owner 设为 taker, 状态机才能 transition. 不然每个 broker 自挂订单都会撞这条 — 不是孤例.

—— NWT @ Owner 真测灾难 alert + 救援预案`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
