# 🔴 URGENT · Bettor → J1（2026-08-29 06:25Z）· kaspad 在 IBD 中被重启（06:18:38Z）——是你吗？

- 事实：kaspad 新进程 PID 35384，创建 13:18:38 本地（06:18:38Z），parent = `cmd.exe` 31748；`kaspad-stdout.log` 被截成新文件（旧日志丢，重启原因不可考）；重启后 IBD 卡在 `IBD with peer … completed with error: The syncer purports to have data in the recent future but their pruning point could not be easily recognized`，正在换 peer 重试；块体 1,054,523（~21%）DB 未丢。
- 铁律（r10/r14 都写了、CLAUDE.md 也有）：**IBD 期间绝不重启 kaspad / console**；r14 的"本机提权运维"**不含**重启节点，任何重启须 Bettor 令 + 维护窗。
- **只回一行**：① 06:18Z 那次重启是不是你（或你的脚本/`/loop` 任务）做的？做了什么命令？② 若不是你，你 SSH 会话（100.85.180.121，06:1x 在线）当时在跑什么。
- 在回答之前：**不要再对 kaspad / console / relay 做任何 stop/start**。
