# pool_oracle_vote 查询规范化设计 — LIKE 模式匹配升级 json_extract + 显式声明 equivocation 政策

**Status: DESIGN — 待 NWT 红队,未落码。** 归 J2(settler/pipeline 域),Codex 卡①(Bettor 转述 07:09 `#cw2xyi.1`)+ Bettor 加的原子性约束。流程照 r402/PB-S8-1:先设计 → NWT 红队 → 落码。

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

改为:
```sql
SELECT payload FROM chain_events
WHERE event_type = 'pool_oracle_vote'
  AND json_extract(payload, '$.market_id') = ?
  AND json_extract(payload, '$.voter_pubkey') = ?
ORDER BY observed_at ASC LIMIT 1
```
（参数直接传 `market.id` / `voterPubkey`,不再拼 `%...%` 通配符）

`ORDER BY observed_at ASC LIMIT 1` **原样保留**(§2 已论证这是显式声明的既有政策,不是待修的 bug)。

**两处改动点**:
- `pool-market-settler.js:1398-1404`(decideConsensusV06 计票)
- `trade-protocol-filter.js:604-610`(PB-S8-1 own-vote 反查)

**注释同步要求**:两处都补一行,写清楚"取最早"是刻意继承 `bshard-close-voter.js` D1 equivocation 政策精神(market-scoped 先到先得),不是未声明的偶然行为——防止未来又被读成"没人管的隐含选择"。

## 4. json_extract 安全性(已验证,不是假设)

`json_extract` 要求 `payload` 是合法 JSON 才能正确取值;若 `payload` 是 malformed/非 JSON 字符串,`json_extract` 返回 `NULL`(SQLite 行为,不抛异常)——这比 `LIKE` 更安全,不会因为脏数据整条查询崩溃,`NULL` 参与 `= ?` 比较天然为假,等价于"这行不匹配",行为上是一个改进而非新增风险。此说法基于 SQLite/json1 文档行为,未针对本库脏数据做过 fuzz 测试——如果 NWT 认为需要额外验证(比如库里现有 payload 是否曾经出现过 malformed 行),可以加一步核实,不是本设计默认的前提。

## 5. Regression 覆盖(设计阶段先说清测什么,落码时对齐)

延续本项目的 offline exec_sql/query_db 纪律,新增/扩展一个 case,至少覆盖:
1. 正常查询:json_extract 版本对同一 fixture 数据返回与旧 LIKE 版本相同的结果(等价性回归,证明迁移没有静默改变行为)。
2. Equivocation 场景:同一 voter_pubkey 对同一 market 两条不同 outcome 的记录,查询显式返回 observed_at 最早的那条——把隐含行为锁成显式断言,这样以后有人想"顺手改成取最新"会立刻撞见一个写明原因的测试失败,而不是无声改变结算逻辑。
3. malformed payload 行不参与匹配(不抛异常、不误命中)。

## 6. 生产数据现取验证(已做,不是留待将来)

针对 §6 原稿里问 NWT 的第②③点,自己先动手查(readonly,零改动):
```
本机 console.db 现取(readonly connection):
  pool_oracle_vote 总行数:                  867
  malformed/incomplete payload:              0   ← JSON.parse 失败或缺 market_id/voter 字段
  全量 867 行 LIKE vs json_extract 等价性比对:  0 处不一致(全量, 非抽样)
```
⇒ 本机数据支持"json_extract 迁移是纯粹的查询机制升级,不改变任何现有行为"这个结论,不是纸面推断,也不是抽样推断——**全量跑过**。**这不构成对其他节点(J1 笔记本/未来 producer)库的证明**——同类风险披露,规模比 r402 小(这是查询语法等价性,不是协议行为),但如实标注只测过本机。

## 7. 请 NWT 打的点

1. **v0.5 那第三处(§1)到底要不要一起改**——本设计倾向不改(范围外),但请给出方向裁定,不要留成"看起来漏了但其实是故意"的状态。
2. ~~§6 的抽样是否够~~ ——已改跑全量(867/867),不是抽样,这条撤销。
3. **其他节点的数据**——本设计的等价性验证只在本机做过,J1 笔记本/producer 侧是否需要各自跑一遍同样的只读比对再落码,还是本机验证 + 代码逻辑同源就够。
