# NWT 红队复核 · PayoutShardV2代币化(`2d1e5e58`) GREEN + 可达图raw-scriptPubKey边扩扫(1164)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1164：①PayoutShardV2八点同PayoutShard复核；②我1139的可达图只按`OpOutputCovenantId`/
> `validateOutputStateWithTemplate`grep，漏了raw `scriptPubKey ==`/anchor拼接这类边——扩大扫描重新
> 确认8合约集合仍闭合，把这类边补进图。

## 结论：**PayoutShardV2 GREEN，25/25独立复现；可达图边类型扫描扩大后，确认存在此前遗漏的边类型
(raw scriptPubKey/P2SH锚)，但其目标全部落在已有8节点集合内，8合约闭合结论不变——是我的扫描方法有
遗漏，不是图本身有洞，接受批评并记录修正后的扫描规则。**

## 一、PayoutShardV2代币化(`2d1e5e58`) —— GREEN

**独立环境**：detached worktree（无node_modules/junction依赖，纯.sil编译+调试器跑）。

**①独立编译**：`silverc PayoutShardV2.sil --constructor-args PayoutShardV2_v03.ctor.json` 产物与
`PayoutShardV2_v03.compiled.json`逐字节一致（`JSON.stringify`比对`identical: true`）。

**②25/25向量独立复现**：`cli-debugger --run-all`——absorb 13/13 PASS，battest(close/cancel_attest各6条)
12/12 PASS，合计25/25，跟commit message一致。

**③24字段编码表 + 漂移量测独立复现**：自己写量测脚本调用同一台`silverc`，量出
`{own_prefix_len:1, own_state_len:288, bytecode_length:19334}`，跟源码硬编码`OWN_PREFIX_LEN=1`/
`OWN_STATE_LEN=288`完全对上（0漂移）。理论算术自己验了一遍：21个int字段×9字节（1 tag+8 payload）+
3个byte[32]字段×33字节（1 tag+32 payload）=189+99=288，跟量测值吻合。

**④diff逐行核（业务逻辑无掺入）**：读了`kasia-console/src/lib/PayoutShardV2.sil`的完整diff（150行，
132增18删）——
- `close_attest`/`cancel_attest`的委员①②③签名验证逻辑（`checkSig`/`validSigs`计数/门限判断）**逐字未动**，
  只新增`tok_prefix`/`tok_suffix`两个witness参数+`require(noTokenInput(...))`一行+KAS weld从
  `==consolidated_pool`改`>=DUST_MIN`一行——跟commit message"委员逻辑一字不动"的描述核对一致。
- `absorb`是整段语义改写（KAS value weld → 代币amount weld，含AB11手写自续约），这是本次改动的主体，
  不是"意外掺入"，跟README描述的范围完全对应。
- `refund_claim`/`zk_handoff`两个entry在diff里完全没有出现——确认"本次不改"属实，不是漏做（源码内联
  注释里也写明了范围决定原因）。

**⑤ZERO_HASH分类复核**：`absorb`里两处`OpInputCovenantId(this.activeInputIndex)`（一处是市场合约自身
续约的owner隐含绑定，一处是喂给token输出续约的`owner`字段）**都是自引用**——按本会话已确立的判别规则
（自引用恒安全，不可达ZERO_HASH），这次代币化落码没有引入新的ZERO_HASH缺口。`V-absorbV2-4`（输出侧
owner被导向陌生人covenant的负向量）验证的正是这条自引用绑定被`validateOutputStateWithInputTemplate`
的哈希重算比对挡住，不是靠额外`!=ZERO32`检查——机制上不需要那条检查，因为self-reference结构性不可能
是ZERO_HASH。

**处置建议**：GREEN，可以定案。

## 二、可达图raw-scriptPubKey边扩扫（1164②）

**批评接受**：我1139的扫描方法确实只grep了`OpOutputCovenantId`/`validateOutputStateWithTemplate`两个
关键字，漏掉了`scriptPubKey ==`直接比对 + `new ScriptPubKeyP2SH(anchor)`这类"从模板哈希现场重建
P2SH锁定脚本再比对"的写法——这是跟`OpXCovenantId`回显完全不同的另一套原语（前者是"引用已声明的
covenant_id"，后者是"从零构造一个新的redeem script再算P2SH"），两者都能起到"把一个输出锚定到某个
特定合约模板"的作用，我此前的方法论确实有盲区，不是文字游戏。

**扩大扫描**：全仓`.sil`文件grep`scriptPubKey\s*==`+`new ScriptPubKeyP2SH`+`_tmpl_hash`+`TmplAnchor`，
逐条过一遍落在8合约集合（`PayoutShard`/`PayoutShardV2`/`RootClose`/`ShardLeaf`/`ShardLeaf_direct`/
`CloseZkV2`/`RootClaim`/`RefundClaim`）内的命中，按"是否构成指向另一个持币合约的边"分类：

| 源文件.位点 | 机制 | 目标 | 是否新边 | 目标是否在8-集合内 |
|---|---|---|---|---|
| `PayoutShardV2.sil:397` `zk_handoff` | `new ScriptPubKeyP2SH(closeZkTmplAnchor重算)` | `CloseZkV2` | **是，此前漏grep** | ✅ 已在集合内 |
| `RootClose.sil:113` `convert_to_claim` | `validateOutputStateWithTemplate(...claim_tmpl_hash)` | `RootClaim` | 否(原grep关键字已覆盖) | ✅ |
| `RootClose.sil:123` `convert_to_refundclaim` | 同上，`refundclaim_tmpl_hash` | `RefundClaim` | 否 | ✅ |
| `ShardLeaf_direct.sil:112` `convert_to_rootclose` | 同上，`rootclose_tmpl_hash` | `RootClose` | 否 | ✅ |
| `ShardLeaf.sil:69`/`ShardLeaf_direct.sil:82` `register_append` | `validateOutputStateWithTemplate(...ps_tmpl_hash)` | 自己铸造的"dust ticket"（`Tk{bettorPk,direction,stake,shardPoolId}`一次性凭证结构，不是外部合约实例） | 不构成边——读了`ShardLeaf.sil:37-47`确认这只是本文件自己定义的一个struct模板，铸出的UTXO由同集合内`RootClaim`/`RefundClaim`后续`readInputStateWithTemplate`读回，全程留在8-集合内部，命名"PoolSide-ticket"是历史沿用的描述性注释，**不是**指向仓库里那个独立、无关的legacy`PoolSide.sil`文件（核对过`PoolSide.sil`/`PoolSpine*.sil`家族是完全不同、更早的betting-pool架构，且其自身的`scriptPubKey==`命中全部是"付给bettor/maker/taker/broker/oracle的终态P2PK/P2SH payout"，不产生任何指向新持币合约的边） | — |
| `PayoutShard.sil:216/:381`、`PayoutShardV2.sil:332` | `scriptPubKey == byte[](winnerLock/refundLock)` | 付给赢家/退款人的P2PK/P2SH地址 | 终态payout，不是covenant-to-covenant边 | — |
| `CloseZkV2.sil:51` | `tx.inputs[1].scriptPubKey == new ScriptPubKeyP2SH(gateRedeemHash)` | ZK-gate内联verify脚本（`gatePrefix+journalHash+gateSuffix`现场拼，不是独立`.sil`合约文件——全仓无对应的Gate合约源码，是ZK precompile调用脚本本身） | **输入侧**核对（消费一个已存在的zk证明门），不是输出侧创建新边，且目标不是一个可持币的图节点 | — |

**结论**：扩大扫描后，确实发现了一条此前grep方法漏掉的边（`PayoutShardV2.zk_handoff→CloseZkV2`，
raw scriptPubKey/P2SH锚机制），但它的目标`CloseZkV2`本来就已经在8-集合内——**8合约闭合的结论不变，
变的只是我图上这条边此前没画出来（这次补上）**。除此之外没有发现任何指向集合外新节点的边。

**方法论修正（记录供以后复用，不是本次一次性补丁）**：以后画这类covenant-to-covenant可达图，扫描
关键字必须同时覆盖两类原语——① `OpInputCovenantId`/`OpOutputCovenantId`（声明式引用已有covenant_id）
② `scriptPubKey ==` / `new ScriptPubKeyP2SH(...)` / 任何"witness供prefix+suffix+blake2b(或blake3)
现场核对committed `_tmpl_hash`/`TmplAnchor`再据此构造预期锁定脚本比对"的写法（从模板哈希独立重建
锁定条件，不依赖任何已声明的covenant_id字段）——只grep前者会漏掉后者这整整一类边。

## 三、给Bettor的处置建议

- **PayoutShardV2(`2d1e5e58`) GREEN**，可以定案。
- **可达图边扫描扩大后，8合约闭合结论确认不变**——此前漏的边（`zk_handoff→CloseZkV2`）目标已在集合
  内，无9号合约。方法论盲区已修正并记录，供以后同类图扫描直接套用两条关键字规则，不必重新论证。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
