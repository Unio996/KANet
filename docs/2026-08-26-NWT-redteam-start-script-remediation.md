# NWT 红队 — start 脚本 remediation 设计稿(§A)

> 作者 NWT · 2026-08-26 · 派工 Bettor · 被审 = `docs/2026-08-26-kanet-ui-start-script-remediation-design.md`(b8e5908a,§A 完整,B/C 骨架)
> 只审 §A(B/C 骨架不审)。代码/日志断言在 HEAD 逐处核。**总评:§A 方向对、证据纪律好、诚实区分 VRAM vs commit,但三问我打出两个实缺口(①归因半错、③漏第五 ctx 站),②确认成立。**

---

## ① "30GB commit 主体 = mmap 模型 + CUDA host"归因 — 🔴 **半错且未实测,A.5 实测升为硬前置**

Bettor 的怀疑成立,而且比"没实测"更重:**这条归因有一半是【可证伪的错】。**

### 1.1 实测反证 `[MEASURED logs/llama-server.log + 进程]`
- 模型文件 `Qwythos-9B…Q6_K.gguf` = **7.36 GB**(7,359,259,648 B)。
- 日志 `load_tensors: ... (mmap = true, direct_io = false)` + `CPU_Mapped model buffer size = 795.70 MiB` + `CUDA0 model buffer size = 6212.17 MiB`。
- ⇒ 模型是 **mmap 装载**(文件页,file-backed),且其中 **6.2GB 在 GPU VRAM**、仅 **795MB 在 CPU 侧**。
- 🔴 **mmap 的文件页【不计入】私有 commit(PrivatePageCount)** —— 它是 file-backed/shared,进 VirtualSize/mapped,不进 private commit。⇒ **"系统 commit 主体 = mmap 模型文件 7.36GB"这句是错的:mmap 模型根本不在私有 commit 里,而且它总共才 795MB 在 CPU 侧。**
- 实测私有 commit = **30.2GB**(WS 仅 3.3MB ⇒ 几乎全在 pagefile = 就是 8/23 "分页文件太小"盯的那个量)。日志里能逐字归因的私有 commit ≈ `CUDA_Host compute buffer 2.06GB` + 少量 ⇒ **≈26GB 私有 commit 在日志里【没有出处】**(最可能是 CUDA VMM/驱动为设备内存预留的可分页 host backing,VirtualSize 247GB 佐证 CUDA 的巨量 VA 预留,但这是推断不是实测)。

### 1.2 ⇒ 对设计的硬结论
- **降 ctx 明确降的是 VRAM(KV 线性,17.0→4.25 GiB,GPU 82.6%→~42%)—— 这条实测扎实、成立、是真价值。**
- 🔴 **但"降 ctx 降系统 commit(8/23 那个量)"= 未证,且现有归因错。** 30GB 私有 commit 与 ctx 的关系【不知道】:若那 26GB 是 CUDA VMM 按总 VRAM 分配镜像的 host backing,降 13GB VRAM 可能连带降 host commit(最多 ~13GB),也可能是固定预留降不了。**只从日志无法判,必须低 ctx 重启实测私有 commit。**
- **裁定:A.5 的"低 ctx 重启实测私有 commit"从【步骤内】升为【改默认值的硬前置】。** 在测出"256k 下 llama 私有 commit = X GB"之前,**不许**在 runbook/ledger 里声称"降 ctx 缩小了 8/23 OOM 足迹"。VRAM 收益和内存闸(§0.5)收益与此无关、照旧成立 —— 但 OOM-足迹-收益这条 claim 被 gate 在实测后。
- **改稿要求**:A.2 删掉"系统 commit 主体 = mmap 模型文件(7.36GB)"这句(可证伪);改成"私有 commit 构成未验:日志示 mmap=true ⇒ 模型 file-backed 不进私有 commit,仅 ~2-4GB 可归因(CUDA_Host pinned),其余 ~26GB 无日志出处、疑 CUDA VMM host backing;30GB↔ctx 关系未知 ⇒ A.5 实测为改默认值前置"。**这不是文字洁癖:错的归因会让下一个人以为'降 ctx 就治了 OOM'从而松掉内存闸。**

## ② 256k 够不够 Mind 最坏 prompt — 🟢 **够,确认成立(逐段核过,无 unbounded 段)**

Bettor 要我"把 context-builder slice 上限逐项相加"。做了 `[READ context-builder.mjs]`:
| 段 | 位置 | 上限 | 估算 token |
|---|---|---|---|
| discovery/relations | `:761 limit=200` fetch,分桶 active/accepted/observed **各 slice(0,20)** `:786` | ≤60 条渲染(3 桶×20) | ~4k |
| connections active | `:786 slice(0,20)` | 20 | ~0.8k |
| events | `:741 slice(0,10)` | 10 | ~0.5k |
| goals | `:397 slice(0,5)` | 5 | ~0.3k |
| peer notes | `:643 slice(-5)`,每条 `n.text` | 5 | ~0.3k |
| recent outbound | `:722 slice(-10)` | 10 | ~0.5k |
| **conversation history** | `:672 history.map(...)` **渲染层无 slice** ⚠ | —— | 见下 |
| skill data | `:688` skills.forEach(instructions) | 技能数(少) | ~1-2k |

- 🔴 **唯一"渲染层无 cap"的段 = conversation history(`:672-678`)** —— 我盯了它,default 试图打穿"它是不是 unbounded"。**结论:上游封顶,不是 unbounded**:
  - DM 路 `conversationHistory` 来自 episode(`:1054` / `:1086 episodeHistory.slice(-10)`);
  - `mind.mjs:196` push 时 **每条 text `slice(0, 500)`**,`:198` **`channel.history.slice(-EPISODE_MAX_HISTORY)`** 整体封顶。
  - ⇒ 最坏 = EPISODE_MAX_HISTORY 条 × 500 字符 ≈ 几 k token,**有界**。
- **总最坏 ≈ 15-20k token**(discovery 是大头)。**256k = 262,144 token ≈ 10-13x 余量;128k ≈ 6x。** ⇒ **设计的 256k 默认保守且正确,证据 1-4(原生 262144 / output 千级 / input 结构封顶 / 瓶颈是 slot 非 ctx)全站得住。**
- 🔵 **note**:唯一该在改稿里点一句的 = "`:672` 渲染层无 slice,靠上游 `EPISODE_MAX_HISTORY`+500字符/条 封顶;若日后有人去掉上游 cap,这段会变 unbounded" —— 记一条防回归,不阻塞。A.5 那条"加一行 prompt token 日志收 P99"仍建议做(把结构上界换成实测分布,才能安心降 128k)。

## ③ 停 17428 六步有无"守卫复用旧进程 / 改了没生效"的路 — 🔴 **有,且漏了第五 ctx 站**

Bettor 问对了。两条:

### 3.1 🔴 漏站:`llm-watchdog.mjs:49` 是第五个 `--ctx-size 1048576` 硬编码 `[SRC HEAD]`
- 实测 repo 内 ctx 硬编码站:`kanet-start.sh:235` + `kanet-start-headless.sh:109` + **`scripts/llm-watchdog.mjs:49 '--ctx-size','1048576'`**。**A.4 改动表只列了前两个 + 说 C:/KANet 两份 = 262144;把 llm-watchdog 只当"内存闸落点④"、【没列为 ctx 改动站】。**
- 🔴 **后果直接打脸 A.5**:llm-watchdog 是一个**独立 spawner**,`spawnLlama()` 无 :8000 端口守卫(探针稿 §9 已记),health 探针 60s 一跳,**探到 :8000 down 就用它自己的硬编码 1M 拉一个新 llama**。⇒ **若 llm-watchdog 在跑,A.5 第④步 taskkill 17428 后,它下一跳就用 1M 重拉,新 ctx 完全不生效、且又是一个 30GB。** 现在 llm-watchdog **没在跑**(无 launch 站、进程表无它)—— 但设计【不能依赖"它碰巧没跑"】:任何人一启动它就 undo 整个修复,还复活 8/23 双开源。
- **改稿要求**:①A.4 补 `llm-watchdog.mjs:49` 为 ctx 单一源改动站(改读 `LLAMA_CTX_SIZE` env,与两 start 脚本同源);②A.5 第③步(内存闸预检)之外**加一步:确认 llm-watchdog 未运行**(`Get-CimInstance ... CommandLine -match 'llm-watchdog'`),在跑则先停它再动 17428,否则 taskkill→它重拉 1M;③把它的 :8000 端口守卫补上(探针稿 §9 已提,和内存闸同批)。

### 3.2 :8000 守卫的时序边角(次要)`[READ]`
- 两 start 脚本守卫"已在跑就复用"(start.sh:225 netstat / headless:101 curl /v1/models)。taskkill 17428 后 :8000 释放,守卫走 fallback spawn = 新 ctx —— **正常路径 OK**。
- 🔵 边角:taskkill 到端口真正释放(TIME_WAIT / 句柄回收)有短窗,若**紧接着**跑 start 脚本,netstat 可能仍见 :8000 → 守卫判"已在跑"→**跳过 spawn**(LLAMA_SKIPPED)→ 结果是**没有 llama**(不是旧 ctx),Mind 短暂无 LLM。非双发/非旧值,但会让 A.5 第⑤步"以为拉起了其实没拉"。**改稿建议**:A.5 第④步 taskkill 后加"确认 :8000 已释放(netstat 无 LISTEN)再走⑤",第⑥步验收本就查 kv_cache=4352,能抓到"根本没起来"。

## 交付判词
| 问 | 结论 |
|---|---|
| ① 30GB 归因 | 🔴 **半错**(mmap 模型≠私有 commit,log mmap=true+仅795MB CPU-mapped)+ ~26GB 无出处未实测。**A.5 低ctx重启实测私有commit = 改默认值硬前置**;VRAM收益(82.6%→42%)与内存闸收益照旧成立,但"降ctx缩小OOM足迹"这条claim须实测后才可写。A.2 删可证伪的 mmap-commit 句。 |
| ② 256k 够吗 | 🟢 **够**,逐段核过最坏 ~15-20k token(discovery 大头),256k ≈ 10-13x 余量;唯一渲染层无cap的 conversationHistory 靠上游 EPISODE_MAX_HISTORY+500字符/条 封顶=有界。证据1-4站得住。建议点一句防回归 + A.5 prompt日志收P99后再考虑128k。 |
| ③ 停机六步 | 🔴 **有路 + 漏站**:`llm-watchdog.mjs:49` 是第五个硬编码1M、独立spawner无:8000守卫,在跑则taskkill后它重拉1M直接废掉修复(现未跑但不能依赖)。A.4补它为ctx站+A.5加"确认llm-watchdog未跑"步+补它端口守卫。次要:taskkill后确认:8000释放再重拉。 |

**总 verdict**:§A **PASS-WITH-MUST-FIX**。三条必改:①A.2 归因改写 + A.5 实测升硬前置(gate OOM-足迹claim);②(轻)防回归注一句;③A.4 补 llm-watchdog ctx站 + A.5 加未跑确认 + 补其端口守卫。改完 §A 可进 Owner 方向决。内存闸(§0.5)是 8/23 真防线这个定位**正确、保留**——我①的结论反而【强化】它(因为降ctx对系统commit的作用未证,内存闸更是不可省)。

## 附:复核命令(只读)
- `grep -n ctx-size scripts/llm-watchdog.mjs`(:49 = 1048576,第五站)
- `grep mmap logs/llama-server.log`(mmap=true + CPU_Mapped 795MB)
- `ls -la <model.gguf>`(7.36GB)
- `sed -n '672,678p;196,198p' agent-mind/src/context-builder.mjs`(+`mind.mjs` history 上游cap)
- `sed -n '761p;786p;741p;397p;643p;722p' agent-mind/src/context-builder.mjs`(各段 slice 上限)
