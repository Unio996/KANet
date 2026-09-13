# NWT 红队复核 · T3 稿 v0.1（主网集 7 合约代币化改法）+ provenance 日志补档抽查 + .gitignore 豁免意见

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象一：`docs/2026-09-13-j2-t3-market-set-token-rewrite-design-v0.1.md` 提交 `0ed31b07`（T3 v0.1）。
> 审对象二：`5fe47544`（provenance 日志补档）+ `e15176fd`（.gitignore 豁免,单行,请求一句意见）。
> 方法：直接读本机 7 份主网集 `.sil` 源码逐条对照 T3 的改法描述,不只读文档措辞;`sha256sum -c` 从仓根对五个 T1/T2 provenance 目录做独立复核。

## 结论：**T3 v0.1 GREEN-with-ONE-MUST-FIX**——落 `.sil` 前必须补一处缺失分支,其余全部 PASS

---

## 一、provenance 日志补档（`5fe47544`）抽查——**PASS**,过程记一条我自己的差错

从仓根（不是从目录内)对 P7/P8/P9/P12/P13 五个目录跑 `sha256sum -c MANIFEST.sha256`：**0 mismatch,全部 OK**;`git ls-tree` 计数与 MANIFEST 行数逐个核对(P7: 6=5+1,P8: 9=8+1,P9: 21=20+1,P12: 13=12+1,P13: 9=8+1,均为"MANIFEST 自身不计入自己的清单"这一个固定偏移)——**根因(`.gitignore:5` 的裸 `*.log`)与补法(`git add -f`)都核实无误**。

**记一条我自己的差错**：我第一次跑这个检查时 `cd` 进了目录再执行 `sha256sum -c`,而 P7/P8/P9 的 `MANIFEST.sha256` 里存的是**仓根相对路径**(不是裸文件名)——这导致路径被拼两次,报了一堆"No such file or directory"的假警报。**从仓根直接跑 `sha256sum -c <目录>/MANIFEST.sha256`(不 cd)后全部 OK**。这是我这次核查过程中的操作失误,不是 J2 补档的问题,如实记录方便下次别人抽查同类 MANIFEST 时别踩我这个坑(P12/P13 的 MANIFEST 用的是裸文件名,两种格式混用在这批 provenance 目录里,抽查前先看一眼 MANIFEST 内容用的哪种路径风格)。

## 二、`.gitignore` 豁免（`e15176fd`）——**一句意见：批准**

`!docs/provenance/**/*.log` 只在 `docs/provenance/` 目录树内豁免 `*.log`,不影响其余任何位置(scratch/`.log`、其它目录构建日志等仍按原规则忽略)。这是结构性修复(配一条规则堵死"运行时原始日志系统性漏收录"这个根因),不是留言/约定,符合本文件通则里"漂移用删/该有权威副本用配自查"这条分类下的"它就是唯一记录,需要机制而不是靠人记住"——**批准,请 Bettor 推**。

## 三、T3 v0.1 · 主体裁决

### 3.1 一处计数误差(非阻塞,记档)

T3 §0/§3 声称"34 处 `.value` 引用逐行……全部弃 KAS weld……0 处保留"。我逐文件 `grep -n "\.value"` 独立核对（排除 `RootClose.sil:22` 那一行——它是注释文字"R3 value-conserve"里含 `.value` 子串,不是真代码行),7 文件实际 `.value` 引用总数是 **33**,与 T3 §3 表格里逐条列出的行号总数(我逐行数过)也是 **33**,一致。**"34"这个数字本身错了 1,但没有漏改任何一行**——33/33 全部对应上,行号也全部核对无误,不影响哪些行要改这个结论,只是汇报的计数比实际多算了一个。记档,不阻塞。

### 3.2 **主发现(MUST,落 `.sil` 前必修)**：`PayoutShard.claim`/`refund_claim`、`PayoutShardV2.refund_claim`、`RootClaim.claim_draw` 缺少"最后一笔精确清零"分支——这是一个**现在就存在**的 KAS 域 bug,代币化会把它原样带过去,且后果从"网络可能拒收"变成"硬性 revert 永久卡死"

**这是 Bettor 点名要查的"34 处改法是否漏了该保留 KAS 语义的地方"这题的答案,但答案的形状跟预期的不一样**——不是"漏了个该留 KAS 的地方",是**漏了一个该复制过去、CloseZkV2 早就有、但没被搬到其余四处的既有防御分支**。

**先说 CloseZkV2 已经怎么做**（`kasia-console/src/lib/CloseZkV2.sil:193-207`,`escape_claim` 同款在 `:126-140`)：
```
if (consolidated_pool == payout) {
    require(tx.outputs[payoutOutIdx].value == consolidated_pool);   // 显式守恒,不留续约输出
} else {
    require(tx.outputs[selfOutIdx].value == consolidated_pool - payout);
    validateOutputState(selfOutIdx, { ... consolidated_pool: consolidated_pool - payout, ... });
}
```
CloseZkV2 自己的头注释写得很清楚(NWT checklist④)：**"最后一个 claimant 精确清零 consolidated_pool 时不产生 0-value continuation output(Kaspa dust 策略拒绝)"**——这是团队已经踩过一次的坑,已经修好、留了案。

**再看其余四处(直接读源码确认,不是猜)**：

| 文件:入口 | 现状(我读的源码行) |
|---|---|
| `PayoutShard.sil:claim` (`:217-224`) | **无条件** `require(tx.outputs[selfOutIdx].value == consolidated_pool - payout)` + 无条件 `validateOutputState`,**没有 `if (consolidated_pool == payout)` 分支** |
| `PayoutShard.sil:refund_claim` (`:382-389`) | 同上,**无分支** |
| `PayoutShardV2.sil:refund_claim` (`:333-344`) | 同上,**无分支** |
| `RootClaim.sil:claim_draw` (`:94-108`) | 同上,**无分支** |

**这不是我猜的边缘情况,是几乎每个市场都会真的撞到的常见路径**：只要一个市场只有一个赢家(单赢家市场——完全合理的常见形态),这个赢家的**唯一一次** `claim` 调用,`payout` 就等于当时的 `consolidated_pool`(因为没人比它先领),**必然**触发这条无分支的路径,构造出一个 `tx.outputs[selfOutIdx].value == 0` 的续约输出;多赢家市场里,**无论谁最后一个来领**(领取顺序不是链上强制的,任何一个赢家都可能是"最后一个"),也会撞到同一条路径。**这是常态,不是尾部情况。**

**KAS 域现状**：如果 Kaspa 的 dust 策略确实拒绝 0-value 输出(CloseZkV2 自己的头注释这么写,归因给团队此前一次真实踩坑),那么 `PayoutShard.claim`/`refund_claim`、`PayoutShardV2.refund_claim`、`RootClaim.claim_draw` **现在(改代币之前)就带着这个 bug**——凡是触发"最后一笔精确清零"这条路径的交易,构造出来的 tx 会被网络拒绝广播,对应的赢家/退款方**领不到钱**。这是一个独立于本次代币化改造、现在就存在的缺陷,只是之前没人显形过(市场量小/没人正好撞上单赢家或最后一位)。

**代币域会更糟**：T3 §3 对这四处的改法描述是"弃 KAS weld → 换代币 amount weld",如果**照字面直接替换**(把 `require(tx.outputs[selfOutIdx].value == consolidated_pool - payout)` 换成对代币输出的 `amount == consolidated_pool - payout` 的 `tokenOutOk` 调用,不额外加分支),最后一笔清零时会试图创建一个 **`amount == 0` 的代币续约输出**——J2 自己在 T3 §6 第③题已经确认"与 KCC-0020 `amount > 0` 约束一致,不留代币输出"这条規則适用于 CloseZkV2,但**没有把同一条规则套到这四处**。KCC-0020 的 `amount > 0` 很可能是**合约状态校验层的硬约束**(不是网络 mempool 策略这种"看运气"的软限制),意味着这个 revert 会是**确定性、每次必发生、无法绕过**的——比 KAS 域的"可能被网络拒收"更硬,后果是该赢家/退款方的钱**永久卡在这份 covenant 里,没有任何后续调用能把它取出来**(因为这条路径每次都会在同一个 `require` 处 revert,没有"重试"这个概念——精确清零是必然状态,不是随机触发的坏运气)。

**裁决:MUST**——落 `.sil` 前,把 CloseZkV2 已经验证过的 `if (consolidated_pool/pool_value == payout/refund) {...} else {...}` 分支,原样搬到 `PayoutShard.claim`、`PayoutShard.refund_claim`、`PayoutShardV2.refund_claim`、`RootClaim.claim_draw` 这四处。这**同时修了一个现在就存在的 KAS 域缺陷**(建议无论代币化进度如何都记一条独立缺陷,不必等 T3 落地才修——如果 mainnet 迁移窗口允许,现在就能在 KAS 域验证这个修法;如果 D-017 節奏已经决定"KAS 域不再投入,直接在代币化里一次修"也可以,我不替 Bettor 拍这个时间顺序,但**技术上这条分支必须在,不能省**)。

我抽查了 `PayoutShardV2.sil` 与 `PayoutShard.sil` 的 `absorb` 入口(它们是"往池子里加钱"不是"从池子里领钱"),确认这两处不受影响(`consolidated_pool + shard_value` 只会增大,没有清零风险);`RootClose.sil` 的 `convert_to_claim`/`convert_to_refundclaim` 是**整池一次性搬到下游新 covenant**,不是逐笔 draw-down,自己没有"续约"这一步,同样不受影响——**只有这四处逐笔 draw-down 的 A 类入口需要这个分支,不是所有 A 类入口都需要**。

### 3.3 CloseZkV2 输出形对 ZK journal 的影响——**直接读源码确认:风险等级 LOW,与 J2 自己 §7 的推测一致,现在可以从"未核"关闭**

读了 `zk_close`(`:36-50`)的 `journalHash = sha256(betsRootBaked + byte[](attestedWinner, 1) + guestPayoutRoot)`——这个哈希只由三个值构成：状态里的 `betsRootBaked`、状态里的 `attestedWinner`、witness 供的 `guestPayoutRoot`。**没有任何一处引用输出的脚本形态、输出数量、或"钱最终怎么付"这类信息**。再读 `claim`(`:144-207`)与 `escape_claim`(`:80-140`)的 merkle 叶公式：`blake2b(bettorPk + byte[](payout, 8))`(或 `bettorPk + stake`)——同样只有 pk 与金额,不含输出脚本形态。

**结论**：ZK guest 电路证明的是"`betsRootBaked`+`attestedWinner` 这两个输入,经过电路计算,得到 `guestPayoutRoot` 这棵 {pk, payout} 映射树"这一件事;电路本身**根本不知道、也不关心**链上合约后续怎么把钱付给这些 pk——付款方式(P2PK 直付 vs 创建一个 `KanetTokenClaim` 覆盖模板输出)完全是 `claim`/`escape_claim` 入口自己的链上逻辑决定的,在电路的证明范围之外。**把 payoutOutIdx/refundOutIdx 的输出从 P2PK 换成代币领取覆盖模板输出,不需要改电路、不需要改 journalHash 公式、不需要重新生成任何证明——这是纯粹链上侧的改动**。这条比 J2 自己在 §7 写的"应不变;未核"更进一步:**现在是从源码直接确认的,不是推测,风险等级 LOW,可以从"没核到"清单里划掉**。

### 3.4 J2 的四问

1. **`seal_count`/`min_bet` 本稿拍进状态**：批准,与我上一轮 Q8 裁决一致(纯等值/比较用途,零结构性,按市场变是合理产品面)。
2. **B 类入口的 KAS dust weld 也要核 `≥ DUST_MIN`**：批准,而且**这条和 3.2 的新发现是两件不同的事,不要合并成一条**——`DUST_MIN` 管的是 KAS `.value`(网络层最低限,适用于**所有**续约输出,包括 B 类不碰代币的那些);3.2 管的是**代币 `amount`**(合约状态层的 `>0` 约束,只适用于会创建/续约代币输出的 A 类入口)。两条都要,互不替代。
3. **`escape_claim`/`claim` 的"最后一笔全额,不留代币输出"分支,与 KCC-0020 `amount>0` 一致**：确认,CloseZkV2 这两处本来就有(是它已经学过的教训),**但请把这条确认套用到 3.2 列的另外四处,不要只留在 CloseZkV2**。
4. **领取输出的 dust KAS 由结算 tx 的 fee 输入付**：批准这个方向,不阻塞本稿,但请 T5(settler/tx 构造阶段)显式验证一次算术闭合——既然池子的钱已经是代币,covenant 自身续约输出大概率只剩 dust 级 KAS,构造 `claim`/`escape_claim` 交易时,**网络 fee**与**新建领取输出的 dust** 这两笔 KAS 都得靠外部 fee 输入供,不能想当然覆盖,T5 落地时这条要有一个真实向量(不只是设计文档一句话)。

### 3.5 §7 未核项处置

- `readInputStateWithTemplate(...).amount` 字段访问的 v1.0.0 形——批准延后到 v0.2/实现阶段核实,机制上 P11 已证过母原语可编,字段访问只是语法细节,风险低。
- CloseZkV2 输出形对 ZK journal 影响——**本轮已核实关闭,见 3.3**,不再是未核项。
- RefundClaim 是否在主网集——批准延后,不影响本稿其余 22 条入口/常量的裁决,T3 v0.2 或落码前确认即可。

---

## 四、给 Bettor 的处置建议

- **T3 v0.1 GREEN-with-ONE-MUST-FIX**：3.2 的四处缺失分支必须在落 `.sil` 前补上(建议同时记一条独立的 KAS 域既有缺陷,不管代币化进度如何这条本身就该修)。其余全部 PASS：34→33 计数误差记档不阻塞;B 类 DUST_MIN 与 A 类 amount>0 两条批准,注意是两件不同的事;CloseZkV2 的 ZK journal 风险从"未核"降级为"已核实 LOW";J2 四问全部批准;§7 剩余两项批准延后。
- provenance 日志补档(`5fe47544`)抽查 PASS,0 mismatch,过程记了我自己一条操作失误(cd 进目录导致路径拼两次的假警报,供后面抽查同类 MANIFEST 的人参考)。
- `.gitignore` 豁免(`e15176fd`)一句意见：**批准**,结构性修复,范围收窄到 `docs/provenance/` 树内,不影响其余规则。
