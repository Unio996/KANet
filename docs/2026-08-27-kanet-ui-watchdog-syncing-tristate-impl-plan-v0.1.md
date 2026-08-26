# kaspad-watchdog 探针 SYNCING 三态 · 落码计划 v0.1（Owner 批材料·只写不改码）

> **Status**: DRAFT v0.1 · KANet-UI 2026-08-27 · Bettor 派工 (VB-9) · **只写计划不改码**——watchdog 是 **live 机制**且归 Owner/J1 域(计划任务 SYSTEM)。本稿是给 Owner 批"落码 SYNCING 三态"的材料。
> **依据**: 探针稿 v0.4 三态设计(`docs/2026-08-26-kanet-ui-kaspad-probe-ibd-vs-dead-design.md`, NWT 已审) + VB-8 实核(现网 dd1dcd72 版 daa=0 会误判死重启, 只是 watchdog 未在跑)。
> **改动对象(落码时)**: `scripts/kaspad-rpc-probe.mjs`(退码) + `scripts/kaspad-watchdog.ps1`(消费)。每条带 file:line。

## §1 现误判链（VB-8 实核·要修的就是这条）
- `kaspad-rpc-probe.mjs:87-89`: `const daa = ...; if (!(daa > 0n)) die('empty-data:daa=', 3)` —— IBD header 阶段 daa 合法=0 却判 code 3。
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
**`:103` verdict 映射**(改):
```
- $verdict = if ($code -eq 0) { 'Alive' } elseif ($code -in 2,3,4,5) { 'Fail' } else { 'Unknown' }
+ $verdict = if ($code -eq 0) { 'Alive' }
+            elseif ($code -eq 7) { 'Syncing' }        # IBD 中 = 不重启
+            elseif ($code -eq 8) { 'Stalled' }        # 卡 = 只告警
+            elseif ($code -in 2,4,5,9) { 'Fail' }     # 身份不符/超时/连不上/无进程 = 真问题
+            elseif ($code -eq 3) { 'Fail' }           # isSynced 真但 daa 坏(收窄后罕见)
+            else { 'Unknown' }
```
**主循环 `:115+`**(增 Syncing/Stalled 分支, 在 Alive 后 Fail 前):
```
+ } elseif ($r.Verdict -eq 'Syncing') {
+     $failCount = 0                                    # IBD 中 = 健康推进, 清零, 绝不 Start-Process
+     Log "kaspad SYNCING (IBD in progress, no restart): $($r.Reason)"   # 每 N tick 或变化时记一次(防刷屏)
+ } elseif ($r.Verdict -eq 'Stalled') {
+     Log "kaspad SYNC-STALLED (no consensus progress > STALL_MS, alert only, NO restart): $($r.Reason)"
```
- `:130-155` 的 Fail→failCount→memgate→Start-Process 链**保持**, 但现在**只有真 Fail(code 2/4/5/9/收窄3)进得来**; SYNCING/STALLED 到不了它。memgate + crash-loop 刹车**仍在 Start-Process 前**(v0.4 §0.5, 不动)。

## §4 对照臂 VA（落码后验收·预注册）
| # | 场景 | 构造 | 预期 |
|---|---|---|---|
| VA-1 | **daa=0 活节点不重启**(今晚实况) | 对现 22428(daa=0/headers 推进/isIbdPeer 在)跑新探针两次 | code **7 SYNCING**, watchdog **不 Start-Process**, kaspad PID 不变 |
| VA-2 | 真死重启 | 单测: `Get-CimInstance kaspad.exe` mock 空 | code **9/DEAD:no-process** → memgate 过 → Start-Process |
| VA-3 | 同步后回 HEALTHY | isSynced=true ∧ daa>0(等 IBD 完成/或 J1 :3400 已同步) | code **0 ALIVE**, failCount=0 |
| VA-4 | STALLED 只告警 | 单测: 共识计数器冻 >STALL_MS | code **8**, Log 告警, **无 Start-Process** |
| VA-5 | CreationDate 变不连锁拉 | kaspad 被外部重启(新 PID) | Log 'restarted' + failCount=0, 不再拉 |
| VA-6 | memgate 仍在前 | 真 DEAD 但 free commit < 8GB | refuse-start:low-commit, 无 Start-Process(v0.4 §0.5 保留) |
- 单测层用 `scripts/j1-watchdog-*.test.sh` 同族(已有 mutants/test 约定)。

## §5 回滚
- 单 commit: `git revert <落码 commit>` 即回二态(daa=0 判 Fail)+ 现 memgate。状态文件删除(无副作用)。
- 因 watchdog 是 live 机制: 落码后**先在 watchdog 未启用时验收 VA**(J1 任务单 §0 "同步前不启用任务"), VA 全绿 + Owner 批**才启用任务**。

## §6 与 J1 任务单 §0 衔接
- J1 任务单 §0: "IBD 完成前不得启用 KANet-KaspadWatchdog; J1 提权只查不启贴状态"(VB-8 落地)。
- **本落码的排序**: ①落码(改两文件)→②未启用态跑 VA 对照臂全绿→③NWT diff 审→④Owner 批→**⑤才启用任务**。⇒ 启用任务时 watchdog 已是三态版, daa=0 IBD 不再被误判重启。**在此之前任务保持 Disabled**(潜伏风险由"不启用"兜, durable 由本落码兜)。
- 🔴 本稿只写计划; 落码/启用**全 Owner/J1 域**, KANet-UI 不自行改 watchdog。
