# Bettor → J1 · Owner 令：关闭全部智能体、由 Bettor 重新拉起 · 本机 J2/NWT/KANet-UI 已于 13:19Z 拉起 · 开发主线对齐单全文如下（你的段 = 独立线 J1 项）

> 你在 younio 远端，不在拉起范围；通道不变（j1-inbox / git）。你若也被 Owner 重启，读 ledger 785 + 791 + 792 对齐，然后回 inbox 一封「读到的最后状态」。

# 本机三人重新拉起 · 主线对齐单（Bettor `kanet-tn12-1c [4a17db]` · 2026-09-04 13:3xZ · 权威现状 = COORD-LEDGER (785) handoff + (791) 最新）

## 0. 先报到，再干活
- 用 SendMessage 发 `kanet-tn12-1c [4a17db]`：角色 + 你的会话名 + 你读到的 ledger 最大块号（应 ≥791）。够不到就写文件到 `scratch/_bettor_inbox/`（README 在内，60s 有人看）。
- 频道 `dev-coord-testnet` 的链上广播 IBD 期 **send 500 不落**（786）：**别重试、别当成自己坏了**，协调一律走 SendMessage / 文件收件箱 / ledger。
- 我核对（ListAgents 可见 + 自报块号）后才给派单。派单 writer 只有我一个。

## 1. 开发主线（当前有效决策 D-001/D-013/D-014/D-015/D-016 + ledger 785）
方向铁律：**ZK = committed 结算架构，rolling/covenant 跨节点 = 死路，不再讨论**（CLAUDE.md 铁律 0.5）。
近期顺序（全部串行、前一步没到不启后一步）：
1. **节点 IBD → BOTH_READY**（`scratch/_step0_gate.mjs` verdict=READY ∧ KANet-UI D 行 READY=1）。时间口径：**~09-09 = 当前估计（条件规划中心）·工作区间 09-08~09-11**，不是"下界"（791 采纳 Codex 33bf86ad）。BOTH_READY 只看实态不看预测日期。
2. **J2 T+0 只读第一小时**（`scratch/_postsync_first_hour_20260827.md` + 派单稿 `scratch/_bettor_msg284/t0-dispatch-draft.md`）：gate (d) 证据页，零广播零钱。KANet-UI 并行 service-resume（`scratch/_postsync_service_resume.md` §6，不重启 console）。
3. **gate (a) 真链向量 N6/N7/N8/P**（D-016，仍 OPEN）：构造 = J2 / 广播 = 提权 operator / 逐格判 = NWT（卡 `docs/2026-08-29-nwt-gate-a-onchain-acceptance-card.md`）。**须 Owner dust-spend GO**，在 ② 之后。
4. **维护窗批次 ①–⑥**（D-014 状态注记清单：红线 7 observe / supervisor v0.1.4 / runbook v0.5.x / llama loopback + node.exe 防火墙收窄 / watchdog v0.4 enable）：READY + T+125 证据无 err 后 **Owner 批一次窗**。
5. **§10 pubkey 身份 live 迁移**：代码层 GREEN（D-013）、live = D-005 独立迁移 Owner 另拍。
独立线（非紧急）：§6-3 ZK covenant gate / D-016 builder HOLD 项（J2）；everSynced 门 + 5 VA、`--ram-scale`、相位模型加 789 的 3.73h 段（J1，远端，j1-inbox）；silverscript v1 迁移计划（低优先）；batch-2 钱路（待 Owner，低优先）。

## 2. 分角色第一小时
### J2（settler/voter/pipeline · reviewer NWT）
- 报到后：`kasia-console/` 根下 6 个今天写的未跟踪只读脚本（`check-*.mjs`、`snapshot-baseline.mjs`，07:59–13:05Z）若是你的，移到 `scratch/`（临时脚本铁律），告诉我；不是你的也告诉我。
- 复读 T+0 稿与 `_postsync_first_hour_20260827.md`，确认 v0.9.2 工具（`kmax-cost.mjs` / `wcap-run.mjs` / `tx-mass-ub.mjs`）就位、只读参数注入路径通；缺什么提前报。
- §6-3 / D-016 未闭项按 DECISIONS.md D-016 状态注记逐条对齐现状，给我一页"哪些 CLOSED、哪些 HOLD、READY 后第一件事"。不落码、不接线、不广播。

### NWT（攻击审/关3/红队）
- 报到后：审 `logs/bettor-supervisor.log` 本次拉起决策（Owner 8/26 令：Bettor 起人/重启决策须被你按班审）。
- 对 791 两条裁定做红队：① 采纳 Codex 33bf86ad "~09-09 非下界"口径；② J2 身份 HOLD 至握手 + ListAgents 可见。有异议直接 SendMessage 我，我按对抗讨论处理。
- 预热 gate (a) 验收卡与 T+0 对拍卡（`docs/2026-08-29-nwt-t0-dispatch-reconcile.md`），READY 到时你是逐格判官。

### KANet-UI（操作员/UI/部署 · reviewer NWT）
- 🔴 **第一件事**：按 `scratch/_handoff_kanetui.md` 3 步重起 IBD loop（`scratch/_ibd_monitor_loop.sh`）。你的 D 行停在 **08:14:58Z**，BOTH_READY 第二信号从那刻起是盲的；loop 起来后把第一行 D 行读数 SendMessage 给我。
- 核 hb_guard（`logs/hb_guard-alive.txt` mtime <10s；PID 37780；**09-05 06:38:50Z 到期**，到期重起归我，你只报）。
- 复读 `scratch/_postsync_service_resume.md`，READY 后你不重启 console、只确认子系统 tick 恢复；`KANet-KaspadWatchdog` 保持 Disabled（D-013 §3 五前置 + 我单独下令才 enable）。
- 降报频规则不变：body 里程碑每 5% / 真 READY / console kill / 真告警 / owner PID 异常变。

## 3. 纪律（全员）
- 只读 RPC；不碰 miner/watchdog/钱路；任何代码改动走「报备→审核→批准→测试」（铁律 0）；用户面/钱路/重大功能必须 Owner 批。
- 不给 Owner 发菜单；有事先问我。自报读数标"自跑"，转述别人的标"未核"。
- 文件名时间戳 `date -u +%Y-%m-%dT%H-%MZ`；速率/ETA 两独立吻合窗，不用单窗。
- 共享 memory 目录：非自建条目只报不改。临时脚本只进 `scratch/`。
