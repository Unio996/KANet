# NWT 红队复核 · KanetTokenClaim.sil（`22bf679a`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 审对象：`22bf679a`，`docs/provenance/2026-09-14-j2-t2-kanettokenclaim/`。
> 方法：独立编译+7向量复现；**自己动手构造了一条J2没写的新对抗向量**（复用J2的`compileKTT`+ctorArgs工具函数，
> 不是凑巧编个新场景），针对Owner③(ii)那条不对称设计判断，直接读了pinned rusty-kaspa源码确认
> `OpInputCovenantId`/`OpOutputCovenantId`的ZERO_HASH兜底语义，再拿这份语义构造真实交易实测，不是纸面推理。

## 结论：**①②机制GREEN，独立复现无误；③(ii)那条不对称设计判断——我找到一个具体的、已实测确认的MUST-FIX：
`target_owner`可以被设成ZERO_HASH，产生的不是"目的地不可花"而是"这枚代币变成任何人都能花"，比Owner问题原话
预设的失效方向更严重；④market_suffix_hash的T4影响可控**

## 一、①独立编译+7向量复现——GREEN

编译产物字节级相同；`cli-debugger --run-all`独立跑7条向量全部复现，跟`run.log`一致。**额外验证了
V-CLAIM-1/V-CLAIM-2的flip-expect claim**（自己把expect从fail翻成pass，逼出verbose输出）：两条向量的真实
失败行都精确落在第100行`checkSig`，不是别的检查行意外通过——确认这两条"结构全对、只差签名"的向量不是假阳性。

## 二、③(i) 转回市场路径的假壳防御——GREEN

`market_suffix_hash`（本文件追加字段）+ witness供`market_suffix_witness`+现场blake3核对+`sigScript`尾匹配，
跟`KanetTestToken.ownerIsMarketInput`同一手法，`V-CLAIM-6`（Bettor明确要求的负向量）独立复现PASS，攻击者
自建的假壳covenant确实被拒。**这条不对称设计里"验的那一半"没有问题**。

## 三、③(ii) 转手新输出路径"不验"——**找到具体MUST-FIX，不是"设计判断留白"**

**先答Bettor的三个具体问题**：

**"新输出到底是什么模板、owner字段谁定、之后谁能花"**：机制上，`target_owner = OpOutputCovenantId(dest_idx)`
是一个**纯字段回显**（我直接读了pinned rusty-kaspa源码`crypto/txscript/src/opcodes/mod.rs`确认，`OpOutputCovenantId`
与`OpInputCovenantId`都是`....covenant_id.unwrap_or(ZERO_HASH)`——读该output/input自己声明的covenant字段，
**没声明就回ZERO_HASH**）。`owner`字段的值完全由交易构造者（理论上是赢家自己或代赢家操作的钱包软件）在
`dest_idx`那个输出上declare了什么决定——可以是一个真实covenant的id（合法、之后由那个covenant自己的规则
决定谁能花），**也可以什么都不declare（ZERO_HASH）**。

**"与D-017'代币只许covenant持有'是否一致"**：**在ZERO_HASH这个退化情形下，不一致**——ZERO_HASH不对应
任何真实covenant的身份，这不是"代币被某个covenant持有"，是"代币的owner字段被写成了'没有covenant'这个
哨兵值"，跟D-017的字面意思相悖。对"赢家选了一个真实存在的新covenant"这个正常情形，是一致的，没有问题。

**"不验目的地是用户风险还是协议风险（赢家被钓鱼签到不可花目的地算不算我们的问题）"——我实测确认，
Bettor原话预设的失效方向是错的，实际更严重**：我拿J2留的`compileKTT`工具函数**自己构造了一条新向量**
（`V-NWT-ZEROHASH_dest_has_no_covenant_field_owner_becomes_zerohash`）——`dest_idx`指向一个完全没有声明
`covenant_id`的裸输出，`tok_out_idx`处放一枚真实编译出的、owner=`ZERO_HASH`的KanetTestToken实例——**独立
编译独立跑，翻转expect逼出verbose输出，确认这笔交易的失败行精确落在第100行`checkSig`**，跟V-CLAIM-1/2
一模一样的失效形态——也就是说，**除了缺一个真实签名，这笔交易的其它每一步(模板验/在场验/输出绑定)都真的
通过了**。这证明：**当前代码没有任何东西挡住owner被写成ZERO_HASH这件事**。

而ZERO_HASH的后果**不是"目的地不可花"（钓鱼签到死地址那种直觉），是"目的地变成任何人都能花"**——因为
`OpInputCovenantId`对"没有声明covenant的输入"回的**也是同一个ZERO_HASH**（我读的是同一段源码同一个语义），
未来任何一笔交易只要塞一个普通、不带covenant的input（这是**绝大多数**Kaspa交易的常态，不需要特殊构造），
`transferPolicy`里"owner在场"那条检查（`OpInputCovenantId(...)==prev_states[i].owner`）就会对着ZERO_HASH
恒成立——**这枚代币变成谁都能捡走的东西，不是卡死不能动**。这条我判**MUST-FIX**：不是"用户自己的选择"，
是一个非直觉、代价为零就能堵住的协议层缺口——一般人凭直觉不会想到"忘了声明covenant"跟"这笔钱谁都能拿"是
同一件事，恰恰因为反直觉，才应该由合约本身挡，不该甩给"赢家自己的风险"。

**修法：不需要J2 README草案里的`claim_tmpl_hash`那套完整collar**——那会把"新输出必须是某种已知模板"这个
更强约束加上去，跟T1"genesis免权限"的设计精神冲突（赢家应该能自由选择任何新的合法covenant形态,不应该被
限定成"只能是已知几种模板之一"）。**只需要最小的一行**：`else`分支算出`target_owner`之后，加
`require(target_owner != byte[32](0x00...00));`（32字节全零）——这条只排除"什么都没声明"这个唯一没有任何
合法理由的退化值，不限制赢家选择任何真实covenant的自由。**这条修复成本为零、不影响任何现有7条向量的判定
（它们的target_owner都是非零的真实值），建议直接加，不需要另外论证。**

**这条判断不改变Bettor原问题的框架，只是纠正了预设的失效方向**：既不是"用户风险可以不管"，也不需要
"claim_tmpl_hash完整collar"，是中间一个精确、廉价、无副作用的最小防线。

## 四、③经济含义论证——PASS

README的论证（真实UTXO消费+创建，owner字段=未来花费授权，旧claim终态消失=支配关系被替代不是记账幻觉）
逻辑自洽，跟T1既有的owner_scheme/covenant语义一致，没有需要NWT纠正的地方。

## 五、④market_suffix_hash的T4影响——可控，非新增风险

这个字段由**创建本claim的市场入口**在创建那一刻写入`blake3(market_tmpl_suffix)`，**不进ctor**（README已
说明，跟`token_tmpl_hash`同一处理方式，避免ctor自指环）——这意味着它是**状态字段**，不是模板常量，
**不影响claim合约自身的template_hash稳定性**（ClaimStub既有的"三组ctor前后缀与hash同一"这条不变量不受
影响，因为这个字段的具体VALUE在不同claim实例之间可以不同，但claim合约的**代码结构**是稳定的，模板hash
比的是代码结构不是状态值）。**T4对照项**：这条只是多一个"由市场写入的状态字段"，跟已有的`market_cov_id`/
`winner_pk`/`amount`/`token_tmpl_hash`四个同类字段处理方式完全一致，不引入新的对照类别，T4创世核对时
按"市场入口正确写入了这五个字段"这一条既有检查项覆盖，不需要新增检查逻辑。

## 六、给Bettor的处置建议

- **①②GREEN**。
- **③(i) GREEN**。
- **③(ii) MUST-FIX**：加`require(target_owner != ZERO32)`（`else`分支内，`validateOutputStateWithInputTemplate`
  调用之前）——不是因为"应该跟(i)同等力度"，是因为独立实测证实当前代码会让owner=ZERO_HASH的代币变成任何人
  可花，这是一个具体、廉价可堵的协议层缺口，不是可以留给"赢家自己判断"的用户风险。不需要`claim_tmpl_hash`
  那套更重的方案。
- **③经济含义 PASS**。
- **④T4影响可控**，不引入新对照类别。
- 建议补一条负向量（`V-CLAIM-8`类，等修复落地后）：`dest_idx`指向裸输出（无covenant_id）应被新加的
  `require`挡住——我这次自己构造的对抗向量已经证明了缺口存在，修复后应该反过来验证同一构造被正确拒绝。
