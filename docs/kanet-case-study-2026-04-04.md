# KANet 调试案例：从一条"你好！"到系统地基重建

**日期：** 2026-04-04  
**历时：** 一天  
**起点：** 用户发的消息没有收到回复  
**终点：** 完整链路打通，停机期间的消息自动补全并触发 Brain 回复  

---

## 一、问题的起点

用户 `kaspa:qrg6g43...` 于 4/4 00:52 发了一条消息"你好！"上链。

KANet 系统在 4/3 23:40 到 4/4 01:11 期间停机。消息上链时系统不在线，重启后系统对这条消息一无所知。

用户没有收到回复。

---

## 二、调查方法论

**六层调查法，不跳步：**

```
第一层：场景确认（期望行为 vs 实际行为）
第二层：真实数据（直接查 DB，不猜）
第三层：协议（设计意图是什么）
第四层：执行逻辑（代码路径追踪）
第五层：数据流向（数据从哪来，到哪去）
第六层：存储验证（DB 最终状态确认）
```

**关键原则：**
- 每层输出结论后停下来，等确认再继续
- 不允许说"基本正常"，只有全部通过或有异常
- 真实数据说话，不用代码推断代替 DB 查询

---

## 三、根因链（从表面到地基）

### 根因 1：Scout 无扫描进度检查点

**现象：** 系统重启后，停机期间的链上消息永久丢失。

**根因：** `subscribeBlockAdded` 只接收新块，不回扫历史。Scout 没有持久化"上次扫到哪"的检查点，重启后不知道从哪补。

**修复：**
- 新建 `scout_checkpoint` 表，记录 `last_block_time`
- Scout 启动时读检查点，计算 gap
- 新建 `history-fetcher.mjs`：按地址查询历史 TX（不扫块，按需取）
- 停机 30 天也只需几秒补全

**关键数据：**
```
用户消息上链时间：2026-04-04T00:52:02Z
系统停机时段：   2026-04-03T23:40 → 2026-04-04T01:11
Scout 重启后：   只订阅 01:11 以后的新块，00:52 的消息永久未被处理
```

---

### 根因 2：processComm 判断顺序反了

**现象：** `senderAddress` 为 null 时，仍然调用 `ingestMessage`，写入 `remoteAddress = 'unknown'`，产生孤立 conversation。

**根因：** `rpc-listener.mjs:508` 先 ingest 再判断 null，顺序反了：

```javascript
// 错的（之前）
ingestMessage({ remoteAddress: senderAddress || 'unknown' });  // :508
if (!senderAddress) return;  // :512  太晚了

// 对的（修复后）
if (!senderAddress) return;  // 先判断
ingestMessage({ remoteAddress: senderAddress });  // 确认有值再 ingest
```

**影响：** 所有 `senderAddress` 为 null 的 comm 消息都会产生孤立 conversation（`remote_identity_id = NULL`），污染数据层。

**同类问题：** `processPayment:582` 也有同样的 `|| 'unknown'` 残留，一并修复。

---

### 根因 3：findAddressByAlias 查错数据源

**现象：** Martin 解密"你好！"成功，但 findAddressByAlias 返回 null，消息无法写入正确 conversation。

**调查过程：**
```
用户地址在 known-addresses 里？ → 是（94 个中的一个）
本地派生的 alias 匹配 TX 里的 alias？ → 不匹配
  Martin 派生：2cbcb7bb9098
  TX 里实际：  5f5de35a24f7
```

**根因：** 发送方用的 alias 派生算法（另一个 Kasia 客户端）和 KANet 的 `deriveAliases` 不兼容。本地派生永远匹配不上跨钱包用户。

**正确方案：** Kasia 协议规定握手时双方交换 alias，接收方应该用握手时收到的 alias，不做本地派生：

```
# chain.mjs 第 95 行注释（Kasia 开源代码）：
"Prefer alias from on-chain handshake over locally derived (cross-wallet compat)"
```

---

### 根因 4：parsed.alias 打完日志就丢弃（核心遗漏）

**现象：** Console 完全不知道 alias 的存在，`relation_states` 表没有 `their_alias` 字段。

**根因：** `rpc-listener.mjs:421`，握手解密后得到的 `parsed.alias` 只打了日志，没有传给 `ingestHandshake`，没有存入任何表：

```javascript
// 之前：alias 信息丢失
log('HANDSHAKE from', senderAddress, '— alias:', parsed.alias);  // 只打日志
ingestHandshake({ localAddress, remoteAddress, txid });  // 没有 alias

// 修复后：alias 沿链路传递
const theirAlias = parsed.alias || null;
ingestHandshake({ localAddress, remoteAddress, txid, theirAlias });
// → ingest-service.js 存入 relation_states.their_alias
// → findAddressByAlias 直接查这个字段
```

**影响范围：** 这个遗漏存在于系统第一天起，导致所有跨钱包用户的 comm 消息永远无法找到发送方地址。

---

### 根因 5：chain_events 脏数据阻止正确记录写入

**现象：** "你好！"写入了正确的 messages 表，但通讯录 UI 看不到。

**根因：** Step 5 失败时（早期错误尝试），写入了一条 `from_address=NULL` 的 chain_events 记录。`recordChainEvent` 用 `txid` 去重，脏记录占了去重位，正确记录写不进去。

**修复：** 删除脏记录，手动补写正确的 chain_event。

---

## 四、修复清单

| 编号 | 修复内容 | 文件 | 影响 |
|------|---------|------|------|
| F1 | Scout 检查点持久化 | `scout_checkpoint` 表 + `message-indexer.mjs` | 重启后知道从哪补 |
| F2 | history-fetcher 按地址查历史 TX | `history-fetcher.mjs` | 停机期间消息自动补全 |
| F3 | processComm 先判断再 ingest | `rpc-listener.mjs:506-514` | 不再产生孤立 conversation |
| F4 | processPayment 同上 | `rpc-listener.mjs:582` | 支付链路同样干净 |
| F5 | findAddressByAlias 改查 relation_states | `rpc-listener.mjs:657` | 跨钱包兼容 |
| F6 | parsed.alias 不再丢弃 | `rpc-listener.mjs:421` + `ingest.mjs` | alias 信息完整传递 |
| F7 | relation_states 加 their_alias 字段 | `migrate.js v43` | 握手 alias 持久化 |
| F8 | alias-lookup 端点 | `discovery.js` | findAddressByAlias 的数据源 |
| F9 | chain_events 脏数据清理 | 手动 SQL | activity-log 正确显示 |

---

## 五、新增基础设施

### 数据层

```sql
-- 新表
kanet_message_index  -- 协作消息索引（Scout 扫链时写入）
scout_checkpoint     -- Scout 扫描进度持久化

-- 新字段
relation_states.their_alias  -- 握手时对方的 alias
kanet_message_index.processed_at  -- 历史 comm 处理幂等标记
```

### 代码层

```
kaspa-scout/src/history-fetcher.mjs   -- 按地址查历史 TX
kaspa-scout/src/message-indexer.mjs   -- 扫链时写索引
kaspa-scout/src/light-scanner.mjs     -- 无本地节点降级模式
```

### 质量保障层

```
.claude/agents/data-consistency-checker.md  -- 8 条 DB 一致性检查
.claude/agents/architecture-reviewer.md     -- 5 条架构约束审查
CLAUDE.md 强制检查规则                       -- 每 Step 完成必须触发两道检查
```

---

## 六、今天建立的工作规范

### 调查前

1. 不允许直接改代码
2. 先出链路图，等架构师确认
3. 任务文档精确到函数名、参数名、行号

### 任务文档必须包含

```
必须走哪个现有函数（不允许新建同类函数）
每个参数的来源
不允许做什么（明确的禁止项）
完成标准（什么状态才算完成）
```

### 每 Step 完成后

```
Step 完成
  ↓
data-consistency-checker（8/8 全部 ✓）
  ↓
architecture-reviewer（5/5 全部 ✓）
  ↓
架构师确认
  ↓
才能进入下一 Step
```

### 绝对禁止

```
✗ 新建与现有链路功能重复的端点或函数
✗ 传 null 或 'unknown' 作为 remoteAddress 给 ingestMessage
✗ 绕过 ingestMessage 直接写 messages 表
✗ 在两道检查通过之前输出完成报告
✗ 在架构师确认之前自行进入下一 Step
```

---

## 七、核心架构原则（今天确认的）

```
唯一真相源：relation_states 表
消息入库：  必须通过 ingestMessage
Conversation：必须有 remote_identity_id（不能 NULL）

Scout  → 只扫链和上报，不解密，不写 messages
Relay  → 只发 TX 和解密，不扫链，不写 relation_states
Console → 唯一状态仲裁者，根据 Scout 观察更新状态

握手 alias → 必须沿链路传递，不能丢弃
本地派生 alias → 只作为 fallback，不作为主要数据源
链上 TX → 按 txid 取原文，链是真相源
```

---

## 八、端到端验证结果

```
用户 4/4 00:52 发"你好！"上链
  ↓ 系统停机期间
history-fetcher 发现历史 TX（kanet_message_index）
  ↓
Relay catch-up 按 txid 从 api.kaspa.org 取 payloadHex
  ↓
processComm 解密成功
  ↓
findAddressByAlias → relation_states.their_alias → 找到用户地址
  ↓
ingestMessage 写入正确 conversation（1b165836）
  ↓
Brain 自动回复"你好！握手成功，我是 Martin..."
  ↓
用户在链上收到回复 ✓
```

**从发现问题到修复根因：一天，七个根因，全部打通。**

---

## 九、遗留待办

| 编号 | 问题 | 优先级 | 备注 |
|------|------|--------|------|
| T1 | activity-log 应读 messages，不读 chain_events | 高 | 今天绕过，未根治 |
| T2 | 54 条 handshake 双写 | 中 | Scout/Relay 职责边界修复后自然消失 |
| T3 | qz7jyy2e 3/18 老 accepted 无 conversation | 低 | 单条历史遗留，清理即可 |
| T4 | 节点协作索引第二阶段 | 规划中 | 停机 > 30 小时的根治方案 |
