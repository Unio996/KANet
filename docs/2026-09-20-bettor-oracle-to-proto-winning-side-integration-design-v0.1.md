> **Status**: CURRENT

# oracle → proto_markets.winning_side 整合设计 v0.1（复用现有 oracle 决策引擎，不造新轮子）

- 出处：Owner 2026-09-20 定向「主网市场判定来源=整合现有 oracle 系统写 winning_side，千万不要新造轮子。检查、评估、整合、迭代」。
- 依据：oracle 现状 Explore 报告（2026-09-20）+ NWT 红队关注点 + D-030 TypeSafe。
- 排序：D-029 主网首轮（受控判定，今天）先行；本设计是紧接着的正式判定路径，走既有门：Bettor 设计 → NWT 红队 → 实现 → NWT 审 diff → 合入 → 迭代。

## 0. 一句话
现有 oracle 决策引擎（5 人委员会 5/5 全票、已知源证据抽取、UMA 镜像、押金罚没、5 分钟 voter/settler cron）**成熟且在跑**，但**结构上看不见 proto_markets**。整合 = 给 proto-v0 市场补"可判定的题"+ 让 voter 巡检扫 proto_markets + 委员会判出后 **write-once 写 winning_side**；**复用引擎，不重写**。判定值 YES/NO→0/1 映射是一行；难点是"给 oracle 一道它看得懂的题"。

## 1. 复用什么（现成，不动其内核）
- 委员会 Path D：maker 选最多 5 个 `is_oracle=1` relay，5/5 全票，异议→重投→退款（`bettor-prediction-settler.js`）。
- 判定引擎 `deriveVote`：已知源抽取器（ESPN/CoinGecko/…）→ 确定性判 or LLM 共识；**未知/低置信 → ABSTAIN 不猜**。
- UMA 镜像 `derivePolymarketVote`（48h 定稿窗，当前定位 testnet shadow，不作主网依赖）。
- 押金/奖惩：`oracle_bond_amount` 链上押、错判罚没。
- cron 形态：`startPredictionVoterCron`（5min tick）+ settler。

## 2. 缺口（Explore 实证）
1. `proto_markets` 只有自由文本 `question` + `winning_side INTEGER`，**无任何 oracle 字段**（无数据源/条件 id/resolution_rule_spec/委员会 relay/押金）。
2. voter cron 只扫 `exchange_offers` 与 `pool_markets`，**不扫 proto_markets**。
3. `/api/proto-markets/:id/resolve` 是**永远抛错的桩**（`proto.js:38-40`）；winning_side 现仅由**受控 SQL 手写**。
4. `winning_side` **无 write-once 约束/锁**（无 CHECK、无"已设则拒改"）——谁写、写几次目前不设防。
5. 老引擎判定值只在 settler 同 tick 内暂存于 `metadata` JSON，**没有"判定→持久写一个稳定列→停手"的契约**；proto-v0 恰恰要这个契约（winning_side 列）。

## 3. 设计（schema + adapter，复用引擎）
### 3.1 schema（proto_markets 加列，走 migrate 新版本）
- 判定题：`resolution_rule_spec`（同老系统 5 必填：data_source_canonical / secondary_sources / ambiguity_handler / dispute_keywords / edge_case_examples）**或** `outcome_market_source`+`outcome_condition_id`（走 UMA 镜像时）。**建市场时必填其一**，否则该市场不可 oracle 判定（回退受控判定，见 §6）。
- 委员会：`outcome_oracle_relay_ids`（JSON，≤5，`is_oracle=1`，建市场时 alive 校验）+（可选）`oracle_bond_amount`。
- 判定落地审计：`winning_side_source`（'oracle' | 'operator'）、`winning_side_set_at`、`winning_side_set_by`。
### 3.2 adapter（新增，不改引擎）
- voter cron 加一支扫描分支（平行于 `processPoolMarket`）：读 `proto_markets` 中 `status='sealed'` 且过 `deadline_ms` 且 `winning_side IS NULL` 的行，构造 offer 形状适配对象喂 `deriveVote`。
- 达成阈值共识（5/5 或配置）→ **一条 `UPDATE proto_markets SET winning_side=?, winning_side_source='oracle', … WHERE id=? AND winning_side IS NULL`**（write-once 见 §4）。**不走**老系统的 escrow/SS settle-tx——proto-v0 有自己的 close_commit→convert→claim 覆盖机制，钱由它动。
### 3.3 TypeSafe 补弃权（D-030，advisory）
- 老 LLM 路径已知毛病：主观题"硬答不弃权"。用 TypeSafe（Noul/Choice + confidence 阈值）替换/包住该路径的主观判定：**高置信→判，低置信→ABSTAIN→人工/退款，绝不猜**。只发非敏感/合成/公开输入，**绝不进 close_commit/convert/claim 出口闸**——TypeSafe 只影响"是否/如何得出 winning_side 的建议"，最终写入仍由委员会共识 + write-once 门控。

## 4. NWT 红队关注点 → 逐条 MUST（本设计骨架）
1. **谁能写 winning_side / write-once / 防重放**：写入仅两条合法路径（oracle 共识 adapter；§6 受控 operator）。**MUST write-once**：`UPDATE … WHERE winning_side IS NULL`，已设则拒；加 `winning_side_source`/`_set_at`/`_by` 审计；同 intent 重放不得二次改值。
2. **oracle 输入被操纵 / 单点**：委员会 5/5（非单点）+ ABSTAIN-on-uncertain + 押金罚没 + data_source_canonical 与 secondary 交叉；单一数据源被投毒 → 异议 → 重投 → 退款，不硬判。
3. **错判不可逆**：winning_side→结算不可逆。MUST 在 winning_side 落库与结算驱动动作之间设**争议/确认宽限窗**（见 5），错值能在 close_commit 广播前被拦/改（write-once 的例外仅限"宽限窗内、经明确授权的更正"，需另设，不默认可改）。
4. **winning_side→close_commit 时间窗**：结算驱动现在下一 tick 即动。MUST 加**判定确认延迟**（如 winning_side_set_at + grace 才进 close_commit），给争议/纠错留窗；与 D-022 refund_flip grace 口径对齐。
5. **与 assertCloseCommitArgsFromDb 另一路派生是否真独立**：MUST 核 winning_side 的写入路径与 close_commit 参数派生（`proto-winner-bet.mjs` 读 winning_side 选赢家 bet）不构成循环自证——winning_side 是外部判定输入，close_commit 派生只消费它、不反向影响它；红队实证两路独立。

## 5. 确认宽限窗（新增，MUST-3/4 的落点）
- winning_side 落库后进入 `resolved_pending` 观察期（时长 Owner 定，如 deadline 后 + Nh），窗内结算驱动**不建 close_commit**；窗过无争议才放行。
- 争议触发（committee 异议 / 人工 flag）→ 冻结该市场结算，升级人工。零价值测试币期可短窗；对外/真值期加长。

## 6. 与受控判定并存（v0 过渡）
- 主网首轮（D-029）用受控 operator 写（`winning_side_source='operator'`）。oracle 路径上线后二者并存但**write-once 互斥**：先到先写、后到拒（不覆盖）。是否允许 operator 覆盖 oracle（争议纠错）= 另一条 Owner 钱路决定，默认不允许。

## 7. 分期
- v0.1（本稿）→ NWT 红队。
- 实现分批：批 A schema+write-once 守卫（最小、先堵"谁能写"）；批 B voter adapter 扫 proto_markets + 共识写；批 C TypeSafe 弃权补 LLM 路径；批 D 确认宽限窗。每批设计→红队→实现→审→合，simnet 端到端验后再上主网。
- 不影响：D-029 主网首轮、批 9 结算机制、驱动开关。
