# provenance · `k_max` 绝对成本表工具（(21) v0.4 入库 durable 版）

用途：Owner/Codex 具名 `k_max` 的决策输入——现网 `H_net` → `H_adv_implied(k) = (k−1)×H_net` → 折成设备台数（CAPEX vs 头寸 VaR 判据见方法稿 `docs/2026-08-27-j2-s63-kmax-absolute-cost-v0.1.md` §5）。闭掉 (17) ③c "脚本未入库 ⇒ 输出不作证据"的缺口。

## 文件
| 文件 | 作用 |
|---|---|
| `kmax-cost.mjs` | 纯函数（`targetFromBits / compactTargetBits / workPerBlock / hNetFromBits / difficultyRatio / decideHNet / clampWindow / hAdvImplied / foldToDevices / costTable`）+ 链读 `main`（SYNC-GATE，输出 `kmax-<UTC>.json` + sha256）|
| `kmax-cost.test.mjs` | 离线确定性测试（读 `vectors.json`，比对 `expected-output.json`，任一不等退出码 1）|
| `vectors.json` | 15 条：**genesis bits 504155340** → target/work/H1/ratio + compact 往返；exp≤3 / exp=1 / 符号位 ⇒ 0 / 高难度量级；两法取 min（law1 / law2 / >2× 加注 / 法2 缺）；`MAX_SAFE_WINDOW_SIZE=10,000` 与 `MIN_WINDOW_SIZE=1000` 边界；`H_adv_implied` 反读（k=1000 @2e9 ≈ 1/3 台 KS3M）；折卡表 |
| `expected-output.json` / `MANIFEST.sha256` | 期望输出 / 四文件 sha256 |
| `kmax-<UTC>.json` | 正式输出（同步后；SYNC-GATE 过才写；带 `schema_version=kmax-cost/4`、`target_commit`、`rpc.live_binary_commit=7b1e18cc`、`cli_args`、`bits_roundtrip_ok`、两法 + 决策 + 表）|

## 运行
```bash
node docs/provenance/2026-08-27-kmax/kmax-cost.test.mjs                                   # 期望 15/15 PASS
cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-kmax/kmax-cost.mjs --window 1000 --json   # (17) ③c
# 退出码: 0 OK / 3 SYNC-GATE / 1 脚本错
cd docs/provenance/2026-08-27-kmax && sha256sum -c MANIFEST.sha256
```

## 坐标（全 `git show 7b1e18cc:<path>`，非工作树 90dbf074）
- `bits → target`：`math/src/lib.rs:64-80 from_compact_target_bits`（`mant = bits & 0xFFFFFF`，`expt = 8×((bits>>24)−3)`，`mant > 0x7FFFFF ⇒ ZERO`）；反向 `:83-97 compact_target_bits`。
- `work = 2^256/(target+1)`：`consensus/src/processes/difficulty.rs:261-267 calc_work`。
- 法 1 `H1 = work × 10 BPS`：`consensus/core/src/config/params.rs:669-696 TESTNET12_PARAMS`（TenBps）。
- 法 2 `estimateNetworkHashesPerSecond`：`consensus/src/processes/difficulty.rs:46-67`（`MIN_WINDOW_SIZE=1000` @:48）；`rpc/service/src/service.rs:954-972`；`MAX_SAFE_WINDOW_SIZE=10,000` @`rpc/core/src/api/rpc.rs:16`。
- 交叉核 `difficulty_ratio = MAX_DIFFICULTY_TARGET_AS_F64 / target`：`rpc/service/src/converter/consensus.rs:49-56`；`consensus/core/src/config/constants.rs:44`（= 2^255−1 = 5.78960446186581e76；🔴 全路径，同仓另有无 `config/` 的 `consensus/core/src/constants.rs`）。
- genesis bits：`consensus/core/src/config/genesis.rs:158`（`bits: 504155340`）。
- 决策值 `min(法1, 法2)`：(21) v0.2（NWT：不高估 `H_net`）；`H_adv_implied = (k−1)×H_floor`：(23) `H_floor_min = H_adv/(k_baked−1)` 反读。

## 设备档（UNVERIFIED-SOURCED，WebSearch 2026-08-27，见方法稿 §3）
RTX 4090 2.0e9（B）· RTX 5090 4.0e9（C 估）· IceRiver KS3M 6.0e12（A）· Bitmain KS5 Pro 2.1e13（B）。地板靠链上实测，卡表只作攻击者侧成本与 sanity。

历史：v0.1–v0.3 脚本在 `scratch/_j2_kmax_cost.mjs`（gitignored，已 SUPERSEDED）。
