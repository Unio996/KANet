# broker UI 缺 tg-bot/DM 设置 — 整改方案初稿 (Owner 提出，待 Bettor 审)

**问题 (Owner 2026-06-20)**: 电报 DM 押注闭环已通，但 **broker UI 里看不到任何 DM/bot 设置界面**。

## 1. 现状 (ground，非记忆)
- **broker UI** (`broker-home.eta` "④ 配置" 块) 现只有: 默认 broker fee% + 收款地址。**无 tg-bot/DM 任何配置。**
- **tg-bot 全部设置在 Settings 页** (`settings.eta` / `settings.js`)，后端 API 已齐:
  - `GET/POST /api/config/tg-bot-broker` — bot 代表哪个 broker (DB config，0-restart，bot 运行时读，替 env BROKER_RELAY_ID)。
  - `POST /api/tg-bot/start|stop` + `tg_bot_enabled` flag — 启停 (跨重启记住)。
- ∴ Owner 在 broker UI 看不到 = **设置只在 Settings 页，没在 broker 页露出**。

## 2. 根因 & 定位
这正是早先规划的 **Post-DoD Task A** (Owner option b): "tg-bot config 进 broker-home.eta '配置' 面板 — Settings 保全局控制 + broker 页便捷入口"。**该任务未落地**，所以 broker UI 没有。

## 3. 整改方案 (Owner option b — Settings 全局控制 + broker 页便捷入口)

在 `broker-home.eta` "④ 配置" 块**加一个 tg-bot/DM 子面板** (纯前端 + 复用现有 API，零新后端):

| 显示 | 数据源 | 含义 |
|------|------|------|
| **本 broker 是不是 DM bot 当前 broker** | `agent.relay_id` vs `GET /api/config/tg-bot-broker` | 一眼看出 DM bot 现在代表的是不是这个 broker |
| **bot 启停状态** (运行中/已停) | `tg_bot_enabled` (经 settings 状态 API) | DM bot 活没活 |

**两个便捷操作 (复用现有 API)**:
1. **「设为 DM bot 的 broker」** 按钮 → `POST /api/config/tg-bot-broker {broker_relay_id: 本broker}` → DM bot 改代表本 broker (0-restart，bot 运行时读)。
2. **启 / 停 bot** 按钮 → `POST /api/tg-bot/start|stop`。

**Settings 页保留不动** = 全局权威控制 (完整管理 + killStrayBots 等)；broker 页只是**便捷视图 + 快捷操作** (单 Owner 在 broker 页就能看到/切换/启停，不必跳 Settings)。

## 4. scope & 安全
- **纯 UI 改** (`broker-home.eta` 配置块 + Alpine state)，**零新后端** (现有 API 全有)。
- 单源: 状态/操作都打现有 `/api/config/tg-bot-broker` + `/api/tg-bot/*`，不复制后端逻辑，Settings 与 broker 页同源同真相。
- 不破现有: 加子面板 additive，不动 fee%/收款地址/Settings 页。
- 便捷操作要不要二次确认 (设 broker / 停 bot)? — 建议「设为 broker」+「停」加一句确认 (防误切 DM bot 的 broker 把在飞 DM 流量切走)。

## 5. 待 Bettor 审的点
1. 方案符合 Owner option b (Settings 全局 + broker 便捷) 吗？
2. broker 页放「快捷操作」(设 broker/启停) 会不会跟 Settings 全局控制冲突 / 双写真相？(我设计成同源 API，应无冲突，请审)。
3. 「设为 DM bot 的 broker」要不要限制 (只允许有 adapter 的 broker，否则 bot 调不通 — 记忆 [[project-broker-phase1-markets-tool-identity-blocker]] 的 identity blocker)？
4. ETA: 纯 UI，审过后落码 1 轮即出 + 自测 (Owner 在 broker 页看到面板 + 切换/启停生效)。

👉 这是初稿，请 Bettor 审 + 拍方向，再落码。
