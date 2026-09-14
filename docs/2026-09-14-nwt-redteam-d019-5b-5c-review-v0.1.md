# NWT 红队复核 · D-019第5b笔(`eafc7e91`)compilePayoutShardRedeem/ShardLeaf迁移 + 第5c笔(`a9f2d751`)启动自检

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1233：5b按1225四点审（schema向前兼容/fail-loud真throw/R-PS-FAMILY-DISPATCH白名单零新增/既有
> 测试）。Bettor 1234：5c三点——①FAIL是否真让创世/编译路径fail-closed(非只打日志)②日志无敏感信息
> ③index.js接入顺序对migrations无副作用。

## 结论：**5b四点+5c三点全部独立验证GREEN。5b：两个函数新ctor数组position-by-position跟对应.sil源码
声明顺序核对（25/12个位置全部精确对齐）；R-PS-FAMILY-DISPATCH全库lint独立跑0 errors+手工核对每个
grep命中（含一处bshard-close-transport.mjs的注释误判自查）；既有测试独立跑通"all checks passed"（含
perf测试的零spawn量化证据）。5c：独立functional test确认四种场景（跳过/PASS/FAIL/永不throw）全部符合
文档描述；确认该函数与真正的承重闸（compileSilV100内部断言）是完全独立、不interfere的两条路径，不存在
"启动FAIL后仍能编译"的缝，因为承重闸本身未被这次改动触碰、每次调用独立重新断言；日志内容核对只含本地
路径/sha256/合约名，无密钥凭据；index.js接入点是裸调用+丢弃返回值，对migrations零副作用。**

## 一、5b——四审点独立验证

### 1.1 schema向前兼容——position-by-position核对ctor，独立读.sil源码声明

`compilePayoutShardRedeem`新ctor（25个位置）跟`PayoutShard.sil`当前ctor声明顺序**逐一核对**：
poolMerkleRoot→predicate_commit→**token_tmpl_hash**→init_consolidated_pool→init_closed→
init_payoutRoot→w0..w16(17)→**claim_tmpl_hash→market_suffix_hash**——**完全对齐**，三个新字段精确落在
源码声明的对应位置（`token_tmpl_hash`插在第3位，另两个在末尾）。`compileShardLeafRedeem`新ctor（12个
位置）跟`ShardLeaf.sil`同样逐一核对：market_id→ps_tmpl_hash→shard_pool_id→seal_count→min_bet→
payout_cov_id→deadline→**token_tmpl_hash**→init_local_yes→init_local_no→init_count→
init_pool_value——**完全对齐**。这是本次复核里最高价值的检查（静默错位是最危险的一类bug，count对但
顺序错会编出语义错误但形状正常的产物），两个函数都一次核对成功，无位置错位。

### 1.2 fail-loud真throw——读代码+复用已验证的一致模式

两个函数体内新增的三个`/^[0-9a-fA-F]{64}$/`格式校验，跟`computeCloseZkTmplAnchor`/
`compilePayoutShardV2Redeem`（上一轮已functional-test过的同一模式）逐字一致的写法——不是新发明的
校验方式，是同一套已验证的纪律复用。

### 1.3 R-PS-FAMILY-DISPATCH白名单——独立全库lint+手工grep交叉核对

独立`git worktree`+`npm install`后跑`node scripts/lint-kanet.mjs`（全库无参扫描）：**956文件，0
errors**——包含这条ERROR级规则本身。另独立`grep`repo-wide`compilePayoutShard(V2)?Redeem(`全部命中，
逐一核对每个文件的分类：真实调用点（`pool-shard-register.mjs`/`bshard-payout-family-coherence.mjs`/
`bshard-auto-settler.mjs`/`bshard-settle-daemon.mjs`）全部在既有白名单里；`.test.mjs`文件（lint规则
本身豁免）；`bshard-close-transport.mjs`一处命中经核对是**纯注释提及**（"错调了compilePayoutShardRedeem"
这句话本身就是注释，不是代码）——**零新增调用点，白名单本身也未被这次改动修改**（`git show`确认
`scripts/lint-kanet.mjs`不在本commit的改动文件列表里）。

### 1.4 既有测试——独立执行，非信commit message转述

独立`node`直接运行两份测试文件：`bshard-payout-family-coherence.test.mjs`→**"✅ all checks passed"**
（含"hand-crafted fixture拒于(c)"这条断言——独立读了测试fixture的diff，确认`seedRow`默认填充**合法**
的32字节hex（`ee`/`ff`/`12`重复模式，跟其它marker互不相同），理由写得很清楚：如果不给合法值，"缺值
FAIL"跟"recompile不等FAIL"会返回同一个`failedStep='c'`，测试会**巧合通过但验的是错的东西**——这条
methodology本身经独立读代码确认落地正确）；`bshard-payout-coherence-perf.test.mjs`→**"✅ all checks
passed"**（含量化证据：200次早返回调用均摊0.0179ms/0.0138ms，远低于单次真实spawn校准值3.93ms的安全
边际0.393ms，独立跑出的数字跟commit描述一致，证明早返回路径确实零spawn）。

## 二、5c——三审点独立验证

### 2.1 ①FAIL是否真fail-closed某路径——独立读diff+functional test，确认无此风险

`checkSilvercPinAtStartup`内部`try{...}catch(e){...return{ok:false,error}}`——**任何异常都被吞掉转成
返回值，从不re-throw**。独立读了`compileSilV100`函数体（这次commit未touch这个函数一行），确认它仍然
在**每次调用自己内部**独立跑`assertSilvercV100Pinned`+`assertSilvercV100GoldenSample`，不依赖/不读取
`checkSilvercPinAtStartup`算出的任何缓存结果——**这两条路径完全独立，互不影响**：启动自检FAIL不会让
真正的编译闸松动，因为编译闸从来没有"信任启动时已经查过"这种捷径。独立functional test跑了4种场景
（跳过/生产二进制PASS/错二进制FAIL/不存在路径也不throw），全部跟文档描述一致，包括**FAIL时的具体
日志内容**（独立跑出真实错误文本，跟claim的格式一致）。**结论：不存在"启动FAIL后某路径仍能编译"这条
缝，因为压根没有依赖关系可以被绕过——调用时断言这句话准确，独立验证成立。**

### 2.2 ②日志不含敏感信息——独立读全部可能的错误文本

独立跑出的真实日志（见1.1的functional test输出）内容只包含：本地文件路径（`D:/silverscript/...exe`,
`D:\kanet-tn12\...\silverc-pin.json`——都是本地部署路径，非凭据）、sha256十六进制摘要、合约名
（`RootClaim`）——独立读了`assertSilvercV100Pinned`/`assertSilvercV100GoldenSample`两个被调函数的
**全部**throw语句原文（不是抽样），确认没有任何一处引用密钥/mnemonic/session token/API key等敏感
字段——这两个函数的参数只有一个`v100Path`字符串，物理上没有机会读到其它敏感env变量。黄金样本用的ctor
是固定的、写死在`silverc-pin.json`里的公开占位值（不涉及任何真实市场数据），即便编译器stderr被回显
也不会泄露超出repo本身已公开的内容。

### 2.3 ③index.js接入点顺序——独立读diff，裸调用零副作用

独立读了`index.js`diff：`checkSilvercPinAtStartup();`是一条**裸语句**（不接收返回值、不参与任何`if`
判断），插在`runMigrations()`之后——由于该函数本身`try/catch`包死不throw，且不碰`sqlite`/DB任何东西
（纯文件系统+子进程调用），这个位置对`runMigrations()`已经完成的迁移状态**没有任何读写交互**，顺序
本身也不影响该函数自己的行为（它不依赖DB已迁移到什么状态）——**零副作用，位置选择合理（migrations先
跑完，日志噪音不会跟迁移日志混在一起争夺注意力，是个好的编排选择，不是必须这样但确实更清晰）**。

## 三、给Bettor的处置建议

- **5b（`eafc7e91`）四点全部GREEN，可以确认**。
- **5c（`a9f2d751`）三点全部GREEN，可以确认**。
- 5b+5c均无新发现问题，可以按你说的进入D-019线联合合入（8笔）。合入后我可以按之前"主线lint+bytecode
  deep-equal"同款收口核方法，对这批新增的4个文件（compilePayoutShardRedeem/compileShardLeafRedeem
  相关调用链）做一次收口确认，如果你觉得有必要。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
