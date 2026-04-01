# UI 统一实施方案

> 收官阶段 UI 迁移计划。目标：所有活跃页面统一使用 page-open/page-close partial + warm/ink/brand 设计系统。
> 旧页面保留不删，新页面用新路由验证通过后再切换。

---

## 现状

- **已迁移（11 页）：** agent-v2, agent, chat-v3, contacts, explore, graph, handshakes, market-overview, predictions, stocks, story
- **待迁移（15 页）：** 分四个 Phase

---

## Phase 1 — 换壳（3 页，最小改动）

conversation、discovered、skills 已经在用 warm/ink/brand 色系，只是各自写了 DOCTYPE + head + sidebar 而没有用共享 partial。

### 改动模式（三个文件相同）

**替换：** 每个文件的 DOCTYPE → sidebar 结束之间的代码（约 80-110 行），换成：
```eta
<%~ include('partials/page-open', { _page: 'xxx', pageTitle: 'yyy', ...it }) %>
```

**保留：** 文件特有的自定义 CSS（如 conversation.eta 的 thinking-dots 动画和 custom-scroll 样式），移到 `<style>` 块内嵌在 page-open 之后。

**替换：** 文件末尾的 `</main></div></body></html>`，换成：
```eta
<%~ include('partials/page-close', it) %>
```

### 具体文件

| 文件 | 当前 HEAD 行数 | 自定义 CSS | 侧边栏行数 | 内容起始行 |
|------|--------------|-----------|-----------|----------|
| conversation.eta | 1-46 | thinking-dots + custom-scroll | 49-108 | 143 |
| discovered.eta | 1-21 | 仅 [x-cloak] | 25-83 | 96 |
| skills.eta | 1-20 | 仅 [x-cloak] | 24-76 | 98 |

### 验证

每个文件改完后刷新页面，检查：
- 侧边栏导航高亮正确（`_page` 参数）
- 页面内容渲染正常
- 自定义功能正常（conversation 的思考动画、skills 的分类管理）

---

## Phase 2 — 常规迁移（8 页核心页面）

这些页面用旧灰色设计（bg-gray-100 body + bg-gray-900 sidebar），需要完整换壳 + 换色。

### 改动模式

1. **替换 HEAD + SIDEBAR**（同 Phase 1）
2. **颜色映射** — 不是逐个替换，而是按语义映射：

| 旧色（gray） | 新色（warm/ink） | 用途 |
|-------------|-----------------|------|
| bg-gray-100 | bg-warm-50 | 页面背景 |
| bg-gray-900 | （由 sidebar partial 处理） | 侧边栏 |
| bg-white | bg-white | 卡片背景（不变） |
| bg-gray-50 | bg-warm-100 | 表头/交替行 |
| text-gray-800 | text-ink-700 | 主标题 |
| text-gray-600 | text-ink-500 | 正文 |
| text-gray-400 | text-ink-300 | 次要文字 |
| border-gray-200 | border-warm-200 | 卡片边框 |
| border-gray-300 | border-warm-300 | 表单边框 |
| bg-blue-600 | bg-brand-500 | 主按钮 |
| hover:bg-blue-700 | hover:bg-brand-600 | 按钮 hover |
| focus:ring-blue-500 | focus:ring-brand-500 | 焦点环 |

3. **语义色不动** — success(green)、warning(amber/yellow)、error(red) 保持 Tailwind 原色

### 迁移顺序（按用户使用频率）

| # | 页面 | 行数 | 特殊处理 | 依赖 |
|---|------|------|---------|------|
| 1 | events.eta | 246 | 有 HTMX 引用，需确认 page-open 是否包含 | 无 |
| 2 | conversations.eta | 206 | 有 HTMX；列表+分页 | 无 |
| 3 | identities.eta | 390 | 信任等级 badge 颜色需保留语义 | 无 |
| 4 | network.eta | 289 | 有动画 spinner + ping 指示器 | 无 |
| 5 | dashboard.eta | 206 | 有 HTMX；统计卡片网格 | 无 |
| 6 | adapters.eta | 452 | **无 Alpine.js** — 需确认 page-open 是否引入 | 无 |
| 7 | relays.eta | 664 | 最复杂：转账 modal、助记词显示、节点配置 | 无 |
| 8 | welcome.eta | 229 | **无侧边栏** — 全屏居中布局，特殊处理 | 无 |

### HTMX 处理

events、conversations、dashboard 用了 HTMX。page-open/head.eta 目前**不包含 HTMX**。两个选项：
- A: 在 head.eta 加入 HTMX CDN（如果多页需要）
- B: 在这三个页面的 page-open 后单独加 `<script src="htmx...">`

建议选 B — 不影响其他页面。

### welcome.eta 特殊处理

welcome 是全屏 onboarding 页，没有侧边栏。当前用深色背景（bg-gray-950）。两个选项：
- A: 不迁移，保持独立（它只用一次，且风格确实应该不同）
- B: 迁移到设计系统但不加侧边栏

建议选 A — welcome 是第一印象页面，可以有自己的风格。仅做颜色微调（gray-950 → 品牌深色）。

### 每页验证

改完每页后检查：
- 侧边栏渲染 + 高亮
- 卡片/表格/表单的颜色协调
- badge 和 status 指示器颜色正确
- 交互功能正常（Alpine.js 数据绑定、表单提交、模态框）
- 无 JS 控制台报错

---

## Phase 3 — 大页面全新设计（2 页）

trading.eta（2906 行）和 market.eta（1049 行）太大，不能简单换壳。全新设计，旧页面保留。

### trading-v2 设计

**当前问题：**
- 53+ 个状态属性在一个 x-data 里
- 4 个不同功能域混在一起（交易所管理、OTC 市场、快速交易、审批流）
- 35+ API 调用散落各处

**新设计原则：**
- 用 page-open/page-close
- 拆成独立 partial 组件
- 每个组件独立 x-data，通过 Alpine.js $dispatch 通信

**组件拆分：**

| 组件 | 预估行数 | 职责 |
|------|---------|------|
| trading-v2.eta | ~100 | 主壳：tabs + 组件组装 |
| partials/trade-portfolio.eta | ~200 | 持仓概览：KAS/USDT 余额、基线、鲸鱼提醒 |
| partials/trade-exchange.eta | ~200 | 交易所账户管理：添加/测试/选择 |
| partials/trade-agent-mode.eta | ~80 | Agent 模式选择器：auto/approval/manual |
| partials/trade-quick.eta | ~150 | 快速交易面板：买/卖 + Agent 建议 |
| partials/trade-otc-orders.eta | ~250 | OTC 订单列表 + 发布表单 |
| partials/trade-deal.eta | ~200 | 活跃交易详情 + 审批 + 聊天 |
| partials/trade-triggers.eta | ~80 | Proactive/Reflection 触发器 |

**路由：** `GET /trading-v2` → trading-v2.eta，旧 `/trading` 不动。

### market-v2 设计

**当前 market.eta** 是自定义深色主题（cyan 主色），和全系统设计语言不一致。

**新设计：**
- 用 page-open/page-close（亮色暖调）
- 保留左右分栏布局（订单列表 | 交易详情）
- 拆分组件：

| 组件 | 预估行数 | 职责 |
|------|---------|------|
| market-v2.eta | ~80 | 主壳：左右分栏 |
| partials/market-orders.eta | ~200 | 订单列表：market/history tabs + 分页 |
| partials/market-deal.eta | ~250 | 交易详情：pipeline + 聊天 + 操作按钮 |
| partials/market-wallet.eta | ~100 | 底部钱包栏 |

**路由：** `GET /market-v2` → market-v2.eta，旧 `/market` 不动。

### 验证

- 旧页面全部功能不受影响
- 新页面所有 API 调用正常
- 新页面在 1280px / 1920px 宽度下布局合理
- Alpine.js 组件间通信正常

---

## Phase 4 — 清理

确认新页面稳定运行后执行：

| 操作 | 说明 |
|------|------|
| 删除 chat.eta | 已被 chat-v3.eta 完全替代，`/chat` 路由指向 chat-v3 |
| 删除 whale-signal.eta | 功能不完整的空壳，whale signal 数据在 market-overview 已展示 |
| 删除 settings.eta | 路由已重定向到 `/relays` |
| 删除 audit.eta | 路由已重定向到 `/contacts` |
| 删除 layout.eta | 旧模板包装器，33 行，无引用 |
| 删除 adapter.eta（单数） | 单 adapter 视图，203 行，未完成 |
| 删除 trading-v2-prototype*.html | 原型文件，已完成使命 |
| 路由切换 | `/trading` → trading-v2.eta，`/market` → market-v2.eta |
| 旧页面归档 | trading.eta → trading-legacy.eta，market.eta → market-legacy.eta |

---

## 工作量估算

| Phase | 页面数 | 预估改动 | 风险 |
|-------|--------|---------|------|
| Phase 1 | 3 | 每页 ~20 分钟 | 低 — 只换壳 |
| Phase 2 | 8 | 每页 30-60 分钟 | 中 — 换色可能漏改 |
| Phase 3 | 2 | 各 2-4 小时 | 高 — 全新设计 + 拆分 |
| Phase 4 | 7 删除 + 2 切换 | 30 分钟 | 低 — 但需确认无引用 |

---

## 侧边栏导航统一

当前 sidebar.eta 的导航项需要确认和现有旧侧边栏一致。旧侧边栏普遍有：

```
我的 Agent (/agent)
会话 (/conversations)
通讯录 (/identities)
网络分析 (/network)
轻松聊天 (/chat)
── 设置 ──
  Events (/events)
  Relays (/relays)
  Adapters (/adapters)
```

新 sidebar.eta 需要覆盖所有页面路由，且高亮当前页。检查 `_page` 参数映射是否完整。

---

## 不做的事

- **不做 i18n** — 收官阶段不大规模做翻译，保持现状（中文为主 + 部分 it.t）
- **不做移动端适配** — 这是桌面客户端，移动端不是优先
- **不做深色模式** — 统一暖白亮色
- **不重写业务逻辑** — UI 迁移只改展示层，不改 API 调用和数据流
