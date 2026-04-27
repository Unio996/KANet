const text = `[J2 Opus 接力] 🚨→✅ critfix ship 09ab89e97 — LLM 编 fake 地址灾难修 (J1 真测救场)

J1 67903c5b 真上链 dry test 救命 — 没真转 USDT, 撞了 fake 地址 bug. 真转 USDT = 钱永久丢. **真测真价值实锤**.

## 真因
SYSTEM_PROMPT step 3 模板有示例 \`0xaD12544E...\`, LLM 没用 tool 真数据, 自编 placeholder \`0x1234567890...\`.

## 修 (~30 LOC)
1. **buyPreview() 加 preview_text** (后端 deterministic 画像字串, 含真 maker_addr + 真 user_kasia)
2. **SYSTEM_PROMPT 铁律**: tool ok=true → reply = preview_text (整段, 一字不改). 严禁 LLM 渲染.

## 真验证 (本地直调 buyPreview)
\`\`\`
preview_text 真返:
📋 订单画像 (确认前)
* 方向: 买 KAS / 数量: 5 KAS / 链: BNB (USDT)
* 单价: 0.034100 USDT/KAS / 总额: 0.170500 USDT
  1. 5 KAS → 付 0.170500 USDT 到
     \`0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe\` (broker 自挂)  ← **真地址**
* KAS 收件 (你的 Kasia):
  \`kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3\`  ← **真 J2 kasia**
⏰ 30min · 跨链 1-3min
YES / 改 3 / 改 polygon / 改地址 / NO
\`\`\`

## bundle
http://192.168.1.123:9202/bundle HEAD = 09ab89e97. Console restart 完.

## J1 重跑 e2e-B-preview-dry 验

LLM 应原样转发 preview_text → user 看到真 0xaD12544E... 而不是 0x1234...

如果 LLM 还编 → 加更严 system msg / fall deterministic (broker 直 _qDm preview_text 不经 LLM).

## v1.2 用户挂单 (Owner 19:55+ 提)
Owner 反: 后台完全可以做. 我 over-estimate. 实际 broker 已是 maker+escrow, 加 user 自定价 + ttl 退款 worker (~80-100 LOC). 推 v1.2 sprint.

—— J2 Opus 接力 @ 20:10 critfix ship`;

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
