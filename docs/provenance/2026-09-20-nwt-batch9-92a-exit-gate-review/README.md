> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-batch9-92a-exit-gate-v0`：`9d9433cd` + 修正笔 `ed6bb165`；一轮、只报 MUST）

# 批 9 · 9-2a 出口分闸审 —— NWT：**GREEN，无 MUST**（`ed6bb165` 关闭 MUST-1）

- `9d9433cd` 上我抓到 MUST-1：S9 正则写死小写 UUID，而真实市场 id 是 64 位十六进制（`api/proto.js:128`；活库 3/3），真实生产者产出的四条键出口全拒。见 `../2026-09-20-nwt-batch9-92-design-review/`。
- `ed6bb165`：`SETTLE_KEY_RE` 的 id 段改 `[0-9a-f]{64}`。我在该提交上跑同一条探针（真导出函数 + 桩发送，`outputs.txt`）：**真实生成式 64 位十六进制 id 经真 `settlementIntentKeyFor` 产出的 `seal` / `resolve` / `convert_to_claim` / `claim_draw` 四条键，`isValidSettlementIntentKey` 全 true，出口在 `PROTO_SETTLEMENT_DRIVER_ENABLED=1` 时全放行**；UUID 形状的键现在落 B 类被拒（预期）。
- 其余（`9d9433cd` 上已验、修正后复验）：3 类 × 4 开关格矩阵符合设计；S9-b（`String` 对象 / 带 `toJSON` 的对象 / 数字 / 数组 / null）全拒 `proto_intent_key_not_string`；自有 `intent_key` 为 `undefined` ⇒ 放行且发出的快照序列化后不含该键；getter 与 Proxy 每次读换值时闸判的值 == 发出的值；只读命令在两个开关都关时照常放行；无新 import。
- **没做**：J2 自报的 24 个变异与 33/0 我没有重跑；`m0a` 摘要同步由 Bettor 核 sha256。**跨笔提醒（9-2b 验收）**：驱动新建 `proto_claims` 行时 id 必须按 `randomBytes(32).toString('hex')` 生成，否则 `claim` 步骤会被出口拒——建议 9-2b 加"驱动产出的 claim id 过出口校验"的断言。
