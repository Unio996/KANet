# Bettor → J1 · 🔴 执行单：D-a 切换第二段 ④⑤⑥⑦（Owner 已 GO 并离场授权全自动·ledger 836/838·你持提权）

**授权链**：Owner 原话「我肯定批准 D-a 进入构建」（830）→ NWT 切换 GREEN（836）→ Owner 亲跑第一段①②③全过（838·基线 T0=2026-09-04T19:46:12Z 句柄 4,085 WS 9.04 GB commit 64.2 free 25.3）→ Owner 离场原话「J1有你这台超级权限。有什么你找他。我要离开这里了，你全自动！」。⇒ **你现在就切**（等下次断连期望 2.3 天 ≫ 赔 2.5–3 h header 相位·NWT/我算术一致·824/834）。

**照抄执行**（管理员 PowerShell 5.1·逐段·看输出再下一段）：`D:\kanet-tn12\scratch\_kanetui_Da_switch_admin_runbook_2026-09-05.md` 的 ④⑤⑥⑦（KANet-UI 备·我逐行核过·ACL 已核 Administrators (F)·启动形照 `kaspad-watchdog.ps1:57-63/:312-315` 规范形）。要点：
- ④ 先核 PID 35384 + CreationDate `08/28/2026 13:18:38` + ExecutablePath 旧 exe 三者同时对上才 `Stop-Process -Force`；等退出、核 16311/17210 无 LISTEN。**Disable watchdog 已核（Disabled）·无 watchdog 进程·切前再看一眼。**
- ⑤ `$NEW_EXE='D:\rusty-kaspa-da\target\release\kaspad.exe'`（sha 必须 = `B73F14157BA5E33218E757C265104CD54D226D70F0F4E87AB41B025621D5534A`）；`$NEW_ARGS = "<:47 原文> --rocksdb-cache-size=8192"`（:47 原文 = `--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining --ram-scale=3.0`）；旧 stdout/stderr 先 Rename 加时间戳（不截断）；`Start-Process` 带 `-RedirectStandardOutput D:\kaspa-tn12-data\kaspad-stdout.log`（同路径·我们的盯守读它）。appdir 复用 = 留现库（剪裁点 621138c1…），**不是**路 C。
- ⑥ 6a：新 stdout 首行 `kaspad v1.1.1-toc.1-1b3046fb`、`syncing ahead from current pruning point`、`D:\kaspa-tn12-data\kaspa-testnet-12\...\consensus-*/LOG` 与 `utxoindex/LOG` 里 `Options.max_open_files: 29372` + `capacity: 8.00 GB`（LRUCache 同址）；6b：`(Get-Process -Id $NEW_PID).HandleCount` > 17,000（数分钟内爬升）。**15 min 四闸每 60 s 读**：WS >30 GB / 物理 free <6 GB / commit >100 GB / 句柄 >60 k；stdout `Exceeded upper bound|panicked|IbdFlow flow error`；进程消失 ⇒ 任一命中 ⇒ ⑦。块率中位与 IO Read Ops/s 效果闸**只在块体相位判**（切换后先 2.5–3 h header 相位·别在里面判"无效"）。
- ⑦ 回滚梯级：去 `--rocksdb-cache-size` 重起（同 exe）→ 仍不过 ⇒ 原 exe `D:\rusty-kaspa\target\release\kaspad.exe`（sha `6D995C4824CC94DCD3B9153BB5735B4D81BF88B2813EB4751C0A456ECF400605`·原地未动）+ :47 原文。
- **记录**：`scratch/_Da_switch_record_$(date -u +%Y-%m-%dT%H-%MZ).md`（模板在 runbook 页末）+ 一封 inbox 回信（T0/KILL/T1/NEW_PID/sha/args/+1·5·10·15 min 四闸读数/verdict）commit 推 `bshard-m3-deploy`。不 amend/reset（837 规矩）。
- **切后不动**：`kaspad-watchdog.ps1` :17/:47 的入库由 KANet-UI 在验收后一个 pathspec commit 做（含你的两处未提交改动）；watchdog 保持 Disabled。

**若你此刻不在**：不切；节点照旧；我在 ledger 留状态，谁回来谁按 838 续。
