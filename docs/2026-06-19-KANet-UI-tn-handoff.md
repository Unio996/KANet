# KANet-UI-tn 接位文档（:3200 operator + 单 git 写者 + 部署执行）

> 写于 2026-06-19 by Bettor-tn（协调者，刚重新接位）。团队重新聚拢、对齐后再出发。**先全读再动手。** 姊妹文档：`docs/2026-06-19-J2-tn-handoff.md`（同批写）。旧的 `2026-06-15-KANet-UI-operator-handoff.md` 已**整体过时**（通篇 #27a batch2.2 deploy，全部 superseded），只保留它的 §4 部署规程 / §5 沟通 / §7 纪律仍有效。

---

## 0. 你是谁 / 你的角色（不可越界）

你是 **KANet-UI-tn**，三个绑定职责：
1. **:3200 节点 operator** —— 你 own :3200 Console + 本机 tn12 kaspad + 所有 relay 的部署、运维、operator-vantage 验证与健康监控。
2. **单 git 写者（single writer）** —— **整个团队只有你能写 git**（cherry-pick/merge/push/FF）。硬纪律，防多 agent 共享 working-tree 的 revert/reapply thrash war（6-14 真发生过，HEAD 每几秒翻）。其他 agent（含我 Bettor、J2、NWT）只 read-only git。
3. **部署执行者** —— 别人审码定方案，你执行落地（deploy 序见 §4）。

**relay 身份（频道发言用）**: `relayId = f5cf6d85-58f4-4991-9cd5-7c6779f6822b`（name=KANet-UI-tn）

**别越界**: 不抢别人 slice 的码（determinism 判 = Bettor/NWT 域，settler/mass = J2 域，SS = J1 域）。你最常见出问题是"手痒替别人改"或"git 乱写捆改"。守单写者 + operator 域。

---

## 1. 当前运维状态（2026-06-19，本会话 Bettor 临时代你稳定了，你接回）

⚠ 你不在线期间 Bettor 代行了部分 operator 活把系统拉稳。**你接回后核一遍现状**：

- **tn12 kaspad**：UP（PID 见 `Get-Process kaspad`，06-17 17:58 启动）。启动命令 = `D:/rusty-kaspa/target/release/kaspad.exe --testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=0.0.0.0:17210`。已同步到链尖。
- **Console :3200**：UP（HTTP 302 = 活；注意没有 /api/health 路由，404 是正常）。
- **tg-bot**：已修复重启。**坑**：旧进程跑 29h 但 grammy getUpdates poller 静默死了（manager 报 `running:true` = 假活）→ DM 无反应。修法 = `POST /api/tg-bot/stop` 然后 `start`（**body 必带 `{}`**，否则 400）。诊断必打 Telegram API（getMe/getWebhookInfo/getUpdates/sendMessage）非看 manager flag。详见记忆 `reference-tg-bot-false-alive-diagnosis`。
- **⚠ relay 连接泄漏风暴（你要长期盯）**：本会话发现单 relay 泄漏 957 条 ws 到 kaspad:17210（全网累计 1184 条）钉死 wRPC → **广播 ingest 静默失效**（dev-coord 频道收不到外部消息，但节点 synced+押注正常，两条路独立易误判）。诊断 = `netstat -ano | grep -c "127.0.0.1:17210.*ESTABLISHED"`（正常 ~22-50，几百/上千=泄漏）+ 按 owning PID 拆。修 = `Stop-Process` 杀泄漏 relay PID，relay-health-monitor 30s 自动重拉（2368→44）。详见记忆 `reference-relay-ws-connection-leak-storm`。**这是 operator 长期健康项，可能复发。**
- **世界杯押注 demo**：10 个世界杯队单（Brazil/England/USA/Mexico/South Korea/Croatia/Ivory Coast/Egypt/Morocco/Cape Verde）已被 6 agent 两边激活，74 笔上链。maker=maker-1(cdb1f91d, 840k KAS)。**AutoBetter-3 的 UTXO 碎片化**（storage mass exceeds max）押注会失败，要恢复得先 UTXO consolidation。

---

## 2. 项目当前真实状态（别信旧 handoff）

**已闭环**:
- **W1 = DoD #5 用户路机制闭环 PASS**（06-16）：电报 `/bet` v0.7 → register → 跨节点 5/5 自主委员判 → settle `6460bae0` → winner 实收 7.16 KAS。诚实定语：内部 AutoBetter-1 非真外部人。
- **bshard（人数无限制）= 设计 sound + PARKED(post-demo)，e2e 从没跑通**（`market_shards=0`、零 v0.8 市场、orchestration 没接线）。

**Git**: 当前 branch `bshard-m3-deploy`，master 是主干。working-tree 有未提交改动（`git status` 自己核）。**deploy-critical 跨节点必 whole-repo sync 同 commit 同 tree**，禁 cherry-pick 单文件（:3300 实测漂移过 voter17+settler113 行）。

**频道**: dev-coord-testnet 从 06-16 02:07 STAND DOWN 后静默至今。Owner 现在重新聚拢团队。

---

## 3. 接下来两大任务（Owner 钦定）+ 你的 slice

### 任务一：测试人数无限制（bshard e2e）
- **你的 slice = 部署 + operator-vantage 验落链**：bshard SS/builder 改动 → 你 whole-repo sync 部署到 :3200（**ctor16 两节点同 commit 同 tree**，否则异 P2SH 异市场）→ J2/Bettor 跑 e2e driver → 你 operator vantage 用 `check_utxo_landed`(output 地址) 独立核每相落链。
- 主攻是 J2（settler/mass）+ J1（SS）+ Bettor（审/验），你管部署落地 + :3200 数据查证。

### 任务二：完善预言机（域信息源白名单 + 判断构造 → oracle 技能）
- **你的 slice = 部署 oracle 码改 + operator 验**：D-L1 确定性 judgeLine / A-ramp 现成字段 / deriveVote 改动落 :3200 → 你部署 → 跑 shadow-accuracy harness 看准确率 → operator vantage 验。
- 守 5 终裁 gating（新活源进 settle 必 Owner 批 + 冻结快照），你部署时别把未 gated 的活源 wire 进 settle 路。

**现在别自己起活**——团队对齐中，等 Owner/Bettor 定优先级。

---

## 4. 部署规程（你的核心动作·照做别跳）

### 4a. 轻量重 deploy（纯码改，无 schema/migration）
```
1. git fetch origin
2. 确认 Bettor 审过放行（频道有明确 "放行/GO"）
3. git merge --ff-only origin/<ref>   # 或 cherry-pick 指定 commit（单写者只你做）
4. 贴 HEAD sha + tree(git rev-parse <sha>^{tree}) 给 Bettor 审 diff（== 预期 scope）
5. push origin（两节点同 sha 前提）
6. tree-kill Console PID（taskkill //T //F，relay 是子进程不自退=orphan/dup-signing 隐患）→ start Console
7. 贴 running sha + curl :3200 /api/pool/markets=200 确认活
8. 通知 J1 :3300 同步同 sha（whole-repo）
```

### 4b. 带 migration/backfill 的重 deploy
```
先停 supervisor 再停 Console（防 supervisor ~90s auto-restart 中途加载新码采半盲数据）
→ node scripts/run-migrations.mjs → node scripts/backfill-*.mjs(先 --dry-run) → start Console
```
migrate.js 版本号必接当前最新（改表前必查 `docs/DATABASE.md`）。

### ⚠️ 部署陷阱（必避）
- **tg-bot 单 owner**：start-scripts 不再启 bot（Console manager 单 owner）。别手动起第二个 poller（Telegram 409 双 poller 冲突）。
- **committed ≠ deployed ≠ 链上验证**：报"已部署"前必核实际 restart 时点的 HEAD/sha。三状态分清报。
- **tree-hash 跨节点核**：重 deploy 后 `git rev-parse <sha>^{tree}` 两节点必相同（byte-identical 铁证），贴给 Bettor/J1 co-verify。
- **node_modules junction 别动**：boot 崩报某 import 找不到 = 本地依赖损坏非 code 问题，修依赖别改 code。
- **CONSOLE_ENCRYPTION_KEY 持久化**（丢失=所有加密数据不可恢复）；kanet.env 新 key 要进 start.sh allowlist 才生效。

---

## 5. 频道沟通（dev-coord-testnet）—— 真送达四纪律

**读频道**:
```bash
node -e "fetch('http://127.0.0.1:3200/api/chat/messages?channel=dev-coord-testnet&limit=12').then(r=>r.json()).then(j=>{for(const m of (j.messages||j).slice(-12)){console.log((m.created_at||'').slice(11,16)+' '+(m.content||m.message||'').replace(/\n/g,' ').slice(0,90))}})"
```
**发频道**（你的 relayId）:
```bash
node -e "fetch('http://127.0.0.1:3200/api/chat/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({relayId:'f5cf6d85-58f4-4991-9cd5-7c6779f6822b',channel:'dev-coord-testnet',message:'你的消息'})}).then(r=>r.json()).then(j=>console.log(j.ok?'sent '+(j.txId||'').slice(0,12):'FAIL '+JSON.stringify(j)))"
```
**四纪律（违反 Owner 暴怒）**: ①**真发**（必跑命令确认 HTTP 200 + txId，不只写 response 文本——前任死在这）②**880 墙**→拆 <800 字符多条 ③**@具体人名**禁@团队 ④派工末尾 `👉@名字【必回】认领+ETA`。**工具调用永远是真 invocation 非文本。**

---

## 6. 团队花名册 & 你跟谁对接

| Agent | 角色 | relay id | 在线 |
|---|---|---|---|
| **Bettor-tn**（协调者） | 方向/驱动/审码/determinism 判/验落链。你跟我要"审过没/放行没" | `5c07f7e5-...` | ✅（刚接位）|
| **J1tn** | :3300 独立节点 operator + SS 作者。跨节点同步跟他 | （:3300 机器）| ✅（一直在）|
| **NWT-tn** | 对抗验证 + determinism lead | `8dd59acb-...` | ✅（已拉起）|
| **J2-tn** | settler/mass 域 + oracle 工程侧 | `102cbb99-...` | 接位中 |
| **Owner** | 终裁。要全自动无人干涉、盯紧别 stall、报数诚实 | — | — |

**对接重点**: 出码/部署前后必跟 **Bettor**（审/放行）；:3300 同步跟 **J1**；验证结果给 **NWT/J2** co-verify。

---

## 7. 硬纪律速记（违 = 退回/Owner 怒）

- **NO TX NO STATE CHANGE** —— 广播/TX 没上链 = 什么都没发生。
- **verify-not-echo** —— 别信别人报数，自己查 DB/链/tree 实证（你是 operator 有 :3200 数据权）。
- **单 git 写者** —— 只有你写 git，写前 `git status`+`git diff --staged` 核清楚别捆改（f022b491 教训：docs commit 捆走了 feature-revert）。
- **每笔链上交易必入库**（地址+TX 双锚点）；链上验用 relay `check_utxo_landed` 走本地 kaspad 看 **output 地址**。
- **跨节点 whole-repo sync 非 cherry-pick**（determinism-critical）。
- **诚实分级披露** —— committed/deployed/链上验证三态分清；出岔子立即透明说别藏。

---

## 8. 一句话上手

你是 :3200 operator + 单 git 写者 + 部署执行。**现在团队重新聚拢、对齐中**——接位先：①核当前运维状态（§1：kaspad/Console/bot/连接数/押注 demo 都已稳，Bettor 代行的你接回）②读频道最新对齐 ③等两大任务优先级定下来再动部署。长期盯 **relay 连接泄漏风暴**（可能复发）+ tg-bot 假活。守单写者 + verify-not-echo + 频道四纪律。疑问频道 `👉@Bettor-tn【必回】`。
