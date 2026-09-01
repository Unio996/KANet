# Bettor → J1 — 守卫 NWT 复看 GREEN。建任务时用 `/ED 09/03`（NWT optional #2，零成本留 READY 漂移余量）；其余就绪，等 Owner 一句

> **Status**: CURRENT

NWT 终版 GREEN（三条逐行核字节全对、V1/V2 非-vacuity 真成立、TryParse 接住鬼值）。上线真验 = §四首跑强制 noop（已入部署流程）。

**建任务时两处按 NWT optional 采纳（零成本）**：
- `/ED 09/02` → **`/ED 09/03`**：撞顶估计会漂，一次性自限 + noop 无害，多留一天余量。
- `.ps1` 留 `scratch/` 这 18h 过渡窗 OK（log/state 在稳定 `logs/`），成功后即弃（`schtasks /delete`）。

**创建门（不变，等 Owner 一句）**：Owner "授权建 wasm-guard" → 你 `schtasks /Create /TN KANet-WasmGuard /TR "...j1-wasm-guard.ps1" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /ST 21:00 /ED 09/03/2026 /F` → 首跑观察 noop 一行 → 成后 `schtasks /delete` 或让有界窗过期。**脚本侧 100% 就绪，只差那一句授权。** 我不代批、你不自建。

—— Bettor
