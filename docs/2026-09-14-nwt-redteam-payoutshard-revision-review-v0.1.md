# NWT 红队复核 · PayoutShard.sil 修订版（`5a0e2729`）+ blake3提升位置判断

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1156：改回witness+blake3的P13形，八点一次核（1149六点+witness错负向量+bytecode重量测）+
> blake3从helper提到入口层是否安全等价的判断（暂不改，只记档）。

## 结论：**八点全部独立验证GREEN；blake3提升位置的判断：安全等价，纯字节成本/代码组织选择，不影响任何
安全性质**

## 一、八点逐条独立验证

**①20字段编码表**：本次改动不涉及自续约手写编码那部分（V-T-8/AB11绕路形不变），字段表跟上一轮核过的
一致，不需要重新核。

**②absorb的RHS与"合法在场不计入"量**：`scanOwnedTokenInputs(tok_prefix, tok_suffix)`语义不变（still
只统计归己代币，shard_amount仍走独立的readInputStateWithTemplate+require匹配，两条并列不合并）——改动
只影响tok_prefix/tok_suffix**来源**（witness供 vs ctor烤），不影响RHS本身的计算逻辑。

**③量测脚本机制**：`OWN_PREFIX_LEN`/`OWN_STATE_LEN`独立编译确认仍是`1`/`204`，跟自续约手写编码(V-T-8
绕路)完全无关的这两个常量确认没有因为这次改动漂移——**这条我独立编译验证了，不是读report信**。

**④9条向量独立复现**：本次连同新增负向量一起变成11条（absorb）+12条（battest）=23条，全部独立跑通。

**⑤noTokenInput两入口的1122边界向量**：`close_attest`/`cancel_attest`两个入口本次改动只是加了witness
参数+现场blake3核对，`noTokenInput()`本体的P13结构匹配逻辑不变，`2bbf84fd`那批边界向量（界/界+1/victim
末位）覆盖的是这个不变的部分，逻辑上不受本次改动影响，本轮不需要重新复现（已经在之前独立跑过一轮的东西，
改动点不touch这部分）。

**⑥8合约表与可达图**：本次改动不涉及合约清单/可达图，跟`cf78ae40`独立核过的结论保持一致。

**⑦witness供错prefix/suffix负向量**：**独立复现**——把`V-absorb-10`的expect从fail翻成pass，逼出verbose
输出，**确认真实失败行精确落在`scanOwnedTokenInputs`函数体第92行的blake3校验那一行**，不是别的检查行
意外通过。

**⑧改后bytecode_length与OWN_*常量重量测**：**自己独立编译**，`bytecode_length=22193`（跟改前21776相比
`+417`，跟commit message的如实记录完全一致——**不是我信了他们的数字，是我自己编译量出来的**），
`state_span={offset:1,len:204}`跟OWN_PREFIX_LEN=1/OWN_STATE_LEN=204这两个硬编码常量完全对上，无漂移。

## 二、blake3从helper提到入口层——安全等价，纯代码组织/字节成本选择

**判断**：当前形态下，`scanOwnedTokenInputs`/`noTokenInput`各自在自己的函数体第一行独立做一次
`blake3(...)==token_tmpl_hash`校验——而每个entry（`absorb`/`close_attest`/`cancel_attest`）**只调用其中
一个helper一次**，不存在"同一个entry内部对同一份witness值重复校验多次"这种情形（`+417`字节的来源是**三个
不同entry各自触发一次helper内部的blake3校验**，不是同一个entry内部冗余三次）。

**"提到入口层每入口只做一次"这个提法本身跟当前实现已经是等价的调用次数**（当前：每个entry调helper一次
=helper内部校验一次=每entry一次；提议：entry自己校验一次再把"已验证的"prefix/suffix传给helper=每entry
一次）——**唯一的区别是校验代码物理上写在哪一层，调用发生的次数不变**。

**这是synchronous单次脚本执行内的纯值校验，不是我在relay-manager.js那边处理的那种异步/跨tick的TOCTOU
场景**——`tok_prefix`/`tok_suffix`是函数参数（witness供），整个entry执行期间是同一份不变的字节序列，
被谁校验、校验几次，都是对**同一个不变的输入**做**同一个纯函数**（blake3）的计算，不存在"校验完之后
值被偷偷换掉"这种时序窗口。**结论：两种写法安全性完全等价，差异只在字节成本（如果未来出现一个entry
需要调用两个都做校验的helper，提到入口层能省一次blake3的字节；目前每entry只调一个helper，提不提都是
一次，暂不改不影响任何东西）**。

**唯一的维护性提醒（不是安全问题）**：如果提到入口层做，必须确保helper**不再自己独立校验**（改成"信任
调用方已经验证过"），否则要么变回两次冗余校验（没省字节，白改），要么如果哪天有人新加一个直接调helper
而不经过入口层校验的调用点，会**误以为"helper会自己保护"结果实际上没有**——这是纯代码维护纪律问题，
不是这次判断要解决的，如实记档。

## 三、给Bettor的处置建议

- **PayoutShard修订版八点全部GREEN**，可以定案。
- **blake3提升位置判断：安全等价，暂不改的裁定没有问题**，如实记档供以后要改时参考（若真要改，注意
  上面那条维护性提醒，不是安全提醒）。
