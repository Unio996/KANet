> **Status**: DRAFT v0.1 — J1 主笔 · 待 J2 审 → NWT 红队 · **design-only,零实现授权**
> **授权**: Bettor 2026-08-04 派工(`#dkt3k1`,ledger (139)补6 `49608682`)= **D-012 §6-1 冻结前置①「typed attestation schema + 域分隔摘要」**。NWT 18:42Z 明确"没越边界"。
> **上位文本**: `docs/2026-08-03-oracle-skill-interface-permission-boundary-freeze-design.md` v0.5(`bc04f817`,NWT 已 GREEN)§2.1 十类绑定字段。
> **作者**: J1tn · 2026-08-04 · 全部 file:line 与外部原语现读核实(非记忆)

# FactReceipt — typed attestation schema + 域分隔摘要(冻结前置① 设计稿 v0.1)

## §0 边界(先划,免得被读成推进了一格)

- 本稿产出的是**前置件本身**:schema 定义 / 规范化规则 / 域分隔符规约 / 摘要算法规约 / 必拒用例清单。**它们是设计与测试产物,不是把契约接进生产代码。**
- 🔴 **本稿不使 D-012 冻结前置从 OPEN 变 CLOSED。** 前置① 要 CLOSED,需要的是**这份 schema 被实现 + 必拒用例真跑出红绿**。本稿只让它**可被实现**。
- 🔴 **NWT 对 v0.5 的 GREEN 是"契约条款经得住攻",不是"可以着手实现"**(他原话)。本稿沿用该边界:零代码、零表、零开关、零 lint 规则。
- **Track**:Track B 协议层。Track A 七铁律不因本稿松动一条。

## §1 复用既有资产,不新造(先查后写,查到了)

本仓**已有**一份 canonical 序列化 + 域分隔 + strict-reject 的实现,且它的注释里逐字写着本稿要防的那个坑:

`shared/lib/app-envelope-canonical.mjs`(M0c-1 信封,console 网关侧与 relay 权威验证侧**共用**的纯函数):

| 已有的东西 | 出处(现读) | 本稿怎么用 |
|---|---|---|
| 域分隔常量 | `:18` `ENVELOPE_DOMAIN = 'kanet.m0c1.app-command.v1'` | **照抄命名法**(`kanet.<域>.<对象>.v<n>`),不另起一套 |
| canonical 序列化 | `:45-65 canonicalJson` — 键**递归字典序**、只允许 JSON-safe 标量、**在场字段全部序列化**、非法类型 `throw` | **逐字节复用同一函数语义**,不写第二份 |
| **"绝不静默剥除未知键"** | `:41-43` 注释原文:「**在场字段全部序列化(绝不静默剥除未知键 — 两份语义不同的载荷不可能产出同一 canonical 字节)**」 | 正是 Bettor 点名的 feeRules 坑,**本仓已经解过一次**;本稿把它从注释升成 schema 条款 |
| strict-reject 结构校验 | `:101-115 validateEnvelopeStructure` — **恰好这些键、恰好这些类型**,未知键即拒(`:104`) | **照搬形状**,换成 FactReceipt 的字段表 |
| 签名消息定义 | `:91-94 envelopeSigningMessage` = `canonicalJson(全对象去 signature)` | 同形状,但**摘要层加域分隔**(见 §4,这是本稿唯一实质新增) |

🔨 **判据**:**"我们没有这个能力"必须先去查,再决定造不造。** 本稿唯一真正新增的是 §4 的域分隔摘要与 §2 的字段表;其余全是复用。若审的人发现我这里重造了什么,请当缺陷提。

## §2 FactReceipt wire schema(v0.5 §2.1 十类 → 具体字段)

**顶层对象恰好 17 个键,多一个少一个都拒。** 类型列即 `validateEnvelopeStructure` 式的严格类型。

| 键 | 类型 | 对应 §2.1 类 | 说明 / 取值约束 |
|---|---|---|---|
| `protocol` | string | ① | 定值 `"kanet-fact-receipt"` |
| `domain` | string | ① | 定值 `"kanet.oracle.fact-receipt.v1"` |
| `schema_version` | number | ① | 整数,当前 `1`。**版本不匹配 = 拒,不做兼容降级** |
| `network` | string | ② | 如 `"kaspa-testnet-12"` |
| `genesis_hash` | string | ② | 64 hex。**网络名可以重名,genesis 不会** |
| `market_id` | string | ③ | |
| `market_state_version` | string | ③ | 十进制字符串。**该市场状态的单调版本**(§7-1:今天无承载物) |
| `outcome_namespace` | string | ④ | 如 `"binary-yes-no.v1"` —— **编码版本进命名空间,不另开字段** |
| `outcome` | string | ④ | 取值必须在 `outcome_namespace` 声明的集合内;**不用整数**(整数在两套编码下指不同结果,正是 ④ 要挡的) |
| `evidence_digest` | string | ⑤ | `"blake2b256:"` + 64 hex |
| `observation_anchor` | object | ⑤ | 恰好 `{source_canonical: string, finality_daa: string}` —— 承 frozen_evidence 方法论(委员**自己 fetch** `predicate.data_source_canonical` + finality 后取) |
| `committee_epoch` | string | ⑥ | 十进制字符串(§7-1:今天无承载物) |
| `committee_set_id` | string | ⑥ | 64 hex,= 该委员会集合的承诺(今天最接近的是 `pool_committee.committee_pk_hash`) |
| `signer_pubkey` | string | ⑥ | 32-byte x-only hex(64 字符) |
| `nonce` | string | ⑦ | 32-byte hex |
| `validity` | object | ⑦ | 恰好 `{not_before_daa: string, expires_at_daa: string}` —— **用 DAA 不用墙钟**:墙钟不可被 covenant 验,DAA 可以 |
| `supersedes` | null \| object | ⑧⑩ | `null` 或恰好 `{receipt_digest: string, prior_committee_set_id: string, prior_threshold: number}`(见 §2.1) |
| `policy_version` | string | ⑨ | P2 期望的策略/解释版本 |
| `signature` | string | — | 签名本身;**不进签名消息**(§4) |

> 上表 18 行含 `signature`;**签名消息覆盖的是去掉 `signature` 之后的 17 个键**。

### §2.1 🔴 第 ⑩ 类(supersede 授权门槛)怎么落进 schema

v0.5 §2.1 第 ⑩ 类要求:**supersede 的签名门槛与集合身份必须等于或高于被取代那一份,且必须显式核对同一 committee epoch。序号更晚不构成授权。**

⇒ 落法:`supersedes` 非 null 时,**验证方必须**做且只接受以下全部成立:
1. `supersedes.prior_committee_set_id` **等于**被取代那份 receipt 的 `committee_set_id`(不是"两份都有值"就算);
2. 本份的有效签名数 **≥** `supersedes.prior_threshold`;
3. 本份 `committee_epoch` 等于被取代那份的 `committee_epoch`(跨 epoch 更正**不由本 schema 授权** —— 它是另一件事,须独立授权);
4. `supersedes.receipt_digest` 等于被取代那份的**摘要**(§4 定义的那个),**不是** market_id/nonce 之类的间接指认。

🔴 **schema 层必须写死的一句**:**`nonce` 与 `validity` 的先后关系,在任何情况下都不构成 supersede 授权。** 排序只决定"哪一份更晚",授权由上面四条决定。
🔨 判据(承 v0.5):**「更正」是一次与原件同权的授权动作,不是一次记账动作。**

### §2.2 🔴 结构上不含什么(这条与"含什么"同等承重)

以下**在 schema 里没有对应键,且未知键一律拒** ⇒ 结构上不可能出现:
- 任何**交易**摘要 / txid / outpoint / 序列化交易片段;
- 任何**地址**、任何**金额**、fee、change、dust;
- 任何 payout 树 / payout root / 逐方分配。

⇒ 这就是 v0.5 §2 P1 判据「**字节里没有逐方分配**」在 wire 层的落地形态:**固定 (事实, `policy_version`) 之后,分配完全不由 FactReceipt 决定。**
⚠ 承 D-012 §2-bis 注:**receipt 内不得含交易摘要** —— 含了,上面这条不变量当场失效。

## §3 规范化规则

1. **序列化**:`canonicalJson`(`shared/lib/app-envelope-canonical.mjs:45`)语义逐字节相同 —— 键递归字典序、字符串走 `JSON.stringify` 转义、`number` 必须有限、`undefined`/`NaN`/`Infinity`/`BigInt`/函数一律 `throw`。
2. 🔴 **顺序是硬约束:先 strict-reject 验结构,后 canonicalize。任何情况下不得先规范化再校验。**
   **理由不是洁癖**:规范化的失败形态**不是"算错了"**,是**"两份不同的东西被算成同一个"** —— 而它在日志里与成功**完全同形**(今天全队在数的那一族)。把校验放在后面,等于让一份非法载荷先获得一个合法摘要。
3. **未知字段必拒**(不是忽略、不是剥掉、不是警告)。**这条写在 schema 本体里,不留给实现层手感** —— Bettor 点名的 feeRules 坑(canonicalize 静默剥未知字段 ⇒ 不同载荷同 commit)正是"留给了手感"的产物。
4. **缺字段必拒 / 类型错必拒 / 定值字段值不符必拒**(`protocol`/`domain`/`schema_version`)。
5. **嵌套对象同样 strict**:`observation_anchor` / `validity` / `supersedes` 各自是**恰好那几个键**的封闭集合,不允许扩展。
6. **数值纪律**:除 `schema_version` 与 `supersedes.prior_threshold` 外,**一切"大数"用十进制字符串**(DAA、epoch、state_version)。理由:JSON `number` 是 IEEE754,超 2^53 静默失真 —— 又一个"失败长成合法答案"。字符串侧用 `^(0|[1-9][0-9]*)$` 严格匹配,**禁前导零、禁正负号、禁空串**。
7. **hex 纪律**:全部**小写**,长度写死(64 / 64 / 64),`^[0-9a-f]{64}$`。大小写混用视为非法而非归一化 —— 归一化会制造"两份不同输入同一摘要"。

## §4 域分隔符与摘要定义(本稿唯一实质新增)

**签名消息**(承 `envelopeSigningMessage:91` 形状):
```
signing_bytes = canonicalJson(receipt 去掉 signature 键)      // UTF-8
```

**receipt 摘要**:
```
LP(x)   = 4 字节大端无符号长度 || x                            // 长度前缀
DOMAIN  = "kanet.oracle.fact-receipt.v1"                       // UTF-8, 与 receipt.domain 同值
receipt_digest = blake2b256( LP(DOMAIN) || LP(signing_bytes) )
```

**三个选择各自的理由(都请审)**:
- **blake2b-256 而不是 sha256**:`shared/lib/app-envelope-canonical.mjs:68` 用的是 sha256,而本对象**将来可能要被 covenant 验**。**SilverScript 有 `blake2b(byte[] data): byte[32]`**(现读 `/d/silverscript/docs/TUTORIAL.md:824`);**同一份 DECL.md + TUTORIAL.md 里 grep 不到 sha256 原语**。⇒ 选 sha256 = 给将来的链上验证埋一道"原语没有"的墙。**这是与既有信封的一处刻意分歧,不是疏忽。**
- **域标签必须进摘要,而不只是当字段**:`receipt.domain` 作为字段,防的是「另一个 **schema** 的对象恰好也解析成 receipt」;把 `DOMAIN` 拌进摘要,防的是「另一个**协议**的字节流与我的字节流相同」。**两者防的不是同一件事,都要。**
- **长度前缀不可省**:没有 LP,`DOMAIN || bytes` 的切分不唯一 —— 攻击者可构造另一组 (域, 载荷) 拼出同一串字节。**这是拼接歧义,不是理论洁癖。**

## §5 🔴 域分隔解决什么、不解决什么(本稿最要紧的一节)

**它解决**:另一个协议的签名被**误读**成一份合法 receipt。

🔴 **它不解决:持钥方肯签任意字节。** 现读:

| 读数 | 出处 |
|---|---|
| relay 有一个**通用消息签名原语**,对**任意字符串**用本 relay 私钥出签,**零策略、零域检查** | `kasia-relay/src/relay.mjs:638-652 case 'ecdsa_sign'`:`const message = String(cmd.message \|\| '')` → `signMessage({message, privateKey})` |
| 它的调用点**签的是各不相同的形状,共用同一把钥匙** | `pool.js:3985` 签 `JSON.stringify(unsignedPayload)`(`t:'pool_oracle_vote_v1'` 裸 JSON,**无域标签**)· `bettor-prediction-voter.js:248` 同形状 · `coord-status.js:29` 签一串 **64 字符 hex**(blake2b 摘要) · `oracle-pool.js:56/85` · `pool.js:292` |
| 命名本身是历史误名 | `coord-status-sign.mjs:6` 自陈:「底层 schnorr,历史上被项目内命名成 "ecdsa_sign" 是遗留误命名」 |

⇒ **结论(带作用域)**:
1. **域分隔是一对协议的性质,不是我单方的性质。** 我这一侧写得再严,只要**对面那些路径不要求自己的域标签**,一个签名在两套解释下都合法这件事就仍然可能 —— 而**上表那几条今天都不带域标签**。
2. 🔴 **更硬的一条**:`ecdsa_sign` 面前,域分隔**根本不是防线** —— 任何够得到它的调用方,可以**直接把一份合法 receipt 的 canonical 字节交给它签**。域分隔防的是误读,不是防蓄意构造。
3. ⇒ **本前置件不能单独关闭 P1 那一权**。真正关闭它的是 v0.5 **§4.1「签名能力必须类型受限」** —— 持钥方**自己**判定被签对象属于 attest 类。`ecdsa_sign` 与 `sign_input_for_settle`(v0.5 §3.2-1)是**同一个病的两个实例**:**策略在调用方、原语在持钥方,中间隔着 IPC。**
4. 📌 **措辞纪律(请全队照用)**:**不许说"FactReceipt 有域分隔所以 oracle 签不了别的东西"。** 正确说法:**域分隔使一份 receipt 不会被当成别的东西;它不使持钥进程失去签别的东西的能力。**

🔵 **与在册的关系**:(138)C 已挂着「M-1.1 矩阵补 `ecdsa_sign` 新调用点」。本节**不认领那张卡**,只把它与 §4.1 的连线说出来 —— 那张卡今天是"矩阵补一行",而本节说明它其实是**冻结线上的承重项**。**是否升级由 Bettor 拍。**

## §6 必拒用例清单(前置件的一部分,不是附录)

**判据:每一条的名字写着它守什么,删掉对应守卫时红的必须是它自己**(承 `[[feedback_test-name-must-be-the-one-that-reddens]]`)。

| # | 用例 | 必须红在 |
|---|---|---|
| 1 | 多一个未知顶层键 | strict-reject 未知键 |
| 2 | 多一个未知**嵌套**键(`validity.foo`) | 嵌套 strict(易漏,单列) |
| 3 | 缺任一必需键 | strict-reject 缺键 |
| 4 | 类型错(`schema_version` 传字符串 / `supersedes` 传数组) | 类型校验 |
| 5 | `protocol`/`domain`/`schema_version` 定值不符 | 定值校验 |
| 6 | 出现 `payout_root` / `amount` / `address` / `tx_digest` 任一 | = 用例 1 的特例,但**必须单列**:它守的是 §2.2 那条不变量,不是"未知键" |
| 7 | 大数用 JSON number 传(`market_state_version: 9007199254740993`) | 数值纪律(超 2^53 静默失真) |
| 8 | hex 大写 / 长度不足 / 含非 hex 字符 | hex 纪律(**不得归一化,必须拒**) |
| 9 | 十进制字符串带前导零(`"007"`)或负号 | 字符串数值正则 |
| 10 | `supersedes` 非 null 但 `prior_committee_set_id` 与被取代那份不符 | §2.1 条件 1 |
| 11 | `supersedes` 有效签名数 < `prior_threshold` | §2.1 条件 2(**这条是 NWT 的 MUST-FIX 本体**) |
| 12 | `supersedes` 跨 `committee_epoch` | §2.1 条件 3 |
| 13 | 只靠更晚的 `nonce`/`validity` 去 supersede | §2.1 那句"排序不构成授权" |
| 14 | 同一 receipt 除 `DOMAIN` 外字节相同,但域标签不同 ⇒ 摘要必须不同 | §4 域进摘要 |
| 15 | 构造 (域, 载荷) 二元组使去掉 LP 后拼接字节相同 ⇒ 摘要必须仍不同 | §4 长度前缀 |
| 16 | **阴性对照**:一份完全合法的 receipt 必须**通过**,且其摘要**可被第三方独立复算出逐字节相同** | 防"全拒型装饰"(承 (136)「永远弃权与永远通过在日志里同形」) |

🔴 **第 16 条不是凑数**:前 15 条全是"必须拒"。**一个把所有输入都拒掉的实现能让 1-15 全绿。** 没有 16,这套用例挡不住一个恒拒的实现。

## §7 诚实标注:今天没有承载物的字段

**schema 要求它在 ≠ 今天有东西能填它。** 这一格最容易被读成"已推进一格",所以单列:

| 字段 | 今天的状况(现读) |
|---|---|
| `market_state_version` | **无承载物**。今天没有一个单调的市场状态版本可引。**不得**拿 `protocol_status` 顶替(它是枚举不是版本) |
| `committee_epoch` | **无承载物**。`bettor-prediction-voter.js` 的 `unsignedPayload` 里有 `epoch: 1` 硬编码常量 ⇒ **是占位不是 epoch** |
| `committee_set_id` | 有**近似**承载物 `pool_committee.committee_pk_hash`;是否满足"集合标识"的语义须 J2 判 |
| `policy_version` | **无承载物**。费率/政策今天没有版本标识 |
| `observation_anchor` | 方法论已成文(frozen_evidence / `predicate.data_source_canonical`),**字段无承载物** |
| `supersedes` | **无承载物**,今天不存在更正机制 |

⇒ **对前置① 的意义**:本 schema **可被实现**,但**填满它需要先造出上面这些量**。**这些不在本稿范围,也不在本稿预算。** 谁引用本稿时说"字段已绑定 X",请先回来看这张表。

## §8 证据层级自标(D-012 §5 纪律)

| 陈述 | 层级 |
|---|---|
| §1 既有资产的每一行 | `[CONFIRMED·源码实读]` `shared/lib/app-envelope-canonical.mjs:18/41-43/45-65/91-94/101-115` |
| §4 SilverScript 有 blake2b、grep 不到 sha256 原语 | `[CONFIRMED·外部文档实读]` `/d/silverscript/docs/TUTORIAL.md:824`;**作用域**:只覆盖 `docs/DECL.md`+`TUTORIAL.md` 两份,**未读编译器源码** |
| §5 `ecdsa_sign` 通用盲签 + 六个调用点 | `[CONFIRMED·源码实读]` `relay.mjs:638-652` 等,file:line 见表 |
| §7 各字段无承载物 | `[CONFIRMED·grep 实读]`,**但"无承载物"是全称否定** ⇒ 作用域 = 我搜过的路径;J2 若知道别处有,请当缺陷提 |
| **本稿 §2/§3/§4/§6 全部** | **`[DESIGN-ONLY·零实现·未审]`** —— schema 不存在于代码,用例一条没写。**本稿不使冻结前置① 从 OPEN 变 CLOSED。** |

## §9 交审点名

1. **@J2**:①`committee_set_id` 用 `committee_pk_hash` 够不够(它是**选择序**哈希,而 §2.1 条件 1 要的是集合身份 —— 选择序不同但集合相同时会不会误判)?②§7 那几个"无承载物"里,有没有哪个其实你域内已有?
2. **@NWT(红队)**:请优先攻 **§5** —— 我主张"域分隔在 `ecdsa_sign` 面前不是防线"。若你认为我把域分隔的作用**说小了**(它其实能挡住某类蓄意构造),请给反例;反之若你认为 §6 那 16 条里**缺一条能让整套用例全绿而实现仍然错**的,那条比什么都值钱。
3. **@Bettor**:§5-3 那条(`ecdsa_sign` 从"矩阵补一行"升为冻结线承重项)要不要立卡,归你拍。**我不自行开卡。**

---

**本稿不改任何代码,不建任何表,不动任何开关。** 下一步 = J2 审 → NWT 红队 → Bettor 收。
