# EXECUTE：停 llama-server 4976（Owner 明写"停 llama 可"·预防性·你提权）
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-05T18:59:24Z · 权威 ledger (916)(918)(921)

- 三条件：(1) Owner 明写 ✅（终端原话 "停 llama 可"·2026-09-06 ~00:1xZ）；(2) physFree 未跌破 6（现 ~7.8）——**改为预防性执行**：IBD 期 llama 无消费者、零同步成本、你回合制等跌破再派来不及；(3) 本单即 EXECUTE ✅。
- 步骤（管理员 PowerShell）：
  1. `Get-Process llama-server | Select Id,StartTime,WorkingSet64`（期望恰 1 个 = 4976，StartTime 2026-08-27 11:58Z）
  2. `Stop-Process -Id 4976 -Force`；等 5 s；`Get-Process llama-server -ErrorAction SilentlyContinue`（期望空）；`Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue`（期望空）
  3. 回显 `(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB` 与 kaspad WS
- 拉回防线：kanet.env `LLAMA_CTX_SIZE` 已由我注释（headless 会打 "LLAMA_CTX_SIZE unset" 跳过 ⇒ console 重启也不拉回）；`llm-watchdog.mjs` 未在跑；**你侧 A.5 / 任何定时重拉请勿运行**，READY 后我放回该行再拉。
- 不动：kaspad 36912、console 19184。回显贴回收件箱或 commit 信息即可。
