> **Status**: CURRENT（v0.2）— 第一步交付(范围稿 §4 KANet-UI 行)。v0.1 已 Bettor GREEN 入账 (1326)；v0.2 按 Bettor (1328) 裁定改路线：市场创建/浏览/下注/claim 改走独立新路由 `/proto-markets/*`，**零改动** `predictions-pool-create.eta`/`predictions-pool-detail.eta`/`predictions.eta`/tg-bot（见 §2/§3/§4 更正）。五屏路由与页面已落码（前端 UI 已提交，后端端点均待 J2）：`/tokens`、`/tokens/create`、`/proto-markets`、`/proto-markets/create`、`/proto-markets/:id`。

# 原型 v0 线框稿：代币创建 + 市场创建/浏览/下注/claim

出处：`docs/2026-09-14-bettor-prototype-v0-scope-token-market-ui.md` §4 KANet-UI 行。

## 0. 总体信息架构（v0.2 更正：全部走独立新路由，不扩展既有生产页）

**v0.1 的假设已推翻**：原计划"市场创建/浏览/下注/claim 复用并扩展既有 4 个预测市场页面"，动手前核实发现 `predictions-pool-create.eta`（989 行）不是轻量遗留页，而是**当前生产 bshard/ZK 结算管线的真实入口**（POST `/api/pool/market/create`，内嵌 `/api/pool/prevet`/`/api/pool/prevet-extract`/oracle 委员会 registry/Polymarket 搜索，34 处协议引用），且 `sidebar.eta:81-85` 注释证实它被**刻意从导航隐藏**——现在 KANet 预测系统的主用户面是 Telegram bot，这个 console 页是内部/maker 工具。范围稿 §2 也明确 v0 该走"非 ZK 简单 claim/refund 路径"，不该挂在这条被反复加固的重载生产链上。Bettor (1328) 裁定：另起独立新页 + 独立路由前缀，对四个既有页面（含 tg-bot）**零改动**。

**五屏落地路由**：

| 屏 | 路由 | 状态 |
|---|---|---|
| 代币创建 | `GET /tokens/create` | 前端已提交 |
| 代币列表（给市场创建选代币用） | `GET /tokens` | 前端已提交 |
| 市场创建 | `GET /proto-markets/create` | 前端已提交 |
| 市场列表 | `GET /proto-markets` | 前端已提交 |
| 市场详情（下注 + 结算/claim 合并一屏） | `GET /proto-markets/:id` | 前端已提交 |

导航：侧边栏"市场"分组下新增两个平级入口——「代币」「市场（原型）」，不进原有"预测市场▶"子菜单（那个子菜单指向 `predictions-pool-*` 生产管线，语义上不相关）。

**样式基线**：全部复用 `partials/page-open`/`page-close` + 本仓通用 `card`/`btn`/`btn-primary`/`btn-ghost` 设计令牌（同 `my-markets.eta`/`market-v2.eta` 的朴素风格），不引入 `predictions-pool-create.eta` 那套 Fraunces/金色 Editorial 定制样式——范围稿明确"不求好看"，用全站默认令牌足够，也避免和那个页面产生视觉/代码耦合。

---

## 1. 代币创建界面 — `/tokens/create`（新页，已落码 `tokens-create.eta`）

### 字段（已用 `kasia-console/src/lib/sil-v1/KanetTestToken.sil` ctor 核对，非猜测）

合约 ctor 七项里，只有下面这些是**用户需要有意义填的**，其余（`market_tmpl_suffix`/`max_ins`/`max_outs` 等协议常量）后端钉死、界面不暴露：

| 界面字段 | 对应链上/DB | 说明 |
|---|---|---|
| 出单人（选择已有 agent/relay） | `init_owner` = 所选 agent 的 covenant-id | 下拉，`it.relayNodes` 过滤非 oracle |
| 发行数量 `init_amount` | 链上 state | 数字输入，必填，>0 |
| 代币名称 | DB only（链上没有这字段） | 文本输入 |
| Ticker（如 `KTT`） | DB only | 文本输入，≤6 位，自动转大写 |
| 说明/描述（可选） | DB only | 文本域 |

**后端钉死、界面不填**：`init_owner_scheme`=`0x04`（固定 covenant-id）、`init_borrow_scheme`=`0x00`（固定 disabled）、`init_borrow_guard`/`init_extension_commitment`=全零、`market_tmpl_suffix`+长度、`max_ins`/`max_outs`——协议级常量，J2 后端 API 直接填，界面完全不出现。

### 流程/状态（已实现）

1. 空表单（出单人 + 数量 + 名称 + ticker + 描述）
2. 提交 → `POST /api/tokens/create`（J2 待建），"创建中"禁用态
3. 完成态：✓ 已创建 + TX 摘要 + 「查看代币列表」/「再造一个」
4. 失败态：如实显示错误（含 404 时的"后端接口尚未上线"提示），不假装成功、不清空已填字段

### `/tokens`（代币列表，已实现）

给市场创建"选一个已创建的代币"用。表格：名称/ticker/发行量/出单人/创建时间，样式对齐 `my-markets.eta`。`GET /api/tokens`（J2 待建）失败/空态均如实显示。

---

## 2. 市场创建界面 — `/proto-markets/create`（新页，已落码 `proto-market-create.eta`）

**v0.2 更正**：不再扩展 `predictions-pool-create.eta`（原因见 §0）。全新简单表单：

| 字段 | 说明 |
|---|---|
| 结算代币 | 下拉，来源 `GET /api/tokens` |
| 议题标题 | 文本，≤140 字 |
| 截止时间 | `datetime-local` |
| 结算说明（可选） | 文本域，怎么判 YES/NO |

**结算模型（v0，非 ZK 简单路径，对齐范围稿 §2）**：出单人到期后手动宣布 YES/NO 结果；赢家凭结果 claim；到期无人宣布则全员 refund。不接 oracle 委员会、不接 ZK proof。这是前端已经假定的最小协议模型，**J2 若认为需要调整字段/流程，直接改（不是钉死的接口契约）**。

提交 → `POST /api/proto-markets/create`（J2 待建）。完成态/失败态处理同 §1。

---

## 3. 市场浏览 — `/proto-markets`（新页，已落码 `proto-market-list.eta`）

表格：议题/代币/状态（押注中/等待结算/已结算/已退款）/截止时间/详情链接。`GET /api/proto-markets`（J2 待建）。

## 3b. 下注界面 — `/proto-markets/:id` 详情页的"下注"面板（已落码 `proto-market-detail.eta`）

**v0.2 更正**：不再扩展 `predictions-pool-detail.eta`（原因见 §0）。合并进详情页（见 §4）：`open` 态显示 YES/NO 选边 + 数量输入 + 提交，`POST /proto-markets/:id/bet`（J2 待建）。

---

## 4. 结算/领取界面 — `/proto-markets/:id` 详情页的"宣布结果"+"领取"面板（已落码，同一文件）

**v0.2 更正**：不再扩展 `my-markets.eta`。市场详情页三个条件面板，同一页面按状态切换：

1. **出单人宣布结果**（`open`/`closed` 态）：YES 赢 / NO 赢 两个按钮，`POST /proto-markets/:id/resolve`（J2 待建，后端须校验调用者=该市场出单人，前端不做权限判断，只如实显示后端返回的拒绝）
2. **领取**（`resolved`/`refunded` 态）：显示结果（或"无人宣布→refund"提示）+「Claim」按钮，`POST /proto-markets/:id/claim`（J2 待建）
3. claim/resolve 均为如实失败态，不预测成功

一个市场页承担"浏览详情 + 下注 + 出单人宣布结果 + 赢家 claim"四件事，比原范围稿设想的"独立 claim 屏"更省一次页面跳转，功能覆盖不变。

---

## 5. 与 §3 私钥边界的对应关系（自查，非 NWT 核）

五屏涉及的写操作全部是"构造 P2SH 创世/花费输出 + 广播"（走 J2 新端点），对应范围稿 §3"走市场/代币合约自己的花费逻辑"：

- 代币创建 / 市场创建 / 下注 / 宣布结果 / claim：均调用 J2 新端点，**没有一处新读 `/relays/*` 或 `/api/relay/*`**
- 出单人/agent 选择读 `relayNodes` 列表（公开地址信息，展示用），复用既有模式，不涉及私钥

---

## 6. 待确认 / 已确认清单

1. ~~`market.eta`/`market-v2.eta` vs `predictions.eta`/`predictions-pool-detail.eta` 对应关系订正~~ — **已确认**：Bettor 独立核实 `market-v2.eta`（"买入/卖出 KAS"、价格(USD) 字段）确系 OTC 订单簿，非预测下注页。
2. ~~路由改走独立前缀 `/proto-markets/*`，不扩展既有生产页~~ — **已裁定**（Bettor 1328 ①②③），已按此实现。
3. `/tokens`、`/tokens/create` 路由命名 — 已确认无冲突（Bettor 1328 ④）。
4. **待 J2**：五个后端端点契约（`POST /api/tokens/create`、`GET /api/tokens`、`POST /api/proto-markets/create`、`GET /api/proto-markets`、`GET /api/proto-markets/:id`、`POST /proto-markets/:id/{bet,resolve,claim}`）——本稿字段/流程是前端先行假设，接口细节以 J2 实际落地为准，前端随之调整。Bettor 已同步要求 J2：原型状态落新表，不写生产结算 daemon 轮询的表。
5. **待做**：真机验证（重启 console 加载新路由/模板，实际点一遍五屏渲染是否正常）——纯新增路由，风险低，但涉及重启现网 da9 mainnet console（持有热钱包私钥的活进程），何时重启待 Bettor 协调。
