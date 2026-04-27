const message = `[NWT] Bug-Z6 修好 d44a29691 — Bug-W 跳过 SELL 关键词 (J1 6a1a2d306e 真测撞)

J1 真 trace: Eric '卖 5 KAS, BSC, 0x...' → broker 报 '买 USDC 1 USDC' (跨方向+跨资产 hallucinate)

## 我的 Bug-W 又一个 class 错 (跟 Bug-Z5 同 root)
SELL 关键词 '卖' 没匹 BUY regex → 我代码 fall back 到 history → 撞 Eric 之前 '买 1 USDC' BUY reply → 硬塞 direction='buy' + asset='USDC' (错!)

## 修法 (3 行)
当前消息含 SELL 关键词 (卖|sell|dump|...) → Bug-W 直接跳过, 让 broker-sell-handler 接管.
关键: history fallback 永远不该补 direction (SELL/BUY 必须 user 明确说). 历史只 fill qty/asset/chain.

## verify (live console 重启加载后)
scripts/_verify-bug-z6-fix.mjs 注入 stale BUY history + Eric SELL 探测:
- reply: 'LLM NLG 处理 SELL' (1.8s LLM)
- log: 没有 det-preview 条目 → Bug-W 真 skip ✓

## 沉淀 (Bug-Z5 + Bug-Z6 一起)
deterministic mitigation 的 history fallback 设计原则: 历史可以补 qty/asset/chain (这些是当前消息可能省略的), 但**永远不能补 direction** — SELL/BUY 必须用户在当前消息里明确说. Bug-W v1 假设 follow-up 都是 BUY (所以 fallback 时硬塞 buy), 这是错的.

我的 Bug-W path 现在 5 commits (v1 + Z5 + Z6 + 报价丰富 + sibling filter), 边修边露洞. 跟 Owner '正则不可取' 钦定方向越来越对齐 — 应该最终靠 J2 SYSTEM_PROMPT trim 让 Qwen 真正用 preview_order tool, 我这条 deterministic 路径作为 fallback 而不是主力.

## 真 turn 真 turn 真 stats (Owner 25:42 mandate cycle 累计)
- ✅ Bug-Z3 R19-EXT (J2)
- ✅ Bug-Z4 _detectIntent SELL/BUY 顺序 (NWT)
- ✅ broker-broker runaway (NWT)
- ✅ Bug-W det-preview v1 (NWT) → 露 Bug-Z5 + Bug-Z6
- ✅ Bug-Z5 current msg first (NWT)
- ✅ Bug-Z6 跳 SELL 关键词 (NWT, 本)
- ✅ J2 v1.2 SYSTEM_PROMPT trim
- ✅ 报价 4 段补强 (NWT)
- ✅ J2 USDC delivery accept_v1 evm_recv_address
- 🎉 J1 4 e2e PASS (3 KAS PASS + USDC half PASS, J2 manual rescue)
- ⏳ USDC auto-deliver e2e 真测真 verify (待 J1 重测)

bundle: D:/kanet-sync.bundle HEAD=d44a29691`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
