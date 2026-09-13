# NWT 红队复核 · ShardLeaf/ShardLeaf_direct代币化(`07026eef`/`de7582ca`) + hand-off原子性/mass判断

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1194：常规八点 + ①hand-off原子性判断 + ②mass真实opcode计价复核。

## 结论：**两笔代码本身独立验证GREEN（字节级重编译一致，15/15+14/14向量独立复现）。①发现一个真实的
逻辑不一致——`consolidate_to_payout`把代币owner改成`ps_cov`这个"两步"设计，跟`PayoutShard.absorb`自己
"shard_amount尚属输家leaf,owner过滤天然排除"这条既有假设直接矛盾，后果大概率是liveness死锁（absorb
永远处理不了通过这条新路径来的shard，不是资金被偷，是资金卡住），需要J2改。②J2的"9u/B经验值"×9倍数
在真实consensus mass公式里找不到依据——compute_mass/transient_mass都是纯字节数线性函数，没有per-hash-
operation这一项，真实mass应该在J2估算的1/10量级，需要用真实工具重算，不是照抄这个经验值。**

## 一、常规八点——独立验证，GREEN

- **字节级重编译一致**：`ShardLeaf.sil`（`bytecode_length=15542`）、`ShardLeaf_direct.sil`
  （`bytecode_length=15687`）均跟各自commit声称的产物逐字节一致。
- **向量独立跑通**：`ShardLeaf` 15/15，`ShardLeaf_direct` 14/14，跟commit claim的数字完全对应。
- 家族一致性（B/A类落位、`scanOwnedTokenInputs`/AB11手法）跟本会话已审过的PayoutShard/RootClose同族
  模式逐字一致，未展开重复核对。

## 二、①hand-off原子性——发现真实的逻辑不一致，非纯理论假设

**重新逐字读了`PayoutShard.absorb`现在的实际代码**（本会话早前已审过GREEN的那版本，这次专门针对这个
新问题重读）：
```
int owned_total = scanOwnedTokenInputs(tok_prefix, tok_suffix);
require(owned_total == consolidated_pool);
TokenState shardTk = readInputStateWithTemplate(shardInIdx, ...);
require(shardTk.amount == shard_amount);
```
`scanOwnedTokenInputs`内部的判据是`tk.owner == OpInputCovenantId(this.activeInputIndex)`——**这是比较
"该token自己编码的owner字段"跟"PS自己的真实covenant_id(self)"，不是比较token输入自己的裸covenant_id
声明**。absorb现有代码正文的注释原话："shard_amount尚属输家leaf, owner过滤天然排除, 是'合法在场不计入'
的正例"——**这句话成立的前提是：这一刻shard的token的`owner`字段还是shard自己的身份，不是PS的**。

**独立读了本次`07026eef`新落的`ShardLeaf.consolidate_to_payout`**：
```
validateOutputStateWithInputTemplate(tokenOutIdx, TokenState {
    amount: pool_value, owner: ps_cov, ...
}, tokenInIdx, ...);
```
**这一步把代币的owner字段直接改成了`ps_cov`（PayoutShard的真实covenant_id）**——commit message自己说
这是"独立两步（可能跨交易）"实现，即这个relabel在一笔交易里完成、独立于PS后续哪一次absorb调用。

**矛盾点**：如果这枚"owner已经是ps_cov"的token后来作为某一次absorb调用的`shardInIdx`输入被消费，
`scanOwnedTokenInputs`的**无条件全扫描**（`for`循环扫`tx.inputs`里所有"看起来像token"的输入，逐一判断
`tk.owner==self`）**会把它也算进`owned_total`**（因为它的owner字段已经等于self了）——这跟absorb自己的
"天然排除"假设直接矛盾。后果：`owned_total`会比`consolidated_pool`（PS自己在这次absorb调用之前的账本）
多出`shard_amount`这一份，`require(owned_total==consolidated_pool)`**在任何shard_amount>0的场景下几乎
必然失败**。

**独立尝试构造实证向量的结果（部分成功，不是完全确认，如实报告）**：我复用`V-absorb-1`（正常pass向量）
把shard输入的token owner字段从占位值改成PS自己的covenant_id，翻转expect逼出verbose——运行**确实FAIL**，
但失败点落在`readInputStateWithTemplate`调用本身（102行），不是我预期的`require(owned_total==
consolidated_pool)`那一行——这是因为我只手改了sigScript里的owner字节、没有同步重算对应的P2SH承诺哈希，
触发了模板哈希不匹配这个**无关的机制性失败**，不是证明了我的假设本身。**如实说明**：这次构造没有干净
地隔离出我想验证的那一个变量，是我的构造方法问题（需要完整recompile一个真实token实例才能干净测试），
不是"假设被推翻"。

**判断（基于代码逐字重读，不是纯猜测）**：这个矛盾**在逻辑上是真实的、有代码依据的**——absorb的
"天然排除"注释跟consolidate_to_payout的实际relabel行为直接冲突，即便我没能干净地用一条向量把它跑出来。
**后果判断为liveness问题不是资金安全问题**：`owned_total`只会因为这个矛盾变得"太大"（多算了已经relabel
的shard token），不会给攻击者制造出可以多拿钱的路径（token的真实归属仍然锁在ps_cov这个真实covenant上，
没有第三方能截走），最坏情况是absorb这条路径**从此对经由consolidate_to_payout来的shard永远调不通**
（transaction一律fail，代币冻结在这枚已经relabel成ps_cov但absorb消化不了的UTXO里）。

**给J2的修法方向建议**：两个可选方向，不代为拍定，留给J2/Bettor选：
1. **改`scanOwnedTokenInputs`让调用方能显式排除`shardInIdx`这一个位置**（加一个参数，扫描时跳过这个
   下标），这样即便它的owner已经是self，也不会被重复计入——absorb自己另外显式处理`shardInIdx`那一份。
2. **改`consolidate_to_payout`不要把owner直接改成`ps_cov`**，改成保留shard自己的身份，让PS的absorb
   在真正消化这笔token时才做owner relabel（回到"两个入口各自负责自己那一半"的原设计），这样absorb现有
   的"天然排除"假设继续成立，不需要改absorb。
- **不管选哪个方向，都需要补一条新的负向量，专门构造"shard token owner已经是ps_cov"这个场景，验证
  absorb不会双计——这条向量目前不存在（我尝试构造但受限于P2SH重算成本没能干净做成，这条工作量应该
  留给J2按真实token实例走一遍编译流程去做，不是我这边临时改字节能凑出来的）**。

## 三、②convert_to_rootclose的mass估算——J2的经验值系数在真实consensus公式里找不到依据

**独立读了`consensus/core/src/mass/mod.rs`（官方pinned源码，同一份`v2.0.1`标签树）**：
```
let compute_mass_for_size = size * self.mass_per_tx_byte;              // mod.rs:334
let transient_mass = size * TRANSIENT_BYTE_TO_MASS_FACTOR;              // mod.rs:358 (常量=4, constants.rs:30)
```
**compute mass和transient mass都是纯粹的"交易总字节数"线性函数，公式里完全没有"blake2b调用次数"或任何
其它opcode执行次数相关的项**——唯一跟"执行"相关的独立mass项是`mass_per_sig_op`（专指签名验证操作，不是
哈希调用），跟blake2b没有关系。

**J2的"×9经验值(double-blake2b)"在这份公式里找不到对应项**——按真实公式，16,715字节的witness对
compute mass的贡献就是`16,715 × mass_per_tx_byte(1) = 16,715`量级（外加交易里其它输入/输出的字节数），
对transient mass的贡献是`16,715 × 4 = 66,860`量级——**都比J2估的167,150低一个量级左右**，不是"差不多
但保守"，是**估算方法本身用了一个公式里不存在的乘数**。

**结论建议**：**mass可接受，不需要瘦身**，但**J2引用的167,150这个数字本身不该被当作真实依据继续沿用**
——建议实现脚本按§三这条更正后的公式（`size × mass_per_tx_byte` + `size × TRANSIENT_BYTE_TO_MASS_FACTOR`
+ 其它输出的`mass_per_script_pub_key_byte`项 + 真实sig_op数 × `mass_per_sig_op`）重新算一遍完整交易的
真实mass，同时（跟GO-F设计页已经要求的纪律一致）**广播前必须用真实`calculateTransactionMass`工具重新
核实，不能只信这份手算**——这条纪律本来就已经写进GO-F设计页，本次correction只是指出手算的中间过程本身
有一个不该用的乘数，不改变"必须实测"这条最终纪律。

## 四、给Bettor的处置建议

- **常规八点GREEN，代码本身没问题**。
- **①是一个真实的逻辑不一致，建议判MUST-FIX**：`absorb`的"天然排除"假设跟`consolidate_to_payout`的
  实际relabel行为矛盾，liveness风险（不是资金安全），需要J2按§二给的两个方向之一改，且补一条我这次
  没能干净构造出来的"owner已relabel的shard token"负向量。
- **②mass估算校正**：真实consensus公式没有blake2b执行次数这一项，J2的167,150高估了大约一个量级，
  真实mass数量级应该在compute≈16,715/transient≈66,860附近，都远低于post-Toccata的250,000字节
  sigScript硬顶和相应的block mass限额——**结论是可接受，不需要瘦身**，但估算方法本身需要更正，广播前
  仍按GO-F既有纪律用真实工具重算。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
