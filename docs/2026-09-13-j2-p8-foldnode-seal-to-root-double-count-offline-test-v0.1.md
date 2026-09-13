# P8 · FoldNode `fold` × `seal_to_root` 同笔交易双记 · 离线实测 + 可达性核 v0.1

> **Status**: FINAL-EVIDENCE v0.1（2026-09-13T11:31Z `date -u`）· J2 · Bettor 派工 SendMessage 11:2xZ（两步：① cov-id 派生/作用域从源码答 ② 离线构造组合交易喂 v1.0.0 debugger；决定要不要开事故账）· 交 Bettor + NWT · 回填批 T v0.6。
> 产物 `docs/provenance/2026-09-13-j2-p8-foldnode-seal-double-count/`（FoldNode 诊断副本 = 批 A 副本 + 仅加 `#[covenant.allow(...)]` 注解，**无任何角色检查 = 现状**；RootStub 作 root 模板替身；10 条向量；run.log；MANIFEST）。

## 0. 结论（三句）

1. **脚本层：双记成立。** 同一笔 tx，input 0 = 未折满 FoldNode A 跑 `fold`（leader，把 B 折进新 leaf 和），input 1 = 已折满 FoldNode B（同 cov id）跑 `seal_to_root`（B 单独封顶成 root）——**两段脚本都接受同一笔 tx**（v1.0.0 cli-debugger 10/10 向量与预期一致，含 2 条 harness 自检）。B 的 `pool_value / count / local_yes / local_no` 在 leaf 与 root 里各记一次；KAS 差额 = B.pool_value 由外部补款。后果向量：双记后的 leaf（count 4 ≠ shard_count 3）**永远封不了顶**，其 150 KAS（含 A 的 50）只剩 fold 路。
2. **可达性：TN12 上不可达，主网集里也不该有它。** (a) covenant id = `hash(授权输入 outpoint, 有序输出列表)`（rusty-kaspa `consensus/core/src/tx.rs:377-378`），续约输出继承（`CovenantBinding`）；relay 里全部 genesis 都是 **单输出** `GenesisCovenantGroup(0,[0])`（`kasia-relay/src/lib/p2sh.mjs:1885`），全部续约都是 `self_out_idx` **单输出**（`:1927/:1975/:2027/:2085/:2161/:2683/:2749`），**不存在任何 1→N 路径** ⇒ 我们的代码造不出"同 cov id 两个同时活着的 UTXO"，P8 的 A/B 前提在 TN12 不成立。(b) relay 只给 **PayoutShard** 输出绑 covenant；ShardLeaf/FoldNode 输出从不带 `CovenantBinding` ⇒ `#[covenant(binding = cov)] fold` 在链上**从未可执行**。(c) `chain_events` 全史 **0** 条 fold/seal/convert 事件；DB 无 fold 表；`ShardLeaf.sil:11` 明写 "原 convert_to_foldnode(fold-tree 路)在 (A)/rolling 整个废弃（2026-06-20 NWT 异质核承重修）"；live 编译入口（pool-bshard-artifacts / pool-shard-register / prediction-escrow-ss / zk-prove-worker）只编 `ShardLeaf / PayoutShard / PayoutShardV2 / PoolSide_v08_shard / PredictionEscrowUnanimous5`，**不编 FoldNode**；`pool-convert-builder / pool-seal-builder / pool-bshard-market-setup` 三个 FoldNode 调用方只互相 import，`index.js` / settle daemon / pool-shard-settle **都不引用** ⇒ 死代码。
3. **裁定建议（Bettor 拍）：不开事故账（非活缺陷，且不可达）；把 fold-tree 家族（FoldNode / FoldNode_sealonly / PoolLeaf / PoolShard_fold / PoolLeaf_nofold_probe）从主网集剔除**——这同时把 C1 三处手写 entry 全部移出主网集（它们只在这三个文件里），C1 角色 1 修复退为"若复活 fold-tree 才做"。主网集瘦身 v2 见批 T v0.6 §2。

## 1. 向量（`FoldNode_diag.test.json` · ctor：shard_count=3, max_fan_in=4, root_tmpl_hash = RootStub(B sealed state) 的 template_hash；A = {10,40,count 1,pool 50}，B = {30,70,count 3,pool 100}，SUM = {40,110,4,150}）

| # | 主动输入 / 入口 | tx | expect | 结果 | 证什么 |
|---|---|---|---|---|---|
| p8_fold_leader_accepts_group_with_sealed_B | in0 `fold` | in[A,B] 同 cov X；out[leaf(SUM) value 150, root value 100] | pass | ✅ | fold 盲按 cov id 读到活着的 B 并接受 |
| p8_seal_to_root_B_accepts_same_tx | in1 `seal_to_root(1, prefix, suffix)` | **同一笔** | pass | ✅ | B 同笔封顶也接受 ⇒ 双记 |
| p8_aftermath_leaf_count4_cannot_seal | `seal_to_root` on leaf(SUM) | — | fail | ✅ | count 4 ≠ 3 永不封顶 |
| p8_baseline_fold_A_alone | `fold` | in[A] out[leaf(A)] | pass | ✅ | fold 不依赖 B |
| c1_single_input_seal_pass | `seal_to_root` | in[B] out[root] | pass | ✅ | C1 正向量 |
| c1_two_same_cov_inputs_seal_CURRENTLY_PASSES | `seal_to_root` | in[A,B] | pass | ✅（**修后应 fail**） | C1 反向量：现状能过 = 缺口存在（脚本层） |
| c1_second_input_not_our_cov_seal_pass | `seal_to_root` | in[裸输入, B] | pass | ✅ | C1 弱注入：判的是同 cov 计数 |
| c1_fold_control_two_inputs_pass | `fold` | in[A, B'(count 1)] | pass | ✅ | fold 对照（count_sum 2 ≠ 3 不触发 commit 校验） |
| h_seal_root_value_wrong_fails | `seal_to_root` | root value 99 | fail | ✅ | seal 真在核 value weld |
| h_fold_sum_wrong_fails | `fold` | leaf pool 149 | fail | ✅ | fold 真在核和 |

root 输出表达：RootStub（7 字段镜像 RootState）用 v1.0.0 以 B 的 sealed 状态为 ctor 编译，整段字节码 = prefix ‖ state ‖ suffix（artifact `state_span {offset 1, len 87}`），`script_hex` = 其 P2SH spk（`aa20<blake2b>87`，kaspa-wasm `ScriptBuilder.fromScript().createPayToScriptHashScript()` 与生产 `bshard-close-transport.mjs:286` 同算法）；ctor `root_tmpl_hash` = artifact `template_hash`。

## 2. 边界

- debugger 非共识 VM；不核 Σin ≥ Σout（双记 tx 在共识层需外部补 B.pool_value 的 KAS，与推演一致）。
- "同 cov id 的 A/B 并存"是**假设输入**（test.json 手工赋同一 covenant_id）；§0.2 已证我们的代码造不出它。
- RootStub 是 PoolRoot 的替身；seal_to_root 只核模板 hash + 状态字节 + value，替身足够。
