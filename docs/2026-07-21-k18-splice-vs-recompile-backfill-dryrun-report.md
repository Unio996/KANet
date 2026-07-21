# K-18 §3.4 backfill dry-run 报告 — splice vs recompile byte-exact 对照(2026-07-21)

**Status**: CURRENT

> 依据 `docs/2026-07-18-payoutshard-family-coherence-gate-design.md` §3.4 DoD 硬前置(NWT MUST-FIX②)：
> "权威切换前, 对现网所有处于 verifying/settling 活跃态的 V1 盘(全量, 非抽样)跑 splice 结果 vs recompile
> 结果的 byte-exact 对照, 逐行记录, 全部一致才能真正切默认权威"。
> 脚本: `kasia-console/scripts/_j1tn_k18_splice_vs_recompile_backfill_dryrun.mjs`(J1 出, commit 107252f5)。
> 执行: KANet-UI, 2026-07-21, operator 主机, 生产库 `kasia-console/data/console.db`(只读, 零写)。
> 完整原始 stdout(556 行含逐行 JSON): `scratch/2026-07-21-k18-backfill-dryrun-raw-stdout.txt`(gitignored 不入库, 但物理落在 operator 主机 `D:\kanet-tn12\scratch\`, 同机 agent 可直接读; J1(:3300 独立节点)不共享此机器文件系统, 需要的话找 KANet-UI 转发内容或摘要)。

## 聚合结果

- 总 `payout_shards` 行数: **721**
- `protocol_status` 全表分布: `pruned_expired_waived=140 / settle_zombie_quarantine=189 / verifying=90 / pending_bettors=6 / refunding=10 / refunded=78 / completed=146 / cancelled=3 / settle_failed=49 / attested_v2=9 / settled_partial_claims=1`
- 孤儿行(`payout_shards` 有但 `pool_markets` 查不到): **0**
- 终态跳过(`completed`+`settle_failed`) = 146+49 = 195，活跃态纳入比对 = 721-195 = **526**
- **MATCH(splice==recompile byte-exact): 428**
- **MISMATCH: 98**
- DECODE_FAIL/RECOMPILE_FAIL: 0
- 校验: 428+98+195 = 721 ✓ 行数无遗漏

## 结论判据(§3.4 原话)

MISMATCH+FAIL 非零(98) → **不满足"全部一致"，K-18 §3.4 权威切换的硬前置当前不通过，v0.3 的 recompile 校验维持非阻塞状态，不能升级为硬拒绝闸**。

## MISMATCH 结构分析(KANet-UI 补充，非脚本自带——供 J1/NWT 判断真假阳性)

98 条 MISMATCH **全部是 storedLen ≠ recompiledLen(21792)**，不是"同长度不同字节"的窄义漂移，是两种不同长度的 stored 脚本：

| storedLen | 行数 | 备注 |
|---|---|---|
| 22196 | 78 | 多数 `refunded`(65)/`pruned_expired_waived`(15 与前重叠计数见下) |
| 16564 | 20 | 含 9 条 `attested_v2` + 部分 `verifying`/`refunded` |

按 `protocol_status` 分组:

| status | MISMATCH 行数 |
|---|---|
| refunded | 65 |
| pruned_expired_waived | 15 |
| attested_v2 | 9 |
| verifying | 9 |

**关键怀疑点**: `attested_v2` 这个状态名本身就指向 V2/ZK 家族(非 V1 committee 家族)，脚本对**所有活跃行统一调用 `compilePayoutShardRedeem`(V1 编译器)**，没有按 `covenant_family` 分派(K-18 §3.1 的 `covenant_family` 列是 v189 migration 的一部分，**尚未落地**，本次 dry-run 只能用现有 schema 跑)。如果这 9 条 `attested_v2` 行实际存的是 V2 redeem 脚本，拿 V1 编译器重编译天然会长度不同、必然 MISMATCH——**这大概率是脚本范围问题(比对了不该比对的家族)，不是真正的 splice/recompile 漂移 bug**。同理，`refunded`/`pruned_expired_waived` 两组也需要人工确认这些行是否仍是 V1 committee 家族、还是历史上曾经历过某种迁移/reissue 导致 redeem 结构变化。

**KANet-UI 不下结论**——这需要 J1(K-18 原作者)或 J2 用实际数据核实这 98 行的真实家族/历史，判断是"脚本范围漏过滤"还是"真发现了漂移"。本报告只负责把完整、无遗漏的对照数据摆出来。

## 追加：频道协作核实(2026-07-21，跑完 dry-run 后当场核对，供后续接位者不用重查)

- **refunded(65 行)组**: 抽样 5+4(NWT/J2 各自抽)条，`pool_markets.settle_txid`/`refund_txid`/`metadata.refund_tx_obj` 全部有真实落链值——确认这些市场已经过了退款流程，早就不在 `closed:0` 阶段，dry-run 脚本拿 `closed:0` 模板去比对天然对不上。**判定：假阳性，非真漂移**(NWT 提出假说，KANet-UI+J2 独立数据验证坐实)。
- **attested_v2(9 行)组**: J2 核实其中一条 id 正是 `docs/DECISIONS.md` D-009 记录过的 ZK guest imageId 事故盘。**判定：家族误判(V2/ZK 行被拿 V1 编译器比)，假阳性**。
- **pruned_expired_waived(15 行)组**: J1 全库 `git log --all -S` 搜索确认 `pruned_expired_waived` 这个状态值**从未被任何应用代码写过**，只能是人工 SQL/线下 runbook 打的——支持"老版本 schema 遗留"猜测，但**尚未坐实**，留待 J1/J2 继续查这批市场历史，不下结论。
- **verifying(9 行)组**(§3.4 字面最相关的"仍处 pre-close 阶段"子集): 排查过程有两轮假说均被数据推翻，记录下来防后续接位者重走弯路——
  1. J1 最初提出 D-001(silverc OP_PICK codegen bug，2026-07-06 修复)pre-0706 编译遗留假说。KANet-UI 查 `payout_shards.created_at`(unix 秒，注意换算单位——首次查询把秒当毫秒传给 `new Date()` 出现自算错误，已自查纠正)，9 条全部创建于 2026-07-06 之后(7/7~7/17)。**J1 随后自己撤回**：V1 的 `PayoutShard`/`ShardLeaf` 编译永远走 `SILVERC_LEGACY`(pin 死的 legacy 二进制)，跟 D-001 OP_PICK 修复所在的 silverc 版本完全不是同一个二进制，日期先后本来就不影响——**D-001 假说从根子上不适用于 V1 编译路径，不只是时间对不上**。
  2. J2 独立全量核实(不是抽样，98 条 MISMATCH 全量复现)同样确认 24 条(9 verifying+15 pruned_expired_waived)全部 post-0706，并提出旁证假说：这 9 条 verifying 可能是 COORD-LEDGER 记录的 "cohort B / spc_daa_index 覆盖起点 56.98M 之前的 9 盘 MAX_WALK 全灭" 那个已知独立老问题的成员(id 数量都是 9，怀疑同一批)。KANet-UI 用客观数据核实(非记忆匹配)：这 9 条的 `deadline_daa` 实际范围是 **55,369,479~63,404,896**，跟 cohort B 叙述的 "46.5M-53.5M 区间" **完全不重叠**；且 `protocol_status` 字段本身就是 `verifying`，不是 cohort B 描述的 `refunding`。**两个维度都对不上，cohort B 假说不成立，退回未解释状态**。
  3. 已知的部分：其中 1 条 id 含 `8pson`，是 K-18 文档 §4 自己举例的已知 incoherent V2/ZK 事故盘，大概率是家族误判(同 attested_v2 组)非新问题。`kr5l4` 有名字(COORD-LEDGER committee-seed 退款修法那条线)但具体跟这次 MISMATCH 的关联未查。
  4. **净剩子集 → 已收敛**: KANet-UI 用 J1 出的结构探针(commit d97e2435)dump 全部 8 条(7 条+kr5l4)：byteLength 全部 = **8282**(基线正常 V1 completed 行 = 10896，系统性短 **2614 字节**，8 条无一例外)。NWT/J2 认出这个精确数字 = COORD-LEDGER 7/17 段"8pson 死路定案"用的四值探针原文结论(`G1≠G0 结构性差 2614 字节，V2 vs V1 两编译路径`)——**同一个数字，不是巧合**。KANet-UI 追查 `metadata.zk_native`(顶层+`resolution_rule_spec.zk_native`)全部 null，判据本身走不通，但 side-confirm 了 K-18 §2 自诊断的病根("唯一家族选择器=可变标记，对 mint 后标记漂移零防护")。**最终由 J2 跑正式四值探针收官**(复用 `codex_probe_8pson.mjs` 判据，脚本 `kasia-console/scratch/_j2_4value_probe_8verifying.mjs`，只读零链上调用)：8/8 全部同一签名——`stored G0=8282 字节 / V1 genesis 重编译 G1=10896 字节 / G0-G1=-2614 字节(逐一精确相等)/ G1==G0 全部 false`，跟 8pson 判据逐位吻合。**结论：这 8 个市场(7jy3s/s6zwj/tha3l/9ez2u/9jaty/kr5l4/j34vb/3mzoh)确认是 genesis 铸 V2/ZK covenant 但 family 标记没跟上的家族错配，跟 8pson 同族同病，不是新漂移、不是 D-001、不是 cohort B**。旁证：A0(stored redeem 的 p2sh) vs 记录的 `payout_ps_addr` 比对，8 条里 2 条(7jy3s/kr5l4)相符、6 条不符——次要发现，不影响主判据，但提示这批盘可能还有第二层地址记录不一致，留给 J1 判断是否要紧。

**收窄后的风险面(最终)**: 98 条 MISMATCH 现在全部有归因——65 refunded(已过 closed:0 阶段，假阳性)+ 9 attested_v2 + 9 verifying(含 8pson，全部 V2/ZK 家族错配，同 8pson 病)= 83 条确认非真漂移；15 条 pruned_expired_waived 家族归属仍待验证(created_at 聚在 7/13-7/14 一小段 <20 分钟窗口内，像批量脚本/手工建盘产物，J2 提议用同一四值探针脚本换 id 集合复核)。**K-18 §3.4 权威切换硬前置(DoD-0)截至目前没有发现任何一条真实 splice-vs-recompile 漂移，全部可解释为脚本比对基准错误(refund-close/V2 家族误判)——支持继续按现有方向推进 K-18 §3.1(covenant_family 不可变列)收尾，不涉及 ZK 电路/协议本身需要调整**(2026-07-21 06:1x Owner 在频道问询后，Bettor/NWT 已直接答复确认)。

## 完整 MISMATCH 逐行清单(98 条全量，无抽样)

```
(全 98 条 marketId/status/storedLen/recompiledLen JSON 记录见执行时 stdout 存档，本文档为避免过长不重复粘贴；
 摘要分组统计已在上方表格；如需单条核对可用以下 SQL 在生产库现查:
 SELECT logical_market_id, payout_redeem_hex, pool_merkle_root, predicate_commit FROM payout_shards
 WHERE logical_market_id IN (<marketId 列表>))
```

## J1 域正式判定(2026-07-21,K-18 §3.3(b) 结构探针结果,`_j1tn_k18_v1_structural_probe.mjs` commit d97e2435,KANet-UI 执行)

**verifying 组 8 目标(7jy3s/s6zwj/tha3l/9ez2u/9jaty/j34vb/3mzoh/kr5l4)判定:高置信度=8pson 同族家族误判,非新 splice/recompile 漂移。**

**证据链**:
1. `byteLength` 8 个目标全部 = **8282**(hex 字符数 16564÷2,此前 KANet-UI 报告口径误把 hex 字符数当字节数,已自查纠正),对照 baseline(任一 `completed` 状态已知正常 V1 行)= **10896**,差值 = **2614 字节,8 个目标全部一致**(不是随机分散的损坏特征——数据损坏预期长度各不相同,系统性一致差值指向"同一份不同模板")。
2. 该数值**不是巧合**:COORD-LEDGER 228 行(8pson 死路定案,Codex 四值探针+NWT+J2 三方核实)白纸黑字记录 "G1≠G0 结构性差 2614 字节(V2 vs V1 两编译路径)"——跟今晚测出的差值**位数级精确匹配**,同一个数字出现在两次独立时间点的独立测量中。
3. state 头部字段(`0x08` PUSH8 marker 位置、`consolidatedPool` 解码 offset)8 个目标全部结构正确、数值域合理(20000000~5650020000000 sompi,无乱码/负数/溢出)——排除"数据物理损坏"假说,支持"完整但来自不同编译模板"。
4. `resolution_rule_spec.zk_native` 全部 null(KANet-UI 现查坐实)——跟 K-18 §2 自己诊断的病根吻合:"唯一家族选择器=可变标记...对 mint 之后的标记漂移零防护"。这批市场很可能跟 8pson 同款,genesis 铸造时是 V2/ZK 家族,但记录家族的标记(`zk_native`)从一开始就没有可靠写入/后续漂移,导致任何依赖这个字段的家族判断(包括本次 backfill 脚本的过滤逻辑)都测不准。

**置信度诚实标注**: 这是**结构信号高度吻合**的判定,不是逐 opcode 字节比对出的 100% 确证(那需要 Codex 当时对 8pson 做的完整四值探针同款深度,本次只做了长度+关键 offset 抽查,没有对 8pson 本尊和这 8 个目标做逐字节 diff 互证)。但独立信号数量(byteLength 精确匹配已知值+state 头结构正确+zk_native 全 null 同 8pson 病灶)已经足够排除"新的 splice/recompile 权威 bug"这个 K-18 §3.4 真正关心的问题——**跟 P0/K-18 §3.4 权威切换的相关性判定为:不相关,是另一个已知问题(家族标记不可靠)的更多样本,不是 v0.3 引入或发现的新漂移**。

**待续(不阻塞上面的判定,分开记账)**:
- `kr5l4` 单独关联(COORD-LEDGER committee-seed 退款修法那条线)未查,不影响上面的家族误判判定(byteLength/zk_native 两个信号 kr5l4 都命中同款特征),但完整归因留待需要时再查。
- `pruned_expired_waived`(15 行)组**尚未跑同款结构探针**——本次探针目标只覆盖了 verifying 组 8 条,pruned_expired_waived 是否也是同一个 2614 字节签名待验证(如果是,可以把假阳性范围扩到 74+15=89/98;如果不是,那是另一个独立、真正需要查的信号)。建议下一步: 用 `_j1tn_k18_v1_structural_probe.mjs` 传 pruned_expired_waived 那 15 个 marketId 跑一遍,看 byteLength 是不是同样落在 8282(同 8pson 族)还是别的数字(全新信号)。

## 部署门禁状态(不变)

K-18 §3.4 权威切换(recompile 从非阻塞校验升级为硬拒绝闸)仍然 **不满足**。P0(6cff7305→v0.3 25b3d0a0)的整体装载仍受 NWT RED verdict + Codex MUST-FIX(6条，部分已折入 v0.3)+ Owner money-path 三重门禁，本报告只解决其中一项前置(backfill dry-run)，且解决结果是"数据摆出来了，但 98 条不一致需要人工归因，不能直接宣布'满足全部一致'"。
