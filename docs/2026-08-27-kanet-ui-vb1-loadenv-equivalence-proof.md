# VB-1 纯重构等价臂 — kanet_load_env 抽取证明（remediation §B step1 · 不碰活文件）

> **Status**: DRAFT v0.1 · KANet-UI 2026-08-27 · Bettor 派工 (G)·裁 (A) · **零落码到活文件**(lib 新增 + 证明; 活 kanet-start.sh/headless 不动) · **待 NWT 审 lib + 本证明**。
> **范围裁定 (A)**: VB-1 = 只抽【今日已证 behavior-identical】的子集; 每候选 prove-then-extract。抽漂移段=隐性统一=把修法混进"零变更"步(NWT 证不了)⇒ 漂移段各留原脚本, VB-2+ "抽+修"同 commit 配对照臂。
> **本轮结论**: 唯一通过等价证的候选 = **`kanet_load_env`**(净 env 态 + shell 变量逐字等价)。其余候选(archive_log/spawn_console/llama spawn 外壳/stop_old/KANET_TEST_MODE/sidecars/ensure_supervisor)**均漂移、不合格**, 留 VB-2+。

## §1 抽了什么
- 新增 `lib/kanet-start-common.sh`, 含 **`kanet_load_env`** 一个函数(加载 kanet.env 全量 export + 派生 CONSOLE_PORT)。
- **活文件不动**: kanet-start.sh / kanet-start-headless.sh **本 commit 零改**。lib 目前无 caller(dead until wired)——接线(两脚本 `source`+调用)是 NWT 确认等价后的**单独一步**, 在能当场复验 supervisor 自愈的窗口做(共享树=live 树, 自愈随时跑 headless)。

## §2 等价证明(kanet_load_env)
**判据**: lib 的 `kanet_load_env` 产出的净 env 态 + 关键 shell 变量, 与两脚本【当前 inline env-load】逐字相同。
**方法**: 隔离各脚本 env-load 段 + lib-call 版, 同一 `kanet.env` 下跑, `env | sort`(滤 ambient `_/SHLVL/PWD/OLDPWD/PATH`)后 diff。harness 在 `scratch/vb1/`(gitignored)。
**结果**:
- env_A(kanet-start.sh inline, 行 93-147) vs env_B(headless inline, 行 25-51): **IDENTICAL**(94 行, 均非空)。
- env_LIB(lib `kanet_load_env`) vs env_A: **IDENTICAL**; vs env_B: **IDENTICAL**。
⇒ 单一 canonical `kanet_load_env` 对**两脚本都**零净变更。
**为什么两版 case 不同却净等价**: 两脚本都 `export "$k=$v"` 全量透传每个 kanet.env key; kanet-start.sh 的 27-key case 里除 KANET_ROOT/CONSOLE_ENCRYPTION_KEY/OPENCLAW_TOKEN/PORT 外, 其余是**已被全量透传覆盖的冗余 `export`**(净无效); CONSOLE_PORT 两版都最终 = kanet.env PORT(kanet-start.sh 在 loop 内 PORT case 设, headless 在 loop 后 `${PORT:-...}` 派生, 值同)。case 差异是**重命名/冗余**、非行为。
**证据纪律**: env dump 含 CONSOLE_ENCRYPTION_KEY/token 等敏感值 ⇒ **本文档只记 diff 结果与行数, 不 paste env 内容**; scratch/vb1 的 env_*.txt 是 gitignored、不入库。

## §3 方法论坑(捕到并修, 记录防重犯)
🔴 **空==空假阳性**: 初版用 `env -i bash harness.sh` 比对——`env -i` 清了 PATH ⇒ `bash` 找不到(exit 127)⇒ 两 harness **根本没跑**、输出都空 ⇒ diff 报 IDENTICAL = **假等价**(绿灯无信息: 空==空)。**修**: ①改 `env -i PATH="$PATH" bash`(留 PATH, 清其余)②每次比对**先验两文件非空 `[ -s ]`** 再信 diff。本证明的 IDENTICAL 是修后、两文件均 94 行非空的真结果。同族记忆 `feedback-offline-test-must-use-real-schema-with-triggers` / 绿灯无信息族。

## §4 未抽候选 = 漂移实证表(留 VB-2+ "抽+修"同 commit)
| 候选 | 漂移# | 实证(file:line) | 处置 |
|---|---|---|---|
| load_env | — | 27-key vs 3-key case, 但**净 env 逐字等价**(§2) | ✅ **VB-1 抽** |
| archive_log | #21 | kanet-start.sh:297 `mv $CONSOLE_LOG .prev`+`>` / headless:151 只 `>` | 漂移·VB-2+ |
| spawn_console | #22 | 只 headless:158 `--max-old-space-size=4096`; kanet-start.sh:311 `${KANET_NODE_FLAGS:-}` | 漂移·VB-2+ |
| KANET_TEST_MODE | #4 | 只 kanet-start.sh:15 export | 漂移·VB-2+ |
| stop_old | #9a | kanet-start.sh:62 跳 console-supervisor.pid / headless 不跳 | 漂移·VB-2+ |
| llama spawn 外壳 | — | arg 行(--model..--flash-attn)逐字同, 但 cd/exe 前缀(`"./$(basename)"` vs `./llama-server.exe`)+ LLAMA_SERVER 默认路径 + memgate `$@` 外壳全漂移 | 外壳漂移·VB-2+ |
| sidecars | #15#24 | 只 kanet-start.sh 有 ws-proxy(:162-207)+bridge 栈(:307-386); headless 无 | 漂移·VB-2+ |
| ensure_supervisor | #9b#9c | 两版逻辑不同(无条件 start vs pidfile 检查 TOCTOU) | 漂移·VB-2+ |

## §5 `$@` 作用域雷(预注册·第一已知差异点·VB-2+ spawn_llama 抽取时触发)
- **雷**: memgate 的 `--memgate-force` 用 `for _a in "$@"` 读**脚本参数**。若 VB-2+ 把 spawn_llama 抽成 lib 函数, 函数内 `$@`=**函数参数**≠脚本参数 ⇒ `--memgate-force` **到不了闸**(静默失效, fail-open 方向——正是不能容忍的方向)。**修法**: 抽取时函数签名显式收 `kanet_spawn_llama "$@"`, 函数内 `$@` 即脚本参数。
- **对照臂(VB-2+ spawn_llama 抽取时必跑)**: 抽后用 `bash kanet-start.sh --memgate-force` 走一遍, 断言日志出现 `memgate:forced`(证参数穿透到闸); 再不带 `--memgate-force` 断言正常判据。
- **VB-1 不触发**: `kanet_load_env` 不引用 `$@`(它读 ENV_FILE)⇒ 本轮无 `$@` 风险; 此条为 VB-2+ 预注册。

## §6 回滚 + 接线(单独一步)
- **回滚 VB-1**: 删 `lib/kanet-start-common.sh`(无 caller, dead code)+ 本证明。零活文件影响。
- **接线(NWT GREEN 后单独 commit)**: 两脚本 env-load 处替换为 `source "$KANET_ROOT/lib/kanet-start-common.sh"; kanet_load_env`, 删各自 inline 段(kanet-start.sh 保留 `ok "已加载配置"` UI log 在 kanet_load_env 之后)。接线后**必 `bash -n` 双脚本 + 走读一遍 + 当场复验 supervisor 自愈**(共享树=live 树)。接线 commit 附:两脚本接线前后 `bash -x` 展开 env-load 段的 diff = 仅结构变(inline→call)、净 env 同。
