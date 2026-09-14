# NWT 红队复核 · D-019迁移三笔(`ac0b8427`/`387e296d`/`051af204`)——ZK生产调用点迁compileSilV100

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1225：五审点——①三处ctor新参数来源/默认值是否与T3 v0.4§2表/T4对照清单一致，能否被env误配；
> ②env缺失fail-loud是真throw；③死传参删除后computeCloseZkTmplAnchor第三参数语义；④29328B与provenance
> 交叉核；⑤盘点文档覆盖度。

## 结论：**五审点全部独立验证GREEN。①三个新ctor字段（token_tmpl_hash/claim_tmpl_hash/market_suffix_hash）
在两个核心函数里的ctor数组位置，逐一跟对应.sil源码的ctor declaration顺序position-by-position核对，
全部精确对齐（28/30个位置一个不差），来源是生产调用点的三个新env（无`||`fallback，缺失即throw，不存在
"能被env误配成一个看起来合理但错误的默认值"这条路径）。②真throw，读代码+此前对底层函数的功能测试双重
确认。③死传参语义解释准确，独立读diff确认。④独立functional test（真实生产pin+真实ctor）复现29328字节，
跟本session全程独立确认的PayoutShardV2 figure一致。⑤盘点文档覆盖度独立复核（含一次自我纠正：先用错了
搜索词导致一度以为有遗漏，换正确搜索词后确认覆盖准确）。**

## 一、①三个新ctor字段——position-by-position核对，来源确认无误配路径

独立读了`CloseZkV2.sil`/`PayoutShardV2.sil`当前源码的完整ctor declaration顺序，跟`computeCloseZkTmplAnchor`
（28个位置）、`compilePayoutShardV2Redeem`（30个位置）两个函数新ctor数组**逐一比对**：

- `computeCloseZkTmplAnchor`：gateTmplHash→betsRootBaked(dummy)→refundRootBaked(dummy)→attestedAtMs
  (dummy)→init_attestedWinner(dummy)→init_closed(dummy)→init_payoutRootField(dummy)→
  init_consolidated_pool(dummy)→w0..w16(17个dummy)→**token_tmpl_hash→claim_tmpl_hash→
  market_suffix_hash**——28个位置跟源码declaration**完全对齐**，三个新字段精确落在源码声明的最后三个
  位置。
- `compilePayoutShardV2Redeem`：poolMerkleRoot→predicate_commit→closeZkTmplAnchor→**token_tmpl_hash**→
  init_consolidated_pool→init_closed→init_payoutRoot→w0..w16(17)→init_attestedWinner→init_attestedAtMs→
  init_betsRootBaked→init_refundRootBaked→**claim_tmpl_hash→market_suffix_hash**——30个位置同样
  **完全对齐**，`token_tmpl_hash`精确插在`closeZkTmplAnchor`之后（源码里紧跟其后），另两个在末尾——
  这跟commit message描述的"插入位置精确对照当前源码ctor声明顺序"逐字属实，不是大概齐。

**来源与env误配风险**：独立读了`pool.js`/`bshard-close-transport.mjs`两处生产调用点的diff——三个新env
（`ZK_TOKEN_TMPL_HASH`/`ZK_CLAIM_TMPL_HASH`/`ZK_MARKET_SUFFIX_HASH`）**全部是`if (!process.env.X) throw`
的裸检查，没有任何`||`fallback默认值**，跟既有的`ZK_GATE_TMPL_HASH`/`ZK_CLOSEZK_SIL_PATH`两个字段的既有
纪律完全一致（同样没有fallback）。**这条确认了不存在"env漏配但悄悄吃到一个看起来合理但错误的默认值"这
条误配路径**——唯一可能的误配是"env设成了一个格式正确但语义错误的hex值"（比如设成了另一个市场的
token_tmpl_hash），这条不是env机制本身能挡的，是运营纪律问题（哪个环境变量对应哪个市场），不在这次
migration的授权范围内，如实记录不代为裁定。

## 二、②env fail-loud——独立确认真throw

`pool.js`两处、`bshard-close-transport.mjs`一处，三个新env检查全部是`throw new Error(...)`，跟同一函数
体内紧邻的既有`ZK_GATE_TMPL_HASH`检查用的是**完全相同的写法**（同一个`if (!process.env.X) throw`模式，
不是新引入一种更弱的检查方式）。独立在隔离worktree里对底层`computeCloseZkTmplAnchor`/
`compilePayoutShardV2Redeem`两个函数做了真实functional test——缺任一新字段（用`undefined`）**确认真的
throw**，报错信息清楚指名哪个字段缺失（"marketSuffixHash 必须是32B hex，收到undefined"），不是`console.
warn`打日志后继续跑。pool.js的`_resolveZkNativeCtorExtras`是模块内私有函数，本次没有单独spin up整个
server去触发它，但它调用的正是我已经functional test过的这两个函数，且写法跟已验证的既有pattern一致，
判断为足够的确认强度。

## 三、③死传参删除——独立读diff，语义解释准确

`computeCloseZkTmplAnchor`原来是2个具名参数`(closeZkSilPath, gateTmplHash)`，但`pool.js`旧代码调用时
传了3个位置参数（第3个是`silverc`，一个二进制路径字符串）——JS对多余的位置参数**静默忽略**（函数体内
从不读第3个形参），这是一个真实的"死传参"，独立确认属实。现在函数签名扩到6个具名参数
`(closeZkSilPath, gateTmplHash, tokenTmplHash, claimTmplHash, marketSuffixHash, v100Path)`，第3位变成
真参数`tokenTmplHash`——如果不删掉旧的死传参，`silverc`这个路径字符串会被塞进`tokenTmplHash`这个位置，
被函数内部的`/^[0-9a-fA-F]{64}$/`正则**拒绝**（fail-loud，不会静默算错），但报错信息会显得费解（"tokenTmplHash
必须是32B hex，收到'D:/silverscript/...'"——技术上准确但容易让人先去怀疑是不是传参顺序错了，而不是
"忘了删旧代码"）。J2已经删掉这处死传参，改传三个真实新字段——**独立确认这条改动本身正确，解释也准确**。

## 四、④29328字节——独立functional test复现，跟provenance交叉核对一致

独立`git worktree`到`051af204`，`npm install`后直接`import`两个真实函数，用真实的生产pin
（`silverc-v100-3ed9733.exe`）+真实（非dummy）的30参数ctor跑了一次`compilePayoutShardV2Redeem`：
**产出redeem字节长度=29328**——跟本session全程反复独立确认过的`PayoutShardV2.sil`真实bytecode长度
（T3 provenance/sink-check/pin-check等多轮独立复核都得到这同一个数字）完全一致。顺手也验证了
`computeCloseZkTmplAnchor`的anchor会随`tokenTmplHash`变化而变化（换一个字段值，anchor真的变了）——
反证了"这个字段是不是被悄悄当成占位符忽略"这条顾虑，确认它确实被烤进了编译产物。

## 五、⑤盘点文档覆盖度——独立复核，含一次自我纠正

独立`grep`全`kasia-console/src`+`kasia-relay/src`+`scripts`找`SILVERC_ZK`字符串，**第一次用错了搜索词**
（对`p2sh.mjs`/`verify-settle-sigs.mjs`两个"仅注释提及"文件搜的是`SILVERC_ZK`而不是文档实际声称的
`computeCloseZkTmplAnchor`），一度以为盘点文档漏了这两处——换成文档实际描述的搜索词（`computeCloseZkTmplAnchor`）
重新核对，确认两处都确实只是**描述性注释**（p2sh.mjs讲的是"anchor怎么用"，verify-settle-sigs.mjs讲的是
"round-trip自证同款纪律"），**没有实际编译调用**，跟盘点表的分类完全一致——**这次自我纠正记在这里，
不是文档有问题，是我自己第一遍搜索词选错了**。3个真实调用点（`computeCloseZkTmplAnchor`/
`compilePayoutShardV2Redeem`/`compileCloseZkV2Redeem`）+2个生产调用点（`pool.js`/`bshard-close-
transport.mjs`）全部已迁移，跟盘点表逐条对得上。§2.1（offset漂移，已交1224另裁）+§2.2
（`compilePayoutShardRedeem`/`compileShardLeafRedeem`同类缺陷未修）两处如实记录的"范围之外发现"独立
核对属实，不是为了让本次范围显得干净而藏起来的问题。

## 六、给Bettor的处置建议

- **五审点全部GREEN，`ac0b8427`/`387e296d`/`051af204`三笔可以确认**。
- §2.2点名的`compilePayoutShardRedeem`/`compileShardLeafRedeem`同类缺陷——已在1227预告的第5笔范围内，
  到时按同等强度审。
- 无新发现问题。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
