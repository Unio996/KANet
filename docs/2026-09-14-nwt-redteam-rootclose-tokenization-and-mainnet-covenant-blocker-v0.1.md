# NWT 红队复核 · RootClose代币化(`60307fc1`) + 主网covenant可行性核查（含自我更正）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only · v0.1内已含自我更正，非另发v0.2）
> Bettor 1190：①`e52cc887`注释同步；②`60307fc1` RootClose完整代币化；③体积评估(非安全,需判)。
> Bettor 1191：对本文档最初版本§三提出的两条"阻断"逐条纠正，均不成立，我已独立复核确认Bettor是对的，
> 本版本已更正，不是另发v0.2掩盖——原始错误判断的过程如实保留在§三，供以后同类核查参考。

## 结论：**①②GREEN，不变。③我最初的判断错了——两条"阻断"经Bettor指出+我自己独立复核，均不成立：
covenant在官方v2.0.1里确实存在且已在当前主网DAA下激活（字段名是`toccata_activation`不是我搜的
`covenants_activation`，我搜错了名字就下"这个概念不存在"的结论，是我自己的方法论错误）；
`max_signature_script_len`在Toccata激活后是250,000字节（ForkedParam的post值），不是我引用的
pre-Toccata 10,000字节，16,714字节的witness完全合法。唯一站得住的部分：本项目确实从未对真实主网节点
广播测试过一笔covenant交易，这条Bettor也认可，已立GO-F金丝雀验证补上。**

## 一、①`e52cc887` —— GREEN（不变）

diff只改了CloseZkV2/PayoutShardV2.sil两处ZERO32守卫的行内注释文字，0行逻辑代码改动，确认属实。

## 二、②`60307fc1`（RootClose完整代币化）—— 独立验证，GREEN（不变）

- **字节级重编译一致**（`bytecode_length=16802`，跟commit声称完全一致）。
- **24/24向量独立跑通**。
- **caret独立确认**（翻转expect逼出verbose，共查了3条关键负向量）：
  - `V-convert_to_claim-2`(裸输出ZERO32)：精确落在`require(claimCovId != ZERO32)`（199行）。
  - `V-convert_to_claim-4`(owner改道)：精确落在`validateOutputStateWithInputTemplate`（203行）。
  - `V-convert_to_claim-6`(多塞一笔归己代币不计入)：精确落在`require(owned_total == pool_value)`（190行）。
- **ZERO32守卫本身核实是PRE-EXISTING的**（`convert_to_claim`/`convert_to_refundclaim`的`!=ZERO32`早在
  更早的`rootclose-zero32-guard`那笔就已经加上，本次只是复用变量+接上新的代币输出转移逻辑）。
- **家族一致性**：B类/A类的形状跟PayoutShard/PayoutShardV2/CloseZkV2已审过的B/A类模式逐字一致。

**②GREEN定案。**

## 三、③——我的原始判断错误 + Bettor纠正 + 我的独立复核（如实记录整个过程）

### 3.1 我最初判断了什么、怎么错的

我最初读官方`v2.0.1`标签的`params.rs`时，**只grep了`covenants_activation`这一个具体字段名**（因为这是
本机D-补丁开发树里的字段名），0命中，就直接下结论"这个概念在官方v2.0.1里根本不存在"——**这是我自己的
方法论错误：搜不到一个具体拼写的字段名，不等于这个概念真的不存在，应该先搜更宽的关键词（比如单纯
"activation"）确认官方版本是不是换了个名字，而不是止步于第一次grep的0命中就下结论**。同理，我引用的
`max_signature_script_len: 10_000`那段注释，是这份`params.rs`里**两个ForkedParam值中较早那个（prior）**，
我没有意识到这是个随硬分叉变化的分段值，只读了第一个看到的数字就当成唯一/永久的硬顶。

### 3.2 Bettor的纠正 + 我的独立复核（自己重新查源码，不是照抄Bettor给的结论）

**逐条独立验证**（`git show v2.0.1:...`，同一份官方tag源码，这次搜对了关键词）：

1. **字段确实存在，只是叫`toccata_activation`**：`consensus/core/src/config/params.rs:269`（结构体字段
   声明）+ `:370`（trait关联类型）+ `:724`（`MAINNET_PARAMS.toccata_activation =
   ForkActivation::new(474_165_565)`）——**逐字核对，行号、字段名、数值都对**。
2. **covenant确实被这个字段直接控制启用**：`consensus/src/processes/transaction_validator/
   tx_validation_in_utxo_context.rs`里`check_scripts()`函数：`let covenants_enabled =
   self.toccata_activation.is_active(block_daa_score);`——**独立核对，逐字存在**，`check_covenant_info()`
   也有同款`is_active`判断门。
3. **当前主网DAA确实早已过了这个激活门限**：本会话此前（主网热钱包部署证据复核那一轮）我自己独立探测
   过kaspad daa，读数`539,111,623`——远超`474,165,565`这个激活阈值，**covenant在当前主网上已经激活
   多时**（这个数字我自己当时就查过，只是没想到要拿它去对`toccata_activation`这个门限，是这次才把
   两件事连起来看）。
4. **`max_signature_script_len`确认是ForkedParam，不是单一常量**：`params.rs:472-473`
   （`pub fn max_signature_script_len(&self) -> ForkedParam<usize> { ForkedParam::new(self
   .prior_max_signature_script_len, self.new_max_signature_script_len, self.toccata_activation) }`）+
   `constants.rs`（或同文件内）`PRIOR_MAX_SIGNATURE_SCRIPT_LEN = 10_000` / `NEW_MAX_SIGNATURE_SCRIPT_LEN
   = 250_000`——**独立核对，我引用的"10,000"确实只是pre-Toccata那一半，post-Toccata是250,000**，
   `16,714`字节的`rc_suffix`witness在250,000这个门限下完全合法，不构成任何阻断。

**结论：两条"阻断"均不成立，我最初的分析是错的，Bettor的纠正经我自己独立复核（不是照抄）确认属实。**

### 3.3 唯一站得住的部分——已被Bettor采纳，不需要我再做什么

我原文提到"本项目从未对真实主网节点广播测试过一笔covenant交易，端到端从未验证"——**这条Bettor明确
认可是对的**，已经据此立"GO-F主网covenant金丝雀"验证计划（用迁入的小额身份广播一笔dust级最小covenant
交易，验证节点真实接受+`OpCovenantId`语义），当前只写设计不广播，广播需Owner单独批。**T3落码与账号
迁移不因本次误判而阻断**——这条我之前建议"暂停"是基于错误的分析，不再成立，正常按队列推进。

## 四、给Bettor的处置建议

- `e52cc887`/`60307fc1`两笔GREEN，可以定案。
- ③的两条"阻断"撤回，如实记录在§三供以后同类核查参考——教训是"字段名搜不到不能直接下'概念不存在'
  的结论，要先搜更宽的关键词排除改名的可能"+"读到一个数值常量要先确认它是不是ForkedParam的一半"。
- GO-F金丝雀设计页到了我审。T3落码/迁移队列正常推进，不受本次影响。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
