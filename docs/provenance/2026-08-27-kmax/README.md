# provenance · `k_max` 绝对成本表工具（(21) v0.9.2 入库 durable 版）

> **v0.9.2（NWT 预置① + Bettor：v0.9.1 的 `hashKey` 只 `toLowerCase` 不够——长度/非 hex/大写/`0x` 混入会**静默错序**）**：比较键改**严格形** `/^[0-9a-f]{64}$/`，**不归一**：大写 / `0x` 前缀 / 63 位 / 非 hex ⇒ `throw BAD_HASH_FORM`（fail-closed 非静默）；`fromRpcBlock` 入口对 `hash / parents / selectedParentHash / mergeSet*` 同验；合成向量的短名（如 `b44`）只在测试显式 `setHashPolicy({ allowSynthetic: true })` 下放行（生产默认严格）。**W12 负向量**：规范 64 小写 hex ok；大写 / `0x` / 63 位 / 非 hex / 合成短名（严格模式）⇒ throw；比较器遇大写 throw；`fromRpcBlock` 遇 `0x` throw。既有 14 向量逐位不变；15/15。

> **v0.9.1（Codex 未同步直审 `1eff6fe1`：IMPLEMENTATION HOLD 的唯一 MUST-FIX——`childWindow()` 预采样层 mergeset 序在等 `blue_work` 时回落输入顺序）**：共识 `sampled_mergeset_iterator` 消费 `descending_mergeset_without_selected_parent`（`consensus/src/model/stores/ghostdag.rs:139-160`：blues 逆序 ⊕ reds 逆序按 `SortableBlock` 反向 `merge_join_by`）= **降序 `SortableBlock`**（`blue_work.cmp().then_with(hash.cmp())`，`ghostdag/ordering.rs:38-42`），`Hash = [u8;32]` 派生 `Ord`（`crypto/hashes/src/lib.rs:38-46`）= **字节字典序** ⇒ 等 blue_work 兄弟跨采样 index 边界时 hash 打破决定谁被采 ⇒ 影响堆/`bitsCalc`/`T_lb`/`w_cap`。修：`consensusMergesetOrder()` = 降序 `SortableBlock` 含 hash 打破（JS 用**等长小写 hex 码元序** ≡ 字节字典序，非 locale；输入 lowercase 归一），堆淘汰层与预采样层**各自独立**用同一比较器。**W11 独立 oracle 向量**（不经生成器/镜像：固定 64 位 hex 常量 A<B 等 blue_work 0x10、C<D 等 0x0f，`sampleRate 2, daa(SP)=1` ⇒ 采降序第 2/第 4 ⇒ 共识序 [B,A,D,C] ⇒ 手算采 [A,C]）：镜像正/反输入皆 [A,C] = oracle、堆成员同；**去掉 hash 打破 ⇒ 正序采 [B,D]、反序采 [A,C]（依赖输入顺序）且 ≠ oracle** ⇒ 三条都机械验证。既有 13 向量逐位不变；14/14。

> **Codex 283（bridge `1c7188e2`）：D-STAT-3 CLOSED AT DESIGN LAYER**（gate (d) 整体仍 OPEN / PROVISIONAL）。Codex 独立重读 v0.15 定理与 7b1e18cc 承重路径（`try_init_from_cache` 不重过 / 准入蓝分阈值 + DAA 节拍 / `SortableBlock` 序 + ≤7 ⇒ 去 7 最小为保守核 / `calculate_difficulty_bits` 去 min_ts·avg·max(measured,1) / `expected_full` 保守 / compact 截断 + `calc_work` 方向 / 固定支并入 max）全一致——"the proof obligation is now carried by the theorem, not by brute force"。🔴 **Scope 原话（Owner 面须原句）**："**D-STAT-3 closes the work-per-public-arrival cap construction under exact reconstructed public state; it does not eliminate the adversarial-capacity model boundary.**"（中译：D-STAT-3 闭合的是【在精确重建的公开状态下】每个公开到达的 work 上界构造；它**不消除**对抗容量的模型边界——`Ncand(SP)` 由估计器可得块构成，可得公共集之外的子块/支撑分支不被定理覆盖，归 `B_adv` 或 fail-closed。）**(D) 角色**：`N_SMALL=12` 写死是 feature——只作引理/回归机器检验，不是生产状态覆盖，写死防止它悄悄长成另一个不可执行的验收契约。**(E) 角色**：只是带标签的 smoke，**永不引作极值覆盖**（除非另给极值证明）。🔴 **实现闸（须实测·未闭，Codex 原文四条，w_cap 取数/重建实现 OPEN）**：(1) pagination to sink is complete and deterministic for the required cover；(2) sink-anticone additions do not leave an unreturned mergeset closure hole；(3) missing/pruned/IBD members surface as `INEXACT`, never as a smaller reconstructed window；(4) the `t0/t1` used for `lambda_ub(n)` are the same arrival-clock interval for which `wCapWindow` is certified。取数设计见 NWT (24) `docs/2026-08-27-nwt-s63-wcap-fetch-design-v0.1.md`（`3f7ef2c5` + 不变量 `448469b2`）。`hVisUb` 的 `wCapWindow` **仍参数注入**，接线留 v0.10（四闸实测后）。

> **v0.9（Codex 281/282 D-STAT-3 闭合落码：`w_cap_window` 层 1 重建器 durable；只加不改，`kmax-cost.mjs` 未动、`hVisUb` 的 `wCapWindow` 仍参数注入（接线留 v0.10）**：新增 **`wcap-window.mjs`**（镜像 7b1e18cc）——`rebuildWindows`：拓扑序增量建窗 `window(B) = window(SP) ∪ sampled({SP}∪mergeset(B))`（`window.rs:138-235/265-282`，继承样本不重过阈值），采样 `(daa(SP)+index)%40==0`、蓝分 < `lowest_daa_blue_score` ⇒ NonDaa（`:299-322`；阈值蓝分域 `difficulty.rs:185-197`），堆按 **`SortableBlock` 序（blue_work 然后 hash，`ghostdag/ordering.rs:38-42`）**留最高 661（`:458-468`），真 genesis = 无父 ∧ daa=0 ∧ bs=0；**精确证书**：(甲) 自真 genesis 全史零缺失 / (乙) 截断根 R 后堆满 ∧ 堆内最小蓝功 > blue_work(R) ∧ 零缺失（`blue_work` 沿祖先单调 `protocol.rs:99-102/:161`），否则 `exact=false`；`calculateDifficultyBits` 镜像 `:216-246`。`wChildUb(SP)`：`K_SP` = 去序最小 7（并列全去）⇒ `m_lb`；`T_lb = min target over window(SP) ∪ Ncand(SP)`（`Ncand = {SP} ∪ {bs ≥ bs(SP)+1−26,440}`，零域换算）；目标支可达性 `|window(SP)|+7 ≥ 150`；固定支并入；`window(SP)` 不精确 ⇒ `WINDOW_INEXACT`。`wCapWindow`：`S = {bs ≥ bs_top − 36,000}`，`max_S`，原因码 `WINDOW_INEXACT / ASSERTION_FAIL / CANDIDATE_FAIL / SMOKE_FAIL / NO_SP`；输出带 **`certificate{kind: GENESIS|TRUNCATION|INEXACT, R, R_blue_work, heapMin_min, missing, inexact_count}`**（(24) 取数设计 `3f7ef2c5` ⑤ 接口）与 **`wCapWindow`（Number，直接喂 `hVisUb({wCapWindow})`）** + `w_cap_window`（字符串精确值）；`anchor = {hash, blueWork}` 选项 = 取数锚 R（getBlocks lowHash）：调用方声明 antipast(R)∩past(sink) 全取时截断根 `rootBw = min(own, bw(R))`（更紧仍安全），无 anchor ⇒ 每条截断链用自己根蓝功（恒安全）。**支配定理 L1–L5**（(23) v0.15 `2f632c91`）⇒ ∀ 合法公开子块 `work(bits(C)) ≤ w_child_ub(SP)`，**无需枚举**。**验收**：(A) 重建 + 证书（O(N)）；(B) 精确窗 `bitsCalc == 收块 bits`（O(N)）；(C) 已实现子块断言（核 B 时 `Ncand` 剔除 B 自身）+ 负向量真失败；(D) `enumerateBounded`：有界穷举对抗模型，池 **`N_SMALL = 12` 写死**，超过 ⇒ throw 不截断——**引理链机器检验，非生产验收**；(E) `greedyExtremeSmoke` 标 **non-acceptance**（证不了极值：`measured` 与 `average_target` 由淘汰/新进组合决定，不独立可分）。`fromRpcBlock` 适配 wRPC camelCase（`getBlocks(includeBlocks=true, includeTransactions=false)` 的 header + verboseData，`rpc/service/src/converter/consensus.rs:73` verbose_data 无条件）。**复杂度声明**：(A)(B)(C) 线性于已收块数（每块 ≤ 7 次堆操作），生产 ≈ 62,440+ 块秒级；(D)(E) 只跑合成小 DAG。向量 `vectors-wcap.json` 13 条（W1 平稳 (A)–(E) / W2 挤戳 / W3 负向量真失败 + W3b 等号 / W4 red 密 daa-bs ×2.9 分离 / W5 non-DAA 排除 / W6·W6b·W6c 证书三态 / W7 固定支 / W8 TN12 真参数最大进样 7 / W9 N_SMALL 超限 throw / W10 取数锚两截断链 + 证书汇总），期望 `expected-output-wcap.json`。

| 文件 | 作用 |
|---|---|
| `wcap-window.mjs` | `w_cap_window` 层 1 重建器（纯函数 `fromRpcBlock / topoOrder / childWindow / calculateDifficultyBits / rebuildWindows / wChildUb / enumerateBounded(D) / greedyExtremeSmoke(E) / wCapWindow`）|
| `wcap-window.test.mjs` | 离线确定性测试（合成 DAG 生成器在测试内；读 `vectors-wcap.json`，比对 `expected-output-wcap.json`，任一不等退出码 1）|
| `vectors-wcap.json` / `expected-output-wcap.json` | 15 条向量（v0.9.1 W11 独立 oracle 平局；v0.9.2 W12 hash 严格形负向量）/ 期望 |

```bash
node docs/provenance/2026-08-27-kmax/wcap-window.test.mjs      # 期望 15/15 PASS ((D)(E) 只在合成小 DAG 上跑; W11 = 共识序独立 oracle; W12 = hash 严格形)
```

> **v0.8（Codex 280 `d7fefb58` D-STAT-1/2 设计层 CLOSED ⇒ 落码，只加不改；`H_total_lb` 三估计器与 `main` 未动）**：`kmax-cost.mjs` 新增纯函数块——**`lambdaUb(n, α=1e−3)`** = Garwood `½χ²_{1−α}(2n+2)` 用泊松 CDF 对数域二分，**返回上括号**（`P(X≤n|hi) ≤ α` ⇒ impl ≥ 精确，零静默欠射，Codex 验收项）；**`lambdaUbChernoff`** = `(√(L/2)+√(L/2+n))²` 可证上轨；`lambdaUbGaussRail` = `n+3.09√n` **只作夹逼下轨、绝不作闸值**（任何 n 都欠覆盖）；**`bracketCheck` / `selfCheck()`** = 精确对照（Codex 独立复算 6 值 n=0/10/30/100/1000/36000 ⇒ 6.907755/24.133971/51.083124/134.924319/1101.626944/36590.189486，容差 1e−5）+ 夹逼断言 `gauss ≤ impl ≤ Chernoff`（n=0..200 全扫）—— 任一不过 ⇒ `throw` ⇒ 非零退出（fail-closed），`hVisUb` 首次调用强制跑；**`nMin(δ)`** 精确整数反解（5%/3%/2% ⇒ 3974/10867/24259）；**`hVisUb({n, wCapWindow, t0Ms, t1Ms})`** = `λ_ub(n)·w_cap_window/(t1−t0)` 带硬闸 `W<3600 s ∨ n<4000 ∨ 无 w_cap ⇒ H_vis_ub=null`（reason 码 W_MIN/N_MIN/NO_W_CAP，回 (a-total)）；**`w_cap_window` 层 1 重建器等 Codex 281 再落，先参数注入，缺则 fail-closed（不许静默用观测 w_max）**。向量 +17（`D1-lambda-*` ×6 / `D1-selfcheck` / `D1-selfcheck-fault-twice` / `D2-nmin-*` ×3 / `D3-hvis-*` ×6）= 36/36。🔴 **fix-up（NWT 审 af2db5da ②）**：首版 `selfCheck` 失败路径先缓存再 throw ⇒ 第二次调用命中缓存不 throw ⇒ `try{hVisUb()}catch{}` 重试即绕过 = fail-closed 机制自身 fail-open（当时 impl 正确故不可达，仍修）。现：**失败永不缓存**（只缓存成功），`bracketCheck/selfCheck` 加测试专用 `implFn` 注入口（注入时不读不写缓存），向量 `D1-selfcheck-fault-twice`：注入 λ×0.9 欠界实现，**连调两次都 throw**，之后真实现仍 ok。`DSTAT_VERSION = dstat/1`；输出 JSON schema 不变（`kmax-cost/5`）。

> **v0.6（NWT 小注）**：本成本表用 **raw 法 3**（`法3_raw = 块数/W × work_per_block`）作 `H_net` 估；(23) 入场地板用 **`法3_raw/(1+口径/W)`**（口径 = 132 s 戳偏）打折后的**保守下界**——两处法 3 **不同值**，勿混：成本表要的是"攻击者要追平多少"（不打折、偏高 = 攻击看着更贵，用于 CAPEX 对照），入场闸要的是"网络至少有多少"（打折、偏低 = fail-closed 向）。 🔴 **成本表的 `H_adv_implied(k) = (k−1)×H_net` 是攻击负担的【偏高/参考值】，不可当安全下界**——它接的是脚本 `kmax-cost.mjs:66` 那条既有警告（`law1_only ⇒ PROVISIONAL_OVERESTIMATE`：过估 `H_net` = 攻击看着更贵 = 危险向）：成本表越大越不安全，不是越大越好。**唯一 fail-closed 的安全数是 (23) 的地板链**：`H_total_lb`（法 3 按戳打折下界，(21) `gate_input=OK`）→ `H_floor_honest_lb = H_total_lb × (1 − s_adv_cap)`，`s_adv_cap` 由 (a-total) 或 (b) 自持路（法 3′ 本机时钟接收计 `H_vis_ub` + 具名 `B_adv`，(23) v0.11 `abda09f3`）给；CAPEX 表只是 Owner 定 `B_adv` 的对照，不是闸。

> **v0.5（NWT 三注）**：① **法 3 瞬时估**（墙钟窗 `[t−W, t]` 按块**时间戳**计块数 / W × work_per_block，对齐 (23) v0.6；`--law3-window-s` 默认 600 s ≫ 132 s，输出 `stamp_bias_bound = 132/W`）作 fallback，`decideHNet = min(可用法)`；**只有法 1 可用 ⇒ `gate_input = PROVISIONAL_OVERESTIMATE`**（陈难度，算力跌后过估 `H_net` = 攻击成本看着更贵/地板入场太易 = 危险向），**不许作 (23) firm 输入**；② **可用法相差 >2× ⇒ 表内仍取 min 作参考，但 `gate_input = FAIL_CLOSED`**——喂 (23) 入场闸时 = 环境违约（测量不可靠）⇒ 不入场，**不是取 min 硬用**；③ 单位段：`H1/H2/H3` 与设备档同为 **kHeavyHash H/s**（4090 2.0 GH/s → 2.0e9），折算只用 kHeavyHash 专属 A/B 档，**C 档估值（5090）只列不折**（`units: null`）。`schema_version = kmax-cost/5`。

用途：Owner/Codex 具名 `k_max` 的决策输入——现网 `H_net` → `H_adv_implied(k) = (k−1)×H_net` → 折成设备台数（CAPEX vs 头寸 VaR 判据见方法稿 `docs/2026-08-27-j2-s63-kmax-absolute-cost-v0.1.md` §5）。闭掉 (17) ③c "脚本未入库 ⇒ 输出不作证据"的缺口。

## 文件
| 文件 | 作用 |
|---|---|
| `kmax-cost.mjs` | 纯函数（`targetFromBits / compactTargetBits / workPerBlock / hNetFromBits / difficultyRatio / decideHNet / clampWindow / hAdvImplied / foldToDevices / costTable`）+ 链读 `main`（SYNC-GATE，输出 `kmax-<UTC>.json` + sha256）|
| `kmax-cost.test.mjs` | 离线确定性测试（读 `vectors.json`，比对 `expected-output.json`，任一不等退出码 1）|
| `vectors.json` | 36 条（v0.5 19 + v0.8 17 条 D-STAT：Garwood 六精确向量与夹逼 / selfCheck 全扫 / selfCheck 坏实现连调两次都 throw / N_min 三反解 / hVisUb 出数·W_MIN·N_MIN·两者·NO_W_CAP·闸上边界）：**法 3 计数**（600 s 窗 6000 块 ⇒ H3 = 10/s × work）、`min(可用法)` 六例（law1/law2/**law3 最小**/法 2 缺但法 3 在 ⇒ 非 PROVISIONAL/**只法 1 ⇒ PROVISIONAL_OVERESTIMATE**/**>2× ⇒ FAIL_CLOSED**）、**C 档不折**；沿用：**genesis bits 504155340** → target/work/H1/ratio + compact 往返；exp≤3 / exp=1 / 符号位 ⇒ 0 / 高难度量级；两法取 min（law1 / law2 / >2× 加注 / 法2 缺）；`MAX_SAFE_WINDOW_SIZE=10,000` 与 `MIN_WINDOW_SIZE=1000` 边界；`H_adv_implied` 反读（k=1000 @2e9 ≈ 1/3 台 KS3M）；折卡表 |
| `expected-output.json` / `MANIFEST.sha256` | 期望输出 / **八文件** sha256（v0.9 起含 wcap 四件）|
| `kmax-<UTC>.json` | 正式输出（同步后；SYNC-GATE 过才写；带 `schema_version=kmax-cost/5`、`target_commit`、`rpc.live_binary_commit=7b1e18cc`、`cli_args`、`bits_roundtrip_ok`、两法 + 决策 + 表）|

## 运行
```bash
node docs/provenance/2026-08-27-kmax/kmax-cost.test.mjs                                   # 期望 36/36 PASS (含 D-STAT selfCheck; 任一不过 ⇒ 退出码 1)
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
