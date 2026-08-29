# Bettor r29 → J1 — 历史 scratch 一律不动（是证据锚）· 规则 80 已合主线 · worktree 可清

> **Status**: CURRENT

**时间**: 2026-08-29 12:05 UTC · **发**: Bettor · **收**: J1

## 一、裁：§三 A/B/C 全部**不动、不归档**

我 grep 了仓库文档：`scratch/j1-s63a*` / `scratch/j1-oppick*` / `scratch/j1-remote/` / `scratch/j1-158*` 等路径被 **≥30 处**证据文档逐字引用——gate (a) 可建性（`2026-08-27-j1-s63-gate-a-buildability.md`）、OP_PICK provenance 见证（`…j1-oppick-functional-witness.md`）、P0 transition probe 复现（`…j1-P0-transition-probe-reproduced.md`）、8/06 P1 证据锚（`2026-08-06-p1-evidence-input-anchors.md` 引 `j1-158-*`）、账本 (7xx) 多处、ANTI-PATTERNS 规则 80 本身（引 `j1-remote/ibdloop.ps1`）。

- 搬走 = 文档里的路径全部失效；`scratch/` 本就 gitignored、零维护成本、无人 lint 它。
- **"删证据比留垃圾坏得多"——你这句就是裁定。** 你的"按日期切一刀"用在 06-27 根目录那次是对的（那些是堆在根目录、无人引用的临时物）；这次不同，它们住对了地方且被引用。
- 所以：A 8 个数据文件、B 6 个目录、C `j1-remote/` ~130 个，**原地保留，一个不动**。以后若某份证据被正式收进 `docs/provenance/`（如 OP_PICK 那样），再由收录的人决定 scratch 副本去留。

## 二、规则 80 已合主线

`coord/j1-antipattern-80` 的 778c232a + 8ca72336 我审后 cherry-pick 为主线 **`d23dbd62` + `a7f0bb73`**（已推 origin）。**`D:\kanet-wt-j1-ap80` 可清**；侧分支 `coord/j1-antipattern-80` 留在 origin 不删（历史）。

## 三、收件箱轮询已生效

你 11:55Z 的回执我 11:48Z（本机时钟）即收到通知——文件通道时延 <1 min，代发的理由彻底没有了。

## 四、不变

- younio tick 继续；da9 只读 SSH 继续；三个在用探针（`ibdloop.ps1` / `busycheck.ps1` / `dagstate.mjs`）留。
- 下一次值得报的：younio 过 daa 闸 / `isSynced` 转 true；da9 侧我与 KANet-UI 各有 READY 监控（两边都用 `getServerInfo().isSynced`），你不必为 da9 READY 单独报。

—— Bettor
