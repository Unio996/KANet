# NWT 红队 — B线落2 设计稿(feeRules 上链锚定,b71aa0b3)

> **Status**: CURRENT
> **对象**: docs/2026-07-12-fee-split-phase2-commit-anchor-design.md v1.0(b71aa0b3)→ **v1.1(fa0397d8)delta 已核**:折入=Bettor 注1(载荷携带)/注2(trigger L4)/注3(bps=0 注释)+NWT F2(create 时 validate)——**P1/P2/P3 均未被 v1.1 覆盖,全部仍适用**(diff 逐段扫过)。
> **verdict**: **GREEN-with-MUST-FIX——P1(设计缺口)/P2/P3 折入设计后落码 GO;方向与信任模型成立**
> **附: 落1 F1/F3 闭环复核(7dfbe9ea)**: 我的原 repro 攻击重放——role 未知键/顶层未知键/未知键→commit 三路全 throw,合法规则不受损,base commit 向后逐位不变;27+6 断言亲跑全绿。**F1 CLOSED,落2 的 P6 前置已满足。**

---

## Bettor 注4 三核点 + 注1 通道核(全部实读代码,file:line)

**(a) 顺序对调前提"deriveCommitteeSeed 输入集与 payout 零交集" = CONFIRMED**:
seed = blake2b(marketId ‖ endBlockHash@deadline_daa ‖ poolMerkleRoot)(pool-committee-sampler.mjs:46-52);members = deadline_daa snapshot(settler:89 pin 注释);excludePks = maker_pk+broker_pk+bettorPks(settler:91),bets 在 step2 已取。**无一输入依赖 payout 输出**,对调本身安全。但见 P2——对调改变了 degenerate 路径的失败形态。

**(b) 判别式双向 BUST 论证 = 两分支成立,第三分支穿了(P1)**。v1/v2 preimage 键集不相交({fee_recipients,predicate} vs {fee_rules_commit,predicate}),跨版本碰撞=blake2b 原像级不可行;篡改→hash 不符/隐瞒→v1≠v2 双向撞墙,论证对 computeMarketCommit 分支成立。**但 enforce 是三分支不是两分支**——见 P1。

**(c) 两级 hash 类型形状 = 成立,需 pin 两点**:canonicalPredicate 对 {string, object|null} 确定性无歧义;**必须写死** fee_rules_commit 以 lowercase hex string 进 preimage(禁 Buffer——canonicalPredicate(Buffer) 会序列化成 {"data":[…],"type":"Buffer"} 形状,两侧一 string 一 Buffer = commit 永假),key 名 `fee_rules_commit` 拼写进设计。

**注1 通道核 = CONFIRMED**:enforce:272-296 实读——onChainCommit 从 psRedeemHex(被签 tx 的链锚输入)切 offset(284),**非 caller 参数**;predicate caller-fed + hash-bind 先例形状属实(262-296)。载荷携带 feeRules 同构安全,附 P3 值源条件。

## P1 🔴 MUST-FIX(设计缺口): 双向论证漏 predicate-null 第三分支 → feeRules 零链上绑定

enforce:287-289:predicate==null 时 expectedCommit = **ctx.marketMetadataHash(委员本地 DB)**,create 侧(pool.js:1517,enforce:274-276 注释坐实)predicate-null 直接烤 market_metadata_hash,**根本不经过 computeMarketCommit**。设计 §2.2 的 v1/v2 判别与双向 BUST 只覆盖 computeMarketCommit 分支。

**攻击链**:建非-zk + blockhash_parity(predicate-null)+ fee_rules 市场——commit 槽 = metadata_hash,与 feeRules 无关 → 委员 commit 检查照过(metadataHash==onChain 恒真)→ settler 载荷喂**任意改过的 feeRules**(改 bps/换 broker 地址)→ 委员 re-derive 叶用假规则 → **fee 重定向到攻击者地址,零 BUST**。可达性:落2 DoD#3 实弹盘"建一个非-zk 测试盘"若按惯例用 blockhash_parity 判定,**恰好就是这个形状**。

**修法**:fee_rules 市场**一律**烤 v2 公式,predicate-null 时 preimage 折入原 identity 锚:`blake2b(canonicalPredicate({fee_rules_commit, market_metadata_hash}))`(predicate 存在时 {fee_rules_commit, predicate} 照设计);委员判别式"载荷带 feeRules → v2 公式"对 null/非 null 统一覆盖;设计 §2.2 论证表补第三行 + regression case 补 predicate-null 篡改 BUST 负例。

## P2 🟠 MUST-FIX(对调副作用): degenerate 早退被 selectCommittee throw 吃掉

现顺序:payout degenerate → return refund 判定(settler:81)发生在选委员**之前**。对调后,单边盘(应 refund)若 members 除 exclude 后 <COMMITTEE_SIZE,selectCommittee **throw**(sampler:95-96)先于 degenerate 判定 → 本该 refund 的盘变 stuck-throw。**修法(便宜)**:degenerate 前置判定改从 bets+winDir 直判(winners=bets.filter(direction==winDir) 为空 → refund 早退,不需要 pm 不需要委员),然后才选委员算费。

## P3 🟠 MUST-FIX(verify-value-source): 委员侧 fee 派生值源唯一 = hash-bound feeRules

signRequest 里 broker_pk/introducer_pk(enforce:263)与载荷 feeRules.roles[].address 是**两个来源**。v2 路径委员派生 fee 叶必须**只读通过 hash-bind 验证的 feeRules**;signRequest.broker_pk 降级为 hint 或显式交叉断言相等(不等 fail-closed)。否则"commit 验的是 A,叶算的是 B"= checker 决策时读不到 binding 的同族 vacuous。

## P4/P5/P6 notes

- **P4(可用性,落3 前必解)**:fee_rules 全文单点存储——链上只有 32B hash,全文只活 :3200 一列(注1 已定不跨节点同步)。丢列=该市场永不可 settle(fail-closed 但永锁);标准 preset 盘可从 broker_pk/introducer 列+preset 常量确定性重构(留 runbook 一句),**custom 规则开放(落3)前必须解决全文可得性**。v184 建议顺手加 Bettor 注2 的 BEFORE-UPDATE trigger(覆盖改,不覆盖丢——丢靠备份纪律)。
- **P5(preset 形状)**:"从 FEE_PRESETS.prediction 注入构造"实际产物 ≠ preset(委员叶 bps=0 → provider 必须 9820 才 Σ==10000)——落码时**显式定义**这个 interim 形状(命名 + 测试钉死,含 oracle/node bps=0 角色是保留还是剔除,二选一写死),防"构造"两处各自理解。validateFeeRules 在 computeFeeRulesCommit 内自动跑(fee-split.mjs:109),create 烤 commit 即验规则 = F2 闭合确认。
- **P6(时序)**:落1 F1(unknown-field strict whitelist)是本落**前置**——commit 上链后 F1 的碰撞面变真。钉死顺序:F1 修 GREEN → 落2 落码。
- 同 commit 同重启窗:DoD#4 建议显式写"**含 :3300 委员节点**同窗装载"(V1 enforce 双节点都跑,漏 :3300 = 半更新窗实弹)。

## 我试了哪些攻击(挣 PASS 清单)

篡改 feeRules→hash 不符 BUST ✓ / 隐瞒 feeRules→v1≠v2 BUST ✓ / 老盘插列伪造升级→v2≠链上 v1 BUST ✓ / 跨版本 preimage 碰撞→键集不相交不可行 ✓ / **predicate-null 绕 commit→穿了(P1)** / 委员本地 DB 读→注1 已封(载荷携带) / settler 换 committeePks→委员自派生,不受载荷控 ✓ / 双来源地址分叉→P3 条件 / 顺序对调改判定→输入集核毕零交集 ✓ 但 degenerate 形态变(P2) / refund 路径误收费→refundLeaves=原样退(settler:524)不经费函数 ✓。

— NWT 2026-07-12
