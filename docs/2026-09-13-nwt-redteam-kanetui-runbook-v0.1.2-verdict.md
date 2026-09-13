# NWT 红队 · KANet-UI TN12 退役 runbook v0.1.2 复审（对 fce3898e 五处 MUST 的闭合判定）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`docs/2026-09-13-kanetui-tn12-retire-mainnet-node-runbook-v0.1.md`（commit `9b0ab9ba`，含 `4f89c420` 主体 + 小补丁，已推）。
> 逐条核对上一轮 `fce3898e` 五处 MUST 是否真闭合；同时按头号铁律做了一次新的独立对抗——不只检查被要求修的地方，也去找没人要求我看的地方。**结果：找到一个新的、真实的验证命令缺陷**，见下方⑥-新。

## 结论一览

| 项 | 裁 |
|---|---|
| ⑥ drain 表扩到全部 11 消费者 + minDepth=20/30min | ✅ **CLOSED** |
| **⑥-新（本次独立发现，非上轮要求）** | 🔴 **PUSH-BACK·MUST-FIX**：§2.2 验证命令 `Get-Process -Name tn12-mining-watchdog-v2` 对这两个 PID **恒为空**（已实测），不管进程死没死都报"已确认停止"——验证步骤本身失效 |
| ① rpc_url SQL 写死 | ✅ **CLOSED** |
| ② 优雅关闭优先 taskkill //F 兜底 | 🟡 **CLOSED-with-caveat**：kaspad/Rust 侧验证扎实（读了源码），Windows/taskkill 侧的关键假设未验证，非阻塞但要如实标注 |
| ⑧ 两实例 mtime+日志链证据 | ✅ **PASS**（达到可接受的证据标准，理由见下） |
| 新 MUST §2.2/2.3 覆盖两套 PID | 🟡 **部分 CLOSED**（`Stop-Process` 命令本身对，配套的验证命令有上面⑥-新那个缺陷） |
| 新 MUST §2.4 Session 0 触发源未定位=不得进GO-1 | ✅ **正确挂起，未过早放行**，且 `9b0ab9ba` 已补提权查询命令给 Owner，进展合理 |

**总判**：GO-1 仍不能放行（§2.4 触发源本身还没查完，这是已知且被正确挂起的阻塞项，不是本次新增）；但**在触发源查完之后**，本 runbook 在放行前还要修一个小问题（⑥-新），修完即可视为地面材料齐备。

---

## ⑥-新：§2.2 验证命令测不出它要测的东西（本次独立发现）

`tn12-mining-watchdog-v2.ps1` 是 PowerShell 脚本，不是独立可执行文件——它的**真实进程名是 `powershell.exe`**，不是 `tn12-mining-watchdog-v2`（同 kaspad-watchdog 那次教训的同一个病，只是这次出现在验证步骤里而不是"谁是父进程"这个问题里）。

**我直接在本机验证**（两个进程此刻仍活着，只读查询）：
```
Get-CimInstance Win32_Process -Filter "ProcessId=13788"   → Name = powershell.exe
Get-CimInstance Win32_Process -Filter "ProcessId=19532"   → Name = powershell.exe, SessionId = 1
Get-Process -Name "tn12-mining-watchdog-v2" -ErrorAction SilentlyContinue   → 完全空（两个进程都在跑，命令却什么都没返回）
```

§103 现在的验证命令是：
```powershell
Get-Process -Name tn12-mining-watchdog-v2,stratum-bridge -ErrorAction SilentlyContinue
```
`stratum-bridge` 这半边是对的（它是独立 `.exe`，`Get-Process -Name` 能命中真实进程名）；`tn12-mining-watchdog-v2` 这半边**从第一天起就不可能命中任何东西**——不管这两个 watchdog 进程是死是活，这条命令的结果都一样是空，执行者会误读成"已确认停止"，而实际上它什么都没验证到。

**MUST-FIX**：改成按 PID 直接查（Stop-Process 那一步已经知道确切 PID 了，不需要按名字猜）：
```powershell
Get-Process -Id 13788,19532 -ErrorAction SilentlyContinue    # 应为空 = 两个 watchdog 真的停了
Get-Process -Name stratum-bridge -ErrorAction SilentlyContinue   # 这半边本来就对，不用改
```
这个修法不影响其他任何判断，是纯粹的验证命令订正，落码量极小，不构成新的阻塞——但**必须在真正执行 §2.2 之前修好**，否则执行者会拿着一个"绿灯"往下走，而灯本身是假的。

## ⑧：两实例 mtime + 日志链证据——够格判据

runbook 自己没有过度声称（§56 原话："这层距离…仍有一层推断距离…最终是否够格由 NWT/Codex 复审判"），这个诚实是对的。我的判断：**够格**，理由不是"日志说了就信"，是一个更强的逻辑——

现在有两个、且只有两个候选启动者（`18576`/Session 0，`24220`/Session 1），`boot-sequence.log` 独立证实两者都在几乎同一时刻（相隔18秒）各自读取并执行了同一份 `kaspad-watchdog.ps1`，而这份文件的最后修改时间（09-06 22:55Z）早于两者的启动时间（09-13 16:45Z 本地）且期间未再改动。**不管 kaspad(16644) 究竟是被这两者中的哪一个拉起的，两者读到的都是同一份、内容确定的文件**——这是一个跨候选者的不变量论证，不是"猜哪个是父进程然后信任它"。唯一没被排除的可能性是"存在第三个、完全独立于这两条已知链的启动者"，但没有任何证据指向这一点，且 kaspad 的实际启动时间（09:48:06Z）正好落在两个候选者各自"等 RPC ready"窗口内，时序自洽。**这满足一个负责任的、可复核的证据标准**，虽然不是"直接读到运行进程的 CommandLine"这个字面最强形式。若未来能提权拿到直读，那是更好的证据，但不是本次放行的必要条件。

## ②：优雅关闭——Rust 侧验证扎实，Windows 侧假设未测（非阻塞，标注即可）

runbook 读了 `core/src/signals.rs` 源码确认 `ctrlc::set_handler` 首次信号触发优雅 `shutdown()`、第二次信号直接硬退——这半边是真的源码验证，不是猜。**但整条链还有另一半没验证**：`taskkill //PID 16644`（不带 `//F`）在 Windows 上对一个由 `Start-Process -WindowStyle Hidden` 启动的**无窗口控制台进程**，是否真的会投递一个能触发 `ctrlc` 处理器的信号——这一半是 Windows 进程信号语义的问题，runbook 只验证了"如果信号送到了，kaspad 会怎么处理"，没有验证"信号到底送不送得到"。

**这不阻塞 GO-1**：即使这个假设是错的（`taskkill` 不带 `//F` 对这类进程直接报错或无效），最坏情况只是"60 秒轮询白等，然后照常走 `//F` 兜底"——这与本审上一轮之前、修复前的行为完全一样（没有让情况变得更差），只是没拿到"优雅关闭"这个想要的好处。**建议**：执行时把这一步当"尝试性优化，不是已证机制"来标注（这句话已经在 §109 写了"标注风险"，只是风险描述的是"RocksDB 未刷盘"，没有点出"这个 taskkill 用法本身是否生效也未验证"这一层）——把这句话补进 §109 即可，不必现在就去实测（实测需要真的对 kaspad 发一次信号，属于执行阶段的事，不是审阅阶段该做的）。

## 新 MUST §2.4 Session 0 触发源——正确挂起，进展合理

`9b0ab9ba` 补的提权查询命令（按 `Actions.Arguments` 内容过滤而非任务名，附 `Principal.UserId` 判断触发身份）设计合理——它已经预见到"任务名可能不含关键词"这个我原本准备提的问题，不需要我再补。这条继续挂起等 Owner 回执，是正确的状态，不构成本次审查的新增问题。

## 给 Bettor 的处置建议

- ⑥-新是本次唯一新发现，落码量极小（一行 PowerShell 命令），建议 KANet-UI 直接改，不需要再走一轮完整复审——改完贴一下 diff 我确认即可，不必重新审全文。
- ②的标注补一句"taskkill 不带 //F 是否对此类进程生效未独立验证"，同样是文字级小改。
- ⑧不阻塞，达到可接受标准。
- §2.4 Session 0 触发源仍是唯一真正挡 GO-1 的项，继续等 Owner 回执。
