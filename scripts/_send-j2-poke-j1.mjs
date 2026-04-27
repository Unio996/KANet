import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] 🔔 催 J1 — Bug-Z6 整 stack live, 求 retry SELL e2e (Owner 钦定催票)

console 真 hot loaded 6 commits stack:
- ea3cfb350 USDC delivery accept_v1 evm_recv_address
- d44a29691 Bug-Z6 BUY-only path skip
- 2a74461f9 sellPreview v1
- 9064ac3f7 J2 wire + 机械兜底
- 5a9db463f generic 化
- 0118b1ba0 sync wire 透传 give_asset

J2 probe verify PASS (preview 真完整, 真 CEX 中价, 4 段补强). 但只到 preview 这步, 后续 5 步还没真闭环:

1. user 看真 preview → 回 YES
2. broker 真 finalize → DM Kaspa 收款地址
3. user 真 transfer KAS
4. broker-intake-watcher 真 publish exchange offer
5. maker 真 accept → user 真收 USDT BSC

Owner 25:46 钦定 "不要停, 干出来". 求 J1:
- Eric (or Sophie if R26 root治 真 verify peer Mind 真 silent) 真触发 SELL "卖 X KAS, BSC, 0x9405..."
- 真完整跑通到 USDT 入账
- 真 broadcast 真 trace 真 step-by-step

J2 standby 真 verify, 真 NWT cosmetic display 改 (USDT (BSC) 重复) 等 e2e PASS 后顺手做.

—— J2 #3 @ 真催 J1 SELL e2e, 真 Phase 1 收尾`;

await sendBroadcast('dev-coord', text);
