# NWT 红队复核 · T3 v0.2（四处 MUST-FIX 落笔 + Codex 不变量）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`docs/2026-09-13-j2-t3-market-set-token-rewrite-design-v0.1.md` 提交 `ec28f980`（v0.2，§3.0/§3.0.1 新增，§6 裁定写入，§7 划项）。
> 历史卡单只读审计项：**Owner 直令（ledger 1061）撤销**——旧网一切冻结,不再提及,该审计的"5 笔真链核"不做、事故账不开、收尾候选作废,我不再对此判定,以下仅覆盖 T3 v0.2 本身。

## 结论：**T3 v0.2 PASS**——正确落地我的 MUST-FIX 与 Codex 的独立不变量,验收 HOLD 的姿态正确,不需要再开一轮

## 一、逐项核对

**§3.0(四处分支落笔)**：把 CloseZkV2 `claim`/`escape_claim` 的 `if (consolidated_pool == payout) {...不留续约...} else {...}` 原文摘出,逐条套到 `PayoutShard.claim`、`PayoutShard.refund_claim`、`PayoutShardV2.refund_claim`、`RootClaim.claim_draw` 四处——**核对每处的改写是否真的贴合各自合约自身的状态形,不是机械 find-replace**：`RootClaim.claim_draw` 的等价形写成"`pool_value == payout` ⇒ 不留 root 续约(`claimed_bitmap` 也随之终结)",这是对的——`claimed_bitmap` 这个 nullifier 的作用是防止同一个 slot 被重复 claim,一旦 covenant 实例整个终止(没有续约输出),就不存在"以后还有人能调用同一个实例的 `claim_draw`"这件事,`claimed_bitmap` 的终值不需要被任何地方读到,不留续约不会漏掉这个记账。`PayoutShardV2.refund_claim` 那行还主动引了同文件 `zk_handoff`(:398-399)"已有终态不续约先例"作对照——我核实过 `zk_handoff` 确实是无续约终态写法,这个类比成立,说明 J2 不是凑合套模板,是真的核对了同文件内部一致性。**absorb 类(只增不减)与 `RootClose.convert_*`(整池一次性搬走,没有续约这一步)保持不动**——上一轮我自己抽查过这两类不受影响,这版原样保留了这个边界,没有过度加固到不需要的地方。**PASS。**

**§3.0.1(Codex 不变量与向量集)**：不变量原文 `remaining==0⇒无续约;remaining>0⇒恰一续约且amount==remaining` 与 Codex `fff9bad2` 的英文原文逐句对应,没有走样。**"payout 计算器舍元归总额精确"这条引用我去核实了**——`kasia-console/src/services/pool-market-settler.js:1908` 确实是 `const winnerDustBI = poolToSplitBI - shareSumBI` 后 `if (i === 0) amtBI += winnerDustBI`(最小 `merkle_index` 赢家吸收余数)：这段代码的效果是"全部赢家的 `amount` 之和精确等于可分配总额,一分不多一分不少"——这直接证明了"某一笔 claim 恰好把 `consolidated_pool` 清零"不是一个概率极低的边缘输入,是**这套记账方式下必然会发生一次的事件**(总有一个赢家是"最后被扣完的那个")。**这条引用属实,不是编的说法**。

**五组向量集**：①单赢家全额、②多赢家最后一位、③全额退款、④非最后一笔部分领取/退款、⑤负向量(必拒,双向:清零时输出仍存在→拒;未清零时续约缺失或 amount 不等→拒)——**比 Codex 原文要求的"至少一条负向量"更严格**,把负向量拆成了双方向(不是只测"零时不该有输出",还测"非零时不该没有输出/金额不该错"),覆盖更完整。**PASS,不需要我再加向量。**

**§6 裁定写入**：核对与我上一轮的批准逐字对应——`DUST_MIN`(KAS `.value` 网络层)与 `amount>0`(代币合约状态层)两条并列写成"都要,不是二选一",没有被合并成一条丢失区分。**PASS。**

**§7 划项**：ZK journal 影响那条按我上一轮"源码确认 LOW"划掉,措辞准确("NWT 判 LOW"而不是含糊的"应该没事")。**PASS。**

**34→33 计数订正**：原文点名"RootClose:22 是注释行,v0.1 grep 误计"——与我上一轮的判断一致(我当时也是排除了这一行注释才数出 33)。**PASS。**

## 二、验收姿态——正确,不要在这一步就放行

文档自己写"**T3 .sil 实现验收 HOLD 至四处真落码 + diff/运行期向量审**",这个姿态是对的——**这版是设计稿的第二轮迭代,不是代码**。四处分支的文字描述再准确,也不能替代真正写出 `.sil`、编译、拿 `cli-debugger` 实际跑一遍五组向量(尤其负向量真的 fail、正向量真的 pass)。**我在此确认:这版文档本身没有问题,但"没有问题"指的是设计层面,不构成对实现的验收——下一次该看的是真实 `.sil` diff + 编译产物 + 运行期向量结果,不是又一版文档。**

## 三、给 Bettor 的处置建议

- **T3 v0.2 PASS**，MUST-FIX 与不变量都已正确落入设计稿,不需要再开一轮文档审。
- **下一审门槛**：J2 把四处分支写进真实 `.sil`（连同批 B/常量搬迁同一轮）后，我要看：diff（确认改动范围精确落在这四处 + 相关状态字段，没有顺手改别的）、编译产物（模板 hash 与其余不变字段保持稳定，参照 P12/P13 的方法）、`cli-debugger` 跑五组向量 × 四文件的实际输出（不接受"应该会 pass"这种自报，要看真输出）。
- T4 骨架、主网 console 起服务方案、三侧分支合并序——按 Owner 定的审序，到了我审。
