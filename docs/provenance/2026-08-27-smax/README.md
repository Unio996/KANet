# provenance · `s_visible_max` 提取（(23) 算力地板规格 §3.5 · (24) v0.4 入库版）

> 🔴 **语义（Codex f65c1fbe）**：本器输出 **`s_visible_max`** = 窗内**可见**最大单 coinbase-script 出块份额 = 对手份额的**下界**（Sybil/共谋令其偏小）。它**不是**无假设的对手上界；(23) 规格须另有**独立论证的 `s_adv_cap ≥ s_visible_max`**，无可信 cap ⇒ fail-closed。本器不产 `s_adv`。

## 文件
| 文件 | 作用 |
|---|---|
| `smax-extractor.mjs` | 提取器（纯函数 `parseCoinbasePayload / serializeCoinbasePayload / aggregate / completeness / decide` + 链读 `main`）|
| `smax-extractor.test.mjs` | 离线确定性测试跑手（无节点、无 DB）：读 `vectors.json`，比对 `expected-output.json`，任一不等退出码 1 |
| `vectors.json` | 14 条向量：genesis payload 实取解析 / 短 payload / 截断 script / 单矿工 / 多身份 / **Sybil 分址（可见份额被压低）** / 输出地址法对照 / 完整性（daaScore 差、部分窗、低产不假触发、blueScore 回落、皆无）/ decide（INCOMPLETE_WINDOW exit 4、OK exit 0）|
| `expected-output.json` | 上述向量的期望输出（由跑手 `--write-expected` 生成，之后只比对不再生成）|
| `MANIFEST.sha256` | 四文件 sha256（`sha256sum -c MANIFEST.sha256` 复核）|
| `smax-<UTC>.json` | 正式输出（同步后跑，SYNC-GATE 过才写）|

## 运行
```bash
# 离线测试(任何机器)
node docs/provenance/2026-08-27-smax/smax-extractor.test.mjs            # 期望 14/14 PASS
# 正式(同步后; 自带 SYNC-GATE daa>80,095,687 ∧ isSynced; (17) 清单 ③d 错峰规则)
cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-smax/smax-extractor.mjs --window-s 600 --max-blocks 9000 --sleep-ms 20
# 退出码: 0 OK / 3 SYNC-GATE / 4 INCOMPLETE_WINDOW(fail-closed, 不出 s_visible_max)
# 复核
cd docs/provenance/2026-08-27-smax && sha256sum -c MANIFEST.sha256
```

## 坐标（全 `git show 7b1e18cc:<path>`，非工作树 90dbf074）
- payload 布局：`consensus/src/processes/coinbase.rs:158-163`（`serialize_coinbase_payload`），常量 `:13-19`（`MIN_PAYLOAD_LENGTH=19`），反序列化对照 `:191`；本块矿工身份在 payload `miner_data.script_public_key`（`:139`）。
- coinbase **输出**付给被 merge 的蓝块矿工（`:113`）、红块奖励付本块矿工（`:134`）⇒ 输出地址只作对照列。
- genesis 向量：`consensus/core/src/config/genesis.rs:149-165`（TESTNET12_GENESIS coinbase_payload，"kaspa-testnetTOCCATA"）。
- 完整性 `expected` = 窗两端块 `daaScore` 差（备选 `blueScore` 差），禁用自身 fetch 计数；`daaScore` 递增定义 `consensus/src/processes/difficulty.rs:33`。

## 方向
矿池合并 ⇒ `s_visible_max` 偏高（安全）；Sybil 分址 ⇒ 偏低（**危险，向量 V6 实证 0.5→0.3**）⇒ 正是 Codex 要 `s_adv_cap` 独立论证的原因；部分窗 ⇒ fail-closed；错向一律优先过计。

历史：2026-08-27 v0.1–v0.3 脚本在 `scratch/_j2_smax_coinbase.mjs`（gitignored，已 SUPERSEDED）；v0.4 入库 + 改名 `s_max → s_visible_max`。
