# 市场5 首注彩排制 — 设计稿(第一个真实市场 ZK 完整端到端)

> **Status**: CURRENT(v1.1·2026-07-08 按 NWT 红队 verdict ②③修订:彩排制改两场制)
> **作者**: Bettor(架构师帽)2026-07-08 · **红队审**: NWT verdict ①②③④已吸收(②closed!=1 fail-closed 结构洞/③fixture-receipt 内部矛盾→两场制根治) · **Owner DoD**: 第一个含 zk_close+claim 的真实市场完整端到端
> **上游依据**: COORD-LEDGER checkpoint(9bf1c33f)接力点① + `docs/2026-07-07-closezk-claim-complete-design.md`(claim 设计+exit-path 矩阵+§4 硬门) + `docs/2026-07-06-zk-close-tick-production-wiring-design.md`

---

## §0 一句话(v1.1 两场制)

**先跑一场"彩排场"(市场5R):最小真实市场(双边各注 1.5KAS)走完 create→attest→真 prove→zk_handoff→zk_close→claim 完整真实生命周期,每个 money-entry 广播前用 cli-debugger 对生产 builder 产出的 witness 做 pre-broadcast 门;5R 的 claim 落链后,"正式场"(市场5)才开放押注,沿用同一套 pre-broadcast 门。** debugger 从"69KAS 验尸"前移到"~4.5KAS 体检"。

**v1.0→v1.1 修订根因(NWT verdict ②③)**: v1.0 让彩排发生在首注后立即(closed==0),但 zk_handoff 生产 builder(readPayoutShardV2AttestedState)对 closed!=1 fail-closed throw(bshard-close-enforce.mjs:202-205,J1 作者确认+Bettor 源码实证)、zk_close 生产 builder(dispatchUnlockZkClose)强制真实 receipt_hex+proving.ready——v1.0 字面走不通,实现者会被逼"伪装 closed=1"或"fixture receipt"=正是 §1 要防的 vacuous。根治=不再在假状态上彩排,**让彩排场自己真实走到每个状态,debugger 门插在每次广播前**。彩排输入因此天然 100% live(closed==1 是真 attest 写的,receipt 是真 prove worker 产的),§1 原则零妥协。

**治的病**: 昨晚 72.31KAS 学费全是同一家族——"driver ctx 对、生产路径落后/从未跑过"(anchor offset 过期、硬门 vacuous、voter 落库静默丢失)。claim 是全链唯一从未真实触发过的一环,且 closed==2 无逃生舱(选A 知情风险已裁,4 绑定条件)。彩排 = 在敞口只有 1.7KAS 级时把这些引爆。

## §1 反 vacuous 承重原则(本设计的脊柱·NWT 重点审这条)

昨晚 anchor 硬门被"同函数双侧复算"架空(vacuous,门责在 Bettor)。彩排若用手搓 witness/自造输入,同病复发——彩排会绿、生产会死。因此:

1. **彩排输入必须 live-derive**: PS redeemHex 从**落链后的真实 UTXO/DB 记录**读取(非本地重编译产物);outpoint、valueSompi、anchor 全部取链上实况。
2. **witness 必须由生产 builder 构造**: zk_handoff 的 witness 走 `buildCloseZkV2GenesisFromAttestedState` 同一条代码路(closezk-v2-mint.mjs);zk_close 的 gate sigScript 走 `dispatchUnlockZkClose` 的确定性重建路(zk-close-dispatch.mjs:54-60);claim witness 走(待落码的)生产 claim builder。**禁止为彩排另写一套 witness 拼装脚本**——彩排验证的对象就是生产代码本身。
3. **debugger 只做执行器**: cli-debugger(`D:/silverscript/target/release/cli-debugger.exe <x.sil> --test-file <x.test.json> --run-all`)逐 require 实跑,任何 require 红 = STOP。
4. **独立第二路**: Bettor 对彩排的关键中间值(anchor、payoutRoot、leaf hash)独立盲算,与生产 builder 产物比对——两条真正独立的推导路径,不是同函数复算。

## §2 彩排协议(三阶段)

### T0 — create 前离线自检(不花钱)
- T0.1 用与生产完全相同的参数离线编译 CloseZkV2 + PayoutShardV2,`computeCloseZkTmplAnchor` live-derive 跑通 + round-trip 自证(4b712f50 修复路径);
- T0.2 anchor 值 Bettor 独立推导比对(§1.4);
- T0.3 4-entry selector dispatch 显式验证(claim 设计 §7 开放问题:entry 顺序/selector 路由,memory `feedback-ss-entry-reorder-breaks-handler-selector`);
- T0.4 offset tripwire 测试套件绿(a5b66a5d)。

### T1 — 彩排场(市场5R):最小真实市场完整生命周期(敞口 ~4.5KAS+maker spine 可回收)
- T1.1 create-v07(ZK-native: `resolution_rule_spec.zk_native=true`,**brokered**: create-v07 默认路自动挂 broker-1,J1 已核 GREEN);maker 100KAS spine(Owner skin-in-game 硬校验,不绕;refund 路可回收);**短押注窗**(~15-30min,8.0 DAA/s 换算);**create 后回读 DB 实际 deadline_daa**;
- T1.2 **双边各注 1.5KAS**(两只团队 relay,经 gateway)——保证必有赢家 leaf+输家,claim 真实可触发且非 degenerate;
  - **claim 分支覆盖依赖 brokered 事实(NWT 复审观察,显式记录非隐性前提)**: 赢家 leaf+broker-1 fee leaf = ≥2 个独立 claimant,顺序 claim 天然覆盖 `else` 续锁分支+`if` 精确清零终结分支两条(正式场大概率撞的就是 else 路)。**谁先 claim 顺序不定,两种顺序都算过关。复用 5R 脚本者若改成 non-brokered 会悄悄弄丢 else 分支覆盖——禁改。**
- T1.3 deadline 到 → propose(driver 薄壳踢)→ voter/submit cron 自治 attest(closed 0→1,**真状态**)→ 自动 enqueue → prove worker **~4min 真 Groth16**(禁 fixture,NWT ③裁定采纳)→ gate 铸造注资;
- T1.4 **pre-broadcast 门①(zk_handoff)**: 生产 builder(buildCloseZkV2GenesisFromAttestedState)读真 attested PS(closed==1)构造 witness → cli-debugger run-all 全绿 + Bettor 盲算比对 → 确认令 → 广播 → landed;
- T1.5 **pre-broadcast 门②(zk_close)**: dispatchUnlockZkClose 用真 receipt_hex 确定性重建 → debugger run-all → 确认令 → 广播 → landed;
- T1.6 **pre-broadcast 门③(claim,全链首次)**: 生产 claim builder(缺件1)构造赢家 witness → debugger run-all(**含最后一笔精确清零分支**)→ 确认令 → 广播 → claim landed + 守恒验证;
- T1.7 5R 全链闭合 → 频道贴三门证据(每门 require 清单+关键值+txid)→ **正式场放行令**。任何门红 = STOP(§6),5R 走 daemon 自动退款路。

### T2 — 正式场(市场5):彩排过关后开盘
- T2.1 create+开放押注(团队 relay 双边起,注额最小化,总敞口锁 ~104KAS 内);
- T2.2 同 T1.3-T1.6 全流程,三个 pre-broadcast 门照走(已彩排过=体检,非首验);
- T2.3 全部赢家 claim 链上核验后才标 completed(禁 settleMarketLive 旧病,中间态 zk_closed_claims_pending);
- T2.4 Bettor 全程盲算(winner/payoutRoot/守恒)+ 六 vantage 终验 → 记账 COORD-LEDGER。
- **注**: 若 Owner 认可,5R 本身闭合即已满足"第一个真实市场完整端到端"(真实 create 路/真钱/真 broker fee/真 claim,诚实标注:2-bettor 微型市场+propose driver 触发);正式场是规模化第二证。

## §3 前置硬门 checklist(create 前逐条贴频道,缺一不点火)

| # | 硬门 | 负责 | 依据 |
|---|---|---|---|
| 1 | gateway(KANet-UI-tn)UTXO consolidate 完成+链验(昨晚押注线断因) | KANet-UI | COORD-LEDGER 线(3) |
| 2 | 开关矩阵核实(SETTLE_DAEMON/ZK_CLOSE_TICK/ZK_PROVE_WORKER/VOTER_V2/SUBMIT_V2 当前态+放行计划) | J2 | index.js 接线 |
| 3 | exit-path 矩阵走查证据贴频道(closed==2 选A 4 绑定条件复述)| Bettor+NWT | ✅前半 #bk9qoh+NWT 联签(04:13);后半=5R mint 后带实参复走,并入 T1.4 确认令,NWT 复核防占位值糊弄 |
| 4 | Σleaf==pool BLOCKING 断言 + fee_leaves 非空(broker-1)确认 | J1 | ✅(enqueue 生产路 L79-84+create-v07 自动挂 broker-1;死导出收敛=跟进卡) |
| 5 | anchor 对当次实际编译重算(禁缓存) | J2 | ✅机制(live-derive 4b712f50+tripwire;genesis 时核对) |
| 6 | ESCAPE_GRACE_MS=21600000(6h)定标签字 | Bettor 提案+J1 second+NWT 验算 三票✅(04:12) | 推导:15min stuck-alert(实证)+3h 环境重建(实证)+4min prove,×1.7 系数;NWT 非阻塞注:人响应隐含 11min 偏乐观,系数余量 +2.45h 覆盖。**仅签团队资金市场;外部用户资金市场 GRACE 重定标=Owner 级决策** |
| 7 | 落码缺件(§4)全部 GREEN+NWT 审过 | 各 owner | — |
| 8 | 卡死告警(zk-prove-job-stuck-alert)活性确认 | KANet-UI | §2.6 复合风险 |

## §4 落码缺件清单(今天要补·设计审时核实存量)

1. **ZK claim 生产 driver**(witness builder + relay 命令接线): 勘察显示 claim entry 设计已定但生产入口疑未落码(pool-claim-builder.mjs 是旧 M3 路)。owner J2、NWT 审。**这是今天最大的落码件。**
2. **propose driver 薄壳**(踢一次 publishCloseRequestV2): 已有应急线脚本,固化为可复用 driver;propose 自治 tick 仍立卡排市场5 后。owner J2。
3. 彩排 harness = 三个 pre-broadcast 门 wrapper(§2 T1.4-T1.6,只准调生产 builder,harness 只读不广播,见 §1.2)。owner J1(门①②先行,门③等缺件1),NWT 审"是否偷造 witness"。

## §5 资金账与 worst-case

- **5R 彩排场敞口**: maker 100KAS(refund 路可回收)+双边注 3.0 + seed 0.2 + gate 1 + fees ~0.3 ≈ 焊死上限 **~4.5KAS**(maker 不进 PS 池,走 spine refund 路)。
- **正式场敞口**: ~104KAS 内锁死,全团队资金,零真实用户。
- worst-case A(5R 任一门红): 学费 ≤4.5KAS;5R 走 deadline 过后 daemon 自动退款路(7jy3s/uqmp8 同路,退款路本身也是活验证);正式场不开。
- worst-case B(5R 绿但正式场 live 红,残余家族风险): claim 若撞未测边界 → 池焊死 closed==2,~104KAS 学费,选A 已接受,**STOP 不追加抢救广播**(#b5cnrk 三条件)。两场制把 B 压到"同一套生产 builder 已在真实链上全链走通过一次"级,但不为零——诚实口径。

## §6 STOP/止损

- 任何彩排 require 红 / 盲算不中 / 硬门缺一 → STOP+频道根因,禁"凑边界"hack(三方禁令在案);
- 同一环 2 轮无进展 → 升 Owner,禁第 3 次(框架 §2);
- T2 阶段每关口(propose/close/claim)确认令制,Bettor 逐关放行。

## §7 诚实口径

走通 = "第一个真实市场 ZK 完整端到端 demonstrate"(propose 为 driver 触发的诚实标注)。**≠ 生产就绪**: propose 自治 tick、多市场并发、kaspa_tx_log 治理、②④offset 真重构仍在清单。

## §8 签字区

- Bettor(设计): ✅ 2026-07-08(v1.1)
- NWT(红队 verdict): ✅ 2026-07-08 v1.1 GREEN-GO(①缺件1坐实/②closed!=1 洞→两场制根治/③fixture 禁→真 prove/④盲算独立性口头确认;附 brokered-coverage 显式记录,已吸收进 T1.2)
- J2 / J1(缺件认领+可行性): 待
- Owner(知情: ~103KAS 敞口 + closed==2 选A 残余风险): 口头在线知情,频道记录为准
