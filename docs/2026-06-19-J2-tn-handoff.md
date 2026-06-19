# J2-tn 接位文档（settler / mass 域 + 2nd-vantage co-verify）

> 写于 2026-06-19 by Bettor-tn（协调者，刚重新接位）。团队重新聚拢、对齐后再出发。**先全读再动手。** 姊妹文档：`docs/2026-06-19-KANet-UI-tn-handoff.md`（同批写）。旧的 `2026-06-15-*-handoff.md` 已**整体过时**（通篇 gate B #31 / #27a / batch2.2，全部 superseded），别照旧的跑。

---

## 0. 你是谁 / 你的角色（不可越界）

你是 **J2-tn**，团队的 **settler / mass 域 owner + 2nd-vantage co-verifier**：
1. **settler / 结算 / 质量(storage-mass)域** —— 你 own settler 逻辑、computeSettleChunks、dispatchPhase2、payoutRoot/fold 构造、880 墙 / storage-mass 阈值（`STORAGE_MASS_SAFE_THRESHOLD`）。链上"钱怎么算、怎么分、会不会撞 mass 限"是你的地盘。
2. **2nd-vantage co-verify** —— 跟 NWT 常配对做独立验证（2 个 vantage 抓 byte-equal / 守恒 / drift）。
3. **oracle 判定的工程侧** —— 你 own 生产 `deriveVote` 的 canonical prompt（线 E 单源）+ A-ramp 现成字段抽取（spread/total）+ settler 记实际值（oracle reward / maker payout）。
4. **NOT git 写者 / NOT operator** —— 你不写 git、不部署（那是 KANet-UI 单写者域）。你出码贴 diff 给 Bettor 审 → KANet-UI 部署。read-only git。

**relay 身份（频道发言用）**: `relayId = 102cbb99-...`（name=J2-tn，完整 id 查 `relay_nodes`，别凭记忆瞎填 UUID 尾段）

---

## 1. 当前真实状态（2026-06-19，别信旧 handoff）

**已闭环（不要重做）**:
- **W1 = DoD #5 用户路机制闭环 PASS**（2026-06-16）：电报 bot 用户 `/bet` v0.7 → register 落链 → 跨节点 5/5 自主委员判 → settle `6460bae0` 落链 → winner 实收 7.16 KAS(+43% 非 refund)。403 voter-flood 根治（commit `432ba9d8` = per-URL FINAL-evidence cache）。诚实定语：bettor 是内部 AutoBetter-1，非真外部冷启动人。
- **bshard（人数无限制 / unlimited-betting）= 设计 sound + 零件全绿 + 被 Owner PARK（post-demo）**。**e2e 从没跑通**：`market_shards = 0` 行、零 v0.8 市场上链、orchestration 层 3 个 builder 零 caller、claim/seal 在 PoolRoot(2285B/87B 7-field) 仍撞 spend-unit 限。route-split（PoolLeaf 36B + PoolRoot 87B）是解 9999 硬限的尝试。

**本会话(06-17~19) Bettor 做的运维稳定**（背景，KANet-UI 域，你知道即可）：tn12 节点重启上线 + KANet 全栈起 + tg-bot 修复（假活 poller 死）+ 世界杯市场多 agent 押注激活（10 市场两边活跃，74 笔上链）+ **relay 连接泄漏风暴根治**（单 relay 泄 957 条 ws 钉死 kaspad:17210 → 广播 ingest 失效；杀泄漏 relay PID 后 2368→44 连接）。

**频道状态**: dev-coord-testnet 从 06-16 02:07 STAND DOWN 后静默至今。现在 Owner 重新聚拢团队。

---

## 2. 接下来两大任务（Owner 钦定，对齐后出发）

### 任务一：测试人数无限制（= bshard e2e 跑通）
- **这是你的核心域**（settle/payout/fold/mass）。bshard e2e 的 blocker 全在你地盘：
  - **orchestration 没接线**：3 个 builder（genesis/register/close/claim）零 caller —— 机制层从没串起来跑。
  - **PoolRoot spend-unit**：close/claim 在 7-field PoolRoot 仍可能撞 9999 限（本会话记忆 `feedback-spend-units-must-be-probed-not-modeled`：spend units 禁估、必造 controlled probe 链上实测，register@493B 跑通是 SIZE-BOUND，claim/seal 在 2285B 仍 bust）。
  - **已知硬限制（documented，非 bug，testnet 可接受）**：L1 claim 串行（Kaspa 无 ref-input）/ L2 payout 委员信任（i64 乘法溢出，off-chain BigInt 算 payoutRoot 委员背书）/ L3 winner cap merkle depth 16 = 65536/market。见 `docs/2026-06-15-bshard-known-limitations.md`。
- **你接手第一步**：跟 Bettor 一起把 `kasia-console/scripts/bshard-e2e-run.mjs`（首跑驱动，自述 "MECHANISM FIRST LIVE RUN, first-run bugs expected"）**真跑一遍**，定位它实际卡在哪一相（genesis / register×N / close committee 4-of-5 / claim serial / root_final==0）。**先 probe spend-units 链上实测，别凭模型拍**。
- **方向先确认（Bettor 已向 Owner 提）**：人数无限制是不是公测开门 DoD 必需？如果不卡开门，优先级可能低于 oracle。**别埋头先烧 e2e，等 Owner 定它在 critical path 的位置。**

### 任务二：完善预言机（域信息源白名单 + 判断构造 → 固化成 oracle 技能）
- **你的 oracle 工程侧 slice**：A-ramp 现成字段抽取（spread/total 从 ESPN feed，gateE-spread-total harness ramp 到 ≥90% 放行）+ deriveVote canonical prompt 单源 + settler 记实际判定。
- **守 Owner 5 终裁（`project-oracle-consensus-launders-poison-rulings`）**——承重墙：4-of-5 共识防节点故障/共谋，**不防坏输入**（共识把毒洗成全票合法 settle）。所以**信源白名单是一等公民**，判断本身能确定性就确定性（D-L1 比分算术）、判不了就弃权（abstain-not-guess）。
- **关键 gating**：白名单里**新增"活源"进 settle = 必须 Owner 批 + 冻结共享快照**（否则破 determinism + 扩攻击面）。**安全第一波 = 零新攻击面**（D-L1 确定性判 / A-ramp 现成字段 / E deriveVote 红队 / C-RECON）。更难的"多源进 settle"(B) = 真对抗设计讨论达共识再落码，不在第一波。
- **别从零 re-scope**：build on 既有 charter + 5 终裁 + capability-staged-expansion + UMA-rule-learning + shadow-accuracy-harness（`scripts/gateE-shadow-accuracy.mjs`）。Bettor 倾向**先单域吃透（sports）做出技能模板**，框架从模板长出来。

---

## 3. 你的工程方法论（硬纪律）

- **spend-units 禁估** —— 链上行为铁律：禁凭 2 锚/模型拍 spend units（∝bytes vs fixed/count 之争只能链上 differential probe settle）。造 controlled probe（只变一维）实测，accept(landed)=units<limit 也是信号。
- **fixture 必复刻 production 输入** —— 理想化/均匀 fixture mask 真 bug（#31 全 1KAS 均匀 fixture mask 了 ORDER BY stake_amount 跨节点 fork + parimutuel 非 uniform 两个真 bug）。测前问"输入跟 production 完全一样吗"。
- **实读实际 code 非凭理解 canonical** —— determinism 序/排序/索引落断言前必 grep 真行（#31 实读 settler L232 `ORDER BY stake_amount ASC` 才抓到 tie 序不定 = fork 命门；"凭理解 canonical"是隐蔽的猜）。
- **NO TX NO STATE CHANGE** —— 广播/TX 没上链 = 什么都没发生，不准推进本地状态。
- **跨节点 whole-repo sync 非 cherry-pick** —— determinism-critical 码跨节点部署必整 repo 同 commit 同 tree（漂移只在 edge-case 暴露、landmark 测 mask 它）。
- **settler 记实际值** —— broker fee→metadata / oracle reward→oracle_history.reward_amount(SOMPI) / maker payout→metadata。committeeMode(v0.7) pays 全委员 uniform oracleFeePerSig（4-of-5 只是签名 threshold 非 payout）。

---

## 4. 拓扑 & 技术坐标

- **:3200 节点 = 本机** Console（你 + Bettor + NWT + KANet-UI 都在 :3200 这一个 Console 上交互）。Owner 在这台。
- **:3300 节点 = J1 的独立机器**（LAN，自己的 kaspad + Console，互不可达，J1 own）。跨节点验靠对比双方数据或 relay check_utxo_landed 走 :3200 kaspad 看整链。
- **共享 working-tree** = `D:\kanet-tn12`（你和 Bettor/NWT/KANet-UI 同一棵树同一 git 身份 → KANet-UI 单写者纪律的根因，你 read-only git）。
- **Console DB**（:3200，readonly 查）= `D:\kanet-tn12\kasia-console\data\console.db`（better-sqlite3）。
- **kaspad**（:3200 本地）= `ws://127.0.0.1:17210`（tn12）。链上验证用 relay `check_utxo_landed`（POST /api/relay/:id/send-command），别用挂掉的公链 API。
- **关键表**: `pool_markets`(id/protocol_status/protocol_version/deadline_daa/settle_txid) · `pool_bettor_sides`(market_id/side_lock_tx/direction/stake_amount/side_lock_daa) · `pool_committee`(committee_pk_hash/vrf_seed/threshold) · `market_shards`(bshard 分片，现 0 行) · `chain_events`(event_type='pool_oracle_vote' = quorum 真源，非 oracle_history) · `oracle_history`(reward_amount)。
- **SS 编译**: `silverc.exe`（`D:/silverscript/target/release/silverc.exe`）。SS 原语查官方 `docs/DECL.md`+`TUTORIAL.md`（TN12 全有 introspection/covenant OpInputCovenantId/byte[](int,int)/blake2b/for），别凭印象判"做不了"搭链下 fallback。

---

## 5. 频道沟通（dev-coord-testnet）—— 真送达四纪律

**读频道**:
```bash
node -e "fetch('http://127.0.0.1:3200/api/chat/messages?channel=dev-coord-testnet&limit=12').then(r=>r.json()).then(j=>{for(const m of (j.messages||j).slice(-12)){console.log((m.created_at||'').slice(11,16)+' '+(m.content||m.message||'').replace(/\n/g,' ').slice(0,90))}})"
```
**发频道**（你的 relayId）:
```bash
node -e "fetch('http://127.0.0.1:3200/api/chat/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({relayId:'102cbb99-...',channel:'dev-coord-testnet',message:'你的消息'})}).then(r=>r.json()).then(j=>console.log(j.ok?'sent '+(j.txId||'').slice(0,12):'FAIL '+JSON.stringify(j)))"
```
（先查 `relay_nodes` 拿你完整 relayId 再填，别凭记忆瞎填尾段=Account not found。）

**四纪律（违反 Owner 暴怒）**: ①**真发**（必跑命令确认 HTTP 200 + txId，不只写 response 文本）②**880 墙**→拆 <800 字符多条 ③**@具体人名**禁@团队 ④派工/请求末尾 `👉@名字【必回】认领+ETA`。
**最重要**: 工具调用永远是真 invocation 非文本（前任 Bettor 死在这）。

---

## 6. 团队花名册 & 你跟谁对接

| Agent | 角色 | relay id | 在线 |
|---|---|---|---|
| **Bettor-tn**（协调者） | 方向/驱动/审码/determinism 判/验落链。你出码贴 diff 给我审 | `5c07f7e5-...` | ✅（刚接位）|
| **J1tn** | :3300 独立节点 operator + SS/determinism 作者（v08 SS / e2e harness）| （:3300 机器）| ✅（一直在）|
| **NWT-tn** | 对抗验证 + determinism lead。跟你常 co-verify（2 vantage）| `8dd59acb-...` | ✅（已拉起）|
| **KANet-UI-tn** | :3200 operator + 单 git 写者 + 部署执行 | `f5cf6d85-...` | 接位中 |
| **Owner** | 终裁。要全自动、报数诚实分级、消息必真送达 | — | — |

**对接重点**: 出码/方案前后跟 **Bettor**（审/放行）；部署找 **KANet-UI**；验证结果跟 **NWT** co-verify；跨节点数据找 **J1** 要 :3300 侧。

---

## 7. 一句话上手

你是 settler/mass 域 owner + oracle 工程侧。**现在团队重新聚拢、对齐中**——别自己起活。接位先：①读频道最新确认对齐状态 ②等 Owner/Bettor 定两大任务的优先级与你的 slice ③bshard e2e 真跑前先链上 probe spend-units，oracle 守 5 终裁信源白名单为先。守 spend-units 禁估 + fixture 复刻 production + 实读实际 code + verify-not-echo。疑问频道 `👉@Bettor-tn【必回】`。
