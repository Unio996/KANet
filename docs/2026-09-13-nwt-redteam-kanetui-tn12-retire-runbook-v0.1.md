# NWT 红队 · KANet-UI「TN12 退役 + 主网只读节点上线」runbook v0.1.1 审（挡 GO-1）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only，本审过程中做过的所有验证均为只读命令：`Get-CimInstance`/`grep`/`sqlite readonly` 查询，未杀进程、未改文件、未碰节点/链）
> 审对象：`docs/2026-09-13-kanetui-tn12-retire-mainnet-node-runbook-v0.1.md`（commit `23a605a6`，已推）。审点：Bettor 派单五项原点 + 三项新增（drain 判据/窗口N、§3条件句是否合意、§1.2 mtime证据链是否够格）。

## 结论一览

| 项 | 裁 |
|---|---|
| ①（原五项之一）LOCAL_ONLY 非严格·停序静默性核对 | 🔴 **PUSH-BACK**：风险条款写对了，但"具体字段待执行时现查"这句本身是个洞——我已查到具体表/键，必须把它写进 runbook，不能留 TBD |
| ②（原）回滚可行性 | 🔴 **PUSH-BACK（新发现）**：§2.3 `taskkill //F` 是强制杀进程，对 RocksDB 这类数据库有未刷盘风险，与"回滚时数据目录原样可续"的假设冲突 |
| ③（原）D:\kaspa-mainnet-data 37GB 处置判据 | 🟡 **PASS（HOLD 合理，给一个默认建议）** |
| ④（原）主网节点参数骨架 | ✅ **PASS-with-note** |
| ⑤（原）四个 GO 检查点是否够 | ✅ **PASS-with-tightening**（建议给 GO-3 补一条准入条件，不加新编号） |
| ⑥（新①）§2.0 drain 四类判据是否够 + 窗口 N | 🔴 **PUSH-BACK（MUST-FIX，本条最重）**：drain 表遗漏了 §1.1 自己列出的至少 5 个真会提交链上交易的消费者，其中两个正是我此前红队点名的 NO-TX-NO-STATE-CHANGE 违反站点 |
| ⑦（新②）§3 条件句改写是否合 PUSH-BACK 本意 | ✅ **PASS** |
| ⑧（新③）§1.2 mtime 证据链是否够格 Codex 3358c4ff | 🔴 **PUSH-BACK（我独立核实后发现证据链指向了错误的进程）** |

**总判**：GO-1 不能在当前版本上发——⑥⑧两条是硬缺口（⑥是钱路安全，⑧是权威判据造假风险，虽非故意）；①②建议一并修。③④⑤无阻塞。

---

## ① LOCAL_ONLY 非严格·停序静默性（原审点）

runbook §2 的风险条款准确复述了我此前的红队发现（`checkConfigured()` 不受 `LOCAL_ONLY` 挡），并给出缓解："停节点前必须先核 DB 里有没有配置外部 TN12 RPC 端点……具体字段待执行时现查"。

**问题**：这条 MUST 缓解本身把"怎么核"留成了执行时现查——而这恰恰是最容易被漏做或做错的一步（执行者若不熟悉 `rpc-health.js` 内部，可能查错表、查错 key，得出"没配置"的假阴性结论，风险条款形同没写）。

**我已核实并可以直接填入 runbook 的答案**：
- 该配置读取路径 = `kasia-console/src/services/rpc-health.js:139` `getConfig('rpc_url')`，写入路径同一个 key，实现在 `kasia-console/src/data/settings/configs.js:6-32`。
- 落地存储 = SQLite 表 `config_entries`，`WHERE key='rpc_url'`（写入时 `category='node'`，见 `settings.js:27`、`system-repair.js:181/190/200` 等写点）。
- **本机现状（只读查询，2026-09-13）**：`SELECT * FROM config_entries WHERE key='rpc_url'` 结果为空——**当前没有配置外部端点，风险条款此刻不构成实际阻塞**，但停节点执行时仍应重新查一遍（这段时间内任何 `settings.js`/`system-repair.js` 的写点都可能改变它）。

**MUST-FIX**：把上面这条 SQL/查询命令原样写进 runbook §2（替换"具体字段待执行时现查"），并注明"若非空，先清空或改成本机 loopback 值再继续，不能假设它一直是空的"。

## ② 回滚可行性（原审点）——新发现：强制杀进程与数据完整性假设冲突

§2.3 步骤 2：`taskkill //PID 16644 //F`。§2.5 回滚假设："kaspad 本身不需要特殊恢复：数据目录本步骤未删，watchdog 拉起后会从原状态继续。"

**问题**：`taskkill /F` 是 `TerminateProcess`，不给进程任何清理机会（不等价于发 Ctrl+C/SIGINT 让进程走自己的优雅退出路径）。kaspad 的存储层（RocksDB）在正常运行时持有打开的文件句柄/写缓冲，强制终止有非零概率留下未刷盘的写、损坏的 `LOCK` 文件，或需要下次启动时做恢复性重放（视 RocksDB 内部 WAL 机制的鲁棒性而定，这不是我能在不实际操作节点的情况下验证的，但"假设强杀后数据目录能无缝续跑"本身是需要证明的断言，不是默认应该假设为真的）。

**MUST-FIX**：§2.3 步骤 2 改为"先尝试优雅关闭（若 kaspad 有 RPC shutdown 方法或响应 `Ctrl+Break`/`GenerateConsoleCtrlEvent`，用它；给出一个超时，如 30s），超时未退出才用 `taskkill /F` 作兜底"。这不是我发明新工序——这是"回滚要求数据目录原样可续"这个既有假设本身要求的前置动作，runbook 现在只写了强杀这一条路。

## ③ D:\kaspa-mainnet-data 37GB 处置判据（原审点）

§4.2 如实标注"未先看清楚不能假设复用/清空",不代执行者做判断——这个 HOLD 本身没问题，是诚实的留白，不是缺口。

**建议（非 MUST，供执行时参考）**：鉴于 D: 现空 758.7 GB 远高于官方最低线，且这份陈旧数据只有 ≈37 GB（半年前、疑似未完成试验留下），默认应偏向"不复用未经验证的半同步数据"——`Rename-Item` 挪到 `D:\kaspa-mainnet-data.old-20260409` 之类的旁路名，全新目录起同步，比"先跑起来看它能不能续传"更安全（续传失败/格式不兼容如果发生在同步过程中途，比一开始就知道要重来更浪费时间且更难诊断)。这只是建议，不阻塞 GO-1（因为 §4 本身在 §3/GO-3 之后才执行）。

## ④ 主网节点参数骨架（原审点）

§4.3 的骨架合理：显式回环绑 borsh RPC（对齐 TN12 2026-07-28 修复后的既有纪律）、不带 `--testnet`/`--enable-unsynced-mining`/`--unsaferpc`，符合我 preconditions 清单里"kaspad RPC 只绑 127.0.0.1"“永不加 `--unsaferpc`”两条 MUST。

**note（非阻塞）**：runbook 没有明确说"P2P 端口（`--listen`，默认 16111）故意不做回环限制"——这是对的（Owner 要求"贡献公共节点"，P2P 理应对外），但既然 RPC 与 P2P 两个端口的暴露策略刻意不同，建议在 §4.3 加一句话点明这是**有意的不对称**，防止将来有人看到"RPC 回环但 P2P 通配"以为是漏改。

## ⑤ 四个 GO 检查点是否够（原审点）

四个点（整体前 / 停节点前可选拆分 / 起主网节点前 / 删除数据独立后置）覆盖了本 runbook 涉及的全部不可逆/半不可逆动作，不需要新增编号。

**建议（非阻塞）**：把 GO-3 的准入条件从"确认 §4.2 陈旧内容已判断清楚"扩成"确认 §4.2 已判断清楚 **且** §2 全部验证命令（消费者已停/挖矿桥已停/kaspad 已停/自启动已禁用）逐条跑过且通过"——现在 GO-3 字面上只挂了一个条件，容易让执行者以为只要想清楚 §4.2 就能进 §4，跳过对 §2 是否真正完成的复核。

## ⑥ §2.0 drain 四类判据是否够 + 窗口 N（新审点，本条最重）

**结论：不够。drain 表覆盖的四类（P2SH 通用 submit / 再平衡 / bshard-close-voter / claim-auto）遗漏了 §1.1 自己列出的至少 5 个会提交真实链上交易的消费者**，我用 `grep` 逐一核实了这些消费者是否调用 `sendCommandAsync`/`submitTransaction` 类路径（真会递交易，不是只读 tick）：

| 遗漏的消费者 | §1.1 里的位置 | 我核实到的真实提交证据 |
|---|---|---|
| **`bettor-prediction-settler.js`** | §1.1 第2行 | `sendCommandAsync` 调用 ×7（`:177/:324/:411/:560/:619/:629/:643`），含 escrow transfer / preimage / sign / submit 多种类型——**这正是我此前红队点名的两处 NO-TX-NO-STATE-CHANGE 违反站点之一**（`:198/:216` 拿到 payout txid 即写状态，无落链核实），停节点这一刻若正好有一笔在飞，drain 表完全没盯它 |
| **`pool-market-settler.js`** | §1.1 第1行 | `sendCommandAsync` 调用 ×10+（`:892/:2486/:2716/:2971/:3022/:3027/:3173/:3477/:3583/:3703`），同样是 broadcast/sign/submit 混合——这是**另一处**我点名的 NO-TX-NO-STATE-CHANGE 站点所在文件 |
| `bshard-settle-daemon.mjs` | §1.1 第3行 | 未逐字核到提交行，但文件名与职责（结算 daemon）与 memory 记录（`minDepth=20` 落地点之一，`:215/:220/:1046`）表明它走的正是 relay 提交路径，需同等纳入 |
| `market-seeder.js` / `pool-market-seeder.js` | §1.1 第4/5行 | 做市 = 主动挂单/吃单，本质就是提交交易的消费者，未核实但职责上必然属于此类 |
| `zk-prove-worker.mjs` | §1.1 第7行 | D-015 记录的 ZK 结算路径最终走 `zk-close-builder.mjs` 构造并提交 covenant spend，属于此类 |

**为什么这不是"多列几个就行"的小修**：drain 步骤存在的唯一理由是"停节点前确认没有交易半路，否则数据目录删除后永远查不清"——如果覆盖面本身有遗漏，drain 判据"通过"这件事**不能证明**真的没有交易在飞，只能证明"我们查过的那四类没有"，这是一个**假阳性风险**：执行者看到 drain 表四项全绿，误以为可以安全进入停节点步骤，而实际上 `pool-market-settler`/`bettor-prediction-settler` 手上可能正压着一笔还没确认的交易。

**MUST-FIX（阻塞 GO-1）**：drain 表必须扩展到覆盖 §1.1 全部已列消费者（至少上表 5 项），"20+ 文件带 setInterval 未逐一列出"那部分也需要至少过一遍 grep 确认哪些会提交交易（哪些是纯读/纯计算可以直接忽略）。这不需要 NWT 或 KANet-UI 现在就做完——但**必须在 GO-1 之前有人做完**，不能带着已知不完整的 drain 表进入执行。

**窗口 N**：本仓已有确认深度的既有惯例——`check_utxo_landed(minDepth=20)`（`pool.js:1532/:1793/:2018`、`bshard-close-transport.mjs:556`、`bshard-settle-daemon.mjs:215/:220/:1046`，J1 phantom-leaf 根治后的统一深度门），不是我发明的数字。**建议**：drain 的判据不是一个固定分钟数，是"每个近期提交的 txid 用 `kaspa_tx_log`/`checkUtxoLanded` 核到 depth≥20（或明确 failed）"；**给一个 wall-clock 兜底/超时值供执行者判断"要不要再等"**：**N = 30 分钟**——理由：TN12 历史记录过降级速率（relay 爬行 0.75 bps 的既有教训），20 个确认在正常速率下几十秒到几分钟就到，30 分钟是留出足够裕量应对降级期，超过 30 分钟还没到 depth 20 应该转为人工判断（可能是真卡住，按既有死锁类问题处理，不再死等）。

## ⑦ §3 条件句改写是否合 PUSH-BACK 本意（新审点）

`docs/2026-09-13-kanetui-tn12-retire-mainnet-node-runbook-v0.1.md` §3 现文本："若该 peer 在线，可以重新同步；若它不在线或以后彻底下线，TN12 数据一旦删除即不可恢复"——**这正是我原话要求的收窄方向**（从"随时能"改成条件句，且引用了具体的 peer 失联记录 ledger (992)(993)(999) 作为依据，没有编造新的确定性）。**PASS**，无需再改。

## ⑧ §1.2 kaspad 命令行 mtime 证据链是否够格 Codex 3358c4ff 标准（新审点）——我独立核实后发现证据链指向了错误的进程

Bettor 的论证：watchdog.ps1 文件最后改于 09-06 22:55Z（早于本次 09-13 09:45:56Z watchdog 进程启动），且文件此后未再改 ⇒ 推断"运行参数 = 脚本 :47 现值"。这个推理形式本身没问题（若前提成立），但**前提需要"watchdog(24220) 就是启动了当前这个 kaspad(16644) 的那个进程"——我独立查了进程树，这个前提不成立**：

```
Get-CimInstance Win32_Process -Filter "ProcessId=16644"（kaspad）
  → ParentProcessId = 18576, SessionId = 0, CreationDate = 2026-09-13T09:48:06Z, CommandLine=(空,同runbook已知的非提权限制)

Get-CimInstance Win32_Process -Filter "ProcessId=18576"（kaspad 的真实父进程）
  → Name = powershell.exe, SessionId = 0, CreationDate = 2026-09-13T09:45:38Z（比 watchdog 24220 早 18 秒！）, CommandLine=(空)

Get-CimInstance Win32_Process -Filter "ProcessId=24220"（runbook/Bettor 指认的"watchdog"）
  → SessionId = 1（不是 0）, CommandLine 可读（Session 1 非提权可读）=
    "powershell.exe" -NoProfile -ExecutionPolicy Bypass -File D:\kanet-tn12\scripts\kaspad-watchdog.ps1
  → 确认 24220 确实在跑 kaspad-watchdog.ps1，但它的 CreationDate=09:45:56Z **晚于** 18576（09:45:38Z）
    ⇒ 18576 不可能是 24220 的子进程（子进程创建时间不能早于父进程）
```

**结论**：kaspad(16644) 的真实父进程是 **18576**，不是 24220。24220 确实是 kaspad-watchdog.ps1 的一个实例（这条我独立核实为真），**但它不是启动当前这个 kaspad 的那个进程**——18576 是一个尚未确认身份的 Session-0 进程（其 `CommandLine` 因同样的非提权限制读不到），可能是：
1. 另一个更早启动的 kaspad-watchdog.ps1 实例（若真如此，boot 链上同时存在两个 watchdog 实例，本身是一个此前无人发现的问题，值得单独排查——"只启不杀"的两个实例会不会互相冲突/重复拉起，未知）；
2. 某个完全不同的启动路径（如某个 `Get-ScheduledTask` 名称过滤未覆盖到的计划任务，因为 kaspad 与 18576 都在 Session 0，而 Session 0 是服务/计划任务常见的运行上下文，与"Startup .lnk 应该在用户交互 session"这一 runbook 自己的假设不符）。

**这意味着 mtime 论证证明了一个真事实（24220 在跑 kaspad-watchdog.ps1，文件自 09-06 起未改），但这个真事实没有连到"当前 kaspad 的启动参数"这个待证命题上**——论证的连接环节（"24220 是 kaspad 的父进程"）被我的独立查询证伪。**这不满足 Codex 3358c4ff"只认运行进程命令行"的标准**：现在有的是"某个我们能读到命令行的进程恰好在跑正确的脚本，但它没有启动 kaspad"+"真正启动了 kaspad 的那个进程读不到命令行"，两句拼在一起仍然是"没读到 kaspad 真实命令行"。

**MUST-FIX（阻塞 GO-1 对"D-c/D-d 不在跑"这条判据的采信，不阻塞其余部分）**：
1. **最直接**：找一次提权（同 §1.2 待办已经写的"需 J1/Bettor 提权读一次"）直接读 **18576**（不是 16644，进程可能已重启导致 PID 变化，届时改读当时的 kaspad 真实父 PID）的 `CommandLine`——这一次查询就能把"猜测链"换成"读数"。
2. **次选**：若坚持不提权，改用**行为证据**代替进程树证据——D-c/D-d 是否在跑，可以从 kaspad 自己的**日志行**（rusty-kaspa.log 是否出现 `IBD self-trigger`/`[node-trust]` 一类既有 canonical 行）或**运行时行为**（是否表现出既有 D-c 记录过的"self-trigger IBD"周期性模式）间接判断，不需要读命令行——这条路本 runbook 未尝试，值得作为提权之外的备选。
3. **顺手排查**：18576 是否是第二个 kaspad-watchdog.ps1 实例本身值得一并确认（哪怕只是为了排除"两个 watchdog 同时跑"这个新出现的疑点），不确认清楚，"只启不杀"的假设在有两个实例时是否还成立是未知的。

**范围声明**：本条 PUSH-BACK 只针对"§1.2 现在这份 mtime 证据链是否够格证明 kaspad 当前无 D-c/D-d 标志"，不否定 runbook 其余部分；也不代表 kaspad 实际带了 D-c/D-d 标志——**只是现在的证据不足以说它没带**，两者不是同一句话（同 CLAUDE.md 通则反复强调的"作用域"纪律）。

## 给 Bettor 的处置建议

- ⑥⑧ 是 GO-1 前必须关闭的缺口（⑥钱路安全/⑧判据造假风险），①的 TBD 已经替你填好答案，直接抄进 runbook 即可，不需要再派工去查。
- ②③④⑤ 不阻塞，②建议一并改，③④⑤是可选加固。
- 建议 KANet-UI 出 v0.1.2 收敛这两条硬缺口后，我再过一遍（预计比这次快，因为大部分骨架已经审过、只需盯这两条新增内容）。
