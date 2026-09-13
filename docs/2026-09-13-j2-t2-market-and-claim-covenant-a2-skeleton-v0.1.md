# T2 · 市场 / 领取 covenant 在 A″ 下的形 · 设计骨架 v0.1（只落 docs · 不写 .sil）

> **Status**: DRAFT-FOR-REVIEW **v0.1**（2026-09-13 · J2 · Bettor 派工 SendMessage「T2 设计骨架 v0.1：市场状态字段清单、领取状态字段、市场各入口与代币共花与否（H5 二选一）、settle_token 运行期喂代币输入 sigScript 模板字节的方案、市场创世初值由 console 填的 T4 对照检查骨架；Q8 答案到了再定哪些值进状态，先搭结构」· 输入：T1 v0.5（`docs/2026-09-13-j2-t1-kanet-test-token-kcc20-contract-design-v0.1.md` §4 A″ 定稿 + P12）· 批 T v0.7 §0.5 H4/H5 + §3 T2/T3/T4 行 · P7 不在场证明（`docs/2026-09-13-j2-h5-no-token-input-proof-vectors-v0.1.md`）· 主网集 7 合约的 23 条手写 entry（本机 `kasia-console/src/lib/*.sil` 逐文件读的入口名）· silverscript v1.0.0 `3ed9733` 源码（`silverscript-abi/src/lib.rs:103 template_hash`）· 交 NWT 红队 → Bettor → 🔴 市场/领取合约 = 钱路 ⇒ Owner 批（D-017 §3）后才写 `.sil`。**Q8（哪些值按市场变）待 NWT 答**：§2.1 字段表分"确定进状态 / 待 Q8"两栏。

## 0. 一句话

A″ 把"谁认识谁"定成单向：**代币烤市场模板与领取模板（稳定），市场/领取把所有 per-instance 值放状态**。本稿把这句话摊成三张表和一个新发现：① 领取 covenant `KanetTokenClaim` 三个状态字段 + 一条花费入口；② 市场侧（主网集 7 合约 23 条入口）逐条分 **A 共花代币 ⇒ 显式核代币输出** / **B 不共花 ⇒ 不在场证明**，A 15 条、B 8 条；③ **B 类入口的不在场证明在 A″ 下不能烤代币后缀字节（烤了就把 v0.3 的环带回来）**——从 silverc 源码读到 `template_hash = blake3(len8(prefix)‖prefix‖len8(suffix)‖suffix)` 且 `blake3` 是语言内建 ⇒ **witness 供前后缀字节、合约用状态里的 `token_tmpl_hash` 现场验、再做 P7 尾匹配**（探针 P13，待编）；④ `settle_token` 运行期向量的喂法与 T4 创世对照检查骨架。

## 1. 前提（不重述，只钉出处）

- A″ 定稿与三条 MUST 落点：T1 v0.5 §4.0；双 R 洞的精确表述（covenant_id 伪造不了 / 创世输出状态内容不受检）：T1 v0.5 §4.2——本稿引用一律按拆开版本。
- P12（`docs/provenance/2026-09-13-j2-t1-p12-market-writes-own-covid/`）：市场 7 个 per-instance 状态字段两组全换 ⇒ 模板 hash 同一；`validateOutputStateWithTemplate` / `validateOutputStateWithInputTemplate` 的 hash 与长度参数接受运行期状态值；市场入口写自己 cov-id 进领取输出的运行期向量 5/5。
- H5（批 T v0.7 §0.5，NWT 升 MUST）：`owner_scheme 0x04` 只证市场**在场**不证**同意**；每条会与代币共存于同一 tx 的入口必须显式核代币输出；不共花的入口要能**证明**不共花。H4：赢家身份进领取 covenant = verify-value-source 承重点，"余额 = 名下求和"是链下索引。
- P7（`docs/provenance/2026-09-13-j2-h5-p7-no-token-input-vectors/`）：不在场证明 = 遍历 `tx.inputs[i].sigScript` 尾部按代币模板后缀匹配，0/1/多/差一字节四档已跑。

## 2. 领取 covenant `KanetTokenClaim`（T2 本体）

### 2.1 状态（全部 per-instance，全部只做等值比较）
| 字段 | 型 | 谁写 | 语义 |
|---|---|---|---|
| `market_cov_id` | byte[32] | **市场入口**在创建本 covenant 的输出时写 `OpInputCovenantId(this.activeInputIndex)`（P12 形，运行期已证） | provenance：这份领取来自哪个市场；不从 witness 喂 |
| `winner_pk` | byte[32]（x-only；**Q7** 若 `checkSig` 需 33 字节则改 `byte[33]`） | 市场入口从 payout merkle 叶（`blake2b(pk‖ser(payout,8))`，RootClaim/CloseZkV2 既有公式）取的 pk 写入 | 赢家身份（H4）；余额 = 链下按 `winner_pk` 求和所有领取 covenant 名下代币 |
| `amount` | int | 市场入口写 = 该赢家应得代币量 | 记账副本；真实持有量在代币 covenant（`owner = 本领取 cov id`）。两者相等是市场入口的 H5 校验保证的，不是本合约再核 |

- ctor = 三个初值（状态初始化须常量，T0 ③）；**无任何非状态 ctor 常量** ⇒ 模板对所有实例稳定（ClaimStub 三组 ctor 前后缀与 hash 同一，P12 实证）。代币 ctor 烤的就是这个 `claim_tmpl_prefix/suffix/hash`。
- 领取 covenant 的 UTXO 本身只带 dust KAS（**Q3**：多少、谁付——结算 tx 的 fee 输入付，与 (c) F2 的派彩 intent 同一笔）。

### 2.2 入口（一条）
```
entry spend(sig s, int tok_in_idx, int tok_out_idx, int dest_idx, TokenState tok_out, byte[] tok_prefix, byte[] tok_suffix)
    require(checkSig(s, winner_pk));                                    // H4: 只有赢家能动
    // H5(本合约也是"会与代币共花的入口"): 核本笔里以本 covenant 为 owner 的代币输出去向 —— 只许两种目的地
    //   (i) 目的地是本 tx 里的一个市场模板输入(再下注): tok_out.owner == OpInputCovenantId(dest_idx) 且该输入模板 == 市场模板
    //   (ii) 目的地是本 tx 新建的领取输出(转手/拆分): tok_out.owner == OpOutputCovenantId(dest_idx) 且该输出模板 == 领取模板
    //   代币合约自己的 (b) 也核同一件事; 两边都核 = H1 与 H5 正交, 不省任何一边
    validateOutputStateWithInputTemplate(tok_out_idx, tok_out, tok_in_idx, tok_prefix.length, tok_suffix.length, blake3-verified token_tmpl_hash?)   // 见 §3.3: 领取合约没有代币模板 hash 状态 ⇒ 二选一: 烤进 ctor(稳定, 单向不成环: 领取→代币? 不, 代币烤领取 ⇒ 领取烤代币 = 环) ⇒ 只能走 witness+市场核
    // 本 covenant 花后不续约(终态): 领取 UTXO 一次性
```
🔴 **写到这里撞到一个结构点（Q1）**：领取合约要核代币输出就得认识代币模板；代币烤了领取模板 hash ⇒ 领取不能再烤代币模板（环）。两条出路：(a) 领取合约**不核**代币输出，把它交给同笔在场的**市场入口**（再下注时市场的 `register_append` 是 A 类，会核）和**代币合约的 (b)**（转手/拆分时 (b-out) 核新领取输出的模板）——即领取合约只做 `checkSig` + "本 tx 必须有一个市场模板输入或领取模板输出与 tok_out.owner 相等"的**cov-id 级**检查（不需要模板字节：`OpInputCovenantId(dest_idx) == tok_out.owner || OpOutputCovenantId(dest_idx) == tok_out.owner`）；模板归属由代币合约的 (b) 保证。(b) 领取合约的代币模板 hash 走**状态**（市场创建领取输出时把自己状态里的 `token_tmpl_hash` 一并写进去）⇒ 领取多一个状态字段 `token_tmpl_hash`，模板仍稳定（Q4 保证），核法同 §3.3（witness 供字节 + blake3 验）。**倾向 (b)**：H5 的原则是"每条共花入口自己核"，不外包给另一份合约的正确性；代价一个 byte[32] 字段。请 NWT 判。

### 2.3 谁创建它
- 市场派彩入口（RootClaim `claim_draw` / PayoutShard `claim` / CloseZkV2 `claim`/`escape_claim` / PayoutShard* `refund_claim` 等 A 类）在 `validateOutputStateWithTemplate(claim_out, ClaimState{ market_cov_id: OpInputCovenantId(this.activeInputIndex), winner_pk, amount[, token_tmpl_hash] }, c_prefix, c_suffix, claim_tmpl_hash)` 里写；`c_prefix/c_suffix` 由 witness 供、`claim_tmpl_hash` 是市场状态字段（P12 `payout_claim` 同形）。
- 同一 tx 里代币 `transfer` 的 (b-out) 也核这个输出是领取模板且 `OpOutputCovenantId(k) == next.owner`（T1 §2.2）。

## 3. 市场侧（主网集 7 合约 · T3 的形，只搭结构）

### 3.1 状态字段清单（A″：per-instance 值只能进状态）
| 字段 | 型 | 归类 | 说明 |
|---|---|---|---|
| `token_tmpl_hash` | byte[32] | **确定进状态** | 代币模板 hash（§3.3 用它验 witness 供的前后缀字节） |
| `token_prefix_len` / `token_suffix_len` | int | **确定进状态** | `validateOutputStateWithInputTemplate` 的定位参数（P12 证运行期值可用） |
| `claim_tmpl_hash` | byte[32] | **确定进状态** | 领取模板 hash（P12 `payout_claim`） |
| `pool_amount`（原 `pool_value`）、`count`、`closed`、`payoutRoot`/`refundRoot`、`local_yes/local_no`、`consolidated_pool`、`claimed_bitmap`… | 既有 | **确定进状态**（本来就是状态） | 语义从 KAS sompi 改成代币 amount；value-weld（`tx.outputs[k].value == pool_value + stake`）改成**代币 amount weld**（§3.2） |
| `market_id` / `commit_v2` / `question_hash` | byte[32] | **待 Q8**（ShardLeaf ctor 现在烤 `market_id`——A″ 下**必须**改状态） | 市场身份/问题 |
| `deadline` / `seal_count` / `min_bet` / `shard_count` | int | **待 Q8**（按市场变的进状态；跨市场常量留 ctor） | ShardLeaf ctor 现在烤 `seal_count/min_bet` |
| 委员/oracle 公钥 ×N | byte[32] × N（固定 N，**不能** byte[]） | **待 Q8**（若每市场换委员 ⇒ 状态；若全网固定 ⇒ ctor） | close_attest 4-of-5 |
| `max_ins` / `max_outs` / merkle `depth_cap` / `MAX_ITERATIONS` | int | **ctor 结构常量**（循环界，MUST ① 禁进状态） | 跨市场不变 |
| `ps_tmpl_hash` / `root_tmpl_hash` 等**市场家族内部**模板锚（ShardLeaf 烤 PayoutShard 模板、RootClose 烤 RootClaim 模板…） | byte[32] | **确定进状态**（同 A″ 理由：家族内也别互烤成环——现状是单向链 Leaf→PS→Root→Claim，烤 ctor 不成环，但 Leaf 烤了 PS 模板 hash 后 PS 一变 Leaf 模板就变；改状态则只重填初值） | 待 T3 稿逐文件核现状 |

### 3.2 入口分类（23 条 · A = 共花代币 · B = 不共花）
| 合约 | 入口 | 类 | A 类：核什么代币输出 / B 类：不在场证明 |
|---|---|---|---|
| ShardLeaf | `register_append` | **A** | bettor 的代币输入（owner = bettor 的领取 cov 或 mint 新实例）→ 输出 owner **= 本 leaf cov id**（`OpInputCovenantId(this.activeInputIndex)`），amount == stake；`pool_amount + stake` weld 改成代币 amount weld；value-weld 删除（KAS 只剩 dust） |
| ShardLeaf | `consolidate_to_payout` | **A** | 本 leaf 名下全部代币 → owner = PayoutShard 输入的 cov id（`OpInputCovenantId(ps_idx)`），amount == pool_amount |
| ShardLeaf_direct | `register_append` | **A** | 同上 |
| ShardLeaf_direct | `convert_to_rootclose` | **A** | 全部代币 → owner = RootClose 输出的 cov id（`OpOutputCovenantId(root_out)`，1:1 直转是新建输出） |
| PayoutShard | `absorb` | **A** | 输家片代币 → owner = 本 PS cov id |
| PayoutShard | `close_attest` | **B** | 委员背书，不碰币 ⇒ §3.3 不在场证明 |
| PayoutShard | `claim` | **A** | 代币 → 新领取输出（§2.3 形）；amount == merkle 叶 payout |
| PayoutShard | `cancel_attest` | **B** | 同 close_attest |
| PayoutShard | `refund_claim` | **A** | 代币 → 新领取输出（winner_pk = 原 bettor pk，amount == stake） |
| PayoutShardV2 | `absorb` | **A** | 同 PayoutShard |
| PayoutShardV2 | `close_attest` | **B** | |
| PayoutShardV2 | `cancel_attest` | **B** | |
| PayoutShardV2 | `refund_claim` | **A** | |
| PayoutShardV2 | `zk_handoff` | **A** | 全部代币 → owner = ZK 结算 covenant（CloseZkV2）输入/输出 cov id；本 PS 终态 |
| RootClose | `close_commit` | **B** | 写 outcome，value 不变 |
| RootClose | `refund_flip` | **B** | 只 flip closed |
| RootClose | `convert_to_claim` | **A** | 全池代币 → owner = RootClaim 输出 cov id |
| RootClose | `convert_to_refundclaim` | **A** | 全池代币 → owner = RefundClaim 输出 cov id（RefundClaim 若仍在集内；T1 §5 退款流输入） |
| RootClaim | `claim_draw` | **A** | 代币 → 新领取输出（P12 形 = 本稿主形）；draw-down：`consolidated − payout` 留在 root 的代币 owner 仍 = root cov id；dust-ticket spent-once 不变 |
| CloseZkV2 | `zk_close` | **B** | 只读自身状态 + ZK 验 |
| CloseZkV2 | `escape_trigger` | **B** | flag flip |
| CloseZkV2 | `escape_claim` | **A** | 逐 bettor 退回：代币 → 新领取输出（winner_pk = bettor，amount = stake） |
| CloseZkV2 | `claim` | **A** | 代币 → 新领取输出（amount = merkle 叶 payout） |
**计数**：A 15 · B 8 = 23（= 批 T v0.7 "23 条手写 entry"）。每条 A：一段 `validateOutputStateWithInputTemplate(tok_out, TokenState{ amount, owner, owner_scheme: 0x04, borrow_scheme: 0x00, borrow_guard: 0, extension_commitment: 0 }, tok_in, token_prefix_len, token_suffix_len, token_tmpl_hash)` + owner 的 cov-id 等式 + amount 等式；正反向量（反 = 同入口条件全满足、只把代币输出 owner 改到别的 covenant / 改 amount ⇒ 拒）。每条 B：§3.3 一段 + 0/1/多/差一字节四档。

### 3.3 B 类入口的不在场证明 · A″ 下的新形（本稿关键发现 · 探针 P13 待编）
- **问题**：P7 的证明比的是 `tx.inputs[i].sigScript` 尾部 == `token_tmpl_suffix`（byte[] **烤在 ctor**）。A″ 下市场**不能**烤代币后缀字节：代币模板字节含市场模板后缀（代币烤市场）⇒ 市场再烤代币后缀 = **v0.3 的环原样回来**。市场状态里只有 `token_tmpl_hash`。
- **出路（源码坐实）**：`silverscript-abi/src/lib.rs:103`：`template_hash(prefix, suffix) = blake3( ser_i64_8(len(prefix)) ‖ prefix ‖ ser_i64_8(len(suffix)) ‖ suffix )`；`silverscript-lang/src/compiler/compile/state.rs:365-` 的 `validateOutputStateWithTemplate` 在脚本里就是用 `blake3` 内建 + 8 字节定长长度重算这个 preimage 再与 expected hash 比。⇒ 合约可以自己做同一件事：**witness 供 `tok_prefix`/`tok_suffix` 字节**，`require(blake3((tok_prefix.length as byte[8]) ‖ tok_prefix ‖ (tok_suffix.length as byte[8]) ‖ tok_suffix) == token_tmpl_hash)`（状态），验过之后再跑 P7 的尾匹配循环用 `tok_suffix`。攻击者供假字节过不了 blake3；供真字节则匹配成立 ⇒ `require(!found)` 照常挡。
- **P13 探针（下一步，T0 级）**：① `blake3` 内建 + `x as byte[8]` 的 i64 序列化是否与 `serialize_script_i64(…, Some(8))` 同字节序（源码里 `TEMPLATE_PART_LENGTH_BYTES`，待读常量与编码函数）；② 与 P7 循环同合约编译、Q4 同款对照（换 `token_tmpl_hash` 值 ⇒ 宿主 hash 不变）；③ 运行期：喂真代币模板字节（P9 产物）⇒ found ⇒ 拒；喂假字节 ⇒ blake3 不等 ⇒ 拒；无代币输入 + 真字节 ⇒ pass；尾差一字节 ⇒ pass（不匹配）但 blake3 也不等 ⇒ 拒——**注意这条与 P7 的弱注入臂语义不同**：P7 里"差一字节"是输入侧的，这里字节由 witness 供，差一字节先死在 blake3。向量要把两层分开：(a) witness 字节对、输入尾部差一字节 ⇒ 不匹配 ⇒ pass（不在场成立）；(b) witness 字节差一字节 ⇒ blake3 拒。
- 若 P13 ①不成立（`as byte[8]` 字节序不同）：退路 = witness 直接供 8 字节长度编码（合约只核 `length` 与解码一致），不影响结构。

### 3.4 `settle_token` 运行期向量的喂法（P12 只到编译级）
- 代币输入在 test.json 里喂 `signature_script_hex`（附 A 方法）：尾部必须是**完整 redeem script** `prefix ‖ encode(state) ‖ suffix`（`readInputStateWithTemplate` / `validateOutputStateWithInputTemplate` 都按 sigScript 尾部 + 长度定位）；前面可以是任意 witness 推入（P7 用了 `00` 占位）。字节来源 = T1 探针 P9 的 `KanetTestToken` 产物：编译一次 ctor = 期望代币状态（amount/owner=市场 cov id/0x04/0x00/0/0）⇒ 整段 bytecode 就是 redeem；`state_span` 给出 prefix/suffix 长度 ⇒ 市场状态初值 `token_prefix_len/suffix_len/token_tmpl_hash` 从同一产物取。
- 代币输出在 test.json 里给 `script_hex = aa20‖blake2b(prefix‖encode(new_state)‖suffix)‖87`（P12 `mk_p12.mjs` 的 P2SH 算法，已对 P8 存档自检）——即再编一次 ctor = 新状态。
- 向量：`settle_token` 正（owner == 市场 cov id、amount 守恒）· 反 owner 改别的 cov id · 反 amount 改 · 反 输入尾差一字节（定位失败）· 反 `token_tmpl_hash` 状态改（模板不匹配）· 翻转臂。全部离线 cli-debugger。

## 4. T4 · 市场创世初值由 console 填的对照检查骨架

A″ 把"模板认识"从编译期搬到**创世时刻的状态初值**：填错 = 该市场永远收不到 / 派不出币（自毁，非漏洞），但要机械地防。骨架（落 T4 稿，本稿只定形）：
1. **单源产物**：`pool-bshard-artifacts.mjs`（现有 `compileSil / extractTemplateArtifact`）对 pinned 源 `sil-v1/KanetTestToken.sil` 与 `sil-v1/KanetTokenClaim.sil` 编一次，取 `{template_hash, state_span}`；**不允许**从 kanet.env / 配置表读这三个值。
2. **对照**：市场创世前，把将写进市场状态的 `token_tmpl_hash/token_prefix_len/token_suffix_len/claim_tmpl_hash` 与 ① 逐字节比；再用市场产物重算创世输出 P2SH（`prefix‖encode(初值)‖suffix`）与 tx 里的 `scriptPublicKey` 比；任一不等 ⇒ 不广播（NO TX）。
3. **落链**：市场创世 tx 走 (c) F2 的 submit-intent（kind 新增 `market_genesis`，幂等键 `genesis:<market_id>`）+ `check_utxo_landed(minDepth = REORG_SAFE_MIN_DEPTH)`；未落链的市场不开放下注（同 escrow_landed_at 硬门形，列 `market_landed_at`）。
4. **锚记录**：市场行记 `template_anchors_json = {token: {hash, span, source_sha256}, claim: {…}, market: {…}}`，供 (i) 后续每笔下注/派彩构造前再对照一次（防源文件被改后产物漂移 = 现有 K-18 coherence gate 的形），(ii) 审计。
5. **向量**：初值与产物不等 ⇒ 拒广播；P2SH 不等 ⇒ 拒；产物源 sha 变 ⇒ 拒；正向量一条。

## 5. 向量计划（骨架；数字不作排期依据）
| 组 | 内容 |
|---|---|
| T2-claim | `spend` 正（checkSig 对 + 目的地是市场输入）· 正（目的地是新领取输出）· 反 错签 · 反 目的地既非市场输入亦非领取输出（NWT §1 攻击）· 反 amount 改 · 翻转 |
| T3-A ×15 | 每条：正 + 反 owner + 反 amount（§3.2） |
| T3-B ×8 | 每条：§3.3 (a)(b) 两层 × 0/1/多匹配 |
| P13 | §3.3 ①②③ |
| settle_token | §3.4 六条 |
| T4 | §4 五条 |

## 6. 请 NWT 判
1. **Q1** 领取合约核不核代币输出：(a) 只做 cov-id 级 + 外包给市场入口与代币 (b)；(b) 加状态字段 `token_tmpl_hash` 自己核（我倾向 (b)，§2.2）。
2. **Q2** 领取 → 新领取（转手/拆分，(b-out)）要不要允许：允许 = 人与人转账面出现（测试币也许无妨），不允许 = 领取合约 `spend` 只准目的地为市场输入。
3. **Q3** 领取输出的 dust 值与付费方。
4. **Q4（= T1 Q8）** §3.1 "待 Q8" 六行：哪些按市场变。这决定 ShardLeaf 等现有 ctor（`market_id/seal_count/min_bet`）要搬多少进状态。
5. **Q5** §3.3 的形（witness 供字节 + blake3 现场验）是否接受为 B 类入口的标准形；P13 结果到了再落。
6. **Q6** 家族内部模板锚（Leaf 烤 PS、Root 烤 Claim）是否也改状态（§3.1 最后一行）。

## 7. 没核到的
- `blake3` 内建的参数形与 `x as byte[8]` 的字节序（P13 ①）；`TEMPLATE_PART_LENGTH_BYTES` 常量值（源码未读到定义处）。
- 主网集 7 文件现有 ctor 里哪些是 per-instance（只读了 ShardLeaf 的 `market_id/seal_count/min_bet`，其余 6 文件的 ctor 列表未逐个读）——T3 稿逐文件核。
- `checkSig` 在 v1.0.0 对 x-only 32 字节 vs 33 字节 pubkey 的要求（Q7/T1）。
- CloseZkV2 `claim`/`escape_claim` 的输出形（是否已是"新建输出 + merkle"）——只读了入口注释。
- RefundClaim 是否在主网集（v0.7 表未列，但 RootClose 有 `convert_to_refundclaim`）。
