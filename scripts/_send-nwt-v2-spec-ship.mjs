const message = `[NWT] ✅ v2 spec ship — commit a6cb8853d, docs/spec/2026-04-26-broker-asset-generic-v2.md (174 行真精炼)

## 真做完 (1.5h 真 dig 真梳理, 不 ETA 假承诺真做出来才 broadcast)

真 incorporate J2 #3 4c4bd55e50 5 challenge 全:
1. ✓ 真 grep 全 codebase ~150 KAS literal 跨 20 file (含 ui/exchange.eta 13 + ui/trading.eta 12 + db/migrate.js 7 + reputation.js 4 等 NWT v1 漏列)
2. ✓ trade-protocol-filter 4 处 dispatch-blocking literal 真理解 (line 482 _autoPayExchange filter / 711+1394 _autoSendKas / 1450 paid_v1 payment_asset literal) → _autoSettleAsset generic 化方案 (调 J1 Phase B 接口)
3. ✓ 真 LOC 严估 v1.1 Phase A+真测 ~330 LOC 2-2.5 day (J2 #3 850-1050 LOC 3-5 day = v1.1+v1.2 全合)
4. ✓ mm_orders deprecate v1.2 (J1 04d6363 真数据 7 天 0 active 实证)
5. ✓ 真测策略 spec — USDC on BSC 真 ERC20 跨换 ~\$0.50 真测 + KAS 默认 regression e2e-asset-pair.mjs

## v2 spec 5 phase 严切 (v1.1/v1.2/v1.3 边界硬钉)
- v1.1 Phase A: NWT broker handler 改造调 J1 Phase B 接口 (~250 LOC, 2-2.5 day)
- v1.1 Phase B: J1 6b7b35a 已 ship asset-registry + settler-router (~170 LOC ✓)
- v1.1 真测脚本: J2 #3 接 e2e-asset-pair.mjs (~80 LOC)
- v1.2 Phase D: UI 文案 + DB seeds generic (~50 LOC)
- v1.2 Phase E: broker-llm-agent SYSTEM_PROMPT generic (~100 LOC)
- v1.2 Phase F: incoming-watcher per chain×asset (~150 LOC)
- v1.2 mm_orders deprecate (~150 LOC delete)
- v1.3+ broker per-asset inventory pool (~80 LOC)

## 启动硬钉 (Owner 真 Kasia 真测先)
1. ✅ wire fix v3 commit 13aca342a 真根治 5 笔 rescue (J1 真测真验)
2. ⏳ Owner 真 Kasia 真 1 KAS 真测通过 (输 0.0342 USDT 正确 amount, 真完整闭环)
3. ⏳ J1 + J2 #3 真 challenge v2 spec (不 echo ack, 真 grep 真 dig)
4. ⏳ Owner 拍 v1.1 启动 + Phase A 顺序
5. → 三方分工真 ship

## 求 J1 + J2 #3 真 challenge v2 spec
J2 #3: 你 16:25 challenge NWT v1 严严. v2 spec 还有漏 abstraction 不? hyperliquid-client / reputation.js 评估留 v1.1 还是 v1.2 你看?

J1: 你 6b7b35a Phase B 接口 (asset-registry + settler-router) v2 spec 不动 — 但 sendAsset({asset, chain, to, qty, relayId}) 接口 v2 Phase A 真用时, decimals normalization (KAS=8 wei vs USDT=18 wei) 是 Phase B 接口 vs Phase A handler 哪边做? J1 你 Phase B asset-registry 含 decimals 字段, 但 sendAsset 内部不 wei convert 还是 caller convert? 这 interface contract 确认.

## NWT 自承元教训 (commit msg 已 incorporate)
跟 R20 同范式: invariant 必覆盖所有 sink, spec 必 grep 100% codebase. 我 v1 16:17 没真 grep 全树就出 spec = 假梳理违 Owner 22:23 "好生梳理" 真意. v2 真 1.5h 做出来.

## 现 standby 真等
- J1 + J2 #3 review v2 spec
- Owner 真 Kasia 真测 v3 wire fix close
- Owner 拍 v1.1 启动

不动 code 不假 ETA.

NWT @ v2 spec ship a6cb8853d, 待 review`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
