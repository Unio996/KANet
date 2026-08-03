# pool_oracle_vote 查询规范化设计 v2 — LIKE 模式匹配升级 json_extract + 显式声明 equivocation 政策

**Status: DESIGN v2 — 待 NWT 复审,未落码。** 归 J2(settler/pipeline 域),Codex 卡①(Bettor 转述 07:09 `#cw2xyi.1`)+ Bettor 加的原子性约束。v1(commit `bc842afb`)被 NWT 红队 PUSH-BACK(commit `290f69ae`,§4 安全性论证被证伪,MUST-FIX)。本版按 NWT 的发现 + 已验证修法改,并经 J2 独立复现确认(不是照抄结论)。流程照 r402/PB-S8-1:先设计 → NWT 红队 → 落码。

## 0. Codex 原始意见 + Bettor 的约束

Codex 审查 PB-S8-1(commit `520903b7`)时指出:`handlePoolOracleTxSignReq` 新插入的 own-vote 查询用 `payload LIKE '%"market_id":"..."%' AND payload LIKE '%"voter_pubkey":"..."%'` 两个字符串模式匹配——**依赖 JSON 序列化的字节形状**(字段顺序、转义方式一旦变化,LIKE 模式可能失配),不是结构化的 `json_extract` 查询;而且**同一 voter 对同一 market 若有多行投票记录,现在的 `ORDER BY observed_at ASC LIMIT 1` 隐含"取最早"这个 policy,从未被显式声明或测试过**。

Bettor 加的约束(不是建议,是硬要求):**只改 PB-S8-1 的检查端(trade-protocol-filter.js),不改计票端(pool-market-settler.js 的 decideConsensusV06),会造成"计票认这行、检查不认这行"的分裂——这比完全不改更危险(两把尺教训)。升级必须原子覆盖两处。**

## 1. 受影响范围(已逐一 grep 确认,不是只有 Codex 点名那一处)

```
pool-market-settler.js:1267-1274   v0.5 decideConsensus 内联投票计数(按 voter_relay_id 匹配)
pool-market-settler.js:1398-1404   v0.6/v0.7 decideConsensusV06 投票计数(按 voter_pubkey 匹配)
trade-protocol-filter.js:604-610   PB-S8-1 own-vote 反查(按 voter_pubkey 匹配, 本轮刚加, commit 520903b7)
```

**必须原子一起改的两处(Bettor 硬约束)**:`pool-market-settler.js:1398-1404` 与 `trade-protocol-filter.js:604-610` ——两者都按 `voter_pubkey` 查同一张表、服务同一条 v0.6/v0.7 委员会流程(一处算票、一处核对),用的是**同一把尺**,必须同时升级、同时测试,不能一边 json_extract 一边留着 LIKE。

**待裁定是否一并改的第三处**:`pool-market-settler.js:1267-1274`(v0.5 路径,按 `voter_relay_id` 而非 `voter_pubkey` 匹配,服务的是完全不同的旧协议版本,PB-S8-1 这条新检查根本不触达 v0.5 市场)。**本设计倾向不改**——它不构成 Bettor 说的"两把尺"风险(v0.5 没有对应的 checker 端),动它是范围外的顺手清理,不是本卡要求的原子集合。列出但不替 NWT/Bettor 拍。

## 2. Equivocation(同一 voter 多行)—— 不是发明新政策,是显式声明已有先例的语义

`chain_events` 表只有 `UNIQUE(txid, event_type)`,**没有** `(market_id, voter_pubkey)` 唯一约束(这两个字段本就不是列,是 JSON payload 内的值)——同一个 oracle 理论上可以对同一市场广播两条 `pool_oracle_vote_v1`,内容还可能不一致(equivocation,或单纯的重复广播/bug)。

**当前隐含行为**:`ORDER BY observed_at ASC LIMIT 1` = 取最早一条,后续不同的投票不生效。

**已有的项目内先例(不是我编的,是已经被红队过的既有设计)**:`bshard-close-voter.js` D1 equivocation 防(`docs/2026-06-22-NWT-redteam-close-voter-daemon.md`)——"committee 对一个市场只能背书一个结果,dedup key = market_id only,已签过任何结果 → 拒签不同结果"。**这条已有的、已过红队的政策精神与当前 `pool_oracle_vote` 隐含行为一致**(先到先得,后续冲突的不生效)——本设计不改变行为,只是把它从"隐含在 ORDER BY 里、没人声明过"升级成**显式声明 + 显式测试**的政策,并在代码注释里明确写出这是刻意继承 D1 的语义,不是巧合。

**不做的**:不做"检测到 equivocation 就报警/拒绝该 oracle 整体资格"这类主动防御升级——那是范围扩张,且会改变现有市场的既定结算结果(风险不对称,不该在这次"查询语法升级"里顺手夹带)。

## 3. 提议改动(未落码,等 NWT 红队)

两处查询从:
```sql
SELECT payload FROM chain_events
WHERE event_type = 'pool_oracle_vote'
  AND payload LIKE ? AND payload LIKE ?
ORDER BY observed_at ASC LIMIT 1
```
（参数 `%"market_id":"X"%` / `%"voter_pubkey":"Y"%`）

改为(v2:加 `json_valid` 前置守卫,见 §4 —— v1 没有这一层,是 PUSH-BACK 的原因):
```sql
SELECT payload FROM chain_events
WHERE event_type = 'pool_oracle_vote'
  AND json_valid(payload)
  AND json_extract(payload, '$.market_id') = ?
  AND json_extract(payload, '$.voter_pubkey') = ?
ORDER BY observed_at ASC LIMIT 1
```
（参数直接传 `market.id` / `voterPubkey`,不再拼 `%...%` 通配符;`json_valid(payload)` 必须排在两个 `json_extract` 之前,靠 SQLite `AND` 链左到右短路求值挡住脏行触发 `json_extract` 抛异常——顺序不能换)

`ORDER BY observed_at ASC LIMIT 1` **原样保留**(§2 已论证这是显式声明的既有政策,不是待修的 bug)。

**两处改动点**:
- `pool-market-settler.js:1398-1404`(decideConsensusV06 计票)
- `trade-protocol-filter.js:604-610`(PB-S8-1 own-vote 反查)

**注释同步要求**:两处都补一行,写清楚"取最早"是刻意继承 `bshard-close-voter.js` D1 equivocation 政策精神(market-scoped 先到先得),不是未声明的偶然行为——防止未来又被读成"没人管的隐含选择"。

## 4. json_extract 安全性(v1 论证被证伪,v2 重写 + 两轮独立验证)

**v1 的错误声称(已撤回)**:「`json_extract` 对 malformed payload 返回 `NULL`,不抛异常,比 `LIKE` 更安全」——这句话没有针对本库实际脏数据测试过,只是基于 SQLite/json1 文档的一般印象断言,是本设计最大的失职:一份要动签名放钱路径查询的设计稿,在"安全性"这个核心论证点上没有自己验证就下结论。

**NWT 逐字复现的真实行为**(commit `290f69ae`):往 `chain_events` 插一行完全无关市场/无关委员的垃圾 JSON payload,再跑提议的 `json_extract` 查询(哪怕这行根本不该匹配任何 WHERE 条件)——**整条查询直接抛 `SqliteError: malformed JSON`**,不是那一行悄悄不匹配、其余正常返回。原因:SQLite 逐行求值 `WHERE` 子句时,`json_extract()` 本身在解析非法 JSON 时抛异常,这个异常不会被"反正这行不匹配"吸收——它发生在**决定这行匹不匹配之前**。`LIKE` 从不解析 JSON,永远不会有这个问题(纯字节层面的模式匹配)。

**J2 独立复现(不是照抄 NWT 的结论,自己起了一个空库验证两组行为)**:
```
无 json_valid 守卫: db.prepare(...json_extract...).get('m1','pk1')
  → 抛 "malformed JSON"(即使目标行 m1/pk1 是合法数据,只因表里还有一行垃圾 JSON)
加 json_valid(payload) 守卫: 同样的库、同样的数据
  → 正常返回目标行,不抛异常
```
两组结果与 NWT 报告的现象一致,独立确认成立,不是单方转述。

**为什么这不是"理论风险"(NWT 指出,已核实)**:`trade-protocol-filter.js:604-610`(PB-S8-1 的 `myVoteRow` 查询,今天 `847f091a` 刚落地、`520903b7` 已过 diff 复核)那次 `.get()` 调用**外面没有 try/catch**,所在的 `for (const oracle of localOracles)` 循环也没有——若真的迁移成不带守卫的 `json_extract`,`chain_events` 里**任意一行**(不论哪个市场、哪个委员)脏数据,都会让本机**所有** oracle 身份、**所有**市场的签名请求处理异常中断。这会把 PB-S8-1"选择性拒签一个可疑请求"的设计意图,退化成"一行脏数据能让整条签名流水线失能"——从功能缺陷升级成可用性/DoS 缺陷,而且是被**这次要做的"安全性升级"自己引入的**,不是既有代码的问题。`decideConsensusV06` 那处虽然有外层 per-market try/catch(不会崩整个 settler tick),但 `errored++` 累加会让 v0.6/v0.7 委员会结算整体卡住,且绕开了同函数里 `malformedCount` 已经妥善处理的容错路径(见 `pool-market-settler.js:1407-1417` 现有的 `try{JSON.parse}catch{malformedCount++}` 模式——加 `json_valid` 守卫后这条既有容错路径继续有效,不加则被短路)。

**修法(已验证,§3 已按此重写)**:`WHERE ... AND json_valid(payload) AND json_extract(...)=? AND json_extract(...)=?`——`json_valid` 排在两个 `json_extract` 前面,靠 `AND` 链左到右短路求值,脏行在真正解析取值之前就被过滤掉。两处查询(decideConsensusV06 + PB-S8-1)都要加,不能只加一处(同 §1 的原子约束——这条本身也是"两把尺"风险的一个新实例:如果只给 PB-S8-1 加守卫、decideConsensusV06 不加,两处对同一脏数据的反应又会不一致)。

## 5. Regression 覆盖(设计阶段先说清测什么,落码时对齐)

延续本项目的 offline exec_sql/query_db 纪律,新增/扩展一个 case,至少覆盖:
1. 正常查询:json_extract 版本对同一 fixture 数据返回与旧 LIKE 版本相同的结果(等价性回归,证明迁移没有静默改变行为)。
2. Equivocation 场景:同一 voter_pubkey 对同一 market 两条不同 outcome 的记录,查询显式返回 observed_at 最早的那条——把隐含行为锁成显式断言,这样以后有人想"顺手改成取最新"会立刻撞见一个写明原因的测试失败,而不是无声改变结算逻辑。
3. **malformed payload 行不让整条查询抛异常(§4 MUST-FIX 的直接回归锁)**:表里插一行垃圾 JSON(不属于任何测试 market/voter)+ 一行合法目标数据,查询必须正常返回目标行、不抛。这条不是"顺手测测",是本次 PUSH-BACK 的核心——没有这条,任何人以后不小心去掉 `json_valid` 守卫都不会被测试抓到。
4. **守卫顺序回归**:验证 `json_valid` 确实排在 `json_extract` 前面(可以反向构造一个"守卫顺序颠倒"的 SQL 变体跑一遍,确认它会抛,证明测试真的在测顺序而不是碰巧过)。

## 6. 生产数据现取验证(已做,不是留待将来)

针对 §6 原稿里问 NWT 的第②③点,自己先动手查(readonly,零改动):
```
本机 console.db 现取(readonly connection):
  pool_oracle_vote 总行数:                  867
  malformed/incomplete payload:              0   ← JSON.parse 失败或缺 market_id/voter 字段
  全量 867 行 LIKE vs json_extract 等价性比对:  0 处不一致(全量, 非抽样)
```
⇒ 本机数据支持"json_extract 迁移是纯粹的查询机制升级,不改变任何现有行为"这个结论,不是纸面推断,也不是抽样推断——**全量跑过**。**这不构成对其他节点(J1 笔记本/未来 producer)库的证明**——同类风险披露,规模比 r402 小(这是查询语法等价性,不是协议行为),但如实标注只测过本机。

## 7. NWT v1 复审裁定(已采纳,v2 按此定稿)

1. **v0.5 第三处不改**——NWT 复审后理由更强:这次发现之后,`LIKE` 反而是当前**更安全**的模式(不解析 JSON,永远不会因脏数据抛异常),v0.5 路径没有对应的 PB-S8 checker,不构成"两把尺"风险,维持原判不改。
2. **抽样问题已撤**(v1 §7 原第②点)——已跑全量 867/867,不是抽样。
3. **其他节点验证的重要性下调**——`json_valid` 守卫修的是查询健壮性(对任意脏数据都稳),不是数据分布相关的问题,跟哪个节点无关;当前本机全量等价性核实(§6)已经够回答"迁移当下没有静默改变行为"这个问题,不需要每个节点各自重跑。
