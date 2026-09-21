# NWT 一轮审:F1 + F1b + F2 补丁(J2)—— verdict:**MUST 0**

- 审的对象:`origin/coord/j2-f1-f2-freeze-hold-20260921 @ca4459b0`,实质改动 = `a4d5c2d7`(F1 + F2)+ `a1b2c279`(F1b);`27c701cd` 是合主线、`ca4459b0` 是 provenance 更正 + verify-arms 判据改版(本轮顺看)。源码改动全在 `proto-settlement-intent.mjs`(+40 行,含两处闸)、`proto-settlement-budget.mjs`(F2 两处判据)、`proto-settlement-driver-core.mjs`(1 行报警登记)、注释若干;新增测试 `ingest-settle-frozen-veto.test.mjs` + intent ⑨-a…⑨-g + budget/freeze-v213 边界改写。
- 审的人:NWT(claude.exe PID 33408)。自己的 worktree `scratch/_nwt_wt_f1f2`(独立 `npm ci`:kasia-console + kasia-relay,零 junction);**不进 J2 的树、不碰 D:\kanet-tn12 分支、主网零触碰**。突变每个都在我自己的树里改、跑、`git checkout` 还原(`git status` 全程干净)。
- 口径:一轮只报 MUST。SHOULD 单列,不阻塞合入。

## 验收线逐条

**① first-send-after-prepare 与 crash-recovery replay 两路回归都真在、突变能杀 —— 满足**
- 两路在代码里是两个不同的点:crash-recovery/重试重播 = `resolvePrepared` 的冻结闸(`proto-settlement-intent.mjs:~174`,全仓对 settle: 行发 `replay_tx_json` 的唯一入口是 `:198`,relay 侧无自主重播);first-send TOCTOU = `recordSettlementIntentPhase` prepared 阶段的读冻结(F1b)。
- F1 突变 9 个(`mutation/mut-f1.*`),在补丁尖 `ca4459b0` 上重跑,全杀且死在预期组:闸禁用→⑨-a+⑨-b 同时红(两路都真在);范围放宽→⑨-e;catch 改 fail-open→⑨-f;去重删/标记不写→⑨-a;错 id 过度拦截→⑨-c(正对照真在守);闸挪到 mempool/landed 之前→⑨-d;HOLD 不抛/code 改名→⑨-a+⑨-b。
- F1b 突变 9 个(`mutation/mut-f1b.*`):读冻结删掉→veto 测试 ②+③ 与 ⑨-g 同红;返回 ok:true(去掉 409)→②+③ 红;写 prepared 之后才拒(行被污染)→②+③ 红;错 id 过度拦截→① 正对照红;catch fail-open / 范围放宽到 seal / 去报警 / submitted 阶段也被否决→⑨-g 红(e2e 不覆盖这四条,单元层覆盖)。

**② F1b 的 TOCTOU 回归与突变 —— 满足**
- `ingest-settle-frozen-veto.test.mjs` 真的接线:真 `createSettlementDriver`(入口③冻结闸→pmt 门→build→covenant_broadcast)+ 真 `covenantBroadcastRelay` fresh 路径 + relay 真 `ingest.mjs` 客户端(真 fetch 打回环 HTTP)+ console 真 fastify 路由(真 PSK 鉴权 + `settle:` 分派)+ 真迁移库;假的只有 kaspa-wasm/rpc(拷自 relay 既有测试)和 driver-core 的取证/构造端口桩。
- 时序是真的:冻结动作挂在 `isSettlementFrozen` 端口**返回 false 之后**(T0 读到 false → T1 冻结落地 → core 继续 build → IPC → relay 写 prepared),不是 ⑨-a 那种"首发失败后再驱动"。判据取 `rpc.submitTransaction` 调用次数:未冻结正对照 = 1 次且行 submitted(证明整条链路是通的),冻结落地在窗口内 = **0 次**、relay 回 `prepared_ingest_failed`(HTTP 409)、console 行保持 pending 无字节、下一 tick 被入口③ gated。另钉 relay ingest 对非 2xx throw / 2xx resolve(不只靠读码)。
- 我核实的 relay 分支:`covenant-broadcast-relay.mjs` fresh 路径在 `ingestPhase(prepared)` 失败时 `return { code:'prepared_ingest_failed' }`,位置在 `rpc.submitTransaction` 之前。

**③ F2:evaluateLateSeal 与 evaluatePromoteGate 两处同判据、GRACE_MIN 只剩配置校验 —— 满足**
- 两处判据都是 `upperMs < cfg.graceMs`;promote gate 的 `Math.min` 压缩已删。突变 7 个(`mutation/mut-f2.*`):两处各自回 graceMinMs、两处边界各自 `<`→`<=`、GRACE_MIN≤GRACE 校验删、默认 GRACE 30→5min 全杀(late_seal 一侧 budget L1 + freeze Z10 双杀,promote 一侧 budget G7 单杀);唯一存活的"promote gate 里 `effectiveGraceMs` 改回 `Math.min(graceMs, upperMs)`"是**等价突变**(上一行 `upperMs<graceMs` 已冻结,过了守卫 min 恒等于 graceMs),不计缺测。F2 相关文件自 a4d5c2d7 起未再变(diff 空),故该组沿用 a4d5c2d7 上的结果。
- 全仓 `graceMinMs/GRACE_MIN` 引用:运行时只剩 `budget.mjs` 的配置校验/默认常量。

**④ 主网默认晚 seal 阈值 5→30 分钟有无漏改的第三处 —— 满足(无漏改)**
- `api/proto.js`、`proto-bet-intake.mjs`、driver、adapter 都只是 `resolveBudgetConfig` 的消费者;`proto-oracle-spec.mjs:117` 建市场时 `minDeadlineMs = oe + uma + graceMs + margin + vote` **本来就按完整 graceMs 预留**——创建期契约与 F2 新判据一致,所以 5→30 的实际影响仅限"seal 晚于 deadline+68min(原 +93min)"的极晚 seal(冻结→refund_flip 安全终局)。补丁说明首段已单列该后果并写"Owner 可否决"。
- 文档漂移已处理:`docs/2026-09-20-bettor-oracle-batchD-grace-refundflip-budget-design-v0.1.md` 页首已加"判据被 1614 F2 取代"一行。

**⑤ 范围钉死只限 close_commit —— 满足**
- 两处闸都带 `subject_type==='market' && step==='resolve'`;⑨-e(resolvePrepared 一侧,seal 在冻结市场仍照常重播)与 ⑨-g(F1b 一侧,seal 的 prepared 回执不受冻结影响、submitted 回执永不被否决)各有断言,对应突变(范围放宽 I2/V4、submitted 也否决 V9)均被杀。

## 独立复跑(在补丁尖 ca4459b0)
- 套件全绿:intent 57 断言 / budget 21 / freeze-v213 13 / driver-core 31 / store 19 / oracle-adapter-core 22 / oracle-spec 12 / ops 6 / oracle-adapter 7 / **ingest-settle-frozen-veto 13** / relay-ipc 34 / relay covenant-broadcast 22。lint 0 error(改动的三个源文件)。
- 过程中一个我自己的环境问题(非补丁问题):第一次跑 relay-ipc 因我没装 kasia-relay 依赖报 `ERR_MODULE_NOT_FOUND`;独立 `npm ci` 后全绿。

## ca4459b0 顺看:verify-arms F 判据改法 —— 合我 ③ 建议,且没把红证洗白
- 新判据 = 意图侧"无 submitted/landed/ambiguous 的 resolve 意图(pending/prepared 不判红)" + 节点侧"close txid 无痕迹(mempool / 输出仍未花 / 输出被已知意图字节花掉)";有 txid 行但没给 `--rpc` ⇒ VACUOUS(不当证据)而不是 PASS;先断言 `networkId==--network` 才查询。
- 结果:F-pre-seed(自然竞态态)31/31 PASS(旧判据的字面 FAIL 消失);终态 29 PASS / 2 FAIL,**两条 FAIL 都在 F 臂且是预期的红**(意图侧 `["landed"]`;节点侧 eb527399 痕迹 `unspent_out1, spent_by_known_tx`)——即新判据仍能抓住历史红证,没有把它判成绿。README 三处更正(pmt 时钟 vs 墙钟、idx1=fee 找零、判据改版)与我 b804c805 的三条一致。

## SHOULD(不阻塞合入,记票)
1. **F1b 的状态条件未被测试覆盖**:`(cur.status === 'pending' || cur.status === 'prepared')` 这一子句删掉,全套测试仍绿(突变 V5 存活)。该子句只影响"对已 submitted/landed 的行收到迟到的 prepared 回执"这一不可达形状(relay fresh 路径只对 pending 行发 prepared 回执),删掉只会多否决一个不可达回执,故不是缺陷;建议二选一:补一条断言(冻结 ∧ 行已 submitted ∧ 迟到 prepared 回执 ⇒ 不被否决、行不变),或直接删去该子句让规则更简单。
2. **F1b 的报警不去重**:每次被拒的 prepared 回执都发一条 `settlement_intent_frozen_prepared_hold`(resolvePrepared 一侧有 last_error 标记去重)。冻结后 pending 行不再被 listWork 选中,所以实际至多 1 次,只是与 F1 一侧的处理不对称,记着即可。
3. 口径提醒(已在补丁说明里写,重申):F1b 只把首发窗口**收窄**到"console 读冻结 → relay 收到 ok 回执并 submitTransaction"一次 IPC/HTTP 往返,跨进程不可能归零;对外不要写"堵死"。

## 证据
- `mutation/mutate.mjs`(突变跑器:只在 NWT 树里改文件,跑完 `git checkout` 还原)、`mutation/mut-*.specs.json`(突变定义)、`mutation/mut-*.result.json`(逐突变的红数/死在哪一组)。
- 未做:没有在 simnet 真共识上重放 F 臂(J2 也未做,矿工停;补丁说明已写明是离线向量 + 真回环 HTTP 的 e2e);活体复验若需要须 Bettor 先点头重起矿工与 console。
