# M0c-3 设计稿 — 防重放 + 审计回执 + 免代码吊销（J2 主设计）

> **Status**: DRAFT（2026-07-23 · J2 出稿 → 待 Bettor 方向审 → 待 NWT 红队 → 待 Owner money-path 签发才落码）
> **本卡性质**：设计文档，不改一行执行代码；不授权任何落码/凭证 provision/relay 重启/签名/广播/结算/资金移动。
> **覆盖 M0c 七项之**：⑤nonce/request-id 防重放 + 幂等回执 ⑥审计回执绑定已认证身份 ⑦免代码吊销/禁用路径（①②=M0c-1；③④=M0c-2）。
> **选型无关（M0c 骨架 §1）**：nonce/审计/吊销机制不依赖身份验证形态 → 可在 M0c-1 落码期并行设计。
> **依据**：M0c-1 v0.3.2（`43c77044`，§5 AuthResult intentDigest + §4.1 nonce 留空接口）+ M0c-2（`1176a67a`，§4 ScopeDecision+grantId 接缝）+ Codex note③（replay state 必 **durable + atomic-reserve**，内存 nonce 非 acceptance-grade）+ M-1.2 v0.2 C-3（`relay.mjs` requestId 仅响应关联、**20/20 命令请求层去重全缺**）+ M0c 骨架 §1。

---

## 0. 接缝（消费 M0c-1 §5 + M0c-2 §4·定死不重定义）

- **M0c-1 §5 产出** `intentDigest`（canonical intent 摘要）→ M0c-3 ⑤用作 replay nonce 绑定的键。
- **M0c-2 §4 产出** `ScopeDecision` + `grantId` → M0c-3 ⑥审计绑定 + ⑦吊销查 grant。
- M0c-3 在 gate 流程的位置（母卡 §4.1 step6 留空接口）：**scope 判定通过后、命令执行副作用前**插 replay 校验（atomic-reserve）；执行后写审计回执。吊销查询在 gate step1（母卡 §4.1 / M0c-2 §3 step1）命中即拒。

---

## 1. 🔴 乙路 TCB 边界继承（置顶）

- replay 存储 / 审计日志 / 吊销表宿主在乙期 Console 可达信任域 → 对场景 A 有效；场景 B（Console 直接改这些表）无效。R 收口移出。
- **禁用词表（继承）**：禁"M0c-3 使被攻陷 Console 无法重放/篡改审计/绕吊销"类表述。允许口径="M0c-3 = 对应用的防重放+审计+吊销；Console=TCB，不防被攻陷 Console 改这些表；抗场景 B 需 R"。

---

## 2. ⑤ 防重放 + 幂等回执（Codex note③ 硬约束：durable + atomic-reserve）

**问题（M-1.2 C-3）**：`relay.mjs` 的 `requestId` 只做响应关联（哪个 reply 对哪个 request），**无去重**——同一已签名信封/命令重发会重复执行（重放攻击：截获合法 app 的结算命令重发 → 重复结算/转账）。20/20 命令请求层去重全缺。

**机制（Codex note③ 焊死）**：
- **durable 存储**：replay 记录落 **DB**（非内存——Codex 明确内存 nonce 非 acceptance-grade，进程重启/多 worker 会丢/不一致）。键 = `intentDigest`（M0c-1 §5，覆盖全部影响执行字段）+ app key-id + 可选 nonce/request-id。
- **atomic-reserve（副作用前）**：命令执行**副作用发生前**，原子地 reserve 这个 key（DB UNIQUE 约束 / `INSERT ... ON CONFLICT` 原子占位）——reserve 成功=首次，继续执行；reserve 冲突=重放，**拒 + 返回首次的缓存回执**（幂等：同 request 重发得同结果，不重执行）。
- **幂等回执**：reserve 记录存首次执行结果摘要（txid / decision），重放命中返缓存回执（幂等语义，非"拒绝报错"——防合法重试[网络抖动 app 重发]被误当攻击断掉）。
- **NO TX NO STATE 交互**：reserve 在广播前占位，但广播失败（未上链）时 reserve 记录须可回滚/标失败（否则重试被幂等挡住=资金卡）——reserve 状态机：reserved(占位)→committed(上链确认)→或 failed(可重试)。**这条是 J2 域 C3 纪律的延伸**（签的==执行的==reserve 的 intentDigest 一致）。

---

## 3. ⑥ 审计回执（绑已认证身份·durable）

- 每条经 gate 的命令（allow 或 deny）→ 写 **durable 审计记录**：`callerId`（service 身份，M0c-1 §5.1）+ `grantId`（M0c-2）+ `intentDigest` + `origin`（internal/app/operator）+ `ScopeDecision`（allow/deny+reason）+ 时间戳 + 执行结果（txid/失败）。
- **不记 secret 值**（继承 operator 专道 §2.5：只记"经 X tier 认证通过"事实）。
- **区别于现有链上 tx**：审计是**授权层**记录（谁被授权发了什么命令），链上 tx 是**结算层**记录（钱怎么动）——两者互补，审计答"这笔链上动作是哪个 caller 经哪个 grant 授权的"。
- **end-user 维度**（母卡 §5.1 T-9）：审计记 service 身份（callerId），端用户维度绑定随 containment MF6，本卡不预写。
- 存储：新审计表，过 DATABASE.md，migrate v190+（当前 v189）。

---

## 4. ⑦ 免代码吊销 / 禁用（运行时·免重启）

- **吊销表**（durable）：记被吊销的 caller（app key-id）/ grant（grantId）+ 吊销时间 + 原因。
- **生效点**：gate step1（M0c-1 §4.1 / M0c-2 §3 step1）查吊销表——命中 → `decision='deny'`（immediate，不需重启 relay/console）。
- **免代码**：吊销是**数据写入**（operator 写吊销表，走 §5 operator 通道），非改代码/重启——满足"运行时吊销某被攻陷/越权 caller"（M0c 七项⑦）。
- **写入面（继承 M0c-1 §4.3 provision）**：吊销表写入走 **operator 离线/operator 专道**（同 grant provision 通道，零应用可达）——应用不能自吊销他人或撤自己吊销。
- **与 grant 有效期互补**：有效期是被动过期，吊销是主动即时撤销（事故响应：发现某 app key 泄露 → 立即吊销，不等有效期）。

---

## 5. 与 M0c-1 / M0c-2 接入点

| 钩子 | 位置 | M0c-3 动作 |
|---|---|---|
| gate step1（吊销查询） | M0c-1 §4.1 / M0c-2 §3 step1 | 查吊销表，命中即 deny |
| scope 通过后、副作用前（replay reserve） | 母卡 §4.1 step6 留空接口 | atomic-reserve intentDigest，冲突返缓存回执 |
| 命令执行后（审计写） | switch 分支执行后 | 写 durable 审计记录 |

M0c-3 **不改** M0c-1/M0c-2 判定逻辑，只在其钩子点插 replay/审计/吊销（解耦）。

---

## 6. 负向测试（armed 判据·关2 行为验）

1. **重放同信封**：截获合法 app 已签命令重发 → 第二次 reserve 冲突 → 拒 + 返首次缓存回执（不重复执行/不重复结算）。
2. **幂等重试**：合法 app 网络抖动重发同 request-id → 返首次结果（不报错断掉，不重执行）。
3. **广播失败重试**：命令广播未上链（NO TX NO STATE）→ reserve 标 failed → 允许重试（不被幂等误挡=资金不卡）。
4. **内存 nonce 拒收**：验证 replay 存储是 durable（进程重启后重放仍被挡）——非内存（Codex note③）。
5. **审计完整**：每条命令（allow/deny）都有审计记录，含 callerId+grantId+intentDigest+decision，不记 secret。
6. **吊销即时生效**：吊销某 caller → 该 caller 下条命令立即 deny（不需重启）。
7. **吊销写入面**：应用尝试写吊销表（自吊销他人/撤自己吊销）→ 拒（写入走 operator 通道）。
8. **atomic-reserve 并发**：同 intentDigest 并发两请求 → 只一个 reserve 成功执行，另一个返缓存/拒（原子性，无 TOCTOU 双执行）。

**armed 判据**：1-8 落码后须全 BUST/正确。实战 harness 真发重放/并发/吊销请求验行为（关2，非单元）。

---

## 7. 预算维度（遵 Owner 令给维度不拍数）

| 组件 | 钱路语义行? | 落点 | 估 |
|---|---|---|---|
| replay 去重存储 + atomic-reserve | **是**（副作用前占位=钱路语义） | 新表（UNIQUE intentDigest）+ reserve 逻辑接入 gate step6 | 待落码，reserve 状态机 reserved→committed/failed |
| 审计表 + 写入 | 部分（写=非钱路，绑定正确性=审计完整性） | 新审计表 + gate 后写钩子 | 待落码 |
| 吊销表 + 查询 | 部分（查=钱路 gate，写=operator 通道） | 新吊销表 + gate step1 查 + operator 写 | 待落码 |

**改表**：replay/审计/吊销三表过 DATABASE.md，migrate v190+（当前 v189），设计定 schema 后同步 DATABASE.md。**诚实标注**：atomic-reserve 是钱路语义核心（防重复结算），reserve 状态机与 NO TX NO STATE 交互须 NWT 重点红队。

---

## 8. 待办 / 交接

- 本卡待 Bettor 方向审 → NWT 红队（照 §6 负向测试 + Codex note③ durable/atomic 深化 + reserve 状态机 vs NO TX NO STATE）→ Owner money-path 签发才落码。
- **接口消费 M0c-1 §5 intentDigest + M0c-2 §4 ScopeDecision/grantId**，两批落码定型后对齐。
- **改表** replay/审计/吊销三表过 DATABASE.md，migrate v190+。
- **吊销写入面**复用 M0c-1 §4.3 operator provision 通道（不新建写路径）。
- **reserve 状态机 × NO TX NO STATE** 是 J2 域 C3 纪律延伸（reserve 的 == 签的 == 执行的 intentDigest），落码 diff 审重点。

**关联**：`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md`（母卡 §5 intentDigest/§4.1 step6/§4.3 provision）、`docs/2026-07-23-m0c-2-scope-evaluator-design.md`（§4 ScopeDecision 接缝）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（C-3 去重缺口）、Codex note③（durable+atomic-reserve）。
