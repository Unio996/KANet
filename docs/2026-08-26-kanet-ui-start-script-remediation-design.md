# start 脚本 remediation 设计稿 — Owner 待决 ②③ 两批（设计层 · 零落码）

> **Status**: DRAFT v0.1 · KANet-UI 2026-08-26 · Bettor 派工 (F) · **零落码**; 目的 = Owner 一点方向即可直接进 NWT 审。改动对象全是运维/启动脚本(非产品码/非钱路), 但 **push 即生效 = deploy**(lint 域纪律), 故走报备→NWT 审→Owner 批。
> **依据**: 漂移表 `docs/2026-08-26-kanet-ui-start-script-drift.md`(A/B 逐段 + §4 六处同病) + 探针稿 §0.5 内存闸 `docs/2026-08-26-kanet-ui-kaspad-probe-ibd-vs-dead-design.md`。
> **证据纪律**: 每条 `[MEASURED]`(实测/日志) / `[READ]`(读码) / `[DESIGN-CHOICE]` / `[TODO·需实测]`。
> **本稿进度**: **A 完整(最急, 治 8/23 主因)**; B/C 骨架占位, 后续轮补。

## §A. llama ctx-size 单一源 + 内存闸落点（最急）

### A.1 问题（漂移表 #18 + 探针稿 §0.5 + §9）
- `--ctx-size 1048576` **两处硬编码、无 env 键**: `kanet-start.sh:235` + `kanet-start-headless.sh:109`(另 `C:/KANet` 主网树两份 = 262144, 同机同 GPU 第三/四副本, 值已不同)。
- 8/23 整机崩主因 = llama 双开撑顶 commit(探针稿 §9)。ctx-size 直接决定单实例 KV cache 体积 ⇒ 决定"再拉一个能不能拉垮机器"。
- 现无单一源 ⇒ 改一处漏一处(漂移表通病), 且值本身可能过大。

### A.2 KV cache 实测（`logs/llama-server.log`, live PID 17428）`[MEASURED]`
llama.cpp 装载时打的真实数字(Qwythos-9B Q6_K, `--cache-type-k/v q8_0`, flash-attn on, 4 slots, n_ctx **1048576**):
```
llama_kv_cache: size = 17408.00 MiB (1048576 cells, 8 layers, 4/1 seqs), K (q8_0): 8704.00, V (q8_0): 8704.00
load_tensors: CUDA0 model buffer size = 6212.17 MiB
sched_reserve: CUDA0 compute buffer size = 3120.28 MiB ; CUDA_Host compute buffer = 2064.29 MiB
llama_memory_recurrent: CUDA0 RS buffer = 201.00 MiB
Device 0: RTX 5090, VRAM 32606 MiB
```
- **KV cache 随 n_ctx 线性**(q8_0, 17408 MiB / 1048576 cells = 0.0166 MiB/cell):
  | ctx | KV cache (K+V, q8_0) | 相对 1M 省 |
  |---|---|---|
  | 1,048,576 (1M, 现值) | **17,408 MiB (17.0 GiB)** | — |
  | 262,144 (256k) | **4,352 MiB (4.25 GiB)** | 省 13.0 GiB |
  | 131,072 (128k) | **2,176 MiB (2.13 GiB)** | 省 15.2 GiB |
- 🔴 **现值 1M 已吃 82% 显存**: model 6212 + KV 17408 + compute 3120 + RS 201 = **26,941 MiB / 32,606 MiB = 82.6%**。这本身是脆点(GPU 无余量), 与系统 RAM 无关。
- ⚠ **诚实区分(承重)**: 上表是 **VRAM**(GPU KV buffer), **不是** 8/23 撑顶的**系统 commit**(llama 进程私有 commit 实测 30.2 GB, 探针稿 §0.5)。系统 commit 主体 = mmap 的模型文件(7.36 GB Q6_K)+ CUDA host-pinned/VMM 预留(部分随 VRAM 用量走, `CUDA_Host` 显式 ~2.07 GB, 其余 CUDA runtime 预留无法只从日志逐字归因)。⇒ **降 ctx 明确降 VRAM(线性)+ 部分降 host 缓冲, 但"单实例系统 commit vs ctx"的精确关系需一次性重启在低 ctx 下实测**(重启 = live 动作, A.5 步骤内, Owner 批)。**8/23 OOM 的真正防线是探针稿 §0.5 内存闸; 降 ctx 是纵深防御 + GPU 余量 + 缩小单实例足迹, 不是替代内存闸。**

### A.3 默认值依据（不拍脑袋）`[MEASURED + READ]`
四条独立证据, 结论 = **256k 足够且有原生余量, 1M 是纯浪费**:
1. **架构(硬证据)**: 日志 `n_ctx_orig_yarn = 262144` + `freq_scale = 0.25` ⇒ 模型**原生训练 context = 262,144(256k)**, 1M 是 **4x YaRN 外推**(freq_base 1e7, scale 0.25)。外推段质量降、且付 4x KV。**256k = 拿满原生高质量 context 而不付外推税。**
2. **output 量(实测码)**: Mind/Qwen 调用的 `max_tokens` = **300**(`pool.js:4246` auto-recommend)/ **500**(`bettor-fundamental-enricher.js:188`)/ 默认 **1024**(`anthropic.mjs:14` `AI_MAX_TOKENS`)。输出全在千 token 级。
3. **input 量(读码, 结构性封顶)**: prompt 由 `agent-mind/src/context-builder.mjs`(1208 行)装配, 各段**slice 硬封顶**: 连接 top 20(`:786`)、events top 10(`:741`)、goals top 5(`:397`)、peer notes last 5(`:643`)、discovery limit 200(`:761`)。⇒ 满载 prompt 也就低数万 token 量级, **比 128k 低一个数量级, 比 256k 低近两个**。
4. **:8000 瓶颈(实测)**: 现网 :8000 压力来自 **slot 饱和**(4 slots, `pool.js:317` 饱和探针), **不是 context 长度**——降 ctx 不伤吞吐, 反而释显存可提 slot/batch 余量。
- 🔴 **`[TODO·需实测]` 精确 input 分布未直采**: qwen-worker idle(167k polls/0 served, 走 adapter 直连非 worker)、llama-server 默认不记 per-request prompt 长度 ⇒ 历史 prompt 分布无日志。**建议(A.5 内, 落码前置)**: 给 adapter 加**一行** prompt token 数日志(`console.log` 级, 零行为变更), 跑一天收真实分布 P50/P99, 用它**确认** 256k(或据数据降 128k), 而非仅靠上面结构上界推断。**默认先定 256k(证据 1-4 已足够保守), 128k 待 P99 实测确认后可再降。**
- **[DESIGN-CHOICE] 推荐默认 `LLAMA_CTX_SIZE=262144`(256k)**: 原生 context 上限、KV 4.25 GiB(省 13 GiB VRAM、GPU 从 82.6%→~42%)、对任何真实 Mind prompt 仍 ≥8x 余量。128k(2.13 GiB)是激进档, P99 实测确认 prompt 远低后可切, 但 256k 已消除 8/23 那类"GPU 顶到边"脆性且不赌 input 分布。

### A.4 改动面 `file:line` 表 `[READ]`
| # | 文件:行 | 现状 | 改为 | 判 |
|---|---|---|---|---|
| A-1 | `kanet-start.sh:235` | `--n-gpu-layers 99 --ctx-size 1048576 \` | `--n-gpu-layers 99 --ctx-size "${LLAMA_CTX_SIZE:-262144}" \` | 读 env, fallback 256k |
| A-2 | `kanet-start-headless.sh:109` | 同上硬编 1048576 | 同 A-1 逐字 | 两脚本同源 |
| A-3 | `kanet.env`(新增行) | (无 `LLAMA_CTX_SIZE`) | `LLAMA_CTX_SIZE=262144` | 单一真相源, 与 `LLAMA_MODEL_PATH` 同处管 |
| A-4 | `kanet-start.sh:234-238` + `kanet-start-headless.sh:106-112` 的 spawn 块**之前** | (无内存闸) | 插入内存闸(A.6) | = 探针稿 §0.5 落点②③ |
| A-5(可选·实测用) | agent-adapter 调 llama 处(provider `openai.mjs` 发请求前) | (不记 prompt 长度) | 加一行 `console.log` 打 prompt token 数 | 收 input 分布, 零行为变更 |
- ⚠ `C:/KANet` 主网树两份(`kanet-start.sh:193`/`kanet-start-headless.sh:78`, ctx=262144)**不在本仓、不归本稿改**——它已是 256k, 但属独立部署, 若要统一另立主网侧报备。本稿只钉 D:/kanet-tn12 两份 + kanet.env。

### A.5 停 live llama(17428)使新 ctx 生效 — 执行步骤 `[READ]`
🔴 **改脚本 ≠ 生效**: 两脚本 :8000 守卫都"已在跑就复用"(`kanet-start.sh:225` netstat / `kanet-start-headless.sh:101` curl /v1/models) ⇒ 新 ctx 只在 llama **被停后下一次拉起**才应用。`kanet-stop.sh:69-76` **明确不扫杀 llama**(防误杀 qclaude)。⇒ 需**显式**停:
```
① 报备 + Owner 批(live 动作: 停共享推理服务, Mind/Qwen 会短暂无 LLM)
② 记 PID+CreationDate: Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'"  (现 17428)
③ 内存闸预检(A.6): 停之前先确认停后重拉不会撞内存(此时会释放 30GB, 空间必够)
④ 停: taskkill //PID 17428 //F   (只此一个 llama, netstat :8000 确认无其它)
⑤ 拉: 由下一次 kanet-start.sh / headless 的 :8000 守卫走 fallback spawn 起(带新 ctx); 或手动跑 start 脚本 llama 段
⑥ 验(对照臂, A.7): 新 llama-server.log 的 `llama_kv_cache: size = 4352.00 MiB` (256k) ≠ 旧 17408
```
- 🔵 **时机**: 与 A-1..A-4 落码 + 内存闸同一个部署窗做; 别为单改 ctx 单开一次 llama 重启(它是共享服务, 每停一次 Mind/Qwen 断一次)。

### A.6 内存闸落点（= 探针稿 §0.5 定义，此处装 ②③）`[DESIGN-CHOICE]`
探针稿 §0.5 定义了内存感知拒拉(REQUIRED, 每重进程 spawn 点、每 tick 重查); 落点 ②③(两 start 脚本的 llama 段)就在本稿装:
```bash
# 插在 kanet-start.sh:232 / kanet-start-headless.sh:106 的 "(cd ... llama-server.exe" spawn 之前:
LLAMA_MIN_FREE_COMMIT_GB="${LLAMA_MIN_FREE_COMMIT_GB:-35}"   # 探针稿 §0.5: ≥ 进程私有 commit(30)+margin
free_gb=$(powershell -NoProfile -Command "[math]::Floor((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB)" | tr -d '\r')
if [ -n "$free_gb" ] && [ "$free_gb" -lt "$LLAMA_MIN_FREE_COMMIT_GB" ]; then
  warn "llama spawn 拒: 空闲 commit ${free_gb}GB < ${LLAMA_MIN_FREE_COMMIT_GB}GB (refuse-start:low-commit, 防 8/23 双开撑顶)"
  # 不 spawn; 走已有的 LLAMA_SKIPPED 分支
else
  ( ... 现有 spawn ... )
fi
```
- 与 :8000 守卫的关系: **守卫在前**(已在跑就复用, 根本不 spawn)→ 内存闸只在"确实要 spawn"时才判。两道叠加 = 既不重复起(守卫)也不缺内存硬起(内存闸)。
- 数值 35 GB 依据: llama 私有 commit 实测 30.2 GB + ~5 margin(探针稿 §0.5)。降 ctx 到 256k 后单实例足迹会小一些, 阈值可随实测下调(A.5 ⑥ 顺带量 commit)。

### A.7 回滚 + 验收（对照臂）
- **回滚**: 三处都是"加 env 读取 + 一个 if", git revert 单 commit 即回硬编码 1M + 无闸态; kanet.env 删 `LLAMA_CTX_SIZE` 行即恢复 fallback(fallback=256k, 若要回 1M 则 fallback 也要改回——建议 fallback 就是目标值 256k, 回滚只回"来源", 不回"数值", 避免 revert 意外把 1M 带回来)。
- **验收(对照臂, 落码后)**:
  | # | 场景 | 构造 | 预期 |
  |---|---|---|---|
  | VA-1 | env 生效 | kanet.env `LLAMA_CTX_SIZE=262144`, 停 llama 重拉 | 新 `llama-server.log` `kv_cache: size = 4352.00 MiB`; /props `n_ctx=262144` |
  | VA-2 | env 缺省 fallback | 临时注释 kanet.env 行, 重拉 | ctx=262144(fallback), 不是 1M |
  | VA-3 | 两脚本同值(对照臂) | 分别用 kanet-start.sh 与 headless 各拉一次(隔离) | 两次 /props n_ctx 相同 = 消漂移 |
  | VA-4 | 内存闸拒拉 | mock `FreeVirtualMemory` < 35GB(或真在高占用时) 跑 llama 段 | 日志 `refuse-start:low-commit`, 无第二 llama spawn |
  | VA-5 | 内存闸放行 | 空闲 commit 充足 | 正常 spawn, 新 ctx 生效 |
  | VA-6 | VRAM 余量(对照臂) | 新 llama 起后读 nvidia-smi / 日志 | VRAM 用量从 ~27GB 降到 ~13-14GB(model+KV256k+compute) |
  | VA-7(若做 A-5) | input 分布 | adapter 日志跑一天 | P99 prompt token 数 ≪ 262144, 确认 256k 保守(或据此降 128k) |

---

## §B. headless 六处「改 A 忘 B」（漂移表 §4）— 骨架，后续轮补
覆盖漂移表 §4 的 #24/#15(bridge 栈+ws-proxy 杀不重起)、#21(console.log 不归档)、#4(无 KANET_TEST_MODE)、#9(supervisor 增殖+pidfile TOCTOU)、#7(端口释放 :3400 无效)、#22(仅 headless 有 --max-old-space-size)。
- **核心设计问题(待定, 本轮先记)**: A/B 合单源 —— 建议 **headless 只做 "stop→start" 薄包装, 复用 kanet-start.sh 抽出的段落函数**(env 加载/llama 段/console 启动/日志归档 → `lib/kanet-start-common.sh`), A 保留 UI+bridge 栈, headless 只多 JSON 输出。理由/取舍下一轮展开 + 每处 file:line 修法表 + supervisor 增殖 TOCTOU 修法 + console.log .prev 补 headless。
- supervisor 增殖: `kanet-start-headless.sh:151-157` 每拉 console 再查 pidfile 起 supervisor, pidfile 存在性检查与 start 之间有 TOCTOU; 修法下一轮。

## §C. 接位目录入库 → docs/handoff/ — 骨架，后续轮补
- `C:\开发过程\…\开发智能体接位\*.md` + 三份 SOP(coord-status-验签 / 频道-Monitor / 终端自驱-禁菜单) → `docs/handoff/`, 原目录留指路桩(7/12 设计 B §2.2 照抄, H3a/H3c 两条硬化别漏)。
- `_bettor_launch_agents.ps1` 改读 `docs/handoff/` + already-running 判重 + heartbeat 文件(NWT 机制红队两条 MUST-FIX)。
- 每处 file:line / 回滚 / 验收下一轮补。
