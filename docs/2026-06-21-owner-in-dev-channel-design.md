# owner-in-dev-channel 设计方案（优化+整合，不建新）

Owner 钦定 2026-06-21：UI 重点之一 = 让 Owner 通过电报 DM 直接在开发频道（dev-coord-testnet）以 owner 身份和团队交流，效果就像现在 Claude Code 界面。**东西都现成，就是优化+整合**。本方案调查清楚后**安排给 KANet-UI 实现**。

## 架构定位（Owner 钦定 2026-06-21 细化）

**电报 DM = 管理界面，实现在"另外两个地方"，不在 relay（怕混乱）**。relay 是链上 agent 角色（签名/广播），管理逻辑不放它身上。两个独立的电报管理面：
1. **broker 面**（= 本批 #1）：broker 管理（建市/查单/挂单），现有 broker handlers。
2. **owner 面**（= 本批 #2 owner-in-dev-channel）：**owner ↔ 开发智能体交流，尤其适合远程控制**——Owner 从电报远程指挥/对话整个开发团队，效果=现在 Claude Code 界面。

**身份锚在地址**（Owner："地址是最底层最内核身份标签"）：owner 身份 = 地址 trust_level='owner'，不是 relay 配置。relay 在 #2 里**只是广播 plumbing**（把 owner 地址的消息上链到 dev-coord），管理/身份判定全在 地址分类 + 电报面。
**owner 面的两个触点（web + 远程，共用 owner-地址身份）**：
- **web home = `/chat`**（chat-v3.eta，"Live Chat"，已有频道列表+发送，显示链上频道含 dev-coord-testnet）。owner 在 /chat 看 dev-coord + 以 owner 身份发言。
- **远程 = 电报 DM**（#2 桥）= 镜像 /chat 的 dev-coord = 远程控制。
- **省力点**：Step1 的 firewall 改（chat.js L195 放行 owner 地址）**一处改、web+远程两处都通**——owner 身份判定（地址 trust_level='owner'）web 和电报共用。
- **#3 整合** = 把 `/public/channel/:name`（public-channel.eta，公开只读 spec 浏览器）并进 `/chat`，统一成一个频道 UI（公开只读 + owner 互动两模式）。

## 现成 pieces（已存在，勿重建）

1. **地址分类管理**：`identities.trust_level`（+ `relation_states.trust_level`），合法值 `['owner','recommended','normal','blocked']`（`conversations.js:1100` / `identities.js:6` TRUST_LEVELS）。一个地址可被分类为 `trust_level='owner'`。这是 Owner 说的"地址可分类管理"。
   - ⚠ KANet-UI 确认：UI 设置地址 trust_level 的入口在哪（现有页面，agent/conversations？）。若入口已有=直接用；若缺=补一个分类下拉（owner/recommended/normal/blocked）。
2. **dev-coord 发言**：`POST /api/chat/send {relayId, channel, message}`（chat.js）。频道 firewall（chat.js **L195**）：`COORD_CHANNELS.has(channel) && !OPUS_RELAY_NAMES.has(relay.name)` → 403。**现按 relay.name 白名单**（Martin/J2/NWT/Bettor…），不认地址分类。
3. **电报 bot**：`tg-bot/`（0-custody，grammy，/link /bet 流 + console-api.mjs req 模式）。
   - 参考：我已在隔离 worktree `feat/tg-owner-dev-bridge` 建了双向 bridge 骨架（Direction A 电报→dev-coord / Direction B poller dev-coord→电报，63 行，node --check 过）。**仅作 Step 3 参考**，身份机制要改成下面的 owner-地址机制（非我骨架里的 custom OWNER_RELAY_ID）。

## 整合设计（3 步，按 Owner 顺序）

### Step 1：owner 地址能在开发频道发言（身份=owner）
- **改 chat.js firewall（L195）**：COORD 频道放行条件从「relay.name ∈ OPUS_RELAY_NAMES」优化为「relay.name ∈ OPUS_RELAY_NAMES **OR** 发送地址 trust_level='owner'」。
- 效果：被分类为 owner 的地址 post dev-coord 不再 403，以 owner 身份发言。
- 小改（一个 OR 条件 + 查 trust_level），不建新。

### Step 2：测试
- 把一个地址设 `trust_level='owner'` → 它在 dev-coord 发言 → 验证落链 + 频道显示身份=owner。
- OK 后再进 Step 3（Owner 顺序：先 ok 再上电报）。

### Step 3：电报 DM 接通
- owner 地址 ↔ Owner 电报 DM 双向桥（tg-bot 整合）：
  - **A**：Owner 电报发文 → 经 owner 地址的 relay post dev-coord（身份=owner）。
  - **B**：dev-coord 新消息 → 推 Owner 电报 DM（poller，dedup，滤自己的消息防回环）。
- 复用 `feat/tg-owner-dev-bridge` 骨架的 Direction A/B 逻辑，把 relay 来源改成 **owner-分类地址对应的 relay**（而非 custom config）。
- 0-custody 不破（纯消息）。

## 其余两项 UI 整合（同批，Owner 列的）
- **#1 电报DM ↔ broker 融合**：现有 broker handlers（buy-handler/dm-classifier）+ /bet 流，菜单统一顺滑。
- **#3 kanet-spec + /chat 页面整合**：`public-channel.eta` + `chat-v3.eta` 合一。

## 安排
- **KANet-UI 实现**（UI 域：地址分类入口确认/补 + firewall L195 优化 + 电报桥整合 + #1/#3）。
- **Bettor 提供**：本方案 + bridge 骨架（feat/tg-owner-dev-bridge）+ firewall 优化点（chat.js L195）。bshard teeth 收尾后 KANet-UI 接。
