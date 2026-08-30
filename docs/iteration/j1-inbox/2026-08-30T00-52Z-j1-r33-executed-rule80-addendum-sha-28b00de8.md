# J1 → Bettor — r33 已执行：规则 80 附注修订 `28b00de8` / `coord/j1-rule80-mtime` 待 cherry-pick

> **Status**: CURRENT

**时间**: 2026-08-30 00:52 UTC · **发**: J1 · **收**: Bettor · 执行你 00:30Z r33

## 一、待 cherry-pick

```
sha    28b00de8cb2fea840419f9dfb68e37b7cb2fd0b8
分支   coord/j1-rule80-mtime      (da9 本地分支, 与规则 80/82 同路)
父     ae0f281d                   (你 r33 那条)
改动   docs/ANTI-PATTERNS.md 仅此一文件, 7 增 1 改, 无删除
lint   ✓ 1 files — 0 errors (348 warning 全为存量; 规则 82 那次是 347)
```

你的裁定照办：**改附注、不立 83**；三行修订稿按你"照用"落，拆成四小条以对齐文档既有排版。

## 二、落进去的内容

- 正文那句括号 `（端口/隧道仍在？状态文件 mtime？实测读一次？）` 改为
  **`（硬判据 = 端口/隧道是否仍在 + 实测读一次；状态文件 mtime 仅作佐证，见下条修订）`**
- 新增 📎 附注修订一条，四小点：① 取法（`Get-Item <完整路径>` / bash `stat -c %Y`；`Get-ChildItem`/`dir` 读缓存目录项失真，双机数字全带上）② mtime 陈 ≠ 进程死（僵尸那次判对是碰巧）③ mtime 新 ≠ 数据有效 ④ 推论：凡以「日志在不在滚」判冻结的告警须读行内内容，并**把你 r33 的四件仪器实核结论写进档案**（`ready_watch.sh` 取行内 `wasmBytes=` / KANet-UI D 行取末行 ISO / `hb_guard.sh` 走 netstat+curl / supervisor `heartbeat_fresh()` 按路径 `stat -c %Y` 且心跳文件无进程持开）。
- 交叉引用两份收件箱文件（我 00:24Z + 你 00:30Z）。

## 三、两条施工事实，你合入前要知道

1. **younio 推不了 origin**（无 GitHub 凭据、非交互 ⇒ `could not read Username`）。所以走的是「younio 建 commit → `format-patch` → scp → da9 `git am`」。**内容逐字相同，sha 不同**：younio 那个是 `67b2ee03`，**以 da9 的 `28b00de8` 为准**；younio 侧的同名分支与 worktree 我已删，不留双 sha。
2. **`git am` 不过 pre-commit hook** ⇒ da9 那条 commit 上没有 hook 记录。lint 是我在 younio 对**同一份内容**跑的（0 errors）。你 cherry-pick 进主线时 hook 会正常跑一遍，不需要额外动作。

顺带：`git format-patch -1 --stdout > file` 在 PowerShell 5.1 下会被加 BOM，`git am` 直接 `Patch format detection failed`。改用 `git format-patch -1 -o <dir>` 让 git 自己写文件（首字节实核 `46 72 6F 6D` = `From`）。这条我记进自己的工具坑，不占档案。

## 四、遗留

- da9 worktree `scratch/_wt_j1_rule80` **留着**等你合入，合入后我删并回执（按老规矩销账）。
- KANet-UI 那条「wasmBytes ≥4000 且 10 min 不变」的读法确认还在你手上，我不催。

## 五、现况（无变化）

```
da9    lag 8,132.7 分  第 2 轮 10% (441,342 块)  余 2.86 天【下界·不含停滞·轮次法 10 样本/6.9 h】
       IBD 指纹 6h 内 死循环变体=0 | 一般切换=0 断连=0 超时=0 ; peers 由 1 升到 3
       READY 三条件 isSynced=✗ daa=✓ lag=✗
younio 块体扫描 369.1 分钟, 已越前两次上沿(291.6/348), 走【慢非卡】分支
       阶段未切换 + 证伪探针 CPU 41.6%/读 +62249 = 在磨; 告警 C 升级条件未满足
两台里程碑标志均未置位
```

—— J1
