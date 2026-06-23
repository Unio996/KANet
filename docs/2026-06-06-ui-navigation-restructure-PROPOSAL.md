# KANet UI 导航梳理 + 重构方案

> Owner 2026-06-06 17:09 钦定: "你看看你构建菜单? 英文+中文, 这两个放在一级? 预测市场主页面是人看的吗? 简直是灾难!"
> 编辑: KANet-UI doc-owner. 不再单方改 sidebar, 先梳理 + 方案提议 → Owner 终裁后实施.

## 1. 现状梳理 (全 page 清单 + sidebar)

### 1.1 现有 sidebar (5 顶级 + 子项)

```
1. Chat            → /chat
2. Contacts        → /contacts (社交圈+Discovery 合并)
3. Portfolio       → /portfolio
4. Agents ▶
   - Overview      → /agent
   - Oracle        → /oracle        ← 我 ac39593 提到顶 (Owner 钦定关键)
   - Broker        → /broker        ← 同上
   - Identity      → /agent?tab=card
   - Behavior      → /skills
   - Approvals     → /approvals
5. 市场 ▶ (我 22fd27d 改中文, 现遭 Owner 怒)
   - 兑换           → /exchange
   - 预测市场       → /oracle        ← 我冲动改, 与 Agents>Oracle 撞 link
   - 建市场         → /predictions/pool/create
6. Settings ▶
   - Network / Relays / Adapters / Language
```

**Owner 怒点**:
- 英中混 (i): Agents/Markets 顶级英文, 子项 "建市场" 中文
- 英中混 (ii): Predictions 英 + 建市场 中并列
- 同 link 重复: /oracle 在 Agents>Oracle (= oracle 角色注册) **和** Markets>预测市场 (= pool 市场列表) 都指 — 意图分裂
- /predictions 旧页 (Polymarket 1v1 escrow Phase 4a) 是 chaos 不是 pool 域, 但 sidebar 之前 link 它

### 1.2 全 page 路由清单 (= 我用户视角分类)

| 路由 | .eta | 真用途 | 用户域 |
|---|---|---|---|
| `/chat` | chat-v3 | 跨 relay 群聊 + 公开频道 | A. 社交沟通 |
| `/contacts` | contacts | 联系人 + 加好友 | A. 社交沟通 |
| `/handshakes` | handshakes | 握手历史 | A. 社交沟通 |
| `/conversation/:id` | conversation | 单对话查看 | A. 社交沟通 |
| `/conversations` | conversations | 历史对话列表 | A. 社交沟通 |
| `/discovered` | discovered | 链上发现的 peer | A. 社交沟通 |
| `/graph` | graph | 网络图 | A. 社交沟通 |
| `/story` | story | 时间线故事 | A. 社交沟通 |
| `/portfolio` | (portfolio) | 资产持仓 | B. 资产/钱包 |
| `/ledger` | ledger | 链上账本 | B. 资产/钱包 |
| `/agent` | agent-v2 | Agent 总览 + Identity/Behavior/Oracle 注册 modal | C. Agent 配置 |
| `/skills` | skills | Behavior 配置 | C. Agent 配置 |
| `/oracle` | oracle-home | **Oracle 信任系统 + Pool 池+市场表** (混 oracle 角色与池预测) | C/D. 混 |
| `/broker` | broker-home | broker 角色管理 | C. Agent 配置 |
| `/approvals` | approvals | 等待审批 | C. Agent 配置 |
| `/agent-status` | agent-status | agent 运行状态 | C. Agent 配置 |
| `/agent-history` | agent-history | agent 历史 | C. Agent 配置 |
| `/identities` | identities | 身份管理 | C. Agent 配置 |
| `/exchange` | exchange | KAS↔USDT 兑换 | D. 市场交易 |
| `/predictions` | predictions | **Polymarket 1v1 SS escrow Phase 4a** (= 旧, chaos) | D. 市场交易 |
| `/predictions/pool/create` | predictions-pool-create | **Pool 预测市场 建市场表单** | D. 市场交易 |
| `/predictions/pool/:id` | predictions-pool-detail | **Pool 预测市场 详情+证据链** | D. 市场交易 |
| `/predictions/oracle-registry` | (302 → /oracle) | redirect | D. 市场交易 |
| `/exchange` | exchange | 现 OTC + auto-pay | D. 市场交易 |
| `/trading` | trading | (= 大概 1v1 escrow 旧) | D. 市场交易 |
| `/stocks` | stocks | 股票 (= 不在 pool 域) | D. 市场交易 |
| `/hyperliquid` | hyperliquid | HL 永续合约 | D. 市场交易 |
| `/aevo` | aevo | Aevo 期权 | D. 市场交易 |
| `/aave` | aave | Aave 借贷 | D. 市场交易 |
| `/relays` | relays | relay 管理 | E. 设置 |
| `/adapters` | adapters | LLM adapter 管理 | E. 设置 |
| `/network` | network | 链/RPC 设置 | E. 设置 |
| `/audit` | (audit dashboard) | 审计监控 | E. 设置 |
| `/whale-signal` | whale-signal | 大户信号 (= unclear) | ? |
| `/welcome-dev` | welcome-dev | onboarding 教学 | F. onboarding |
| `/faucet` | faucet | 测试币龙头 | F. onboarding |
| `/digest-viewer` | digest-viewer | 周报浏览 | F. onboarding |
| `/dashboard` | dashboard | overview dashboard | F. onboarding |

= ~35 路由分 5-6 域. sidebar 只暴 ~15. 其他要么 redirect 要么藏.

## 2. 核心混乱根因

1. **域错位**: `/oracle` 单页混 (a) oracle 信任角色管理 + (b) pool 市场列表 → 两个用户意图同 page 互骚扰.
2. **路由命名错指**: `/predictions` 指 Polymarket 1v1 SS escrow Phase 4a (= 旧实验, 不是用户主旅程), 但名字暗示是预测市场主页. 实际 pool 预测市场是 `/predictions/pool/*` 子路由.
3. **入口分散**: pool 建市场 `/predictions/pool/create` + pool 列表 `/oracle` + pool 详情 `/predictions/pool/:id` → 3 个不同顶级前缀, 用户找不到全貌.
4. **多市场域并列**: pool 预测 + 1v1 escrow + Polymarket + Hyperliquid + Aevo + Aave + stocks → 用户搞不清各域关系 (= 都是"市场" 但完全不同 protocol).
5. **sidebar 英中混**: Agents/Markets 英 + 建市场/兑换/预测市场 中 → 跳跃.
6. **演示展示主入口不明**: KANet 真实演示主线是 pool 预测市场 (Owner 钦定终点 = 4-of-5 settle 跨节点), 但 sidebar 没有突出"看演示 demo"的顶级入口.

## 3. 方案候选 (4 个, 我推荐 B)

### 方案 A: 全删非 pool 域 + 极简
- 删 sidebar `/predictions /trading /stocks /hyperliquid /aevo /aave`
- 留: Chat / Contacts / Agent / **预测市场 (= pool 主)** / 设置
- 优: 极简, 直击 KANet 真演示线
- 劣: 删 demo agents 已 ship 的 HL/Aave/Aevo 等 (= 历史功能丢)

### 方案 B (推荐): 重命名 + 拆 /predictions + pool 域提为一级
**sidebar 全中文**:
```
1. 聊天          → /chat
2. 联系人        → /contacts
3. 资产          → /portfolio
4. Agent ▶
   - 总览        → /agent
   - 我的 Oracle 角色 → /agent?tab=oracle (= 注册 modal, b37a7ed 已 ship)
   - 我的 Broker 角色 → /broker
   - 身份        → /agent?tab=card
   - 行为        → /skills
   - 等审批      → /approvals
5. 预测市场 ▶   ← 顶级提升 (= KANet 真演示)
   - 市场列表    → /oracle    (= rename: oracle-home 改 prediction-home)
   - 建市场      → /predictions/pool/create
   - (空状态时显教程深链)
6. 其他市场 ▶  (= 收 demo agents 历史功能)
   - 兑换 KAS↔USDT → /exchange
   - 永续 (Hyperliquid)→ /hyperliquid
   - 期权 (Aevo)  → /aevo
   - 借贷 (Aave)  → /aave
   - (1v1 SS escrow 实验 Phase 4a — 归档隐藏 OR 子菜单显)
7. 设置 ▶
   - 网络 / Relay / 适配器 / 语言
```
- **关键**: rename `/oracle` → 改路由到 `/predictions` (= 让真"预测市场主页"返回 pool 池+市场列表), 旧 Polymarket 1v1 escrow 归档/重命名到 `/legacy/1v1-escrow`.
- 优: 中文统一; pool 域提为一级凸显 KANet 主演示; oracle 角色管理在 Agent 域不与市场列表混; 其他 demo 市场聚拢避杂.
- 劣: 路由迁移 (= 加 302 redirect 旧 link 不 break); /oracle.eta 拆 (= oracle 角色管理那段保留在 Agent 域).

### 方案 C: 保留双页 + 命名清晰
- 不改路由
- sidebar 顶级中文统一 + 子项中文统一
- "预测市场" 子分 "Pool 池预测" / "1v1 SS escrow" 显式区分两类
- 优: 不动路由零 redirect 风险
- 劣: 双页并列仍混乱; "1v1 SS escrow" 实际是旧实验不该平等显示

### 方案 D: 全推倒重做 sidebar 信息架构
- 召集团队头脑风暴 + Owner 终裁
- 长期方案
- 优: 一次到位
- 劣: 时间长, 影响 demo cycle

## 4. 推荐 B 理由 + 实施 step

B 比 A 软 (保留历史 demo) 比 C 干净 (路由真迁移, pool 主入口清). 实施分 5 步, 每步 commit + ④:

1. 重命名 sidebar 全中文 + 重排 (= 不动路由) — 5 min
2. /predictions/pool/create 重排到顶级菜单 "建市场" 子项 — 已 ship
3. oracle-home.eta 拆分: pool 市场列表部分 → 移到新 prediction-home.eta `/predictions` (新路由, 302 旧 /predictions Polymarket → /legacy/polymarket-escrow); oracle 角色信任部分留 oracle-home.eta `/oracle` (仅 Agent 域查) — 30 min
4. Agent 域 Oracle 子项 link 改 `/agent?tab=oracle` (= 注册 modal 已 ship), 避免与市场域 link 重复 — 5 min
5. 旧 `/predictions` Polymarket 加 302 redirect → `/legacy/polymarket-escrow` (= 不删, 仅归档命名, 历史 link 不 break) — 5 min

总改: ~1 hour, 风险低 (= 全 302 兼容 + eta 拆分).

## 5. 各 agent 出立场 (待发起讨论)

- **@Bettor 协调**: 这是 UI 域优先级 OR 钉 D7 主线先?
- **@J2-tn**: settler/api 视角, oracle-home 拆开有无影响 settler 用 endpoint?
- **@J1tn**: 跨节点 demo 时 sidebar 改命有无碰节点同步?
- **@NWT-tn**: 测试 harness 用了哪些 page 路由?
- **@Owner**: 方向终裁 — A/B/C/D 哪个? 或全否 (= 另方案)?

## 6. 紧急回滚

我 22fd27d 冲动 ship sidebar 中文化 + /oracle link 是单方案推. **若 Owner 钦定别的方向, 我立即 revert 22fd27d**, 再走方案落地.
