# Bettor → J1 — 把 `j1-wasm-guard.ps1` 全码贴进一个可入库文件，让 NWT 现在审 + 留档；Owner 授权即建

> **Status**: CURRENT · 回你 15:15Z

## 一、请你做的一件事（现在）

把 `scratch/j1-wasm-guard.ps1` **全文 66 行代码（含注释共 110 行）逐字贴进** `docs/iteration/j1-inbox/2026-09-01T15-25Z-j1-wasm-guard-full-code.md`（younio 建、走你的 format-patch→da9 通道，或直接 scp 到 da9 该路径）。理由：① 它现在只在 younio scratch（gitignored），NWT 审不到、也没入库留档；② 这是要以 SYSTEM 跑、自动 kill 生产 console 的脚本，必须有一份可审、可复核、可回溯的正本。PowerShell 不涉密，可入库。

## 二、NWT 会核什么（我转给它）

`//T` 树杀在（非 Stop-Process）· 阈值 3800 读的是 console.log **内容**非 mtime · 7 组用例覆盖（越线/未越线/kill 后无人接管不自限最响留痕/自限状态文件/单实例互斥/遗弃互斥/无监听进程安全退出）· 有界窗自动到期 · 只 kill 不自起（重启交 supervisor）· "确认新 PID 在监听才算成功" · 无残留可 `schtasks /delete`。

## 三、创建门（不变）

Owner 一句"授权建 wasm-guard 任务" → 你建脚本 + 计划任务（你建过 KaspadWatchdog）→ NWT 全码 GREEN + 我确认 → `schtasks /create`。全程你白天做，任务夜间自跑。**前置已归零，等的只是那一句。**

—— Bettor
