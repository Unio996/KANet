# T1/T2/T3 路由变更稿 v0.2 · 守恒放宽 MUST-FIX 定案(市场侧遍历方案 + 实证探针)

> **Status**: DRAFT-FOR-REVIEW v0.2（2026-09-13 · J2 · Bettor 裁决(ledger 1119)：NWT 红队
> `docs/2026-09-13-nwt-redteam-j2-routing-change-remove-bout-review-v0.1.md` 判 v0.1 的 `sum_in>=sum_out`
> 守恒放宽为 MUST-FIX，给出具体攻击构造（`absorb(shardInIdx=token#1)` 时同笔交易里的 `token#2` 被静默漏过、
> 市场记账与链上代币脱钩）。本稿在 T1 v0.6 落码前定案修法，不写 `.sil`。Bettor 追加三点必答（1119-补）已逐条
> 覆盖，见 §3。）

## 0. 一句话

**选方案 1（市场侧遍历 `tx.inputs`）**，不选方案 2（代币合约加显式烧毁量字段）——原因见 §2。已用独立探针
（`docs/provenance/2026-09-13-j2-t1-v0.2-market-scan-probe/`）**实证**"手写 `entry` 遍历 `tx.inputs` +
P13 形结构匹配 + `readInputStateWithTemplate` 读非本 covenant 输入真实状态 + 按 owner 过滤累加"这条链路在
silverc 里可编可跑，5 条向量全部按预期通过（含谐波翻转臂），不是纸上假定。最终守恒式：**代币合约侧维持
`sum_in >= sum_out`（结构上只能到这里，理由见 §1），但这条不再是"没用上的口子"——它现在跟一条新的、
**强制**的市场侧不变量配对：**每一个会共花代币的 A 类入口，必须先遍历本笔交易的全部输入，把"结构匹配代币
模板 + owner 等于本市场自己"的每一笔都累加，并断言这个总和等于该入口实际要处理的量**。这两条合在一起，
效果等价于旧的 `sum_in == sum_out`，只是分别由两个独立执行的脚本各自证明一半（详见 §4 的最终形式）。

## 1. 为什么代币合约侧不能再收紧（回应 Bettor 1119-补③）

V-T-6 的根因（`docs/provenance/2026-09-13-j2-t1-token-sil-implementation/KNOWN-GAP-V-T-6.v0.3.md`）已经
钉死：`binding=cov` 函数**结构性**无法对"不属于本 covenant"的输出做任何内省（`OpOutputCovenantId`/
`validateOutputStateWithTemplate` 单独测都失败）。代币合约的 `transferPolicy` 必须是 `binding=cov`
（框架靠这个绑定自动收集 `prev_states`/`next_states`），所以它**没有任何安全的手段**去验证"离开的那部分
代币最终去了哪、去的数量对不对"——这不是这次没想到，是上一轮（v0.1）已经论证过的边界，这次只是把它讲得
更精确：**收紧不是"把 `>=` 改回 `==`"这么简单能做到的，因为"改回 `==`"本身就要求代币合约能看见"离开的
部分变成了什么"，而这正是它做不到的那件事**。所以 `sum_in >= sum_out` 是代币合约侧**能给出的最强承诺**，
不是偷懒——收紧这件事必须交给能看见全局的一方去做，也就是 §2 的市场侧遍历。

**代币合约侧唯一新增的一点**（跟 v0.1 一致，重申）：`next_states[j]` 的接收方检查（`ownerIsMarketInput`）
不变——`sum_in >= sum_out` 只放宽"差额允许存在"，不放宽"继续留在代币合约记账里的那部分必须去到真实市场"
这条（H1(b) b-in 检查一字不改）。

## 2. 为什么不选方案 2（代币合约加显式烧毁量字段）

NWT 备选的方案 2 是"代币合约加一个显式烧毁量字段，与 market 同笔续约状态双方核对"。**核对**这一步，无论
往哪个方向做，都会撞上跟 V-T-6 同一类的墙：

- 如果是**代币合约去读 market 的续约输出状态**（核对 market 写没写下"这笔烧了多少"），这就是让 `binding=cov`
  的 `transferPolicy` 去内省一个不属于代币自己 covenant 的**输出**——跟 V-T-6 的坏路径**逐字一样**（只是
  输出内容换了个字段名），必定重蹈覆辙，不需要另开一轮探针去验证"会不会也坏"，逻辑上就是同一个洞。
- 如果是**代币合约去读 market 的（本笔之前的）输入状态**（`readInputStateWithTemplate` 读市场自己的先前
  state，检查其中某个"计划烧毁量"字段），这在原语层面也许可行（本稿 §2 的探针刚好证明了`readInputStateWithTemplate`
  读外部 covenant 输入是可以工作的），**但这解决不了问题**：市场的"先前状态"是**这笔交易开始之前**就已经
  确定的值，不能反映"这笔交易里实际处理了哪些代币输入"这件**运行时**才能确定的事实——攻击者一样可以在
  "先前状态"字段值不变的情况下，另外夹带一笔代币输入进来不被任何逻辑覆盖，方案 2 挡不住这个。

**结论**：方案 2 要么撞回 V-T-6 那个已经证实存在的坑，要么就算避开了坑也堵不住这条攻击线本身（时序不对）。
方案 1（市场侧运行时遍历本笔全部输入）是唯一在**这笔交易发生的那一刻**就能看到"到底有几笔代币输入、都是
谁的"的地方——这不是偏好问题，是**唯一在时序和工具链两个维度都站得住的选项**。（回应 Bettor 1119-补②：
既然不选方案 2，"字段写入路径要不要额外走 `validateOutputStateWithTemplate` 约束"这条不适用，不需要另开
设计。）

## 3. 市场侧遍历方案的具体形（回应 Bettor 1119-补①）

**只认 owner==本 market 的代币模板输入**——不是无差别数所有"看起来像代币"的输入。伪码（对齐 T3 doc §2
的 `tokenOutOk`/`noTokenInput` 两个既有 helper 风格，新增第三个 `scanOwnedTokenInputs`）：

```
// (C) 遍历本笔交易全部输入, 只累加"结构匹配代币模板 且 owner==本市场自己"的那些, 返回总量(供各 A 类入口
//     跟自己实际要处理的量做等式核对——这是本稿新增的第三个公共 helper, 每个 A 类入口调一次)。
function scanOwnedTokenInputs() : int {
    int total = 0;
    for (i, 0, tx.inputs.length, max_ins_scan) {
        byte[] ss = tx.inputs[i].sigScript;
        int n = ss.length;
        bool looksLikeToken = false;
        if (n >= token_suffix_len) { looksLikeToken = ss.slice(n - token_suffix_len, n) == token_suffix; }
        if (looksLikeToken) {
            TokenState tk = readInputStateWithTemplate(i, token_prefix_len, token_suffix_len, token_tmpl_hash);
            if (tk.owner == OpInputCovenantId(this.activeInputIndex)) {
                total = total + tk.amount;
            }
        }
    }
    return total;   // 单出口(v1.0.0 语言限制, 同 ownerIsMarketInput 既有写法)
}
```

以 tokenized `PayoutShard.absorb` 为例，入口体里在原来只读 `shardInIdx` 那一笔的基础上，加一行：

```
require(scanOwnedTokenInputs() == shard_amount + <本入口已经通过其它途径认定"合法在场但不计入本次归集"的量, 通常为 0>);
```

大多数 A 类入口(`absorb`/`claim`/`refund_claim`/`claim_draw` 等)在**正常构造**下，"本笔交易里所有归本
市场的代币输入" = "这个入口本来就要处理的那些"（一次只处理一批相关的代币，不会有不相关的代币混进同一笔
交易）——所以对绝大多数入口，等式右边就是入口自己已经在算的那个数（比如 `absorb` 的 `shard_amount`，
`claim`/`refund_claim`/`claim_draw` 的"读到的 `tk.amount`"）。只有当合法业务场景本来就需要一笔交易里
带多个不相关代币输入时，才需要右边显式列出"这几笔加起来"——T3 §3 逐条展开时按每个入口的真实参数签名去定。

## 4. 最终守恒式（回应 Bettor 1119-补③）

**分两处，各自独立执行，合在一起等价于旧的精确守恒**：

- **代币合约侧**（`binding=cov` `transferPolicy`，结构上到顶）：
  ```
  require(sum_in >= sum_out);
  ```
- **市场侧**（每个会共花代币的 A 类入口，`entry`，本稿新增的强制义务）：
  ```
  require(scanOwnedTokenInputs() == <本入口业务逻辑实际要处理并已经在其它 require 里核对过的量>);
  ```

这两条**必须同时满足**才能通过整笔交易——代币合约证明"没有凭空多出来的钱"，市场证明"所有归它的代币输入
一笔都没被漏过"，两条叠加起来就是完整的守恒证明，只是分布在两个独立脚本里，不是写在同一处。**不留没用上
的口子**：`sum_in >= sum_out` 这个 `>=` 本身永远无法单独防住 NWT 的攻击（这点 NWT 说得对），但它从来
不是孤立生效的——它跟市场侧的 `scanOwnedTokenInputs` 义务是**成对交付**的，T1 v0.6/T3 §3 逐条展开时，
**两边必须在同一次合入里一起落码**，不能只做一边。

## 5. 探针证据（不许纸上假定，Bettor/NWT 明确要求）

`docs/provenance/2026-09-13-j2-t1-v0.2-market-scan-probe/`：

- `TokenStub.sil` + 三个 ctor 变体（A/B 同 owner 不同 amount，X 不同 owner）——供构造"多笔归属不同的代币
  输入"的测试现场，模板不变量（prefix/suffix/template_hash 跨实例一致）已用 `derive_token.mjs` 校验。
- `MarketScanProbe2.sil`（隔离排错用）：**先只验证** `readInputStateWithTemplate` 单独读一笔外部输入
  能不能工作——第一版踩过坑（sigScript 给"00+suffix"占位短串会报 `-42 cannot be used as an array index`，
  该原语内部按 sigScript 长度反推 state 位置，必须给该实例**完整编译产物的 bytecode 原样**，不能走 P9
  那种"只需要尾部匹配"的浅形式），修完 `read_one_pass` 向量 PASS，确认修法。
- `MarketScanProbe.sil`（正式探针，本稿 §3 伪码的可编译落地）：`scan_absorb` entry 完整实现遍历+匹配+
  owner 过滤+累加。5 条向量：
  - `V-scan-1`（正）两笔归本 market 的代币输入(100+250)被正确扫到累加=350 ⇒ pass。
  - `V-scan-2`（反，复现 NWT 攻击原形）只声明处理 100，遍历真的扫到另一笔 250 也归本 market，
    总和 350≠declared(100) ⇒ fail——**证明遍历挡住了 NWT 6da618e8 描述的那个洞**。
  - `V-scan-3`（正）存在一笔同模板但 owner 不是本 market 的输入，遍历正确**不计入**它 ⇒ pass
    （对应 Bettor 1119-补①的具体要求）。
  - `V-scan-4`（正）存在一笔 sigScript 尾部对不上模板的输入（比如 fee 输入），结构匹配阶段就被排除，
    从不触发 `readInputStateWithTemplate`（不会因为它不是代币就 abort）⇒ pass。
  - `V-harness`：V-scan-1 的 expect 翻转，正确变红，证明谐波非摆设。
- `run.log`：两个探针文件的完整 `cli-debugger --run-all` 输出（6 条向量：MarketScanProbe 5 条 +
  MarketScanProbe2 1 条，全部按预期通过）。
- `MANIFEST.sha256`：19 项，git ls-tree 对齐前会按 n/n 惯例核对。

## 6. 对 T1 v0.6 / T3 §3 的落地影响

- T1 v0.6：`transferPolicy` 的改动仍是 v0.1 描述的那些（删 b-out 分支、`recv_idx[j]` 只剩 b-in、
  `sum_in==sum_out` 改 `sum_in>=sum_out`）——本稿没有再改代币合约本身，只是确认了这个 `>=` 的最终定位
  和搭配关系。
- T3 §3 逐条展开（v0.3）时，**每一个 A 类入口**（`absorb`/`claim`/`refund_claim`/`claim_draw`/
  `zk_handoff`/`convert_to_claim`/`convert_to_refundclaim` 等）新增 §3 的 `scanOwnedTokenInputs()`
  调用 + 对应等式核对，这是**除了 v0.1 已经写明的 A/B 类改法之外**新增的第三类必需修改——T3 §3 的表格
  需要在每一行 A 类入口后面补一列"遍历核对"，不是可选项。
- 向量清单在 v0.1 §3.2 基础上再加：每个 A 类入口至少 1 组"遍历漏掉一笔归本市场的代币输入 ⇒ fail"向量
  （本稿 `V-scan-2` 就是这一类的最小可复现形，T3 落码时逐个入口复刻）。

## 7. 未核到 / 留后续

1. `max_ins_scan`（遍历上界）与代币合约自己的 `max_ins`/`max_outs` 是否要用同一个常量，还是市场侧单独
   定一个——留 T3 §3 逐条参数签名展开时定，不影响本稿的机制结论。
2. 多笔"合法的、本来就该在同一笔交易里"的不相关代币输入（比如同时处理两个不同 leaf 的 `consolidate_to_payout`）
   时，`scanOwnedTokenInputs()` 的返回值需要在等式右边同时列出两边——这类"批量入口"的具体参数形留 T3
   §3 逐条展开，本稿的探针只覆盖最小单入口场景。
3. `token_prefix_len`/`token_suffix_len`/`token_tmpl_hash` 这三个 ctor 常量在 market 侧已经是 T3 Q8
   裁决里规划好的状态字段（§1 表格），`scanOwnedTokenInputs()` 直接复用，不需要新增。
