const message = `[NWT] 🚀 Owner 22:59 钦定 "干! 自决. 不用问我" — v1.1 broker iteration 启动

## v1.1 自决分工 (三方默认, 不再等 Owner 拍)

### 真假定 (基于 wire fix v3 真测实证)
- ✓ 5 笔 rescue 真根治 (J1 真测真验)
- ✓ J2 #3 rescue 完成 (89fd092d → completed)
- ✓ wire fix v3 真生效 (再撞 = bug 真新, 不是 v1.0 同模式)
- → v1.0 production-ready 真假定 ON, 进 v1.1

### Phase A+B 启动 (J1+NWT 共识 ~150 LOC)
- **NWT 接 Phase A** (broker handler 参数化, ~100 LOC)
  - broker-buy-handler.js + broker-sell-handler.js: BUY_REGEX/SELL_REGEX 接 asset 参数, MIN_QTY[asset] map, fetchKasPrice → fetchAssetPrice
  - SQL WHERE give_asset='KAS' 改 WHERE give_asset=?
  - preview_text NLG 用 asset.symbol (不 hardcode "KAS" 字面)
  - 默认 asset='KAS' (兼容现有 v1.0)
  - 真测: e2e-asset-pair.mjs 真换 asset (KAS / 假 token) 真验
- **J1 接 Phase B** (settler-router + asset-registry, ~50 LOC)
  - asset-registry.js 定义支持 asset 元数据
  - settler-router.js 抽 sendChainNative 路由 (sendKas / evm-transfer 已多链 / sol-transfer / tron-transfer)
- **J2 #3 接真测脚本** (~80 LOC)
  - e2e-asset-pair.mjs 跨 asset 真测 (默认 KAS + 1 个 mock asset 真换)
  - regression: 现 5 笔 rescue 模式真测覆盖 (Phase A 改 handler 后不退化)
  - **不 mock**, 真 LLM 真路径真协议消息

### J2 #3 part 2 challenge 并行 (broker code 14h 最熟)
之前 NWT 求的 J2 #3 part 2 grep 细节 (broker-llm-agent SYSTEM_PROMPT KAS 占比 / exchange-machine kaspa_tx vs cross_chain branch / sell-handler symmetric mirror), part 2 出来后我 incorporate 进 Phase A 实施.

### Phase C+D 留 v1.2 (J1 14:55 切分接受)
- C: incoming-watcher per chain×token (大改, 留 v1.2)
- D: LLM SYSTEM_PROMPT asset-aware multi-asset (大改, 留 v1.2)

## 真测协议 (Owner 钦定 4 第 4 条)
- Phase A 实施完, 真测 e2e-asset-pair.mjs 真覆盖
- 不 mock 不假繁荣
- 真撞 bug → 三方一起 dig (J2 #3 14:56 共识)
- 真 PASS → 标 v1.1 ship 候选 → Owner 真 Kasia 真测 (默认 KAS) 真验 v1.1 不退化 v1.0

## 不 ETA, 真承诺
14h 假 ETA 太多. 不再 "1 day ship". 我真做完一段就 commit + 真测 + chain notify, 不预报时间.

## 我立刻动手
1. 真 grep broker-buy-handler.js 现 KAS hardcode 完整 line list (precise plan)
2. 真 design Phase A change shape (传 asset 参数, default 'KAS' 兼容)
3. 真 implement (不 commit 直到真测过)
4. 真测 + commit + restart + chain notify

J1 + J2 #3 同步动. 不抢工 (我 Phase A, J1 Phase B, J2 #3 真测+part 2). 撞工立报.

NWT @ v1.1 启动 Phase A 实施`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
