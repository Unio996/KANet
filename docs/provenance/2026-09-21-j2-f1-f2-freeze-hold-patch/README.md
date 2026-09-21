# F1 + F2 补丁说明(J2 · 2026-09-21)——冻结后 prepared close_commit 不重播 / 宽限窗不压缩

> 依据:账本 1614(Bettor 裁)、1615;Codex df07b0ec(F1 CONFIRMED MUST / F2 CONFIRMED)。
> 红证:`docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/`(commit 178f46ee)F 臂——冻结后 prepared resolve(eb527399…)被 driver `replayed same bytes → submitted` 并落地。
> 范围:**只 resolvePrepared 冻结重读 HOLD + 晚 seal 判据 graceMinMs→graceMs 两处**(见下"范围说明"对 evaluatePromoteGate 的一处同判据说明)。未动主线、未碰主网、未部署。

## 1. 改了什么(逐 hunk)

| 文件 | 改动 |
|---|---|
| `kasia-console/src/lib/proto-settlement-intent.mjs` | ① `import { isMarketFrozen }`(复用既有 `proto-settlement-freeze.mjs`,不另造读冻结的函数);② `resolvePrepared` 在 mempool 检查、landed 检查**之后**、无字节检查与同字节重播**之前**,对 `subject_type=market ∧ step=resolve`(=close_commit)重读冻结列:`isMarketFrozen` 明确返回 `false` 才放行,`true`/抛错一律按冻结 ⇒ `SettlementIntentHoldError(code=settlement_frozen)`,**不重播、不重建、不弃行**(行仍 prepared,字节原样);③ 首次 HOLD 落 `last_error='settlement_frozen_prepared_hold'` + 发 `settlement_intent_frozen_prepared_hold`(error)一条,之后每 tick 静默 hold(不刷 events、不刷 `updated_at`,以免重置 `settlement_prepared_stale` 去重键)。 |
| `proto-settlement-driver-core.mjs` | `SETTLEMENT_ALERTS` 登记 `settlement_intent_frozen_prepared_hold: 'error'`(闭集登记,1 行)。 |
| `proto-settlement-store.mjs` | 仅注释:原"已 prepared 的意图…不受冻结影响"是设计假设、已作废(1614 明写),改为指向 F1。 |
| `proto-settlement-budget.mjs` | F2:`evaluateLateSeal` 判据 `graceMinMs`→`graceMs`;**同判据在 `evaluatePromoteGate`**(`upperMs < graceMs ⇒ freeze late_seal`,`effectiveGraceMs = cfg.graceMs`,删 `Math.min(graceMs, upperMs)` 压缩);`GRACE_MIN_MS` 保留为**只校验配置**(仍须 ≤ GRACE,env `PROTO_GRACE_MIN_MS` 仍接受,不破配置)。 |
| `proto-settlement-freeze.mjs` | 仅注释(晚 seal 判据措辞)。 |
| 3 个测试文件 | `proto-settlement-intent.test.mjs`(新增 ⑨-a…⑨-f 六组 F1 回归)、`proto-settlement-budget.test.mjs`(L1/G7 改 graceMs 边界 + 弱注入臂)、`proto-settlement-freeze-v213.test.mjs`(Z10 改 graceMs 边界)。 |

## 2. 范围说明(请 Bettor/NWT 特别看这三点)
1. **`evaluatePromoteGate` 的同判据一并改了**(budget.mjs `:204-205`)。1614 字面写"evaluateLateSeal 判据 graceMinMs→graceMs",但 promote 门里是**同一个判据的第二份拷贝**(freeze.mjs 头注也写"promote 门自己也会在 promote 时再判一次晚 seal, 双覆盖")并且带真正的压缩(`Math.min(graceMs, upperMs)`)。只改 evaluateLateSeal ⇒ seal 时不 late 的市场在 promote 时仍会被压缩宽限,F2 不成立(Codex:"GRACE_MIN 只可校验配置不可运行时压缩")。若 Bettor 认为越界,可只回退这两行,其余不受影响。
2. **主网默认值影响**:晚 seal 冻结阈值由 5 min(GRACE_MIN)升到 30 min(GRACE,默认)——seal 须在 `deadline + 100min − MARGIN(2min) − 30min = deadline + 68min` 前落地,否则冻结。simnet(GRACE=2min/MIN=1min)阈值 1→2 min。**无配置迁移**。
3. **新增一个报警名**(`settlement_intent_frozen_prepared_hold`)——"必须有告警"是 1614 的要求;该名只在 `SETTLEMENT_ALERTS` 闭集登记(intent 层直写 events,不经 core 的 makeAlerter,与 `settlement_intent_prepared_without_bytes` 同构)。

## 3. 回归覆盖(Codex df07b0ec 要求"两路")
- **⑨-a first-send-after-prepare**:fresh 路径 `buildAndBroadcast` 先落 prepared(字节入库)再首发失败(`driveSettlementIntent` 以 exhausted 收场,行停 prepared)→ **冻结后到** → 下一次驱动 ⇒ HOLD(`settlement_frozen`),`covenant_broadcast` 零条,行仍 prepared 且字节原样;重复驱动不刷 events / `updated_at`。
- **⑨-b crash-recovery replay**:上一进程留下的 prepared 行 + 已冻结 ⇒ `resumeStaleSettlementIntents`(`held=1 resolved=0`)零广播;同一行走 `driveSettlementIntent` 的 prepared 分支(即 driver 每 tick 的 listWork preparedRows 路径)同样 HOLD 零广播。
- **⑨-c 正对照(单字段差异)**:同构 prepared 行 + **未冻结** ⇒ 重播确实发生(1 条 `covenant_broadcast`,行转 submitted;resume 路径亦然)——证明 a/b 的"零广播"不是夹具本身发不出去。a/b 与 c 的唯一差别 = `proto_markets.settlement_frozen_at` 一列。
- **⑨-d 顺序**:冻结 ∧ 已在 mempool / 已落链 ⇒ 照常记 submitted、零广播、**不** hold(冻结否定不了已发生的事实)。
- **⑨-e 范围钉死**:只限 close_commit;seal 行在冻结市场上仍照常重播(冻结语义 = "close_commit 三入口")。
- **⑨-f fail-closed**:冻结列读不到(该 subject 无市场行 ⇒ `isMarketFrozen` 抛)⇒ 按冻结 HOLD。
- **突变验证**(`mutation-*.txt`):把 F1 闸禁用(`if (false && …)`)⇒ intent 测试 **12 项红**(正是 simnet 红证的形状:`covenant_broadcast` 1 条、行转 submitted);把 F2 判据还原为 graceMinMs(+`Math.min` 压缩)⇒ budget L1/G7 与 freeze Z10 **3 项红**。改回后全绿(`green-*.txt`,11 个套件 exit=0)。
- 验证局限:以上是**离线向量**(真迁移临时库 + 脚本化 relay 桩,零链)。**未**在 simnet 真共识上重放 F 臂(矿工停、simnet `isSynced=false`;重起矿工与在补丁代码上重起 3298 console 需 Bettor 先点头)。这与 1614"F1 派小补丁+测试"的口径一致,活体复验是可选 corroboration。

## 4. 附带观察的定性(Bettor 1615 追问)
> 观察:F 臂冻结后,`convert_to_claim` / `claim_draw` 也 landed。

**结论:是 MUST① 同一根因的下游,不是独立缺口。**
- 读码:`store.mjs listWork` 的 `convert_to_claim` 选行条件 = `c.side='win' ∧ m.status='resolved' ∧ EXISTS(resolve landed)`,**无冻结过滤**;`claim_draw` 同。这与冻结的既定语义一致——`proto-settlement-freeze.mjs` 头注:"冻结 = 该市场结算不再前进: **close_commit 三入口** fail-closed",冻结范围本来就只有 close_commit。
- 因果链:prepared close 冻结后仍落地(F1)⇒ `markLanded` 使市场 `resolved` ⇒ 依赖链正常放行下游两步。F1 修复后,**冻结在 close 落地之前**的市场不会再到 `resolved`,下游两步不会被触发;**冻结在 close 落地之后**的市场(winning_side 已上链、赢家已有权益)继续 claim 是正确的,拦它反而会困住赢家资金。
- 不扩补丁面:未改 claim 路径;测试 ⑨-e 钉死范围。若设计上要"冻结也拦 claim",那是新决定,应另立票。

## 5. 未覆盖 / 需要 Bettor 决定(我没做,因为超出"两处")
**F1b(可选、同根因的第三个点):fresh 路径首发的 TOCTOU 窗口。** driver-core 在 `:172-174` 读冻结(false)⇒ 构造 ⇒ IPC 到 relay ⇒ relay 先 `ingestPhase(prepared)`(`covenant-broadcast-relay.mjs:189`,**失败即不广播**,relay 侧对 console 返回非 2xx 会 throw ⇒ `prepared_ingest_failed`)再 `submitTransaction`(:197)。若冻结恰好落在 `:172` 读取之后、relay 落 prepared 之前,首发仍会广播。**堵法零新机制**:`recordSettlementIntentPhase`(console 侧 `/ingest/proto-bet-intent-phase` 的 `settle:` 分派,本就是"广播前落库"的既有否决点)对 `market:resolve` 的 `prepared` 阶段读一次 `isMarketFrozen`,冻结 ⇒ 返回 `{ok:false}` ⇒ 409 ⇒ relay 拒广播。这是 Codex 说的"最终 send 边界"里 **first send** 的那一半;本补丁覆盖的是 **replay** 那一半(及首发失败后的下一 tick 重播)。**未做,等 GO**;残余窗口 = 冻结落在 relay 落 prepared 与 submit 之间的毫秒级(relay 无 DB,不可再堵)。

## 6. 证据文件
- `green-*.txt`:补丁后 11 个套件全绿输出(intent / budget / freeze-v213 / driver-core / store / oracle-adapter-core / oracle-spec / ops / oracle-adapter / ingest-settle-dispatch / relay-ipc)。
- `mutation-F1-guard-disabled-intent-test.txt`、`mutation-F2-graceMin-restored-budget-and-freeze-tests.txt`:突变红。
- lint:`node scripts/lint-kanet.mjs <改动文件>` 0 error。
