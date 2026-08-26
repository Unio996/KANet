# provenance · claim-shape 深度采样（(d) §5① 部署硬前置 · (27) v0.7 入库版 · Codex 6fd55a53 三 MUST-FIX + 5d23a4be 时间戳 MUST-FIX 落法）

> **v0.5（NWT residual：`settled_at` 多写者）**：`SENDER_TS_POLICY` 源 × 写点 × 格式 × tz——`refund_attempted_at`{SQLite 文本(UTC) / 整数 epoch / ISO 带 tz}、`refund_dispatched_at` 与 `settled_at`{只 ISO 带 tz，写点 toISOString：`bshard-auto-settler.mjs:983`、`bshard-settle-daemon.mjs:885/:697`}；不认的格式（尤其裸 ISO 无 tz）⇒ inconclusive 不猜时区。(27) 实际读的 `settled_at` = `metadata.zk_settle_evidence.settled_at` → 回落 `metadata.settle_evidence.settled_at`（本机 DB 146/270 行，全 ISO Z）；`kasia-console/src/api/kanet-broker.js:227/260/327` 是 read-side 投影（非写点，`r.updated_at` 不落表）、`kasia-console/src/api/trading.js:1909` 写 `trade_baselines`——(27) 都不读。向量 35/35（含真值 `'2026-06-30T06:49:47.469Z'`）。`schema_version = claim-depth/6`（v0.6 只改注释/措辞，向量不变）。

> **v0.4（Codex 5d23a4be）**：🔴 v0.3 `Date.parse(refund_attempted_at)` 把 SQLite `CURRENT_TIMESTAMP` UTC 文本当本地时（本机 UTC+7 ⇒ −25,200 s，负值会静默混进 `N_claim`）。本版 canonical **`parseTs`**：SQLite 文本 → `Date.UTC`；ISO 带时区按其时区、不带按 UTC；整数 ≥1e12 ms / 1e9..1e12 秒；其它 ⇒ inconclusive。`legAFrom` 只有 finite 且非负才 final-eligible，否则 `state=inconclusive_ts` 单列 surfaced（`legA_inconclusive_ts`）。向量 28 条（含本机 DB 只读抽的真实格式：`'2026-07-09 06:05:28'`、`1783785324`、`'2026-06-01T04:12:37.538Z'`）。`schema_version = claim-depth/4`。

🔴 读数一律带前缀"**代理 claim-shape**（现网 pool covenant 花费，非 v0.15 T5 同形）"。`N_claim = 实测运行包络 + 具名 S_unalloc`，p100 只是样本内经验下界，不是未来最坏上界（Codex）。

## Codex 6fd55a53 三 MUST-FIX → 本版
| MUST-FIX | 落法 |
|---|---|
| ① canonical 包含块反核 | `verifyInclusion` 三态：`verified`（txid ∈ `getBlock(includeTransactions)` 的块）/ `excluded`（块可判但 txid 不在 = tx_log 陈旧/被 reorg 出）/ **`inconclusive`**（缺块 / getBlock 错 / 畸形 / 未载 tx）——**单列 surfaced，不静默计**，两者都不进 n |
| ② 入库 + 官方跑可复算 | 源在本目录；输出 JSON 带 `schema_version=claim-depth/3`、`target_commit`（kanet-tn12 HEAD）、`rpc{url, network, live_binary_commit=7b1e18cc, semantics}`、`cli_args`、**`samples[]` 原始行全量**（可重算分位）、文件 sha256（stdout 打印）|
| ③ Leg A 真提交时刻 | 三级来源：**`SENDER_TS`**（发送方进程自记，可入最终界：`pool_bettor_sides.refund_attempted_at`、`pool_markets.metadata.refund_dispatched_at`、`metadata.zk_settle_evidence.settled_at`——后两者是提交返回后写，≈ 提交 + RPC 往返，偏晚秒级）> **`MEMPOOL_SEEN`**（live：本机 `getMempoolEntries` 1 s 轮询首见，observational）> **`PROXY_POLL`**（DB 30 s 轮询首见，observational）。`feed.N_claim_envelope_daa` **只用 SENDER_TS**；`legA_observational` 单列。**最终 T5 界须用 harness 发出时绑定 txid 的 `submit_ts`**（上链跑手 `checksigfromstack-e2e-onchain.mjs` 的 `recordSubmission` 已带 `t`）|

## 真提交时刻来源盘点（2026-08-27 只读实核）
- DB：`pool_bettor_sides.refund_attempted_at`（2,278 行非空）= refund 发起时刻 ✅；`pool_markets.metadata.refund_dispatched_at`（`bshard-auto-settler.mjs:983`）✅；`metadata.zk_settle_evidence.settled_at`（`bshard-settle-daemon.mjs:697`，提交返回后写）✅；**claim（`pool_bettor_sides.claim_txid`）无提交时刻列**；`tx_records`（188,059 行）与 pool claim/settle/refund 只命中 10 笔（它记的是 comm 路）；`execution_states.output_txid` 命中 0。
- 日志：kasia-relay 7 个 `rpc.submitTransaction` 站点（`p2sh.mjs:295/371/517/636/798/1053/1186`）**提交后不打 txid+时刻日志**，只 `return { txId }`；console `relay-manager.js` 也不记 ⇒ **没有 txid ⋈ 时刻的日志源**。
- ⇒ **hook 设计（只写不改码，须 Owner 批——relay 是钱路模块）**：在 `p2sh.mjs` 7 站点 `submitTransaction` 返回后各加一行结构化日志 `[submit] txid=<transactionId> ts=<ISO> daa=<virtualDaaScore> site=<fn>`（或集中到 `_assertTxInvariants` 同层的一个 `_logSubmit()`），零逻辑改动、零返回值改动；采样器 live 模式改读该日志行作 `SENDER_TS`。在此之前 live 只有 `MEMPOOL_SEEN`（1 s 粒度，read-only，无需改码）。

## 文件
| 文件 | 作用 |
|---|---|
| `claim-depth-sampler.mjs` | 采样器（纯函数 `verifyInclusion / legBFromBlocks / legAFrom / stats / summarize` + 链读/DB `main`）|
| `claim-depth-sampler.test.mjs` | 离线确定性测试（读 `vectors.json`，比对 `expected-output.json`，任一不等退出码 1）|
| `vectors.json` | **35 条**（v0.3 15 + v0.4 13 条 `parseTs`/Leg A 真实格式 + v0.5 7 条 `SENDER_TS_POLICY` 按源拒收/真值）：反核 verified / excluded / **inconclusive 三例（未载 tx·缺块·畸形）**；Leg B 平稳 / DAA 跳增 / 低产 / 不达；Leg A **SENDER_TS / MEMPOOL_SEEN / PROXY_POLL** 三级；summarize：29+5 excluded ⇒ exit 5 / 30 含两级 legA + 3 excluded + 2 inconclusive ⇒ OK 且 feed 只加 SENDER_TS / **40 笔 20 inconclusive ⇒ INSUFFICIENT 且 inconclusive 单列** |
| `expected-output.json` / `MANIFEST.sha256` | 期望输出 / 四文件 sha256 |
| `claim-depth-<UTC>.json` | 正式输出（同步后；SYNC-GATE 过且 Leg B n ≥ 30 才写；含原始样本行）|

## 运行
```bash
node docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.test.mjs      # 期望 35/35 PASS
cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.mjs --mode hist --limit 50 --sleep-ms 20   # (17) ③e, 错峰同 ③d
cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.mjs --mode live --live-minutes 60 --poll-ms 1000
# 退出码: 0 OK / 3 SYNC-GATE / 5 INSUFFICIENT_SAMPLES(fail-closed)
cd docs/provenance/2026-08-27-claim-depth && sha256sum -c MANIFEST.sha256
```

## 承重规则
- `S_unalloc` 两腿之和 `σ_A + σ_B ≥ √(σ_A² + σ_B²)`（配对不可得故取和 = 保守过估），**不与 (d) 的 reorg/观测/拥塞具名裕度重复计**。
- 坐标：`kasia-relay/src/lib/p2sh.mjs:1484 checkUtxoLanded`；`kasia-console/src/lib/pool-shard-register.mjs:88 REORG_SAFE_MIN_DEPTH`；`consensus/src/processes/difficulty.rs:33` @7b1e18cc。
- refund 的 `SENDER_TS` 子查询同时按 `market_id` 与 `market_shards.shard_market_id` 查 sides（R-SHARD-BLIND，bshard sides 按 shard 存）。

历史：v0.1 scratch（SUPERSEDED）；v0.2 `45f05a36` 入库 + 反核；v0.3 `3339a81b`；v0.4 `c6af2743`；v0.5 `f6bc2920`；v0.6 `8b2f17dc`；v0.7 本版（只对齐 README 条数文案）。
