# operator-scoped 结算专道设计稿 — relay.js:1726 收敛 A 方案的 money-path 出口

> **Status**: DRAFT（2026-07-23 · J2 出稿 → 待 Bettor 方向审 → 待 NWT 红队 → 待 Owner **专道 money-path 签发**才落码）
> **本卡性质**：设计文档，不改一行执行代码；不授权任何落码/凭证 provision/relay 重启/签名/广播/结算/资金移动。
> **是什么**：M0c-1 relay.js:1726 收敛 **A 方案**（Bettor 拍板）里的 (b) 分量——operator 手动结算的 money-path 命令彻底离开共享 secret 端点后，落地的**operator-scoped 专用 money-path 路径**。**gate-arming 硬前置**：M0c-1 gate armed 前此专道必须到位（否则钱路面无合法出口或仍走场景A可达的宽端点）。
> **依据**：M0c-1 v0.3.2（`43c77044`，§4.0/§4.3）+ 分类清单 relay.js:1726 收敛 A 拍板（`c698edea`，§1）+ M-1.6 v0.3.1 乙路 TCB 声明 + Owner M0c-1 设计层签发（20:12Z，Bettor 地面核 tx df8abb9a + J2 relay_nodes 核 Owner-qrymjvc-tn 91e2efb1）。
> **是独立新钱路组件**：不折进 M0c-1 核心落码批（NWT gate①）——走自己的 design→NWT 红队→Owner 签发，J2 才 wire。

---

## 0. 问题（为什么需要专道）

relay.js:1726 `POST /api/relay/:id/send-command` = 零鉴权裸透传（转发任意 body 到任意命令含全钱路）。收敛 A 方案把它拆成两条出口：

- **非钱路通信类** → 留在端点，端点加 auth + 白名单收窄（KANet-UI 部署侧）。
- **money-path 类**（operator 手动 covenant/结算刚需，实测命令集见 §2.2）→ **彻底移出该端点**，走本专道。

**为什么不能只给端点加 verifyIngestRequest 保留钱路**（NWT precondition，M0c-1 §4.3）：verifyIngestRequest = 11 组件共用**共享 ingest secret**，tg-bot（场景A app，托管钱包）就持这个 secret → 加了它端点仍是"持共享 secret 者（含场景A）可达" → 场景A app 仍能发 money-path → **不满足 gate-arming precondition**（gate 场景A保护 vacuous）。故 money-path auth 必须用**排除场景A的凭证**（非共享 ingest secret）。

---

## 1. operator 手动结算是刚需（不许静默砍·红线）

operator scratch 脚本（事故兜底 + 一次性盘处置）**实需**经某路径发 money-path covenant 命令——NWT+KANet-UI 各自收回"只读白名单/砍钱路"的教训坐实这条。KANet-UI 证实 21 脚本中 20 个是一次性历史盘处置（qi37q/bh01w/3o6cs 按市场 ID 命名，已用完），持久 operator money-path 需求小 = 专道是**小组件**、非"迁 21 个"。**红线**：砍 operator 手动结算能力必须有替代——本专道就是替代。

---

## 2. 设计：operator-scoped money-path 专道

### 2.1 端点形态

新增 `POST /api/operator/settle-command`（命名待定，operator 语义非 relay 透传语义）——**专用 money-path 出口**，仅 operator 可达。

### 2.2 命令白名单（显式枚举·operator money-path 命令集）

依 operator scratch 实测命令集（grep 坐实）显式枚举：`sign_input_for_settle` / `bshard_close_attest` / `bshard_payout_claim` / `sweep_per_bet` / `transfer` / `ecdsa_sign` / `consolidate_utxo` / `get_per_bet_address` 等 covenant/结算命令。**白名单外拒**（fail-closed，与 M0c-1 §3.2 默认拒绝同构）；新增命令默认不在白名单=拒。**非钱路通信类不走本专道**（走收窄后的 relay.js:1726 端点，职责分离）。

### 2.3 auth = 现成 operator 门（复用不重造·资产调研坐实）

复用 `checkAdminSecretTier`（`src/lib/admin-secret-tier.mjs:26`，coord-status sign / zk-close-v2 / pool.js ZK_CLOSE_BROADCAST 已用的分 tier operator 门机制）：

- **专用 tier**：`ADMIN_SECRET_OPERATOR_SETTLE`（新 env，operator 专有秘钥，**非共享 ingest secret**）。
- **IP allowlist**：`ADMIN_IP_ALLOWLIST` 默认 `127.0.0.1,::1`（localhost-only，同 coord-status）。
- **env 开关默认 off**：`ADMIN_OPERATOR_SETTLE_ENABLED != '1'` → 503（默认关，operator 手动结算时才开，镜像 zk-close-v2 默认 OFF）。
- **relay 侧 origin**：专道翻译成 sendCommandAsync 时标 `origin='operator'`（origin 四值：internal/app/operator/缺失拒——operator 是**第四类 origin**，gate 侧按 operator-scoped 放行 money-path；与 internal 区分=可审计谁发的手动结算）。

### 2.4 排除场景A论证（🔴 NWT 头号验收判据·gate-arming precondition 满足）

**NWT 头号红队判据（批1 能不能过的决定性条件）**：专道 auth 必须**实**排除场景A = 那把 operator secret **不能是场景A也持有的那把**。本设计满足：

- `ADMIN_SECRET_OPERATOR_SETTLE` **是独立 operator 密钥**，**不是** 11 组件共用的共享 ingest secret——tg-bot 等场景A app 持 ingest secret，**不持** ADMIN_SECRET_OPERATOR_SETTLE（operator 专有，**不下发给任何应用/组件**）。落码 diff 审须核：此 env 与 `KANET_INGEST_SECRET`（共享那把）**不同源、不复用、不派生**；若落码时发现被设成同值或从 ingest secret 派生 → 判据不成立、打回。
- 故场景A app 够不到本专道（无凭证）+ 够不到 relay.js:1726 的 money-path（已移出，§3）→ **money-path 面对场景A彻底关闭** = gate-arming precondition 满足（NWT 收口判据"money-path 路径实排除场景A，共享 secret 不算"）。
- 与 provision 信任根（M0c-1 §4.3 operator 离线）**同构**：授权到达面一致收窄到 operator 专有凭证。

### 2.5 审计回执绑 operator 身份（NWT 红队核项）

专道每次放行的 money-path 命令 → 审计记录带 **origin='operator' + tier 标识 + 命令摘要 + 时间戳**（operator 手动结算是高敏感 money-path 动作，必留痕）。审计与 M0c-3 审计（⑥）同接缝，consume `intentDigest`。**不记 ADMIN_SECRET 值**（只记"经 operator tier 认证通过"事实）。**可审计性 = origin='operator' 第四类的价值**：区分"daemon 自动结算（internal）"vs"operator 手动介入（operator）"，事故复盘时不混淆。

---

## 3. 与 relay.js:1726 收敛联动（A 方案完整闭环）

| 分量 | 出口 | auth | origin |
|---|---|---|---|
| 内部 daemon（bshard-settle-daemon:86 等） | 直接 import sendCommandAsync（不经 HTTP） | 进程内=TCB | `internal` |
| operator 手动 money-path | **本专道** `/api/operator/settle-command` | ADMIN_SECRET_OPERATOR_SETTLE + IP + env off | `operator` |
| 非钱路通信类（UI/operator） | relay.js:1726 端点（白名单收窄） | verifyIngestRequest（够用，非钱路无场景A money-path 风险） | `app`/`internal` 按调用方 |

**relay.js:1726 端点收敛后**：白名单只留非钱路 → 场景A app 即使持 ingest secret 打这个端点，也发不出 money-path（白名单拒）→ 端点不再是钱路旁路。

---

## 4. 21 脚本迁移

- **20 个一次性历史脚本**（已用完）：不迁，标 deprecated（或归档 scratch/_archive）——它们指向的旧端点行为（转发 money-path）迁移后消失，但脚本已不跑，无回归。
- **持久 operator 结算脚本**（少数）：改指向 `/api/operator/settle-command` + 带 ADMIN_SECRET_OPERATOR_SETTLE header。迁移清单落码批逐条列。

---

## 5. gate-arming 前置关系

M0c-1 gate armed 的 checklist 前置项（KANet-UI 装载编排）新增一条：**operator 专道已到位**（端点落地 + auth 生效 + 21 脚本迁移收口 + relay.js:1726 money-path 白名单收窄）。未到位 = money-path 无合法 operator 出口 or 仍走宽端点 = gate 不 armed。

---

## 6. 威胁模型 / 负向测试（armed 判据·关2 行为验）

1. **场景A app 打专道**（持共享 ingest secret，不持 ADMIN_SECRET_OPERATOR_SETTLE）→ 拒（auth 不过）。
2. **白名单外命令**（非枚举 money-path/试图发任意命令）→ 拒（fail-closed）。
3. **env 开关 off 时打专道** → 503（默认关）。
4. **非 localhost IP 打专道** → 拒（IP allowlist）。
5. **relay.js:1726 端点发 money-path**（收敛后，持 ingest secret）→ 白名单拒（money-path 已移出）。
6. **合法 operator**（持 ADMIN_SECRET_OPERATOR_SETTLE + localhost + env on + 白名单内命令）→ 真放行，真发出 covenant 命令、真结算（关2 正向对照，实战 harness 真发）。

---

## 7. 诚实边界（乙路 TCB·禁用词表继承）

- operator 专道的 auth（ADMIN_SECRET_OPERATOR_SETTLE）**宿主在 Console 域内** = 乙路 TCB。对**场景A（应用/共享 secret 持有者）有效**（排除了它们）；对**场景B（被攻陷 Console 读 env 拿 ADMIN_SECRET）无效**——Console 攻陷者能读任何 env 秘钥，本专道不防 B-0（与 M0c-1 §1 一致）。
- **禁用词表**：不得称本专道"防被攻陷 Console"。允许口径="operator 专道 = money-path 排除场景A（应用/共享 secret 够不到）+ operator 显式门；Console=TCB，不防 B-0，抗场景B需 R"。
- **R 收口**：R 后 ADMIN_SECRET 托管移出 Console 域 / operator 身份走可验证凭证时，本专道 auth 升级（记 R 卡族）。

---

## 8. 预算 / 待办

- **预算维度**（遵 Owner 令给维度不拍数）：新端点路由骨架（非钱路语义）+ auth 复用（checkAdminSecretTier 现成，零新增）+ 命令白名单校验（钱路语义，受 ≤50 约束）+ origin=operator 接入 gate（与 M0c-1 gate 本体协调，落码时对齐）。具体行数落码读实际 diff 填。
- **待办**：① Bettor 方向审 → ② NWT 红队（照 §6 负向测试 + 排除场景A论证核）→ ③ Owner 专道 money-path 签发 → ④ 落码（端点+白名单+origin=operator）→ ⑤ 实战测试（§6 逐条真发）→ ⑥ 21 脚本迁移收口 → ⑦ 并入 gate-arming checklist。
- **改表**：本专道不新增表（auth 走 env + 现成 checkAdminSecretTier，命令走现有 relay IPC）。
- **origin 四值化**：M0c-1 gate 本体（批3）需把 origin 从三分（internal/app/缺失）扩到四分（+operator），本卡与 M0c-1 §4.0 落码时同步（origin='operator' 的 gate 分支 = operator-scoped money-path 放行）。

**关联**：`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md`（M0c-1 母卡 §4.0/§4.3）、`docs/2026-07-23-m0c-1-origin-migration-classification.md`（relay.js:1726 收敛 A §1）、`src/lib/admin-secret-tier.mjs`（复用 auth）。
