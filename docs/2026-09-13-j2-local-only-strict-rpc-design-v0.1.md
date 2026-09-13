# `KASPA_RPC_LOCAL_ONLY=1` 严格语义（strict intended-local-only）· 设计 v0.1（不写码）

> **Status**: DRAFT-FOR-REVIEW · v0.1（2026-09-13T10:1xZ `date -u`）· J2 · reviewer **NWT**（负测归 NWT，本稿 §5 列清单）→ Bettor → 🔴 **rpc-health 是钱路闸（G-1/③ 门）与 relay 子进程的 RPC 读数源 ⇒ 落码按钱路标准走 Owner 批**（铁律 0）。
> 派工：Bettor seed `scratch/_bettor_relaunch_seed_2026-09-13.md` §2 J2 (a) + SendMessage 10:0xZ 补充（relay 侧纳入同一信任域）。输入：Codex 复审 `RESPONSE-20260907-MAINNET-PIVOT-PRECONDITIONS-CODEX-REVIEW.md` finding #2（HOLD）· NWT 清单 `docs/2026-09-07-NWT-mainnet-real-money-preconditions-v0.1.md` ①（LOCAL_ONLY 主网 MUST）· ledger (1001)(1004)(1005) · G-2 设计 `docs/2026-09-07-j2-g1-g2-node-trust-gate-and-console-rpc-selfheal-design-v0.1.md` v0.2 §4 · **D-017**（主网节点 = da9 本机官方 v2.0.1）。
> 行号随 HEAD `8f1e107f`（2026-09-13T10:10Z）。本稿只裁"语义是什么、改哪几处、怎么验、怎么回滚"；不落 src、不上链。
> 🔵 **与 NWT 负测规格对齐**（`docs/2026-09-13-nwt-negative-test-spec-local-only-and-network-prefix-v0.1.md` §A，本地 184bf6f5，与本稿并行写成）：A-N2 = 本稿 N1；**A-N3 口径本稿答：strict = 只信 env `KASPA_RPC_URL`，DB 配置的局域网/回环端点同样 ⇒ null（S1/S8，本稿 N2）**；A-N5 = 本稿 N6 对照臂；A-N4 由 S1 不改负缓存/`checkLocal` 保证。本稿 N4/N5/N8 是 NWT 规格之外的增项（写入口拒写 / relay 信任域 / 弱注入臂）。

## 0. 一句话

今天的 `KASPA_RPC_LOCAL_ONLY=1` 只关掉 **Resolver 发现**，没关掉 **DB 配置端点回退**，也管不到 **relay/scout 子进程拿 URL 的那条路（DB 优先于 env）**——所以它的真实语义是"disable discovery"，不是"只信本机"。本稿把它定义成 **strict：唯一可信 RPC = env `KASPA_RPC_URL`；本机不可用 ⇒ `null`（fail-closed），任何配置/发现/硬编码回退在 strict 下一律不走，写配置的入口在 strict 下拒写**，并把 console 读数侧与 relay/scout 子进程拉进**同一个信任域**。回滚 = env 改 `0`（strict 由 env 门控，不是改语义的代码）。

## 1. 事实基线（全部 grep 短语可核，HEAD `8f1e107f`）

| # | 事实 | 出处（grep 短语） |
|---|---|---|
| F1 | `LOCAL_ONLY` 只在 `discoverNode()` 里被读一次；`getWorkingRpc()` 本机失败后**无条件**先跑 `checkConfigured()`，再才到 discovery | `rpc-health.js:27` `const LOCAL_ONLY =`；`:152` `if (LOCAL_ONLY) {`；`:218` `const configured = await checkConfigured();` |
| F2 | `checkConfigured()` 读 DB `rpc_url`，只要 `dataCheck(url,false)` 过（同网 ∧ isSynced）就返回；返回后按私网正则把 `10./172.16-31./192.168./localhost/127.` 判成 `isLocal=true` | `:138-147`；`:222` `const isLan = /^wss?:\/\/(10\.\|172\.…` |
| F3 | **本机此刻这个洞是"未上膛"**：`config_entries` 只有 `rpc_mode`（2026-05-26），**没有 `rpc_url` 行** ⇒ `checkConfigured()` 现返回 `null`。但有 **4 个写入口**随时能把它上膛：UI `POST /settings/node`（写任意 custom/discovered URL）、`applyFix('switch_to_discovered')`（`fixData.url` 调用方可控）、`applyFix('discover_node')`（把 `getWorkingRpc()` 返回的什么都写进去）、`applyFix('switch_to_local')`（写**硬编码** `ws://127.0.0.1:17110`，不是 env 的 `17210`） | `settings.js:27` `await setConfig('rpc_url', url`；`system-repair.js:181/192/200`；`system-repair.js:44` `tcpPing('127.0.0.1', 17110` |
| F4 | **三条完全绕过 rpc-health 的 DB 直读，且 DB 优先于 env**：relay 子进程的 `KASPA_RPC_URL`、scout 子进程、escrow refund 预检 | `relay-manager.js:69` `const rpcUrl = await getConfig('rpc_url') \|\| process.env.KASPA_RPC_URL`；`scanner.js:98` 同形；`escrow.js:153` 同形 |
| F5 | relay 侧自己的 URL 解析：env 优先；env 空 ⇒ 向 console 拉 `/api/config/rpc-url`；再空 ⇒ **Resolver 公网发现**；另一处直接硬编码回退 `ws://127.0.0.1:17210`；utxo-split 另有 `RPC_URL` 别名 | `kasia-relay/src/lib/transaction.mjs:120` `if (process.env.KASPA_RPC_URL) return`；`:125` `/api/config/rpc-url`；`rpc-listener.mjs:735-738` `resolver: new Resolver()`；`relay.mjs:1106` `\|\| 'ws://127.0.0.1:17210'`；`utxo-split.mjs:27` `process.env.RPC_URL` |
| F6 | **③ 门读数已经是 strict 的**：G-2 把门读数改成只读 env 本机 URL、不经 `getWorkingRpc()`；`ibd-tick-gate` 复用它 | `preprune-capture-worker.mjs:134` `门读数【只读本机节点】KASPA_RPC_URL, 不再经 getWorkingRpc()`；`:146` `const url = env.KASPA_RPC_URL` |
| F7 | 但 **16 个业务调用方**仍走 `getWorkingRpc()`（chain-data / oracle-pool ×2 / pool ×4 / relay.js ×2 / settings / tg-wallet / faucet-utxo-health / cross-chain-verify / oracle-pool-chain-scanner-cron / oracle-pool-renewal-cron / scanner / system-repair ×2 / trade-protocol-filter ×2）；其中 **5 处对 `url===null` 无守卫**，直接 `new RpcClient({ url: null, … })` | `grep -rn "await getWorkingRpc()" kasia-console/src`；无守卫：`oracle-pool.js:371/469`、`pool.js:1120`、`oracle-pool-renewal-cron.mjs:125`、`oracle-pool-chain-scanner-cron.mjs:32` |
| F8 | `kanet.env` 对这个开关的注释写的是"共享客户端只用本机节点"——**注释宣称的语义比代码交付的强**（文档漂移，同 CLAUDE.md 通则那族） | `kanet.env:304` `共享客户端只用本机节点·rpc-health 发现列表按网络过滤`；`:305` `KASPA_RPC_LOCAL_ONLY=1` |
| F9 | 现有回归只断言 H6 的日志行，**没有**"strict + 本机失败 + 配置端点健康 ⇒ null"的用例 | `rpc-health-datacheck.test.mjs:66` `discovery disabled \(KASPA_RPC_LOCAL_ONLY=1\)` |
| F10 | D-017：主网节点跑 da9 本机、官方 v2.0.1 原样 ⇒ env 将变成 `KASPA_RPC_URL=ws://127.0.0.1:17110` + `KASPA_NETWORK=mainnet`；届时 F3 那个硬编码 `17110` **碰巧对上**，但它仍是第二个真相源 | `docs/DECISIONS.md` D-017 §2 裁定 9 |

## 2. 为什么它是波 0 前置（威胁形状，四种组合）

"读数源"与"递交源"一旦落在两个信任域，闸就等于没有。今天的代码允许下面四种错位，每一种都在 TN12 真发生过或结构上可发生：

| # | console 读数（getWorkingRpc / ③ 门） | relay 递交（子进程 `KASPA_RPC_URL`） | 后果 | 今天挡得住？ |
|---|---|---|---|---|
| T1 | 本机坏 ⇒ 回退 **DB 配置的同网公网端点**，isSynced=true | 本机（env） | 闸放行，本机落后/IBD 头部相位递交（22:55Z 形状的主网版，NWT 1001 ①） | ❌ F1/F2 |
| T2 | 本机 | DB `rpc_url` = 外部端点（F4：DB 优先） | 闸读本机、**submit 走外部**：mempool 视图分裂，"三源无"（`check_utxo_landed` 本机查不到自己递的 tx） | ❌ F4 |
| T3 | 本机坏 ⇒ 回退公网 mainnet 节点（G-2 前的 22:55Z 事故） | 本机 | G-2 已用 networkId 核挡住 **异网**；**同网**公网仍过 | 部分（G-2） |
| T4 | 本机 | relay env 空 ⇒ 拉 console 配置 ⇒ 空 ⇒ **Resolver 公网** | 主网上 relay 悄悄用公网节点签发递交 | ❌ F5 |

主网上 T1/T2/T4 的公网端点**天然同网且健康**（主网公网节点很多、都 synced），所以 G-2 的 networkId 核在主网上**一个都拦不住**——这就是 Codex #2 说的"trust-domain split the G-2 design is supposed to eliminate"。

## 3. 语义定义

### 3.1 名词

- **intended local RPC** := env `KASPA_RPC_URL`（唯一真相源；`rpc-health.js:19` 已 fail-fast：未设即 throw）。不引入新变量，不用 DB。
- **strict** := `KASPA_RPC_LOCAL_ONLY === '1'`。其它值/未设 = **non-strict = 今天的行为原样**（开发机、外部接入者不受影响）。

### 3.2 strict 下的契约（S1–S8）

| # | 契约 | 落点 |
|---|---|---|
| S1 | `getWorkingRpc()`：本机 `checkLocal()` 过 ⇒ `{url: LOCAL_RPC, isLocal: true}`；不过 ⇒ **直接** `{url: null, isLocal: false}`。**不调用** `checkConfigured()`、**不调用** `discoverNode()`。负缓存 10 s / 本机缓存 5 min 不变 | `rpc-health.js` `getWorkingRpc()` 在"2. 配置的 URL"之前加一个 strict 早退 |
| S2 | **canonical 日志行不变**：`[rpc-health] discovery disabled (KASPA_RPC_LOCAL_ONLY=1): no public fallback, fail-closed` 仍然**逐字**、仍然只打一次——但打点移到 strict 早退处（原来在 `discoverNode()` 里，strict 后永远到不了）。新增一行（一次）：`[rpc-health] strict local-only (KASPA_RPC_LOCAL_ONLY=1): configured fallback skipped` | 记忆 `feedback-new-code-paths-must-emit-the-canonical-log-lines-that-gates-and-monitors-grep`；H6 用例 grep 的是这一行 |
| S3 | "全部失败"的 warn 行与 `events.rpc_health_check_failed` 行：**event_type 不变**（监控按它 grep），summary 文案在 strict 下改为 `本机不可用 (strict local-only: configured/discovery 未尝试; 10 min 限频)`——今天那句"全部候选(local/configured/discover)均不可用"在 strict 下是假话 | `rpc-health.js:251` |
| S4 | **写入口在 strict 下拒写**：`POST /settings/node` 的 `mode ∈ {custom, discovered, public}` ⇒ 409 `{error:'strict-local-only'}`；`applyFix('switch_to_discovered')` / `applyFix('discover_node')` ⇒ `{ok:false, message:'strict local-only: 不允许切到非本机端点'}`；`applyFix('switch_to_local')` 与 `mode=local` 允许，但写入的值必须是 **env `KASPA_RPC_URL`**，不再是硬编码 `ws://127.0.0.1:17110`；`diagnose()` 的 `tcpPing('127.0.0.1', 17110)` 改用 env 端口 | `settings.js:19-27`、`system-repair.js:44/181/192/200` |
| S5 | **DB 直读的三处并入同一信任域**：新增 `rpc-health.js` 导出 `resolveChildRpcUrl()`：strict ⇒ 恒返回 env `KASPA_RPC_URL`（DB 值**被忽略并打一行** `[rpc-health] strict local-only: DB rpc_url ignored for <caller>`，一次/caller）；non-strict ⇒ 原顺序 `getConfig('rpc_url') \|\| env`。`relay-manager.js:69`、`scanner.js:98`、`escrow.js:153` 三处改调它。**strict 且 env 空 ⇒ relay-manager 拒起 relay** `{ok:false, reason:'no_rpc_url_strict'}`（今天会把 `''` 递给子进程，触发 F5 的公网链条） | 单一实现点，三个调用方 |
| S6 | **relay 子进程**：`relay-manager` 已 `...process.env` ⇒ 子进程能看到 `KASPA_RPC_LOCAL_ONLY`。`transaction.mjs resolveRpcUrl()`：strict 且 env 空 ⇒ **throw**（不拉 console 配置、不进 Resolver）；`rpc-listener.mjs:735-738` 的 `resolver:` 分支同样在 strict 下 throw；`relay.mjs:1106` 硬编码 `\|\| 'ws://127.0.0.1:17210'` 删掉改 env 必填（这一处同时是 §G 类 E 的 TN12 绑定，(b) 稿清单里也列）；`utxo-split.mjs:27` 的 `RPC_URL` 别名 strict 下不认 | relay 侧 4 处 |
| S7 | **与 G-2 REBUILD 的关系（不变、且更纯）**：strict 不动 `checkLocal() → dataCheck(LOCAL_RPC, true) → noteSharedRpcHealthFailure → REBUILD(≥3)` 这条链，本机每次未命中（负缓存之外）照样核、照样计数。strict 后 `_notLocalReason` 只可能是本机原因（`rpc-fail / not-synced / network-mismatch / tcp-unreachable`），`BACK-TO-LOCAL after Ns (was: …)` 这行语义从"从某个替身回来"变成"从 null 回来"，runbook ⑤-①b 看 `was=rpc-fail` 的判据**不变**。⇒ strict 让 REBUILD 成为**唯一**恢复路径（没有替身遮住它），这正是 G-2 想要的 | `kaspa-rpc-shared.mjs:113-123` |
| S8 | `isLan` 私网正则在 strict 下**不可达**（S1 早退），non-strict 下原样。不在本稿扩大它的语义 | `rpc-health.js:222` |

### 3.3 明确不做

- 不做"可信 RPC allowlist"（Codex 给的另一条路）：D-017 之后主网节点就在本机，allowlist 只会是一个元素；多一个配置面就多一个漂移面。
- 不动 non-strict 行为：一个字都不改，`N6` 对照臂守它。
- 不给 16 个业务调用方逐个加 null 守卫（那是各自域的活）；但 **F7 的 5 处无守卫是 strict 的直接受害者**（strict 后 null 更常见）⇒ 列为 §5 N9 探针 + (b)/(c) 之外的独立小单，由 Bettor 派。

## 4. 改动清单（file:line · 不写码 · 行号随 HEAD `8f1e107f`）

| # | 文件 | 改什么 | 属 |
|---|---|---|---|
| C1 | `kasia-console/src/services/rpc-health.js` `getWorkingRpc()` :216-218 之间 | strict 早退（S1）+ 两条日志行（S2）+ 失败 summary 文案（S3）+ 新导出 `resolveChildRpcUrl()`（S5） | console |
| C2 | `kasia-console/src/api/settings.js` :19-27 | strict 拒写非 local 模式；`mode=local` 写 env 值（S4） | console UI |
| C3 | `kasia-console/src/services/system-repair.js` :44 / :181 / :192 / :200 | 硬编码 `17110` → env 端口；strict 拒 `switch_to_discovered` / `discover_node`（S4） | console |
| C4 | `kasia-console/src/services/relay-manager.js` :69 | 改调 `resolveChildRpcUrl()`；strict 且空 ⇒ 拒起（S5） | 钱路（relay 起法） |
| C5 | `kasia-console/src/services/scanner.js` :98 | 改调 `resolveChildRpcUrl()`（S5） | scout |
| C6 | `kasia-console/src/api/escrow.js` :153 | 改调 `resolveChildRpcUrl()`（S5） | 钱路 |
| C7 | `kasia-relay/src/lib/transaction.mjs` :119-133 `resolveRpcUrl()` | strict 且 env 空 ⇒ throw（S6） | 钱路 |
| C8 | `kasia-relay/src/rpc-listener.mjs` :735-738 | strict 下 `resolver:` 分支 throw（S6） | relay |
| C9 | `kasia-relay/src/relay.mjs` :1106 | 删硬编码回退，env 必填（S6；与 (b) 类 E 重叠，二选一落，不重复改） | 钱路 |
| C10 | `kasia-relay/src/lib/utxo-split.mjs` :27 | strict 下不认 `RPC_URL` 别名（S6） | relay |
| C11 | `kanet.env` :304 注释 | 改成 strict 的真实语义 + 指向本稿 | 配置 |
| C12 | `kasia-console/src/services/rpc-health-datacheck.test.mjs` | 加 §5 N1–N8 | 测试 |

C1 是唯一"必须"；C2–C3 是"写入口拒写"（§7 Q1 待 NWT 判：只读侧忽略是否已够）；C4–C10 是 relay/scout 信任域合一（Bettor 10:0xZ 已点名要）。

## 5. 负测清单（NWT 出用例 · J2 列判据 · 骨架沿用 `rpc-health-datacheck.test.mjs`：临时 migration 库 + 本机随机端口 listener + 假 `RpcClient` Ctor 注入 + `setConfig` 直写）

| # | 设置 | 期望 | 它证什么 |
|---|---|---|---|
| **N1**（Codex 原题） | strict · 本机 listener 的假 Ctor 返回 `isSynced:false`（或超时）· `setConfig('rpc_url', 'ws://127.0.0.1:<port2>')`，port2 另起 listener、假 Ctor 对它返回 `{networkId:'testnet-12', isSynced:true}` | `getWorkingRpc()` ⇒ `{url:null}`；**port2 的实例数 = 0**（`st.ctor` 不增）；日志无 `using configured node` | 配置回退真的没被走到（不是走了又被拒） |
| N2 | N1 + 配置 URL 换成私网形 `ws://192.168.1.2:17210` | 同 N1；且 `isLocal===false` | `isLan` 正则在 strict 下不可达 |
| N3 | strict · 配置 URL **恰等于** env `KASPA_RPC_URL` · 本机健康 | 返回本机；`getServerInfo` 只核 1 次 | 不因配置存在而重复核 |
| N4 | strict · `POST /settings/node {mode:'custom', custom_url:…}` / `applyFix('discover_node')` | 409 / `{ok:false}`；`getConfig('rpc_url')` 前后一致 | 写入口拒写（S4） |
| N5 | strict · `setConfig('rpc_url', 外部)` · 调 relay-manager 的 env 组装（需先把 :69-90 的 env 组装抽成纯函数 `buildRelayEnv()` 才可单测，列为 C4 的一部分） | 子进程 env `KASPA_RPC_URL === process.env.KASPA_RPC_URL`；env 空 ⇒ `{ok:false, reason:'no_rpc_url_strict'}` | relay 与 console 同信任域（T2/T4 关门） |
| **N6 对照臂** | **non-strict**（env 不设）· 其余同 N1 | 返回配置 URL、`using configured node` 行出现 | 老行为一字未改；也证明 N1 的红不是"测试环境本来就连不上" |
| N7 | strict · 任意 | `discovery disabled (KASPA_RPC_LOCAL_ONLY=1)` 逐字**恰一次** | canonical 行没丢（H6 继续绿） |
| **N8 弱注入臂**（接位档 §(d)） | N1 的全部设置，**只**把 `KASPA_RPC_LOCAL_ONLY` 翻成 `'0'` | 结果翻成"返回配置 URL" | N1 的断言读的是这个开关，不是别的东西替它答题 |
| N9（探针·OPEN） | `new RpcClient({ url: null/undefined, encoding, networkId })` 然后 `connect()` —— F7 那 5 处在 strict 下会真的这么调 | 记录它是 throw、还是**默认走公网 Resolver**（若是后者 = strict 被 kaspa-wasm 默认值绕开，5 处必须先加守卫） | 探针有出网动作，NWT 决定跑不跑 |

## 6. 与 D-017 / 四波 / 回滚

- **波 0（主网只读节点上 da9）落地时 env 变更**：`KASPA_RPC_URL=ws://127.0.0.1:17110`、`KASPA_NETWORK=mainnet`、`KASPA_RPC_LOCAL_ONLY=1` 不动。strict 语义使 NWT 1001 ① 那个"主网公网节点替身"**在结构上不可能**，不靠 networkId 核。
- **生效需 console 重启**（模块级常量）+ relay 子进程随 relay-manager 重起。重启前照 `feedback-preshutdown-money-surface-is-timers-plus-ingress-triggered-paths-quiesce-ingress-before-restart`。
- **回滚**：`KASPA_RPC_LOCAL_ONLY=0` + 重启 = 老行为（strict 全部由 env 门控，代码不改老路径）。这一点比 G-2 好（G-2 的 NWT 审注明"语义已变，去 env 不够"）。
- **顺序**：本稿 → NWT 红队（§5 + §7）→ Bettor → Owner 批（钱路读数源）→ 落码（C1 先，C4–C10 同批或紧随）→ N1–N8 绿 → 部署。

## 7. 请 NWT 判 / 请 Bettor 拍

1. **Q1 写入口**：只在读侧忽略（C1+C4–C6）够不够，还是 C2–C3 拒写也要？我倾向**都要**——只忽略会让 `/api/config/rpc-status` 显示"configured 已设"而实际未用，UI 在撒谎。
2. **Q2 relay 侧 throw 的形**：`transaction.mjs` strict 且 env 空 ⇒ throw 在模块顶层（relay 起不来，最响）还是在 `resolveRpcUrl()` 调用时（每次发送失败）？我倾向**顶层**：与 `rpc-health.js:19` 同形，错配在启动那一刻就暴露。
3. **Q3 N9 跑不跑**：它决定 F7 的 5 处要不要先补守卫。
4. **Q4 落码归类**：C1/C2/C3/C5 非钱路，C4/C6/C7/C9 钱路。是否拆两笔（非钱路 Bettor 批先落，钱路 Owner 批）？我倾向**不拆**：拆开 = 一段时间里 console 读数 strict 而 relay 递交不 strict，恰好是 T2。

## 8. 本稿没核到的（写明）

- N9 未跑（有出网动作，等 NWT 拍）。
- `escrow.js:153` 那条路径今天有没有人走（refund 分支 deadline 预检）——未查调用频率；C6 的风险面按"存在即改"处理。
- kaspa-wasm `RpcClient` 在 `url` 缺省时的行为只看了 `rpc-listener.mjs` 的 `resolver:` 用法，没读 d.ts；N9 就是为它。
