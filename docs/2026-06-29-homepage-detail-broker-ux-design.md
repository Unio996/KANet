# 首页→详情页+深链+DM 地址制 UX 设计文档

**派工**: Bettor 2026-06-29 01:37 (#yjt00s)  
**Owner 批评**: ①首页押注单子缺详情入口(巨大设计问题) ②broker 锚定地址·DM 管理挂 relay=结构性错  
**执行**: KANet-UI  
**v2 修订**: Bettor 复审 2 点——要改点 1(详情页主 CTA) + 要改点 2(nested \<a\> HTML bug)

---

## 现状问题

| # | 问题 | 根因 |
|---|------|------|
| 1 | 首页列单子但用户**点不进详情** | broker-home.eta ⑤历史 market card 无 `<a>` 链接 |
| 2 | 全局裸 TG 链接无上下文 | 复制整 bot 链接而非 `start=<marketId>` 参数化 |
| 3 | DM/bot 管理界面以 `relay_id` 锚定 broker | `tgBotBrokerId` 对比 `agent.id`(relay) 非 `broker_address` |

---

## (a) 首页 → 市场详情页 信息架构

### 目标流

```
首页(broker-home.eta ⑤历史)
  └─ market card [整卡可点→详情页]
        └─ /predictions/pool/:id  (已有路由·已有模板 predictions-pool-detail.eta)
              └─ 显眼"去 TG 押注"CTA (见 §d 新增)
```

### Card 改动(修正 nested \<a\> 问题)

**Bettor 要改点 2**: 原设计「整卡 `<a>` + 内部'详情'`<a>`」= nested `<a>` 非法 HTML。

**修正方案：整卡可点，去掉内部'详情'按钮**。

**broker-home.eta 第 272 行**，把每个 market row `<div>` 改成 `<a>` tag：

```diff
- <div class="flex items-center justify-between text-xs py-1.5 border-b ...">
+ <a :href="'/predictions/pool/' + m.id"
+    class="flex items-center justify-between text-xs py-1.5 border-b ...
+           hover:bg-warm-50 cursor-pointer transition-colors no-underline">
```

Card 显示内容（当前已有，保留不动）：
- 第一行：市场标题（specTitle 截 64 字符）
- 第二行：POOL · protocol_status · stake X KAS · fee Y%

**右侧操作按钮组**（使用 `@click.prevent` 避免触发外层 `<a>` 跳转）：
```html
<div class="ml-2 flex items-center gap-1 shrink-0">
  <!-- TG 分享（见 §b） — 用 @click.prevent 拦截，防止触发整卡跳转 -->
  <button @click.prevent="copyTgLink(m.id)"
     class="text-[10px] px-2 py-0.5 rounded border border-warm-200 text-ink-400 hover:text-tg-500 hover:border-tg-300"
     title="复制 TG 分享链接">
    TG
  </button>
</div>
```

> 整卡 `<a>` 已提供"进详情"功能，不再单独加"详情"按钮（去掉即修 nested \<a\>）。

---

## (b) 深链 `start=<marketId>` 零复制

### 现状
TG bot 已支持 `/start <marketId>` 和 deep link `t.me/<bot>?start=<marketId>`（`bot.mjs:52-64`）。  
**格式确认**（Bettor 复审）：`start=<marketId>` 正确，无需 `bet_` 前缀。  
**缺口**：UI 上没有生成这个格式的按钮，只有裸的全局 bot 链接。

### 方案

**JS 方法**（加入 `brokerHome()` data 对象）：
```javascript
copyTgLink(marketId) {
  const bot = this.agent?.tgBotUsername;  // 从 broker 信息取 bot 用户名
  if (!bot) { alert('该 broker 无 TG bot 用户名'); return; }
  const link = `https://t.me/${bot.replace('@','')}?start=${marketId}`;
  navigator.clipboard.writeText(link).then(() => {
    // 临时提示 "已复制"
  });
},
```

**数据来源**：`tgBotUsername` 从 `/api/kanet-broker/onboard/status?address=<broker_address>` 或 `broker_onboarding` 行的 `bot_username` 字段返回。  
**fallback**：若无 tgBotUsername，显示 marketId 供手动拼接。

---

## (c) DM/bot 管理从 relay 迁到 broker-address 视图

### 根因

当前 `broker-home.eta` 的 DM bot 面板：
```javascript
get isThisBrokerBot() {
  return this.agent && this.tgBotBrokerId && this.agent.id === this.tgBotBrokerId;
  // ↑ agent.id = relay_id → 错误，broker 身份 = broker_address
}
```

### 目标

broker 身份铁律：`broker_address` = 首要标识符（`broker_onboarding` 表已地址制）。  
DM/bot 面板与 relay 解耦，只认 broker_address。

**「设为 DM bot broker」按钮废弃**（Bettor 复审确认）：多-bot 地址制模型下每个 approved broker 有自己的 bot，无需"切换代表"。确认无单-bot legacy 流程依赖此按钮。

### 改动

**新 API 端点（已存在，可复用）** — grep 实证（`kasia-console/src/api/kanet-broker.js`）：
- L374: `GET /api/kanet-broker/bots/status` → 返回各 broker bot 状态（按 broker_address 键）
- L379: `POST /api/kanet-broker/bots/stop` body `{broker_address}` → 停 bot
- L368: `POST /api/kanet-broker/bots/reconcile` → 触发多-bot 对齐（审批后立即拉起）

> NWT 验：`grep -n "bots/status\|bots/stop\|bots/reconcile" kasia-console/src/api/kanet-broker.js`

**broker-home.eta JS 改动**：

```diff
- get isThisBrokerBot() {
-   return !!(this.agent && this.tgBotBrokerId && this.agent.id === this.tgBotBrokerId);
- },
+ get thisBrokerAddress() {
+   return this.onboard?.result?.broker_address || null;
+ },
+ get thisBotRunning() {
+   if (!this.thisBrokerAddress || !this.botStatuses) return false;
+   return this.botStatuses[this.thisBrokerAddress]?.running ?? false;
+ },
```

---

## (d) 详情页 主下单 CTA（Bettor 要改点 1·新增）

### Owner 核心需求

> "链接在用户**看懂市场的那个点**出现"  
> 用户点进详情、看懂了 → 没有就地下单入口 = 正是 Owner 说的'没入口了解+下单'

**定位区分**：
- 首页卡片 TG 按钮 = **分享**（次要，把市场分享给朋友）
- 详情页 TG 深链 CTA = **下单**（主要，用户已看懂、要押注）

### 在 predictions-pool-detail.eta 加 CTA

**位置**：市场 header 下方、状态机可视化之前（用户刚看完标题+状态，是行动点）。  
**仅在市场未结算 (`!isSettled()`) 时显示**（已结算无需下单 CTA）。

```html
<!-- (d) TG 下注 CTA — 用户看懂市场时的主行动点 -->
<div x-show="!isSettled() && tgBetLink"
     class="mb-4 rounded-lg px-4 py-3 bg-brand-500 text-white flex items-center justify-between">
  <div>
    <div class="text-sm font-medium">去 TG 押注 →</div>
    <div class="text-[11px] opacity-80 mt-0.5" x-text="'t.me/...' + '?start=' + marketId"></div>
  </div>
  <a :href="tgBetLink" target="_blank"
     class="px-4 py-2 bg-white text-brand-600 text-sm font-medium rounded hover:bg-warm-50 transition-colors shrink-0">
    立即押注
  </a>
</div>
```

**JS 数据**：`tgBetLink` 从 `/api/kanet-broker/onboard/status` 取 `bot_username`，拼 `https://t.me/<bot>?start=<marketId>`。  
从 **detail 页路由参数** `it.marketId` 和 **broker context** 构造。

**不显示的条件**：`isSettled()` 或 `!tgBetLink`（无 bot_username 时 CTA 不显，详情页其余内容不受影响）。

---

## 改动范围汇总（v2）

| 文件 | 改动 | 估量 |
|------|------|------|
| `src/ui/broker-home.eta` | 整卡改 `<a>` (去掉内部"详情"按钮·修 nested \<a\>) + TG 按钮 `@click.prevent` | ~15 行改 |
| `src/ui/broker-home.eta` (JS) | 新增 `copyTgLink()`、`thisBrokerAddress` getter、`thisBotRunning` getter，fetch `bots/status` | ~30 行改 |
| `src/ui/predictions-pool-detail.eta` | 在 header 下方加"去 TG 押注"CTA banner，`x-show="!isSettled() && tgBetLink"` | ~15 行加 |
| `src/ui/predictions-pool-detail.eta` (JS) | 加 `tgBetLink` 数据字段，fetch `/api/kanet-broker/onboard/status` 取 bot_username | ~10 行加 |
| 后端 API | 无需新增（`/api/kanet-broker/bots/status|stop|reconcile` + onboard/status 已存在） | 0 |

**不碰**：链上结算路、TG bot 深链逻辑（已完整）

---

## 注意事项

1. **relay 地址 ≠ broker 地址**：`agent.address`（relay 的 kaspa 地址）≠ `broker_onboarding.broker_address`（玩家自填）。地址制迁移不能把两者混用。

2. **多-broker 场景**：broker-home.eta 现在的 agent selector 是选 relay（gateway 模型）。地址制 broker 应有独立的 selector（从 `broker_onboarding` 表的 approved 地址列表选）或单一 address input。

3. **tgBotUsername 来源**：`broker_onboarding.bot_username`（创建时填）→ 从 `/api/kanet-broker/onboard/status?address=<addr>` 返回。若空，TG 分享按钮 disabled + tooltip 提示「填写 bot 用户名后可用」。

4. **整卡 `<a>` 内的 button `@click.prevent`**：避免 button 点击冒泡触发外层 `<a>` 跳转。Alpine.js `@click.prevent` 拦截跳转，`@click.stop` 阻止冒泡——两者都需要。
