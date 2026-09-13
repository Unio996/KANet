# 42 个 `.sil` · silverscript v1.0.0 全量重编清单 v0.1（批 A 机械语法只在副本上 · 未改任何跟踪源）

> **Status**: FINAL-EVIDENCE v0.1（2026-09-13T10:4xZ `date -u`）· J2 · Bettor 派工 SendMessage 10:3xZ（"42 文件批 A 语法 + v1.0.0 全量重编拿清单，产物 = 文件 × 编过/拒绝原因，别改任何 .sil 源"）· 交 NWT / Bettor；作为 **批 A 的输入** 与 **主网集瘦身（批 T v0.2 §2）的实证**。
> 方法：隔离 clone `scratch/_j2_silverc_v100`@`3ed9733`（= tag v1.0.0）自建 `silverc.exe`（sha256 `4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643`），`git ls-files '*.sil'` 42 个文件**复制**到 `scratch/_j2_v100_recompile/out/`，脚本 `run.mjs` 施加机械变换后编译；ctor 参数按签名自动生成占位值（int=2 / bool=true / byte[N]=全 1）。离线、零花费、没碰 `/d/silverscript`、live 树、pinned silverc。**复跑**：`node scratch/_j2_v100_recompile/run.mjs`（严格臂）· `BNEUT=1 node scratch/_j2_v100_recompile/runB.mjs`（诊断臂）· `node scratch/_j2_v100_recompile/mktable.mjs`。
> 两臂：**严格臂** = 只做批 A 机械（A1–A9）；**诊断臂** = 严格臂 + 把 `require(tx.time …)` 换成 `require(true)`（**只为显露批 B 之外的残留，产物不可用**）。

## 0. 一句话

批 A 机械变换（含本次新发现的 **A5–A9 五条漏项**）后 **17/42 直接编过**；剩下 25 个里 **23 个的唯一障碍是批 B（`tx.time` 域）**——诊断臂中和它后 **38/42 编过**；最终残留 **4 个 = 两种 v1.0.0 新静态规则**：(C1) leader 合约里手写 `entry` 必须显式 `#[covenant.allow(rule = manual_entrypoint_in_leader_contract)]`（FoldNode / PoolLeaf / PoolShard_fold，**全在主网集**）；(A5-manual) 外模板字面量对应的 struct 未在文件内声明（RootClose）。#245/#246 的资源/脚本上限对 42 个文件**零命中**。

## 1. 计数

| 臂 | PASS | 失败 | 失败构成 |
|---|---|---|---|
| 严格批 A | **17 / 42** | 25 | B(tx.time) 纯 21 · B + C1 1（PoolShard_fold）· B + A5-manual 1（RootClose）· C1 2（FoldNode / PoolLeaf） |
| 诊断（+B 中和） | **38 / 42** | 4 | C1 ×3（FoldNode / PoolLeaf / PoolShard_fold）· A5-manual ×1（RootClose） |
| 主网集 11（批 T v0.2 §2） | 5 直接过（FoldNode_sealonly / PayoutShard / PayoutShardV2 / RootClaim / ShardLeaf_direct） | 6 | B 纯 3（CloseZkV2 / ShardLeaf / RootClose→+A5-manual）· C1 3（FoldNode / PoolLeaf / PoolShard_fold） |

## 2. 批 A 机械变换全表（迁移计划 §4 批 A 原 4 条 + 本次新发现 5 条 · 计数 = 严格臂实际施加）

| 项 | 变换 | 文件 / 处 | 出处 |
|---|---|---|---|
| A1 | `entrypoint function` → `entry` | 42 / 104 | 计划 §4 |
| A2 | `byte[34]` → `byte[36]` | 24 / 106 | 计划 §4 |
| A3 | `byte[](x, n)` → `(x as byte[n])`（只处理括号内无嵌套的简单形；余 4 处全在注释里） | 13 / 52 | 计划 §4（原计 42 处；本次逐行 56 命中含 4 注释） |
| A4 | `checkSigFromStack` → `checkMsgSig` | 1 / 2 | 计划 §4 |
| **A5（新）** | 匿名状态字面量 `{ f: v }` 与解构 `{ f: T x } = …` 必须带类型名：`State { … }` / `<Struct> { … }`。grammar `struct_literal = Identifier "{"…`、`struct_destructure_assignment = Identifier "{" …`。脚本按字面量字段集匹配选名（= 合约状态字段 ⇒ `State`；= 文件内某 `struct` ⇒ 该名） | State 13 / 23 · 外模板 16 / 31 | v1.0.0 `silverscript.pest:51,130`；⚠ 上游 `DECL.md:426` 的无标识符解构示例**已陈** |
| **A6（新）** | `byte[N] + byte[M]` 定型为 `byte[N+M]`，`byte[] x = a + b;` 报 `variable 'x' expects byte[]` ⇒ RHS 整体包 `byte[](…)`（探针 P5：`byte[](已是 byte[])` 为合法 no-op） | 12 / 90 | 探针 P5 / diag concat_a-c 三法皆过 |
| **A7（新）** | `blake2b()/sha256()/blake3()` 参数须 `byte[]`（探针 P6：直接喂 `byte[32]` 拒）⇒ 参数整体包 `byte[](…)` | 20 / 79 | 探针 P6 |
| **A8（新）** | 一参定长 int 转换 `byte[N](int)` → `(x as byte[N])`（报 `cannot cast int to byte[1]; use 'value as byte[N]'`）；hex 字面量形不动 | 1 / 6（PayoutShardV2） | 编译器报错原文 |
| **A9（新）** | `scriptPubKey == new ScriptPubKeyP2SH(…)` 两侧须同型（`byte[]` vs `byte[37]`）⇒ 右侧包 `byte[](…)` | 3 / 3 | TUTORIAL:1180 同形 |

🔴 **⇒ 迁移计划 §4 批 A 必须扩成 9 条**；A5–A7 三条的量（23+31 / 90 / 79）比原 4 条里最大的还多，"批 A = 零语义机械"的性质不变，但**逐字节等价验收（计划 §5 辅证 r1–r4）要加 A6/A7 的转换 opcode 剥离规则**。

## 3. 两条 v1.0.0 新静态规则（不机械 · 进批 C · 都在主网集）

| # | 规则 | 命中 | 含义 / 处置 |
|---|---|---|---|
| **C1** | `manual entrypoint '<e>' belongs to leader contract '<C>' and may participate in a same-covenant input group; use a cov-bound declaration or acknowledge manual covenant-group checks with #[covenant.allow(rule = manual_entrypoint_in_leader_contract)]` | FoldNode `seal_to_root` · PoolLeaf `register_append` · PoolShard_fold `register_append`（三个都是同时有 `#[covenant(binding = cov …)]` 声明 + 手写 `entry` 的文件） | 二选一：(i) 加 `allow` 注解 = **明确承认编译器不再校验该 entry 的 covenant 组逻辑**（DECL.md:336-340）；(ii) 把手写 entry 改成 cov-bound 声明。**这是设计决策不是语法**，与批 T 的 H5（每条共花代币入口自校输出）同一批人审最省 |
| **A5-manual** | `unknown struct field 'claimed_bitmap'` | RootClose（向 RootClaim 模板写状态，字面量字段既非本合约 State 也无本地 `struct` 声明） | 在 RootClose 里声明 `struct ClaimState { … }` 镜像 RootClaim 布局（FoldNode_sealonly:42 `struct RootState` 已是同一做法） |

## 4. 批 B 实证（不在本清单范围，只记对账）

- 有 `tx.time` 的 24 文件（计划附录 A 43 处）中 **23 个进了本次失败集**（`type mismatch` 无定位），第 24 个 `WinningsPool_v1` 直接编过 —— 待查其 `tx.time` 形（计划附录 A 写它 1 处）。诊断臂对全部 23 个中和后即过 ⇒ **批 B 之外没有第二种类型错**。
- 编译器对 `tx.time` 域错只报 `compile error: type mismatch` 四个字、无行号 ⇒ 批 B 落码时按计划附录 A 逐处表定位，不能靠编译器。

## 5. 本清单没做 / 边界

- 只证"编得过"，**不证语义等价**：A5–A9 的产物是否与 pinned 编译器逐 opcode 等价（计划 §5 辅证）未跑；`WinningsPool_v1` 等 17 个 PASS 的字节码只记长度。
- ctor 占位值可能让某些 `require` 在向量阶段不可满足（如 `max_fan_in = 2`）；这不影响"编得过"。
- 4 处 `⚠two-arg-left` 全在注释（`PoolSpine_v07:327/334`、`PoolSpine_i_proto` 同）。
- `_j2_closezk_repro4.sil`（根目录）与 `docs/provenance/…/S63A_TransitionProbe.sil` 是取证副本，随大流编，不进任何批。

## 附 · 42 行明细（严格臂 × 诊断臂）

| # | 文件 | 主网集 | 批 A 机械应用（A1–A9 计数） | ctor 参数数 | 严格批 A | 类别 | 诊断臂（批 A + tx.time 中和） | 字节码 |
|---|---|---|---|---|---|---|---|---|
| 1 | `_j2_closezk_repro4.sil` |  | entry×3 byte36×1 asByte×2 A5-foreign×3 A7-hasharg×5 A9-spkcmp×1 | 25 | ❌ | B(tx.time) 纯 | ✅ | 2328 B (中和臂) |
| 2 | `docs/provenance/2026-08-29-s63a-probe-v03/S63A_TransitionProbe.sil` |  | entry×4 A5-foreign×1 | 6 | ❌ | B(tx.time) 纯 | ✅ | 162 B (中和臂) |
| 3 | `kasia-console/src/lib/Blake2bProbe.sil` |  | entry×2 A7-hasharg×1 | 1 | ✅ | PASS | ✅ | 105 B |
| 4 | `kasia-console/src/lib/CheckSigFromStackProbe.sil` |  | entry×1 checkMsgSig×2 | 1 | ✅ | PASS | ✅ | 32 B |
| 5 | `kasia-console/src/lib/CloseZkV2.sil` | ★ | entry×4 byte36×2 asByte×4 A5-foreign×4 A7-hasharg×6 A9-spkcmp×1 | 25 | ❌ | B(tx.time) 纯 | ✅ | 4094.5 B (中和臂) |
| 6 | `kasia-console/src/lib/FoldNode.sil` | ★ | entry×1 asByte×3 A5-foreign×1 A6-concat×3 A7-hasharg×1 | 10 | ❌ | C1 leader 合约手写 entry 须 allow 注解 | ❌ compile error: unsupported feature: manual entrypoint 'seal_to_root' belongs to leader contract 'Fol |  |
| 7 | `kasia-console/src/lib/FoldNode_sealonly.sil` | ★ | entry×1 A5-foreign×1 | 7 | ✅ | PASS | ✅ | 140.5 B |
| 8 | `kasia-console/src/lib/OracleStake_v1.sil` |  | entry×1 byte36×1 | 2 | ❌ | B(tx.time) 纯 | ✅ | 73 B (中和臂) |
| 9 | `kasia-console/src/lib/PayoutShard.sil` | ★ | entry×5 byte36×2 asByte×2 A5-foreign×5 A6-concat×8 A7-hasharg×9 | 22 | ✅ | PASS | ✅ | 6451 B |
| 10 | `kasia-console/src/lib/PayoutShardV2.sil` | ★ | entry×5 byte36×1 asByte×10 A5-foreign×4 A6-concat×11 A7-hasharg×4 A8-asN×6 A9-spkcmp×1 | 27 | ✅ | PASS | ✅ | 5036 B |
| 11 | `kasia-console/src/lib/PoolLeaf.sil` | ★ | entry×2 asByte×3 A5-State×1 A5-foreign×2 A6-concat×3 A7-hasharg×2 | 14 | ❌ | C1 leader 合约手写 entry 须 allow 注解 | ❌ compile error: unsupported feature: manual entrypoint 'register_append' belongs to leader contract ' |  |
| 12 | `kasia-console/src/lib/PoolLeaf_nofold_probe.sil` |  | entry×2 A5-State×1 A5-foreign×2 A7-hasharg×1 | 14 | ✅ | PASS | ✅ | 325 B |
| 13 | `kasia-console/src/lib/PoolRoot.sil` |  | entry×3 byte36×2 asByte×1 A5-State×3 A7-hasharg×2 | 16 | ❌ | B(tx.time) 纯 | ✅ | 1274.5 B (中和臂) |
| 14 | `kasia-console/src/lib/PoolShard_fold.sil` | ★ | entry×4 byte36×2 asByte×4 A5-State×4 A5-foreign×1 A6-concat×3 A7-hasharg×2 | 21 | ❌ | B(tx.time) + C1 | ❌ compile error: unsupported feature: manual entrypoint 'register_append' belongs to leader contract ' |  |
| 15 | `kasia-console/src/lib/PoolSide.sil` |  | entry×4 byte36×3 A6-concat×6 A7-hasharg×7 | 9 | ❌ | B(tx.time) 纯 | ✅ | 384 B (中和臂) |
| 16 | `kasia-console/src/lib/PoolSide_v06.sil` |  | entry×3 byte36×2 | 6 | ❌ | B(tx.time) 纯 | ✅ | 1365 B (中和臂) |
| 17 | `kasia-console/src/lib/PoolSide_v07.sil` |  | entry×3 byte36×2 | 6 | ❌ | B(tx.time) 纯 | ✅ | 1384 B (中和臂) |
| 18 | `kasia-console/src/lib/PoolSide_v08_shard.sil` |  | entry×1 | 4 | ✅ | PASS | ✅ | 58.5 B |
| 19 | `kasia-console/src/lib/PoolSide_v0_7_1.sil` |  | entry×3 byte36×2 | 5 | ❌ | B(tx.time) 纯 | ✅ | 186 B (中和臂) |
| 20 | `kasia-console/src/lib/PoolSpine.sil` |  | entry×5 byte36×7 | 12 | ❌ | B(tx.time) 纯 | ✅ | 649.5 B (中和臂) |
| 21 | `kasia-console/src/lib/PoolSpine_i_proto.sil` |  | entry×3 byte36×7 asByte×6 ⚠two-arg-left×2 A6-concat×11 A7-hasharg×8 | 15 | ❌ | B(tx.time) 纯 | ✅ | 1435 B (中和臂) |
| 22 | `kasia-console/src/lib/PoolSpine_v06.sil` |  | entry×3 byte36×7 A6-concat×8 A7-hasharg×4 | 10 | ❌ | B(tx.time) 纯 | ✅ | 1332 B (中和臂) |
| 23 | `kasia-console/src/lib/PoolSpine_v07.sil` |  | entry×3 byte36×7 asByte×6 ⚠two-arg-left×2 A6-concat×11 A7-hasharg×8 | 13 | ❌ | B(tx.time) 纯 | ✅ | 1438.5 B (中和臂) |
| 24 | `kasia-console/src/lib/PoolSpine_v08_agg.sil` |  | entry×3 byte36×7 A6-concat×8 A7-hasharg×4 | 16 | ❌ | B(tx.time) 纯 | ✅ | 1427.5 B (中和臂) |
| 25 | `kasia-console/src/lib/PoolSpine_v08_chunk.sil` |  | entry×3 byte36×10 asByte×1 A5-State×2 A6-concat×8 A7-hasharg×6 | 16 | ❌ | B(tx.time) 纯 | ✅ | 1275.5 B (中和臂) |
| 26 | `kasia-console/src/lib/PoolSpine_v08_shard.sil` |  | entry×2 A5-State×2 | 12 | ❌ | B(tx.time) 纯 | ✅ | 393 B (中和臂) |
| 27 | `kasia-console/src/lib/PoolSpine_v0_7_1.sil` |  | entry×3 byte36×7 asByte×9 A6-concat×10 A7-hasharg×5 | 11 | ❌ | B(tx.time) 纯 | ✅ | 1417.5 B (中和臂) |
| 28 | `kasia-console/src/lib/PredictionEscrowConsensualMid.sil` |  | entry×2 byte36×3 | 8 | ❌ | B(tx.time) 纯 | ✅ | 239.5 B (中和臂) |
| 29 | `kasia-console/src/lib/PredictionEscrowUnanimous5.sil` |  | entry×4 byte36×14 | 14 | ❌ | B(tx.time) 纯 | ✅ | 683.5 B (中和臂) |
| 30 | `kasia-console/src/lib/PredictionPoolUnanimous3.sil` |  | entry×4 byte36×14 | 12 | ❌ | B(tx.time) 纯 | ✅ | 654 B (中和臂) |
| 31 | `kasia-console/src/lib/ProbeC_selfonly.sil` |  | entry×1 A5-State×1 | 4 | ✅ | PASS | ✅ | 74 B |
| 32 | `kasia-console/src/lib/RefundClaim.sil` |  | entry×1 byte36×1 A5-State×1 | 9 | ✅ | PASS | ✅ | 343 B |
| 33 | `kasia-console/src/lib/RootClaim.sil` | ★ | entry×1 byte36×1 asByte×1 A5-State×1 A7-hasharg×1 | 10 | ✅ | PASS | ✅ | 497.5 B |
| 34 | `kasia-console/src/lib/RootClose.sil` | ★ | entry×4 A5-State×4 A7-hasharg×2 | 11 | ❌ | B(tx.time) + A5-manual | ❌ compile error: unsupported feature: unknown struct field 'claimed_bitmap' |  |
| 35 | `kasia-console/src/lib/RootStub_probe.sil` |  | entry×1 A5-State×1 | 7 | ✅ | PASS | ✅ | 120.5 B |
| 36 | `kasia-console/src/lib/RootStub_probe_p106.sil` |  | entry×1 A5-foreign×1 | 7 | ✅ | PASS | ✅ | 536 B |
| 37 | `kasia-console/src/lib/RootStub_probe_p27.sil` |  | entry×1 A5-foreign×1 | 7 | ✅ | PASS | ✅ | 220 B |
| 38 | `kasia-console/src/lib/RootStub_probe_p53.sil` |  | entry×1 A5-foreign×1 | 7 | ✅ | PASS | ✅ | 324 B |
| 39 | `kasia-console/src/lib/RootStub_probe_p80.sil` |  | entry×1 A5-foreign×1 | 7 | ✅ | PASS | ✅ | 432 B |
| 40 | `kasia-console/src/lib/ShardLeaf.sil` | ★ | entry×2 A5-State×1 A5-foreign×1 | 11 | ❌ | B(tx.time) 纯 | ✅ | 271.5 B (中和臂) |
| 41 | `kasia-console/src/lib/ShardLeaf_direct.sil` | ★ | entry×2 A5-State×1 A5-foreign×2 A7-hasharg×1 | 11 | ✅ | PASS | ✅ | 325 B |
| 42 | `kasia-console/src/lib/WinningsPool_v1.sil` |  | entry×1 byte36×1 | 5 | ✅ | PASS | ✅ | 103.5 B |
