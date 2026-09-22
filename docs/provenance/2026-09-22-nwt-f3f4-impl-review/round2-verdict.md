# NWT 增量核(第二轮):F3/F4 rebase + 2 MUST 修复 @d557f67d —— verdict:**MUST-1/MUST-2 机制真修,但 1 条新 MUST(SOURCES 两条零测试覆盖,突变证实)**

- 审的对象:`origin/coord/j2-f3-f4-impl-20260922 @d557f67d`(87f1a467 + d557f67d,基线 `f2f56815` 含 R-a)。只核你点名的四点,不开新面(除了突变本身暴露出的东西)。
- 方式:读码 + 独立复跑 9 个套件(全绿)+ 5 条针对本轮修复本身的新突变(在自己的树上改、跑、`git checkout` 还原)。

## 结论

**① MUST-1 机制真修,但测试覆盖不足——追加一条 MUST。② MUST-2 机制真修,突变验证通过。③ refund_flip×创世争用测试真实覆盖交错。④ 没有别的行为改动(REFUND_GRACE_SEC 改导入是纯 D-031 单源整理,数值不变)。**

## ①-a MUST-1 机制:SOURCES 两条真在,`extractInputOutpoints` 双格式修复核实通过

- `SOURCES` 数组三条都在(`proto_settlement_intents`/`proto_markets`/`proto_bet_intents`),我读码确认。
- `simulateIngestPrepared`(`proto-broadcast-ops.test.mjs`/`proto-driver.test.mjs`)对照了 `kasia-relay/covenant-broadcast-relay.mjs:189` 那一行:真实 relay 调用 `ingestPhase({phase:'prepared', txid, txJson: JSON.stringify([txJson])})`,测试的 mock 逐字节复现这个调用形状(同样的 `JSON.stringify([txJson])` 包法),再调**真实**`recordMarketIntentPhase`/`recordBetIntentPhase` 落库——不是伪造结果,是真的走生产写入函数。
- `extractInputOutpoints` 的双层解包(`[innerJsonString]` → `JSON.parse` 两次)我没有再造一个新探针去核对"真实主网库格式"——**我在上一轮审 R-a 时已经亲手读过 simnet 真实产物**(`_j2_e2e_run` 的 `console.simnet.db`,用的是与主网相同的 relay/ingest 代码路径),当时看到的 `prepared_tx_json` 原始值就是这个双层形状(`"[\"{\\\"id\\\":\\\"590ec128...`,截断前缀已足够确认外层是数组、内层是转义 JSON 字符串)。这与本次修复的解包逻辑吻合,不需要重复验证。

## ①-b **新 MUST**:SOURCES 里 `proto_markets`/`proto_bet_intents` 两条,现有测试**一条都测不到**——我用突变证实,不是猜测

我把 `SOURCES` 砍回只剩 `proto_settlement_intents` 一条(完全撤销 MUST-1 的修复),分别对三个测试文件重跑:

| 测试文件 | 结果 |
|---|---|
| `proto-fee-reservation.test.mjs` | 0 red(**这个文件的头注写着"proto_settlement_intents 是本批唯一接线的 DB 派生源——proto_markets/proto_bet_intents 的 prepared_tx_json 在当前生产路径下从未真正写入"——这句话是撤销 MUST-1 之前的旧结论,`proto-fee-reservation.mjs` 那边已经改口承认判定错了,这个测试文件的头注没跟着改,而且确实没有测那两张表**) |
| `proto-broadcast-ops.test.mjs` | 0 red(`simulateIngestPrepared` 写完 prepared 之后**立刻**把市场状态强推到终态 `betting`——头注写"直接把状态推到终态释放它——只影响 DB 派生层的可见性, 不影响任何既有断言",这句话本身是对的,但后果是:这个文件里**没有任何一个时刻**存在"一行非终态的 genesis_prepared/bet-intent 行,同时有另一次选择在跑"——SOURCES 保护的正是这个窗口,窗口在测试里被主动清除了) |
| `proto-driver.test.mjs` | 0 red(这个文件的 `simulateIngestPrepared` 不强推终态,但翻了全文件也没有一个测试用例去检查"选中了/避开了"某个非终态 genesis/bet 行的 outpoint——8 个用例测的都是别的行为) |

**三个文件,零覆盖,不是我挑了一个薄弱点——是这条修复目前完全没有回归测试兜底**。跟 F1 那次"守恒断言在当前代码结构下恒真"不同类型:这次不是"暂时测不出但结构上确实工作",是"工作,但没人写过一个测试去证它工作,而现有测试的 fixture 手法(强推终态 / 不构造并发场景)恰好绕开了这条防线该发挥作用的窗口"。

**最小修法**:任选一处加一个直接测试(不需要走完整的 driver/broadcast-ops 流程)——`reservedFeeOutpoints({db})` 是纯函数,直接往临时库塞一行 `proto_markets`(`status='genesis_prepared'`, `genesis_prepared_tx_json` = 真实形状的双层 JSON,输入含某个 outpoint)+ 一行 `proto_bet_intents`(同理),断言返回的 `Set` 包含这两个 outpoint;再加一条突变(SOURCES 砍回一条 ⇒ 这个新测试红)。这个测试应该放进 `proto-fee-reservation.test.mjs`(它是该测的地方,现在头注还是旧结论,需要一起改)。

## ② MUST-2 机制:突变验证通过

三个真实调用点(`buildMarketGenesisAndBroadcast`、`buildRegisterAppendAndBroadcast`、`proto-settlement-driver-core.mjs` 的结算广播)都把 `try/catch` 缩小到只包 `sendCmd` 那一步:`sendCmd` 正常 resolve(不论 `rep.ok` true/false,relay 给出确定答复)⇒ 立即释放;`sendCmd` 本身抛错(IPC 超时/无响应)⇒ 不释放,转 `deferReservationReconciliation`(挂 `setTimeout`,到期查 DB `prepared_tx_json` 是否已落——有 ⇒ 移交 DB 层,无 ⇒ 释放)。`driver-core.mjs` 侧的 `deps.checkIntentPreparedInDb` 我核实是真接线(`proto-settlement-driver.mjs` 里 `(intentKey) => !!(getSettlementIntent(intentKey)||{}).prepared_tx_json`,不是桩)。

三条突变全部命中:① 把 genesis 侧 `catch` 分支改回立即释放 ⇒ 红;② driver-core.mjs 侧同样改回无条件释放 ⇒ 红;③ `reconcileUncertainReservation` 改成"两种结局都直接释放,不管 DB 里有没有字节" ⇒ `proto-fee-reservation.test.mjs` 3 项红。三条互相独立,分别对应你要求的"超时不释放/到期对账/DB 有字节移交"。

## ③ refund_flip×创世真实争用测试:确认覆盖 HTTP×driver 交错,不是顺序

`proto-settlement-ops.test.mjs` 新增两组,**用 `Promise.all` 并发两个真实生产函数**(不是 mock 选择逻辑):① `driver.advanceStep({step:'seal'})` 与 `driver.advanceStep({step:'refund_flip'})` 争同一个候选池(只留一枚"最佳"候选);② `buildMarketGenesisAndBroadcast`(创世的真实生产函数,与 HTTP 入口 `api/proto.js:196` 调的是同一个函数)与 `driver.advanceStep({step:'refund_flip'})` 争同一候选。两组断言都是:全部真实广播的交易互不重叠花费同一个 outpoint(`dup` 数组必须为空)+ 共享候选最多被一笔交易花掉 + 至少一方成功(排除"两边都失败、什么也没测到"的空判)。这是真实交错(两个函数各自内部有多个 `await`,`Promise.all` 让 JS 调度器按各自的真实异步链交替执行,不是人为固定顺序),我认为满足"HTTP×driver"的实质要求(创世函数本身就是 HTTP 入口调用的那个函数,不需要真的走一次 HTTP 往返)。

## ④ 没有别的行为改动

`git diff f2f56815..d557f67d --stat` 之外我额外核了 `proto-close-commit-gate.mjs` 的 `REFUND_FLIP_GRACE_MS` 改成从 `pool-refund-grace.mjs` 的 `REFUND_GRACE_SEC` 导入——`REFUND_GRACE_SEC=7200`,乘 1000 = 7,200,000,与改动前的字面常量数值完全相同,纯粹是 D-031(Owner 追问后核出的漏项,账本1624)要求的单源整理,不是行为变化。全部 9 个独立复跑的测试套件本轮无一处失败(见附录)。

## 独立复跑(补充你 ls-remote/merge-tree 的核对)

`proto-fee-reservation.test.mjs`(全绿)、`proto-broadcast-ops.test.mjs` 22 项、`proto-settlement-ops.test.mjs` 10 项、`proto-settlement-driver-core.test.mjs` 41 项、`proto-driver.test.mjs` 8 项、`proto-settlement-c1.test.mjs` 45 项、`proto-tx-assembly.test.mjs` 40 项、`proto-tx-assembly-settlement.test.mjs` 51 项、`proto-settlement-driver.test.mjs` 11 项——全部独立在自己的树上跑,全绿。`lint-kanet.mjs` 对 5 个关键改动文件 0 error。

## 附:突变结果

| id | 内容 | 结果 |
|---|---|---|
| S1 | `extractInputOutpoints` 去掉双层解包 | 杀(broadcast-ops 8 处红) |
| S2 | `SOURCES` 砍回只剩 `proto_settlement_intents` | **存活**(三个测试文件全部 0 red → 追加 MUST,见①-b) |
| S3 | genesis 广播:`catch` 分支改回立即释放 | 杀 |
| S4 | driver-core.mjs 结算广播:`catch` 分支改回立即释放 | 杀 |
| S5 | `reconcileUncertainReservation` 两种结局都直接释放 | 杀(3 处红) |

见 `mutation-r2/mut-f3f4-r2.json`(规格)、`mutation-r2/mut-f3f4-r2.out.json`(逐条结果)。S2 的补充验证(对 `proto-driver.test.mjs` 单独重跑,同样 0 red)是手工做的,不在这两个文件里,过程记在本文档正文。
