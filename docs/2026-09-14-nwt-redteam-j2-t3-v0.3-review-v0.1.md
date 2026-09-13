# NWT 红队复核 · T3 v0.3（全23入口落位表+边界纪律+双边对账+币解耦）+ T1 v0.6 + draw-down MUST-FIX

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 审对象：`coord/j2-t3-market-sil` 三笔 — `2a5c1eb0`(T1 v0.6 .sil)、`f2fce916`(四处draw-down MUST-FIX+v1.0.0迁移修)、
> `949dfc96`(T3 v0.3设计稿+MarketScanProbe3)。
> 方法：三份 provenance 全部独立提取+`sha256sum -c`+用已独立构建的 silverscript v1.0.0 工具链重新编译+`cli-debugger --run-all`
> 重跑；`git show <commit>:<path>`直接读被审代码，不读我本地工作树（**过程中一次撞到自己的方法论错误——先误读了本地
> 工作树的CloseZkV2.sil(在别的分支上,还是byte[34])当成被审版本,一度以为抓到一处f2fce916声称修了但没修的坑,
> `git merge-base --is-ancestor`一查发现f2fce916根本不在我本地分支祖先链里,及时改用`git show 949dfc96:<path>`
> 重新核实后确认byte[36]确实落了——这条不写进结论,但过程记下来,防下次犯同一个坑**。

## 结论：**GREEN，T1 v0.6 + draw-down MUST-FIX 落码质量扎实(独立复现零折扣)，T3 v0.3 设计稿三前提+Owner两条全部经得起独立核验；§7 迁移阻断经独立编译确认为真实存在，不是夸大——不阻塞本次(设计层)合入，但是 19 条入口实际落码前的硬性前提，必须先清**

## 一、T1 v0.6 `.sil`（`2a5c1eb0`）——独立复核 GREEN

`.sil`源码 diff（对比 v0.5 基座）：删 `ClaimState` struct + 三个 claim_tmpl_* ctor 参数、`transferPolicy` 的 (b) 路由
分支只剩 `recv_idx[j] >= 0` 一条（原 else 分支的 b-out 构造彻底删除）、`sum_in == sum_out` → `sum_in >= sum_out`——
**逐字对得上我批准的 v0.2 路由设计，没有夹带任何我没审过的改动**。独立编译产物字节级相同；`cli-debugger --run-all`
14 条向量独立复现：13 PASS + 1 谐波翻转臂正确 FAIL，跟 `run.log` 一致。**GREEN**。

## 二、四处 draw-down MUST-FIX + v1.0.0 迁移修（`f2fce916`）——独立复核 GREEN

19 个 provenance 文件 `sha256sum -c` 全 OK；独立编译 `PayoutShard.sil`/`PayoutShardV2.sil`/`RootClaim.sil`/
`PoolSideStub.sil`（用各自真实 ctor 参数）全部编译通过（`PoolSideStub` 产物字节级相同）；`cli-debugger --run-all`
独立跑三个 test.json，16/16 全部复现（`PayoutShard` 8/8、`PayoutShardV2` 4/4、`RootClaim` 4/4），跟 `run.log` 一致。
README 如实记录未覆盖项（merkle_index 越界等既有分支未重验、committee 签名验证只confirm编译未构造真实向量）——
**这条我认可是诚实的范围声明，不是藏起来的缺口**，负向量本身（金额错/续约缺失两类各4条 fail）已经提供了"harness不是
无脑放行"的证据，不强制要求额外的谐波翻转臂。**GREEN**。

## 三、T3 v0.3 设计稿（`949dfc96`）——逐条核验

### (a) 七合约封闭清单——PASS，独立扫描确认无遗漏

全仓 `find *.sil` 扫过一遍（排除 worktree/scratch 噪音后落在 `kasia-console/src/lib/`）——`PoolLeaf`/`PoolSpine`/
`PoolSide`/`WinningsPool_v1`/`PredictionEscrow*`/`FoldNode`/`OracleStake_v1` 等一批文件属于**旧 rolling/bshard
架构**（跟 D-013/D-017"rolling 跨节点=死路"是同一条线，不在本轮代币化范围），不该也没有被列进 7 合约表。
`RefundClaim.sil` 确实存在且**不在**表里——但稿子 §1 自己已经点名"是否在主网集未定案"，这是**自己声明的开放项**，
不是我发现了一个他们藏起来的漏项。**PASS**。

### (b1) 全23入口A/B落位表——PASS，独立重新计数吻合，1123数字口径纠正成立

不信文档自己的算术，自己重新数了一遍表格：A 类 = ShardLeaf(2)+ShardLeaf_direct(2)+PayoutShard(3)+PayoutShardV2(3)
+RootClose(2)+RootClaim(1)+CloseZkV2(2) = **15**；B 类 = PayoutShard(2)+PayoutShardV2(2)+RootClose(2)+CloseZkV2(2)
= **8**；合计 23，**无一行两列都不占**。跟 Bettor 1123 转述的"12条B类"确实不符——但稿子的口径是源表原文，1123是转述
误记，稿子的处置（如实记差异+说明裁定本身不受影响）是正确的处理方式，不需要回去改 Bettor 的裁定。**PASS**。

### (b2)/(c) max_ins_scan 边界纪律——PASS，我要求的两条边界戳点独立复现

取值依据 `max_tx_inputs=1000`（我 1122 自己钉的数）引用无误；等价安替代形（`require(len<=bound)`先拒超界+界与
循环深度共享同一常量）跟 1122 的裁决一致。**独立提取+编译+运行`MarketScanProbe3.sil`的全部9条向量**（4 bound +
3 notoken + 2 outbind），逐条读了 JSON 构造（不只读名字）：
- `V-bound-2`(界+1=9输入)验证了拦截点真的是`tx.inputs.length`本身（构造里塞的第9个输入内容本身若无长度闸也会
  通过其余检查，隔离出纯粹是长度闸挡的）；
- `V-bound-3`/`V-bound-4`验证了victim放在下标7(=界内最后一个可达位置)时循环真的展开到了那里(3号pass证明扫到了、
  4号fail证明"声明值不对"能被抓到，两条对照排除"循环提前截断导致巧合通过"这个假设)。
这正是我在1122-补要求的两个具体戳点，**独立编译独立跑，9/9与run.log一致**。**PASS**。

### (b3) B类负向量——PASS

`V-notoken-2`(夹带归己代币+no-op entry, fail)、`V-notoken-3`(同上但entry有真实状态变化, fail)独立复现一致——
第二条负向量确实排除了"entry靠什么都不干侧面绕开攻击"这个可能性(dummy_state_change参数存在且被require校验，
不是摆设)。**PASS**。

### Owner① 双边对账/输出侧派生绑定——PASS，独立验证攻击构造真实

读了`V-outbind-1`/`V-outbind-2`的完整JSON构造(不只读expect字段)：两条向量的输入侧**完全相同**(3笔各100共300，
declared_total=300，输入侧扫描逻辑本身正确无误)——**差异只在输出侧**：`V-outbind-1`输出covenant_id=`0x11..`(跟
active input的owner一致=自身)pass；`V-outbind-2`输出covenant_id=`0x99..`(陌生covenant，靠额外插入的input#4的
`authorizing_input`撑住这个新covenant的genesis合法性)fail。**这是一个真实、干净的"输入对上了，输出却被引到陌生
地址"构造**，独立编译独立跑确认被新加的`require(OpOutputCovenantId(selfOutIdx)==OpInputCovenantId(this.activeInputIndex))`
挡住。J2自己承认v0.2的探针"整个没有任何输出构造/校验，是真空白"——**这条承认是诚实的，不是文字游戏**，这次补的
纪律和证据我认可堵住了这个洞。**PASS**。

**追加检查（我自己排查的一个可能绕法，结果：不成立，不是新洞）**：`register_append`类入口"合法在场不计入"这条
豁免（bettor新下注的token因owner尚未变成本leaf而被scan天然排除）会不会被利用来悄悄夹带一笔"实际是victim已有
持仓、伪装成新下注"的代币？——推了一遍：**任何代币要被花掉都受它自己`transferPolicy`的H1(a)"owner在场"约束**，
victim的代币要花，victim自己的covenant必须也在场、跑它自己的入口，那个入口才是该为victim的代币负责扫描/放行
的地方，不是这个leaf的`register_append`——这条豁免只对"付款人自愿花自己的钱"这个场景成立，没有重开我原来的洞。

### Owner② 币种解耦——PASS，逐行核对无隐含依赖

自己过了一遍23行表格的RHS/输出绑定列——全部只引用`token_tmpl_hash`/`token_prefix`/`token_suffix`这几个ctor常量
和`OpInputCovenantId`/`OpOutputCovenantId`两个协议原语，**没有一行的安全性论证文字提到"反正免费/供应无限"这类
措辞**——跟T1合约本身"MODE_TEST_COIN只是编译期常量、H2/P1已钉死切态=改常量重编"的既有设计一致。**PASS**。

### D-018 引用——PASS

§6只引用不复述，跟我上一轮已核对无失真的D-018文本(`46818d08`)一致，没有在这里另起一套新论证制造两个版本的
风险。**PASS**。

### §7 迁移阻断——**独立编译确认为真实存在的硬性前提，不是夸大**

**没有信文档说"这三个文件编不过"就算了——自己拿`git show 949dfc96:<path>`提取七个文件的正确commit版本**（过程中
先误读了本地工作树的旧分支版本，`git merge-base --is-ancestor`发现f2fce916不在我分支祖先链里后改用`git show`
重新提取，见页首方法论记录），独立编译：
```
RootClose.sil / ShardLeaf.sil / ShardLeaf_direct.sil / CloseZkV2.sil → 全部 PARSE ERROR(entrypoint关键字,
  v1.0.0已改entry，连词法/语法层都过不去)
PayoutShard.sil / PayoutShardV2.sil / RootClaim.sil → 无parse错误，只在故意给空ctor时报"参数数量不match"
  (=parse+类型检查框架均已跑通，跟f2fce916验证过的真实ctor编译成功一致)
```
**结论：§7描述的阻断是真实的，不是保守估计或夸大**——四个文件里有三个连"合约本身长什么样"这一步编译器都读
不进去，"19条入口落码前必须先清"这句话不是流程套话，是当前工具链下的字面事实。三步消除计划(纯语法迁移→
补纪律→向量)本身范围声明清楚(第一步零逻辑改动、撞到需要判断的地方立即停下报备)，符合这个项目一贯的纪律。
**这条不阻塞本次(设计层)合入——本稿本身没有写这19条入口的.sil，只是设计层落位——但必须作为下一步落码前的硬性
前提写死，不能被后续汇报悄悄降级成"建议"**。

## 四、给 Bettor 的处置建议

- **T1 v0.6 GREEN，draw-down MUST-FIX GREEN，T3 v0.3设计稿三前提+Owner①②+D-018引用全部PASS**——可以按这份
  设计稿定案。
- **§7迁移阻断独立确认为真实存在**：RootClose/ShardLeaf/ShardLeaf_direct/CloseZkV2 四文件当前完全不能在
  v1.0.0工具链下编译entry body(前三个甚至连parse都过不去)——这是19条非draw-down入口落码前必须先做完的独立
  工作，不是可以并行/跳过的一步。
- 未发现新的攻击面；我自己排查了一个"register_append豁免会不会被滥用"的可能绕法，推演后判定不成立，记录在案
  供后续参考，不升级为发现。
- 下一步：J2按§7三步计划清完迁移阻断、19条入口逐条落码后，我会照本稿§2表格逐条核对(scanOwnedTokenInputs/
  noTokenInput+输出侧派生绑定两条都要占)，尤其盯多代币输入入口的RHS写法(§8向量计划已列为必做项)。
