# NWT 红队复核 · GO-F主网covenant金丝雀设计页(`a6169524`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1192：①KTT genesis天生不可花是否真触发官方节点covenant共识校验；②大witness金丝雀构造安全性/
> 成本；③p2sh.mjs复用路径是否真适用mainnet；④阻断前提"排在第2批之后"。

## 结论：**方向GREEN，可以照这个设计做。①的答案是"是，两层验证互不干扰"（细节见下，这条值得讲清楚
不是简单是/否）；②数量级估算方法正确且已自我约束"广播前重算"；③复用的具体函数(`unlockBshardGenesisMintPayout`)
本身网络参数处理是安全的，但顺手点名同文件里另一个真实存在的footgun供实现脚本注意；④阻断前提确认写清楚。
广播仍需Owner单独批，本次不涉及任何风险动作。**

## 一、①KTT genesis"天生不可花"是否真触发官方节点covenant共识校验——是，两层验证机制上互不干扰

**独立复核pinned`covenants.rs::CovenantsContext::from_tx()`（本会话此前已读过，这次重新对着这个具体
问题过一遍逻辑）**：consensus层对genesis covenant的校验(`WrongGenesisCovenantId`规则：
`expected_id = covenant_id(input.previous_outpoint, output_indices)`跟输出**声明**的covenant_id逐字
比对，不等则整笔交易**在consensus层直接拒绝**)——这条检查**只关心`output.covenant`这个字段的声明值
跟交易结构（花的是哪个outpoint、连带哪些output）是否算术一致，完全不解析、不关心scriptPubKey背后的
redeem脚本内容**（consensus不认识silverscript的State编码，`owner_scheme`/`owner`这些字段对consensus
而言只是"随便一段不透明字节"）。

**这意味着**：genesis输出只要正确声明了`covenant: Some(CovenantBinding{covenant_id, authorizing_input})`
且covenant_id算对了，**不论这个UTXO的scriptPubKey背后编码的State字段是不是"天生不可花"（`owner_scheme
≠0x04`），consensus层的`WrongGenesisCovenantId`全字节算术校验都会被完整触发**——这不是"绕过了真正的
校验，只做了一个表面动作"，是两个完全独立的层（consensus级covenant_id算术一致性 vs. 应用级silverscript
State字段语义）本来就互不干扰，"天生不可花"只影响**将来**有人想通过`transfer`入口花这个UTXO时会被
`require(owner_scheme==SCHEME_COVENANT_ID)`挡住，跟**这一次genesis创建交易本身**要不要经过完整的
consensus covenant校验，是两件不搭界的事。**GO-F这笔金丝雀确实测到了Bettor想测的东西，不是走过场。**

**"OpOutputCovenantId读回是否需要花费"——需要澄清两件事不是一件事**：
- `OpOutputCovenantId(idx)`是一个**脚本opcode**，只在**某笔交易的某个脚本执行时**被调用才会"跑"——
  GO-F这笔金丝雀范围内没有任何脚本执行这个opcode（genesis阶段不执行任何脚本，本页§2.1已经点明），
  所以严格说**这次金丝雀不会真的执行到这个opcode**。
- 但§3第3/4点验证方法（`getUtxosByAddresses`查`entry.covenantId`直接读UTXO持久化字段）**读的是同一个
  底层数据**——`OpOutputCovenantId`本身（本会话此前独立读源码确认过）就是对这个持久化字段的纯回显
  （`.unwrap_or(ZERO_HASH)`），不做任何额外变换。**验证"这个字段被consensus正确算出并持久化"跟验证
  "OpOutputCovenantId会不会读到这个值"是同一件事的两种访问路径（RPC查询 vs. 脚本opcode），不需要真的
  执行一次opcode才能确认后者会成立**——RPC查询已经充分验证了opcode将来会读到的东西。
- **结论**：设计页§3的验证方法是充分的，不需要为了"真的调一次OpOutputCovenantId"而额外设计一个花费
  场景（那会引入`transfer`入口和`V-T-6`已知坑，§2.1已经明确要避开）。

## 二、②大witness金丝雀（§2.3）—— 数量级方法正确，成本估算方法论已自我约束

`50,000字节 × mass_per_tx_byte(1) × MIN_SOMPI_PER_MASS(100 sompi/mass) = 5,000,000 sompi = 0.05 KAS`
——算术验算无误，落在设计页自称的"≤0.1 KAS"范围内。**设计页已经自己写明这是数量级判断，广播前必须用
真实`calculateTransactionMass`重新算一遍才能执行**——这条自我约束是对的，不需要我再加码要求，实现
脚本按这条纪律走就够了。

**构造安全性**：填充字节本身不涉及任何真实资金逻辑（只是撑大sigScript长度，纯粹测consensus层的字节数
上限），且这笔genesis同样是"天生不可花"设计（§2.2同款），跟第一笔金丝雀共享同一层"回滚不需要"的论证，
不需要独立再论证一遍。

## 三、③p2sh.mjs复用路径是否真适用主网——具体函数本身安全，但顺手点名同文件的一个真实footgun

**独立读了`unlockBshardGenesisMintPayout`（`p2sh.mjs:1865`）的完整实现**：`networkId`是从`args`显式
传入的参数（`const { wallet, cmd, networkId, lockTime = 0n } = args`），**没有默认值**，`connectRpc
(networkId)`按传入值连接——只要调用方明确传`networkId:'mainnet'`，这个函数本身的网络路由是安全的，
不会静默落到testnet-12。

**但同一份文件里确实存在Bettor该提防的那类坑**：`compileEscrow`（`p2sh.mjs:214`）等其它函数的
`networkId`参数**默认值是`'testnet-12'`**——这是本仓一个真实存在、本会话此前已经在别处撞过的模式
（"函数默认参数悄悄落到旧网"这类坑)。**建议**：实现脚本严格只复用`unlockBshardGenesisMintPayout`这
一个已确认安全的函数模式，如果为了拼装KTT专用的genesis交易需要参考/复用文件里其它helper，逐个检查
是否有`='testnet-12'`这类默认参数，不能假设"这个文件里的函数都安全"。

**mass计算的panic规避**：独立grep确认`p2sh.mjs:45`那条注释（"calculateTransactionMass在'testnet-12'
下任何tx形都panic"）确实存在于源码里，不是设计页凭空引用——这条bug本身只发生在`testnet-12`这个具体
networkId字符串下（`Params::from(NetworkId)`缺分支），mainnet走的是有分支的正常路径，设计页"mainnet
不受这个panic影响"的判断成立。

## 四、④阻断前提"排在第2批之后"——确认写清楚

§0.2明确写"GO-F的广播动作不能早于第2批验收通过"，且执行门分两层（设计批准≠广播批准，广播还要Owner
单独批）——跟本会话此前审批2执行页时确立的批次顺序纪律一致，没有跳步。

## 五、给Bettor的处置建议

- **设计方向GREEN，可以照这个做**。①的两层验证互不干扰这条讲清楚了，genesis天生不可花不影响这次
  金丝雀要验证的consensus级covenant_id校验。
- 实现脚本落码时提醒一句：只复用`unlockBshardGenesisMintPayout`这个已确认安全的模式，避免误用同文件
  里带`='testnet-12'`默认值的其它函数。
- §1.1的"删不删迁移账号"分歧点我认同设计页的立场（不删，迁移结果不该被验证动作撤销），这条留给
  Bettor/Owner最终确认，不需要我再补充论证。
- 无新发现的安全问题。广播动作本身仍需Owner单独批，我这边不做任何执行相关的动作。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
