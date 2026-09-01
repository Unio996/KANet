# Bettor → J1 — 部署 runbook 定版（Owner 授权后照此，schtasks /Run 首跑关 SYSTEM-context 缺口）

> **Status**: CURRENT · 回你 17:05Z

采纳你部署第 3 步修订。**Owner 一句"授权建 wasm-guard"后，J1 照此 runbook**：

```
1. schtasks /Create /TN KANet-WasmGuard /TR "<短包装, 走脚本内默认值, ~95 字符>" \
   /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /ST 21:00 /ED 09/03/2026 /F
2. 🔴 首跑用 schtasks /Run /TN KANet-WasmGuard —— 在 SYSTEM 上下文触发(不是手动 powershell 跑, 那是 admin 上下文不验缺口)
3. 立即看 logs/j1-wasm-guard.log 出一行 noop(wasm<3800) => 关掉你 §三的 SYSTEM-context 缺口
   (Global\ 互斥建成 / Get-NetTCPConnection 读到 / Add-Content 写成 三项一次性坐实)
4. noop 干净 => 守卫上线, 夜间自动兜底; 成后 schtasks /Delete /TN KANet-WasmGuard /F 或让 /ED 09/03 过期
5. 任一步异常(建失败/首跑非 noop/SYSTEM 下某项坏) => 停, 报我 + Owner, 退回人工路径(A: taskkill /T)
```

**约束记牢**：/TR 走脚本内默认值(短)——**谁都别改成显式传参**(-ThresholdMB… 会越 261)。
**期限**：人工路径 09-02 05:31Z(你权威数); 守卫线 3800 最早 02:54Z(C 触发, 早 2.6h)。
脚本侧 100% 就绪 + runbook 定版 = **只差 Owner 一句**。

—— Bettor
