# NWT-tn 接位文档（对抗验证者 + determinism lead）

> 写于 2026-06-15 by Bettor-tn（协调者）。前任 NWT-tn 出问题被 Owner 重启。本文让你（新 Claude Code agent）立即接手 NWT 的验证职责。**先全读再动手。** 姊妹文档：`docs/2026-06-15-KANet-UI-operator-handoff.md`。

---

## 0. 你是谁 / 你的角色

你是 **NWT-tn**，团队的**对抗验证者 + determinism lead**：
1. **对抗验证（不是 echo 附和）** —— 别人报 PASS 你要实测打脸。你前任靠 trial-ramp **抓出了 2 个 deploy-级 critical bug**（#28 bond=0 破建市、#27a 新 bet NULL-daa 破新市场），都是码审漏的、只有实跑 trial 抓得到。**这是你的核心价值**。
2. **determinism lead** —— 跨节点确定性的判定权在你。你前任的关键贡献：committee_pk_hash byte-equal 验法、`#27d-bet-sync` precondition、transient-self-heal 推理、单源 captureSideLockDaa 防双实现漂移。
3. **NOT operator / NOT git 写者** —— 你不部署、不写 git（那是 KANet-UI 单写者域）。你 **read-only 验证** + 出对抗证据 + determinism 判。

**relay 身份（频道发言用）**: `relayId = 8dd59acb-3ccc-47b8-8833-cc4b7358848f`（name=NWT-tn）

---

## 1. 立即待办（你接手时的验证链）

**当前 critical path**: J1 刚 push `#27a forward-break fix = d2d11a2f`（已被 Bettor + J2 审过 determinism 放行）→ KANet-UI 正/即将 batch2.2 轻量 deploy 两节点 → **然后就是你的验证活**。

**batch2.2 deploy 完成后你要跑的（gated 在 deploy）**:
1. **e0ktm live-repro 复验**（你前任的实锤 market `e0ktm`）: 修后该市场的 NULL-daa bet 应被 `recaptureSideLockDaaForMarket` 重取 → `side_lock_daa` 从 NULL→真值（如 ~38458736）→ sample **不再 fail-loud** → 采到委员。贴 before/after。
2. **跨节点 fresh-市场 e2e**（#27a determinism 权威证）: 建一个 fresh 市场（#28 已修, default bond 现可用不必显式传）→ 两节点 #27d-sync 同 bet 集 → 各自 sample → **committee_pk_hash 全 64 字节 byte-equal**。这验的是 forward 路（老市场 0vafc 的 (b) 已 PASS）。
3. **#28 oracle≈feeShare settle 复验**: 一个市场 settle 后, oracle 实得 ≈ 1% feeShare（非被 bond 抬高）。这条 gated 在 #27a 修（需 bet→sample→settle 通）。
4. **(c) regression 覆盖审**: J1 的 d2d11a2f 含 2 套 #27a regression（committee-exclude 10检 + NULL-fail-loud 7检, import 生产 fn）。你 verify **覆盖实路非假绿**。⚠**残留**: #27d regression 还没人写（你前任 flag 是 #27a+#27d 都要）→ 催 J1 补或你提覆盖点。

**你前任的验证 harness**: `_nwt_batch2_verify.cjs`（在 repo 根, node --check 过, 跑 (a)backfill 一致 / (b)pk_hash 32B / (c)#28 bond）。先读它复用别重造。

---

## 2. 当前状态（精确·2026-06-15）

- **Git**: 两节点都 `ee483f20`（branch=docs/oracle-v06-spec, tree=`53e4825f...`）。J1 #27a fix `d2d11a2f`（parent=ee483f20, FF-able, 纯码改）在 `origin/j1-27a-forward-break`, 已放行待 batch2.2 deploy。
- **已 PASS 不重跑**: (a) 跨节点 20/20 bet `side_lock_daa` byte-equal · (b) 0vafc committee_pk_hash 全 64 字节 byte-equal（你前任亲手封口）· #28 hotfix(ee483f20) create-v07 返 200（修前 500）。
- **待你验（gated 在 batch2.2 deploy）**: 上面 §1 的 4 项。
- **deploy 栈**: ee483f20(#28)←a67c4155(B)←c8e21e6a(tg-bot)←c3582a05(#27d)←959acd21(#27a-v2)←d3bb2e3a(锁基)。
- **B after-stress**: 功能 PASS（tick1 rebalanced 8/8），tick2 `split_utxo Storage mass exceeds maximum`=已知 880 KIP-9, non-fatal retry, 进 backlog 非 blocker。

---

## 3. 你的验证方法论（硬纪律·你前任的招）

- **fixture 必复刻 production 输入** —— 理想化输入会 mask 真 bug（线E 一夜三犯教训）。测前问"输入跟 production 喂的完全一样吗"。
- **trial-ramp 必端到端** —— 量化/上线动作 5-10 trial 验过再铺；trial #1 必走到关键下游里程碑（建市→押注→至少 1 票落链）。#28/#27a 两 critical 都是 trial 端到端抓的。
- **adversarial-verify-not-echo** —— 不附和别人的 PASS。自己 read-only 查 DB/链/tree 实证。abstain-not-guess: 取不到完整证据不下结论。
- **跨节点 determinism 验法**:
  - 跨节点比 daa: key=**`side_lock_tx`**（唯一, 非 side_p2sh —— 同地址多 UTXO）。同 bet 同 daa byte-equal=PASS; :3300 缺某 bet=ingestion gap 非 daa 问题。
  - 跨节点比 committee: **同 bet 集**前提下比 `committee_pk_hash` 全 64 字节（bet 集差→excludePks 差→pk_hash 合法不等非 bug, 要 #27d-synced fresh 市场才是干净测）。
  - 链上验 tx: relay `check_utxo_landed`（POST /api/relay/:id/send-command）, 别用挂掉的公链 API。
- **determinism guardrail（#27a 这类）**: 任何 daa 取不到→**fail-loud 不存 NULL/猜值**（守跨节点 byte-equal）; truly-unresolvable→quorum-timeout-refund 兜底; recapture 必用单源 captureSideLockDaa（防双实现漂）。

---

## 4. 拓扑 & 技术坐标

- **:3200 节点 = 本机** Console（你 + Bettor + KANet-UI + J2 都在 :3200 这一个 Console；你 read-only 查 :3200）。
- **:3300 节点 = J1 的独立机器**（够不到, J1 own）。跨节点验靠 J1 贴 :3300 数据 + 你 :3200 数据对比，或 relay check_utxo_landed 走 :3200 kaspad 看整链。
- **Console DB**（:3200 查询）= `D:\kanet-tn12\kasia-console\data\console.db`（better-sqlite3 readonly）。
- **kaspad**（:3200）= `ws://192.168.1.106:17210`（tn12）。
- **常用查询**（示例, readonly）:
```bash
node -e "const D=require('./kasia-console/node_modules/better-sqlite3');const d=new D('./kasia-console/data/console.db',{readonly:true});console.log(d.prepare('SELECT committee_pk_hash FROM pool_committee WHERE market_id=?').get('ext-pool-v07-...'));d.close()"
```
- 关键表: `pool_markets`(id/protocol_status/deadline_daa/settle_txid) · `pool_bettor_sides`(market_id/side_lock_tx/side_p2sh/side_lock_daa) · `pool_committee`(market_id/committee_pk_hash/vrf_seed/threshold) · `chain_events`(event_type='pool_oracle_vote' = quorum 真源, 非 oracle_history)。

---

## 5. 频道沟通（dev-coord-testnet）—— 真送达四纪律

**读频道**:
```bash
node -e "fetch('http://127.0.0.1:3200/api/chat/messages?channel=dev-coord-testnet&limit=12').then(r=>r.json()).then(j=>{for(const m of (j.messages||j).slice(-12)){console.log((m.timestamp||'').slice(11,16)+' '+(m.content||m.message||'').replace(/\n/g,' ').slice(0,90))}})"
```
**发频道**（你的 relayId）:
```bash
node -e "fetch('http://127.0.0.1:3200/api/chat/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({relayId:'8dd59acb-3ccc-47b8-8833-cc4b7358848f',channel:'dev-coord-testnet',message:'你的消息'})}).then(r=>r.json()).then(j=>console.log(j.ok?'sent '+(j.txId||'').slice(0,12):'FAIL '+JSON.stringify(j)))"
```
**四纪律**: ①真发(确认 txId) ②880 墙→拆 <880 字符多条 ③@具体人名禁@团队 ④派工/请求末尾 `👉@名字【必回】`。

---

## 6. 团队花名册

| Agent | 角色 | relay id |
|---|---|---|
| **Bettor-tn**（协调者） | 方向/驱动/审码/determinism 判/验落链。你的验证结果给我汇总 | `5c07f7e5-...` |
| **J1tn** | #27a/#27d owner, :3300 独立节点 operator。当前 #27a fix d2d11a2f | （:3300 机器）|
| **KANet-UI-tn**（刚也重启,已接位） | :3200 operator + 单 git 写者 + 部署执行 | `f5cf6d85-...` |
| **J2-tn** | 验证 + 2nd-vantage co-review。跟你常 co-verify | `102cbb99-...` |
| **Owner** | 终裁。要全自动、盯紧别 stall、报数诚实分级 | — |

**对接重点**: 你出验证证据给 **Bettor** 汇总 + **J2** 常跟你 co-verify（2 vantage）；跨节点数据找 **J1** 要 :3300 侧；deploy 完成信号等 **KANet-UI**。

---

## 7. 一句话上手

你是对抗验证者 + determinism lead。**现在等 KANet-UI 把 batch2.2(d2d11a2f #27a fix) deploy 到两节点 → 你跑: ①e0ktm live-repro 复验(NULL→daa 填, sample 不 fail-loud) ②fresh-市场跨节点 e2e(committee_pk_hash byte-equal) ③#28 settle oracle≈feeShare ④审 (c) regression 覆盖 + 催 #27d regression**。守 adversarial-verify-not-echo + trial-端到端 + determinism guardrail。先读 `_nwt_batch2_verify.cjs` 复用。疑问频道 @Bettor-tn【必回】。
