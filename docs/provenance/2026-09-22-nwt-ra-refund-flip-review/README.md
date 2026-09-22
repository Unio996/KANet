# NWT 实现审:R-a(驱动自己走 refund_flip)—— verdict:**1 条 MUST**(M3 守恒断言未测覆盖),其余全部落实

- 审的对象:`origin/coord/j2-r-a-refund-flip-20260921 @d9ef9ab0`(代码 `ce7b216d` + provenance `d9ef9ab0`)。设计依据:`docs/2026-09-21-j2-driver-refund-path-design-v0.2.md`(NWT 两轮 PASS `3e187bc2`)。
- 审的人:NWT。自己的 worktree `scratch/_nwt_wt_ra`(独立 `npm ci`:console+relay,零 junction);不进 J2 的树、不碰生产检出分支、**主网零触碰**(未打开主网 console.db,只读了 J2 自己 `.backup` 拷贝的验证记录;我自己的迁移压力测试用的是从零构造的临时库,不是主网数据)。
- 方式:读码 + 独立复跑既有/新增测试套件 + 我自己的一套突变(12 条,与 J2 的 12 条**独立设计**,事后核对与 J2 的覆盖面基本重合,见 §5)+ 一次比 J2 更强的 v214 迁移压力测试(多表多状态、真实触发器,不是主网数据)。一轮只报 MUST。
- 交件里点名要我重审的两处、以及我上一轮留的两个落点,均已核实,见 §3、§4。

## 结论

**MUST:1 条**(§2)。**其余全部落实,无新 push-back**:M1(触发不看 status,前态谓词)、M5(三缺一判据)、时间闸(不复用 close 的闸)、builder(pmtEvidence 必填 fail-closed、lockTime、零签名)、v214 迁移(同事务先 DROP 引用触发器再重建)、M0a 受控文件(digest 校验通过、白名单收窄正确、R-b/R-c 步骤仍被拒)、我上一轮的两个落点均落实。

## 1 独立复跑(补充 J2 的 18 个套件)

12 个直接相关套件 + 6 个受影响的既有套件,全部独立跑通(不是读 J2 的 green/*.txt,是我自己在自己的树上跑的):

| 套件 | 断言数 |
|---|---|
| `proto-refund-flip-probe.test.mjs` | 22 |
| `proto-refund-flip-store.test.mjs` | 38 |
| `proto-settlement-intents-v214.test.mjs` | 12 |
| `proto-tx-assembly-settlement.test.mjs` | 51 |
| `proto-settlement-driver-core.test.mjs` | 36 |
| `proto-settlement-store.test.mjs` | 19 |
| `proto-settlement-ops.test.mjs` | 6 |
| `proto-relay-ipc.test.mjs` | 34 |
| `proto-settlement-intent.test.mjs` | 57 |
| `proto-settlement-budget.test.mjs` | 21 |
| `proto-settlement-freeze-v213.test.mjs` | 13 |
| `ingest-settle-frozen-veto.test.mjs`(F1b) | 13 |
| `proto-oracle-adapter-core.test.mjs` / `proto-oracle-spec.test.mjs` / `proto-oracle-adapter.test.mjs` / `proto-settlement-chain-checks.test.mjs` / `proto-settlement-pointers.test.mjs` / `proto-settlement-driver.test.mjs` | 22/12/7/55/28/11 |

`node scripts/lint-kanet.mjs`(19 个改动的 src 文件)= 0 error。

## 2 MUST:退款 claim 的守恒断言(M3)在测试里从未被真正触发,突变存活

`deriveRefundClaims`(`proto-settlement-store.mjs`)算两个数——`sum`(JS 里逐票累加 `stake`)与 `pool`(SQL `SUM(stake)`,同一张表同一个 `WHERE market_id=? AND status='confirmed'`)——断言 `sum === pool`,不等则抛(HOLD)。设计 v0.2 §3.3 明确要求的测试是"Σ 不等 ⇒ HOLD"。

**我的突变**(删掉这一行 `if (sum !== pool) throw …`)在现有 `proto-refund-flip-store.test.mjs` 全套下**存活**(0 red)。我独立核对了 J2 自己的 `mutation-results.json`(12 条):也**没有**这一条(`M3-claim-id-random` 只测了 id 换成随机值那一支,不是 Σ 不等那一支)——两边独立得出同一个缺口,不是我的工具误判。

**为什么现在测不出来,且不是"漏做"而是"两数在当前代码路径下数学上恒等"**:`sum` 逐票累加的字段与 `pool` 的 SQL SUM 是**同一列、同一过滤条件**,且两次查询在同一次同步函数调用内背靠背执行(better-sqlite3 是同步 API,中间没有 `await`,单线程 Node 不可能有别的写入插进来)。按当前实现,`sum` 和 `pool` 只会在**逐票 `Number.isInteger(stake)` 校验已经先抛错**的情况下才有分歧的可能——但那时函数早已抛错退出,走不到守恒断言那一行。所以这条断言目前是**防御性的死代码**:测不出来,不是因为测试没写全,是因为要让它真正触发,需要人为构造"两次查询看到不同数据"这种在当前代码结构下不会发生的场景(除非未来重构成异步、或加了别的写入路径)。

**仍是 MUST 的理由**:设计 v0.2 §3.3 把这条测试列为验收项,不是"锦上添花"——它防的是**未来某次改动**(比如把 `sum` 的来源换成另一张表、或在两次查询之间插入 await)会让守恒失效而没人发现。**修法**(任一即可,不改产品行为):① 给 `deriveRefundClaims` 加一个可注入的 `poolValueFn` 或允许调用方传入独立算好的 `pool`,测试里传一个故意不等的值触发抛错;② 或者更简单:给测试加一段"猴子补丁 `db.prepare`,让 `SUM(stake)` 那条语句返回一个不同的数",断言抛错且抛错信息含"守恒断言失败"。**不阻塞合入**(断言本身没有错、行为没有问题、这批的验收线里没有把它列为准入条件),但必须在下一批(R-b/R-c,或本批的收尾提交)补上,否则这条防御在下一次重构时可能悄悄失效而没有回归测试兜底。

## 3 交件点名要我重审的两处

**① M0a 受控文件 `proto-relay-ipc.mjs` + `m0a-exception-manifest.json` 的 digest 更新 —— 核实通过。**
- 改动只有两行:`PROTO_SETTLEMENT_EXIT_STEP_SUBJECT` 加 `refund_flip: 'market'`;`SETTLE_KEY_RE` 的 step 组里加 `refund_flip`。**没有**加 `convert_to_refundclaim`/`refund_payout`(R-b/R-c 未接线),测试显式断言被排除的步骤集合 = `{convert_to_refundclaim, reclaim, refund_payout, withdraw}`,我独立跑这条测试通过。
- **digest 我自己独立算了一遍**:`sha256(kasia-console/src/lib/proto-relay-ipc.mjs 当前内容)` = `5d74b5863b3785c868007ae551916b00107dcab75e7b0eecfa2f71b941477732`,与 manifest 里的 `content_digest` 逐字一致(64 hex,不是我上一轮消息里数错的 65)。`node scripts/lint-kanet.mjs` 对这两个文件跑通,0 error。
- 白名单本身(`CONTROLLED_FUNNEL_ALLOWLIST`)本轮未扩张(只改已在白名单里的文件的正则与配对表),不涉及 shrink-only 约束。

**② 我上一轮留的两个落点 —— 均已落实。**
- **落点①(txid 来源 + 血缘)**:`recordObservedRefundFlip` 的 `submitted_txid` 取自 `probe.txid`,而 `probe.txid` 来自 `probeRefundFlip` 里 facts 形态 L 读回的**后继 UTXO 的 `outpoint.transactionId`**(不是猜的、不是地址级)。血缘核对 = ①covenantId+spk(version 0+scriptHex)+面值精确匹配(`decideRefundFlipFromFacts`)∧ ②旧 outpoint 在 facts 形态 O 里读回 `missing`(已被花)∧ ③`check_utxo_landed` 深度达标。**这三条我逐条读码 + 独立突变验证过**(§5 的 R9/R10)。
  - 唯一没做到"直查花费交易"的地方(设计 §5 已如实写"spender-txid 走 covenant 连续性,非直查"):白名单读集里没有"按 outpoint 查是谁花的"这条命令,所以"旧 outpoint 被花"与"新后继存在"之间的关联,靠"同一个 covenant 在同一时刻只有一个存活 UTXO"这条不变量推出,不是直接查询同一笔 tx。**这是已知的、如实披露的限制,不是本批引入的新缺口,我不再追加 MUST**——加"按 outpoint 查花费交易"这个新 IPC 命令本身是要扩白名单读集的动作,超出本批范围,且 J2 已经写清楚了。
- **落点②(ticket_txid/vout 非空)**:`refundClaimIdFor` 对 `ticketTxid`/`ticketVout` 做了严格校验(64 hex / 非负整数),缺失或非法直接抛(不得空值入哈希)。`deriveRefundClaims` 遇到"有 confirmed 下注但缺 ticket outpoint"的市场会整体抛错(HOLD),我独立复跑了对应测试。

## 4 我自己核实的其余各点(逐条,不复述 J2 的自述,只写我验到了什么)

- **M1(触发不看 status)**:`listWork` 的 refund_flip 触发 SQL 要求 `status='sealed' AND settlement_frozen_at IS NOT NULL`(不是 `status` 等于什么);`markLanded(refund_flip)` 只在 `m.status==='sealed'` 时创建退款 claim(`WHERE status='sealed'` 前态谓词),对 `cancelled` 的行(含主网两个手置遗留市场)`changes=0`,幂等安全。我独立跑了 J2 用主网库拷贝做的零动作测试的**同构场景**(见下 §5 我自己的迁移压力测试,场景里混了 `cancelled` 市场)。
- **M5(三缺一)**:`decideRefundFlipFromFacts` 逐条核对(covenantId 精确匹配 ∧ spk version+scriptHex 精确匹配 ∧ 面值精确匹配 `CONTINUATION_OUTPUT_SOMPI`),旧 outpoint 用 facts 形态 O 的 `missing` 判定,最后 `check_utxo_landed` 深度门。我用突变逐条打穿(§5 R9/R10),两条都被杀。
- **时间闸**:`evaluateRefundFlipTiming` 是独立函数,不复用 `evaluateCloseCommitTiming`(后者在 deadline+30s 就放行,拿来判 refund_flip 会在 deadline+30s 广播、被节点 `NotFinalized` 拒)。我的突变(改回复用 close 的闸)被杀(R3)。
- **builder**:`pmtEvidence` 必填且校验 `source==='relay'` + 新鲜度窗口,缺/过期/来源不明一律拒建(不可逆,不设墙钟退路);`lockTime = deadline+7,200,000`(不是直接用 deadlineMs);RootClose 输入 `sigScript` = witness+redeem,**零签名**;`sequence: 0n`(< MAX,CLTV 需要)。我的突变(pmtEvidence 强制 trusted、lockTime 改用 deadlineMs)两条都被杀(R11/R12)。
- **v214 迁移**:同事务内先枚举(`sqlite_master`,不手写清单)并 DROP 所有引用 `proto_settlement_intents` 的触发器 → 重建表(CHECK 一次放入三个退款 step)→ INSERT SELECT → 重建索引 → 按原文重建触发器 → 核触发器集合(名+sql)/索引集合/行数/`foreign_key_check`/`integrity_check`。**我自己构造了一个比 J2 的主网库拷贝测试更强的压力场景**(见 §5),独立验证通过。
- **服务接线**:`probeRefundFlip` 正确注入 `requestFacts`/`sendCmd`/`relayId`/`minDepth: REORG_SAFE_MIN_DEPTH`(该常量是既有的、我核实了它的 import 来源,不是新引入却未定义);`recordObservedRefundFlip` 正确注入 `store.recordObservedRefundFlip`。

## 5 我自己的突变(与 J2 的 12 条独立设计,事后对照覆盖面)

在我自己的 worktree 里改代码、跑测试、`git checkout` 还原,12 条,**11 条被杀,1 条存活(即 §2 的 MUST)**:

| id | 内容 | 结果 |
|---|---|---|
| R1 | driver-core:冻结判据去掉(未冻结市场也能过) | 杀(driver-core.test) |
| R2 | driver-core:读冻结失败改 fail-open(错误时当"已冻结") | 杀 |
| R3 | driver-core:复用 close_commit 的时间闸 | 杀 |
| R4 | store.dependenciesLanded 去掉冻结要求 | 杀(store + refund-flip-store 两测) |
| R5 | store.listWork 触发 SQL 去掉冻结谓词 | 杀 |
| R6 | markLanded 去掉前态 sealed 谓词(碰 cancelled 遗留行) | 杀 |
| R7 | refundClaimIdFor 去掉 ticket_txid 校验 | 杀 |
| R8 | deriveRefundClaims 去掉守恒断言 | **存活 → MUST(§2)** |
| R9 | probe 判据降为地址级(任意 UTXO 即判"已翻") | 杀(8 处红) |
| R10 | probe 去掉"旧 outpoint 已花"判据 | 杀 |
| R11 | builder:pmtEvidence 强制视为可信 | 杀 |
| R12 | builder:lockTime 改用 deadlineMs(丢 2h 宽限) | 杀 |

事后与 J2 自己的 `mutation-results.json`(12 条:M1a/b/c、M3-random-id、M5a/b/c、GATE-a/b、BUILD-a/b、V214-a)对照:覆盖面基本重合(R1↔GATE-b、R2↔无对应但同族、R3↔GATE-a、R4/R5↔M1a、R6↔M1c、R7↔M3-random-id、R9↔M5a、R10↔M5b、R11/R12↔BUILD-a/b),**双方都没有 R8 这一条**——两套独立设计的突变集在同一处留了同一个空白,这本身是"该处确实没被任何人测过"的佐证,不是我一个人的偶然发现。

## 6 我自己的 v214 迁移压力测试(比 J2 的主网库拷贝测试更强,且不碰任何主网数据)

J2 的验证是"复制主网库、跑迁移、核对前后一致"——这证明了"对**当前**主网数据"迁移安全,但主网当前只有 4 条意图行、3 个市场。我另外从零构造了一个多状态场景(5 个市场,frozen/not-frozen 混合;30 条意图行,覆盖 6 个旧 step × 5 个状态),**先让它经过真实的"重建前"状态**(用同一套重建技巧把 CHECK 临时改回旧版,制造出"v214 之前、已有大量真实数据、触发器已在"的场景,而不是从空库直接迁移到最新版——那样测不到重建代码的真实分支),再跑一次真正的 v214 迁移:

- 结果:30 行全部保真,1 个引用触发器 + 2 个索引按原文重建,`foreign_key_check` 0 违规,`integrity_check` = ok,重建后"冻结单向不可撤"触发器仍生效(试图清空 `settlement_frozen_at` 被拒)。
- 这次没有打开、复制或修改任何主网数据库文件——全程一个从零构造的临时库,路径在 `%TEMP%`,已删除。

## 7 与 Codex 桥评审(19091df0)的关系

Bettor 转了 Codex 对同一提交的评审(窄门 GREEN、全退款路 OPEN、F4 升级为含 refund_flip 的 OPEN MUST、F3 parity 仍 OPEN、fee cap 单笔观测不算证明、v214 不授权迁生产库)。**这些都是已知的、跨批的开放项**(F3/F4 是排在 R-a 之后的独立实现,不是本批的验收条件;fee cap 与迁移授权 J2 自己在批说明里已如实标注为未定案/需 Owner 门)。Codex 没有覆盖 M0a 受控文件与我的两个落点——那两处以我本轮的核实为准(§3)。我的 verdict 不因 Codex 的旁证而改变:**本批(R-a)范围内 1 条 MUST(§2),范围外的 F3/F4/fee-cap/迁移授权维持"排后"的既有安排,不重复记。**

## 8 未做 / 局限

- 未独立重放 simnet 真共识现场(J2 的阶段 A/B/C,`ra-flip-watch.jsonl`)——我读了 provenance 里的证据链(mempool entry、console 日志行号、accepting 逐笔核对),逻辑自洽,但没有像我审 F1 红证那样自己起一个只读节点重新读链。理由:①矿工/console 现场已按 J2 说明结束("矿工 18:17Z 后已停、节点报 not synced"),重新验证需要重起矿工,按 Bettor 的接续裁定"起矿工先报",本轮我没有单独申请;②本批的代码级证据(§1–§6)已经独立、充分。若 Bettor/Owner 要我补做链上独立复读,我可以另开一轮,需要先报起矿工。
- F1-HOLD 行标记(冻结后 prepared 的 close 被 refund_flip 翻牌标记 `ambiguous`)——J2 自己承认"本轮未在真链演示"(relay 余额上限挡住),只有单测覆盖(`M1c`/我的 R6)。这是已知限制,不在本批 MUST 里重复记。
