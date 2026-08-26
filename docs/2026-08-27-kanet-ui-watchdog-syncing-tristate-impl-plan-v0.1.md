# kaspad-watchdog 探针 SYNCING 三态 · 落码计划 v0.1（Owner 批材料·只写不改码）

> **Status**: DRAFT **v0.2** · KANet-UI 2026-08-27 · Bettor 派工 (VB-9) · **只写计划不改码**——watchdog 是 **live 机制**归 Owner/J1 域。给 Owner 批"落码 SYNCING 三态"的材料。
> **v0.2(应 NWT GREEN-WITH-2-MUST)**: MUST③ crash-loop 刹车用**独立于 failCount 的 restart-attempts-in-window 计数**+写死 N/T+自重启 vs 外部重启判别(§2b/§3c)。MUST④ watchdog verdict **显式分支** 7→SYNCING/8→STALLED/9→DEAD, **不落 else⇒Unknown**(§3b)。非阻塞: 进度信号 RPC-based ①③ 承重、stdout ② 软加; STALLED 60min 阈合理(今晚 49min 判 SYNCING-warn 正确)。**两 MUST 不落不许启用任务**。
> **依据**: 探针稿 v0.4 三态设计(`docs/2026-08-26-kanet-ui-kaspad-probe-ibd-vs-dead-design.md`, NWT 已审) + VB-8 实核(现网 dd1dcd72 版 daa=0 会误判死重启, 只是 watchdog 未在跑)。
> **改动对象(落码时)**: `scripts/kaspad-rpc-probe.mjs`(退码) + `scripts/kaspad-watchdog.ps1`(消费)。每条带 file:line。

## §1 现误判链（VB-8 实核·要修的就是这条）
- `scripts/kaspad-rpc-probe.mjs:89`: `die(...empty-data:daa=..., 3)`(daa 判据在 :87-89 段)—— IBD header 阶段 daa 合法=0 却判 code 3。(全路径, 避与 `scripts/task0-rpc-probe.mjs` 混)
- `kaspad-watchdog.ps1:103`: `$verdict = ... elseif ($code -in 2,3,4,5) { 'Fail' }` —— code 3 归 Fail。
- `:130` `$failCount++`; `:132` `if ($failCount -ge $FAIL_THRESHOLD(3))`; `:152/:155` memgate 过则 `Start-Process`(重启 kaspad)。
- ⇒ daa=0 稳态 3min 后重启 kaspad = 打断 IBD = 8/23 那类"恢复无进度门重造故障"。memgate(kaspad 8GB)在空闲 commit 足时**不挡**。

## §2 三态判据（写死·Bettor 定 + v0.4 对齐）
| 态 | 判据(信号) | 动作 |
|---|---|---|
| **DEAD** | (a) `Get-CimInstance Win32_Process -Filter Name='kaspad.exe'` **空**(无进程) —— 唯一真死信号 | **重启**(过 memgate + crash-loop 刹车后 Start-Process) |
| **SYNCING** | 进程活 **且** RPC 答(network=testnet-12) **且** (`getInfo().isSynced=false` ∨ daa=0) **且** 有进度信号任一: ①headerCount/blockCount/daa 相对上次采样单调不降(状态文件)②`kaspad-stdout.log` 尾 "Downloaded N headers" 行在推进(实测 +1000/min, 05:22:50 时 58000)③`getConnectedPeerInfo` 有 `isIbdPeer=true` 对端 | **只告警不重启**(failCount=0) |
| **HEALTHY** | `isSynced=true` ∧ `daa>0`(推进) | failCount=0, 静默 |
| (SYNC-STALLED) | SYNCING 但共识计数器 >`STALL_MS`(默认 60min, v0.4 MF-1)零进度 | 只告警(不重启), 交操作员 |
- 🔴 **CreationDate 变 ≠ DEAD**(v0.4 §L1): kaspad 被别人重启(新 PID/CreationDate)⇒ 记 `restarted` + failCount=0 让新实例 IBD, **不判死不再拉**(防连锁)。Bettor "CreationDate 变"作**重启发生的标记**, 非"该重启"信号。
- **心跳定义**: `kaspad-stdout.log` 的 "Downloaded N headers from the pruning point chain segment" 行(IBD 阶段 ~35-60s 一行)= IBD 存活心跳; 尾行时间戳 >N min 不动 + 共识计数器不动 ⇒ 疑 STALLED(非立即 DEAD)。

## §2b crash-loop 刹车（MUST③·写死·独立于 failCount）
🔴 **独立计数**: 刹车用**自己的 restart-attempts-in-window 计数** `restartAttempts[]`(每次真 Start-Process 记 {ts, spawnedPid}), **不复用 failCount**(failCount 会被 SYNCING/CreationDate-reset 清零, 刹车不能跟着清, 否则 8/23 无限拉起)。
- **写死定义(建议值+依据)**: **N=5 次 restart / T=5 min 窗** ⇒ 停拉 + 升 `STALLED-escalate`(交操作员告警, 非重启); 触发后 **30 min cooldown**(cooldown 内即便真死也只告警不拉)。依据 = 照 `kanet-console-supervisor.sh` 现有 `max_restarts=5 restart_window=300s cool_down=1800s`(实测基线值, 同族机制复用不另拍)。env 可覆盖 `KASPAD_WATCHDOG_MAX_RESTARTS`(默认 5)/ `_RESTART_WINDOW_SEC`(300)/ `_COOLDOWN_SEC`(1800)。
- 🔴 **CreationDate-reset 只清 failCount, 不清刹车计数**: kaspad 换 PID/CreationDate ⇒ failCount=0(让新实例 IBD), 但 `restartAttempts[]` **保留**(否则外部重启/自重启都清刹车 = 连锁拉起回来)。
- 🔴 **自重启 vs 外部重启判别(MUST③)**: watchdog **记录自己上次 Start-Process 的 {ts, spawnedPid}**(状态文件 `kaspad-watchdog-state.json`)。下 tick 见 kaspad (PID, CreationDate) 变: 新 PID == 自己上次 spawnedPid(或 CreationDate ≈ 自己 Start-Process 时刻±slack)⇒ **自重启** ⇒ **不 reset 刹车计数**(这次拉起本就计在刹车里, 清了=自清=无限拉); 新 PID ≠ 自己 spawnedPid 且 CreationDate 不匹配 ⇒ **外部重启**(别人/J1 起的)⇒ failCount=0 **且刹车计数可 reset**; 判别失败(读不到)⇒ **fail-closed: 当自重启, 不 reset 刹车**。

## §3 行级 diff 预览（落码时·本稿不 apply）
### 3a. `scripts/kaspad-rpc-probe.mjs`
在 `:80 getBlockDagInfo()` 后**增采**(新增, 不改现有):
```
+ const info = await withTimeout(rpc.getInfo(), TIMEOUT_MS, 'getInfo');           // isSynced
+ const peers = await withTimeout(rpc.getConnectedPeerInfo(), TIMEOUT_MS, 'peers'); // isIbdPeer
+ const ibdPeer = (peers.peerInfo||peers.infos||[]).some(p => p.isIbdPeer);
+ // 读状态文件上次采样 headerCount/blockCount/daa, 算进度(v0.4 §3.2 L-共识)
```
**替换** `:87-90`(daa=0→code 3)为:
```
- const daa = ...; if (!(daa > 0n)) die(`empty-data:daa=${dag.virtualDaaScore}`, 3);
+ const daa = ...;
+ if (info.isSynced && daa > 0n) { /* 落到下方 ALIVE */ }
+ else if (info.isSynced && !(daa > 0n)) die(`empty-data:daa=${dag.virtualDaaScore}`, 3);  // isSynced 真但 daa 坏 = 真数据空(收窄, 罕见)
+ else {  // isSynced=false = IBD 中
+   const progressing = <headerCount/blockCount/daa 相对状态文件增> || ibdPeer;
+   if (progressing || <未超 STALL_MS>) { writeState(...); die(`SYNCING:isSynced=false hdr=${dag.headerCount} daa=${dag.virtualDaaScore} ibdPeer=${ibdPeer}`, 7); }
+   else die(`SYNC-STALLED:hdr=${dag.headerCount} since=...`, 8);
+ }
```
- 新增退码 **7=SYNCING / 8=STALLED**(v0.4 §3.3, 在现 0/1/2/3/4/5/6 上**只加不改**); `:92 ALIVE(0)` 保留但前置改为 `isSynced && daa>0`(v0.4 F-A)。状态文件 `D:\kaspa-tn12-data\kaspad-probe-state.json`(env `KASPAD_PROBE_STATE`)。

### 3b. `scripts/kaspad-watchdog.ps1`
**L1 进程闸(新增, 在 Probe-Tn12Node 前)**:
```
+ $kp = Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'"
+ if (-not $kp) { <DEAD:no-process 分支 -> memgate+crashloop 后 Start-Process> }   # 唯一真死
+ # 记 (PID, CreationDate) 入状态; 变 => Log 'restarted' + $failCount=0 (不判死)
```
**`:103` verdict 映射(改·MUST④ 显式分支·9 单列为 DEAD)**:
```
- $verdict = if ($code -eq 0) { 'Alive' } elseif ($code -in 2,3,4,5) { 'Fail' } else { 'Unknown' }
+ $verdict = if     ($code -eq 0) { 'Alive' }          # HEALTHY
+            elseif ($code -eq 7) { 'Syncing' }        # IBD 中 => failCount=0, 不重启
+            elseif ($code -eq 8) { 'Stalled' }        # 卡 => 只告警, 不重启
+            elseif ($code -eq 9) { 'Dead' }           # no-process(probe 侧) => 真死 => 重启候选
+            elseif ($code -in 2,4,5) { 'Fail' }       # 身份不符/超时/连不上 => 真问题 => 重启候选
+            elseif ($code -eq 3) { 'Fail' }           # 收窄: isSynced 真但 daa 坏 = 非-daa 数据空(罕见)
+            else { 'Unknown' }                        # 仅 code=6/-1/其它探针自身坏; 7/8/9 绝不落这里
```
🔴 **MUST④ 铁律**: 7/8/9 **必须各有显式分支**——落 `else⇒Unknown` 就是设计失效(7 不清 failCount 会累积误判死 / 9 不进重启路真死不拉)。code 3 **收窄**为"isSynced=true 但 daa 非正数 = 非-daa 数据空"(daa=0 的 IBD 走 code 7 不再是 3)。
**主循环 `:115+`**(显式 Syncing/Stalled/Dead 分支 + 刹车; 顺序: Alive → Syncing → Stalled → Dead/Fail → Unknown):
```
  if     ($r.Verdict -eq 'Alive')   { $failCount = 0 }                          # HEALTHY
+ elseif ($r.Verdict -eq 'Syncing') { $failCount = 0; Log-throttled "kaspad SYNCING (IBD, no restart)" }
+ elseif ($r.Verdict -eq 'Stalled') { Log "kaspad SYNC-STALLED (>STALL_MS no consensus progress, alert only, NO restart)" }
+ elseif ($r.Verdict -eq 'Dead' -or $r.Verdict -eq 'Fail') {
+     $failCount++
+     if ($failCount -ge $FAIL_THRESHOLD) {
+         # === MUST3 crash-loop 刹车(独立计数, 在 memgate 之前) ===
+         Prune-RestartAttempts $RESTART_WINDOW_SEC              # 去掉窗外的
+         if ($restartAttempts.Count -ge $MAX_RESTARTS -or (In-Cooldown)) {
+             Log "kaspad CRASH-LOOP: too many restarts in window (or cooldown) -> STALLED-escalate, NO Start-Process, alert operator"
+         } else {
+             # === memgate(v0.4 §0.5, 不动) 在 Start-Process 前 ===
+             # memgate 检查: refuse-start:low-commit/commit-unknown 则 skip; 否则:
+             $proc = Start-Process ...
+             $restartAttempts += @{ ts = (Get-Date); pid = $proc.Id }    # 记入刹车计数
+             Save-WatchdogState @{ lastSpawnTs=(Get-Date); lastSpawnPid=$proc.Id }  # MUST3 自重启判别用
+             $failCount = 0
+         }
+     }
+ }
+ else { # Unknown: failCount 不动(v0.4 L1) }
```
- **DEAD 两路确认同判 no-process**(非阻塞项): (1)watchdog **自身** L1 `Get-CimInstance Win32_Process -Filter Name='kaspad.exe'` 空 (2)probe **code 9**(probe 侧也枚举进程)。两路都 = "无 kaspad 进程" = 真死; 落码时**取两者【或】**(任一判无进程即 DEAD), 避免单路盲区。
- **CreationDate 变的处理**(§2b 判别): 在进 verdict 分支前先跑 §3c。

### 3c. 自/外重启判别 + 刹车计数（MUST③·watchdog 状态文件）
每 tick 进 verdict 分支**前**:
```
+ $cur = Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" | Select -First 1
+ $st  = Load-WatchdogState   # {lastSpawnTs, lastSpawnPid, lastSeenPid, lastSeenCreated}
+ if ($cur -and $st.lastSeenPid -and ($cur.ProcessId -ne $st.lastSeenPid -or $cur.CreationDate -ne $st.lastSeenCreated)) {
+     # kaspad 换实例了 —— 判自重启 vs 外部
+     $mine = ($cur.ProcessId -eq $st.lastSpawnPid) -or ($st.lastSpawnTs -and [math]::Abs(($cur.CreationDate - $st.lastSpawnTs).TotalSeconds) -le $SPAWN_MATCH_SLACK_SEC)
+     if ($mine) { $failCount = 0 }                       # 自重启: 清 failCount, 【不清】restartAttempts(已计在刹车)
+     else       { $failCount = 0; $restartAttempts = @() }  # 外部重启(别人/J1): 清 failCount 且刹车归零(不是我的 loop)
+     # 判别读不到 => fail-closed: 当自重启, 不清刹车
+ }
+ Save-WatchdogState @{ lastSeenPid=$cur.ProcessId; lastSeenCreated=$cur.CreationDate }
```
- `SPAWN_MATCH_SLACK_SEC` 默认 15(Start-Process 到 CreationDate 落地的抖动窗)。状态文件 `D:\kaspa-tn12-data\kaspad-watchdog-state.json`(env `KASPAD_WATCHDOG_STATE`)。
- 🔴 **fail-closed**: 判别失败(状态文件缺/读错)⇒ **当自重启**(不清刹车)——宁可多等操作员, 不可自清致 8/23 连锁。

## §4 对照臂 VA（落码后验收·预注册）
| # | 场景 | 构造 | 预期 |
|---|---|---|---|
| VA-1 | **daa=0 活节点不重启**(今晚实况) | 对现 22428(daa=0/headers 推进/isIbdPeer 在)跑新探针两次 | code **7 SYNCING**, watchdog **不 Start-Process**, kaspad PID 不变 |
| VA-2 | 真死重启 | 单测: `Get-CimInstance kaspad.exe` mock 空 | code **9/DEAD:no-process** → memgate 过 → Start-Process |
| VA-3 | 同步后回 HEALTHY | isSynced=true ∧ daa>0(等 IBD 完成/或 J1 :3400 已同步) | code **0 ALIVE**, failCount=0 |
| VA-4 | STALLED 只告警 | 单测: 共识计数器冻 >STALL_MS | code **8**, Log 告警, **无 Start-Process** |
| VA-5 | CreationDate 变不连锁拉 | kaspad 被外部重启(新 PID) | Log 'restarted' + failCount=0, 不再拉 |
| VA-6 | memgate 仍在前 | 真 DEAD 但 free commit < 8GB | refuse-start:low-commit, 无 Start-Process(v0.4 §0.5 保留) |
| VA-7(MUST③ 刹车) | crash-loop 停拉 | 单测: 喂 restartAttempts = 5 次/5min | CRASH-LOOP STALLED-escalate, **无 Start-Process**, 刹车不被 CreationDate-reset 清 |
| VA-8(MUST③ 自重启不自清) | 自重启不清刹车 | 单测: watchdog Start-Process 后下 tick 见新 PID==lastSpawnPid | failCount=0 但 restartAttempts **保留**(不归零) |
| VA-9(MUST④ 无 else 陷阱) | 7/8/9 各走显式分支 | 单测: probe 返 7/8/9 各一次 | 7→failCount=0 不拉 / 8→warn 不拉 / 9→进重启路(过刹车+memgate); 无一落 Unknown |
- 单测层用 `scripts/j1-watchdog-*.test.sh` 同族(已有 mutants/test 约定)。

## §5 回滚
- 单 commit: `git revert <落码 commit>` 即回二态(daa=0 判 Fail)+ 现 memgate。状态文件删除(无副作用)。
- 因 watchdog 是 live 机制: 落码后**先在 watchdog 未启用时验收 VA**(J1 任务单 §0 "同步前不启用任务"), VA 全绿 + Owner 批**才启用任务**。

## §6 与 J1 任务单 §0 衔接
- J1 任务单 §0: "IBD 完成前不得启用 KANet-KaspadWatchdog; J1 提权只查不启贴状态"(VB-8 落地)。
- **本落码的排序**: ①落码(改两文件)→②未启用态跑 VA 对照臂全绿→③NWT diff 审→④Owner 批→**⑤才启用任务**。⇒ 启用任务时 watchdog 已是三态版, daa=0 IBD 不再被误判重启。**在此之前任务保持 Disabled**(潜伏风险由"不启用"兜, durable 由本落码兜)。
- 🔴 本稿只写计划; 落码/启用**全 Owner/J1 域**, KANet-UI 不自行改 watchdog。
