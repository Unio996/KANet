import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] 🔧 真 fix R19 false positive — SELL flow user-supplied EVM addr 真 whitelist (Owner 09:34 真测撞)

## Owner 真测 SELL flow 真撞

Owner '我要卖 99 KAS, BSC, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D' →
broker LLM 真 echo Owner addr 真 confirmation →
R19-EXT 真 single-direction (broker reply EVM addr 必 broker 自己 BSC) →
**false positive 拒**: '抱歉, broker 检测到地址异常 (内部 R19 拦截)'

NWT 09:38 真 broadcast 同 audit (J1 R26 peer-LLM-echo 真 case 真化).

## J2 真 fix commit (~10 LOC)

assertReplyAddressInvariant 真 second arg userContext:
\`\`\`js
export function assertReplyAddressInvariant(replyText, userContext = '') {
  // ... evmMatches from replyText ...
  const userAddrs = new Set();  // user-supplied EVM addr from message context
  if (userContext) {
    const userEvm = userContext.match(/0x[a-fA-F0-9]{40}/g) || [];
    for (const a of userEvm) userAddrs.add(a.toLowerCase());
  }
  for (const addr of evmMatches) {
    if (!own.has(addr.toLowerCase()) && !userAddrs.has(addr.toLowerCase())) {
      return { violated: true, foreign_address: addr, ... };
    }
  }
}
\`\`\`

conversations.js _r19Guard 真 pass user message context 真 whitelist.

## ✅ 真 verify (J2 直 invoke 3/3 PASS)

- Test 1 user echo: ✓ PASS (whitelist user addr)
- Test 2 broker hallucinate fake: ✓ violation caught
- Test 3 broker own addr: ✓ PASS

## R19 真 invariant 真精化

before: broker reply EVM addr ⊆ broker_wallets (单向 strict)
after: broker reply EVM addr ⊆ (broker_wallets ∪ user_supplied_addrs) (真 user echo whitelist)

真原意 (J1 67903c5b 钢线): protect broker LLM hallucinate fake addr → user 转 USDT lost.
真 fix preserve 真原意 + 真 SELL flow user echo 真 production OK.

## 真 next 真 standby

- ⏳ Owner 真重 trigger SELL 99 KAS BSC 真 verify 真完整 round-trip (broker handler 真 capture + INSERT retail_dex_orders + DM 转 KAS instruction + intake-watcher 真 detect KAS 入账 + 真 publish offer + 真 deliver USDT)
- ⏳ NWT broker-sell-handler 真 e2e 真测 trigger
- ⏳ 9 条复用 USDT-ETH/Polygon 真 user 真测扩

—— J2 #3 @ 09:42 真 fix R19 false positive (Owner SELL 真测撞), 真等 Owner 真 retrigger`;

await sendBroadcast('dev-coord', text);
