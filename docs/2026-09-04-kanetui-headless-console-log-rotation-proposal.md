# 报备：kanet-start-headless.sh 截断 console.log 前先归档（保留最近 N 份）

> **Status**: CURRENT（APPROVED · 已落码 · 待下次自然重启生效）

- 状态：**APPROVED · NWT GREEN（1 SHOULD 已采纳：清理管道尾 `|| true`；#6 可选 KEEP 非数字回落已采纳）· Bettor 批（2026-09-04 ~13:5xZ）· 已落码 `kanet-start-headless.sh` · 生效 = 下次自然重启 · 不单独重启**
- 提出：KANet-UI（运维域 · 非钱路 · 非用户面）· 2026-09-04 · Bettor `kanet-tn12-1c [4a17db]` 派工
- 审：NWT（reviewer）→ GREEN 后 Bettor 批 → **随下次自然重启生效，不为它单独重启**
- 改动面：`kanet-start-headless.sh` 一处（第 150–151 行附近）· 不碰 `kanet-start.sh`（见 §5 后续项）

## 1. 问题（今天实核）

| 事实 | 出处（自跑） |
|---|---|
| headless 路径截断 `console.log` **无副本** | `kanet-start-headless.sh:150-151`：`CONSOLE_LOG="$LOG_DIR/console.log"` 紧接 `> "$CONSOLE_LOG"` |
| 交互路径有归档，但只在那一条路径 | `kanet-start.sh:297`：`[ -f "$CONSOLE_LOG" ] && mv "$CONSOLE_LOG" "$CONSOLE_LOG.prev" 2>/dev/null` |
| supervisor 判死**永远走 headless** | `scripts/kanet-console-supervisor.sh:129-131`：`Console death detected — invoking kanet-start-headless.sh` |
| 今天 13:33:04Z 自愈重启把 console 34368 的 ~93MB 日志清空 | `logs/console.log` 现 424KB、起 13:33Z；`logs/console.log.prev` 123MB 但内容是 08-18→08-21（末时间戳 `2026-08-21T15:35:36`），不是 34368 的 |
| headless 截断前已先杀旧 console | `kanet-start-headless.sh:68-79`（pid 文件 `kill` + 端口 `Stop-Process`）在 :151 之前 ⇒ 截断时旧进程已死，mv 不与写者竞争 |

⇒ 每次**自动**自愈重启都把死前证据抹掉。KANet-UI 接位文件"六步重启 ⓪ 先 cp console.log"只覆盖**人手**重启；机器路径没有这一步。今天 J2 六层诊断因此少了 34368 的死前日志。

## 2. 改什么（精确到行）

`kanet-start-headless.sh` 第 150–151 行，把

```bash
CONSOLE_LOG="$LOG_DIR/console.log"
> "$CONSOLE_LOG"
```

改为

```bash
CONSOLE_LOG="$LOG_DIR/console.log"
# 截断前归档(2026-09-04 KANet-UI 报备·Bettor 派工): supervisor 自愈重启一律走本脚本,
# 之前这里直接截断 ⇒ 死前 console.log 无副本(今天 34368 的 93MB 就这样没了)。
# 与 kanet-start.sh:297 的单份 .prev 不同: 带 UTC 后缀 + 只留最近 N 份, 不无限堆积。
KEEP="${KANET_CONSOLE_LOG_KEEP:-5}"
case "$KEEP" in ''|*[!0-9]*) KEEP=5;; esac   # NWT 审 #6: 非数字回落默认, 不让清理管道带错
if [ -s "$CONSOLE_LOG" ]; then
  ARCH="$CONSOLE_LOG.prev-$(date -u +%Y%m%dT%H%M%SZ)"
  if ! mv "$CONSOLE_LOG" "$ARCH" 2>/dev/null; then
    # mv 失败(句柄仍被占等)⇒ 退化为 cp, 证据仍在, 只是多花一次拷贝
    cp "$CONSOLE_LOG" "$ARCH" 2>/dev/null || echo "[headless] WARN console.log archive failed: $ARCH"
  fi
  # 只留最近 KEEP 份 .prev-<UTC>(按名字排序 = 按时间排序); 旧的 .prev / .pre-restart* 不动
  # NWT 审 #1 SHOULD: 尾加 || true, 让"归档失败不杀启动"写进机制, 不依赖本脚本当前没有 set -e
  ls -1 "$CONSOLE_LOG".prev-*Z 2>/dev/null | sort | head -n -"$KEEP" | while read -r old; do rm -f "$old"; done || true
fi
> "$CONSOLE_LOG"
```

要点：
- **默认 N=5**，可用 `KANET_CONSOLE_LOG_KEEP` 覆盖（只在 kanet.env / 环境给，不改脚本）。今天量级 93MB×5 ≈ 465MB；`/d` 现余 768G。
- **只清理本规则自己产出的 `console.log.prev-<UTC>Z`**（glob `prev-*Z`）；既有的 `console.log.prev`、`console.log.pre-restart*`（人手归档）**不在清理范围**。
- `-s`（非空）才归档：空日志不留空壳。
- 文件名时间戳 `date -u`（ledger 783/784 教训：手打漂 4h）。
- 失败退化 cp、再失败只 WARN 不阻塞启动（**启动路径不能因归档失败而失败**）。
- `set -uo pipefail` 下 `head -n -N` 对空输入 exit 0，`ls` 无匹配时 `2>/dev/null` + 空管道，整段不触发 `-u`。

## 3. 不改什么

- 不动 `kanet-start.sh:297`（交互路径）——那条已有单份 `.prev`；统一两条路径是**后续项**（§5），本次小步只补机器路径。
- 不动 supervisor、不动 console 代码、不重启任何东西。
- 不改 `.prev` 既有文件、不删 `pre-restart*` 人手归档。

## 4. 生效与验证

- **生效时机**：commit + push 后，下一次 supervisor 判死自愈 / 人手跑 headless 时自然生效。**不为它单独重启。**
- **不重启的静态验证（我落码后跑、NWT 可复跑）**：
  1. `bash -n kanet-start-headless.sh`（语法）；
  2. 把 §2 代码块抽成 scratch 脚本、指向 `scratch/_logrot_test/console.log` 假文件跑 7 次，断言目录里 `prev-*Z` 恰 5 份且是最新 5 份、`prev`/`pre-restart*` 假文件未动、空文件不产 prev；
  3. `node scripts/lint-kanet.mjs kanet-start-headless.sh`。
- **草案阶段自测（KANet-UI 自跑 · 2026-09-04 13:47:44Z–13:47:49Z · `set -uo pipefail` 下）**：§2 逻辑抽成函数对 `scratch/_logrot_test/console.log` 跑 7 轮 + 1 轮空文件：结果恰 5 份 `prev-*Z`（内容 line 3→7 = 最新 5 份）、预置的 `console.log.prev` 与 `console.log.pre-restart-x` 未动、空文件轮未新增文件、8 轮 rc 全 0。测试目录已删。
- **真实生效证据（下次自然重启后我核）**：`logs/console.log.prev-<UTC>Z` 出现、大小 ≈ 死前 `console.log`、末行时间戳 = 死前最后一行；`kanet-start-headless-launcher.log` 无 `WARN console.log archive failed`。

## 5. 回滚

- 一条 `git revert <该 commit>`（改动只此一处、无状态、无数据迁移）。
- 回滚后行为 = 现状（直接截断）。已产生的 `prev-<UTC>Z` 文件不受影响，可手动删。
- 后续项（另开报备，不搭车）：`kanet-start.sh:297` 改为同一段逻辑 → 两条路径单一源（Owner "统一最新删旧"）。

## 6. 风险面

| 风险 | 判断 |
|---|---|
| 磁盘 | N=5、单份 ≤ 百 MB 级；`/d` 余 768G；且只清自己产的文件 |
| 启动被归档失败卡住 | 全部 `2>/dev/null` + 退化 + WARN，最坏 = 与现状相同（直接截断） |
| mv 与旧进程竞争 | :68-79 已先杀旧 console；即便句柄残留，Windows 下 node 以 share-delete 打开，rename 通常成功，失败也退化 cp |
| 误删 | glob 限定 `console.log.prev-*Z`；`.prev`/`.pre-restart*` 不匹配 |
| lint 闸 | `.sh` 改动走 pre-commit `lint-kanet`；无新 lint 规则、非 lint 工具本身 ⇒ 不触发"lint push 即 deploy"红线 |
