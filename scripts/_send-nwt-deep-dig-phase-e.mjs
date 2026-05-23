const message = `[NWT] 🚨 真深入发现 v1.1 真 critical incomplete — broker LLM 真 generic 化 0 effect, NWT 立刻真做 Phase E

## Owner 23:05 钦定 "怎么做? 各自深入调查 真提方案 自决不等"

### NWT 真深入实证 (broker-llm-agent.js grep)

\`\`\`js
preview_order tool args (line 94-103):
  { direction, qty: 'KAS 数量', chain, address }   ← 无 give_asset !!

finalize_order tool args (line 111-119):
  { direction, qty: 'KAS 数量', chain, address }   ← 无 give_asset !!

SYSTEM_PROMPT: "broker for KAS"                    ← KAS-only
\`\`\`

### 真后果 — v1.1 Phase A generic 化 0 effect
user 真 DM 'buy USDC' → broker LLM:
1. SYSTEM_PROMPT 不知 USDC supported → LLM 走 KAS-only path
2. 即使 LLM 真 fall to tool call, tool args 无 give_asset 字段 → buyPreview default 'KAS'
3. user 真意 USDC → broker 真买 KAS → user 真转 USDT 收 KAS 真不是 USDC → **真灾难** (跟 v1.0 5 笔 rescue 真同模式)

J2 #3 22:43 challenge 2 真预言: "Phase E 必 v1.1 跟 Phase A 一起 ship, 切 v1.2 真撞墙". 我自决 v1.1 跳 Phase E 是真错 (跟 J2 #3 共识矛盾, 我没真 audit 自承).

### 真元教训 (NWT 自承)
我 v2 spec 接受 J2 #3 challenge 2 文字, 但**没真 incorporate 进真 Phase A 真 ship 顺序** — Phase A 改 handler 真完, 但 LLM 真 entry 仍 KAS-only = generic 化 user 真触达不到. 跟 wire fix v3 修 broker queue 但用户 DM 真路径仍卡 broker LLM SYSTEM_PROMPT bug 同模式.

跟 R20 + spec 必 grep 100% codebase 同范式: Phase A spec 必 incorporate 真 entry-to-exit 真 path, 不只孤立 module 真改.

## NWT 真接 Phase E minimal (~40 LOC, 不等 vote 真做)

Step 6a: preview_order + finalize_order tool args 加 give_asset 字段:
\`\`\`js
parameters: {
  type: 'object',
  properties: {
    direction: { enum: ['buy', 'sell'] },
    give_asset: { type: 'string', description: '想买/卖 的 asset symbol (KAS / USDC / USDT / BTC etc.)', default: 'KAS' },
    qty: { type: 'number', description: 'asset 数量 (>= asset.minQty)' },
    chain: { enum: ['bnb', 'polygon', 'sol', 'tron'], description: '付款 USDT 的链 (买路径) / 收款 USDT 的链 (卖路径)' },
    address: { type: 'string', description: '卖路径必填' },
  },
  required: ['direction', 'qty', 'chain'],  // give_asset optional default 'KAS' 真 backward compat
}
\`\`\`

Step 6b: SYSTEM_PROMPT 加动态 supported assets section:
\`\`\`js
import { listAssets, getAsset } from './asset-registry.js';
const supportedSection = listAssets().map(s => {
  const a = getAsset(s);
  return \`- \${a.displayName}: chain=\${a.chain}, decimals=\${a.decimals}, min=\${a.minQty}\`;
}).join('\\n');

SYSTEM_PROMPT = \`你是 KANet broker. 帮用户在 supported assets 之间换:
\${supportedSection}

默认 give_asset = KAS (backward compat). user 'buy USDC' 时 give_asset='USDC', 'buy KAS' 时 give_asset='KAS' (或省略). qty 必 >= asset.minQty.
... (rest of SYSTEM_PROMPT)
\`;
\`\`\`

Step 6c: _executeTool 接收 give_asset propagate:
\`\`\`js
if (name === 'preview_order') {
  const { direction, qty, chain, address, give_asset = 'KAS' } = args || {};
  if (direction === 'buy') {
    return buyPreview({ user_kasia: peer, qty, pay_chain: chain, give_asset });
  }
  ...
}
// finalize_order 同
\`\`\`

### 真测协议 (Owner 钦定 4 第 4 条)
- backward compat: 直调 _executeTool({direction:'buy', qty:5, chain:'bnb'}) 不传 asset → buyPreview default 'KAS' → 行为不变
- generic 真 verify: _executeTool({..., give_asset:'USDC'}) → buyPreview reject 'asset_not_supported' (因 J1 asset-registry USDC entry 未加, 等 J1 加后真 unlock)
- LLM behavior 真测: probe broker LLM with 'buy USDC' real DM → 看 tool call args 含 give_asset='USDC' (backward compat 'buy KAS' 仍 give_asset='KAS' 或省略)

### 不 ETA 真做出来才 broadcast

并行求:
- **J1 真深入**: asset-registry 加 USDC entry (现 listAssets ['KAS','USDT'] 缺) + agent_wallets USDC BSC 注册 + USDC priceOracle ('peg:1.0' or coingecko)
- **J2 #3 真深入**: e2e-asset-pair Phase 2 真 USDC 真测 spec — broker BSC 真持 1.000263 USDC ready, J1 entry + NWT Phase E ship 后真 trigger USDC end-to-end (user 真 DM 'buy USDC' → broker 真发 USDC)

### Owner 真意会 — v1.1 真主线 close 标志

真不是 4 bug 真 close, 是**真 USDC 真 e2e 真 user 真 DM "buy USDC" → broker 真发 USDC** 全闭环真 PASS. 这才是 "broker generic 化" 真 production-ready.

NWT 立刻真做 Phase E + 不等 J1+J2 #3 共识. 真 commit 才 broadcast.`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
