# 电报 DM bot 配置 UI 不可达 (settings.eta 孤儿) — 整改方案 (Owner 提出, 待 Bettor 审)

**问题 (Owner 2026-06-20)**: 作为用户,**几乎无法通过 UI 配置电报 DM bot** —— bot token / broker 身份 / 启停的管理界面打不开。

## 1. 根因 (ground, 全验证非记忆)
- tg-bot 全部管理 UI 在 `settings.eta` (371 行, 3 块):
  1. **Token 配置** (L80-117): @BotFather 的 bot token, 加密存储。API `/api/config/tg-bot-token` GET/POST。
  2. **Broker 身份** (L118-147): bot 代言哪个 broker, 即时生效。API `/api/config/tg-bot-broker` GET/POST。
  3. **运行控制** (L148+): 启动/停止/状态。API `/api/tg-bot/start|stop|status`。
- **🔴 `settings.eta` 没有任何 route 服务它** = 孤儿页, 不可达 (全 src grep `viewAsync('settings')` 零结果)。
- `/settings` route (index.js:399) 只 **redirect 到 `/relays`**。
- `/relays` (relay.js:40) 渲染 `relays.eta` ("节点配置"页, nav 里叫"系统设置"), **里面没有 tg-bot 任何块** (实测 GET /relays HTML 无 tg-bot/Token)。
- ∴ tg-bot 管理 (尤其 **token 配置**) **用户无路可达**。bot 现在在跑只因配置之前存过 (DB 持久)。

## 2. 影响
- 新 Owner / 换 broker / 改 token / 启停 bot —— **全部无 UI 可做**, 只能手改 kanet.env 或直接改 DB (= Owner 当初要修掉的 system defect 又回来了)。
- 我先前在 broker 页加的便捷面板 (启停 + 设为 broker) 是**目前唯一可达的 tg-bot UI**, 但**缺 token 配置** (broker 页面板不含 token)。

## 3. 整改方案 (推荐: 把孤儿 3 块接进 /relays)
**把 `settings.eta` 的 3 块 tg-bot 管理 (Token + Broker + 运行控制) 移进 `relays.eta`** (= /relays = nav 的"系统设置"页, 用户预期管理在这):
- relays.eta 现有结构: 节点配置 + Relay 子进程 RPC 状态 + add-relay。在合适位置 (如节点配置块后) 加一个 **"电报 DM bot" 区**, 放这 3 块。
- **零新后端**: 3 块的 Alpine + fetch 全打**现有 API** (tg-bot-token / tg-bot-broker / tg-bot/start|stop|status), 直接搬 settings.eta 的 markup。
- 孤儿 `settings.eta`: 搬完后**删除** (避免两份漂移; 它已不可达)。
- 我 broker 页便捷面板**保留** (启停 + 设为本 broker 的快捷操作, 同源 API), 与 /relays 的完整管理**同源不双写** (都打同一 API)。

## 4. 备选
- (B) 恢复 `/settings` route 服务 settings.eta (un-orphan): 但 redirect 是有意的 ("node config 在 /relays 了"), 恢复会让 /settings 和 /relays 两个 node-config 入口=更乱。**不推荐**。
- (C) 只扩 broker 页面板加 token: 但 token 是全局配置 (非 per-broker), 放 broker 页语义不对; 且非 broker 角色用户 (Owner 在 /relays) 仍无路。**不如 (A)**。

## 5. scope & 安全
- **纯 UI** (relays.eta 加 tg-bot 区 + settings.eta 删), **零新后端** (现有 API 全有)。
- token 加密存储不变 (CONSOLE_ENCRYPTION_KEY, GET 永不返回明文, 只返 hint), 搬 markup 不碰 crypto。
- 单源: /relays 完整管理 + broker 页便捷操作都打同一 API, 同真相。

## 6. 待 Bettor 审
1. (A) 把 3 块搬进 /relays + 删孤儿 settings.eta —— 方向对吗?
2. token 配置放 /relays (全局节点配置页) vs 别处 —— 合理吗?
3. broker 页便捷面板保留 (启停+设 broker) + /relays 放完整 (含 token) —— 这个分工 (便捷 vs 完整) 对吗? 会不会冗余?
4. 搬 markup 时 Alpine x-data 作用域 (settings.eta 每块独立 x-data) 接进 relays.eta 现有结构需核不冲突。
5. ETA: 纯 UI 搬迁, 审过后落码 1-2 轮 + 自测 (Owner 在 /relays 能配 token + 设 broker + 启停)。

👉 这是初稿, 请 Bettor 审 + 拍方向, 再落码。Owner 提出 "用户无法 UI 配置 DM" = 真 defect, 优先级高 (但别拖 ① bshard 主线)。
