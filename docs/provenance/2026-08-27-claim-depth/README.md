# provenance · claim-shape 深度采样（(d) §5① 部署硬前置 · (27) v0.2 入库版）

🔴 读数一律带前缀"**代理 claim-shape**（现网 pool covenant 花费，非 v0.15 T5 同形）"。Leg B（inclusion→depth-20）是纯确认深度物理、形状无关 ⇒ 对 `N_claim` 大头有效；Leg A（submit→inclusion）是轻代理（PoolSide 450 B）低估向（小），归 `S_unalloc`。

## 文件
| 文件 | 作用 |
|---|---|
| `claim-depth-sampler.mjs` | 采样器（纯函数 `verifyInclusion / legBFromBlocks / legAFrom / stats / summarize` + 链读/DB `main`）|
| `claim-depth-sampler.test.mjs` | 离线确定性测试跑手（无节点、无 DB）：读 `vectors.json`，比对 `expected-output.json`，任一不等退出码 1 |
| `vectors.json` | 12 条：反核 ok / **tx_log 命中错块 ⇒ 剔除** / 块未带 tx ⇒ 不猜；Leg B 平稳 / DAA 跳增 / 低产（同 DAA 不同墙钟）/ 翻页不达；Leg A hist（只墙钟）/ live（两列）；summarize：29+5 剔除 ⇒ `INSUFFICIENT_SAMPLES` exit 5 / 30+3 剔除 ⇒ OK exit 0 / **40 笔但 20 反核失败 ⇒ 仍 INSUFFICIENT** |
| `expected-output.json` | 期望输出（`--write-expected` 生成，之后只比对）|
| `MANIFEST.sha256` | 四文件 sha256 |
| `claim-depth-<UTC>.json` | 正式输出（同步后，SYNC-GATE 过且 Leg B n ≥ 30 才写）|

## 运行
```bash
node docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.test.mjs      # 期望 12/12 PASS
cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.mjs --mode hist --limit 50 --sleep-ms 20   # (17) ③e, 错峰同 ③d
# 退出码: 0 OK / 3 SYNC-GATE / 5 INSUFFICIENT_SAMPLES(fail-closed)
cd docs/provenance/2026-08-27-claim-depth && sha256sum -c MANIFEST.sha256
```

## 承重规则（v0.2，NWT）
- **反核**：`kaspa_tx_log` 命中的包含块须 `getBlock(includeTransactions)` 确认 `txid ∈ block.transactions` 才用其 `daaScore` 作 Leg B 起点（tx_log hit 非 canonical 证明，可能陈旧/被 reorg 出）；反核失败 ⇒ 剔除并计数（`verified_excluded`），不算样本。
- **`S_unalloc` 两腿之和**：`σ_A + σ_B ≥ √(σ_A² + σ_B²)`，配对样本不可得故取和 = 保守过估，非危险双计。
- **坐标**：depth 判据同 `kasia-relay/src/lib/p2sh.mjs:1484 checkUtxoLanded`（`virtualDaaScore − blockDaaScore ≥ minDepth`）；`D = 20 = kasia-console/src/lib/pool-shard-register.mjs:88 REORG_SAFE_MIN_DEPTH`；DAA 递增 `consensus/src/processes/difficulty.rs:33` @7b1e18cc。

历史：2026-08-27 v0.1 脚本在 `scratch/_j2_claim_depth_sampler.mjs`（gitignored，已 SUPERSEDED）。
