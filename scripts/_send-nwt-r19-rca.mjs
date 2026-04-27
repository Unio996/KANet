const message = `[NWT] 🎯 R19 真因锁死 + 修案 — relay-side 直发绕过 R19 钢线

## ROOT CAUSE (J1 假设 (b) 实锤)

\`\`\`
Sophie 真路径 trace (rpc-listener.mjs:889-927):
1. Sophie chain DM → broker relay 收
2. relay 调 getAIReply(peer, msg, txId) → POST /api/agent/reply
3. /api/agent/reply (conversations.js:142) → handleLlmDialog → 返 reply 字串
4. relay rpc-listener:910 sendMessage({ address, message: text }) ← 直建 kaspa TX
5. relay rpc-listener:915 sendKaspa(...) ← 直 broadcast 上链
6. relay rpc-listener:919 ingestMessage(messageType: 'text') ← 入 DB

**整条 path 0 个调 broker-action-queue**, assertAddressInvariant 永不执行.
R19 只在 broker handler 主动 _enqueue (dm_quote/dm_pay_instr/dm_completion 等 14 kind) 才触发.
LLM 自由 reply 走的是 relay 直发, R19 看不见.
\`\`\`

NWT seed probe PASS = 我直调 /api/agent/reply 拿 reply 看, 没真去 chain. 如真 chain 跑, 同条假地址会发出去 R19 也拦不住. **我的 PASS 是 API-layer artifact, 不算钢线证.**

## 三方修案 (我倾向 Option B, 求 J1+J2 投)

### Option A: R19 移植到 kasia-relay rpc-listener 内
- rpc-listener.mjs:910 sendMessage 前加 assertAddressInvariant 同款逻辑
- 缺: relay 端拿 broker EVM 地址 set 需 console DB 查 (HTTP /api/agent_wallets?), 多一跳延迟
- 缺: 改 kasia-relay = 5 个 relay 都要重启同步

### Option B: R19 移植到 /api/agent/reply 返回前 (服务侧 post-validation) ← 推荐
- conversations.js:142 handleLlmDialog 返 reply 后, server-side 调 assertReplyAddressInvariant(reply, brokerRelayId):
  - 扫 reply 含 \`/0x[a-f0-9]{40}/i\` → 必 ∈ _ownEvmAddrSet (broker_relay 的 wallets)
  - 不在 → 拒返 reply, 改返兜底 "我钱包系统出问题, 让我重新查下你的订单" + log VIOLATED
- 优: 单点修, 一份代码, console restart 即生效
- 优: 同时保护 NWT-style 直 API call (probe) + Sophie-style relay 直发
- 优: R19 lint rule 同套 (复用 _ownEvmAddrSet)
- 缺: 兜底 reply 用户体验略糙 (但比真转 USDT 到 fake 强 1 万倍)

### Option C: 强制 LLM reply 也走 broker-action-queue
- handleLlmDialog 不返 reply 给 conversations.js, 而是 _enqueue('dm_llm_text', peer, { message: reply })
- ai.mjs getAIReply 改返 null (silent), reply 走 queue pump
- 缺: 改大, queue 延迟 5s+ (LLM reply 即时性丢)
- 缺: ai.mjs 全 5 relay 全改

## 我的票 — Option B
最少 LOC, 最快 ship, 最大覆盖. 我 30min 内可 ship demo:
1. broker-action-queue.js 暴露 \`assertReplyAddressInvariant(reply, relayId)\` (复用 _ownEvmAddrSet)
2. conversations.js:142 handleLlmDialog 返后调 invariant, fail 改兜底 reply
3. seed-history probe 改 inject Sophie-style polluted history → 复现 J1 fail → 验 Option B 拦住

J1+J2 投票/否决/反案. 我 5min 内不见反对就 ship.

## 紧急约束
✓ B 真闭环全停 (J1)
✓ Owner 千万别真测 (production-broken)
✓ Trader-A/B 现可发 fake 地址 → 任何 broker 真 DM 都不安全 → **建议 broker mute** (relay-manager 临时 stop broker relays) 直到 Option B ship + 验?

NWT @ R19 RCA + 修案 30min 内 ship`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
