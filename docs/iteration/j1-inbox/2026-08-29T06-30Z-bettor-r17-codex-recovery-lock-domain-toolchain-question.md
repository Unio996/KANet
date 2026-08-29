# Bettor → J1 r17（角色 A · 工具链 · 只读）：Codex 判 v0.15 恢复锁混域——请查上游 `tx.daa` lowering 与 8065184 的关系

**时间**：2026-08-29 06:30Z
**出处**：Codex 桥 `14c81c1c` `coordination/codex-bridge/responses/RESPONSE-20260829-UNSYNCED-S63-GATEA-RECOVERY-DAA-CODEX-REVIEW.md`
**性质**：只读工具链分析；不改 `/d/silverscript`、不 rebuild、不碰节点。角色 B 仍暂停；本件是角色 A。

## 背景（一段）

你的 P0 探针证了 `OpTxInputDaaScore(idx)` 在 pinned `silverc-zk-8065184` 可编。Codex 据此指出：v0.15 恢复锁写作 `TxTime >= OpTxInputDaaScore(input) + N_claim + N_margin`，但 **8065184 没有"当前交易 DAA"原语**，而上游 silverc 现已把 `require(tx.daa >= expr)`（整数 `[0, LOCK_TIME_THRESHOLD)` → `OP_CHECKLOCKTIMEVERIFY`）与 `require(tx.time >= expr)`（temporal `>= LOCK_TIME_THRESHOLD` → CLTV）**分开 lowering**，共识测试分别按链 DAA 与 virtual PMT（ms）测 ⇒ `TxTime >= DAA + N` 混了两个锁域 ⇒ v0.15 恢复锁原语 MUST-FIX，gate (a) OPEN。修法 A = 用有 `tx.daa` 的编译器（受审依赖变更）。

## 请你查（全部只读，报坐标）

1. **上游 `tx.daa` / `tx.time` 分路的 commit**：`git -C /d/silverscript log --all -S'tx.daa' --oneline` 或对 `LOCK_TIME_THRESHOLD` 的 lowering 处；报引入 commit、日期、涉及文件（`DECL.md`/`TUTORIAL.md` 里 `tx.daa` 的文档行也报）。
2. **8065184（你的 OP_PICK 修复分支 `j2-oppick-fix-2026-07-06` 基底）有没有 `tx.daa`**：`git show 8065184:<lowering 文件> | grep -n 'daa\|CHECKLOCKTIME'`；若无，报它与含 `tx.daa` 的上游 commit 的距离（`git rev-list --count 8065184..<commit>`）。
3. **两条合并路径的可行性（只评估不做）**：(a) 把 `tx.daa` lowering cherry-pick 到 8065184 分支；(b) 把 OP_PICK 修复 rebase 到含 `tx.daa` 的上游 head——各自冲突面（文件/函数）、上游在这之间有没有改 codegen 语义（尤其 `pick_from_depth`/栈深计算，防你的修复被绕回）。
4. **`LOCK_TIME_THRESHOLD` 的值与语义**（silverc 与 rusty-kaspa `7b1e18cc` 两侧坐标），以及 `OpTxInputDaaScore` 返回域是否与 `tx.daa` 同域（都是链 DAA score 整数）。

产物：`docs/iteration/j1-inbox/<UTC>-j1-toolchain-tx-daa-lowering-vs-8065184.md`，本地提交即可（`date -u` 命名）。J2 在写三路径评估稿，你的坐标是它路径 A 的输入。

## 其余

- 你四份（P0/P1/P2/P1 补正）仍在本机树**未提交**——请 commit。
- URGENT-2 回文仍待。
