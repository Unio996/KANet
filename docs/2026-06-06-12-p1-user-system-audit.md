# #12 P1 v0.6 用户系统实能用 — 现状 audit + 缺口报

> KANet-UI doc-owner · 2026-06-06 · 派工: Bettor r... 09:18 "用户建市场/下注/看结果/看裁决链路 UI+bot 流程补缺口, 喂主线展示层"
> 守 [[里程碑非终点]] 精确级别 · 守 [[无 impl-jargon user copy]] · 守 [[设计前必读 KB]] (D:\KANet-Knowledge-Base/products/03-prediction-pool.md)

## 0. Scope 自校

主线 = Bettor 钦定 "完整自治闭环公开演示版" (agent 自建→自押→自抽样→自投票→5/5→自 settle→UI 展示全链路可审计可点 txid)。

本 audit = **用户视角**完整链路 ("用户" = 链下匿名 telegram/web 用户 + 第三方 fork 部署的 demo 观察者)。

四条用户旅程:
1. **建市场** — 用户怎么发起一个池预测市场
2. **下注** — 用户怎么把 stake 锁进 PoolSide
3. **看结果** — 用户怎么知道自己赢/输 + 何时拿钱
4. **看裁决链路** — 用户怎么验证机制公正 (= 委员选谁/为什么/各怎么投/SS 怎么验/钱怎么分)

## 1. 现状 audit (per-path)

### 1.1 tg-bot (= 真实用户主入口)

文件: `tg-bot/prediction-menu.mjs` (491 行) + `tg-bot/console-api.mjs` (helpers).

| 旅程 | 现状 | 级别 |
|---|---|---|
| 建市场 | **❌ 不存在** — `console-api.mjs` 仅 read+bet helpers, 无 create market endpoint 调用 | P0 缺 (主线展示用) |
| 下注 | ✅ stage0-5 menu 完整 (link → 选市场 → 选方向 → 输入金额 → prep 算 P2SH → confirm 等付 → poll on-chain) | OK |
| 看结果 | ✅ `formatMyBets` (L125) + `myPositions` endpoint 显 settle_txid / refund_txid + KAS 数 | OK |
| 看裁决链路 | **⚠ 仅 settle TX 单链接** — 没 vote/sig/spine_lock/side_lock 全链路 | P1 缺 (展示主线弱) |

### 1.2 web UI (= demo 观察者+开发者主入口)

| 页 | 路由 | 状态 | 现状 | 级别 |
|---|---|---|---|---|
| 主列表 | `/predictions` | 200 | 含 explorer 链接 settle/refund (good), 含 UMA finalization status (v0.5 legacy), 未显 protocol_version / committee 信息 | P2 显示陈旧 |
| 详情页 | `/predictions/pool/:id` | 200 | 状态机 5 阶段 ✓ / live 投票进度 ✓ / settle 结果 ✓ / **explorer hardcoded `explorer-tn10`** (= ❌ 实际 TN12) / `buildOracleList()` 用 `oracle_relay_ids` (v0.5 字段, v0.7 改 `committee_pks` PK 不 relay_id) → **v0.7 市场 oracle list 显空** | **P0 显示坏** |
| 建市场 | `/predictions/pool/create` | 200 | 633 行 (有但未审, 假设存在) | 待审 |
| Oracle 信任 | `/oracle` | 200 | 已迁 canonical chain_view (c750f26 我今日 ship), 含 5 PK committee 暴露 + settle_txid + 跨节点 root | OK |
| Oracle 注册表 | `/predictions/oracle-registry` | 302 | redirect 到 /oracle | OK |

### 1.3 API 端点支撑

已存在 (我之前 ship):
- ✅ `GET /api/pool/markets` — 列表 (filter status/category)
- ✅ `GET /api/pool/market/:id` — 单市场
- ✅ `GET /api/pool/my-positions?linked_addr=X` — 我的押注
- ✅ `GET /api/pool/market/:id/settle-audit` — **三方分账证据链** (commit 12eeafc, settle_txid + committee PK→relay_address + chain_events + explorer 链接) **未被 UI 接入** ❌
- ✅ `GET /api/oracle/markets/:id/audit` — 投票审计历史
- ✅ `POST /api/pool/market/:id/bettor/register-v06/{prep,confirm}` — 下注

缺 (建市场 user-facing 链路):
- ⚠ tg-bot `console-api.mjs` 无 createMarket helper. web /predictions/pool/create 已存在.
- ⚠ create-v07 endpoint 有 INSERT param bug (Bettor 23:03 实证, 缺 outcome_market_source/outcome_condition_id/outcome_token_id 字段 → "Too few parameter values"). 这是 J2 域 bug, 我不修.

## 2. 缺口报 (P0→P3 优先)

### P0 — 主线展示层硬需 (Bettor 钦定主线靠这条出 demo)

**P0.1 `/predictions/pool/:id` v0.7 适配 + 全链路证据链 (settle-audit endpoint 接入)**
- 修 explorer 硬编码 (tn10 → 用 `lib/explorer-url.mjs` 或 fetch network type)
- `buildOracleList()` 分支: v0.5 用 `oracle_relay_ids`, v0.6/v0.7 用 `committee_pks` (= settle-audit endpoint 返回的 PK→relay_address 映射)
- 接入 `/api/pool/market/:id/settle-audit` 数据, 渲染三方分账证据链 4 段: spine_lock_tx → side_lock_txs(每 bettor) → vote_txs(每委员) → sigs_chain_events → settle_txid → 各 outputs (broker/N委员/winner)
- 每段 txid → TN12 explorer 链接
- 跨节点标识: 显 maker 节点 (= "本节点" / "cross-node:xxx") + 委员节点分布 (= ":3200 / :3300 / 5 PK")

### P1 — 用户主旅程完备 (用户实能用)

**P1.1 tg-bot prediction-menu 加 "看裁决链路" 入口**
- 每个 settled bet 显 "🔍 看怎么定的" 按钮 → 给出 web URL `/predictions/pool/<id>` 深链
- 文案 plain (= "看怎么决定输赢的" 非 "查证据链")

**P1.2 主列表 `/predictions` v0.7 适配**
- 显 protocol_version (v0.5/v0.6/v0.7) badge
- 显 committee 信息 (= v0.7 池预言机标识)

### P2 — 用户建市场 (低优, 跨派工)

**P2.1 等 J2 修 create-v07 INSERT param bug** (J2 域非我)
- 修好后 tg-bot `console-api.mjs` 加 `createMarket` helper + prediction-menu 加 "建市场" 入口 (= stage6-9 menu)

### P3 — 文案+视觉

**P3.1** 守 [[no-impl-jargon-in-user-copy]]: 用户文案 plain + actionable, 不暴露 "委员 PK / merkle proof / sighash" 等术语. "5 个仲裁人投了 4 票 YES + 1 票静默 → 判 YES"  ≠ "4-of-5 forfeit_1 committee consensus".

## 3. 起手序

1. **P0.1** predictions-pool-detail.eta 适配 v0.7 + 接 settle-audit endpoint (= 主线展示层硬需, 一改即喂 Bettor 主线)
2. **P1.1** tg-bot 加深链 (= 极小改动, 立刻让用户能跳)
3. **P1.2** 主列表 v0.7 badge (小改)
4. **P2 / P3** 等节点 / 整理

## 4. 守 [[里程碑非终点]] 诚实边界

本 audit 是 **基线 + 缺口扫描**, 不是 "用户系统 done"。判 "P1 v0.6 用户系统实能用" 通过的 DoD:
- (a) 用户从 tg-bot 完整 link → 选市场 → 押注 → 看结果 → 点链路看证据 (= 4 段实跑 + 链上 TX 实存)
- (b) demo 观察者从 web 任一 settled v0.7 市场点详情页 → 看到 spine_lock + 5 side_lock + 5 vote + N sigs + settle TX 全可点 + outputs 与文档 §6 三方分账数字对得上
- (c) 文案 0 impl jargon

至 ship 通过这 3 项, 才报 "用户系统实能用" 实证.
