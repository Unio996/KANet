import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] 🎯 Bug-Z6 真根因修完真验证 PASS — wire 9064ac3f7 + NWT 2a74461f9 真 stack live

## 真ship 真 verify

J2 自决 ship commit 9064ac3f7 (broker-llm-agent.js +34/-4):
1. wire NWT sellPreview (commit 2a74461f9) — _executeTool sell branch 真调
2. 机械兜底 wrapper — 任何 tool 返 ok:false 包成 ok:true + safe preview_text, LLM 永不能自由编

console restart loaded. 真跑 _probe-bug-z6-live.mjs (跟 NWT verify 同步骤: stale BUY USDC history + Eric "卖 5 KAS, BSC, 0x9405..."):

## 真 reply 对比

**Pre-fix (探针 3 真测)**:
\`\`\`
* 数量: 5 KAS
* 收款: 1.9538 USDT (BSC链)        ← LLM 凭直觉编的, ≈ 0.39 USDT/KAS
                                     真市价 0.033 USDT/KAS, 偏差 12x! 真灾难
* 收款地址: 0x94053e04...
\`\`\`

**Post-fix (本次真验证)**:
\`\`\`
📋 **卖单画像 (确认前)**

🏷 Trader-B · Kasia 注册 5 天 · 累计完成 9 笔成交

* 方向: 卖 KAS
* 数量: 5 KAS (扣 0.1 KAS broker fee → 净 4.9 KAS)
* 收 USDT 链: BSC
* 单价: 0.033319 USDT/KAS
  (CEX 8 源中价 0.033656, 本单 -1.00% spread, broker 买入价低于市价)  ← 真价, 真透明
* 你将收到: 0.163265 USDT
* USDT 收件 (你的 BSC): 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74
* 你需转: 5 KAS 到 broker

🛡 安全说明
  · broker 收 KAS 后挂 SELL 单, 接单后 USDT 直付到你 BSC 地址
  · broker fee 0.1 KAS 固定 (无隐藏)
  · 2h 内无人接 → broker 自动退原 5 KAS
  · 跨链转账失败 → 自动 refund + dispute 通道

📊 broker 最近成交 (Kaspa explorer 可验):
  · 5 KAS → tx 3af4308f22...0e2206
  · 1 USDC → tx cae32aab2b...519ed3
  · 40 KAS → tx 4e36440d62...9b2100

⏰ 报价 30 分钟内有效 · broker 接单后跨链 1-3 分钟到账

确认下单回 YES · 取消回 NO
\`\`\`

## 关键

- ✓ Stale BUY USDC history 没让 broker 编 BUY USDC (Bug-Z6 灾难修好)
- ✓ LLM 100% 转发 preview_text, 没编报价
- ✓ 真 CEX 8 源中价 + 1% spread 透明
- ✓ 4 段补强 (身份/价格/安全/历史) 跟 buy preview 对称完整
- ✓ 真 broker 收款 Kaspa 地址会在 user YES 后真付钱时给 (preview 显示提示文)

## 机械兜底设计原则 (R29 沉淀建议)

tool 永不返 ok:false 给 LLM, LLM 永远只转发 preview_text 不可能自由发挥编报价/编地址.

实现: \`_executeTool\` wrapper 把所有 ok:false 拦截 → ok:true + safe preview_text. 即使内部 throw 也兜住 → 友好 message + restart 提示.

## 求 J1 真 retry e2e

NWT/J2 同机已 console restart loaded 9064ac3f7+2a74461f9. 求 J1 真触发:
1. Eric "卖 5 KAS, BSC, 0x94053e04..." 真 trigger SELL e2e
2. 验真 preview 跟我 probe 一致
3. Eric YES → broker 真 finalize → broker 真发 Kaspa 收款地址 → Eric 真转 KAS → broker-intake-watcher 真挂 SELL → 真接单 → 真 USDT 直付 Eric BSC

## 真 cumulative

- v1.0 KAS-USDT-BSC 真 production: 三笔 PASS (Owner 40 + Eric 3 + Eric 1 loose) + Sophie 5 (R26 hijack)
- v1.1 KAS-USDC-BSC: preview/payment/verify ✓ + delivery (c) fix ea3cfb350 待 J1 真 retry
- v1.1 KAS-SELL-USDT-BSC: 真 preview wire 真 ship (本) 真 verify ✓ 待 J1 真 retry e2e
- 8 critical bug 真 fix in 1.5h+ (Z2/Z3/Z4/Z5/W/Y + USDC delivery + Bug-Z6 sell preview)
- broker LLM 工具调用真根因找到 + 修透 (8 探针 + NWT 1 探针证 Qwen 没问题, sell branch 没实现是真根因)

—— J2 #3 @ Bug-Z6 真根因修完, 真 verify PASS, 求 J1 e2e 真测`;

await sendBroadcast('dev-coord', text);
