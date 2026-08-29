# NWT 对拍 — T+0 派工稿 vs gate (a) 真链卡（缺口/冲突/改法）

> NWT · 2026-08-29 · 只读对拍 · A = `scratch/_bettor_msg284/t0-dispatch-draft.md`（含 12:5xZ 追加的卡指针）· B = `docs/2026-08-29-nwt-gate-a-onchain-acceptance-card.md`（`507f7e6d`）。输出给 Bettor 改稿到一致，READY 前定稿。

## 🔴 冲突 1（承重）— 读写范围冲突：第一小时是【只读】，gate (a) 是【广播】
- **A 铁律**：`只读 RPC；④/④' 转账前置与 Owner GO 不在本轮`。整个 T+0…T+125 = 纯读、零钱、零广播。
- **B 实质**：N6–N9/P **必须广播** —— 先给 `recovery_daa` redeem 地址**注资**一个 dust `SUCC_UTXO`（一笔 spend），再**提交** N6–N9 tx（读拒因）、**提交** P 并等落链。这是 **relay 签名+广播的写路径**，不是只读 RPC。
- ⇒ **gate (a) 不能跑在只读第一小时窗内**。A 的追加段"T+0 派 J2 时随稿附上 / J2 照卡跑"**位置错**——它读作"T+0（只读窗）里跑 gate (a)"，与铁律直接撞。
- **🔴 我 owns 我卡的 §0 也错**：B §0 写"只读 RPC + 尘埃级探针金额"——**self-contradictory**（N6–N9/P 明明广播，§1 已写"广播段"）。**改法**：B §0 改为「**广播段**：relay 签名广播 dust 注资 + N6–N9/P 提交 + P 落链；**须 dust-spend Owner GO**；与只读第一小时**分窗**」。
- **改法（A 侧）**：把 gate (a) 从"T+0 随稿"移出，列为**独立广播轮**，序 = **只读第一小时之后、维护窗 broker 批之前**（见下 §6 = 你裁定"gate(a)真链先"的正确落位）。

## 2. 步骤顺序 / 依赖
- A 主体 T+0…T+125 = **gate-d/经济核第一小时**（③a 三闸 / ③b err 基线 / ③c H_total_lb / ③d 3600s wcap / ③f 四闸 RPC / ③e 汇总）——**与 N6–N9/P 无步骤重叠**（不同门）。
- B 的 N6–N9/P **在 A 的时间线里没有槽**。**改法**：gate (a) 广播轮自带内部序：**注资 UTXO → N6/N7/N9（tip 任意，可立即）→ N8（tip≤E 立即提交）→ 等 `tip DAA > E`（E=daaScore+n_probe，n_probe=100 ⇒ 约 100 DAA ≈ 分钟级）→ P（同 N8 字节，此时提交）→ successor 续继 + 深度**。这一串独立于 wcap 3600s 窗，不必等第一小时跑完。

## 3. INCONCLUSIVE 重投：次数/间隔谁定 = 缺，我补
- B 只写"INCONCLUSIVE 重投"未定**上限/间隔**。**改法（B 补，NWT 定）**：每向量 **≤3 次重投**，每次**必先修**噪声因（fee/mass/standardness/orphan），**非盲重投**；3 次后仍 INCONCLUSIVE ⇒ **停、报 Bettor**（记原始 err + 重投计数），**不烧窗不循环**（stop-rule 6 同源）。间隔 = 修好即投，无固定 sleep。

## 4. 谁跑/谁核/谁写读数（gate (a) 角色要拆）
- A 模型：J2 跑第一小时+写读数、NWT 审、KANet-UI 并行 step0/服务恢复；读数纪律"自跑写数/别人标未核"。
- B 的 gate (a) **角色须拆三段**（A/B 都没写清）：**构造** = J2（离线，已在 probe v0.3 定字节）；**广播** = **提权 operator（relay 签名）**——J2 只读、**不能广播**，故须 Bettor 指派提权人（同 deploy 执行人模型）；**回读+逐格判** = NWT 按卡。**改法**：A/B 都标"gate (a) 广播由提权 operator，J2 供构造、NWT 判"。

## 5. 证据命名 / sha 钉法
- A：③e 汇总 `docs/2026-08-27-j2-postsync-first-hour-evidence-v0.1.md` + `runs/` + 每文件 sha256（gate-d 树）。
- B：`docs/provenance/<date>-gate-a-onchain/runs/gate-a-<Nx>.json` + `MANIFEST.sha256`（gate-a 树）。
- **一致性**：两套都 `runs/`+sha256+一页汇总，**但是两棵独立证据树**（不同门，别塞一份汇总）。**改法**：统一"每 `runs/` 一个 `MANIFEST.sha256` 覆盖全量、`sha256sum -c` 复核"的口径；gate-a 走 B 的 provenance 路径、gate-d 走 A 的 evidence 路径，互不混。

## 6. 第一小时该做/不该做 + 维护窗①-⑥ vs gate (a) 先后（你裁定的正确落位）
- **只读第一小时（T+0…T+125）**：gate-d 证据 + KANet-UI 服务恢复（不重启 console）。**不广播、不转账、不迁移、不启 watchdog**（A 已列全）。**gate (a) 不在此窗**（冲突 1）。
- **⇒ 三段序（改法）**：① **只读第一小时**（gate-d，无 GO）→ ② **gate (a) 广播轮**（dust 注资+N6–N9/P，**须 dust-spend Owner GO**，提权 operator 跑、NWT 判）→ ③ **维护窗 broker 批①-⑥**（batch-1→batch-2，**Owner 批钱路**，另排）。
- 你裁定"gate (a) 真链先、维护窗 Owner 批后另排" = **正确**，落位 = gate (a)（②）在维护窗（③）**之前**；但 gate (a) 本身是**独立广播轮**、**不塞进只读第一小时（①）**，且它自己也要 Owner 的 dust-spend GO（虽非结算钱、仍是链上写）。

## 7. READY 判定互证（_step0_gate.mjs 三闸 vs KANet-UI D 行）
- A：READY = J2 `_step0_gate.mjs` verdict=READY（sync_ok/daa_ok>80,095,687/ibd_ok）；KANet-UI 并行也跑 step0。
- **互证方式（缺明写）**：两个独立信号——J2 `_step0_gate.mjs` 全 JSON + KANet-UI 的 D 行（`getBlockDagInfo` 派生）——**须都判 READY 才 T+0**；不一致 ⇒ 停、查（谁的节点句柄/daa 陈）。**改法**：A 明写"READY = 两信号一致"；B §0 的 READY 前置**引 A 的两信号**（现只引 `_step0_gate.mjs` 单信号）——gate (a)（②）继承第一小时（①）的 READY，不自行单信号判。

## 结论（给 Bettor 改稿点）
1. **移 gate (a) 出只读第一小时** = 独立广播轮（②），三段序 ①→②→③；2. **修我卡 B §0**（只读→广播段+dust GO）；3. **补 INCONCLUSIVE ≤3 修后重投 + 停报**（B）；4. **拆 gate (a) 三角色**（构造 J2 / 广播提权 / 判 NWT）；5. **两证据树各自 MANIFEST**、不混一页；6. **READY = 两信号一致**（B §0 引双信号）。改完 A 与 B 一致，READY 前定稿。
