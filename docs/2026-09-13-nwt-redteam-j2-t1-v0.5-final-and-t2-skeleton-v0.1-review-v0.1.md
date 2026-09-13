# NWT 红队复核 · T1 v0.5（A″ 定稿 + P12 实证）+ T2 骨架 v0.1 + Q8 ctor 盘点裁决

> **Status**: FINAL v0.2（2026-09-13 · NWT · docs only · v0.2 追加第五章：J2 主网集 7 文件 ctor 盘点 `a6bd91fb` 的 Q8 具体裁决）
> 审对象一：`docs/2026-09-13-j2-t1-kanet-test-token-kcc20-contract-design-v0.1.md` 提交 `57e4c344`（v0.5，§4 A″ 定稿 + §4.2 双 R 洞精确表述 + P12 provenance）。
> 审对象二：`docs/2026-09-13-j2-t2-market-and-claim-covenant-a2-skeleton-v0.1.md` 提交 `7d1f47cd`（T2 骨架 v0.1，Bettor 追加派工）。
> 审对象三：`docs/2026-09-13-j2-t3-mainnet-set-ctor-inventory-for-q8-v0.1.md` 提交 `a6bd91fb`（主网集 7 文件 ctor 盘点，Bettor 追加派工）。
> 方法：**不信自报，独立重算**——找到本机 silverscript 仓库两个已构建二进制（`D:/silverscript-v1rc1` worktree, commit `c7d17a1`，含 `silverc.exe`+`cli-debugger.exe`），把 P12 provenance 目录的 11 个已提交文件（原样，未改一字节）喂给这两个二进制，独立重新编译两组市场 ctor + 三组领取 ctor，独立重跑全部 6 条运行期向量；另外直接读 `3ed9733`（silverscript v1.0.0 tag，T1/T2 稿引用的编译器版本）源码核对 `template_hash` 公式、`blake3` 内建、`pubkey` 类型宽度三处关键技术断言。

## 结论：**T1 v0.5 GREEN**，**T2 骨架 v0.1 结构方向 GREEN**（Q1 裁 (b)，Q7 裁 byte[32]，其余留 T3 细化）

---

## 一、T1 v0.5 · 四点裁决

### ① 29959d41 三条 MUST 在 A″ 落点——独立重算，逐条兑现

**不是读文档确认"写了"，是我自己重新编译验证"是真的"。**

用 `c7d17a1` 版 `silverc.exe`，拿 provenance 目录原始的 `P12.a.json`（`token_prefix_len=1, deadline=1000`）与 `P12.b.json`（`token_prefix_len=7, deadline=9`，七个字段全换）分别编译 `P12_market_a2.sil`：

| ctor | template_hash（我独立算出） | bytecode_len |
|---|---|---|
| a | `a5c45a36f25b7a1665...` | 808 |
| b | `a5c45a36f25b7a1665...`（**逐字节相同**） | 808 |

与提交信息声称的 `a5c45a36(808B)` **完全一致**——**MUST①（等值比较）+ MUST②（双 ctor 编译对照）同时兑现**：两组 ctor 七个字段（含 `deadline`/`token_prefix_len` 这类看起来最像"结构参数"的值）全换,模板字节不动一位。

`ClaimStub.sil` 用 `Claim.M.json`/`Claim.X.json`/`Claim.M_amt.json`（winner_pk 换、amount 从 500 换 501）独立编译,三组 `template_hash` 同为 `209abf73...`（236B）,与声称一致。

**MUST③（provenance-bind）**：直接读 `P12_market_a2.sil` 源码第 22 行——`market_cov_id: OpInputCovenantId(this.activeInputIndex)` 是市场入口**自己**在构造领取输出时写的,不接受外部实参喂这个字段（`payout_claim` 的形参里根本没有 `market_cov_id` 这一项）。再用 `cli-debugger.exe --run-all` 独立重跑 `P12.test.json` 六条向量：

```
PASS  p12_market_writes_own_covid_pass
PASS  p12_claim_built_with_attacker_covid_fail   ← 攻击者拿 X 的 ClaimStub 模板造领取,拒
PASS  p12_market_is_X_claim_says_M_fail          ← 输入其实是 X,声称是 M,拒
PASS  p12_claim_amount_tampered_fail
PASS  p12_market_state_tampered_fail
FAIL  harness_flip_pass_vector                   ← 翻转臂,期望就是 FAIL(证明判据不是摆设)
6 tests: 5 passed, 1 failed
```
5/5 + 翻转臂形态正确,与提交信息声称的"cli-debugger 5/5+翻转臂"逐条对上。**三条 MUST 全部独立复现,PASS。**

**范围披露（如实记,不隐瞒）**：本机没有 `3ed9733`（T1/T2 稿点名的编译器版本）的已构建二进制,我用的是更早的 `c7d17a1`（早于 `entry` 语法版但已支持,晚于此的 `db9e1ba` 可移植 ABI artifact 也已支持）。我另外直接读了 `3ed9733` 的 `silverscript-abi/src/lib.rs:103`/`state.rs` 源码,确认 `template_hash` 公式与 `validateOutputStateWithTemplate` 的 codegen 路径在两个版本间没有变化痕迹（同一个 `serialize_script_i64`/`int_to_fixed_bytes_expr`/`OpBlake3` 组合）,但**没有在 `3ed9733` 二进制上重跑这次编译**。**建议**：T1 落码前找一次真 `3ed9733` 构建把这轮 P12 编译重放一次（十分钟量级的 cargo build,不是新工作,是同一验证换个版本号）,不阻塞本次文档裁决。

### ② §4.2 双 R 洞措辞——精确表述已落,PASS

原文：
> ✅ covenant_id 伪造不了……🔴 创世输出的状态内容不受检……**不是"创世完全不验证"**。

这正是我 29959d41 要求的拆分版本——"身份不可伪造"与"内容不受检"两句分写、显式否定"完全不验证"这个会被误读的强化说法。**PASS,不需要再改字。**

### ③ P12 provenance 作为 A″ 前提证据——**基本够,但有一处 MANIFEST 计数不实,已用独立重算补上**

**我发现的问题**：`MANIFEST.sha256` 列了 12 个文件的哈希,但 `git ls-tree 57e4c344` 该目录下**只有 11 个 blob**（10 个数据文件 + `MANIFEST.sha256` 自己）。`git log --all` 对该目录的全部历史只有这一笔提交——**`p12_template_hash.log` 与 `run.log` 这两个文件从未进过 git,任何提交都没有**。"provenance 12 文件 MANIFEST 12/12"这句commit message 描述与实际入库文件数不符（12 之中 2 个只存在于 J2 本机、从未提交）。这恰好是两份"运行时原始日志"——按理是最直接的一手证据（编译器真跑了、debugger 真跑了的命令输出）,而这两份恰恰缺失,委托方只能看到已提交的输入文件（`.sil`/ctor json）与一份人工汇总的 `claim_M.derived.json`。

**我的处置**：没有停在"日志缺失,存疑"——**我自己拿原始输入文件重新编译、重新跑 debugger**（见①）,独立产出了比那两份缺失日志更强的证据（不是读别人的日志,是我自己的编译器/debugger 输出）。**结论：作为 A″ 的证据前提,现在是够的**——不是因为"12/12"这句话成立（它不成立）,而是因为我用独立的编译器+debugger 复现了同样的数字。**流程问题仍要记档**：以后写"MANIFEST N/N"必须是 `git ls-tree` 真数出来的数字,不能是"应该生成的文件清单"数,运行时原始日志(`*.log`)属于**证据**范畴,该入库而不是留在本机——建议 J2 以后 provenance 目录统一用 `git add -A` 前先 `git status` 对一遍清单,而不是手写文件名列表。

### ④ Q7 / Q8

**Q7（winner_pk 类型）——裁 `byte[32]`（x-only）,不改 `byte[33]`**：直接读 `3ed9733` 源码 `silverscript-lang/src/ast/mod.rs:204`：`pub const PUBKEY_BYTE_LEN: usize = 32;`,`builtin_types.rs:145` 确认 `checkSig(signature: Sig, publicKey: Pubkey)` 的 `Pubkey` 标量类型固定宽度就是这个常量。`checkSig` 要的 pubkey 本身就是 32 字节（Kaspa 只有 Schnorr,无需 33 字节压缩公钥那套）——`byte[32]` 与 `checkSig` 的实参类型**逐字节匹配**,P12 现在的选型就是对的,不用等 T2 落码才知道。

**Q8（市场结构常量清单,与 T2 §3.1 的"待 Q8"栏合并裁）**：判据不是"这个值是否按市场变",是**"这个值有没有在合约任何地方被结构性使用（循环上界、固定数组维度、切片长度)"**——P10 的对照臂已经证明了这条分界线：`structural_n` 只用作 `for` 上界,一换值 template_hash 就变;P12 的七个市场字段全部只做等值比较,全换值 template_hash 不动。这条线比"按市场变不变"更根本,因为它直接决定值能不能被声明成状态字段（声明成状态字段=进 `state_span`=模板天然稳定,与"业务上是否按市场变"无关——一个全网固定但被声明为状态字段的值,一样不影响模板稳定;真正强制"必须 ctor"的,只有结构性用途这一条）。逐项裁：

| 字段 | 结构性用途? | 裁决 |
|---|---|---|
| `market_id`/`commit_v2`/`question_hash` | 无（纯等值/身份数据） | **状态**,且必须——本来就按市场变 |
| `deadline` | 无（`tx.time` 比较,阈值形式） | **状态** |
| `seal_count`/`min_bet` | **待 T3 逐点核**：如果 ShardLeaf 现在拿它们做循环上界/数组维度就必须留 ctor(→ 强制全网同值,若产品要求按市场变则需要重新设计该段代码,不能只是"挪进状态"了事);如果只是门槛比较(`require(x >= min_bet)`这种)就能进状态。T2 §7 自己也承认"只读了 ShardLeaf 的 ctor,其余 6 文件未逐个读"——**这条不能靠我隔空判,T3 稿必须先逐文件读完用法再定,我到时候要看这张读用法的清单,不接受"看起来只是比较"这种印象判断**。 |
| `shard_count` | 同上,待 T3 核 | 同上 |
| 委员/oracle 公钥 ×N | **N（个数）结构性,公钥值不结构性** | T2 自己的分析是对的：N 是编译期固定数组维度(→ 全网必须同一个 N,这是语言约束,不是产品选择的余地);但数组**里的值**(每个具体公钥)只做签名验证的等值/门限判断,可以是状态。**换句话说:"每市场几个委员"不能变,"每市场委员是谁"可以变**——这是个技术上已经确定的答案,不是留白;T2 描述成"待 Q8：全网固定 ⇒ ctor,按市场换 ⇒ 状态"这个二选一框架本身有一个隐藏前提没写清楚：**无论选哪个,N 都必须是全网固定的 ctor 常量**,选项只在"公钥值"这一层,请 Bettor 转告 J2 更新 T2 §3.1 这一行的措辞,避免下游误读成"N 也能按市场变"。 |

---

## 二、"未核项可否留后"——两项都批准留后,但留后不等于免审

**settle_token 运行期向量留 T3**：批准。P12 已经在编译级证明了 H5 检查（`validateOutputStateWithInputTemplate` 吃状态里的运行期 hash/长度值）能编译通过、且模板稳定;真正的运行期向量需要 T3 阶段的完整代币 sigScript 字节（P9 产物 + 完整 redeem 拼接),这套字节在 settle_token 之外的其它 A 类入口（15 条）也全部要用同一套,不是 settle_token 独有的缺口,现在单独补一条不会比 T3 阶段批量补更早发现问题。**批准延后**。

**市场创世初值 console 填错自毁 T4 对照未设计**：批准延后,但**T2 §4 已经给出了一个具体骨架**（单源产物/逐字节对照/P2SH 重算/`market_landed_at` 硬门+锚记录),不是空白留白。**要求**：T4 正式稿落地时,这五步骨架必须整体交我审一次（尤其第 2 步"逐字节对照"与第 4 步"硬门"的实现,是 (c) `escrow_landed_at` 同款模式在新场景的复用,我会按同样标准核"单一所有权点/单一写入方/幂等"三件套）,不能因为"骨架已经有了"就跳过实现阶段的复核。

---

## 三、T2 骨架 v0.1 · Bettor 追加三点裁决

### ① §3.3 witness 供前后缀字节 + 现场 blake3 验——**技术路径本身可靠,已从源码验证；J2 自己的 P13 探针已跟进验证并回报全绿**

我直接读了 `3ed9733` 的 `silverscript-abi/src/lib.rs:103` 与 `silverscript-lang/src/compiler/compile/state.rs`（`compile_validate_output_state_with_template_inner_statement`）：`template_hash = Blake3(len8(prefix)‖prefix‖len8(suffix)‖suffix)`,长度编码函数是 `int_to_fixed_bytes_expr(length(x), 8)`,这个函数**就是** `x as byte[8]` 这个类型转换在编译器内部走的同一条 codegen 路径（`as_cast_call_name`）——**也就是说,合约作者写 `tok_prefix.length as byte[8]` 得到的字节序,与 `validateOutputStateWithTemplate` 内部自己拼 preimage 时用的字节序,是编译器里同一个函数生成的,不是"两套独立实现刚好碰巧一致"**。这直接回答了 T2 §7 留白的 P13 ①（字节序是否一致）——**答案是"是",且是源码级确定性的答案,不需要跑测试去猜,跑测试只是再确认一遍**。我看到刚才 dev-coord-testnet 频道里 J2 已经报告 P13 全绿（提交 `127c3aee`,`silverc` 产物 `58fe86fc` 正向量 pass）,与我从源码推出的结论一致——**两条独立路径(我读 codegen 源码 / J2 跑编译器实测)得到同一结论,互相印证,不需要我再重复实测**。

**攻击面**（Bettor 点名的"witness 可控⇒靠 hash 绑定是否够"）：够。因为 blake3 是**单向哈希**,攻击者供假的 `tok_prefix`/`tok_suffix` 字节,`blake3(假字节) != token_tmpl_hash`（状态里的真值,不可由 witness 覆盖）,`require` 直接拒;攻击者供真字节,则 P7 尾匹配循环拿到的就是真代币模板后缀,判定正确。**witness 可控 ≠ 可以骗过 hash 绑定**——这条防线的强度等价于"能否找到 blake3 原像/碰撞",不是这次设计要操心的攻击面。T2 自己在 §3.3 末尾已经把这两层攻击(供假字节 / 供真字节但尾部差一字节)分开列向量,分层正确。**PASS**。

### ② Q1（领取合约自核代币输出）——裁 **(b)**,理由是我构造了一个针对 (a) 的具体攻击

**(a)（只做 cov-id 级检查,委托给"同笔在场的市场入口"或"代币合约的 (b)"去核）在下面这个构造下被攻破**：攻击者花费领取的 `spend` 入口,同一笔 tx 里放一个**市场的 `close_attest`（B 类,不碰币的委员背书入口）作为"在场输入"**——`close_attest` 的 cov-id 与领取的 `dest_idx` 检查要求的 `OpInputCovenantId(dest_idx)` 相等这件事很容易满足(它就是那个市场自己),但 `close_attest` 这个入口**根本不检查代币输出**（它是 B 类,只管委员签名与状态 flip)。领取合约如果只核"目标位置的输入 cov-id 等于市场"（(a) 的浅层检查),就会认为"市场在场,应该有市场自己核过",但**实际被激活的市场入口是不核代币的那一个**——代币最终去哪由攻击者在 `tok_out` 里自由填,两边都没有任何一份代码真的检查过这个具体输出。**这是"在场≠同意"（H5 的立论)在领取合约自己身上的复现**,不是我编的假设风险。

**(b)（领取合约自己加 `token_tmpl_hash` 状态字段,自己核代币输出模板+owner)** 关闭了这个洞——领取自己的 `spend` 逻辑不依赖"这笔 tx 里恰好有谁在场、恰好做了什么",直接在自己的入口里核实 `tok_out` 的模板匹配与 owner 归属。代价是一个 `byte[32]` 状态字段(市场创建领取输出时顺手多写一个值,P12 已证市场入口写复合状态字段没有额外结构性代价)。**裁 (b),J2 的倾向是对的,理由是这条具体攻击,不是"原则上更谨慎"。**

### ③ Q2/Q3/Q6

**Q2（领取→新领取转手）**：技术上不构成新的安全缺口——(b) 下领取自己核代币输出,允许转手只是把"合法目的地"的判定从"仅市场输入"扩到"市场输入或新领取输出",判定逻辑本身（模板匹配+owner 归属)没变。**是否允许是产品/经济设计问题（测试币场景下人物间转账是否有意义),不是我这轮该拍的技术判据,建议 Bettor/Owner 按"KTT 定位"决定,不阻塞 T3 结构设计——T3 两种情况的向量都先写,选型定了删一半即可。**

**Q3（dust 值与付费方）**：机械细节,留 T3 实现阶段定,不影响本轮结构性裁决。

**Q6（家族内部模板锚 Leaf 烤 PS、Root 烤 Claim 是否也改状态)**：**建议改**,但理由与 A″ 的核心动机不同,要分开讲清楚,不要混为一谈——T1 A″ 解决的是**双 R 攻击**（创世状态内容不受检的伪造洞),市场/领取/代币三方之间**现有的单向链 Leaf→PS→Root→Claim 没有环,不存在同款伪造洞**,这条不是安全 MUST。**真正的理由是升级刚性**：`ShardLeaf` 现在烤死了 `PayoutShard` 的 `template_hash`,如果 `PayoutShard.sil` 未来需要一次修 bug/升级,**所有已经创世的 `ShardLeaf` UTXO 会永久锁定在旧版 `PayoutShard` 模板上,永远无法 `consolidate_to_payout` 进新版**——这是一个自己埋的雷,现在没有人在任何文档里点过名。**这条我裁 SHOULD 不裁 MUST**,因为处理它需要重新设计"家族内部怎么互相认识"这一层（把 Leaf 认 PS 的方式从烤 ctor 换成状态字段,谁来在创世时写这个状态字段、写错了怎么办,是一整套跟 T1/T2 同等量级的设计工作),T3 阶段先把主线（市场↔代币↔领取)按 A″ 落地,家族内部锚这条可以单独开一轮,但**必须记档,不能让它继续隐身**。

---

## 四、Q8 具体形 · 主网集 7 文件 ctor 盘点 `a6bd91fb` 裁决

**先验证盘点本身,再裁决**：抽查了 `market_id`（ShardLeaf/ShardLeaf_direct 确认零使用位点,仅声明行)、全部 5 处 `for (` 循环（`PayoutShard.sil:195/:359`、`PayoutShardV2.sil:311`、`RootClaim.sil:73/:88`、`CloseZkV2.sil:104/:169`,界全是字面量 63/1/2,无一处引用 ctor 变量)、`predicate_commit`/`poolMerkleRoot`/`committee_hash`/`gateTmplHash`/`betsRootBaked`/`refundRootBaked`/`attestedAtMs` 的全部用法行——**J2 的读数与我直接 grep 源码逐行核对一致,没有发现盘点本身有误报**。"机械上 22 个全可搬"这条结论成立,可信。

**但"能搬"与"该搬"是两个问题,盘点只答了第一个。第二个要看安全后果,下面按类分开裁,不接受"倾向 22 全搬"这个统一默认值。**

### 5.1 7 个模板 hash/锚——**裁：`gateTmplHash` 必须留 ctor（安全 MUST）；其余 6 个（`ps_tmpl_hash`×3/`rootclose_tmpl_hash`/`claim_tmpl_hash`/`refundclaim_tmpl_hash`/`closeZkTmplAnchor`）默认留 ctor,除非 T4 明确扩大覆盖范围**

J2 的论证只到"留 ctor 不成环",但漏了一层——**留在 ctor 里的模板 hash,天然被"这份 UTXO 的 covenant template_hash 是否等于官方已知值"这条既有检查免费保护**：伪造实例如果改了 ctor 里的 `rootclose_tmpl_hash`,自己的 `template_hash` 就会跟着变(ctor 常量进字节码),任何核对"这是不是真 ShardLeaf"的地方一比就穿。**搬进状态之后,这条免费保护消失**：伪造实例的 `template_hash` 可以跟真实例完全相同(状态值不影响 template_hash——这正是 A″ 整套设计的前提),状态里的 `rootclose_tmpl_hash` 却可以被创世时填成攻击者自己的值——**这就是 T1 §4.2 那个"创世输出状态内容不受检"的洞,原样复现在家族内部锚上,不是我类比,是同一个共识层事实(`populate_genesis_covenants` 不碰脚本内容)在新字段上的直接后果**。

**`gateTmplHash` 是这 7 个里最不能搬的一个,理由比"避免重编面"更硬**：源码注释自己写"烤死(改 guest image_id=新 covenant=新 hash)"——这个值的设计意图就是**充当 ZK 验证目标电路的身份本身**,不是"某个市场恰好选了哪条 hash"这种运营参数。搬进状态等于把"这份合约只认一个固定电路"这条不变式,换成"这份合约认创世时状态里写的任意电路"——一次 console 填值 bug 或一次被攻击的创世,就能让一个"CloseZkV2 形状"的 covenant 实际验证的是攻击者的电路,而所有下游代码看到的 `template_hash` 跟真品一模一样。**这条我裁死:MUST 留 ctor,不因为省重编面就搬。**

其余 6 个(纯粹是"下游是哪个模板"这层信息,不是"验证目标电路"这种根本身份)风险等级低于 `gateTmplHash`,但同款漏洞机制成立。**裁决**：默认留 ctor(与 J2 盘点表格里"处置"列的"可留"一致,不采纳"倾向搬"那句)。**唯一允许搬的条件**：T4 的创世对照检查扩大到覆盖市场创世时写入的**全部**状态字段(不只 T1 的 token/claim 三参),逐字节比对单源产物,那时搬这 6 个不增加净风险(T4 已经在管这件事)——**这是一句可以现在拍的话,不必等 T4 稿：请 Bettor 现在就定,T4 的"对照检查"范围是"token 模板三参"还是"市场创世写的每一个状态字段",这个范围决定了这 6 个 hash 能不能搬,不是我这轮能替 T4 稿先拍的细节,但决定原则我现在就能定：范围不够就不能搬。**

### 5.2 6 个 "?"——分两档,`poolMerkleRoot`/`committee_hash` 风险显著高于 `seal_count`/`min_bet`

**`poolMerkleRoot`（委员必须∈的 oracle pool 根）与 `committee_hash`（RootClose 委员会 hash）不是运营参数,是这个市场的信任根——决定谁有权对结果背书**。搬进状态机械上没问题(纯等值比较,我已核实),但**这两个字段的"创世填错"跟其它字段的"创世填错"性质不同**：`deadline` 填错是这个市场跑不完/提前锁(自毁,如实记的那种);`poolMerkleRoot`/`committee_hash` 填错(或被攻击性填错)是**换了一批人有权裁决这个市场的输赢**——不是"这个市场坏了",是"这个市场被劫持了还看不出来"。**裁决**：机械上可搬,是否按市场变是产品问题(委员会/oracle pool 按市场轮换是合理的产品形态,我不拦),**但这两个字段一旦搬进状态,T4 的创世对照检查覆盖它们是硬性前提,不是"建议覆盖"——这条我升级为 MUST,不是 5.1 那种"范围够就行"的软条件,因为错误后果是权力转移不是功能失效**。

`seal_count`/`min_bet` 是纯运营门槛(分片数/最小注),填错的后果是"这个市场分片数或门槛不对"，不涉及信任根转移,风险自限。**裁决**：机械上可搬,按市场变是否是真实产品需求交 Bettor/T3 拍,搬的安全代价可忽略,T4 覆盖与否不是安全 MUST(覆盖当然更好,但不覆盖也不产生权力转移类风险)。

### 5.3 `market_id`——裁：删

零使用位点,任何 require 都不读它,它现在唯一的名义作用("让 P2SH 唯一")在 A″ 下已经由 oracle_pk/question_hash/deadline 等本来就按市场变的字段间接提供,不需要一个没人核对的额外字段。**这本身是我例行要抓的"无牙检查"模式的镜像版本——不是"看起来在检查但其实没检查",是"看起来在提供某个属性但其实没有任何代码依赖它提供这个属性"**,同样该删。裁：**删除**,不搬状态(搬了也是白搬,没有 require 会去读)。

### 5.4 `predicate_commit` baked-use 行——裁：搬状态后删,PASS

`require(blake2b(byte[](predicate_commit)) != predicate_commit)`（PayoutShard.sil:84/246、PayoutShardV2.sil 同款)读了源码注释与用法,确认它唯一目的是防止编译器把未使用的 ctor 常量常量折叠掉,不是业务逻辑。`predicate_commit` 搬进状态字段后天然进 redeem 字节,这两行失去存在理由。**裁：删,PASS**,J2 判断对。删除前后 `template_hash` 会变——这是 A″ 落码那一轮重编面的一部分,不是新增风险,不需要单独开向量。

### 5.5 汇总表

| 字段 | 裁决 | 等级 |
|---|---|---|
| `gateTmplHash` | 留 ctor | **MUST**（验证目标电路身份,搬则重开双 R 型洞) |
| `ps_tmpl_hash`×3 / `rootclose_tmpl_hash` / `claim_tmpl_hash` / `refundclaim_tmpl_hash` / `closeZkTmplAnchor` | 默认留 ctor;T4 扩大覆盖范围后可搬 | 条件性(范围由 Bettor 现在定) |
| `poolMerkleRoot` / `committee_hash` | 可搬,但 T4 覆盖是搬的前提 | 若搬:**MUST** 配 T4 覆盖(信任根字段) |
| `seal_count` / `min_bet` | 可搬,按市场变与否是产品问题 | 低风险,交 T3/Bettor 拍 |
| `market_id` | 删除 | — |
| `predicate_commit` baked-use 两行 | 搬状态后删 | PASS,J2 判断对 |

## 五、给 Bettor 的处置建议

- **T1 v0.5 GREEN**：①②③④ 逐条独立复核通过,可视为 A″ 定稿,`.sil` 落码走 D-017 §3 Owner 批流程。MANIFEST 12/12 的计数问题记档但不影响结论(我已用独立重算补上证据链)。
- **T2 骨架 v0.1 结构方向 GREEN**：Q1 裁 (b)（附具体攻击作为理由)、Q7 裁 `byte[32]`(源码级确定)、Q8 给出"结构性用途"这条统一判据+委员 N 与委员值分层裁决,请转告 J2 更新 T2 §3.1 措辞。Q2/Q3 留 T3/产品裁,Q6 建议单独开一轮(升级刚性,非安全 MUST)。
- **两项批准延后**：settle_token 运行期向量(T3)、T4 创世对照(T4 骨架已有,落地时须回我审一次三件套)。
- **一条流程问题记档**：provenance 目录的运行时原始日志（`.log`)以后要入库,不能只入库输入文件+人工汇总,`MANIFEST N/N` 的 N 必须是 `git ls-tree` 真数出来的数。
- P13（J2 刚报的 `127c3aee`)与我从源码独立推出的结论一致,不需要我再单独复核那一轮,除非 Bettor 要求。
- **Q8 ctor 盘点 `a6bd91fb` 裁决(§四)**：盘点本身抽查无误报,机械可搬结论成立。**不采纳"22 全搬"的默认值**——`gateTmplHash` MUST 留 ctor(验证目标电路身份,搬则重开双 R 型洞,是本轮最重的一条新发现);其余 6 个模板 hash/锚默认留 ctor,搬的条件是 T4 对照检查范围扩大到覆盖市场创世的全部状态字段(这个范围现在就能拍,不必等 T4 稿——请 Bettor 定);`poolMerkleRoot`/`committee_hash` 可搬但搬了 T4 覆盖是 MUST(信任根字段,填错=换委员不是自毁);`seal_count`/`min_bet` 低风险交 T3/产品拍;`market_id` 删(零使用位点,同款"无牙"模式);`predicate_commit` baked-use 两行搬后删,PASS。
