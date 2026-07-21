> **Status**: SUPERSEDED-by [docs/DECISIONS.md D-001](DECISIONS.md) (2026-07-06)
> ⚠️ **正名+废止**: 本文标题写"ZK"但实际机制是【委员盲签+driver-enforce covenant】,**不是密码学ZK proof**(见文内"非 covenant 验 payoutRoot·委员盲签·非 production-trustless")。真·密码学ZK只到单片(pb73v),多片从未用ZK。当前结算口径以 DECISIONS.md D-001 为准。**勿据本文认为"在用ZK"。**

# 多片 ZK 自动结算装配 执行卡 — fresh J2 照此秒接(Owner 2026-06-30 "干")

> **用途**: 把【无限押注(多片)】+【ZK 自动结算】装配成默认自动结算的精确 runbook。
> **为何独立卡**: 2026-06-30 J2 单片 ZK e2e LANDED(pb73v·见记忆 [[project-zk-interim-b-full-e2e-landed-pb73v]])后·Owner 问"能否装配无限+ZK"·三方(J2/J1/Bettor)查实=**多片 fold 结算是真缺口**·Owner "干"。Bettor 钦定 fresh 会话(money-path)·J1 co-author covenant/fold·我+J1+Bettor+KANet-UI 四源 co-verify。
> **趁满上下文钉死·fresh 会话零重推导。**

## 0. PRE-FLIGHT(fresh 会话先做)
1. 会话自检 fresh(xzztw 铁律·多片 settle=money-path)。
2. `node scripts/check-tree-fresh.mjs` + 确认 bshard-auto-settler.mjs / pool-shard-settle.mjs / pool-bettor-sides-query.mjs 在 canonical。
3. **oracle pool 仍有效?**(🔴 Phase 2 e2e 前必【链验】非信 DB/cron): lock_until_daa=51200000(2026-06-30 ~04:00 re-enroll·~28h 窗)。逐个验 5 oracle(NWT/broker-2/tester-1·2·3)的新 P2SH 链上有 stake UTXO≥1KAS + lock>snapshotDaa(getUtxosByAddresses·非信 DB row)。过期/缺则先跑 `scratch/_j2_zk_reenroll_pool.mjs`。
   - **✅ auto-renewal cron 已修+LANDED 自治(77d9d0bd·2026-06-30 05:00·NO-TX-NO-STATE 闭: transfer→_pollUtxoLanded 8×10s 确认 UTXO≥stake→atomic DB·throw→留旧自愈)**: 1h tick·~3.5 天前自动续期·下次到期 ≈2026-07-11·手验 5/5 GREEN(console PID 14876)。∴ Phase 2 池现自动维护·lock 不再是 51200000 而是 cron 续到的远期值。fresh J2 仍按"验当前码/链"原则: e2e 前链验 5 oracle 实有 stake + lock>snapshotDaa(不信 DB·万一 cron 某 tick 出岔)·坏了重 re-enroll(_j2_zk_reenroll_pool.mjs)。
4. co-verify 槽: J1(:3300 covenant/fold 域·co-author)+ Bettor(:3200)+ KANet-UI(:3200)在线。

## 1. 真实缺口(三方查实·非"只 2 bug")
- **单片 ZK 证了**(pb73v 1 片)·**多片盘自动结算没装也没 e2e 证**。
- 代码墙: `getMarketBets`(pool-bettor-sides-query.mjs L99-110): multiShard>1 → `rows=[]`(只给片数不给注)。`computeSettlePlan`(bshard-auto-settler.mjs L58): multiShard>0 → reject "fold 路 production·此 minimal 单片"。
- ∴ 真·无限(多片)盘现在 settler 直接拒。

## 2. 装配三步
**① 多片 fold 汇总接进 settler(driver-side·主活)**
- `getMarketBets` 多片路: 现返 `rows=[]`。改/加 fold gather = **逐片 `getSidesByShard(shard_market_id)` union 全部 shard**(shard-only·非 getSidesByLogicalMarket·后者含 maker_stake/commingled 杂质·见 L83-86 注)。返 combined bets = 所有片所有注。
- `computeSettlePlan` 去 L58 单片限制: multiShard>0 时走 fold gather → `computePariMutuelPayout(combined bets, winDir)` → payoutRoot **覆盖全片 winner**(命门: Σ各片 winner 全进 payoutRoot·J1 必 co-verify 这条)。
- **consolidate 那半已多片就绪**: `consolidateAllShards`(pool-shard-settle.mjs L234)已 loop 全片逐片折进【一个】PayoutShard·返 {psOutpoint, consolidatedPool(=Σ全片 pool), consolidatedShards}。fold 后 = 单 PS → close+claim 同单片路(复用我脚本)。
- 口径不变: payoutRoot driver 供·委员盲签·安全靠 driver enforce 烤死锚 + 四源 re-derive(覆盖全片)。**非 covenant 验 payoutRoot**(同 interim-B)。

**② 修 2 daemon bug**(task#8·记忆有细节)
- #14 `verifyClosedLanded`(L190)单发查 false-negative → 加 retry/poll(我单片撞过·close 实 landed 但返 ok:false)。
- #15 claim loop 多-winner(L196-212)复用 closeTxid:0 + w=0 不 thread → **我已写通 threaded claim**(`scratch/_j2_zk_claim.mjs`·thread outpoint+consolidated_pool+w-bitmap·splice _POOL_STATE_START=1·每笔验 p2sh==handler psContAddress)。直接 fold 进 settler claim loop。

**③ 多片真盘 e2e + 四源 co-verify**(money-path·fresh·非单片 pb73v)
- 建盘 + **>32 注**滚成 ≥2 片(`scratch/_j2_v07_b_e2e.mjs <market> 40 1` 类·B e2e 证过 36 注滚 2 片)。
- 跑 fold settle(consolidate 全片→close→claim 全 winner across shards)。
- 四源对死: payoutRoot 覆盖全片 winner / 守恒 Σ全片 pool == Σpayout + seed / winner 实收 / 旧 PS spent。

## 3. ⚠ J1 钦点多片真拦路虎(装配必盯)
- **size-bound**: 多片 reveal 暴大(PoolRoot 2287B 撞 9999 SIZE 墙·见记忆 bshard-size-bound / silverscript-fold-limits)。多片 fold/close witness 体积是真墙·J1 covenant 域盯。
- **N×broadcast**: 多片 settle = N×side broadcast·anti-spam/churn 风险。
- J1 早 co-verified FoldNode k=2 折叠 covenant·这两条是他域·co-author 时对齐。

## 4. 复用资产(都在·零重造)
- `scratch/_j2_zk_settle_drive.mjs`: consolidate/plan/dryrun/settle phase·全 ctx 已 wire(:3200 API/judgeWinDir 用 ev.fields/endBlockHash via chain_get_block_at_daa/fee self-mint)。
- `scratch/_j2_zk_claim.mjs`: threaded 多-winner claim(splice 复刻 relay _continuationAddress)。
- `scratch/_j2_v07_b_e2e.mjs`: 押注(payer fund from maker relay·register-v07/prep+confirm)。
- `scratch/_j2_zk_reenroll_pool.mjs`: oracle pool re-enroll(若过期)。
- 记忆 [[project-zk-interim-b-full-e2e-landed-pb73v]]: 全 ctx wiring + 2 bug 修法 + splice 公式 + 坑(kaspa-wasm Generator 用 testnet-10/judgeLine 用 ev.fields/API :3200)。

## 5. 诚实口径(守死)
- driver-side prevention·非 production-trustless·非全自治 daemon(装配后=工程化自动·daemon 接线就绪才算"无人值守")。
- **⚠ payoutRoot depth-10 = ≤1024 winner 上限**(Bettor 2026-06-30 钦点): 超 1024 winner 要 rolling payout-shard(TODO·未做)。准确口径 = "多片 settle **≤1024 winner**"·**非"真无限 settle"**。e2e 小盘没事·但报 Owner/装配文案别说"无限 winner"。
- SIZE 墙(9999)已 2026-06-20 committee-sig pivot 绕开(迭代 consolidate·非 on-chain fold)·Phase 0 验当前码无 drift·非 open 题(记忆 project-bshard-aggregation-pivot-committee-sig)。
- 报 Owner 陈述句·不给菜单(`feedback-never-menu-owner-not-at-terminal`)。
- **别号称"无限+ZK 已装配"直到 多片真盘 e2e 四源验过。**

## 6. Phase 1/2 命门(Bettor 钦定·四源 co-verify)
- **Phase 1** = fresh 会话实现(money-path): getMarketBets 多片 fold gather(逐片 getSidesByShard union)+ computeSettlePlan 去 L58 + settleMarketLive consolidate-first + threaded claim(#15 已写通)+ 修 #14。
- **Phase 2** = 真·多片盘(2+ 片·别用 nnd1g)e2e·**四源 co-verify 命门**: ① Σ各片 winner 全进 payoutRoot(无一片注掉) ② 守恒 Σ全片 pool == Σpayout + seed ③ winner 实收 ④ 旧 PS spent。J1 自派生各片 leaf + payoutRoot 含全 winner·Bettor + KANet-UI 独立链验。
