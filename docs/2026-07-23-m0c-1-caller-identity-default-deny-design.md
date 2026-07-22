# M0c-1 设计稿 — Caller 身份验证 + 默认拒绝（A+C 乙路核心·J2 主设计）

> **Status**: DRAFT（2026-07-23 · J2 出稿 → 待 NWT 红队 → 待 Owner money-path 签发才落码）
> **本卡性质**：设计文档，不改一行执行代码；不授权任何落码、凭证 provision、relay 重启、签名、广播、结算、资金移动。
> **覆盖 M0c 七项之**：①非自声明 caller 身份 ②默认拒绝命令暴露（M0c-2 的③④ scope evaluator / M0c-3 的⑤⑥⑦ replay+audit+revocation 各自另稿并行）。
> **依据**：M-1.6 v0.3.1 A+C+R 定案（`a015d965`，Owner 乙路 `d8c45faa`，NWT GREEN `d52b815d`+Codex GREEN-with-notes 复审 `e20fdc82`）+ Bettor M0c 骨架（`docs/2026-07-22-m0c-capability-base-batch-prep.md` §1 切分/§2 预算维度）+ M-1.1 能力清单（`66cc5686`）+ M-1.2 v0.2 威胁模型（`f3fde977`，§4 验收矩阵）。
> **Codex 5 must-survive notes = 本卡硬约束**（逐条对照见 §7）。

---

## 0. 现状地基（读码坐实，M0c-1 的落点依据）

三个事实决定 M0c-1 装在哪：

1. **IPC 命令下发零 caller 校验**（M-1.2 T-1）：`relay.mjs:331` `process.on('message')` 收 cmd → `:337` `validateCommandPayload(cmd)`（`commands.mjs:242-280`：只校 type 已知 + required 字段存在 + typeof 匹配，**零 caller 身份、零授权**）→ `:358` `switch(cmd.type)` 执行全 ~50 命令。进程内任何代码 `child.send(cmd)` 即全权。
2. **HTTP ingest secret 只 gate 上报方向，不 gate 命令下发**（M-1.2 T-2）：`ingest-auth.js` `verifyIngestRequest` 单一共享 secret，仅 gate relay→console 的 `/ingest/*`；console→relay 的命令走 IPC `child.send`，**无任何鉴权**，靠"只有 console 能 fork relay"的进程边界（=B-0 的 TCB 根）。
3. **tg-bot 已验证纯 HTTP 模式**（A 网关先例）：tg-bot 经 `/api/pool/*` 走 HTTP、不碰 DB、不 import relay-manager——这是 A 网关"外部应用只能过 HTTP"的可行性证据，M0c-1 的 A 层是给这个模式补上鉴权。

**M0c-1 的两个插入点由此确定**：
- **C 信封验证 locus = relay 分发点**（`relay.mjs:337` 之后、`:358` switch 之前，插 `authorizeCommand` gate）——这是 M-1.6 定的"验证 locus 在 relay 进程内命令执行前 fail-closed"。
- **A 能力网关 = console 新增 HTTP 路由层**（按业务能力命名，非裸 sendCommandAsync 透传）——外部应用进程（M2/M4 抽离后）唯一入口。

---

## 1. 🔴 乙路 TCB 边界继承（置顶·M0c-1 不得声称抗 Console）

M0c-1 继承 M-1.6 v0.3.1 §1 的诚实 TCB 声明，**逐条约束到 M0c-1 的机制**：

- M0c-1 的 C 信封验证跑在 relay 进程内，**但 relay 的私钥仍由 Console fork 时经 env 注入**（`relay-manager.js:83-84`）——故 M0c-1 防的是**应用面**（场景 A：被攻陷/越权应用、共享 secret、应用间越权、内部误用），**不防被攻陷 Console（场景 B/B-0）**。
- M0c-1 的 grant registry / app 凭证签发权在乙期**在 Console 可达信任域内**（§4.2）——对场景 A 有效，对场景 B 无效。R 收口才移出。
- **禁用词表（继承 M-1.6 §1.3）**：本卡及 M0c-1 实现批禁止出现"M0c-1 使被攻陷 Console 无法伪造命令"类表述。允许口径="M0c-1 = 针对应用的非自声明 caller 身份 + 默认拒绝；Console 在测试网阶段是 TCB，M0c-1 不防被攻陷 Console；抗场景 B 需 R。"
- **红队硬门（Codex note① load-bearing）**：M0c 三子批全 GREEN **且 R 收口**前，任何抽离应用不得独立触达 relay。M0c-1 单独 GREEN ≠ 放行 relay-access（§7 note①）。

---

## 2. 机制 A — HTTP 能力网关（console 侧，防"谁能连"）

### 2.1 端点形态

新增 `POST /api/capability/<business-capability>` 路由层，**按业务能力命名**而非底层 relay 命令命名（例：`/api/capability/bshard-settle`、`/api/capability/exchange-offer-accept`）。**不暴露**裸 `sendCommandAsync` 透传端点。

### 2.2 网关职责（M0c-1 只做①②，scope 判定留 M0c-2）

1. 认证调用方 app 身份（见 §4 C 信封——网关不自己发明身份机制，复用 C 的签名验证结果）。
2. **默认拒绝**：未在能力注册表登记的 (app, capability) 组合 → 拒（§3）。
3. 通过后把请求翻译成具体 `sendCommandAsync` 调用，**并把认证出的 caller 身份 + 信封随命令带到 relay**（供 relay 侧 C 验证，见 §4）。

### 2.3 明确边界（M-1.6 §附录 A.1 继承）

A 网关对**场景 B 零防御**——Console 进程内代码可不走网关直接 import relay-manager 调 sendCommandAsync。这不是 A 的缺陷，是 A 的定义边界（A 管跨进程"谁能连"，管不了同进程绕过）。场景 B 的防线只在 R（§1）。故 **A 网关不能是 M0c-1 的唯一 gate**——C 信封在 relay 侧的验证才是命令执行前的最后闸（§4），即使有人绕过 A 网关直接 child.send，relay 侧 C 验证仍拦（对场景 A 的越权应用有效）。

---

## 3. 机制：默认拒绝（Codex note② + 七项②·M0c-1 核心不变量）

### 3.1 命令分类（默认拒绝的判据）

M-1.1 全命令清单（~50 条）按"是否需授权信封"二分：

- **需信封类**（所有 state-mutate / transfer / sign / 钱路命令）：register_bet/claim_winner/close_commit/custodial_transfer/ECDSA_SIGN/SIGN_INPUT_FOR_SETTLE/TRANSFER/全 covenant unlock 等——**无有效信封=拒，fail-closed**。
- **无害只读类**（M-1.1 类 A 6 条纯计算/只读）：可豁免信封（但仍过网关限流/审计）——豁免清单**显式白名单**，不在白名单=默认归入需信封类（默认拒绝的方向：新命令默认需授权，不是默认放行）。

### 3.2 默认拒绝的 fail-closed 语义（不变量）

- relay 分发点 `authorizeCommand` gate 对需信封类命令：无信封 / 信封验证失败 / grant 不覆盖 → **拒绝执行 + 不推进任何状态**（NO TX NO STATE，铁律）。
- **新增命令默认落入需信封类**——防"加了新命令忘了授权配置=悄悄全开"（M0a lint 同源思路：新增即需显式授权，不是默认放行）。这条对应 §8 负向测试"未登记命令默认拒"。

---

## 4. 机制 C — 签名能力信封 + relay-authoritative grant（Codex note② + MF3）

### 4.1 信封验证 locus 与流程（relay 进程内）

在 `relay.mjs:337` `validateCommandPayload` 通过之后、`:358` switch 之前，插入 `authorizeCommand(cmd)` gate，流程：

1. 无害只读白名单命中 → pass（§3.1）。
2. 解析 `cmd.envelope`（缺 → 拒）。
3. 验证信封签名（app key-id → 查 grant registry 取 app 公钥；签名不过 → 拒）。
4. canonical 反序列化信封字段（M-1.6 §5 字段表；domain-separation）。
5. intent ⊆ grant 校验（§4.2 — MF3 核心）。
6. [M0c-3] nonce/replay durable 校验（本批留接口，M0c-3 实现）。
7. 全过 → 返回 authenticated caller identity（§5 接口）→ 进 switch；任一步失败 → fail-closed 拒 + 不推进状态。

### 4.2 relay-authoritative grant（MF3 · Codex note② · 防 grant inflation）

**信封里的 scope 是不可信输入**——app 签名只证"持有 app key"，不证"被授权用它写的那个 scope"（NWT/Codex 独立点出的 grant-inflation 缺口）。故 relay 必须拿请求 intent 跟一个 **relay 侧权威 grant** 比对，`intent ⊆ 已签发 grant` 才放行。grant 绑定（M-1.6 §5 + Codex canonical 要求）：app key-id、允许命令+typed-intent 版本、允许 relay/wallet/network、market/family/outpoint/branch scope、收款人+金额/费率上限、有效期+grant 版本、吊销标识。

**乙路诚实注记（§1 + Codex note② + §4.1 母卡）**：grant 由 Console 信任域**之外**的 authority 签发是 MF3 的完整要求，但走乙 = Console 是 TCB = 这个"之外"现在就是 Console 自己。故 **M0c-1 的 grant registry 乙期在 TCB 内，对场景 A（应用伪造不了 Console 签发的 grant）有效、对场景 B（Console 直接改 registry 自授权）无效**。这与 §1 一致，不构成矛盾；R 收口 = 把 grant 签发 authority 移出 Console 域。实现批 diff 审须核 grant registry 宿主，禁止把"registry 在 Console 内"描述成"抗 Console"。

---

## 5. 🔑 caller 身份抽象接口（M0c-1↔M0c-2 解耦接缝·Bettor 特别要求先定）

M0c-1 产出"这条命令的已认证 caller 是谁"，M0c-2 消费它做 scope 判定。**先定接口签名，选型只改 M0c-1 的实现、不改接口，两批并行**：

```
authorizeCommand(cmd) → AuthResult

AuthResult = {
  authenticated: boolean,        // 身份是否验证通过（M0c-1 ①）
  decision: 'allow' | 'deny',    // 默认拒绝的判定（M0c-1 ②；M0c-2 接入后 = 身份∧scope）
  callerId: string | null,       // 认证出的 app 身份（key-id），deny 时可 null
  grantId: string | null,        // 命中的权威 grant id（供 M0c-2 scope 判定 + M0c-3 审计绑定）
  intentDigest: string | null,   // canonical intent 摘要（供 M0c-3 nonce 绑定+审计）
  reason: string | null          // deny 原因（审计/日志，不泄露 secret）
}
```

- **M0c-1 交付**：`authenticated` + 基础 `decision`（身份验证 + 默认拒绝 + intent⊆grant）。
- **M0c-2 接入**：在 M0c-1 的 `decision` 基础上叠加逐 caller 命令/钱包/市场/outpoint scope 精判（消费 `callerId`+`grantId`，不关心身份怎么验出来的）。
- **M0c-3 接入**：消费 `callerId`+`grantId`+`intentDigest` 做 nonce 绑定（⑤）+ 审计回执（⑥）+ 吊销查询（⑦，吊销命中 → `decision='deny'`）。

这个接口是三子批的解耦契约，本卡定死字段语义，M0c-2/M0c-3 设计稿引用不重定义。

---

## 6. 预算维度（J2 域填·Bettor 骨架 §2 待补空）

按 Owner 令（钱路语义行≤50 硬上限、给不出诚实数写待补不拍数）。**J2 read-only 核了落点，给维度 + 初估区间，标注待落码时精确**：

| 组件 | 钱路语义行? | 落点 | 初估（设计期，待实测精确） |
|---|---|---|---|
| relay `authorizeCommand` gate | **是**（分发点是钱路命令闸） | `relay.mjs:337~358` 之间插 gate + 新 `authorize.mjs` 模块 | gate 接入点 ~10 行（钱路语义，受≤50 约束）；`authorize.mjs` 验证逻辑本体是新模块非 diff 到现有钱路文件，按新增模块预算——**待落码精确，超 50 则拆权限子函数** |
| console 能力网关路由 | 部分（翻译成 sendCommandAsync=钱路，路由骨架=非钱路） | 新增 `/api/capability/*` 路由文件 | 新增文件，待实测 |
| grant registry + app 凭证 provision | 部分（校验=钱路，存储 schema=非钱路） | 新表/配置（改表须过 DATABASE.md，当前 migrate v55）+ provision 流程 | 待实测；改表走 migrate v56+ |

**诚实标注**：`authorizeCommand` gate 是钱路语义行的核心，落码时若接入逻辑超 50 行硬上限，按 Owner 令拆成更小权限函数（每个单一职责）而非申请豁免。具体行数**待落码阶段读实际 diff 填**，本卡不拍未核的数。

---

## 7. Codex 5 must-survive notes 逐条对照（硬约束核对单）

| # | Codex note | M0c-1 落点 | 状态 |
|---|---|---|---|
| ① | 硬门 load-bearing：M0c GREEN 且 R 收口前应用不得触达 relay，不得把"R 不阻塞主线"读成 relay-access 边界 R 前放行 | §1 红队硬门 + §2.3（M0c-1 单独 GREEN≠放行） | ✅ 焊入·M0c-1 armed 判据不含"放行 relay-access" |
| ② | app 签名只证 key 持有非授权 scope；intent 必须 ⊆ relay-authoritative grant；grant registry 乙期在 TCB 内不得称抗 Console | §4.2 grant-inflation 防护 + §4.2 乙路诚实注记 | ✅ MF3 核心机制 + TCB 诚实边界 |
| ③ | replay state 必须 durable + 副作用前 atomic-reserve，内存 nonce 非 acceptance-grade | §4.1 gate 流程留 nonce 校验接口 + §5 intentDigest 字段 | 🔶 接口留在 M0c-1，**实现归 M0c-3**（durable/atomic 由 M0c-3 设计+NWT 盯） |
| ④ | service 身份 ≠ 端用户授权（multi-user tg-bot 凭证不授权特定用户提款，并轨 containment 目标 B） | §5 callerId=service 身份（app key），端用户授权是独立证明 | 🔶 M0c-1 只认 service 身份；用户授权拆分归 containment 卡 MF6，本卡 callerId 语义明确标"service 身份非端用户" |
| ⑤ | 只闭了 selection/document，每个 M0c/R 实现切片仍各自走 design→红队→签发 | 本卡是 M0c-1 **设计**，落码前走 NWT 红队 + Owner money-path 签发 | ✅ 本卡 Status 已声明 |

---

## 8. 负向测试（M0c-1 armed 判据·对应 M-1.2 §4 验收矩阵）

每条 = 可执行负向测试，pass=拒(BUST)/fail=得逞(LANDS)，现状全 LANDS（M0c-1 未装）：

1. **伪造 app_id（A-4）**：payload 自声明 `app_id` 无有效签名信封 → 拒（身份是签名验证结果非自称字段）。
2. **无信封钱路命令（②默认拒绝）**：需信封类命令不带信封直发分发点 → 拒 fail-closed，不推进状态。
3. **grant inflation（MF3 / Codex note②）**：合法 app key 签一个 scope 超出其 grant 的信封 → relay 侧 intent⊄grant → 拒（这条 scope 精判在 M0c-2，M0c-1 保证"有 grant 对照"这个前提在，M0c-1 层测"无 grant=拒"）。
4. **未登记命令默认拒（§3.2）**：新增/未在授权配置的命令 → 默认落需信封类 → 无 grant → 拒（防悄悄全开）。
5. **A 网关绕过 vs relay gate（场景 A）**：独立应用进程绕过 A 网关直接尝试触达 relay（M0c armed 后场景）→ relay 侧 C gate 仍拦（对越权应用有效）；**注**：Console 进程内绕过=场景 B，走乙 LANDS（§1，R 收口才 BUST）。
6. **只读白名单越界（§3.1）**：白名单外命令伪装成只读类试图豁免信封 → 拒（白名单是显式命令枚举，不按 caller 自称的"这是只读"）。

**armed 判据**：1/2/4/6 在 M0c-1 落码后须全 BUST；3/5 依赖 M0c-2（scope 精判）完整，M0c-1 层只保证"gate 存在且 fail-closed"。M0c-1 单独 armed ≠ 放行 relay-access（§7 note①）。

---

## 9. 待办 / 交接

- **本卡待 NWT 红队** → 过后 Owner money-path 签发才落码（M0c 碰 relay 授权=money-path）。
- **M0c-2/M0c-3 并行起草**：消费 §5 caller 身份抽象接口，J2 域，随后出稿。
- **改表**（grant registry / 审计表）须过 `docs/DATABASE.md`，migrate 接 v56+（当前 v55），设计定 schema 后同步更新 DATABASE.md。
- **预算精确数**：待 Owner 签发、落码阶段读实际 diff 填（§6 给维度不拍数）。

**关联**：`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md` v0.3.1（A+C+R 定案+TCB 声明+canonical envelope）、`docs/2026-07-22-m0c-capability-base-batch-prep.md`（三子批切分+预算框架）、`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`（命令分类来源）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（§4 验收矩阵）、Codex RED `06d759df` + 复审 `e20fdc82`（5 must-survive notes）、`docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md`（MF6 用户授权拆分并轨）。
