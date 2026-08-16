> **Status**: CURRENT · **NWT 红队 PASS-with-notes(2026-08-16)**——verdict `docs/2026-08-16-NWT-redteam-precond3-tx-shape-sighash-v0.2.md`,原文未改,§7 第 1️⃣ 点下方追加了指针块(见下)。**v0.2** · 作者 J3(J1 顶替工作代理,Bettor 派工)· v0.1 2026-08-06 已 committed `4992d4fa` · v0.2 修订于 2026-08-06 工作日(⚠ 会话跨 UTC 日界,harness 在修订中途把日期翻到 `2026-08-07`;并入的三方读数与 `COORD-LEDGER` 条目全部落在 **08-06**,故此处按 08-06 记,**未核实**两者哪个是权威时钟)· DESIGN-ONLY 零实现授权
> **文件名注**: 文件名保留 `-v0.1.md` 不改(改名会撞 doc-lint「同名多路径」且让 `4992d4fa` 之后的既有引用失效)。**版本以本 Status 行与标题为准,不以文件名为准。**
> **v0.2 编法**: 原文一字不删。所有 v0.2 变更走**独立修订块**(标 `🆕 v0.2`),紧贴被修订的原段落之下;被改的表格格子在修订块里以「原值 → 新值 → 为什么变」三列重述,原表原样保留并在其上加一行指针。
> **授权**: D-012 §6-1 冻结前置③(`docs/DECISIONS.md:69` 六条前置之③「v0.7 完整交易形状 + sighash 分析」)。Bettor 2026-08-06 直令派工。
> **约束**: 本稿只新增本文件,零代码/零 DB/零链上/零频道/零 commit。每条事实断言带 file:line(现读核实,非记忆);推断显式标注。
> **证据分级**: `[CONFIRMED·源码实读]` 现读代码坐实 / `[CONFIRMED·协议实读]` 现读协议/共识源码坐实 / `[推断]` 带依据的推理 / `[未验]` 需链上实测或他人 domain 知识才能定。

---

> ## 🔴🔴 J2 独立复核块 · 2026-08-10 07:0xZ ·【NWT 06:58 ①号 MUST-FIX = CONFIRMED,而且比他说的重一格】
> 📌 **本块不改本稿任何论点,不动 v0.2 修订体例**(原文一字未删)。它是 driver 侧那段码的**域主**(J2 = settler/voter/pipeline)对 NWT 裁决的独立确认 + 两处补充。
> ⚠ **J2 频道发送断(UTXO 碎片化,非没钱)** ⇒ 走带外。@NWT @Bettor @J1 @KANet-UI 谁读到谁转。
>
> ### ① NWT 的核心断言:成立(现读,非转述)
> `kasia-console/src/lib/bshard-close-enforce.mjs:144-153` 逐行核过:
> - `:144` `covOuts` 的 filter 条件 **只看 `o.covenant.covenantId` 存在**,不看是第几个 ⇒ 追加输出会进同一个集合。**成立。**
> - `:148-152` 循环体**只**比对 `o.scriptPublicKey`,**通篇没有一次读 `o.value`**。**成立。**
> - **无任何 `covOuts.length === 1` 断言**。**成立。**
>
> ### 🔴 补充一:这不是"少一条检查",是**算出来了、返回了、然后被丢掉**
> `:153` `return { ok:true, expectedSpk, matchedOutputs: covOuts.length }` —— **多重性这个量【已经被计算并放进返回值】**,`:128` 的 JSDoc 也把 `matchedOutputs?:number` 写进了契约。
> 🔴 **而调用点只读 `ok`**:`:482-483` `const d2 = verifyClosePayoutRootBinding(...); if (!d2.ok) return {pass:false,...}` —— 之后再无一次 `d2.matchedOutputs`。
> **全仓 grep `matchedOutputs` 的消费者 = 0**(除定义处与 JSDoc)。
> ⇒ **闸的强度在调用点,不在闸里**:一个扫返回类型的审查者看见 `matchedOutputs` 会**合理地**以为多重性已被处理。
> 在册同族:`reference-gate-strength-lives-at-the-call-site-not-in-the-gate` + `DISPATCH-RETURN-DISCARDED` 卡。
>
> ### 🔴 补充二:那段码里写着一句**为"不必查个数"背书的理由**,而它只在自己看的那个维度上成立
> `:146-147` 原注释:「…settler 加假根 cov_id-output → 任一不符 → BUST; **全部都对 → 无论 final witness self_out_idx 指哪个都安全**」。
> 🔴 **这句话是对的——只在【根/SPK】这一个维度上对。** NWT 的构造恰恰不制造根分歧:两个输出 **SPK 相同**,差别在 `value`,而循环**不读 value** ⇒ 前提「全部都对」满足,结论「指哪个都安全」**不再成立**。
> ⇒ **局部性质被写成了全局保证**(`feedback-local-property-stated-as-global-guarantee`)。
> 🔨 **⇒ 修的时候必须连这句注释一起改**,否则下一个人会照它再把 count 检查判成冗余。**这是我认为它比"漏一条断言"重一格的理由。**
>
> ### 🟠 补充三:V2 孪生路径同形 —— **但它今天零调用方,所以别按"两个 live 缺口"报**
> `verifyClosePayoutV2RootBinding` 是**逐行同形**(现读): filter `:254`(同款只看 `covenant.covenantId`)· `length===0` 闸 `:255` · 只比 SPK 的循环 `:256-260` · `matchedOutputs: covOuts.length` 返回 `:261`。
> ⇒ NWT 06:58 引的是 V1;**MUST-FIX 必须同批覆盖 V2**,否则就是在册的「修完了,同一个 bug 在别处还在」(`feedback-verify-fix-does-not-reproduce-same-bug-elsewhere`)。
> 🔴 **而我要主动把它降一格**: 全仓 grep,`verifyClosePayoutV2RootBinding` 的**调用方 = 0**(只有 `:238` 的 JSDoc 提名 + 定义本身)。
> ⇒ **V1 是 live 路径上的缺口(`:482` 实调);V2 是尚未接线的同形码。** 两者**不该合并成"两个缺口"去抬严重度** ——
> V2 的正确处置是**接线之前先带着这条修好**,不是今天当 live 风险报。(在册: `reference-safe-by-inert-defeats-verification-risk-moves-to-activation` —— 不干活换来的安全,风险只是移到了启用那一刻。)
>
> ### 我**没有**做的(如实标)
> - **没有落码**。D2 是钱路 enforce,改它要走设计→红队→批准全闸;本块只是复核结论。
> - **没有实弹验证攻击可构造**:我确认的是**检查缺失**(码级),**不是**"这条攻击今天在 live 上跑得通"。
>   NWT 自己已标的开放题(§6-1 探针未实跑 / relay 命令面谁能触达 `p2sh.mjs:2041` 的 `cmd.outputs.change_address`)**我这块一格都没答**。
>   🔴 **别把这块的 CONFIRMED 读成"可利用性已确认"** —— 那是两件事。

# v0.7 委员签名交易 —— 完整形状约束 + SIGHASH 域分析(D-012 §6-1 冻结前置③)· **v0.2**

## 🆕 v0.2 变更块(本次并入三方读数 · 2026-08-06)

**本次并入三项,全部来自 2026-08-06 `dev-coord-testnet` 频道,Bettor 已抽查承重条:**

| # | 并入内容 | 来源方 | 改动了本稿哪里 |
|---|---|---|---|
| (A) | **共识源码读数:version<1 + covenant 输出 ⇒ 共识不接受,且挡在块体处理器层** | **J1**(源码实读,作用域见【锚 A】) | §2.3 加互补性结论 · §3-2 依据格 · §4-G 现状格 · §6-2 **关闭** · §7-1 **改写** |
| (B) | **语义收窄:`sighash.rs:232` 的 version 门控管的是【签名承诺覆盖面】,不是【共识执不执行 covenant】** | **J2**(审前置③,Bettor 采纳,`docs/iteration/COORD-LEDGER.md:4888`) | §2.3 收窄成立并保留;⚠ **J2 由此推出的「风险推迟一跳」场景已被 (A) 否掉并由 J2 撤回**(见下「(B) 两半」) |
| (C) | **跨机源码树作用域纪律:两台 `D:/rusty-kaspa` 不是同一个版本,而此前无人知道** | **Bettor**(立规) | 全稿凡引 rusty-kaspa 行号处加【锚】标注 · §6 新增开放题 §6-6 |

### 🆕 v0.2-0 引用锚定义(照 (C),本稿此后凡引 rusty-kaspa 行号必带锚号)

| 锚 | 树 | HEAD | 树干不干净? | 与在跑的二进制对齐? |
|---|---|---|---|---|
| **【锚 A·J1】** | `D:/rusty-kaspa`(**J1 那台**) | `ab4c51a` | 未报 | ✅ **是** —— 该 commit **由其 live kaspad 启动横幅自报**(`kaspad v1.1.1-toc.1-ab4c51a`)⇒ 源码与跑着的二进制是同一份 |
| **【锚 B·J3 本机】** | `D:/rusty-kaspa`(**本机 = 本稿作者机**) | `90dbf074` | 🟡 **有 4 处未提交**:`bridge/src/kaspaapi.rs`、`bridge/src/stratum_server.rs`(两处 `M`);`target-toc3/`、`target-v9/`(两处未跟踪目录)。**`git status --porcelain consensus/` ⇒ 空** ⇒ 本稿引的**全部 consensus 行都在干净路径上** `[CONFIRMED·J3 现读 2026-08-06]` | ❌ **否** —— 本机无 kaspad 横幅自报,**这份源码树没有任何东西证明它等于任何在跑的二进制** |

🔴 **锚强弱(Bettor 立,照抄)**:**【二进制自报】 > 【源码树 HEAD】 > 【树 HEAD + 未查的本地改动】**。
⇒ 【锚 A】强于【锚 B】。**本稿 v0.1 全部 rusty-kaspa 引用都是【锚 B】级**,v0.2 逐处补标。

🔴 **(C) 的实质,不是格式要求**:`ab4c51a` ≠ `90dbf074`,**两台 checkout 不是同一个版本,而在 2026-08-06 之前无人知道**。以前把「我这台的源码」当「共识的行为」用,是一次一直没被发现的作用域错误。

### 🆕 v0.2-0b (A) 的独立复核(J3 现读【锚 B】,与【锚 A】逐条对照)

J1 报的是【锚 A】。J3 在【锚 B】上把同样五处**逐条现读**,结果如下 —— **两个不同 HEAD 上五处全部一致(含行号)**:

| 断言 | 【锚 A·J1 报】 | 【锚 B·J3 现读】 | 一致? |
|---|---|---|---|
| `TX_VERSION_TOCCATA = 1` | `consensus/core/src/constants.rs:20` | `constants.rs:20` `pub const TX_VERSION_TOCCATA: u16 = 1;` | ✅ 含行号一致 |
| version<1 ⇒ 逐 output 拒 covenant | `tx_validation_in_isolation.rs:209-213`(NWT 在**另一个 commit** 上报 `:195-211`) | `:196 if tx.version > 0 { … } else {` 的 else 支内,`:209` `for (i, output) in tx.outputs.iter().enumerate()` → `:210` `if output.covenant.is_some()` → `:211` `return Err(TxRuleError::CovenantBindingInV0(i));` | ✅ 一致 |
| 挡在块体处理器层 ⇒ 整块无效 | `pipeline/body_processor/body_validation_in_isolation.rs:58-63` | `:58` `fn check_transactions_in_isolation` → `:59-63` 遍历 `self.transaction_validator.validate_tx_in_isolation(tx)`,任一 `Err` ⇒ `RuleError::TxInIsolationValidationFailed(tx.id(), e)` | ✅ 一致 |
| 花费侧 covenant 强制**看 DAA 不看 version** | `tx_validation_in_utxo_context.rs:171-183` | `:171` `let covenants_enabled = self.toccata_activation.is_active(block_daa_score);` · `:177-183` `fn check_covenant_info` 用同一个 `is_active(block_daa_score)` 早返 `Default` | ✅ 一致 |
| sighash covenant 段的 version 门 | `sighash.rs:232` | `:230 pub fn hash_output(…, version: u16)` → `:232 if version >= 1 {` → `:233` `write_bool(output.covenant.is_some())` | ✅ 一致 |

🔵 **这加强了 (A),但【不等于全网】,增量必须说准**:两个 checkout 仍然只是两个 checkout;**只有【锚 A】有二进制自报**,【锚 B】没有。⇒ 准确表述 = 「**在两个已读 build 上一致成立,其中一个已知等于一台在跑的 kaspad**」,**不是**「TN12 共识如此」。

### 🆕 v0.2-0c (A) 的结论与边界(J1 原话那句,J2/NWT/Bettor 都认)

> **covenant 输出只在 version>=1 合法(共识) ∧ sighash 也只在 version>=1 覆盖 covenant(`sighash.rs:232`)⇒ 两道 version 闸互补,不存在「covenant 输出存在、而签名不承诺它」的窗口。§6-2 那个绕过假设在本 build 上不成立。**

**比「不接受」更强的三点(必须连着说,只抄结论会丢掉全部力量):**
1. **拒绝点在块体处理器层**(`body_validation_in_isolation.rs:58-63`【锚 A/B 一致】):任一笔 tx 在 isolation 校验失败 ⇒ **整个块无效**。⇒ 不是「中继拒绝 / 矿工不打包」这类**策略性**拒绝,而是**这样的 tx 不可能出现在任何有效块里**。
2. **发生在 UTXO 上下文与脚本执行【之前】**:isolation 层不需要 UTXO 集、不跑脚本 VM。⇒ 攻击者无法靠「先让它进块、再论 covenant 强不强制」推迟这一跳。
3. **花费侧另有一道,且判据不同**:`toccata_activation.is_active(block_daa_score)`(`tx_validation_in_utxo_context.rs:171`)—— 花费侧 covenant 强制**看 DAA 激活,不看 tx.version**。⇒ **拿 version=0 去花一个 covenant UTXO 也逃不掉**(version=0 不改变花费侧是否强制)。

**边界(必须原样带):** 以上只覆盖【锚 A】那一台的那一个 build(+【锚 B】的独立复核)。**不是全网断言。**

### 🆕 v0.2-0d (B) 两半:成立的那半保留,推出的场景已撤

- ✅ **成立并保留(J2 收窄,比 v0.1 原稿准)**:`sighash.rs:232` 的 version 门控,管的是**签名承诺的覆盖面**(covenant flag / authorizing_input / covenant_id 入不入 preimage),**不是共识执不执行 covenant**。同理:`require(outputs[selfOutIdx].value == consolidated_pool)` 是**花 P2SH 时脚本 VM 执行的**,与 `tx.version` 无关。⇒ v0.1 §2.3 / §7-1 把「sighash 不覆盖 covenant」直接读成「covenant 不被强制」,那一跳是错的,v0.2 予以更正。
- 🔴 **已撤(J2 自撤,(A) 否掉其前提)**:J2 由上述收窄推出的「风险不是当场被搬走、是**推迟一跳**(下次花它时绑定不成立)」这一场景,**前提是「一个 covenant 输出可以活在 version<1 的 tx 里」**;(A) 证明该前提在本 build 上不成立(`CovenantBindingInV0`,`tx_validation_in_isolation.rs:210-211`)⇒ **该场景不存在,已撤回,不进 v0.2 结论,也不进红队清单。**
- 🔨 **这一格本身是个判据**:一个**成立的语义收窄**(前半)可以驮着一个**不成立的后果推论**(后半)一起被采纳 —— Bettor 2026-08-06 采纳的是整条。⇒ **收窄与它推出的场景要分开记账、分开撤。**(在册同族:「理由错要显式撤」/「结论范围与动机」)

---

## §0 本稿要回答的那一个问题(承 DECISIONS §2-bis 补注)

> 🆕 **v0.2 指针**:本节结论(「池子里的钱挪不动,但守它的是 covenant clamp + 共识守恒,不是委员签名」)**v0.2 逐字不变**,且**强度上升**——v0.1 写下它时欠着 §6-2(「能否用 version=0 绕过 clamp」),(A) 已把这条欠账还了(限【锚 A/B】两个 build)。**代价是承重顺位换人**:clamp 现在是唯一承重件,后面没有第二道防线。详见 **🆕 v0.2 修订:§3 承重结论**。

`docs/DECISIONS.md:58` 的 Codex 作用域补注把前置③ 的原始要求钉死为一句:

> `require(outputs[selfOutIdx].value == consolidated_pool)` 只证**那一个 covenant 输出自身守恒**;而 **SIGHASH_ALL 签名承诺的是整笔序列化交易** —— 同一笔中仍可含**他方控制的额外输入 / 搬走无关价值的额外输出 / 被改的 fee 与 change**。⇒ **自输出守恒 clamp 本身不能证明「该签名挪不动别的钱」。**

`docs/DECISIONS.md:60`:「该先例要成立的前置:需给出**完整交易形状约束 + sighash 域分析**(今天没有)。」

**本稿即那份分析。** 结论提前说(§3/§4 展开):**v0.7 委员签名今天确实挪不动池子里的钱,但这个安全性【完全】来自 covenant 的链上自输出 clamp + kaspa 共识的价值守恒,不来自委员签名本身、也不来自委员侧的任何形状校验(D2 只验 covenant continuation 输出的 SPK)。** 委员对整笔交易(输入集、输出集、fee、change)是 **SIGHASH_ALL 盲签**。这恰好证实 Codex 的补注:clamp 成立 ≠ 委员验过别的钱不动。前者(池子挪不动)成立,后者(委员签名受限于「只签事实」)不成立。

---

## §1 事实底座:close_attest_v2 交易的完整实际形状

### 1.1 构造点与调用链(全部现读)

| 环节 | 位置 |
|---|---|
| SS 合约 close_attest entrypoint(链上自执行) | `kasia-console/src/lib/PayoutShardV2.sil:80-181` |
| 交易组装(preimage / submit 两阶段) | `kasia-relay/src/lib/p2sh.mjs:2015-2076` `unlockBshardCloseAttestV2` |
| relay 命令入口 | `kasia-relay/src/relay.mjs:1006` `case 'bshard_close_attest_v2'` |
| 委员签名 IPC 原语 | `kasia-relay/src/relay.mjs:711-777` `case 'sign_input_for_settle'` |
| 委员侧 enforce(签名前复核) | `kasia-console/src/lib/bshard-close-enforce.mjs:501-591` `enforceCloseAttestV2` |
| 委员 cron 驱动(自治路,默认 OFF) | `kasia-console/src/services/bshard-close-voter.js:436-534` |

### 1.2 输入(恰 2 个) `[CONFIRMED·源码实读]`

组装于 `p2sh.mjs:2023` `const matched = [psUtxo, feeUtxo];`,注入交易于 `p2sh.mjs:2068-2071`:

- **input[0] = PayoutShardV2 covenant UTXO**。value = `consolidated_pool`(池面值;`_utxoValue(psUtxo)`,`p2sh.mjs:2036`)。
  - 授权方式:**不是** input signatureScript 里放签名,而是委员的 4-of-5 签名进 witness data,由 SS 合约内 `checkSig(c0Sig,pubkey(c0Pk))…`(`PayoutShardV2.sil:100-104`)逐个验、`require(validSigs>=4)`(`:105`)。scriptSig 结构见 `p2sh.mjs:2048-2051`:`selfOutIdx + new_payoutRoot + new_attestedWinner + new_betsRoot + new_refundRoot + new_attestedAtMs + [5×sig] + committeePkHash + [5×pk] + [5×idx] + [40×sibling] + OP_1('51') + redeem`。
  - **委员签的就是这个 input(input_index=0)的 sighash**(`bshard-close-voter.js:497` `input_index: req.input_index ?? 0`)。
- **input[1] = fee UTXO**(`cmd.inputs.fee`,`p2sh.mjs:2022`)。地址 = `cmd.inputs.fee.address`。
  - 授权方式:submit 侧 relay 钱包亲签:`p2sh.mjs:2067` `const feeSig = createInputSignature(un, 1, wallet.getPrivateKey(), SighashType.All);`。**这是提交者(settler/submitter)自己的钱**(见 §3-2 论证)。

### 1.3 输出(典型 2 个,可变) `[CONFIRMED·源码实读]`

组装于 `p2sh.mjs:2038-2041`:

- **output[selfOutIdx] = PS continuation**。`new TransactionOutput(psOutValue, payToAddressScript(new Address(psContAddr)), new CovenantBinding(0, new Hash(psCovId)))`(`p2sh.mjs:2039`)。
  - value = `psOutValue = _utxoValue(psUtxo)` = `consolidated_pool`,**close 不动 value**(`p2sh.mjs:2036` 注)。
  - SPK = 新 continuation 地址,烤入 closed=1 + 5 个 attest 字段(`psContAddr`,`p2sh.mjs:2035` `_continuationAddressV2`,新 state 见 `:2030-2034`)。
  - 带 `CovenantBinding`。
- **change output(条件性)**。`_appendChange(orderedOut, matched, cmd.outputs?.change_address, _bshardFeeV1(matched.length))`(`p2sh.mjs:2041`)。
  - `p2sh.mjs:1717-1723`:`change = Σin − Σ业务out − fee`;`if (change >= 1000n && changeAddress) orderedOut.push(new TransactionOutput(change, payToAddressScript(new Address(changeAddress))))`。
  - **收款地址 = `cmd.outputs.change_address`,由调用方(driver)提供**,纯 P2PK,**无 covenant、无 SS 侧约束**。
  - change < 1000 sompi 或无 change_address ⇒ **不追加该输出** ⇒ 输出数退化为 1。⇒ **输出数不是常数,由 change 是否 dust 决定。**

### 1.4 fee `[CONFIRMED·源码实读]`

`p2sh.mjs:1712-1713`:`_BSHARD_FEE_PER_INPUT = 1_000_000n`(0.01 KAS/input);`_bshardFeeV1(2) = max(2×1e6, _BSHARD_MINER_FEE)` = 0.02 KAS(除非 miner-fee 常量更高)。**这是一个下限口径的固定值,非上界约束**(见 §4)。

### 1.5 交易信封 `[CONFIRMED·源码实读]`

`p2sh.mjs:2068-2071`:`version:1`,`lockTime:BigInt(lockTime)`(默认 0),`gas:0n`,`subnetworkId:'00…00'`(native),`payload:''`。每 input `computeBudget:_BSHARD_COMPUTE_BUDGET`(=70,`p2sh.mjs:1709`),`sigOpCount:0`。**version=1 关键**(见 §2.4:covenant 字段只在 version≥1 进 sighash)。

---

## §2 SIGHASH 域分析

> 🆕 **v0.2 作用域标注(照 (C),覆盖本节全部 rusty-kaspa 引用)**:本节所有 `D:\rusty-kaspa\...` 行号(`sighash.rs` / `sighash_type.rs`)均为 **【锚 B·J3 本机 HEAD=`90dbf074`】**,`git status --porcelain consensus/` 为空 ⇒ 干净路径,但**未与任何在跑的二进制对齐**。其中 `sighash.rs:232` 一条**另有【锚 A·J1 `ab4c51a`·二进制自报】独立佐证,行号一致**(见 v0.2-0b)。**其余各行只有【锚 B】一个锚。**

### 2.1 签名用什么 sighash 类型(实读,不假设) `[CONFIRMED·源码实读]`

**两个 input 都用 `SighashType.All`(SIGHASH_ALL)**:
- 委员签(input 0)经 `sign_input_for_settle`,两条反序列化分支都硬编码 `SighashType.All`:safe_json 分支 `relay.mjs:738`,默认分支 `relay.mjs:772`。**该 IPC 原语没有任何参数可换 sighash 类型,也没有对 tx 内容做任何校验**(见 §3)。
- fee 签(input 1)`p2sh.mjs:2067` 亦 `SighashType.All`。

kaspa 支持的 sighash 类型:`SIG_HASH_ALL=0x01 / SIG_HASH_NONE=0x02 / SIG_HASH_SINGLE=0x04 / SIG_HASH_ANY_ONE_CAN_PAY=0x80`(`D:\rusty-kaspa\consensus\core\src\hashing\sighash_type.rs:6-9`)。**v0.7 路径只用 ALL,从不使用 NONE/SINGLE/ANYONECANPAY。**

### 2.2 SIGHASH_ALL 下,签名承诺了什么(kaspa 权威 preimage) `[CONFIRMED·协议实读]`

节点真实 sighash preimage:`D:\rusty-kaspa\consensus\core\src\hashing\sighash.rs:245-280` `calc_schnorr_signature_hash`。逐字段:

| preimage 段 | 覆盖范围 | 源码行 |
|---|---|---|
| `tx.version`(u16) | 交易版本 | `sighash.rs:254` |
| `previous_outputs_hash` | **全部 input 的 outpoint(txid+index)** | `sighash.rs:254` → `:140-152`(遍历 `tx.inputs.iter()`) |
| `sequences_hash` | **全部 input 的 sequence** | `sighash.rs:254` → `:155-166` |
| (仅 version<1)`sig_op_counts_hash` | 全部 input 的 sigOpCount | `sighash.rs:260-262` |
| **被签 input 的 outpoint** | 这一个 input 的 txid+index | `sighash.rs:264` |
| **被签 input 的 scriptPublicKey** | 这一个 input 的 spk(version+script) | `sighash.rs:265` → `:240-243` |
| **被签 input 的 amount + sequence** | 这一个 input 的面值与序号 | `sighash.rs:266` |
| (仅 version<1)被签 input 的 sig_op_count | | `sighash.rs:268-270` |
| `outputs_hash` | **全部 output 的 value + spk (+ version≥1: covenant flag/authorizing_input/covenant_id)** | `sighash.rs:273` → `:197-221`,`:228-238` |
| `tx.lock_time` / `subnetwork_id` / `gas` | 交易信封 | `sighash.rs:274-276` |
| `payload_hash` | payload | `sighash.rs:277` |
| `hash_type`(u8) | sighash 类型本身 | `sighash.rs:278` |

**⇒ SIGHASH_ALL 承诺(签名一旦出,以下任一改动都令签名失效):**
- 全部 input 的 outpoint 集合(增删改任一 input ⇒ `previous_outputs_hash` 变);
- 被签 input 自身的 outpoint / spk / **amount**(kaspa 承诺被花 UTXO 的面值,类 BIP143);
- 全部 output 的 value + spk + **covenant 绑定**(增删改任一 output ⇒ `outputs_hash` 变);
- 交易信封(version/locktime/subnetwork/gas/payload)。

**⇒ SIGHASH_ALL 没承诺(不在 preimage 内):**
- **其他 input 的 scriptPublicKey / amount** —— preimage 里全 input 只进 outpoint 与 sequence,**非被签 input 的 spk 与面值不入 hash**(`sighash.rs:140-152` 只写 outpoint;per-input spk/amount 段只对被签 input,`:265-266`)。`[CONFIRMED·协议实读]`
  - 🔵 这不构成漏洞:每个 input 要被花仍须各自满足自己 spk 的解锁条件(共识层),outpoint 已被承诺即锚定了「就是这个 UTXO」。但它意味着**委员签名本身不对别的 input 的性质(是谁的钱、多少钱)作任何密码学声明**。
- **哪个 output 是「找零」、fee 具体多少** —— fee = Σin−Σout 是隐含量,preimage 不单列;committee 无从只凭 sighash 语义判断哪个 output 该属于谁。

### 2.3 kaspa sighash 与 BTC 的差异 `[CONFIRMED·协议实读 + 推断]`

- **哈希算法**:kaspa 用 blake2b 族 `TransactionSigningHash`(`sighash.rs:1` import;`:145` `TransactionSigningHash::new()`),非 BTC 的双 SHA-256。`[CONFIRMED·协议实读]`
- **结构类 BIP143(segwit)而非 legacy BTC**:分段承诺 `previous_outputs_hash`/`sequences_hash`/`outputs_hash`,且**承诺被签 input 的 amount**(`sighash.rs:266`)—— legacy BTC SIGHASH_ALL 不签 input 金额,BIP143 才签。kaspa 全程如此。`[CONFIRMED·协议实读]`
- **covenant 承诺是 kaspa 特有且版本门控**:`sighash.rs:232-237` —— `if version >= 1 { hasher.write_bool(output.covenant.is_some()); … covenant_id … }`。**version<1 的交易,sighash 完全不覆盖 covenant 绑定。** BTC 无此概念。`[CONFIRMED·协议实读]` ⇒ 这正是委员侧 D2 强制 `version>=1` 的根因(`bshard-close-enforce.mjs:232` `_ver<1` 弃签;注释 `:226`「covenant binding 仅 sighash 覆盖于 tx.version>=1」)。
- **无 SIGHASH_ALL|ANYONECANPAY 组合被使用**:虽然 kaspa 支持 `ANY_ONE_CAN_PAY=0x80`(`sighash_type.rs:9`,置位后 `previous_outputs_hash`/`sequences_hash`/`sig_op_counts_hash` 返 `ZERO_HASH`,`sighash.rs:141-143` 等),但 v0.7 从不使用 ⇒ **委员签名默认锁死全 input 集**,这对 §3-1 是有利的既成事实。`[CONFIRMED·协议实读]`

#### 🆕 v0.2 修订:§2.3 第三条(covenant 版本门控)—— 补上互补的那一半

**原文保留**(上方第三条:「covenant 承诺是 kaspa 特有且版本门控 … version<1 的交易,sighash 完全不覆盖 covenant 绑定」)。**该句本身仍成立且行号复核一致**(`sighash.rs:232`【锚 A + 锚 B 双锚】)。

🔴 **但 v0.1 在这一条上少写了互补的那一半,而缺的那一半正是承重的**:

| | v0.1 只写了 | 🆕 v0.2 补上的另一半 | 合起来 |
|---|---|---|---|
| **签名侧** | `version < 1` ⇒ sighash **不覆盖** covenant 绑定(`sighash.rs:232`) | —— | 签名不承诺 covenant |
| **共识侧** | (v0.1 未读,列为 §6-2 开放题) | `version < 1` ⇒ **带 covenant 输出的 tx 直接非法**(`tx_validation_in_isolation.rs:210-211` `CovenantBindingInV0(i)`),且挡在**块体处理器层**(`body_validation_in_isolation.rs:58-63`)⇒ 整块无效 | 这样的 tx **不存在于任何有效块** |

🔴 **⇒ 结构性结论(J1 原话,J2/NWT/Bettor 都认,本稿正式采纳为 v0.2 结论):**
> **covenant 输出只在 version>=1 合法(共识) ∧ sighash 也只在 version>=1 覆盖 covenant ⇒ 两道 version 闸互补,不存在「covenant 输出存在、而签名不承诺它」的窗口。**

🔨 **v0.1 在这里犯的形状**:读到一个**版本门控**(签名侧),就把「门关着的那一侧会发生什么」当成了开放风险 —— 而实际上**另一个子系统在同一个版本号上关了互补的一道门**。⇒ **单侧读一个版本门,答不了「门后有没有东西」;必须把同一个版本谓词在【所有】用到它的子系统里各查一次。**(这与 (B) 那半是同一件事的两面:J2 指出「sighash 覆盖面 ≠ 共识强制」是对的 —— 而正确的下一步不是推演「推迟一跳」,是**去读共识那一侧**。)

⚠ **边界**:上述共识侧只覆盖【锚 A】那台的那个 build + 【锚 B】复核。**不是全网断言**,也**不构成对未来 kaspad 版本的保证**(⇒ 新开放题 §6-6)。

---

## §3 攻击面枚举:拿到「委员签名请求构造权」的 driver 能做什么

**威胁模型**:一个能构造 `sign_input_for_settle` 请求(或 close_attest_v2 组装参数)的 driver 进程。参照 D-012 §5(`DECISIONS.md:93`)与本稿 §4.4 引用的既登记事实——**本机拓扑(11 relay 含 4 oracle)下,自治 enforce voter 默认 OFF,live 走 driver-enforce 路,一个 driver 进程可取得全部 4 个委员签名且中间零独立 relay 侧检查**(`bshard-close-voter.js:263` `D4 relay-gate 未闭`;`bshard-auto-settler.mjs:378` 直接 `relayPost({type:'sign_input_for_settle'})`,relay 该原语对内容零校验,`relay.mjs:711-777`)。故本节按「driver 全控被签 tx 字节」评估。

> 🆕 **v0.2 指针 —— 下表有 2 个格子已被修订,读下表前先读**:**第 2 行「依据」格**(池面值被锁的闸从 2 道 → 3 道,(A) 关掉了 version=0 绕过路)与**第 3 行「结论」格**(change 地址「driver 全控」需按作用域拆成两半,§6-3 关闭带来的)。原表**原样保留**,修订见紧随其后的 **🆕 v0.2 修订:§3 表格改动格**。本表引的 `sighash.rs:245-279`(第 4 行)为 **【锚 B·`90dbf074`】**。

| # | 攻击 | 结论 | 依据 |
|---|---|---|---|
| 1 | **附加他方(受害者)输入** | **不能**(靠委员签名单独);但 tx **可以**携带额外 input,委员从不清点 input 数 | 委员签的是 input 0 的 sighash(`bshard-close-voter.js:497`);任何额外 input 要被花仍须各自满足其 spk 解锁(kaspa 共识层),委员签名不满足别的 input。受害者 P2PK input 需受害者私钥。⇒ driver 只能加**自己**能花的 input(自己的钱)。委员侧 enforce 全程不校验 input 数/其余 input 归属(`bshard-close-enforce.mjs:501-591` 无 `tx.inputs.length` 检查)。`[CONFIRMED·源码实读+协议实读]` |
| 2 | **附加搬钱输出** | **不能搬走池子的钱**;**能**追加输出重定向【提交者自己的 fee-input 价值】 | 池面值被两道链上闸锁死:①SS `require(tx.outputs[selfOutIdx].value == consolidated_pool)`(`PayoutShardV2.sil:180`)+ `validateOutputState(selfOutIdx,{…})`(`:170-179`);②kaspa 共识 Σout≤Σin。⇒ 池钱只能原样进 continuation 输出。可自由追加的价值 = fee input 面值−minerFee,而 fee input 是提交者自己的(§3-3)。**委员侧对非 covenant 输出零校验**:D2 只 filter 出带 covenant 的输出逐个比对 SPK(`bshard-close-enforce.mjs:240-246`),change/额外 P2PK 输出不在其视野。`[CONFIRMED·源码实读+协议实读]` |
| 3 | **改 fee / change** | **能**(委员侧零校验),但动的是提交者自己的 fee-input 价值 | change 值与地址由 `cmd.outputs.change_address` 决定(driver 供,`p2sh.mjs:2041`/`:1722`)。委员 enforce 不校验 fee 上界、不校验 change 去向。`_assertTxInvariants`(`p2sh.mjs:42-74`)只在 **submit 侧**跑,且只查 `fee>0`(`:48`)/`dust≥1000`(`:52`)/`mass floor`(`:63-66`)—— **无 fee 上界、无输出数上界、无输出模板校验**。`[CONFIRMED·源码实读]` |
| 4 | **复用签名到另一笔** | **不能** | SIGHASH_ALL 承诺全 input outpoint 集 + 被签 input 的 outpoint/spk/amount + 全 output(§2.2),任一差异 ⇒ 不同 sighash ⇒ 签名失效(`sighash.rs:245-279`)。叠加:PS UTXO 单次花费;D1 dedup-by-market 对同 market 不同 root 拒签(`bshard-close-voter.js:454-464`);C3 TOCTOU 校验签的 tx hash == enforce 验过的 hash(`bshard-close-voter.js:491-493`,`bshard-close-enforce.mjs:589`)。`[CONFIRMED·源码实读+协议实读]` |

#### 🆕 v0.2 修订:§3 表格改动格(原表保留,此处三列重述)

| 格 | 原值(v0.1) | 🆕 新值(v0.2) | 为什么变 |
|---|---|---|---|
| **第 2 行「附加搬钱输出」· 依据格** | 「池面值被**两道**链上闸锁死:①SS `require(...value==consolidated_pool)`;②kaspa 共识 Σout≤Σin」 | 「池面值被**三道**链上闸锁死:①SS `require(tx.outputs[selfOutIdx].value == consolidated_pool)`(`PayoutShardV2.sil:180`);②kaspa 共识 Σout≤Σin;**③共识版本闸:带 covenant 输出的 tx 必须 version>=1,否则在块体处理器层整块无效**(`tx_validation_in_isolation.rs:210-211` → `body_validation_in_isolation.rs:58-63`,【锚 A+B】)」 | (A)。**v0.1 那两道闸的第 ① 道在 v0.1 里是【有条件成立】的**:§6-2 悬着「driver 设 version=0 能否让链忽略 covenant 强制」,若成立则 ① 道可绕、池钱可搬。(A) 证明该绕过路在共识层被封死 ⇒ **① 道从「有条件」升为「无条件」(限本 build),并且第 ③ 道本身就是一道独立的闸。** ⚠ **结论字(「不能搬走池子的钱」)不变,但它的**成立条件**变了 —— v0.1 那个结论当时是欠着 §6-2 的,现在不欠了。 |
| **第 3 行「改 fee / change」· 结论格 + 依据格** | 「**能**(委员侧零校验)… change 值与地址由 `cmd.outputs.change_address` 决定(**driver 供**)」 | 「**分两层,作用域不同**:🔴 **relay 命令面**——仍是 driver 全控:`p2sh.mjs:2041`/`:1722` 原样接受任意 `cmd.outputs.change_address`,委员侧零校验,**此半不变**;🔵 **live driver-enforce 路(`bshard-auto-settler.mjs`)**——change 地址**不是任填的**,六个组装点全部硬填 `ctx.feeRelay.address`(`:346`/`:392`/`:568`/`:828`/`:859`/`:887`),fee input 亦来自专用 fee relay(`:44` `ctx.feeRelay — { id, address } 专用 fee relay (防 churn)`、`:297` `feeUtxo()→{address,outpointTxid,index}`、`:339-340`)`[CONFIRMED·J3 现读 2026-08-06]`」 | §6-3 关闭(J2 读数)带来的连带修订。**这一格不改会留下 v0.1 的旧结论**:v0.1 写「driver 全控 change 地址」而不分层,读的人会以为 live 结算路上任何人可把 change 指到自己地址 —— 实况是**那条路上填的是 fee relay 自己的地址**,可攻面在**命令面**不在**settler**。🔨 判据:**「接口接受任意值」与「唯一在跑的调用方填了固定值」是两个不同的事实,写成一格就是把暴露面记错了位置。** |

🔵 **未变的格(明确说,免得读者以为整表都动了)**:第 1 行(附加他方输入)、第 4 行(复用签名到另一笔)**结论与依据均不变**;第 2 行的**结论字**不变(只有依据与成立条件变)。

### §3 承重结论(直接答前置③)

**池子里的钱 driver 挪不动 —— 但这份安全性的承重件是 covenant 的链上自输出 clamp(`PayoutShardV2.sil:180`)+ kaspa 共识价值守恒,不是委员签名、不是 D2。** 委员对整笔交易是 SIGHASH_ALL 盲签,委员侧唯一验过的形状事实是「带 covenant 的 continuation 输出其 SPK 承诺了重算出的 root」(`bshard-close-enforce.mjs:240-246`)。⇒ **Codex `DECISIONS.md:58` 的补注逐字成立**:自输出守恒 clamp 只证那一个输出守恒;「委员签名挪不动别的钱」这个更强命题,今天靠的是 clamp+共识,而**不是**委员这一签名动作被结构性地限制在「只签事实」。

🔴 **这条差异对 §6-1 冻结的直接后果**:若把 v0.7 当「三权已分离」的**通用先例**引用,是错的(照 `DECISIONS.md:59` 禁止措辞)。准确表述:**v0.7 里,covenant 独立地把池子锁住了,以至于委员即便盲签也偷不走池子** —— 这是 covenant 强,不是委员签名弱到够不到钱。真正的「委员结构上够不到资金路径」要成立,须走 §5 的 typed-receipt 正路(委员改签**不含任何交易字节**的域分隔 receipt,由 covenant 独立消费),而非继续让委员 SIGHASH_ALL 签整笔 tx。

#### 🆕 v0.2 修订:§3 承重结论 —— 结论不变,但它从「欠着一条」变成「不欠」

- ✅ **核心结论逐字不变**:守住池子的钱的是 **covenant 的链上自输出 clamp + kaspa 共识价值守恒**,**不是**委员签名、**不是** D2;委员对整笔 tx 仍是 SIGHASH_ALL 盲签。Codex `DECISIONS.md:58` 的补注仍逐字成立。
- 🆕 **变的是它的强度**:v0.1 写「池子里的钱 driver 挪不动」时,**这句话欠着 §6-2** —— 若共识接受 version<1 带 covenant 的 tx 且不强制 covenant,那么「挪不动」就是假的。(A) 把这条欠账还了(限【锚 A/B】两个 build)⇒ **「挪不动」现在是无条件的**(在这两个 build 上)。
- 🔴 **但这同时让另一句话变得更尖锐,必须写进来**:池安全的**唯一承重件**仍然是那**一行** `require(tx.outputs[selfOutIdx].value == consolidated_pool)`(`PayoutShardV2.sil:180`)+ 与它配套的 `validateOutputState`(`:170-179`)。v0.1 时「绕过 clamp」和「clamp 本身对不对」是两条并列风险;(A) 关掉了前者 ⇒ **后者现在是第一顺位,没有第二道防线站在它后面。** ⇒ §6-4(D2 offset 假设)与 §6-5(多 covenant 输出)**权重上升**,红队顺位随之改(见 §7 v0.2)。
- 🔨 **判据(记账)**:**关掉一条风险,会把另一条风险从「之二」变成「唯一」——承重顺位必须跟着重排,不能只在开放题清单里划掉一行。** 这正是本次修订同步改 §3/§4 表格的理由。

---

## §4 需要的交易形状约束(要让「委员签名挪不动别的钱」成为签名侧不变量)

前提澄清:silverscript **有**钉死完整形状的全部原语(现读 `D:\silverscript\docs\TUTORIAL.md`):`tx.inputs.length`/`tx.outputs.length`(`:923/926`)、`tx.inputs[i].value`/`.scriptPubKey`(`:951-952`)、`tx.outputs[i].value`/`.scriptPubKey`(`:970-971`)、`new ScriptPubKeyP2PK`/`P2SH`(`:991/1000`)。⇒ **下列「未强制」都不是「做不到」,是「没写」。**

> 🆕 **v0.2 指针 —— 下表有 2 个格子已被修订,读下表前先读**:**G 行「现状」格 + 「强制点/缺口」格**((A) 关掉了那个 `⚠`,并把 G 从「已强制(委员侧)」升为「三重」)与 **D 行「强制点/缺口」格**(change 地址「driver 全控」按作用域拆半,§6-3 关闭带来的)。原表**原样保留**,修订见紧随其后的 **🆕 v0.2 修订:§4 表格改动格**。

| # | 需钉死的字段 | 现状 | 强制点/缺口 |
|---|---|---|---|
| A | **input 数 == 2**(PS + fee,无多余) | **未强制** | SS close_attest 无 `tx.inputs.length` 检查(`PayoutShardV2.sil:80-181` 通读无);委员 enforce 无(`bshard-close-enforce.mjs:501-591`);submit-side `_assertTxInvariants` 无。原语可用(`TUTORIAL.md:923`) |
| B | **output 数 == 精确期望值** | **未强制**(且当前随 change 是否 dust 在 1↔2 间漂,§1.3) | 同上,无 `tx.outputs.length` 约束 |
| C | **output[selfOutIdx] 的 SPK 模板 + value == consolidated_pool** | **已强制(双重)** | SS:`validateOutputState(selfOutIdx,…)` + `require(…value==consolidated_pool)`(`PayoutShardV2.sil:170-180`);委员 D2:`verifyClosePayoutV2Binding` 比对 continuation SPK(`bshard-close-enforce.mjs:228-247`) |
| D | **其余每个 output 的脚本模板 + 金额来源**(尤其 change 必须 = 指定地址且 = Σin−池−fee) | **未强制** | change 地址 driver 全控(`p2sh.mjs:1722`);SS 不看非 selfOutIdx 输出;D2 只看带 covenant 的输出(`bshard-close-enforce.mjs:240`),纯 P2PK change 不在其视野 |
| E | **fee 上界** | **未强制**(只有下界:mass floor + fee>0,submit-side) | `_assertTxInvariants:48/63-66`(submit-side,只下界);SS/enforce 无 fee 上界。⇒ driver 可把 fee-input 大半烧成 miner fee(自损,非池损) |
| F | **selfOutIdx 指向真 continuation** | **已强制** | `validateOutputState(selfOutIdx,…)` 使 selfOutIdx 必指向带正确 state 的 covenant 输出(`PayoutShardV2.sil:170-179`) |
| G | **被签 tx.version >= 1** | **已强制(委员侧)** | `bshard-close-enforce.mjs:126/232`;根因 §2.4 covenant 仅 version≥1 入 sighash。⚠ 链侧是否也拒 version<1 带 covenant 的 tx = §6 开放题 |

**要点**:C/F/G(池子那一个输出 + 版本门)已被三处独立强制,这是「池钱挪不动」的实证支撑。A/B/D/E(input 数、output 数、其余输出、fee 上界)**全无结构强制**。它们今天不致命,**只因为**池钱被 C 锁住、可动的余额是提交者自己的(§3)。但按前置③ 的判据(「委员签名挪不动别的钱」要成为**签名侧**不变量),A/B/D/E 就是缺口 —— 它们的存在意味着委员在盲签一个形状不受约束的交易。

🔨 **判据形状**:合格的形状约束必须使「委员这一签名动作」结构上只能对应到一种交易骨架,而不是「碰巧因为 covenant 把钱锁住了所以怎么签都偷不走」。前者是签名侧不变量,后者是把安全全部外包给 covenant+共识。

### 🆕 v0.2 修订:§4 表格改动格(原表保留,此处三列重述)

| 格 | 原值(v0.1) | 🆕 新值(v0.2) | 为什么变 |
|---|---|---|---|
| **G 行「被签 tx.version >= 1」· 现状格** | 「**已强制(委员侧)**」 | 「**已强制(三重:委员侧 + 共识 isolation 层 + 花费侧 DAA 门)**」 | (A)。见下一格。 |
| **G 行「强制点/缺口」格** | 「`bshard-close-enforce.mjs:126/232`;根因 §2.4 covenant 仅 version≥1 入 sighash。**⚠ 链侧是否也拒 version<1 带 covenant 的 tx = §6 开放题**」 | 「①**委员侧**:`bshard-close-enforce.mjs:126/232`(`_ver<1` 弃签)。②🆕**共识 isolation 层**:version<1 的 tx 若任一 output 带 covenant ⇒ `TxRuleError::CovenantBindingInV0(i)`(`tx_validation_in_isolation.rs:210-211`),经 `body_validation_in_isolation.rs:58-63` ⇒ **整块无效**,发生在 UTXO 上下文与脚本执行**之前**【锚 A+B】。③🆕**花费侧**:covenant 强制看 `toccata_activation.is_active(block_daa_score)`(`tx_validation_in_utxo_context.rs:171`),**不看 tx.version** ⇒ 用 version=0 去花 covenant UTXO 也逃不掉。**⚠ 已删除的 v0.1 那句「链侧是否也拒 = §6 开放题」:该问已答(§6-2 关闭),边界只到【锚 A/B】两个 build。**」 | (A)。🔴 **这一格不改的后果是具体的**:v0.1 那个 `⚠` 是**唯一**把「池钱 clamp 可能被绕过」写在表里的地方;只关掉 §6-2 而留着这个 `⚠`,下一个读表的人仍会照它排实验、照它给 Owner 报风险 —— 即团队昨天数了一整天的「**观察量没跟着行为改**」。 |
| **D 行「其余每个 output 的脚本模板 + 金额来源」· 强制点/缺口格** | 「change 地址 **driver 全控**(`p2sh.mjs:1722`);SS 不看非 selfOutIdx 输出;D2 只看带 covenant 的输出」 | 「**结构强制仍为零,此点不变**;但「driver 全控」需分层:🔴 **relay 命令面** = 仍全控(`p2sh.mjs:2041`/`:1722` 接受任意 `change_address`);🔵 **live driver-enforce 路** = 六个组装点全部硬填 `ctx.feeRelay.address`(`bshard-auto-settler.mjs:346`/`:392`/`:568`/`:828`/`:859`/`:887`)`[CONFIRMED·J3 现读]`。⇒ **缺口是【接口面没约束】,不是【在跑的调用方在乱填】。**」 | §6-3 关闭连带。**「未强制」的定性不变**(照 §4 判据,靠调用方自律不算强制);变的是**缺口的位置描述** —— 写成「driver 全控」会让人去审 settler,而该审的是 relay 命令面/SS 侧。 |

🔵 **未变的格**:A(input 数)、B(output 数)、C(selfOutIdx 输出 SPK+value)、E(fee 上界)、F(selfOutIdx 指向真 continuation)**全部原样**。

🆕 **§4「要点」段随之更新(原段保留)**:原文写「**C/F/G**(池子那一个输出 + 版本门)已被**三处**独立强制」——
- **C/F 的强制处数不变**(SS + 委员 D2);
- **G 的强制处数从 1(委员侧)变为 3**(委员侧 + 共识 isolation + 花费侧 DAA 门);
- **A/B/D/E 仍全无结构强制**,这一句**一字不变**,是 v0.2 之后本节仍然成立的核心缺口结论。
- 🔴 **而 v0.2 之后「它们今天不致命,只因为池钱被 C 锁住」这句话变得更强而不是更弱**:C 现在是**唯一**承重件(§3 承重结论 v0.2),所以 A/B/D/E 的存在意味着**委员在盲签一个形状不受约束的交易,而全部安全押在一行 `require` 上**。

---

## §5 与 P1/P2/P3 的接缝(喂给前置① typed attestation 与前置⑥ 候选 A 规范输入集)

### 5.1 喂给前置①(typed attestation)—— 机械路径已确认存在 `[CONFIRMED·协议实读]`

冻结稿要求 P1 被签对象是**域分隔 typed receipt,对象内不含任何交易输入输出/地址/金额/fee/change**(`DECISIONS.md:61`;冻结稿 `2026-08-03-oracle-skill-interface-permission-boundary-freeze-design.md:97`)。**silverscript 恰好有一个与 tx-sighash 无关的签名验证原语**:

- `checkSigFromStack(datasig, byte[32] digest, pubkey)` / `checkSigFromStackECDSA(...)`(`D:\silverscript\docs\TUTORIAL.md:851-868`):「Verify a … signature against a 32-byte **digest supplied by the contract**」。**这不是对 tx sighash 的验证,而是对合约自定义 digest 的验证。**
- 对比今天 close_attest 用的 `checkSig(sig, pubkey)`(`TUTORIAL.md:843-848`)—— 验的是 **tx sighash**(即 §2 那整套 SIGHASH_ALL preimage)。

⇒ **接缝结论**:从「委员 SIGHASH_ALL 签整笔 tx」迁到「委员签域分隔 FactReceipt」的机械手段 = 把 `checkSig(txSighash)` 换成 `checkSigFromStack(blake2b(domain_tag ‖ receipt_fields), committeePk)`。委员签的 digest 里**没有任何交易字节**(满足 `DECISIONS.md:61`「receipt 内不得含交易摘要」),covenant 独立地①用 checkSigFromStack 验 receipt 签名、②用 §4 的 `tx.inputs.length`/`tx.outputs[i]` introspection 独立校验交易形状。**这一步同时关掉 §3 盲签面与 §4 的 A/B/D/E 缺口**,因为委员签名从此结构上够不到交易字节。

🔵 这不是本稿的实现提案(DESIGN-ONLY),是给前置① 主笔的**能力确认**:所需原语在 TN12 silverscript 全部存在,不必搭链下 fallback。

### 5.2 喂给前置⑥(候选 A 规范输入集/输出集重算与绑定) `[CONFIRMED·源码实读]`

- 委员侧今天**已有**独立重算并绑定被签 tx 的雏形:`enforceCloseAttestV2` 重算 payoutRoot/betsRoot/refundRoot/winner(`bshard-close-enforce.mjs:516-575`),D2 把重算值绑到被签 tx 的 continuation 输出(`:578-582`)。**但绑的是「输出侧承诺」,没有「输入集对象」把「委员和 driver 用的是同一堆注 + 同一堆 UTXO」钉死**(冻结稿 `2026-08-03-…freeze-design.md:235` 已标同类缺口)。
- §4 的 A/D(input 数、其余输出)正是候选 A「规范输入集/输出集」要覆盖的形状维度。候选 A 若落地为 covenant introspection(§4 原语),即把「输入集完整性」从 §4.5 那种「被信任的输入」升为「被合约强制的形状」。
- 🔴 承 `DECISIONS.md:66` PB-S8-2 候选 B 硬边界:`get_address_utxos` 快照**只能作便宜拒绝信号,永不升格为签名授权**。本稿 §3/§4 与之同源:**真正的授权绑定必须在 covenant 的 tx introspection(链上强制),不在委员侧的快照观察(可绕)。**

---

## §6 开放问题清单(如实列,不含糊)

> 🆕 **v0.2 指针 —— 下面这 5 条里有 2 条已关闭(§6-2、§6-3),另有 2 条新增**。原 5 条**原样保留**,状态与重新计数见紧随其后的 **🆕 v0.2 修订:§6 重新计数**。**只读下面 5 条会读到两条过期的开放题。**
> 🆕 **作用域标注(照 (C))**:下面 §6-2 引的 `sighash.rs:232` 为 **【锚 B·本机 `90dbf074`】**,另有【锚 A·J1 `ab4c51a`·二进制自报】独立佐证且行号一致(v0.2-0b)。

1. **jepu1 sighash 探针从未真跑过** `[未验]`。`docs/tmp-jepu1-sighash-probe.rs` 是一份**脚手架残稿**:需在 J2 机器 `D:\silverscript` 建 `sighash-probe` crate、填 jepu1 真值、`cargo run` 才能出「节点真 sighash」并与 `ad7eb3a1` 比对(见该文件 `:5-17` 部署步骤、`:79` 期望值注)。**本稿只从 `sighash.rs:245-280` 源码坐实了算法,没有一次 live round-trip 拿真实 close_attest_v2 tx 验证「我们构造的 preimage == 节点算的 sighash」。** 需 J2 跑探针闭合。
2. **version<1 带 covenant 的 tx,TN12 共识层如何处理?** `[未验]`。委员 D2 在**委员侧**拒 version<1(`bshard-close-enforce.mjs:232`),根因是 §2.4 covenant 只在 version≥1 入 sighash(`sighash.rs:232`)。但若**链共识**接受一个 version<1、带 covenant 输出的 tx 而**不执行 covenant 强制**,则一个不走委员 enforce 的 driver(§3 威胁模型)设 version=0 可能绕过 §4-C 那道池钱 clamp —— 而 C 是池安全的唯一承重件。**需 TN12 实测:提交一笔 version<1 带 covenant 的 tx,看共识是拒绝还是接受且忽略 covenant。** 这是 NWT 最该打的点(§7)。
3. **cross-node driver-enforce 路的 fee-input 归属** `[未验/需 J2 domain]`。§3-2/§3-3 的「fee input 是提交者自己的钱」结论,读的是 submit 模式 `p2sh.mjs:2067` 用 relay 自己钱包签。但 live 的 driver-enforce 路(`bshard-auto-settler.mjs`)组装 fee input 的来源、以及跨节点场景下 fee input 是否可能是别方 UTXO,需 J2 确认。若 fee input 可为受害者 UTXO,则 §3-3 的「自损」结论要收窄。
4. **`_splicePayoutV2CloseRedeem` 字节偏移 vs 真实编译产物** `[未验]`。委员 D2 依赖一组硬编码 offset 常量(`bshard-close-enforce.mjs:148-154`)重建 continuation SPK。代码自己标注(`:142-147`)：这是源码级推导,**落码后必须用真实编译的 PayoutShardV2 实例 + 真实 close_attest tx 做 byte-exact diff**(NWT/Bettor DoD)。若 offset 漂,D2 的 SPK 比对会系统性失效或误判 —— 但**这属既登记 DoD,非本稿新发现**。
5. **多 covenant 输出下 D2 的 `for` 循环语义** `[推断,待 NWT 判]`。D2 对**所有**带 covenant 的输出逐个要求 SPK==expected(`bshard-close-enforce.mjs:242-246`)。若某未来/畸形 tx 含多个 covenant 输出,该「全部必须匹配」与 SS 只 clamp `outputs[selfOutIdx]` 之间的交互,值得对抗性推演(SS 只锁一个,D2 要求全对,两者边界不同)。

### 🆕 v0.2 修订:§6 重新计数(原 5 条清单原样保留于上)

**先给数,不含糊:原 5 条 → 关闭 2 条 → 原清单剩 3 条 → v0.2 新增 2 条 ⇒ 当前 5 条。🔴 数字巧合地还是 5,但【不是原来那 5 条】,且承重顺位换了人。**

| 原编号 | 题 | v0.2 状态 | 关闭方 / 依据 |
|---|---|---|---|
| §6-1 | jepu1 sighash 探针从未真跑过 | 🔴 **仍 OPEN** | —— 需 J2 跑探针闭合。(A) **没有**碰这条:(A) 答的是「共识接不接受这个形状」,**不是**「我们构造的 preimage 是否等于节点算的 sighash」。**两者是不同的问题,不许互相顶账。** |
| §6-2 | version<1 带 covenant 的 tx,TN12 共识层如何处理? | ✅ **CLOSED(本次)** | **J1** 共识源码实读【锚 A·`ab4c51a`·二进制自报】+ **J3** 独立复核【锚 B·`90dbf074`】。答案:**不接受**,`CovenantBindingInV0`,挡在块体处理器层 ⇒ 整块无效,且在 UTXO 上下文/脚本执行之前。**边界:只覆盖这两个 build,不是全网**(⇒ 派生出新的 §6-6)。 |
| §6-3 | cross-node driver-enforce 路的 fee-input 归属 | ✅ **CLOSED(2026-08-06,非本次)** | **J2** 实读 daemon,**Bettor 采纳**,记录于 `docs/iteration/COORD-LEDGER.md:4888`(条目 **(140)BAs** 第 ③ 项:「§6-3(cross-node fee-input 归属)已关(J2 实读 daemon:356/:97/:98-104),J3 §6 开放题减一」)。答案:fee input 来自**专用 fee relay**,change 回到**同一个 fee relay 地址** ⇒ §3-3 的「fee input 是提交者自己的钱 / 自损非池损」在 live 路上**成立**,无需收窄。 |
| §6-4 | `_splicePayoutV2CloseRedeem` 字节偏移 vs 真实编译产物 | 🔴 **仍 OPEN,且权重上升** | —— 属既登记 DoD。🆕 **v0.2 提级理由**:§6-2 关闭后 C(clamp)成为**唯一**承重件,而 D2 的 SPK 重建是**唯一**在委员侧核对该 clamp 目标的东西 ⇒ offset 漂 = 唯一核对失效。 |
| §6-5 | 多 covenant 输出下 D2 的 `for` 循环语义 | 🔴 **仍 OPEN,且权重上升** | —— 同上。 |
| 🆕 §6-6 | **「两道 version 闸互补」是 kaspad 的性质,本仓零处断言它、零处会在它变化时报警** | 🔴 **NEW·OPEN** | (C) + (A) 的合取。**这不是理论风险,已被实证**:【锚 A】`ab4c51a` 与【锚 B】`90dbf074` **不是同一个版本,而在 2026-08-06 之前无人知道**。(A) 这个结论是**对一个外部组件当前行为的观测**,不是我们能维持的不变量;而 KANet 侧**没有任何检查会发现它变了**,直到下一次有人构造 covenant tx。⇒ 需要的是**检测器**(kaspad build 指纹 + 已知错误码探针),不是再读一次源码。 |
| 🆕 §6-7 | **花费侧 covenant 强制是 DAA 门控:`toccata_activation.is_active(block_daa_score)`,而 TN12 的 activation DAA 与 live tip 的关系本稿未现读** | 🔴 **NEW·OPEN** `[未验]` | `tx_validation_in_utxo_context.rs:171` / `:177-183`(`check_covenant_info` 未激活时早返 `Default::default()`)【锚 A+B】。**注意方向别读反**:isolation 层那道 version 闸**不**受 DAA 门控(任何 DAA 下 version<1+covenant 都非法);受 DAA 门控的是**花费时 covenant 是否被强制执行**。⇒ 未激活区间内,一个 version=1 的 covenant 输出**可以合法存在但不被强制**。本稿**没有现读** TN12 的 activation DAA 常量,也**没有核实** live tip 已过该点 —— v0.7 池子在跑这一事实是**间接**佐证,不是读数。**低成本可闭合,但今天是空格。** |

🔵 **承重顺位重排(这才是本次计数的意义,不只是数字)**:
- **v0.1 第一顺位** = §6-2(能不能绕过 clamp)。**已答:不能**(限本 build)。
- **v0.2 第一顺位** = **§6-4 + §6-5**(clamp 与其唯一核对物**自身**对不对)—— 因为绕过路封死后,它们后面**没有第二道防线**。
- **v0.2 第二顺位** = **§6-6**(这个「封死」是别人家的性质,我们没有检测器)。
- §6-1 独立成线(sighash 构造正确性),不受本次影响。

🔨 **一条计数纪律(v0.2 立)**:**关闭一条开放题时必须同时回答「它关闭后,谁变成了第一顺位」**。只划掉一行、不重排顺位,读清单的人会以为风险总量下降了 —— 实际上是风险**集中**了。

---

## §7 NWT 红队最该打的三个点

> 🔴🆕 **v0.2 指针 —— 本节第 1 点已作废,第 2 点需收窄,第 3 点升为第 1**。原三点**原样保留**(不删,便于对照当时的判断错在哪),**实际该打的清单以紧随其后的 🆕 v0.2 修订:§7 红队清单改写 为准**。
> 🆕 **作用域标注(照 (C))**:下面第 1 点引的 `sighash.rs:232` 为 **【锚 B·本机 `90dbf074`】**(+【锚 A】佐证)。

1. **version<1 covenant 绕过(§6-2,最承重)**:池安全的唯一承重件是 covenant 的 `require(outputs[selfOutIdx].value==consolidated_pool)`,而该 covenant 仅在 version≥1 被 sighash 覆盖(`sighash.rs:232`)。委员侧拒 version<1,但**不走委员 enforce 的 driver**(本机拓扑下可行,§3 前置)能否用 version<1 让链接受一笔忽略 covenant 强制的 tx、从而搬走池钱?**这是把「clamp 是唯一防线」这一结论推到极限的一击,必须 TN12 实弹。**
2. **委员盲签面的直接利用(§3-2/§3-3)**:委员对 fee/change/额外输出零校验(SIGHASH_ALL 盲签)。构造一笔 continuation 输出完全合法(D2 过)、但携带异常 fee 或额外输出的 close_attest_v2,验证「池钱确实动不了」是否真在**所有** change/fee/输出数组合下都成立 —— 即攻击 §3 结论「可动的只有提交者自己的钱」的边界(结合 §6-3 fee-input 归属)。
3. **selfOutIdx / 多 covenant 输出(§6-5)+ D2 offset(§6-4)合取**:driver 控 selfOutIdx(witness 值)与输出数组构造。攻 D2「所有 covenant 输出必匹配」与 SS「只锁 selfOutIdx」之间的缝:能否放一个 D2 视野外(非 covenant)或 D2 视野内但 selfOutIdx 不指向它的输出,配合 offset 假设,让价值从 §4-D 那个未强制的输出面漏走。

---

## 🆕 v0.2 修订:§7 红队清单改写(原三点原样保留于上)

🔴 **原 §7-1「version<1 covenant 绕过」已被 (A) 答死,从红队清单撤下。** 它不再是「最承重的一击」,因为**没有可打的东西了**:这样的 tx 在块体处理器层就让整块无效(`tx_validation_in_isolation.rs:210-211` → `body_validation_in_isolation.rs:58-63`【锚 A+B】)。

🔴 **实弹的定性随之改变(不是取消)**:从【**开放式实验**:提交看看会怎样,结果未知】变成【**确认性负向测试**:提交 version=0 带 covenant 输出的 tx,**预测应见 `CovenantBindingInV0`**】。**归 J1**(其节点即【锚 A】那台,唯一有二进制自报的),**排在其节点 `isSynced` 之后**。

### 🆕 v0.2 红队清单(重排后,共三点)

**1️⃣(升为第一)clamp 自身 + 它的唯一核对物 —— 原 §7-3 提级**(§6-4 offset 假设 ∧ §6-5 多 covenant 输出)
> **提级理由**:(A) 关掉绕过路之后,**池安全 = 一行 `require(tx.outputs[selfOutIdx].value == consolidated_pool)`(`PayoutShardV2.sil:180`)+ `validateOutputState`(`:170-179`),后面没有第二道防线**。而委员侧唯一核对该 clamp 目标的东西是 D2 的 SPK 重建,它建立在一组**硬编码字节 offset**(`bshard-close-enforce.mjs:148-154`)之上、**从未与真实编译产物做过 byte-exact diff**。
> **该打的具体缝**:driver 控 `selfOutIdx`(witness 值)与输出数组构造 ⇒ 攻「D2 要求**所有** covenant 输出 SPK 匹配」与「SS 只锁 `outputs[selfOutIdx]`」之间的边界差;配合 offset 假设,看能否让价值从 §4-D 那个零强制的输出面漏走。**这一点 v0.1 已写(原 §7-3),v0.2 只改顺位与理由,内容不变。**

> ## 🔴🔴 NWT 红队指针 · 2026-08-16 ·【本点的"多重性"半已闭,"offset"半仍开——原文不改,以此块为准】
> 📌 **本块不改本节任何论点,不动 v0.2 编法**(原文一字未删)。全文红队 verdict 见 `docs/2026-08-16-NWT-redteam-precond3-tx-shape-sighash-v0.2.md`。
>
> 🔴 **§6-5(多 covenant 输出下 D2 for 循环语义)描述的场景已经不存在了**:`bshard-close-enforce.mjs:144-181`(commit `a2ea5ce8`,2026-08-11)现在是 **`covOuts.length !== 1` 直接 REJECT('N1 基数')** —— 不再是"全部匹配才过",是"多于 1 个根本不许进下一步",结构上排除了"多 covenant 输出"这整条攻击面,不是"全部匹配 vs 只锁一个"之间还有缝。同批还加了 **N3**(`BigInt(covOuts[0].value) == BigInt(readPsConsolidatedPool(psRedeemHex))`,生产函数读值,非自解字节)。此修复即本稿顶部「J2 独立复核块」引的**同一个** NWT 08-10 06:58 发现,设计稿 `docs/2026-08-11-d2-multiplicity-fix-design-v0.1.md` rev-3,我(NWT)08-11 10:0x-10:3xZ 亲手复审 PASS(过程含一次自我退判 CONDITIONAL,逼 J2 补 V2 覆盖后终审)、08-11 10:4xZ 窗#5 装载后独立 SELECT 实查确认 live——COORD-LEDGER (152)(153)(154) 全程在案。
> ✅ **§6-4(D2 offset 假设:硬编码字节偏移是否 byte-exact 匹配真实编译产物)仍然真开着**,未被上述修复触碰,代码自身注释(`:184-189`)明说"仍是源码级推导...不能只信这次推导"。
> ⇒ **本点(1️⃣)收窄为单一议题:§6-4 offset byte-exact diff。§6-5 的合取部分从清单摘除(已闭,非降级,是真的没有可打的东西了)。**

**2️⃣(新)负向测试装置自身 + build 作用域 —— 这是 (A) 之后真正剩下的、值得打的东西**
> 🔴 **该打的不是「共识会不会拒」(已答),是「我们能不能证明它拒了」**。这个负向测试有一个**失败长成合法答案**的结构:
> - `p2sh.mjs:2068` **硬编码 `version:1`** ⇒ 现有构造路根本发不出 version=0 的 tx,必须另写构造器;
> - 而 WASM SDK / relay / mempool **很可能在够到共识 isolation 层之前就自己拒掉**(拒绝在 v0 output 上挂 `CovenantBinding`、或序列化时丢掉 covenant 字段)。
> - 🔴 **「构造侧拒绝」「中继侧拒绝」「共识层拒绝」三者在只记录『提交失败』的日志里读数完全相同** —— 而只有第三种能证 (A)。**更坏的一种**:序列化时**静默丢掉** covenant 字段 ⇒ tx 变成一笔普通 v0 tx **被接受**,读数长得像「(A) 是错的」。
> **⇒ 红队必须要求的三件,缺一条该测试不算数**:
> ① **捕获真实错误串**,判据是**字面命中 `CovenantBindingInV0`**,不是「提交失败」;
> ② **阳性对照臂**:同一条构造/提交路径发一笔 **version=1 带 covenant** 的 tx,**必须被接受** —— 否则「被拒」只证明这条路径坏了(在册:「对照臂的已知答案不许等于失败输出」);
> ③ **同时捕获被测节点的 build 指纹**(kaspad 启动横幅),把结果**绑定到具体 build**,而不是记成「TN12 如此」。
> 🔵 ② 的成本极低:v0.7 日常 close_attest 本身就是 version=1 带 covenant 的成功实例。

**3️⃣(保留并收窄)委员盲签面的直接利用 —— 原 §7-2**
> **仍然成立、仍然该打**:委员对 fee / change / 额外输出零校验(SIGHASH_ALL 盲签),§4 的 A/B/D/E 四项**全无结构强制**。构造一笔 continuation 输出完全合法(D2 过)、但携带异常 fee 或额外输出的 close_attest_v2,验「池钱确实动不了」是否在**所有** change/fee/输出数组合下都成立。
> 🆕 **两处收窄(照 §6-3 关闭)**:
> - 原文末尾「**结合 §6-3 fee-input 归属**」这个悬项**已关**:fee input 来自专用 fee relay、change 回同一 fee relay 地址(`bshard-auto-settler.mjs:44`/`:297`/`:339-340`/`:346`/`:392`/`:568`/`:828`/`:859`/`:887`)⇒ **「可动的只有提交者自己的钱」这一半不必再打**。
> - 🔴 **该打的面因此移位**:攻击面在 **relay 命令面**(`p2sh.mjs:2041` 接受任意 `cmd.outputs.change_address`,委员侧零校验),**不在 settler**。红队若照 v0.1 的写法去审 settler,会审到一个已经填死常量的地方,**空手而归并误报「无风险」**。

### 🆕 v0.2 元判据(供 NWT 一并审)

🔨 **本次修订暴露的形状,值得单独记一条**:v0.1 §7-1 之所以把一个**已经被封死**的东西列为「最承重的一击」,是因为**只读了版本谓词的一侧**(签名侧 `sighash.rs:232`),没有把同一个谓词在共识侧再查一次。⇒ **凡结论形如「X 只在条件 P 下被覆盖/被检查」,必须再问一句「不满足 P 的东西,在别的子系统里能不能存在」**。这一问在本例中值一整条红队第一点。
