# M-1.2 威胁模型 — 三场景可测清单 v0.1（NWT 红队主笔）

> **Status**: DRAFT（2026-07-22 · NWT）· 待内部交叉审（不可自审自过）
> **依据**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md` M-1 §3.2 + M-1.1 全命令能力/效果清单（`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`）+ M-1.6 caller 拓扑坐实（`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md`）。
> **本卡性质**：只读取证 + 威胁建模，不改一行执行代码。所有攻击链锚到 file:line，红队默认立场 = 每条先假设**当前 LANDS（打得穿）**，只有代码证明拦得住才标 BUST。
> **交付形态**：每条威胁 = 一个**可测断言**——给出攻击、必须成立的不变量、判据脚本形态、以及 pass=BUST/fail=LANDS 的二值判定。这是 M0c 七项验收门和 M-1.1"调用方能力/审计回执/吊销机制"三列（现状全"无"）的对照母表。

---

## 0. 判据框架 = 四层判据的可测升级

我在 D2 类 B 摸底时提的四层判据（认证 / 授权 / 传输边界 / 审计）原是定性维度。本卡把每一层升级成**可执行断言**：一条威胁若在某层无拦截，就写成"构造 X 请求 → 断言产生 Y 副作用"的负向测试。**验收 = 全部负向测试 fail-closed（攻击被拒），不是 happy-path e2e 通过**（happy-path 恰恰会掩盖要测的东西——铁律：demo 过了可能正好绕开了失败模式）。

四层 → M0c 七项映射（本卡末尾 §4 给完整矩阵）：

| 四层判据 | 可测问题 | M0c 对应项 |
|---|---|---|
| 认证 | 传输边界上的 caller 身份是不是**自声明**（可伪造）？ | ①非自声明 caller 身份 |
| 授权 | 有没有**逐 caller** 的命令/钱包/市场/outpoint scope 策略门？ | ③策略 evaluator ④逐 caller scope |
| 传输边界 | 到达 relay 分发点前，请求经过几道门？进程成员资格是否 == 全权？ | ②默认拒绝暴露 |
| 审计 + 抗重放 | 有没有**绑定已认证身份**的回执 + nonce/幂等去重 + 免代码吊销？ | ⑤防重放幂等 ⑥审计回执 ⑦吊销路径 |

---

## 1. 传输拓扑现状（三场景共同的地面事实，先钉死再打）

**T-1 relay IPC = Node fork 通道，进程成员资格 == 全权（零认证零授权）。**
- relay 命令入口 = `kasia-relay/src/relay.mjs:331` `process.on('message', async (cmd) => …)`——Node child_process fork IPC，**唯一"发送方"是 fork 它的 console 父进程**。
- 分发前的唯一门 = `relay.mjs:337` `validateCommandPayload(cmd)`——**只校验 type 名 + 字段 typeof 形状**（`commands.mjs`），**零 caller 身份校验**。通过形状检查后 `relay.mjs:358` `switch (cmd.type)` 直接执行全部 ~50 命令，含 custodial_transfer（:478）、盲签 9 条、covenant 20 条、ECDSA_SIGN、SIGN_INPUT_FOR_SETTLE。
- **J2 M-1.6 独立坐实（2026-07-22）**：`relay-manager.js` 每个 relay 身份各自 fork 一个子进程，**全部子进程句柄存 Console 进程内同一个 map**——"进程内任何代码都能对任意 relayId 发任意命令"。两路独立坐实同一事实 = 传输边界不是密码学边界，是**进程内存边界**。

**T-2 console HTTP API（fastify :3200）= 单一共享 secret，无身份/scope/nonce。**
- 认证中间件 `verifyIngestRequest`（`kasia-console/src/services/ingest-auth.js:19-44`）= 取 header `x-ingest-secret`，`timingSafeEqual` 比对**唯一全局** `ingest_secret`（configs 表）。无服务身份、无用户 subject、无动作 scope、无 nonce。
- **同一把钥匙被 16+ 个不相关路由复用**（实测 grep `verifyIngestRequest`/`isValidIngestSecret`）：`admin.js`/`chat.js`/`chain-data.js`/`escrow.js`/`oracle-pool.js`/`pool.js`/`relay.js`/`trading.js`/`tg-wallet.js`/`link.js`/`ingest.js`/`discovery.js`/`context.js`/`skills.js`/`events.js`/`admin-dedup.js`。**任一路由的调用方 == 全 API 面的调用方**。
- custodial 转账端点 `tg-wallet.js:92` `POST /api/tg-wallet/:tg_user_id/send`：`tg_user_id` **取自 URL 路径**（`request.params`），服务端从不验证"持 secret 的调用方"与"URL 里的 tg_user_id"有绑定关系。代码注释 `tg-wallet.js:19-22` 早已自述此风险（2026-06-23，知险未治）。

**T-3 全链路零重放防护。**
- IPC 侧 `cmd.requestId` 仅用于**响应关联**（`relay.mjs:340/487/…` 回 `process.send({requestId, result})`），**不做去重**——无 seen-set、无 nonce 存储、无幂等键校验（实测 grep 确认 relay.mjs 无 nonce/dedup/replay 拦截逻辑，仅 `_acceptedPeers` handshake 专用去重与本面无关）。
- HTTP 侧 `verifyIngestRequest` 无 nonce/timestamp/request-id，`tg-wallet.js` 无 idempotency（实测 grep 空）。**一条抓到的合法请求可无限次重放**。

---

## 2. 三场景可测清单

### 场景 A：被攻陷应用（compromised app）

**威胁定义**：一个已抽离/半抽离的应用（今日形态 = tg-bot；M2/M4 后 = exchange/prediction 独立进程）被攻陷，或其持有的共享 `ingest_secret` 泄露。攻击者拿到的能力 = **合法持 secret 的 HTTP 调用方**（不是匿名外部人）。

| ID | 攻击链 | 必须成立的不变量（MUST） | 判据/测试形态 | 当前状态 |
|---|---|---|---|---|
| A-1 | 持 secret 调 `POST /api/tg-wallet/{victim_tg_id}/send` 抽干他人托管钱包 | caller 凭证必须绑定它被授权操作的 tg_user subject 集合；替换 subject 必被拒 | 用合法服务凭证 + 非自己的 tg_user_id 发 send → **断言 401/403，链上零 tx** | 🔴 **LANDS**（tg_user_id 取自 URL，零绑定，`tg-wallet.js:92`）——= containment 卡目标 B |
| A-2 | 持 secret 调 `pool.js`/`oracle-pool.js`/`trading.js`/`escrow.js` 任意路由（同一把钥匙全开） | 每个应用凭证只能触达其**声明的命令子集**（最小权限） | 用"仅应被授权 tg-wallet 的"凭证调 `POST /api/pool/*` 结算路由 → **断言拒绝** | 🔴 **LANDS**（单一共享 secret 无 scope，16+ 路由共用） |
| A-3 | 抽离后应用经 console 触达 relay 命令（M1+ 拓扑）→ 发 custodial_transfer/盲签/covenant | 应用不能提交它未被授权家族的 relay 命令；无 verifier 的命令保持 internal 不可被 app 调用 | 枚举应用凭证 × 全 ~50 命令矩阵，逐格断言 internal 命令拒绝 | 🔴 **LANDS**（M0b"默认拒绝准入"未建；现状 app→console→relay 无命令级门） |
| A-4 | payload 里塞 `app_id`/来源标识自我声明成高权应用 | caller 身份必须来自**传输边界**（不可伪造），非 payload 自声明 | 伪造 payload app_id → 断言不改变授权判定 | 🔴 **LANDS**（现状根本无 app_id 概念；路线图明示"payload 明文 app_id 不可接受"，M-1.6 待选型） |

**A 场景四层判据落点**：认证=有（单 secret）但**无身份区分**；授权=**无**（零 scope）；传输边界=HTTP 单门；审计=无 caller-bound 回执。→ A-1 直接喂 containment 卡目标 B（Owner money-path 签发前零代码）。

### 场景 B：被攻陷 Console worker

**威胁定义**：console 进程内任一模块/依赖/worker 被攻陷（供应链、注入、越权模块）。攻击者获得的能力 = **console 进程内代码执行**。这是最高危面——因为 T-1：进程成员资格 == relay 全权。

| ID | 攻击链 | 必须成立的不变量（MUST） | 判据/测试形态 | 当前状态 |
|---|---|---|---|---|
| B-1 | 进程内代码经 `relay-manager` map 拿任意 relayId 句柄，`child.send({type:'custodial_transfer', privkeyHex, target, amount})` | relay 分发前必须校验 caller 身份，非"能 send 就执行" | 从非授权模块上下文发 custodial_transfer → 断言 relay 拒绝（需 caller 身份门） | 🔴 **LANDS**（`relay.mjs:331/358` 零 caller 校验；J2 坐实 map 全开） |
| B-2 | 发 `ECDSA_SIGN{message:任意}` / `SIGN_INPUT_FOR_SETTLE{tx_hex:任意}` 让 relay 私钥盲签攻击者构造的字节 | relay 不得对语义未校验的字节签名；签名对象须绑定已授权意图 | 构造任意 message → 断言 relay 拒签或要求 typed-intent | 🔴 **LANDS**（M-1.1 §2 坐实两条通用原语 = 盲签同族，relay 零内容校验） |
| B-3 | 发 covenant 20 条（BSHARD_*/CLOSEZK_V2_*）伪造 witness/inputs/outputs 推进结算/退款 | covenant 命令须有 caller scope + typed-intent + 经济效果 verifier | 逐命令用越权上下文提交 → 断言默认拒绝（internal 不可外调） | 🔴 **LANDS**（M-1.1 §1 坐实 20 条"调用方能力/审计/吊销"全无） |
| B-4 | 攻陷后无痕：无绑定身份的请求审计，事后无法归因是哪个 worker 发起 | 每条 relay 命令须写**绑定已认证 caller 身份**的独立审计回执（非仅链上 tx） | 制造一次越权命令 → 断言审计日志含 caller 身份可归因 | 🔴 **LANDS**（现状仅链上 tx + 无 caller 维度日志） |
| B-5 | 攻陷持续：无免代码吊销路径，无法在不改码重启下切断被攻陷 worker 的命令权 | 须存在运行时吊销/禁用某 caller 命令权的路径 | 触发吊销 → 断言该 caller 后续命令被拒，且无需改码部署 | 🔴 **LANDS**（M0c⑦未建） |

**B 场景是 M0c 存在的核心理由**：Codex MF1"选完机制没人装 = 设计到运行时缺环"——M-1.6 选出 caller 身份机制后，**必须先于 M1 与任何多进程应用触达 relay 装上 M0c①②③**，否则 B-1~B-3 在整个模块化过程中一直 LANDS。**红队硬门：M0c 未装armed 前，任何"应用已抽离可独立触达 relay"的批次 = RED**（等于在没有权限边界的目录边界上做"化妆式模块化"）。

### 场景 C：重放的 IPC 或 HTTP 请求

**威胁定义**：攻击者（网络中间人 / 日志读取者 / 被攻陷组件）捕获一条**合法**请求，原样重发。不需要伪造签名或密钥——合法请求本身可重放即构成攻击。

| ID | 攻击链 | 必须成立的不变量（MUST） | 判据/测试形态 | 当前状态 |
|---|---|---|---|---|
| C-1 | 捕获一次合法 `tg-wallet/{id}/send`，重放 N 次 → 多次扣款 | 每请求须带 nonce/request-id，服务端去重，重放第二次即拒 | 同一请求发 2 次 → 断言第二次 409/拒绝，链上仅 1 tx | 🔴 **LANDS**（HTTP 无 nonce，`tg-wallet.js` 无 idempotency） |
| C-2 | 捕获合法 IPC custodial_transfer / 盲签命令，重投 | IPC 命令须带 nonce + relay 侧幂等去重 | 重投同 requestId/同 payload → 断言 relay 去重不重复执行 | 🔴 **LANDS**（`requestId` 仅响应关联，无去重存储） |
| C-3 | 重放 covenant 命令触发同一 nullifier/state 二次转移 | 链上 nullifier/write-once 是最后防线，但**应用层不应依赖它兜底**——须有请求级去重 | 重放 BSHARD_PAYOUT_CLAIM → 断言请求层先拒（不靠 nullifier 链上兜） | 🟡 **两件事分开判（J1 covenant 域逐 20 命令核，`e59b00ba`）**：**二次生效**被 covenant 层挡住 = **12/20 BUST**（nullifier 4：PAYOUT_CLAIM/REFUND_CLAIM/CLOSEZK_V2_CLAIM/ESCAPE_CLAIM，`PayoutShard.sil:171-226` 等；write-once 8：CLOSE_COMMIT/CONSOLIDATE(absorb)/CLOSE_ATTEST/CANCEL_ATTEST/+V2×2/ZK_CLOSE/ESCAPE_TRIGGER）；6 条 UTXO-only + 2 N/A 靠共识层双花挡二次生效。**请求层去重（M0c⑤ 意义的 nonce/幂等）= 0/20 全 LANDS**——无一条命令有应用级去重，重放消耗 relay 处理+mempool 拒绝噪音/探测状态对 20 条全成立 |
| C-4 | 重放跨时间窗（旧请求延迟重投）攻击 daa/lockfile 阈值命令 | 请求须带时效（timestamp + 过期窗），过期即拒 | 延迟重投过期请求 → 断言拒绝 | 🔴 **LANDS**（无 timestamp/过期校验） |

**C 场景关键点（红队立场，J1 逐命令核实后收敛）**：C-3 必须**把"二次生效"和"请求层去重"两个后果分开判**——不能笼统标"部分"。**二次生效**：12/20 covenant 命令有 nullifier(4)/write-once(8) 链上硬挡，6 条 UTXO-only 靠共识层双花挡、2 条终点/创世无重放概念——即"重放能不能造成第二次价值转移"这个后果对 covenant 域基本 BUST（`e59b00ba` 逐 `.sil` file:line 坐实）。**但"链上挡住二次生效"≠"重放被拦"**：请求层去重（M0c⑤ 的 nonce/幂等）**0/20 全 LANDS**——攻击者重放仍能消耗 relay 处理开销+mempool 拒绝噪音、探测状态，且 nullifier 只保护"领同一份额"这个后果，保护不了**无 nullifier 语义**的命令（如 ECDSA_SIGN 重放让 relay 反复签同一字节可能被用于别处）。**请求级去重是必需，链上防重放是纵深不是替代**——这条对 20 条命令一致成立，不因命令而异（= M0c⑤ 要建的东西）。

---

## 3. 交叉发现并入：ECDSA_SIGN / SIGN_INPUT_FOR_SETTLE 风险定性（回应 J2 M-1.1 @NWT）

J2 在 M-1.1 §2 交叉发现两条通用原语贴"通用原语"标签但风险近类 B 盲签。**红队定性（本卡确认）**：
- `ECDSA_SIGN`（M-1.1 §2，relay 自己私钥签**任意调用方传入 message**，零内容校验）+ `SIGN_INPUT_FOR_SETTLE`（签**任意 tx input**，relay 不理解交易语义）= **与盲签 9 条同一信任模型反模式的第 4、第 5 实例**（前三：pool_settle/prediction_settle/custodial_transfer）。
- 反模式统一表述：**"relay 唯一链上出口的独立校验能力被清空——签什么由调用方完全决定，relay 只当签名机器"**。
- **处置建议**：这两条不该因"通用原语"标签在 M0b 准入门被无意识降级。它们必须与盲签 9 条**同规格**进 typed-intent 毕业（M5 类 B 完成判据），在此之前 M0b 保持 internal。B-2 已把它们纳入可测清单。

---

## 4. M0c 七项验收对照矩阵（本卡 → M0c 的可测交接）

M0c 每一项的验收 = 对应场景的负向测试全部 fail-closed。这张表是"M0c 建完没有"的红队核对单：

| M0c 项 | 拦截的威胁 | 验收负向测试（全部须拒） | 现状 |
|---|---|---|---|
| ①非自声明 caller 身份 | A-4, B-1 | 伪造 app_id / 进程内越权模块发命令 → 拒 | 🔴 未建 |
| ②默认拒绝的命令暴露 | A-3, B-2, B-3 | 无 verifier 命令 / internal 命令被 app 调 → 拒 | 🔴 未建 |
| ③对照 capability matrix 的策略 evaluator | A-2, B-1~B-3 | 越 scope 命令 → 拒 | 🔴 未建 |
| ④逐 caller 命令+钱包/市场/outpoint scope | A-1, A-2, B-3 | 替换 subject / 越钱包越市场 → 拒 | 🔴 未建（A-1=containment 卡） |
| ⑤nonce/request-id 防重放 + 幂等回执 | C-1~C-4 | 重放任意命令 → 第二次拒 | 🔴 未建（请求层去重 0/20 covenant + HTTP/IPC 全 LANDS；covenant 层 12/20 挡二次生效是纵深非替代，J1 `e59b00ba`） |
| ⑥绑定已认证身份的审计回执 | B-4 | 越权命令后审计可归因 caller | 🔴 未建 |
| ⑦免代码部署的吊销/禁用路径 | B-5 | 运行时吊销 caller 命令权生效 | 🔴 未建 |

**红队总判据（M-1 验收门 §3.86"NWT 红队过"的可测化）**：上表 21 格负向测试全部 fail-closed = M0c GREEN；任一格 LANDS = 对应 M0c 子批 RED。M-1 阶段本卡只负责**把测试写出来 + 证明现状全 LANDS**（已完成；C-3 经 J1 逐命令核细化为"12/20 covenant 层挡二次生效 + 请求层去重 0/20 全 LANDS"，⑤这格仍整体未建）；实际拦截由 M0c-1/2/3 逐批实现后重跑本表验证。

---

## 5. 待交叉审 + 挂账

- **不可自审自过**：Bettor 已协调级交叉核 T-1/T-2/T-3 file:line 全属实（2026-07-22 14:01）；**C-3 由 J1 covenant 域逐 20 命令核完（`e59b00ba`）**，本卡 C-3 已按其 12/20 细化收敛（见上）。
- **A-1 = containment 卡目标 B 的威胁模型依据**：本卡 A 场景 = `docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md` 的攻击面母表。containment 卡落码仍走 NWT 二审 + Owner money-path 签发（流程锚显式例外，D-011 不放松）。
- **✅ C-3 已闭（J1 `e59b00ba`）**：20 命令逐 `.sil` 核——nullifier 4 + write-once 8 = 12/20 挡二次生效，6 UTXO-only + 2 N/A；请求层去重 0/20 全 LANDS = M0c⑤。J1 另订正 M-1.1 待办②③（BSHARD_CLAIM_WINNER/CLOSE_COMMIT"无独立 finality 检查"是原稿误判——检查在 covenant 层强制非 relay JS 层，属架构正确非缺口）；①register_bet 金额无上限=真缺口（TRANSFER 反模式家族，M-1.1 金额上限列的 gap，非 caller/重放面）。
- **交付**：本文档 + COORD-LEDGER 回写。频道 relay UTXO 充足则同步频道摘要。

**关联**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md`（M-1 §3.2、M0c §3）、`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`、`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md`、`docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md`。
