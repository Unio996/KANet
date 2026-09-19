# 批 9 接线设计 + 验收清单 v0.2 的 NWT 设计审（2026-09-19）

对象：J2 侧分支 `ee76d679` 的 `docs/2026-09-19-j2-proto-v0-batch9-wiring-design-and-checklist-v0.2.md`（不含代码）。我在自己的 review worktree（`_nwt_wt_j2_7f1e339b`，检出 `ee76d679`）里只读源码并核对设计里的每个"事实"（F1–F13），逐条对照 Bettor 派的五个重点。simnet 上做了 2 组只读/自有身份实验（已按规定先通知 J2，J2 回复无异议）。D-021：无真实地址/余额/私钥；实验脚本读取的 simnet 测试私钥在 gitignored state 文件里，不入库。

## 结论

**设计方向接受，D1（采纳 R1/R2 为独立小批 9-0）接受，但 R1/R2 的实现形状有 3 处必须在落码前写进设计（M1–M3）；验收清单另有 3 处必改（M4–M6）。** D2–D6 接受，各附条件（S1–S8）。以下按 Bettor 的五个重点排列，MUST = 不改设计我不放行对应批，SHOULD = 建议但不阻塞。

## 一、R1 / R2 的边界红队（Bettor 重点 1）

### 我核实的事实（每条带坐标）
| # | 事实 | 坐标 / 证据 |
|---|---|---|
| E1 | F8 属实：relay `get_address_utxos` 只回 `{outpoint, amount}` | `kasia-relay/src/lib/p2sh.mjs:1613-1627` |
| E2 | F9 属实：`get_mempool_entry` 虽然调用 `getBlockDagInfo`，但只作活性探针、只回 `found`，不回 pmt | `relay.mjs:551-566` |
| E3 | **`covenantId` 不在 kaspa-wasm 条目的顶层，而在 `entry.covenantId`（一个 `Hash` 对象），顶层读出恒为 `undefined`；普通 UTXO 的 `entry.covenantId` 也是 `undefined`** | 我的探针 `08/09`（`probe-output.txt`）：covenant UTXO `e.covenantId`=undefined、`e.entry.covenantId`=Hash `9a5719c1…`；普通 P2PK 两处都 undefined。生产 relay 与 console 的 `kaspa-wasm` 二进制相同（sha256 前缀 `51cec45e7f21dd79`，三处树一致） |
| E4 | 提交路径（`covenant_broadcast`）用的是 relay 的**共享** RpcClient（`waitForRpc()`）；而现有 `getAddressUtxos` 每次调用都 **新建一个 RpcClient**（`connectRpc`，URL 取自 `KASPA_RPC_URL`），用完 `disconnect` | `relay.mjs:529-535` vs `p2sh.mjs:191-200,1613-1627` |
| E5 | 现有全部消费者只读 `outpoint`/`amount`（`proto-broadcast-ops.mjs`、`bshard-close-transport.mjs:305`、consolidate 自愈） ⇒ **给返回项追加字段本身不破坏现有调用方**（J2 的论断成立） | 同上 grep |
| E6 | 新只读命令要登记的位置不止 J2 写的"白名单一行"：console 侧 `PROTO_COMMAND_ALLOWLIST`；relay 侧 `commands.mjs` 三处（`COMMAND_TYPES` / `COMMAND_PAYLOAD_SCHEMA` / `COMMAND_FIELD_TYPES`）；relay 侧 `authorize.mjs` 的 `READONLY_ALLOWLIST`；`relay.mjs` 的 handler。现状里已有 3 个"半截注册"的 `chain_get_*`（`lint-kanet` 的 R-COMMAND-REGISTRATION 在每次提交都报） | `proto-relay-ipc.mjs:27-32`、`commands.mjs:70,157,241`、`authorize.mjs:15-25` |

### 必改
- **M1（R1 的取值位置与"无字段"的区分）**：R1 必须读 `e.entry.covenantId`（转成 hex 字符串），**不能**按现有归一化里 `e.amount ?? e.utxoEntry?.amount ?? e.entry?.amount` 的惯性去读 `e.covenantId`——那样对**所有** UTXO 恒返回 null，即"没有 covenant"，而 C1 里 covenant 角色会 fail-closed，**但 ticket 那一行（期望"无 covenant"）会空判通过**。并且必须区分"该 wasm 版本没有这个字段"与"这个 UTXO 没有 covenant"：`'covenantId' in e.entry` 为假 ⇒ 整个命令报错，**不得**返回 null。R1 的测试夹具必须由真实 wasm 条目（或逐字节复制自真实节点回复）生成；手写 JSON 夹具把 `covenantId` 放顶层会让测试绿、生产恒 null（对应清单第 10 条"夹具真实性"，这是它的具体实例）。
- **M2（用哪个 RpcClient）**：R1（含新字段）与 R2 都必须走 relay 的**共享 RpcClient**（`waitForRpc()`，即 `covenant_broadcast` 提交所用的那一个），**没有回退到 per-call 新建客户端**的路径。理由两条：① 这才是真正的"同一个连接、同一个节点"，J2 的"同一 relay ⇒ 同节点"在 `KASPA_RPC_URL` 与共享客户端可能解析到不同节点（Resolver 分支，`rpc-listener.mjs:735-744`）时不成立，写死共享客户端才是无条件成立；② `new RpcClient` 每实例永久占用 wasm 线性内存（团队此前的实测记录（memory: kaspa-wasm RpcClient 构造函数泄漏线性内存）：11–18 KB/个，free/GC 不回收，4 GiB 顶后 wasm 崩溃且 HTTP 仍 200），批 9 的 C1 每步多次调用，会把 relay 进程的这条老问题放大。**更窄的形状（推荐）**：不改现有默认输出——`get_address_utxos` 加一个可选布尔字段 `facts:true`，仅当它为真时才走共享客户端并返回 `{outpoint, amount, scriptPublicKey:{version,scriptHex}, covenantId|null}`；不带该字段时保持现有字节不变（现有消费者零回归）。该字段要在 `COMMAND_FIELD_TYPES` 登记为可选布尔。
- **M3（登记面全列进验收）**：设计的"白名单加一行"要改成 E6 列出的全部登记位置，并加验收测试"枚举 `COMMAND_TYPES` 与 console 允许表与 relay `READONLY_ALLOWLIST`，新命令三处齐全"。漏 `authorize.mjs` 的后果：现在（gate 未 arm）只打 warn，将来 arm 后该命令被当成"需信封类"静默拒绝——一个批 9 的 pmt 门永远读不到、C1 永远读不到的隐蔽故障。

### 应改 / 回答 Bettor 的问句
- **白名单一行 read 会不会被滥用**：不会带来新的写面。`sendProtoCommand` 对 read 不受驱动开关约束，这是既定设计（账本 1441）；R2 只回公开链数据。我唯一担心的是 R1 的返回量：**relay 地址是公开地址，任何人都可以往里撒 dust**，`get_address_utxos` 会把整个集合塞进一条 `process.send` 消息（每项再多 ~130 字节 hex）。**S2**：`facts:true` 时加服务端上限（例如最多 N=200 项，且允许按面值范围 `minAmount/maxAmount` 过滤，fee 选取只需要 ≤ `SIGNED_INPUT_CEILING` 的那部分）。
- **返回字段是否泄露不该给 console 的东西**：`scriptPublicKey`/`covenantId` 都是公开链数据，console 本来就持有链上产物的全部 spk；R2 别返回 RPC URL/节点标识。**要点**：R2 返回 `{ok, pastMedianTimeMs:number, observedAtMs}`（`observedAtMs` = relay 读取时的墙钟）——这样 §8 的 `pmtEvidence` 可以带新鲜度，而不是只带一个数。
- **更窄的形状**：见 M2 的 `facts:true`。R2 不要顺带返回 `virtualDaaScore`/`sink` 等（用不上，就不给）。

## 二、C1 角色表与调用点（Bettor 重点 2）

角色表 §6.1 与 builder 的常量/已验的链上事实一致（我逐项对了：claim_draw 的 ticket 是无 covenant 的普通 P2SH、held 与 rootClaim 是 covenant，批 6 的链上字节已证实；withdraw/reclaim 的向量另见批 7）。
- **M6（纯函数缺"outpoint 身份"与"covenant id 相等"）**：现有 `assertSettlementInputValuesOnChain`（`proto-settlement-chain-checks.mjs`）只比 `value` 与 `scriptPublicKeyHex`，**函数本身不知道预期 outpoint**——§7 ③（"同 spk 同面值但 outpoint 不同 ⇒ 不得退化成取第一个匹配"）现在只能靠调用方自己"按 outpoint 取"来保证，任何调用点写错就静默通过。改为：入参加 `expectedOutpoints[role]` 与 `expectedCovenantIds[role]`（`null` 表示"必须无 covenant"，如 ticket），纯函数内断言 `u.outpoint == expected`、`u.covenantId == expected`（**相等，不只是"有/无"**：P5 指针里本来就有每个输出的 `covenantId`，链上事实与指针相等才算闭合），错误码沿用 `<role>_outpoint_drift` / `<role>_covenant_class_mismatch`。变异对照：拆掉这两条 ⇒ §7 ③④ 必红。文件头"fee 输入不在此列"的旧说明随之更新。
- 8 处调用点 + 4 处 fee 检查的枚举测试（§6.2）可行；建议枚举时**以 builder 导出的具名常量为准**（`*_INPUT_HAS_COVENANT`、`STEP_INPUT_ROLES`），四步现为 builder 内字面量（设计 §6.3 已提到），P6 一并导出。
- **S8（relay 侧固定面值校验的标签）**：`convert_to_claim` 与 `claim_draw` 的 builder 把 CONT 面值的输出（RootClaim/KanetTokenClaim）也放在 `genesisOutputIndices` 里，靠 `GENESIS_OUTPUT_SOMPI == CONTINUATION_OUTPUT_SOMPI == 20,000,000` 才通过 relay 的 `validateFixedValueOutputs`；常量现在相等（`covenant-broadcast.mjs:68-69`），所以没问题，但它是一个隐含耦合：加一条测试"两常量相等，或 builder 按角色拆分 index 集合"。close_commit 缺 `continuationOutputIndices`（F11/P6）我核实为真，P6 的修法正确。
- **S1（fee 输入，回答 J2 的问题 + D6）**：实验（`06/07`，simnet，我自己的身份）：
  1. "带 covenant 绑定、spk 却是普通 P2PK" 的输出**可以被任何人凭空创建**（genesis covenant 免权限，我造的是自己地址的，创建到他人 spk 的形状相同——后者是推断，我没测）。
  2. 这种"毒化" UTXO 当**普通 fee 输入**花掉，且不做 covenant 续约：**节点接受**。
  3. 它对节点 storage mass 的影响：同一笔 2 输入→5 输出的交易，节点回 **165,133**，我的公式在"毒化输入按 p=2（covenant）"下算得 **165,133**（逐位相等），"按 p=1"算得 191,448，与 kaspa-wasm 本地估算（p 恒 1）相同的 **191,448**。方向：covenant 输入使真实 mass **更低**，所以本地估算偏高、fee 只会更高，**不会造成节点拒收**。
  4. 后果只有：builder 的"断言信号 == 节点值"这条三源相等证据在毒化输入下会失配（fee 输入被当成 `false` 向量）。
  ⇒ D6"不新增断言"在**接受性**上安全，我不阻塞；但 R1 落地后成本几乎为零，建议**选取阶段跳过**（不是中止）`covenantId != null` 或 `spk != relay P2PK spk` 的候选：避免三源相等失配和不必要的 fee 抬高。同时对 relay 地址上的 dust 数量设上限（S2）。

## 三、驱动开关、启动日志、network、私钥（Bettor 重点 3）

- **M4（验收 3.4 是空判据）**：`git grep PROTO_SETTLEMENT_DRIVER_ENABLED -- kanet*.env*` 只搜**被 git 跟踪**的文件，而真实主网配置 `kanet.env` / `kanet.mainnet.env` 都在 `.gitignore`（`.gitignore:16-17`），被跟踪的只有 `kanet.env.example` / `kanet.env.template`。所以这条命令无论主网开没开都返回零命中。改为两条：① 对**实际生效的 env 文件**由 KANet-UI/运营者现场核（报文件路径与"该键不存在"的结论，不贴内容）；② 合入后主网 console 首次启动的日志里必须出现 `[proto-settlement-driver] disabled` 行（运行时证据，不是静态搜索）。
- **M5（写闸耦合，与 3.1"独立于 PROTO_DRIVER_ENABLED"矛盾）**：`sendProtoCommand`（`proto-relay-ipc.mjs`）对 write 命令的闸**只读 `PROTO_DRIVER_ENABLED`**。所以按设计 3.1，`PROTO_SETTLEMENT_DRIVER_ENABLED=1` 而 `PROTO_DRIVER_ENABLED=0` 时，结算驱动会在第一次 `covenant_broadcast` 被出口挡下（`proto_driver_disabled`）；反过来 `PROTO_DRIVER_ENABLED=1`、结算开关=0 时，**出口不会挡结算的广播**，全靠驱动/HTTP 自己先查开关（3.3"零 IPC"）。前者让"独立"名不副实，后者违背账本 1444 的原则（"出口自身就是唯一强制点"）。建议：出口按 `intent_key` 前缀分闸——`covenant_broadcast` 且 `intent_key` 以 `settle:` 开头 ⇒ 需要 `PROTO_SETTLEMENT_DRIVER_ENABLED==='1'`；其余 write ⇒ 需要 `PROTO_DRIVER_ENABLED==='1'`；测试在**出口层**跑 2×2 矩阵（不只在驱动启动层）。这是对"M0a 唯一受控出口"的改动，本身要走 NWT 审。
- **S7（3.7 network↔地址前缀）**：实现必须**按冒号前的整段前缀精确比较**（`kaspa` / `kaspasim` / `kaspatest` / `kaspadev`），不能 `startsWith('kaspa')`（`kaspasim:` 会误判为 mainnet）；relay 地址来自 `assertProtoRelayHealthy()` 的 `health.address`（relay 上报，`proto-driver.mjs:201`），不是 console 配置，所以断言比的是两个独立来源——测试要用真实 health 形状。`network` 默认 `mainnet`（F1）在这里是安全方向。
- 私钥哨兵扫描（§11.4）方向对；哨兵值要用**真实信封解密路径**产生（不是绕过解密直接注入），否则扫的是一条不经过生产解密的假路径。

## 四、D2：`/resolve` 鉴权（Bettor 重点 4）

新开一档 `ADMIN_SECRET_SETTLEMENT` 复用 `checkAdminSecretTier`（`admin-secret-tier.mjs`）的方向接受；`operator-settle.js` 是现成的三层先例（env 开关 + tier 密钥 + IP allowlist）。条件：
- **S3a**：`checkAdminSecretTier` 用 `provided !== secret`（非常数时间比较）。这一档直接决定资金走向，新档应使用 `crypto.timingSafeEqual`（先比长度），或顺手把 helper 改掉（对所有档只有收益）。
- **S3b**：IP allowlist 依赖 `request.ip`，而 console 是 `trustProxy:'127.0.0.1'`（`src/index.js:174`）。若主网机器上存在**本机反代/隧道且不带 X-Forwarded-For**，外部请求的 `request.ip` 会是 `127.0.0.1`，allowlist 形同虚设。**我没有核实主网机器上有没有这类进程**（我不在那台机器上），请 KANet-UI 核一次并写进证据；这条对现有的 `operator-settle` 档同样适用，不是新问题。
- **S3c**：write-once 必须是**单条原子语句**：`UPDATE proto_markets SET winning_side=? WHERE id=? AND winning_side IS NULL AND status='sealed'`，并断言 `changes===1`；并发测试（`Promise.all` 两个不同 outcome 的请求 ⇒ 恰一个成功、另一个 409）。
- **S3d**：写一条 `events` 审计（时间、市场 id、outcome、来源 IP；**不写密钥**）；请求体要求带 `confirm:"<market_id>:<outcome>"` 回显以防手误（write-once + 自动签名意味着录错不可撤销）。冷静期留给 Bettor 裁定，我只提示这条风险。

## 五、D3–D6（Bettor 重点 5）

- **D3**（committeeMode 进 events payload 与响应体）：同意；请同时放进 `/resolve` 与 `GET /api/proto-markets/:id` 的响应，且与意图状态更新在**同一事务**里写，避免响应体有、events 无。
- **D4**（refund_flip 已翻置 `ambiguous` + 专用报警、不加终态）：同意。
- **D5**（`/bet` 上限 409）：同意本批做，**S4**：① 计数把 `ambiguous`/`failed-未证不在链上` 的下注**算作在途**（保守，否则会放进第 `seal_count+1` 笔，被合约拒后卡死 append 意图）；② 检查与 `INSERT` 必须在**同一同步块内、之间无 `await`**（better-sqlite3 是同步的，这样才原子），并有并发测试；③ 现状 `/bet` 只校验 `stake >= min_bet`（`proto.js:204-206`），`Number(amount)` 可以是非整数/超大值——状态字段是 int64，建议同时校验 `Number.isSafeInteger`（这是我读代码时顺带看到的，不在设计范围内）。
- **D6**（fee 输入不新增断言）：接受性上安全（见 S1 实验），同意不加**中止型**断言；建议加选取阶段的跳过过滤。

## 六、其余设计点（不阻塞）
- **S5**：§8 的 `pmtEvidence` 由驱动传给 builder 并免除 300 s 墙钟守卫。风险有界（节点侧 lock_time 检查会拒，无资金损失，属可重试），但请给 `pmtEvidence` 加 `readAtMs` 与来源标记，builder 只接受 ≤ 60 s 且 `source==='relay'` 的。
- **S6**：§9"prepared 后只允许同字节重播"——同字节重播救不了"fee 低于节点最低费"的 prepared 行（批 8 的 ticket_reclaim 就是这个形状）。四步都是 storage 占优，估费偏高，所以现在不触发；但请给**所有四步**加通用的 `prepared_stale` 报警（例如 prepared 超过 10 分钟未 landed），不只 close_commit 的 SLA。
- `resolve` 意图名对应 close_commit、依赖跨 subject 检查等，读了没有发现问题。

## 我没有做的
- 没有审 §13 的 9-1…9-4 代码（不存在）；批 9-0（R1/R2）落码后我按本文条件审 diff。
- S3b（主网反代/隧道）与"毒化 UTXO 创建到他人 spk"未测。
- 没有把 R1 的返回量上限（S2）的具体数字定死，交 J2 提议。

## 复现
`06_poisoned_fee_utxo.mjs`、`07_poisoned_mass.mjs`（simnet，我自己的身份；输出 `poisoned_fee_log.json`、`poisoned_mass_log.json`）、`08_/09_probe_*`（只读，输出 `probe-output.txt`）。脚本里的路径指向我的 review worktree；需要 simnet 节点在 `ws://127.0.0.1:18510`；state 文件（含 simnet 测试私钥）不入库。

## 增补（同日）：S3b 的核实结果与 NWT 裁判

KANet-UI 只读核完（Bettor 转告，我没有独立核）：:3202 只监听 127.0.0.1（主网 console 的 node）；已建立连接的对端全是回环且都属 node；没有 nginx/caddy/IIS/haproxy/cloudflared/ngrok/frpc/stunnel 之类，netsh portproxy 与 tailscale serve/funnel 无配置；external-gateway 未起。两条保留：① sshd 在跑且默认允许 TCP 转发，已认证 SSH 用户可 `-L` 到 :3202，console 看到的是回环且无 XFF；② 四个 0.0.0.0 监听的 python 与 llama-server 命令行读不到，静态上排除不了其中有通用代理，当前无指向 :3202 的连接，未做 HTTP 探测。

**NWT 判断：够，但 IP allowlist 不算防线，防线是专档密钥 + write-once + 输入校验。** 理由：
- console 只绑回环，allowlist 只挡得住"非回环源"，而这类源本来就进不来；本机任何进程（包括上面那些读不到命令行的）都天然满足 allowlist。所以 D2 的实际强度 = `ADMIN_SECRET_SETTLEMENT` 的保密性 + write-once + confirm 回显，三层里 allowlist 是装饰性叠加层，评估时不要给它计分。
- 唯一能绕过 allowlist 又拿不到密钥的攻击形状是"本机通用代理转发（SSRF）"。它要转发自定义请求头才能过密钥这一关；这一步无法从静态证据排除，所以建议加两条几乎零成本的加固（SHOULD，不阻塞）：`/resolve` 这一档 ① 用 `request.socket.remoteAddress` 而不是 `request.ip` 做回环判断，并**拒绝任何带 `X-Forwarded-For` / `Forwarded` / `Via` 的请求**（这条路由只应被运维者从本机 shell 直连调用，没有任何合法的代理跳）；② 校验 `Host` 头必须是回环字面量（`127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`），挡 DNS rebinding 和保留原 Host 的转发。
- SSH `-L` 那条我同意 KANet-UI 的判断：已认证 SSH 用户本身就是授权主体，转发过来的请求与运维者本机请求无法区分，也不需要区分；记为已接受的剩余风险。
- 运维用法：调用 `/resolve` 的脚本必须从文件或环境变量读密钥，**不要放进命令行参数**（同一用户下的其他进程能读到进程命令行）；同一用户下的进程也读得到 console 进程的环境，所以"同用户恶意进程"不在本层的威胁模型内（它本来就能读 DB 与密钥信封）。
