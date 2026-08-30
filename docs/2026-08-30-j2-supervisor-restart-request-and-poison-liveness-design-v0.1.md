# J2 · supervisor「请求重启」入口（GAP-2）+「毒化判活」（GAP-1）设计 v0.1

> **Status**: DRAFT v0.1 · 给 NWT 审 · docs only，**不落码** · Bettor 派工 2026-08-30 · 背景 = `docs/iteration/COORD-LEDGER.md` (732)(733) + J1 `docs/iteration/j1-inbox/2026-08-30T05-56Z-j1-input-to-732-gap2-poison-liveness-three-impl-traps.md`
> **改的是生产脚本 `scripts/kanet-console-supervisor.sh`（SYSTEM 计划任务运行）⇒ 报备 → NWT 审 → Owner 批；本稿只定形，落码另起侧分支。**

## 0. 一句话

console 由 supervisor 以 **SYSTEM** 拉起（`scripts/register-console-supervisor-task.ps1:23,70`：`-UserId 'SYSTEM' -RunLevel Highest`，设计上"非提权杀不掉"），而全队自动化会话均非提权 ⇒ (732) 首次有序重启卡了 5.3 h（`taskkill` Access denied ×4 路，唯一路径 = Owner 手动）。同时 supervisor 的 `console_alive()`（`kanet-console-supervisor.sh:74-79` = `curl :3200/` 200 ∨ 心跳文件 ≤10 s）对 **wasm 撞顶毒化**盲——04:27:40Z 撞 4 GiB 后进程活、HTTP 200、心跳 0–1 s、链读全坏，supervisor 3.2 h 不判死。两个缺口用**同一个文件**补：

- **GAP-2**：supervisor 每 tick 轮询 `logs/console-restart-request`；存在 ⇒ 记日志 → 走既有 `restart_console()`（死→headless 同一条路，:128-140）→ 请求文件改名 `.done-<utc>`。非提权会话只写文件。
- **GAP-1**：`console_alive()` 加"毒化 = 死"两条签名（日志串 / wasmBytes 冻结），任一命中 ⇒ 返回 1，走既有 fail 计数与风暴保护。

## 1. 现状（实核，行号以 `27f30ea5` 主线为准）

| 件 | 现状 |
|---|---|
| 判活 | `console_alive()` :74-79：`curl -sf --max-time 5 http://127.0.0.1:${CONSOLE_PORT}/` 成功即活；失败再看 `heartbeat_fresh()` :67-72（`logs/console-heartbeat.txt` mtime ≤10 s）。 |
| 判死→重启 | `run_supervisor()` :142-171：每 `CHECK_INTERVAL_SEC`(30 s) 一 tick；连续 `HEALTH_FAIL_THRESHOLD`(3) 次不活 ⇒ 风暴保护（`RESTART_WINDOW_SEC` 300 s 内 ≥ `RESTART_MAX_IN_WINDOW` 次 ⇒ `COOL_DOWN_SEC` 1800 s）⇒ `restart_console()` :128 = `bash kanet-start-headless.sh`（:131）。 |
| headless 杀旧 | `kanet-start-headless.sh:65-79`：按 `logs/pids/*.pid` `kill`，再 `Stop-Process -Force`；同为 SYSTEM ⇒ **有权杀**。这正是"请求重启"可借的提权路径。 |
| console.log | headless 每次启动重写（`kanet-start-headless.sh:150` `CONSOLE_LOG=`；memory：9.4 MB→58 KB 实证）；首行恒为 `[db] path=…`（本实例 boot 标记）。 |
| 毒化签名（8/05 + 8/30 两次实录） | `[kanet:uncaught] RuntimeError: unreachable`（`kasia-console/src/index.js:23` 打点；8/30 04:2x–04:3x ×3）；`[diag:heap-sample] … wasmBytes=4096.0MB` 冻结（grow 失败后不再变）；其后 `memory access out of bounds` / `Offset is outside the bounds of the DataView` 成片。 |
| 谁能写 `logs/` | 目录 `ADMIN` 所有、`drwxr-xr-x`；本机四个自动化会话均以 ADMIN 跑 ⇒ 都能写；SYSTEM 也能写（supervisor 自己在写 `console-supervisor.log`）。 |

## 2. GAP-2 · 请求重启入口

### 2.1 协议
- 🔴 **文件 = step-3-only**（NWT ②）：有序重启三段 = ① 花钱面 CLEAN（两次）② 停守卫/quiesce ingress（`feedback-preshutdown-money-surface…`）③ kill。**请求文件只承载 ③**，语义是"①② 已由请求方核过，现在执行 kill"；supervisor 不核 ①②、也**不能被用来跳过 ①②**——写文件的人对 ①② 负责，文件里 `reason` 须写明 ①② 完成的证据指针（如 `moneysurface=CLEAN#2@02:24:07Z guard=stopped`）。
- 文件：`$KANET_ROOT/logs/console-restart-request`（无扩展名；固定单文件，不排队）。
- 内容一行：`<requester>|<nonce>|<utc ISO8601>|<reason>`（NWT ④），例 `bettor|8f3c1a2e|2026-08-30T02:30:00Z|wasmBytes>=3200; moneysurface=CLEAN#2@02:24:07Z; guard=stopped`。nonce = 请求方随机 8 hex；`.done-<utc>-<nonce>` 改名后同 nonce 再来 ⇒ 视为重放，`.ignored-*`。**只读不 source**（memory `feedback-self-heal-accounting-after-the-heal-action-never-runs-write-ahead`：状态文件不 source，只认字段）。
- 写方（非提权会话）：`printf '%s|%s|%s\n' bettor "reason" "$(date -u +%FT%TZ)" > logs/console-restart-request.tmp && mv -f logs/console-restart-request.tmp logs/console-restart-request`（先写临时再 `mv` = 原子，supervisor 不会读到半行）。
- supervisor（每 tick，**在 `console_alive` 之前**判）：
  ```
  if [[ -f "$RESTART_REQUEST" ]]; then
    req=$(head -c 512 "$RESTART_REQUEST" | head -1)          # 只读第一行、上限 512 B
    requester=${req%%|*}; rest=${req#*|}; reason=${rest%%|*}; when=${rest#*|}
    utc=$(date -u +%Y%m%dT%H%M%SZ)
    if rate_limited; then log "restart-request IGNORED (rate-limit: 1/h) requester=$requester reason=$reason"; mv -f "$RESTART_REQUEST" "$RESTART_REQUEST.ignored-$utc"; 
    else log "restart-request ACCEPTED requester=$requester reason=$reason requested_at=$when"; mv -f "$RESTART_REQUEST" "$RESTART_REQUEST.done-$utc"; restart_console || true; consecutive_fail=0; fi
  fi
  ```
  🔴 **先 rename 再 restart**（write-ahead：动作若把 supervisor 自己带走，请求文件已被消费，不会在下次 tick 重复触发 = 同 memory 那条自愈记账教训）。
- `restart_console()` 不改：它就是 (733) 实证走通的 death→headless 路（07:41:35→07:43:19Z）。
- 风暴保护共用：请求触发同样 `record_restart`（:87）计数，落在 5 min 窗 ≥5 次 ⇒ cool-down 拒绝（与判死路一致）。

### 2.2 限流与滥用面（④）
- **谁能伪造**：能写 `logs/` 的任何本机进程（ADMIN 下四会话 + 任何本机脚本）。**后果上界 = 一次 headless 重启**（有界、可审计、与 supervisor 自判死后果相同）；不能借此提权、不能让 supervisor 执行任意命令（文件只读字段，不 source、不 eval、不把内容拼进命令）。
- **限流**（NWT ①）：一个 cooldown 内**只处理 1 个请求**——`RESTART_REQUEST_MIN_GAP_SEC=3600` 内第二个及以后的请求文件一律改名 `.ignored-<utc>-<nonce>` + LOUD 日志，不执行、不排队、不"等窗口到了再执行"（防写方 bug 风暴：一个失控循环最多换来 1 次重启/小时）。再叠既有 5 min/5 次风暴保护（cool-down 期间同样 `.ignored`）。

### 2.3 headless 杀旧进程必须杀树（NWT ③，改动一并进本批）
现状实核：`kanet-start-headless.sh:65-71` 按 `logs/pids/*.pid` 发 `kill "$pid"`（SIGTERM，触发 console `shutdown()→stopAllRelays()` 优雅杀 relay 子），:74-80 再对 `:3200` 占用者 `Stop-Process -Id … -Force`——**无 `-T`/树杀**；`kanet-stop.sh:23` 才是 `taskkill //PID … //F //T`。(719) NWT 孤儿调查记过：优雅路先走 SIGTERM 所以 8/29 三次重启零孤儿，但若 console 在 SIGTERM 后卡住（正是毒化态可能发生的：主循环活、链读层坏、relay 子等 IPC 超时），`Stop-Process` 只杀父 ⇒ 35 个 relay 子孤儿（8/23 前的老病）。改法：:79 的 `Stop-Process` 之后（或替代）加 `taskkill //PID $pid //T //F`（对每个 `$PIDS`），并在 kill 后 `sleep 2` 复核 `Get-CimInstance Win32_Process -Filter "ParentProcessId=$pid"` 为空，非空 LOUD 日志（不静默）。这一改动与 GAP-2 同批落码，因为"请求重启"会更频繁走这条路。
- **不做的**：不接受远端/HTTP 触发（admin.js 0 端点，保持）；不做"请求文件里带命令"；不做队列。
- 请求前置（写方纪律，非脚本强制）：`feedback-preshutdown-money-surface…` 那套 quiesce（花钱面 CLEAN 两次、停守卫）由请求方在写文件前完成——脚本不替它判。

## 3. GAP-1 · 毒化判活

### 3.1 判据（J2 定，J1 8/30 实跑成立：02:58Z 预报 04:26Z，实撞 04:27:40Z）
`console_alive()` 改为：HTTP/心跳判活 **∧ 非毒化**。毒化任一成立 ⇒ 返回 1：

- **P1 日志签名族**（NWT (a)）：`console.log` 自本实例 boot 行之后出现任一：`unreachable executed | RuntimeError | memory\.grow | RangeError.*wasm | wasm panic | memory access out of bounds | could not allocate`。
  排除式：`… | grep -a -v 'unreachable=\|^\[relay:'`（`unreachable=` 是 settle-daemon 业务行、`[relay:` 是子进程转发行——两者是 8/30 KANet-UI/J2 各误中一次的来源）。8/30 实录首个命中形 = `[kanet:uncaught] RuntimeError: unreachable`（`index.js:23`）。
  "本实例"界定 + **只数新行**：取文件里**最后一个** `^\[db\] path=` 行号为 boot 行（headless 每次重写日志时它恰是第 1 行；若将来改成 append，判据仍对）；supervisor 记住上次已扫到的行号 `last_scanned_line`，每 tick 只 grep `(last_scanned_line, EOF]`——同一条毒化行不重复计、日志被截断（行号回退）时重置为 boot 行。**不依赖 truncation、不读 mtime。**
- **P2 wasm 冻结**：最新 heap-sample `wasmBytes ≥ 4000` **且** 连续 ≥10 min 的样本变化 <1 MB。
  读法：`grep -a 'diag:heap-sample' console.log | tail -n 15`（15 = 上限，每样本 ≈60 s；见 3.2 坑②），每行取 `at=` 与 `wasmBytes=([0-9.]+)MB`；取最后一条 `w_last,t_last`，向前找第一条 `t ≤ t_last−600 s` 的样本 `w_ref`；`w_last ≥ 4000 ∧ |w_last−w_ref| < 1` ⇒ 冻结。样本不足 10 min ⇒ **不判**（不判 ≠ 活：只是 P2 缺席，P1 仍有效）。
- 🔴 **P2 的 `≥4000` 限定词不可去**（NWT (b)）：IBD 门生效后 wasm 本就 flat-low（8/30 07:45–07:51Z 实测 4.1→4.3 MB），"10 min 不变"是健康常态；只有**顶上**不变才是毒化。
- 两条都是"离散事件"判据；**不加速率判据**（J1 §四：速率抖动两次误疑，检测器只报越阈与冻结）。

### 3.4 phase-2（最干净方案，改 console，另报备）
心跳文件 `logs/console-heartbeat.txt`（`index.js:519-521` 每 2 s 写 `Date.now()`）改写为 `<ts>|wasm-ok|<wasmBytes>`：console 自己在写心跳前读 `__wasm.memory.buffer.byteLength`（同 probe 的直读）并做一次 1 B 的 wasm 调用自检（如 `new Address(faucet)`），异常或 ≥4000 ⇒ 写 `wasm-poisoned`；supervisor 的 `heartbeat_fresh()` 改为"新鲜 ∧ token==wasm-ok"。优点：判活信号由被判者自证、不解析日志；缺点：改 console（用户面外、非钱路，但走完整报备）。v0.1 先落 supervisor 侧 P1/P2（零改 console），phase-2 另起。

### 3.2 J1 05:56Z 三条实现坑（必须写进实现与向量）
- **坑①** 数值正则只吃整数：字段是 `wasmBytes=3373.1MB`，`(\d+)` 会匹出 `3373` 再被当字节 ⇒ "0 MB / 零风险"。**用 `wasmBytes=([0-9.]+)MB`**；bash 里用 `awk` 取浮点，禁 `(( ))` 整数算术；加哨兵：解析出的值 ≤0 或非数 ⇒ 视为**解析失败**（LOUD 日志），不是"安全"。
- **坑②** 采样上限静默截短：`tail -n N` 取样时输出必带 `上限 N / 实取 M`；**M ≥ N 打旗标**；冻结起点须可信——起点样本的前一条必须仍 <4096，若起点就是窗口第一条 ⇒ 起点被截、真实更久。本判据只需"最近 10 min 不变"，N=15 足够且必须 >10 min 的样本数，不足即旗标。
- **坑③** "不变"不许读 mtime/size：Windows 目录项对持开写入文件实测滞后 3 min 20 s ~ 4 天（规则 80 附注 `d866c655`）⇒ **只读行内 `at=`/`wasmBytes=`**；`heartbeat_fresh()` 现用的 `stat -c %Y` 是既有实现，本稿不动它，但 P2 不得复用那条路。

### 3.3 与既有 fail 计数的关系
- 毒化命中 ⇒ `console_alive` 返 1 ⇒ 进入既有 `consecutive_fail` 路（3 tick = 90 s 后 restart）——保留 3 次确认，天然抗单次误读（如日志被截、样本缺）。
- 日志：命中时 `log "POISON: <P1|P2> <证据一行>"`（P1 = 命中的原行前 120 字；P2 = `wasm=<w_last>MB frozen_for=<sec>s samples=<M>/<N>`），每 tick 一行直到重启（最多 3 行）。

## 4. 激活约束（③）—— 🔴 bootstrap 死结（NWT ⑤）
- supervisor 是**常驻 bash 进程**（`_run` 分支 :175，`nohup … &`），改脚本文件**不会**改变正在跑的进程 ⇒ 新逻辑只在下次 supervisor 重起后生效。
- supervisor 由 headless 在每次 console 重启时"不活才拉"（`kanet-start-headless.sh:178-185`），而它通常一直活 ⇒ **console 重启不会换 supervisor 的码**；换码只有两条路：(a) 提权 `kanet-console-supervisor.sh stop` 再由计划任务/headless 拉起新码；(b) 整机重启（计划任务随开机起）。两条都要提权 ⇒ **首次激活必然是一次 Owner 提权动作**——这正是 GAP-2 要消灭的动作本身，所以它无法自举，只能"最后一次手动"。
- **紧迫度 gate 在 A/B**：IBD 门有效（wasm 斜率 ≤0.1 GB/h，见诊断 v0.2）⇒ 下次撞顶不再有时间压力，与下次计划重启合并激活；无效 ⇒ 下次毒化前紧急激活（Owner 一次提权）。
- **合并激活步骤**（与下一次阈值重启合并，零额外停机）：① 侧分支落码 → NWT diff GREEN → Owner 批 → 合入 live 树；② 下一次有序重启（wasm ≥3200 或 6 h 兜底）时，由**提权方**（Owner，或本稿 GAP-2 落地后…注意：GAP-2 自身还没生效，首次仍是 Owner）在 kill console **之前**先 `bash scripts/kanet-console-supervisor.sh stop`（:191-205，需能杀 SYSTEM 进程 = 提权）再 kill console → 计划任务/headless 拉起时以新脚本起 supervisor；③ 起后核 `console-supervisor.log` 首行 `supervisor start pid=… ` 时间 > 合入时间，并跑 §5 的正向量（写一个请求文件 → 看到 `restart-request ACCEPTED`）——**这是唯一能证明新逻辑在跑的读数**（memory `committed-not-deployed…`：commit ≠ live）。
- 🔴 首次激活前 GAP-2 不存在 ⇒ 仍需 Owner 提权一次；激活后以后每次都走文件。

## 5. 测试（⑤，全部离线、不动 live supervisor）
- `bash -n scripts/kanet-console-supervisor.sh`（语法）。
- 抠函数到 scratch：把 `console_alive`/`poison_p1`/`poison_p2`/`handle_restart_request`/`rate_limited` 复制成 `scratch/_sup_units.sh`，`source` 后对假日志/假请求文件跑向量（`KANET_ROOT` 指向临时目录，`restart_console` 替换成记账 stub）：
  | # | 向量 | 期望 |
  |---|---|---|
  | R1 | 无请求文件 | 不触发；日志无 `restart-request` |
  | R2 | 请求文件 `bettor|test|<utc>` | `ACCEPTED` 日志 + stub 调 1 次 + 文件已改名 `.done-*` + `RESTART_HISTORY` 多 1 行 |
  | R3 | 1 h 内第二个请求 | `IGNORED (rate-limit)` + 改名 `.ignored-*` + stub 0 次 |
  | R4 | 请求文件内容含 `;rm -rf`/反引号/512 B+ | 字段原样进日志（截断 512 B），**stub 仍只调 1 次、无其它副作用**（证不 eval） |
  | R5 | 请求文件 + 风暴窗已 5 次 | cool-down 拒绝，改名 `.ignored-*` |
  | R6 | 同 nonce 的请求在 `.done-*-<nonce>` 存在后再来 | 重放 ⇒ `.ignored-*`，stub 0 次 |
  | R7 | cooldown 内第 2、3 个请求 | 全部 `.ignored-*`，不排队、窗口到期后不补执行 |
  | K1 | headless 杀树：假父进程 + 子进程树（scratch 起 `node -e setInterval` 父子） | `taskkill //T //F` 后子进程为空；去掉 `//T` 的突变 ⇒ 子进程残留（红） |
  | P1a | 假 console.log：boot 行**之前**有 `RuntimeError: unreachable`，之后无 | 活 |
  | P1b | boot 行之后有 `[kanet:uncaught] RuntimeError: unreachable` | 死（`POISON: P1`） |
  | P1c | 之后只有 `unreachable=7[...]` 与 `[relay:x] … unreachable` | 活（排除式生效） |
  | P2a | 15 个样本 wasm 从 3900 涨到 4020（每分钟 +8） | 活（未冻） |
  | P2b | 样本 4096.0 连续 12 min 不变 | 死（`POISON: P2 frozen_for≥600`） |
  | P2c | 4096.0 但只有 5 min 样本 | 不判（活）+ 旗标 `samples<10min` |
  | P2d | `wasmBytes=3373.1MB` 用旧正则 `(\d+)` | 向量必须证明新正则取 3373.1（坑①），并对 `wasmBytes=abcMB` 报解析失败 |
  | P2e | 取样 `tail -n 15` 恰好实取 15 且最早一条已 ≥4096 | 旗标 `起点被截`（坑②） |
- 突变对照（memory `mutation-test-must-grep-the-injected-line`）：去掉 `mv … .done` ⇒ R2 第二个 tick 必须再触发（红）；去掉排除式 ⇒ P1c 变死（红）；正则改回 `(\d+)` ⇒ P2d 红。
- 真机激活后的正向量（§4③）只做 R2 一次，写方 = Bettor。

## 6. 不在本稿
- 台阶源修复（IBD 门 `c64cd0c1` 已在 live，本次重启 = A/B 处理臂；判读另出诊断 v0.2）。
- 链读探针式判活（`getUtxosByAddresses` 阳性对照）——比 P1/P2 更主动但引入 RPC 依赖与 IBD 期空值语义，留 v0.2 议。
- 计划任务 `Run` 权限下放给 ADMIN（另一条 GAP-2 路径）——涉及 Windows ACL，NWT/Owner 另议；本稿走"文件请求"是因为它不改任何权限模型。

## 7. 待 NWT 判
1. P2 阈值 4000 MB / 10 min / <1 MB 三个常数是否沿用 KANet-UI 盯守的 CAPPED=4000 口径。
2. 请求文件限流 1/h 是否过紧（有序重启失败需重试的场景）——可改为"上一请求 `.done` 后 10 min 内不再收"。
3. 毒化命中是否仍要 3 次确认（90 s），还是 P1 命中即刻（P1 是硬证据、不可逆）。
