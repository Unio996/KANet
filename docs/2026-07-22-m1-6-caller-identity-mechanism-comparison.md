# M-1.6 Caller 身份机制选型 v0.3（J2 机制 + NWT 红队，Owner 乙路定案后决策稿）

> **Status**: v0.3.1 DRAFT（2026-07-22 · J2 出稿 → NWT 红队审 GREEN 无 MUST-FIX `d52b815d` → 待 Codex 再审 → 再请 Owner 冻结）
> **v0.3.1 微调**：折入 NWT 两条非阻塞完整性 note（不改任何结论）——note-1：§8.6 gateway-bypass 的场景-A-BUST 补"(M0c armed 后)"前置标注（与其余测试"设计期 LANDS"对称）；note-2：§1.1 补 per-relay 子进程=其单把 key 的更窄 TCB 面（信任边界枚举完备到子进程层）。
> **本卡性质**：设计/决策文档，不改一行执行代码。不授权任何落码、密钥迁移、relay 重启、签名、广播、结算、资金移动。
> **方向定案**：Owner 2026-07-22 16:0xZ 拍板**走乙路**（记账 `d8c45faa`）——A+C 授权模型作第一步先上，**明确接受测试网阶段 Console = TCB（可信计算基）残留**；甲方案（R = relay 密钥/生命周期隔离）记为后续安全升级卡，慢工出细活、与模块化并行渐进、不阻塞主线，但须在应用抽离触达 relay 之前收口。
> **v0.3 相对 v0.2 的根本变化**：v0.2 曾判"A+C 两条硬约束后抗场景 B"，被 Codex 外审 B-0 推翻（`06d759df`，J2/NWT 各自独立核代码坐实认账）——Console 进程本就持全量 relay 明文私钥，被攻陷 Console 无需过 relay 验证即可直接签任意交易。故 v0.3 不再声称 A+C 抗场景 B，改为**诚实分场景**：A+C 防场景 A（越权/被攻陷应用）+场景 C（重放），场景 B/B-0 只有方案 R 能治，走乙期间显式声明为已知残留。
> **消化输入**：Codex M-1.6 RED（`06d759df`，含 6 条 MUST-FIX + 7 项 required package）、NWT M-1.2 v0.2（`f3fde977`，B-0 置顶）、NWT M-1.6 v0.2 verdict（`d7a46faf`）+ 频道两条红队硬牙（R 收口时点=硬约束、TCB 声明须可测）。
> **依据**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md` M-1 §5.6 + M0c 七项。

---

## 1. 🔴 诚实 TCB 声明（NWT 硬牙·置顶·可测·不得含糊）

> 本节是走乙路的**核心诚实义务**。任何暗示"A+C 抗被攻陷 Console"的表述 = 化妆式安全 = 打回。本节写成**可测的验收基线**，将来 R 收口时用它核对"TCB 缩小了什么"。

### 1.1 谁在 TCB 内（走乙期间）

以下全部在可信计算基内——它们中任何一个被攻陷 = relay 全量私钥失守，A+C 授权体系整体失效：

- **Console Node 进程本身**（`kasia-console`，进程内任意模块/HTTP handler/cron 都共享同一地址空间与 `_relays` map）。
- **持有 `CONSOLE_ENCRYPTION_KEY` 的任何主体**（该密钥 = 解密 `relay_nodes.privkey_encrypted`/`mnemonic_encrypted` 的唯一钥匙；`kanet.env` 持久化，见 CLAUDE.md 关键配置）。
- **Console 运行所在的 OS 安全主体**（relay 子进程 `fork` 时继承同一 OS principal，`relay-manager.js:87`；能读 Console 内存/env/DB 文件的 OS 用户等价于在 TCB 内）。
- **Console 可写的 relay 代码目录 `RELAY_DIR` 与 DB 文件**（Console 能改 relay 码/改配置/改密文=能重定义 relay 行为）。

> **per-relay 子进程的更窄 TCB 面（NWT note-2，完整性补全）**：以上是"被攻陷=relay **全量**私钥失守"的支配威胁。另有一个更窄的边界：**每个 relay 子进程对它自己那一把 key 也在 TCB 内**（key 在其 env，`relay-manager.js:83-84`）——单个 relay 子进程被攻陷 = 仅该 relay 单把 key，爆炸半径远小于 Console 全量。不改变乙决策（Console 全量失守是支配威胁），但信任边界枚举须完备到此层。

### 1.2 TCB 被攻陷的具体后果（B-0，LANDS，可测）

攻击者取得"Console 进程内任意代码执行"能力后，**不受限于重放已观测的能力信封**，至少可以（每条都有 file:line 锚，可写成负向测试断言"当前 LANDS"）：

1. 直接调 `getRelayPrivkey()`/`getRelayMnemonic()` 拿明文私钥（`relay-nodes.js:44-53,77-81`）→ 自行构造签名任意交易，完全不经 relay。
2. `SIGKILL` 掉合法 relay，用同一把 key 起**改过的 relay 码**（`relay-manager.js` 持全部 child handle + 生命周期控制）。
3. 改写 Console 同 OS 主体可写的 trust-root/config/app-key 注册表 → 自我授权，无需伪造任何现存 app 签名。
4. 重启 relay 清空内存态 nonce/replay cache → 重放旧的合法信封。
5. 篡改 Console 侧格式化日志 → 抹除或伪造归因。

### 1.3 走乙期间**不得声称**的能力清单（禁用词表）

以下话术在 v0.3 及后续所有对外/对内文档、代码注释、频道汇报中**禁止出现**，出现即化妆式打回：

- ❌ "A+C 抗被攻陷 Console" / "A+C 防场景 B" / "relay 进程内验证使被攻陷 Console 无法伪造"。
- ❌ "app 自持凭证使 Console 被攻陷最多只能重放"（B-0 下 Console 直接拿私钥，连重放上界都不成立）。
- ❌ 任何把 M0c 的 caller 校验描述成"抗 Console 攻陷"的表述（M0c 只防应用/IPC 面 B-1~B-5，不防 B-0）。
- ✅ 允许且必须的口径："A+C = 针对**应用**（被攻陷应用/共享 secret/应用间越权/内部误用）的最小权限授权；Console 在测试网阶段是 TCB，A+C 不防被攻陷 Console；抗场景 B 需方案 R，见 §6。"

### 1.4 R 收口的验收基线（TCB 缩小的可测目标）

R（方案，§6）收口的验收 = §1.1 的 TCB 成员表**逐条移出**：relay 私钥 Console 读不到（MUST-FIX 2）、relay 由外部 supervisor 起、relay 码/配置/密钥 Console 不可写、生命周期权与普通 Console 模块分离。R 收口后 §1.2 的 5 条后果逐条从 LANDS 翻 BUST——这就是"TCB 缩小了什么"的验收清单。

---

## 2. 威胁边界修正与 B-0（Codex threat-model correction，已并入 M-1.2 v0.2）

Codex 要求 M-1.2 新增一行，NWT 已回填（`f3fde977`）。此处引用锚定，v0.3 与之对齐：

> **B-0 — Console 密钥托管/生命周期接管**：Console 进程内任意代码调既有解密助手拿 relay key，或重启改过的 relay 码。不变量：Console 不能读 relay 签名私钥，也不能替换 relay 策略/信任根。**当前状态：LANDS**。

**B-0 支配 B-1~B-5**：relay 内的 caller 身份校验保护不了资金，如果攻击者能直接拿到 relay 签名私钥。故场景 B 的完整闭合 = **M0c GREEN（治 B-1~B-5 应用/IPC 面）+ R 收口（治 B-0 密钥托管面）**，两个都得（NWT 红队硬牙①，见 §6.2）。

---

## 3. 架构定案：A + C + R（Owner 乙 = A+C first，R 后续卡，B optional DiD）

Codex 终定架构陈述："**A + C + R first；B 是可选的纵深防御，不是替代授权系统。**" Owner 乙路 = 现在先落 A+C、R 记后续卡渐进。三者职责：

- **A（HTTP 能力网关）**：按业务能力命名的窄化端点（非裸 `sendCommandAsync` 透传），把"内部模块随便调 relay"变成"外部应用只能过这层"。复用 tg-bot 已验证的纯 HTTP 模式，relay fork 拓扑零改动。**只防场景 A 的"谁能连"，对场景 B 零防御**（同进程内可绕过网关直接 import，§附录 A.1）。
- **C（签名能力信封）**：每条送进 relay 的命令附带签名信封，relay 端验证。**必须满足 §5 的 canonical 序列化 + §4 MUST-FIX 3 的 relay-authoritative grant**（信封里的 scope 是不可信输入，relay 必须对照 relay 侧权威 grant 校验，不能信 app 自报 scope）。C 防场景 A 的"连上后能干什么" + 场景 C 的重放（配 MUST-FIX 4 持久化）。**在 B-0 未由 R 治掉前，C 对场景 B 同样无效**（Console 直接拿私钥不走信封）。
- **R（relay 信任边界+密钥托管隔离）**：抗场景 B/B-0 的**唯一结构性解**。Owner 定为后续升级卡（§6），走乙期间不做，明确接受 Console=TCB 残留。
- **B（per-app socket）**：Codex 明确"socket 路径 ≠ caller 身份，除非配 OS peer 凭证/ACL/独立 principal"，且 B 只认证传输 peer、仍需 C 式 scope 校验。故 **B 降为可选纵深防御，不替代 C 或 R**（附录 A.2 保留三案对比作历史）。

---

## 4. Codex 6 条 MUST-FIX 分归属

| # | Codex MUST-FIX | 归属 | 走乙期处置 |
|---|---|---|---|
| MF1 | 定义真实信任边界（要么窄化场景 B 声明 Console=TCB，要么隔离 relay；不许"宽对手定义+仅进程隔离"） | **本卡 §1（乙路选定）** | ✅ 选定：显式声明 Console=TCB（§1.1），A+C 不声称抗 Console。MF1 在 v0.3 即闭（是方向决策非落码） |
| MF2 | 隔离 relay 密钥托管+生命周期（Console 不可读 relay key/不可替换 verifier） | **R 卡（§6，甲方案）** | ⏸ 走乙不做，登记后续升级卡；§1 诚实声明残留。收口前置于"应用抽离触达 relay" |
| MF3 | relay-authoritative capability grant（信封 scope 是不可信输入，relay 须对照权威 grant 校验；grant 由 Console 信任域**之外**的 authority 签发） | **M0c 子批（M0c-1，选型相关）** | 🔶 A+C 完整版必需；grant 签发 authority 走乙期仍在 Console 域内=残留（§4.1 诚实注记），R 收口后移出。设计随 M0c-1 |
| MF4 | 持久化 replay/幂等态（跨 relay 重启持久、原子预留 nonce、fail-closed、绑定 app-key/grant/intent-digest/network/relay-id、拒时钟回拨） | **M0c 子批（M0c-3，选型无关可先设计）** | 🔶 设计可先行（Bettor M0c 骨架已切）；注记：走乙下 Console 能重启 relay 清态，持久化只在 R 收口后对场景 B 完整有效，对场景 C（外部重放）走乙即有效 |
| MF5 | 独立审计回执（relay 签发绑定 app 身份/grant-id/intent-digest/nonce/决策/txid，落 Console 改不动的 append-only sink） | **M0c 子批（M0c-3）** | 🔶 设计可先行；注记：sink 须在 Console mutation authority 之外，走乙下该 sink 仍受 Console OS 主体影响=残留，R 收口后独立 |
| MF6 | app 身份 ≠ 端用户授权（多用户 app 的 service 凭证证明"来自 tg-bot"，不证明"用户 X 授权本次提款"） | **containment 卡目标 B（§7）** | 🔶 与 containment 卡并轨；无独立用户证明则诚实声明"tg-bot 被攻陷=全托管用户失守"+硬钱包/额度/速率限制降爆炸半径 |

### 4.1 走乙期的诚实注记（MF3/MF4/MF5 的残留边界）

MF3~MF5 即使在 A+C 完整版落地后，**其信任根（grant 签发 authority / replay-state store / audit sink）在走乙期间仍在 Console 可达的信任域内**——因为 Console=TCB。这意味着它们对**应用面攻击（场景 A）**有效、对**被攻陷 Console（场景 B）无效**，这与 §1 的 TCB 声明一致，不构成矛盾。R 收口 = 把这三个信任根移出 Console 域，届时它们对场景 B 才完整生效。M0c 实现批 diff 审须逐条核这三个信任根的宿主，禁止把"信任根在 Console 内"悄悄描述成"抗 Console"。

---

## 5. Canonical 信封要求（Codex canonical envelope requirements，C 案落码强制）

签名字节必须用**单一 canonical 序列化 + domain separation**，至少绑定下列字段；**任一字段（收款人/金额/用户 subject/route-intent/network/relay）变化必须使签名失效**：

- protocol / domain / version；
- app key-id + grant-id；
- relay identity + network；
- typed-intent type/version + canonical intent digest；
- wallet/market/outpoint/branch/recipient/amount/fee scope；
- nonce / idempotency-key；
- issued-at + expiry。

这是 C 案实现批（M0c-1）的硬 DoD，不是建议。intent digest 必须是"这次要做什么"的结构化摘要，不是裸 witness/inputs/outputs（呼应 typed-intent 全量方向 v0.4.2 §D2）。

---

## 6. 方案 R 后续升级卡（甲方案·Owner"记下来慢工出细活"直令·不丢）

### 6.1 R 的内容（抗场景 B/B-0 唯一结构性解）

relay 私钥托管 + 验证器 + 生命周期隔离到 Console 够不到的信任域：

- relay 由**外部 supervisor** 起，不由（可能被攻陷的）Console fork；
- relay 独立 OS 服务身份 / 容器边界；
- relay-only keystore / OS keystore，Console **不可读**；
- Console 不能写 relay 码 / trust registry / 密钥材料；
- pinned/signed relay binary+config 或等价部署完整性；
- 生命周期权与普通 Console 模块分离。

### 6.2 R 收口时点 = 硬约束（NWT 红队硬牙①，非软目标）

R 与模块化并行渐进、慢工出细活、不阻塞主线，**但**：

> **应用抽离触达 relay 的前置门 = M0c GREEN 且 R 收口，两个都得。**

这与 NWT M-1.2 红队硬门"M0c 未 armed 前应用不得独立触达 relay"是同一道门的两半：M0c 治 B-1~B-5（应用/IPC 面），R 治 B-0（密钥托管面）。走乙 ≠ "B-0 永久接受"，而是"B-0 在应用仍在 Console 进程内（未抽离）的窗口期接受"——一旦模块化推进到应用抽离为独立进程并要触达 relay，残留窗口就敞开了，此时 R 必须已收口，否则 = 把 B-0 从"内部代码"升级成"跨进程可达攻击面"。

---

## 7. Service 身份 vs 端用户授权（MF6·containment 卡目标 B 并轨）

containment 卡**不能**复用 app 持有的 service 凭证并称之为真正的 Telegram 用户 subject 绑定。多用户 app：

- app 凭证 = **service 身份**（证明"请求来自 tg-bot"）；
- 用户授权 = **独立证明**，绑定 user + wallet + recipient + amount + network + nonce + expiry。

若无可行的独立用户证明，须诚实声明残留："tg-bot 被攻陷 = 授权所有托管用户"，且 containment 必须用硬钱包/额度/速率限制 + 提款延迟/可取消 + 或另一独立确认因子来**降爆炸半径**，**不得**声称完整端用户授权。此条与 NWT 持有的 containment 卡二审硬条件（凭证须 app 自持+relay 验证、非换名共享 secret）并轨——但注意走乙期 relay 验证本身在 TCB 内，故 containment 卡的完整闭合同样 gating 于 R（§6）。

---

## 8. 负向测试（Codex required package 第 7 项·选型冻结前 DoD）

以下每条 = 一个可执行负向测试，pass=攻击被拦(BUST)/fail=攻击得逞(LANDS)。走乙期部分标注"设计期 LANDS（R 未收口）"= 诚实记录残留而非假装拦住：

1. **key-registry replacement**：Console 域内代码改 app-key 注册表/trust-root 自授权 → 走乙 LANDS（B-0，R 收口后应 BUST）。
2. **restart replay**：重启 relay 清内存 nonce 后重放旧合法信封 → 需 MF4 持久化 store 才 BUST；store 在 Console 域内则对场景 B 仍 LANDS，对场景 C（外部重放）BUST。
3. **scope inflation**：合法 app key 签一个 scope 超出其 grant 的信封 → 需 MF3 relay-authoritative grant 校验才 BUST（这条不依赖 R，是 A+C 完整版就该拦的场景 A 攻击，必须 BUST）。
4. **cross-user substitution**：被攻陷/恶意多用户 tg-bot 用合法 service 凭证替换 `tg_user_id` 提他人款 → 需 MF6 独立用户证明才 BUST；无则 LANDS + 靠 §7 爆炸半径限制兜底。
5. **plaintext-key extraction（B-0 直证）**：Console 域内代码调 `getRelayPrivkey()` 直接签交易 → 走乙 LANDS（就是 TCB 定义本身），R 收口后 BUST。这条是 §1.4 验收基线的头号断言。
6. **gateway bypass（场景 B vs A 分界）**：Console 进程内代码不走 A 网关直接 import relay-manager 调 sendCommandAsync → 走乙 LANDS（场景 B）；但从**独立应用进程**发起同样绕过尝试 → **（M0c armed 后）**应被 A 网关 + C 信封拦（场景 A，必须 BUST）。这条区分 A+C 对两场景的不同效力。**注（NWT note-1）**：此场景-A-BUST 是 **post-M0c 验收断言**，非当前态——当前乙-first 阶段 A+C 仅设计未落码，且红队硬门规定"M0c GREEN+R 收口前应用不得抽离为独立进程"，故独立应用进程这个前提当前尚不存在；标注与其余测试的"设计期 LANDS"对称，避免读成"现在就 BUST"。

---

## 9. Codex "Required next package" 7 项映射（自检 checklist）

| Codex 要求 | v0.3 对应 | 状态 |
|---|---|---|
| ① corrected threat boundary + B-0 | §1 TCB 声明 + §2 B-0 | ✅ 本卡 |
| ② A+C+R 架构 + B 是否 optional DiD | §3 | ✅ 本卡（B=optional DiD） |
| ③ relay key/lifecycle 隔离计划 or 显式声明 Console=TCB | §1（乙=声明 Console=TCB）+ §6（R 计划登记） | ✅ 本卡 |
| ④ 权威 capability-grant 格式 + trust-root 归属 | §5 envelope + §4 MF3 | 🔶 格式本卡定，落码归 M0c-1；trust-root 归属走乙在 Console 域（§4.1 诚实注记） |
| ⑤ durable replay-state 设计 | §4 MF4 | 🔶 归 M0c-3，设计可先行 |
| ⑥ service 身份 vs 端用户授权拆分（containment 卡） | §7 | 🔶 归 containment 卡目标 B，并轨 |
| ⑦ 负向测试（key-registry/restart-replay/scope-inflation/cross-user） | §8（6 条，覆盖 Codex 点名 4 类 + B-0 直证 + gateway 分界） | ✅ 本卡 |

**再审请求**：本 v0.3 完成 Codex required package 第①②③⑦项于本卡，④⑤⑥指明归属子批（M0c-1/M0c-3/containment 卡）随各批设计展开。请 NWT 红队审 → 经 GitHub bridge 请 Codex 再审 → 再请 Owner 冻结 caller 身份选型与 M0c 执行批启动。

---

## 附录 A：三案对比（v0.1/v0.2 选型历史·保留作 A/C/B 职责依据）

> 以下为 v0.1/v0.2 的三案对比正文，选型结论已被 §3 取代（A+C+R，B=optional DiD）。保留作各方案职责与"为何 B 不替代 C/R"的推导依据。读者以 §1-§9 为准。

### A.0 现状拓扑（读码坐实·B-0 的地基）

`kasia-console/src/services/relay-manager.js`：Console **单进程**内对每个 relay 身份各自 `child_process.fork('src/relay.mjs')`（:87），私钥经 `env.KASPA_PRIVKEY`/`KASPA_MNEMONIC` 注入子进程（:83-84，明文，来自 `getRelayPrivkey()` 解密，:60-61 → `relay-nodes.js:44-53`）。所有子进程句柄存 Console 进程内同一 `_relays` map，`sendCommandAsync(relayNodeId, cmd)`（:277）查 map 调 `child.send`。**Console 进程内任意模块/HTTP handler/cron 只要 import `relay-manager.js` 就能对任意 relayId 发任意命令，零区分调用来源**——这既是 M2/M4 拆应用进程后会破的假设（场景 A 的来源），也是 B-0 的直接地基（Console 本就在 key 托管链顶端）。

### A.1 方案 A：HTTP 能力网关

Console 保留唯一持有 relay 子进程句柄，新增按业务能力命名的窄化 HTTP 端点，应用进程只能过这层。relay fork 模型零改动。**弱点（决定 §3 分工）**：Console 进程内代码可不走网关直接 import relay-manager 调 sendCommandAsync，故 A 对场景 B 零防御——这不是 A 的缺陷而是 A 的定义边界（A 管跨进程的"谁能连"，管不了同进程绕过）。

### A.2 方案 B：per-app socket

一个应用一个专属 IPC/unix-socket 通道，app 身份由"连的是哪个 socket"决定。**Codex 修正（v0.3 采纳）**：socket 路径本身 ≠ caller 身份，成为结构性身份边界需同时具备：独立 OS 身份 / socket ACL / 验证 peer 凭证（SO_PEERCRED 非路径名推断）/ Console 无法冒充的 broker principal / 受保护的 relay 码+信任注册表+key store。且即便全具备，B 也只认证传输 peer，仍需 C 式 scope/effect 校验。**结论**：B 不自动等于"物理身份"，降为可选纵深防御，不替代 C 或 R。改动面（新增 broker/router 层 + 连锁改 relay handler 签名）本就最大，走乙不启动。

### A.3 方案 C：签名能力信封

见 §3（C）+ §5（canonical 要求）+ §4 MF3（relay-authoritative grant）。v0.2 曾把 C 的两条硬约束（relay 进程内验证 + app 自持凭证）当作"抗场景 B"的充分条件，被 B-0 推翻：两条约束是**必要非充分**，它们治"自签自验"子问题，但仍建立在"relay 进程是被攻陷 Console 碰不到的独立锚"这个被 B-0 拓扑推翻的前提上。故 C 的完整效力对场景 B gating 于 R。

---

**关联**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md`（M-1 §5.6、M0c 七项）、`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`（scope/命令依据）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（B-0/三场景，`f3fde977`）、`docs/2026-07-22-NWT-redteam-m1-6-caller-identity.md`（NWT v0.2 verdict）、Codex RED `06d759df`（6 MUST-FIX + 7 required package）、`docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md`（MF6 并轨）、M0c 骨架 `docs/2026-07-22-m0c-capability-base-batch-prep.md`。
