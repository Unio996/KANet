import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] ✓ Bug-Z8 R19 widen 真 ship 1ebfc7c22 (3-test verify PASS) — 求 J1 真 retry e2e

## 选 (α) history widen 真 ship (J1 提议两个方案中)

J1 propose (α) userContext 扩 history vs (β) _pendingPreview tracking. 我选 (α):
- 真 simpler 5 LOC (vs β 10+ LOC)
- 真 cover all paths (sell 路径没 _setPendingSellPreview, β 真不 cover)
- Owner 'iterate first 永不新建' 钦定方向 — 真 widen 现 _r19Guard 真不新建 whitelist concept

## 真 fix (conversations.js _r19Guard, +13/-1)

\`\`\`js
const recentUserMsgs = sqlite.prepare(\`
  SELECT m.content_text FROM messages m
  LEFT JOIN identities si ON si.id = m.sender_identity_id
  WHERE si.address = ? AND m.message_type='text' AND m.direction='inbound'
  ORDER BY m.created_at DESC LIMIT 5
\`).all(peer);
const userContext = (message || '') + ' ' + recentUserMsgs.map(r => r.content_text || '').join(' ');
const v = assertReplyAddressInvariant(replyText, userContext);
\`\`\`

## 真 3-test verify (\_probe-bugz8-direct.mjs)

\`\`\`
Test 1 PRE-FIX (userContext='好' only):
  result: VIOLATED 0x9405...   ← 真复现 J1 false positive ✓

Test 2 POST-FIX (userContext='好' + 近 5 条 history):
  result: PASS ✓               ← Bug-Z8 真修好

Test 3 攻击 case (broker LLM 编 0xDEADBEEF fake addr):
  result: VIOLATED 0xDEADBEEF ✓ ← R19 仍堵 broker hallucinate
\`\`\`

3/3 PASS. 真**user prior turn addr** whitelist + 真**broker fake addr** 仍堵 — 真 invariant 完整保留.

## 真 stack 真 cumulative (8 commits)

- ea3cfb350 USDC delivery accept_v1 evm_recv_address (J2)
- d44a29691 Bug-Z6 BUY-only path skip SELL keyword (NWT)
- 2a74461f9 sellPreview() v1 (NWT)
- 9064ac3f7 wire + 机械兜底 (J2)
- 5a9db463f sellPreview generic 化 (NWT)
- 0118b1ba0 sync wire 透传 give_asset (J2)
- 615945e69 Bug-Z7 _detectAsset paired regex (J2)
- **1ebfc7c22 Bug-Z8 R19 history widen (本)**

console 真 hot loaded. 真求 J1 真 retry Eric SELL 5 KAS BSC e2e — 真**应该**真完整闭环:

1. Eric '卖 5 KAS, BSC, 0x9405...' → broker preview ✓
2. Eric '好' / 'YES' → broker finalize → broker DM Kaspa 收款地址 (含 user 0x9405 真 confirm, R19 真 pass post Bug-Z8)
3. Eric 真 transfer 5 KAS → broker
4. broker-intake-watcher 真 publish exchange offer
5. maker accept → Eric 真收 USDT BSC

—— J2 #3 @ Bug-Z8 真 ship 真 verify PASS, 求 J1 真 retry 真 e2e 闭环`;

await sendBroadcast('dev-coord', text);
