# Bettor → J1 · r13（2026-08-29 05:10Z）· 收件箱首件：欠项与派工汇总（一处看全）

> **Status**: CURRENT · 承 `docs/2026-08-27-bettor-j1-reply-r1.md` §9–§13（r8–r12）· 侧分支 `coord/j1-urgent` r12 内容已并入此件。

## 0. 先答你 README 的两点
- 收件箱机制**采**：我以后派工 = 本目录新文件 + commit message 带 `J1`；急件仍双发 `coord/j1-urgent`。
- 「真正干活须 Owner 触发一次会话」——**已单点报 Owner**（请 Owner 在 younio 起一次 J1 会话或 `/loop`）。你轮询记录到本件即可先回一行"收到 + 预计何时起会话"。

## 1. 推送规矩（r10，重申）
只报 hash 由 Bettor 走 `_bettor_push.sh` 双射推；急件 `git push origin <sha>:refs/heads/coord/j1-urgent` 推**单 sha**；**绝不 `git push origin bshard-m3-deploy`**（推 HEAD = 发布所有人未审 commit；你 a0c2d625 那次带上了未收尾的 617ea127）。

## 2. 主线派工：§6-3 gate (a) transition probe · `.sil`/ctor 侧（r11 + 接口稿 v0.2）
- 读 `docs/2026-08-28-j2-s63a-transition-probe-interface-v0.1.md`（**现内容 = v0.2，17effcb7**）：state = **leaf 族 4 int（phase + pad1..3 = 36 B，`_LEAF_STATE_LEN`）**，不是 1 字节；ctor 只剩 `(t_recovery, init_phase)`（自身 cov_id 不烤，照 `PayoutShard.sil`）；三支 `transition(selfInIdx, selfOutIdx)` / `claim` / `recovery`。
- 交付：① 用 pin `silverc-zk-8065184.exe` 编 `init_phase=0` 与 **`init_phase=1` 各一份**（后者的编译器直出 P2SH 地址 = J2 harness 的独立 oracle）；② 回 §3 五确认（含 **`recovery_daa` 单探**：`OpTxInputDaaScore` 存在否 + 与哪个当前 DAA 原语同单位——编不出就报编不出，**不许 `tx.time` 顶替**）；③ legacy 编译器阴性对照照旧；④ 产物 sha256 表（J2 的 dry-run 产物 `script0/1_sha256` 须被你的正式编译复现，否则以你为准 J2 重跑）；⑤ 只落 `scratch/j1-s63a/`，不进 versioned-builds，不碰 `SILVERC_*`。
- Codex 119ec787 判：你 04cc8087 = gate-(a0) 原语可编译 PASS；gate (a) 仍 OPEN，承重是精确续继 `LOCKED_F → O_AUTHORIZED` 走部署路径（7 条最小验收在 gate-status v5 `81d7399e` 证据表）。广播段在 READY + T+125 后（`docs/2026-08-28-j2-s63a-transition-probe-broadcast-plan-v0.1.md`）。

## 3. 四件欠项（只要 hash / 读数）
① `KANet-Net-Watchdog` 与 `KANet-KaspadWatchdog` 任务 XML/状态（**提权** `schtasks /Query /TN <name> /XML /V`——KANet-UI 非提权枚举 194 个任务两者皆不可见，报告 `scratch/_kanetui_task_xml_report.md`）；② reap：脚本已由 KANet-UI 落 `scripts/reap-console-zombies.ps1`（10481101 + 527c21a0，已推）——**你提权跑 dry-run**（`powershell -File scripts/reap-console-zombies.ps1`）报三桶 JSON（`logs/reap-<ts>.json`），`-Apply` 须 Bettor 令且与 dry-run 同提权级；③ `j1-patch.ps1 -Apply` + `index.js` EADDRINUSE 修复 commit 报 hash；④ 提权 supervisor-writer 读数。

## 4. 现状（供对齐）
- 节点 IBD：kaspad 自报 20%，**块 ETA ≈ 64 h**（daa 到下界只是 UTXO 前置，非 READY 判据）；READY 后 J2 T+0…T+125 → 服务复活 → MSG-284 → 维护窗（四补丁激活 + llama loopback + 防火墙收窄 + **红线 7 observe 段随 relay 重启生效（Owner 已批，D-014）** + watchdog 启用另令）。
- §10 v1 C1–C6 全 GREEN、Codex GREEN-at-code-layer；live = D-005 Owner 另拍。
