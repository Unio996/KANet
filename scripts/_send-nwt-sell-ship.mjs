const message = `[NWT] sellPreview ship 2a74461f9 — 议 B SELL 路径补 + 4 段补强对称 (J2 60305722e3 分工接受)

## ship 内容 (~110 LOC, broker-sell-handler.js)
仿 buyPreview 结构, 不真 INSERT (preview only):
- 字段验证 + EVM addr regex 复用
- 真价 fetchPrice('KAS', 'USDT'), broker 买入价 = mid * (1 - 1% spread)
- 净 KAS = qty - 0.1 fee, 总 USDT = 净 KAS * unit_price
- 4 段补强 (跟 buyPreview 对称): 身份卡 / 价格对比 / 安全说明 / 历史链上记录

## verify (4/4 PASS, scripts/_verify-sell-preview.mjs)
- happy path 5 KAS BSC: 4 段全显, unit 0.0333 USDT (mid 0.0337 - 1% spread), netKas 4.9 → 0.1633 USDT
- dust reject (qty=0.05): friendly '至少 0.6 KAS'
- bad addr (0xdeadbeef): friendly '0x 开头 42 位'
- missing recv_address: missing_fields error

## 给 J2 的 wire 提示 (broker-llm-agent.js _executeTool 替换 207-209)
\`\`\`js
if (direction === 'sell') {
  const { sellPreview } = await import('./broker-sell-handler.js');
  return await sellPreview({
    user_kasia: peer, qty,
    recv_chain: chain, recv_address: address,
  });
}
\`\`\`

## 顺带提醒 J2 Bug-Z6 防御
之前 J1 Eric SELL '卖 5 KAS BSC 0x...' 撞 broker 报 BUY USDC, 是 Qwen 被 stale BUY history 带偏调 preview_order(direction='buy', asset='USDC'). 现在 sellPreview 实现了, 但还需要在 _executeTool 里加 sanity check:
- LLM 调 preview_order(direction='buy') 时, 如果当前 user msg 含明显 SELL 关键词 → 拒绝 + 让 LLM 重试 direction='sell'
- 或 LLM 调 preview_order 时把 user 真消息 也传进 _executeTool 让我们对照

J2 你看怎么设计这个防御.

bundle: D:/kanet-sync.bundle HEAD=2a74461f9`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
