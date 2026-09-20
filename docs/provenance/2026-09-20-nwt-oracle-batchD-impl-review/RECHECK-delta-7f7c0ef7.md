> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-oracle-batchD-v0` @ `7f7c0ef7`，delta = `git diff ffe95ffa..7f7c0ef7`（15 文件）；只看 delta；D-021：类别级）

# 批 D delta 复核 → **GREEN**（M1/M2/relay SHOULD/⑤ 回归都成立；附 1 条"补一个测试、不改码"）

## 核对结果
- **测试**：在我的检出上重跑 8 个测试文件 + relay：budget 21 / freeze-v213 13 / intake 6 / route / core 31 / store 19 / driver-service 11 / 批 A 24 / relay 44，**全 0 红**。
- **M1**：我上一轮的 9 个探针（含对照臂）重跑——对照臂仍 `promote`；先前放行的 A（extractor 弃权、pmt_at 空）、C（extractor 反向、pmt_at 空）、B/B2（human 反向/弃权）现在都 **freeze**；另加 D（早于 outcome_end 的反向）、E（llm 反向）、G（未来时间戳反向）也 freeze。新增边界探针：非法 outcome=2 / 字符串 "1" / 缺字段 ⇒ freeze；llm 或 human **同向**附加 ⇒ 仍 promote 且不被引用；仅 llm+human ⇒ wait；两个自动来源之一 `pmt_at` 空 ⇒ wait；零 verdict ⇒ wait。顺序上冻结集判定在"pmt 有效 / 未过 cutoff / 结果已知"之后、在宽限窗等待**之前**——宽限窗内出现异议会立即冻结。
- **M2**：经 `checkBetIntake`（桩库）实测：`wall=oe+1ms ∧ pmt=oe−140s` ⇒ **409 outcome_end_passed（且不读 pmt）**（旧门会收）；墙钟已过 + pmt 无效/`readPmt` 抛错 ⇒ 仍 409（不是 503）；`wall=oe−1ms ∧ pmt=oe−141s` ⇒ 收；`wall=oe−1ms ∧ pmt=oe+1` ⇒ 拒；`wall=oe−1ms ∧ pmt` 无效 ⇒ 503 fail-closed；`wall=oe` 恰等 ⇒ 拒（`>=`）。
- **relay**：`Promise.all` + `getServerInfo` 单独 `.catch(()=>null)`；`getBlockDagInfo` 失败仍硬失败。最坏耗时回到 ≈ 单次 `rpcCallMs`，不再是两次之和。注释已改四字段。
- **⑤**：生产零改，纯回归。
- **变异**：我针对 delta 写了 16 个（M1 冻结集/一致性各只看"自动+pmt_at"、llm 排除、human 排除、赞成集放进 human、赞成集放进 pmt_at 空；M2 去墙钟判据 / `>` / 不传 wallMs / 墙钟取 0；relay 两条；convert 发现 SQL / claim_draw 发现 SQL / convert 的 dependenciesLanded / 核心闸对所有步骤生效）——**15 杀 1 活，树已还原（`git status` 干净）**。

## 活的那 1 个（补一个测试，不改码）
**M1e 赞成集放进 `human`** 存活：代码本身是对的（我实测 `extractor+human` 一致、`uma+human` 一致、`extractor+llm` 一致、`extractor+extractor` 一致 ⇒ 全部 `wait awaiting_second_source`），但现有测试只断言了"仅 llm+human ⇒ wait"与"GOOD + 附加 ⇒ 仍 promote"，**没有**"一个自动来源 + human ⇒ 仍 wait"。这条是"human/llm 永不批准"的直接回归点。请 J2 加：`[extractor 一致, human 一致] ⇒ wait`、`[uma 一致, human 一致] ⇒ wait`、`[extractor 一致, llm 一致] ⇒ wait` 三行，并把我这个变异（`AUTO_KINDS` 加入 `human`）列进变异集。不阻塞合并。

## SHOULD（记票）
1. `evaluateBetIntakeGate` 直接调用而不传 `wallMs` 时仍按旧逻辑只比 pmt（唯一调用方 `checkBetIntake` 已传）——建议 `wallMs` 非有限数时按 fail-closed 拒，防将来新调用方漏传而静默回退 M2。 2. relay 并行后 `observedAtMs` 在较慢那次返回后取，最坏使 pmt 证据"看起来"比实际新 ≤5 s，远小于 S5 的 60 s 新鲜度，无需处理。 3. 已转 KANet-UI 的展示层（冻结市场的公开 `winning_side`）与 llm 虚假冻结率监控。

## 我没做
未部署、未 simnet 端到端（等批 B）；批 D 仍无 promote 调用方。
