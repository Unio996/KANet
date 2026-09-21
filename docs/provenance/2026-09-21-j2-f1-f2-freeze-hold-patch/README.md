# F1 + F1b + F2 补丁说明(J2 · 2026-09-21)——冻结后 prepared close_commit 不重播不首发 / 宽限窗不压缩

> 🔴 **首段后果(Bettor 1617 裁定要求单列,Owner 可否决)**:F2 使**主网默认晚 seal 冻结阈值由 5 分钟(GRACE_MIN)升到 30 分钟(GRACE)**——`seal` 须在 `deadline + 100min − MARGIN(2min) − 30min = deadline + 68min` 前落地,否则市场冻结(走既有安全终局 refund_flip),而不再靠"压缩宽限"放行。simnet(GRACE=2min/MIN=1min)阈值 1→2 分钟。**无配置迁移**(`PROTO_GRACE_MIN_MS` 仍被接受、仍须 ≤ GRACE,只是运行时不再读它)。**只合不部署**:下次主网 console 重启才生效。
>
> 依据:账本 1614(Bettor 裁)、1615、1616、1617(F1b GO);Codex df07b0ec(F1 CONFIRMED MUST / F2 CONFIRMED)。
> 红证:`docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/`(已入主线)F 臂——冻结后 prepared resolve(eb527399…)被 driver `replayed same bytes → submitted` 并落地。
> 未动主线、未碰主网、未部署。

## 0. 边界声明:冻结不回溯已落链 close
冻结 = "该市场 **close_commit 三入口** fail-closed"(`proto-settlement-freeze.mjs` 头注),**不回溯已落链的 close**。close 已落链之后才冻结的市场,其 `convert_to_claim` / `claim_draw` 继续走是**正确**的(winning_side 已上链、赢家已有权益,拦它反而困住赢家资金)。simnet F 臂里"冻结后 convert/claim 也 landed"是 MUST① 的**同根因下游**(前提"close 已落链"是被 F1 缺陷造出来的),不是独立缺口;F1/F1b 修后,**冻结在 close 落地之前**的市场到不了 `resolved`,下游两步不会被触发。**日后若要加"运营应急冻结",须先定这条边界**(是否也要拦已落链 close 之后的 claim)——那是新决定,应另立票。补丁未改 claim 路径,测试 ⑨-e 钉死范围。

## 1. 改了什么(逐 hunk)

| 文件 | 改动 |
|---|---|
| `kasia-console/src/lib/proto-settlement-intent.mjs` | ① `import { isMarketFrozen }`(复用既有 `proto-settlement-freeze.mjs`,不另造读冻结的函数)。② **F1**:`resolvePrepared` 在 mempool、landed 检查**之后**、无字节检查与同字节重播**之前**,对 `market:resolve`(=close_commit)行重读冻结列:`isMarketFrozen` 明确 `false` 才放行,`true`/抛错一律按冻结 ⇒ `SettlementIntentHoldError(settlement_frozen)`,不重播、不重建、不弃行(行仍 prepared,字节原样);首次落 `last_error` 标记 + 报警一条,其后静默(不刷 events / `updated_at`)。③ **F1b**:`recordSettlementIntentPhase` 的 `prepared` 阶段对 `market:resolve` ∧ 行 `pending|prepared` 读一次冻结,冻结/读不到 ⇒ `{ok:false, code:'settlement_frozen'}`、**不落 prepared**(行保持 pending、无字节)+ 报警;`ingest.js` 既有的 `!r.ok → 409` ⇒ relay 既有的"prepared 落库失败即不广播"。**`submitted` 阶段永不否决**(已广播的事实必须记,NO TX NO STATE)。 |
| `proto-settlement-driver-core.mjs` | `SETTLEMENT_ALERTS` 登记 `settlement_intent_frozen_prepared_hold: 'error'`(1 行;F1 与 F1b 共用该名,F1b 的 payload 带 `stage:'prepared_receipt_refused'`)。 |
| `proto-settlement-store.mjs` / `proto-settlement-freeze.mjs` | 仅注释(作废"prepared 不受冻结影响"的设计假设 / 晚 seal 判据措辞)。 |
| `proto-settlement-budget.mjs` | **F2**:`evaluateLateSeal` 判据 `graceMinMs`→`graceMs`;**同判据在 `evaluatePromoteGate`** 一并改(`upperMs < graceMs ⇒ freeze late_seal`,`effectiveGraceMs = cfg.graceMs`,删 `Math.min(graceMs, upperMs)` 压缩;Bettor 1617 裁"不算越界");`GRACE_MIN_MS` 只校验配置。 |
| `docs/2026-09-20-bettor-oracle-batchD-…-design-v0.1.md` | 页首加一行"判据被 1614 F2 取代,以 proto-settlement-budget.mjs 为准",**正文不动**(NWT SHOULD)。 |
| 测试 | `proto-settlement-intent.test.mjs`(⑨-a…⑨-g)、`ingest-settle-frozen-veto.test.mjs`(**新**,F1b 端到端)、`proto-settlement-budget.test.mjs` L1/G7、`proto-settlement-freeze-v213.test.mjs` Z10。 |

## 2. 回归覆盖
**F1(replay 路径,`resolvePrepared`)**——`proto-settlement-intent.test.mjs`:
- ⑨-a:fresh 路径 prepared 已落库、**首发失败**后冻结到 → 下一次驱动 HOLD,零广播,行仍 prepared,重复驱动不刷 events/`updated_at`。⑨-b:上一进程留下的 prepared 行 + 已冻结 ⇒ `resumeStaleSettlementIntents`(`held=1`)与 `driveSettlementIntent` prepared 分支(=driver 每 tick 的 preparedRows)都不重播。⑨-c:正对照(仅 `settlement_frozen_at` 不同)未冻结会重播 1 条。⑨-d:冻结 ∧ 已在池/已落链 ⇒ 照常 submitted(冻结不否定已发生的事实)。⑨-e:范围钉死只限 close_commit(seal 照常)。⑨-f:冻结列读不到 ⇒ fail-closed HOLD。
- ⚠ ⑨-a/⑨-b 与 crash-recovery 同走 `resolvePrepared`,**测不到首发 TOCTOU**——那是 F1b 的事(下)。

**F1b(first send,prepared 回执否决点)**:
- ⑨-g(单元):冻结 ⇒ prepared 回执 `ok:false`、行仍 pending/无字节、报警 1 条;正对照未冻结正常落;冻结后 `submitted` 回执仍被记;seal 不受影响;读不到冻结列 ⇒ 拒。
- `ingest-settle-frozen-veto.test.mjs`(**端到端,NWT 验收线的时序**):**真** driver-core(`advanceStep`,真入口③冻结闸)+ **真** relay `covenantBroadcastRelay`(fresh 路径)+ **真** relay ingest 客户端(真 `fetch` 打回环 HTTP)+ **真** console fastify 路由(PSK / relay_id 鉴权 / `settle:` 分派)+ 真迁移库;只有 kaspa-wasm/rpc 是拷自 relay 测试的最小假体。冻结动作挂在 `isSettlementFrozen` 端口**返回 false 之后**——即"driver-core 读冻结=false 之后、prepared 回执落库之前冻结落地":`rpc.submitTransaction` 调用 **0** 次,relay 回 `prepared_ingest_failed`(错误串带 `HTTP 409` + frozen 原因),console 行仍 pending/无字节,下一 tick 入口③ `gated`。正对照(同接线、不冻结)广播 1 次、行 submitted——证明"零广播"不是链路本身坏了。
- **relay 侧"非 2xx 即 throw"用测试钉住**(不只靠读码):`ingestProtoBetIntentPhase` 对 409 reject、对 2xx resolve(该测试第 ③ 组);relay 既有 `FRESH-2`(prepared ingest 失败 ⇒ 不广播)未动。

**F2**:`proto-settlement-budget.test.mjs` L1/G7、`proto-settlement-freeze-v213.test.mjs` Z10 改 graceMs 边界,加 `[GRACE_MIN, GRACE)` 区间必冻结的回归与"只改 graceMinMs 结论不变"的弱注入臂。

**突变(证明测试不空,`mutation-*.txt`)**:
| 突变 | 结果 |
|---|---|
| F1 闸禁用(`resolvePrepared` 冻结重读 `if (false && …)`) | intent 测试 **12 项红**(形状 = simnet 红证:`covenant_broadcast` 1 条、行转 submitted) |
| F2 判据还原为 graceMinMs(+`Math.min` 压缩) | budget L1/G7 + freeze Z10 **3 项红** |
| **F1b 冻结读取删掉**(`recordSettlementIntentPhase` 的否决 `if (false && …)`) | intent ⑨-g 4 项红 + 端到端 **零广播断言红(`submitTransaction` 调用 1 次)**、core 视为 submitted、行转 submitted(`mutation-F1b-deleted.txt`) |
| **F1b 冻结读取挪到写 prepared 之后**(先写 prepared 再读冻结,冻结则返回 `ok:false`) | 广播仍是 0(relay 仍拒),但**行被污染成 prepared/带字节**:⑨-g 3 项红 + 端到端行断言红、下一 tick 变 `held` 而非 `gated`(`mutation-F1b-moved-after-write.txt`)。为什么钉"不落行":prepared 行 = "字节已签、即将发送"的断言,relay 明明被拒却留下一条,操作员无法区分"真发过"与"被拒"——状态说谎。 |
全部改回后各套件全绿(`green-*.txt`)。

## 3. 残余窗口(口径:**收窄**,不写"堵死")
F1b 把首发 TOCTOU 窗口从"driver 读冻结 → relay 写 prepared 之间的整段 build + IPC"**收窄到"console 处理 prepared 回执的那次读冻结 → relay 收到 ok 回执并 `submitTransaction`"这一次 IPC/HTTP 往返**。冻结若恰落在这一往返内,首发仍会广播——**跨进程,console 无法保证归零**(relay 无 DB,不可再堵)。该窗口内广播的那一笔,在效果上等价于"冻结在广播之后一瞬间落地":已广播的事实不可撤,其后按 §0"冻结不回溯已落链 close"处理。

## 4. 验证局限
以上是**离线向量**(真迁移临时库 + 脚本化桩,含一条真 HTTP 端到端),零链;**未**在 simnet 真共识上重放 F 臂(矿工停、simnet `isSynced=false`;重起矿工与在补丁代码上重起 3298 console 需 Bettor 先点头)。活体复验是可选 corroboration。lint 0 error。

## 5. 证据文件
- `green-*.txt`:补丁后各相关套件全绿输出。
- `mutation-F1-guard-disabled-intent-test.txt`、`mutation-F2-graceMin-restored-budget-and-freeze-tests.txt`、`mutation-F1b-deleted.txt`、`mutation-F1b-moved-after-write.txt`:突变红。
