# 通讯录合并设计

## 一句话

把 contacts.eta（通讯录管理）和 audit.eta（链上行为）合并为一个新的通讯录页面，侧栏顶级入口，紧跟聊天。

## 现状问题

1. 两个页面功能重叠：contacts 显示联系人列表+编辑，audit 也显示联系人列表+行为明细+编辑
2. 数据不一致：contacts 读 relation_states（40 人），audit 读 chain_events（23 人），用户不知道哪个是全的
3. 用户迷茫：不知道该看通讯录还是链上行为
4. "链上行为"名字拗口，新用户不理解

## 设计

### 页面名称：通讯录

路由：`/contacts`（复用现有路由，替换现有 contacts.eta）

### 侧栏位置

```
聊天
通讯录    ← 顶级，紧跟聊天
Agent
探索
市场
设置（链上行为入口移除）
```

### 数据源合并

联系人来源 = relation_states ∪ chain_events 的 peer 地址取**并集**，不漏人：
- relation_states 有但 chain_events 没有 → 显示（Scout 发现的地址）
- chain_events 有但 relation_states 没有 → 显示（交易对手等）
- 两个都有 → 合并显示

### 页面功能

**联系人列表**（现有 audit 页面的结构）：
- Agent 选择器
- 筛选：全部 / 外部 / 内部
- 排序：最近交互 / 交互最多 / 名称
- 搜索
- 每行显示：名称、地址、标签、发出↑/收到↓/合计Σ、类型、最近时间

**点开联系人**（现有 audit 页面的展开功能）：
- 完整地址（可复制）
- 标签编辑 + 备注编辑
- 行为明细列表（消息内容、握手、交易），分页
- **快捷发消息框**（新增）

**快捷发消息框**：
- 输入框 + 发送按钮
- 选择用哪个 Agent 发送（如果选了 Agent 就用该 Agent 的 Relay）
- 调用现有 `/api/relay/:id/send-command` type='send_message'
- 发完不等回复 — 回复在聊天页面看
- 发送成功后消息出现在行为明细中

**手动添加联系人**（现有 contacts 页面的功能）：
- 顶部"+ 添加"按钮
- 输入地址 + 名称 + 信任等级
- 调用现有 `/api/contacts/add` API

### 退役页面

- `audit.eta` → 内容全部迁移到新 contacts.eta，audit.eta 保留文件不删，`/audit` 路由 redirect 到 `/contacts`
- 旧 contacts.eta → 被新版替换

### 不改的

- 后端 API 全部复用（`/api/agent/activity-by-peer`、`/api/agent/activity-log`、`/api/contacts/update`、`/api/contacts/add`、`/api/relay/:id/send-command`）
- Agent 概览页的"链上行为"数字点击跳转改为 `/contacts?agent=xxx`
- 社交风格配置保持在 Agent 概览页

## 测试

1. 打开 `/contacts`，选 Agent，联系人数量 ≥ 现有通讯录和链上行为的最大值
2. 点开联系人，能看到行为明细（消息、握手）
3. 编辑标签，刷新确认持久化
4. 快捷发消息，确认 Relay 发出
5. 手动添加联系人，确认出现在列表
6. `/audit` 访问 → redirect 到 `/contacts`
7. 侧栏"通讯录"高亮正确
