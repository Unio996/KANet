# NWT 红队 — 2026-09-04 Bettor 拉起决策审 + ledger (791) 两裁定 + gate (a)/T+0 卡预热

> NWT · 2026-09-04 13:2xZ · 会话 `NWT智能体会话启动 [f0336b]`（claude.exe PID 10060·Bettor `kanet-tn12-1c [4a17db]` 13:19:10Z 拉起）· 依据 seed `scratch/_bettor_relaunch_seed_2026-09-04.md` NWT 段 + Owner 8/26 令（ledger (624)：Bettor 起人/重启决策须 NWT 按班审）。
> 读数纪律：下列全部为**我亲手跑**（进程表 CIM / `git` / 文件 `cat`）；引用别人的一律标「未核」。七条审查准则（`docs/2026-08-06-nwt-seven-review-criteria-v1.0.md`）逐条对应见 §5。

## 0. 结论一眼

| # | 对象 | verdict | 承重 push-back |
|---|---|---|---|
| ① | 13:19Z 拉起决策（supervisor 日志三行 + launcher 两处改动） | **PASS-with-push-back** | 决策本身（Owner 令、非钱路、可逆、绑定可重建）过；**可审计性**四处缺（日志无 PID/seed sha；盘上 dry-run 产物是修前的坏版；默认上级 ref 硬编码会随 Bettor 重启陈；seed 裸日期无口径标签） |
| ② | (791) 采纳 Codex 33bf86ad「~09-09 非下界」 | **PASS（口径）· push-back（数）** | 标签改对了，**数没重算**：784 的推导（09-02）之后发生了 789 的计划外 header 相位（3.73h·lag+2h），无人折进去；~09-09 今天仍成立是**两个误差相抵**（收敛比 34.9 快 ↔ 789 罚时），不是推导结果 |
| ③ | (791) J2 身份 HOLD 至握手 ∧ ListAgents 可见 | **PASS（裁定）· push-back（判据措辞 + 账本记录）** | 写出来的判据（自报块号 + ListAgents 可见）**本机任何会话都能满足**，绑定不到「Bettor 拉起的那一个」；Bettor 实际做的（launcher→窗口→claude.exe 进程祖先链 + PID）才是真判据，但 (792) 一个 PID/ref/session-id 都没记 |
| ④ | gate (a) 卡 + T+0 对拍卡预热 | **坐标全部复核通过 · 1 条 READY 前必修** | T+0 稿 T+15 依赖的 `wcap-run.mjs`（及 `wcap-fetch.mjs`）**不在 tracked 树**，只在 gitignored `scratch/_j2_kmax_v010_staging/`；`kmax-cost.mjs` tracked = v0.9.2（头注释陈写 v0.8·我首版误报已更正）、v0.10 同样只在 staging ⇒ 派单前须落 provenance（J2 报备已到·我审中）|

---

## 1. ① 拉起决策审（`logs/bettor-supervisor.log` 1094–1096 行 + `_bettor_launch_agents.ps1`）

### 1.1 我核到的事实
- 日志三行（逐字 grep `relaunch-owner-0904-all-agents-closed`）：`13:19:08Z agent=J2` / `13:19:10Z agent=NWT` / `13:19:11Z agent=KANet-UI`，各带 `bettor=kanet-tn12-1c [4a17db] ledgerMax=791 handoff=<接位文件>`。
- 进程表（CIM，13:2xZ 我跑）：

| agent | claude.exe PID | 起 | 父 powershell.exe | 父起 | 祖父 |
|---|---|---|---|---|---|
| J2 | 33972 | 13:19:09Z | 11272 | 13:19:08Z | 25700 |
| NWT | 10060 | 13:19:10Z | 21848 | 13:19:10Z | 25700 |
| KANet-UI | 14716 | 13:19:12Z | 34404 | 13:19:11Z | 25700 |

  三个窗口共祖父 25700，起时与日志三行逐秒对上 ⇒ **日志 ↔ 进程绑定成立**（这是我重建的，日志本身没给）。
- 三个 claude.exe 命令行（len 696/698/708）里 `然后读 D:\kanet-tn12\scratch\_bettor_relaunch_seed_2026-09-04.md` **路径完整**（我按 `IndexOf('然后读')` 截出）⇒ 真起的 seed 是修后的。
- launcher 两处改动（792 自述·我对照文件）：`$BettorSession` 默认 `'kanet-tn12-1c [4a17db]'` ✅；seed 陈句已换为「读 785+791，再读对齐单；频道 IBD 期 send 500 报到走 SendMessage」✅。文件 `_*` 前缀 gitignored，无 git 历史可差分（`feedback-hash-detects-change-but-cannot-support-a-differential` 同族：只能对照 792 自述）。
- 6 个未跟踪脚本 `kasia-console/check-*.mjs` + `snapshot-baseline.mjs`：我通读——全部 `better-sqlite3 readonly:true`，查 `broadcast_messages` / `chain_events` / `config_entries(scanner)` / `scout_checkpoint` / `kanet_message_index`；grep `INSERT|UPDATE|DELETE|writeFile|fetch|http|exec` = 0 命中 ⇒ 只读诊断，内容像在查「频道为什么死」。非我的；归属由 J2 答（seed 已派）。

### 1.2 push-back（按承重排）
- **P1（可审计性）日志行没有绑定物**：`Start-Process … | Out-Null` 丢弃了进程对象，日志只有 Reason/agent/bettor/ledgerMax/handoff，**无窗口 PID、无 seed sha256、无 launcher 文件 sha**。今天我能靠秒级起时把三条日志和三个进程对上，纯属进程还活着；下次「拉起后 5 分钟会话死了又被人手起一个」这种情形，日志分不出哪个是 Bettor 起的。修法（launcher 改动·Bettor 工具非产品码·报备即可）：`$p = Start-Process -PassThru`，日志行加 `winPid=$($p.Id) seedSha=<sha256(seed)>`。
- **P1（证据与记录不符）盘上 dry-run 是修前坏版**：`scratch/_dryrun_seed_check.txt`（13:18:34Z）渲染出的 seed 是 `然后读 -09-04.md`（反斜杠被吞·Reason 还是 `relaunch-owner-0904`），而 (792) 写「dry-run 渲染核过路径才起人」。结论正确（进程命令行证明），但**留在盘上的证据反着说**。修法：用最终脚本重跑 `-DryRun` 覆盖该文件，或 (793) 注明「盘上 dry-run 为修前版·证据 = 进程命令行」。
- **P2（结构）默认上级 ref 硬编码**：`kanet-tn12-1c [4a17db]` 烤在 launcher 默认值里。Bettor 每次重启 ref 都变（786→791 就换了两次），launcher 没有任何「目标可达」自检 ⇒ 下一个忘改的人会把三个新会话送到死地址——正是 791 记的 [2fef14] 失联形。修法：拉起前 `ListAgents`/自查当前会话名，不匹配即拒起；至少在日志行记 `bettorSession` 的 session-id（`from=` 里那个 `session_…`）而非只记名字。
- **P2（口径）seed 裸日期**：seed 原句「节点仍 IBD，READY 约 9月9日」**无口径标签**，与 (791) 自己立的统一口径（`~09-09 = 条件规划中心估计·工作区间 09-08~09-11`）相悖；三个新会话第一眼读到的就是裸日期（`feedback-report-eta-with-caliber-labels-optimistic-lowerbound-vs-planning-baseline`）。修法：seed 里写「READY ~09-09（条件规划中心估计·非下界·以 BOTH_READY 实态为准）」。
- **P3（陈句再生）**：seed 硬编码「第 785 块是 handoff 总纲、第 791 块是最新现状」——下次拉起就陈（与本次刚换掉的 8/23 陈句同族）。修法：只留 `$maxBlock` 派生，总纲块号从 `scratch/_bettor_relaunch_seed_*.md` 头部读或去掉。

**verdict ①：PASS-with-push-back。** 决策层无异议（Owner 令 · 非钱路 · 不动节点/console · 三人只读派工）；push-back 全在「下次能不能审」。

---

## 2. ② (791) 采纳 Codex 33bf86ad：`~09-09` 非下界

### 2.1 我试的攻击
- **攻 Codex**：「下界」在 784 的语义是 J1 的「不含新停滞/密度突变/第三段相位」= 乐观下界（只排除变坏的因素）。但 784 自己的推导含两个可**双向**动的量：收敛率取 33.5–36.3 中值 34.9（实测相位后 36.3 更快 ⇒ 更早）、剩余 header 相位「~2.9 轮 ⇒ 2 段」是外推（可能 1 段 ⇒ 更早）。两个量任一朝好的方向动，日期就早于 09-09 ⇒ **09-09 不是数学下界**，Codex 拒绝该标签**成立**。我打不穿。
- **攻 Bettor 的采纳**：采纳只改了标签，**没有重算数**。784 推导时点 09-02 07:57Z；之后 789 记了一段**计划外** header 相位（20:27Z→00:11Z·3.73h·lag 68→70h·块零推进）——按 784 自己的相位成本模型（时长 + lag 增 + 丢收敛 ≈ 净 10–14h/段），中心应后移约半天；(791) 说「3.73h 重连段已证相位成本须实测不能照抄」，然后**照旧写 ~09-09**。
- **今天的读数（我读 `scratch/_ibd_monitor.log` 13:20:18Z 那一行·KANet-UI loop 重起后首行·单样本非趋势）**：

| 量 | 值 | 换算（自 13:20Z） |
|---|---|---|
| lag | 63h | — |
| lagETA(READY,cum) | 96.1h | 09-08 13:26Z |
| lagETA(READY,6h) | 113.3h | 09-09 06:38Z |
| 剩余 round header 相位 | 0–2 段（784 外推） | +0 … +28h |

  ⇒ 纯收敛落 09-08 13Z–09-09 07Z，加 1 段相位落 09-09 04Z–09-09 21Z。**~09-09 今天仍站得住，但站在两个误差相抵上**：收敛跑得比 34.9 快（cum 口径折合 ≈39 lag-min/h）刚好吃掉了 789 的罚时。这不是「模型稳」，是「模型没更新、恰好没被打脸」。
- **攻「工作区间 09-08~09-11（保留既定假设时）」**：784 只断言了区间，没推导。用 784 的假设（率 33.5–36.3 × 相位 0–2 段）从今天算，上沿到 09-10 10Z 左右，**09-11 不是那套假设产出的**。作为保守余量可以，作为「保留假设时的区间」是错标。

### 2.2 verdict ②
- **口径采纳：PASS**（Codex 的 refute 我复核成立；「下界」两义混用是根因，停用正确）。
- **push-back（P1）**：`~09-09` 须标「784 推导·未折 789 相位段」，或由 J1 用两段**不重叠**的 789 后窗 + 显式剩余相位段数重推（`feedback-do-not-refute-a-trend-claim-with-a-single-instantaneous-reading` 对偶：我上面 13:20Z 单样本也只作对照，不作新中心）。
- **push-back（P2）**：区间标签改「09-08~09-11 = 保守工作区间（含未建模停滞余量）」，别写「保留假设时」。
- BOTH_READY 只看 S1 ∧ S2 实态不看日期——这一条 (791) 写对了，我无异议。

---

## 3. ③ (791) J2 身份 HOLD 至握手 ∧ ListAgents 可见

### 3.1 我试的攻击
- **判据可伪**：写出的两条——(a) 自报「ledger 最大块号 + READY 口径 + 会话地址」、(b) Bettor 在 ListAgents 看得见——**本机任何一个能读仓库的 claude 会话都满足**：块号是 `grep '^### (' COORD-LEDGER.md` 一条命令；ListAgents 可见只证「本机存在一个会话」。旧 Bettor `[e325ed]`（08-29 起·bg）此刻就在 ListAgents 里；一个 08-26 的旧 J2 会话若没被真关，同样「可见 + 能自报 791」。
- **名字不是身份**：ListAgents 名由首条 prompt 派生、**不唯一**。现成的对照：Bettor 会话在我的 ListAgents 里叫 `kanet-tn12-1c [4a17db]`，它给我的 SendMessage 头却是 `from-name="Bettor接位智能体开发" from="bridge:session_01P5CS…"`——**同一会话两个名**。唯一稳定的是 `session_…` id 与 `[ref]`。
- **Bettor 实际做的比判据强**：它回我「PID 10060 = 我 13:19:10Z 拉起」——这是进程祖先链绑定（claude.exe ← powershell 窗口 ← 25700），和 §1.1 表一致。**这才是承重判据**，但它没写进 (791)/(792)，(792) 也**一个 PID / ref / session-id 都没记**——下周有人问「T+0 证据页是哪个会话写的」，账本答不出。
- **后果域**：第一小时只读，钱路零风险；但 T+0 产出是 **provenance 承重**（`runs/` + `MANIFEST.sha256` + 「single-node evidence」证据页）——作者错 = 证据出处错，不是「没损失」。

### 3.2 我核到的 J2 握手（供 Bettor 对照·非替它裁）
- ListAgents：`J2 开发智能体报到 [561bd8]`（Remote Control·running）；进程：claude.exe 33972 起 13:19:09Z，命令行含 J2 接位提示词与完整 seed 路径，父 11272（13:19:08Z）← 25700 —— 与日志第 1 行 `13:19:08Z agent=J2` 对上。**J2 的绑定我这边独立可证。**

### 3.3 verdict ③
- **HOLD 裁定：PASS**（Owner 说起了 ≠ 身份；一个派单 writer；fail-closed 方向对）。
- **push-back（P1）判据重写**：握手 = (1) launcher 日志行 ∧ (2) claude.exe 进程祖先链到该行的窗口（PID + 起时秒级对齐）∧ (3) 来信 `from=` 的 session-id 记账 ∧ (4) 自报块号 ≥ ledgerMax。(a)(b) 只是必要条件。
- **push-back（P1）记账**：(793) 补三人各一行 `agent / claude PID / 起时 / ListAgents 名+ref / from session-id`。Bettor 已经核了，只是没写。
- **push-back（P3）**：launcher 一并记 winPid（见 §1.2 P1），握手时就能机械比对而不是靠秒级起时目测。

---

## 4. ④ gate (a) 验收卡 + T+0 对拍卡预热（坐标复核）

| 引用 | 现状（我核）| 判 |
|---|---|---|
| `kasia-relay/src/lib/cltv-locktime.mjs:90 classifyLockReject` | 行 90 起四正则：`mismatched locktime types`→domain_mismatch / `locktime requirement not satisfied`→not_yet / `transaction input is finalized`→sequence_max / `transaction input #\d+ is not finalized`→not_finalized；其余 `inconclusive` | ✅ 与卡 §1/§2 逐字一致 |
| `kasia-relay/src/lib/tx-mass-ub.mjs` | tracked（+ `.test.mjs`） | ✅ |
| `build.harness.v03.mjs` | tracked `docs/provenance/2026-08-29-s63a-probe-v03/` | ✅ |
| 探针 script sha `31d506a9…` / `e6e9c073…` | README §1 行 11/12 在 | ✅ |
| (24) claim-depth 采样器 | tracked `docs/provenance/2026-08-27-claim-depth/` | ✅ |
| (23) `s_visible_max` 提取器 | tracked `docs/provenance/2026-08-27-smax/smax-extractor.mjs` | ✅ |
| (21) `kmax-cost.mjs`「v0.9.2 durable」 | tracked 版 **= v0.9.2**（`4703bcc0`·sha `083e058a`）——**头注释仍写 v0.8 是陈的**（我首版据头注释误报「tracked = v0.8」，13:5xZ 按 git log + sha 更正）；v0.10 只在 gitignored `scratch/_j2_kmax_v010_staging/` | 🟡 头注释陈；v0.10 非 durable |
| `wcap-run.mjs`（T+15 3600s 窗） | **只在 `scratch/_j2_kmax_v010_staging/wcap-run.mjs`**（08-27·未跟踪） | 🔴 非 durable |
| `mass-bound.mjs`（卡 §0 fee 地板数出处） | 只在 `scratch/_j2_gate_a/`（未跟踪） | 🟡 卡引了未钉 sha 的脚本 |
| `_step0_gate.mjs` | `scratch/_step0_gate.mjs`（08-28）在 | ✅（scratch 但 Bettor/KANet-UI 都在用·两信号之一） |
| D-016 状态 | gate (a) OPEN；builder HOLD/未接线；MUST-FIX（sequence 上界、零延迟、config entry/max、TG-1~4）全 CLOSED at code layer；gate (a) 路径用 sequence 0 | ✅ 卡假设未失效 |

- **READY 前必修（P1·派 J2·NWT 审）**：T+0 稿 T+15 步依赖的 `wcap-run.mjs`/`wcap-fetch.mjs` 与 v0.10 `kmax-cost.mjs` 要么落 `docs/provenance/` 带 MANIFEST（staging 里 `MANIFEST-v010.draft.sha256` 已是草稿），要么稿里改成「v0.9.2 tracked + v0.10 staging（非 durable·路径 `scratch/…`·sha 钉）」。现在是稿写 durable、树里没有——J2 新会话按稿找工具只能找到 v0.9.2，跑不出 v0.10 的 fetch-evidence。（更正：本条首版写「tracked 只有 v0.8」，错——头注释陈；tracked 实为 v0.9.2 `4703bcc0`。）这正是 seed 派 J2 的「确认 v0.9.2 工具就位」那条，我先把答案钉在这。
- **我自己卡的修正（P3）**：§0 引「我实跑 `mass-bound.mjs`」应补 sha256 + 路径；READY 后 fee 地板须**重跑**（当时 SEED=1 KAS 的 G1≈0.040/R1≈0.040/P≈0.0078 是 08-29 数）。
- 三段序（只读第一小时 → gate (a) 广播轮须 Owner dust GO → 维护窗）与 seed §1 一致，无冲突。

---

## 5. 七条审查准则对应
1. 工具先验证：进程表用 CIM 非 Get-Process（ANTI-PATTERNS 75）；grep 逐字短语。2. 主语匹配：每条 verdict 写清是裁「决策」还是裁「可审计性/措辞」。3. 独立佐证：J2 握手我独立从进程表证（§3.2），不引 Bettor 自报。4. 预注册判据：③ 的判据重写是加严不是事后放宽。5. 观察量随行为同批变：② 用 13:20Z 同一行的 lag/lagETA，不跨样本拼。6. 结构论证与实证分开标：② 「两误差相抵」是结构论证，13:20Z 是单样本实证，已分标。7. 位置精确：文件:行 / PID / 时间戳全给。

## 6. 本审边界
不授权任何代码/配置/进程/钱路变更；launcher 修改属 Bettor 工具，按铁律 0 报备即可（非产品码）。频道 IBD 期 send 500，本稿交付 = 本文件 + SendMessage Bettor + Bettor 转 ledger (793)。
