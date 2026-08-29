# console supervisor · lifetime 风暴保护 + PID-aware boot grace · 设计草案 v0.1.4

> **Status**: DRAFT v0.1.4 · NWT 设计层 GREEN（4 审点，2026-08-29）→ v0.1.3 最终 GREEN **被 NWT 对抗审撤回**（HUNG_BOOT 一击判死对长命 console 的瞬时阻塞 = 稳态比旧版更凶）→ **v0.1.4 MUST-FIX**：HUNG_BOOT 按 `last_boot_ok_ts > last_restart_ts` 分软/硬 + 心跳陈阈 10→20 s 常量化 + 候选唯一墙钟入口 `now_s()`（harness 桩它，边界向量确定性）；selftest 64/64 ×8（provenance 见 §5）；等 NWT 重跑 5× + 复核分支 · v0.1.2 = NWT 两条非阻塞注折入：① `console_state` 的 `rc` 取法（候选本就是 `local rc=0; … || rc=$?`，手写草案是旧形）；② **采** CreationDate 防 PID 复用（§3 行"PID 复用"改写；selftest 47/47） · J2 2026-08-29 · Bettor 派（今晨 05:14Z supervisor 重启风暴两条设计缺口 (a)(b)）· **不动生产代码；候选脚本 + 机器 diff + offline 验收 38/38 在 `docs/provenance/2026-08-29-supervisor-v01/`（不 apply）** · NWT 审 → 与 57fde30f 同批进维护窗（Owner 批：live 进程守护逻辑）。优先级：低于 READY 派单、高于 C3。
> v0.1.1（Bettor 裁后）：`BOOT_GRACE_SEC=300` 采；headless 杀调用者本轮不动（状态文件 write-ahead 已中和）；§4 手写 diff 换成**机器 diff**（`diff -u` 自候选脚本生成）；§5 五条验收**已跑**（下）。
> 对象：`scripts/kanet-console-supervisor.sh`（223 行，r424）+ `kasia-console/src/index.js`（`__booted` :20/:506，心跳 setInterval :519-521）+ 触点 `kanet-start-headless.sh:65-71,158,178-185`。坐标 J2 2026-08-29 亲核。

## §0 今晨实况（`logs/console-supervisor.log`，UTC，只读）
```
05:13:17 fail#1 → 05:13:49 #2 → 05:14:22 #3 "Console death detected — invoking kanet-start-headless.sh"
05:14:50 supervisor start pid=250711            ← 新 supervisor
05:15:55 fail#1 → 05:16:27 #2 → 05:16:59 #3 → restart
05:17:10 supervisor start pid=251197            ← 又一个新 supervisor
05:18:48 fail#1 → 05:19:20 #2 → 05:19:55 #3 → restart
05:20:05 supervisor start pid=251557
05:21:07 fail#1 …（Bettor 20 min 心跳守卫介入）
```
- 周期 ≈ **2.6 min/次**（65 s 首 fail + 2×32 s + headless ≈ 30 s）。定窗 guard 要 300 s 内 ≥5 次 ⇒ 永远到不了（Bettor (a) 判断成立）。
- 🔴 **更深一层（本稿新发现）**：`logs/console-supervisor-restarts.log` 末条 = **2026-08-23**，今晨三次重启**一条都没记**。原因：`restart_console()`（:128-140）先调 `bash kanet-start-headless.sh`（:131），而 headless `:65-71` **遍历 `logs/pids/*.pid` 逐个 kill——含 `console-supervisor.pid` 即调用者自己**；headless `:178-185` 再起一个新 supervisor。⇒ 旧 supervisor 死在 :131 里，`record_restart()`（:135）永远跑不到，`in_cool_down_until`/`consecutive_fail` 全在内存也随之归零。**⇒ 定窗计数器不是"对慢循环盲"，是结构性恒 0；cool-down 也永远进不去。** 任何新 guard 若仍靠内存状态 + 事后记账，同样死。
- boot 时长下界：05:14:22 headless 起 → 05:16:59 被判死时**仍未 alive** ⇒ 本机现役负载下 **boot ≥ 157 s**（且它是被杀的，不是自然完成）。心跳文件 :519 只在 `__booted=true`（:506）之后才开始写 ⇒ boot 期 = curl 失败 ∧ 心跳陈 = 3 次×30 s 后判死 ⇒ **supervisor 把正在 boot 的 console 杀掉重来** = 风暴的自激环（Bettor (b) 判断成立）。

## §1 目标行为（两条 guard 都必须在"supervisor 自己会被杀"的前提下成立）
| 状态 | 判据 | 动作 |
|---|---|---|
| **ALIVE** | curl 200/302 ∨ 心跳新鲜(≤10 s) | 归零 fail 计数；若从 BOOTING 转来 ⇒ 记 `boot_ok_ts`、算 `boot_ms` 入日志 |
| **BOOTING** | 心跳陈 ∧ boot-marker 存在 ∧ marker 里的 PID **活着** ∧ `now − marker.start ≤ BOOT_GRACE_SEC` | **等**，不计 fail，不重启 |
| **HUNG_BOOT** | 同上但 `now − marker.start > BOOT_GRACE_SEC` | 🔴 **v0.1.4（NWT 对抗审 MUST-FIX）分两支**：`last_boot_ok_ts > last_restart_ts`（重启后曾 ALIVE）⇒ 这只是长命 console 的一次**瞬时阻塞**（稳态实测 8–10.5 s 段每 20–30 s 一次）⇒ **软 fail，须 3 连**；`last_boot_ok_ts ≤ last_restart_ts`（自上次重启从未 ALIVE）⇒ 真 hung boot ⇒ 立即判死。v0.1.3 把两者都一击判死 = 稳态比旧版更凶（回归，撤回 GREEN） |
| **DEAD** | 心跳陈 ∧（无 marker ∨ marker.PID 不存在） | **立即**判死 ⇒ 走重启（受 guard；不再等 3 次） |
| 心跳"陈" | `HEARTBEAT_STALE_SEC` **= 20 s**（v0.1.4 Bettor 裁，原硬编码 10 s；env `KANET_SUPERVISOR_HEARTBEAT_STALE_SEC`） | 8–10.5 s 阻塞段与 10 s 同量级 ⇒ 10 s 阈会把一次阻塞当"陈"；soft-fail 为主、阈为辅；代价 = 真死检测最多慢 10 s |
| **UNKNOWN** | 心跳陈 ∧ marker 存在 ∧ PID 存在性**查不出**（tasklist 出错） | 退回旧逻辑：连续 3 次 fail 才判死（fail-safe 不 fail-open） |

**guard（重启前，顺序）**：① 若 `cool_down_until > now` ⇒ skip；② **lifetime 风暴**：`lifetime = now − last_boot_ok_ts`（上次判 ALIVE 的时刻；若上次重启后从未 ALIVE，`lifetime = now − last_restart_ts`），`lifetime < SHORT_LIFETIME_SEC(300)` ⇒ `short_streak += 1` 否则归 0；`short_streak ≥ 3` ⇒ `cool_down_until = now + 1800`，不重启；③ 保留旧定窗（≥5/300 s）作第二道（改成从状态文件读，不再恒 0）。
**全部状态持久化到 `logs/console-supervisor-state.env`**（`last_restart_ts / last_boot_ok_ts / short_streak / cool_down_until`，`KEY=VALUE` 行，bash `source` 即读），**写在调 headless 之前**（write-ahead），新 supervisor 启动时先 `source` 它。⇒ 即使 headless 杀掉调用者，账已记、streak 已增、cool-down 已生效。

## §2 boot-marker（console 侧，唯一的 index.js 改动，两处、各 ≤5 行）
- 文件顶部（`let __booted = false;` :20 之后）**立即**写 `logs/console-boot.txt` = `<pid> <start_ms>`（best-effort try/catch；与心跳同目录同风格）。这是 supervisor 区分"在 boot"与"死了"的唯一可靠信号：**boot 失败 ⇒ `process.exit(1)`（:26/:33/:504）⇒ PID 没了 ⇒ DEAD**；boot 中 ⇒ PID 活 + 心跳陈 ⇒ BOOTING。
- 心跳 setInterval（:519）加显式 `if (!__booted) return;`——**今天结构上已经在 :506 之后**（不是 bug），加它是防未来有人把这块上移到 boot 前造成假活；零行为变化。Bettor 说的"`index.js:514` gate on `__booted`"= 此。
- 🔴 不改 `kanet-start-headless.sh` 本稿内不动（它杀 supervisor 的行为由 §1 的状态文件**绕过**而非修复；要不要让 headless 跳过 `console-supervisor.pid` 是另一件，标 §5）。

## §3 数值与判据来源
| 参数 | 值 | 依据 |
|---|---|---|
| `BOOT_GRACE_SEC` | **默认 300**（Bettor 提 180 → **裁 300**，2026-08-29） | §0：现役负载下 boot ≥157 s 且未完成；180 s 只比已观测下界多 23 s，一次慢盘/迁移就再触发自激。boot-marker 落地后 `boot_ms` 有真数据再收紧 |
| `SHORT_LIFETIME_SEC` | 300 | Bettor 裁定"lifetime < 5 min" |
| `SHORT_STREAK_MAX` | 3 | Bettor 裁定"连续 3 个" |
| `COOL_DOWN_SEC` | 1800（不变） | 原值 |
| PID 存在性 | `tasklist //FI "PID eq <pid>" //NH` 输出含 `node.exe` | **非提权也能读**（只是进程存在性，不读 CommandLine）——避开今天 `Win32_Process.CommandLine` 对 SYSTEM 进程为 null 的假空坑（runbook v0.5.1 §检查③）。Git-Bash 下 `kill -0` 对 SYSTEM 进程不可靠，不用 |
| PID 复用 | **v0.1.2 防住**：`pid_alive <pid> <marker_ms>` 在 tasklist 存在之外再读 CIM `Win32_Process.CreationDate`（epoch ms），`creation_ms > marker_ms + 2000` ⇒ 判"不在"（PID 已被复用）；读不到 ⇒ 放行 | 复用的 PID 创建时刻必晚于旧进程死亡 ≥ marker 写入时刻 ⇒ 复用形 = creation > marker。**只核"创建不晚于 marker"不核相等**：marker 由 `index.js` 顶部写，但 ESM 静态 `import` 先于顶部代码执行 ⇒ marker 可能晚于创建数秒（方向固定：marker ≥ creation）；2 s skew 只防时钟抖动。CreationDate 对 SYSTEM 进程非提权可读（NWT 实测 + selftest 阳性对照 pid=2816 读到 `1787980804498`），≠ CommandLine（那个为 null）。误判方向仍 fail-safe：读不到放行 = 最坏多等 ≤ grace−age |

## §4 diff（**不 apply**）
🔴 **v0.1.1 起以机器 diff 为准**：`docs/provenance/2026-08-29-supervisor-v01/supervisor.v01.diff`（**v0.1.4 = 268 行**，`diff -u scripts/kanet-console-supervisor.sh <候选>`；provenance **`dab53cbc`**；历史 v0.1.2 `1fe10b22` 220 行 / v0.1.3 `3b10b479`）与 `index.v01.diff`（27 行）；候选全文 `kanet-console-supervisor.v01.sh`；sha256 在 `MANIFEST.sha256`。下方 4.1/4.2 是 v0.1 的手写草案，**保留作阅读导引，以机器 diff 为准**（两者差异见下"候选相对手写草案的四处收紧"）。
候选相对手写草案的四处收紧（写候选时发现的）：
1. 主循环体拆成 `supervisor_tick()`（一次判活+决策），`run_supervisor` 只剩 `load_state` + `while … supervisor_tick; sleep`——为了能 offline 单测；`consecutive_fail`/`was_booting` 由调用方作用域持有。
2. `load_state` **不 `source` 状态文件**（`source` = 执行任意行），改逐行 `KEY=VALUE` 解析、只认四个 key 且值须 `^[0-9]+$`（验收有脏行向量 `evil=1; rm -rf /` / `short_streak=abc` / 带空格值 全拒）。
3. 加 `_lib` 子命令（只定义函数不跑主流程），供 `source <脚本> _lib` 测试；不影响 `start|stop|status|_run`。
4. `restart_console` 一律 `return 0`：成败改由主循环状态机判（BOOTING 等 / ALIVE 记 `boot_ms` / HUNG_BOOT 再判死）——原 `sleep 5; console_alive` 那句在 boot ≥157 s 的现实下恒假，且 headless 若杀掉本进程它根本跑不到。
bash 注意：`set -e` 下 `((x++))` 在 x=0 时返回 1 会退出，一律 `x=$((x+1))`（候选全文如此）。

### 4.1 `scripts/kanet-console-supervisor.sh`
```diff
@@ -30,4 +30,8 @@
 RESTART_WINDOW_SEC=${KANET_SUPERVISOR_RESTART_WINDOW_SEC:-300}   # 5 min
 RESTART_MAX_IN_WINDOW=${KANET_SUPERVISOR_RESTART_MAX:-5}
 COOL_DOWN_SEC=${KANET_SUPERVISOR_COOL_DOWN_SEC:-1800}            # 30 min after burst
+BOOT_GRACE_SEC=${KANET_SUPERVISOR_BOOT_GRACE_SEC:-300}           # (b) PID 活+无心跳 ⇒ 等这么久才算 hung boot(2026-08-29 实测 boot>=157s)
+SHORT_LIFETIME_SEC=${KANET_SUPERVISOR_SHORT_LIFETIME_SEC:-300}   # (a) lifetime < 5min = 短命
+SHORT_STREAK_MAX=${KANET_SUPERVISOR_SHORT_STREAK_MAX:-3}          # (a) 连续 3 个短命 ⇒ cool-down
+STATE_FILE="$KANET_ROOT/logs/console-supervisor-state.env"       # 持久化: headless 会杀掉本 supervisor(:65-71), 内存状态活不过一次重启
+BOOT_MARKER="$KANET_ROOT/logs/console-boot.txt"                  # console 启动即写 "<pid> <start_ms>"(index.js 顶部)
@@ -72,6 +76,55 @@
+# ── 持久化状态(write-ahead: 先写盘再调 headless) ──
+last_restart_ts=0; last_boot_ok_ts=0; short_streak=0; cool_down_until=0
+load_state() { [[ -f "$STATE_FILE" ]] && source "$STATE_FILE" || true; }
+save_state() {
+  mkdir -p "$(dirname "$STATE_FILE")"
+  printf 'last_restart_ts=%s\nlast_boot_ok_ts=%s\nshort_streak=%s\ncool_down_until=%s\n' \
+    "$last_restart_ts" "$last_boot_ok_ts" "$short_streak" "$cool_down_until" > "$STATE_FILE.tmp" && mv -f "$STATE_FILE.tmp" "$STATE_FILE"
+}
+
+# ── boot-marker / PID 存在性 ──
+marker_pid=""; marker_start_s=0
+read_marker() {
+  marker_pid=""; marker_start_s=0
+  [[ -f "$BOOT_MARKER" ]] || return 1
+  read -r marker_pid marker_ms < "$BOOT_MARKER" || return 1
+  [[ "$marker_pid" =~ ^[0-9]+$ && "$marker_ms" =~ ^[0-9]+$ ]] || return 1
+  marker_start_s=$(( marker_ms / 1000 ))
+}
+# 0 = 活, 1 = 不在, 2 = 查不出(tasklist 失败 ⇒ 调用方退回旧 3-fail 逻辑, fail-safe)
+pid_alive() {
+  local out
+  out="$(tasklist //FI "PID eq $1" //NH 2>/dev/null)" || return 2
+  grep -q "node.exe" <<< "$out" && return 0
+  return 1
+}
+# 打印 ALIVE|BOOTING|HUNG_BOOT|DEAD|UNKNOWN
+console_state() {
+  if console_alive; then echo ALIVE; return; fi
+  read_marker || { echo DEAD; return; }
+  pid_alive "$marker_pid"; local rc=$?
+  if (( rc == 1 )); then echo DEAD; return; fi
+  if (( rc == 2 )); then echo UNKNOWN; return; fi
+  local age=$(( $(date +%s) - marker_start_s ))
+  if (( age <= BOOT_GRACE_SEC )); then echo BOOTING; else echo HUNG_BOOT; fi
+}
+
+# ── (a) lifetime 风暴 guard: 返回 0 = 准重启, 1 = 拒(已进 cool-down) ──
+lifetime_guard() {
+  local now=$1 lifetime
+  if (( last_boot_ok_ts > last_restart_ts )); then lifetime=$(( now - last_boot_ok_ts )); else lifetime=$(( now - last_restart_ts )); fi
+  if (( last_restart_ts > 0 && lifetime < SHORT_LIFETIME_SEC )); then short_streak=$(( short_streak + 1 )); else short_streak=0; fi
+  log "lifetime=${lifetime}s short_streak=${short_streak}/${SHORT_STREAK_MAX}"
+  if (( short_streak >= SHORT_STREAK_MAX )); then
+    cool_down_until=$(( now + COOL_DOWN_SEC )); save_state
+    log "LIFETIME STORM: ${short_streak} consecutive lifetimes < ${SHORT_LIFETIME_SEC}s — enter ${COOL_DOWN_SEC}s cool-down"
+    return 1
+  fi
+  return 0
+}
+
@@ -128,4 +181,7 @@ restart_console() {
   log "Console death detected — invoking kanet-start-headless.sh"
+  # write-ahead: headless 会 kill 本进程(:65-71), 之后的 record_restart 可能永远跑不到(2026-08-29 三次重启零记录的根因)
+  last_restart_ts=$(date +%s); save_state; record_restart
   announce_restart
   bash "$KANET_ROOT/kanet-start-headless.sh" >> "$LOG" 2>&1 || log "kanet-start-headless fail"
-  sleep 5
-  if console_alive; then
-    log "Console restarted OK"
-    record_restart
-    return 0
-  fi
-  log "Console restart fail (still not alive after 5s)"
-  return 1
+  # 若本进程还活着(headless 没杀到), 不再用 5s 判成败——那是 boot grace 的活
+  return 0
 }
@@ -142,6 +195,8 @@ run_supervisor() {
   echo $$ > "$PID_FILE"
-  log "supervisor start pid=$$ … cool_down=${COOL_DOWN_SEC}s"
+  load_state
+  log "supervisor start pid=$$ … cool_down=${COOL_DOWN_SEC}s boot_grace=${BOOT_GRACE_SEC}s short_lifetime=${SHORT_LIFETIME_SEC}s streak_max=${SHORT_STREAK_MAX} state:last_restart=${last_restart_ts} streak=${short_streak} cool_down_until=${cool_down_until}"
   local consecutive_fail=0
-  local in_cool_down_until=0
+  local was_booting=0
   while true; do
-    if console_alive; then
-      consecutive_fail=0
-    else
-      consecutive_fail=$(( consecutive_fail + 1 ))
-      log "health fail #${consecutive_fail}/${HEALTH_FAIL_THRESHOLD}"
-      if (( consecutive_fail >= HEALTH_FAIL_THRESHOLD )); then
+    local st; st="$(console_state)"
+    local now; now=$(date +%s)
+    case "$st" in
+      ALIVE)
+        consecutive_fail=0
+        if (( was_booting == 1 )) || (( last_boot_ok_ts < last_restart_ts )); then
+          last_boot_ok_ts=$now; save_state; was_booting=0
+          read_marker && log "boot OK: boot_ms=$(( (now - marker_start_s) * 1000 )) pid=${marker_pid}"
+        fi ;;
+      BOOTING)
+        was_booting=1; consecutive_fail=0
+        read_marker; log "booting: pid=${marker_pid} age=$(( now - marker_start_s ))s/${BOOT_GRACE_SEC}s — wait" ;;
+      UNKNOWN)
+        consecutive_fail=$(( consecutive_fail + 1 ))
+        log "health fail #${consecutive_fail}/${HEALTH_FAIL_THRESHOLD} (pid check unavailable)" ;;
+      DEAD|HUNG_BOOT)
+        consecutive_fail=$HEALTH_FAIL_THRESHOLD
+        log "console ${st} — immediate death verdict" ;;
+    esac
+    if (( consecutive_fail >= HEALTH_FAIL_THRESHOLD )); then
-        local now=$(date +%s)
-        if (( now < in_cool_down_until )); then
-          local remain=$(( in_cool_down_until - now ))
+        if (( now < cool_down_until )); then
+          local remain=$(( cool_down_until - now ))
           log "in cool-down period (${remain}s remain), skip restart"
         else
           local recent=$(count_recent_restarts)
           if (( recent >= RESTART_MAX_IN_WINDOW )); then
-            in_cool_down_until=$(( now + COOL_DOWN_SEC ))
+            cool_down_until=$(( now + COOL_DOWN_SEC )); save_state
             log "RESTART STORM: ${recent} restarts in last ${RESTART_WINDOW_SEC}s — enter ${COOL_DOWN_SEC}s cool-down"
+          elif ! lifetime_guard "$now"; then
+            :   # 已进 cool-down, 日志在 guard 里
           else
             restart_console || true
           fi
           consecutive_fail=0
         fi
-      fi
     fi
     sleep "$CHECK_INTERVAL_SEC"
   done
 }
```
（`status` 子命令加一行 `cat "$STATE_FILE"`，略。）

### 4.2 `kasia-console/src/index.js`
```diff
@@ -20,1 +20,6 @@
 let __booted = false;
+// boot-marker(supervisor (b) PID-aware boot grace, 2026-08-29): 进程一起就写 "<pid> <start_ms>", 让 supervisor
+// 能把"PID 活+无心跳"(在 boot)与"PID 没了"(启动失败 exit(1) / 真崩)分开。best-effort, 不影响启动。
+try {
+  const { writeFileSync: __wfs, mkdirSync: __mk } = await import('node:fs'); const { join: __pj, dirname: __pd } = await import('node:path'); const { fileURLToPath: __fu } = await import('node:url');
+  const __d = __pj(__pd(__fu(import.meta.url)), '..', '..', 'logs'); __mk(__d, { recursive: true }); __wfs(__pj(__d, 'console-boot.txt'), `${process.pid} ${Date.now()}`);
+} catch { /* best-effort */ }
@@ -519,3 +524,4 @@
 setInterval(() => {
+  if (!__booted) return;   // 结构上本就在 :506 之后; 显式 gate 防未来上移造成 boot 期假活
   try { writeFileSync(HEARTBEAT_FILE, String(Date.now())); } catch { /* best-effort, 不影响主流程 */ }
 }, 2000);
```
（4.2 第一段若嫌 `await import` 顶层丑，可复用 :515-517 已 import 的三件搬到文件顶——但那三行在 :515 是"后半段 import"，搬动影响面更大；草案取最小侵入。NWT 定。）

## §5 验收（维护窗落地前，全 offline）
✅ **已跑（2026-08-29，`docs/provenance/2026-08-29-supervisor-v01/selftest.sh` → `selftest.out`：v0.1.1 38/38 → **v0.1.2 47 PASS / 0 FAIL**，+9 = CreationDate 可读 / creation ≤ now / 真进程+marker=now ⇒ 活 / marker 早于创建 60 s（复用形）⇒ 不在 / 早 1 s（<skew）⇒ 放行 / 读不到 ⇒ 放行 / 五态经 marker 走复用 ⇒ DEAD / 真进程 ⇒ BOOTING / 复用日志行）**。跑法：`bash docs/provenance/2026-08-29-supervisor-v01/selftest.sh`——隔离根 `<dir>/t/`（`BASH_ARGV0` 把候选脚本顶部的 `cd "$(dirname "$0")/.."` 落进 `t`，`KANET_ROOT=t`，不碰 live `logs/`、不碰任何进程；桩 `console_alive`/`pid_alive`/假 headless），`index.v01.js` 由 `patch` 从仓内现役 `index.js` + `index.v01.diff` 重建（index.js 漂了 patch 会红 = 要重生成 diff 的信号）。覆盖：语法 2 / 五态 8（含 age==grace 边界、垃圾 marker）/ tick 决策 9（BOOTING×4 不重启、BOOTING→ALIVE 记 `boot_ms`、DEAD 与 HUNG_BOOT 各 1 tick 即重启、UNKNOWN 退回 3-fail）/ lifetime 9（首次不计、100/100/100 第三次拒且 cool_down 持久化、400 归零、由 `last_boot_ok_ts` 算、cool-down 内 DEAD skip）/ **write-ahead 3（假 headless `kill -9 $PPID` 杀掉调用者后 state.env 与 restarts.log 已各有 1 条；新进程 `load_state` 继承）**/ 脏状态文件 4 / **真 `tasklist` 阳性对照**（本机现役 node.exe pid ⇒ 0）+ 阴性（pid 4000000 ⇒ 1）+ 失败 ⇒ 2。
两处 harness 自身的坑（记下，防下个人再踩）：source 时 `$0` 是 harness 路径不是 `bash`；`unset -f` 会把被桩的真函数一起删，要先 `declare -f` 存起来。
🔴 **v0.1.4（NWT 对抗审 MUST-FIX + 第二个 wall-clock flake）**：+16 向量 = 64/64（×8 连跑，留档 run1..5）：`HUNG_BOOT` never-alive（`last_boot_ok_ts=0`）⇒ 1 tick 立即 + 日志行；**was-ALIVE + 瞬时阻塞 ⇒ soft #1/#2 不重启 → ALIVE 归零 → 再 3 连才重启** + `#3/3` 日志行；反向量 `boot_ok < restart` ⇒ 立即；心跳阈 20 s：15 s fresh / 21 s stale / 20 s 含边界 fresh / 注入阈 10 时 15 s stale（= 旧阈误判形）/ 无文件 stale。**第二个 flake（run4/5 逮到，8/8 前）**："age 300 s == grace 边界"向量用真 `date` 写 marker、`console_state` 再读一次真 `date`，跨秒 ⇒ 301 ⇒ HUNG_BOOT。根治 = 候选脚本加**唯一墙钟入口 `now_s()`**（生产 `date +%s`；日志时间戳不经它），六处取时改经它；harness 桩 `now_s` 为固定值，marker/心跳 mtime 全相对桩时间 ⇒ 边界向量确定性。这是候选脚本的**可测性改动**，生产语义不变。
🔴 **v0.1.3（NWT 分诊 · flaky 只在 TEST 不在生产）**：Bettor 亲跑一次 46/47 后复跑 47/47。生产判定 `cms > marker_ms + 2000` 两值皆固定属性（marker 文件 / 进程 CreationDate），**无 wall-clock 量**；v0.1.2 的 harness 却把 marker 构造成相对 `now` 且每条向量调真 powershell（~1–2 s）⇒ setup 耗时越过 2 s 边界即翻。改法：① CreationDate 组**纯 mock 注入**（`tasklist`/`proc_creation_ms` 都打桩）七向量：`cms−marker = +2001 ⇒ gone / +1999 ⇒ 不 flag / +2000（== skew，不 >）⇒ 不 flag / −5000（真 console 形）⇒ 不 flag / 无 marker_ms ⇒ 只查存在 / 读不到 ⇒ 放行 / 非数字 ⇒ 放行`；② 真 powershell 只留 **1 条 smoke**（对 harness **自起**的受控 node 子进程读 CreationDate 返正整数），**不进闸**，汇总行单列 `smoke(not gating)`；③ 不再 `Get-Process node | First 1` 挑别人的进程（可能是瞬时进程，在挑到与 tasklist 之间退出——这是另一个 flake 源）；④ 生产候选/diff **不动**。**J2 连跑 5/5 = 48 PASS / 0 FAIL**（`selftest-run1..5.out` 全留档 provenance），子进程无泄漏。验收 harness 自己 flaky 就不能当闸——同族 `feedback-commit-chain-must-gate-on-green`。
1. **bash 语法**：`bash -n scripts/kanet-console-supervisor.sh`；`node --check kasia-console/src/index.js`。
2. **状态机单测**（scratch，假 `console_alive`/`pid_alive`/marker 文件，`source` 函数体）：ALIVE / BOOTING(age 10 s) / HUNG_BOOT(age 301 s) / DEAD(marker PID 不存在) / UNKNOWN(tasklist 失败 ⇒ 3 次才判) 五态各一向量；`lifetime_guard` 三向量：lifetimes 100/100/100 ⇒ 第三次 cool_down；100/400/100 ⇒ streak 归零不 cool；`last_restart_ts=0` 首次 ⇒ 不计短命。
3. **write-ahead 实证**：模拟 headless 在 `restart_console` 内 `kill $$`，重启 supervisor 后 `state.env` 里 `last_restart_ts` 已在、`restarts.log` 已多一行——**这条是今晨缺口的直接回归**。
4. **`set -e` 陷阱回归**：`short_streak=0` 时走一遍 `lifetime_guard` 不退出。
5. 落地后首个真实 boot：日志出现 `booting: … — wait` 若干行后 `boot OK: boot_ms=…`（用它校 `BOOT_GRACE_SEC`）。

## §6 不在本稿 / 留给 Bettor 裁
- `kanet-start-headless.sh:65-71` 杀调用者 supervisor 的行为（是否跳过 `console-supervisor.pid`）——本稿用状态文件绕过，不修它；修它是整套启动脚本的事（漂移表 #24 域）。
- 今晨 05:13 console **第一次**为什么死——本稿只堵自激环，不猜首因。
- 运行身份：supervisor 若不与 console 同用户，`tasklist` 仍能看存在性（已核：不需 CommandLine）；但 `logs/` 写权限须同一目录可写（今天已是）。
- `restarts.log` 08-23 有 6 条在 13 s 内——另一条历史异常，未查。
