# J1 · 四件欠项交付（2026-08-29）· r13 §3 / r14 §1-B

> 全部为提权亲跑读数。未动 kaspad/console/relay，未启用任何任务。

## ① 任务 XML（回 KANet-UI 交接件：定权威状态）

**答案 = 情况 (b)：两任务都存在，只是非提权被 ACL 隐藏。** 逐任务一行：

`
KANet-KaspadWatchdog : exists=y state=Disabled  runAs=SYSTEM action=powershell -NoProfile -ExecutionPolicy Bypass -File "D:\kanet-tn12\scripts\kaspad-watchdog.ps1"  trigger=At system start up  nextRun=N/A
KANet-Net-Watchdog   : exists=y state=Ready     runAs=SYSTEM action=powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File D:\kanet-ops\net-watchdog.ps1  trigger=One Time Only + Repeat every 2 min  nextRun=29-Aug-26 00:56
KANet-Net-Watchdog-Boot  : exists=y state=Ready runAs=SYSTEM action=同上 net-watchdog.ps1  trigger=At system start up
KANet-TN12-BootSequence  : exists=y state=Ready runAs=SYSTEM action=powershell ... -File D:\kanet-tn12\scripts\kanet-boot-sequence.ps1  trigger=At system start up
KANet-Console-Supervisor : exists=y state=Ready runAs=SYSTEM action=bash -lc "cd 'D:/kanet-tn12' && bash scripts/kanet-console-supervisor.sh _run"  trigger=At system start up
`

- ✅ **KaspadWatchdog = Disabled**，符合 D-013 §3（enable 前保持 Disabled）。**无需修正。**
- 🟡 **更正我 8/28 的一条过度警报**：我当时报「TN12-BootSequence 与 Console-Supervisor 是 Ready，任一触发就会重启 kaspad/console 打断 IBD」。**不准确** —— 这三个 Ready 任务的触发器都是 At system start up，**只在开机时触发，不会自发运行**，对当前 IBD 无风险。唯一周期运行的是 Net-Watchdog（每 2 分钟）。特此更正，免得据此误判。

## ② reap 提权 dry-run 三桶（已于 8/28 交付，此处复述结论）


ode_total=45 candidates=0 unknown=0 excluded=45；KANet-UI 非提权那次的 unknown=1 已归零 —— 那个 pid 19928 = 
ode D:\kaspa-tn12-mining\tn12-dag-health-probe.mjs（ppid 3432 挖矿 watchdog 派生的 DAG 健康探针，与 console 无关）。**当前零候选，-Apply 无事可做，未跑。**
🟡 另报一个脚本缺陷：logs/reap-<ts>.json 带 BOM 写出，JSON.parse 直接 SyntaxError: Unexpected token '\uFEFF'，任何 JSON 消费者读不了这份证据文件。修法一行：Out-File -Encoding utf8 → [IO.File]::WriteAllText(,,[Text.UTF8Encoding]::new(False))。

## ③ j1-patch.ps1 -Apply + index.js — commit 57fde30f

- dry-run 两锚点精确命中 → -Apply → indstr __booted 命中 4 处 → **
ode --check 退出码 0** → 备份 index.js.bak-j1-20260826 在位（54,207 B → 新 56,244 B）。
- 改动：顶层 handler 加 __booted 分界（listen 成功前异常 = 致命退出，之后回到 r429 保活语义）；astify.listen 单独 try/catch，EADDRINUSE 给人话原因再 exit(1)。
- **未重启 console** —— 补丁在下次 console 启动时自然生效；重启归 Bettor 令 + 维护窗。

## ④ supervisor-writer 提权读数 — 🔴 pidfile 谎报确认复现

`
实况: PID 12640  owner=NT AUTHORITY\SYSTEM  起于 08/26 03:03:32  ppid=16292
      cmd = "C:\Program Files\Git\usr\bin\bash.exe" D:/kanet-tn12/scripts/kanet-console-supervisor.sh _run
pidfile(logs/pids/console-supervisor.pid) = 5596  →  该 PID 不存在 = bash 伪 PID 坑（KANet-UI 8/22 结论复现）
日志尾: 仅 health fail #1/3 与 #2/3（最后一条 08-27 11:49:49），**从未累计到 3 ⇒ 从未真正重启过 console**
被守对象: :3200 = PID 27412, owner=SYSTEM, 起于 08/26 03:03:18
`

⇒ supervisor **在跑且判活正常**（没误杀）；但**任何按 pidfile 判活的代码都会拿到错误答案**，判据必须用 Get-CimInstance 的 CommandLine 实况。
⇒ 另注：console 与 supervisor 均以 **SYSTEM** 运行（= eference-console-runs-as-system-not-admin 那条老病仍在），维护窗若要改 RunAsUser 需 Owner 定凭据。

## 边界

未启用任何计划任务；未重启 console/kaspad/relay；-Apply(reap) 未跑；本次仅 index.js 一处文件改动并已 commit。