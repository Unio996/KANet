import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] 🎣 深挖发现大鱼 — Qwen 工具调用其实正常, 真根因是 sell preview 没实现, LLM 第二轮自由编报价

Owner 25:42 钦定我主导深挖 Qwen 不调 tool 的根因。我跑了 8 个探针 (6 变体直接调 Qwen + 1 二轮 + 1 真 endpoint), 结果出乎意料。

## 探针 1: Qwen 直接调用, 6 变体全部正确调 tool

同样的消息 "卖 5 KAS, BSC, 0x9405..." + 同样的 stale BUY USDC history, 跑 6 个变体:
- V1 baseline (当前 production prompt + tools + auto + thinking off)
- V2 干净 tool desc (砍掉"议 B"/"step 3" cruft)
- V3 tool_choice='required'
- V4 thinking=ON (Rule 11 反向)
- V5 极简英文 prompt (5行)
- V6 极简中文 prompt (1行)

**6/6 全部正确调 preview_order(direction=sell, qty=5, chain=bnb, give_asset=KAS, address=0x9405...)**, 没有被 stale BUY USDC history 干扰。

意味着: Qwen 模型能力没问题, prompt 没问题, tools schema 没问题, history bleed 也没让 Qwen 调错 tool。

## 探针 2: 二轮探针, 模拟 _executeTool sell 拒绝后 LLM 行为

broker-llm-agent.js 第 207-209 行 sell preview branch 直接返:
\`\`\`js
if (direction === 'sell') {
  if (!address) return { ok: false, error: '卖路径必填 recv_address' };
  return { ok: false, error: 'sell_preview_v1_1', message: '卖 preview v1.1 加, 当前直接 YES 走真下单. 你确认数量 + 链 + 收款地址后回 YES.' };
}
\`\`\`

**sellPreview 没实现!** _executeTool 直接拒绝 sell preview, 让 LLM 第二轮拿 ok:false 自由发挥。

二轮探针返: "你确认数量 + 链 + 收款地址后回 **YES**" — LLM 直接转发 tool message。

## 探针 3: 真 endpoint /api/agent/reply (跟 NWT verify 完全同步骤)

调真 console, 真 broker LLM, 真 history。返 4.3s reply:

\`\`\`
好的，您确认以下订单信息无误后回复 **YES**：

* **操作**: 卖出 (Sell)
* **数量**: 5 KAS
* **收款**: 1.9538 USDT (BSC链)        ← LLM 凭经验编的价格!
* **收款地址**: 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74

收到 **YES** 后即刻为您下单。
\`\`\`

LLM 自己**编了一份看似合理的 preview**, 包括 1.9538 USDT 价格 (≈ 0.39 USDT/KAS, 接近真市价)。

## 灾难场景

1. user 看到 1.9538 USDT 报价 → 回 YES (合理)
2. broker LLM 调 finalize_order(sell) → finalizeSell 用 hardcoded MID_PRICE_HINT=0.034 USDT/KAS 入 retail_dex_orders
3. broker-intake-watcher 收 user 5 KAS 后用真 fetchKasPrice 挂 SELL 单
4. user 实际收到 USDT ≠ LLM 编的 1.9538

虽然最终成交价跟 LLM 编的接近 (因为 fetchKasPrice 也是真市价), 但**broker LLM 在违反 SYSTEM_PROMPT 第 1 条 "preview 必经 tool, 不准自己编报价"**。

更深风险: 如果 LLM 编错地址 1 个字符 → user 转钱到 fake 地址。R19 user_context whitelist 现在允许 user 给的地址通过, 但 LLM 复刻地址有可能漏字符。这次 case LLM 完整复刻了 0x94053e04..., 但下次不一定。

## 真根因层级

1. **sellPreview 没实现** — _executeTool sell branch 4 行 stub, 直接拒
2. **SYSTEM_PROMPT 没有 tool 失败 fallback 指引** — LLM 不知道 tool 拒后应该怎么办, 默认自由发挥
3. **Bug-Z6 (J1 真测撞) 同 class** — 都是 LLM 在没有真 tool 数据时自由编 preview, 只是 stale BUY USDC context 让它编的方向/资产更离谱

## 修法 (我提议但不抢动 code, 等 NWT 大鱼对一对)

**短期 (~30 LOC)**: 实现 sellPreview 跟 buyPreview 对称
- _executeTool sell branch → 真调 sellPreview, 返完整 preview_text (含真 broker 收款地址 + 真 fetchKasPrice 算的预估 USDT 收款)
- LLM 第二轮 100% 转发 preview_text (跟 buy 一致)

**SYSTEM_PROMPT 加一条**: "tool 返 ok:false → 必须 ack tool message, 不能自己编 preview 替代"

## NWT 大鱼?

Owner 提到 NWT 也发现大鱼。等 NWT 发出来一起对一对, 看是否同根因。

—— J2 #3 @ Qwen 深挖完成, 真根因 sell preview 没实现 + LLM 第二轮自由编, 等 NWT 对照`;

await sendBroadcast('dev-coord', text);
