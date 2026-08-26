# NWT 红队 — J1 任务单 §1（A.5 停 live llama）

> 作者 NWT · 2026-08-27 · 派工 Bettor (20) · 被审 = `docs/2026-08-27-bettor-j1-return-brief.md` §1（工作树更新版，未 commit）+ 设计 `2026-08-26-kanet-ui-start-script-remediation-design.md` §A.5–A.7 + 我终审 `2026-08-26-NWT-redteam-remediation-final-verdict.md`
> **这是 LIVE 生产动作（停共享推理服务，SYSTEM 树 PID 17428）——审后才做。** 我实核了当前工作树脚本状态（非假设）。
> **总评：前置（ctx-env 已落码 / 内存闸已落 / 边界注已补）都对；但步骤 5 主路径【会杀 console】= 违 §0、断协调频道 + 3 会话 = CRITICAL MUST-1。** 另 3 注 2 补。

## 0 · 实核到的当前状态（先钉，`[READ 工作树]`）
- ✅ **A-1/A-2 已落码**：`kanet-start-headless.sh:137` + `kanet-start.sh:266` = `--ctx-size "$LLAMA_CTX_SIZE"`（读 env，非硬编 1M）⇒ **重拉走 env=262144 成立**（不会再 spawn 1M）。（brief 引 `:106`/`:109` 是旧行号，实际 spawn ~:132-145）
- ✅ **内存闸已落**：`kanet-start-headless.sh:112 _MEMGATE_MIN_GB=35` / `:122 FreeVirtualMemory` / `:130 refuse-start:low-commit` / `:127 fail-closed(读取失败拒拉)`；闸在 spawn(:137) **之前**。
- ✅ **③ 边界（Bettor 已补注）实数对**：现 free 32.6GB < 35 ⇒ 现在起第二个被正确拒（8/23 防线在岗）；停 17428 释放 ~30 ⇒ ≈63GB ⇒ 重拉必过（28GB 余量，非边界）。boundary 风险**对这次动作不成立**。

## 1 · 🔴 MUST-1（CRITICAL·①⑥）：步骤 5 主路径 `bash kanet-start-headless.sh` 会杀 console
- **实证**：`kanet-start-headless.sh:63-72` 停旧进程循环 **kill 掉 `$PID_DIR/*.pid` 的每个 pid（含 `console.pid`）**；脚本自注 `:99-100`「**headless 只 kill :3200** 不 kill :8000」。⇒ **`bash kanet-start-headless.sh` = 杀 console(:3200) + 整套重起** = 违 brief §0「不重启 console」= **断协调频道 + 3 本机会话通信面**（正是这单最怕的事）。
- brief 步骤 5 写「走 start 脚本 llama 段…**只拉 llama 段，不要整套重启 console**」——**这句与它给的命令自相矛盾**：`bash kanet-start-headless.sh` 不存在"只拉 llama 段"模式，它必先 kill :3200。
- **连锁放大**：console-supervisor（注册任务，`kanet-console-supervisor.sh:14-16` 监 `curl :3200`、3 次 fail 触发**再跑 `kanet-start-headless.sh`**）——若 console 被杀，supervisor 会**再拉一次整套**（restart storm 防护 5min>5 次才 cool-down）。⇒ 手滑跑一次脚本 = console 被杀 + supervisor amplify。
- 🔴 **修法（MUST）**：步骤 5 改为 **手动 llama spawn ONLY，明令禁止 `bash kanet-start-headless.sh`**：
  1. **先加载 env**（否则 `$LLAMA_CTX_SIZE` 空 ⇒ `--ctx-size ""` ⇒ llama 报错）：`set -a; source kanet.env; set +a`（或显式 `LLAMA_CTX_SIZE=262144`）。
  2. **手动跑内存闸预检**（裸 spawn 绕过脚本 :112-131 的闸）：`free=$(powershell ... FreeVirtualMemory/1MB)`；`[ "$free" -ge 35 ]` 才 spawn（停后 63GB 必过，但纪律要在——将来别的场景可能不过）。
  3. **给出 `:132-145` 那条 spawn 命令的【完整原文】**（全部 flag，不是只 `--ctx-size`）——brief 现在只写 `--ctx-size $LLAMA_CTX_SIZE` 一个 flag，漏了 `--model/--n-gpu-layers/--cache-type-k/v/--flash-attn/--host/--port/-np` 等；J1 照残缺命令起会缺 flag。**从脚本 :132-145 逐字抄进 brief。**
  - ⚠ 连 `HEADLESS_NO_KILL=1 bash kanet-start-headless.sh` 也不建议：它跳过 kill 循环（console 不被杀 ✓），但仍进 console 段试起第二个 console → :3200 bind 冲突 + 脏日志。**最干净 = 纯手动 llama spawn，完全不碰脚本。**

## 2 · 🔵 MUST-2（⑥·降为 CONFIRM + 补注）：supervisor/watchdog 在停窗内不 cascade——但须写进 §0
- **console-supervisor**：监 `:3200`（**不是** :8000）⇒ 停 llama 时 console 仍活 ⇒ **不触发**。✅ 但其 restart 动作 = `kanet-start-headless.sh`（杀 :3200）⇒ **§0 必须显式列「不许跑 kanet-start-headless.sh（=console-supervisor 的动作，会杀频道）」**，不只写"不重启 console"（现 §0 没点破"跑那个脚本"就是重启 console）。
- **llm-watchdog**：brief 步骤③已查（未跑）✓——它才是会用旧参数重拉 llama 的那个，查对了。
- **kaspad-watchdog / tn12-mining-watchdog**：监 kaspad/挖矿（IBD 中），**不监 llama** ⇒ 停 llama 不触发。§0 可补一句"这两个 watchdog 与 llama 无关、不会因停 llama 动作"以免 J1 疑虑。

## 3 · 🔵 注（②）：`:8000 真释放` 判据——"无 LISTENING" 必要但非充分
- Stop-Process 后 LISTENING 立即消失，但**已接受连接的 server 端 socket 在 :8000 进 TIME_WAIT**（若停时有在飞推理）；新 llama bind :8000 若无 `SO_REUSEADDR` 可能 `EADDRINUSE`。⇒ 判据补："无 LISTENING 后 spawn；**若 spawn 报 bind 失败 = TIME_WAIT 未清，等 ~30s 重试**，别把 bind 失败误判成崩溃"。**最终成功判据 = 步骤 6 `/props` 返 n_ctx=262144**（brief 有，好）。

## 4 · 🔵 注（④）：默认值已落码 dd1dcd72——硬前置"顺序"没跟，但实质保护在
- 我设计 §A.5② 的硬前置是"**测出私有 commit 随 ctx 降**之前，不把默认写进 kanet.env"。**dd1dcd72 已先写了 262144**——字面顺序没跟。**但不阻塞**：默认站在 **VRAM 82.6%→42% + YaRN 原生 256k（两者已坐实）**，**不站在**"降 ctx 缩 commit"（未证）；且 OOM 防线 = 内存闸（已落、已验 :112-131）。
- 🔴 **须补一句进 brief**：步骤 6 现写"新实例 PagedMemorySize64…是降 ctx 是否降私有 commit 的唯一实测，NWT 定为改默认值硬前置"——这话会让读者以为**量出来不降就推翻默认**。**加**："默认值站 VRAM+YaRN，步骤 6 的 commit 量是**验证非前置**；即便 commit 不随 ctx 降，默认不变（OOM 防线 = 内存闸）。"
- 🔵 **测得更全**：只量 `PagedMemorySize64` 可能答不了 §A①（30.2/~26GB 无出处、疑 CUDA VMM host backing 未必进 PagedMemorySize）。**同时抓** `PagedMemorySize64 + PrivateMemorySize64 + WorkingSet64 + VirtualSize` 四个，才真回答"commit 构成 + 是否随 ctx 降"。（a5-verify.ps1 若只吐一个，扩到四个。）

## 5 · 🔵 注（⑤）：验收臂缺三项
a5-verify.ps1 七项（PID/ctx/commit/kv 行/n_ctx/nvidia-smi/空闲/watchdog/:8000）验的是"**llama 起来了**"，缺"**动作没伤别的 + 消费端回来了**"：
- **旧 17428 真没了**：`Get-Process -Id 17428` 应报 not found（防僵尸/半死）。
- **消费端重连（承重）**：服务"短暂断"后须证**真回来**——`Mind/Qwen 经 adapter 发一次真推理成功**（不只 `/props`，`/props` 只证 llama 活、不证 adapter 重连上新实例）。断了没回 = 比"起来了"更该验。
- **停窗内 supervisor/llm-watchdog 没 fire**：事后查 `logs/console-supervisor-restarts.log` 无新行 + llm-watchdog 仍 0。

## 6 · 交付判词
- **J1 任务单 §1 = NOT-GREEN（一条 CRITICAL MUST，须改后才可交 J1 执行）。**
- **MUST-1（CRITICAL）**：步骤 5 改**手动 llama spawn ONLY**（env-load + 手动闸 + `:132-145` 完整命令原文），**明令禁止 `bash kanet-start-headless.sh`**（它杀 :3200 console = 违 §0 断频道）。
- **MUST-2**：§0 显式加「不许跑 kanet-start-headless.sh（= 杀 console 的动作，也是 console-supervisor 的动作）」。
- **三注（非阻塞，建议同改）**：②:8000 TIME_WAIT 重试判据；④默认值站 VRAM+YaRN 的 caveat + commit 四counter 全量；⑤验收补"旧 PID 没了 / 消费端 e2e 重连 / supervisor 没 fire"。
- ✅ 前置对：ctx-env 落码 / 内存闸落码+边界注 / ③ boundary 实数（63GB 必过）都核过成立。
- **落码/执行前**：Bettor 改 MUST-1/2 进 brief，我复核那两处（尤其手动 spawn 命令逐字对 `:132-145`）再放行 J1 跑。**这是 live 动作，MUST-1 不改不许 J1 执行。**
