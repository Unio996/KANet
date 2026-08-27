# start 脚本 remediation 设计稿 — Owner 待决 ②③ 两批（设计层 · 零落码）

> **Status**: DRAFT **v0.2** · KANet-UI 2026-08-26 · Bettor 派工 (F) · **零落码**; 改动对象全是运维/启动脚本(非产品码/非钱路), **push 即生效 = deploy**, 走报备→NWT 审→Owner 批。
> **B/C v0.2(应 NWT 红队 `docs/2026-08-26-NWT-redteam-start-script-remediation-BC.md` d9b7c37a, §B/§C PASS-WITH-MUST-FIX)**: ①#9c 删 flock(本机 Git-Bash `command -v flock`=NOT-FOUND 已自核), 改 mkdir 锁 + 锁内写 PID + stale-PID 回收(持锁进程被 SIGKILL 不 rmdir ⇒ 锁永久残留 ⇒ supervisor 永不起=把'多起一个'换成'再也起不来', 正是 8/23 形态)+ EXIT trap。②#9b 不用可继承 env KANET_SUPERVISED(向子树传播, 失效 fail-open: 操作员 shell 残留=1→手动 kanet-start.sh 静默不起监工=亲手复刻 8/23 无报错), 改显式 `--supervised` 参数(作用域一次调用不继承)。③heartbeat 判死绝不唯一触发(自报族两向都失: fresh≠活/stale≠死, 合法静默可达 10-20min), 配进程存活 + 阈值≥15-20min。非阻塞: sidecar 幂等'活'判据看端口 LISTEN 非进程存在。
> **v0.2(应 NWT 红队 `docs/2026-08-26-NWT-redteam-start-script-remediation.md` 32b47138, §A PASS-WITH-MUST-FIX)**: ①归因半错纠正 — mmap 模型 file-backed **不进私有 commit**(log:138 mmap=true / :142 CPU_Mapped 795.70 MiB), 删"系统 commit 主体=mmap 模型"; 30.2GB 里只 ~2-4GB(CUDA_Host)有出处, ~26GB 无出处(疑 CUDA VMM host backing, 推断); **A.5 低 ctx 重启实测私有 commit 从步骤升为【改默认值硬前置】, 测出前不许写"降 ctx 缩小 OOM 足迹"**。②256k 依据补 conversationHistory cap 实证 + 防回归注。③**第五 ctx 站: llm-watchdog.mjs:49 也硬编 1048576**(无 :8000 守卫, 若在跑会 taskkill 后用 1M 重拉复活双开源)。
> **依据**: 漂移表 `docs/2026-08-26-kanet-ui-start-script-drift.md`(A/B 逐段 + §4 六处同病) + 探针稿 §0.5 内存闸 `docs/2026-08-26-kanet-ui-kaspad-probe-ibd-vs-dead-design.md`。
> **证据纪律**: 每条 `[MEASURED]`(实测/日志) / `[READ]`(读码) / `[DESIGN-CHOICE]` / `[TODO·需实测]`。
> **本稿进度**: **A + B + C 完整**(A 治 8/23 主因; B 六处改-A-忘-B; C 接位入库)。

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
- ⚠ **诚实区分(承重·v0.2 NWT ① 纠正)**: 上表是 **VRAM**(GPU KV buffer), **不是** 8/23 撑顶的**系统 commit**(llama 私有 commit 实测 30.2 GB, 探针稿 §0.5)。
  - 🔴 **原稿"系统 commit 主体 = mmap 模型 7.36GB"已被证伪**: 日志 `:138 mmap = true` + `:142 CPU_Mapped model buffer = 795.70 MiB` ⇒ 模型是 **file-backed mmap, 不进私有 commit**(且映射到 host 的只有 795.70 MiB, 大头 6212 MiB 在 CUDA0 VRAM)。删该句。
  - **私有 commit 30.2 GB 的构成【未验】**: 只 ~2-4 GB 归得出(`CUDA_Host` compute buffer ~2.07 GB pinned); **~26 GB 无逐字出处**(疑 CUDA VMM host backing, `VirtualSize` 247 GB 佐证——这是**推断**不是坐实)。
  - ⇒ **降 ctx 降 VRAM 是真价值且已坐实**(82.6%→~42%, 线性); 但 **"降 ctx 缩小 8/23 那个系统 commit 足迹" = 未证**。**A.5 低 ctx 单实例重启实测私有 commit = 改默认值的硬前置(见 A.5)**; 测出前**本稿不许**声称降 ctx 缩小了 OOM 足迹。
  - 🔴 **这反而强化: 8/23 OOM 真防线 = 探针稿 §0.5 内存闸**(它按实测 FreeVirtualMemory 拒拉, 不依赖"降 ctx 是否降 commit"这个未证命题)。降 ctx = GPU 余量 + 纵深防御, **不是** OOM 主刀。

### A.2-after A.5 已执行实测（`docs/2026-08-27-a5-baseline-after.txt`, live PID 4976, n_ctx **262144**）`[MEASURED 2026-08-27]`
J1 于 18:58:47 重拉 llama 到 256k(pid 17428→4976)。a5-verify after 对照 before(`docs/2026-08-27-a5-baseline-before.txt`):
| 项 | before(17428, 1M) | after(4976, 256k) | 变化 |
|---|---|---|---|
| n_ctx | 1,048,576 | 262,144 | 256k 生效 |
| KV cache (q8_0) | 17,408 MiB | **4,352 MiB (262144 cells)** | ↓13.0 GiB |
| PrivateCommit | 30.15 GB | **13.58 GB** | **↓16.57 GB** |
| VRAM used | 28,488 MiB | 13,117 MiB | 82.6%→~40% |
| free commit | 32.7 GB (used 67) | 44.1 GB (used 55.5) | 合 r4 硬闸 ≤80∧≥20 |
| :8000 host | 0.0.0.0 | **127.0.0.1** | 暴露面收窄(旧全网卡→仅本机) |
| llm-watchdog | 0 | 0 | 未跑, 无 memgate 干扰 |
- ✅ **KV 4,352 MiB 恰中 A.2 表对 262144 的预测(4,352 MiB)** ⇒ 线性 KV 模型坐实。
- 🔵 **A.2 那条"未证"悬案现有实测了**: 降 ctx 1M→256k, **私有 commit 实降 ~16.6 GB**(30.15→13.58) ⇒ **降 ctx 确实缩小了私有 commit 足迹**(A.5 硬前置已满足, 不再是"未证")。原~26GB"无逐字出处"部分随 ctx 大幅缩小, 佐证其确与 ctx/KV 相关(CUDA VMM host backing 推断得到支持, 但仍非逐字坐实)。
- 🔴 **不改结论**: OOM 主防线仍是探针稿 §0.5 内存闸(按实测 FreeVirtualMemory 拒拉); 降 ctx = GPU 余量 + 私有 commit ↓16.6GB 的纵深, 不替代内存闸。
- 📌 J1 重拉用手动(pidfile 缺=非标准 launcher)。谁停 17428 未查(4689 进程退出审计默认关, Bettor 免查)。after 文件未 commit(等 Bettor 批一并推)。

### A.3 默认值依据（不拍脑袋）`[MEASURED + READ]`
四条独立证据, 结论 = **256k 足够且有原生余量, 1M 是纯浪费**:
1. **架构(硬证据)**: 日志 `n_ctx_orig_yarn = 262144` + `freq_scale = 0.25` ⇒ 模型**原生训练 context = 262,144(256k)**, 1M 是 **4x YaRN 外推**(freq_base 1e7, scale 0.25)。外推段质量降、且付 4x KV。**256k = 拿满原生高质量 context 而不付外推税。**
2. **output 量(实测码)**: Mind/Qwen 调用的 `max_tokens` = **300**(`pool.js:4246` auto-recommend)/ **500**(`bettor-fundamental-enricher.js:188`)/ 默认 **1024**(`anthropic.mjs:14` `AI_MAX_TOKENS`)。输出全在千 token 级。
3. **input 量(读码, 结构性封顶 + NWT ② 逐段核)**: prompt 由 `agent-mind/src/context-builder.mjs`(1208 行)装配, 各段 **slice 硬封顶**: 连接 top 20(`:786`)、events top 10(`:741`)、goals top 5(`:397`)、peer notes last 5(`:643`)、discovery limit 200 fetch→**3 桶×20 渲染**(`:761`, 大头)。**conversationHistory 渲染层无 cap, 但上游 `mind.mjs:65 EPISODE_MAX_HISTORY=20` + `:196 每条 .slice(0,500)` 双封顶**(20 turns × 500 char)。⇒ NWT 逐段核最坏 **~15-20k token**, **比 128k 低约一个数量级, 比 256k 低近两个**。
   - 🔴 **防回归注(NWT ②)**: 此上界依赖 context-builder 那些 slice + mind.mjs 的 history cap。**若日后放开任一 slice/cap 上限, 须重估 ctx 默认**(否则"prompt≪ctx"前提失效)。128k 更激进档等 A.5 prompt 日志 P99 实测再定。
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
| **A-1c(NWT ③ 第五站)** | `scripts/llm-watchdog.mjs:49` | `'--n-gpu-layers','99','--ctx-size','1048576',` | 读 env: `process.env.LLAMA_CTX_SIZE || '262144'` | 🔴 **它也硬编 1M**; 且无 :8000 守卫 —— 若在跑, taskkill 17428 后它会用 **1M** 重拉 = 废掉整个修复 + 复活双开源。**必须同改**, 且**补 :8000 守卫**(spawn 前 probe :8000, 在跑就不 spawn, 照 start 脚本) + 内存闸(§0.5 落点④) |
| A-5(可选·实测用) | agent-adapter 调 llama 处(provider `openai.mjs` 发请求前) | (不记 prompt 长度) | 加一行 `console.log` 打 prompt token 数 | 收 input 分布, 零行为变更(产品码改动, 走报备) |
- ⚠ `C:/KANet` 主网树两份(`kanet-start.sh:193`/`kanet-start-headless.sh:78`, ctx=262144)**不在本仓、不归本稿改**——它已是 256k, 但属独立部署, 若要统一另立主网侧报备。本稿只钉 D:/kanet-tn12 两份 + kanet.env。

### A.5 停 live llama(17428)使新 ctx 生效 — 执行步骤 `[READ]`
🔴 **改脚本 ≠ 生效**: 两脚本 :8000 守卫都"已在跑就复用"(`kanet-start.sh:225` netstat / `kanet-start-headless.sh:101` curl /v1/models) ⇒ 新 ctx 只在 llama **被停后下一次拉起**才应用。`kanet-stop.sh:69-76` **明确不扫杀 llama**(防误杀 qclaude)。⇒ 需**显式**停:
```
① 报备 + Owner 批(live 动作: 停共享推理服务, Mind/Qwen 会短暂无 LLM)
🔴② **改默认值硬前置(NWT ①)**: 停 17428 之前, 先在**低 ctx** 起一个 llama 实测私有 commit(或停后以 256k 重拉立即量 `PrivatePageCount`), 与现 30.2GB 对比 —— **这一步是把 LLAMA_CTX_SIZE 默认值写进 kanet.env 的前提**; 测出前稿里不写"降 ctx 缩小 OOM 足迹"。若实测显示私有 commit 不随 ctx 显著降, 则 ctx 决策**只**由 VRAM + YaRN 原生 context 支撑(仍成立), OOM 防护全靠 §0.5 内存闸。
🔴③ **确认 llm-watchdog 未跑(NWT ③)**: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? CommandLine -like '*llm-watchdog*'` 必须**空**——否则它会在 taskkill 后用 1M 重拉。在跑则先停它(且先落 A-1c 的守卫+ctx 改)。`[MEASURED 2026-08-26: 未跑]`
④ 记 PID+CreationDate: Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'"  (现 17428)
⑤ 内存闸预检(A.6): 确认重拉不撞内存(停会释放 commit, 空间必够)
⑥ 停: taskkill //PID 17428 //F
⑦ **确认 :8000 真释放再重拉(NWT ③ 次要)**: `netstat -ano | grep ":8000 "` 无监听后, 才由下一次 start 脚本 :8000 守卫走 fallback spawn 起(带新 ctx)
⑧ 验(对照臂, A.7): 新 llama-server.log `llama_kv_cache: size = 4352.00 MiB`(256k) ≠ 旧 17408; 同时量新实例 `PrivatePageCount` 收 ② 的数
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

## §B. headless 六处「改 A 忘 B」（漂移表 §4）

### B.0 架构决定：抽 `lib/kanet-start-common.sh`（不是"headless 调 kanet-start.sh"）`[DESIGN-CHOICE]`
两个候选:
- **(选)抽公共 lib**: 把两脚本逐字相同的四段(env 加载 / 停旧进程 / llama+内存闸 / console 启动 + 日志归档)+ sidecar 拉起, 提成 `lib/kanet-start-common.sh` 的**函数**; A source 它 + 只加 UI/banner/bridge/tail, headless source 它 + 只加 JSON 输出。"两份逐字相同的段"从此**字面上是同一个函数**, 改一处两边都变 = 漂移物理不可能。
- **(否)headless 调 kanet-start.sh**: 不行 —— kanet-start.sh 是**交互+阻塞**(`:43-49` clear/banner, `:429` `tail -f` 永不返回), headless 需**非阻塞+JSON+spawn-不-等 llama**; source 它会继承 tail 阻塞。反向(kanet-start.sh 调 headless)更糟: A 丢掉自己的交互 tail/UX。
- ⇒ **A/B 真正不同只在两端**(A=交互 UI+bridge+tail; B=JSON+非阻塞), 中间全同 ⇒ 抽函数是唯一对的粒度。

### B.1 公共 lib 函数清单（新文件 `lib/kanet-start-common.sh`）
| 函数 | 内容(现出处) | 修掉的漂移 |
|---|---|---|
| `kanet_load_env` | env 全量 export + 变量转换 + **export KANET_TEST_MODE**(A:15) + 派生 CONSOLE_PORT(A:118/B:51) | #4(B 补上 KANET_TEST_MODE) |
| `kanet_stop_old` | 停旧进程, **跳过 console-supervisor.pid + ws-proxy/bridge 各 pidfile**(现 A:62 只跳 supervisor, B:65-72 全杀) | #9(不再杀 sidecar/supervisor) |
| `kanet_archive_console_log` | `mv console.log console.log.prev` 再截断(A:265-266) | #21(B 补归档) |
| `kanet_spawn_llama` | llama spawn + **A.6 内存闸** + `--ctx-size "${LLAMA_CTX_SIZE:-262144}"`(§A) | #18 + §A |
| `kanet_spawn_console` | console spawn + **统一 node flags `--max-old-space-size=4096`**(现只 B:129 有) | #22(两边同 flags) |
| `kanet_bring_up_sidecars` | ws-proxy(A:162-207) + bridge 栈(A:307-386)。🔵 **NWT 非阻塞: 幂等"活"判据看端口 LISTEN(netstat), 不看进程存在** —— wedge 死锁进程仍在但端口不 LISTEN, 看进程会漏重建 | #15+#24(自愈后 sidecar 重建) |
| `kanet_ensure_supervisor` | 幂等起 supervisor(mkdir 锁+stale 回收, B.2 #9c), **`--supervised` 参数时 no-op**(不用可继承 env, B.2 #9b) | #9 递归+TOCTOU |
- **调用序(两脚本都按此, 由 lib 强制)**: `kanet_load_env` → `kanet_stop_old` → `kanet_archive_console_log` → `kanet_spawn_llama` → `kanet_spawn_console` → `kanet_bring_up_sidecars` → `kanet_ensure_supervisor`。**load_env 在 stop_old 之前** ⇒ 修 #7(端口释放用真 CONSOLE_PORT 非默认 3400)。

### B.2 逐处修法 `file:line` 表
| 漂移# | 现状(file:line) | 修法 | 判据/理由 |
|---|---|---|---|
| #4 KANET_TEST_MODE | 只 A:15 export; headless 无 | 移进 `kanet_load_env` | 两脚本起的 console 行为一致(reset_peer endpoint 注册与否不再看走哪个脚本) |
| #7 端口释放 :3400 | A:75-84 用 `$CONSOLE_PORT`(此刻=默认 3400, env 未加载) | `kanet_stop_old` 在 `kanet_load_env` 之后跑 | A 的"释放 :3200"真生效(现在放空 :3400) |
| #9a supervisor 被杀 | B:65-72 无差别杀所有 pidfile(含 supervisor 自己) | `kanet_stop_old` 跳过 console-supervisor.pid(照 A:62) | supervisor 调 headless 时不再自杀 |
| #9b supervisor 增殖递归 | B:151-157 每拉 console 再起 supervisor | 🔴 **NWT ②: 不用可继承 env** —— supervisor 调 headless 传 **显式参数 `--supervised`**(作用域仅这次调用、**不继承给子树**); `kanet_ensure_supervisor` 见此参数 no-op。**禁 `export KANET_SUPERVISED=1`**: 可继承 env 会向整个子树传播, 失效方向 fail-open(操作员 shell 残留 `=1` → 手动 `kanet-start.sh` 静默不起监工 = 用 remediation 亲手复刻 8/23 且无报错)。备选: `kanet_ensure_supervisor` 正向核父进程是不是 supervisor(不靠传标记) | 断递归, 且不制造 fail-open 缺口 |
| #9c pidfile TOCTOU | B:151-152 "pidfile 存在且 kill -0" 与随后 start 非原子 | 🔴 **NWT ①: 删 flock**(本机 Git-Bash `command -v flock`=**NOT-FOUND**, 已自核)。用 **mkdir 锁**(原子)+ **锁目录内写持锁 PID** + **stale 回收**: 取锁失败时读锁内 PID, `kill -0` 判它是不是孤儿(持锁进程被 SIGKILL 不会 rmdir ⇒ 锁目录永久残留 ⇒ supervisor **永不起** = 把"多起一个"换成"再也起不来", **正是 8/23 形态**), 是孤儿则 `rmdir` 重试取锁; 持锁进程加 **EXIT trap** 释放锁。备选: **后验去重**(起手后发现自己非唯一 supervisor 则 loser 主动退) | 两并发不各起一个 supervisor, 且锁不因崩溃永久卡死 |
| #15 ws-proxy 杀不重起 | B 无 ws-proxy 段; #9 循环杀 `kaspa-ws-proxy.pid` | `kanet_bring_up_sidecars` 含 ws-proxy(幂等), 两脚本都调 | headless 自愈后 :17310 重建 |
| #21 console.log 不归档 | B:122 直接 `> console.log` | `kanet_archive_console_log`(mv→.prev) | headless 自愈保住死前现场(接位 ⓪ 步痛点) |
| #22 max-old-space | 只 B:129 有 `--max-old-space-size=4096` | `kanet_spawn_console` 统一带此 flag | A/B 起的 console V8 堆一致 |
| #24 bridge 栈杀不重起 | B 无 bridge 段; #9 循环杀其 pidfile | `kanet_bring_up_sidecars` 含 5 个 bridge(幂等), 两脚本都调 | 自愈后 owner-bot/channel-bridge 等重建(现网正缺) |
- ⚠ **sidecar 重建的一个真问题(标出, 供 NWT/Bettor 判)**: channel-bridge 的 `consoleUrl` 现 = :3100(漂移表另项 + 五服务清单已记), 起了读错网。**`kanet_bring_up_sidecars` 拉 channel-bridge 前必须先把该 config 改 :3200**(否则自愈会稳定拉起一个读错网的进程)——这条**并入本批**一起改, 别单拉。

### B.3 回滚 + 验收（对照臂）
- **回滚**: 新增 `lib/kanet-start-common.sh` + 两脚本改为 source 它, 是一个逻辑 commit; git revert 即回两份独立脚本原状。**建议分两步落**: 先加 lib 且两脚本函数体**逐字等价**迁入(NWT diff 证"行为零变更"=纯重构), 绿了再在 lib 里逐条打开 B.2 的修法(每条单独 diff)。避免"重构+改行为"混在一个 diff 里没法审。
| # | 验收(对照臂) | 构造 | 预期 |
|---|---|---|---|
| VB-1 | 纯重构等价 | 迁入 lib 后, 两脚本各跑一次 vs 迁入前 | 起的进程集合/端口/log 逐项相同(证重构零行为变更) |
| VB-2 | #24 自愈重建(对照臂) | kill console 触发 supervisor→headless 自愈 | 自愈后 :9100/:17310 + owner-bot/channel-bridge **都在**(现在: 都没) |
| VB-3 | #21 归档 | headless 自愈一次 | `console.log.prev` 是自愈**前**那份(现在: 被截断丢失) |
| VB-4 | #9 无增殖 | supervisor 触发 headless 10 次 | 全程 supervisor 进程数恒 1, 无第二个 `_run`(现在: 疑 flap) |
| VB-5 | #7 端口 | A 在 :3200 被占时跑 | 真释放 :3200(现在: 放空 :3400) |
| VB-6 | #4 parity | headless 起的 console 查 /api/test/reset_peer | 注册(与 A 起的一致) |

### B.4 VB-1 实施发现（2026-08-27·裁 (A)·覆盖面缩小 + 原因）
🔴 **VB-1 原设想"抽 7 函数零变更"内部矛盾**: 7 函数里至少 6 个对应【当前就漂移】的段, 抽成单一共享函数 = 隐性统一 = 把 VB-2+ 的修法(#4/#7/#9/#21/#22/#15/#24)混进"零变更"步, NWT 证不了、也违两步落地初衷。⇒ Bettor 裁 **(A)**: VB-1 只抽**今日已证 behavior-identical** 的子集, 每候选 prove-then-extract; 漂移段各留原脚本, VB-2+ "抽+修"同 commit 配对照臂。
**prove-then-extract 结果(证明: `docs/2026-08-27-kanet-ui-vb1-loadenv-equivalence-proof.md`)**:
| 候选 | 判 | 依据 |
|---|---|---|
| **load_env** | ✅ **抽**(唯一过) | 27-key vs 3-key case 但**净 env 态+shell 变量逐字等价**(全量 export 透传, case 差异是重命名/冗余); lib-call env|sort == 两脚本 inline |
| archive_log(#21) / spawn_console(#22) / KANET_TEST_MODE(#4) / stop_old(#9a) / llama spawn 外壳 / sidecars(#15#24) / ensure_supervisor(#9b#9c) | ✗ 漂移·留 VB-2+ | 逐字不同(实证表见证明文档 §4) |
⇒ **VB-1 = 新增 `lib/kanet-start-common.sh`(仅 `kanet_load_env`)+ 证明; 活 kanet-start.sh/headless 不动**(lib dead-until-wired)。接线(两脚本 source+调用)= NWT 确认等价后**单独一步**, 在能当场复验 supervisor 自愈的窗口做(共享树=live 树)。
🔵 **`$@` 作用域雷预注册**(第一已知差异点): VB-2+ 抽 spawn_llama 时, 函数内 `$@`≠脚本参数 ⇒ `--memgate-force` 会到不了闸(静默 fail-open)。修法=显式 `kanet_spawn_llama "$@"`; 对照臂=抽后 `bash kanet-start.sh --memgate-force` 断言日志出 `memgate:forced`。VB-1 不触发(load_env 不用 `$@`)。
🔨 **方法论坑记录**(证明文档 §3): 初版 `env -i bash` 清了 PATH ⇒ 两 harness 没跑输出都空 ⇒ diff 假报 IDENTICAL(空==空绿灯无信息)。修=`env -i PATH="$PATH"` + 比对前验两文件 `[ -s ]` 非空。

## §C. 接位目录入库 → `docs/handoff/`

### C.1 为什么（漂移表同族 + 单点失败）
接位文件现在**只在** `C:\开发过程\多智能体开发框架\开发智能体接位\`(仓外、非入库、非跨机)。问题: ①仓外产物无法差分/无 diff 审(记忆 feedback-hash-detects-change-but-cannot-support-a-differential); ②跨机(J1 younio)拿不到; ③改了没有版本历史。入库 `docs/handoff/` = 可差分 + 跟仓走 + 接位者 `git` 即得。

### C.2 迁移清单（`ls` 实测）`[MEASURED]`
源目录现有 .md(11 个): 5 接位(Bettor/J1/J2/NWT/KANet-UI) + 3 SOP(coord-status-验签 / 终端自驱-禁菜单 / 频道-Monitor) + 3 个 new-user-tn(operating-manual / daily-ops / 接位 / 接位与日常运维整合)。
| 迁移 | 文件 | 去向 |
|---|---|---|
| 核心(Bettor 点名) | 5×`*-接位.md` + 3×`*-SOP.md` | `docs/handoff/` |
| 附带(建议同迁, 同类) | `new-user-tn-*.md`(3-4 个运维手册) | `docs/handoff/` 或 `docs/handoff/new-user-tn/` |
- **原址处置(H3c 硬化, 7/12 设计 :53/:54)**: 迁移后原目录**只留指路桩, 不留完整废内容** —— **横幅可被 offset 读绕过**(7/12 实证: NWT 接位被贴旧路径整读了旧内容)。桩文件**首行即指路**(扛 offset 读): 如 `→ 本文件已迁入库: D:\kanet-tn12\docs\handoff\<name>.md — 原址不再维护, 勿读此桩下方(若有)。`, 桩下不留旧正文。

### C.3 launcher `_bettor_launch_agents.ps1` 改造 `[READ]`
现状(读码): `:14 $base = 'C:\开发过程\...\开发智能体接位'`; `:23 $handoff = Join-Path $base "$a-接位.md"`; `:35` 每次盲 `Start-Process` 开新窗口, **无判重、无 heartbeat**。
| 改# | file:line | 现状 | 改为 |
|---|---|---|---|
| C-1 | `:14` | `$base = 'C:\开发过程\...'` | `$base = Join-Path $repo 'docs\handoff'`(读入库路径) |
| C-2(NWT MUST-FIX 判重) | `:22-38` 循环 | 每次盲开新窗 | 开窗前判 `claude-$a` **已在跑**则跳过 —— 查同名窗口标题 / 或读 heartbeat 文件(C-3)判活; 已活跳过 + 日志记 `skip:already-running`。防双开(同一 agent 两窗 = 两会话抢同一活, 对等消息目标歧义) |
| C-3(NWT MUST-FIX heartbeat) | 新增 | (无) | agent 周期写 `logs/heartbeat-<agent>.json`(ts+session)。🔴 **NWT ③ 纪律: heartbeat 是自报族, 两向都失** —— **fresh≠活**(wedge 卡死但定时器还跳)、**stale≠死**(Claude 会话深度工作 10-20min 合法静默, NWT 审 E1 时自己就 10+min 没写)。⇒ **① 判重防双开(C-2)可用**(存在即跳, 保守安全); **② 判死触发重启【绝不以 heartbeat 为唯一触发】**, 须配**进程存活检查** + 阈值 **> 最长合法静默(≥15-20min, 宁长勿短)**。heartbeat 写入是 agent 侧(接位文件加自写一步, handoff 文档改动随 C) |
- ⚠ **H3a(7/12 设计 :53/:61, 活进程旧副本)**: 已 armed 的长驻 Monitor 进程持有**旧路径/旧 NAMES 内存副本**, 文件搬家不刷新运行中进程。⇒ C 落地时**显式广播"全员按新 `docs/handoff/` 路径重新 arm monitor"一步 + 杀孤儿旧 monitor 进程**(不假设 file move 传播到活进程)。本机三人的频道 Monitor 都要重 arm。

### C.4 回滚 + 验收（对照臂）
- **回滚**: git mv 的逆操作 + launcher `$base` 改回; 桩文件删除。分两 commit: ①`git mv` 入库 + 留桩(纯移动, NWT 核内容 byte 等价) ②launcher 改路径 + 判重 + heartbeat(逻辑改动单独审)。
| # | 验收(对照臂) | 构造 | 预期 |
|---|---|---|---|
| VC-1 | 内容等价 | `git mv` 后 diff 源vs目标 | byte 等价(纯移动) |
| VC-2 | 桩扛 offset 读 | `tail -c 200 <原址桩>` 与 `head` | 都只见指路句, 无旧正文 |
| VC-3 | launcher 读新路径 | `-DryRun` 跑 | handoff 路径 = `docs\handoff\<a>-接位.md`, 存在 |
| VC-4(判重) | already-running | `claude-KANet-UI` 在跑时再跑 launcher | skip + 日志 `already-running`, 不开第二窗 |
| VC-5(heartbeat) | 活性可读 | agent 起后 | `logs/heartbeat-<a>.json` ts 在刷新; launcher/监工读得到 |
| VC-6(H3a) | 无孤儿旧 monitor | 迁移+广播后 | 无进程仍指旧 `C:\开发过程` 路径 arm 的 monitor |

### C.5 依赖顺序
C 落地前置(7/12 §4 序): 先 `git mv` 入库 + 留桩(H3c) → launcher 改路径 → 判重+heartbeat(NWT 两 MUST-FIX) → **显式广播全员重 arm monitor + 杀孤儿(H3a)**。heartbeat 需 agent 侧接位文件加"自写心跳"一步 = handoff 文档改动, 随本批。
