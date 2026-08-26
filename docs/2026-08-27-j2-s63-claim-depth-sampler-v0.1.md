# §6-3 gate (d) · §5① claim-shape 深度采样器 · 方法稿 v0.4（(d) 残余清单第 1 项 = 部署硬前置 · 入库 + 确定性向量 · 只读 · 同步后跑）

> **v0.4（Codex 5d23a4be 真 bug MUST-FIX）**：🔴 v0.3 的 Leg A 用 `Date.parse(sender_ts)`；而 `pool_bettor_sides.refund_attempted_at` 由生产码写 SQLite `CURRENT_TIMESTAMP`（`pool.js:531` / `bettor-refund-claim-auto.mjs:146`）= `YYYY-MM-DD HH:MM:SS` **UTC 文本**，JS `Date.parse` 把它当**本地时**——本机 UTC+7 ⇒ **偏 −25,200 s（复现值）**，比 Codex 说的 NaN 更糟：**符号错的负数会静默混进 `N_claim`**；同列还实存**整数秒**（`1783785324`），metadata 里是 ISO Z。本版：① canonical `parseTs`——SQLite 文本按 UTC（`Date.UTC`，依据 SQLite `CURRENT_TIMESTAMP` 定义 + 写点全 UTC）/ ISO 带时区按其时区、不带按 UTC / 整数 ≥1e12 毫秒、1e9..1e12 秒（按量级，显式规则）/ 其它量级、null、畸形 ⇒ **inconclusive 不进 n**，每样本记 `submit_fmt`；② `legAFrom` 只有 **finite 且非负** 才 final-eligible，否则 `state=inconclusive_ts` 剔除并 surfaced（`legA_inconclusive_ts{n, reasons}` 单列）；③ 向量加 9 条真实格式（本机 DB 只读抽样：`'2026-07-09 06:05:28'`、`1783785324`、`'2026-06-01T04:12:37.538Z'` + ISO 偏移/裸 ISO/int ms/歧义整数/畸形/null）+ 3 条 Leg A（真实 SQLite 文本 +5 s ⇒ 5.0 / 畸形 ⇒ inconclusive_ts / 负值 ⇒ inconclusive_ts）+ 1 条 summarize 含 inconclusive_ts；28/28。④ 注：**历史 p100 是样本内观测，非未来最坏；最终 T5 界仍要真 harness `submit_ts`**（上链跑手 `recordSubmission.t`）。`schema_version = claim-depth/4`。

> **v0.3（Codex 6fd55a53 三 MUST-FIX + Bettor (27) v0.3 派工）**：① 反核**三态**：`verified / excluded / inconclusive`，inconclusive（缺块·getBlock 错·畸形·未载 tx）**单列 surfaced 不静默计**（Codex MUST-FIX 1 原句 *"excluded and surfaced as inconclusive, never silently counted"*）；② 官方跑输出加 `schema_version=claim-depth/3`、`target_commit`、`rpc{live_binary_commit 7b1e18cc, semantics}`、`cli_args`、**原始样本行全量**（可重算分位）、文件 sha256（MUST-FIX 2）；③ **Leg A 真提交时刻三级来源**：`SENDER_TS`（发送方进程自记：`refund_attempted_at` / `metadata.refund_dispatched_at` / `zk_settle_evidence.settled_at`）唯一可入最终界；`MEMPOOL_SEEN`（live 本机 mempool 1 s 轮询首见，read-only 无需改码）与 `PROXY_POLL`（DB 30 s）只作 observational（MUST-FIX 3）。**真提交时刻来源盘点**：claim 无提交时刻列；relay 7 个 `submitTransaction` 站点（`p2sh.mjs:295…1186`）提交后不打 txid⋈时刻日志 ⇒ **hook 设计（不改码，Owner 批）**：各站点返回后加一行 `[submit] txid ts daa site` 结构化日志，采样器 live 改读之作 `SENDER_TS`；最终 T5 界用 harness 自带的 `submit_ts`（上链跑手 `recordSubmission.t`）。另：`N_claim = 实测运行包络 + 具名 S_unalloc`，p100 非未来最坏上界；R-SHARD-BLIND 修：refund `SENDER_TS` 同时按 `market_id` 与 `shard_market_id` 查。向量 15/15。

> **v0.2（NWT GREEN-WITH-NOTES + Bettor）**：🔴 **反核 MUST**：`kaspa_tx_log` 命中的包含块须 `getBlock(includeTransactions)` 确认 `txid ∈ block.transactions` 才用该块 `daaScore` 作 Leg B 起点（tx_log hit 非 canonical 证明，可能陈旧/被 reorg 出；喂 `N_claim` 的安全数验不猜）；反核失败 ⇒ 剔除并计数，不算样本。Leg A 标"轻代理（PoolSide 450 B）低估向，归 `S_unalloc`"；`S_unalloc` 两腿之和 `σ_A + σ_B ≥ √(σ_A²+σ_B²)` = 保守过估（配对样本不可得故取和），非危险双计；坐标精确：`checkUtxoLanded` 函数体 `kasia-relay/src/lib/p2sh.mjs:1484`（`:1474` 是其上注释），`REORG_SAFE_MIN_DEPTH = 20` 在 `kasia-console/src/lib/pool-shard-register.mjs:88`。**脚本入库** `docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.mjs`（纯函数拆出）+ 离线确定性测试（`claim-depth-sampler.test.mjs` + `vectors.json` 12 条 + `expected-output.json` + `MANIFEST.sha256`）：tx_log 命中错块 ⇒ 剔除、n<30 ⇒ 退出码 5、40 笔但 20 反核失败仍 INSUFFICIENT、DAA 跳增与低产两列分开。scratch 版 SUPERSEDED。
> **Status**: METHOD v0.2 · J2 2026-08-27 · Bettor 派工 (27) · 脚本 `docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.mjs`（`node --check` 过；dry-run 只读实证见 §6）· 正式输出落 `docs/provenance/2026-08-27-claim-depth/`（JSON + sha256）· 已加进 (17) 同步后清单 **③e**（与 ③a–③d 并行只读，错峰规则同 ③d）。
> **一句话**：对**代理** claim-shape tx（现网 pool covenant 花费）逐笔量两腿——**Leg A** submit→inclusion、**Leg B** inclusion→depth-20 蓝确认——每腿 **DAA 推进与墙钟两列**（Codex D-2 纪律）；≥30 样本才出 p50/p90/p100/σ，否则 `INSUFFICIENT_SAMPLES` fail-closed；统计直接喂 (d) 稿 `N_claim` 与 `S_unalloc = max(p100 − p50, 3σ)`。
> 🔴 **代理 ≠ 同形**：v0.15 T5（花 `O` + `O_AUTHORIZED`，`checkSigFromStack` + introspection 焊接）现网**不存在**；本稿只近似"一笔 2 输入 covenant 花费从提交到深度 20 要多久"的**确认深度行为**，差异见 §1，结论里必须带这个前缀。

---

## §1 样本源：代理与 T5 的差异（明标）
| 代理（现网有）| 来源（DB 只读）| 现网可用量（2026-08-27 读数）| 输入数 | 脚本 | 与 T5 的差异 |
|---|---|---|---|---|---|
| PoolSide claim | `pool_bettor_sides.claim_txid` ⋈ `kaspa_tx_log` | **2,151** | ≥2（`PoolSide.sil:37 require(tx.inputs.length >= 2)`：spine + side）| `side_redeem_script_hex`（dry-run 样本 450 B）| 同为 2 covenant 输入；opcode 集不同（无 checkSigFromStack/四路焊）；mass 未必同量级 |
| Pool settle | `pool_markets.settle_txid` ⋈ tx_log | **266** | 多输入聚合 | PoolSpine/PayoutShard | 输入更多、mass 更大 ⇒ 落链行为偏保守向 |
| Pool refund | `pool_markets.refund_txid` ⋈ tx_log（`refund_attempted_at` = 提交时刻）| **1,250**（有提交时刻）| 1–2 | RefundClaim 等 | 唯一带**历史提交时刻**的代理 ⇒ Leg A 历史样本只来自它 |
| ShardLeaf 续链 | `market_shards.current_leaf_outpoint` ⋈ tx_log | **1,341** | 2（leaf + spine）| `shard_redeem_hex` | 续链 + 覆盖 introspection，最接近 T5 的"covenant 出 covenant" |
**T5 本体**（v0.15 §4-c/§4-e）：输入 = `O` + `O_AUTHORIZED`（+ 可选费输入，(b) 下），输出 = payout（值焊死）+ 可选找零；脚本含 `OpCheckSigFromStack` + `OpInputCovenantId` + `OpTxOutputSpkSubstr` + `OpCovOutputCount`；mass 待 P3 真形状。**代理给的是"链的确认深度物理"，不是 T5 的 mass/脚本执行时间；后者由 (d) §5① 的 ≥30 笔真 claim-shape 对抗阈值测试补，本采样器不替代它，只先把 Leg B 的分布量出来。**

## §2 量法（两腿两列）
| 腿 | 起点 | 终点 | DAA 列 | 墙钟列 | 样本来源 |
|---|---|---|---|---|---|
| **Leg A** submit→inclusion | 提交时刻 | 包含块 | `blockDaaScore(inclusion) − virtualDaaScore(submit)`（**仅 live 模式有**：提交时刻的 DAA 历史无记录）| `block.timestamp − submit_ts` | hist：`refund_attempted_at` 样本（墙钟列）；live：DB 首次出现时刻（30 s 轮询粒度，非 mempool 首见——如实标）|
| **Leg B** inclusion→depth-D | 包含块 | 首个 `header.daaScore ≥ inclusion.daaScore + D` 的块 | `reach.daaScore − inclusion.daaScore`（≥ D，多出部分 = DAA 跳增）| `reach.timestamp − inclusion.timestamp` | 全部代理 |
- `D = 20` = `REORG_SAFE_MIN_DEPTH`（`kasia-console/src/lib/pool-shard-register.mjs:88`），与 `checkUtxoLanded` 的 `virtualDaaScore − blockDaaScore ≥ minDepth`（函数体 `kasia-relay/src/lib/p2sh.mjs:1484`；`:1474` 是其上方注释"默认 20"）同判据。
- 🔴 **反核（v0.2）**：包含块先 `getBlock(includeTransactions:true)`，`verifyInclusion(block, txid)` 确认 `txid ∈ block.transactions`（取 `verboseData.transactionId`）；不在 ⇒ `verified.ok=false` 剔除并入 `verified_excluded{n, reasons}`；只有反核过的块的 `daaScore` 才作 Leg B 起点。
- 到达块由 `getBlocks(lowHash = inclusion)` 前向翻页找首个达标块（≤50 页）；找不到 ⇒ 该样本 `legB.ok=false`，不计入 n。
- **`S_unalloc` 喂法**：两腿各自 `S_unalloc_rule = max(p100 − p50, 3σ)` 后**取和**——`σ_A + σ_B ≥ √(σ_A² + σ_B²)`，配对样本不可得（同一笔的 A、B 不能都量到）故取和 = 保守过估，不是危险双计；Leg A 轻代理偏短 = 低估向（小），其欠估也归此和。
- **"蓝确认"口径**：depth 按 DAA 计（DAA 计入 mergeset 蓝+红），不另判该 tx 所在块是否蓝——与 live 结算路的 `checkUtxoLanded` 完全一致，故喂 `N_claim` 时口径同源。

## §3 输出与 fail-closed
- JSON：`mode / daa / depth / by_kind / proxy_redeem_len_bytes / legB_inclusion_to_depth{n, daa{p50,p90,p100,mean,sd,S_unalloc_rule}, wall_s{…}} / legA_submit_to_inclusion{n, wall_s, daa} / samples[]`；正式写 `docs/provenance/2026-08-27-claim-depth/claim-depth-<UTC>.json` 并打印 sha256。
- **`INSUFFICIENT_SAMPLES`**：Leg B `n < 30` ⇒ 退出码 5，**不出统计**、不落 provenance。
- `S_unalloc_rule = max(p100 − p50, 3σ)`（(d) 稿 3-C v0.5 规则）随每个分布一起输出；**直接喂 `N_claim`（Leg A+B 之和的 DAA 列）与 `S_unalloc`**——但代理前缀必须带上（§1）。
- SYNC-GATE 同 (21)；`--dry-run N` 绕闸只看形状。

## §4 运行模式
- `--mode hist`（默认）：历史代理，Leg B 全量、Leg A 只有 refund 的墙钟列；`--limit` 每类上限（默认 200）。
- `--mode live --live-minutes M`：轮询 DB 新出现的 claim/settle/refund txid，首次出现时记 `virtualDaaScore`（Leg A 的 DAA 列由此而来），进 `kaspa_tx_log` 后量 Leg B；30 min 未落链的留 `live_pending`。**live 的"提交时刻"精度 = 30 s 轮询**，比 mempool 首见晚，Leg A 偏短 ⇒ 喂 `N_claim` 前加 30 s × 实际出块率的修正并标。
- 错峰同 ③d：③b 立稳 ≥10 min 后跑，`--sleep-ms 20`；hist 每样本 ≥2 次 RPC（getBlock + getBlocks 翻页），`--limit 200` × 4 类 ≈ 800 样本 ≈ 2,000+ 次调用，先 `--limit 50`。

## §5 读数规则（预注册）
- 喂 (d) 的是 **Leg B 的 DAA p100**（+ Leg A 的 DAA p100，live 有则加）作 `N_claim` 的实测下界；`S_unalloc` 取两腿 `S_unalloc_rule` 之和。
- 结论句式固定："**代理 claim-shape**（现网 pool covenant 花费，非 T5 同形）下，inclusion→depth-20 的 DAA 推进 p50/p90/p100 = …"；不许省略前缀。
- 任一腿 n<30 ⇒ 该腿不出数；Leg A 历史只有墙钟列 ⇒ 不喂 DAA。

## §6 dry-run 实况（2026-08-27，节点 IBD，只读）
`--dry-run 3`：DB 侧取到 3 笔 `pool_side_claim`（redeem 450 B）；Leg B 全部 `ok=false`（IBD 节点 `getBlock` 无该块）——符合预期，只证 DB 取样 + JSON 形状；无任何统计。

## §7 未覆盖
- 代理不是 T5（§1）；T5 的 mass/脚本执行时间要 P3 真形状后用 (d) §5① 的对抗阈值测试补。
- Leg A 历史无 DAA 列；live 的提交时刻是 DB 首次出现（30 s 粒度），不是 mempool 首见。
- `kaspa_tx_log` 覆盖非 100%（claim 2151/2153、settle 266/270、refund 1250/1512 命中），缺的样本不计，不外推。
