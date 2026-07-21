# NWT 红队 — 桶A 合卡落码 diff 审(937b12e5 pre-gate + 58803a41 win_direction 回补)

> **Status**: CURRENT
> **对象**: 937b12e5(Fix-B pre-gate)+ 58803a41(Fix-A win_direction root-match)
> **verdict**: **GREEN——F1/F2 独立验证闭合,承重 consolidatedPool 一致性核毕,可同窗装载(DoD#3 9gzf1 结算后)**

---

## F1 闭合(链读实落,我域核心)——CONFIRMED

Fix-A matchTarget 彻底从 DB 移到链:`_inferWinDirectionFromChain` 读 close_txid 的链上 output0 地址(kaspa_tx_log),对 dir∈{0,1} 编译候选 closed redeem→p2sh 地址比对,**恰一吻合=链锚判定**。evidence.payout_root 退出匹配靶(只留既有 mismatch check)。psRow 篡改→双候选都不匹配=自锚 fail-closed。zero/double→drift 事件(response),indexer 缺口→普通 fail-closed(不发 drift,分桶准)。**比我原诉求更硬**(地址是 P2SH hash 承诺,不可伪)。

## F2 闭合(边界+常量)——独立读 rpc-listener 核毕

不信 J2 转述,亲读 `kasia-relay/src/rpc-listener.mjs:224,264-266`:
- **同名 env**:rpc 侧 MAX_WALK = `parseInt(process.env.GETBLOCKATDAA_MAX_WALK)||250000`,与 driver PREGATE_MAX_WALK **同一 env 名 + 同默认 250000**——改一处两侧同步,规则55 手工配对 drift 面机制性消除(比我 F2 要的"注释钉方向"更强)。
- **边界语义**:rpc :264-266 亲读——exhaust 时 `lastEligible.daaScore > deadlineDaa` 才 throw;`daa==deadline` 属正确 crossing 返回成功(SPC daaScore 严格增,无更深同 daa 块)。∴ gap==MAX_WALK 时 rpc 可解 → pre-gate 严格 `>` 不 gate = 边界一致,无 off-by-one。
- **非对称方向**:注释钉死"宁大勿小(driver<rpc=可达盘被跳=liveness 误伤)",安全约束 driver_MAX_WALK≥rpc 落地。

## 承重一致性(决定 Fix-A 对真实 22 盘是否真救,非合成 test 遮蔽)——VERIFIED

Fix-A 重建 `consolidatedPool = poolSompi + psSeedSompi(20M)` 编译候选地址,**必须与 computeSettlePlan 建 closed 地址同源否则真盘全不匹配=inert**。亲比对:
- computeSettlePlan:125 `consolidatedPool = BigInt(poolSompi)+BigInt(ctx.psSeedSompi??20000000)` + compilePayoutShardRedeem(closed:1)
- Fix-A infer:同上逐字相同公式 + 同 compilePayoutShardRedeem。

∴ Fix-A 候选地址重建方式 == driver 当年建 close 的方式(pzmm5hg7 predict 同源)。22 盘由同一 driver 代码闭 → 链上 output0 == 正确 dir 的候选地址。**Fix-A 对真数据有效,不是只过合成 test**。psSeedSompi=20M 常量统一,无非标种子盘。

## 结构正确性

- **Fix-B 层**:unreachablePreGate 在 selectRipeMarkets `push` 前 `continue`(daemon:366)——gated 盘永不达 _settleOneMarketAttempt→永不 computeSettlePlan(spy 断言 pregate.test 覆盖),真解桶C 饿死(不占 slot)。attempt 层留纵深防绕过。
- **ctx.p2shAddr 在真 ctx**:daemon:217 buildCtx 返回 p2shAddr →Fix-A 非 inert(否则永 fail-closed 无救)。
- **json_set 幂等**:`WHERE ... win_direction IS NULL` 单语句原子,零 JS RMW(注2)。
- **审计不静默**:pre-gate 首次 unreachable_gated + 每 tick 计数 log;infer drift 独立 event_type;[resume-skip] 诊断补齐(副发现 a)。
- **两测试亲跑**:windir-infer 12 断言 + pregate 11 断言,我独立 exit 0(真 compilePayoutShardRedeem 编译 + 真 migration 隔离库,非 mock)。

## 非阻塞 note

- **N1(rescue-rate,live 验收为准)**:Fix-A 只实 F1 路①(地址匹配),路②(claim sigscript 直读)未实现——但路②针对"有 claim tx 可读"场景,这 22 盘正卡无 claim,路②无源可读,故路①是对的工具,非缺口。真实 22 盘 rescue 率的 ground truth = 装载后 DoD 验收(桶A≥20 转 resume);机制我已验证同源(consolidatedPool 一致),预期能救标准盘,bettor 集漂移/refund-root 盘 fail-closed 不救(F3 口径,禁宣 22 全救)。

## 结论

两 commit GREEN。F1(链读)+ F2(边界/常量)独立验证闭合,consolidatedPool 承重一致性核毕(Fix-A 对真数据有效非 test 遮蔽),结构正确,审计不静默,两测试亲跑绿。**可同窗装载**(J2 序:DoD#3 9gzf1 结算落 claim 后再重启,避免打断自治链——序合理)。装载后 DoD 验收:桶A≥20 转 resume / 桶C 首进 tick / 每小时数对 gate 计数。

— NWT 2026-07-12
