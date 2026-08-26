# J1 回归任务单（Bettor · 2026-08-27 · Owner 决：A.5 提权手走 (b) = J1 SSH 进本机起会话）

> 读法：按序做，每步带命令 + 原始输出回报。回报通道优先级：① 本机对等消息（你在本机起 claude 会话后 `SendMessage` 给 **kanet-tn12-08 [6255ac]**（Bettor 会话名；`ListAgents` 看不到 bypass 会话，直接按名发）；② 不通则 `git commit` 到 `bshard-m3-deploy`（我盯 origin，commit message 就是消息）；③ 频道 `dev-coord-testnet` 现因本机 IBD 不可用（67%，02:33）。
> 出向 SSH 到 younio(100.85.180.121) 22 端口不通（ping 通、TTL=128），所以只能你进来。本机 sshd Running/Automatic。

## 0. 别动的东西
- **不重启 console**（杀协调频道 + 三个本机会话的通信面）；**不动 kaspad**（IBD 进行中，新库，watchdog 归你/Owner 域但现在不需要）；**不推任何未经 NWT 审的 commit**。
- 🔴 **绝对不许跑 `bash kanet-start-headless.sh` / `kanet-start.sh`**（NWT (20) 33d6ce1e CRITICAL）：headless `:63-72` 会 kill `$PID_DIR/*.pid` 里每个 pid（**含 console.pid**）+ Stop-Process 占 :3200 的进程 = **重启 console**；`HEADLESS_NO_KILL=1` 也别用（跳 kill 但仍试起第二个 console → :3200 冲突）。console-supervisor 监 :3200（不监 :8000）——停 llama **不会**触发它，但 console 一旦被杀它会再跑 headless 放大。⇒ A.5 只允许下面 §1 的**手动 spawn**。

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
4. 确认 :8000 真释放：`netstat -ano | findstr ":8000 "` 无 LISTENING（"无 LISTENING"必要非充分：TIME_WAIT 可能挡 rebind——spawn 若报 bind 失败 = **等 30 s 重试**，别误判崩溃；最终判据是步骤 6 的 /props）。
5. 重拉 = **手动 spawn ONLY**（🔴 禁 `bash kanet-start-headless.sh`，见 §0）。在 Git Bash（提权会话）逐条跑，命令逐字对 `kanet-start-headless.sh:134-140`，只是 ctx 从 kanet.env 读：
   ```bash
   cd /d/kanet-tn12 && set -a && source kanet.env && set +a && echo "ctx=$LLAMA_CTX_SIZE model=$LLAMA_MODEL_PATH"   # 必须打印 ctx=262144 与 Q6_K 路径；空则停
   powershell -NoProfile -Command "[math]::Floor((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB)"   # 手动内存闸：须 ≥ 35（裸 spawn 绕过脚本 :112-131 的闸，所以手动判）；<35 停、报 Bettor、不调阈
   (cd C:/KANet/tools/llama-server && ./llama-server.exe \
     --model "$LLAMA_MODEL_PATH" \
     --host 0.0.0.0 --port 8000 \
     --n-gpu-layers 99 --ctx-size "$LLAMA_CTX_SIZE" \
     --cache-type-k q8_0 --cache-type-v q8_0 \
     --threads 8 --flash-attn on \
     >> /d/kanet-tn12/logs/llama-server.log 2>&1) &
   echo $! > /d/kanet-tn12/pids/llama-server.pid   # PID_DIR 以 kanet.env / 脚本为准；若目录不同按脚本 $PID_DIR
   ```
   （与 live 17428 的 qclaude.bat:64 flag 集相同，仅 `--ctx-size` 1048576→262144；`>>` 追加不截断旧日志，保留旧 kv 行作对照。）
6. 验（对照臂 A.7 VA-1/VA-6 + A.5 ②）——直接跑 `powershell -NoProfile -ExecutionPolicy Bypass -File D:/kanet-tn12/scripts/a5-verify.ps1` 得"后"臂，并补三项：① 旧 17428 真没了（`Get-Process -Id 17428` 报错）；② **消费端真推理成功**：经 adapter 走一次 Mind/Qwen 调用（不只 /props——证 Mind/Qwen 重连上新实例）；③ 停窗内 console-supervisor 与 llm-watchdog 都没 fire（`logs/kanet-console-supervisor.log` 尾无新重启行、Win32_Process 无 llm-watchdog）。预期：`llama_kv_cache: size = 4352.00 MiB`（旧 17408）、/props `n_ctx=262144`、VRAM ~28.5 GB → ~13-14 GB、新实例私有 commit vs 旧 30.15 GB。
   ⚠ 口径：默认值 256k **站的是 VRAM 82.6%→42% + YaRN 原生 256k**，都已坐实；步骤 6 的 commit 读数是**验证不是前置**——即便私有 commit 不降，默认不变（dd1dcd72 已先落码，NWT ④ 认可）。为回答 §A① 那 ~26 GB 无出处，四个 counter 全量：`PagedMemorySize64 / PrivateMemorySize64 / WorkingSet64 / VirtualMemorySize64`。
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
