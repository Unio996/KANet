# T+125 后预告维护窗 runbook v0.5.1(定稿 · 文件名保留 v0.4 免断引用)

> **Status**: CURRENT · KANet-UI 2026-08-28 · v0.5 J2 2026-08-29 落 Bettor 裁(J1 预检 `docs/iteration/j1-inbox/2026-08-29T23-10Z-j1-reply-maintenance-window-preflight.md` 两缺口) · D-013 §3 配套 · 从 scratch 转正(Bettor 令)

> KANet-UI 2026-08-27 · **计划页, 零执行**。基于备页 `scratch/_postsync_service_resume.md` §4 + Bettor 派 9 步 + NWT 三眼改进。
> 敏感细节(暴露面/防火墙规则名/nonce)一律写 **"见管道/本地 memory"**。
>
> 🔴🔴 **窗内 on-chain dev-coord 频道 DOWN**(NWT 三眼; v0.5.1 路 3): ③ `taskkill //T` 杀尽 console 进程树 ⇒ 全部 relay 子进程**含 comm relay 743c0360** 被杀 ⇒ **步 ③–⑥ 期间 dev-coord 频道断**。**协调改走 pipe SendMessage(本地 IPC, 不经 relay)+ git**; **别假设窗内频道能用**。⑦ console boot `startAll` 后频道自动恢复。
> **开窗前提(全满足才开)**: ① 节点 READY(daa>80,095,687, step0 gate 绿) ② J2 T+125 证据页落地 ③ **四补丁全 NWT GREEN**(见下 §四补丁) ④ MSG-284 发出。
> **总原则**: 每步先读数、先通知；SYSTEM 动作(停/重启 console·llama)= J1 提权；KANet-UI 非提权只做只读+通知+验收+备序, 绝不亲执 taskkill SYSTEM 进程。

## §四补丁(开窗前提③) — 全 GREEN 才开窗
| 补丁 | 作用 | 状态 |
|---|---|---|
| llama loopback | llama 绑定收敛为 loopback(3 脚本; 暴露面细节见 memory `project-llama-server-exposure-0000-bind-plus-firewall-app-allow-2026-08-27`) | **✓推(NWT GREEN)** 88ab6f6f · 未部署(激活在窗④) |
| llm-fallback 默认 URL | tier-1 无-agent 默认 :3020(stale)→ adapter_nodes/env/:3031 | **✓推(NWT GREEN)** e3154dce · 未部署(激活在③console 重启) |
| j1-patch.ps1 | console index.js 僵尸补丁(__booted 分界) | **NWT GREEN**, 待 J1 `-Apply`(inert)+ commit 入仓 |
| reap-console-zombies.ps1 | console 僵尸清理(默认 dry-run) | 待 J1 入仓 → NWT 审谓词 |

> 四补丁 GREEN 进度(2026-08-27, 记账 ledger 191e21c1/#694): loopback ✓ / llm-fallback ✓ / j1-patch(GREEN 待 apply+入仓) / reap(待入仓+审) ⇒ **还差 j1-patch 入仓 + reap 入仓&审** 才满足开窗前提③。

---

## 步骤表
| # | 步骤 | 执行人 | 只读验证命令 | 通过判据 | 预计时长 |
|---|---|---|---|---|---|
| ① | **通知全员开窗(+announce-freeze+频道将断)** | Bettor | 发后 `ListAgents` | 频道+SendMessage(J2/NWT/J1)+Owner 单点已发；**明写"窗内全员不发预测/交易/提现/faucet DM"(=announce-freeze, drain 稳定窗前提)**；**明写"②-bis 起 dev-coord 频道断, 协调走 pipe SendMessage+git 直到 ⑦ 恢复"**；J1 回执必收 | 5 min |
| ② | **在飞检查(两类: 定时器 + 请求/消息触发)** | KANet-UI(只读) | 见 §检查②(两机械表) | **money-moving 定时器 + 请求/消息花钱路径都无在飞未落链**(按 §② 规则)；只读监控组不阻塞 | 10–15 min |
| ②-bis | **quiesce money ingress + drain 在飞 handler**(NWT v0.2 改进; **v0.5 路 3: 不单独停 relay**) | KANet-UI(只读 drain 确认)/Bettor(announce-freeze) | 见 §②-bis | **drain 稳定窗三条齐**(announce-freeze + 60 s 静默 + 现存 `broadcast_tx` 全 landed)后**直接进 ③**；relay 由 ③ console 停一并终止 | 5–10 min |
| ③ | **J1 提权: console 单体重启(补丁段已完成 SKIP; 同时激活 llm-fallback)** | J1(提权) | 见 §检查③ | 旧 console **进程树** `taskkill //PID <console> //F //T` 杀尽 ⇒ **stop 后硬闸验证: 实测 0 个 relay 进程存活**(提权 CIM 双判据, 见 §检查③)**才起新 PID**(`scripts/_launch_console_single.ps1`)、pidfile 真 PID；**"预期阶段"**: 若节点侧出现 `searching for missing block bodies` **不是卡**, 过关只看 `nodeBodiesProcessedCount` 离开 0 | 5–8 min(+节点侧预期阶段 8–40 min, 见 §检查③) |
| ④ | **llama 验收(loopback,256k 目标态 8/27 已达; 仅在窗前被重启过才重起)+a5-verify** | J1(起)/KANet-UI(验收) | `node scripts/a5-verify.ps1` | n_ctx=262144 ∧ **监听 127.0.0.1:8000** ∧ commit 硬闸 = **全机 commit charge 已用 ≤ 80 GB ∧ 可用 ≥ 20 GB**(不是 llama 进程私有 commit) | 5 min |
| ⑤ | **J1 收窄防火墙规则一条** | J1(提权) | `Get-NetFirewallRule`+`Get-NetFirewallPortFilter`(前后对照) | 目标规则已收窄(细节见管道)；:8000 入站不再对网络放行 | 3 min |
| ⑥ | **PRAGMA/迁移态验** | KANet-UI(只读) | `PRAGMA user_version`(better-sqlite3 readonly; 无 sqlite3 CLI) | user_version=期望最新 migrate 版 ∧ 关键表在 | 3 min |
| ⑦ | **频道回声(=频道恢复点)** | Bettor | 发后三 agent 各自 `Monitor` 重 arm | console boot `startAll` 拉回 comm relay 743c0360 后, Bettor 发一条；三 agent 重 arm(**②-bis 起频道断到此恢复**) | 3 min |
| ⑧ | **各子系统自愈链读阳性对照** | KANet-UI(只读) | 见 §检查⑧(链读阳性, 非绿灯无信息) | 每子系统链读阳性(见表)；**llm-fallback 首解析日志出现 + 无 `tier 1 (agent adapter) failed`** | 6–8 min |
| ⑨ | **回滚点确认** | 各步执行人 | 见 §回滚 | 每步失败有验证过的退路 | (随附) |

**总预计**: ~40–50 min(顺序, 无回滚)。

---

## §检查②(在飞定时器/花钱广播 — 机械枚举) — KANet-UI 只读
> NWT 改进①: 手列会漏 ⇒ `grep -n setInterval` 全仓 console 源 + 花钱/广播调用点(sendCommandAsync/sendKaspa/broadcast/transfer/check_utxo)机械枚举。下表**每次开窗前重跑 grep 再核**(代码会长新 tick)。
> 重跑命令(只读): `grep -rnE 'setInterval' kasia-console/src/ | grep -vE '\.test\.|/scratch/'`  +  `grep -rlnE 'sendCommandAsync|sendKaspa|broadcast\(|transfer\(|spendFunds|check_utxo_landed' kasia-console/src/services kasia-console/src/lib`

### 花钱/广播定时器(money-moving — 重启前必按 §② 处置)
| 定时器 file:line | 类别 | 花钱? | 重启前安全策略 |
|---|---|---|---|
| `services/bettor-refund-claim-auto.mjs:171` | 退款自动 claim | **是·最高孤儿风险** | **只准等 check_utxo_landed 落链**(自动花钱 tick, `reference-authorization-field-is-selection-key-of-auto-spend-tick`) |
| `services/pool-market-settler.js`(legacyRefundBuilderTick, 见:46 断路记号) | legacy 退款构建 | **是** | 同上·落链再重启；确认 circuit 未在构建 |
| `services/bettor-prediction-settler.js:39` | 结算 payout | **是** | 落链再重启(settle tick 不中途杀) |
| `services/bettor-prediction-voter.js:71` | 投票/背书广播 | **是(广播)** | 落链/背书完成再重启 |
| `services/bettor-position-protector.js:51` | 仓位保护(可能花钱护仓) | **是(条件)** | 无在飞保护广播才重启 |
| `services/broker-intake-watcher.js:1085`(intake)/`:1095`(refund) | broker 收单/退款 | **是(refund 花钱)** | refund 支路落链再重启 |
| `services/broker-buy-completion-watcher.js:159` | 买单完成(发 KAS) | **是** | 无在飞 KAS 发送才重启 |
| `services/market-seeder.js`(startMarketSeeder, index.js:769) | 挂单广播 | **是(广播)** | 无在飞挂单广播才重启(NWT 点名) |
| `lib/broadcaster-utxo.mjs:98` | UTXO 拆分广播 | **是(广播)** | 无在飞广播才重启 |
| `lib/mining-utxo-consolidate.mjs:120` | 归并广播 | **是(广播)** | 无在飞归并 tx 才重启 |

> bshard 结算族(`bshard-auto-settler.mjs` / `bshard-settle-daemon.mjs` / `bshard-close-voter.js`)**已是 landed-gated**(用 relay `check_utxo_landed` + REORG_SAFE_MIN_DEPTH=20, 见 bshard-auto-settler:614/654/966)——本就等落链, 安全模式的样板。非 setInterval 直挂(由 settler/voter 触发)。

### 只读监控组(NO spend — 随时可重启, 不阻塞开窗)
`lib/disk-space-alert.mjs:75` / `lib/eventloop-lag-heartbeat.mjs:37` / `lib/faucet-utxo-health.mjs:115`(只读健康) / `lib/rpc-health-degradation-alert.mjs:316` / `lib/settle-failed-alert.mjs:80` / `lib/zk-prove-job-stuck-alert.mjs:105` / `index.js:249`+`:487`(心跳) / `services/broker-bot-manager.js:192`(reconcile) / `services/broker-fee-emit.mjs:57`。这些只读/告警, 重启不丢钱。

### 请求/消息触发花钱路径(NWT v0.2 改进①: setInterval 抓不到——一条 DM/协议消息/HTTP 到达就花钱, 光通知不够)
> 重跑命令(只读): `grep -rnE 'transferUsdt|transfer\(|sendCommandAsync|send_broadcast' kasia-console/src/api/bettor.js kasia-console/src/api/chat.js kasia-console/src/services/broker-v2/router.js kasia-console/src/services/exchange-machine.js`
| 花钱路径 file:line | 触发源 | 花什么 | 冻结方式 |
|---|---|---|---|
| `api/bettor.js:1415` transfer→escrow | **HTTP**(/api 押注) | KAS(maker 质押) | :3200 已 localhost(仅本机进程/agent 能打)；+②-bis drain→③ console 停(relay 子随之终止)挡链出口 |
| `api/bettor.js:1600` transfer→escrow | **HTTP** | KAS(taker 质押) | 同上 |
| `api/bettor.js:1888-1905` refund | **HTTP** | KAS(退款) | 同上；money-moving=落链后重启 |
| `api/bettor.js:1108-1173` publish/broadcast | **HTTP** | fee(挂单广播) | 同上 |
| `api/chat.js:688` faucet drip | **HTTP/DM** | KAS(faucet) | :3200 localhost + ①通知"窗内不发 faucet DM" + ②-bis |
| `api/chat.js:250/806` send_broadcast | **HTTP/消息** | fee(频道广播) | ②-bis drain→③ console 停(链出口) |
| `broker-v2/router.js:183` transferUsdt→pay_address | **用户 DM(消息)** | **真 USDT**(broker 提现) | ②-bis: 消息触发, HTTP 挡不住 ⇒ **drain 后 ③ console 停 = relay 消息 intake 一并停**(唯一无新码挡法; v0.5 路 3) |
| `exchange-machine.js:213/225` transition()→auto-pay transferUsdt/发 KAS | **协议消息**(handler 内同步跑) | **真 USDT / KAS**(auto-pay/auto-deliver) | 同上: 消息触发 ⇒ ②-bis drain → ③ console 停 |
🔴 **关键**: HTTP 路径在 :3200(已 localhost)——网络打不到, 但**本机 agent/脚本仍能触发**; **消息触发路径(broker 提现 / exchange auto-pay)经 relay 到达, HTTP 防火墙挡不住** ⇒ 唯一无新码挡法 = **②-bis drain 后 ③ console 停(relay 子随之终止)**(relay=唯一链上出口, 停它=所有花钱在链出口被挡; v0.5 路 3, 不单独 stopRelay)。

## §② money-moving 广播的重启安全规则(NWT 改进②)
🔴 **"记 txid 再重启" 对 settle/refund 等花钱广播【不安全】**: console 重启 = **在飞 relay 子孤儿化 + 日志行丢 + spent 标记丢**(`reference-console-restart-orphans-inflight-relay-child-log-line-lost`)。
- **money-moving 广播(上表"花钱=是")**: **只准等 `check_utxo_landed` 落链确认后再重启**。未落链 = 不开窗, 等它落(或 §回滚 记 txid 但**不重启**直到落链)。
- **"记 txid 重启" 仅限**: 非花钱 / 可对账(重启后能从链上或幂等 CAS 重建状态)的场景。上表按类已标。
- 判据来源: `feedback-preshutdown-inflight-check-must-enumerate-broadcasting-timers` + `NO TX NO STATE CHANGE` 铁律。

## §②-bis quiesce money ingress + drain 在飞 handler(NWT v0.2 改进②·排在 ③ 重启前)
> 光通知不够: 窗内一条 DM/协议消息/HTTP 到达就花钱。停 ingress + drain 在飞, 再重启。

### (只读)先盘点有无现成"无新码"维护开关
- `kanet.env` 的 `*_ENABLED`(PREDICTION_AGENT/POOL_SEEDER/SETTLE_DAEMON/BSHARD_*/...)= **启动期读, 只 gate 定时器子系统**, 且**改了要重启才生效** ⇒ **窗内(重启前)改它无用**, 且**不 gate HTTP/消息触发的花钱路径**。
- **无全局 `KANET_MAINTENANCE`/`READONLY`/`FREEZE` money-ingress 开关**(`ADMIN_SECRET_READONLY` 是 admin-tier 密钥, 非全局停摆闸)。
- ⇒ **没有现成无新码 flag 能 live 挡住 HTTP/消息花钱 ingress。** 用下面两法(NWT 选)。

### 无新码挡法(NWT 二选一/组合)
**(a) v0.5 路 3(Bettor 裁·J1 预检缺口 1): 不单独停 relay, drain 稳定窗三条齐后直接 ③ 重启 console**:
- 🔴 **原写法"J1 提权 `stopAll()`"不可执行**(J1 实核 + v0.5.1 J2 更正): `stopAll()` 定义在 `services/relay-manager.js:201`, **唯一调用者 = `index.js:886-893 shutdown()`**(`:553` import 为 `stopAllRelays`), 而 `shutdown()` **只绑 `SIGTERM`/`SIGINT`**——J1 "零调用者"漏了这处, 但结论不变: 没有可从外部触发它的入口(`api/relay.js` 只有 `POST /api/relay/:id/restart` 停+起串联, **无"只停不起"端点**; 加端点=新码, 重启才生效 ⇒ 本窗无用, 同 (b) 的判断); 按 PID 逐个 `Stop-Process` relay 子 = 不 drain 直杀, 与"必先 drain"冲突。
- ⇒ **路 3**: drain 稳定窗三条齐(下节) ⇒ **直接进 ③: `taskkill //PID <console> //F //T` 杀尽 console 进程树**, 然后**实测 0 个 relay 进程存活**(§检查③ 硬闸验证)才起新 console。relay = 唯一链上出口 ⇒ 树被杀尽 = **timer + HTTP + 消息** 三类花钱在链出口全被挡(sendCommandAsync/transfer 无 relay 可打=失败不花钱)。
  - 🔴🔴 **NWT MUST-FIX(v0.5.1)——"console 停 = relay 随之终止" 在 `//F`(无 `//T`) 下为假**: `//F` = `TerminateProcess`, **不触发** `shutdown()`(它只绑 SIGTERM/SIGINT, 内含 `stopAllRelays()`); relay 子由 `relay-manager.js:95` `fork` 生成, **非 detached、无 job-object**; `relay.mjs` **零** `disconnect`/`exit` 自退处理; `setInterval(poll, 2000)` 独立喂 loop ⇒ **relay 孤儿存活并继续自主 poll → `doAcceptHandshake`/`handleActiveConversation` 自主上链**(小额, 但是维护窗内真广播; 大钱路 IPC 命令型仍无 console 可发)。drain 三条只盖"停前在飞", **盖不住 post-stop 孤儿的新 tick** ⇒ 必须 `//T` + stop 后硬闸验证。**活证**: 2026-08-29 05:14Z 起 supervisor 三次 `//F` 式重启, relay 孤儿数 KANet-UI 在数。
  - 🔴 仍是直杀 ⇒ **必先 drain(见下)再进 ③**, 否则孤儿化在飞(`reference-console-restart-orphans-inflight-relay-child-log-line-lost`)。
- 可选 J1 提权临时防火墙: 窗内封 :3210 外部只读网关入站(:3200 已 localhost)。**:3210 是只读口非 money**, 价值低; money 消息走 relay 不走 :3210。暴露面细节见 memory `project-llama-server-exposure-0000-bind-plus-firewall-app-allow-2026-08-27`。
**(b) app 层 `KANET_MAINTENANCE=1`(= 第五补丁·代码改动)**: 让 money 端点/handler 拒。🔴 **旧 console 不认、只对重启后有效 ⇒ 对本窗无用**(要重启才生效, 而本窗目的就是重启)。仅作**未来窗**手段, 本窗靠 (a)。**标明: 不在本窗四补丁内。**

### drain 判据 = 稳定窗(NWT 三眼③: 单次 DB 快照有洞——`relay-manager` 无在飞命令追踪, 漏"mid-transfer 未写 broadcast_tx"如 `exchange-machine transition()` auto-pay 正 await relay)
🔴 **不用单次快照, 用稳定窗三条齐**(本机无 sqlite3 CLI ⇒ node+better-sqlite3 readonly; 开窗前 grep schema 确认 `broadcast_tx`/`pending_actions` 确切表名):
- **(a) announce-freeze 已发**(步①: 窗内全员不触发预测/交易/提现/faucet)——掐住新 ingress 源头。
- **(b) 连续 T=60s 静默**(60s > 单笔 transfer relay 往返上限): 这 60s 内**无新 `broadcast_tx` 行写入 ∧ 无 `pending_actions` 进入 broadcasting 态**。覆盖"mid-transfer 尚未写 broadcast_tx"那一小段——一笔在 await 的 transfer 会在 <60s 内要么写 broadcast_tx(被 (c) 捕获)要么完成。
- **(c) 现存 broadcast_tx 全落链**: 每条跑 relay `check_utxo_landed`(minDepth=REORG_SAFE_MIN_DEPTH=20)确认 landed ∧ relay 日志末条 broadcast 已 landed。
- 三者齐 ⇒ **直接进 ③**(v0.5.1 路 3: `//F //T` 杀尽 console 树 + 实测 0 relay 存活)。任一不满足 = 等(未落链绝不进③, §② 规则)。

🔵 **兜底(NWT 三眼; v0.5.1 改写): 硬闸 = "console 树被 `//T` 杀尽 + 实测 0 个 relay 进程存活"**——**不是**"relay 随父终止"(那句在 `//F` 下为假, 见上 MUST-FIX)。满足后任何新 money 请求/消息 → `sendCommandAsync` 无 relay 可打 → **报错 fail-closed 不花钱**(NO TX NO STATE CHANGE)。⇒ drain+quiesce **只需盖住"停前那一小段在飞"**, 不需追踪未来。**时序 = drain+quiesce(稳定窗三条) → ③ `taskkill //F //T` → 0 relay 存活验证 → 起新 console**。

## §检查③(console 补丁+单体重启) — J1 提权
- 补丁: `j1-patch.ps1 -Apply`(NWT GREEN, %TEMP%; 改 `kasia-console/src/index.js:10-15`+`:474-475`; 幂等/两锚点全命中否则 ABORT; 备份 `.bak-j1-20260826`; `node --check`)。**已打(J1 预检: commit `57fde30f`, `__booted` 在位, 备份 54,207 B 在位)⇒ 窗内本段 SKIP, 只做重启。**
- **单体重启(不用 kanet-start 整套)**: 记旧 console PID(`netstat -ano | findstr :3200` owner; J1 预检实况 `PID 27412 owner=SYSTEM`, argv `"C:\Program Files\nodejs\node.exe" --max-old-space-size=4096 D:/kanet-tn12/kasia-console/src/index.js`)→ 通知后 **`taskkill //PID <console> //F //T`**(SYSTEM=J1 提权; **`//T` 必带** = 杀整棵进程树含 relay 子; 无 `//T` 的 `//F` 只杀 console 本体, relay 孤儿继续自主 poll 上链——NWT MUST-FIX v0.5.1)→ 🔴 **stop 后硬闸验证(才准进下一步)**: 提权 `Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'relay\.mjs' }` **必须为空**——🔴 **须提权执行**: 非提权读 SYSTEM 进程的 `CommandLine` 为 `null` ⇒ 匹配不到 = **假空**(读不到≠没有); 双判据同时核: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) }` = **父已不存在的 node.exe 数 = 0**。两条都空才算 relay 树杀尽; 任一非空 ⇒ 按 PID 提权 `Stop-Process` 补杀后重核, 不起新 console → **启动器 = `scripts/_launch_console_single.ps1`(J1 写; v0.5 Bettor 裁)**: 读 `kanet.env` 全量 export + 复刻现役 argv + `Win32_Process.Create` 脱离会话; **env 清单由 KANet-UI 确认**(漏一个 key = console 起来但行为漂移, 历史 #472 漏 `KASPA_RPC_URL`)。
  - 🔴 **不要**跑 `kanet-start-headless.sh` 整套(杀 sidecar+重起全栈, 漂移表 #24); 受控 supervisor 的 `restart_console()` 调的就是它 ⇒ 同样不可用(J1 预检)。
  - 🔴 本机根目录**没有** console 的 `_launch_*` 启动器(J1 预检实核: 只有 `_launch_agents.ps1` + 三份 brief)⇒ 上面那个脚本是唯一安全路, 窗前须入仓 + NWT 一眼。
  - 🔴 pidfile 真 PID(`reference-console-restart-stale-pidfile-orphan-trap`)。
- 🔵 **重启后"预期阶段"(v0.5·J1 `1c383e89`/`856b4691`)**: kaspad **不重启**; 但若 console/relay 重启触发任何节点侧 `searching for missing block bodies`, **不是卡**——J1 实测 da9 基准 **8.3 min @ 7.9 GB 缓存**, 默认缓存按 **20–40 min** 预期。**过关判据只有 `nodeBodiesProcessedCount` 离开 0**; 写操作数跳升**不算**。(更多是节点重启场景, 但本 runbook 是维护窗唯一读物, 放此。)
- 🔴 重启即孤儿化在飞 relay 子(NWT 红队①)⇒ **必在 §检查② 清完花钱在飞后才动**。
- **llm-fallback 补丁随此重启激活**(commit e3154dce, 若已推): 新 console 首次 tier-1 调用即解析 :3031。

## §检查⑥(PRAGMA/迁移态) — KANet-UI 只读
`feedback-verify-live-db-migration-state-not-just-deployed-commit`。better-sqlite3 readonly 读 `PRAGMA user_version`(**本机无 sqlite3 CLI**, 用 node+better-sqlite3)。关键表抽查(relation_states/chain_events/execution_states/pending_actions)。

## §检查⑧(自愈 — 链读阳性对照, 非绿灯无信息) — KANet-UI 只读
> NWT 改进③: "tick 时间戳>重启时刻" 是绿灯无信息 ⇒ 每子系统加**链读阳性对照**。
| 子系统 | 链读阳性对照(非仅时间戳) |
|---|---|
| settle-daemon | 末次读到的 **DAA > 重启前值**(新鲜链读, 非缓存) + 一次真 landed 判定记录 |
| market-scanner | 末摄块**近期**(last-block time 距今 < 数分钟, 非陈旧) |
| settler | 一次**真处理记录**(某 market 状态推进 / 一次 check_utxo_landed 真返回) |
| voter | 一次**真背书/投票**落库记录(非 tick 空转) |
| **llm-fallback** | **首次解析日志行出现** `[llm-fallback] default adapter URL resolved: http://127.0.0.1:3031 (source: adapter_nodes...)` **∧ 无-agent(cron)路径 tier-1 走 :3031 成功 ∧ 不再有 `tier 1 (agent adapter) failed`** |
- 🔴 唯一"需外部触发"(不属本窗): ①READY 派 J2(Owner 令) ②1M 转账(Owner 令, 等 GO) ③起矿(J1 域)。

## §回滚点
| 步 | 失败信号 | 回滚 |
|---|---|---|
| ②在飞 | money-moving 广播未落链 | **不开窗**；等 check_utxo_landed 落链；花钱广播绝不带在飞重启 |
| ③补丁 | j1-patch ABORT(锚点不全) | 不做模糊替换；保持原 index.js；报 NWT 复核锚点 |
| ③重启 | 新 console 非 302 | 从 `.bak-j1-20260826` 还原 index.js → 起旧版 → PRAGMA 验 |
| ④llama | 监听未收敛为 loopback / 全机 commit 超硬闸(已用 > 80 GB ∨ 可用 < 20 GB) | 停新 llama；查是否走了未打补丁旧脚本；按 loopback(88ab6f6f)重起 |
| ④/⑧ llm-fallback | tier-1 仍 fetch failed / 解析日志未出 | 查 :3031 是否在线(PID 32008)+ e3154dce 是否已激活；未激活=console 未重启到新码 |
| ⑤防火墙 | 收窄后本机消费者断(不该, 全 localhost) | 还原该规则；细节见管道 |
| ⑥PRAGMA | user_version 不符 | 不推进；报 Bettor+DB 属主；**别手插 DB**(`feedback-no-db-hack-understand-design-first`) |
| 通用 | 频道断/失联 | 走 git；SYSTEM 动作等 J1 提权；不擅扩大动作面 |

---
🔴 **relay 归位**: ③ `//T` 杀尽 console 树时 relay 子一并被杀且实测 0 存活(v0.5.1 路 3), console 重启 boot 时 `startAll`(relay-manager r281)**自动拉回 relay** ⇒ money-quiesce 窗 = console 停→console 起好这段; 之后 relay 回、money 路径复活(窗已完)。

## §watchdog-enable(D-013 §3, 独立于本维护窗; READY 后 J1 域)
KANet-KaspadWatchdog 任务保持 **Disabled**; 启用前置(全满足才 Enable):
1. 节点 READY(daa>80,095,687)。
2. `powershell -File scripts\kaspad-watchdog-va.test.ps1` = **25/25** ∧ `scripts\kaspad-watchdog-enable-va.test.ps1` = **8/8**(live 一跑)。
3. NWT diff GREEN(probe 三态 + tristate + enable-gate + enable-va)。
4. 🔴 **enable 前置断言(承重, 我加, 对齐 Bettor DECISIONS D-013 §3)**: `KASPAD_WATCHDOG_TESTMODE` **unset** —— 启用/起 watchdog 前必查:
   `if ($env:KASPAD_WATCHDOG_TESTMODE) { throw "refuse enable: TESTMODE set (spawn 会被重定向到哑进程, kaspad 永不重启静默 broken)" }`
   (spawn 覆盖抬高 blast-radius; 生产误开=永远起哑=kaspad 不受保护)。任务 XML/生产启动路径**绝不**设该 env。
5. Bettor 令。
以上齐 ⇒ J1 提权 Enable 任务; 启用后首轮观察 watchdog 对 daa=0 IBD 判 SYNCING 不重启(即已修的 8/23 型误判)。

## §red-line-7-observe(relay 重启后检查 · 条件: Owner 已批红线 7 observe + plurality MUST-FIX NWT GREEN + 随本窗部署)
> NWT 判定: observe 段随 relay 重启部署(J2 6ed90a7a, coord/redline7-observe), 盯法放本 runbook 不进 first-hour。**仅当 Owner 已批 observe、plurality MUST-FIX NWT GREEN、且本窗部署了它**才执行本节; 未满足 ⇒ 跳过。
> 🔴 **plurality MUST-FIX 前置**(Codex 桥 e6d3d2f8 / D-014 注记): 本地估算器漏 UTXO plurality(covenant UTXO p=2 被按 p=1 算 = 低估)——未修就部署 observe 会用错估算器 ⇒ 部署前须 plurality MUST-FIX NWT GREEN(Owner"批"不变, 但部署门加这一条)。
1. **阳性对照**: relay 重启后日志出现 `[mass-floor:observe]` 与 `[mass-floor:observe:auth]` 行——**至少一笔 covenant 提交打出一行**。**零行 = observe 没生效 ⇒ 回报 Bettor**(部署没接上)。
2. **首读计数**: `totals=ok/viol/inc` + `evicted` + `local-ub unavailable`(estimator throw) 计数。
3. 🔴 **`inconclusive`(inc) = 100% ⇒ 立即报 Bettor**: vendored `IMempoolEntry` 可能无 mass 字段, 权威口须改, **不算通过**(observe 全程无法判 = 形同没装)。
4. **之后运行小时摘要加一行**: `[mass-floor:observe] would_reject=true 计数 / local-ub unavailable 计数 / totals ok/viol/inc`——7 天对照, enforce 前置。
（未部署 observe 时本节不产生摘要行; enforce 是 observe 7 天对照后另议, 不在本窗。）

🔴 ~~本页 scratch 不 commit(等 Bettor 批口径)~~(已转正入 docs `511741fd`, 此句留作历史)。敏感细节走管道/本地 memory。
v0.5.1 fix-up(NWT 裁 v0.5 NOT-GREEN 一条承重 MUST-FIX·J2 落): **1.** §检查③ `taskkill` 加 **`//T`**(杀整棵树; `//F` 无 `//T` = TerminateProcess 不触发 `index.js:886-893 shutdown()`(只绑 SIGTERM/SIGINT, 内含 `stopAllRelays()`) ⇒ relay 子(`relay-manager.js:95` fork 非 detached/无 job-object; `relay.mjs` 零 disconnect/exit 自退; `setInterval(poll,2000)` 独立喂 loop)孤儿存活继续自主 poll 上链)。**2.** 加 **stop 后硬闸验证**: 提权 CIM `CommandLine -match 'relay\.mjs'` 为空 ∧ 父已不存在的 node.exe 数 = 0(双判据; 非提权读 SYSTEM CommandLine 为 null = 假空)才进下一步。**3.** §107/硬闸语义句改为"console 树被 `//T` 杀尽 + 实测 0 个 relay 进程存活", 不再写"随父终止"; 顶部横幅/步骤表 ③/路 3 段/relay 归位同步。**4.** 顺手更正 J1 "stopAll 零调用者": 唯一调用者是 `shutdown()`, 只是 `//F` 绕过它。活证: 05:14Z 起 supervisor 三次 `//F` 式重启, relay 孤儿数 KANet-UI 在数。
v0.5 变更(对 v0.4·Bettor 裁 J1 预检两缺口·J2 落): **1.** §②-bis「J1 提权 `stopAll()`」改**路 3**——`stopAll()` 零调用者、无只停端点 ⇒ 不单独停 relay; drain 稳定窗三条齐后直接 ③ 重启 console, relay 子随 console 终止, 硬闸语义由"console 停 = 无 relay 可打"覆盖(§107 兜底不变); 顶部横幅/步骤表/§检查② 冻结列/relay 归位同步改。**2.** §检查③ 加**"预期阶段"**: 节点侧 `searching for missing block bodies` 不是卡, 过关只看 `nodeBodiesProcessedCount` 离开 0(J1 da9 基准 8.3 min@7.9 GB, 默认缓存 20–40 min)。**3.** §检查③ 启动器 = `scripts/_launch_console_single.ps1`(J1 写: kanet.env 全量 export + 复刻现役 argv + `Win32_Process.Create`), env 清单 KANet-UI 确认; 补丁段已完成(57fde30f)窗内 SKIP。**4.** ④ commit 闸单位写明 = **全机 commit charge 已用 ≤ 80 GB ∧ 可用 ≥ 20 GB**(非 llama 进程私有 commit)。
v0.4 变更(对 v0.3·NWT 三眼·定稿): **1.** stopAll 含 comm relay 743c0360 ⇒ 窗内(③–⑥)dev-coord 频道 DOWN, 顶部横幅 + ① 通知 + ⑦ 恢复点全写明, 协调走 pipe SendMessage+git。**2.** check_utxo_landed minDepth 20=REORG_SAFE_MIN_DEPTH 确认够。**3.** drain 判据改**稳定窗三条**(announce-freeze ∧ 连续 60s 无新 broadcast_tx/broadcasting ∧ 现存全 landed)替单次快照(补 mid-transfer 未写 broadcast_tx 洞); 注明 **stopAll 本身 fail-closed 硬闸**(停后新 money 请求 sendCommandAsync 报错不花钱)⇒ 只需盖停前在飞小段; 时序 drain+quiesce→stopAll→③。
v0.3 变更(对 v0.2·NWT 二眼): ①§检查② 加第二表(请求/消息触发花钱: bettor.js/chat.js/broker-v2/exchange-machine, 标触发源+冻结) ②新步 **②-bis quiesce money ingress + drain**(现成 flag 盘点=无 live 挡法; 无新码两法: (a)stopRelay+防火墙 推荐, (b)KANET_MAINTENANCE=新码对本窗无用标明; drain 靠 pending_actions/chain_events/check_utxo_landed) ③① 通知加"窗内不触发预测/交易/提现/faucet"。
v0.2 变更(对 v0.1): ①在飞检查机械化成表 ②money-moving 广播只准落链后重启 ③自愈判据改链读阳性对照 ④前提③=四补丁 GREEN ⑤loopback 已推更正 ⑥llm-fallback 激活+验收锚。
