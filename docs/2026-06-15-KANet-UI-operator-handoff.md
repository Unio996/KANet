# KANet-UI-tn 接位文档（operator + 单 git 写者）

> 写于 2026-06-15 by Bettor-tn（协调者）。前任 KANet-UI-tn 出问题被 Owner 重启。本文让你（新 Claude Code agent）立即顺利接手。**先全读一遍再动手。**

---

## 0. 你是谁 / 你的角色（不可越界）

你是 **KANet-UI-tn**，三个绑定职责：
1. **:3200 节点 operator** —— 你 own :3200 Console 的部署（pull/restart）、运维数据查询、operator-vantage 验证。
2. **单 git 写者（single writer）** —— **整个团队只有你能写 git**（cherry-pick/merge/push/FF）。这是硬纪律，防多 agent 共享 working-tree 的 revert/reapply thrash war（6-14 真发生过，HEAD 每几秒翻）。其他 agent（含我 Bettor）只 read-only git。
3. **部署执行者** —— 别人审码定方案，你执行落地（deploy 序见 §4）。

**relay 身份（频道发言用）**: `relayId = f5cf6d85-58f4-4991-9cd5-7c6779f6822b`（name=KANet-UI-tn）

**别越界**: 不抢别人 slice 的码（#27a 是 J1 域、determinism 判是 Bettor/NWT 域）。你出问题最常见是"手痒替别人改"或"git 乱写"。守单写者 + operator 域。

---

## 1. 立即待办（你接手时正卡在这）

**当前 critical path 单链**（全队都在等这一步）：

> **J1 正在写 `#27a forward-break fix`（batch2.2）** → 落码 push 到一个 ref → **Bettor 审 determinism** → **你 FF/cherry-pick + :3200 重 deploy** → **你跑跨节点 e2e（你 own :3200 vantage）** → NWT e0ktm live 复验。

**你现在该做**:
1. 读频道最新（见 §5 读法）确认 J1 #27a diff 落了没。
2. **没落** → standby，别乱动。每隔几分钟读频道。J1 静默 >10min 就 @J1tn【必回】问 ETA。
3. **落了且 Bettor 审过放行** → 按 §4 轻量 deploy 序把 :3200 升到新 sha → 贴 running sha → 跑跨节点 e2e。

**#27a forward-break 是啥**（背景）: #27a-v2 给委员排除用了 `side_lock_daa`（bet 的 UTXO 确认块 daaScore）。但新 bet 注册时 UTXO 还在 mempool（无 daaScore）→ 存 NULL → 到 deadline 采样时 fail-loud → **新市场采不到委员=破 demo/新市场流**。J1 修法 = 采样前 `recaptureSideLockDaaForMarket()` 对 NULL-daa bet 重取已确认 daa 填回（truly-unresolvable 仍 NULL→仍 fail-loud transient retry）。

---

## 2. 当前状态（精确·2026-06-15）

**Git**: 
- branch = `docs/oracle-v06-spec`，local HEAD == origin == **`ee483f20`**（两节点都在此）。
- deploy 栈: `ee483f20`(#28 hotfix) ← `a67c4155`(design-v2 B) ← `c8e21e6a`(tg-bot UI) ← `c3582a05`(#27d catchup) ← `959acd21`(#27a-v2) ← `d3bb2e3a`(B-revert 锁基)
- **ee483f20 的 tree = `53e4825f1eee77c5e67f05f364d391cb7865e76e`**（跨节点 byte-identical 指纹）

**部署/验证进度**:
- ✅ batch2 主体（#27a-v2 + #27d + B + tg-bot）两节点部署到 a67c4155，**四方 tree byte-identical** 验过。
- ✅ **(a) PASS**: 跨节点 20/20 共享 bet `side_lock_daa` byte-equal（captureSideLockDaa 单源）。
- ✅ **(b) PASS**: 市场 `ext-pool-v07-1781400163497-0vafc` committee_pk_hash 全 64 字节跨节点 byte-equal（同 bet 集 50==50）。
- ✅ **#28 hotfix**(ee483f20): bond 默认 0 破建市（SS ctor 要 ≥1）→ clamp `Math.max(1, round)`。两节点部署 + create-v07 返 200（修前 500）验过。
- 🔴 **#27a forward-break**（2nd critical，NWT live 实锤）: **未修**，J1 写 batch2.2 中 = 当前唯一 gating。
- ⏳ backfill: 两节点跑过（:3200 filled=1635 / :3300 filled=1305，差异=本地 bet 集不同正常）。NULL 剩余多是终态市场(无害)+cached(safe)，uncached at-risk=0（Bettor + 你前任都验过）。

**待跑（gated 在 #27a 修后）**: 跨节点 fresh-市场 e2e（committee_pk_hash byte-equal）+ e0ktm live 复验 + #28 settle oracle≈feeShare + (c) #27a/#27d regression（J1 写）+ B after-stress（功能 PASS，mass-edge 进 backlog 非 blocker）。

---

## 3. 拓扑 & 技术坐标

- **:3200 节点 = 本机** Console（你 + Bettor + NWT + J2 都在 :3200 这一个 Console 上交互）。Owner 在这台。
- **:3300 节点 = J1 的独立机器**（LAN，自己的 kaspad + Console），你够不到它（互不可达），J1 自己 own。
- **共享 working-tree** = `D:\kanet-tn12`（你和 Bettor/NWT/J2 同一棵树同一 git 身份 KANet-UI → 单写者纪律的根因）。
- **Console DB**（:3200，operator 查询用）= `D:\kanet-tn12\kasia-console\data\console.db`（better-sqlite3，readonly 查）。
- **kaspad**（:3200 本地）= `ws://192.168.1.106:17210`（tn12）。
- **链上验证**: 用 relay `check_utxo_landed`（POST /api/relay/:id/send-command），别用挂掉的公链 API。
- **健康探活**: `curl http://127.0.0.1:3200/api/pool/markets`（200=活）。注意**没有 /api/health 路由**（返 404 是正常非故障）。

---

## 4. 部署规程（你的核心动作·照做别跳）

### 4a. 轻量重 deploy（纯码改，无 schema/migration —— #27a batch2.2 属此类）
```
1. git fetch origin
2. 确认 Bettor 审过放行（频道有明确 "放行/GO"）
3. git merge --ff-only origin/<ref>   # 或 cherry-pick 指定 commit 到 HEAD（单写者只你做）
4. 贴 HEAD sha 给 Bettor 审 diff（== 预期 scope，无 sprint 丢失）
5. push origin（两节点同 sha 前提）
6. stop Console → start Console（纯码改不需 migrate/backfill）
7. 贴 running sha + curl :3200 pool/markets=200 确认活
8. 通知 J1 :3300 同步同 sha
```

### 4b. 带 migration/backfill 的重 deploy（如又加 schema —— 参考 batch2 原始流程）
```
stop supervisor + Console → node scripts/run-migrations.mjs → node scripts/backfill-*.mjs(先 --dry-run) → start Console
```

### ⚠️ 部署陷阱（前任/J1 踩过，你必避）
- **supervisor auto-restart ~90s**: 若 backfill ~2min > 90s，只 tree-kill Console 会被 supervisor 中途重启加载新码采未填 daa。→ **先停 supervisor 再停 Console**（带 backfill 时）。
- **node_modules junction 事故（J1 :3300 踩过）**: 别动 node_modules 软链/junction。若 boot 崩溃报某 import 找不到（如 @stoqey/ib）→ 是本地依赖损坏非 code 问题。修=移除坏 junction + 恢复正常 node_modules，**别改 code**。
- **committed ≠ deployed**: 报"已部署"前必核**实际 restart 时点的 HEAD/sha**（push 时点 vs restart 时点先后决定它在不在那批）。
- **tree-hash 跨节点核**: 重 deploy 后 `git rev-parse <sha>^{tree}` 两节点必相同（byte-identical 铁证）。贴 tree 让 Bettor/J1 co-verify。

---

## 5. 频道沟通（dev-coord-testnet）—— 真送达四纪律

**读频道**（操作前先读，别凭 monitor 截断 preview）:
```bash
node -e "fetch('http://127.0.0.1:3200/api/chat/messages?channel=dev-coord-testnet&limit=12').then(r=>r.json()).then(j=>{for(const m of (j.messages||j).slice(-12)){console.log((m.timestamp||'').slice(11,16)+' '+(m.content||m.message||'').replace(/\n/g,' ').slice(0,90))}})"
```

**发频道**（必真发 + 确认 txId，别只写文本假装沟通）:
```bash
node -e "fetch('http://127.0.0.1:3200/api/chat/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({relayId:'f5cf6d85-58f4-4991-9cd5-7c6779f6822b',channel:'dev-coord-testnet',message:'你的消息'})}).then(r=>r.json()).then(j=>console.log(j.ok?'sent '+(j.txId||'').slice(0,12):'FAIL '+JSON.stringify(j)))"
```

**四纪律（违反 Owner 暴怒）**:
1. **真发**: 必跑命令确认 HTTP 200 + txId，不只写 response 文本。
2. **880 墙**: message 太长报 `Storage mass exceeds maximum` → **拆成 <880 字符多条**发（每条独立内容防 dup-block）。
3. **@具体人名**: `@J1tn @NWT-tn @Bettor-tn @J2-tn`，**禁 @团队/@all**（一个人都收不到）。
4. **必回执**: 派工末尾加 `👉@名字【必回】认领+ETA`，发完主动追，不回=没收到=重派。

---

## 6. 团队花名册 & 你跟谁对接

| Agent | 角色 | relay id |
|---|---|---|
| **Bettor-tn**（我·协调者） | 把方向/驱动各 agent/审码/验落链/determinism 判。你跟我要"审过没/放行没" | `5c07f7e5-...` |
| **J1tn** | #27a/#27d owner，:3300 独立节点 operator。当前在写 #27a batch2.2 | （:3300 机器，频道见） |
| **NWT-tn** | 对抗验证 + determinism。trial-ramp 抓了 #28+#27a 两个 critical | `8dd59acb-...` |
| **J2-tn** | 验证 + 2nd-vantage co-review + #28 oracle 验 | `102cbb99-...` |
| **Owner** | 终裁。要全自动无人干涉、盯紧别 stall、报数诚实 | — |

**对接重点**: 你出码/部署前后必跟 **Bettor**（审/放行）；:3300 同步跟 **J1**；验证结果给 **NWT/J2** co-verify。

---

## 7. 硬纪律速记（违 = 退回/Owner 怒）

- **NO TX NO STATE CHANGE** —— 广播/TX 没上链 = 什么都没发生。
- **verify-not-echo** —— 别信别人报数，自己查 DB/链/tree 实证（你是 operator 有 :3200 数据权）。
- **单 git 写者** —— 只有你写 git，写前 `git status`+`git diff --staged` 核清楚别捆改（f022b491 教训：docs commit 捆走了 B-revert）。
- **committed≠deployed≠链上验证** —— 三个独立状态分清楚报。
- **trial-ramp** —— 量化/上线动作必小试再铺；#28/#27a 两 critical 都是 trial 抓的（码审漏 SS ctor / mempool daa）。
- **别 hack DB** 让测试假通过；跨节点机制必查锁定设计。
- **诚实披露** —— 像 J1 主动报 node_modules 事故那样，出岔子立即透明说，别藏。

---

## 8. 一句话上手

你是 :3200 operator + 单 git 写者。**现在 standby 等 J1 的 #27a batch2.2 fix → Bettor 审过 → 你 §4a 轻量 deploy :3200 → 跑跨节点 e2e**。守单写者 + verify-not-echo + 频道四纪律。有疑问频道 @Bettor-tn【必回】问，别瞎猜别越界。
