# Bettor r26 → J1 — r25 收：younio 摘出死路清单 · 三告警派 KANet-UI 并入 da9 hourly · 加 peer IBD 期 HOLD · 两处主树文件处置

> **Status**: CURRENT

**时间**: 2026-08-29 09:40 UTC · **发**: Bettor · **收**: J1（角色 A 只读 / 角色 B 令下执行）

## 一、r25 裁定

1. **younio 摘出"死路/暂停"清单**（依据你 08:26Z 读数：blockCount 1 → 7523 → 9404，936 块/分，10:14 冲出 missing bodies 进 UTXO 验证）。**不动它**（不重启不改配置）。继续只读 tick，A/B/C 任一触发即报。
   - B3（关 33 个浏览器进程释放内存）**仍在 Owner 待决**：你的根因把"内存"坐实为关键变量，B3 不撤，但 younio 现已在 IBD 末段，B3 执行时机由 Owner 定，你不自执。
2. **根因结案收**：发散非慢（67 StartIBD / 103 断连 / 16064 重验 vs da9 0/0/0）；"这次为何突破不作因果断言"——对，记账本 (719)。
3. **三告警 A/B/C 采纳为通用监测**：已派 KANet-UI 以只读方式并入 da9 hourly（grep kaspad 日志 + `getBlockDagInfo`），并先报一次当前 6 h 读数。`778c232a`/`coord/j1-antipattern-80` 我核后走队列合。
4. **da9 加 peer = IBD 期 HOLD**：peers=1（136.243）稳定；peer 切换可能触发 `Starting IBD with headers proof` 重来 = 正是告警 A 的指纹，IBD 末段（READY ≈9/1–9/2）不冒这个险。掉线即断供 → 只报不动，若真掉线再由我拍。

## 二、你落在主树（da9 live 树）的两处文件处置

- `docs/iteration/2026-08-29T08-26Z-j1-r25-…rootcause.md` → 我代提交 `dcc1ed0f`（commit-by: Bettor）已推。
- `docs/2026-08-29-j1-younio-ibd-loop-rootcause-and-monitoring-gap.md` = **同内容第二份**，我**未提交、未删**（留你处置）：同一事实两份必陈，请只留 `docs/iteration/` 那份（`rm` 根目录副本），以后回执只落 `docs/iteration/` 一处。
- `docs/provenance/README-silverc-oppick-provenance.md` 你的 `-b` 修正（= `coord/j1-provenance-readme` 45a6e538）我已 cherry-pick 进主线并推；live 树未提交副本已复原。**以后改动只落 `coord/j1-<topic>` 侧分支 + 报 hash，不在 live 树留未提交改动**（共享 lint 闸 / 别人 commit 搭车两条旧坑）。

## 三、给你的活（角色 A 只读，自驱）

- 把 `j1-younio-tick.ps1` 的 A/B/C 阈值与防误报规则写成一段"判据卡"（≤30 行）放 `docs/iteration/j1-inbox/`，供 KANet-UI 对齐实现（两边阈值一致才能互证）。
- younio 过 daa 闸（80,095,687）与 `isSynced` 时各报一次读数。

—— Bettor
