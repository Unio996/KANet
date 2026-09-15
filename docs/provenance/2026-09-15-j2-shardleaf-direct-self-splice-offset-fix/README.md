# 账本1468: ShardLeaf_direct.register_append 自续约偏移计算根因修复

## 事故

Owner批准的闸3重试(账本1465修复合入后)，genesis成功上链，首笔下注`register_append`被主网节点
拒绝：`failed to verify the signature script: script ran, but verification failed`（共识层脚本
执行失败，非RPC格式层——零资金移动，prepared交易从未进mempool，种子UTXO/leaf UTXO均未花费）。

## 根因（用cli-debugger 3ed9733真实执行确认，非猜测）

`ShardLeaf_direct.sil`的`register_append`entry在自续约(self-continuation)校验里，需要从
`tx.inputs[this.activeInputIndex].sigScript`（本输入的完整签名脚本）里切出"当前redeem脚本的state
区前后两段字节"，再拼上新state重新哈希、比对新输出的scriptPubKey：

```
byte[] ownSig = tx.inputs[this.activeInputIndex].sigScript;
int ownLen = ownSig.length;
byte[] ownPrefix = ownSig.slice(0, OWN_PREFIX_LEN);              // 原代码：从字节0切
byte[] ownSuffix = ownSig.slice(OWN_PREFIX_LEN + OWN_STATE_LEN, ownLen);
```

`OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=36`是**裸编译redeem脚本自身**的state区偏移（与
`compileSilV100`返回的`state_layout.start/len`完全一致，已核对）。但`tx.inputs[i].sigScript`
读到的是**完整sigScript**：`action见证字节 ++ redeem脚本字节`（见
`proto-register-append-witness.mjs`头注"sigScript = action_bytes ++ pushdata(redeem_bytes)"）。
原代码直接从完整sigScript的字节0切——这只在action见证部分长度恰好为0时才是对的。

真实`register_append`的action见证（`ps_prefix`/`ps_suffix`/`tok_prefix`/`tok_suffix`等协议常量
见证值，尤其`tok_suffix`现在是几千字节的真实KanetTestToken模板）远大于0字节——账本1468实测某次
真实构造的action长度为**3164字节**。从字节0切出来的"prefix"/"suffix"因此落在action见证内部，跟
redeem脚本真实的state区毫无关系，链上校验100%必然失败。

**此前唯一一次cli-debugger通过的`V-register_append-1_pass_first_bet_zero_existing_pool`测试**
（`docs/provenance/2026-09-14-j2-t3-v03-shardleafdirect-tokenization/`）用的是代币化改造早期的
夹具，那时action见证很短（占位witness），巧合掩盖了这个偏移错误——D-020/代币化落地后真实action
变长，这份夹具从未跟着更新重跑，是这个bug第4次没被现有测试抓到的直接原因。

## 修复

`ShardLeaf_direct.sil`新增常量`OWN_REDEEM_LEN`（compileSilV100实测的裸编译产物字节数，同
`OWN_PREFIX_LEN`/`OWN_STATE_LEN`一样按"本文件实际编译产物量测得出"手法，ctor全是定宽byte[32]/int
字段不含变长参数，编译产物字节数不随ctor取值变化，稳定常量），先算出redeem脚本在完整sigScript里的
真实起点，再从那个起点算prefix/suffix：

```
int ownRedeemStart = ownLen - OWN_REDEEM_LEN;
byte[] ownPrefix = ownSig.slice(ownRedeemStart, ownRedeemStart + OWN_PREFIX_LEN);
byte[] ownSuffix = ownSig.slice(ownRedeemStart + OWN_PREFIX_LEN + OWN_STATE_LEN, ownLen);
```

修复过程中的一次自我纠错：第一版把`ownPrefix`写成`ownSig.slice(0, ownRedeemStart+OWN_PREFIX_LEN)`
（错误地把action字节也含进了prefix），用cli-debugger真实执行验证时仍然FAIL；用真实mainnet失败数据
手工独立重算blake2b（Node脚本，不信debugger的中间结果）后发现，正确公式应该只取redeem脚本自己的
`[0,1)`和`[37,end)`字节段（即相对redeem脚本自身，不含前面的action字节），据此改成上面`slice(
ownRedeemStart, ...)`的版本，再次验证与真实失败交易独立复算的hash逐字节一致，随后用全新合成场景
（见下）确认真实通过。

## 为什么现有测试连续4次没抓到（Bettor明确要求解释）

kaspa-wasm不导出任何本地脚本执行引擎（账本1465已核实：全部导出符号检索零命中`TxScriptEngine`/
`checkScripts`等），`calculateTransactionMass`只按字节数公式算mass、不执行脚本逻辑。这意味着
`proto-tx-assembly.mjs`/`proto-tx-assembly-register-append.test.mjs`等现有JS测试无论写多少条，
都**结构性地**无法验证"这笔真实构造出的交易，喂给真实silverscript VM执行`register_append`这条
covenant逻辑，到底会不会通过"——它们只能验证：
1. JS自己的内部一致性（构造出的值自己对不对得上自己，比如`assertImpliedFeeMatches`）；
2. relay侧`extractTxShape`/`validateFixedValueOutputs`这类"检查输出值形状/手续费"的浅层逻辑；

从未真正执行过`ShardLeaf_direct.sil`自己的`require()`链。唯一能在不广播的前提下真实执行到这一层
的工具是silverscript的`cli-debugger`（D-019同一个pin commit `3ed9733`），它内嵌了跟节点consensus
同一份`kaspa-txscript`（Cargo pin同一个rev）真实脚本引擎——但此前只有代币化改造**之前**用短占位见证
跑过一次`.test.json`夹具，代币化落地后witness变长这份夹具从未重新跑过，也没有任何机制提醒"这份夹具
过期了"。

## 修复验证（真实cli-debugger执行，非猜测）

`kasia-console/scripts/verify-shardleaf-direct-scripts.mjs`（本次新增，永久保留）：用
`proto-tx-assembly.mjs`/`proto-covenant-builder.mjs`的**真实生产函数**（不是重写一遍逻辑）构造
两种真实交易形状（首笔下注无held / 次笔下注有held），全部协议常量/合成随机值（D-021安全，零真实
账户数据），relay侧真签名，导出成`cli-debugger`认识的`.test.json`（直接喂我们真实产出的签名脚本
字节，不用debugger自己的witness构造器——测的是"我们真实产出的字节能不能过"，不是"debugger会不会
自己造出能过的字节"这种同义反复）：

```
CLI_DEBUGGER_PATH=<cli-debugger二进制路径> node scripts/verify-shardleaf-direct-scripts.mjs
```

本次运行结果（两种场景均PASS）：见 `verify-run.log`。

cli-debugger二进制不随本仓分发（silverscript独立仓库的构建产物）。本次验证用的二进制：从
`silverscript`仓库`3ed9733`标签（D-019 pin同一commit）新建worktree `D:/silverscript-debugger-3ed9733`
现场`cargo build --release -p cli-debugger`得到，供NWT/后续复核直接复用（不需重新构建）。

## 一并修复：relay侧replay守卫的covenant输入误报（Bettor③要求）

`kasia-relay/src/lib/transaction.mjs`的`replayPreparedTransactions`步骤③（重播前核对"外部输入是否
仍未花"）原来无差别把所有外部输入都拿去查**同一个**`senderAddress`的UTXO集——对纯钱包转账（外部
输入本就来自senderAddress自己）成立，但对covenant交易（leaf/held输入活在它们各自的P2SH covenant
地址，从来就不是senderAddress）是系统性误判：这类输入无论有没有被花过，永远不会出现在senderAddress
的UTXO集里，每次重播检查都会被误判`inputs_spent`→`ambiguous`。账本1468实测复现：市场genesis刚
落链、leaf从未被花过，却被判"no longer in sender UTXO set"（报文本身就在说一件不成立的事——它从来
没在过，不是"不再在"）。

修复：每个外部输入按它自己`utxo.scriptPublicKey`派生真实所在地址分别查询（逐地址单独调用
`getUtxosByAddresses`，不引入一次查多地址的新调用形态），不再假设"所有外部输入都来自同一个
senderAddress"。派生失败或没有`.utxo`字段时退回原有senderAddress语义，不改变纯转账场景的既有行为。

`kasia-relay/src/lib/covenant-roundtrip.test.mjs`原有一条注释明确记录了这是"已知边界"（"这是【本
函数的已知边界】：对多地址输入的交易，调用方须传senderAddress=含全部外部输入的地址集合(v2)"），
并在测试里用"把两个outpoint都塞进同一个fee地址集合模拟全部在"的方式绕开了这个限制——这次连同修复
一起改掉：测试现在真实区分fee地址和covenant P2SH地址两个独立UTXO集，新增两条账本1468回归向量
（真阳性：covenant输入真的被花→仍正确拒绝；真阴性：covenant输入只在它自己地址而不在fee地址→不再
误判，核心修复目标）。

## 残留数据处置建议（账本1468④，仅建议，不代为执行DB操作）

**该市场（a0c4d628…）的leaf是永久受影响的，无法通过这次代码修复恢复**：P2SH covenant地址=已编译
字节的哈希，修复改变了`register_append`的编译字节（增加了`OWN_REDEEM_LEN`常量及其运算），因此
**任何新市场genesis-mint出来的leaf都会是新地址**，但这个已经真实上链的市场的leaf，其P2SH地址已经
绑死在旧（有bug）的编译字节上——旧字节要求的自校验公式无法被任何"语义正确"的新续约输出satisfy（除非
故意构造一笔专门迎合旧bug公式的交易，那是一次性、脆弱、绕过合约本意的hack，价值(0.2 KAS dust +
测试代币，无真实经济价值)远低于构造与验证它的复杂度和风险，不建议）。

建议：
1. **放弃该市场的canary继续**，`proto_bet_intents`（ambiguous的那一行）和`proto_bets`
   （pending的那一行）标终态（不是删除——按现有status机制，若无"void/failed"这类终态值，需要先确认
   schema支持什么值；这一步涉及生产DB写入，按D-017§3执行门走：KANet-UI runbook → NWT审 → Owner
   终端单点GO，不是我或任何agent自行执行）。
2. **确认leaf(`fc802a14...:0`)和三枚种子UTXO均仍未花费**（Bettor已在派工消息里确认）后，用本次
   合入的修复重新走一次market_genesis铸一个全新市场（新leaf、新P2SH地址，用的是已修复的编译字节），
   继续闸3验证。
3. 前提确认：`proto_bet_intents`prepared字节确实永不可能上链（旧字节的txid已经在链上广播失败过一次，
   任何相同字节的重播都会命中同样的共识层脚本拒绝——这不是"暂时不行"，是"永远不行"，与Bettor原话
   一致）。

## D-021合规

本文档只写协议常量、字节偏移量、公开的.sil逻辑、合成/随机值——不含任何真实relay地址、真实账户余额、
真实bettor公钥、或完整的真实广播txid。诊断过程中读取过的真实mainnet数据（该市场的market_id/
bettor_pk/relay关联txid等）仅在本机内存/本地临时文件中处理，未写入任何提交物，诊断完成后已删除。

---

> 📌 **状态注记（2026-09-15 · J2 · 账本1469/1470/1471 · Bettor裁定 · 取代上方"修复"一节里的
> `OWN_REDEEM_LEN` 常量方案）**：上方"修复"一节写的 `OWN_REDEEM_LEN=14746` 是**第一版**修复，已被
> 证实不完整——**保留本节作为历史记录，不改原文，问题与订正如下**：
>
> **问题（J2 矩阵实测, NWT min_bet=20 独立复现证实）**：`OWN_REDEEM_LEN` 当时被当作"ctor 全是定宽
> byte[32]/int 字段, 编译产物字节数不随 ctor 取值变化, 是稳定常量"——这个假设是**错的**。用
> `compileSilV100` 对 `seal_count`/`min_bet`/四个 `init_*` state 字段分别扫
> `[0,1,15,16,17,255,256,65535,65536,2^31,2^32,2^40,-1,MAX_SAFE_INTEGER]` 实测：`local_yes`/
> `local_no`/`count`/`pool_value`（state 区, 运行期 `as byte[8]` 定宽转型）确实不影响编译产物长度；
> 但 `seal_count`/`min_bet`（纯 ctor 常量, 从不进 state 区, 直接被 `require()` 引用为字面量）的
> minimal-push 编码宽度会随 magnitude 跨界增长（最多 +14 字节）——同一份 `.sil` 源码换一组
> `seal_count`/`min_bet`, 真实 redeem 长度就不是 14746, 硬编码单一 constant 只对账本1468 金丝雀市场
> 那组极小值（seal_count=2, min_bet=1）成立, 换一个真实量级的市场就会再次触发同一类拒收。
>
> **方案取舍（Bettor 裁定）**：曾考虑"per-call 见证传长度"（register_append 调用时把长度当 witness
> 参数传入, 不烤进 ctor）——**被否决**：调用方可控长度 ⇒ 自续约切片可指向 action 见证内部任意位置
> ⇒ 攻击者只需同时构造一个匹配的续约输出 scriptPubKey, 就能让"同合约只改 state"这条 `require()`
> 通过一个实际上改写了合约逻辑的续约输出 ⇒ 可卷走 leaf 与其持有的 held KTT（真实资金损失, 不是理论
> 风险）。ctor 烤入方案由我方代码在 genesis 时一次性计算、写入不可变的 ctor 字段, 之后任何调用方都
> 无法覆盖, 不存在这个攻击面。
>
> **订正后的方案（已实现, 见 `ShardLeaf_direct.sil`/`proto-covenant-builder.mjs` 当前版本）**：
> 1. `OWN_REDEEM_LEN` 从 `.sil` 内部 `constant` 改成 ctor 参数 `own_redeem_len`（第13个字段）。
> 2. JS 侧新增 `convergeShardLeafOwnRedeemLen`：不动点收敛（编译→量长度→以此长度再编→直到长度不再
>    变化, ≤4轮不收敛则 throw, 起始猜测种子用14746 只影响收敛快慢不影响正确性）, 只在 genesis 时
>    调用一次, 结果连同其余 genesis artifacts 一起返回。
> 3. `proto_markets` 新增列 `shardleaf_own_redeem_len`（v209 迁移, 允许 NULL 无 DEFAULT, 同 K-18
>    纪律）, genesis 时写入, 是"一次性事实之后不变"的字段, 同 `shardleaf_cov_id`/`rootclose_tmpl_hash`
>    一类。
> 4. `computeShardLeafRedeemScript`（register_append 重建路径）新增必填参数 `ownRedeemLen`, 从
>    `proto_markets.shardleaf_own_redeem_len` 原样读回, **不重新猜/不重新收敛**——genesis 时的收敛
>    结果是唯一真值来源。
> 5. fail-closed 双闸：`convergeShardLeafOwnRedeemLen`（genesis 侧）与 `computeShardLeafRedeemScript`
>    （register_append 侧）都断言"真实编译出的长度 == ctor 里的 own_redeem_len"，不等即 throw 拒绝
>    返回——不会构造出一笔"看起来成功但链上必拒"的交易。
> 6. 回归覆盖：`verify-shardleaf-direct-scripts.mjs` 现跑 3 组 ctor 组合
>    `(seal_count=2,min_bet=1)`/`(seal_count=1000,min_bet=100000)`/`(seal_count=2,min_bet=2^40)`,
>    每组首笔（无held）+ 次笔（有held）都真实构造 → 真实签名 → 喂 `cli-debugger` 真执行, 共 6 次
>    PASS（见 `verify-run-1469-ctor-matrix.log`, own_redeem_len 分别收敛为 14746/14753/14752, 证明
>    确实随 ctor 变化）；`proto-covenant-builder.test.mjs` 新增 ctor 取值矩阵单测（14 组组合, 断言
>    收敛成功 + fail-closed 断言成立）+ fail-closed 真的会拦的负向测试。
>
> **ShardLeaf.sil（legacy, 铁律0.5冻结, 不改）同类缺陷记录（Bettor⑥要求）**：`ShardLeaf.sil` 的
> `OWN_PREFIX_LEN`/`OWN_STATE_LEN`/`ownSig.slice(0, ...)` 与本文件订正前的第一版缺陷模式逐字节相同
> （grep 确认存在于该文件, 未核实是否也有"长度随ctor变化"的同族问题, 因为不在本次修复范围, 该文件
> 不在proto-v0活路径上）——按铁律0.5不追加投入, 只记录, 不修复。
>
> **前瞻观察票（Bettor判, 不扩本次范围）T-PROTO-LEAF-ARTIFACT-VERSIONING**：NWT 独立证实"合约源码
> 一改, 旧市场的 P2SH 就与新代码脱钩"这一机制本身成立（P2SH = 编译字节的哈希, 任何字节变化都换地址），
> 但不改变旧市场（a0c4d628…）"已实现损失、任何修复都救不回"这个结论——旧市场锁死的根因是旧字节
> `register_append` 本身的偏移缺陷 + `convert_to_rootclose` 需要 `count == seal_count`, 不是"脱钩"
> 本身。真实前瞻风险是：未来合约再次修改时, 若届时已有活市场持仓, 需要一个版本一致性机制（genesis 时
> 落库合约源 commit + 编译 hash, builder 发现当前编译 hash 与链上 P2SH 不一致时 fail-closed 拒绝）。
> 触发条件：出现第二个活市场，或下次再修改 `ShardLeaf_direct.sil` 之前——原型 v0 目前无活市场, 本次
> 不实现, 只记录。
