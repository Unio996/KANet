> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-oracle-batchB-v0` @ `6287c9dc`，delta = `git diff bacd6879..6287c9dc`；只看 delta；D-021：类别级）

# 批 B fix delta 复核 → **GREEN**

## 核对结果
- **测试**：在我的检出上重跑 10 个相关测试文件全 0 红（verdict 12 / adapter-core 22 / spec 12 / policy 5 / service 7 / create-route / bet-intake 8 / intake-route / budget 21 / freeze-v213 13）。
- **M1（误拒）已修**：用我上一轮的真库探针复跑——`wall=oe+60s ∧ pmt=oe−80s` ⇒ **不写批准票**（`written:0`）；下一 tick `pmt≥oe` ⇒ extractor 与 UMA 两票都写入、`pmt_at≥oe`，gate 最终 `promote`（此前是 `wait awaiting_second_source` 永远）。对照臂不变。新增探针：**滞后窗内的异议仍写**（extractor YES + UMA NO、pmt<oe ⇒ 两行都写，之后 `pmt≥oe` 时门冻结），**pmt 无效 + 实质 ABSTAIN ⇒ 仍写 `pmt_at=NULL`**（B4 不退化）。`planVerdictWrites` 对缺失/非正 `outcomeEndMs` 抛错（不静默放宽）。
- **M2（活性）已修**：20 个远期市场 + 1 个已到期市场 ⇒ `scanned=1`，已到期者被 derive（此前 `scanned=20` 全跳过、新市场饿死）。永久不可处理的两类（坏 spec / 数据源不在注册表）⇒ 首个 tick 就被 `freezeMarket`（`frozen_reason` 为 `spec_invalid|clock=wall` / `source_not_registered|clock=wall`），第二个 tick `scanned=0`，不再占名额。
- **你要我核的"删死代码"**：循环内原判 `wall >= oe || (pmtOk && pmt >= oe)` 与 `wall = nowMs()`——候选 SQL 已保证 `outcome_end_ms <= 查询时墙钟`，循环里的墙钟 ≥ 查询时墙钟（单调），所以原判**恒真**；我 grep 确认文件里 `pmtOk` / `wall` **再无任何残留引用**（不是"删了定义留了用法"）；该 pmtOk 只服务于那一个判定。**没有删掉活逻辑**。批准票是否需要 pmt≥oe 现在由 `planVerdictWrites` 承担（已被变异杀）。
- **SHOULD①②**：`startProtoOracleAdapter` 的 voter 导入失败 ⇒ LOUD `REFUSED to start` 不抛 ✔；创建路由的 `^(resolution|outcome)` 未识别键 ⇒ 400 ✔——并核对了现有创建 UI（`proto-market-create.eta`）实际发送的键只有 `tokenId / title / deadline / resolutionNote`，`resolutionNote` 在"已识别"清单里，**对现有流程无回归**。
- **变异**：我针对 delta 写了 12 个（批准票门去除 / `>` / 不校验 outcomeEndMs / 异议也被推迟 / 候选 SQL 去时间过滤 / 排序回退 / permanentFreeze 不冻结 / spec_invalid 只跳过 / 导入不保护 / 去未识别键检查 / 去 resolutionNote 识别 / UMA 标签不要 ok:true）：**12/12 全杀，树已还原**（`git status` 干净）。上一轮活着的 B1c 已被杀。

## 备注（不阻塞）
主网上 `not_allowed_here` 的判定题（只可能来自直接写库/旧数据）不冻结、仍占候选名额——J2 的取舍合理（白名单可变，不该永久冻）；若将来出现，`LIMIT` 名额会被它们占，届时另出票。

## 我没做
未部署、未 simnet 端到端；derive 全注入（真 ESPN / Polymarket / relay pmt 没跑）。
