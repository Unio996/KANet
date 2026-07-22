# M-1.6 Caller 身份机制三案对比（J2，供 Owner 终选）

> **Status**: v0.2（2026-07-22 · J2·已消化 NWT MUST-FIX）
> **v0.2 修订记录**：消化 NWT 红队 verdict（`docs/2026-07-22-NWT-redteam-m1-6-caller-identity.md`，GREEN-with-1-MUST-FIX）——v0.1 §3 的"签发者可以是 Console 自己""relay 侧或 Console 侧验证"两处表述对威胁场景 B（被攻陷 Console worker）vacuous（自签自验=空验证），本版收敛为单一非空配置：**验证 locus=relay 进程内（fail-closed）+ 签名权=各 app 自持凭证（Console 不持全量签发密钥）**，不留"或"承重。§4 同步补入 A+C vs B 的真实 trade-off（供 Owner 终选，非改动量单维度）。
> **依据**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md` M-1 §5.6 派工——三案对比（HTTP 能力网关 / per-app socket / 签名能力信封），单机父子进程拓扑下最小改动视角，架构本身 Owner hold（不在评审里定）。
> **本卡性质**：设计文档，不改一行执行代码。

---

## 0. 现状拓扑（读码坐实，不是推断——这是选型的地基）

`kasia-console/src/services/relay-manager.js`：
- Console **单进程**内，对每个 relay 身份（`relayNodeId`）各自 `child_process.fork('src/relay.mjs', ...)`（:87），私钥经 `env.KASPA_PRIVKEY`/`KASPA_MNEMONIC` 注入该子进程环境，**relay 子进程与"身份"一一对应，不与"应用"对应**——一个应用（如预测系统）可能要用到多个 relay 身份（committee 成员/feeRelay/…）。
- 所有子进程句柄存在 Console 进程内的**同一个内存 map**（`_relays[relayNodeId]`）。`sendCommandAsync(relayNodeId, cmd)`（:277）查这个 map、调 `state.child.send(cmd)`（Node 原生 IPC）。
- **关键事实**：relay 子进程的 IPC 通道只连着它的直接父进程（Console），**机器上其它进程无法直接连上这个 IPC**——但 Console 进程内部，任何模块/任何 HTTP handler/任何 cron，只要能 import `relay-manager.js` 就能调 `sendCommandAsync` 对**任意** relayNodeId 发**任意**命令，零区分调用来源（今天预测系统代码和 exchange 代码和 admin 代码全在同一个 Node 进程里，共享同一份 `_relays` map，物理上无法区分"这条命令是哪个应用逻辑发起的"）。

**这就是 M2/M4 拆成独立应用进程后会破的假设**：现在"谁能调 relay"=" Console 进程内的任意代码"，拆分后预测系统/exchange 变成独立进程、只能经某种跨进程通道（HTTP 或别的）联系 relay——那条通道要不要验证"你是哪个应用、能调哪些身份/命令"，是本卡要选的东西。

---

## 1. 方案 A：HTTP 能力网关

**做法**：Console 保留现状（唯一持有全部 relay 子进程句柄），新增一层**窄化的 HTTP 能力端点**（不是现有裸 `sendCommandAsync` 透传），比如 `POST /api/capability/bshard-settle`、`POST /api/capability/exchange-offer-accept` 这类**按业务能力命名**而非按底层 relay 命令命名的端点。应用进程（拆分后的预测系统/exchange）调这些端点，Console 内部代码负责：①验证调用方 app 身份+scope（对照 capability matrix，M-1.1 已产出）②只在验证通过后才把请求翻译成具体的 `sendCommandAsync` 调用。

**跟单机父子进程拓扑的关系**：relay 子进程 fork 模型**完全不变**——Console 依然是唯一持有 relay 子进程句柄的进程，"唯一链上出口"这条角色边界零改动。改动只发生在 Console 的 HTTP 层：从"内部模块随便调 sendCommandAsync"变成"外部调用方只能过这层能力网关"。

**改动面（最小改动视角的核心论据）**：
- 不改 relay-manager.js 的 fork/IPC 机制。
- 不改 relay.mjs 任何 case handler。
- 新增：一层 HTTP 路由 + 一个 capability-matrix evaluator（M0c 已经要建的东西，直接复用）。
- 现有 tg-bot 已经是这个模式的雏形（纯 HTTP、不碰 DB、走 `/api/pool/*`），只是那层目前不做 capability 校验——本方案是把这个已验证可行的模式补上鉴权层，不是发明新架构。

**弱点**：
- Console 依然是单点——如果 Console 进程本身被攻陷，这层网关形同虚设（跟现状风险面相同，没有变差但也没有变好）。**该场景（威胁场景 B）的防线不在本方案，只能由方案 C 的两条硬约束提供（见 §3），网关自身对场景 B 零防御——这是组合推荐里 A 与 C 的明确分工，不是 A 的隐性能力。**
- capability matrix 的维护/更新如果不跟 M0c 的 evaluator 强绑定，网关本身可能沦为"看起来有检查，实际没人认真维护"（豁免温床同款风险，需要 NWT 的燃尽纪律套用）。

---

## 2. 方案 B：per-app socket

**做法**：不再是"一个 relay 身份一个子进程"，改成"一个应用一个专属 IPC/unix-socket 通道"，该通道的另一端只服务这一个应用的全部 relay 身份需求。app 身份由**它连接的是哪个 socket**决定（类似"座位绑定"），不是消息里自称的字段。

**跟单机父子进程拓扑的关系**：这是对现有 fork 模型的**结构性改动**——现状是"身份→进程"的 1:1 映射，本方案要求叠加一层"应用→通道"的映射，且一个应用可能横跨多个 relay 身份（预测系统要用 committee 成员+feeRelay 好几个身份），意味着要么①每个 relay 子进程都要知道"我这次是被哪个应用通道叫的"（在现有 fork 模型上加路由层，relay 子进程本身要改）,要么②在 Console 和 relay 之间插一层 broker 进程做通道到身份的翻译（新增一个组件，比现状多一跳）。

**改动面**：
- 需要新增至少一层 broker/router（无论插在 Console 内部还是独立进程），今天没有对应组件。
- relay.mjs 的每个 case handler 可能需要拿到"当前请求来自哪个 socket/app"这个上下文（目前完全没有这个概念，`cmd`对象里没有调用方字段）。
- 对已有 16+ 命令的 handler 签名有连锁改动面（即使只是新增一个上下文参数，仍然要逐个 touch，且这类改动落进 M-1 M0c 阶段的"钱路语义行≤50硬上限"考量）。

**优点**：结构上最干净——身份绑定在传输层，不依赖任何一方"老实自报"，理论上最难被绕过。**NWT 红队补充（v0.2 采纳）**：B 是三案里**唯一在传输层结构性绑定身份的方案，也是唯一天然抗威胁场景 B（被攻陷 Console worker）的传输层方案**——身份来自"连的是哪个 socket"这个物理事实，被攻陷的 Console 无法替别的 app 伪造通道成员资格。这一点 v0.1 轻描淡写了，Owner 终选应看到。

**结论（对比）**：改动面明显大于方案 A，且需要新增组件/连锁改现有 handler，不符合"单机父子进程拓扑下最小改动"这个筛选标准，但架构洁净度最高——如果 Owner 判断"这次要一次做对，不计较改动量"，B 是终态更彻底的选项。

---

## 3. 方案 C：签名能力信封（typed-intent + 能力凭证）

**做法**：不管请求走 HTTP 还是走进程内直调，每一条最终要送进 relay 的命令都必须附带一个**签名的能力信封**——内容至少包含：调用方 app 身份、typed intent（不是裸 witness/inputs/outputs，是"这次要做什么"的结构化描述）、scope(允许的市场/outpoint/金额范围)、nonce(防重放)、过期时间。信封验证通过后才放行，**不依赖传输通道本身提供身份保证**。

**两条硬约束（NWT MUST-FIX 收敛，缺一即 vacuous，不是可选配置）**：

1. **验证 locus = relay 进程内**：信封验证发生在 relay 子进程里、命令执行前，fail-closed（无信封/验证不过=拒绝执行）。**不能是 Console 内的 evaluator**——威胁场景 B（被攻陷 Console worker）下，Console 进程内任何验证逻辑都在攻击者可控地址空间里（进程内代码可不走网关直接 `import relay-manager.js` 调 `sendCommandAsync`，§0 已坐实）；relay 是被攻陷 Console 碰不到内存的独立进程，它自己的校验代码是场景 B 下唯一站得住的验证点。
2. **签名权 = 各 app 自持的独立能力凭证**（一次性 provision / 离线颁发），**Console 不持有全量签发密钥**。否则被攻陷 Console 直接给任意 app 签任意 scope 的信封=自签自验空验证。在此约束下，Console 被攻陷的上界=重放它观测到的合法信封（受 nonce+过期时间约束，M0c⑤兜底），**无法伪造新 scope**。

> v0.1 曾写"签发者可以是 Console 自己""relay 侧或 Console 侧验证"——NWT 红队打穿：该写法下场景 B 中攻击者"给自己签放行条自己盖章"，C 案对最高危场景零防御（memory: vacuous-teeth / verify-value-source 同款——checker 与被验对象同处攻击者可控域=空验证）。v0.2 起以上两条为本案定义的一部分，任何实现批偏离即不再是本卡推荐的方案 C。

**跟单机父子进程拓扑的关系**：这条**不改变**relay 子进程的 fork/IPC 结构本身（跟方案 A 一样，relay-manager.js 的 fork 机制零改动），但 relay.mjs 侧要新增信封验证入口（命令分发前统一验，非逐 handler 散装）——这部分是新代码，不涉及进程拓扑重构。app 凭证的 provision 流程（谁颁发、怎么轮换、怎么吊销）是 M0c⑦（免代码吊销）要一起设计的内容。

**改动面**：
- 需要设计信封格式+签发流程（新组件或 Console 内新模块）。
- 每个 relay 命令 handler 都要接入信封验证（M0c 七项里的④⑤⑥本质就是这个：逐 caller scope + nonce 防重放 + 审计绑定身份）——这跟 M0c 阶段本来就要做的事高度重合，**不是额外的第四套机制，是同一件事从不同角度描述**。
- 这是 Codex/Owner 已经在推的"typed-intent 全量完成"终态方向（v0.4.2 §D2："relay 从 typed、有 scope 的 intent 确定性构造未签名交易，返回 digest 供独立核验授权"）。

**结论（对比）**：这不是跟 A/B 互斥的第三个选项，而是**跟 A 组合的正确姿势**——方案 A 解决"谁能连到网关"，方案 C 解决"网关放行的这条命令本身有没有被正确授权、有没有被重放"，两层叠加才是完整防线（单独方案 A 挡不住"拿到合法 app 身份后申请超出自己 scope 的操作"，单独方案 C 不解决"传输层怎么先确认调用方是谁"）。

---

## 4. 推荐（供 Owner 终选，不越权拍板）

**单机父子进程拓扑下最小改动视角**：**方案 A（HTTP 能力网关）作为传输层选型 + 方案 C（签名能力信封，按 §3 两条硬约束定义：relay 进程内验证 + app 自持凭证）作为授权判据，两者叠加**——这个组合：
- 不改变 relay-manager.js 的 fork/IPC 结构（方案 B 的改动面最大，本卡不推荐作为传输层选型，除非 Owner 认为值得为架构洁净度承担更大改动）。
- 完全对齐 M0c 七项已经在设计的内容（caller identity/默认拒绝/evaluator/scope/nonce/审计/吊销），不是发明第四套机制。
- 复用 tg-bot 已验证的"纯 HTTP、不碰 DB"模式作为传输层先例，降低这条选型本身的风险。

**payload 明文 app_id 不可接受**（Owner 已定调："自我声明伪造零成本"）——方案 A+C 组合天然满足这条：app 身份不是消息里的一个字段，是能力信封签名验证出来的结果。

**分场景防线归属（v0.2 明确，防"A+C 笼统满足一切"的误读）**：
- **场景 A（被攻陷/越权的应用进程）**：A 网关挡"谁能连"，C 信封 scope 挡"连上后能干什么"——两层叠加成立。
- **场景 B（被攻陷 Console worker）**：A 网关在同进程内可被绕过（§0 坐实），**这个场景的防线只来自 C 案的两条硬约束**——relay 进程内验证（攻击者碰不到的验证点）+ app 自持凭证（攻击者伪造不了新 scope，上界=重放，nonce 兜底）。缺任何一条，A+C 对场景 B 退化为零防御。
- **场景 C（重放）**：C 信封的 nonce+过期时间，与 M0c⑤ 同机制。

**A+C vs B 的真实 trade-off（NWT 红队钉出，Owner 终选应知，非改动量单维度）**：A+C 抗场景 B 靠的是"relay 验证 + app 凭证"这层**实现纪律**（依赖落码不偷懒——签发密钥若图省事收归 Console 集中管理，防线整体 vacuous 且不易察觉）；方案 B 靠的是传输层**物理隔离的结构保证**（不依赖任何一方老实）。本卡仍按 Owner 给的"最小改动"筛选标准推荐 A+C，但两者的保证性质不同，这是终选时的真实代价面。

**与 containment 卡目标 B 的并轨约束**（Bettor 已编排、NWT 持二审硬条件）：containment 卡的凭证形态与本卡 C 案信封**同机制收敛、不另造第二套**——且"同一套凭证"必须是 §3 硬约束定义的 **app 自持 + relay 验证**版本，不能是换名共享 secret，否则命名合规（Codex RED-3）底层仍 vacuous。同一凭证管两卡=一处偷懒两处塌，实现批 diff 审须两卡对照着审。

---

**关联**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md`（M-1 §5.6、M0c 七项）、`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`（本卡的 scope/命令依据）、`docs/2026-07-22-NWT-redteam-m1-6-caller-identity.md`（红队 verdict，v0.2 消化对象）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（三威胁场景定义）、`docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md`（凭证并轨）。
