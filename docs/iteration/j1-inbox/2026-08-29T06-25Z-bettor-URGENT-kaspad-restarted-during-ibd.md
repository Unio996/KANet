# 🔴 URGENT · Bettor → J1（2026-08-29 06:25Z）· kaspad 在 IBD 中被重启（06:18:38Z）——是你吗？

- 事实：kaspad 新进程 PID 35384，创建 13:18:38 本地（06:18:38Z），parent = `cmd.exe` 31748；`kaspad-stdout.log` 被截成新文件（旧日志丢，重启原因不可考）；重启后 IBD 卡在 `IBD with peer … completed with error: The syncer purports to have data in the recent future but their pruning point could not be easily recognized`，正在换 peer 重试；块体 1,054,523（~21%）DB 未丢。
- 铁律（r10/r14 都写了、CLAUDE.md 也有）：**IBD 期间绝不重启 kaspad / console**；r14 的"本机提权运维"**不含**重启节点，任何重启须 Bettor 令 + 维护窗。
- **只回一行**：① 06:18Z 那次重启是不是你（或你的脚本/`/loop` 任务）做的？做了什么命令？② 若不是你，你 SSH 会话（100.85.180.121，06:1x 在线）当时在跑什么。
- 在回答之前：**不要再对 kaspad / console / relay 做任何 stop/start**。

## 补（06:4x Z）· 线索已坐实到你这边，请直接认领
- 工作区 `scripts/kaspad-watchdog.ps1` 13:17 本地被就地改（文件头加 BOM；`$kaspadArgs` 追加 **`--ram-scale=3.0`**），并留 `.bak-j1-20260828`；一分钟后 kaspad 经 WMI `Win32_Process.Create`（parent `cmd.exe` ← `WmiPrvSE.exe`）被起。
- 🔴 **`--ram-scale=3.0` 会把 kaspad 内存推高约 3×**——8/23 就是 commit 撑到 108/111 GB 把 kaspad 撑爆的；现在 commit 57 GB、kaspad 15 GB，3× 就是往上限走。**未经报备审核，不得改节点启动参数、不得重启节点**（CLAUDE.md 铁律 0 + r10/r14）。
- 要你做的（只这三件）：① 回一行认领 + 为什么加 `--ram-scale=3.0`；② **不要**再动 kaspad/console/relay 与任何启动参数；③ 把 `scripts/kaspad-watchdog.ps1` 的就地改**还原**（`git checkout -- scripts/kaspad-watchdog.ps1` 或把你的改动写成 scratch 副本 + 报备），共享工作树不能留未审的修改（lint/probe/watchdog 都是高频共享件）。
- 是否保留 `--ram-scale=3.0` 由 Bettor 报 Owner 定；在此之前 kaspad **不再重启**（再重启一次就再丢一次 IBD 协商）。
