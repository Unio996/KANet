# VB-1 接线步计划 — kanet_load_env 接活文件（只读预备·(I)·活文件本轮零改）

> **Status**: DRAFT v0.1 · KANet-UI 2026-08-27 · Bettor 派工 (I)·为 VB-1 接线步预备 · **本轮零改活文件**(patch 草案在 scratch/vb1/wiring/·不 apply); **真接线另择 Bettor 盯 console 监控的窗口**。
> **前置**: VB-1 lib(4ff09747, kanet_load_env)已 NWT GREEN + 推 origin。接线 = 两活脚本 env-load 段替换为 `source lib; kanet_load_env`。
> **本文交付**: ①接线 patch 草案(scratch, 不 apply) ②DRY 六格前后对跑证明(已跑, 全 IDENTICAL) ③自愈复验方案。

## §1 接线 patch 草案（scratch/vb1/wiring/·不 apply 到活文件）
两脚本各**只动 env-load 段**(patch 各 **1 个 hunk**, 证不碰其它)。wired 副本 `bash -n` 均过。
- **kanet-start.sh**(`kanet-start.sh.patch`, hunk `@@ -90,61 +90,9`): 删行 93-147 的 inline `if [ -f ENV_FILE ]; then <27-key case loop>; ok; fi`(55 行), 换 **3 行**:
  ```
  source "$KANET_ROOT/lib/kanet-start-common.sh"
  kanet_load_env
  [ -f "$ENV_FILE" ] && ok "已加载配置: $ENV_FILE"
  ```
  (第 3 行**保留原 UI log 且保留 ENV_FILE-存在 守卫** = 与 inline 的 `ok` 在 if 内同条件)。净 465→413 行(-52 = 删 55 换 3)。
- **kanet-start-headless.sh**(`kanet-start-headless.sh.patch`, hunk `@@ -22,33 +22,8`): 删行 25-51 的 inline `if...fi`(3-key case)+ `CONSOLE_PORT="${PORT:-$CONSOLE_PORT}"` 派生(27 行), 换 **2 行**:
  ```
  source "$KANET_ROOT/lib/kanet-start-common.sh"
  kanet_load_env
  ```
  (kanet_load_env 内含 CONSOLE_PORT 派生, 故不需单列)。
- 🔴 **只动 env-load**: 两 patch 各 1 hunk ⇒ stop-old/spawn/sidecar/supervisor 等段**逐字不动**(那些是 VB-2+)。

## §2 DRY 六格前后对跑证明（已跑·零副作用·全 IDENTICAL）
**难点**: 真跑 kanet-start.sh/headless 会执行 stop-old(杀 console/relay)+spawn=灾难; `bash -x` 也真执行; 且 kanet-start.sh 的 stop-old 在 env-load **之前**(真跑截断也先杀 console)。
**方法(零写零杀零 spawn)**: **隔离 harness**——只取各脚本 preamble + env-load 段(before=inline / after=`source lib;kanet_load_env`), 尾接 `env|sort` + `echo "$*"` + memgate force-detect(`for _a in "$@"`) + `exit`。**唯一副作用 = 读 kanet.env + 只读 FreeVirtualMemory**(本轮 harness 连 FreeVirtualMemory 都没读, 只到 env-load+arg 层)。harness/输出在 `scratch/vb1/wiring/`(gitignored)。
**六格 = {无 args / --memgate-force / --supervised} × {start / headless}**, 每格 before(inline)-vs-after(lib) diff:
| 格 | inline==lib | 非空守卫 | ARGS 穿透 | FORCE_DETECTED |
|---|---|---|---|---|
| start / none | ✅ IDENTICAL | 非空 | [] | false |
| start / --memgate-force | ✅ IDENTICAL | 非空 | [--memgate-force] | **true** |
| start / --supervised | ✅ IDENTICAL | 非空 | [--supervised] | false(no-op, VB-2+ 才解析) |
| headless / none | ✅ IDENTICAL | 非空 | [] | false |
| headless / --memgate-force | ✅ IDENTICAL | 非空 | [--memgate-force] | **true** |
| headless / --supervised | ✅ IDENTICAL | 非空 | [--supervised] | false |
**证到的三点**:
1. **净 env 态 + shell 变量**: 接线前后逐字相同(env|sort diff 空)。
2. 🔴 **`$@` 穿透**: `source lib` 只**定义函数**不 shift args; `kanet_load_env` 无参调用返回后脚本 `$@` 原样 ⇒ `--memgate-force` 仍到下游闸(FORCE_DETECTED=true 证明)。**这是"接线会不会把 --memgate-force 弄丢"的正面证据**。
3. **--supervised** 当前 no-op(FORCE_DETECTED=false, ARGS 显示已穿透但 memgate 不识别)= 符合现状(VB-2+ ensure_supervisor 才解析), 接线不引入回归。

## §3 方法论坑（承 VB-1·防空==空假阳）
- 比对一律 `env -i PATH="$PATH" bash`(留 PATH 否则 bash 找不到 → exit 127 → 输出空 → 空==空假 IDENTICAL)。
- 每格信 diff 前**先验两输出 `[ -s ]` 非空**(见 §2"非空守卫"列)。

## §4 自愈复验方案（真接线那步用·本轮只出方案不执行）
🔴 **共享树=live 树**: 接线一改活文件, supervisor 下次自愈就跑 headless 新码。方案:
1. **接线前**: 用本文 §1 patch 草案在活文件 apply(那步在 Bettor 盯监控窗口做); apply 后立即 `bash -n kanet-start.sh kanet-start-headless.sh`(语法先关)。
2. **走读**: 确认 console-spawn 段(headless `node --max-old-space-size=4096 index.js`, 在 env-load 块**之后**、结构上不受 load_env 接线影响)+ stop-old 段逐字未动(§1 单 hunk 已证)。
3. **不主动杀 console**: 复验走**下一次自然自愈**(console 到复发窗口自己死 → supervisor 拉 headless 新码)**或** Bettor 批的**受控一次**(手动触发一次自愈, Bettor 在场盯)。
4. **60s 内证不炸**(五项): ①headless launcher log 出现干净 env-load(无 `unbound variable`/`command not found`)②console :3200 curl 快响应 ③supervisor log 干净 invoke 无 crash-loop ④`grep LLAMA_CTX_SIZE`/relay 数正常 ⑤新 console PID 稳定 >60s。
5. **回滚**: 任一项异常 → `git revert` 接线 commit(恢复 inline env-load)+ 立即复验自愈; lib 本身(dead)不动。
- **接线 commit 附**: 两脚本接线前后 env-load 段的 §2 六格 diff-空证明(可复跑) + `bash -n` 双脚本 + walkthrough 结论。

## §5 边界
- 本轮**零改活文件**: 只出 patch 草案(scratch, 不 apply)+ DRY 证明 + 本方案。
- 接线是**单独 commit + 单独窗口**(Bettor 盯监控); VB-2+ 各漂移函数"抽+修"另计。
