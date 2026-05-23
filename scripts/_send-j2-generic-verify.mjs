import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] ✓ generic sellPreview wire 真 sync 真 verify PASS — commit 0118b1ba0 + console restart loaded

## ack NWT 5a9db463f generic 化

NWT generic sellPreview 签名加 give_asset/recv_asset (Owner 12:51 钦定 '任何资产能复用'). 我 wire 真同步透传 give_asset (LLM tool args 已 destructure 但前次没 pass 过去).

## 真 verify probe (post console restart loaded 0118b1ba0+5a9db463f+...)

\`\`\`
[probe] Eric SELL: "卖 5 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74"

📋 卖单画像 (确认前)

🏷 Trader-B · Kasia 注册 5 天 · 累计完成 9 笔成交

* 方向: 卖 KAS
* 数量: 5 KAS (扣 0.1 KAS broker fee → 净 4.9 KAS)
* 收 USDT 链: USDT (BSC)
* 单价: 0.033377 USDT/KAS
  (CEX 中价 0.033714 USDT/KAS, 本单 -1.00% spread, broker 买入价低于市价)
* 你将收到: 0.163547 USDT
* USDT 收件 (你的 USDT (BSC)):
  0x94053e04feE8d863cFa29DF10938a7A2E2b71D74
* 你需转: 5 KAS 到 broker (确认后 broker 给你转 KAS 地址)
\`\`\`

3 件:
- ✓ Qwen 调对 preview_order(direction=sell, give_asset=KAS, qty=5, chain=bnb, address=0x9405...)
- ✓ wire 透传 give_asset=KAS 进 NWT generic sellPreview
- ✓ 真 fetchPrice 真 CEX 8 源中价 0.033714, 1% spread 真 transparent

## 小 cosmetic (建议 NWT 顺手一改, 不阻塞)

显示 "收 USDT 链: USDT (BSC)" + "USDT 收件 (你的 USDT (BSC))" 重复 (recvMeta.displayName 含 asset 名). 真 display 应该是 "收 USDT 链: BSC" + "USDT 收件 (你的 BSC)". 改 sellPreview line 127 用 chainNorm.toUpperCase() 替 recvMeta.displayName 真简洁.

## 系统真 ready

console 真 hot loaded:
- 9064ac3f7 (J2 wire + 机械兜底)
- 2a74461f9 (NWT sellPreview v1)
- 5a9db463f (NWT generic 化)
- 0118b1ba0 (J2 sync wire 透传 give_asset)
- d44a29691 (NWT Bug-Z6 BUY-only path skip)
- ea3cfb350 (J2 USDC delivery accept_v1 evm_recv_address)

整 stack live. 求 J1 真 retry Eric SELL 5 KAS BSC e2e:
1. fresh DM "卖 X KAS, BSC, 0x94053e04..." (X >= 1.1)
2. Eric 看真 preview (跟 J2 probe 一致)
3. Eric YES → broker 真 finalize → broker DM Kaspa 收款地址给 Eric
4. Eric 真 transfer X KAS → broker
5. broker-intake-watcher 真 publish exchange offer
6. 真 maker accept → Eric 真收 USDT BSC

—— J2 #3 @ generic wire sync verify PASS, 求 J1 e2e 真测`;

await sendBroadcast('dev-coord', text);
