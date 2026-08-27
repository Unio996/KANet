# §6-3 门现状表 v3（刷新 · 给 Owner 一页）· 2026-08-27

> **作者 NWT · 派工 Bettor · SUPERSEDES v2（`1a0980f8`+`0eaf4d90`）· 只读汇总不裁门。**
> 🔴 **顶层不变（Codex MSG-267 原句）**：§6-3 Shape-B 设计层 **CONDITIONALLY CLOSED**；**没有任何一门给了 build / 部署 / 钱路 授权**（Codex MSG-283 再次明写 "No … production money-path action is authorized"）。
> **本轮相对 v2 的进展 = (d) 的算力地板/H_vis_ub 统计构造走完 D-STAT 全程：Codex MSG-279→283 六轮，D-STAT-1/2/3 三条 CLOSED（设计层）。**

## 🆕 D-STAT 三条 CLOSED（设计层）— (d) 入场闸「诚实算力地板」的统计承重（Codex `1c7188e2` MSG-283）

| 项 | 状态 | 一句机制 | 证据 commit |
|---|---|---|---|
| **D-STAT-1** 泊松单侧上界 | 🟢 **CLOSED（设计层）** | 弃高斯 `n+3.09√n`（任何 n 欠覆盖），冻结 **Garwood 精确** `½χ²_{0.999}(2n+2)`；实现返回上括号/Chernoff 轨、零静默欠射 | (23) v0.12 `0e123323`；(21) 工具 v0.8 `af2db5da`+`384684fd`（selfCheck fail-open 已修）|
| **D-STAT-2** 样本充分闸 | 🟢 **CLOSED（设计层）** | 机械 `n≥N_min=4,000@δ5%` 与 `W≥3600s` 并列（`n` 实测非 `BPS×W`）| (23) v0.12 `0e123323` |
| **D-STAT-3** 每公开到达 work 上界 | 🟢 **CLOSED（设计层）** | `H_vis_ub=λ_ub(n)·w_cap_window/W`；`w_cap_window` = **支配定理 L1–L5**（∀ 合法公开子块 C `work(bits(C))≤w_child_ub(SP)`，**无需枚举**）；覆盖集 = `window(SP)`【精确重建】∪ Ncand，历史闸 = 结构性精确证书（blue_work 单调），洞归估计器 fail-closed **非 B_adv** | (23) v0.15 `2f632c91`+`e160f1fb`；(d) v0.16 `6e2218d9` |

- **验收角色（Codex 283 §2）**：(A) 重建+证书 / (B) `bitsCalc==收块bits` / (C) 已实现子块断言+自喂剔除+负向量 = **生产验收**；**(D)** `N_small=12` 有界模型 = **引理/回归机器检验（写死是 feature，防再膨胀成不可执行契约）**；**(E)** 贪心 = **仅 smoke，非极值覆盖**。
- 🔴 **w_cap 取数/重建【实现】= OPEN**（Codex 283 §4 直审取数设计 `448469b2`："direction sound, 但非 D-STAT-3 闭合证据"）：真 RPC 路须证四闸（分页完整确定 / sink-anticone 无闭包洞 / 缺失-剪裁-IBD 必成 INEXACT 绝不成更小窗 / t0-t1 同接收时钟）——见 (24) v0.2。

### 🔴 Scope（Codex 283 §3·原话，Owner 须读）
- **英**："**D-STAT-3 closes the work-per-public-arrival cap construction under exact reconstructed public state; it does not eliminate the adversarial-capacity model boundary.**"
- **中**：D-STAT-3 闭的是"每公开到达 work 上界构造（**在精确重建的公开状态下**）"；**不消除**对手容量的模型边界——私链/withheld/反事实/可用性仍归 `B_adv` 或 fail-closed。`Ncand(SP)` 只由估计器可得块建，**不魔法覆盖可得公开集之外**。

### Codex 283 §5 剩余 OPEN（原文口径）
- **w_cap fetch/reconstruction implementation**：OPEN；exactness/data-acquisition 证据仍需（= (24) v0.2 四闸真 RPC 路证）。
- **gate (d) overall**：OPEN/PROVISIONAL——非 D-STAT 项（**claim-shape 证据、同步后运行证据、对手预算/cap 策略、具名保守常量**等）**未由本裁定闭**。

## (a)–(h)/P3 门表（相对 v2 仅 (d) 更新，余同 v2 `1a0980f8`）
| 门 | 状态 | 剩余 | 依赖 |
|---|---|---|---|
| (a) buildability | 🔴 OPEN（J1 域） | 真续链 tx 上链 + 阴性 REJECT + 钉 runtime | J1+节点 |
| (b) A2-whole→结算腿 | 🟡 OPEN（执行闸，判据冻） | 真 covenant + 套件机械执行 + 逐格拒因 | Owner build+J1 SS+节点 |
| (c) cov_id durable | 🟡 (c)-1 CLOSED / (c)-2..6 OPEN | 续链上链五项 | J1+节点 |
| **(d)** 具名 min_O/N_claim/N_margin+reactive-liveness | 🟡 **OPEN-PROVISIONAL（结构闭 + D-STAT 三条设计层 CLOSED；数待兑现）** | **六项残余（同 v2）+ w_cap 取数实现四闸** | 节点同步+Owner(k_max/H_adv/H_total_ub)+P3 形状 |
| (e) quorum 独立性 | 🔴 OPEN（真金前硬闸+Owner） | §10 落地 + 可复现测量 + 部署时现跑 | Owner(§10)+部署时 |
| (f) 跨链 | 🟢 非阻塞（scope fail-closed） | ctor `network∈{testnet-12}` 硬断言+负测 | 落码 |
| (g) P1 toolchain | 🟢 CLOSED | — | — |
| (h) Shape-B 变异套件 | 🟢 CLOSED AT DESIGN LAYER | 机械执行=真 covenant 后 | Owner+J1 |
| P3 fee-source | 🟢 PASS（设计），(a)/(b) 待 Owner | (a)`OpTxInputCount==2` vs (b) 二选一 | Owner |

**(d) 六项残余同 v2**（claim-depth SENDER_TS / W_dis 双列 / Owner 具名 k_max 挂 s_adv_cap / P3 真形状+终选 / 具名最终常量+五类 fail-closed / 工具官方跑）；**新增**：D-STAT 已把"s_adv_cap 的 H_vis_ub 上界"从"待定"推进到**设计层 CLOSED**，只剩**取数实现四闸 + Owner 给 `H_adv_cap`/`H_total_ub`/`B_adv` 具名** + 同步后实测。

## Tier-2 定位（不变）
🔴 §6-3 Tier-2 fair-exchange 现网禁用 = **结构性**（无码/无 covenant/无开关），非翻开关。live 有开关的是 committed ZK 结算（另一 track、`ADMIN_ZK_*=1` fail-closed），别混。⇒ (23)/(21)/(24) 算力地板/k_max/取数 = **未来 (b)-实现的入场闸设计要求，非现网运行时控制**。

## 🔴 Owner 待决三件（不变，Bettor 精炼上报）
1. **§10 pubkey 身份 GO**（方向批）——(e) quorum 独立性 + ⑦ 抢注跨节点关闭前提（v0.2 `70761d33` NWT PASS-WITH-NOTES；C1–C5 每 commit NWT 审）。
2. **§6-1 ⑥ 生产签发口 Track + 是否推翻 (527)**——Track-A(手工) 已 E2E GREEN 够 / Track-B(端点) 需 §10 抢注先解 + 推翻 (527)。
3. **watchdog SYNCING 三态落码批**（KANet-UI VB-9 计划待 NWT 审）——防 headers=0/daa=0 误判为死重启（8/23 类）。

**一句给 Owner**：**(d) 的统计承重（算力地板/H_vis_ub）走完 Codex 六轮、D-STAT-1/2/3 三条设计层 CLOSED**；但 **scope 须记牢：只闭"精确公开状态下的每到达 work 上界构造"，不消对手容量边界**；w_cap **取数实现**与 gate (d) 的**非 D-STAT 项**（claim-shape/同步运行/对手 cap 策略/具名常量）**仍 OPEN**。三件待 Owner 决不变。**全程零 build/deploy/money-path 授权。**

**引用锚**：Codex `RESPONSE-…MSG279/280/281/282/283`（bridge `b4df8328`/`d7fefb58`/`95d7f354`/`713232be`/`1c7188e2`）；D-STAT 证据 (23) v0.12–v0.15 / (21) v0.9 `a93f9c5e` / (24) v0.1–v0.2 / (d) v0.17 `9ac6cc09`；v2 表 `1a0980f8`。
