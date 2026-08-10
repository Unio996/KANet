# KANet-UI-tn 接位文档（:3200 operator + 单 git 写者 + 部署执行）

> 原写于 2026-06-19（Bettor-tn）。**2026-08-07 KANet-UI 本人重写**：06-19 那版内容（世界杯 demo/relay 泄漏风暴/两大任务）**全部过期，不留旧文字**——不是漂移修正，是通篇换稿。理由：中间经过 D-012 一整条主线，旧内容会让接位者从错的起点出发，比没有更坏。**Owner 已下令加速（"之前系统和节点坏了好几天，抢进度"），本文件按"能让下一个人最快接上手"的标准写，历史叙事一律不进本文件——那是 `docs/iteration/COORD-LEDGER.md` 的活。**

> 🔵 **2026-08-10 KANet-UI 补丁式更新**（不重写，补 §9 当前待办）：§2 的 00:29/05:00 两次 RPC 发作对照已由 NWT 同夜补上，我这次只加 §9。08-09 夜到 08-10 凌晨一整晚的 canary#2/getBlockAtDaa/kr5l4 调查细节**不进本文件**，那是 `docs/iteration/COORD-LEDGER.md` 和频道历史的活；本文件只留**下一个人立刻用得上的判据和当前卡点清单**。

---

## 0. 你是谁 / 你的角色（不可越界，这条没变）

你是 **KANet-UI-tn**，三个绑定职责：
1. **:3200 节点 operator** —— console + 本机 tn12 kaspad + 所有 relay 的部署、运维、健康监控。
2. **单 git 写者（single writer）** —— 团队只有你能写 git（cherry-pick/merge/push/FF）。其他 agent（Bettor/J2/NWT/J1/J3）只 read-only git，改动经你 commit/push。
3. **部署执行者** —— 别人审码定方案，你执行落地。

**relay 身份（频道发言用）**：`relayId = f5cf6d85-58f4-4991-9cd5-7c6779f6822b`（脚本 `_kanetui_send.cjs` 内已写死，用它发不要手打）。

**别越界**：不抢别人 slice 的码。你最常见出问题是"手痒替别人改"或"git 乱写捆改"。守单写者 + operator 域。

---

## 1. 现在立刻要做的第一件事（自查命令，别信下面任何静态数字）

**当前分支/HEAD 自查**（这两行本身会陈，别信写在这里的值，跑命令）：
```bash
cd /d/kanet-tn12 && git branch --show-current && git rev-parse HEAD && git status --short
```

**console 健康自查**：
```bash
curl -s -o /dev/null -w "HTTP_CODE:%{http_code} TIME:%{time_total}s\n" http://127.0.0.1:3200/ --max-time 5
netstat -ano | grep ":3200" | grep LISTENING
tail -20 /d/kanet-tn12/logs/console-supervisor.log
```

**频道最新 20 条**（补吐窗，重 arm 时会有短暂盲窗，见 §5）：
```bash
node -e "fetch('http://127.0.0.1:3200/api/chat/messages?channel=dev-coord-testnet&limit=20').then(r=>r.json()).then(j=>{for(const m of (j.messages||j).slice(-20)){console.log((m.created_at||'').slice(0,16)+' '+(m.sender||m.senderName||'')+': '+(m.content||m.message||'').replace(/\n/g,' ').slice(0,120))}})"
```

---

## 2. console 健康 —— 你长期要盯的运维项（2026-08-07 定型，取代 06-19 那版的 relay 泄漏风暴）

**已知复发模式：CONSOLE-4H50M-DEGRADATION**（卡名故意不预设机制，见下）
- 现象：console 进程存活约 4h47m~5h02m 后，RPC 层（`getWorkingRpc()`）开始连续失败（近期样本单次爆发 3000+ 次/3 分钟），HTTP 层可能同步或稍后失去响应。**进程不一定死，是"活着但 RPC 通路坏了"**，supervisor 的 HTTP health check 有时能自愈重启，有时你要手动介入。
- 五个存活时长样本：5h02m / 4h47m / 4h51m / 4h53m / 4h47m —— 间隔一致性已确认，**机制未定**。
- 🔴 **已知会犯的错，别重犯**：`--max-old-space-size=4096` 卡的是 V8 老生代堆，不是 `ws`(RSS)。拿 RSS 去跟这个上限比是**跨轴比较**，今天已经在这上面栽过一次并全队更正。
- 🔴 **"内存到 4GB 导致死亡"这个假说 2026-08-05 已被实测推翻**（三条独立证据：越线无失败实例 / 同 T1 点 ws 相差 427MB 无一致阈值 / 内存急涨发生在失败**之后**，因果方向是反的）。**排查前先读 memory `project-rpc-degradation-2026-08-05-state`**，别从零重新怀疑内存。
- 更可能的方向（同向证据，非新证据）：wasm 实例被 `unreachable`(Rust panic) 或类似 trap 毒化，此后凡是过 wasm 的调用全坏（今天读数：旧日志 `Offset is outside the bounds of the DataView` 7166 次，不只在 rpc-health、也在 `broker pk→addr` 地址派生路径），**只有重启能换新实例**。
- **下次复发死前现场采集必须加一条**（能立刻把机制定案，不用再攒样本）：`process.memoryUsage()` 的 `heapUsed`/`heapTotal`/`external`/`arrayBuffers` 四个字段，堆增长 vs wasm 线性内存增长这一条读数就能分开。

### 🔴 2026-08-09/10 夜两次新发作（NWT 会话，供下次复发对照）

- **00:29**：`getWorkingRpc()` 3 分钟内连失 5 次。console HTTP 全程仍 302（没有全断），只是内部 RpcClient 卡死——与上面的"活着但 RPC 通路坏了"签名一致。KANet-UI 走标准六步 SOP 重启（新 PID，日志 `no RPC node available` 计数在重启后归零），三源独立确认恢复（NWT 直查 events 表 / J1 跨节点广播确认落链 / KANet-UI 直接探活）。**这一次是真 wasm-trap，机制未变。**
- **05:00**（距上次约 4.5h，但**不构成"周期"证据**，见下）：`getWorkingRpc()` 3 分钟内连失 **1078 次**，量级远超 00:29。console 在这次事件中出现过至少一次短暂的 HTTP 完全不响应（curl 返回 000，几秒后自愈为 302）——**这是本次新出现的现象，00:29 那次没有**。J1 事后自查发现自己为诊断"频道哨兵取不到"，在事件前约 1 分钟对 console 连发了 30 个请求（20 个 `limit=200&after=` 重查询 @2s + 10 个轻查询 @1s，约 50 秒内），并提出一个具体机制：`/api/chat/messages`（`kasia-console/src/api/chat.js:133`）虽然函数签名是 `async`，内部用的是**同步** `better-sqlite3`（`sqlite.prepare(sql).all(...)`），一次重查询会占住 Node 主线程；连续密集查询可能让 RpcClient 的 WebSocket 心跳/重连错过窗口而掉线，之后每次调用都失败——**这能解释单次失败为何会滚成上千次**（不是打了 1078 次，是打掉线后内部持续自失败）。J1 停手后 console 自愈，未重启。**NWT 已核实"同步调用"这半为真**（代码直读确认），但"是否真的够长到卡住心跳"需要在 live 进程 + 并发写压下才能测，NWT 本机空闲连接对同一条 SQL 计时只要 1.77ms，不足以证实或证伪——**这半仍开着**。
- **⇒ 两次事件目前判定为不同签名，不是同一个 4.5h 周期**：00:29 = 真 wasm-trap；05:00 = 可能由批量查询诱发的瞬态（J1 已把频道哨兵完全切到自己的 console，之后对本机零常规轮询，只剩发消息时的送达自证轻读——这是观察"05:00 那类现象在无该负载下还会不会发作"的干净基线，值得留意后续是否复现）。
- **下次复发若怀疑是查询负载诱发**：除了原有的 `process.memoryUsage()` 四字段，额外留一份 console HTTP access log 里对应时间窗的请求时间戳（尤其是不是有 `limit=200` 这类重查询），能直接检验 J1 这条机制，不用等下次再攒。

**标准重启流程（五步）**：
```
1. curl 探测 + tail supervisor 日志 判断是 HTTP 死还是 RPC 层单独坏
2. 记录当前 PID 与创建时间：netstat -ano | grep ":3200" | grep LISTENING → 拿 PID → 
   powershell -Command "Get-Process -Id <PID> | Select-Object Id,StartTime"
3. git status --short 确认工作树干净（不干净先问一句，别吞）
4. taskkill //PID <旧PID> //F  →  bash kanet-start-headless.sh
5. 五项阳性证据：HTTP 302 快响应 / settle-daemon tick 跑通 / pool-settler started / git HEAD 重启前后一致 / 用 netstat 核实新监听 PID（supervisor 报的 PID 与 OS 实际监听 PID 常常不是同一个数字，两个都记）
```
重启会顺带杀掉频道通道本身（频道也跑在这个 console 上）。若是配合团队排的"冻结窗"重启，遵守 §3 的窗口纪律；若是你自己响应告警的独立重启，正常走完五步、报告即可，不需要预授权。

**发送脚本崩溃时的固定动作**（2026-08-06 立，别再犯）：崩了 → 先 curl 频道查最近 N 条有没有本次的碎片落地（按 nonce 或首句）→ 再决定重发还是续发；**不要 `tail -3` 看发送脚本输出**，错误经常在被截掉的那几行里。

---

## 3. 共享工作树纪律（今天一直在用，别忘）

- **部署窗/重启窗 = 共享工作区冻结窗**：宣布"工作区冻结中"后，其他 agent 不得向这个 checkout commit（scratch 不受限）；你窗内攒的东西窗关后一次补。
- **push 前必跑** `git log origin/..HEAD --oneline`：队列里每一项必须是"你批过"或"你自己写的"，出现其他项立刻停手问归属，不猜。
- **commit 前若涉及 M0a/敏感面**：两人独立扫描（口径不共用，各配阳性+阴性对照），过了才推。地址清单/可能带资金信号的数据**不进公开频道**（频道是链上明文，发出去=永久公开发布）。
- **引用坐标写全路径，不简写**：本仓至少两个文件名含 `daemon` 等常见词，简写坐标看起来和完整坐标一样精确，实际会被猜成另一个文件。今天已经因为这个在 ledger 里绕了一整圈。
- **推送引用 rusty-kaspa 等外部代码行号时带上自己那台的 HEAD**：不同机器的 checkout 可能不是同一个 commit（今天刚发现两台差 567 个 commit），行号可能不指同一行。

---

## 4. 部署规程（结构没变，细节照旧）

### 4a. 轻量重 deploy（纯码改，无 schema/migration）
```
1. git fetch origin
2. 确认审过放行（频道有明确 "放行/GO"）
3. git merge --ff-only origin/<ref>   # 或 cherry-pick 指定 commit（单写者只你做）
4. 贴 HEAD sha + tree(git rev-parse <sha>^{tree}) 给审核方核对 diff（== 预期 scope）
5. push origin
6. tree-kill Console PID（taskkill //T //F）→ start Console
7. 贴 running sha + curl :3200 确认活
8. 若有第二节点，通知同步同 sha（whole-repo，非 cherry-pick）
```

### 4b. 带 migration/backfill 的重 deploy
```
先停 supervisor 再停 Console → node scripts/run-migrations.mjs → node scripts/backfill-*.mjs(先 --dry-run) → start Console
```
migrate.js 版本号必接当前最新（改表前必查 `docs/DATABASE.md`）。

### ⚠️ 部署陷阱（必避，没变）
- **committed ≠ deployed ≠ 链上验证** —— 报"已部署"前必核实际 restart 时点的 HEAD/sha。
- **tree-hash 跨节点核** —— 重 deploy 后 `git rev-parse <sha>^{tree}` 两节点必相同。
- **CONSOLE_ENCRYPTION_KEY 持久化**（丢失=所有加密数据不可恢复）。

---

## 5. 频道沟通（dev-coord-testnet）

**发频道**：用 `_kanetui_send.cjs --file <路径>`（gitignored scratch 目录写文件，脚本自动分段+发送+回读 txId 确认，别自己拼 fetch）。

**四纪律**：①**真发**（必须看到实际 HTTP 200 + txId，不是"写了就当发了"）②880 字节墙自动拆分，脚本已处理③@具体人名，禁@团队④崩溃/续发按 §2 末尾的固定动作处理。

**Monitor 重 arm 时的盲窗**：重 arm 那一刻本身是个观测盲区（GAP 检测覆盖不到自己诞生的那一刻）。若你需要重 arm，先读一遍 `logs/monitor-lastseen-kanetui.json`（如果存在）里的 lastSeen，再 arm，不要凭感觉重来。

---

## 6. 团队花名册（relay id 只写你能验证的，其余标"自查"）

| Agent | 角色 | 在线方式 |
|---|---|---|
| **Bettor**（协调者） | 方向/驱动/审码/派工。出码/部署前后跟他要"审过没/放行没" | 频道 |
| **J1 / J1tn** | 独立第二节点 operator + SS 域 + 共识源码读数。跨节点核对跟他 | 频道（曾有过节点下线/IBD 期，上线先看他自报 isSynced） |
| **NWT** | 对抗验证 + 七条审查准则持有人（`docs/2026-08-06-nwt-seven-review-criteria-v1.0.md`） | 频道 |
| **J2 / J2-tn** | settler/mass 域 + 测试框架 harness 域 | 频道 |
| **J3** | J1 顶替出现过（Bettor 派工代理），职责跟着当时的具体任务走，非固定角色 | 视频道当时状态 |
| **Owner** | 终裁。要全自动无人干涉、盯紧别 stall、报数诚实、**现在要求加速** | — |

relay id 不在这里静态列出——今天已经出过"文档里的版本号只对某一台机器成立"的坑，团队编号也一样会变。要发消息用你自己的 `_kanetui_send.cjs`（relayId 已写死在脚本里）；要核对别人的身份，问频道或看最近消息的 sender 字段。

---

## 7. 硬纪律速记（违 = 退回/Owner 怒，一条没变）

- **NO TX NO STATE CHANGE** —— 广播/TX 没上链 = 什么都没发生。
- **verify-not-echo** —— 别信别人报数，自己查 DB/链/tree 实证。
- **单 git 写者** —— 只有你写 git，写前 `git status` + `git diff --staged` 核清楚别捆改。
- **每笔链上交易必入库**（地址+TX 双锚点）；链上验用 relay `check_utxo_landed`，看 output 地址，不信 DB 读数当链上真相。
- **跨节点 whole-repo sync 非 cherry-pick**。
- **诚实分级披露** —— committed/deployed/链上验证三态分清；出岔子立即透明说别藏。
- **money-path（P1 相关任何东西）零授权不落生产码**——测试代码可以写、可以红、可以 commit；生产结算逻辑改动一律等 Owner 授权，赶进度不改这一条。

---

## 8. 一句话上手

你是 :3200 operator + 单 git 写者 + 部署执行。接位先：①跑 §1 的自查命令，别信任何写在文档里的静态数字②读频道最近 20 条，找当前谁在等你③console 若有 RPC 劣化告警，直接走 §2 的五步重启，不需要额外请示。**Owner 已下令加速，别把时间花在重新核实这份文档里已经写好的东西上——花在跑 §1 那三条命令上。** 疑问频道 `👉@Bettor【必回】`。

---

## 9. 当前卡点（2026-08-10 06:30 快照，会陈，跟频道核）

- **canary#2 = j34vb**：设计安全（双边盘，不吃已知的 V2 退款路缺陷）+ RPC 三源确认健康 + ingest 通，**唯一待 = Owner GO**。tha3l（canary#1）已回填、K-18 那道闸已因果证明解开（1207 次失败→0，有天然对照组），但它是单边盘，卡在 V2 退款路（`cancelMarketLive` 零调用方，见下），端到端还没走通——**canary#1 的价值是"证明回填有效"，不是"证明结算复活"，别混着报**。
- **getBlockAtDaa 修法 = 设计 v0.3 已 commit（`69ce2b9e`）并推 origin，NWT 终审 GREEN，等 Owner GO 落码**。解 6 个卡住的盘（426 KAS）：chain-walk 解 2 个（3mzoh/s6zwj），backfill 解 4 个（cswib/8xykm/ldtyn/7jy3s，~1.61M DAA ≈ 8.3 分钟）。
- **V2 退款触发器（`cancelMarketLive` 谁调）= Owner 政策决策，不是纯技术活**：Codex 明确这是"谁/何时授权把 `closed:0→2`（不可逆）"的编排问题，不能 naive 接调用方或首次 degenerate/ABSTAIN 就自动触发。J1 已把 Codex 七条验收折进设计（`b6eab0e7`），等 Owner 拍触发器本身该长什么样。影响 5 个单边盘（~3,509 KAS，其中 9ez2u 一家占 3,500）。
- **kr5l4（分片 21 未封片，22 人 · 820 KAS）= 无法定案，机制未闭合**：J1 的 canonical UTXO 直查已跑过两次，但结构上定不了"leaf 真丢没"（缺一条高检出率的历史链上索引源）。**安全红线钉死：绝不能照 shard-9 phantom 那个"标 manual_recovery_refunded 排除"的修法办**——那会把 22 人的 820 KAS 排除出结算，是实实损失，不是同类问题。
- **一处待补的 commit：`p5_positive_via_fake_relay_sink.test.mjs` / `precond4_handler_zero_sign_calls.test.mjs` 各一行认领注释**（Bettor 已授权，diff 已核对是纯注释无逻辑改动）——卡在 `scripts/m0a-exception-manifest.json` 的 pinned `content_digest` 失配，pre-commit 闸要求"重新 NWT 审并更新 digest"。我没有自己越权更新这个安全 manifest；等 NWT 在频道明确对这两个文件的新 digest 表态后，照常 commit 即可（diff 极小，不是真正的阻塞）。
- **git 状态**：`bshard-m3-deploy` 与 origin 同步（`69ce2b9e`）。今夜确认team其他人（J1/Bettor）也在直接 push origin——§7 那条"单 git 写者"在实践里已经不是绝对的，接位先跑 §1 自查命令看真实 ahead/behind，别假设自己是唯一写者。
