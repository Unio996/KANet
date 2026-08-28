# J1 交接: watchdog 计划任务提权读取 (KANet-UI → J1, r14 B 提权运维)

> KANet-UI 2026-08-28T0620Z · 非提权做不了, 交 J1 提权。原为 J1 欠项①(接过后实做非提权部分, 提权部分交回)。

## 我(非提权)已做的读数
- `Get-ScheduledTask -TaskName KANet-Net-Watchdog` / `KANet-KaspadWatchdog` ⇒ **两个都 NOT FOUND**。
- 广搜 `Get-ScheduledTask | Where TaskName -match 'KANet|watchdog|kaspad|net-watch'` ⇒ **零匹配**。
- sanity: 非提权**可枚举 194 个任务**(我不是全盲), 但两目标不在其中。
- 详见 `scratch/_kanetui_task_xml_report.md`(非提权报告全文)。

## 为什么交 J1
🔴 非提权**无法区分**两种可能:
- (a) 两任务**根本没注册**(Net-Watchdog 从没建 / KaspadWatchdog 从没装), 或
- (b) 两任务**以 SYSTEM/受限 ACL 存在**, 非提权隐身(194 可见任务是我有权读的那批)。
只有**提权**才能定权威状态。

## 请 J1(提权)做
1. `schtasks /Query /TN "KANet-Net-Watchdog" /XML` + `/V /FO LIST` —— 存在? 动作命令行? 触发器? 运行账户? Enabled?
2. `schtasks /Query /TN "KANet-KaspadWatchdog" /XML` + `/V /FO LIST` —— **应 Disabled**(D-013 §3: watchdog 三态 enable 前保持 Disabled; 启用前置 = READY + VA 25/25∧8/8 + NWT GREEN + `KASPAD_WATCHDOG_TESTMODE` unset 断言 + Bettor 令)。确认或修正为 Disabled。
3. 若 (a) 两任务不存在:
   - Net-Watchdog: 按 J1 原设计建(动作/触发器/账户由 J1 定, 我无该设计)。
   - KaspadWatchdog: **enable 前不建 / 保持 Disabled**; 真启用走 D-013 §3 五前置 + `docs/2026-08-28-postsync-maintenance-window-runbook-v0.4.md` §watchdog-enable。

## 期望回报形 (J1 → commit / SendMessage)
- 每任务一行: `<name>: exists=<y/n> state=<Ready/Disabled/…> runAs=<acct> action=<exe+args 摘要> trigger=<类型>`
- KaspadWatchdog **务必确认 state=Disabled**(或不存在); 若发现 Ready/Running ⇒ 🔴 立即报(IBD 期不该活)。
