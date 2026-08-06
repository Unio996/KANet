> **Status**: DRAFT v0.1 · 作者 J3(J1 顶替工作代理,Bettor 派工)· 2026-08-06 · DESIGN-ONLY 零实现授权 · 待 NWT 红队
> **授权**: D-012 §6-1 冻结前置⑥(`docs/DECISIONS.md:69` 六条前置之⑥「候选 A 的规范输入集/输出集重算与绑定设计」)。Bettor 2026-08-06 直令派工。
> **约束**: 本稿只新增本文件,零代码/零 DB 写/零链上/零频道/零 commit。对 settler / P1 / pool 全部只读。每条事实断言带 file:line(本会话现读核实,非记忆);推断显式标注。
> **证据分级**: `[CONFIRMED·源码实读]` 现读代码坐实 / `[CONFIRMED·DB实读]` 对 live `data/console.db` 只读 PRAGMA 坐实 / `[CONFIRMED·外部文档实读]` 现读 silverscript 文档坐实 / `[推断]` 带依据的推理 / `[未验]` 需实测或他人 domain 才能定。
> **上位文本**(不与之冲突,冲突以上位为准):`docs/DECISIONS.md` §2-bis Codex 第三轮三条 · `docs/2026-08-03-oracle-skill-interface-permission-boundary-freeze-design.md` §2.2 · `docs/2026-08-04-fact-receipt-typed-schema-and-domain-digest-design.md`(摘要/域分隔规则唯一来源,本稿不另立第二套)· `docs/2026-08-06-precond3-v07-tx-shape-sighash-analysis-v0.1.md`(前置③,本稿 §5 与之接缝)。

# 候选 A · 规范输入集/输出集重算与绑定设计(D-012 §6-1 冻结前置⑥)

## §0 作用域与本稿要回答的那一个问题

`docs/DECISIONS.md:64` 逐字写死的要求:

> **P2 仅"纯函数确定性"不足**: 两节点确定性一致 ≠ 用了同一个完整输入集。P2 须消费并承诺**规范输入集对象**(前态 outpoint/版本、每笔注的 outpoint/txid + 地址承诺 + 方向 + 金额、确定性去重与排序、政策/费/bond/dust/change 版本、输入集 merkle root、payout-root 与总额记账)。🔴 **证明不了该输入集的参与者必须 `verifier-inconclusive`、不产生任何授权,且【不得回落到候选 B 去签名】。**

**作用域(先划,免得本稿被引用到不该去的地方)**:

| 轴 | 本稿覆盖 |
|---|---|
| **主体** | **子集②(v0.5/v0.6 committee-sig,当前 live 主力)** —— 候选 A 的家在 `handlePoolOracleTxSignReq`(`kasia-console/src/services/trade-protocol-filter.js:541`),这是 PB-S8-2 两个候选共同的插入点(`docs/2026-08-03-pbs8-2-payout-byte-binding-design.md:27`)。 |
| **参照** | **v0.7 ZK-native** —— 它**已经有一个部分实现的规范输入集绑定**(§3.1),本稿把它当**既有资产**读,不重造;`docs/2026-08-06-precond3-…-v0.1.md` 已分析其交易形状。 |
| **不覆盖** | 不改 D-012 §0 Track 边界;不提议拆任何墙;不定 P1 FactReceipt 的字段(那是前置①,本稿只**引用**它的摘要规则)。 |

**本稿的一句话结论(§1/§2 展开)**:
🔴 **今天在候选 A 的插入点上,「规范输入集」这个对象【不存在】—— 不是"存在但弱",是"零"**。签名决策消费 7 个由**消息自带**的值,其中**只有 1 个(winner)被交叉核过**;而生产这些字节的一侧(`dispatchPhase2`)所依据的输入集,**全部来自本机 DB 与代码常量,没有任何一项被承诺、被比对、或被跨节点收敛**。
🔵 **而 v0.7 那条路上,这个对象的骨架已经存在并在链上被强制**(`betsRoot` 烤进 covenant + guest journal 绑定,`CloseZkV2.sil:45`)—— ⑥ 对子集② 要做的**不是从零发明,是把 v0.7 已有的形状补齐四个缺口后搬过来**。

---

## §1 今天的实况:P2 实际消费什么,来源是什么,哪些可控可伪

**判据(承 memory `feedback-verify-value-source-checker-must-access-binding-at-decision-time`)**:每个值追到来源;凡 **caller-fed / witness / 消息自带 / 决策时才读的可写本地态** = 可控可伪。

### 1.1 签名决策点(候选 A 的插入点)消费的全部输入 `[CONFIRMED·源码实读]`

`handlePoolOracleTxSignReq`(`trade-protocol-filter.js:541-700`)。分派点 `:109`,**分派前对消息发送方零认证**(该 case 无任何 sender 校验;配 memory `reference-bcast-sender-address-is-output0-spoofable`)。

| # | 值 | 来源 | 决策时用途 | 今天被核过吗 |
|---|---|---|---|---|
| 1 | `msg.market_id` | **消息** | `:553` 选 market 行 / `:570` 选委员集 / `:628` 选自己的票 | ❌ 无 |
| 2 | `msg.winner` | **消息** | `:643` 推 `expectedOutcome` | ✅ **唯一被核的**:`:644-647` 与本机自己那条 `pool_oracle_vote` 比对(PB-S8-1) |
| 3 | `msg.input_count` | **消息** | `:542` 列为 required —— 🔴 **之后全函数再无一次读取**(本会话对 `541-720` 区间逐行 grep,`input_count` 仅出现在 `:542`) | ❌ 无;**它是一个看起来像判据、实际不参与任何判定的字段** |
| 4 | `msg.spine_input_count` | **消息** | `:585` `Number(msg.spine_input_count) \|\| 1` → `:649` 决定**对多少个 input 出签** | ❌ 无 |
| 5 | `msg.unanimous` | **消息** | `:587` 与 6 合取决定弃签 | ❌ 无 |
| 6 | `msg.silent_oracle_index` | **消息** | `:587-588`、`:600-603` 决定**本委员是否跳过签名** | ❌ 无 |
| 7 | `msg.phase2_tx_obj` | **消息**(`:562`,优先于本地 meta) | `:668` 转 safe_json → `:669-674` **就是被签的那串字节** | ❌ **零校验**(金额/地址/输入集/输出集/fee 全部不看) |
| 8 | `market.metadata.phase2_tx_obj` | 本地 DB(fallback,`:562`) | 同上 | ❌ 无;且 `metadata` 是**单个 JSON blob、多写者共享同一次可写性**(同 `docs/2026-08-04-fact-receipt-…-design.md:187` 对 `refund_authorization` 的同族判词) |
| 9 | `pool_committee.committee_pks` | 本地 DB `:570` | `:598` 成员资格 | 本机表(系统级假设,承前置① §9-2 NWT 边界) |
| 10 | `relay_nodes.is_oracle=1` | 本地 DB `:578-580` | 选哪些本机身份去签 | 同上(D-012 §6 已记该列决定"谁能签") |
| 11 | 自己的 `pool_oracle_vote` 行 | 本地 DB `:621-628` | PB-S8-1 比对 | 同上 |

🔴 **⇒ 可控可伪(消息自带、签名者无从独立取得)= 7 个(#1-#7),其中被核过的 = 1 个(#2 winner)。** 其余 6 个里,#7 是被签字节本体,#4/#6 直接决定"签几个 input / 本委员签不签"。
🔴 **relay 侧同样不看**:`sign_input_for_settle`(`kasia-relay/src/relay.mjs:711-777`)对 tx 内容**零校验**,两条反序列化分支都硬编码 `SighashType.All`(`:738` / `:772`)⇒ **委员对整笔交易是 SIGHASH_ALL 盲签**(与前置③ §3 结论同源)。

### 1.2 生产侧(`dispatchPhase2`)实际用来算 payout 的输入集 `[CONFIRMED·源码实读]`

候选 A 要"独立重算比对",重算的对象就是这一套。逐项追来源(`kasia-console/src/services/pool-market-settler.js`):

| # | 输入 | 出处 | 来源类 |
|---|---|---|---|
| a | 每笔注 `{bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index}` | `:1988-1994`(`pool_bettor_sides`,`ORDER BY merkle_index ASC`) | **本地 DB**(ingest 完整性决定对错 —— r402 同款残余风险) |
| b | maker 方向与本金 | `:2006-2007`(`market.outcome_side` / `market.maker_stake_amount`) | 本地 DB |
| c | 委员收款地址 | `:2013-2014`(`market.oracle_relay_ids`) | 本地 DB(抽样那刻写死) |
| d | broker 收款地址 | `:2036-2044`(由 `market.broker_pk` pk-derive) | 本地 DB |
| e | bettor / maker 收款地址 | `:2069-2076` / `:2090-2099`(pk-derive) | 本地 DB(pk 派生,跨节点确定) |
| f | `brokerFeePct` | `:2243` `market.broker_fee_pct` | 本地 DB **列存在** |
| g | `oracleBond` | `:2246` `market.oracle_bond_amount` | 本地 DB **列存在** |
| h | 🔴 `oracleFeePct` / `makerFeePct` | `:2244-2245` `market.oracle_fee_pct \|\| 100` / `market.maker_fee_pct \|\| 10` | 🔴 **这两列在 live 库的 `pool_markets` 上【不存在】** `[CONFIRMED·DB实读]`(本会话只读 `PRAGMA table_info(pool_markets)`:`oracle_fee_pct=false` / `maker_fee_pct=false`;`miner_fee`/`oracle_bond_amount`/`broker_fee_pct`/`fee_rules` 均 `true`)⇒ **两个费率恒等于代码里的常量 100 / 10,是【部署代码版本】的属性,不是市场的属性。** |
| i | `minerFee` | `:2229-2239`:v0.6/v0.7 用 `dynamicFee`,由 `:2197-2215` 的字节量估算 + `:2219` `MASS_MULTIPLIER_X10=30` + `:2226-2230` 算出 | **代码常量 + 本地 metadata**(`metaForFee.spine_redeem_script_hex`,`:2199`)⇒ **不是持久化值,是每次现算的** |
| j | `oracleCount` / `committeeMode` | `:2250-2251`(由 `market.protocol_version` 推) | 本地 DB |
| k | 委员质押权重 | `:2295` `getCommitteeStakesCanonical` → `:1955-1962`(`pool_snapshots` × `pool_committee.committee_pks`) | 本地 DB |
| l | 输入 outpoint 集 | `:2351-2365`:`market.spine_lock_tx:0` + `chain_events` 里 `pool_oracle_deposit` 的 `deposit_tx:0` × N + 每笔注 `side_lock_tx:0` | 本地 DB |
| m | 输入**面值** | `:2370-2374`:`market.maker_stake_amount` / `market.oracle_bond_amount` / `s.stake_amount` | 🔴 **本地 DB 列,不是链上现查** —— 与 v0.7 从 redeem 链锚现读 `consolidatedPool`(`bshard-close-enforce.mjs:96` `_readPsConsolidatedPool`)形成直接对照 |

**生产侧唯一存在的闭合检查**:`:2339-2345` ⑥守恒 assert(`Σoutputs == totalPool − minerFee`,不闭则 abort)。
🔴 **它只在生产者自己进程内跑**;`phase2_tx_obj` 一旦落进 `metadata`(`:2488-2502`)并被广播(`:2596-2602`),接收方**没有任何东西可以重放这个断言** —— 因为 (h)(i)(m) 三项接收方要么取不到、要么取到的是自己代码里的常量。

### 1.3 §1 小结:三条承重读数

1. 🔴 **签名侧零输入集**:候选 A 的插入点今天不消费任何输入集对象,只消费 7 个消息字段 + 4 个本机表。
2. 🔴 **政策不是数据,是代码版本**:`oracle_fee_pct`/`maker_fee_pct` 无列(`[CONFIRMED·DB实读]`),`minerFee` 现算。**两个跑着不同代码版本的节点会"确定性地"算出不同 payout,而双方都认为自己对** —— 这正是 `DECISIONS.md:64` 那句话所描述的失败形态,在本仓有一个具体载体。
   🔵 **而这些值的权威副本其实在链上**:`oracleFeePct` 是 spine 合约的 ctor 参数,建市时烤进 P2SH(`kasia-console/src/api/pool.js:654-657` 收参 → `:747 computeSpineP2SH({… oracleFeePct …})` → `kasia-console/src/lib/pool-p2sh.mjs:138,152` 进 ctor)。`pool.js:3362` 的注释自陈「oracle_fee_pct not directly stored」。⇒ **§2 的政策字段应当从 redeem 反推,不是从 DB 查。**
3. 🔵 **输入面值来源不对称**:子集② 从 DB 列取(`:2370-2374`),v0.7 从 redeem 链锚现读(`bshard-close-enforce.mjs:96/515`)。**后者是对的做法,已在本仓跑着。**

---

## §2 规范输入集对象(CanonicalInputSet, 下称 CIS)定义

### 2.0 先查资产:哪些已经有了,本稿只补缺口 `[CONFIRMED·源码实读]`

| Codex 六项(`DECISIONS.md:64`) | v0.7 现状 | 子集② 现状 |
|---|---|---|
| ① 前态 outpoint + 版本 | 🟡 **半有**:`consolidatedPool` 从被签 tx 的 PS input redeem 链锚现读(`bshard-close-enforce.mjs:96/510-515`);但**没有 outpoint 本身**进任何承诺 | ❌ 无 |
| ② 每笔注 outpoint/地址/方向/金额 | 🟡 **半有**:`betsLeaf = blake2b(pk32 ‖ i64le(stake,8) ‖ i64le(dir,1))`(`pool-payout-root.mjs:49-55`)—— **有 pk/stake/direction,没有 outpoint** | ❌ 无 |
| ③ 确定性去重与排序 | 🟡 **半有**:`canonicalBetOrder` 按 `side_lock_daa ASC` + `side_lock_tx` tiebreak、缺任一即 fail-loud(`pool-payout-root.mjs:66-78`);🔴 **但排序键本身不在叶子里** ⇒ 排序输入未被承诺 | ❌ 无(`:1993` 只有 `ORDER BY merkle_index ASC`) |
| ④ 政策/费/bond/dust/change 版本 | ❌ 无版本标识(`deriveSettlementFeeLeaves` 的 feeLeaves 是**调用方传入**,`zk-prove-enqueue.mjs:36/69-71` 只验非空) | ❌ 无,且见 §1.3-2 |
| ⑤ 输入集 merkle root | 🟢 **有**:`computeBetsRoot`(`pool-payout-root.mjs:85-90`)—— 但它是 **hash-chain 不是 merkle**,`:18` 自陈「不可做 membership proof」 | ❌ 无 |
| ⑥ payout-root + 总额记账 | 🟢 **有**:`payoutRoot` depth-10 position-aware merkle(`pool-payout-root.mjs:92-107`)+ `Σleaf == consolidatedPool` 硬门(`zk-prove-enqueue.mjs:82-87`) | 🟡 生产者侧有 ⑥守恒 assert(`:2339-2345`),**验证者侧无** |

🔨 **判据(本节最值钱的一句)**:**⑥ 不是"造一个新对象",是"把 v0.7 已有的 `betsRoot` 从【三元组的链】升成【带 outpoint 与政策的集合承诺】,再把它搬到今天什么都没有的子集② 上"。** 任何重造 canonicalJson / 第二套摘要 / 第二种排序的实现,按本仓在册纪律(`fact-receipt` §1 / `pool-payout-root.mjs:57-60` 「全系统只此一处定义 bets 的 canonical 序」)当缺陷提。

### 2.1 CIS 字段表(逐条给"为什么必须在里面 / 漏了会被怎么利用")

**顶层合法键集 = 下表全部键,多一个少一个都拒**(照抄 `shared/lib/app-envelope-canonical.mjs:101-115` `validateEnvelopeStructure` 的形状 —— **恰好这些键、恰好这些类型,未知键即拒**)。
**本表不写键数字面量**(承 `fact-receipt` §2 那条自踩教训:数字会与表对不上,而照数字实现的人会拒掉每一份合法对象)。

#### A 组 · 身份与语境

| 键 | 类型 | 为什么必须在 | 漏了怎么被利用 |
|---|---|---|---|
| `protocol` | string | 定值 `"kanet-canonical-input-set"` | 跨对象类型混用 |
| `domain` | string | 定值 `"kanet.pool.canonical-input-set.v1"` | 同一串字节在别处被当作 FactReceipt / ConditionReceipt 验(承 `fact-receipt` §4「域标签必须进摘要」) |
| `schema_version` | number | 整数;不匹配即拒,**不做兼容降级** | 加字段不 bump ⇒ 两份语义不同的对象同承诺(`fee-split.mjs:79-85` 已用同一条规则关掉过一次) |
| `network` + `genesis_hash` | string | 网络名可重名,genesis 不会 | 把 testnet 的输入集拿到另一条链上解释 |
| `market_id` | string | | 跨市场替换 |
| `market_state_version` | string(十进制) | 该市场状态实例的单调版本 | 状态推进后旧输入集被当成对新状态的声明 |

> 🔵 **对前置① 一处正向补充**:`fact-receipt` §7 把 `market_state_version` 标为「**今天无承载物**」。**对 CIS 而言它有** —— B 组的 `prior_state.outpoint` 就是"哪一个状态实例"的唯一确定标识(一个 covenant 状态实例 ≡ 它的那一个 UTXO)。⇒ **CIS 可以先把这一格用 outpoint 顶上,而不必等一个单调计数器被造出来。** 该顶替**只对 CIS 成立**,不得回头填进 FactReceipt(那边被禁止含任何交易字节,`DECISIONS.md:61`)。

#### B 组 · 前态(Codex ①)

| 键 | 类型 | 为什么必须在 | 漏了怎么被利用 |
|---|---|---|---|
| `prior_state` | object,恰好 `{outpoint:{txid,index}, script_pubkey_digest, value_sompi, state_digest}` | **地址是类型,outpoint 才是那一个** | 🔴 **commingled-spine 攻击族,本仓有实数**:J2 现查本机库 `protocol_version='v0.7'` 市场 3700 个、**49 组 commingled spine、最大一组 97 个市场共享同一 `spine_p2sh`**(`docs/2026-08-03-pbs8-2-candidate-b-implementation-design.md:376`)⇒ **只绑地址等于没绑**;`value_sompi` 缺失 ⇒ 池基数可被换 |

- `state_digest` 的现成载体:v0.7 = 从 PS redeem 现读的状态(`bshard-close-enforce.mjs:96 _readPsConsolidatedPool` / `:196 readPayoutShardV2AttestedState`);子集② = `blake2b(spine_redeem_script_hex)`(其本身就是 P2SH 承诺的原像)。**两者都已在仓里,不新造。**

#### C 组 · 每笔注(Codex ②③)

| 键 | 类型 | 为什么必须在 | 漏了怎么被利用 |
|---|---|---|---|
| `bets[]` | array of 恰好 `{outpoint:{txid,index}, bettor_pk, address_commitment, direction, stake_sompi, lock_daa}` | 逐笔可核而非只核聚合 | 🔴 **今天的 `betsLeaf` 只含 (pk,stake,dir)**(`pool-payout-root.mjs:49-55`)⇒ **两组完全不同的 UTXO,只要 (pk,stake,dir) 多重集与顺序相同,产出同一个 `betsRoot`** ⇒ 输入集 root 存在却**不绑哪些钱被花**。这是 ② 今天最实的缺口 |
| `order_rule` | object,恰好 `{sort_keys:[...], tiebreak, dedup_rule, rule_version}` | **排序规则本身必须是被承诺的一部分**(Codex ③ 原话) | 🔴 `canonicalBetOrder` 按 `side_lock_daa`/`side_lock_tx` 排(`pool-payout-root.mjs:73-77`),**而这两个键都不在叶子里** ⇒ 一个节点若对某笔注记了不同的 `side_lock_daa`,它会算出不同的序 ⇒ 不同 root。**今天这表现为"对不上就都拒",看似安全;但反过来:改排序规则(换代码版本)不改变任何被承诺的字节** |
| `bets_excluded[]` | array(可空) | 显式登记被排除的行及理由 | 🔴 本仓已有一个**一次性硬编码排除**:`_shard9PhantomExcludeFor`(`bshard-close-voter.js:178` 传给 `loadBettors`)⇒ **一个不在任何承诺里的排除表,会让两侧"确定性地"算出不同集合**。写进 CIS = 让它变成可比对的一行,而不是代码里的一个隐藏分支 |

#### D 组 · 非注输入(本稿新增;Codex 六项没点名,但 live 交易里有)

| 键 | 类型 | 为什么必须在 |
|---|---|---|
| `other_inputs[]` | array of 恰好 `{outpoint:{txid,index}, role, value_sompi, address_commitment}`,`role ∈ {maker_stake, oracle_bond, fee_funding}` | `requiredInputOutpoints`(`pool-market-settler.js:2361-2365`)实际有**三类** input:maker stake / N 笔 oracle bond / N 笔 bettor side。**只承诺 bets 的验证者算不出 Σin**,也就核不了总额记账。v0.7 的 `close_attest_v2` 另有 fee UTXO(前置③ §1.2 `p2sh.mjs:2022-2023`),同理 |

#### E 组 · 政策/费/bond/dust/fee 版本(Codex ④)

| 键 | 类型 | 为什么必须在 |
|---|---|---|
| `policy` | object,恰好 `{fee_rules_commit, broker_fee_bps, oracle_fee_bps, maker_fee_bps, min_broker_fee_sompi, oracle_bond_sompi, committee_mode, oracle_count, dust_absorber_rule, miner_fee_sompi, miner_fee_formula_version, policy_source}` | 见下三条 |

1. 🔴 **`oracle_fee_bps` / `maker_fee_bps` 必须显式在场且带 `policy_source`** —— `[CONFIRMED·DB实读]` 它们**没有 DB 列**,今天恒取代码常量(§1.2-h)。`policy_source` 只允许两个值:`"redeem_ctor"`(从 spine redeem 反推,唯一权威)或 `"explicit"`(显式声明并接受审计),**禁止 `"code_default"`**。
   🔨 判据:**一个"默认值"在两台机器上是两个值,而它在日志里与"配置一致"完全同形。**
2. 🔴 **`miner_fee_sompi` 必须是**值**,`miner_fee_formula_version` 必须是**版本**,两者都在场** —— `dynamicFee` 是现算的(`:2197-2230`),依赖 `MASS_MULTIPLIER_X10=30`(`:2219`)、`SETTLE_FEE_MIN`(`:2221`)、以及 `metadata.spine_redeem_script_hex` 的字节长度(`:2199-2200`)。**改这三样任一 ⇒ distributable 变 ⇒ 每个赢家的钱都变**,而这在今天不留任何痕迹。
3. `fee_rules_commit` 复用既有单源 `computeFeeRulesCommit = blake2b256(canonicalizeFeeRules(...))`(`kasia-console/src/lib/fee-split.mjs:163`),**不另造** —— 且必须与 `fact-receipt` §7 认定的「费率政策这一层今天就能填」对齐。

#### F 组 · 承诺与记账(Codex ⑤⑥)

| 键 | 类型 | 说明 |
|---|---|---|
| `input_set_root` | string,`"blake2b256:"` + 64 hex | 见 §2.3 构造 |
| `bets_root_legacy` | string 或 null | v0.7 链上已烤的那个 hash-chain 值(`CloseZkV2.sil:18 betsRootBaked`)。**并存不合并**:链上那个不能改(改 = 换 covenant),CIS 这个答的是另一个问题。🔴 CIS 验证方**必须两个都算、两个都比** |
| `outputs[]` | array of 恰好 `{index, role, address_commitment, value_sompi}`,**按交易输出顺序** | ⑥ 标题里的「**输出集**」那一半。今天生产者按固定 layout 排(`:2302-2334`:broker→5 委员→winners→makerFee→makerExtra),**这个 layout 只活在代码里** |
| `output_layout_version` | string | 同上:layout 变了必须能被发现 |
| `payout_root` | string,带算法前缀 | 复用 `payoutRoot`(`pool-payout-root.mjs:107`) |
| `accounting` | object,恰好 `{sum_inputs, sum_outputs, miner_fee, sum_fees, sum_winner_payouts, dust_absorber_index}` | **闭合等式必须在对象里可被独立验算**:`sum_outputs + miner_fee == sum_inputs`(镜像生产者侧 `:2339-2345`)。`dust_absorber_index` 必须显式(今天是隐式约定"winners[0] = 最小 merkle_index",`pool-market-settler.js:1899-1901`)—— 隐式约定换实现不报错 |

#### G 组 · 防重放信封

| 键 | 类型 | 说明 |
|---|---|---|
| `nonce` | string,32B hex | |
| `validity` | object,恰好 `{not_before_daa, expires_at_daa}` | **用 DAA 不用墙钟**(承 `fact-receipt` §2:墙钟不可被 covenant 验) |
| `producer_pk` | string,32B x-only hex | **仅归属标注,不是授权**;验证方不得据它放宽任何检查 |

### 2.2 序列化与确定性规则(全部复用,零新增)

1. **序列化** = `canonicalJson`(`shared/lib/app-envelope-canonical.mjs:45`)语义逐字节相同:键递归字典序、只允许 JSON-safe 标量、**在场字段全部序列化绝不静默剥除未知键**(`:41-43` 注释原文)、非法类型 `throw`。
2. **顺序硬约束**:**先 strict-reject 验结构,后 canonicalize**(活实例 `fee-split.mjs:146-147`:`canonicalizeFeeRules` 第一行就是 `validateFeeRules`)。
3. **数值纪律**:一切大数用十进制字符串(`^(0|[1-9][0-9]*)$`),`schema_version` 是唯一 JSON number(承 `fact-receipt` §3-6)。
4. **hex/摘要纪律**:裸 hex 字段 `^[0-9a-f]{64}$` 全小写;带算法标识的摘要字段 `^blake2b256:[0-9a-f]{64}$`;大小写混用视为非法**而非归一化**(承 `fact-receipt` §3-7 / §2.6)。
5. **UTF-8 零 normalization**(承 `fact-receipt` §2.6-②):不做 NFC/NFD/NFKC/NFKD、不折叠大小写与空白、不剥 BOM、lone surrogate 拒。
6. **`bets[]` / `other_inputs[]` / `outputs[]` 的数组序即语义序**,由 `order_rule` / `output_layout_version` 承诺;**canonicalJson 不对数组重排**(它只排对象键)。

### 2.3 `input_set_root` 构造(与前置① 摘要规则对齐,不另立)

```
LP(x)          = 4 字节大端无符号长度 ‖ x                          // 同 fact-receipt §4
DOMAIN_CIS     = "kanet.pool.canonical-input-set.v1"               // UTF-8, == 对象的 domain 字段

// 叶子:全定宽拼接(不需 LP —— 判据同 fact-receipt §1-bis-3:LP 只在【变长拼接】时必需)
bet_leaf_i     = blake2b256( LP("kanet.pool.cis.bet.v1")
                             ‖ txid[32] ‖ i32le(index) ‖ pk[32]
                             ‖ addr_commit[32] ‖ i64le(stake,8) ‖ i64le(direction,1) ‖ i64le(lock_daa,8) )
other_leaf_j   = blake2b256( LP("kanet.pool.cis.other-input.v1")
                             ‖ txid[32] ‖ i32le(index) ‖ i64le(role_code,1)
                             ‖ addr_commit[32] ‖ i64le(value,8) )
out_leaf_k     = blake2b256( LP("kanet.pool.cis.output.v1")
                             ‖ i32le(index) ‖ i64le(role_code,1) ‖ addr_commit[32] ‖ i64le(value,8) )

// 三棵子树各自 depth-10 position-aware merkle(复用 pool-payout-root.mjs:92-107 的 levelsOf,
// ZERO32 padding、blake2b、CAP=1024),再一次域分隔归并:
input_set_root = "blake2b256:" ‖ hex( blake2b256(
                     LP(DOMAIN_CIS)
                   ‖ LP(canonicalJson(policy 与 order_rule 与 prior_state 三个子对象))
                   ‖ LP(bets_tree_root) ‖ LP(other_inputs_tree_root) ‖ LP(outputs_tree_root) ) )
```

**三个选择的理由(都请审)**:
- **用 depth-10 position-aware merkle 而不是 `computeBetsRoot` 的 hash-chain**:后者 `pool-payout-root.mjs:18` 自陈「**不可做 membership proof**」。CIS 的用途之一是让第三方**只拿一笔注**就能证明它在集合里(候选 A 的假阳性诊断、跨节点争议定位都要用),chain 形态做不到。**而 depth-10 merkle 在本仓已有实现且与 SS climb 逐字节对齐**(`pool-payout-root.mjs:106-125`,`climbProof` 是 SS climb 的复制),**将来要上链验时不需要新原语**。
- **`i64le` 用 `serializeI64`**(`pool-payout-root.mjs:15-36`,JS 精确移植 rusty-kaspa `serialize_i64`)—— 不另写第二个整数编码。
- **叶子全定宽 ⇒ 不需要逐字段 LP**,但**域标签必须 LP**(它是变长的);三棵树根归并处必须 LP(变长 canonicalJson 段)。🔴 **这一条必须写死而不是"看着办"**:`computeCommitteePkHash` 就是一个裸 concat 无 LP 的既有反例,它今天安全**只因为输入恰好定宽,而函数里没有任何校验**(`bshard-close-voter.js:573-576`,`fact-receipt` §2.3 已判)。

---

## §3 承诺与验证

### 3.1 v0.7 已有的绑定链(照抄形状,不重造)`[CONFIRMED·源码实读]`

```
委员独立重算 betsRoot/refundRoot/payoutRoot          bshard-close-enforce.mjs:545/552-561/566-575/516-519
        ↓ 比对被签 tx 实际 commit 的 5 个值(D2)        bshard-close-enforce.mjs:578-582
close_attest_v2 落链 ⇒ betsRoot 进 PayoutShardV2 状态   前置③ §1.3(p2sh.mjs:2030-2039)
        ↓ genesis-mint 烤进 CloseZkV2 ctor              CloseZkV2.sil:18 betsRootBaked
guest 产 proof,journal 绑三元组                         CloseZkV2.sil:45
        journalHash = sha256(betsRootBaked ‖ byte[](attestedWinner,1) ‖ guestPayoutRoot)
        ↓ covenant 强制 journal 进 gate P2SH             CloseZkV2.sil:48-51
        require(tx.inputs[1].scriptPubKey == new ScriptPubKeyP2SH(gateRedeemHash))
```

🔵 **这就是 ⑥ 要的形状的一个活实例**:P2(guest)**必须**消费一个其承诺已被链上钉死的输入集,否则 proof 过不了 gate。**且它是链上强制,不是"谁记得去查"。**
🔴 **它的四个缺口正是 §2 补的**:betsRoot 不绑 outpoint / 不绑排序键 / 不绑政策版本 / 是 chain 不是 merkle。

### 3.2 承诺放在哪(三个位置,给结论不给菜单)

| 位置 | 强度 | 可否用于**存量**市场 | 结论 |
|---|---|---|---|
| **(a) covenant 状态 / ctor 烤死** | 最强(共识强制) | ❌ **不能** —— 烤在 genesis mint 那一刻(`CloseZkV2.sil:18` 注释:改 guest image_id = 新 covenant = 新 hash);存量盘的 redeem 不可变 | **新市场的目标形态。⑥ 应把 `input_set_root` 列为下一代 spine/PayoutShard ctor 的一个字段**,但本稿不提议改任何在飞合约(D-005/D-009 冻结精神) |
| **(b) P2 承诺对象(`ConditionReceipt`)内,签名/验签在链下** | 中(只与验证者集合一样强) | ✅ 能 | **候选 A 的落点。** 承 `fact-receipt` §2.4:`ConditionReceipt` 的消费面**逐字**就是「`FactReceipt` 摘要 + `policy_version` + **规范输入集承诺**」⇒ **CIS 就是那个位置上今天缺的东西**,本稿把它填上,不新造第四个对象 |
| **(c) 交易 payload 锚** | 弱(签名承诺、covenant 看不见) | ✅ 能 | 🔴 **不采用,但理由要记清楚**:`payload_hash` 确实进 SIGHASH_ALL preimage(前置③ §2.2,`rusty-kaspa …/hashing/sighash.rs:277`),v0.7 今天 `payload:''`(前置③ §1.5);**而 silverscript 没有 payload 内省原语** `[CONFIRMED·外部文档实读]`(本会话 grep `docs/DECL.md`+`docs/TUTORIAL.md`:`tx.version`(`TUTORIAL.md:929`)/`tx.time`(`:942`)在,**`tx.payload` 零命中**)⇒ 放进 payload 只能让签名"承诺了它",不能让 covenant"检查它"。**可作低成本审计锚,不得作授权条件** |

### 3.3 验证者如何独立重算并比对(可被红队直接攻的形态)

**记号沿用 `fact-receipt` §2.1**:`LOOKUP(x)` = 验证方**自己**从权威来源取得;`WIRE(x)` = 对象里带的值。

🔴 **总则(一条,压住全节)**:**CIS 的每一个字段在验证时都必须有一个 `LOOKUP` 来源,且该来源不得是"被验证的这条消息"。** 对象里带的值只用于**比对**,永不用于**取值**。

| 字段组 | 验证方的 `LOOKUP` 来源(按优先级) | 若取不到 |
|---|---|---|
| B 组 `prior_state` | ① 被签 tx 的对应 input redeem 现读(v0.7 既有做法 `bshard-close-enforce.mjs:96/510-515`)② 链上 outpoint 存在性 | **inconclusive**(见 §4),🔴 不得退到"地址匹配就算" |
| C 组 `bets[]` | 本机 `pool_bettor_sides`(`:1988-1994`)+ 每笔的 `side_lock_daa`/`side_lock_tx` 链锚 | 缺任一 ⇒ `canonicalBetOrder` 已 fail-loud(`pool-payout-root.mjs:70-71`)⇒ **inconclusive**,🔴 不得回退本地 id 序 |
| D 组 `other_inputs[]` | `market.spine_lock_tx` + `chain_events` 的 `pool_oracle_deposit`(`:2351-2358`) | inconclusive |
| E 组 `policy` | **从 spine redeem 反推**(`policy_source == "redeem_ctor"`);`broker_fee_pct`/`oracle_bond_amount`/`miner_fee` 另有 DB 列可作**交叉核**(不作唯一源) | 🔴 **取不到 ⇒ inconclusive,禁止用代码默认值补** —— 这正是今天在做的事(§1.2-h) |
| F 组 `accounting` | 验证方自己按 `computePoolPayouts`(`pool-market-settler.js:1818`,纯函数零 DB)重算 | 重算 throw ⇒ inconclusive |

**比对序(顺序本身是判据的一部分)**:
1. strict-reject 结构校验(未知键/缺键/类型/定值/嵌套封闭集)→ 失败即拒,**不 canonicalize**;
2. 逐字段 `LOOKUP` 取值,**任一取不到 ⇒ 立即 inconclusive**(不继续、不降级);
3. 用 `LOOKUP` 值**自行构造**一个 CIS,算出 `input_set_root'`;
4. `input_set_root' == WIRE(input_set_root)`?否 ⇒ **inconclusive 而不是"拒签后继续"**(两者的行为差别见 §4);
5. 用同一个 CIS 跑 `computePoolPayouts` → 逐笔比对 `phase2_tx_obj.outputs`(索引、地址、金额三者全等)+ 闭合等式;
6. 全过 ⇒ 才进签名循环。
7. 🔴 **C3 式 TOCTOU 闭合(照抄 v0.7 既有做法)**:验过的那一份被签字节要算 hash 带回,签名前必须 `== ` 该 hash —— `bshard-close-enforce.mjs:589` + `bshard-close-voter.js:491-493` 已是这个形状,**候选 A 必须同样做,否则"验的那个"和"签的那个"可以是两份**。

🔴 **一条容易被跳过的**:第 5 步比对的对象是 `phase2_tx_obj`,而**它自己也是消息自带的**(§1.1-#7)。⇒ **CIS 通过 ≠ 被签的字节就是 CIS 描述的那笔交易**;两者的桥是第 5 步的逐笔全等 + 第 7 步的 hash 闭合。**少任一步,CIS 就退化成一份漂亮的、与实际被签字节无关的附件。**

---

## §4 inconclusive 路径(可测试判据)

### 4.1 行为规范(三条,不许软化)

承 `DECISIONS.md:64` 与 `:70`:

1. **证不了输入集 ⇒ `verifier-inconclusive` ⇒ 零授权。** 不签名、不产生任何转移授权。
2. 🔴 **不得回落到候选 B 去签名。** B 的三个锚点(`docs/2026-08-03-pbs8-2-candidate-b-implementation-design.md` §1)**永远只有拒绝权**(该稿 §11.4 已入档 Bettor 18:24 裁定原话:「`cannot-verify` ⇒ 弃权不签、零授权,不得回落到候选 B 取得签名资格;B 永远只有拒绝权」)。
3. 🔴 **deadline 到期不得把「缺证据」变成「执行另一条不可逆钱路的许可」**(`DECISIONS.md:70` 状态机不变量)。

**🔵 这一条今天已经有一半是真的,必须如实说**:`[CONFIRMED·源码实读]` watchdog-b 早已从"强制 cancel + maker refund"改成冻结 —— `pool-market-settler.js:1400-1420`:`collecting_sigs` 超时且 `sigCount<4` ⇒ `freezeAwaitingAuthorization(...)`(定义 `:256-287`,置 `protocol_status='unresolved_needs_authorization'`,白名单式 WHERE `:274`),注释逐字写着「**签名收不齐【不是】退款授权**」「sigCount 是本机知道的签名数,跨节点回执没 ingest 时,它与"委员真的没签"读数完全相同」。
🔴 **但同一段代码的日志文案仍是旧行为**:`:1408` 打印「→ force cancel + maker refund (silent stuck)」而实际动作是冻结。⇒ **任何以日志文本为断言轴的用例会读到相反的事实**(正撞 NWT 七条第五条「行为变了,描述行为的观察量必须同批变」,`docs/2026-08-06-nwt-seven-review-criteria-v1.0.md`)。**本稿把它作为一条实读发现登记,不在本稿修。**

### 4.2 可测试判据(六条 · 与前置⑤ 共用同一份实现,不另抄一份)

**底座**:`docs/2026-08-06-precond5-verification-interrupt-no-autorefund-test-design-v0.1.md` §3 已给出六臂结构(N1/N2 阴性 + P1/P2 阳性 + A0 前提臂 + I0 仪器臂)。
🔴 **硬约束(照抄它的 §3.4-bis)**:本节的痕迹断言与⑤ 的痕迹断言**必须来自同一份 helper / 同一段 SQL**;复制的谓词会产出两个互相同意而实现已漂移的测试。

| # | 判据 | fixture | 断言(全部成立才算过) | 它防的是 |
|---|---|---|---|---|
| **C-1** | **CIS 证不了 ⇒ 零签名调用** | CIS 任一 `LOOKUP` 取不到(如 `policy_source` 拿不到 redeem)| `sign_input_for_settle` 调用次数 **== 0** | 「拒签"了但还是签了」 |
| **C-2** | 🔴 **不回落候选 B**(本稿最承重的一条) | **CIS 失败 ∧ 候选 B 三锚全过**(spine outpoint 对、毛额守恒过、非 commingled) | 调用次数 **== 0**;且 `cannot_verify` 事件落库 | 「B 过了就签」—— 这**逐字**是 Codex 禁止的回落,而它在代码上长成「检查失败才 continue」的自然形态(该稿 §10.4 已点明) |
| **C-3** | **阳性对照**:CIS 全过 ⇒ **恰好签一次** | CIS 全过 ∧ B 全过 | 调用次数 **== 期望 input 数**(非 0) | 🔴 防「恒拒型装饰」——C-1/C-2 单独可被一个"什么都不签"的实现全绿 |
| **C-4** | **零退款授权** | 同 C-1 | ① `protocol_status == 'unresolved_needs_authorization'` ② `metadata.refund_tx_obj` 不存在 ③ `refund_dispatched_at` 不存在 ④ 该市场零条 `bettor_refund_available` ⑤ `metadata.evidence_gap` **存在**(证明是被冻结逻辑处置的,不是根本没被处理) | 与⑤ N1/N2 同形,**复用其 helper** |
| **C-5** | 🔴 **时间不产生权力** | 同 C-1,再把时钟推过 `COLLECTING_SIGS_WATCHDOG_MS`(`:1402`)与 deadline | 再跑一次 tick 后 **C-4 五条仍全部成立**;`refund_authorization` 仍不存在 | `DECISIONS.md:70` 那条不变量本体 |
| **C-6** | **inconclusive 必须可计数且可分辨** | C-1 与「消息根本没到」两个 fixture | 前者产出一条带 reason code 的 `cannot_verify` 记录,后者不产出;两者**读数不同** | 「永远弃权与永远通过在日志里同形」((136) 弃权率同族);**没有这条,C-1 的"零签名"与"这台机器根本没跑"无法区分** |
| **C-7** | **仪器臂** | 纯 SQL 种一条已带签名痕迹/退款痕迹的终态行 | 读痕迹的那几个探针**逐个命中** | NWT 七条第一条;**任一探针零命中 ⇒ C-1/C-2/C-4 的"零"全部不作数** |

**注入对照(落码时必须实跑一次,承⑤ §3.4 的做法)**:把 C-2 的 fixture 里 CIS 改成合法 ⇒ **C-2 必须当场变红**。跑完还原。
🔴 **不许用改生产码的方式做注入**(钱路 + live 进程随时重载)。

### 4.3 一条必须写进 schema 层的失败语义

**「读不到判据的值」也是一种 cannot-verify,不许降级成「那就不查这层了」。**
本仓已有该形态的血案:候选 B v5 `MUST-FIX-0`(`docs/2026-08-03-pbs8-2-candidate-b-implementation-design.md:326-367`)—— 同一个漏读的列,在一处产生**恒拒**(全线停签 ⇒ 顺着推向退款),在另一处产生**恒过**(守卫 fail-open 成装饰),**而两侧的日志与正常完全同形**。
⇒ CIS 实现的第一步必须是:**承重字段缺失 ⇒ 弃权(inconclusive),不是跳过**。

---

## §5 与前置③ 的接缝:哪些归 CIS,哪些必须留给 covenant introspection

### 5.1 先确认能力边界(现读,不凭印象)`[CONFIRMED·外部文档实读]`

本会话 grep `D:\silverscript\docs\DECL.md` + `docs\TUTORIAL.md`:

| 原语 | 有无 | 出处 |
|---|---|---|
| `tx.inputs.length` / `tx.outputs.length` | ✅ | `TUTORIAL.md:923` / `:926` |
| `tx.inputs[i].value` / `.scriptPubKey` | ✅ | `:951` / `:952` |
| `tx.outputs[i].value` / `.scriptPubKey` | ✅ | `:970` / `:971` |
| `tx.version` / `tx.time` | ✅ | `:929` / `:942` |
| `blake2b` / `sha256` | ✅ | `:826` / `:835` |
| `checkSigFromStack(sig, digest32, pk)`(验**合约自定义 digest**,非 tx sighash) | ✅ | `:851` |
| `readInputState` / `readInputStateWithTemplate`(读**别的 input** 的状态;后者额外验模板 hash 且检查 redeem 字节与该 input 的 P2SH spk 相符) | ✅ | `:1043` / `:1049` / 语义 `:1080-1083` |
| `OpInputCovenantId` / `OpCovInputCount` / `OpCovOutputCount` | ✅ | `DECL.md:17,184` / `:273-274` |
| 🔴 **input 的 outpoint(txid:index)** | ❌ **两份文档 grep `outpoint`/`txId`/`transactionId`/`prevout` 零命中** | — |
| 🔴 **`tx.payload`** | ❌ 零命中 | — |

> **作用域**:只覆盖 `DECL.md` + `TUTORIAL.md` 两份,**未读编译器源码**。若有人在 `silverc` 源码里找到 outpoint 内省,本节 §5.2 的分配要重划 —— **请当缺陷提**(同 `fact-receipt` §8 的同款作用域标注)。

🔨 **这条读数直接决定 §5.2 的分配,而它是"能不能做"不是"想不想做"**:**covenant 能看见"这笔交易长什么样",看不见"这些钱是从哪一笔来的"。** 前者归 covenant,后者只能归 CIS。

### 5.2 分配表(接前置③ §4 那张"已强制/未强制"表)

| ③ §4 编号 | 字段 | ③ 的现状判定 | ⑥ 的分配 | 理由 |
|---|---|---|---|---|
| **A** | `input 数 == 期望值` | 未强制 | 🔵 **covenant**(`tx.inputs.length`) | 是"这笔交易的形状";covenant 检查由共识强制,CIS 检查只由"愿意去验的人"强制 |
| **B** | `output 数 == 期望值` | 未强制(且随 change 是否 dust 在 1↔2 漂) | 🔵 **covenant**(`tx.outputs.length`)+ **CIS 侧 `output_layout_version`** | 数量归 covenant;"第 k 个是谁的"归 CIS(covenant 看不见收款人身份的语义,只看得见 spk 字节) |
| **C** | `output[selfOutIdx]` 的 SPK 模板 + value | **已强制(双重)** | 保持 | 前置③ 已实证 |
| **D** | 其余每个 output 的模板 + 金额来源(尤其 change) | 未强制 | 🔵 **两边都要**:covenant 逐 output 比 `value`+`scriptPubKey`;CIS 的 `outputs[]` + `accounting` 提供"这些值本该是多少" | covenant 只能验"等于我烤死的那个",算不出"该是多少";CIS 算得出但强制不了。**分开做,两边都不完整** |
| **E** | fee 上界 | 未强制(只有下界) | 🔵 **covenant**(`Σtx.inputs[i].value − Σtx.outputs[j].value ≤ 上界`,两个原语都有)+ CIS 的 `miner_fee_sompi` 作期望值 | 同 D |
| **F** | `selfOutIdx` 指向真 continuation | 已强制 | 保持 | |
| **G** | `tx.version >= 1` | 已强制(委员侧) | 保持;🔴 链侧行为仍是前置③ §6-2 的开放题 | |
| **—** | 🔴 **前态 outpoint(哪一个 UTXO)** | ③ 未列 | 🔴 **只能 CIS**(§5.1:无 outpoint 内省) | covenant 侧最接近的替代 = `OpInputCovenantId` + `readInputStateWithTemplate`,它能证「这个 input 是同一 covenant 域、同一模板、状态是 X」,**证不了「是那一笔」** ⇒ **commingled-spine 那 49 组共享地址,covenant 分不开,CIS 能** |
| **—** | 每笔注的 outpoint / 排序键 / 政策版本 / 被排除的行 | ③ 未列 | 🔴 **只能 CIS** | 全部是"这笔交易之外的世界的状态",covenant 结构上看不见 |

🔨 **一句话分配律**:**凡是「这一笔交易自身的形状」⇒ covenant;凡是「这一笔交易之外的世界的状态」⇒ CIS。** 前者不写进 CIS(写了也只是一份没牙的副本);后者不指望 covenant(它看不见)。

### 5.3 与前置① 的接缝(不重叠、不打架)

- `FactReceipt` **禁止**含任何交易字节/地址/金额(`DECISIONS.md:61`)⇒ **CIS 不是 FactReceipt 的字段,是 `ConditionReceipt` 消费的另一个对象**(`fact-receipt` §2.4 的三对象表逐字要求 `ConditionReceipt` 消费「FactReceipt 摘要 + policy_version + **规范输入集承诺**」)。
- ⇒ **CIS 不进 P1 签名面** ⇒ 前置③ §5.1 那条「payout 变化不改变 P1 字节」的不变量**不被本稿破坏**。
- `policy_version` 的归属:`fact-receipt` §2.4 把它从 FactReceipt 移进 `ConditionReceipt`。**CIS 的 E 组 `policy` 必须与那个 `policy_version` 对得上**(同一个版本标识,两侧比对),**不另立第二个版本轴**。

---

## §6 落地量级估算(不是写码,不构成排期承诺)

| # | 要动的地方 | 量级 | 依赖 |
|---|---|---|---|
| 1 | 新 `shared/lib/canonical-input-set.mjs`:schema 表 + strict-reject + 三棵树 + root。**复用** `canonicalJson` / `serializeI64` / `levelsOf` | 小-中(≈1 文件,无新算法) | 无 |
| 2 | **补齐政策取值**:从 spine redeem 反推 `oracleFeePct`/`makerFeePct`/`minerFee 期望`(今天无 DB 列,§1.2-h) | 🔴 **中-大,且是本卡真正的成本中心** | 需 J2 确认 v0.5/v0.6/v0.7 各自 ctor 布局与偏移(同 `bshard-close-enforce.mjs:148-154` 那组硬编码 offset 的 DoD 风险) |
| 3 | `handlePoolOracleTxSignReq` 插入 CIS 验证(在 PB-S8-1 之后、签名循环之前)+ C3 式 hash 闭合 | 中 | 依赖 1、2;🔴 **候选 B v5 `MUST-FIX-0` 是硬前置** —— 那条 SELECT(`trade-protocol-filter.js:553-555`)只取 `id/protocol_status/metadata`,CIS 要的列**一个都不在 row 上** |
| 4 | inconclusive 路径:reason code + 可计数事件 + 与 `freezeAwaitingAuthorization` 对接 | 小-中 | 依赖 P1 卡已落的冻结态(`:256-287`,已在) |
| 5 | §4.2 七条用例 + 注入对照,进 `test-framework/cases/` | 中 | 🔴 **必须与前置⑤ 共用同一份痕迹 helper**;且 runner 扫描面问题(CLAUDE.md 已记 `cases/m0c1-gate/` 10 个文件无一匹配 `*.test.mjs`)要一并解决,否则"加了用例"≠"跑得到" |
| 6 | 生产侧对称改造:`dispatchPhase2` 产出 CIS 并随 `phase2_tx_obj` 一起广播 | 中 | 依赖 1;🔴 **广播体积**:`phase2_tx_obj` 已需 chunked(`:2618`),CIS 再加 `bets[]` 逐笔 ⇒ 需评估是否只广播 root + 各方本地重建 |
| 7 | (不在本卡)新市场 ctor 烤 `input_set_root` | — | D-005/D-009 冻结精神;**需独立决策,本稿不提议** |

**依赖谁**:J2(settler/pipeline 域 + redeem 布局 + 候选 B MUST-FIX-0)· NWT(红队 + §5.1 作用域复核)· Bettor(排期与 §7-1 的裁定)。

---

## §7 开放问题(答不了的如实列)

1. 🔴 **CIS 的验证失败,在"本机数据不全"与"对方在骗"之间不可分辨 —— 而两者的正确处置可能不同。** `[未验]`
   候选 A 从提出那天起就带着这个问题(`docs/2026-08-03-pbs8-2-payout-byte-binding-design.md:29`「一个 ingest 不完整的委员节点会对**正确**的 tx_obj 报不一致而拒签」)。本稿的答案是**两者都走 inconclusive**(§4.1),理由是「不产生授权的东西不能用来补一个证明不了的位置」。
   🔴 **但代价必须说**:弃权变多 ⇒ 签名更难凑齐 ⇒ 更多市场进冻结态 ⇒ **压力全压在 `authorizeRefundByOwner` 这个人工出口上**(`:289-296`,operator 手动脚本、不开 HTTP 面)。**这个出口的吞吐够不够,不是我能判的** —— 需 Bettor 按运营实况裁。
2. **`policy_source == "redeem_ctor"` 在 v0.5/v0.6 上能不能真做到?** `[未验/需 J2]`
   v0.7 有现成先例(`_readPsConsolidatedPool` 从 redeem 现读),但 v0.5/v0.6 的 spine ctor 布局与偏移我没有逐字节核过。若做不到,E 组只能退到 `"explicit"`,而那意味着**费率仍然由构造方声明** —— 那正是「由被检查方提供的门槛不是门槛」(`fact-receipt` §2.1)。
3. **`bets[]` 逐笔上线的广播体积。** `[未验]`
   一个 400 注的市场,`bets[]` 逐笔约 400 × ~150B ≈ 60KB,远超 `SAFE_CHUNK_BUDGET`(`:2618` 注)。**只广播 root + 各方本地重建**是显然的省法,但它把"两边用的是同一集"这件事又交还给了本地数据 —— **这个折衷怎么取,需要 NWT 判它是否把 CIS 削回成"确定性一致"那个被否掉的形态**。
4. **`market_state_version` 用 `prior_state.outpoint` 顶替(§2.1 A 组注)是否成立。** `[推断,待 NWT 判]`
   我的理由:一个 covenant 状态实例 ≡ 它的那一个 UTXO。**反例可能在**:同一状态在 mempool 与 accepted 之间、或在链重组两侧,可能有两个 outpoint 指向"同一个语义状态"。**我没有实测过 TN12 的重组行为。**
5. **前置③ §6-2 的 version<1 绕过题,对 ⑥ 是不是也承重。** `[未验]`
   若共识接受 version<1 且忽略 covenant 强制,则 §5.2 里所有"归 covenant"的格子在那条路径上一起失效 ⇒ **CIS 会从"两条腿之一"变成"唯一那条腿"**。**这道题归③,但 ⑥ 的分配律依赖它的答案。**
6. **候选 B 的三个锚点在 CIS 上线后还留不留。** `[待 Bettor 裁]`
   按 §4.1-2,B 只有拒绝权;CIS 上线后 B 的每一条都被 CIS 严格包含。**保留 B = 多一条更便宜的早拒路径(省算力);删掉 B = 少一处会漂的重复实现。** 两边都有理,我不替 Bettor 拍。

---

## §8 证据层级自标(D-012 §5 纪律)

| 陈述 | 层级 |
|---|---|
| §1.1 七个消息字段与各自用途、`input_count` 未被读取 | `[CONFIRMED·源码实读]` `trade-protocol-filter.js:541-720`(区间逐行 grep,`input_count` 仅 `:542` 一处) |
| §1.2 生产侧 13 项输入来源 | `[CONFIRMED·源码实读]` `pool-market-settler.js:1818/1985-2374/2488-2502/2596-2602` |
| 🔴 `oracle_fee_pct` / `maker_fee_pct` **无列** | `[CONFIRMED·DB实读]` 本会话对 `D:/kanet-tn12/kasia-console/data/console.db` 只读 `PRAGMA table_info(pool_markets)`;**作用域 = 本机这份库**,别的节点未查 |
| §2.0 v0.7 六项现状 | `[CONFIRMED·源码实读]` `pool-payout-root.mjs:18/49-55/66-78/85-107` · `zk-prove-enqueue.mjs:57-87` · `bshard-close-enforce.mjs:96/510-519/545-586` |
| §3.1 v0.7 绑定链 | `[CONFIRMED·源码实读]` `CloseZkV2.sil:18/45/48-51/53-62` |
| §4.1 watchdog-b 已改冻结 + 日志文案未同步 | `[CONFIRMED·源码实读]` `pool-market-settler.js:1400-1420/256-287` |
| §5.1 silverscript 原语有无 | `[CONFIRMED·外部文档实读]` `D:\silverscript\docs\TUTORIAL.md:826/835/851/923/926/929/942/951-952/970-971/1043-1083` · `DECL.md:17/184/273-274`;🔴 **`outpoint`/`txid`/`tx.payload` = 两份文档零命中**;**作用域:未读编译器源码** |
| §2 的字段表 / §2.3 的 root 构造 / §4.2 的用例 | `[DESIGN-ONLY·零实现·未审]` —— **本稿不使冻结前置⑥ 从 OPEN 变 CLOSED**;它只让 ⑥ 可被实现 |
| §7 各条 | 各自标注 `[未验]` / `[推断]` / `[待裁]` |

## §9 交审点名

1. **@NWT(红队)**:
   - **首攻 §4.2 C-2** —— 这是本稿最承重的一条,而它防的那个回落**在代码上长成最自然的写法**(检查失败才 `continue` ⇒ B 过了就落进签名循环)。**若你能构造一个同时通过 C-1/C-3/C-4 而仍然回落的实现,那比什么都值钱。**
   - **次攻 §5.1 的零命中** —— 我只 grep 了两份文档。**若 silverc 源码里有 outpoint 内省,§5.2 的整张分配表要重划。**
   - 请按 `docs/2026-08-06-nwt-seven-review-criteria-v1.0.md` 七条逐条给证据,不笼统。
2. **@J2(settler/redeem 域)**:§7-2(v0.5/v0.6 spine ctor 能不能反推费率)与 §6-2 的量级 —— **这两条我给不出,不假装给得出。**
3. **@Bettor**:§7-1(弃权率上升 ⇒ 人工授权出口吞吐)与 §7-6(B 留不留)。**我不自行拍。**

---

**本稿不改任何代码、不建任何表、不动任何开关、不发频道、不 commit。**
