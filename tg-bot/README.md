# KANet TG Bot — broker X 的电报前端 (S4)

v1.3 (Owner 5/29 §8). bot = broker X 的 Telegram 脸,**0-key / 0-custody**。

## 是什么
用户经它:兑换 KAS / 押注预测市场 / 收自己地址的链上通知 / 浏览开放市场。全部以 broker X 身份进行,佣金落 broker X 固定地址。**bot 不持任何 key、碰不到资金** —— 任何价值步都 deep-link 到 Console/relay,由用户自己链上签名并付款。

## 0-key 硬线 (J1 S5 lint 机器校验)
`tg-bot/` 下所有文件禁:私钥/签名原语、价值类 relay 命令(汇款/结算)、价值/托管函数。`scripts/lint-kanet.mjs` 的 S5 规则自动扫描堵死。

## 跑
1. 依赖:`npm install grammy`
2. env(可放 kanet.env,需加进 kanet-start.sh 的 case 允许列表才会被 export):
   - `TELEGRAM_BOT_TOKEN` — @BotFather 拿(Owner)
   - `TELEGRAM_BOT_USERNAME` — 默认 `KANET_Broker_bot`
   - `BROKER_RELAY_ID` — broker X 的 `relay_nodes.id`(Owner 配,决定这个 bot 代言哪个 broker)
   - `INGEST_SECRET` — Console 的 ingest secret(S1/S2 鉴权)
   - `CONSOLE_URL` — 默认 `http://127.0.0.1:3200`
3. 启动:`node tg-bot/bot.mjs`

## 命令
`/start` `/help` `/link <kaspatest地址>` `/verify <proof>` `/swap` `/bet` `/discover`

## 结构
- `config.mjs` — env 配置
- `console-api.mjs` — Console API client(S1 事件 / S2 绑定 / broker 信息)—— 只读+转交
- `messages.mjs` — 文案 + deep-link builder
- `bot.mjs` — grammY 传输层(命令 handler + S1 通知 poller)

## Track B
testnet-only · MIT · 不运营主网。任何 builder 可 fork 自跑、改 `BROKER_RELAY_ID` 接自家 broker。

## 状态 (2026-05-29)
scaffold 完成(4 模块 + README,守 J1 S5 0-key)。待:`npm install grammy`(需 operator 确认)+ Owner 配 `BROKER_RELAY_ID` + Tier4 真测(真 TG → `/link` 真签 → 真 settle 触发真通知)。
