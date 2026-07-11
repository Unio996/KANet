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
- 诊断缺口顺手补(Bettor #gukbiu 副发现(a)):derive 拒绝原因 log 落 `[resume-skip]` 行,不再静默。

## 3. Fix-B:不可达 pre-gate(Bettor 三硬边界逐条落)

**位置**:两个 resume 调用点之后、computeSettlePlan 之前(resume 成功的盘零影响——resume 根本不走
getBlockAtDaa):

```
resume {ok:false} 时:
  floor = SELECT MIN(start_daa) FROM spc_daa_index_coverage   (无行 → 不 gate, 照走)
  ① deadline_daa < floor 且 (currentDaa - deadline_daa) > 250000 双条件同时成立 → gate:
     skip 本盘(状态不动=挂账), 计数器+1;单条件不满足 → 照走 computeSettlePlan(可达的一律照走)
  ② 每 tick 末 log: `[pre-gate] N market(s) gated (unreachable: deadline<coverage-floor && gap>MAX_WALK)`
     + 每盘首次被 gate 时发一条 events 审计(unreachable_gated, 有账可对 KANet-UI 每小时数)
  ③ 落地序: pre-gate 可先行独立 commit(独立正确, 立即解桶C 饿死+消 ~44min/轮×250k 块节点重锤)
```
- MAX_WALK 常量:driver 侧新增同值常量并注明"必须 == rpc-listener.mjs:221"(跨进程无法 import;
  ANTI-PATTERNS 规则55 手工配对——lint 卡点做不到跨 repo,注释+regression case 双向钉)。
- currentDaa 源:tick 已有 currentDaa(selectRipeMarkets 入参),零新链读。
- 被 gate 盘的终局:Fix-A 修好 22 盘走 resume(不再撞 gate);真·无 evidence 且不可达的残余 = 既有
  L628 超龄退款另案卡(本设计不扩权,只止血)。

## 4. 验收(DoD)

1. 单测(真函数 + in-memory fixture,phase2.test 同款风格):
   - Fix-A:缺 win_direction + root 吻合 dir=1 → resume ok 且 winDir=1;root 双不吻合 → fail-closed;
     payout_root 缺 → fail-closed;fee_rules 市场推断带 fee 叶。
   - Fix-B:双条件成立 → gate(computeSettlePlan 零调用,spy 断言);单条件(可达)→ 照走;coverage
     空表 → 不 gate。
2. 实弹:装载后观察 daemon 一轮 tick——桶A ≥20 盘从 MAX_WALK 空转转为 resume 续跑(claim 落链计数),
   桶C 首次进 tick(日志出现桶C id);KANet-UI 每小时数与 gate 计数对账。
3. 报数口径:桶A 恢复计数按"resume 续跑成功/claim landed"分级,不 claim"27 全清"直到逐盘落账。

## 5. 边界自问

- **为什么不直接手工 UPDATE 22 盘的 win_direction?** 人工判方向=xzztw 家族;root-match 推断在代码里
  fail-closed 兜底,新老盘通用,一次修永不再犯。
- **pre-gate 会不会误伤将来 backfill 扩覆盖后变可达的盘?** 不会——判据①读 coverage floor 实时值,
  backfill 扩了 floor 下移,盘自动出 gate。
- **改排序/MAX_PER_TICK 吗?** 不改(scope 收紧)。Fix-A+B 落地后空转盘消失,排序问题自然消解;
  排序优化若仍需要另立卡。
