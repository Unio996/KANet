# C1 · leader 合约里的手写 entry 补"角色 1"最小修 · 设计 v0.1（不出 patch）

> **Status**: DRAFT-FOR-REVIEW v0.1（2026-09-13T11:2xZ）· J2 · Bettor 派工 11:2xZ（"设计先行不出 patch；连 seal_to_root 同笔记两次推演一起交 NWT；NWT 判 seal_to_root 是否既有缺陷"）· 改 `.sil` = 批 C 语义新增 ⇒ NWT GREEN + Bettor 拍后才出 patch；已部署 TN12 字节码不动（pinned 复现）。
> 出处：42 文件重编清单 §3 C1（v1.0.0 新静态规则）· NWT f4abb387 ②（allow 是低风险选项，**前提**先核三处实现了 DECL.md 三选一哪一种）· 批 T v0.4 §3 C1 行（实核：一种都没实现）。

## 1. 事实

| 文件:入口 | 现有组检查 | DECL.md:321-335 三选一 |
|---|---|---|
| `FoldNode.sil:82 seal_to_root` | **无**（只 `require(count == shard_count)` + `validateOutputStateWithTemplate(root…)` + `tx.outputs[rootOutIdx].value == pool_value`） | 一种都没 |
| `PoolLeaf.sil:59 register_append` | **无**（`validateOutputStateWithTemplate(ps…)` + `validateOutputState(leaf…)` + value weld） | 一种都没 |
| `PoolShard_fold.sil:53 register_append` | **无**（同上 + `closed == 0`） | 一种都没 |

三个文件同时有 `#[covenant(binding = cov, from = max_fan_in, to = 1, mode = verification)] function fold(...)` ⇒ 是 **leader 合约**；v1.0.0 报 `manual entrypoint '<e>' belongs to leader contract '<C>' and may participate in a same-covenant input group`。`#[covenant.allow(rule = manual_entrypoint_in_leader_contract)]` 只压掉编译错、**不生成任何检查**（DECL.md:338-340）⇒ 直接贴 = 把"编译器不查"合法化，而手写逻辑本来就没查。

## 2. 最小修 = 角色 1（拒绝共享执行）

每处入口**第一行**加：
```
require(OpCovInputCount(OpInputCovenantId(this.activeInputIndex)) == 1);   // C1 角色1: 本入口不与同 covenant 的其它输入共花
```
并在入口上方加 `#[covenant.allow(rule = manual_entrypoint_in_leader_contract)]`。
- 语义：`register_append` / `seal_to_root` 只允许"这笔 tx 里本 covenant 只有我这一个输入"；同 covenant 多输入的合法场景只有 `fold`（cov 声明自己管组）。
- 为什么不选角色 2/3：角色 2（拒 input zero）会让单输入的 register 永远失败（单输入就是 input zero）；角色 3（当 leader 验全组）= 重写 fold 的组校验，等于改声明路线的代价。
- 字节码影响：每入口 +4 op（`ACTIVEINPUTIDX INPUTCOVID COVINPUTCOUNT 1 EQUAL VERIFY` 量级）；**dispatch tag / 模板 hash 全变**（v1.0.0 本来就全换，批 D 一并）；已部署 TN12 盘不受影响（pinned 编译器复现）。
- 与批 C 的关系：这是 rc1/v1.0.0 **拒而 0.1.0 收**的那类"潜伏 bug"（计划 §4 批 C 定义），排批 C，不单开批。

## 3. 向量（每入口一正一反 + 一对照）

| # | 设置 | expect |
|---|---|---|
| 正 | 本 covenant 单输入跑 `register_append` / `seal_to_root`，其余输入非本 covenant | pass |
| 反 | 同 covenant 两输入，input 0 跑本手写 entry，input 1 任意 | fail（`OpCovInputCount == 2`） |
| 对照 | 同 covenant 两输入走 `fold`（cov 声明） | pass（证明修的是手写 entry，没伤 fold） |
| 弱注入 | 反向量里把第二输入换成**不同** covenant id | pass（证明判的是"同 covenant"计数，不是"输入数"） |
cli-debugger `.test.json` 可表达（`covenant_id` 相同/不同 + `active_input_index`），离线零花费。

## 4. 🟡 顺手发现 · `seal_to_root` 在 fold 组内可能双记 pool_value（请 NWT 判是否既有缺陷）

前提：`seal_to_root` 现无组检查（§1）。构造：同一 tx，input 0 = FoldNode A 跑 `fold`（leader，读全组 prev_states 求和、`validateOutputState` 一个新 leaf 值 = Σ pool_value），input 1 = FoldNode B（同 covenant）跑 `seal_to_root`（要求 `tx.outputs[rootOutIdx].value == B.pool_value` 且 root 状态 pool_value = B.pool_value）。
- 若 fold 的 `prev_states` 覆盖组内**全部**输入（含 B），则 B 的 pool_value 既进了新 leaf 的和，又出现在 root 输出——**账面 pool_value 被记两次**；KAS 层面输入 = A+B，输出 = (A+B) leaf + B root，差额 B 需外部补款——攻击者补一份 B 就能得到一份"多出来"的 root 记账（root 之后按 pool_value 派彩）。
- 若 fold 的组校验会因 B 不在 `new_states`/输出映射里而拒，则不成立。
- **我不下结论**：取决于 fold 的 leader wrapper 对"组内输入必须一一对应到组输出"的强度（DECL.md verification mode 只核 out_count == new_states.length，没说输入侧一一对应）。这**同时在 TN12 live（0.1.0 编译的 FoldNode）与主网集**，是否单开事故账请 NWT/Bettor 判；角色 1 修复恰好关掉这条路。

## 5. 请 NWT 判

1. 角色 1 是否够（vs 改 cov-bound 声明）。
2. §4 是否既有缺陷；若是，TN12 live 盘是否需处置（D-017：未结盘不逐盘收摊，但缺陷账要记）。
3. 向量四档是否完整。
