# §6-3 门现状表 v4（刷新 · 给 Owner 一页）· 2026-08-27

> **Status**: CURRENT（SUPERSEDES v3）
> **作者 NWT · 派工 Bettor · SUPERSEDES v3（`docs/2026-08-27-nwt-s63-gate-status-refresh-v3.md`）· 只读汇总不裁门。**
> 🔴 **顶层不变（Codex MSG-267/283）**：§6-3 Shape-B 设计层 **CONDITIONALLY CLOSED**；**没有任何一门给了 build / 部署 / 钱路 授权**（"No … production money-path action is authorized"）。
> **本轮相对 v3 = Owner 三决落地（D-013）+ 四补丁/维护窗状态入表**；D-STAT-1/2/3 三条仍 CLOSED（设计层，同 v3）。

## 🆕 Owner 三决落地（`docs/DECISIONS.md` D-013 · Owner 原话「§10 GO，B_adv 只定语义不钉数，watchdog v0.3 批」）

| 决 | Owner 裁 | 现状 / 下一步 | 权威锚 |
|---|---|---|---|
| **§10 跨节点 pubkey 身份 v1** | 🟢 **GO（开工）** | 范围铁律：只 `operation=register`；rotate/revoke/迁移不含；不部署对外、不动 §0 墙（D-012）；不改 A2 六字段。流程：J2 落码（pathspec 不推）→ **每 commit NWT diff 审** → Bettor 推 → Codex 桥审 → 上线=D-005 独立迁移 Owner 另拍。**J2 出一页切片计划中**；NWT 已核 v0.2(70761d33) 全吸收 v0.1 PASS-WITH-NOTES(e128a735)，**1 残余（C5 审词旧措辞）待 J2 切片前修**。 | 设计 847bcf22 / 计划 v0.2 70761d33 |
| **`B_adv` 对手预算** | 🟢 **只定语义、不钉硬数** | 语义 = 单一预算 `H_hidden_ub=H_adv_add=B_adv`（拆须论证+守卫）·不具名 ⇒ Tier-2 fail-closed（= 现网安全现状）·机械复核触发（(24) 见第二 coinbase 地址≥100 块 / Tier-2 真 build）·硬值等实测基线。已写入 (23)§8 OWNER-FREEZE 注 + (d)§8 镜像。**无后续动作**（fail-closed 缺省对现网正确）。 | D-013 §2 / (23) v0.15 / 决策稿 719cab73 |
| **watchdog SYNCING 三态** | 🟢 **v0.3 批** | 三态（ALIVE/SYNCING/DEAD）替 "daa=0 判死"；刹车 N=5/T=5min/冷却30min **不得被恢复动作自身 reset**；(PID,CreationDate) 判自重启；退出码 7/8/9；VA-1…9。**启用条件不变**：本机 READY(`isSynced ∧ daa>80,095,687`)+VA 全过+NWT diff GREEN；**IBD 期只落码不启用**（`KANet-KaspadWatchdog` 保持 Disabled）。KANet-UI 落码 pending → NWT diff 审。 | D-013 §3 / 计划 48d025f6 |

🔴 **仍待 Owner 一件（原四决第四件，D-013 未含）**：**§6-1 ⑥ 生产签发口 Track + 是否推翻 (527)**——Track-A(手工) 已 E2E GREEN 够 / Track-B(端点) 需 §10 抢注先解 + 推翻 (527)。（§10 GO 已解"抢注"前提之半，但推翻 (527) 仍是独立 Owner 裁。）

## 🆕 四补丁 + 维护窗状态（8/23 整机崩后的稳态化，全非门、非钱路）

| 项 | 状态 | 一句 |
|---|---|---|
| j1-patch（index.js `__booted` 守卫）| 🟡 审过·待部署 | startup 异常 exit(1) 不再被 log-only 吞（8/23 根因）；锚点精确匹配 + node --check + .bak；**生效需 console 重启=维护窗** |
| lint R-WATCHDOG-PROBE-SELFFAULT-RESTART（c95acecd）| 🟢 已落 | watchdog 探针自故障不得触发重启；5 向量 |
| llama loopback（88ab6f6f）| 🟢 已落·细节走管道 | 三启动路径 `0.0.0.0`→`127.0.0.1`；暴露面细节不进公开 git |
| llm-fallback 默认 URL（e3154dce）| 🟢 NWT GREEN·已推未部署 | tier-1 无-agent 默认 `:3020`(stale)→活解析 `:3031`；生效需重启 |
| 维护窗 runbook（`scratch/_postsync_maint_window.md`）| 🟡 v0.4 定稿中 | 花钱面**两类全冻**：定时器（10 条表·等 tick 落）+ **请求/消息触发**（broker 提现/exchange auto-pay/bettor API·停 relay 挡 egress + drain 稳定窗 60s）；NWT 三眼过 |

## D-STAT 三条 CLOSED（设计层）— 同 v3（不重述，见 v3 §🆕 表）
- **验收角色**（Codex 283 §2）：(A) 重建+证书 / (B) `bitsCalc==收块bits` / (C) 断言+自喂剔除+负向量 = 生产验收；(D) `N_small=12` = 引理/回归机器检验（写死是 feature）；(E) 贪心 = 仅 smoke。
- 🔴 **w_cap 取数/重建【实现】= OPEN**：真 RPC 路证四闸（分页完整确定 / sink-anticone 无闭包洞 / 缺失-剪裁-IBD 必 INEXACT 绝不成更小窗 / t0-t1 同接收时钟）——(24) v0.2；**须等本机节点 READY**（单节点 da9；younio S0 Modern Standby 未同步完，不作第二 vantage）。

### 🔴 Scope（Codex 283 §3·原话，Owner 须读，不变）
- **英**："D-STAT-3 closes the work-per-public-arrival cap construction under exact reconstructed public state; it does not eliminate the adversarial-capacity model boundary."
- **中**：闭"每公开到达 work 上界构造（**在精确重建公开状态下**）"；**不消除**对手容量模型边界（私链/withheld/反事实/可用性 ⇒ 归 `B_adv` 或 fail-closed）。

## (a)–(h)/P3 门表（相对 v3 仅 (d) 的 B_adv 从"待 Owner"→"Owner 冻结语义"，余同 v3）
| 门 | 状态 | 剩余 |
|---|---|---|
| (a) buildability | 🔴 OPEN（J1 域） | 真续链 tx 上链 + 阴性 REJECT + 钉 runtime |
| (b) A2-whole→结算腿 | 🟡 OPEN（执行闸，判据冻） | 真 covenant + 套件机械执行 + 逐格拒因 |
| (c) cov_id durable | 🟡 (c)-1 CLOSED / (c)-2..6 OPEN | 续链上链五项 |
| **(d)** 具名地板 + reactive-liveness | 🟡 **OPEN-PROVISIONAL（结构闭 + D-STAT 三条设计层 CLOSED + `B_adv` 语义 Owner 冻结）** | **六项残余 + w_cap 取数实现四闸 + Owner 给 `H_adv_cap`/`H_total_ub` 具名**（`B_adv` 语义已冻，硬值等实测）+ 同步后实测 |
| (e) quorum 独立性 | 🔴 OPEN（真金前硬闸+Owner §10） | §10 落地（GO 已批）+ 可复现测量 + 部署时现跑 |
| (f) 跨链 | 🟢 非阻塞（scope fail-closed） | ctor 硬断言+负测（落码） |
| (g) P1 toolchain | 🟢 CLOSED | — |
| (h) Shape-B 变异套件 | 🟢 CLOSED AT DESIGN LAYER | 机械执行=真 covenant 后 |
| P3 fee-source | 🟢 PASS（设计），(a)/(b) 二选一待 Owner | — |

## Tier-2 定位（不变）
🔴 §6-3 Tier-2 fair-exchange 现网禁用 = **结构性**（无码/无 covenant/无开关），非翻开关。⇒ (23)/(21)/(24) 算力地板/k_max/取数 = **未来 (b)-实现的入场闸设计要求，非现网运行时控制**。`B_adv` Owner 冻结不改变这个"结构性关"——现网单矿工 ⇒ fair-exchange 两侧 cap 一侧给不了 ⇒ 关（任何 `B_adv` 值都不改）。

**一句给 Owner**：**三决已落（§10 开工·`B_adv` 语义冻结不钉数·watchdog v0.3 批），仅 §6-1 ⑥ 推翻 (527) 一件仍待你**；§10 由 J2 逐 commit 落码、NWT 每 commit 红队；D-STAT scope 记牢（只闭精确公开状态下每到达 work 上界，不消对手容量边界）；w_cap 取数实现与 (d) 非 D-STAT 项仍 OPEN，**须等本机节点 READY**。四补丁/维护窗在稳态化 8/23 崩，全非门非钱路。**全程零 build/deploy/money-path 授权。**

**引用锚**：`docs/DECISIONS.md` D-013（Owner 三决）；Codex MSG-279→283（D-STAT 六轮）；(23) v0.15 OWNER-FREEZE / (21) v0.9 / (24) v0.2 / (d) v0.17；v3 表 `docs/2026-08-27-nwt-s63-gate-status-refresh-v3.md`；四补丁 j1-patch/c95acecd/88ab6f6f/e3154dce；维护窗 `scratch/_postsync_maint_window.md`。
