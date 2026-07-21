# 5 问架构审查 — 分工派发 + 验收标准（Owner 钦定「干」· Bettor 全权协调）

**日期**: 2026-06-27 · **协调**: Bettor · **状态**: 已派发，并行执行中
**沉状态层**: 频道=传输层会滚走，本文档=状态层。接位/重启从此对齐当前 task 与验收。
**调查证据**: 3 路深挖 + Bettor 链上核证（122 completed 市场 + 2106 笔链上 claim 推翻"settle stubbed"误判）。详见频道 #wgr1jy 上文综合分析。

---

## 0. Owner 产品决策（Bettor 默认值，Owner 可改）
- **Q4 热门口径**: 默认 **activity+commitment 加权**（非裸 volume，防 seeder 刷量），含过滤（最小池/deadline>1h/排除极新/status=open）。非 FOMO 裸热榜。
- **introducer**: 默认 **放 Phase B**（完整裂变子系统：注册+归属+链锚+显示，需先设计 SS）。本轮先做增量传播/透明度（Q5 深链 + Q3 node 收益显示）。Bettor 起 introducer 设计稿并行。

---

## 1. 派发清单（按域并行，依赖标注）

### 【KANet-UI】UI / bot — 3 件独立可立即做
**T1 (优先·传播力) — Q5 单 case 深链 + 分享按钮**
- 文件: `tg-bot/bot.mjs`（/start handler L52）+ `tg-bot/prediction-menu.mjs`（市场详情）
- 改: (a) `/start` 解析 `ctx.match` payload — 若是 market_id，跳进该市场详情/下注流（对照 /send L99 已有的 ctx.match 解析写法）; (b) 市场详情页加「🔗 分享」按钮，生成 `https://t.me/<bot_username>?start=<market_id>`，用 grammy `InlineKeyboard.copyText()` 一键复制（已有先例: 详情页地址复制 prediction-menu.mjs:601）。
- 边界: 不碰 settle/钱逻辑，纯 bot 交互 + 链接拼接。bot_username 从 config 取（别硬编）。
- 验收(Bettor): 真发一个深链给自己点开 → 新会话直接落到该市场；分享按钮一键复制出正确 URL。

**T2 — Q1a /broker 并入收益显示**
- 文件: `tg-bot/bot.mjs`（/broker L165）+ `tg-bot/messages.mjs`
- 改: /broker 现只显 onboarding 状态。把 `/earnings`（已有，调 kanet-broker.js earnings-by-address，链验）的收益摘要并进 /broker 视图（经手 N 单 + 已赚 Σ KAS + /earnings 看详情）。/earnings 保留为详情命令。
- 边界: 只调已有 earnings API，不改后端。non-broker 不显收益行（零噪音）。
- 验收(Bettor): broker 地址 /broker 见收益摘要；non-broker /broker 无收益行。

**T3 — Q2 TG-bot 管理移出 /relays**
- 文件: `kasia-console/src/ui/relays.eta`(L161-261 三块) → 新 `/integrations` 页（或恢复 settings.eta 可达）; route 在 `kasia-console/src/api/relay.js` / settings.js
- 改: 把 token 配置/broker 身份/启停三块从 /relays 迁到独立 /integrations 页（语义: TG bot 是独立 0-key 单例进程，不属 relay）。导航加入口。API 端点（/api/config/tg-bot-*、/api/tg-bot/*）不变，只挪 UI。
- 边界: 纯 UI 迁移，不改 tg-bot-manager 逻辑、不改 API。迁完 /relays 只剩 relay 管理。
- 验收(Bettor): /integrations 可达且三块功能照常（改 token/切 broker/启停）；/relays 不再有 tg-bot 块。

**T4 (依赖 J2 的 T6) — Q3 introducer+node 收益显示**
- 等 J2 T6 出 node 收益端点 → DM/UI 加 node 身份收益显示。introducer 显示等 Phase B 设计。

### 【J2】后端 — settler/income，2 件独立可立即做
**T5 (Q4) — trending 端点**
- 文件: `kasia-console/src/api/pool.js`（markets 列表附近 L1878）
- 改: 新 `GET /api/pool/markets/trending?limit=5` — 排序 = activity+commitment 加权（bettor_count 权重 + total_pool_kas），**过滤**: protocol_status='open' + deadline>now+1h + total_pool ≥ 阈值（防刷量）+ 排除创建<1h 极新。返回精简字段（id/title/odds/pool/bettor_count）。
- 边界: 只读端点，不碰 settle。加权公式注释清楚（防后人误判 gaming）。
- 验收(Bettor): 端点返回前 5 真实活跃市场，刷量小市场被过滤挡掉。

**T6 (Q3) — ⑤node 收益独立端点 + ①bettor 收益链验**
- 文件: `kasia-console/src/api/pool.js`（参照 L2521 /api/oracle/income/:pk）+ my-positions L2086
- 改: (a) node 收益现跟 oracle 捆绑 → 出 `/api/node/income/:pk` 或在 oracle income 里拆出 node 份额独立可查（parse outputs_json 委员 position，node 份额）; (b) bettor my-positions 的 actual_payout 改读链（kaspa_tx_log.outputs_json）非 DB metadata（对照 broker earnings L233 的链验写法）。
- 边界: 链验铁律——parse outputs_json 真值，不信 DB 记账（这程 DB 骗 4 次）。
- 验收(Bettor): node 收益可独立查且链验对死；bettor payout 链上核证（拿一个 completed 市场对 claim_txid）。

### 【NWT / J1】链/relay — 进行中
**T7 — escrow push（e0b075ba 已 4 项全绿）** + **Track B 自治委员 daemon**（production-trustless 硬化，进行中，非本轮新增）。

### 【Bettor 自己】
- 协调 + 逐项验收（每件按上面"验收"栏链上/实测核）。
- **introducer 全机制设计稿**（Phase B）: 注册（谁是 introducer）+ 归属（谁介绍谁，bet 时带 introducer_pk）+ 链锚（fee_recipients_commit 烤 introducer 地址）+ 显示。并行起草，不阻塞 T1-T6。

---

## 2. 依赖图
- 独立并行: T1, T2, T3, T5, T6, T7 — 立即开。
- T4 依赖 T6（node 端点出了才显示）。
- introducer 显示依赖 Bettor 设计稿（Phase B）。

## 3. 验收总纲
每件 Bettor 亲验（verify-not-echo）: UI/bot 件实测走一遍；后端件链上核证（outputs_json/claim_txid，不信 DB）；改码件过 `node scripts/lint-kanet.mjs`。修 bug 同步加 regression case。
