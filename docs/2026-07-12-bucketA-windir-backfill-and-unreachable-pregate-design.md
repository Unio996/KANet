# 桶A win_direction 回补 + 不可达 pre-gate 合卡设计(半页)

> **Status**: CURRENT(设计稿·待 NWT 红队 + Bettor 审;落码前不动代码)
> **作者**: J2 · 2026-07-12 · 合卡令: Bettor #guux0p(win_direction 回补 #gukbiu + 桶C 饿死 pre-gate 折一份设计一轮审)
> **背景事实(双向坐实)**: ①Bettor 日志实测——22/27 桶A 盘 settle_evidence 系老版本写入**缺 win_direction**
> → `deriveResumePlanFromEvidence`(bshard-auto-settler.mjs:148)fail-closed 拒 → 静默回退 computeSettlePlan
> → 撞 MAX_WALK(deadline ~50.4-50.6M 在剪裁点 56461401 下,物理不可达);②J2 trace——每盘空转 ~2min×每轮,
> selectRipeMarkets 排序(daemon:325 kanet_v07 优先+deadline ASC)把空转盘全排桶C(56.99M+)前,
> MAX_PER_TICK=20 ≤ 空转盘数 → **桶C 结构性饿死**(17 个候选盘 24h 日志零命中)。

## 1. 查了哪些既有资产

| 资产 | file:line | 用途 |
|---|---|---|
| resume 派生 | `bshard-auto-settler.mjs:141` deriveResumePlanFromEvidence | 回补落点(win_direction 推断) |
| resume 两调用点 | `bshard-auto-settler.mjs:225` + `bshard-settle-daemon.mjs:492` | evidence.close_txid 存在才试 resume |
| MAX_WALK 源 | `kasia-relay/src/rpc-listener.mjs:221`(=250000)+ throw :264 | 空转的物理墙 |
| coverage 表 | v183 `spc_daa_index_coverage`(migrate.js:5381) | pre-gate 判据①的 floor 源 |
| close 落链锚 | settle_evidence.close_txid + payout_root(resume-fix 设计 §1) | 回补的链上真相源 |
| 排序/容量 | `bshard-settle-daemon.mjs:315-326` selectRipeMarkets + :53 MAX_PER_TICK | 饿死机制(本设计不改排序) |

## 2. Fix-A:win_direction 回补 = **root-match 推断,零人工回填**

老 evidence 缺 win_direction,但 **payout_root 在**(close attest 时写,且链上 close tx 的 closed-PS redeem
烤着同一 root = 链锚)。win_direction ∈ {0,1} 只有两个候选——**逐个重算 root,谁跟 evidence.payout_root
吻合谁就是当年 attest 过的方向**:

```
deriveResumePlanFromEvidence 改(:148 附近):
  win_direction 有效(0|1)      → 现状路径不动
  win_direction 缺/无效:
    evidence.payout_root 缺     → {ok:false}(现状 fail-closed, 无从推断)
    对 dir ∈ {0,1} 各重算 root(同现有重算逻辑, 含 fee_rules 市场 fee 叶):
      恰一个吻合 → 采其为 winDir, resume 继续(root 即链上 attest 终审值, 推断=零新信任面)
      零/双吻合  → {ok:false} fail-closed(双吻合理论不可能——不同 winner 集不同叶集不同 root, 防御性保留)
    推断成功顺手回写 evidence.win_direction + events 审计事件(backfill_windir_inferred, 一次性, 下轮直走快路)
```
- **为什么推断不是猜**:payout_root 是当年委员 4-of-5 attest 上链的值(claim 时链上 covenant 再终审),
  推断只是"解一元二选一方程",authority 仍在链。**不手插 DB、不人工判方向**(xzztw 反例的合规版)。
- **🔴 匹配靶=链读非 DB(v1.2, NWT F1 折入——verify-value-source)**:v1.0 拿 `evidence.payout_root`(DB)当靶
  = 重算==DB claim 的规则56 近亲。改为**链读优先序**(任一步取不到 → fail-closed 落 F3 账,不降级信 DB):
  ① 对 dir∈{0,1} 各编译候选 closed redeem(`compilePayoutShardRedeem(poolMerkleRoot, predicateCommit,
     consolidatedPool, closed=1, payoutRoot=root_dir)`)→ p2sh 地址,与 close_txid 的链上 output0 地址
     (kaspa_tx_log 观测→必要时块扫)比对——地址承诺 redeem 承诺 root,恰一吻合即链锚判定
     (= pzmm5hg7 expectedClosedAddr predict 同款方法学倒用);
  ② 若有已落链 claim tx:其 input sigscript 揭示 closed redeem 全文 → offset 直读 root == root_dir(最强链读);
  ③ 至少断言 `evidence.payout_root == 链读值` 后才允许它参与比对——**禁裸信 evidence**。
  matchTarget 值源为 NWT 落码 diff 复审重点,机制选型(①/②优先)以落码时实测哪路对 22 盘覆盖率高定,
  两路都实现则互为 sanity。
- 诊断缺口顺手补(Bettor #gukbiu 副发现(a)):derive 拒绝原因 log 落 `[resume-skip]` 行,不再静默。

## 3. Fix-B:不可达 pre-gate(Bettor 三硬边界逐条落;v1.1 按方向审注1 MUST-FIX 改层)

**🔴 位置(v1.1 更正,Bettor 注1)**:主 gate **下沉进 `selectRipeMarkets` 循环内(daemon:328-346),push
进 ripe 之前判**——v1.0 放在 resume 调用点后是错层:被 gate 盘无 lease 无状态变化,deadline ASC 稳定
排序下一 tick 原样再入选,照占 MAX_PER_TICK slot,桶C 仍永不入选("先行=立即解饿死"claim 在 v1.0 层
不成立,只消节点重锤)。改法:

```
selectRipeMarkets(currentDaa, pmt, limit) 内:
  floor = SELECT MIN(start_daa) FROM spc_daa_index_coverage   (每 tick 查一次; 无行 → 不 gate)
  循环内 push 前(每行纯算术, 零 DB 写, 状态照旧不动):
    m.deadline_daa < floor 且 (currentDaa - m.deadline_daa) > MAX_WALK 双条件同时成立
      且 无 settle_evidence.close_txid 可 resume(有 evidence 的盘照进——resume 不走 getBlockAtDaa)
      → 不 push(不占 slot), gatedCount++
  ① 可达的一律照走(单条件不满足 → 照 push)
  ② tick log: `[pre-gate] N gated (unreachable)` + 每盘首次 gate 发 events 审计(unreachable_gated)
  ③ 落地序: pre-gate 先行独立 commit 仍成立(在正确层, 才真解桶C 饿死+消 ~44min/轮节点重锤)
```
- `_settleOneMarketAttempt` 内保留同双条件 gate 作**纵深**(防其它入口绕过 selection 直调)。
- **resume-可用盘不被 gate**:有 evidence.close_txid 的盘(桶A 全部)照进 selection——Fix-A 让它们走
  resume 快路零 walk;gate 只拦"无 evidence 且物理不可达"的残余(终局=既有 L628 超龄退款另案)。
- MAX_WALK 配对常量(Bettor 注4 + NWT F2 非对称钉死):driver 侧常量 + 注释 + regression 双钉 + 同名 env
  override。**失效方向非对称(F2)**:driver > rpc 真值 = gate 少触发(次优但安全);driver < rpc 真值 =
  可达盘被跳(liveness 误伤)——**安全约束 = driver_MAX_WALK ≥ rpc_MAX_WALK,注释钉死"宁大勿小"**。
  **落码前必查** rpc-listener.mjs:264 的 gap==MAX_WALK 边界语义(walk 成功还是 throw),gate 判据 `>` vs `>=`
  与之严格一致 + 边界 off-by-one regression case(F2 修法②)。
- currentDaa 源:selectRipeMarkets 既有入参,零新链读。

## 3.5 注2/注3 折入(v1.1)

- **回写点(注2,NWT 必核)**:推断成功回写 evidence.win_direction **不走 JS read-modify-write**——用
  SQLite 单语句原子 `UPDATE pool_markets SET metadata = json_set(metadata, '$.settle_evidence.win_direction', ?)
  WHERE id = ? AND json_extract(metadata, '$.settle_evidence.win_direction') IS NULL`(幂等:已有值不覆盖;
  单语句 = 无 RMW 窗口,与 settler 其它 metadata 写互斥由 SQLite 语句原子性保证,tick 串行再加一层)。
  **写失败不回滚推断结果,本 tick 照用**(写是优化非前提,下 tick 重推断一样对)。
- **zero-match 单独报(注3)**:推断双向都不吻合 ≠ "不可推断"——是 **evidence 漂移信号**(今日 bet 集与
  当年 attest 叶集不一致,phantom/排除表变动族)。单独计数 + 响亮 log(`🔴 [resume-infer] root 双向不吻合`),
  与 pre-gate 计数分开报,不混桶。

## 4. 验收(DoD)

1. 单测(真函数 + in-memory fixture,phase2.test 同款风格):
   - Fix-A:缺 win_direction + root 吻合 dir=1 → resume ok 且 winDir=1;root 双不吻合 → fail-closed;
     payout_root 缺 → fail-closed;fee_rules 市场推断带 fee 叶。
   - Fix-B:双条件成立 → gate(computeSettlePlan 零调用,spy 断言);单条件(可达)→ 照走;coverage
     空表 → 不 gate。
2. 实弹:装载后观察 daemon 一轮 tick——桶A ≥20 盘从 MAX_WALK 空转转为 resume 续跑(claim 落链计数),
   桶C 首次进 tick(日志出现桶C id);KANet-UI 每小时数与 gate 计数对账。
3. 报数口径:桶A 恢复计数按"resume 续跑成功/claim landed"分级,不 claim"27 全清"直到逐盘落账。
   **F3(NWT)加严**:两类盘 root-match 必 fail-closed 不救——bettor 集漂移(attest 后 exclude 逻辑演进,
   = 注3 的 evidence 漂移信号)+ refund-root 盘(degenerate 退款市场两个 pari-mutuel 方向都不吻合)。
   **禁宣"root-match 救全部 22"**,救不回的落 L628 另案。
   **F4(NWT)scope**:pre-gate 收益 = "floor 以下不可达盘"的重锤;coverage **洞**内盘(deadline ≥ floor
   但落索引空段)不被 gate、仍可能撞线性 walk——洞是 §2.5 另一维,本 gate 不治,报数别夸大。

## 5. 边界自问

- **为什么不直接手工 UPDATE 22 盘的 win_direction?** 人工判方向=xzztw 家族;root-match 推断在代码里
  fail-closed 兜底,新老盘通用,一次修永不再犯。
- **pre-gate 会不会误伤将来 backfill 扩覆盖后变可达的盘?** 不会——判据①读 coverage floor 实时值,
  backfill 扩了 floor 下移,盘自动出 gate。
- **改排序/MAX_PER_TICK 吗?** 不改(scope 收紧)。Fix-A+B 落地后空转盘消失,排序问题自然消解;
  排序优化若仍需要另立卡。
