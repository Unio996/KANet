# KANet 底座模块化路线图 v0.2.1（收敛稿 · 对抗讨论第一轮裁决整合 + D2 三轨定稿 · 待 Owner 磨合）

> **Status**: CURRENT（2026-07-22 · Bettor 主编 · 整合 KANet-UI/NWT/J1/J2 四方对抗意见，频道裁决 #v6ij51 在案；v0.2.1 增量：D2 按 34 命令分类表实证结果由双轨升三轨，四方全数确认）
> **流程锚**（Owner 终裁 2026-07-21 18:20Z）：首稿 v0.1 → 对抗讨论（本轮完成，四方全回执）→ **本收敛稿交 Owner 磨合 → 钉死后 Bettor 安排分批执行。钉死前不动任何执行代码。**
> **v0.1→v0.2 变更**：D2 拆双轨（J1）；D4 按 J2 读码修正（exchange-machine 零预测逻辑）+ V1 drain 退役方案（J2）；M0 加运维脚本例外 + 豁免燃尽三钉（KANet-UI/NWT）；M1 按 handler 拆三批 + 互斥穷尽两硬门（NWT）；全路线图单批规模硬上限（NWT 实测校准）；M3 排序钉死 M3a+M3b→M3c（J1）；运维/runbook 改造升为一等工作项 + 拓扑自报端点（KANet-UI）。
> **本卡性质**：设计文档，不改一行执行代码。

---

## 0. 总纲（不变）

底座回归立项定位（`docs/KANet-Positioning.md`）：只留三原语（安全通信/身份与发现/价值结算）+ 运行时角色（Console 传导 / Relay 唯一链上出口 / Scout 只读 / Mind 决策）。预测系统与 kas 兑换系统按同一套可复用模式抽离为应用。终验收 = 立项原文标准：**新应用接入 KANet，不改一行 KANet 代码**。

现状量化证据、底座保留资产清单、三种已验证抽离范式（fee-split 纯函数包 / 独立进程 / 同仓收敛）与选型规则（③同仓收敛→接口化→②独立进程渐进，禁一步微服务化）见 v0.1 §1，本稿不重复，数据不变。

---

## 1. 设计决策（对抗讨论后定稿）

### D1 数据库：不物理拆库，先拆访问路径（无人反对，维持）
应用专属表留 console.db，应用代码一律经仓储层/HTTP API 访问，禁止裸 `sqlite` 句柄。物理拆库留待独立进程化稳定后单独议。

### D2 Relay 命令表：三轨制（v0.2.1 定稿 · J2 分类表实证 + J1/NWT/KANet-UI 全数确认）
分类表已完成（J2 主核读 COMMAND_PAYLOAD_SCHEMA/FIELD_TYPES + KANet-UI 实读 relay.mjs 抽查坐实 + J1/NWT verdict）：**类 A 6 + 类 B 9 + 类 C 20 = 35 条**（原估 ~34，取整差异）。分轨依据是 **relay 对 covenant 脚本的信任模型**，非组合 vs 扩展：

- **类 A 纯计算/只读（6）**：GET_PER_BET_ADDRESS / POOL_V07_COMPUTE_REFUND_MASS / CHAIN_GET_* ×3 / GET_ADDRESS_UTXOS。零签名能力，风险天然有界 → **轻量应用注册通道**。
- **类 B 盲签（9，风险排三类之首——J1 裁定，NWT 认可）**：PREDICTION_SETTLE_TX 等 9 条，调用方传 `redeem_script_hex`，relay 零结构/opcode 校验原样签字（KANet-UI 实证 `relay.mjs:786-816`）。本质 = "唯一链上出口"的独立校验能力被清空，**谁能拿到这个 IPC 接口 = 谁就有等效签名权**；与 covenant_family 治的"不独立验证、只信调用方声明"是同一反模式。两条硬约束（J1 钉，非软建议）：
  ① **caller 白名单必须运行时强制**（relay 侧校验 caller identity），不是审查时君子协定；现状这 9 条的调用权限控制是既有缺口，D2 设计稿**硬前置**摸清并趁重构窗口补上（NWT）。
  ② 长期观察项独立立卡（不阻塞本轮）：relay 对高频类 B 脚本做最小结构校验——校验脚本 hash 落在已注册模板集合（covenant_family structural-signature 思路），非重新实现 covenant 逻辑。
  D2 设计稿中类 B 是最重的一块，禁被"只有 9 条"的数量印象带轻。
- **类 C relay 内建 covenant 编译（20）**：BSHARD_* / CLOSEZK_* 全家，payload 为结构化 {witness,inputs,outputs}，relay 内部编译脚本字节。每加一条 = relay 签名能力集合实际变大 → **应用命令注册机制 + relay 代码库全强度审查**（NWT/团队，不下放 app 自审）。

### D3 协议消息分发收归底座原语（维持，DoD 见 M1 两硬门）

### D4 V1 预测路径退役（J2 读码修正后重写）
**修正**：exchange-machine.js 本身零预测专属逻辑，`transition()`/`spendFunds()` 是通用状态机；耦合是**单向的**——V1 settler 作为消费者借用通用 API（查 `exchange_offers WHERE give/want_asset='prediction_outcome_share'`）。因此：
- M2 抽离 exchange 时 **exchange-machine 不为 V1 改一行代码**。
- V1 退役 = **drain 方案**：①立停新建 V1 市场入口（现存 4 条 pending_bettors 仍可下新注，此项为 M3b 第一子项）→ ②现存 23 条非终态（15 条 pool_markets V1 + 9 条 prediction_outcome_share offer）在旧代码路径原样跑到自然终态（不动 working 钱路）→ ③零非终态确认后才删 `bettor-prediction-settler.js` 等 V1 文件。**drain 清零即验收判据，不拍日期。**
- exchange_offers 表物理迁移前置检查 = 复用同一张 drain 清单（防 V1 数据孤立），不另造。

---

## 2. 全路线图硬约束（NWT 实测校准，适用每一批）

- **单批规模上限：实际 diff ≤300 行改动 + ≤4 个新增/改动文件**。超过必须在设计稿阶段预拆子批，不许审到一半再拆。
- **排期换算：每个 ≤300 行批次 = 半天到一天实打红队时间**（covenant_family 实测：一个窄模块 7 小时连续审查抓 5 个实 bug）。大改动耦合风险非线性，禁按行数线性外推。
- 每批完整审链：设计 → NWT 红队 → 落码 → diff 审 → 装载验证；涉钱路走 D-011。

---

## 3. 分批路线（定稿）

### M0 边界冻结（止血批）
- 《底座 API 契约 v1》文档 + lint 卡点（新增代码禁止应用目录裸连 sqlite/relay-manager）。
- **例外**（KANet-UI）：`scripts/` 等 ops-only 路径的 operator 只读诊断工具不算应用代码，例外靠路径约定+清单，不靠个案豁免。
- **豁免燃尽三钉**（NWT，不满足则 M0 不算完）：
  (a) 每条豁免挂具体批次名下燃尽：M2 完成→exchange 相关豁免归零；M4 完成→prediction 相关归零；M5 完成→豁免表物理删除。禁"以后会减少"式无主语承诺。
  (b) 连续两周豁免数零净减少 → 自动升级为阻塞项报频道，不许静默停滞。
  (c) 豁免基线全量文件路径清单 = M0 交付物，公开入库可核对。
- 反例警句入档：**"止血但永不缝合 = 自我实现的谎言。"**

### M1 协议分发解绑（按 handler 拆三批：pool / oracle / exchange 各自单独出 diff）
- 底座分发器 + 三个独立 handler；解开 exchange-machine 环形依赖。
- **两硬门（NWT，不满足不算完）**：①匹配规则**互斥且穷尽**——每条消息有且仅有一个 handler 接手，禁 first-match-wins 隐含优先级；②注册表**静态可枚举**，编译期可审，禁运行时动态注册。
- 设计稿必含威胁模型节：消息 type 字段发送方可控 → 路由层 type confusion（路错产生副作用 / 双 handler 重复处理）是首要攻击面。
- 验收：行为零变化（exchange stress 12/12 + pool/oracle test domain 回归全绿）。

### M2 Exchange 抽离（练刀批，产出《应用抽离 playbook v1》）
- M2a 归拢 `apps/exchange/`：**按表/功能组切 2-3 批**（NWT），纯移动+import 修正。
- M2b 接口化：裸 DB/relay 直连改仓储层+底座 API；共享表走底座接口。**设计稿必含运行时拓扑自报端点**（health 报告单体/半独立模式，KANet-UI）。
- M2c 独立进程化（视 M2b 后收益决定）：**runbook/supervisor/装载判据/健康检测/日志归档改造 = 一等验收项**（现 kanet-start/stop/supervisor 全按单 console 进程设计），不当"运维顺带的事"。
- exchange-machine 零改动（D4 修正）；表迁移前置检查复用 drain 清单。
- 验收：seeder deposit-watcher/refund-worker 真实用户路径零退化；OTC/exchange e2e 回归。

### M3 预测系统内聚（🔴 钱路主批 · **排序钉死 M3a+M3b → M3c**，J1："在还在变的靶子上做外科手术=返工不是加速"）
- **M3a** #28 P2 完成（真相源层模块化 + re-derive 纪律推广，J1 域）。**按一字段一批拆**（covenant_family 已完成为首例）；剩余待推广字段清单在 M3a 设计稿冻结。
- **M3b** V1↔bshard 功能对等核对（J2 域）：**逐状态转移非逐命令**（命令级核对会假阴性——recapture/dispatchRefund/#30 缺口在命令层面 bshard 都"有对应功能"，缺的是恢复/边缘分支）。对照表五列：V1 机制 / 触发场景 / bshard 对应 file:line / present-absent-partial / 风险层级（money-path/cosmetic），沿 7/17 recapture 卡模式一条一关。**第一子项 = 立停 V1 新建入口**；drain 23 条非终态到零 = 验收判据。
- **M3c** 结算 daemon 独立进程化（切共享 sqlite/直写 events/同 event loop 三条），**必须在 M3a+M3b 全部收敛后**才动；设计稿含拓扑自报端点。
- 硬约束不变：live 盘不停、rolling 零追加、ZK 主线（J2）优先级不被挤占。

### M4 预测系统抽离（按 M2 playbook；tg-bot `/api/pool/*` 契约冻结为对外 API）
- 验收：tg-bot/UI 零改动可用；结算 e2e 含孤儿盘/重启穿越两场景；真金测试网下注-结算走一遍；runbook 改造同 M2c 标准。

### M5 底座收尾与定位验收
- index.js 回归纯底座启动器；relay 命令表双轨落地（D2）；豁免表物理删除（M0 钉 a）。
- 终验收：最小 demo 应用仅靠《底座 API 契约 v1》完成"身份+通信+一笔结算"，不改一行 KANet 代码，fee-split 式冷启动计时公开验收。

---

## 4. 风险与不做清单（v0.1 基础上追加）

- 不一把梭 / 不动 working 钱路 / 不物理拆库 / 不微服务化教条（维持）。
- NWT 审查带宽为全程瓶颈：批规模硬上限（§2）就是为它定的；宁多批勿大批。
- 回退：结构批 git revert 即回；接口批 feature-flag 观察期 + 拓扑自报端点消除"现在是哪个模式"的人记负担。
- 豁免温床风险：M0 三钉机制对冲；两周零净减自动升级。
- 与公测运营/ZK 主线火力配比：**留 Owner 磨合裁定**（默认建议：ZK(J2) 与 M3a(J1) 并行不抢占；M0-M2 用非钱路带宽推进）。

## 5. 待办与交 Owner 事项

| 项 | 状态 |
|---|---|
| 34 命令分类表（J2 主核 + KANet-UI 复核） | ✅ 完成（A6+B9+C20=35，四方确认，已入 D2 三轨定稿） |
| 类 B 现状调用权限控制摸底 + caller 白名单方案 | D2 设计稿硬前置（钉死后 M0-M1 期间可并行做设计） |
| 本收敛稿交 Owner 磨合 | 待交（Bettor 精炼单点上报） |
| Owner 磨合点：①方案本体 ②节奏/火力配比（公测运营 vs 模块化 vs ZK 主线） | 待 Owner |
| 钉死后：M0 设计稿开工（首批派工） | 等钉死 |

---

**关联**：v0.1 首稿（`2026-07-22-kanet-base-modularization-roadmap-v0.1.md`，已 SUPERSEDED，含完整资产盘点数据）、频道对抗讨论记录（#v6c77r 首稿发布 / KANet-UI 三条 / NWT #①②③ / J1 两靶一议 / J2 三题 / #v6ij51 裁决）、`docs/2026-07-21-28-state-sync-architecture-full-design.md`、`docs/KANet-Positioning.md`。
