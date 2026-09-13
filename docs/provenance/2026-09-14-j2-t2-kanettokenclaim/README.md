# KanetTokenClaim.sil — T2 §2 领取 covenant 落码

Bettor ledger 1136（KanetTokenClaim 有设计：T2 §2，状态四字段、一条入口）→ Owner 终端三问（ledger 1147，经
Bettor 转达）→ 本次落码。设计文档：`docs/2026-09-13-j2-t2-market-and-claim-covenant-a2-skeleton-v0.1.md` §2。

## 状态：五字段（§2.1 的三字段 + Q1(b) 追加 `token_tmpl_hash` + 本文件追加 `market_suffix_hash`）

| 字段 | 型 | 谁写 | 用途 |
|---|---|---|---|
| `market_cov_id` | byte[32] | 创建本 claim 的市场入口写 `OpInputCovenantId(this.activeInputIndex)`（P12 形） | provenance：这份领取来自哪个市场 |
| `winner_pk` | byte[32] | 市场入口从 payout merkle 叶取的 pk | 赢家身份（H4） |
| `amount` | int | 市场入口写的应得代币量 | 记账副本；真实持有量在一枚独立 KanetTestToken UTXO（owner=本 claim 自身 cov id） |
| `token_tmpl_hash` | byte[32] | 市场入口写（同市场自己状态里的这份值） | §3.3 形：witness 供代币模板前后缀字节现场核（不烤 ctor，避免"代币烤市场/claim 模板，市场/claim 又烤代币模板"的环） |
| `market_suffix_hash` | byte[32]（**本文件追加，回应角②**） | 创建本 claim 的市场入口写 `blake3(market_tmpl_suffix)` | `spend` 验证"转回市场再下注"目的地真是市场覆盖，不是假壳（见下） |

`spend`（唯一入口，`checkSig` 挪到函数末尾——纯可测试性考量，不影响最终判定：一个 entry 只有全部 `require`
都过才算通过，顺序不改变这一点；离线向量没有真实私钥，把 `checkSig` 放最后能让其余每条结构性检查独立验证，
不被"没有真签名"这一件事整体掩盖，同项目 `close_attest`/`cancel_attest` 委员签名向量已用过这个先例）。

## Owner 终端三问（ledger 1147）逐条回应

### ① 赢家 redeem 后代币去哪：这个 covenant 是什么、由谁在什么时刻创建

D-017 代币只许 covenant 持有——`spend` 提供**两条**合法目的地，二选一，由 `to_market_input` 标志区分：

- **(i) 转回市场再下注**（`to_market_input=true`）：目的地是**本笔交易里已经存在的一个市场输入**
  （`dest_idx` 指向 `tx.inputs`），代币新 owner = `OpInputCovenantId(dest_idx)`。这个市场 covenant **不是
  本次交易创建的**——它是赢家发起这笔"领取并再下注"交易时，选择在同一笔里花掉的一个已存在的市场实例
  （创建时机 = 那个市场自己的 genesis，跟本次 `spend` 无关；本次只是把代币的 owner 指向它）。
- **(ii) 转手/拆分到一个新建的领取 covenant**（`to_market_input=false`）：目的地是**本笔交易新建的一个
  输出**（`dest_idx` 指向 `tx.outputs`），代币新 owner = `OpOutputCovenantId(dest_idx)`。这是 T1 设计里
  "genesis 免权限"的直接应用——任何人都可以构造一个新的 KanetTestToken/KanetTokenClaim 实例作为 genesis，
  不需要代币合约或 claim 合约额外授权；**创建时机 = 本笔交易本身**，创建者 = 正在花费这个 claim 的赢家自己
  （他们决定把领到的钱转给谁、以什么形式存在）。

**两条路径都终结在某个 covenant，绝不落到裸 P2PK 地址**——`spend` 本身没有任何构造 P2PK 输出的代码路径，
唯一能设置的 `owner` 字段只能来自 `OpInputCovenantId`/`OpOutputCovenantId`，这两个原语的返回值定义上就是
"某个 covenant 的 id"，不存在"返回一个裸地址"的分支。

### ② claim 合约的 spend 入口怎么验证"这是合法的新 covenant、不是攻击者随手包一层的假壳"

这条对两条路径的处理**不对称**，是本文件的设计判断（写清楚，供 NWT 复核是否需要同等力度）：

- **(i) 转回市场**：**验**。`market_suffix_hash`（本文件追加字段）由创建本 claim 的市场在其创建时写入
  `blake3(market_tmpl_suffix)`；`spend` 的 witness 供 `market_suffix_witness`，先核 `blake3(...)==
  market_suffix_hash`，再核 `dest_idx` 那个输入的 `sigScript` 尾部确实等于这段验过的后缀字节——跟
  `KanetTestToken.sil` 的 `ownerIsMarketInput` 同一手法。**攻击者随手包一层的假壳**（一个自己控制、
  `sigScript` 尾部对不上真市场后缀的 covenant）在这一步被拒——`V-CLAIM-6` 向量已证。
- **(ii) 转手到新输出**：**不验**目的地"是不是真的某种覆盖类型"。理由：genesis 在 T1 设计里本来就是
  免权限的——任何人（包括赢家自己）本来就可以无条件构造一个新 KanetTestToken/KanetTokenClaim 实例，
  `owner` 字段只是记账用的 32 字节，不断言目的地合约的"类型"或"未来行为"。这条路径的风险模型是
  "赢家把自己的钱转去哪"，属于赢家自己的选择（同一笔交易需要赢家自己的 `checkSig` 才能发起），跟"攻击者
  冒充赢家把钱转去攻击者控制的地方"不是同一类攻击——后者已经被 `checkSig(s, winner_pk)` 挡死（没有赢家
  私钥就无法调用 `spend`）。**这不是"没想到"，是判断"赢家自己选目的地"和"验证目的地是真市场"是两件不同
  性质的事——请 NWT 复核这个不对称是否需要收紧**（例如要求新输出也必须是已知的 claim 模板，需要再加一个
  `claim_tmpl_hash` 字段和一次 blake3 验，结构上完全可行，只是本次判断没有必要）。

### ③ 若设计成"只改状态标记，代币不物理转移"，要论证这与"赢家真正拿到钱"的经济含义一致

本设计**不是**"只改状态标记"——`spend` 每次执行都会真实消费一枚 KanetTestToken UTXO（`tok_in_idx`）并
创建一枚新的、owner 字段被重新指向的 KanetTestToken UTXO（`tok_out_idx`），这是链上真实发生的 UTXO 消费与
创建，不是链下记账。"赢家真正拿到钱"体现在：`owner` 字段的语义就是"谁能在未来花费这枚代币"——`owner_scheme
0x04` 约束花费该代币时必须有 `owner` 字段声明的那个 covenant id 作为在场输入（T1 `OpInputCovenantId` 检查）;
一旦 `owner` 被 `spend` 改写为市场覆盖或赢家自己选的新覆盖，原来的 `KanetTokenClaim` 实例（本文件）**终态
消失**（没有续约），旧的支配关系（"这份钱归属这个 claim, 只有 winner_pk 能通过它动用"）被新的支配关系
（"这份钱归属新 owner, 未来由新 owner 的花费规则决定"）**替代**——这正是真实转移的语义，不是记账幻觉。

## 〇、NWT 1155/1158 MUST-FIX 修订（ZERO32 目的地守卫）

**发现（NWT 红队复核 22bf679a ③(ii)）**：`OpInputCovenantId`/`OpOutputCovenantId` 对未声明 `covenant_id`
的输入/输出回退 `ZERO_HASH`（rusty-kaspa `opcodes/mod.rs unwrap_or(ZERO_HASH)`，本文件用最小探针
`scratch/_t1v06_check/ZeroHashProbe.sil` 在**这个调试器自己的模型**里直接实证复现，不只是信引用）。
路径 (i)（转回市场）已有独立验证（`market_suffix_hash` 尾匹配）挡住假壳，但路径 (ii)（转手新输出，
`target_owner = OpOutputCovenantId(dest_idx)`）此前**没有**任何独立验证——`dest_idx` 随手指一个没声明
`covenant_id` 的裸输出，就能把 `target_owner` 写成全零，后果不是"转移失败"，而是代币变成任何在场检查对
全零恒真的攻击者都能花（NWT 1158 系统性扫查结论：这是全仓库唯一缺口，`T1 v0.6`/`PayoutShard.absorb` 引用的
都是 `this.activeInputIndex`，恒安全，不用改）。

**修**：`spend` 的 `else` 分支（`to_market_input=false`）里，`target_owner = OpOutputCovenantId(dest_idx);`
后立即加 `require(target_owner != byte[32](0x00...00));`（`KanetTokenClaim.sil` 行 86-90）。

**负向量 `V-CLAIM-8`**：`dest_idx` 指向一个裸输出（`{ value: 1 }`，未声明 `covenant_id`）——用交互式
调试器逐语句步进（8 步，见下）确认 `error: script ran, but verification failed` 的 caret 精确指在这条新加
的 `require` 表达式上，不是巧合地落在别的检查（例如后面的 `validateOutputStateWithInputTemplate`）：

```
→   85 |             target_owner = OpOutputCovenantId(dest_idx);
→   90 |             require(target_owner != byte[32](0x0000...0000));
(sdb) error: script ran, but verification failed
   |             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ verification failed here
```

## 向量（`run.log`，8/8 PASS，均用 flip-expect / 交互步进复核真实失败行）

| 向量 | 验证点 | 真实失败行 |
|---|---|---|
| `V-CLAIM-1` | 转回市场路径，结构全对 | 只在最后 `checkSig`（占位签名，无真实私钥，同项目既有惯例） |
| `V-CLAIM-2` | 转手新输出路径，结构全对 | 同上 |
| `V-CLAIM-3` | witness `tok_prefix` 错 | `blake3(...)==token_tmpl_hash` |
| `V-CLAIM-4` | witness `tok_suffix` 错 | 同上 |
| `V-CLAIM-5` | 被消费的代币不属于本 claim（偷一个恰好同笔在场的陌生代币） | `tk.owner == OpInputCovenantId(this.activeInputIndex)` |
| `V-CLAIM-6`（**Bettor 明确要求的"假壳 covenant 被拒"负向量**） | `dest_idx` 是攻击者控制、`sigScript` 尾部对不上真市场后缀的 covenant | `destSig.slice(...)==market_suffix_witness` |
| `V-CLAIM-7` | 输出代币金额被篡改（99≠100） | `validateOutputStateWithInputTemplate` |
| `V-CLAIM-8`（**NWT 1155/1158 MUST-FIX 负向量**） | 路径(ii) `dest_idx` 指向裸输出，`target_owner` 被算成 ZERO32 | 新加 `require(target_owner != ZERO32)`（交互步进逐行确认，见上） |

## 本文件不受 V-T-8 影响

`spend` 没有任何 `validateOutputState`（同合约自续约）调用——本 covenant 花后终态、不续约（§2.1"领取 UTXO
一次性"）。唯一的"读外部状态"（`readInputStateWithTemplate`）只跟 `validateOutputStateWithInputTemplate`
（同为"外部模板"一类）共存，这个组合已用 T1 v0.2 `MarketScanProbe.sil`（AB2/AB3）证过安全，不撞 V-T-8。

## 纠错记录（供追溯）

本文件的代币模板验证从一开始就采用"witness 供 `tok_prefix`/`tok_suffix` + `blake3` 现场核 `token_tmpl_hash`"
形（T2 §3.3 原文），**没有**重复 J2 早前在 `PayoutShard.sil` 上犯的"blake3 不是可调用内置函数"误判——那个
误判已在报告中纠正（ledger，`silverscript-lang/src/compiler/compile/expression/builtin.rs:33` 确认
`blake3` 是注册齐全的真实内置函数）；`PayoutShard.sil` 的 `scanOwnedTokenInputs`/`noTokenInput` 已按 Bettor
1151 裁定另开 commit 改回同一形式，不在本 commit 范围。
