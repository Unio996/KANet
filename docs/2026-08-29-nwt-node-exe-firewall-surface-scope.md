# node.exe 入站防火墙面 — 收窄 scope（结论稿）· 2026-08-29 · NWT

> **Status**: SCOPE（只读枚举 · 派工 Bettor · 起因 = J1 维护窗预检 §⑤：本机入站防火墙无按端口规则，`Node.js JavaScript Runtime` 的 Allow 规则对整个 `node.exe` 放行 = 所有 node 服务共用一个入站口）。
> **执行归属**：J1 角色 B 令下 + **Owner 批（安全面）**，**不在本维护窗**。本稿只出 scope + 收窄方向。
> 🔴 **暴露面明细（哪些监听绑全接口、tailnet 地址、确切端口）按 memory `feedback-security-baseline-findings-default-to-narrowest-channel` 不进公开 git** —— 在本机 `…/scratch/node-firewall-surface-detail.md`，并已经 pipe 报 Bettor。本稿只写结论。

## 0. 一句话
`node.exe` 防火墙 Allow 是**应用级、整进程、全端口、Public profile** ⇒ **任何 node 服务只要 `listen()` 绑了全接口（0.0.0.0/::），就对公网可达、无需任何人批准**。实测现役 node 监听中：一个 **console 主 HTTP 已正确 loopback**、一个**跨机 ZK proving 是 tailnet-scope（非公网）**、一个**外部网关是 by-design 0.0.0.0（但 arming 状态待确认）**、一个 **sibling 服务意外绑了全接口（本可 loopback）**。

## 1. 结构性根因（可写进公开稿的部分）
- **防火墙不是闸；`listen()` 里的 host 参数才是唯一那道闸**（`kanet.env:31-42` 早已把这条写死，源自 llama 那次 0.0.0.0 教训 = memory `project-llama-server-exposure-0000-bind-plus-firewall-app-allow-2026-08-27`）。
- 🔴 **本次新发现 = 守卫覆盖不全**：console 主进程的 HOST 闸（`kasia-console/src/index.js:496` 读 `process.env.HOST || '127.0.0.1'`，配 `kanet.env:42 HOST=127.0.0.1`）**只护 console 自己**，**不延伸到 sibling node 服务**——某 sibling 用自己的 `server.listen(PORT, cb)`（**无 host 参数**）⇒ Node 默认绑全接口 ⇒ `kanet.env` 的 `HOST=127.0.0.1` 对它**无效**。这是"守卫存在于一个服务、漏了同胞服务"型（= 该 sibling 只做本地 IPC、本应 loopback）。

## 2. 谁真需要外部入站（结论）
| 类 | 需外部入站？ | 处置方向 |
|---|---|---|
| console 主 HTTP | 否（loopback，反代/本机）| ✅ 已 loopback，不动 |
| 跨机 ZK proving | 只跨节点（tailnet peer）、非公网 | tailnet-scope 恰当；可选加 tailnet ACL 收到具体 peer |
| 外部 onboarding 网关 | 设计上是；**但取决于 M0c-1 是否已 arming/上线** | 🔴 **待 Owner 确认 arming 状态**：未上线 ⇒ 撤 env（默认不启动）；已上线 ⇒ 保留但配 port-rule 只曝该端口 |
| sibling IPC 服务（adapter 型）| **否**（纯本地）| 🔴 **绑 127.0.0.1**（补 host 参数，durable in-code）—— 本次唯一的**意外**暴露、明确 fixable |
| relay / tg-bot | 否（relay 出站连 kaspad；tg-bot 出站 long-poll）| 无入站监听 = 对 |

## 3. 收窄方向（durable，非手动——A.5 教训：手动 rebind 重启即回退）
1. 🔴 **sibling IPC 服务 → 绑 `127.0.0.1`**（补 `server.listen(PORT, host, cb)` 的 host，或注 env）。承重、最清晰、补 §1 那个守卫洞。
2. **防火墙 app-rule → port-rule**：把整 `node.exe` 的 Allow 改为**只放必需端口**（backstop：未来任何 node 意外绑 0.0.0.0 不再自动可达）。listen-host 是主闸、port-rule 是第二道。
3. **外部网关 → 确认 arming**（Owner）：未上线撤 env / 已上线配 port-rule。
4. **跨机 ZK → 保 tailnet**（可选 ACL）。
5. **回滚一条命令**：防火墙 `Set-NetFirewallRule -DisplayName '<rule>' -Enabled True`（改前先 `Export-NetFirewallRule`）；rebind revert env/那行 diff。

## 4. 与既有 memory 对齐
- `index-security-exposure` 子索引 / `project-llama-server-exposure-0000…`（同 pattern：app-allow + 0.0.0.0 = 公网可达）/ `feedback-security-baseline-findings-default-to-narrowest-channel`（明细走管道）/ `feedback-verify-target-path-is-live-before-operate`（执行前确认 live）。
- **本稿结论**：只有 **1 处意外暴露**（sibling IPC 全接口绑，明确 fixable → loopback）+ **1 处 by-design 暴露待 arming 确认**（外部网关）+ **1 处 tailnet-scope 可接受**（跨机 ZK）。防火墙 port-rule 化是通用 backstop。**无立即处置权在本会话**——J1 令下 + Owner 批（安全面）。
