# UI Component System — 开发者文档

## Fatal Traps

0. **不猜代码，查了再写。** 列名用 `PRAGMA table_info`，函数名用 grep，参数名看调用方。记忆不可信，代码是唯一真相。每次引用前先验证，零例外。

---

## 概述

KANet Console 的 UI 组件系统，基于 Eta 模板引擎的 partial include 机制 + Tailwind CSS + Alpine.js。

目标：新页面 5 行 boilerplate，设计语言统一，组件可复用。

## 设计系统 v2

四原则：**实用、简洁、高效、清晰**。

### 色板

```
backgrounds  warm-50 #faf9f7 / warm-100 #f7f6f3 / warm-200 #efeee9 / warm-300 #e4e2dc
text         ink-300 #9496a1 / ink-400 #6b6d7b / ink-500 #4a4b57 / ink-600 #2d2e3a / ink-700 #1a1a2e
brand        brand-50 #eff6ff / brand-100 #dbeafe / brand-500 #3b82f6 / brand-600 #2563eb / brand-700 #1d4ed8
semantic     success #16a34a / warning #d97706 / error #dc2626 / info #2563eb
```

### 字体

- 正文：Inter, -apple-system, sans-serif
- 链上数据：system monospace

## 文件结构

```
src/ui/
  partials/
    head.eta          ← Tailwind config + Inter font + Alpine.js + kanet-ui.js + styles.eta
    sidebar.eta       ← 导航栏（自动高亮 it._page）
    styles.eta        ← 设计系统 CSS 类
    page-open.eta     ← 完整页面开头（include head + sidebar + header + main）
    page-close.eta    ← 页面闭合
  agent-v2.eta        ← 第一个使用组件系统的页面

public/
  kanet-ui.js         ← Alpine.js 全局工具库
```

## 创建新页面

```html
<%~ include('partials/page-open', { _page: 'mypage', pageTitle: '页面标题', ...it }) %>

<div class="p-6" x-data="{ /* Alpine state */ }">
  <!-- 页面内容 -->
</div>

<%~ include('partials/page-close', it) %>
```

page-open 提供：DOCTYPE + html + head（含 Tailwind/Alpine/fonts/kanet-ui.js/styles） + body + sidebar（自动高亮 `_page`） + main wrapper + header（显示 `pageTitle`）。

### 传入参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `_page` | string | 当前页面标识，sidebar 用于高亮当前项 |
| `pageTitle` | string | 页面标题，显示在 header |
| `headerRight` | string | header 右侧额外 HTML（可选） |
| `extraHead` | string | head 中额外 HTML（可选） |
| `extraScripts` | string | body 末尾额外 script（可选） |

## CSS 类（styles.eta）

### Status Dot
```html
<span class="status-dot green"></span>   <!-- 绿色实心圆 -->
<span class="status-dot yellow"></span>  <!-- 琥珀色 -->
<span class="status-dot red"></span>     <!-- 红色 -->
<span class="status-dot gray"></span>    <!-- 灰色 -->
```

### Badge
```html
<span class="badge badge-success">已完成</span>
<span class="badge badge-warning">进行中</span>
<span class="badge badge-error">争议中</span>
<span class="badge badge-info">信息</span>
<span class="badge badge-neutral">已取消</span>
```

### Card
```html
<div class="card">标准卡片（16px padding, 12px radius）</div>
<div class="card card-compact">紧凑（12px padding）</div>
<div class="card card-flush">无 padding（内部自行控制）</div>
```

### Button
```html
<button class="btn btn-primary">主要</button>
<button class="btn btn-secondary">次要</button>
<button class="btn btn-ghost">幽灵</button>
<button class="btn btn-danger">危险</button>
<button class="btn btn-sm btn-primary">小号</button>
```

### Tab
```html
<div class="tab-bar">
  <button class="tab-item active">当前</button>
  <button class="tab-item">其他</button>
</div>
```

### Order Status（左边框颜色）
```html
<div class="card order-published">蓝色</div>
<div class="card order-paying">琥珀色</div>
<div class="card order-completed">绿色</div>
<div class="card order-disputed">红色</div>
```

### Approval Card
```html
<div class="approval-card">琥珀色边框+背景，hover 微光，非打断式</div>
```

### Skeleton Loading
```html
<div class="skeleton" style="width:120px;height:14px;"></div>
```

### 三层可验证
```html
<div class="verify-layer-1">第一层：人话</div>
<div class="verify-layer-2">第二层：规则数据</div>
<div class="verify-layer-3">第三层：链上证据（monospace）</div>
```

## KANet.js 工具库（public/kanet-ui.js）

所有函数挂在 `window.KANet` 全局对象上，Alpine 模板中直接调用：

| 函数 | 用途 | 示例 |
|------|------|------|
| `KANet.shortAddr(addr, tail)` | 截断地址 | `kaspa:qz...last8` |
| `KANet.copy(text)` | 复制到剪贴板 | 返回 Promise |
| `KANet.relativeTime(iso)` | 相对时间 | `3 分钟前` / `昨天` |
| `KANet.formatKas(amount, decimals)` | 格式化金额 | `1,234.57` |
| `KANet.statusLabel(status)` | 订单状态中文 | `已完成` |
| `KANet.statusColor(status)` | 状态→语义色名 | `success` / `warning` |
| `KANet.healthDot(status)` | 健康→dot 色名 | `green` / `yellow` / `red` |
| `KANet.sideLabel(side)` | 买卖方向 | `买入` / `卖出` |
| `KANet.chainName(chain)` | 链名称 | `BNB Chain` |

## Sidebar 导航项

sidebar.eta 中的 `_page` 值对应高亮：

| `_page` 值 | 导航项 |
|------------|--------|
| `agent` | 我的 Agent |
| `conversations` / `conversation` | 会话 |
| `identities` | 通讯录 |
| `network` | 网络 |
| `chat` | 聊天 |
| `market` | 自由市场 |
| `events` | 活动日志 |
| `relays` / `relay` | 账户管理 |
| `adapters` / `adapter` | AI 引擎 |
| `skills` | 技能 |

## 反模式（不要）

- 渐变背景、毛玻璃效果
- Emoji 图标导航
- 纯装饰动画
- 第一层暴露技术细节
- 全圆角药丸按钮
- 暗色主题
- 交易终端或 AI 聊天机器人风格

## 下一步：三页整合

通讯录、会话、网络三个页面待用组件系统重做：
- 使用 page-open/page-close
- 使用 styles.eta + kanet-ui.js
- 与 episode 系统交叉链接
- 统一视觉语言

做完后，用户在任何页面都能回答：**"这个 Agent 和谁有关系，关系怎样，发生了什么。"**
