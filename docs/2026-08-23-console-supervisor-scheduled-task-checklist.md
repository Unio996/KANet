# console-supervisor scheduled-task 落地验收清单 (P1②)

> **Status**: CURRENT

背景：`kanet-console-supervisor.sh` 目前是 bash-loop（`nohup bash "$0" _run &`），J1 已实证其失效模式——SSH 会话发起它时，会话结束触发 Windows Job Object 清理，连带杀掉 nohup 保护的整棵进程树。今晚（2026-08-22/23）额外实证：其自身 `start` 子命令的"already running"自检信 pidfile（bash 内部伪 PID），会对已死进程误判为存活（活样本：pidfile 记 94677，Windows 层查无此 PID，真实 supervisor 其实没在跑）。

真持久 = 注册为 Windows Scheduled Task（首字段独立于任何登录会话）。脚本：`scripts/register-console-supervisor-task.ps1`（我写好，未执行——需要管理员权限，我全程非 admin）。

## 前置

- 需要提权终端（管理员 PowerShell）。
- 确认没有旧的 bash-loop supervisor 还在跑（避免两个 supervisor 同时管一个 console）：
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='bash.exe'" | Where-Object { $_.CommandLine -like '*kanet-console-supervisor.sh*' -and $_.CommandLine -like '*_run*' }
  ```
  **必须用这条谓词（进程名+命令行内容），不要信 `logs/pids/console-supervisor.pid`**——今晚证实这个 pidfile 会撒谎。若有命中，先 `Stop-Process -Id <真实PID> -Force` 停掉旧的。

## 执行

```powershell
# 管理员 PowerShell
cd D:\kanet-tn12
.\scripts\register-console-supervisor-task.ps1 -RunAsUser SYSTEM   # 或指定域账户，见脚本头注权衡
Start-ScheduledTask -TaskName 'KANet-Console-Supervisor'
```

`-RunAsUser` 权衡（脚本头注已写，此处重复一遍免得漏看）：
- `SYSTEM`：最耐久（不随登出消失、无需存密码），**但代价是非提权 agent 以后连它都停不掉**——今晚 console/kaspad 撞过的同一堵权限墙会原样复制到 supervisor 身上。
- 具体域账户：与今天行为一致（同用户可不提权重启），但需要交互式注册时输入密码。

**这个取舍我不代拍，J1/Owner 执行时定。**

## 验收（按今晚已验证过的方法，不要用 pidfile）

1. **任务本身注册成功**：
   ```powershell
   Get-ScheduledTask -TaskName 'KANet-Console-Supervisor' | Select State, LastRunTime, LastTaskResult
   ```
   `State` 应为 `Running`。

2. **真实进程存在**（同前置那条谓词，现在应该命中 1 条）：
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='bash.exe'" | Where-Object { $_.CommandLine -like '*kanet-console-supervisor.sh*' -and $_.CommandLine -like '*_run*' } | Select ProcessId, CreationDate
   ```

3. **日志心跳**：`logs/console-supervisor.log` 应有一条新的 `supervisor start pid=...` 行（注意：这条 pid 仍是 bash 内部伪 PID，只作时间戳对照用，不要拿它去匹配 Windows 层 PID）。

4. **真正的持久性测试**（这是本次要解决的核心问题，不要跳过）：
   - 从一个 SSH 会话里手动杀掉 console 进程（`Stop-Process` 或让 wasm-trap 自然发生），确认 supervisor 侦测到 3 次健康检查失败后拉起新 console。
   - **关键对照**：从一个"会话结束会触发 Job Object 清理"的路径（比如 SSH 登出）验证 supervisor 自己没有跟着消失——这正是 bash-loop 版本失效的地方。方法：注册完任务后，从 SSH 登入触发一次 `Start-ScheduledTask`（如果任务本身没设成自动 AtStartup 就绪），登出该 SSH 会话，几分钟后从另一个连接方式（RDP/本机终端）重新查步骤 2 的谓词，确认进程仍在。

5. **重启穿越测试**（可选，影响面较大，建议排到非高峰期做）：
   - 重启这台机器，确认 `AtStartup` 触发器真的把 supervisor 和它管的 console 都拉起来。

## 完成后

- 回填 `docs/DECISIONS.md` 或 COORD-LEDGER 一条，记下最终选的 `-RunAsUser` 值和验收结果（尤其第 4 条的对照结果）——这样下次有人查"supervisor 靠不靠得住"能查到实测证据，而不是重新猜。
- 若验收通过，`RPC_HEALTH_SELF_RESTART=1` 才具备开启条件（rpc-health-degradation-alert.mjs 的自退动作依赖这里的可靠拉起方，见该文件顶部注释）。
