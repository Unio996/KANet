# KANet 底座模块化路线图 v0.4.1（内部二轮对抗 4/4 GREEN · 已送 Codex 复审 · 复审 GREEN 后请 Owner 钉死）

> **Status**: CURRENT（2026-07-22 · Bettor 主编）
> **v0.4.1 增量**：内部二轮 4/4 GREEN（KANet-UI/J1/J2/NWT）；Codex 四条代码断言全部 file:line 坐实；custodial_transfer 单列 M-1 最高优先级（校准定性：design debt 非当下可利用）；健康信号模板注记。
> **版本链**：v0.1 首稿 → v0.2/v0.2.1 内部对抗第一轮整合（#v6ij51，D2 三轨）→ v0.3 Owner 磨合五条落实（`bdfd5c80`）→ **v0.4 = Codex 外部对抗审查（RESPONSE-20260722-MODULARIZATION-ROADMAP，verdict：战略 GREEN / 执行案 RED）11 条 MUST-FIX 全消化**：新增 M-1 安全边界发现阶段、能力/效果授权模型（A/B/C 降为描述性分类）、盲签退役方向、批规模门改"语义门+钱路 50 行硬上限"叠加制（NWT 终裁）、drain 台账算术更正（14+9=23）与三停政策、M2 进程分离失败语义验收、M5 最小权限验收。
> **流程**：本稿 → 内部对抗第二轮 → 回 bridge 送 Codex 复审 → 双 GREEN → Owner 钉死 → 执行。钉死前不动任何执行代码（M-1 的取证/设计工作为只读+文档，Owner 已令即启，不属例外）。
> **流程锚**（Owner 终裁 2026-07-21 18:20Z）：首稿 v0.1 → 对抗讨论（本轮完成，四方全回执）→ **本收敛稿交 Owner 磨合 → 钉死后 Bettor 安排分批执行。钉死前不动任何执行代码。**
> **v0.1→v0.2 变更**：D2 拆双轨（J1）；D4 按 J2 读码修正（exchange-machine 零预测逻辑）+ V1 drain 退役方案（J2）；M0 加运维脚本例外 + 豁免燃尽三钉（KANet-UI/NWT）；M1 按 handler 拆三批 + 互斥穷尽两硬门（NWT）；全路线图单批规模硬上限（NWT 实测校准）；M3 排序钉死 M3a+M3b→M3c（J1）；运维/runbook 改造升为一等工作项 + 拓扑自报端点（KANet-UI）。
> **本卡性质**：设计文档，不改一行执行代码。

---

## 0. 总纲（不变）

底座回归立项定位（`docs/KANet-Positioning.md`）：只留三原语（安全通信/身份与发现/价值结算）+ 运行时角色（Console 传导 / Relay 唯一链上出口 / Scout 只读 / Mind 决策）。预测系统与 kas 兑换系统按同一套可复用模式抽离为应用。终验收 = 立项原文标准：**新应用接入 KANet，不改一行 KANet 代码**。

现状量化证据、底座保留资产清单、三种已验证抽离范式（fee-split 纯函数包 / 独立进程 / 同仓收敛）与选型规则（③同仓收敛→接口化→②独立进程渐进，禁一步微服务化）见 v0.1 §1，本稿不重复，数据不变。

**Codex 镜子（v0.4 起为总纲第二句）**："Directory boundaries without capability boundaries are cosmetic modularity"——只有目录边界没有权限边界 = 化妆式模块化。本路线图定义的不只是"应用和底座在哪分开"，必须同时定义"**什么权限跨过这条边界**：哪个应用身份、对哪个钱包/市场/outpoint/金额、行使哪个能力、按什么运行时策略、如何吊销、如何审计"。这就是 M-1 阶段存在的理由。

---

## 1. 设计决策（对抗讨论后定稿）

### D1 数据库：不物理拆库，先拆访问路径 + schema 归属移交应用（v0.4 补 Codex MF5，Owner 令二选一必须明写）
应用专属表留 console.db，应用代码一律经仓储层/HTTP API 访问，禁止裸 `sqlite` 句柄。物理拆库留待独立进程化稳定后单独议。
**MF5 矛盾裁定（二选一，本稿选前者）**：若新应用接入要底座加表/迁移/仓储/端点，则"不改一行 KANet 代码"的终验收不可达——耦合只是躲进了 HTTP 后面。**裁定：schema 归属移交应用**——app 专属 schema/数据/迁移由应用自有；底座只暴露通用身份、通信、结算、事件、证据原语。过渡期物理文件可同库共存，但 **schema 归属权与迁移权分离且限时**（燃尽计划挂 M2/M4 批次，同 M0 豁免机制）。共享库过渡期规范（M2b 设计稿必含）：迁移属主与顺序 / schema 兼容与版本协商 / HTTP 上的事务与快照语义 / 幂等与乐观并发 / WAL 背压与进程崩溃行为 / 事件 outbox 语义 / 备份恢复属主——否则 M2b/M3c 是拿分布式半写换进程内原子性。

### D2 Relay 命令表：能力/效果授权模型（v0.4 重构 · Codex MF1 采纳）

**A/B/C 三分类降级为描述性"脚本信任模型"，不再充当授权模型**（Codex MF1：分类描述的是 relay 怎么处理脚本，不是"谁被允许干什么"）。授权模型 = M-1 产出的**全命令能力/效果清单**，覆盖全部 ~50 条命令——**含 16 条"通用原语"**：transfer / custodial_transfer（收调用方外部私钥！）/ ecdsa_sign（任意消息签名）/ sign_input_for_settle（调用方给交易字节）/ sweep_per_bet 等不因"通用+早就有"就归入同一安全级。清单最小列（machine-readable）：命令 / 效果类（read·derive·build·sign·submit·transfer·wallet-admin·state-mutate）/ 所用密钥与钱包 / 允许资产与网络 / 允许市场-家族-分支 / 输入 outpoint 范围 / 收款与输出约束 / 金额-费率上限 / 幂等键 / 所需证据与终局性 / 调用方能力 / 审计回执 / 吊销机制 / 是否可进公开应用契约。

**类 B 现状取证结论（J2 四层表 + NWT 复核，2026-07-22 频道在案，M-1 第一份输入）**：①认证【没有】（console HTTP 层零认证，preHandler 只做编码校验）②授权【没有独立层】（仅业务数据隐性绑定——bettor_pk 匹配本机 relay_nodes 等，是 business-logic 副作用非 access control 设计）③传输边界【部分】（console↔relay 为 OS 级 child_process fork IPC，进程隔离真实=内墙有；外部→console HTTP 零认证=外门无）④审计【部分】。缓解性事实：9 条盲签命令的 redeem 字节全部取自 DB 服务端历史值，非 HTTP body 直传；其中 5 条纯内部 cron 零 HTTP 触面、4 条 HTTP 路由直通无认证。**现状安全姿态="业务逻辑巧合挡住滥用"，且整体依赖"console 是唯一受信任调用方"这一假设——M2/M4 多应用进程化后该假设直接失效**（NWT 复核结论）。

#### D2 附：脚本信任模型三分类（描述性，保留作分析工具）
分类表已完成（J2 主核读 COMMAND_PAYLOAD_SCHEMA/FIELD_TYPES + KANet-UI 实读 relay.mjs 抽查坐实 + J1/NWT verdict）：**类 A 6 + 类 B 9 + 类 C 20 = 35 条**（原估 ~34，取整差异）。分轨依据是 **relay 对 covenant 脚本的信任模型**，非组合 vs 扩展：

- **类 A 纯计算/只读（6）**：GET_PER_BET_ADDRESS / POOL_V07_COMPUTE_REFUND_MASS / CHAIN_GET_* ×3 / GET_ADDRESS_UTXOS。零签名能力，风险天然有界 → **轻量应用注册通道**。
- **类 B 盲签（9，风险排三类之首——J1 裁定，NWT 认可）**：PREDICTION_SETTLE_TX 等 9 条，调用方传 `redeem_script_hex`，relay 零结构/opcode 校验原样签字（KANet-UI 实证 `relay.mjs:786-816`）。本质 = "唯一链上出口"的独立校验能力被清空，**谁能拿到这个 IPC 接口 = 谁就有等效签名权**；与 covenant_family 治的"不独立验证、只信调用方声明"是同一反模式。两条硬约束（J1 钉，非软建议）：
  ① **caller 白名单必须运行时强制**（relay 侧校验 caller identity），不是审查时君子协定；现状这 9 条的调用权限控制是既有缺口，D2 设计稿**硬前置**摸清并趁重构窗口补上（NWT）。
  ② ~~长期观察项：模板 hash 结构校验~~ **v0.4 修正（Codex MF3，J1 认账）**：模板 hash 只证"脚本像已批准家族"，**不证"这笔交易被授权"**（outpoint/分支/winner/收款人/金额/费用/locktime/sighash 全部可在合法模板下更换；J1 自注 assertPayoutShardCoherence 边界与此同源——家族匹配≠交易授权）。降为辅助校验，不得作为授权依据。
  D2 设计稿中类 B 是最重的一块，禁被"只有 9 条"的数量印象带轻。

**签名/提交运行时策略（Codex MF3+MF4，类 B 与类 C 一体适用——"relay 自己编译"只防脚本替换，不防未授权价值移动；代码审查是开发流程，不是运行时控制）**，签名前逐项校验：家族+covenant 精确身份与出处 / 当前 outpoint 未花且达终局标准 / 允许的 entrypoint 分支 / 输出清单与价值守恒 / 收款人绑定 / 费用与找零上限 / 期望网络与 sighash 类型 / typed-intent 或预授权交易 digest 精确匹配 / 幂等防重。**终态方向：退役任意字节盲签**——relay 从 typed、有 scope 的 intent 确定性构造未签名交易，返回 digest 供独立核验授权，只签 byte-identical 的已授权 digest。
- **类 C relay 内建 covenant 编译（20）**：BSHARD_* / CLOSEZK_* 全家，payload 为结构化 {witness,inputs,outputs}，relay 内部编译脚本字节。每加一条 = relay 签名能力集合实际变大 → **应用命令注册机制 + relay 代码库全强度审查**（NWT/团队，不下放 app 自审）。

### D3 协议消息分发收归底座原语（维持，DoD 见 M1 两硬门）

### D4 V1 预测路径退役（J2 读码修正后重写）
**修正**：exchange-machine.js 本身零预测专属逻辑，`transition()`/`spendFunds()` 是通用状态机；耦合是**单向的**——V1 settler 作为消费者借用通用 API（查 `exchange_offers WHERE give/want_asset='prediction_outcome_share'`）。因此：
- M2 抽离 exchange 时 **exchange-machine 不为 V1 改一行代码**。
- V1 退役 = **drain 方案**：①**三停显式政策（v0.4 补 Codex MF8）**：停建新 V1 市场 + 停建新 V1 offer + **存量市场停收新注**（三件全停；第三件不停会无限拖长 drain。现存 4 条 pending_bettors 仍可下新注，停注入口的技术落点为 M3b 第一子项细化）→ ②现存 **23 条非终态（14 条 pool_markets V1[4 pending_bettors+2 refunding+8 pending_oracle_deposits] + 9 条 prediction_outcome_share offer，两表物理不重叠零去重——J2 复查更正，原报 15 为复述笔误）** 在旧代码路径原样跑到自然终态（不动 working 钱路）→ ③零非终态确认后才删 `bettor-prediction-settler.js` 等 V1 文件。**drain 清零即验收判据，不拍日期。**
- **drain 义务台账 = M3b 前置件（Owner 采 Codex MF8）**：固定快照查询 + 逐行字段：市场 ID 与关联 offer ID / 当前状态与终态判据 / 最后下注与敞口 / deadline-endBlock 证据状态 / 属主与监控人 / pinned 代码版本 / 兜底恢复路径 / M2-M3 期间不可移除的依赖。
- **drain 超期终态化兜底（Owner 磨合补，堵验收判据自身的 ABSTAIN 风险）**：drain 启动后 **30 天为超期审查点**（触发人工裁定流程的点，非自动强制）——届时仍未自然终态的行（如对手方永不响应的孤儿单），由 Bettor 逐条汇总提案（可判定结果的走 settle；确实无法判定的提请 refund），**Owner money-path 签发后执行终态化**。与"只 settle 绝不 refund"既有先例一致：refund 仅在 Owner 签发下作为例外路径。
- exchange_offers 表物理迁移前置检查 = 复用同一张 drain 清单（防 V1 数据孤立），不另造。

---

## 2. 全路线图硬约束（v0.4 重写：NWT 叠加门终裁 + Owner 语义澄清，Codex MF7 消化）

**行数预算 ≠ 风险预算；权限相关 diff 无论多小走全强度**（Owner 定语）。批次门 = 叠加制，不是二选一：

- **①语义切片门（必要条件，通不过则不管多小都不算一批）**：单一命名不变量/改动目标 · 依赖与钱路爆炸半径有界 · 每个中间 commit 可部署或显式 dark/disabled · 完整测试在同一验收单元 · 独立回退 · 不临时放宽任何权限。人为拆批不得制造不安全中间态。
- **②钱路语义行硬上限（NWT 终裁，无书面例外）**：触及**签名/授权/花费构造逻辑**的改动行单独计数，**单批 ≤50 行**，超出强制拆批。（依据：今晚最致命的坑 marker off-by-one 是几十行里的一个字符；而 468 行 11 文件的纯接线批照样审出实 bug——出事维度是钱路语义密度，不是总行数。）
- **③纯结构搬移预算（Codex 模式）**：纯移动/import 重写适用 ≤300 行默认预算 + 书面例外（例外须记录理由入批次卡）。
- **排期换算：每批 = 半天到一天实打红队时间**；大改动耦合风险非线性，禁按行数线性外推。
- 每批完整审链：设计 → NWT 红队 → 落码 → diff 审 → 装载验证；涉钱路走 D-011。

---

## 3. 分批路线（v0.4 排序：**M-1（即启）→ M0a（与 M-1 并行）→ M0b（M-1 后）→ M1 → M2 → M3 → M4 → M5**）

### M-1 安全边界发现（v0.4 新增 · Codex 核心要求 + Owner 两半拆法约束范围）
> Owner 裁定：M-1 插入接受，**整体串行反对**——防"安全完美主义反噬止血时效"（否则即"止血但永不缝合"的镜像失败）。M-1 全部为只读取证+文档设计，不动执行代码，Owner 已令即启。
- **摸底类（全量做）**：
  1. **全命令能力/效果清单**（machine-readable，覆盖全部 ~50 条**含 16 条"通用原语"**——Owner：D2 号称穷尽却排除 transfer/custodial_transfer/ecdsa_sign/sign_input_for_settle 于分类外，是在自己身上违反 M1"互斥且穷尽"；列定义见 D2 节）。已开工：J2 类 B 四层表已交，A/C 与通用原语扩展中。
  2. 威胁模型：被攻陷应用 / 被攻陷 Console worker / 重放的 IPC 或 HTTP 请求。
  3. public-vs-internal 命令资格划分。
  4. **Codex 代码断言我方复核**（Owner：verify over echo 双向适用）——**四条全部坐实（v0.4.1，内部二轮期间完成）**：HTTP 零认证（J2 四层表）、dispatch 无身份校验（NWT，relay.mjs:331 起）、custodial_transfer 收调用方 privkeyHex（NWT，relay.mjs:478-490，IPC 字段直传 custodialSendKaspa，relay 不派生）、prediction_settle_tx 完整可控参数面（J1，relay.mjs:734-758，redeem/outpoints/outputs 收款地址金额/sigs/winner 全部 IPC 原样直传零校验，与 Codex MF3 可换维度逐字段吻合）。
  4b. **custodial_transfer 单列 M-1 设计最高优先级项**（NWT 提、J1 附议、J2 补全链路、NWT 接受校准后的最终定性）：relay 层对 privkeyHex 来源零验证 = **实际存在的信任模型缺陷（design debt），但非当下可利用**——现存唯一触发路径（tg-wallet.js:92 send）有 ingest-secret 认证且私钥不出 console 进程边界；风险窗口在 M2/M4 多进程化后打开。性质与类 B 授权问题不同量级（密钥材料暴露面 vs 签名授权），在 M-1 caller identity 机制设计中排最优先，不与类 B 九条混排。
- **设计类（只做到这两件为止）**：
  5. capability matrix（应用 × 钱包/市场/outpoint/分支/金额/收款地址 × 动作）。
  6. **caller 身份机制选型**：HTTP 能力网关 / per-app socket / 签名能力信封三案对比——**架构不在评审里定**（Owner hold），J2 出单机父子进程 IPC 拓扑下的最小改动对比，Owner 终选。payload 明文 app_id 不可接受（自我声明伪造零成本）。
- **明确不属 M-1**（独立立卡，不作 M0b 解锁条件）：typed-intent 签名全架构（按类 B 9 条分批实施）、capability 授权吊销机制全量实现。
- 验收：清单 + matrix + 威胁模型 + 选型对比四件齐，NWT 红队过。

### M0 边界冻结（止血批 · Owner 拆两半）
- **M0a lint 卡点（立即可做，与 M-1 并行——负向约束"新代码禁裸连"不依赖 M-1 结论，冻错风险为零）**：新增代码禁止应用目录裸连 sqlite/relay-manager。
- **M0b《底座 API 契约 v1》冻结（移到 M-1 之后——冻错契约比不冻更糟；契约必须建立在 capability matrix 上，防把超权命令冻成"公开原语"）**。
- **例外**（KANet-UI）：`scripts/` 等 ops-only 路径的 operator 只读诊断工具不算应用代码，例外靠路径约定+清单，不靠个案豁免。
- **豁免燃尽三钉**（NWT，不满足则 M0 不算完）：
  (a) 每条豁免挂具体批次名下燃尽：M2 完成→exchange 相关豁免归零；M4 完成→prediction 相关归零；M5 完成→豁免表物理删除。禁"以后会减少"式无主语承诺。
  (b) 连续两周豁免数零净减少 → 升级为阻塞项报频道，不许静默停滞。**执行主语（Owner 磨合钉死）：COORD-LEDGER 周检项，Bettor 执行**——有归属才算机制，非文化承诺。
  (c) 豁免基线全量文件路径清单 = M0 交付物，公开入库可核对。
- 反例警句入档：**"止血但永不缝合 = 自我实现的谎言。"**

### M1 协议分发解绑（按 handler 拆三批：pool / oracle / exchange 各自单独出 diff）
- 底座分发器 + 三个独立 handler；解开 exchange-machine 环形依赖。
- **两硬门（NWT，不满足不算完）**：①匹配规则**互斥且穷尽**——每条消息有且仅有一个 handler 接手，禁 first-match-wins 隐含优先级；②注册表**静态可枚举**，编译期可审，禁运行时动态注册。
- **升级为精确派发契约（v0.4 采 Codex MF6）**：exact versioned `type → 单一 handler` 映射 / 重复注册 = 构建或启动即失败 / 未知 type fail-closed / schema 版本带命名空间、禁隐式跨版本回退 / 授权判定先于 handler 选择的任何副作用 / 一条入站消息产生零或一个效果，绝不产生两个 / handler 失败不得穿透到另一 handler。
- 设计稿必含威胁模型节：消息 type 字段发送方可控 → 路由层 type confusion（路错产生副作用 / 双 handler 重复处理）是首要攻击面。
- 验收：行为零变化（exchange stress 12/12 + pool/oracle test domain 回归全绿）**+ 路由器完备性测试**：枚举全部注册 type、未知/fuzz type、重复注册、畸形版本、重放/幂等、副作用探针（现有 stress 测试不证明路由完备与 exactly-once）。

### M2 Exchange 抽离（练刀批，产出《应用抽离 playbook v1》）
- M2a 归拢 `apps/exchange/`：**按表/功能组切 2-3 批**（NWT），纯移动+import 修正。
- M2b 接口化：裸 DB/relay 直连改仓储层+底座 API；共享表走底座接口。**设计稿必含运行时拓扑自报端点**（health 报告单体/半独立模式，KANet-UI）。
- M2c 独立进程化（视 M2b 后收益决定）：**runbook/supervisor/装载判据/健康检测/日志归档改造 = 一等验收项**（现 kanet-start/stop/supervisor 全按单 console 进程设计），不当"运维顺带的事"。
- 健康信号模板（KANet-UI 二轮补，非阻塞）：rpc-health-degradation-alert 的"检测+events 表+播频道"三件套直接作为各独立 daemon 进程的健康信号模板复用，M-1/M2c 设计时照抄现有实现，不重新设计。
- **进程分离失败语义验收（v0.4 采 Codex MF9——seeder deposit-watcher/refund-worker 是钱路，进程分离即使业务逻辑不变也改变 crash 窗口/顺序/重试/原子性；exchange 抽离不因"半冻结"就天然低风险）**，M2c 前必备：shadow/dual-read 对比 · checkpoint 事件重放 · 幂等与重复投递测试 · outbox/inbox 级持久交接 · "链上已生效但 DB 未确认"崩溃场景 · supervisor 重启与 stale-worker fencing · 限定钱包/金额范围的 canary 模式 · 回退不产生双活 worker。**"行为零变化"必须涵盖运维失败语义，不只 happy-path e2e。**
- exchange-machine 零改动（D4 修正）；表迁移前置检查复用 drain 清单。
- 验收：seeder deposit-watcher/refund-worker 真实用户路径零退化；OTC/exchange e2e 回归。

### M3 预测系统内聚（🔴 钱路主批 · **排序钉死 M3a+M3b → M3c**，J1："在还在变的靶子上做外科手术=返工不是加速"）
- **M3a** #28 P2 完成（真相源层模块化 + re-derive 纪律推广，J1 域）。**按一字段一批拆**（covenant_family 已完成为首例——**回执链（v0.4 补 Codex MF11，Owner 令"不因是自己人就降低证据标准"）**：批 1 commits `d829e8fe→ced75f31→09f911da→a0583ace→c6095001`、批 2 `ebee4012→a2a228ea→0505c11a→54f57f66→bcab1128→c887ed26`（bshard-m3-deploy，已 merge master `2d48f264..5daad1ad`）+ 7 测试文件双环境跑绿 + backfill migrate v189 生产实跑 721 行与 dry-run 零偏差 + NWT 批 1/批 2 各自 GREEN + KANet-UI 装载三验 + DoD-8 真金下注验证。Codex 所据 bridge STATUS 为 stale，非路线图夸大，STATUS 更新另行处理）；剩余待推广字段清单在 M3a 设计稿冻结。**M3 依赖以 commit/测试/状态门为准，不以叙事里程碑为准**（MF11 后半采纳）。
- **M3b** V1↔bshard 功能对等核对（J2 域）：**逐状态转移非逐命令**（命令级核对会假阴性——recapture/dispatchRefund/#30 缺口在命令层面 bshard 都"有对应功能"，缺的是恢复/边缘分支）。对照表五列：V1 机制 / 触发场景 / bshard 对应 file:line / present-absent-partial / 风险层级（money-path/cosmetic），沿 7/17 recapture 卡模式一条一关。**第一子项 = 立停 V1 新建入口**；drain 23 条非终态到零 = 验收判据。
- **M3c** 结算 daemon 独立进程化（切共享 sqlite/直写 events/同 event loop 三条），**必须在 M3a+M3b 全部收敛后**才动；设计稿含拓扑自报端点。
- 硬约束不变：live 盘不停、rolling 零追加、ZK 主线（J2）优先级不被挤占。

### M4 预测系统抽离（按 M2 playbook；tg-bot `/api/pool/*` 契约冻结为对外 API）
- 验收：tg-bot/UI 零改动可用；结算 e2e 含孤儿盘/重启穿越两场景；真金测试网下注-结算走一遍；runbook 改造同 M2c 标准。

### D2-C 存量补审批次组（Owner 磨合挂账，消除隐形排期）
- D2 注册机制管**增量**；存量 20 条类 C 命令的全强度补审是独立工作量——按 §2 上限换算约 **2-4 个红队批次**，显式挂账为独立批次组，排期 M3 完成后启动、M5 终验收前完成（M5 验收依赖 relay 命令表干净）。不写进路线图 = 隐形排期，故单列。

### M5 底座收尾与定位验收
- index.js 回归纯底座启动器；relay 命令表三轨落地（D2，A 轨注册机制 + B 轨白名单强制 + C 轨核心表）；D2-C 存量补审批次组完成；豁免表物理删除（M0 钉 a）。
- 终验收：最小 demo 应用仅靠《底座 API 契约 v1》完成"身份+通信+一笔结算"，不改一行 KANet 代码（D1 已裁 schema 归属移交应用，使此句可达），fee-split 式冷启动计时公开验收。
- **最小权限五维（v0.4 采 Codex MF10 + Owner"与 BUST/LAND 探针文化同构"）**：demo 拿超权 transfer 接入 = 用牺牲安全边界换扩展性，不算过。验收必含：声明式最小权限能力清单 / 无任意消息-交易签名 / 限定测试钱包或有界 fund lock + 金额-频率-收款人限制 / 可吊销 + 完整审计回执 / **拒绝越权测试 + 应用被攻陷演练**（证明攻陷一个 app 影响不了其他 app/市场/钱包）。

---

## 4. 风险与不做清单（v0.1 基础上追加）

- 不一把梭 / 不动 working 钱路 / 不物理拆库 / 不微服务化教条（维持）。
- NWT 审查带宽为全程瓶颈：批规模硬上限（§2）就是为它定的；宁多批勿大批。
- 回退：结构批 git revert 即回；接口批 feature-flag 观察期 + 拓扑自报端点消除"现在是哪个模式"的人记负担。
- 豁免温床风险：M0 三钉机制对冲；两周零净减自动升级。
- 与公测运营/ZK 主线火力配比：**批次总量量化**——Owner 磨合粗算 M0(1)+M1(3)+M2(4-5)+M3a(3-5)+M3b(1-2)+M3c(1)+M4(2-3)+M5(1) ≈ 13-18 批；加 D2-C 存量补审（2-4 批）+ **v0.4 新增 M-1（摸底+matrix+选型，估 2-3 批红队量）+ typed-intent 独立卡（类 B 9 条分批，估 3-5 批，长线）** 后总量约 **20-30 批**，与 ZK 主线和公测运营共享同一 NWT 瓶颈。默认配比（Owner 已认可）：ZK(J2) 与 M3a(J1) 并行不抢占；M0a/M-1 走非钱路带宽即启。裁决依据是这个总量，不是里程碑个数的印象。
- **Codex 复审流程旗（Owner 定）**：评审权 ≠ 状态裁定权——bridge STATUS 由 Codex 写的 `blocked` 改为 `red_verdict_pending_owner`；后续评审同理，verdict 归评审方、状态裁定归 Owner。

## 5. 待办与交 Owner 事项

| 项 | 状态 |
|---|---|
| 35（原估 34）命令分类表（J2 主核 + KANet-UI 复核） | ✅ 完成（A6+B9+C20=35；v0.4 起降级为描述性分类，授权模型另立） |
| 类 B 现状调用权限摸底（NWT 四层判据） | ✅ 完成（J2 四层表：认证无/授权无独立层/传输部分/审计部分；NWT 复核） |
| M-1 全命令能力/效果清单（~50 条含通用原语） | 进行中（J2 扩展 A/C+通用原语；Codex 四断言全部 file:line 坐实 ✅） |
| 内部对抗第二轮 | ✅ 4/4 GREEN（KANet-UI/J1/J2/NWT，2026-07-22 22:1x，含两断言坐实与 custodial_transfer 校准增量） |
| M-1 caller 身份机制三案对比（gateway/per-app socket/能力信封） | 待做（J2 出对比，Owner 终选） |
| drain 义务台账（固定快照+逐行字段） | M3b 前置件，待做 |
| bridge STATUS 更新（MF11 回执 + `blocked`→`red_verdict_pending_owner`） | 待做（Bettor 执行） |
| D2-C 存量 20 条补审批次组 | 已挂账（2-4 批，M3 后启动，M5 前完成） |
| typed-intent 签名全架构 | 独立卡（类 B 9 条分批，不卡 M0b） |
| Codex 复审（v0.4.1 送 bridge） | 已发起（MSG-20260722-114） |
| Owner 钉死 | 双 GREEN 后 |
| 本收敛稿交 Owner 磨合 | 待交（Bettor 精炼单点上报） |
| Owner 磨合点：①方案本体 ②节奏/火力配比（公测运营 vs 模块化 vs ZK 主线） | 待 Owner |
| 钉死后：M0 设计稿开工（首批派工） | 等钉死 |

---

**关联**：v0.1 首稿（`2026-07-22-kanet-base-modularization-roadmap-v0.1.md`，已 SUPERSEDED，含完整资产盘点数据）、频道对抗讨论记录（#v6c77r 首稿发布 / KANet-UI 三条 / NWT #①②③ / J1 两靶一议 / J2 三题 / #v6ij51 裁决）、`docs/2026-07-21-28-state-sync-architecture-full-design.md`、`docs/KANet-Positioning.md`。
