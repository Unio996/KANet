# Broker Asset-Generic v2 Spec — KAS 参数化为通用 OTC Dispatcher

> **日期**: 2026-04-26
> **作者**: NWT Opus (接位 #2)
> **版本**: v2 (撤回 v1 16:25 c37da51f draft, 重写 incorporate J2 #3 4c4bd55e50 5 点 challenge + J1 c081c9446f part 3 grep + J1 6b7b35a Phase B 接口)
> **状态**: 讨论稿 (待 J1 + J2 #3 review + Owner 拍方向)
> **基础**: v1.0 wire fix v3 (commit 13aca342a) 真测真根治 5 笔 rescue 模式
> **审校对象**: Owner (Martin) · J1 Opus · J2 Opus #3

---

## 摘要 (TL;DR)

Owner 22:23 钦定 "broker 系统下一步迭代! 模块化, 结构清晰化! KAS 这个参数一换, 这个系统就是全球去中心化 kas 市场".

v1 draft (NWT 16:17 74ef7968) 假繁荣 5 处被 J2 #3 16:25 严严 challenge:
1. grep 漏 4 file (api/exchange.js 24 KAS literal! + api/trading.js + intake-watcher + market-seeder)
2. trade-protocol-filter "100% generic" 错判 (真 4 处 KAS literal 直 dispatch-blocking)
3. ~300 LOC 1-2 day 严重低估 (真 850-1050 LOC 3-5 day J2 #3 严估)
4. mm_orders prior art 假设错 (老 schema 更 hardcode, 反向 deprecate 真对)
5. 测试策略没 spec (真 ERC20 跨换真测 USDC on BSC ~$0.50 真实例)

v2 spec 真 grep 全 codebase + incorporate 5 challenge + 严 phase 切分 + 真 LOC 严估 + 真测策略 spec.

---

## 真 grep 实证 (NWT 16:27 全 codebase 真扫)

| File | KAS literal | 真意图 |
|---|---|---|
| api/exchange.js | 19 | publish/accept REST API 默认 KAS |
| services/broker-buy-handler.js | 18 | BUY_REGEX/MIN_QTY_KAS/SQL/fetchKasPrice/preview_text NLG |
| ui/exchange.eta | 13 | UI 文案 + form labels |
| ui/trading.eta | 12 | UI (老 mm_orders 路径) |
| services/exchange-machine.js | 12 | _verifyAndComplete 路径 KAS-specific branches (kaspa_tx vs cross_chain_tx) |
| services/broker-intake-watcher.js | 12 | sell flow KAS receive 检测 |
| services/market-seeder.js | 11 | fetchKasPrice 单 asset price oracle |
| services/broker-sell-handler.js | 10 | SELL_REGEX/FEE_KAS/MID_PRICE |
| services/trade-protocol-filter.js | 7 | **4 处 dispatch-blocking** (line 482/711/1394/1450) |
| db/migrate.js | 7 | DB schema seeds 默认 KAS |
| ui/partials/trade-otc.eta | 5 | UI 老 OTC partial |
| services/exchange-orders.js | 5 | order helper KAS-only |
| api/trading.js | 5 | mm_orders 老 OTC API (J1 实证 7 天 0 active) |
| services/reputation.js | 4 | 信誉系统 KAS 关联 |
| services/broker-action-queue.js | 4 | dm_* templates KAS 文案 |
| cross-chain-verify.mjs | 3 | KAS verifier 1 处 |
| ui/partials/trade-portfolio.eta | 2 | UI portfolio 老路径 |
| api/ingest.js | 2 | chain ingest |
| ui/partials/trade-settings.eta | 1 | UI settings 老 |
| services/hyperliquid-client.js | 1 | HL integration 评估 ignore |

**真总: ~150 KAS literal hardcode 跨 20 file**

---

## 真 4 处 dispatch-blocking literal (J2 #3 实证, NWT 16:28 验证真意图)

trade-protocol-filter.js:
- **line 482** `_autoPayExchange` filter: `if (give_asset !== 'KAS' || want_asset !== 'USDT') return;` — 当前 auto-pay 路径只对 KAS↔USDT 触发, 其他 asset_pair 全 silent skip
- **line 711+1394** `_autoSendKas` 触发 + 函数内 guard: 只对 verification=='kaspa_tx' && want_asset=='KAS' 触发
- **line 1450** paid_v1 broadcast `payment_asset: 'KAS'` literal (真协议消息字段)

**真改造模式**: `_autoPayExchange` + `_autoSendKas` → `_autoSettleAsset(offer)` generic 化, 调 J1 Phase B `canSendAsset` + `sendAsset` 接口路由, asset 来自 `offer.want_asset` (DB 真值, 非 hardcode).

---

## 真 4 missing abstraction layer (J2 #3 challenge 接受)

1. **Decimals normalization** (~30 LOC): KAS=8 vs USDT-BSC=18 vs USDT-TRON=6 vs USDT-Polygon=6. 现 fund-lock + cross-chain-verify hardcode KAS-decimals. 加 per-asset decimals lookup. **J1 Phase B asset-registry 已含 decimals 字段, Phase A 调 sendAsset 前 wei convert**.
2. **Per-asset min_qty / dust** (~15 LOC): 现 MIN_QTY_KAS=1.0. 多 asset 需 per-asset min (KAS 1.0 / BTC 0.0001 / ETH 0.001). **J1 Phase B asset-registry 已含 minQty 字段, Phase A handler 用此**.
3. **Broker per-asset inventory pool** (~80 LOC): 现 broker_dynamic 自挂只 KAS 库存. multi-asset 需 broker per-asset wallet pool + rebalance trigger. **v1.2 留, v1.1 只支持 KAS 库存 + USDT 交换 (asset 维度只扩到 USDT-on-EVM 路径)**.
4. **Migration safety** (~20 LOC): 现 exchange_offers row 全 give_asset='KAS' 默认. 加 asset_pair concept 后 backward query 真不能 break. SQL `WHERE give_asset = ?` 兼容现存 row 自动 ✓ (无需 migration script, 测试 regress 5 笔 rescue 模式真覆盖).

---

## mm_orders deprecate decision (J1 04d6363ad1 真数据)

J1 query DB 真实证: mm_orders 7 天 0 active records (109 total: 26 cancelled + 42 completed + 41 expired). exchange_offers 同期 608 records, 主用 ✓.

**决定**: api/trading.js + ui/trading.eta + ui/partials/trade-* 老 mm_orders 路径 deprecate (~150 LOC 删 + UI cleanup), 不 generic 化老路径. v1.1 Phase A 不动 mm_orders (deprecate 单独 v1.2 sprint 处理).

---

## Phase 切分 (v1.1 / v1.2 / v1.3 严边界)

### v1.1 Phase A — broker handler 调 J1 Phase B 接口 (~250 LOC, NWT 接)
- broker-buy-handler.js / broker-sell-handler.js: BUY_REGEX/SELL_REGEX 接 asset 参数 (regex 模板), MIN_QTY[asset] map (调 asset-registry), fetchKasPrice → fetchAssetPrice (调 asset-registry), SQL WHERE give_asset=? (current 'KAS' 默认), preview_text NLG asset.symbol parameterize
- broker-action-queue.js: dm_* templates asset symbol parameterize
- trade-protocol-filter.js: _autoPayExchange + _autoSendKas → _autoSettleAsset generic (line 482/711/1394/1450 改造, 调 settler-router)
- exchange-machine.js: _verifyAndComplete KAS-specific branches 改 asset-aware (调 cross-chain-verify per asset_pair)
- 真测: e2e-asset-pair.mjs

### v1.1 Phase B — asset-registry + settler-router (J1 已 ship 6b7b35a, ~170 LOC)
✓ 已 ship 16/16 PASS, isolated 接口层. v2 Phase A incorporate.

### v1.2 Phase D — UI 文案 + DB seeds generic (~50 LOC)
- ui/exchange.eta + ui/partials/* asset symbol parameterize
- db/migrate.js seeds asset-aware

### v1.2 Phase E — broker-llm-agent SYSTEM_PROMPT generic (~100 LOC)
- LLM SYSTEM_PROMPT 含 supported assets table (动态 from asset-registry)
- preview_order / finalize_order tool 接 asset 参数

### v1.2 Phase F — incoming-watcher per chain×asset (~150 LOC)
- bsc-incoming-watcher 抽 IncomingWatcher base class
- 每 chain×asset 一份 watcher (BSC USDT / BSC USDC / Polygon USDT / SOL USDC / TRON USDT)

### v1.2 mm_orders deprecate (~150 LOC delete)
- api/trading.js + ui/trading.eta + ui/partials/trade-* 删
- mm_orders 表保留 (audit history 109 records 留 chain_events)

### v1.3+ broker per-asset inventory pool (~80 LOC)
- broker per-asset wallet 注册
- rebalance trigger 自动调用

---

## 真 LOC 严估

| Phase | LOC | ETA | v1.1/v1.2/v1.3 |
|---|---|---|---|
| Phase A (NWT) | ~250 | 真 1.5-2 day | v1.1 |
| Phase B (J1 已 ship) | ~170 ✓ | done | v1.1 |
| Phase D (UI + migrate) | ~50 | 0.5 day | v1.2 |
| Phase E (LLM) | ~100 | 1 day | v1.2 |
| Phase F (watcher) | ~150 | 1.5 day | v1.2 |
| mm_orders deprecate | ~150 | 0.5 day | v1.2 |
| 真测脚本 (J2 #3 接) | ~80 | 0.5 day | v1.1+ |

**v1.1 真总**: Phase A + 真测 = ~330 LOC, **2-2.5 day** 真严估
**v1.2 真总**: Phase D+E+F + deprecate = ~450 LOC, **3-4 day**
**v1.3+ 真总**: ~80 LOC inventory, 评估时再

J2 #3 ~850-1050 LOC 3-5 day 是 **v1.1+v1.2 全合**. v2 spec 切到 v1.1 ~330 LOC 2-2.5 day 才是真 v1.1 sprint.

---

## 真测策略 (J2 #3 challenge 接受)

**真 ERC20 跨换真测** (USDC on BSC):
1. broker config 加 USDC-BSC support (asset-registry + broker BSC USDC wallet 注册)
2. broker publish 'sell USDC for USDT BSC' offer (broker_dynamic 模式, broker 用自己 USDC 库存)
3. user (Sophie 或 NWT) DM "买 1 USDC, BSC, USDT 付" → broker preview → user YES → broker accept_v1 真上链
4. user 真转 X USDT BSC → bsc-watcher 真 detect → paid_v1 真上链
5. broker 真 deliver 1 USDC BSC → completed
6. **真测代价**: ~$0.50 BSC (USDC/USDT 真转 + gas) + broker 真要持 1+ USDC BSC 库存 (~$1)

**默认 KAS regression**: e2e-asset-pair.mjs 含 KAS 默认 case 真测 (Phase A 改完不退化 v1.0 wire fix v3 真生效).

---

## v1.1 启动条件 (硬钉)

1. ✅ wire fix v3 (commit 13aca342a) 真测真根治 5 笔 rescue
2. ⏳ Owner 真 Kasia 真 1 KAS 真测通过 (输 0.0342 USDT 正确 amount, broker 真 deliver 1 KAS 完整闭环)
3. ⏳ NWT v2 spec broadcast → J1 + J2 #3 review → Owner 拍方向
4. → 三方分工 ship Phase A (NWT) + 真测 (J2 #3) + Phase B 集成 (J1 6b7b35a 接口)

---

## 自决投票 (v2 spec 待三方 review)

NWT 投: v1.1 ship Phase A + 真测策略 (含 USDC on BSC 真 ERC20 真测), v1.2 ship Phase D+E+F + mm_orders deprecate, v1.3 评估 inventory pool.

求 J1 + J2 #3 真 challenge v2 spec (不 echo ack, 真 grep 真 dig 实证 challenge).

通过 → Owner 拍方向 → 启动 ship.
不通过 → 三方一起 dig 修 spec.

---

## 元教训 (NWT 自承)

跟 R20 同范式: invariant 必覆盖所有 sink, spec 必 grep 100% codebase 全列. 我 v1 draft 16:17 没真 grep 全树就出 spec, 是假梳理 (Owner 22:23 钦定 "好生梳理" 真意被违反). v2 spec 真 grep + 真 read 关键 file + 真 design + 真严估 LOC, 真梳理.
