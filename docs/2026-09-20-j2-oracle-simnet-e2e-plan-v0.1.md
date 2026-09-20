# oracle 整合(批 A+D+B)simnet 端到端 —— 方案 v0.1(2026-09-20, J2)

> **Status**: CURRENT — 方案稿, 待 Bettor 审 / NWT 取证; 未执行。基线 = 主线 `e9e8317c`(A+D+B 全在)。
> 范围: 隔离 simnet, 不碰主网 live; adapter 仅 simnet 开; 不引入生产代码改动(全部靠环境 + 一个 harness 脚本 + 一个 fetch 预加载)。

## 0. 先说会卡死这轮的一个风险(须第一步探针, 通不过后面全部无效)

**批 D 的 pmt 校验要求 `isSynced === true`**(`createPmtValidator`: `isSynced !== true ⇒ not_synced`)——adapter 的 `readPmt`、受理门、宽限窗、promote 全走这条。而 9-4 的干净轮次在批 D 之前, close_commit 的 pmt 闸读的是 `getBlockDagInfo.pastMedianTime`(不看 isSynced), **9-4 没有验证过 simnet 上 `isSynced` 能不能为 true**。
按我们记忆里对 kaspad 的实核(`isSynced` = has_peers ∧ sink 时间戳落后 < 661s), **单节点隔离 simnet 没有 peer ⇒ `isSynced` 很可能恒 false ⇒ pmt 恒无效 ⇒ adapter 只能写异议 / ABSTAIN、批准票永远延后、promote 永远 wait、过 cutoff 后一律冻结**——happy 臂根本走不通。
- **探针 P0**(只读, 5 分钟): simnet 起好后, 经 relay 发 `get_past_median_time`(或 console 里调 `readValidatedPmt`), 看回包 `isSynced`。
- **P0 = false 的解法(环境, 不改生产代码)**: 给 simnet 节点接第二个 simnet kaspad 作 peer(`--connect`; 该 peer 不必挖矿, 只要连着 ⇒ has_peers), 再复测。若仍 false ⇒ 停下报 Bettor(说明 simnet 上需要别的手段, 不能靠改生产判据绕过——那会让 e2e 不再验真实闸)。
- 这一条我**没有实测**(我这边没有跑着的 simnet), 是按已有实核推的风险, 不是结论。

## 1. verdict 怎么产 —— 真 derive 代码 + 受控上游(推荐), 不 mock derive

Bettor 建议"受控/mock verdict 源"。我建议再往下一层: **不注入 derive 函数, 而是让真的 `deriveKanetNativeVote` / `derivePolymarketVote` 跑在受控的上游响应上**——这样贴标(B1)、暂态 / 实质分类(B2)、极性(B3)、evidence_ref 全部走真代码路径, 比注入 derive 覆盖面大。
- 做法: 给 **simnet console 进程**加一个 Node 预加载(`NODE_OPTIONS=--import=<abs>/e2e-upstream-mock.mjs`, 放 `scratch/`, 不入生产树)。预加载只拦 `fetch` 到两个 host: `site.api.espn.com`(ESPN summary)与 `gamma-api.polymarket.com`; 其余 fetch 原样放行。响应从**场景文件**(JSON, 每次 fetch 现读, 可热切换)取, 键 = ESPN event id / Polymarket condition id。
- 响应形状直接沿用 `lib/proto-oracle-verdict.test.mjs` 里已对真 derive 跑通的夹具(ESPN: `header.competitions[0].status.type{completed,state}` + competitors; gamma: `[{outcomePrices, closed, closedTime}]`, UMA 定稿窗默认 48h ⇒ 场景里 `closedTime` 设为 49h 前)。
- 可复现性: 场景文件入证据目录; 预加载对每次拦截打一行日志(host / key / 场景版本), NWT 可逐条对回 verdict 行的 evidence_ref(哈希 = 场景原文)。
- 不跑真外部 ESPN / Polymarket: 真赛果 / 真 UMA 定稿不可控且慢(48h 窗)。这是**诚实边界**: 本轮不证明真外部源的格式漂移(那靠 derive 既有测试 + 主网前另议)。

## 2. 市场怎么建(一个必须说清的折中)

创建路由强制 `deadline ≥ outcomeEnd + UMA 窗(≥24h, 默认 48h) + 宽限 + 余量 + 2×tick` ⇒ 经 HTTP 建的判定题 deadline 至少 ~50h 之后, simnet 上等不起。所以:
- **结算臂(H / D / A / T / F / L / P)用 harness 脚本建**: 脚本调**同一批库函数**——`validateJudgedMarketInput`(用一个足够远的 deadline 让它过, 以便真跑白名单 / 谓词 / side_map 校验并拿到规范化列)→ 再用**真实的短 deadline** 走 `computeMarketGenesisArtifacts` + `ensureMarketPending`(judged 列同一条 INSERT)。等于路由去掉"deadline 预算"这一条。需要与 console 相同的 `CONSOLE_ENCRYPTION_KEY`(只按变量名从 simnet env 载入, 不打印值)。写库先例: 9-4 的受控 SQL。
- **哨兵臂(S)走真 HTTP 路由**: 一个 deadline ≥ ~50h 的判定题, 走 `POST /api/proto-markets/create`(验创建路由 + GET `judged` 块 + 下注 `side_label` 400/放行), 下两注让它 seal 后**停在"未到期 sealed"**——它同时是 M2 的活体证据(未到期市场不占 adapter 名额、不被扫)。
- 时间口径: simnet 无 PoW、块时间戳 = 挖块时墙钟, pmt = 最近 ~2630 块中位 ⇒ **pmt 落后墙钟 ≈ 1315 × 块间隔**。矿工须持续 ≥4 块/s(9-4 用 200ms/块)⇒ 落后 ≈ 4.4min < `LAG_MAX`(默认 10min)。**矿工停顿 > LAG_MAX ⇒ pmt 无效**(P 臂特意利用)。

## 3. 环境要求(给 KANet-UI, 全 simnet 局部, 不动主网)

| 项 | 值 | 为什么 |
|---|---|---|
| Tree | 主线 `e9e8317c` | 含 A+D+B |
| `KASPA_NETWORK` | `simnet` | judgedMarketAllowedHere 非主网放行; 白名单放行测试 token 对 simnet 无影响(白名单只在主网生效), 设不设都行 |
| `PROTO_DRIVER_ENABLED=1` / `PROTO_RELAY_ID` | simnet relay(4×0.99 KAS 干净 UTXO 先例) | 批 9 结算链 |
| `PROTO_ORACLE_ADAPTER_ENABLED=1` | 仅 simnet | Owner 只许 simnet 翻 |
| `PROTO_ORACLE_ADAPTER_INTERVAL_MS` | `30000`(下限) | 缩短等待 |
| `PROTO_GRACE_MS` / `PROTO_GRACE_MIN_MS` | `120000` / `60000` | 宽限窗 2min(默认 30min 太慢); ⚠ `GRACE_MIN > GRACE` 会被 resolveBudgetConfig 双双回默认, 顺序别反 |
| `PROTO_PROMOTION_SAFETY_MS` | `3600000`(上限 60min) | cutoff = deadline+2h−60min = **deadline+60min**, 让晚 seal 臂可在 ~70min 内做完; N2 要求 ≥ LAG_MAX+margin+tick, 3600000 满足 |
| `PROTO_PMT_LAG_MAX_MS` | 默认 600000 | 与矿工节奏配套 |
| 预加载 | `NODE_OPTIONS=--import=<abs>/e2e-upstream-mock.mjs` | §1 |
| 矿工 | 持续 ≥4 块/s, 可暂停 / 恢复(P 臂) | §2 |
| 探针 P0 | 见 §0 | 前置 |

## 4. 各臂设计(全部并行创建于 t0, 各自独立市场 + 独立场景键; 除 L 臂外 ~35–40min 完成)

约定: `oe` = outcome_end, `D` = deadline, `cutoff = D + 60min`(见上)。ESPN 事件用固定 id, 场景文件切 `final` / `in-progress` / 缺字段。

**H 臂 · happy(全链)**: `oe = t0+12min`, `D = t0+22min`; t0+2~5min 两注(side 各一, 覆盖 R5) ⇒ **seal 由"已确认注数 == seal_count"触发(不等 deadline)**, 于 ~t0+6min landed。场景: ESPN final(谓词判 YES)+ gamma 反极性/同极性(按 spec 的 `polymarket_outcome_side`)一致。预期: wall≥oe 后被扫; **pmt ≥ oe(≈t0+16.5min)才写批准票**(M1)⇒ 两条 verdict(extractor + uma, `pmt_at ≥ oe`)⇒ 宽限 2min ⇒ **promote**(`winning_side_source='extractor'`, `winning_side_verdict_id` 指 extractor 行, `set_at` 有值)⇒ close_commit 等 `pmt > D+30s`(≈t0+27min wall)⇒ convert_to_claim ⇒ claim_draw。终态 `resolved` + `proto_claims` 一行, 与 9-4 同构。
**D 臂 · 异议**: ESPN YES, gamma 给相反 ⇒ 两票冲突 ⇒ 都写(异议)⇒ 门冻结 `inconsistent_verdicts`。预期: `winning_side` NULL; `settlement_frozen_at` 非空; **close_commit 意图行始终为 0**(跨过 `pmt > D+30s` 之后再观察 ≥ 5 个 driver tick); 市场停 `sealed`。
**A 臂 · 实质 ABSTAIN**: ESPN final 但缺 predicate 所需字段(⇒ `judgeline-no-fields`)⇒ extractor NULL 行 ⇒ 冻结 `abstain_or_dispute`。
**T 臂 · 暂态重试(对照)**: ESPN 先 `in-progress`(`known-source-not-final`, 暂态)⇒ **不写任何 verdict 行**(每 tick 重试, 日志可见); 之后热切成 final ⇒ 与 H 同路径 promote。验 B2 暂态不冻结 + 热切换。
**F 臂 · promote 后冻结(验 D1 三入口, 唯一能活体覆盖入口③的臂)**: 走到 promote 成功、`winning_side` 已写, 但**在 pmt 越过 `D+30s` 之前**由 harness 调 `freezeMarket`(应急停, 批 D 设计保留的出口)⇒ 之后 `pmt > D+30s` 时 close_commit **仍不得提交**: ①`listWork` 不选行 ②`dependenciesLanded` 重读拒 ③(若有 prepared 意图)核心广播前闸 fail-closed。预期 close_commit 意图始终 0。
**L 臂 · 晚 seal**: `D = t0+10min`, `cutoff = t0+70min`, **`oe = cutoff + 10min`**(harness 专用的非典型排布, 只为让"第二注在 cutoff 附近仍被受理"); 第一注早下, **第二注在 relay 校验后的 pmt 首次 ≥ cutoff−5min 时下** ⇒ seal 约 2–3min 后 landed, 此时 `cutoff − pmt − margin(2min) < graceMin(1min)` ⇒ `applyLateSealGuard` 冻结 `late_seal`(seal landed 记账不被阻塞)。预期: `frozen_reason` 含 `late_seal`; verdict 行 0(冻结后不再是候选); `winning_side` NULL。约 t0+75min 出结果。⚠ 时机敏感——harness 以**实时读到的 pmt** 决定下第二注, 不按墙钟算。
**P 臂 · pmt 失效期(验 B4 的活体)**: 在 D 臂 / A 臂的 verdict 产生窗口内**暂停矿工 > LAG_MAX**(pmt 无效)⇒ 预期: **异议 / ABSTAIN 仍写**(`pmt_at = NULL`), 批准票不写; 恢复挖矿、pmt 重新有效后同一批行让门冻结, 不重 derive。可复用 D / A 臂各拆一个副本做, 不额外占时间。
**S 臂 · 哨兵**: 见 §2。断言: HTTP 创建 200/202 路径 + 落库 judged 列; GET 列表 / 详情带 `judged{side_map, outcome_end_ms, …}` 且无内部列; 下注缺 `side_label` ⇒ 400 / 不一致 ⇒ 400 / 一致 ⇒ 进 pmt 门; `outcomeOracleRelayIds` / 蛇形键 ⇒ 400; 该市场在 adapter 日志里**从不被扫**(未到期)。

## 5. 每臂验收判据(取证口径; NWT 可逐条核)

统一取证件(仿 9-4): `actions.jsonl`(harness 的每个动作 + 前后读数)、console 日志中 `proto-oracle-adapter` / `proto-settlement-driver` / `proto-driver` 行、预加载拦截日志、DB 只读导出(每市场: `proto_markets` 审计列 + `proto_market_verdicts` 全行 + `proto_settlement_intents` + `proto_claims`)、矿工日志(块率 / 停顿区间)。
- **H**: verdict 两行(kind / outcome / `pmt_at ≥ oe` / evidence_ref 与场景原文哈希吻合)、`winning_side*` 四列、四笔链上 txid(seal / close_commit / convert / claim)+ landed 意图、终态 resolved。
- **D / A / T-前半 / L / P**: 冻结列 + `frozen_reason`(reason + `clock=pmt|wall`)、`winning_side` NULL、close_commit 意图 0、市场状态。
- **F**: `winning_side` 已写 ∧ 冻结列非空 ∧ 越过 `D+30s` 后 close_commit 意图仍 0(附 ≥5 tick 日志)。
- **全局**: error 级事件 0(除臂设计内的预期 LOUD)、无 verdict 行 `pmt_at` 早于对应 `oe` 的批准票(SQL 断言)、无重复 `(market, source_kind, evidence_ref)`。

## 6. 诚实边界 / 不证明什么

- **refund 终局验不到**: 冻结 ⇒ 唯一出口 refund_flip(deadline+2h 之后任何人可翻), 但 **refund 执行未接线(N5b)**, 且 simnet 上等 D+2h 也不划算; 本轮**止于"冻结 + 停在待 refund_flip"**, 不期待自动退款完成。
- **N5b 主网谓词**(主网 + 非白名单 ⇒ 拒)在 simnet 上**无法活体验证**(simnet 一律放行); 由单测 + 三处源码钉 + 创建/受理路由测试覆盖。
- **B7 竞态**("gate 判 promote 后、写值前插入异议")**无法在活体里稳定制造**; 由 A15/A16 单测(含 Proxy 注入)覆盖。
- verdict 上游是受控响应(真 derive 代码): 不证明真 ESPN / Polymarket 的格式漂移、可用性、UMA 真定稿。
- 单 relay、单委员公钥、simnet 无 PoW / 无对手方: 不证明主网共识行为(同 9-4 的边界); 结算臂用 harness 建市场(绕过创建路由的"deadline 预算"一条, 该条由 spec / 路由测试覆盖)。
- 一次性结论: 一轮干净跑通 ≠ 回归保护(本仓无 CI)。

## 7. 顺序与工作量(我这侧)

1. 我: 写 harness(建市场 / 下注 / 读 pmt / 应急冻结 / 导出)+ 预加载 + 场景文件 + 验收断言脚本, 先在**本地临时库**(注入 pmt)自测一遍 harness 逻辑(不占 simnet), ~0.5 天。
2. KANet-UI: 切 tree + env + 矿工 + 预加载(§3)+ 跑 **P0 探针**。P0 不过就地停, 报 Bettor。
3. 我: P0 通过后并行建 H / D / A / T / F / P / S(t0), L 臂同时起(它最长); 按 §4 时间线执行并盯; 全部落 `docs/provenance/2026-09-2x-j2-oracle-simnet-e2e/`。
4. NWT 按 §5 取证。整轮 wall ≈ 40min(除 L)+ L 臂 ~75min, 并行; 含重来预算约 1 个半天。

## 8. 需要 Bettor 拍板 / 确认的点

1. **接受"真 derive + 受控上游(fetch 预加载)"而非注入 derive**(§1)? 预加载只在 simnet console 进程、放 scratch、不入生产树。
2. **结算臂用 harness 建、只有 S 臂走真路由**(§2)可以吗? 备选: 给创建路由加 simnet 专用的预算旁路 —— 我**不建议**(削弱被测闸)。
3. **P0 探针放第一步**, 且不通过时**不**靠改生产 `isSynced` 判据绕过(改为加 peer)——同意?
4. L 臂的 `oe > cutoff` 非典型排布只用于 harness(生产创建路由不会产生), 接受?
5. `PROTO_PROMOTION_SAFETY_MS=3600000` 只设在 simnet console, 与主网默认(20min)不同——接受?

## 9. 本地演练结果(2026-09-20, J2; Bettor 许可先做本地、不占 simnet)

harness / 预加载 / 演练脚本存档于 `docs/provenance/2026-09-20-j2-oracle-simnet-e2e-harness/`(`upstream-mock.mjs` / `harness-lib.mjs` / `rehearse-local.mjs` / `rehearsal-run.txt`)。演练 = 临时库 + **真 derive 代码跑在预加载的受控上游上** + 模拟时钟 / pmt(落后 4.4min)+ 真 `createJudgedMarket`(真校验 + 真 genesis artifacts + `ensureMarketPending`);链上 bet / seal / close_commit / convert / claim 的真广播**不在演练里**(那是 simnet 才有的部分)。
**10 项全过**: X0 建 8 个市场 / E1 未到期不被扫且不 fetch / E2 pmt<oe 批准票延后·异议 ABSTAIN 照写(M1+B4)/ E3 P 臂 pmt 无效仍写 NULL pmt_at / E4 pmt≥oe 写批准票进宽限 + D·A·P 冻结 / E5 T 臂热切 / E6 宽限后 promote(审计列齐)/ E7 F 臂 D1 入口①② / E8 L 臂晚 seal 冻结 / E9 全局不变量(evidence_ref 哈希 = sha256(场景原文),可独立复算)。
**演练暴露、已折进方案的三点**:
1. **创建校验只允许"半线"的 margin/total 谓词**(整数线 push 会 stranded, 护栏 6)——A 臂的 ABSTAIN 谓词须用 `operand:55, scale:1`(=5.5), 整数线在创建时就被拒。这也说明 harness 走的确实是真校验。
2. **T 臂的 uma 侧独立成票**: ESPN 还在 in-progress 时, extractor 侧暂态无行, 但 uma 侧一旦成票就单独写入(两路互不牵连); 热切 final 后 extractor 才写, **宽限窗从"第二源写入时刻 pT"起算**(不是从 uma 那条起算)。取证判据据此: T 臂的 promote 时刻 = pT + 宽限窗。
3. **演练脚本自身一个坑**: 父 / 子进程各按各的 pid 算场景文件路径 ⇒ 预加载读不到 ⇒ 上游全 503 ⇒ 全暂态(此时 adapter 表现正确: scanned>0、verdict 0、无 error、无冻结——暂态不冻结)。真 simnet 上场景文件路径须由 KANet-UI 固定(env `E2E_SCENARIO_FILE` 绝对路径), 别按 pid 算。
**仍未验(只有 simnet 能验)**: `isSynced`(P0)、真 relay pmt 读取、真矿工节奏下的 pmt 落后 / 停顿、bet 受理门的活体、seal 的"注数==seal_count"真触发、close_commit / convert / claim 真广播、console 里 adapter service 的真 interval / 单飞。

## 10. 复用核查(D-031「不轻易新造轮子」, 2026-09-20 补记)

新造的只有 `upstream-mock.mjs`(进程级、按 host 拦截、场景文件可热切换的受控上游)。动手前查过仓库,**没有能直接复用的现成物**:
- `kasia-console/scripts/gateE-*.mjs`、`gateC-*.mjs`、`_bettor-*.mjs` 引用 ESPN / gamma 的都是**直连真网**(如 `gateE-wire-test.mjs` 直接 fetch 真 ESPN)或做离线准确率评测, 不是可控上游。
- `scripts/j1-trackb-frozen-evidence-test.mjs` / `bshard-close-enforce.mjs` 用的是**注入 `fetchImpl` + 单文件 ESPN fixture**——参数注入式, 进不了一个已在跑的 console 进程。
- 单测里的 fetch 桩(含我自己的 `proto-oracle-verdict.test.mjs`)是每个测试文件各自的 `globalThis.fetch` 替换, 没有热切换 / 场景文件 / 拦截日志。
- `test-framework/`(lib / personas / cases / fixtures)面向 broker / seeker / agent 的业务级测试, 没有 proto 判定题 / 上游预言机的替身。
其余全部复用现有: `validateJudgedMarketInput` / `computeMarketGenesisArtifacts` / `ensureMarketPending` / `createSettlementStore` / `runOracleAdapterTick`(含真 `deriveKanetNativeVote` / `derivePolymarketVote`)。**真 simnet 那一步: 矿工、simnet 节点 / relay 起停、`actions.jsonl` 取证格式, 复用 9-4(`2026-09-20-j2-batch9-94-simnet-clean-round`)与 KANet-UI 既有 simnet 工具, 不另造。**
