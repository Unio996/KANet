# NWT 实现审:F3(fee 候选资格函数)+ F4(fee 输入两层预留)—— verdict:**2 条 MUST(均比 Bettor 的怀疑更重),第 3–5 点核实通过**

- 审的对象:`origin/coord/j2-f3-f4-impl-20260922 @0e24c821`(基线 `3691b19b`)。**这轮审的是未 rebase 的版本**,按 Bettor 指示"逻辑问题 rebase 不会变,现在可以开审";最终 verdict 待 rebase 到 `f2f56815`+争用测试后,我会核一次增量,不重新过一遍全部。
- 审的人:NWT。自己的 worktree `scratch/_nwt_wt_ra`(独立 `npm ci`);不进 J2 的树;主网零触碰(全程临时库,未打开任何主网数据)。
- 方式:读码 + 独立复跑既有/新增测试(9 个套件全绿)+ **两个针对 Bettor 点名疑点的独立端到端探针**(不是 mock,是真代码路径)+ 独立跑一遍 lint 新规则。

## 结论先行

**Bettor 点名的疑点①和②,我独立验证后判定:两条都成立,而且比 Bettor 猜测的更严重——①不是"是否覆盖跨进程/重启"的问题,是 J2 给出的排除理由本身在真实代码路径下是错的;②不是"简化",是 `reconcileUncertainReservation` 整个函数在生产代码里零调用点,写了却没接。**第 3、4、5 点(HTTP 入口覆盖/lint 规则/F3 零改动/parity)核实通过。

## MUST-1(重于 Bettor 的怀疑):J2 排除 `proto_markets`/`proto_bet_intents` 的理由——"prepared_tx_json 从未被写入"——在真实生产代码路径下是错的,是把 mock 测试的假象当成了生产事实

**J2 的说法**(`proto-fee-reservation.mjs` 头部注释):这两列/表在生产路径下"从未被写入过",所以 F4 的 DB 派生层(`reservedFeeOutpoints`)只接 `proto_settlement_intents`,创世/下注只靠进程内层。引用的证据是 `proto-broadcast-ops.test.mjs F3b-4`、`proto-driver.test.mjs ⑦`。

**我独立核实的结果:这个断言不成立。** 我读了 J2 引用的两个测试,它们的 `sendCmd` 是**手写的 fake stub**——对 `covenant_broadcast` 直接 `return {ok:true, txId:...}`,**根本没有调用真正的 relay 代码,也没有经过 relay 的 `ingestPhase` HTTP 回调**。relay 的真实实现(`covenant-broadcast-relay.mjs` 的 fresh path)在 `submitTransaction` **之前无条件**调用 `ingestPhase({phase:'prepared', ...})`,这个调用是一次真实的 HTTP POST 到 console 的 `/ingest/proto-bet-intent-phase`,该端点按 `intent_key` 前缀分派(`genesis:` → `recordMarketIntentPhase`,其余 → `recordBetIntentPhase`)——这条路径对创世/下注和结算是**完全同一套代码**,没有任何分支跳过它。

**我搭了一个真实的端到端探针**(真 fastify + 真 `registerIngestRoutes` + 真 `covenantBroadcastRelay`,只有 kaspa-wasm/rpc 是假的,和 F1b 的 `ingest-settle-frozen-veto.test.mjs` 同一手法):`ensureMarketPending` 建一个 `genesis_pending` 市场 → 用真实 `covenantBroadcastRelay` 走一次 fresh-path 广播 → 读回市场行。结果:

```
BEFORE {"status":"genesis_pending","genesis_prepared_tx_json":null,"genesis_prepared_txid":null}
RELAY REPLY {"ok":true,"txId":"GENESIS_PROBE_TXID_..."}
AFTER  {"status":"genesis_submitted","genesis_prepared_tx_json":"len=428","genesis_prepared_txid":"GENESIS_PROBE_TXID_...","genesis_submitted_txid":"GENESIS_PROBE_TXID_..."}
```

`genesis_prepared_tx_json` **真实被写入**,而且市场到达 `genesis_submitted` 之后这一列**仍然非空**——直接与 J2 注释里"每一个广播成功过的市场永远触发 fail-closed(txCol 为 null)"这句话矛盾。我又顺着代码读了一遍 `recordMarketIntentPhase`/`ensureMarketPending`/`driveBetIntent`(bet append 侧结构完全对称:`driveBetIntent` 同样在任何 IPC 之前 `ensureBetIntent`,relay 同一套 `ingestPhase` 回调会落到 `recordBetIntentPhase`),结论一致——**这条排除理由的论据本身是被 mock 掉的测试制造的假象,不是生产行为**。（`proto-driver.test.mjs ⑦` 这条引用更离题:那条测试测的是"landed 后 `proto_bets.status` 直接推到 confirmed",跟 prepared_tx_json 写入完全无关,是错误引用。）

**为什么这比 Bettor 猜的"跨进程/重启覆盖不足"更重**:Bettor 问的是"这两列 DB 层缺失时,创世/下注是否至少有进程内层兜底,跨进程/重启会不会漏"。我的发现是:**排除这两列本身没有必要**——它们能正常工作,是可以直接加进 `SOURCES` 的现成 DB 派生源,J2 却因为一个被 mock 污染的测试论据放弃了它们,导致创世/下注在**没有任何必要性**的情况下,比结算路径少了一层重启/跨进程保护(结算有 DB 层兜底,创世/下注目前完全没有,只靠进程内层——重启瞬间清零,或者 MUST-2 触发时提前释放,防线单薄一层)。

**修法**:把 `SOURCES` 加回两条(`proto_markets`:`nonTerminal=['genesis_pending','genesis_prepared']`,`txCol='genesis_prepared_tx_json'`;`proto_bet_intents`:沿用 `proto_bet_intents.status`/`prepared_tx_json`);J2 若有其它真实撞到的场景(不是 mock 造成的),需要用**真实relay 回环**(不是手写 stub)重新验证并写清楚具体触发条件,而不是笼统排除整张表。

## MUST-2(与 Bettor 猜测一致,证据更直接):`reconcileUncertainReservation` 生产代码零调用点——"结果不确定"分支完全没有落地,是死代码

设计 v0.2.1 §3.2 B.2 明确要求:IPC 超时(结果不确定)⇒ 保持预留 + 有界期限 + 到期先对账再释放。J2 实现了 `reconcileUncertainReservation`/`RESERVATION_UNCERTAIN_TIMEOUT_MS`,但:

```
git grep -n "reconcileUncertainReservation\|RESERVATION_UNCERTAIN_TIMEOUT_MS" -- kasia-console/src ':!*.test.mjs'
```
只命中 `proto-fee-reservation.mjs` 自己的定义——**三个真实调用点(`buildMarketGenesisAndBroadcast`、`buildRegisterAppendAndBroadcast`、`proto-settlement-driver-core.mjs`)一个都没接**。三处的真实代码是:

```js
try { const rep = await sendCmd(relayId, {type:'covenant_broadcast', ...}, 30000, ...); ... }
finally { releaseReservationOnPrepared(feeUtxo); }   // 或 driver-core.mjs 的 releaseFeeReservation
```

`finally` 无条件执行——`sendCmd` 无论是拿到明确的 relay 拒绝回执、还是**因为 IPC 超时/传输错误直接抛错**,预留都会立即释放,不区分"relay 明确说没广播"和"我们不知道 relay 广播了没有"这两种结局。driver-core.mjs 的代码注释试图论证"这里不需要不确定分支,因为 `sendCmd` 本身 await 到底、不会挂起不返回"——**这个论证不成立**:`sendCmd` 是否"挂起不返回"是**我们自己进程的等待行为**,跟 relay 是否已经真的完成了广播(甚至已经把交易送进了 mempool)是两件独立的事。IPC 超时意味着"我们等的这一侧没等到回复",不意味着"relay 那一侧什么都没发生"——恰恰是这类超时最容易发生在 relay **已经**调用完 `submitTransaction`、只是往回传回执的路上慢了/断了的场景,这正是设计文档要求"结果不确定"要保守处理的原因。

我确认了三个调用点均无区分,`reconcileUncertainReservation` 是纯粹的死代码(有测试覆盖它自身的单元行为,但生产没有一处会调用它)。

**修法**:三个调用点的 `finally` 需要拆开——relay **明确**拒绝(有 `rep.error`/`rep.code` 且不是 transport 异常)⇒ 立即释放;`sendCmd` **抛错**(transport/timeout,没拿到 relay 的明确回执)⇒ 交给 `reconcileUncertainReservation`(定时或下次选择前对账),不立即释放。这一点与 MUST-1 叠加时对创世/下注更严重:创世/下注没有 DB 层backstop(MUST-1 未修的话),提前释放 = 直接重开 A 臂那条死锁窗口,没有任何兜底。

## 第 3 点:M1/M4 覆盖面 —— 核实通过

- `selectAndReserveFeeUtxo` 覆盖创世(`proto-broadcast-ops.mjs:buildMarketGenesisAndBroadcast`)、下注(`buildRegisterAppendAndBroadcast`)、结算(`proto-settlement-ops.mjs:build` 的唯一 `tryEach` 闭包)三个入口,我逐个读码确认;`api/proto.js` 的两个 HTTP 端点(创建市场立即创世 `:186` 起、下注立即 append `:288` 起)分别经 `driveMarketGenesis`/`driveBetIntent` 调用上述两个函数,**是同一套代码路径**,不是另开的分支——覆盖成立。
- lint `R-FEE-SELECT-ONLY-VIA-WRAPPER` 我自己写了一个裸调用文件(`selectFeeUtxoByConstruction(` 直接调,不经过 `selectAndReserveFeeUtxo`)放进这棵树里跑 lint,**真的红**(报错文字与规则定义一致),跑完删除,没有提交。

## 第 4 点:F3(共用资格函数)—— 核实通过

- `filterFeeCandidates` 从 `proto-settlement-c1.mjs` 挪到 `proto-tx-assembly.mjs`,原文件改成 `export { filterFeeCandidates }` 的纯 re-export,`c1.mjs` 内部消费点(`verifyCore`)不用改 import 路径(有本地绑定的 re-export)。新位置的实现是逐字节相同的算法 + 新增 `isFiniteCandidateShape`/`skippedUnknown` 分类(F3 unknown-fail-closed 要求),我读码确认新增检查不会误伤任何既有合法候选(只筛掉形状不合法的条目)。
- 我独立在自己的树上跑了 9 个相关套件,全绿,零失败(`proto-settlement-c1.test.mjs` 46 项、`proto-tx-assembly.test.mjs` 41 项、`proto-fee-reservation.test.mjs` 29 项、`proto-broadcast-ops.test.mjs` 21 项、`proto-driver.test.mjs` 9 项、`proto-tx-assembly-settlement.test.mjs` 45 项、`proto-settlement-driver-core.test.mjs` 32 项、`proto-settlement-ops.test.mjs` 7 项、`proto-settlement-driver.test.mjs` 12 项)——结算既有测试确实零改动零回归。
- `proto-tx-assembly.test.mjs` 自带一个"F3-mutation 对照"(去掉 `isFiniteCandidateShape` 检查后行为验证会误判),说明 J2 自己对这一处也做了突变式验证,不是空判。
- Parity(F3b-1/F3b-2/F3b-4)只对安全维度(毒化 covenant / unknown 字段缺失)断言一致,没有把 `feeMinAmount` 拉进"一致性"判定(结算 `feeMin=cap`、创世/下注 `feeMin=0n` 仍各自独立)——符合 v0.2.1 round2 M4 的措辞。

## 第 5 点:跨入口争用 —— 单元级已证,集成级(HTTP×driver)待 rebase 后的争用测试

`proto-fee-reservation.test.mjs` 的 T-race-sequential 在**模块级**证明了"第一次选中后,第二次选择自动跳过、选到别的候选"(不需要等 DB 写入)。但目前**没有**一个测试真正并发调用 `buildMarketGenesisAndBroadcast`(或它经由 `api/proto.js` 的 HTTP 路径)与结算/另一次创世,在真实的 `await` 交错点验证"两个操作争同一个最佳候选,第二个绝不选中已被第一个占用的那个"——这正是 Bettor 说 rebase 会"顺手把 refund_flip 真实争用测试补进同批"要补的东西。**我这轮不为此单独开 MUST**(按 Bettor"逻辑问题现在审、争用测试等 rebase"的安排),但会在 rebase 后的增量核对里把这条列为必须验证项。

## 未做 / 局限

- 本轮基于**未 rebase**的 `0e24c821`;rebase 到 `f2f56815` 后的增量(冲突解法、新加的争用测试)我还没看,按 Bettor 说的等新 hash。
- MUST-1/MUST-2 的探针脚本(`_nwt_probe_genesis_prepared_write.mjs`)只针对**创世**侧做了完整的真实端到端复现;**下注(register_append)侧我是靠代码结构对称性推断**(`driveBetIntent`/`ensureBetIntent`/`recordBetIntentPhase` 的调用形状与创世逐项对应,relay 侧是同一段代码),没有单独跑第二个探针——如果 J2/Bettor 需要,我可以补一个,但结构已经足够确定,不认为会有不同结论。
- 没有验证"结算路径的 DB 层backstop 在真实超时窗口里够不够快"(即 relay 的 ingestPhase 写入与下一次并发选择之间谁先谁后)——这是 MUST-2 修完之后才有意义验证的时序问题,本轮不测。
