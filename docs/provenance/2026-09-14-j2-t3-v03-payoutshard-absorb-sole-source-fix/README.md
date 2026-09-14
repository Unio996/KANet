# PayoutShard.absorb — sole-source MUST-FIX（ledger 1208，Codex 独立发现，Bettor 核过成立）

## 背景

`ShardLeaf`↔`PayoutShard.absorb` 的 hand-off MUST-FIX（`9ff095a3`，ledger 1196）修完双计数冻结 bug 后，
Codex 独立复核这条改动时判"P+S 双计数"这个具体缺陷 **CODE-CLOSED**、"同笔原子"这个方向判 **SUPPORTED**，
但同时发现了**另一条**此前没人指出的缺口（Bettor 核过成立，属真实 MUST-FIX，不是同一个 bug 的重复认领）：

`absorb` 只验证 `shardInIdx` **单点**的模板字节匹配与金额（`readInputStateWithTemplate(shardInIdx,...)` +
`require(shardTk.amount==shard_amount)`），**从未证明 `shardInIdx` 是本笔交易里唯一的"同模板、非本 PS
持有"代币输入**。

## 攻击/事故向量

两个**合法**的 `ShardLeaf` 实例 A、B 各自持有 `S` 代币，凑巧（或被恶意构造）在**同一笔交易**里各自独立跑
`consolidate_to_payout`（A 和 B 各自的 `scanOwnedTokenInputs()==pool_value` 检查互不知情、各自独立成立，
两边都合法通过）。`absorb` 只需要**点名其中一个**（例如 B）当 `shardInIdx`，`tok_out` 的金额只算
`consolidated_pool + S`（只计入 B 的份额）——A 的代币输入**被这笔交易消费掉，但从未出现在任何输出的账目
里**：这是**静默销毁**（真实资产损失，不是通胀/多印钱）。批量归集组装器如果无意中在同一笔交易里塞进了
不止一个待归集分片，也可能无意触发同一路径，不需要恶意构造。

## 修法：`countStrayNonOwnedTokenInputs` + `shardInIdx` 自身非自持双重核对

在 `scanOwnedTokenInputs` 同一遍扫描逻辑之外，新增一个**同形**的扫描函数，统计"同模板、`owner != 本 PS`、
下标 `!= excludeIdx`"的代币输入个数：

```
function countStrayNonOwnedTokenInputs(byte[] tok_prefix, byte[] tok_suffix, int excludeIdx) : int {
    ... 同 scanOwnedTokenInputs 的 blake3 现场核 + P7 尾匹配预筛 ...
    int strayCount = 0;
    for (i, 0, tx.inputs.length, MAX_INS_SCAN) {
        if (i != excludeIdx) {
            ... 命中模板 且 owner != self 则 strayCount += 1 ...
        }
    }
    return strayCount;
}
```

`absorb` 里新增两条 `require`：

```
require(shardTk.owner != OpInputCovenantId(this.activeInputIndex));         // shardInIdx 自身真是非自持
require(countStrayNonOwnedTokenInputs(tok_prefix, tok_suffix, shardInIdx) == 0);  // 本笔无其它未说明的同类输入
```

**两条合起来的证明力**：`shardInIdx` 自身满足"模板匹配 + 非自持"，且**排除 `shardInIdx` 之后**，整笔交易
再没有第二个满足"模板匹配 + 非自持"的输入——两条结合等价于"`shardInIdx` 是本笔交易里唯一的非自持同模板
代币输入"（不需要函数返回一个"下标"来单独核对相等，用"排除法计数为 0"规避了 silverscript 函数只能返回
单值的限制，正确性论证见下）。

**为什么不是"数量=1 + 记下标比对"这种更直白的形**：`silverscript` 函数只能返回一个值，同时拿到"count"和
"该 count 唯一命中的下标"需要两个返回值。改用**排除法**：先用一个独立 `require` 证明 `shardInIdx` 自己
满足"模板匹配+非自持"，再用 `countStrayNonOwnedTokenInputs(..., excludeIdx=shardInIdx)==0` 证明"除了
`shardInIdx` 之外没有第二个"——两者合起来在逻辑上与"count==1 且这个 1 就是 shardInIdx"完全等价，只用了
一个额外的单返回值函数，不需要多返回值。

**`ShardLeaf.sil` 侧不动**（Bettor 1208 明确裁）：对等额双 leaf（A、B 都持 S）而言，`ShardLeaf` 自己的
`scanOwnedTokenInputs()==pool_value` 检查是**纯自证**（只看自己名下的持仓，不看别的 leaf），对"哪个 leaf
被 absorb 点名"这件事没有区分力——这条 MUST-FIX 只能在**消费方**（`absorb`，唯一能看到"本笔交易全部代币
输入"的入口）堵，不能指望产出方（`ShardLeaf`）替消费方把关。

**`PayoutShard.sil`/`PayoutShardV2.sil` 两文件各一 commit**（本 README 记 `PayoutShard.sil` 那半，
`PayoutShardV2.sil` 见 `docs/provenance/2026-09-14-j2-t3-v03-payoutshardv2-absorb-sole-source-fix/`）——
两文件改动逐字同构（`PayoutShardV2.sil` 原本就是 `PayoutShard.sil` 的 ZK-native 结算变体，`absorb` 部分
历来保持逐字一致）。

## 编译验证

空 ctor → `expected 25, got 0`（ctor 形状不变，本次只改入口体逻辑，不改 ctor）。真实 25 参数 ctor 完整
编译 0 error。**AB11 常量重新量测**（源码变了，按纪律不假设不漂移）：`state_span={offset:1,len:204}` ——
与既有 `OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=204` 完全一致，**无漂移**（新增的函数与 `require` 不影响 State
变量的编码布局）。`bytecode_length` 从 `25967` 涨到 `32779`（新函数 + 两条新检查，符合预期，不是异常）。

## 既有向量重跑结果（确认无回归）

- `docs/provenance/2026-09-14-j2-t3-v03-payoutshard-claim-family-tokenization/PayoutShard.claimfamily.test.json`
  ——**12/12 PASS**（`claim`/`refund_claim` 两入口未被本次改动触及，逐条重跑确认不受影响）。
- `docs/provenance/2026-09-14-j2-t3-v03-shardleaf-payoutshard-handoff-fix/PayoutShard.handoff-fix.test.json`
  ——**7/7 PASS**（`absorb` 的既有跨合约验收向量，全部场景里 `shardInIdx` 本来就是本笔交易唯一的非自持
  代币输入，新增的两条检查对这些既有场景全部透明通过，不影响既有正向/负向结论）。
- `docs/provenance/2026-09-14-j2-t3-v03-payoutshard-absorb-ab11-and-batest/`（`PayoutShard_v03_absorb.test.json`
  `PayoutShard_v03_battest.test.json`）与 `docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/
  PayoutShard.drawdown.test.json`——**不适用重跑**：这三份是早于 claim-family 代币化（`0d8a61ee`，ctor
  23/22→25）的历史快照，ctor 参数数与当前源码不匹配（`constructor expects 25 arguments, got 23/22`），
  这是**已知的、早于本次改动就存在的**历史快照陈旧现象（同 `ShardLeaf.sil` 代币化 README 记录过的同类
  情况），不是本次改动引入的回归——如实记录，不代为重新生成这些历史快照的向量。

## 新增向量（`run.log`，6/6 PASS，全部 flip-expect 复核真实失败行）

| 向量 | 验证点 | 真实失败行（flip-expect 复核） |
|---|---|---|
| `V-SSF-1_pass_single_leaf_sole_source` | pass：单一 leaf 归集，`shardInIdx` 是唯一非自持代币输入 | — |
| `V-SSF-2_fail_dual_leaf_only_one_named_other_silently_destroyed`（Codex 主判据） | fail：A、B 两个合法 leaf 同笔各自 consolidate，`absorb` 只点名 B，A 的代币未被 `shardInIdx` 说明 | `PayoutShard.sil:187`（`countStrayNonOwnedTokenInputs(...)==0`） |
| `V-SSF-3_fail_shardInIdx_already_self_owned_double_credit` | fail：`shardInIdx` 指向的代币本来就是自持（已算进 `owned_total`），试图再当"新纳入"骗一次多余入账 | `PayoutShard.sil:186`（`shardTk.owner != self`） |
| `V-SSF-4_fail_unrelated_stray_same_template_input_unaccounted` | fail：一笔无关第三方的同模板代币在场且未被说明（不预设"另一个 leaf"这个叙事，验证一般化的陌生代币场景） | `PayoutShard.sil:187`（同上，隔离出"任何陌生同模板输入"而非仅"另一 leaf"这一种叙事） |
| `V-SSF-5_fail_hidden_extra_ps_owned_token_uncounted`（Codex⑤保留项） | fail：PS 自己账本之外多塞一笔归己代币 | `PayoutShard.sil:177`（`owned_total==consolidated_pool`，既有检查，确认未被新代码抢先掩盖） |
| `V-SSF-6_fail_wrong_output_amount`（Codex⑤保留项） | fail：`tok_out` 金额算错 | `PayoutShard.sil:189`（`validateOutputStateWithInputTemplate`） |

`V-SSF-3`/`V-SSF-5` 两条负向量构造时都曾一度"巧合失败在别的检查行"（`V-SSF-3` 最初被 `owned_total`
检查提前挡下、`V-SSF-5` 最初因 `tok_out` 参数误写成输入下标而報告不明确失败）——已定位并改构造，flip-expect
复核确认现在都精确失败在各自要证明的那一行，不是巧合通过。

## 授权链表补充："来源一对一"

沿用 `ShardLeaf.sil`/`RootClose.sil` 等既有 README 的授权链表体例，补一行本次新增的绑定关系：

| # | 比较 | 左操作数来源 | 右操作数来源 | 独立非零/唯一性证明 |
|---|---|---|---|---|
| 新增 | **来源一对一**：`shardInIdx` 指向的代币是本笔交易里唯一满足"模板匹配+非本 PS 持有"的输入 | `shardTk.owner`（`readInputStateWithTemplate(shardInIdx,...)` 现场读） | `OpInputCovenantId(this.activeInputIndex)`（PS 自身，协议原生读数）+ `countStrayNonOwnedTokenInputs(...,excludeIdx=shardInIdx)`（对本笔交易全部输入的独立扫描） | 两条 `require` 合取：`shardInIdx` 自身非自持（不是"假装新纳入"的自己已有持仓）+ 排除 `shardInIdx` 后再无第二个非自持同模板输入（不是"多个真实来源、只认领一个"）——合起来证明 `shard_amount` credit 的唯一合法来源就是 `shardInIdx`，没有遗漏也没有重复认领 |

## 文件清单

- `PayoutShard.sil` — 本次修改后的完整合约源码（`absorb` 新增两条 `require` + `countStrayNonOwnedTokenInputs` 函数）
- `mk_sole_source_vectors.mjs` — 6 条向量生成脚本
- `PayoutShard.sole-source-fix.test.json` — 生成的 6 条测试向量
- `PayoutShard.reference.ctor.json` / `PayoutShard.reference.compiled.json` — 参考编译产物（25 参数 ctor）
- `run.log` — `cli-debugger --run-all` 完整输出，6/6 PASS
- `README.md` — 本文件
- `MANIFEST.sha256` — 文件计数校验
