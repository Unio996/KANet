> **Status**: CURRENT（2026-09-20，NWT；对象 = `docs/2026-09-20-bettor-oracle-to-proto-winning-side-integration-design-v0.1.md`（主线 `1b28d752`）；Bettor 令：设计审，不是漏洞评估；只报 MUST，SHOULD 记票）
> D-021：本文只写设计缺口的类别与处置，不含利用步骤。

# oracle → `proto_markets.winning_side` 整合设计 v0.1 —— NWT 设计审

## 结论：**方向对（复用引擎、不新造、批 A 先堵"谁能写"），但按现稿还不能派实现——有 6 条 MUST 缺口；§4 的五条只有第 5 条基本闭合、其余四条未闭合或半闭合。** 修完这 6 条再送我复核一轮即可，不必重审全稿。

## 我对着真实代码核过的事实（设计稿的前提有几处与现状不符）
| 事实 | 依据 |
|---|---|
| `winning_side` 现在**没有任何应用层写入方**，只有手写 SQL；列是裸 `INTEGER`，**无 CHECK、无触发器** | `migrate.js:5981`；全仓非测试代码无 `UPDATE … winning_side`；`/resolve` 是抛错的桩 |
| **主网 `relay_nodes` 的 `is_oracle=1` 共 0 个**（18 个全是 0）；`oracle_registry` / `oracle_pool_membership` / `oracle_stake_enrollments` / `pool_markets` 全 0 行 | 只读主网库计数 |
| 委员会**由建市场的调用方在请求体里指定**（`outcome_oracle_relay_ids`，要求 5 个 `is_oracle=1` 且存活；maker/broker 不得兼任） | `api/bettor.js:1277-1310` |
| `deriveVote` 对"已知源"走确定性抽取器（未 final ⇒ ABSTAIN），但 `kanet_*` 源仍走"抓页面文本 → LLM → `{outcome, confidence}`"，低置信才弃权 | `services/bettor-prediction-voter.js:747-930` |
| 结算驱动在 `winning_side` 落库后**下一 tick（≈20 s）**就会动 close_commit | 主网首轮实测 |
| **covenant 自带 refund 时限：`REFUND_FLIP_GRACE_MS = 7_200_000`——`deadline` 后 2 小时起任何人可把 RootClose 的 closed 0→2（改判退款）** | `proto-close-commit-gate.mjs` |
| `assertCloseCommitArgsFromDb` 与 builder 入参**都从同一列 `winning_side` 派生**（`deriveWinnerBet` 读该列）；v0 还要求"赢家那一侧恰 1 条已确认下注"，否则 fail-closed | `proto-winner-bet.mjs`、`proto-settlement-inputs.mjs` |
| 批 9 驱动**不接线** withdraw / ticket_reclaim；refund_flip 只探测报警，不执行 | `proto-settlement-driver.mjs:7`、核心 `probeRefundFlip` |

## MUST 缺口（6 条）
**M1 — write-once 必须在 DB 层强制，且要带证据链，而不只是 adapter 里的 `WHERE winning_side IS NULL`。**
- 另一条合法写入路径（§6 的受控 operator，今天就是手写 SQL）不经过 adapter，所以 adapter 里的谓词**约不到它**；`winning_side_source` / `_set_by` 只是可自填的字符串，不构成来源证明。
- 修法（批 A 的内容）：① SQLite 触发器 `BEFORE UPDATE OF winning_side … WHEN OLD.winning_side IS NOT NULL ⇒ RAISE(ABORT)`，并 `BEFORE UPDATE/INSERT` 时校验 `NEW.winning_side IN (0,1)` 与 `status='sealed'`（SQLite 不能给既有列补 CHECK，触发器是唯一办法）；② adapter 的 UPDATE 谓词同一条语句里带 `status='sealed'`（防"读完候选到写入之间被取消/已结算"的 TOCTOU），并检查 `changes===1`，`changes===0` 视为"已被判定"而不是错误重试；③ **oracle 来源必须引用一条不可改的"判定记录"**（见 M3 的 `proto_market_verdicts`），`source='oracle'` 而没有对应记录 ⇒ 触发器拒绝。
- 另：§6 "先到先写"会让 operator 永远能抢在 oracle 前面——**建了 oracle 判定题的市场应禁止 operator 直写**（除一条显式的 Owner 覆盖路径），没有判定题的市场才走 operator。

**M2 — 时间预算被 covenant 的 deadline+2h 硬顶住，设计没写数。**
- `deadline` 后 2 小时任何人可把市场翻成退款。所以 **委员会出结果 + §5 确认宽限窗 + close_commit 落链深度**必须整体小于 2 小时，否则 oracle 路径会**结构性输给 refund_flip**（赢家被退款）。§5 的"Nh，Owner 定"必须带上界：`N ≤ 7200s − 投票最坏耗时(5 分钟 tick × 重投轮数) − close_commit 落链余量`，并在 deadline+1h 报警（已有 SLA 报警口径）。
- **与 write-once 的矛盾**：§4-3 说"宽限窗内可经授权更正"，§4-1 又要 write-once——两者不能同时成立。请在设计里选定并写明：**推荐"争议 ⇒ 冻结市场、不改值、走自然 refund_flip（+2h 后自动退款）"**，即 winning_side 一旦写入永不改；错判的补救 = 在 close_commit 前让市场被 refund_flip 或人工冻结，而不是改列。若坚持要更正路径，须单独立项并另出触发器例外规则。

**M3 — AI 判定不能直接写钱路的列：需要"判定记录 → 确认 → 提升"两段式。**
- 现稿 adapter 一旦达成共识就写 `winning_side`，而结算驱动 20 s 内就据此花钱。LLM 路径（`kanet_*` 源）的输入是**攻击者可控**的：市场 `question`、`resolution_rule_spec` 的自由文本、被抓取的页面文本都进 prompt；且"5 个委员都跑同一个模型、读同一份抓取文本"给出的 5/5 是**强相关，不是 5 个独立判断**。TypeSafe 只是把 LLM 换个供应商，不改变这一点。
- 修法：新增追加型表 `proto_market_verdicts`（判定值、来源类型、投票明细/证据哈希、时间）——adapter 只写这张表；**提升到 `winning_side` 只允许两类来源**：(a) 确定性已知源抽取器（且该抽取器报告"已 final"）与/或已定稿的 UMA 镜像；(b) 人工确认。**纯 LLM 判定只产生 proposal，不自动提升**。这同时给 M1 提供证据链，并使 §5 的宽限窗有了自然落点（提升时刻 = `winning_side_set_at`）。

**M4 — 委员会在主网并不存在，且"5/5 = 去中心化"的说法不成立；委员会不能由建市场的调用方指定。**
- 主网 0 个 `is_oracle=1` relay、oracle 相关表全空（见上表）：设计里"复用 5 人委员会 + 押金罚没"**今天在主网跑不起来**；要有就得先有 5 个带押金的 oracle relay。若它们都由 KANet 自己运营，则这是**单运营方的裁决机**（与既定 H0 立场一致，没问题），但文档应如实标注，不要写成"5/5 去中心化"。
- 现引擎里委员会是建市场时**调用方在请求体里传的**（`api/bettor.js:1277`）。proto-v0 里必须改为**运营方固定的白名单**，且写进判定题的委员会在**建市场后不可更改**，否则"谁建市场谁挑裁判"。

**M5 — ABSTAIN / 异议 / 委员会掉线 / 胜方侧无法结算，必须有确定的终局与执行者。**
- "弃权→人工/退款"没有执行者：批 9 不接线 withdraw/ticket_reclaim，refund_flip 只报警。请在设计里写明：委员会超时（例如 deadline+X 仍无共识）⇒ **自然 refund_flip（+2h）** 作为默认终局，并说明退款侧的 claim/withdraw 由谁、哪一批接线（否则"不猜"等于"不结算、资金可链上取回但没有驱动帮忙"）。
- adapter **写入前**必须先校验：胜方那一侧**恰 1 条已确认下注**且奖池 >0（`deriveWinnerBet` 的前置），否则写了也会让市场卡在 `winner_count`/`winner_pool_empty`；这种市场应直接走"人工/退款"而不是写值。

**M6 — 判定时刻语义：`deadline_ms` 是 covenant 的 deadline，不是"结果已可知"的时刻。**
- voter 扫描条件"过 `deadline_ms`"要求 `deadline_ms` ≥ 事件结果可知时刻 + 投票与宽限余量（因为 deadline+2h 之后任何人可翻退款）。老系统有 `outcome_end_date > now+15min` 这样的"结果可知时间"概念，`proto_markets` 没有。请加 `outcome_end_ms`，并在建市场时校验 `deadline_ms ≥ outcome_end_ms + 投票预算 + 宽限窗 + 余量`；voter 在 `outcome_end_ms` 之前不得投票（LLM 路径对"未 final"没有抽取器兜底，更需要这条硬时间闸）。

## §4 五条是否闭合
| # | 结论 | 说明 |
|---|---|---|
| 1 谁能写 / write-once / 防重放 | ❌ 未闭合 | 见 M1：只在 adapter 谓词里，约不到 operator 直写；来源标签可伪造 |
| 2 输入操纵 / 单点 | ⚠ 半闭合 | 见 M3/M4：5/5 强相关且主网无委员会；输入面（question/spec/页面）攻击者可控 |
| 3 错判不可逆 | ❌ 未闭合 | 见 M2：与 write-once 自相矛盾；"更正"无规则 |
| 4 时间窗 | ⚠ 半闭合 | 思路对（宽限窗），缺 deadline+2h 的数字上界（M2）与实现落点（`listWork` 的 close_commit 触发条件里加 `winning_side_set_at + grace < now`，而不是新增 `resolved_pending` 状态——新状态会碰到现有 `m.status='sealed'` 谓词） |
| 5 与 `assertCloseCommitArgsFromDb` 是否真独立 | ✅ 基本闭合，但**表述要改** | 二者**不循环**（`winning_side` 是外部输入，close_commit 只消费）；但它们**同源于同一列**，所以"独立"只在"驱动入参 == DB 派生值"这个意义上成立，**不验证 `winning_side` 本身对不对**。`winning_side` 的正确性只靠 §4 的 1–4，请别在文档里把这条当成对判定值的第二道防线 |

## schema / adapter 有无绕过 write-once 或让 AI 溜进钱路的缝
有，就是 M1（operator 直写与 adapter 不同路、来源可伪造）+ M3（adapter 直接写钱路的列、LLM 输入可控且相关）。另两条小缝记 SHOULD：`/api/proto-markets/:id/resolve` 桩若将来被打开必须先加鉴权与同一触发器保护；`winning_side_set_by` 是自由文本，别当审计证据。

## 分批顺序
批 A（DB 层 write-once 触发器 + `proto_market_verdicts` 表 + status 谓词）先行 ✅ 合理，**范围按 M1 扩**。**批 D（宽限窗）必须排在批 B（adapter 写值）之前**——否则 B 一开，判定值 20 s 内就被驱动花掉，宽限窗没有落点；更稳的排法：**A → D → B（先只写 `proto_market_verdicts`，影子运行）→ simnet 端到端（含争议、超时、退款终局）→ B 对确定性源开提升 → C（TypeSafe，仅作 proposal 的置信度参考）**。批 B 上线前还需 M4 的委员会白名单与 M6 的 `outcome_end_ms`。

## SHOULD（记票，不拦）
1. 判定时间戳用节点 `pastMedianTime` 口径，与 refund_flip 的判定一致，而不是控制台墙钟。 2. 委员会/共识超时值与 cron 重复触发的幂等（`changes===0` 处理）写进测试。 3. TypeSafe 属外部依赖：可用性与数据外发（只发公开题面，已有红线）+ 置信度阈值别写死在代码里。 4. 确认宽限窗的争议入口（谁能 flag、怎么冻结）要有鉴权。 5. 判定记录保留原始抓取文本的哈希，便于事后复盘。
