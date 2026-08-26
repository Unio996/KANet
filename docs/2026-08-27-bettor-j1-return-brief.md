# J1 回归任务单（Bettor · 2026-08-27 · Owner 决：A.5 提权手走 (b) = J1 SSH 进本机起会话）

> 读法：按序做，每步带命令 + 原始输出回报。回报通道优先级：① 本机对等消息（你在本机起 claude 会话后 `SendMessage` 给 **kanet-tn12-08 [6255ac]**（Bettor 会话名；`ListAgents` 看不到 bypass 会话，直接按名发）；② 不通则 `git commit` 到 `bshard-m3-deploy`（我盯 origin，commit message 就是消息）；③ 频道 `dev-coord-testnet` 现因本机 IBD 不可用（67%，02:33）。
> 出向 SSH 到 younio(100.85.180.121) 22 端口不通（ping 通、TTL=128），所以只能你进来。本机 sshd Running/Automatic。

## 0. 别动的东西
- **不重启 console**（杀协调频道 + 三个本机会话的通信面）；**不动 kaspad**（IBD 进行中，新库，watchdog 归你/Owner 域但现在不需要）；**不推任何未经 NWT 审的 commit**（队列里有 5 条在审）。

## 1. A.5 — 停 live llama(17428) 使 256k ctx 生效（Owner 已批；共享推理服务会短暂断）
依据 `docs/2026-08-26-kanet-ui-start-script-remediation-design.md` §A.5 ②–⑧（NWT 终审 `docs/2026-08-26-NWT-redteam-remediation-final-verdict.md`）。前置已具备（Bettor 实核 02:5x）：
- env 单一源已落：`kanet.env:153 LLAMA_CTX_SIZE=262144`（dd1dcd72，含内存闸 `kanet-start.sh:252` / `kanet-start-headless.sh:130` / `scripts/llm-watchdog.mjs`）。
- `llm-watchdog` **未在跑**（`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? CommandLine -like '*llm-watchdog*'` = 空）——你进来后**再查一次**（步骤③硬前置，否则它会用旧参数重拉）。
- 目标：`llama-server.exe` PID **17428**，StartTime 2026-08-25 10:31:04，私有 commit **30.2 GB**（Get-Process PagedMemorySize64）。SYSTEM 树，非提权会话杀不掉——这就是要你的原因。
**一键只读验收（KANet-UI VB-3 e7d24a37）**：`powershell -NoProfile -ExecutionPolicy Bypass -File D:/kanet-tn12/scripts/a5-verify.ps1` —— 七项（PID/ctx-size/私有 commit、log kv_cache 行、/props n_ctx、nvidia-smi、空闲 commit、llm-watchdog 是否在跑、:8000）。"前"对照臂已存 `docs/2026-08-27-a5-baseline-before.txt`（PrivateCommit 30.15 GB / kv 17408 MiB / n_ctx 1048576 / VRAM 28488/32607 / free commit 32.6 GB / watchdog 0 / :8000 LISTENING 17428）。**你提权跑一次"前"（能读到 CommandLine 的 --ctx-size）、停后重拉再跑一次"后"**，两份原样贴回。
⚠ 内存闸边界：现空闲 commit 32.6 GB **< 闸阈 35 GB**（`_MEMGATE_MIN_GB`）——现在若再起一个 llama 会被正确拒掉；停 17428 释放 ~30 GB 后 ≈63 GB 必过。若重拉被 `refuse-start:low-commit` 拒，先看 free commit 数，不要调阈值。
步骤：
1. 记 PID+CreationDate：`Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | select ProcessId,CreationDate,CommandLine`
2. 内存闸预检：`(Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB`（停后会释放 ~30 GB，够）
3. 停：`Stop-Process -Id 17428 -Force`（或 `taskkill /PID 17428 /F`）
4. 确认 :8000 真释放：`netstat -ano | findstr ":8000 "` 无 LISTENING 后才重拉
5. 重拉：走 start 脚本 llama 段（`bash kanet-start-headless.sh` 的 :8000 守卫走 fallback spawn，带新 ctx + 内存闸）——**只拉 llama 段，不要整套重启 console**；若脚本必整套跑，改为手动按 `kanet-start-headless.sh:106` 附近那条 spawn 命令起 llama（`--ctx-size $LLAMA_CTX_SIZE`）。
6. 验（对照臂 A.7 VA-1/VA-6 + A.5 ②）：新 `logs/llama-server.log` 出现 `llama_kv_cache: size = 4352.00 MiB`（旧 17408）；`curl -s http://127.0.0.1:8000/props | findstr n_ctx` = 262144；新实例 `PagedMemorySize64`（对比旧 30.2 GB——这是 §A ① "降 ctx 是否降私有 commit" 的**唯一实测**，NWT 定为改默认值硬前置）；`nvidia-smi` VRAM（预期 ~27 GB → ~13-14 GB）。
7. 回报：上面每条命令 + 原始输出，一条消息。

## 2. watchtower 第二故障域两条确认（KANet-UI VB-2 795b495d+656edaa3 待你现场核）
- ① 你的通信 relay key（`kaspatest:qq0kt3dm…`，relay id 743c0360）**只在 younio 托管**，不在本机 `kasia-console/data/console.db`（本机 32/32 relay key 同一 db 同一 CONSOLE_ENCRYPTION_KEY）。给命令：younio 上 `sqlite3 console.db "select count(*) from relay_nodes where address like 'kaspatest:qq0kt3dm%'"` + 本机同查 = 0。
- ② younio 是物理独立机（不是与本机共 commit 池的 VM）：`Get-CimInstance Win32_ComputerSystem | select Manufacturer,Model,TotalPhysicalMemory` + `systeminfo | findstr /i "hypervisor"`。
两条都过 ⇒ 才能对 Owner 声明"真独立第二域 = younio"。

## 3. §6-3 (a)(c)（你的 SS 域，坐标表已钉）
- (c) 源码坐标表 `docs/2026-08-27-j2-s63-gate-c-source-pins.md`（48a9d1af，NWT GREEN）：全部 `git show 7b1e18cc:` 坐标；**你要证的一条 = `7b1e18cc == younio live kaspad`**（`grep -a 'v1.1.1' <你的 kaspad 日志> | head -1`）。
- (a) buildability：v0.15 构造稿 `docs/2026-08-21-j1-s6-3-A-covenant-construction-v0.15.md` 能否被 silverc 编出——注意 OP_PICK 修复**只在本机 `/d/silverscript` 本地分支 `j2-oppick-fix-2026-07-06` (8065184)**，上游没有；你那台若用上游 silverc 则 bug 仍在。
- (d) 一条给你看：`docs/2026-08-27-nwt-s63-bwin-simulation-v0.2.md`（9a4f4127，队列中）——DAA-pump 在 +132 s 未来封下有界、B_win(k) 对数缓增；无界的是"审查"信道（时间戳落后 >660 s ⇒ `txrelay/flow.rs:118-119` 全网 tx relay 停）。J2 反向核中。

## 4. 之后（不是现在）
- 1M KAS → J1 新址转账：runbook `docs/2026-08-26-kanet-ui-1m-to-j1-transfer-runbook.md`（2c986960），要本机 UTXO 集可用 + Owner GO；你是第二 vantage（链读你自己节点）。
