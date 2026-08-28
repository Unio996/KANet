# Bettor → J1 · r14（2026-08-29 06:30Z）· J1 纳入团队日常开发：固定职责 · 固定节奏 · 固定队列

> **Status**: CURRENT · Owner 原话（2026-08-29）「你要把 J1 纳入团队日常开发工作」· 本件 = J1 的常驻工作说明书，后续只增队列不改规矩。

## 1. 三块固定职责（J1 主责）
- **A. §6-3 covenant / silverscript 工具链**：transition probe 的 `.sil` 与 ctor（接口稿 v0.2 `17effcb7` leaf 族 36 B state）、`silverc-zk-8065184` 正式编译与 legacy 阴性对照、`versioned-builds/` 与 OP_PICK 修复的 provenance（本机分支 `j2-oppick-fix-2026-07-06` 未推上游那件也在你名下）、将来 A-covenant 的编译面。J2 做 relay 侧 harness，你俩接口走 `docs/`。
- **B. 本机提权运维**（console 跑在 SYSTEM、非提权看不见的都归你）：`KANet-Net-Watchdog` / `KANet-KaspadWatchdog` 任务 XML 与启用（启用须 Bettor 令）、`reap-console-zombies.ps1` 提权 dry-run 与 `-Apply`（须令）、维护窗四补丁激活（llama loopback / llm-fallback / lint / probe）、防火墙收窄、supervisor-writer 检查、`j1-patch.ps1 -Apply` + `index.js` EADDRINUSE 修复。
- **C. younio 第二 vantage**：younio 节点同步到 TN12 并保持在线（`M_reorg` / `W_dis` 的 two-vantage 证据只能从你那边出，Codex f7bc9057 明写 younio 不是 second vantage 直到它同步）；MSG-284 之后的 two-vantage 跟进由你产数据、J2 算、NWT 审。

## 2. 固定节奏（每个会话）
1. 读收件箱（本目录新文件 + commit message 含 `J1`）→ 2. 取队列最高优先项做 → 3. **回报 = 一个 commit（报 hash，不推 `bshard-m3-deploy` HEAD；急件 `coord/j1-urgent` 推单 sha）或一个收件箱回文件** `docs/iteration/j1-inbox/<UTC>-j1-reply-<主题>.md`（读数/hash/卡点，一件一行）→ 4. 下一项。
- 规矩不变：报备 → NWT 审 → Bettor 推；钱路/用户面 = Owner 批；只报自己亲手跑的读数。
- 🔴 你是回合制：**Owner 在 younio 用 `/loop` 起你**（已请 Owner）；起来后按本节自驱，不等我点名。

## 3. 当前队列（按优先级）
| P | 项 | 交付 |
|---|---|---|
| P0 | **transition probe `.sil` 正式编译**（r13 §2）：`init_phase=0` 与 `init_phase=1` 各一份、§3 五确认（含 `recovery_daa` 单探，不许 `tx.time` 顶替）、legacy 阴性对照、sha256 表 | `scratch/j1-s63a/` + 收件箱回文件 |
| P0 | 四件欠项（r13 §3）：任务 XML / reap 提权 dry-run 三桶 / `j1-patch.ps1 -Apply` + `index.js` commit / supervisor-writer 读数 | hash + 读数 |
| P1 | **younio 节点状态**：TN12 同步到哪（`isSynced`/daa/blockCount）、磁盘/内存、能否常驻；给出"何时可作第二 vantage"的实测 ETA | 收件箱回文件 |
| P1 | 维护窗准备（`docs/2026-08-28-postsync-maintenance-window-runbook-v0.4.md`）：你负责的步骤逐条确认可执行（提权命令、回滚路径），窗在本机 READY + J2 T+125 之后，Bettor 令 | 回文件 |
| P2 | OP_PICK 修复分支推上游的 provenance 收口（`/d/silverscript` `j2-oppick-fix-2026-07-06` 8065184 只在本地）| 报备 |

## 4. 现状（对齐用）
节点 IBD kaspad 21%，块 ETA ≈ 61 h；§10 v1 code-layer GREEN（live = D-005）；红线 7 修法链全 GREEN（observe 段 Owner 批，随维护窗部署；enforce 另报备）；Codex 最近判 gate (a) 仍 OPEN 等部署路径真跑（你的 P0 是前置）。
