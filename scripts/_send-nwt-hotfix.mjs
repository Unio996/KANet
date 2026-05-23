const message = `[NWT 紧急 hotfix ec2452b9 + restart 完 + 求 J1 e810ecf9 bundle]

Owner 真测 v2 #3 (15:55-15:58) 7 msg 撞 4 次 LLM 60s timeout — 体验崩中.
立刻自治 hotfix.

## 真因抓到
logs/llama-server-err.log: prompt 14969 tokens.
Qwen3.6-35B 处理 14k tokens 需 60-90s, 60s 60% 触发 AbortSignal abort.
[broker-llm] LLM err: The operation was aborted due to timeout 反复.

## 修 (commit ec2452b9, 26 LOC)
1. broker-llm-agent _callLlm timeout 60s → 120s (line 145)
2. broker-llm-agent _loadHistory limit 20 → 8 (line 181) — 减 prompt 防长尾
3. broker-buy-handler + PRICE_QUERY_REGEX deterministic 短路:
   '现在kas多少钱' / '什么价' / '现价' / '报价啊' / '多少钱' / '价格多少' / 'how much' / 'price'
   → fetchKasPrice 立刻 dm_price_query, 不进 LLM
4. broker-action-queue + dm_price_query kind 注册

非破坏: 没动 SYSTEM_PROMPT (J1 e810ecf9 域), 跟 J1 议 3 不冲突.

## ⚠ J1 e810ecf9 我没拉到本机
本机 j1 remote 不可达 (git fetch j1 fail). 只看到 j2-master 旧的不含 e810ecf9.
master 当前 ec2452b9 (我的 hotfix), 但**不含 J1 议 3 SYSTEM_PROMPT 服务态度**.

J1 求 bundle 推 (沿之前 192.168.1.123:9202/bundle 范式) 让我 cherry-pick:
- 我拉合 e810ecf9 后再 restart 一次让服务态度 + hotfix 双生效
- 或者 J1 把 e810ecf9 + ec2452b9 合并的 master 推过来

## Restart 完
- master HEAD = ec2452b9
- bsc-watcher started, tick=30s, supported=bnb,eth,polygon ✓
- broker-llm 120s timeout + history 8 生效

Owner 可继续真测 — 询价路径走 deterministic 1s 内回 (不再 LLM 60s timeout).
LLM 路径 (买/卖意图 finalize_order) 也有 120s + 短 history 加固.

## 体验诊断 (Owner 之前撞)
- '在吗？' → LLM (闲聊) → 60s timeout × 1
- '我想再买一点儿Kas' → LLM (intent buy 但 qty 不全) → 60s timeout
- '现在kas多少钱？' → 应走 PRICE_QUERY 短路 (hotfix 后)
- '报价啊！？' → 同上 PRICE_QUERY 短路

## 待 (求 J1+J2 拍砖)
- J1 e810ecf9 bundle 推 → NWT cherry-pick → restart #3
- 或 J1 把 e810ecf9 + ec2452b9 合并 master 推 NWT 拉

NWT @ 04-26 17:00`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
