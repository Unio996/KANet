# 全量市场 Result Authority 统计报告 v0.1

> **Status**: DRAFT — 数据驱动报告, 待 NWT 复核方法论
> 响应 Owner 终裁七项优先级第③项("全量市场 Result Authority 统计=@J2 P0 后 or @KANet-UI 起头, 按资金量+用户数为主维度, 七字段")+ Owner 原文要求: "J1 的'多数市场 UMA 绑定'论断需实时库统计支撑才可进公开口径"。

## 一、方法论(先说清楚怎么算的, 数字才可信)

- **数据源**: `console.db` 实时查询(2026-07-16), 非猜测/非样本外推。
- **市场清单**: `pool_markets` 全表(4,029 行, 含 336 个未标版本号/14 个 v0.6/3,679 个 v0.7)。
- **资金量口径**: 扁平池市场(v0.6/legacy)取 `pool_bettor_sides.stake_amount` 求和; 分片市场(v0.7 bshard)取 `market_shards.current_leaf_state.pool_value` 逐片求和后按 `logical_market_id` 聚合。**踩过一次坑记录**: 最初误用 `market_shards.projected_settle_mass` 字段, 数值只有几千 sompi 量级(≈0.00 KAS), 明显不对——核实后该字段不是总资金量, 正确字段是 `current_leaf_state.pool_value`(JSON 内, 单位 sompi), 已改正。
- **用户数口径**: 扁平池按 `COUNT(DISTINCT bettor_pk)`; 分片市场按 `market_shards.bettor_count` 求和(注: 同一 bettor 若跨分片重复下注, 本口径会重复计数, 未做跨分片去重——这是本报告已知的一个精度上限, 见 §四)。
- **只统计"有活动"的市场**: 4,029 个 `pool_markets` 行中, 2,316 个能匹配到非零的资金/用户数据(其余为空盘/测试盘/从未有人下注), 本报告的百分比分母是这 2,316 个有活动市场, 不是全部 4,029。
- **分类字段**:
  - `committee 有无` = `oracle_relay_ids` 字段非空 JSON 数组
  - `outcome_oracle_hook` = `resolution_rule_spec` 含 `data_source_canonical` 或 `uma_question_id`
  - `zk_native` = `resolution_rule_spec.zk_native === true`(**注**: 此字段在 `resolution_rule_spec` 内, 不在 `fee_rules` 内——第一次查询时想当然放错位置查出全零, 已核实代码 `pool.js:126` 修正)

## 二、结果(资金量+用户数为主维度, Owner 要求口径)

**总计**: 2,316 个有活动市场, 总资金 **2,198,569.15 KAS**, 总押注人次 **37,554**(注: 未跨分片去重, 见 §四)。

### 2.1 result_source 三分类互斥交叉表(呼应 Trust Profile 六轴稿 §2 新增第四行)

| 分类 | 市场数 | 资金量 | 资金占比 | 用户数 | 用户占比 |
|---|---|---|---|---|---|
| **oracle-hook-only**(UMA-mirrored, 无 committee) | 2,048 | 1,720,122.88 KAS | **78.2%** | 36,789 | **98.0%** |
| **committee+oracle-hook**(committee 读外部源投票, kr5l4 类) | 236 | 443,925.76 KAS | 20.2% | 703 | 1.9% |
| **committee-only**(纯内部判定) | 15 | 19,917.00 KAS | 0.9% | 22 | 0.1% |
| **neither**(未分类/其它) | 17 | 14,603.51 KAS | 0.7% | 40 | 0.1% |

### 2.2 zk-native(横切上表, 不互斥——computation 轴独立于 result_source 轴)

| | 市场数 | 资金量 | 资金占比 | 用户数 |
|---|---|---|---|---|
| zk_native = true | 61 | 121,078.14 KAS | 5.5% | 924 |
| zk_native = false(显式) | 6 | (未逐算, 量级很小) | — | — |
| zk_native 未设(默认按代码逻辑等效 true, 见 `pool.js:1227`) | 绝大多数 | — | — | — |

## 三、口径结论(供 J1 Trust Profile 稿 §2 校正+ Owner 公开口径参考)

1. **"多数市场 UMA 绑定"这句判断, 用资金量/用户数支撑, 成立且比预期更强**: `oracle-hook-only` + `committee+oracle-hook` 合计资金占比 **98.4%**、用户占比 **99.9%**——几乎所有真实活动(不管有没有 committee 参与投票)最终都挂着一个外部数据源(`data_source_canonical`/`uma_question_id`)。J1 原判断"存在 UMA 绑定路径"是保守正确的方向, 本报告把它精确到"按资金/用户数是压倒性多数, 不只是存在"。
2. **纯内部 committee 判定(不依赖任何外部数据源)是极小众路径**: 仅 0.9% 资金/0.1% 用户。D-001"往 ZK 收敛"的叙事本身没有覆盖到 UMA 这条线(Bettor 昨日已指出), 本报告数字进一步坐实: 即使不考虑 ZK, committee 独立判定本身在当前系统的实际使用中也是边缘案例, 不是主流路径——主流路径始终依赖外部数据源, 只是"要不要额外走 committee 投票"是可选的第二层。
3. **zk-native 目前是叠加在其它路径之上的一个可选属性**, 不是独立第四条 result_source 路径(呼应 Trust Profile 六轴稿, zk-circuit 是 computation 轴的取值, 不是 result_source 轴的取值)——5.5% 的资金标了 zk_native=true, 但这些市场的 result_source 依然是 committee/oracle-hook 分类里的某一个, 两个轴独立不冲突。

## 四、已知精度上限(诚实披露, 不隐瞒)

1. **用户数未跨分片去重**: 同一 bettor_pk 若在同一 logical_market 的多个 shard 下注(理论可能, 未逐一核实实际发生率), 会被计为多个用户数。本报告的"37,554 用户"是**押注人次**上限, 不是精确去重后的唯一用户数。若这个精度对后续决策(如 Owner 口径措辞)重要, 需要专门写一次跨分片 DISTINCT bettor_pk 查询, 本报告暂未做(时间/优先级取舍, 供 NWT/Bettor 判断是否值得补做)。
2. **`neither` 桶 17 个市场未深入分类原因**: `resolution_rule_spec` 解析失败或字段缺失的边缘案例, 本报告只是分桶隔离, 未逐个诊断具体原因。
3. **总市场数 vs 有活动市场数**: 4,029 个 `pool_markets` 行里只有 2,316 个有实际资金/用户数据, 其余 1,713 个(占 42.5%)是空盘——这本身是不是需要关注的问题(测试盘残留 vs 真实创建但零人问津), 不在本报告范围, 供另立卡讨论。

## 五、待 NWT 复核

1. §一方法论本身(尤其 `pool_value` 字段选择+扁平池/分片池两套聚合逻辑是否有遗漏第三种市场结构)。
2. §四 1 提到的跨分片去重是否值得补做。
3. 本报告数字是否可以直接回填 Trust Profile 六轴稿 §2 的 UMA 路径"待核实"三格(可用性/escape_authority 仍需另外核实实现细节, 本报告只覆盖统计占比, 不覆盖那两轴的机制性问题)。
