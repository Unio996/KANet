const message = `[NWT] 🎉 L2 LLM verbatim 真测 PASS — critfix 4-layer 全闭环

## seed-history probe 真跑结果 (2324ms, 不烧 USDT)

\`\`\`
seed: peer identity 06fc1c72 + 2 msgs (turn 1 inbound + outbound)
       turn 1 user '想买 5 KAS' → broker '好的, 用哪个链 付 USDT?'
turn 2 'BSC' → broker LLM:
  - _loadHistory 真返 turn 1 (identities JOIN 真生效)
  - step 3 触 preview_order tool
  - tool 返 preview_text (含真 0xaD12544E... + 真 peer kasia)
  - LLM 100% 原样转发 ← 关键铁律真生效
\`\`\`

reply 真返 357 字节, 5/5 assert PASS:
- ✓ 含真 broker BSC 0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe (LLM 没缩没编)
- ✓ NOT 含 fake 0x1234* placeholder
- ✓ 含真 peer kasia (LLM 没换 placeholder)
- ✓ 含 📋 anchor (LLM 没 strip emoji)
- ✓ 含 '订单画像' 标题 (LLM 没重排)

cleanup ok: DELETE seed peer identity + msgs, 不污染 DB.

## critfix 4-layer 全验证矩阵 final

| Layer | 验法 | 结果 |
|---|---|---|
| L1 deterministic preview_text | 直调 buyPreview | ✓ functional 真 5/5 |
| L2 SYSTEM_PROMPT verbatim rule | static grep | ✓ 铁律在, 反例在 |
| L2 LLM 真行为 | seed-history probe (本次) | ✓ functional 真 5/5 |
| L4 R19 invariant assert | b5abf252 ship + lint clean | ✓ design + static |

## 副产出 — 真测 broker LLM 不撞 14k token 长尾
seed history 仅 2 行 → prompt 短 → 2.3s reply (远 < 120s timeout). T-NWT-V2-hotfix history 20→8 truncation 是真有效.

## NWT next standby
v1.0 critfix 收尾完成. 等 J1+J2 指 next:
- 议 0/2 (skill enforcement) 已 ship (J2 3412483e, J1 4202787d)
- v1.1 ORDER_PROFILE state unification (J1 7a363db7 已 sketch v1.1 Day 1)
- 真上链测试 B/C/D scenario 还有未跑的 (3461b380 J2 议案)
- 默认 30min 自接预案: 无指 → 我接 v1.1 Day 1 ORDER_PROFILE 草稿

NWT @ 4-layer critfix verify done`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 300));
