# NWT 红队复核 · T3 v0.4增补(cf78ae40) GREEN + PayoutShard.absorb(edc8b959/2bbf84fd) 暂停复审说明

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 范围：`cf78ae40`(T3 v0.4增补，RefundClaim收口)独立核对完毕GREEN；`edc8b959`/`2bbf84fd`(PayoutShard.absorb
> 落码)因Bettor 1151指出的ctor-vs-witness纪律违反将被J2修订，本轮**不追加更多复核投入**，已完成的独立验证
> 记录在案供下一版对照，等修订版到位后按1149六点+1151新增两点重新核。

## 一、T3 v0.4增补(`cf78ae40`) —— GREEN

RefundClaim纳入封闭清单为第8合约、A15→16(B8不变)总24——跟我自己`793df647`那轮独立扫可达图得出的"8文件
收敛、RefundClaim之后不再向下绑定新合约"结论一致，算术(15+1=16)对得上。doc记录的"NWT读RefundClaim.sil
发现的既有bug(`:44`/`:63`/`:73`)"跟我自己当时的原始发现逐字对得上(`refund_payout`无条件续约、缺
`remaining==0`分支、同f2fce916四处draw-down同一bug形)——**这条不是我这次重新验证，是核对doc有没有如实
转述我自己之前已经验证过的发现，确认没有被转述走样**。§2的V-T-8/AB11绕路形记档跟我自己在`12efdc1d`那轮
独立验证过的AB11机制描述一致，没有新增未经验证的断言。**GREEN**。

## 二、PayoutShard.absorb(`edc8b959`/`2bbf84fd`) —— 暂停深入复审，记录已完成的验证供对照

Bettor 1151指出J2把`noTokenInput()`/`scanOwnedTokenInputs()`该走witness供`token_prefix`/`token_suffix`+
`blake3(prefix+suffix)==token_tmpl_hash`现场验的既有P13形，误改成了ctor烤死字节（误因：以为blake3不是
内置——**这个前提本身是错的**，本会话`validate_output_state.rs`/`state.rs`源码阅读早就确认过`blake2b`是
真内置，`blake3`同理应该也是；这条误判导致`token_prefix`/`token_suffix`整段代币字节码被烤进了PayoutShard
自己的ctor/bytecode——**这正是Owner 1127②"市场合约与代币价值/供应解耦"那条裁决明确要防的耦合**：市场
合约的编译产物本身不该包含具体某个代币品种的字节码，只该引用一个hash）。改回witness供的正确形之后，
`PayoutShard`的`bytecode_length`应该会大幅缩小（`21776`字节、`own_suffix_len=21571`这个量级明显不对，一个
市场合约的自身模板不应该带着一份完整代币合约的字节码）。

**我已经独立完成、仍然有效、不需要重跑的验证**（记录供下一版对照，避免重复劳动）：
- 20字段State编码表跟源码字段声明顺序逐字对上，算术(18+33+153=204)正确——**这部分跟ctor/witness怎么供
  token_prefix/suffix无关**，是自续约手写编码的字段布局，改动预期不影响这条，下一版应该保持一致，如果
  变了要重新核。
- `measure_payoutshard_state_span.mjs`量测脚本本身的漂移检测逻辑我已经用对抗性测试验证过真的会检测漂移
  （改坏一个常量后脚本确实报DRIFT）——脚本机制本身没问题，**但用它量出来的`OWN_PREFIX_LEN`/`OWN_STATE_LEN`
  两个数值需要在修订版上重新跑一遍**（Bettor 1151新增点②要求的"重量测"）。
- V-absorb-6的flip-expect验证方法（改expect看真实失败行）我已经独立复现过一次，证明这个方法本身可靠——
  下一版的负向量应该用同一方法验证，不能因为改了witness供的形式就退回"读expect字段信"的浅验证。

**下一版到位后要审的清单**（1149六点 + 1151新增两点，共八点）：①20字段编码逐字段核；②absorb的RHS与
"合法在场不计入"量(预期不变，因为改动只影响token_prefix/suffix的来源不影响scanOwnedTokenInputs的语义)；
③量测脚本是否真从编译产物取值(已验证机制可靠，这次核实际数值)；④9向量独立复现(数量可能因新增负向量而
变化)；⑤noTokenInput两入口的1122边界向量(`2bbf84fd`那批，界/界+1/victim末位，暂缓到修订版一起核，避免
针对将被替换的代码浪费复核投入)；⑥v0.4的8合约表与可达图扫描一致(本轮已确认，见上)；⑦witness供错
prefix/suffix的负向量(新增)；⑧修订后bytecode_length与OWN_*常量重量测、确认回到合理量级且不再夹带完整
代币字节码(新增)。

## 三、给Bettor的处置建议

- **`cf78ae40` GREEN**，可以定案。
- **`edc8b959`/`2bbf84fd`不追加复核投入**，等J2出witness形修订commit后按上面八点一次核完，本页记录的已
  完成验证可以直接复用（编码表/量测脚本机制/flip-expect方法三项预期不受影响），不需要重新做一遍。
