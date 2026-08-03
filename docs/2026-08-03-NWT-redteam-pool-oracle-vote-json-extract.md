# NWT 红队 — pool_oracle_vote 查询规范化设计(json_extract 迁移,commit bc842afb)

> **Status**: CURRENT

**审的对象**: `docs/2026-08-03-pool-oracle-vote-json-extract-migration-design.md`(J2,commit `bc842afb`)。
**结论**: **PUSH-BACK,一个 MUST-FIX**(与 r402 v1 同级别——不是风格问题,是设计稿自己的核心安全性论证被证伪,而这条改动会直接波及今天刚审过、刚部署的 PB-S8-1)。

头号铁律:default 试图打穿。设计稿 §4 那句"json_extract 对 malformed payload 返回 NULL,不抛异常,比 LIKE 更安全"我没有直接采信——现取用项目实际的 `better-sqlite3` 复现了一遍,结果和设计稿的断言**相反**。

---

## finding① 🔴🔴 MUST-FIX —— `json_extract` 对 malformed JSON 不是返回 NULL,是**抛异常**,而且是整条查询级别的抛,不分行

**逐字复现(用项目实际的 better-sqlite3,不是理论上的 SQLite 文档行为)**:

```js
db.exec("CREATE TABLE chain_events(payload TEXT, event_type TEXT, observed_at TEXT)");
db.prepare('INSERT ...').run('{"market_id":"m1","voter_pubkey":"pk1","outcome":"YES"}', 'pool_oracle_vote', '2026-08-01');
db.prepare('INSERT ...').run('not json at all {{{', 'pool_oracle_vote', '2026-08-02');  // 完全无关的一行脏数据

db.prepare(`
  SELECT payload FROM chain_events
  WHERE event_type = 'pool_oracle_vote'
    AND json_extract(payload, '$.market_id') = ?
    AND json_extract(payload, '$.voter_pubkey') = ?
  ORDER BY observed_at ASC LIMIT 1
`).get('m1', 'pk1');
// → SqliteError: malformed JSON
```

**关键事实,设计稿没有预见到的**:这个查询是**逐字**照抄设计稿 §3 的提议 SQL,表里只有一行匹配(`m1`/`pk1`,合法 JSON),另一行是完全无关的垃圾字符串——**查询依然整体抛异常,不是"那一行匹配不上、其余正常返回"。** SQLite 的 `json_extract` 在扫描到任何一行 malformed payload 时就抛 `SQLITE_ERROR: malformed JSON`,不管这一行最终会不会满足其他 WHERE 条件。设计稿 §4 的原话"json_extract 返回 NULL,不抛异常,比 LIKE 更安全"——**这句话是错的,方向反了**:`LIKE` 从不解析 JSON,对任何 malformed 行都不会抛;`json_extract` 会。这次迁移把一个"从不因脏数据抛异常"的查询,换成了一个"表里任何一行脏数据都能让整条查询抛异常"的查询——**安全性是倒退,不是设计稿说的改进。**

**用多行/多种脏数据(含 NULL、含脏数据排在有效行之前)重复验证,结论一致**(见下方"我做的额外验证")。

### 这条不是理论洁癖——它直接命中今天已经上线的 PB-S8-1

`decideConsensusV06`(`pool-market-settler.js:1398-1404`,本设计要改的两处之一)的调用点(L934 `decideConsensus(market)`)**确实有 per-market try/catch 包裹**(L1073-1076,`errored++` 计数),异常不会打崩整个 tick——**但后果依然严重**:只要 `chain_events` 里**任何位置**存在一行 `event_type='pool_oracle_vote'` 的 malformed payload(不管是哪个市场哪个委员的),**每一个**在这个 tick 里跑到 `decideConsensusV06` 的 v0.6/v0.7 市场都会在这条查询上抛异常、被 catch、计入 `errored`——**committee-sig 结算(D-012 §二子集②,当前 live 主力)全线卡死**,而且卡死原因和现有代码已经显式处理的"malformed payload → `malformedCount`/`malformedSet`、按 silent-equiv 处理、继续判定"这条既有容错路径完全不是一回事——**这次迁移把一条已经妥善处理的已知场景,变成了一个未处理的异常。**

**更严重的是 `trade-protocol-filter.js:604-610`(PB-S8-1 own-vote 反查,今天 `847f091a` 刚落地、`520903b7` 我刚 diff 复核 GREEN 过的那段代码)——这里逐字读过,`myVoteRow` 那次 `.get()` 调用外面没有 try/catch 包裹,而它所在的 `for (const oracle of localOracles)` 循环体也没有内层 try/catch。** 若迁移成 json_extract 且表里存在任何一行 malformed `pool_oracle_vote`:这次 `.get()` 抛出的异常会直接冲出整个 `handlePoolOracleTxSignReq` 函数(顶多在更外层的消息分派 `try/catch` 被兜住、写一行 `[trade-filter] Error processing ...` 日志),**这台机器上所有本地 oracle 身份、所有市场的签名请求处理,只要跑到这个函数,全部因为一行无关的脏数据而中断**——包括那些投票记录完全正常、本该顺利签名放行的委员。**这会让我们今天刚验证、刚部署的 PB-S8-1 拜占庭防御,从"选择性拒签"退化成"任何脏数据都能让整条签名流水线失能",且失能方式是异常而非设计好的拒签路径——完全背离 PB-S8-1 的初衷。**

---

## 我做的额外验证:确认一个可行的最小修法(不是只报问题不给方向)

测了加一道 `json_valid(payload)` 前置守卫是否能让 SQLite 短路、跳过对 malformed 行求值:

```sql
SELECT payload FROM chain_events
WHERE event_type = 'pool_oracle_vote'
  AND json_valid(payload)                          -- 新增
  AND json_extract(payload, '$.market_id') = ?
  AND json_extract(payload, '$.voter_pubkey') = ?
ORDER BY observed_at ASC LIMIT 1
```

**多组数据验证(含 NULL payload、含多行脏数据、含脏数据排在合法行之前)**:加了 `json_valid(payload)` 守卫后,查询**稳定成功**,正确跳过所有 malformed/NULL 行,只返回合法匹配行——不再抛异常。这是 SQLite 对 `AND` 链的从左到右短路求值,`json_valid` 排在 `json_extract` 之前时,后者不会被求值到 malformed 的那一行。

**要求**:设计稿 §3 提议的两处查询(`pool-market-settler.js:1398-1404` + `trade-protocol-filter.js:604-610`)都必须加这道 `json_valid(payload)` 守卫,不能只加 `json_extract` 不加校验。§4 那段关于安全性的论证需要整段重写(现在的版本方向是反的)。

---

## §7 J2 请打的三点

1. **v0.5 第三处(1267-1274)要不要一起改**——**我的裁定:不改,而且鉴于 finding① 的发现,理由比 J2 原来给的更强了**。J2 原判断是"范围外、无对应 checker、不构成两把尺风险",我同意;额外一条:v0.5 那条现在还是 `LIKE`,**在这次的教训之后,LIKE 反而是当前更安全的模式**(不会因为表里出现脏数据就抛异常)。除非将来专门给它也加 `json_valid` 守卫再迁移,否则不建议现在顺手动它——动了反而引入同类风险到第三处。
2. ~~抽样是否够~~(J2 已撤销此问)。
3. **其他节点数据是否需要各自验证等价性**——**这个问题在 finding① 修完之后重要性大幅下降**:J2 的"本机 867/867 无脏数据"验证回答的是"当前查询等价",不回答"未来会不会出现脏数据";而 `json_valid` 守卫修复的正是"未来出现脏数据时会不会炸"这个问题,与哪个节点、哪次快照无关(是查询本身的健壮性,不是数据分布)。守卫加上之后,不要求逐节点验证,当前的全量等价性核实已经足够回答"迁移当下没有静默改变行为"这个问题。

---

## 其他部分:PASS

- **equivocation 显式声明**(§2):核对了 `docs/2026-06-22-NWT-redteam-close-voter-daemon.md` D1 原文——"对某 market 已签过任何根,拒签该 market 的不同根"，机制上是**主动拦截**(拒绝创建冲突记录);而 `pool_oracle_vote` 现状是**被动选择**(冲突记录允许被创建,只是读取时总是取最早一条)。两者机制不同,但**效果一致**("先到先得,后续冲突不生效")——J2 "精神一致"的表述准确,不是过度类比。且确认了 `decideConsensusV06` 按 committee 成员逐一查询(每个 index 一次 `LIMIT 1`),equivocation 不会导致同一委员的票被重复计入 `yesCount`/`noCount`——不生新洞。
- **受影响范围枚举**(§1):grep 独立复核,三处坐标(1267-1274/1398-1404/604-610)准确,原子约束的两处选择(Bettor 硬要求)合理。
- **regression 覆盖清单**(§5):三条(等价性回归/equivocation 显式断言/malformed 行不误命中)方向对——**第三条现在必须真正落地测试到("malformed 行不误命中"不能只是不误命中,还必须不让整个查询抛异常),这正是 finding① 要补的那个断言,不是可选项。**

## 总裁定(v1)

**PUSH-BACK。finding① 是唯一但严重的 MUST-FIX**:加 `json_valid(payload)` 守卫到两处查询,§4 安全性论证重写。§7 三点已裁定。其余部分方向正确,改完这一处即可预期 GREEN,不需要推翻整个设计。

---

## 复审(v2 `56766585` → v3 `4472a3d3`):GREEN

**v2 核实**:§3 两处查询均加 `json_valid(payload)` 守卫且顺序正确(排在两个 `json_extract` 之前);§4 论证整段重写,如实标注 v1 断言"没有针对本库实际脏数据测试过、只是基于文档一般印象"这个失职,并附 J2 独立复现(不是照抄我的结论,自建空库验证)。§5 regression 覆盖新增"malformed 行不让整条查询抛异常"(不是"不误命中"这个弱版本)+ "守卫顺序颠倒会重新抛"两条,精确对应 finding①。§7 三点裁定原样采纳。

**v3 核实**:仅将 spike 证据从叙述改成可复制粘贴重跑的 `node -e` 命令块 + 精确预期输出,不改设计本身(SQL/equivocation 政策/受影响范围均未变)。**我自己把这段命令块原样跑了一遍**(不是信任"J2 说他跑过"):
```
WITHOUT guard: THROWS -> malformed JSON
WITH guard: no throw, result= {"payload":"{\"market_id\":\"m1\",\"voter_pubkey\":\"pk1\",\"outcome\":\"YES\"}"}
```
逐字符与文档一致。

**关联加固已独立复核**(见 `docs/2026-08-03-NWT-redteam-pbs8-tryCatch-hardening.md`):`f7b16894` 给 PB-S8-1 的 `myVoteRow` 查询本身加了 try/catch,与本卡"同卡不同步骤"分开落码——GREEN,但两者之间有 Bettor 钉死的部署顺序约束(try/catch 必须同窗或先于本卡上线,不允许颠倒),已在那份文档记录,此处不重复。

## 总裁定(最终)

**GREEN。** finding① 的 MUST-FIX 已验证修复,可以落码。落码后按 r402/PB-S8-1 同款流程,我再核一遍实际 diff。

— NWT
