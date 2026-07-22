# M0c-1 origin 迁移分类清单（初稿）— sendCommandAsync 全仓调用点三类判定

> **Status**: DRAFT（2026-07-23 · J2 起草[文件级粗扫] → 待 NWT 穷尽性核对 + J1 外部可达性核 → 迁移批落码时逐条精判随 diff 审）
> **判据来源**：M0c-1 设计稿 v0.3 §4.0 三类分类表（`b02fd31a`）——(a) 实 internal=非请求触发 → `origin='internal'`；(b) 挂共享 ingest secret 服务外部 app 请求 → `origin='legacy-app-unprotected'`（禁静默标 internal）；(c) 经能力网关 → `'app'`。
> **本稿性质与局限（诚实标注）**：文件级 grep 粗扫（`verifyIngestRequest` 出现在文件 ≠ 每个 route 都挂；触发上下文按目录/代码形态粗判）。**route 级逐条精判在迁移批做**，本稿供 NWT 穷尽性核对（"第三类是否穷尽"）与 J1 可达性核，不作最终判定。

## 0. 总量

文件级 grep：**37 文件、约 130 个调用点**（含少量注释/定义行，精确数迁移批清点）。api/ 12 文件 50 处 / services/ 20 文件 ~70 处 / lib/ 4 文件 ~10 处 / db/migrate.js。

## 1. 🔴 特殊高亮（迁移批最先处理）

| 位置 | 内容 | 定性 |
|---|---|---|
| `api/relay.js:1726/:1734` | `POST /api/relay/:id/send-command` — **零鉴权裸透传端点**（NWT 实读更正 + J2 route 级复核：本稿初版写"挂共享 secret"错——那是文件级 grep 误判，relay.js 全文件仅 `/api/relay/import-privkey`:119 挂 verifyIngestRequest preHandler，此 route **零门**）：`request.body` 整体直发任意命令类型（含全部钱路命令），任意本机进程可发（不限持 secret 的场景A app） | §2.1"不暴露裸透传端点"存量**最严重**反例，比 (b) 类更糟（零门 vs 持 secret）。**绝不标 internal**（标了=整个 gate 被单端点旁路）；也无法简单标 app+envelope（转发任意 body 无有效 envelope=端点废掉）。**收敛路径见下方**。紧迫度按 NWT 校准：当前 localhost-only 双证非公网火警，但属"Console 一旦暴露即全 money-path 沦陷"单点 |

**relay.js:1726 收敛路径（KANet-UI 分桶取证 + NWT 红队 + J2[设计 owner]，2026-07-23）**：

消费方全景（KANet-UI 分桶查、无截断——含一笔 head 截断致"零生产依赖"假象的自纠，同 ws-proxy/limit=8 族第 N 次；NWT 独立 background grep 坐实同结论、并更正自己"白名单收窄到只读"的未查猜测）：
- **① 生产内部 daemon 走 self-HTTP-fetch**：`bshard-settle-daemon.mjs:86` relayPost（结算，**J2 域** settler）+ `prediction-agent-mind.mjs:385`（下注付款 transfer→side P2SH）——发钱路命令。
- **② operator scratch 脚本**（十几~21 个：nwt-reverify/qi37q_*/run_bh01w/_j2_3o6cs_* 等），**发 money-path 命令**（sign_input_for_settle 等，人工 covenant/结算实需）+ 部分非钱路（handshake 等）。
- **∴ 既不能纯删**（生产 daemon + operator 都在用）**也不能白名单砍到只读**（会断人工结算，NWT 更正）。

**收敛方案（三方收敛，最终形态迁移批 NWT 主导 diff 核定）**：
- **(a) 生产 daemon → 直接 import `sendCommandAsync` + `origin='internal'`**（消 R-SELF-HTTP-FETCH 反模式 = legacy-refund 死循环那族教训 + 内部命令带对 origin）。**`bshard-settle-daemon.mjs:86` 在 J2 域，J2 落码批 wire**（money-path，走 diff 审+Owner 签发）；`prediction-agent-mind.mjs:385` 归属确认后 wire。
- **(b) daemon 迁走后端点不消失**（operator scratch 仍用）→ **零鉴权改 verifyIngestRequest（起步·三方定稿）**：**不砍钱路白名单**（KANet-UI 认账收回"白名单砍钱路"——operator 手动 covenant/结算 sign_input_for_settle/bshard_close_attest 就是经此端点发 money-path=刚需，砍了断人工结算，同 NWT 自纠"只读白名单"一个性质）。**诚实残留（进禁用词表）**：verifyIngestRequest = 那把 11 组件共用共享 secret（M-1 containment 母面），起步堵场景 A 但**非实 operator 隔离**；operator-scoped 身份 = 理想态，排后（R 卡族）。
- **🔴 ② operator scratch 21 脚本的钱路处置（NWT 点名摊开·钱路运维决策·非纯技术选型）**：这 21 脚本发的正是 money-path covenant 命令（sign_input_for_settle/bshard_close_attest/zk_* 等），是**事故时人工结算兜底手段**。两方案：
  - **A：端点彻底非钱路 + operator 钱路另开专道**——端点白名单只留非钱路（覆盖 daemon+UI）+ operator 手动结算迁到 operator-auth 专用 money-path 路径（operator-scoped 身份门，乙路 operator=TCB 放行 money-path）。最干净（宽 HTTP 端点永不转发钱路），代价=新建 operator 专道 + 21 脚本改指向。（NWT 倾向 A）
  - **B：端点加 operator-auth 保留全命令面**——改动最小，但留一个 operator 可发钱路的 passthrough。
  - **红线（不管选哪个）**：不许静默砍 operator 手动结算能力（事故兜底，砍了必须有替代）。
  - **决策归属**：operator 手动结算路径存废 = **钱路运维决策，升 Bettor/Owner 知情拍**（NWT 明确非纯技术选型，J2 不自拍），本卡忠实记 tension + A/B，选定后回写。
- **时序统一 note-A**：relay.js:1726 收敛（daemon 并入 (a) 类迁移 + 端点 (b) 加鉴权 + ② A/B 定后 operator 路径处置）= gate arming 硬前置。涉 money-path 面按 D-011 内部审链，NWT 落码 diff 核。
- **时序（NWT 红队判定，2026-07-23）**：①**不做独立紧急热修**（双证不 live 远程暴露，走乙 localhost=TCB 内无活跃远程利用路径）；②**绝不能拖到 gate 装载后**（零鉴权任意命令透传原样留着=gate 装了也被这单端点整体旁路发任意命令绕 authorizeCommand）→ **gate-arming 硬前置 checklist 项**（"未收敛裸透传存在=gate 不 armed"，KANet-UI 已钉），"迁移批优先"= gate 开之前、非迁移批内部随意排序。
- **收敛后决定性残留核（NWT 必答，迁移批）**：daemon 迁走后**还有没有外部/UI 调这个 HTTP 端点**？有 → 加 auth（不能只靠迁 daemon）；无 → operator-only 化/删。NWT 落码 diff 核收敛改动（daemon 迁移 + 端点 auth/白名单/删三选一按残留定）。
| `api/relay.js:494/:504` | `POST /api/relay/:id/transfer` 提币端点（`type:'transfer'`） | **route 级核实=同样零鉴权**（无 preHandler）——归零鉴权钱路端点族（同 :1726 处置方向），非 (b)（无 secret 概念）非本地面板观察卡级（它是任意 relay 提币，面宽于面板） |

## 2. (b) 类候选 — api/ 挂共享 secret（文件级），外部可达性待 J1 逐 route 核

| 文件 | 调用数 | tg-facing | 初判 |
|---|---|---|---|
**J1 逐 route 可达性核完成（2026-07-23，六文件收工）——判定逐条落定：**

| 文件 | 调用数 | J1 判定 |
|---|---|---|
| `api/pool.js` | 19（:288 ecdsa_sign 坐实、:1617/:1814 sweep、:487 submit） | **(b) 坐实族**（tg-facing + verifyIngestRequest 守） |
| `api/tg-wallet.js` | 1（:125 custodial） | **(b) 坐实族**（NWT 点名同暴露模型） |
| `api/chat.js` | 3（send_broadcast/faucet） | (b) 候选（tg-facing，逐 route 门待迁移批确认） |
| `api/admin.js` | 1（:27 handshake） | **(b) 低风险**：唯一调用是 handshake（**非钱路**），在 verifyIngestRequest 守的路由（:18-27），门对 |
| `api/discovery.js` | 1（:388 handshake） | **(b)**：scoped 全局 hook（:185-189，只对 `/api/discovery` 非 scanner/list/activity 非 GET 生效）覆盖 :388 调用，门生效；scanner/list/activity 注释"UI local only"但**不发 sendCommandAsync**（标注 hook 范围，不影响判定） |
| `api/escrow.js` | 3（:59/:108/:138 create/lock/execute） | **(b) 干净**：三处全在显式挂 verifyIngestRequest 的 AUTH-gated 路由内 |
| `api/oracle-pool.js` | 6 | 🔶 **性质特殊，单独立卡（不进本次三分类）**：`/withdraw`(:303)/`/enroll`/`/timeout-unlock` HTTP 层零 verifyIngestRequest，但安全边界设计在**下游签名验证层**（`_broadcastOracleStakeWithdraw` 验签名者 pk==staker_pk_x，protocol-level auth 替代 HTTP-level）——**J1 未 verify 该层校验代码是否严实**（真校验=安全；没校验=真洞）。是"HTTP 无门+协议层门没查清"问题，非"origin 标错"，性质不同，深查卡另立 |
| `api/trading.js` | 2+（:2326/:2470/:2488/:2574） | 🔴 **J1 新发现·真实不一致**：verifyIngestRequest 只在 :2153（mm-orders 创建）+:2690 两处内联，但 `/api/trade/mm-orders/:id/action`（:2221 起，含四处 sendCommandAsync 含 handshake）**本身无 verifyIngestRequest**——同组端点"创建有门/对订单 action 没门"，进 (b) 类高危清单（连同 relay.js:1726，非本地面板可缓那类） |

**双人 grep 口径差（如实标注，迁移批清点为准）**：NWT 独立穷尽核 = 同 9 文件 **~53 处**；本稿文件级过滤后 = 38 处。差异来自过滤规则（import/注释行、跨行调用形态、helper 内共用 call）——**9 文件集合双方一致（穷尽性对上），处数以迁移批逐 call-site 清点为准**，两人数字先各自保留不硬拍。
**NWT scope note（三核 #4，进本清单约束）**：①(b) 候选覆盖必须全 9 文件，不停在 pool.js/tg-wallet 两例；②"挂 verifyIngestRequest"是 (b) 的**必要非充分**条件——每处逐 call-site 判"是否实由外部 app 请求触发"（route+daemon 共用 helper 非纯请求触发，随 §4 调用链透传规则处理）。

## 3. 本地面板/自有门控族（文件级零 ingest-secret 的 HTTP 路由）— 独立观察卡，不塞本分类

| 文件 | 调用数 | 备注 |
|---|---|---|
| `api/bettor.js` | 6（:1415/:1600 transfer escrow） | J1 已定性：零鉴权本地面板（交易推荐 domain，撞名纯巧合）；KANet-UI 已查证部署=仅绑 127.0.0.1 无反代对外，非 live 洞。观察卡（纵深防御）非紧迫 |
| `api/relay.js:494` `/:id/transfer` | 1 | **J1 route 级判定=本地面板族**（并入观察卡，非 (b)）：零 preHandler，紧邻 :514 `/relays/:id/mnemonic`（注释"local UI only"揭示 mnemonic）=同路由簇强上下文信号；单一固定语义 transfer+零鉴权，风险比 :1726（任意命令）低一档，并入零鉴权本地面板观察卡，不单独收敛卡 |
| `api/exchange.js` | 5 | 同暴露模型候选（exchange UI 后端），观察卡随 bettor.js 一起 |
| `api/coord-status.js` | 1（:29 ecdsa_sign） | D-010 签名端点，自有门控（ADMIN_SECRET+IP allowlist+默认 OFF），单列核 |

**观察卡范围**（J1 标 + NWT 加急被 KANet-UI 查证降级 + trustProxy 旁证）：零鉴权本地面板端点纵深防御 + `index.js:122` trustProxy 反代暴露形态盘点。独立卡，不阻塞 M0c-1。

## 4. (a) 实 internal 候选 — 非请求触发（daemon tick/watcher/cron/worker/传输层）

- **services/ 20 文件 ~70 处**：pool-market-settler(9) / bettor-prediction-settler(9) / bettor-prediction-voter(12) / bshard-close-voter(9) / trade-protocol-filter(6) / broker 族(9) / exchange-machine(3) / market-seeder(1) / oracle-pool-renewal-cron(3) / prediction-params-cache(3) / relay-chain-reader(3) / retail-dex-pusher(1) / settler-router(2) / utxo-splitter(1) / zk-prove-worker(2) / bettor-refund-claim-auto(1) 等——初判全 (a)。
- **lib/ 4 文件**：broadcaster-utxo / bshard-close-transport(6) / mining-utxo-consolidate / pool-broadcast——被 daemon/settler 调用，初判 (a)。
- **注意两点**：① `relay-manager.js:345`（transferFromRelay 工具函数）等**被谁调用决定性质**——工具函数不自标 origin，origin 由最外层调用方传入（设计稿 §4.0 落码细则待补这句：origin 参数沿调用链透传，不在工具层硬编码）；② services 中若有函数**同时被 HTTP route 调用**（如 pool.js:1968 relayCall 传给 zk worker），迁移批逐条查调用链定 origin 传递路径。

## 5. 独立立卡（本次分类之外，J1 核衍生，不塞 origin 三分类）

- **oracle-pool.js 协议层认证深查卡**：`/withdraw` 等 HTTP 层无门、安全边界在下游签名验证层（`_broadcastOracleStakeWithdraw` 验签名者 pk==staker_pk_x）——须 verify 该层校验代码是否严实。真校验=安全 / 没校验=真洞（喂别人 staker_pk_x + 自己 signing_relay_id 广播他人 withdraw，下游签名大概率对不上但深度未查）。**性质=协议层 auth 完整性核，非 origin 分类**。
- **零鉴权本地面板观察卡**（纵深防御，Bettor 排期，非紧迫）：bettor.js(6) + exchange.js(5) + relay.js:494 transfer + trustProxy 反代暴露形态盘点（index.js:122）。双证当前 localhost-only 不 live 暴露。
- **trading.js mm-orders/:id/action 鉴权不一致**：进 (b) 高危清单（§2 表已录），迁移批处理。

## 6. 待办

- [ ] NWT：§2 (b) 候选穷尽性二核（J1 核后名单：pool/tg-wallet/chat/admin/discovery/escrow/trading 挂门族 + relay.js:1726/trading action 零门高危 + oracle-pool 单立卡 + relay.js:494 移观察卡）。
- [x] J1：逐 route 可达性核完成（六文件收工，判定已录 §2/§3/§5）。
- [ ] J2：设计稿 §4.0 已补 origin 透传 + 两层守护 + 机械盲区（v0.3.1/v0.3.2），落码批清点精确处数。
- [ ] relay.js:1726 收敛卡：KANet-UI 运维域记（gate arming 前置，取证中——注意 head 截断致"零生产依赖"假象，KANet-UI 已自纠，消费方含 services/ 生产调用）。
