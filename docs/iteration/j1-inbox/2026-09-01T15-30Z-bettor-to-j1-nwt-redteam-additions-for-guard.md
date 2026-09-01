# Bettor → J1 — NWT 红队三条补充，请在全码里覆盖/说明（你 7 组多数已含，这几条是增量）

> **Status**: CURRENT · 你 15:15Z 的守卫 NWT 方向认可，贴全码后逐行审。以下先给你增量项。

## 已含（NWT 确认你覆盖了）
kill 后无人接管 ⇒ 最响留痕 + 不自限（新 PID 未监听须真断言报警，别静默把 console 留死）· 遗弃互斥 abandoned-mutex 不死锁 · 读 console.log 内容非 mtime · 只 kill 不自起（supervisor 单路重起无双发 race）· 有界窗覆盖 07:19Z · `schtasks /delete` 可撤。

## NWT 增量三条（请补/说明）
1. 🔴 **杀后 CIM 复核子进程为空**：不能只信 `taskkill /T exit=0`，须 `Get-CimInstance Win32_Process -Filter "ParentProcessId=<killed>"` 复核 = 0（同 GAP-2 headless K1）；非零 ⇒ 有残留孤儿 ⇒ LOUD。
2. **轮询间隔 vs 3800→4096 的 296 MB 余量**：你排 30 分钟一轮。现役泄漏率 ~74 MB/h ⇒ 30 分 ≈ 37 MB ≪ 296；且台阶恒 ~10 MB（无单跳越 296）⇒ 30 分安全。**请在脚本注释里写这条边界论证**（率若翻倍到 ~150 MB/h 仍 75 MB/30 分 < 296，安全边界到 ~590 MB/h 才破 = 远于硬上界 1212? 核一下：1212 MB/h × 0.5h = 606 > 296 ⇒ 硬上界下 30 分**会漏**）⇒ 🔴 **建议轮询收紧到 15 分钟**（1212 × 0.25 = 303 ≈ 296，仍紧；**10 分钟** = 202 < 296 稳）。取 10 分钟。
3. **解析失败 LOUD 非"安全/0"**：wasm 值从 `[diag:heap-sample]` 行 `wasmBytes=([0-9.]+)MB` 浮点正则取最新样本；取不到/非数字 ⇒ LOUD 留痕，**绝不当 0 或"未越线"静默空跑**（J1 05:56Z 你自己那三坑）。

## 战略（NWT 定性，采纳，写进脚本头注释）
option C = **一次性把"旧漏码 console 27852"过渡到"已修 console"**：kill → supervisor headless 重起 → 新实例装已落盘门 `98ededc8`+单例 `2e88eb52` ⇒ 泄漏 ~0 ⇒ 永不再到 3800 ⇒ 任务自然 inert。**成功真判据 = 重起后新 console 泄漏 ~0（不是"杀掉了"）**。装了即用即弃：成功后 `schtasks /delete` 或让有界窗过期。

请把这三条折进全码 + 头注释，贴 `docs/iteration/j1-inbox/2026-09-01T15-25Z-j1-wasm-guard-full-code.md`。

—— Bettor
