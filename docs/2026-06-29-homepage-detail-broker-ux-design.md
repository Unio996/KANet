# 首页→详情页+深链+DM 地址制 UX 设计文档

**派工**: Bettor 2026-06-29 01:37 (#yjt00s)  
**Owner 批评**: ①首页押注单子缺详情入口(巨大设计问题) ②broker 锚定地址·DM 管理挂 relay=结构性错  
**执行**: KANet-UI  
**待审**: Bettor(qpjhaad7)

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
  └─ market card [可点]
        └─ /predictions/pool/:id  (已有路由·已有模板 predictions-pool-detail.eta)
```

### Card 改动(最小改动)

**broker-home.eta 第 272 行**，把每个 market row `<div>` 改成 `<a>` tag：

```diff
- <div class="flex items-center justify-between text-xs py-1.5 border-b ...">
+ <a :href="'/predictions/pool/' + m.id"
+    class="flex items-center justify-between text-xs py-1.5 border-b ...
+           hover:bg-warm-50 cursor-pointer transition-colors">
```

Card 显示内容（当前已有，保留不动）：
- 第一行：市场标题（specTitle 截 64 字符）
- 第二行：POOL · protocol_status · stake X KAS · fee Y%

**新增**：右侧操作按钮组（inline，不破布局）：
```html
<div class="ml-2 flex items-center gap-1 shrink-0">
  <!-- 详情入口 -->
  <a :href="'/predictions/pool/' + m.id"
     class="text-[10px] px-2 py-0.5 rounded border border-warm-200 text-ink-400 hover:text-brand-600 hover:border-brand-300">
    详情
  </a>
  <!-- TG 分享（见 §b） -->
  <button @click.prevent="copyTgLink(m.id)"
     class="text-[10px] px-2 py-0.5 rounded border border-warm-200 text-ink-400 hover:text-tg-500 hover:border-tg-300"
     title="复制 TG 分享链接">
    TG
  </button>
</div>
```

### 详情页现有内容(不改)

`predictions-pool-detail.eta` 已提供：
- 市场标题 + 双方赔率 + 池子规模 + 截止时间
- 状态机可视化（投票中→结算→完成）
- 链上证据链（settlement audit）
- 结算横幅（settled 状态自动显示）

---

## (b) 深链 `start=<marketId>` 零复制

### 现状
TG bot 已支持 `/start <marketId>` 和 deep link `t.me/<bot>?start=<marketId>`（`bot.mjs:52-64`）。  
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

**删除**：`broker-home.eta` 现有的全局裸 TG bot 链接（若有）。

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

API 面板调用：`/api/config/tg-bot-broker`（设 broker 的旧接口，relay-keyed）

### 目标

broker 身份铁律：`broker_address` = 首要标识符（`broker_onboarding` 表已地址制）。  
DM/bot 面板与 relay 解耦，只认 broker_address。

### 改动

**新 API 端点（已存在，可复用）**：
- `GET /api/kanet-broker/bots/status` → 返回各 broker bot 状态（按 broker_address 键）
- `POST /api/kanet-broker/bots/stop` body `{broker_address}` → 停 bot
- `POST /api/kanet-broker/bots/reconcile` → 触发多-bot 对齐（审批后立即拉起）

**broker-home.eta JS 改动**：

```diff
- get isThisBrokerBot() {
-   return !!(this.agent && this.tgBotBrokerId && this.agent.id === this.tgBotBrokerId);
- },
+ // broker_address = 从 onboard 状态取，或从 agent.address 取（relay 地址 ≠ broker 地址，注意区分）
+ get thisBrokerAddress() {
+   return this.onboard?.result?.broker_address || null;
+ },
+ get thisBotRunning() {
+   if (!this.thisBrokerAddress || !this.botStatuses) return false;
+   return this.botStatuses[this.thisBrokerAddress]?.running ?? false;
+ },
```

**面板显示逻辑**：
- 若该 `broker_address` 有 `approved` onboarding → 显示 bot 状态（从 bots/status 拉）
- 运行/停止按钮：改调 `/api/kanet-broker/bots/stop` + `/api/kanet-broker/bots/reconcile`
- 「设为 DM bot broker」按钮：**废弃**（多-bot 模型下每个 approved broker 有自己的 bot，无需"切换代表"）

**面板移位**：DM bot 面板从现在的 relay agent selector 下方，移到 ② broker 收入区块下方，与 onboarding 状态联动：

```
[玩家轻路·成为 broker（地址制）]
  → 申请 / 查状态
  → 若 approved: 显示 bot 状态 + start/stop 按钮 ← 新位置
```

---

## 改动范围汇总

| 文件 | 改动 | 估量 |
|------|------|------|
| `src/ui/broker-home.eta` | 市场 card 加 `<a>` + TG 按钮 + DM 面板地址制改造 | ~40 行改 |
| `src/ui/broker-home.eta` (JS) | 新增 `copyTgLink()`、`thisBrokerAddress` getter、`thisBotRunning` getter，fetch `bots/status` | ~30 行改 |
| 后端 API | 无需新增（`/api/kanet-broker/bots/status|stop|reconcile` 已存在） | 0 |

**不碰**：链上结算路、predictions-pool-detail.eta（detail 页不改）、TG bot 深链逻辑（已完整）

---

## 注意事项

1. **relay 地址 ≠ broker 地址**：`agent.address`（relay 的 kaspa 地址）≠ `broker_onboarding.broker_address`（玩家自填）。地址制迁移不能把两者混用。

2. **多-broker 场景**：broker-home.eta 现在的 agent selector 是选 relay（gateway 模型）。地址制 broker 应有独立的 selector（从 `broker_onboarding` 表的 approved 地址列表选）或单一 address input。设计可复用现有 onboarding 查状态的 input box。

3. **tgBotUsername 来源**：`broker_onboarding.bot_username`（创建时填）→ 从 `/api/kanet-broker/onboard/status?address=<addr>` 返回。若空，TG 分享按钮 disabled + tooltip 提示「填写 bot 用户名后可用」。

---

## 待 Bettor 审核

- 首页卡片详情入口：以上方案 OK？
- 深链：`start=<marketId>` 格式已有，只需 UI 按钮。是否还需其他格式？
- DM/bot 地址制：「设为 DM bot」按钮废弃方向正确？还是保留作为 legacy relay 路？
