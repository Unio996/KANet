# NWT 红队复核 · ZERO_HASH 系统性扫查 + 代币合约侧釜底抽薪判断

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1155：系统性扫查所有A类入口的`OpInputCovenantId`/`OpOutputCovenantId`写入owner/目的地字段位置 +
> 判"代币合约侧是否应直接拒绝owner==ZERO32的next_state"。

## 结论：**推导出一条可机械套用的判别规则，用它给出3个已有代码文件的完整分类；强烈建议代币合约侧加一行
`require(next_states[j].owner != ZERO32)`釜底抽薪——这条能覆盖绝大多数(但不是全部)攻击面；其余文件(未
迁移完成的5个)待代码可读时用同一条规则复核**

## 一、判别规则（可机械套用，不需要逐案重新论证）

**`OpXCovenantId(this.activeInputIndex)`（引用自身）——恒安全，结构性不可达ZERO_HASH**：一段covenant脚本
能够被VM当作covenant dispatch执行，前提是它自己的输入**已经**在脚本开始执行前，通过P2SH哈希匹配验证过
自己声明了一个真实的covenant_id（否则它根本不会走covenant dispatch这条路径，会被当成普通P2SH/P2PK处理）。
所以"引用自己"这件事，逻辑上不可能读到ZERO_HASH——**这条不需要加防御，是Bettor要的"证明不可达"那一类**。

**`OpXCovenantId(某个其它input/output下标)`写进owner/target字段——安不安全取决于那个下标有没有独立验证**：
- **有独立验证**（同KanetTestToken.ownerIsMarketInput / KanetTokenClaim路径(i)的market_suffix_hash：核
  sigScript尾部字节匹配一个committed hash）——**安全**，因为要让ZERO_HASH通过这层验证，需要一个不带
  covenant的普通输入的sigScript尾部恰好撞上一段经blake3验过的具体字节序列，这是哈希原像问题量级，跟
  攻击者能不能"随手不declare covenant"完全无关。
- **没有独立验证**（直接`OpOutputCovenantId(dest_idx)`或`OpInputCovenantId(dest_idx)`回显进owner，不做
  任何进一步核实）——**易受攻击**，dest_idx指向的output/input只要没declare covenant，回显值就是ZERO_HASH，
  没有任何东西挡住写进owner字段。

## 二、已有代码的完整分类（3个文件，`OpInputCovenantId`/`OpOutputCovenantId`全部出现位点逐一过）

| 文件 | 位点 | 分类 | 判定 |
|---|---|---|---|
| T1 v0.6 `KanetTestToken.sil` | `:59 ownerIsMarketInput`内的比较 | 比较,不是赋值 | 不适用(不写owner,是在场核对) |
| 同上 | `:81/:108` `transfer_delegator`系的在场比较 | 比较 | 不适用 |
| 同上 | `:118/:124` `OpCovInputCount(OpInputCovenantId(this.activeInputIndex))` | 自身引用+比较 | 已守卫(自身恒安全) |
| 同上 | b-in路由本身（`recv_idx[j]>=0`+`ownerIsMarketInput`校验`next_states[j].owner`） | 有独立验证(sigScript尾匹配market_tmpl_suffix) | 已守卫 |
| `KanetTokenClaim.sil` | `:70` 在场比较 | 比较 | 不适用 |
| 同上 | `:83` 路径(i) `target_owner=OpInputCovenantId(dest_idx)` | 有独立验证(market_suffix_hash) | 已守卫 |
| 同上 | `:85` 路径(ii) `target_owner=OpOutputCovenantId(dest_idx)` | **无独立验证** | **须加`!=ZERO32`(已报`7150e07c`，MUST-FIX待J2修)** |
| `PayoutShard.sil`(edc8b959版,即将被5a0e2729取代) | `:97` `scanOwnedTokenInputs`式在场过滤比较 | 比较 | 不适用 |
| 同上 | `:133` `owner: OpInputCovenantId(this.activeInputIndex)`（absorb续约本PS自身） | 自身引用 | 已守卫(自身恒安全)——**这条我核对过跟T3设计表"续约owner=本PS自身"一致，不是新发现的洞** |

**独立结论：目前有代码可读的3个文件里，唯一的真实缺口就是我已经报过的`KanetTokenClaim.sil:85`那一条**——
T1 v0.6本身没有洞（b-in路由的独立验证机制在设计之初就已经堵死这条），PayoutShard.absorb写self是结构性
安全不需要额外验证。

## 三、代币合约侧釜底抽薪——**强烈建议加，但要讲清楚它覆盖的范围边界，不能当成唯一防线**

**建议**：`KanetTestToken.transferPolicy`（`binding=cov`）现有的`next_states`遍历循环里，紧跟着
`amount>0`/`borrow_guard`/`extension_commitment`那几条既有检查，加一行：
```
require(next_states[j].owner != byte[32](0x0000000000000000000000000000000000000000000000000000000000000000));
```

**为什么这条能覆盖住KanetTokenClaim路径(ii)那个洞，即使那个洞的代码在另一个文件里**：`binding=cov`的
自动收集机制（本会话反复确认过的机制本身）会把**同一笔交易里所有同模板的代币输入/输出**都收进
`prev_states`/`next_states`，不管这些输出是被哪个"外部"covenant的entry（PayoutShard.absorb/KanetTokenClaim.spend）
orchestrate出来的——**只要这笔交易里还有至少一个真实存在的KanetTestToken输入被同时消费**（这正是
KanetTokenClaim.spend的场景：`tok_in_idx`那笔真实存在的代币输入被消费，触发`transferPolicy`被dispatch，
它自己的收集机制会把`tok_out_idx`那个新输出也收进`next_states`，独立跑一遍这条`!=ZERO32`检查——不需要
`KanetTokenClaim.sil`自己那条检查"记得"存在，代币合约侧会自己再核一遍）。

**这条防线覆盖不到的唯一情形（如实讲清楚，不夸大覆盖面）**：一笔**纯genesis**交易——没有任何既有代币
输入被消费，从零构造一个全新的、owner=ZERO32的代币实例。**这种情形我判断不构成真实风险**：genesis本身
免权限（任何人可以给自己造任意owner的新代币），如果有人deliberately给自己造一个owner=ZERO32的代币，
那是他们自己凭空创造出来又放弃归属的东西，没有第三方受害者——跟我发现的那类"已经归属某人的钱被悄悄转去
ZERO_HASH"是完全不同性质的两件事。**釜底抽薪这条防线覆盖了所有"会伤害到已有资金归属"的真实攻击面，
覆盖不到的那个角落本身没有受害者，不需要额外堵**。

**建议同时保留`KanetTokenClaim.sil`自己那条`!=ZERO32`检查**（已报的MUST-FIX不撤销）——两条防线不是互斥的，
"代币合约侧兜底"+"每个入口自己也核一次"是这个项目从H5"在场≠同意"以来一贯的纪律（不外包、每层自己也验），
代币合约侧加了这条不代表claim/absorb侧的检查就可以省略。

**验证要求**：这条新加的`require`必须跑一遍T1 v0.6现有的14条向量确认不破坏任何既有PASS（预期不会，因为
所有现有vector的owner值都是真实非零covenant id），且需要专门补一条"owner=ZERO32的continuation必须被
transferPolicy自己挡住"的新向量（不依赖任何外部entry，直接在token合约自己的层面证明这条防线独立生效）。

## 四、还没有代码可读的文件——待迁移完成后用同一条规则复核

`RootClose.sil`/`ShardLeaf.sil`/`ShardLeaf_direct.sil`/`CloseZkV2.sil`(剩余部分)/`RefundClaim.sil`目前
仍卡在v1.0.0语法迁移阻断（§7），我手上没有它们迁移后的真实代码可以逐行核对。**按T3设计表已经写出的输出侧
派生绑定描述**，先给一份"待验证"清单（迁移完成、代码到位后按上面§一的规则逐条复核，不是现在就下结论）：

| 文件.入口 | 设计表描述的绑定表达式 | 预期分类(基于描述,待代码核实) |
|---|---|---|
| `ShardLeaf.consolidate_to_payout` | `owner=OpInputCovenantId(psInIdx)`（已核==payout_cov_id） | 描述里写了"已核"，像是有独立验证，待代码确认具体核的是什么 |
| `ShardLeaf_direct.convert_to_rootclose` | `owner=OpOutputCovenantId(rcOutIdx)`（本笔新建RootClose，独立校验） | 描述写"独立校验"但没说校验什么，**待代码确认是否真有tail-match/hash-anchor这类独立验证，不能只信"独立校验"这四个字** |
| `RootClose.convert_to_claim` | `owner=OpOutputCovenantId(claimOutIdx)`（本笔新建RootClaim） | **描述里没提任何独立验证机制，待代码确认——这条最像是跟KanetTokenClaim路径(ii)同款缺口** |
| `RootClose.convert_to_refundclaim` | `owner=OpOutputCovenantId(rcOutIdx)`（本笔新建RefundClaim） | 同上，**同样待确认，同类疑点** |
| `PayoutShardV2.zk_handoff` | `owner=OpOutputCovenantId(zkOutIdx)`（本笔新建CloseZkV2，"既有closeZkTmplAnchor锚检查不变"） | 提到了具体的锚检查机制名字，像是已经有独立验证，待代码确认`closeZkTmplAnchor`具体核的是什么 |

**这条留白不是我不查，是代码还不存在（还在迁移阻断名单里）**——一旦§7迁移完成、这几个文件的真实代码
落地，我会用§一的判别规则逐条过一遍，不会因为"设计表写了独立校验"这几个字就直接放行。

## 五、给Bettor的处置建议

- **强烈建议代币合约侧加`require(next_states[j].owner != ZERO32)`**，覆盖范围+边界已讲清楚（覆盖所有
  真实受害场景，不覆盖无受害者的纯genesis自娱自乐）。
- 已有代码的3个文件里，唯一真实缺口是已报的`KanetTokenClaim.sil:85`，其余(T1 v0.6/PayoutShard.absorb)
  经我核对是结构性安全或已有独立验证。
- 5个未迁移文件按§四清单排期——`RootClose.convert_to_claim`/`convert_to_refundclaim`两条我判断风险最高
  （设计表描述里没提任何独立验证机制），迁移落地后优先核这两条。
