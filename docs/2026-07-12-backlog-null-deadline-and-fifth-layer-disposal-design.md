> **Status**: CURRENT

# 积压两族处置设计 — NULL-deadline(10 盘)+ ShardLeaf 第五层(4 盘)

**作者**: J2 · 2026-07-12 · Bettor 派工 #hfou1g("一张处置设计覆盖两族"),排卡B后
**依据**: 桶B 先例(`docs/2026-07-11-backlog-markets-resume-fix-and-cleanup-design.md`,127 盘
`pruned_expired_waived` 终裁)+ NULL-deadline 分类(KANet-UI,9 内部+fy1yk 单列同族)+ ShardLeaf 第五层
L2 全空(J2,4342 候选零命中,身份 100% 内部)。

## 1. 判据(两族共同前提:100% 内部资金,零真实用户权利主张)

| 族 | 盘数 | 身份核实方 | 卡死点 |
|---|---|---|---|
| NULL-deadline | 9(fy1yk 单列,见 §4) | KANet-UI(relay_nodes 逐一命中) | `deadline_daa` 列 NULL,对 selectRipeMarkets 和 pre-gate 双不可见 |
| ShardLeaf 第五层 | 4(w07cw/sbg5h/0ac0q/yaq0d) | NWT(relay_nodes 逐一命中) | consolidate 步撞 leaf UTXO not found,L2 全空(k≤3) |

两族**共同点**:①100% 内部身份(同 fy1yk/桶B 族)②`protocol_status`='verifying'/`pending_bettors'` 类
非终态,`settle_txid IS NULL`③maker_stake 已锁在 spine(各 100 KAS,含 fy1yk 更大)④**卡死原因结构不同**
(NULL-deadline=数据缺列;第五层=leaf 链未知缺口),**处置动作相同**(豁免收口)。

## 2. 处置动作

### 2.1 终态标记(🔴 targeted UPDATE,禁 pattern sweep——28mln terminal sweep 覆盖 shard10
`manual_recovery_refunded` 教训)

```sql
UPDATE pool_markets SET protocol_status = 'pruned_expired_waived',
  metadata = json_set(metadata, '$.waived_reason', ?, '$.waived_at', ?)
WHERE id IN (/* 精确 13 个 id 字面量(9 NULL-deadline + 4 第五层, fy1yk 不在其中, 见 §4), 一次性生成清单,
                非 WHERE 条件式批量 */)
  AND protocol_status IN ('verifying', 'pending_bettors')
```

**🔴 第二个 WHERE 子句是安全闸(NWT 红队 H1 MUST-FIX 修正,活库实测驱动)**:v1.0 用黑名单
(`NOT IN ('completed', 'pruned_expired_waived', ...)`)——NWT 查活库 `pool_markets` 全部 distinct
`protocol_status` 发现真实存在 15 种值(`refunded`/907 行、`refunding`/51 行进行中转账、`disputed`/
`archived`/`settle_zombie_quarantine` 等),黑名单只列了 5 个,**结构性不完备**(今晚第三次撞同一模式:
反馈工具 allow-list/trading.js type 排除表/这里——枚举"不该碰的状态"天生漏,枚举"该碰的状态"才封闭)。
**改白名单**:`protocol_status IN ('verifying', 'pending_bettors')`(= §1 表已明确的两族目标市场应处状态)
——无论 id 清单意外混进什么状态的市场,不精确匹配"理应处于的状态"就不会被碰,不需要穷举所有不该碰的值。
每个 id 精确来自本设计 §1 表 + KANet-UI/NWT 的身份核实输出,不用任何 LIKE/pattern 匹配生成清单
(dry-run 先跑 SELECT 核对 13 行精确匹配,再执行 UPDATE)。

沿用桶B 命名(`pruned_expired_waived`,NWT 边界②:不带 `refunded` 字样——没有转账发生就不能叫"退款",
NO TX NO STATE 语义)。`waived_reason` 区分两族("null_deadline_internal" / "shardleaf_fifth_layer_internal_l2exhausted")。

### 2.2 daemon TRANSIENT churn 终止

第五层 4 盘当前每 tick 被 `selectRipeMarkets` 选中→撞 consolidate 错误→`TRANSIENT` 重试→下 tick 再撞
(见今晚日志,`w07cw`/`sbg5h`/`0ac0q` 反复出现)。§2.1 UPDATE 后 `protocol_status` 不再是
`pending_bettors`/`verifying`,`selectRipeMarkets` 的 WHERE 子句(`daemon.mjs:320-321`)天然排除
`pruned_expired_waived`——**churn 随终态标记自动停止,零额外代码改动**。

### 2.3 PS seed(20M sompi × 4)留驻

第五层 4 盘的 PayoutShard genesis 各锁 20,000,000 sompi(0.2 KAS)seed,**未花**(§1 L1 诊断确认)。
**不回收**——同桶B"maker spine 维持现状不动,收回走独立 escape 设计卡"精神:这笔 seed 金额小
(4×0.2=0.8 KAS)、回收需要新走一条 covenant spend 路径(额外风险面),不值得为这点金额开一条新钱路。
留驻记账,若未来第五层 4 盘的 leaf 链之谜被 L3 解开(续卡),回收可以那时一并做。

### 2.4 maker spine reclaim(单列,不与 §2.1-2.3 同批执行)

§2.1 的 13 盘(bettor 资金豁免)+ fy1yk 自己的 maker spine(§4 单列,与其 1004 笔 bettor 资金处置分开的
另一个问题)= 最多 14 盘的 maker_stake Σ 锁在各自 spine
P2SH。**本设计只标记"该回收",不在本卡执行**——回收动作(`refund_maker_unjoined` 覆约路径,同 §2.3
理由 + 桶B 先例"maker bond reclaim 走独立 B 卡")本身需要:①逐盘 covenant exit-path 验证(D-005 族
"资金进 covenant 前必验 exit-path 矩阵"精神反向应用:资金已在 covenant 里,回收前也要重新过一遍这条
纪律)②spine 地址→maker relay 身份反查确认回收目标正确。**单列为续卡**,不阻塞 §2.1 终态标记落地
(状态终结与资金回收是两个独立动作,先前者不影响后者的正确性)。

## 3. 诚实口径(必须显式写,禁过度声称)

- **第五层 4 盘分叉原因留档 OPEN**:L2 全空只排除"k≤3 笔乐观写未落链"假设,**不是** definitive 判定
  ①phantom vs ②front-advanced 二分叉的答案(见 triage 设计 §2 注3)。本次处置是"身份内部+L2 已尽力+
  继续投入 L3 性价比低"的**资金处置决策**,不是"我们查清了病根"的**技术结论**。若未来 register 病根卡
  (排队中)或 L3 揭示这 4 盘确实是①phantom,本处置结论不变(反正是豁免,不影响);若揭示是②front-advanced
  且能找到真实 tip,届时可能有钱可"真结算"而非"豁免"——**那种情况下需要撤销本次的 pruned_expired_waived
  标记重新走结算路,本设计不排除这个可能性,只是当下不追。**
- **fy1yk 单独处理**(§4):不在本批次自动 UPDATE 清单里,理由见下。
- **不做**:不生成新的批量转账/退款交易(§2.1 是纯状态标记,零 TX)。不回收 maker spine(§2.4 续卡)。
  不回收 PS seed(§2.3)。

## 4. fy1yk 单列(Bettor 预裁,本设计承接)

Bettor 06:04 预裁"豁免收口口径"但留了一问:register-v07 bulk 脚本生成的 960 个 fresh privkey 有无持久化
——J2 06:06 搜索负结果(未找到持久化痕迹,非 100% 确证)。**本设计承接预裁但不在 §2.1 UPDATE 清单里自动
带上 fy1yk**——1004 注/1060 KAS 量级远超其余 13 盘,且"退款路是否物理可行"这个问题的答案(有无私钥)会
实质影响处置动作是"豁免"还是别的形态,**需要 J1(域内对当晚脚本更熟)或 Owner 单独确认后再执行**,不
因为"同族"就自动打包处理。

## 5. DoD

1. NWT 红队:§2.1 SQL 安全闸(guard WHERE 子句)+ 13 个 id 清单精确性(dry-run SELECT 逐行核对)+
   `pruned_expired_waived` 是否与桶B 127 盘的既有语义完全一致(无隐性差异)。
2. dry-run(`SELECT id, protocol_status FROM pool_markets WHERE id IN (...)`)输出报 Bettor 核对后,
   再执行真 UPDATE(桶B 同款"dry-run→Bettor 批→写"两人闸纪律)。
3. 执行后 daemon 下一 tick 确认第五层 4 盘不再出现在 `settling` 日志行(TRANSIENT churn 终止实证)。
4. fy1yk 挂账等 J1/Owner 确认,不阻塞其余 13 盘本轮处置。
