# M0c-2 设计稿 — 策略 evaluator + 逐 caller scope 精判（J2 主设计）

> **Status**: DRAFT（2026-07-23 · J2 出稿 → 待 Bettor 方向审 → 待 NWT 红队 → 待 Owner money-path 签发才落码）
> **本卡性质**：设计文档，不改一行执行代码；不授权任何落码/凭证 provision/relay 重启/签名/广播/结算/资金移动。
> **覆盖 M0c 七项之**：③对照 capability matrix 的策略 evaluator ④逐 caller 命令+钱包/市场/outpoint scope 精判（①②=M0c-1 已设计/落码中；⑤⑥⑦=M0c-3 另稿）。
> **选型无关（M0c 骨架 §1）**：evaluator 消费 M0c-1 产出的 `AuthResult`（callerId+grantId）+ M-1.1 capability matrix，**不关心身份怎么验出来的** → 可在 M0c-1 落码期并行设计。
> **依据**：M0c-1 v0.3.2 母卡（`43c77044`，§5 AuthResult 接口 + §4.2 grant 绑定字段）+ M0c 骨架（`docs/2026-07-22-m0c-capability-base-batch-prep.md` §1 切分）+ M-1.1 命令能力矩阵（`66cc5686`，~50 命令 14 列）+ M-1.6 v0.3.1（grant scope canonical 绑定）+ M-1.2 v0.2 §4 验收矩阵。

---

## 0. 接缝（M0c-1 → M0c-2 消费契约·母卡 §5 定死不重定义）

M0c-1 `authorizeCommand(cmd) → AuthResult` 产出（母卡 §5）：`authenticated`（身份验过）+ `decision`（M0c-1 层=身份验证+默认拒绝+**粗粒度** intent⊆grant）+ `callerId`（app key-id）+ `grantId`（命中的权威 grant）+ `intentDigest` + `reason`。

**M0c-2 的位置**：在 M0c-1 的 `decision` 基础上**叠加逐 caller 细粒度 scope 精判**——M0c-1 保证"有 grant 对照且 intent 粗粒度 ⊆ grant"，M0c-2 保证"intent 逐维度精确 ⊆ 该 caller 该 grant 的具体 scope"。消费 `callerId`+`grantId`（拿 grant scope）+ 反序列化后的 intent（命令+参数），**不消费身份验证过程**（选型无关接缝）。

**为什么分两层**（M0c-1 粗 / M0c-2 细）：M0c-1 是"gate 存在且 fail-closed + 有权威 grant"（防 grant-inflation 的前提在）；M0c-2 是"这个 grant 的 scope 边界逐维度焊死"（防已认证 caller 越自己 scope）。对应 NWT 靶单 **M1-8（身份≠授权）**：M0c-1 层已做 intent⊆grant 早拦（比预期早），M0c-2 做完整逐维度 scope。

---

## 1. 🔴 乙路 TCB 边界继承（置顶·M0c-2 不得声称抗 Console）

M0c-2 继承 M0c-1 §1 乙路诚实 TCB 声明：

- scope 策略表 / grant scope 数据宿主在**乙期 Console 可达信任域内** → 对场景 A（被攻陷/越权应用越自己 scope）有效；对场景 B（Console 直接改 scope 表自授权）无效。R 收口才移出。
- **禁用词表（继承）**：禁止"M0c-2 使被攻陷 Console 无法越 scope"类表述。允许口径="M0c-2 = 对应用的逐 caller 细粒度 scope 精判；Console=TCB，不防被攻陷 Console 改 scope 表；抗场景 B 需 R"。
- scope 精判**只对 origin='app' 路径 load-bearing**（外部应用走能力网关+envelope+grant）；origin='internal'（daemon）/'operator'（专道）走各自路径（M0c-1 §4.0/专道卡），不经 M0c-2 scope（它们是 TCB 内/operator-gated，scope 由各自机制管，M0c-2 不重复也不假装管）。

---

## 2. scope 策略数据模型（grant scope schema）

grant 的 scope 维度（M0c-1 §4.2 grant 绑定 + M-1.6 §5 canonical，M0c-2 定 evaluator 消费的结构）：

| 维度 | 内容 | 判据来源 |
|---|---|---|
| **allowed_commands** | 该 caller 允许的命令类型集 + typed-intent 版本 | M-1.1 capability matrix（命令→能力/效果列） |
| **relay/wallet scope** | 允许操作的 relay id / wallet 地址集 | grant 绑定 |
| **market/family/outpoint/branch** | 允许触达的 market_id / covenant family / 具体 outpoint / 分支 | grant 绑定（covenant 结算细粒度） |
| **收款人+额度上限** | 允许收款人地址集 + 单笔/累计金额上限 + 费率上限 | grant 绑定（intra-command scope，母卡 note-2 的 app 侧对应） |
| **有效期+版本** | grant 生效/失效 DAA 或时间 + grant 版本 + 吊销标识 | grant 绑定（吊销查询接 M0c-3 ⑦） |

**宿主（乙期）**：scope 策略 = grant registry 的一部分（M0c-1 §4.3 provision operator 离线写入，M0c-2 只读评估不写）。schema 落 DB 须过 DATABASE.md（migrate 接 v190+，当前 v189）或配置——落码定，本卡定维度不定存储形态。

---

## 3. evaluator 判定逻辑（逐维度 intent ⊆ grant scope·fail-closed）

`evaluateScope(callerId, grantId, canonicalIntent) → ScopeDecision`：

1. 拉 grant（grantId）的 scope（§2 各维度）——grant 不存在/已吊销/过期 → **拒**（fail-closed）。
2. **逐维度精判**（全过才 allow，任一维度越界即拒）：
   - 命令类型 ∈ allowed_commands 且 typed-intent 版本匹配 → 否则拒。
   - relay/wallet ∈ scope → 否则拒。
   - market/family/outpoint/branch ∈ scope（对 covenant 结算命令）→ 否则拒。
   - 收款人 ∈ allowed + 金额 ≤ 上限 + 费率 ≤ 上限 → 否则拒（intra-command scope 精判）。
3. 全维度过 → `allow`；任一拒 → `deny` + reason（审计，不泄露 secret）。
4. **fail-closed 不变量**：evaluator 任何解析异常/维度缺失/grant 读失败 → 拒（同 M0c-1 §3.2 解析异常 fail-closed）。scope 表未配置某维度 → **默认最严**（无 allowed_commands = 拒所有，非放行所有）。

**与 M0c-1 decision 合成**：最终 `decision = M0c-1.decision AND evaluateScope(...)`——M0c-1 先过（身份+粗 grant），M0c-2 scope 再过，任一 deny 则 deny。M0c-2 **不放宽** M0c-1 的拒（只可能更严），保证叠加单调。

---

## 4. 与 origin 四值 / M0c-3 的关系

- **origin='app'**：M0c-2 scope 精判 load-bearing（外部应用逐 caller scope）。
- **origin='internal'/'operator'**：不经 M0c-2 scope（§1，各自机制管）——evaluator 只在 app 路径调用，internal/operator 路径 M0c-1 gate 直接按各自 policy 放行/拒。
- **M0c-3 接缝**：M0c-2 产出的 `ScopeDecision` + `grantId` 供 M0c-3 审计（⑥绑 callerId+grantId+scope 判定结果）+ 吊销（⑦吊销命中 grant → evaluator step 1 拒）。M0c-2 不实现 nonce/审计/吊销（M0c-3），只在 step 1 留吊销查询接口。

---

## 5. 负向测试（scope 精判 armed 判据·关2 行为验）

每条 pass=拒(BUST)/fail=越 scope 得逞(LANDS)：

1. **越命令 scope**：caller 持合法 grant，发一个不在 allowed_commands 的命令 → 拒。
2. **越 relay/wallet scope**：合法命令但目标 relay/wallet 不在 scope → 拒。
3. **越 market/outpoint scope**：covenant 结算命令触达不在 scope 的 market/outpoint → 拒。
4. **超额度**：transfer/结算金额超单笔或累计上限 → 拒；费率超上限 → 拒。
5. **越收款人**：收款人不在 allowed → 拒。
6. **过期/吊销 grant**：grant 过有效期或已吊销 → 拒（step 1）。
7. **scope 表缺维度默认最严**：某 caller 无 allowed_commands 配置 → 拒所有（非放行）。
8. **M0c-2 不放宽 M0c-1**：M0c-1 已 deny 的（无身份/无 grant）→ M0c-2 不可能 allow（合成单调）。
9. **origin 路径隔离**：origin='internal'/'operator' 命令不误经 M0c-2 app scope 拒（各自路径正确放行/拒）。

**armed 判据**：1-8 落码后须全 BUST，9 须路径正确。实战 harness 真发越 scope 请求验拒 + 合法 scope 内请求验放行（关2 行为验，非单元）。

---

## 6. 预算维度（遵 Owner 令给维度不拍数）

| 组件 | 钱路语义行? | 落点 | 估 |
|---|---|---|---|
| scope 策略表 schema | 否（数据） | 新表/配置（过 DATABASE.md，migrate v190+） | 待落码 |
| `evaluateScope` 判定函数 | **是**（scope 判定=钱路语义） | 新 `scope-evaluator.mjs` 模块 + 接入 M0c-1 authorizeCommand 的 decision 合成点 | 待落码，超 50 拆逐维度子函数 |
| 与 M0c-1 合成接入 | 是 | authorizeCommand（M0c-1 gate）decision AND scope | 待落码（小，合成一行 + evaluator 调用） |

**诚实标注**：evaluator 是钱路语义核心，逐维度判定超 50 行硬上限则按维度拆子函数。具体行数落码读实际 diff 填。

---

## 7. 待办 / 交接

- 本卡待 Bettor 方向审 → NWT 红队（照 §5 负向测试 + M1-8 身份≠授权深化）→ Owner money-path 签发才落码。
- **接口消费 M0c-1 §5 AuthResult**（callerId+grantId），M0c-1 落码定型后对齐字段（现 M0c-1 批A/批B 落码中）。
- **改表**（scope 策略表）过 DATABASE.md，migrate 接 v190+（当前 v189）。
- **M0c-3 并行**：消费 §4 ScopeDecision+grantId 做审计/吊销，J2 域另稿。
- **origin 路径隔离测试**（§5-9）依赖 M0c-1 gate 的 origin 四值分支（批E）落地后端到端验。

**关联**：`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md`（M0c-1 母卡 §5 接口/§4.2 grant）、`docs/2026-07-22-m0c-capability-base-batch-prep.md`（三子批切分）、`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`（capability matrix）、`docs/2026-07-23-m0c-1-operator-settle-lane-design.md`（origin=operator 路径）。
