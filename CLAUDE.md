# KANet — Claude Code 接力指南

## 你必须先读这些文档

1. **开发者指南（唯一权威文档）** → `D:\Anthropic\docs\DEVELOPER-GUIDE.md`
   - 必须先读完再动任何代码。全系统 11 章：架构、消息管道、Mind、交易、Health、UI、市场(8源)、致命陷阱
   - 持续更新（最近：2026-04-01）。有改动就在此文件上更新，不新建 dev-*.md

2. **Alpha 达标标准** → `D:\Anthropic\docs\ALPHA-CHECKLIST.md`

3. **系统架构（详细版）** → `D:\Anthropic\docs\kanet-system-architecture.md`
   - 五大模块职责、25张表读写映射、数据流、已知裂缝、API 清单

4. **数据架构危机** → `C:\Users\Y\.claude\projects\D--Anthropic\memory\kanet-data-architecture-crisis.md`
   - Scout/Relay 双写问题、identity 断链路、catch-up 半盲

3. **最新会话总结** → `C:\Users\Y\.claude\projects\D--Anthropic\memory\kanet-session-0325.md`

4. **记忆索引** → `C:\Users\Y\.claude\projects\D--Anthropic\memory\MEMORY.md`

## 核心原则（违反即退回）

- **不猜代码，查了再写** — 列名、函数名、参数名、路径，每次引用前先查。记忆不可信，代码是唯一真相。零例外。
- **先读透现有代码再动手** — 不理解就不改
- **继承优化，不替换重写** — 已有功能不能退化
- **先计划再编码** — 改动前说清楚要改什么、为什么
- **必须自测再交付** — 不让用户当测试员
- **改了什么必须说清楚** — 包括顺手改的 UI 文案
- **每笔链上交易必须入库** — 地址 + TX 双锚点
- **花钱代码验证所有路径** — 失败也要处理

## 五大系统

| 系统 | 路径 | 定位 |
|------|------|------|
| kasia-console | `D:\Anthropic\kasia-console` | 数据中枢 + UI (port 3100) |
| kasia-relay | `D:\Anthropic\kasia-relay` | 链上代理人（私钥、签名、加解密）|
| kaspa-scout | `D:\Anthropic\kaspa-scout` | 链上观察者（扫链、发现、监控）|
| agent-mind | `D:\Anthropic\agent-mind` | Agent 灵魂（五核、技能、决策）|
| agent-adapter | `D:\Anthropic\agent-adapter` | AI 大脑桥接（多 provider）|

## 当前进行中的工作

### 协议收口（P0）
- `relation_states` + `chain_events` + `execution_states` 三张协议状态表已建好
- `relation_states` 71 条数据从旧表 backfill，agent.eta 已迁移并验证通过
- `relation-state.js` 服务已写好（状态机 + 推进规则）
- 剩余 6 个页面待迁移：identities / discovered / network / events / conversation / trading
- Trade ACTION 权限漏洞已堵（executeTradeAction 加了 owner 检查）
- 消息风暴已修（comm 不再触发 proactive，cascade 关闭，60s 冷却）
- 8 个交易所 API 测试 + 余额读取全部实现
- 多交易所合并视图待做（P2）

### 自由市场
- `order-machine.js` 状态机已建
- trading.js `/action` 端点已接入状态机
- UI 交易室已更新全状态
- 三模式（auto/approval/manual）待实现
- 测试需要充值后进行

## 启动/停止

```bash
bash D:/Anthropic/kanet-start.sh
bash D:/Anthropic/kanet-stop.sh
```

## 必读：Agent 社交骚扰问题（4/1 已修，认知修复）

**已修复（2026-04-01）。** 根因：Brain proactive 不知道自己发了什么 DM。修复后 Brain 看到 YOUR RECENT OUTBOUND（DM+广播）+ YOUR CONNECTIONS 含消息计数和迟回复警告 + anti-spam fail-closed + Relay 30min 去重。4/1 之后零骚扰。详见 DEVELOPER-GUIDE 第三章"社交认知链"。

**2026-04-03 补充修复：**
1. 迟回复警告 — context-builder.mjs 对外部 peer 注入 `⚠ PEER MESSAGED YOU N DAYS AGO`
2. messages 表计数修正 — query_card/handshake 过滤，discovery/list 只计 message_type='text'
3. unknown 脏数据 — comm self-send 检测覆盖 sender=null + bcast: 前缀

## 必读：安全审查遗留问题

参考 `D:\A-KANet\日志\需要修改补充的\目前需要优化方面.txt`

1. ~~**verifyIngestRequest() async**~~ — **已修**，12 个调用点全部 `await`
2. ~~**Console 直接碰链**~~ — **已修（3/29）**，card-publisher/bcast-sender 删除，utxo-splitter 改 IPC
3. ~~**market-maker since vs after**~~ — **已修**，chat.js:28 `const afterTs = after || since`
4. ~~**OTC 收款无唯一订单绑定**~~ — **已修（4/3）**，UNIQUE 索引堵竞态 + 付款方地址校验 + 审计日志（chain_events + events 表 Brain 可见）
5. ~~**硬编码绝对路径**~~ — **已修（3/29）**，全部改为 `process.env.KANET_ROOT || 'D:/Anthropic'`

## 必读：KANet 定位

参考 `D:\Anthropic\docs\KANet-Positioning.md`

- KANet 是协议基础设施，不是产品
- 只提供三个原语：安全通信、身份与发现、价值结算
- 只建地基不造房子
- 角色分工：Mind 决策不执行、Console 传导不碰链、Relay 是唯一链上出口、Scout 只读不写

## 关键配置

- Adapter 端口从 3010 起
- Console 端口 3100
- CONSOLE_ENCRYPTION_KEY 必须持久化（丢失 = 所有加密数据不可恢复）
- kanet.env 持久化配置
