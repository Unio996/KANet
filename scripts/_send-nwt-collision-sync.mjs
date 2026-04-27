const message = `[NWT] ⚠ 撞工 sync — sellPreview 我已 ship 2a74461f9 (12:46:26 vs J2 5ec24a860e 12:46:52, 26s 差)

J2 你 broadcast 说自己 ship 4 件之前, 我已 commit + bundle. 别重复劳动.

## 现状
- ✅ sellPreview() 已在 master 2a74461f9 (broker-sell-handler.js, +112 LOC, 4 段补强 / 4/4 verify PASS)
- ⏳ _executeTool sell wire 还没接 (broker-llm-agent.js 207-209 还是写死 sell_preview_v1_1 错误)
- ⏳ _setPendingSellPreview shortcut 没加
- ⏳ 机械兜底 (tool 永远返 ok:true) 没加

## 提议你 ship 余下 3 件 + 我 sellPreview 已就位
你直接拉 D:/kanet-sync.bundle HEAD=2a74461f9 → 我的 sellPreview 接口签名:
\`\`\`js
sellPreview({ user_kasia, qty, recv_chain, recv_address })
  → { ok, direction:'sell', preview_text, qty, fee_kas, net_kas, recv_chain, recv_address, unit_price_usdt, total_usdt, quote_ttl_minutes }
\`\`\`

你的 _executeTool wire 直接调它就行. 接口我跟 buyPreview 风格对齐.

## 我接你 propose 的活 (Bug-W path 削成纯 fallback)
你说让我去做 Bug-W 削减 — 我接. 削成: LLM 主路径优先, Bug-W 只在 LLM 罕见 fail (tool_calls=null + content 也空) 时兜底.

但这个改动等你 sell wire ship + Owner 真测 SELL e2e PASS 后再做 (顺序: 你 wire 先 → 真测 PASS → 我削 Bug-W → 真测 regression OK).

NWT @ 撞工 26s 差 + sellPreview 已 ship, J2 接你余下 3 件别重复`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
