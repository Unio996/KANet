# §6-3 门现状表 v2（刷新 · 给 Owner 一页）· 2026-08-27

> **作者 NWT · 派工 Bettor (28) · 接 J2 8dae9cfe v1 · 只读汇总不裁门。** 每门：状态 / Codex 裁定文件+hash / 本仓证据 commit / 剩余项 / 依赖。
> 🔴 **顶层不变（Codex MSG-267 原句）**：§6-3 Shape-B 设计层 **CONDITIONALLY CLOSED**；**没有任何一门给了 build / 部署 / 钱路 授权**。下表"剩余项"全在此约束下。
> **本轮相对 v1 的进展**：(g) CLOSED、(h) CLOSED-AT-DESIGN、P3 PASS、(c)-1 坐标已钉、(d) 的 B_win/k_max/算力地板/claim-depth 全套入库+Codex 复审。

## 一张表（(a)–(h) + P1(g) + P3）

| 门 | 状态 | Codex 裁定（文件 · hash） | 本仓证据 commit | 剩余项 | 依赖 |
|---|---|---|---|---|---|
| **(a)** LOCKED_F→O_AUTHORIZED buildability | 🔴 **OPEN（J1 域）** | MSG-267：pre-code buildability gate；builder 注释非权威 | v0.15 §4 论证（依赖 relay 注释）；J1 8/12 round-trip 阳性对照未成 | 五条（真续链 tx 上链 + 阴性 REJECT + 钉 runtime） | **J1 + 节点同步**（J1 离线 ⇒ 停） |
| **(b)** A2-whole receipt→结算腿 | 🟡 **OPEN（执行闸，判据冻）** | 267：pre-registered impl gate；probe 非 A2-whole closure | J2 acceptance design（d969890a）+ NWT (b) 建其上；P3 fee-source PASS 已定费源结构 | 真 covenant（Owner build）+ 套件机械执行 + 逐格拒因 | **Owner build + J1 SS + 节点** |
| **(c)** cov_id 派生/续链 durable | 🟡 **(c)-1 CLOSED / (c)-2..6 OPEN（J1 域）** | 同 (a)（builder 注释非权威）| 🟢 **(c)-1 坐标表 48a9d1af（NWT GREEN ecd7af8c）**：全 `git show 7b1e18cc:` 逐字命中、opcode hex 全核 | (c)-2..6 上链（两 genesis→两 cov_id / 只收 baked / 续链恰一 / terminal 零续 / 变异按理由失败） | **J1 + 节点** |
| **(d)** 具名 `min_O/N_claim/N_margin`+reactive-liveness | 🟡 **OPEN-PROVISIONAL（结构闭、数待兑现）** | MSG-273/274 **88d8a57f/eb4db39c**：D-1 *PASS at proof-structure*、D-2 *bounded ACCEPTED*、B_win=f(k) accepted；MSG-275/276 **f65c1fbe**：B_win durable PASS / payload PASS / 单矿工 fail-closed PASS / s_adv 语义 + 法3 两 MUST-FIX | (d) v0.9（J2，NWT 审中）；B_win 仿真入库 **8310f390**；k_max 方法 **7074a673**；算力地板 v0.6 **b6dbcfd0**；s_max 提取器 **2718834c**；claim-depth **3339a81b**；NWT 审词全在 | 见下"(d) 残余六项" | **节点同步 + Owner（k_max/H_adv）+ P3 形状** |
| **(e)** quorum 独立性 | 🔴 **OPEN（真金前硬闸 + Owner）** | 267：*"Owner risk acceptance…can only explicitly accept the weaker trust model"*；*"stale % 非部署证据"* | §10 pubkey 身份 v0.2 **70761d33**（NWT PASS-WITH-NOTES）；集中度测量待 | ① §10 落地（global crypto identity 前提）② raw roster+selector 可复现测量 ③ 部署时现跑 | **Owner（§10 方向）+ 部署时** |
| **(f)** 跨链 | 🟢 **非阻塞（scope fail-closed）** | 267：*"separate future track, NOT a blocker if scope enforcement fail-closed"* | 判据在 (d) 单位/量级带 + §10 network 本地权威 | ctor 一条 `network∈{testnet-12}` 硬断言 + 负测（落码时与 CFG-UNIT-DOMAIN 同批） | 落码（无独立阻塞） |
| **(g)** P1 toolchain/provenance | 🟢 **CLOSED** | MSG-273/274 **eb4db39c**：P1(g) **CLOSED**（读法甲充分、被拒 tx 体缺失不阻该窄门）；sha 白名单 *"unregistered compiler rejected before compile = real improvement"* | durable 证据包 `docs/provenance/2026-08-27-p1g-durable-evidence/`；上链跑手 fc925044；乙腿 (g) CLOSED 后不需（(17) ⑤ 已 SUPERSEDED） | — | — |
| **(h)** Shape-B 变异一致性套件 | 🟢 **CLOSED AT DESIGN LAYER** | MSG-273/274 **eb4db39c**：*"(h) CLOSED AT DESIGN LAYER"*（H1 六臂在声明焊缝被拒、H2 独立配置臂、CF-4 归 (d)）；carry：机械执行待真 covenant | (h) v1.1 **7899a94e**；CF-4 归 (d) 已接 | 机械执行 = 真 covenant 后（锚从 §行换 `.sil` file:line、矩阵从真支集再生） | 执行层：真 covenant（Owner+J1） |
| **P3** fee-source（(d) 子） | 🟢 **PASS（设计），(a)/(b) 待 Owner** | **eb4db39c**：*"P3 structure PASS, recommend (b)"*；`min_O` 只围 O/存储/价值地板重定义 | fee-source v0.3 **1f4c90a4**（NWT GREEN）；(b) 下 `min_O=SF×storage_floor`、`F_claim_reserve` 归 claimant/watchtower 就绪度 | (a) `OpTxInputCount==2` vs (b) 二选一 | **Owner（改 v0.15 正文）** |

## (d) 残余六项（逐条）

| # | 内容 | 谁 | 依赖 | 现有工具 |
|---|---|---|---|---|
| ① | §5① claim-shape **深确认阈值测试**（≥30 笔、depth≥20）⇒ `N_claim` 从下界变实测；**部署硬前置** | J2/NWT | **节点同步** | (27) 采样器 provenance `docs/provenance/2026-08-27-claim-depth/`（3339a81b）+ (17) 清单 **③e** |
| ② | §5② 节点 lag/停滞/reorg + **参考节点 DAA** 重采 ⇒ `M_observe`/`W_dis` | J2 | **节点同步** | (17) 清单 **③b** 采样器（120 min）|
| ③ | P3 真形状 mass ⇒ `min_O` 费项 + **(a)/(b) 决定** | Owner + J1 | **真 covenant（(b)(h) 执行）** | fee-source v0.3（1f4c90a4）判据冻 |
| ④ | **`k_max` 具名**（B_win=f(k) 有界；占位 55,200⟺k≲1000 是弱假设）⇒ 定 `N_margin` 的 `B_win` | **Owner/Codex** | **Owner 给 `H_adv` + 算力地板** | (21) k_max 成本 provenance + (23) 地板 v0.6 + B_win 仿真（8310f390）|
| ⑤ | **`s_visible_max` 实值**（窗内最大单 coinbase 份额）⇒ 算力地板 `s_adv_cap` 输入 | J2/NWT | **节点同步**（s_visible_max）+ **Owner**（s_adv_cap 论证）| (24) s_max 提取器 provenance `docs/provenance/2026-08-27-smax/`（2718834c）+ (17) **③d** |
| ⑥ | NWT 审 (d) v0.9（进行中）⇒ 桥报 Codex 收 (d) | NWT | — | (d) v0.9 + 本表 |

## Tier-2 定位（VB-5/VB-6）
🔴 **§6-3 Tier-2 fair-exchange 现网禁用 = 【结构性】（未建：无码、无 covenant、无开关）**，非"翻某开关"（VB-5 盘点 b2d5dc7d、NWT GREEN 8fe85c93；术语表落 DEVELOPER-GUIDE + DECISIONS 指针 VB-6 4d000543）。live 有开关的是 **committed ZK 结算（另一 track、ADMIN_ZK_*=1 fail-closed）**，别混。⇒ **(23)/(21) 算力地板/k_max = 未来 (b)-实现的入场闸设计要求，非现网运行时控制。**

## Owner 待决三件（Bettor 精炼上报）
1. **§10 pubkey 身份 GO**（方向批）——(e) quorum 独立性 + ⑦ 抢注跨节点关闭的前提（v0.2 70761d33 NWT PASS-WITH-NOTES；C1–C5 切分每 commit NWT 审）。
2. **§6-1 ⑥ 生产签发口 Track + 是否推翻 (527)**——Track-A(手工)已 E2E GREEN 够 / Track-B(端点)需 §10 抢注先解 + 推翻 (527)（VB-4 41a8edb1、两死结 NWT 筛为伪、NWT GREEN 23074530）。
3. **watchdog SYNCING 三态落码批**（KANet-UI VB-9 计划待 NWT 审）——防 headers=0/daa=0 被误判为死而重启（8/23 类）。

**一句给 Owner**：设计层 CONDITIONALLY CLOSED；pre-code 门里 **(g)(h) 已 CLOSED（(h) 在设计层）、P3 PASS、(c)-1 坐标钉死、(d) 结构闭数待兑现（B_win/k_max/地板/claim-depth 全套入库+Codex 复审）、(f) 非阻塞**；真正卡住的仍是 **(a)(c-2..6)（J1 SS 域·零链上证据·J1 离线+节点 IBD）** 与 **(b)/(h) 执行层 + (e)（要 Owner：build 授权 / §10 身份方向）**。**节点同步（延后 ~2h）到位后 (d) 的 ①②⑤ 可跑；(d)④ 与 P3③ 等 Owner。**

**引用锚**：Codex `RESPONSE-…MSG267/MSG269-270/MSG271-272/MSG273-274/MSG275-276`（88d8a57f/eb4db39c/f65c1fbe/6fd55a53）；MSG-277 桥 d73ae82c；v1 表 8dae9cfe。
