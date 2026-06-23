# 两线分立·预测市场 ≠ 预言机系统·方案 (= 待 Bettor 关 1 审 + Owner 终裁)

> Owner 2026-06-06 20:52 钦定: "预言机系统和预测市场本身就是两条相对独立的线."
> Owner 实证: /oracle 现是预言机系统页, 但我 22fd27d 把 sidebar "预测市场" link 直接指 /oracle = **两线混淆**, 错.

## 1. 架构理念 (= Owner 钦定基础原则)

**线 A: 预言机系统** (Oracle System)
- 定位: oracle 角色生命周期 + oracle 池治理 + 信任度评分
- 用户视角: "我想成为 oracle / 看池子健康度 / 看 oracle 信任记录"
- 数据源: `oracle_stake_enrollments` (= chain-derived 单源, #21 焊死) + `oracle_pool_chain_view` (= 快照) + `oracle_registry` (= 元数据 tier/cap)
- 现页面: `/oracle` (oracle-home.eta) — 含信任系统 + 池透明 + 我的 oracle 角色

**线 B: 预测市场** (Prediction Market)
- 定位: pool 押注 + maker 出题 + 仲裁结果 + 三方分账
- 用户视角: "我想看有什么市场 / 押注 / 出题 / 看结果"
- 数据源: `pool_markets` + `pool_bettor_sides` + `chain_events`
- 现页面: **缺独立顶级 page** (= 我之前指 /oracle 错了)

**两线交点 (= 不混淆)**:
- 市场仲裁时 voter 调 oracle 池 API 获取 active committee — 数据流向是 "市场 → 调用 oracle 系统"
- 市场表只存 committee_pks 引用, 不存 oracle 详情
- = 两线在 backend 有 dependency, 但 UI/UX 必须分立

## 2. 现状错位审计

| 现状 | 问题 |
|---|---|
| sidebar "预测市场" → /oracle | **混线**: 把线 B 入口指到线 A 页 |
| /oracle = oracle-home.eta 含两层 (信任系统 + pool 市场表) | **页内混线**: 一页同时显两线信息 |
| /predictions → 302 /legacy/polymarket-escrow (= 件 1 ship) | **线 B 顶级入口空着**, 没显 pool_markets list |
| sidebar Agent ▶ "Oracle" 子项 → /oracle | **重复**: 同 link 在 Agent + Markets 两处出 |
| /predictions/pool/create = 发起预测表单 | OK (= 线 B) |
| /predictions/pool/:id = 市场详情 + 证据链 | OK (= 线 B) |
| /my-markets = 件 2 ship (= 我的 maker_relay_id markets) | OK (= 线 B) |

## 3. 方案 (= 两线分立)

### sidebar 新布局

```
1. 聊天                  → /chat
2. 联系人                → /contacts
3. 资产                  → /portfolio
4. Agent ▶
   - 总览                → /agent
   - 我的 oracle 角色    → /agent?tab=oracle (= 注册 modal 已 ship b37a7ed)
   - 我的 broker 角色    → /broker
   - 身份                → /agent?tab=card
   - 行为                → /skills
   - 等审批              → /approvals
5. 预言机系统 ▶          → /oracle (= 线 A, 信任+池+治理)
6. 预测市场 ▶            ← **顶级独立, 不指 /oracle**
   - 看市场              → /predictions (= 待新建独立 page)
   - 发起预测            → /predictions/pool/create
   - 我的市场            → /my-markets (= 件 2 ship)
7. 兑换 ▶                → /exchange
8. 设置 ▶                → /settings
```

= **预言机系统** 与 **预测市场** 各自顶级, 独立线.

### /predictions 新页内容 (= 线 B 主入口)

新建 `src/ui/predictions-list.eta` (或重做 predictions.eta 现旧 Polymarket 1v1 那段已迁 /legacy):
- pool_markets list (= 复用 oracle-home.eta 现 pool 市场表的 render component)
- filter: 全部 / 进行中 / 已结算 / 取消
- 排序: 最新 / 截止时间 / 池子大小
- 每行点击 → /predictions/pool/<id> 详情页
- 顶部 "+ 发起预测" 按钮 → /predictions/pool/create
- 顶部 "看自己建的" 按钮 → /my-markets

### /oracle 页保留 (= 线 A)

不动. oracle-home.eta 仍包含:
- ② 池透明 (= chain_view canonical, 8b54e20 ship 过)
- ③ onboarding (= 信任范式教学)
- 我的 oracle 注册入口 (= 已嵌 agent-v2.eta modal)
- 委员信任度 + 池健康度

**但**: oracle-home.eta L113 起的 "链上证据 (= pool 市场表)" section 移除或移到 /predictions, 让 /oracle 真纯 oracle 域.

## 4. 实施 step (= 不动 backend, 全 UI + routes)

1. **新建 src/ui/predictions-list.eta** — Alpine.js 页拉 /api/pool/markets (= 现 endpoint 不动), 显 pool 市场 list + 详情链接. ~30 min code.
2. **src/api/stocks.js**: 现 /predictions 302 → /legacy (件1 ship). 修改: /predictions 改服新 predictions-list view, /legacy/polymarket-escrow 保不动. ~5 min.
3. **src/ui/oracle-home.eta**: 移除 pool 市场表 section, 仅保 oracle 信任系统部分. ~15 min.
4. **src/ui/partials/sidebar.eta**: 重排 "预言机系统" 顶 + "预测市场" 顶 (子: 看市场/发起预测/我的市场). 删旧 "市场 ▶" 段, 重建. ~10 min.

总 ~1 hour code. 0 backend, 0 endpoint 改, 0 SS 改, 0 数据破坏.

**先后**: step 1 + 2 一起 (= 新页起来) → step 3 (= /oracle 清理) → step 4 (= sidebar 重排).

## 5. 风险 + 诚实边界

- 旧 /oracle bookmark 用户预期: 看到 pool 市场列表 — 拿走会失望. 缓解: /oracle 保留指向 /predictions 的提示 link "看市场清单 →".
- /oracle 上 "信任范式教学" 等 onboarding 内容跟 /predictions 怎么衔接 — 单独议题, 待 r570 funnel 一起讨论.
- 件 2 /my-markets 现在 sidebar 加在哪个顶级 — 跟新布局对齐 (= 预测市场 ▶ 子项).

## 6. 待审

**Bettor 关 1 角度**:
- (i) 方向: 两线分立 = 修架构 bug, 不是新功能扩张?
- (ii) 复用: 全 reuse existing UI components + 0 backend, 风险低?
- (iii) 跨域影响: oracle-home.eta 拆分 pool 市场表 — 影响现 /oracle 用户书签?
- (iv) 测试: NWT 影响清单?

**Owner 终裁**:
1. 方向是不是?
2. 实施顺序认可? (= 件 2 已 ship 在线 B 子, 本提案在线 B 顶级新建独立 page)
3. 排期: 立刻做 / 等 r581 议题收口后做 / 等 D9 主线后做?

**我等共识不冲动**.
