# J1 · 维护窗预检交付 —— 我负责步骤逐条确认（runbook v0.4）· 2026-08-29

> 全部**只读预检**，未执行任何维护动作。逐步给：能否执行 / 命令 / 回滚件是否在位 / 缺口。

## 汇总

| 步 | 我的判定 | 说明 |
|---|---|---|
| ②-bis 停 relay | 🔴 **缺可执行入口** | 见下，需 Bettor 定 |
| ③ 补丁 | ✅ **已完成可 SKIP** | commit 57fde30f |
| ③ 单体重启 | 🔴 **缺启动器** | 见下，需 Bettor 定 |
| ④ llama loopback+256k | ✅ **目标态已达成** | 8/27 已做，实测仍在位 |
| ⑤ 防火墙收窄 | ✅ 可执行，已定位目标规则 | 见下 |
| watchdog-enable | ✅ 前置件齐 | 待 READY + Bettor 令 |

---

## 🔴 缺口 1：②-bis「停 relay」没有可执行入口

- stopAll() 仅在 kasia-console/src/services/relay-manager.js:201 **定义**，全仓 grep **零调用者**（src/ 下无任何 import/调用）。
- src/api/relay.js 只暴露 **POST /api/relay/:id/restart**（stopRelay(id) → startRelay(id) 串联），**没有「只停不起」的端点**。
- ⇒ 按 runbook 写的"J1 提权 stopAll()"**当前无法直接调用**。三条可选路（**请 Bettor 定，我不擅自选**）：
  1. **加一个只停端点**（代码改动 → 需 NWT 审 + 但要重启 console 才生效 ⇒ 本窗无用，同 runbook 对 KANET_MAINTENANCE=1 的判断）；
  2. **按 PID 逐个停 relay 子进程**（提权 Stop-Process，我可执行）——但**不 drain**，与 runbook §②-bis 「必先 drain 再停」冲突，且会踩 eference-console-restart-orphans-inflight-relay-child-log-line-lost；
  3. **不单独停 relay**：靠 drain 稳定窗三条齐（announce-freeze + 60s 静默 + 现存 broadcast_tx 全 landed）后**直接进 ③ 重启 console**——console 一停，其 relay 子进程随之终止；stopAll 的语义由 ③ 覆盖。**我倾向 3**（少一个动作面，且 runbook §144 已写"③ console 重启 boot 时 startAll 自动拉回 relay"）。
- 🔵 兜底不受影响：runbook §107 的"stopAll 本身是硬闸 ⇒ 停后新 money 请求 fail-closed"在路 3 下同样成立（console 停 = 无 relay 可打）。

## 🔴 缺口 2：③「单体重启」在本机没有 _launch_* console 启动器

- runbook §111 写"_launch_* 单起或受控 supervisor 拉起"。**实测本机根目录只有** _launch_agents.ps1 + 三份 _launch_*_brief.md，**没有 console 启动器**。
- 现役 console 的真实启动形（我从进程实况读的，非猜）：
  `
  PID 27412  owner=NT AUTHORITY\SYSTEM
  "C:\Program Files\nodejs\node.exe" --max-old-space-size=4096 D:/kanet-tn12/kasia-console/src/index.js
  `
- 另一条路"受控 supervisor 拉起"**不可用**：supervisor 的 estart_console() 调的就是 kanet-start-headless.sh，而 §0/漂移表 #24 **明令禁跑整套**。
- ⇒ 唯一安全路 = **手动 spawn 复刻上述 argv + 完整 env**（kanet.env 全量 export，含 CONSOLE_ENCRYPTION_KEY/PORT/DB_PATH/KASPA_RPC_URL 等）。我能做（提权 + Win32_Process.Create 脱离 SSH 会话，同 A.5 手法），但**env 清单须 Bettor 或 KANet-UI 确认**——漏一个 key = console 起来但行为漂移（历史上 472 就栽在漏 export KASPA_RPC_URL）。
- **回滚件已在位**：kasia-console/src/index.js.bak-j1-20260826（54,207 B）✅ —— ③重启失败可还原旧版再起。

## ✅ 步③ 补丁段：已完成，窗内 SKIP

index.js 已含 __booted（commit 57fde30f，dry-run 两锚点命中 → -Apply → 
ode --check 退出码 0 → 备份在位）。**窗内此段直接跳过**，只做重启。

## ✅ 步④：目标态已达成（8/27 A.5 已做）

`
llama-server PID 4976   ctx=262144   host=127.0.0.1   私有 commit 14,037 MB
:8000 监听于 127.0.0.1（非 0.0.0.0）
scripts/a5-verify.ps1 在位
`
⇒ 窗内④**只需跑一次 5-verify.ps1 验收**，不需要重起 llama（除非它在窗前被别的动作重启过）。
🟡 一处口径要 Bettor 明确：runbook 写"commit 合硬闸(≤80∧≥20)"——**指进程私有 commit 还是全机空闲 commit？** 当前 llama 私有 commit = 14 GB，若判据是"进程 ≥20 GB"则不合；若是"全机空闲 commit ∈ [20,80]"则当前 21.8–44 GB 合。**按字面我判不了，请给单位。**

## ✅ 步⑤：防火墙 —— 目标规则已定位

- 实测**没有按端口的入站规则**；相关规则**全是按程序**匹配：
  `
  [Allow] llama-server -> C:\kanet\tools\llama-server\llama-server.exe      ← 收窄目标
  [Allow] kaspad       -> D:\rusty-kaspa\target\release\kaspad.exe          ← P2P 需要, 不动
  [Allow] Node.js JavaScript Runtime -> C:\program files\nodejs\node.exe    ← 面很宽, 见下
  `
- **可执行**：llama-server 现已只监听 127.0.0.1，该 Allow 规则**已无必要** ⇒ Disable-NetFirewallRule -DisplayName 'llama-server'（我提权可执行）。
  **回滚**：Enable-NetFirewallRule -DisplayName 'llama-server'（一条命令，无副作用）。
- 🟡 **顺带报一个更大的暴露面**（不在本窗，供排期）：Node.js JavaScript Runtime 的 Allow 规则**对整个 node.exe 放行**，等于给本机**所有** node 服务开了入站口（console/relay/adapter/bridge 全走这个 exe）。收窄它需要逐服务确认监听面，风险高于本窗容量，**我不在窗内动**，只报。

## ✅ watchdog-enable 前置件（READY 后另令）

`
scripts\kaspad-watchdog-va.test.ps1        在位 ✅
scripts\kaspad-watchdog-enable-va.test.ps1 在位 ✅
KASPAD_WATCHDOG_TESTMODE = (空, unset)     ✅ 满足 D-013 §3 承重断言
KANet-KaspadWatchdog 任务状态 = Disabled    ✅
`
⇒ 五前置里我这侧的四条（脚本在位 / TESTMODE unset / 任务 Disabled / 提权可 Enable）**已就绪**，只等 ①节点 READY ②VA 25/25∧8/8 实跑 ③NWT GREEN ⑤Bettor 令。

## 边界

本轮全程只读：未停任何进程、未改防火墙、未启用任务、未重启 console/llama/kaspad。