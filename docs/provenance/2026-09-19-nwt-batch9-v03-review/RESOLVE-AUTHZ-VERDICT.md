# `/resolve` 鉴权三层（allowlist + `ADMIN_SECRET_SETTLEMENT` + write-once）在"IP allowlist 只作叠加层"前提下够不够 —— NWT verdict

2026-09-19。回应账本 (1530) 转给我的判断。输入：账本 (1528)(1530)；J2 v0.3（`0194326d`）§2 P2 / §13 9-3；我死机前的 S3b 增补（`52072a09`）；现源码 `admin-secret-tier.mjs`、`health.js` runtime-identity、`index.js`（`trustProxy:'127.0.0.1'`、无 CORS 插件）；今晚部署后核里对 :3202 监听的实测（仅 127.0.0.1）。D-021：无真实地址 / 密钥值。

## Verdict：**够——前提是把 allowlist 当成 0 分，并满足下面 6 条必须项（R1–R6）**

"三层"里真正承重的是**专档密钥的保密性 + write-once 的原子性 + `confirm` 回显**；allowlist 不给分。理由不是它没用，而是 console 只绑回环（今晚实测 `:3202` 恰 1 个 Listen、`127.0.0.1`），它挡得住的"非回环源"本来就进不来，而它挡不住的（本机任何进程、`ssh -L`、本机代理）恰恰是所有满足 allowlist 的源。评估强度时它不该进分母。

`/resolve` 的资产意义：它写的 `winning_side` 是 close_commit 五个委员槽**自动签名**的输入（`proto-settlement-inputs.mjs:27-52`），写错 = 不可撤销的错误结算。所以这条路由的风险不在"泄露"，在"被不该写的人写 / 被写错"。

## 威胁模型（每类攻击者被什么挡住）

| 攻击者 | 能做什么 | 被什么挡住 | 剩余 |
|---|---|---|---|
| 网络远端 | 无（不可达 :3202） | 只绑回环（实测）；KANet-UI (1530) 核过无本机反代 | 保留①：`sshd` 允许转发 → 见下"接受的剩余风险" |
| 本机非特权进程（含 session 0 里读不到命令行的 python / llama / litellm 等 0.0.0.0 服务被当作 SSRF 跳板） | 向 :3202 发任意 HTTP | **专档密钥**：拿不到值就是 403。SSRF 跳板能转发请求头也没用，值它不知道 | 密钥不得出现在命令行 / 日志 / 响应（R5、R6） |
| 本机同用户进程 | 读 console 进程环境 / DB / 密钥信封 | 不在本层威胁模型内（它本来就能读 relay 私钥信封，`/resolve` 不是它的最短路径） | 已接受 |
| 浏览器页面（CSRF / DNS rebinding） | 借运维者浏览器向回环发请求 | 自定义头 `x-kanet-admin-secret` ⇒ 跨源触发 preflight，console **无 CORS 插件**（`src/` 与 `package.json` grep `@fastify/cors|access-control-allow` 零命中）⇒ preflight 无 `Access-Control-Allow-*` ⇒ 浏览器拦；rebinding 由 **Host 回环字面量校验**（R1）挡 | 无 |
| 运维者手误（选错 outcome / 选错市场） | 写错不可撤销 | `confirm:"<market_id>:<outcome>"` 回显 + write-once（错了也改不了，所以回显是唯一一次机会） | 见 R4 的 dry-run 建议 |
| 已认证 SSH 用户 `-L` 转发 | 请求在 console 看来与本机 shell 无异（回环、无 XFF） | 无——**已接受的剩余风险**（已认证 SSH 用户本身是授权主体，且目前只有 J1 一人） | 可选加固见文末 |

## 必须项（落 9-3 前写进设计 / 落码时必须有测试）

**R1 —— `/resolve` 的规范文本收成一处**（即 S11）。v0.3 里现在有三处不一致：§2 P2 的"⇒ 以 runtime-identity 为模板：`ADMIN_IP_ALLOWLIST`，同时核 `request.ip` 与 `socket.remoteAddress`"（L52 附近）、§13 9-3 行的同一句、以及 L50 的 S3b 判定（"只用 `socket.remoteAddress`、拒 XFF/Forwarded/Via、校验 Host"）。照第一种实现的人会漏掉后两条。规范（一处，其余引用它）：
1. **拒绝**任何带 `X-Forwarded-For` / `Forwarded` / `Via` / `X-Real-IP` 头的请求（这条路由只被运维者从本机 shell 直连，没有合法的代理跳）；
2. `request.socket.remoteAddress ∈ {127.0.0.1, ::1, ::ffff:127.0.0.1}`——**固定字面量集合，不读 `ADMIN_IP_ALLOWLIST`**（若复用 env，启动时必须断言其只含回环字面量，否则运维者一次"临时加个 IP"就把 R1 掏空；直接写死更简单）；
3. `Host` 头必须是回环字面量 + 本进程端口（`127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`），缺失 / 域名 / 他人 IP / 无端口一律拒；
4. `checkAdminSecretTier(request,'ADMIN_SECRET_SETTLEMENT')`（专档，见 R2/R3）；
5. write-once（R4）+ `confirm` 校验。
校验顺序：1→2→3→4→5，前三条失败**不回显**任何关于密钥的信息（统一 403，日志记原因）。这一档用**路由级 preHandler**，不用全局钩子（`index.js` 现有全局 `preHandler` 是 UTF-8 校验，别混进来）。

**R2 —— `ADMIN_SECRET_SETTLEMENT` 的值必须与其他档不同（tier 隔离是值的性质，不是名字的性质）**。verify-value-source：`checkAdminSecretTier` 只按 env **名**区分档；运维者若图省事把 `ADMIN_SECRET_FUNDS`（主网 env 里已设）和新档设成同值，"拿 FUNDS 打 `/resolve` 必 403"在代码测试里绿、在生产里恒为 200。要求：console 启动时对所有已设的 `ADMIN_SECRET_*` 做**两两 SHA-256 摘要比较**（不打印值、不打印摘要），撞值 ⇒ LOUD 日志 + `/resolve` 保持 503（`disabled`），直到修正。这条是新增的，v0.3 没有。

**R3 —— 常数时间比较，且不泄露长度**。现 `provided !== secret`（`admin-secret-tier.mjs:36`）。这一档决定资金走向，且攻击者可能是本机进程（能做纳秒级计时的那类）。要求：对两边先取 SHA-256 再 `crypto.timingSafeEqual`（定长，自然规避"长度不等时 `timingSafeEqual` 抛错"与长度泄露）；`provided` 非 string（重复头 / 数组）一律拒。我倾向**改 helper 本身**（对所有档受益），条件：验证 503（env 未设）/ 403（缺 / 错）语义与 `src/api/t-loopback-authz-funds-hotfix.test.mjs` 现有全部用例逐一不变——若改 helper，9-3 diff 里要单列一个 commit 并附该文件的跑分。值本身：≥32 字节随机（hex 64），启动检查长度 <32 ⇒ 该档保持 503 + LOUD。

**R4 —— write-once 是单事务原子块**。`UPDATE proto_markets SET winning_side=? WHERE id=? AND winning_side IS NULL AND status='sealed'` + 断言 `changes===1`；"seal 意图已 `landed`" 的检查与该 UPDATE 放在**同一个同步 `db.transaction` 块、之间无 `await`**（否则检查通过与写入之间有窗口）。并发测试：`Promise.all` 两个不同 outcome ⇒ 恰一个 200、另一个 409。**验证"写入路径唯一"**（verify-value-source 的枚举纪律）：加源码扫描测试，断言 `src/` 下对 `winning_side` 的 `UPDATE`/`INSERT` 赋值**恰好一处**（今天为零处——`git grep` `0194326d` 只有读取与建表；9-3 之后应恰一处，出现第二处 ⇒ 红）。可选（Bettor 裁，需迁移）：SQLite 触发器 `BEFORE UPDATE OF winning_side … WHEN OLD.winning_side IS NOT NULL` ⇒ `RAISE(ABORT)` 把 write-once 从"约定"变成"结构"；我不作为 MUST，因为有了单写入点 + 原子 UPDATE + 扫描测试已能守住，加触发器要走迁移与人工改库的例外流程。**建议**（不阻塞）：加 `dry-run`（`?dry=1` 或 body `dry:true`）——只返回"将写入 `{market_id, outcome, 派生 payouts, committeeMode}`"而不写，让运维者在不可撤销写入前看到 close_commit 会据此签什么；这对"手误"一类风险是唯一的缓冲。

**R5 —— 审计与失败信号**。成功 / 失败（403 / 409 / 400）都写 `events`：时间、市场 id、outcome、`socket.remoteAddress`、`User-Agent`、拒绝原因码；**绝不写密钥 / 摘要 / `confirm` 之外的请求头**。403 计数：同一进程内 1 分钟 ≥5 次 ⇒ `error` 级报警（暴力探测信号）；**不做锁定**（锁定本身是运维者自己被锁在外的 DoS 面，且 64 hex 密钥暴力不可行）。

**R6 —— 运维口径**。调用 `/resolve` 的脚本必须从**文件或环境变量**读密钥，**不放命令行参数**（同用户进程读得到命令行）；密钥文件不得在任何 git 工作树内（规则 83：备份 / 导出 / 数据库 / 密钥物不落 git 树）；提交的 runbook 只写"从 `<路径>` 读"，不写值。

## 我试过的攻击

1. **allowlist 被 XFF 绕过**（`trustProxy:'127.0.0.1'` 下直连回环时 `request.ip` 改读 XFF）→ 用 R1-1/2 堵（拒 XFF + 只信 `socket.remoteAddress`）。成立，已收进规范。
2. **DNS rebinding / 保留原 Host 的转发** → R1-3 堵。
3. **同值复用密钥**（R2）→ 打穿现有设计（v0.3 只有名字隔离），新增 R2。
4. **timing 泄露**（本机计时）→ 现 `!==` 理论上有泄露；网络抖动使实际可利用性很低，但改动成本几乎为零，列 R3。
5. **write-once 的 TOCTOU**（先 SELECT 检查 seal landed、再 UPDATE）→ R4 单块。
6. **第二个写入者**（别的路径也能写 `winning_side`）→ 今天零写入者；R4 扫描测试把"恰一处"固化。
7. **CSRF**（浏览器 POST）→ 自定义头 + 无 CORS ⇒ preflight 拦；未实测浏览器，属机制推理，如实标注。
8. **未打穿**：远端网络直达（不可达，实测）；SSRF 跳板无密钥（403）；SSRF 跳板有密钥值（等价于泄密，不在本层）。

## 接受的剩余风险与可选加固
- `ssh -L`（已认证 SSH 用户）：接受。**可选加固**（J1 / Owner 的运维决策，我不主张也不执行，需提权改 `sshd_config`）：若 J1 的工作流不用端口转发，`AllowTcpForwarding no` 或 `PermitOpen` 限定即可关掉这条口子；改前先问 J1 是否用 `-L`。
- 四个 0.0.0.0 监听的服务命令行读不到（(1530) 保留②）：不需要为 `/resolve` 单独排除——R1/R2/R3 使"它们是通用代理"也无法在无密钥时得逞。
- 本机同用户进程：接受。

## 没做
- 没写 / 没审代码（9-3 不存在）；没做浏览器实测（第 7 条是推理）；没读 `checkAdminSecretTier` 之外各档的调用点（R2 只要求启动时比对值，不需要读调用点）。
