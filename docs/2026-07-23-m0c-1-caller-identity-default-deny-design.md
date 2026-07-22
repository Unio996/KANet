# M0c-1 设计稿 — Caller 身份验证 + 默认拒绝（A+C 乙路核心·J2 主设计）

> **Status**: v0.2 修订版（2026-07-23 · J2 出稿 → 三路审全回 → J2[重启会话]消化修订 → 待 NWT 复审 MUST-FIX 闭合 + J1 域二过 → 待 Owner money-path 签发才落码）
> **三路审 verdict（v0.1=600a005c）**：Bettor 方向审 GREEN-with-3-notes（#whhsjn）/ NWT 红队 GREEN-with-1-MUST-FIX+3-note（`8c1d424b`，`docs/2026-07-23-NWT-redteam-m0c-1-design-verdict.md`）/ J1 域复核 GREEN-with-1-MUST-FIX（locus 无异议+TCB 边界零漏网+legacy 误伤缺口）。
> **v0.2 修订内容**：两 MUST-FIX 合并解（§4.0 命令来源判别 + §4.3 provision 信任根）+ NWT 3 note（§4.1 TOCTOU 不变量/§2.1 M0b 交叉引用/§8 补显式测试）+ Bettor 3 notes（§8 靶单对齐/§4.1 禁内存 nonce 占位/§6 预算边界注）+ J1 四点补丁（M1-4 §3.2/M1-5 §4.3/M1-6 §4.1/T-9 §5.1）。
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
- **origin='internal' 放行的诚实边界（v0.2·§4.0）**：internal 路径放行对场景 B 零防御（Console 内部代码可伪造 internal 标记 = 乙路已接受的 TCB 残留，如实标 LANDS，非新场景 A 洞）；对场景 A 有效的前提 = 外部应用只有 HTTP 面、结构上够不到进程内调用点（现状拓扑事实，写明非机制保证）。此信任**乙-scoped**，R 收口后必须 revisit（§4.0 note-B）。

---

## 2. 机制 A — HTTP 能力网关（console 侧，防"谁能连"）

### 2.1 端点形态

新增 `POST /api/capability/<business-capability>` 路由层，**按业务能力命名**而非底层 relay 命令命名（例：`/api/capability/bshard-settle`、`/api/capability/exchange-offer-accept`）。**不暴露**裸 `sendCommandAsync` 透传端点。

**M0b 交叉引用（NWT note-2）**：M1-3"无 verifier 命令→internal"那半属 M0b 准入门治，M0c-1 不重复做；但能力网关端点清单**只暴露 verifier-complete 命令**、不遗漏——网关端点登记表落码时逐条对照 M-1.1 命令清单的 verifier 状态列。

### 2.2 网关职责（M0c-1 只做①②，scope 判定留 M0c-2）

1. 认证调用方 app 身份（见 §4 C 信封——网关不自己发明身份机制，复用 C 的签名验证结果）。
2. **默认拒绝**：未在能力注册表登记的 (app, capability) 组合 → 拒（§3）。
3. 通过后把请求翻译成具体 `sendCommandAsync` 调用，**并把认证出的 caller 身份 + 信封随命令带到 relay**（供 relay 侧 C 验证，见 §4）。

### 2.3 明确边界（M-1.6 §附录 A.1 继承）

A 网关对**场景 B 零防御**——Console 进程内代码可不走网关直接 import relay-manager 调 sendCommandAsync。这不是 A 的缺陷，是 A 的定义边界（A 管跨进程"谁能连"，管不了同进程绕过）。场景 B 的防线只在 R（§1）。故 **A 网关不能是 M0c-1 的唯一 gate**——C 信封在 relay 侧的验证才是命令执行前的最后闸（§4）。

**relay 侧 gate 对场景 A 的价值（v0.2 措辞修正，NWT 红队护栏）**：外部应用**结构上够不到 IPC**（独立进程无 `sendCommandAsync` import 权、发不了 `child.send`，唯一入口=网关 HTTP）——这是 load-bearing 结构依赖，必须显式写明+测试（§8-9），不能默认。故 relay 侧 C 验证对场景 A 的实际价值 = **backstop 网关授权 bug**（网关漏验/配置错时命令到 relay 仍被拦）+ **post-R 隔离预备**（R 收口后 relay 独立成信任域，C 验证成为真正独立闸），而非"拦应用绕过网关直连 IPC"（应用本就够不到 IPC）。

---

## 3. 机制：默认拒绝（Codex note② + 七项②·M0c-1 核心不变量）

### 3.1 命令分类（默认拒绝的判据）

M-1.1 全命令清单（~50 条）按"是否需授权信封"二分：

- **需信封类**（所有 state-mutate / transfer / sign / 钱路命令）：register_bet/claim_winner/close_commit/custodial_transfer/ECDSA_SIGN/SIGN_INPUT_FOR_SETTLE/TRANSFER/全 covenant unlock 等——**无有效信封=拒，fail-closed**。
- **无害只读类**（M-1.1 类 A 6 条纯计算/只读）：可豁免信封（但仍过网关限流/审计）——豁免清单**显式白名单**，不在白名单=默认归入需信封类（默认拒绝的方向：新命令默认需授权，不是默认放行）。

### 3.2 默认拒绝的 fail-closed 语义（不变量）

- relay 分发点 `authorizeCommand` gate 对需信封类命令：无信封 / 信封验证失败 / grant 不覆盖 → **拒绝执行 + 不推进任何状态**（NO TX NO STATE，铁律）。
- **新增命令默认落入需信封类**——防"加了新命令忘了授权配置=悄悄全开"（M0a lint 同源思路：新增即需显式授权，不是默认放行）。这条对应 §8 负向测试"未登记命令默认拒"。
- **解析异常 fail-closed（J1 补丁 M1-4，v0.2）**：身份/信封/origin 任一环节解析异常（malformed envelope、未知 key-id、origin 值非法、canonical 反序列化抛错）**统一走拒绝分支，不存在任何"默认身份"或"降级放行"回退路径**。解析失败≠无信封（两者都拒，但审计 reason 区分），gate 内任何 throw 必须被捕获并转为 deny——不允许异常逃逸导致跳过 gate 进 switch。对应 §8-8 负向测试。

---

## 4. 机制 C — 签名能力信封 + relay-authoritative grant（Codex note② + MF3）

### 4.0 命令来源判别（v0.2 新增·两 MUST-FIX 的合并前提·J1 MUST-FIX 解）

**问题（J1 域复核 + NWT 红队同源定性）**：v0.1 的 gate 对分发点全部命令无条件生效，但 Console 既有内部自动化（settle-daemon/voter/transport/api 路由/lib 传输层，全仓 20+ 文件直调 `sendCommandAsync`，`pool-market-settler.js` 单文件 12 处，含 `:2179/:2409/:2594/:2750/:3054/:3267` 六处结算命令）零 envelope——gate 无条件生效 = 装载即断现网 money-path。同时 NWT MUST-FIX 指出 provision 面"该拦的没拦死"。两者同源：**authorizeCommand 的触发前提需要一个不可伪造、不误伤 legacy 的判别标准**。

**判别机制（origin 三分 fail-closed，J2 方案 + NWT 护栏 + J1 评估收敛）**：

`sendCommandAsync` 签名加显式 `origin` 参数，relay 侧 gate 按三分处理：

| origin | 语义 | gate 行为 |
|---|---|---|
| `'internal'`（正向标记） | Console 自身 daemon/内部代码路径（settler/voter/transport 等），调用方代码**静态设置** | 乙路 TCB 语义放行（不要求 envelope）——诚实边界见下 |
| `'app'` | 经 A 能力网关转发的外部应用请求 | **必须带有效 envelope**，走 §4.1 完整验证链 |
| 缺失 / 非法值 | 新增未声明调用点 / 异常 | **fail-closed 拒**（不是 pass）——防悄悄全开，与 §3.2"新命令默认需授权"同构 |

**不可伪造性论证（写明，非默认）**：
- origin 是**调用方代码静态设置的内部路径标注**，不是外部数据决定的自称字段（非 M1-1 自声明身份反模式）——其安全性来自"谁能调用 `sendCommandAsync`"这个物理边界，而非 origin 值本身。
- **场景 A 不可达**：外部应用是独立进程，无 `sendCommandAsync` import 权、发不了 `child.send`（结构上够不到 IPC，load-bearing 结构依赖，§2.3）；唯一入口 = A 网关 HTTP，网关**强制覆写任何入站 origin 声明为 `'app'`**（应用注入 `origin=internal` → 被覆写 → 无有效 envelope = 拒，§8-7 负向测试）。
- **场景 B 可伪造（如实标 LANDS）**：Console 进程内代码可直接声称 `internal`——这是乙路已接受的 TCB 残留（B-0 territory，§1），不是新场景 A 洞；R 收口才 BUST。

**存量迁移（零行为变更可验）**：全仓 20+ 文件调用点逐一显式标 `origin='internal'`（机械改动，标注后行为==现状）；走 M0a 同款差分门——lint 规则"`sendCommandAsync` 调用必须显式 origin"+ baseline 枚举存量 + 新增即败（KANet-UI 接 lint 侧，复用 m0a-lib 四件套基建；新规则按 warn-first 规矩，NWT diff GREEN 后升 ERROR）。迁移批独立 diff 审。

**装载排序硬前置（NWT note-A·armed 显式前置条件）**：gate armed 前，全部存量 internal 调用点**必须已迁移标注 + 验证零行为变更**——否则未迁移调用 → 无 origin → fail-closed 拒 = 现网结算断。装载时序三段式（KANet-UI 装载编排）：① lint warn 落码（warn 清单 = 迁移驱动器）→ ② 全迁完 + NWT diff GREEN → 升 ERROR（关门：新调用点必须显式 origin）→ ③ ERROR 门在位 + 迁移收口报告 = gate armed 装载窗的显式前置 checklist 项。**不允许 gate 先上、迁移后补。**

**post-R revisit（NWT note-B·乙-scoped 声明，进 R 卡）**：`origin='internal'` 跳 envelope 这条信任是**乙-scoped**——relay 信任 Console 设的 origin，仅因乙路 Console=TCB。**R 收口后 relay 隔离，不得再盲信 Console 设的 origin 字段**（届时 Console 在 relay 信任域外，`internal` 变成可伪造声明）——R 卡验收基线须含"internal 路径改走可验证凭证或等效机制"，本条记入 R 后续升级卡（M-1.6 §1.4）。

### 4.1 信封验证 locus 与流程（relay 进程内）

在 `relay.mjs:337` `validateCommandPayload` 通过之后、`:358` switch 之前，插入 `authorizeCommand(cmd)` gate，流程：

0. **origin 判别（§4.0）**：`internal` → 按 TCB 语义放行（记审计）；缺失/非法 → 拒；`app` → 继续 1-7。
1. 无害只读白名单命中 → pass（§3.1）。
2. 解析 `cmd.envelope`（缺 → 拒）。
3. 验证信封签名（app key-id → 查 grant registry 取 app 公钥；签名不过 → 拒）。
4. canonical 反序列化信封字段（M-1.6 §5 字段表；domain-separation）。
5. intent ⊆ grant 校验（§4.2 — MF3 核心）。
6. [M0c-3] nonce/replay durable 校验（本批**留空接口**，M0c-3 实现——**落码禁用内存 nonce 占位**，Codex note③ durable+atomic，内存非 acceptance-grade；留空接口 > 留内存占位，Bettor n2）。
7. 全过 → 返回 authenticated caller identity（§5 接口）→ 进 switch；任一步失败 → fail-closed 拒 + 不推进状态（含解析异常，§3.2 M1-4）。

**TOCTOU 不变量（v0.2 钉死·J1 补丁 M1-6 + NWT note-1 + C3 纪律同源）**：步骤 4 canonical 反序列化的产物随 AuthResult **冻结返回**（frozen canonical cmd），`:358` switch 各分支**只准消费这份 frozen canonical cmd**，禁止任何分支回头读 `process.on('message')` 进来的原始 cmd 引用（外部可变输入）；`intentDigest` 必须**覆盖全部影响执行的字段**——"验的对象 == 执行的对象"是不变量（同 C3 纪律"签的 tx byte-identical == enforce 验的 txSafeJson"），落码 diff 审照此核，§8-10 负向测试。

### 4.2 relay-authoritative grant（MF3 · Codex note② · 防 grant inflation）

**信封里的 scope 是不可信输入**——app 签名只证"持有 app key"，不证"被授权用它写的那个 scope"（NWT/Codex 独立点出的 grant-inflation 缺口）。故 relay 必须拿请求 intent 跟一个 **relay 侧权威 grant** 比对，`intent ⊆ 已签发 grant` 才放行。grant 绑定（M-1.6 §5 + Codex canonical 要求）：app key-id、允许命令+typed-intent 版本、允许 relay/wallet/network、market/family/outpoint/branch scope、收款人+金额/费率上限、有效期+grant 版本、吊销标识。

**乙路诚实注记（§1 + Codex note② + §4.1 母卡）**：grant 由 Console 信任域**之外**的 authority 签发是 MF3 的完整要求，但走乙 = Console 是 TCB = 这个"之外"现在就是 Console 自己。故 **M0c-1 的 grant registry 乙期在 TCB 内，对场景 A（应用伪造不了 Console 签发的 grant）有效、对场景 B（Console 直接改 registry 自授权）无效**。这与 §1 一致，不构成矛盾；R 收口 = 把 grant 签发 authority 移出 Console 域。实现批 diff 审须核 grant registry 宿主，禁止把"registry 在 Console 内"描述成"抗 Console"。

### 4.3 grant/app-key provision 信任根（v0.2 新增·NWT MUST-FIX 解 + J1 补丁 M1-5）

**缺口（NWT 红队 `8c1d424b`）**：v0.1 全篇未指定 registry 谁写、经什么路径写。若 provision 应用可达（复用共享 ingest secret / 经 A 能力网关），场景 A 攻击者自签发一条覆盖任意 scope 的 grant 给自己 → 之后 `intent⊆grant` 永远成立 → MF3 权威比对被自签发整个绕过。§4.2 的效力全建立在"应用改不了 registry"这个前提上，前提必须焊死。

**修法（写死为设计不变量）**：
- **provision 只走 operator 离线带外脚本**（`scripts/` 下 operator 手跑，读写 registry 存储）——**零 HTTP 写入路径、零 IPC 写入路径**：不经共享 ingest secret、不经 A 能力网关、不经任何应用可发的命令（含 relay IPC 全部 ~50 命令——不新增"provision_grant"类命令）。
- **静态可枚举（M1-5）**：registry 的全部写入方在代码中静态可枚举 = 仅 operator 脚本一处；任何请求处理代码路径（HTTP handler/IPC handler/daemon tick）出现 registry 写入 = 实现批 diff 审直接打回。运行时自注册禁止。
- **负向测试（§8-9）**：应用用合法 service 凭证尝试 provision 新 grant（经网关/经任何 HTTP 端点/构造 IPC 命令）→ 必拒。
- **与 M0c-3 接缝**：吊销（⑦）走同一 operator 离线通道（写入面越窄，吊销/审计越好接）；审计（⑥）只读 registry，不引入写路径。
- **同网三面（NWT 定性）**："授权到达面"一张网：provision 管谁能写 grant（本节）/ origin 管谁能不带 envelope 过 gate（§4.0）/ post-R 管隔离后 internal 怎么 auth（§4.0 note-B→R 卡）。三面缺一则整网 vacuous。

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

### 5.1 service 身份 ≠ 端用户 subject（v0.2 独立成节·J1 补丁 T-9 + Codex note④）

v0.1 只在 §7 note④ 一句带过，NWT 靶单 T-9 要求的力度更高，独立钉死：

- **`callerId` 的语义 = service 身份（app key-id），永远不是端用户身份。** 一个 multi-user 应用（如 tg-bot）持有的 service 凭证证明"这条命令来自该应用"，**不证明**"该应用的某个用户授权了这笔操作"。
- **禁止的推断链**：`authenticated=true`（app 身份验过）⇒ "用户 X 授权了提款"——这是两个独立命题。M0c-1 的 gate 只判前者；端用户授权（用户对特定资金操作的意思表示）是独立证明义务，归 containment 卡 MF6（`docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md`）治理，M0c-1 不解决也不声称解决。
- **落码约束**：AuthResult 不设 `userId` 类字段（防止实现者顺手把 envelope 里应用自报的用户标识当已验身份透传）；若命令 payload 含端用户标识，它对 M0c-1 gate 是**不透明业务数据**，gate 不读不信不转述为身份。
- **审计（M0c-3 接缝）**：审计记录 callerId（service）+ 命令摘要；端用户维度的审计绑定随 MF6 设计，不在本卡预写。

---

## 6. 预算维度（J2 域填·Bettor 骨架 §2 待补空）

按 Owner 令（钱路语义行≤50 硬上限、给不出诚实数写待补不拍数）。**J2 read-only 核了落点，给维度 + 初估区间，标注待落码时精确**：

| 组件 | 钱路语义行? | 落点 | 初估（设计期，待实测精确） |
|---|---|---|---|
| relay `authorizeCommand` gate | **是**（分发点是钱路命令闸） | `relay.mjs:337~358` 之间插 gate + 新 `authorize.mjs` 模块 | gate 接入点 ~10 行（钱路语义，受≤50 约束）；`authorize.mjs` 验证逻辑本体是新模块非 diff 到现有钱路文件，按新增模块预算——**待落码精确，超 50 则拆权限子函数** |
| console 能力网关路由 | 部分（翻译成 sendCommandAsync=钱路，路由骨架=非钱路） | 新增 `/api/capability/*` 路由文件 | 新增文件，待实测 |
| grant registry + app 凭证 provision | 部分（校验=钱路，存储 schema=非钱路） | 新表/配置（改表须过 DATABASE.md，当前 migrate v55）+ provision 流程 | 待实测；改表走 migrate v56+ |

**诚实标注**：`authorizeCommand` gate 是钱路语义行的核心，落码时若接入逻辑超 50 行硬上限，按 Owner 令拆成更小权限函数（每个单一职责）而非申请豁免。具体行数**待落码阶段读实际 diff 填**，本卡不拍未核的数。**Bettor n3**：`authorize.mjs` 验证本体按"新模块预算"处理 vs 钱路语义行 ≤50 的边界划法，落码批开工前与 Owner 令对齐口径（新模块中触碰签名/广播/资金判定的函数按钱路语义行计，纯解析/查表不计——落码批报预算时显式列出这个划分供审）。**v0.2 新增迁移预算**：存量 20+ 文件 origin 标注 = 机械参数补齐（非钱路语义变更，零行为变更可验），lint 差分门本体归 KANet-UI lint 域预算。

---

## 7. Codex 5 must-survive notes 逐条对照（硬约束核对单）

| # | Codex note | M0c-1 落点 | 状态 |
|---|---|---|---|
| ① | 硬门 load-bearing：M0c GREEN 且 R 收口前应用不得触达 relay，不得把"R 不阻塞主线"读成 relay-access 边界 R 前放行 | §1 红队硬门 + §2.3（M0c-1 单独 GREEN≠放行） | ✅ 焊入·M0c-1 armed 判据不含"放行 relay-access" |
| ② | app 签名只证 key 持有非授权 scope；intent 必须 ⊆ relay-authoritative grant；grant registry 乙期在 TCB 内不得称抗 Console | §4.2 grant-inflation 防护 + §4.2 乙路诚实注记 | ✅ MF3 核心机制 + TCB 诚实边界 |
| ③ | replay state 必须 durable + 副作用前 atomic-reserve，内存 nonce 非 acceptance-grade | §4.1 gate 流程留**空接口**（v0.2：落码禁内存 nonce 占位，Bettor n2）+ §5 intentDigest 字段 | 🔶 接口留在 M0c-1，**实现归 M0c-3**（durable/atomic 由 M0c-3 设计+NWT 盯） |
| ④ | service 身份 ≠ 端用户授权（multi-user tg-bot 凭证不授权特定用户提款，并轨 containment 目标 B） | §5.1 独立成节（v0.2）：callerId 语义钉死 + 禁止推断链 + AuthResult 不设 userId + MF6 归属 | ✅ v0.2 独立成节钉死（T-9 力度） |
| ⑤ | 只闭了 selection/document，每个 M0c/R 实现切片仍各自走 design→红队→签发 | 本卡是 M0c-1 **设计**，落码前走 NWT 红队 + Owner money-path 签发 | ✅ 本卡 Status 已声明 |

---

## 8. 负向测试（M0c-1 armed 判据·对应 M-1.2 §4 验收矩阵）

每条 = 可执行负向测试，pass=拒(BUST)/fail=得逞(LANDS)，现状全 LANDS（M0c-1 未装）。**v0.2 对齐 NWT a7f5beba 8 靶单**（Bettor n1 + NWT note-3），靶单编号标注在括号内：

1. **伪造 app_id（A-4 / 靶 M1-1）**：payload 自声明 `app_id` 无有效签名信封 → 拒（身份是签名验证结果非自称字段）。
2. **无信封钱路命令（②默认拒绝 / 靶 M1-2）**：需信封类命令（origin='app' 或缺 origin）不带信封直发分发点 → 拒 fail-closed，不推进状态。
3. **grant inflation（MF3 / Codex note② / 靶 M1-8）**：合法 app key 签一个 scope 超出其 grant 的信封 → relay 侧 intent⊄grant → 拒（scope 精判在 M0c-2，M0c-1 层测"无 grant=拒"+"有 grant 对照"前提在）。
4. **未登记命令默认拒（§3.2 / 靶 M1-2 派生）**：新增/未在授权配置的命令 → 默认落需信封类 → 无 grant → 拒（防悄悄全开）。
5. **A 网关绕过 vs relay gate（靶 M1-7 场景分界）**：M0c armed 后独立应用进程绕过 A 网关尝试触达 relay → 结构上够不到 IPC（§2.3 load-bearing 依赖的行为验证）；relay 侧 C gate 的 backstop 价值按 §2.3 v0.2 措辞验证。**Console 进程内绕过 = 场景 B，走乙如实标 LANDS**（§1，R 收口才 BUST，不算 fail）。
6. **只读白名单越界（§3.1 / 靶 M1-3 关联）**：白名单外命令伪装成只读类试图豁免信封 → 拒（白名单是显式命令枚举，不按 caller 自称）。
7. **origin 伪造注入（§4.0 / 靶 M1-1 同族·v0.2 新增）**：应用经 A 网关请求中注入 `origin='internal'` → 网关强制覆写为 `'app'` → 无有效 envelope = 拒。直发 IPC 不可达（结构依赖见 5）。
8. **解析异常 fail-closed（§3.2 M1-4 / 靶 M1-4·v0.2 新增）**：malformed envelope / 未知 key-id / origin 非法值 / canonical 反序列化抛错 → 全部走拒绝分支，无默认身份回退、无异常逃逸进 switch。
9. **provision 场景 A 不可达（§4.3 / 靶 M1-5·v0.2 新增）**：应用用合法 service 凭证尝试 provision 新 grant（经网关 / 任何 HTTP 端点 / 构造 IPC 命令）→ 必拒；registry 写入方静态枚举 = 仅 operator 离线脚本。
10. **TOCTOU（§4.1 不变量 / 靶 M1-6·v0.2 新增）**：验证通过后篡改原始 cmd 引用的字段 → 执行不受影响（switch 只消费 frozen canonical cmd）；intentDigest 覆盖全部影响执行字段的完备性核查。
11. **legacy 迁移零回归（§4.0 note-A·v0.2 新增·正向对照）**：全部存量 internal 调用点标注后，现网结算/投票/传输行为 == 迁移前（gate armed 前置 checklist 项，实战窗跑真实 settle tick 验证）。

**armed 判据**：1/2/4/6/7/8/9 在 M0c-1 落码后须全 BUST，11 须全等；3 的 scope 精判依赖 M0c-2；5 的 Console 内部分支 + M1-7 走乙如实 LANDS（§1）；10 的 digest 完备性随实现批 diff 审核。M0c-1 单独 armed ≠ 放行 relay-access（§7 note①）。实战测试按 Owner DoD：NWT harness（`f7865428`）逐条真发攻击验 BUST + 合法请求真发验放行（关 2 行为验，非单元断言）。

---

## 9. 待办 / 交接（v0.2 更新）

- **v0.2 待 NWT 复审（MUST-FIX 闭合核）+ J1 域二过** → 两维度过 → Owner money-path 签发才落码（M0c 碰 relay 授权=money-path）。
- **落码/装载排序（§4.0 note-A 硬前置）**：① origin lint warn 落码（KANet-UI，复用 m0a-lib 差分门）→ ② 存量 20+ 调用点迁移标注 + 零行为变更验证 + NWT diff GREEN → 升 ERROR → ③ gate 落码（实际 diff 审 + Owner 签发）→ ④ 实战测试（NWT harness `f7865428` 逐条真发，§8 armed 判据）→ ⑤ 装载。**gate armed 的前置 checklist 含"全部 internal 调用点已迁移"。**
- **R 卡回写**：§4.0 note-B（post-R 不得盲信 Console 设 origin）记入 R 后续升级卡验收基线（M-1.6 §1.4）。
- **M0c-2/M0c-3 并行起草**：消费 §5 caller 身份抽象接口 + §4.3 provision/吊销同通道约定，J2 域，随后出稿。
- **改表**（grant registry / 审计表）须过 `docs/DATABASE.md`，migrate 接 v56+（当前 v55），设计定 schema 后同步更新 DATABASE.md。
- **预算精确数**：待 Owner 签发、落码阶段读实际 diff 填（§6 给维度不拍数 + n3 划分口径）。

**关联**：`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md` v0.3.1（A+C+R 定案+TCB 声明+canonical envelope）、`docs/2026-07-22-m0c-capability-base-batch-prep.md`（三子批切分+预算框架）、`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`（命令分类来源）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（§4 验收矩阵）、Codex RED `06d759df` + 复审 `e20fdc82`（5 must-survive notes）、`docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md`（MF6 用户授权拆分并轨）。
