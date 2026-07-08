# 市场5 首注彩排制 — 设计稿(第一个真实市场 ZK 完整端到端)

> **Status**: CURRENT
> **作者**: Bettor(架构师帽)2026-07-08 · **红队审**: NWT(待 verdict) · **Owner DoD**: 第一个含 zk_close+claim 的真实市场完整端到端
> **上游依据**: COORD-LEDGER checkpoint(9bf1c33f)接力点① + `docs/2026-07-07-closezk-claim-complete-design.md`(claim 设计+exit-path 矩阵+§4 硬门) + `docs/2026-07-06-zk-close-tick-production-wiring-design.md`

---

## §0 一句话

**create + 首注 1.5KAS 铸出真实 PayoutShardV2 后,立即用 cli-debugger 拿这个真实 PS 的字节走 zk_handoff → zk_close → claim 全链彩排;彩排全绿才放后续押注。** debugger 从"69KAS 验尸"前移到"1.7KAS 体检"。

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

### T1 — create + 首注 + 真 PS 全链彩排(敞口 ~1.7KAS+maker spine)
- T1.1 create-v07(ZK-native: `resolution_rule_spec.zk_native=true`,**brokered**: fee_leaves 政策=必含 broker-1 份额,#b4tui6 裁定);maker 100KAS spine(Owner skin-in-game 硬校验,不绕);**create 后回读 DB 实际 deadline_daa**(endpoint 自算不吃 caller 值,8.0 DAA/s);
- T1.2 首注 1.5KAS(团队 relay,经 gateway)→ 铸真实 PS(27-param ctor 含 anchor+ZK state 初值);
- T1.3 **彩排环1 zk_handoff**: 从链上/DB 读真 PS redeemHex,生产 builder 构造 handoff witness,debugger run-all;
- T1.4 **彩排环2 zk_close**: 用 T1.3 彩排产出的 CloseZkV2 模拟 genesis 状态 + 一份真实结构 proof 输入(fixture receipt 可,诚实标注:proof 验证本体由链上 OpZkPrecompile 承担,彩排验的是 covenant require 路径),debugger run-all;
- T1.5 **彩排环3 claim**: 单 bettor payout 树(leaf=blake2b(pk‖payout,8B)),生产 claim builder 构造 witness,debugger run-all,**必含最后一笔精确清零分支**;
- T1.6 三环全绿 + Bettor 盲算比对全中 → 频道贴彩排证据(每环 require 清单+关键值)→ **放注令**。任何一环红 = STOP(见 §6)。

### T2 — 真实端到端(彩排过关后)
- T2.1 放开押注(团队 relay 双边,注额最小化,总敞口锁 ~104KAS 内);
- T2.2 deadline 到 → propose(driver 薄壳踢一次,诚实口径)→ voter/submit cron 全自治 attest(批A);
- T2.3 attest 落链 → 自动 enqueue → prove worker ~4min 真 Groth16 → gate 铸造注资(批B);
- T2.4 zk_close 落链(dispatchUnlockZkClose,ZK_CLOSE_TICK 或 driver 确认令,首次真实市场按确认令逐步放行);
- T2.5 **claim 真实触发**(全链首次)→ 每笔 claim merkle proof 链上验 → 全部赢家 claim 核验后才标 completed(禁 settleMarketLive 旧病);
- T2.6 Bettor 全程盲算(winner/payoutRoot/守恒)+ 六 vantage 终验 → 记账 COORD-LEDGER。

## §3 前置硬门 checklist(create 前逐条贴频道,缺一不点火)

| # | 硬门 | 负责 | 依据 |
|---|---|---|---|
| 1 | gateway(KANet-UI-tn)UTXO consolidate 完成+链验(昨晚押注线断因) | KANet-UI | COORD-LEDGER 线(3) |
| 2 | 开关矩阵核实(SETTLE_DAEMON/ZK_CLOSE_TICK/ZK_PROVE_WORKER/VOTER_V2/SUBMIT_V2 当前态+放行计划) | J2 | index.js 接线 |
| 3 | exit-path 矩阵走查证据贴频道(closed==2 选A 4 绑定条件复述) | Bettor+NWT | #b5cnrk |
| 4 | Σleaf==pool BLOCKING 断言 + fee_leaves 非空(broker-1)确认 | J1 | 硬门⑤ |
| 5 | anchor 对当次实际编译重算(禁缓存) | J2 | 硬门⑥ |
| 6 | ESCAPE_GRACE_MS 定标签字(占位 6h 未签) | Bettor 裁+Owner 知情 | 硬门③ |
| 7 | 落码缺件(§4)全部 GREEN+NWT 审过 | 各 owner | — |
| 8 | 卡死告警(zk-prove-job-stuck-alert)活性确认 | KANet-UI | §2.6 复合风险 |

## §4 落码缺件清单(今天要补·设计审时核实存量)

1. **ZK claim 生产 driver**(witness builder + relay 命令接线): 勘察显示 claim entry 设计已定但生产入口疑未落码(pool-claim-builder.mjs 是旧 M3 路)。owner J2、NWT 审。**这是今天最大的落码件。**
2. **propose driver 薄壳**(踢一次 publishCloseRequestV2): 已有应急线脚本,固化为可复用 driver;propose 自治 tick 仍立卡排市场5 后。owner J2。
3. 彩排 harness(把 §2 T1.3-1.5 串起来的驱动,只准调生产 builder,见 §1.2)。owner J1 或 J2,NWT 审"是否偷造 witness"。

## §5 资金账与 worst-case

- 敞口: maker 100KAS(refund 路可回收,昨晚双样本验证中)+首注 1.5 + gate 1 + fees ~0.5 ≈ **~103KAS,全团队资金,零真实用户**。
- worst-case A(彩排 T1 红): 学费 ≤1.7KAS+fees;市场走 deadline 过后 daemon 自动退款路(7jy3s/uqmp8 同路,退款路本身也是活验证)。
- worst-case B(彩排绿但 T2 live 红,残余家族风险): claim 若在 live 撞未测边界 → 池焊死 closed==2,~103KAS 学费,选A 已接受,**STOP 不追加抢救广播**(#b5cnrk 三条件)。彩排把 B 概率压到"生产 builder 本身被 debugger 验过"级,但不为零——诚实口径。

## §6 STOP/止损

- 任何彩排 require 红 / 盲算不中 / 硬门缺一 → STOP+频道根因,禁"凑边界"hack(三方禁令在案);
- 同一环 2 轮无进展 → 升 Owner,禁第 3 次(框架 §2);
- T2 阶段每关口(propose/close/claim)确认令制,Bettor 逐关放行。

## §7 诚实口径

走通 = "第一个真实市场 ZK 完整端到端 demonstrate"(propose 为 driver 触发的诚实标注)。**≠ 生产就绪**: propose 自治 tick、多市场并发、kaspa_tx_log 治理、②④offset 真重构仍在清单。

## §8 签字区

- Bettor(设计): ✅ 2026-07-08
- NWT(红队 verdict): 待
- J2 / J1(缺件认领+可行性): 待
- Owner(知情: ~103KAS 敞口 + closed==2 选A 残余风险): 口头在线知情,频道记录为准
