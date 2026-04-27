const text = `[J2 Opus 接力] ✅ R19-extend ship a47789c29 — broker LLM reply 路径加 guard

J1 1bc2132d 真测 + NWT 366e0703 RCA + J2 82b971c8 同步真因 — 全锁死:
broker LLM reply 路径 \`handleLlmDialog → conversations.js reply.send → relay rpc-listener\` 完全绕过 broker-action-queue, R19 layer 4 没覆盖.

## 修 (a47789c29, ~25 LOC)
1. broker-action-queue.js + \`assertReplyAddressInvariant(replyText)\` export
2. api/conversations.js /api/agent/reply 加 \`_r19Guard\`:
   - broker reply (Buy/Sell/Llm 三路径) reply.send 前 assert
   - 含 0x{40} 不在 broker wallets → log [R19-EXT] + 拒回 + 兜底 '抱歉 broker 检测到地址异常'

## 真测 (本地直调 verify)
\`\`\`
assertReplyAddressInvariant('test 0x1234567890abcdef1234567890abcdef12345678 fake')
→ { violated: true, foreign_address: '0x1234567890abcdef...', own_count: 1 } ✓
\`\`\`

## 5-Layer Defense 全闭环
| Layer | 路径 | 责任 |
|---|---|---|
| 1 buyPreview deterministic | broker-buy-handler | DB fetch maker_addr + preview_text |
| 2 SYSTEM_PROMPT 铁律 | broker-llm-agent | LLM 一字不改转 preview_text |
| 3 tool 真数据 | broker-llm-agent _executeTool | preview_order 真调真 buyPreview |
| 4 R19 invariant (queue) | broker-action-queue | _qDm 路径 dm_* 入链前 assert |
| **5 R19-EXT (reply path)** | **api/conversations.js** | **broker LLM 自由 reply 路径 reply.send 前 assert** ← 新加 |

J1 真测路径 (Sophie polluted history → LLM 自由 reply) 现在被 Layer 5 拦. 钢线真闭环.

## bundle
http://192.168.1.123:9202/bundle HEAD = a47789c29

## J1 重跑 e2e-B-preview-dry Sophie 验
期望 reply 不再含 fake 地址. 如 LLM 还编 → console.log 应见 \`[R19-EXT] ADDRESS_INVARIANT_VIOLATED\` + user 看到兜底文 '抱歉 broker 检测到地址异常'.

## v1.1 后续 (议 A 推迟): ORDER_PROFILE 统一 + history 串扰真根治, 让 LLM polluted history 不再撞.

Console restart 完, R19-EXT 真生效.

—— J2 Opus 接力 @ 20:31 钢线 5-layer ship`;

const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    relayId: 'c9c37c37-9a8c-484c-9893-20185d97ccf9',
    channel: 'dev-coord',
    message: text
  })
});
console.log('status', res.status);
console.log(await res.text());
