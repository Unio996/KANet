# provenance · `k_max` 绝对成本表工具（(21) v0.7 入库 durable 版）

> **v0.6（NWT 小注）**：本成本表用 **raw 法 3**（`法3_raw = 块数/W × work_per_block`）作 `H_net` 估；(23) 入场地板用 **`法3_raw/(1+口径/W)`**（口径 = 132 s 戳偏）打折后的**保守下界**——两处法 3 **不同值**，勿混：成本表要的是"攻击者要追平多少"（不打折、偏高 = 攻击看着更贵，用于 CAPEX 对照），入场闸要的是"网络至少有多少"（打折、偏低 = fail-closed 向）。 🔴 **成本表的 `H_adv_implied(k) = (k−1)×H_net` 是攻击负担的【偏高/参考值】，不可当安全下界**——它接的是脚本 `kmax-cost.mjs:66` 那条既有警告（`law1_only ⇒ PROVISIONAL_OVERESTIMATE`：过估 `H_net` = 攻击看着更贵 = 危险向）：成本表越大越不安全，不是越大越好。**唯一 fail-closed 的安全数是 (23) 的地板链**：`H_total_lb`（法 3 按戳打折下界，(21) `gate_input=OK`）→ `H_floor_honest_lb = H_total_lb × (1 − s_adv_cap)`，`s_adv_cap` 由 (a-total) 或 (b) 自持路（法 3′ 本机时钟接收计 `H_vis_ub` + 具名 `B_adv`，(23) v0.11 `abda09f3`）给；CAPEX 表只是 Owner 定 `B_adv` 的对照，不是闸。

> **v0.5（NWT 三注）**：① **法 3 瞬时估**（墙钟窗 `[t−W, t]` 按块**时间戳**计块数 / W × work_per_block，对齐 (23) v0.6；`--law3-window-s` 默认 600 s ≫ 132 s，输出 `stamp_bias_bound = 132/W`）作 fallback，`decideHNet = min(可用法)`；**只有法 1 可用 ⇒ `gate_input = PROVISIONAL_OVERESTIMATE`**（陈难度，算力跌后过估 `H_net` = 攻击成本看着更贵/地板入场太易 = 危险向），**不许作 (23) firm 输入**；② **可用法相差 >2× ⇒ 表内仍取 min 作参考，但 `gate_input = FAIL_CLOSED`**——喂 (23) 入场闸时 = 环境违约（测量不可靠）⇒ 不入场，**不是取 min 硬用**；③ 单位段：`H1/H2/H3` 与设备档同为 **kHeavyHash H/s**（4090 2.0 GH/s → 2.0e9），折算只用 kHeavyHash 专属 A/B 档，**C 档估值（5090）只列不折**（`units: null`）。`schema_version = kmax-cost/5`。

用途：Owner/Codex 具名 `k_max` 的决策输入——现网 `H_net` → `H_adv_implied(k) = (k−1)×H_net` → 折成设备台数（CAPEX vs 头寸 VaR 判据见方法稿 `docs/2026-08-27-j2-s63-kmax-absolute-cost-v0.1.md` §5）。闭掉 (17) ③c "脚本未入库 ⇒ 输出不作证据"的缺口。

## 文件
| 文件 | 作用 |
|---|---|
| `kmax-cost.mjs` | 纯函数（`targetFromBits / compactTargetBits / workPerBlock / hNetFromBits / difficultyRatio / decideHNet / clampWindow / hAdvImplied / foldToDevices / costTable`）+ 链读 `main`（SYNC-GATE，输出 `kmax-<UTC>.json` + sha256）|
| `kmax-cost.test.mjs` | 离线确定性测试（读 `vectors.json`，比对 `expected-output.json`，任一不等退出码 1）|
| `vectors.json` | 19 条：**法 3 计数**（600 s 窗 6000 块 ⇒ H3 = 10/s × work）、`min(可用法)` 六例（law1/law2/**law3 最小**/法 2 缺但法 3 在 ⇒ 非 PROVISIONAL/**只法 1 ⇒ PROVISIONAL_OVERESTIMATE**/**>2× ⇒ FAIL_CLOSED**）、**C 档不折**；沿用：**genesis bits 504155340** → target/work/H1/ratio + compact 往返；exp≤3 / exp=1 / 符号位 ⇒ 0 / 高难度量级；两法取 min（law1 / law2 / >2× 加注 / 法2 缺）；`MAX_SAFE_WINDOW_SIZE=10,000` 与 `MIN_WINDOW_SIZE=1000` 边界；`H_adv_implied` 反读（k=1000 @2e9 ≈ 1/3 台 KS3M）；折卡表 |
| `expected-output.json` / `MANIFEST.sha256` | 期望输出 / 四文件 sha256 |
| `kmax-<UTC>.json` | 正式输出（同步后；SYNC-GATE 过才写；带 `schema_version=kmax-cost/5`、`target_commit`、`rpc.live_binary_commit=7b1e18cc`、`cli_args`、`bits_roundtrip_ok`、两法 + 决策 + 表）|

## 运行
```bash
node docs/provenance/2026-08-27-kmax/kmax-cost.test.mjs                                   # 期望 19/19 PASS
cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-kmax/kmax-cost.mjs --window 1000 --law3-window-s 600 --sleep-ms 20 --json   # (17) ③c
# 喂 (23) 入场闸只认 decision.gate_input === 'OK'; PROVISIONAL_OVERESTIMATE / FAIL_CLOSED 只作成本表参考
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
- 法 3：(23) v0.6 `docs/2026-08-27-nwt-s63-hash-floor-spec-v0.6.md` §法3（块时间戳窗，W ≫ 132 s，live 偏差上界 132/W）。
- 决策值 `min(可用法)`：(21) v0.2（NWT：不高估 `H_net`）；v0.5 `gate_input` 语义（OK / PROVISIONAL_OVERESTIMATE / FAIL_CLOSED）；`H_adv_implied = (k−1)×H_floor`：(23) `H_floor_min = H_adv/(k_baked−1)` 反读。

## 设备档（UNVERIFIED-SOURCED，WebSearch 2026-08-27，见方法稿 §3）
RTX 4090 2.0e9（B）· RTX 5090 4.0e9（C 估）· IceRiver KS3M 6.0e12（A）· Bitmain KS5 Pro 2.1e13（B）。地板靠链上实测，卡表只作攻击者侧成本与 sanity。

历史：v0.1–v0.3 脚本在 `scratch/_j2_kmax_cost.mjs`（gitignored，已 SUPERSEDED）。
