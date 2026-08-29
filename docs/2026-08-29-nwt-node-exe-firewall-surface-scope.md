# node.exe 入站防火墙面 — 收窄 scope（结论稿·脱敏）· 2026-08-29 · NWT

> **Status**: SCOPE（只读枚举 · 派工 Bettor · 起因 = J1 维护窗预检 §⑤：本机入站防火墙无按端口规则，`Node.js JavaScript Runtime` 的 Allow 规则对整个 `node.exe` 放行 = 所有 node 服务共用一个入站口）。
> **执行归属**：J1 角色 B 令下 + **Owner 批（安全面）**，**不在本维护窗**。本稿只出 scope + 收窄方向。
> 🔴 **暴露面明细（哪个服务是什么绑定形、确切端口/地址）按 memory `feedback-security-baseline-findings-default-to-narrowest-channel` 不进公开 git** —— 服务名 ↔ 绑定形 的对应只在本机 `…/scratch/node-firewall-surface-detail.md`，并已 pipe 报 Bettor。本稿只写**结构与方向**，不含服务名与绑定形的对应。

## 0. 一句话
`node.exe` 防火墙 Allow 是**应用级、整进程、全端口、Public profile** ⇒ **任何 node 服务只要 `listen()` 绑了非-loopback，就对公网可达、无需任何人批准**。实测现役 node 监听中：**大多数仅回环或经私有 overlay（非公网）**；其中**恰一处是意外的非-loopback 绑定（本可仅回环，明确 fixable）**，另有**一处 by-design 的对外绑定其"是否此刻该曝"待 arming 确认**。逐项对应见本机明细。

## 1. 结构性根因（可写进公开稿的部分）
- **防火墙不是闸；`listen()` 里的 host 参数才是唯一那道闸**（`kanet.env:31-42` 早已把这条写死，源自 llama 那次教训 = memory `project-llama-server-exposure-0000-bind-plus-firewall-app-allow-2026-08-27`）。
- 🔴 **本次新发现 = 守卫覆盖不全**：主进程的 host 闸（`kasia-console/src/index.js:496` 读 `process.env.HOST || '127.0.0.1'`，配 `kanet.env:42 HOST=127.0.0.1`）**只护它自己**，**不延伸到 sibling node 服务**——某 sibling 用自己的 `server.listen(PORT, cb)`（**无 host 参数**）⇒ Node 默认绑非-loopback ⇒ `kanet.env` 的 `HOST=127.0.0.1` 对它**无效**。这是"守卫存在于一个服务、漏了同胞服务"型（该 sibling 只做本地 IPC、本应仅回环）。

## 2. 谁真需要外部入站（结论·不含服务名↔绑定形）
| 类（用途）| 需外部入站？ | 处置方向 |
|---|---|---|
| 主 HTTP（本机/反代）| 否 | ✅ 已仅回环、不动 |
| 跨机协作服务 | 只跨节点、非公网（私有 overlay）| 已 overlay-scope；可选加 overlay ACL 收到具体 peer |
| 对外 onboarding 网关 | 设计上是；**但取决于是否已 arming/上线** | 🔴 **待 Owner 确认 arming**：未上线 ⇒ 撤 env（默认不启动）；已上线 ⇒ 保留但配 port-rule 只曝该端口 |
| sibling 本地 IPC 服务 | **否**（纯本地）| 🔴 **改仅回环**（补 host 参数，durable in-code）—— 本次唯一的**意外**暴露、明确 fixable |
| relay / tg-bot | 否（出站连 kaspad / 出站 long-poll）| 无入站监听 = 对 |

## 3. 收窄方向（durable，非手动——A.5 教训：手动 rebind 重启即回退）
1. 🔴 **sibling 本地 IPC 服务 → 仅回环**（补 `server.listen(PORT, host, cb)` 的 host，或注 env）。承重、最清晰、补 §1 那个守卫洞。
2. **防火墙 app-rule → port-rule**：把整 `node.exe` 的 Allow 改为**只放必需端口**（backstop：未来任何 node 意外绑非-loopback 不再自动可达）。listen-host 是主闸、port-rule 是第二道。
3. **对外网关 → 确认 arming**（Owner）：未上线撤 env / 已上线配 port-rule。
4. **跨机协作服务 → 保 overlay-scope**（可选 ACL）。
5. **回滚一条命令**：防火墙 `Set-NetFirewallRule -DisplayName '<rule>' -Enabled True`（改前先 `Export-NetFirewallRule`）；rebind revert env/那行 diff。

## 4. 与既有 memory 对齐
- `index-security-exposure` 子索引 / `project-llama-server-exposure-0000…`（同 pattern：app-allow + 非-loopback bind = 公网可达）/ `feedback-security-baseline-findings-default-to-narrowest-channel`（明细走管道）/ `feedback-verify-target-path-is-live-before-operate`（执行前确认 live）。
- **本稿结论**：只有 **1 处意外暴露**（sibling 本地 IPC 绑非-loopback，明确 fixable → 仅回环）+ **1 处 by-design 对外绑定待 arming 确认** + 其余仅回环/overlay-scope 可接受。防火墙 port-rule 化是通用 backstop。**无立即处置权在本会话**——J1 令下 + Owner 批（安全面）。逐项服务名↔绑定形见本机明细文件。
