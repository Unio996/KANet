# NWT 红队验收 — enforce lib 2291daa1 + daemon 65d2c0e9 (Track B)

2026-06-22 · NWT (verify-value-source 红队) · 独立行级复核 J1 enforce lib (`bshard-close-enforce.mjs`) + J2 daemon (`bshard-close-voter.js`)。**verify-not-echo**: 下面每条都对照实码行号坐实，不信注释。

**总口径(诚实标定)**: Track B **未达 production-trustless**，且**比"logic-proven autonomous"还差一层** —
当前 daemon 与 enforce lib **ctx 契约不匹配，自治-enforce 路一调即抛、跑不通**(E1)。x4kpq live GREEN 是 **driver-side/手动** verify-then-sign，**不是本 daemon 跑出来的**。

---

## 🔴 E1 (新, CRITICAL) — daemon ↔ enforce ctx 契约不匹配, 自治路不可执行

- daemon `processCloseRequest` L97-98 注入 ctx = **`{ rcOn, myRelayId: voter.id }`** (仅两项)。
- 真 enforce `enforceCloseAttest(signRequest, ctx)` 需要 **~8 个 ctx hook**:
  `ctx.myOracleKeys` (L49) / `ctx.fetchCanonicalEvidence` (L133) / `ctx.loadPoolSnapshot` (L155) /
  `ctx.fetchEndBlockHashCanonical` (L168) / `ctx.chainReader` (L168) / `ctx.deadlineDaa` (L97,168) /
  `ctx.loadBettors` (L90) / `ctx.verifyBettorsCompleteFromChain` (L102, optional)。
- **后果**: `loadEnforce()` 现在能 import 到真 lib (J1 已 ship) → daemon 调真 enforce →
  L49 `ctx.myOracleKeys?.map(...).includes(myPk)` 中 `myOracleKeys` undefined →
  `undefined?.map()` 短路成 undefined → `undefined.includes(myPk)` **抛 TypeError** →
  daemon try/catch (L119) 吞成 `{errored:true}` → **每个 close-request 每 tick 都 errored**。
- grep 坐实: daemon 文件里 `loadBettors`/`loadPoolSnapshot`/`myOracleKeys`/`fetchCanonicalEvidence`/
  `fetchEndBlockHashCanonical`/`verifyBettorsCompleteFromChain` **零出现** = 这些 hook 从没接。
- **修**: J2 必须实现并注入全部 ctx hook (尤其链锚的 `loadBettors`/`loadPoolSnapshot`/
  `fetchEndBlockHashCanonical`)，否则 daemon 只能跑 placeholder(= 它本要替掉的 driver-side `enforceCommitteeSign`)。
  **在 E1 闭之前，Track B 自治-enforce 等于没接上。**

---

## 命门级 (load-bearing) — 开

### 🔴 D2 — payoutRoot 验的是 caller 标量, 不是被签 tx 里 commit 的根 (verify-value-source 违反, 最承重)
- enforce L113: `if (reDerivedRoot !== String(claimedPayoutRoot))` — 验的是 **req 旁路标量 `claimedPayoutRoot`**。
- enforce **从不 parse `txSafeJson`** 取 close_attest 输出实际 commit 的那个根 (sighash 覆盖的值)。
- 攻击: settler 给【匹配的 `claimedPayoutRoot` 字段】+【`txSafeJson` 的 close_attest 输出 commit 另一个根】
  → enforce 标量验过 → daemon (L107) 签了【输出是恶意根的 tx】。
- 这正是记忆铁律 `verify-value-source-checker-must-access-binding-at-decision-time`:
  **验的值必须是被签名覆盖的那个值，不是 caller 另给的同名字段。**
- **修**: enforce 必从被签 `txSafeJson` 反解 input_index 对应 sighash 覆盖的 close_attest 输出根，验【它】== reDerivedRoot。

### 🔴 C1 / D6 — bettors 链锚 (PARTIAL, 诚实标定的真开口)
- enforce L90 `bettors = await ctx.loadBettors(market_id)` = DB/caller 源 (且 hook 未实现, 见 E1)。
- per-bettor 守卫 (L95-98) **只验 `side_lock_daa <= deadline_daa` (时间轴)** — **不验 direction/stake/pk 链锚**。
- 完整-集 (L102-105) 藏在 **optional** `ctx.verifyBettorsCompleteFromChain` 后; daemon 没注入 → **运行时根本不跑**。
- **D6 sharp point 坐实**: 聚合 Σstake 绑定抓不到 **direction-swap / identity-swap**(翻一个 ticket YES↔NO 保持 Σstake 不变 → pari-mutuel winners/分母变 → payoutRoot 变, 聚合校验仍过)。
- 数学根因: step-6 (L106-115) 的 payoutRoot re-derive **完全自洽** —— `bettors` 和 `claimedPayoutRoot` 若都由 settler 控,
  settler 造一组自洽的假集→假根, enforce 必过。**唯一防御 = `bettors` 逐 ticket 链锚**(pk+direction+stake+shardPoolId),
  且跨【全部 auto-rolled shards】从链上 ShardLeaf 重建。**这是 C1 命门, 现 PARTIAL。**
- **验收测 (我下次造)**: direction-swap attack-case (Σstake 不变, 翻一 ticket 方向) → 级1-only enforce 必【漏过】(证半闭),
  级2 (链上全 shard 重建) enforce 必【BUST】(证真闭)。

### 🟠 D4 — no-bypass 不变量未落 (enforce 的前提)
- enforce L11-13 + daemon L12-16 自认 (a)(b) "在 relay/console 层落(本文件外)" = **未实现**。
- 现状: 6+ console 路直调 `sign_input_for_settle`, relay handler 盲签。daemon 'enforce-在前'挡不住别路绕过直签同一 PS input。
- **enforce 只在 D4 落了才有意义**: 必在 relay 端【按被签 input 是 PS/covenant 输入】强制走 daemon enforce(无视 caller 标签)+ 堵其他 console 路。

---

## 收口 / 防御纵深 — 部分开

### 🟠 C2 — 委员完整有序集: 逻辑对, 锚软
- enforce `reDeriveCommittee` L160-165: `buildPoolMerkleTree(members) == poolMerkleRoot` **逻辑正确**(子集→不同 root→reject)。
- **但 `poolMerkleRoot` 来自 `ctx.loadPoolSnapshot` (DB/snapshot), 非链上 PS/spine ctor 读** —— L166-167 内联 TODO 自认。
  若 `loadPoolSnapshot` 读【本节点 scout 派生的链上态】=OK; 若 settler 中继=破。**必 pin 到链上 ctor 读。**
- 状态: closed-against-inconsistent-subset, **anchor-pending**。

### 🟠 C3 — TOCTOU 返回值【未被 daemon 用】
- enforce L119 返 `verifiedTxHash = blake2b(txSafeJson)`。**但 daemon L104-110 不 assert `signedTx == verifiedTxHash`**, 直接签 `req.txSafeJson`。
- 现因 daemon 恰签同一 `req.txSafeJson` 而未被利用，但**无强制 assert** = C3 形同虚设。
- **修**: daemon 签前 `assert(blake2b(被签 tx) === verdict.verifiedTxHash)`。(且与 D2 合: verifiedTxHash 必绑到验过根的那个 tx。)

### 🟠 D1 — equivocation / 同市场双根 (dedup 粒度)
- daemon L90-93 dedup key = `(market_id, payout_root)` → 同节点可对同市场签【两个不同根】。
- 现被 enforce step-6 determinism 掩盖(只一个正确根能过), 但应 dedup-by-`market_id`: 对某 market 已签【任何】根则拒签【不同】根。防御纵深, 真实但低危(给定 enforce)。

### 🟠 D5 — refund liveness 不能 settler-gated
- daemon L100-102 abstain 靠 "settler 侧 quorum-timeout-refund"。恶意 settler 不会主动 refund。
- 需 Track A CLTV deadline-gate refund 臂【deadline 后 permissionless】(任何人可触发), 跨-track 依赖, 待确认 Track A 臂对任意人开放。

---

## ✅ 真闭 (verify-not-echo 坐实)

### D3 — 委员成员判定: enforce 自治 re-derive + 非成员自拒 (闭, modulo C2 锚)
- enforce L77-87: `reDeriveCommittee(market_id, ctx)` 链锚重算委员 + L85 `committee.includes(myPk)` 不在则**本节点自拒签**。
- daemon L98 传的是 `committee_pk: voterPk`(本节点 get_pubkey 真 pk)→ enforce 验【真 pk】∈ re-derived 集。**不信 settler 的 `req.committee_pks`**(只当 daemon L86-87 便宜预筛)。**命门④ 在 enforce 层闭。**(强度受 C2 锚软上限。)

---

## 验收 scorecard (诚实)

| 项 | 状态 | 承重 |
|---|---|---|
| E1 ctx 契约不匹配 (自治路不可跑) | 🔴 新-CRITICAL | 阻塞全部 |
| D2 root-from-signed-tx | 🔴 开 | 命门 (最承重) |
| C1/D6 bettors 逐-ticket 链锚 | 🔴 PARTIAL | 命门 |
| D4 no-bypass (relay gate) | 🟠 开 | enforce 前提 |
| C2 poolMerkleRoot 链锚 | 🟠 逻辑闭/锚开 | 中 |
| C3 daemon assert tx-hash | 🟠 开 (返回值未用) | 中 |
| D1 dedup 粒度 | 🟠 开 (被 enforce 掩) | 防御纵深 |
| D5 refund permissionless | 🟠 开 (跨 Track A) | liveness |
| D3 委员自拒非成员 | ✅ 闭 (受 C2 锚限) | — |

**下一步交付棒**:
- **J2**: 闭 E1 — 实现并注入全部 ctx hook(链锚 `loadBettors`/`loadPoolSnapshot`/`fetchEndBlockHashCanonical`)+ D4 relay-gate + C3 daemon assert + D1 dedup-by-market。
- **J1**: 闭 D2(从被签 tx 反解根)+ C1 级2(全 shard 链上重建 bettor 集)+ C2 poolMerkleRoot 链上 ctor 读。
- **NWT (我)**: E1 闭后跑端到端; 造 direction-swap + 假根-标量(D2) + 子集-委员(C2) 三 attack-case, 验【修前真 pass / 修后真 refuse】(测有牙非 vacuous)。
- **Track A**: 确认 CLTV refund 臂 deadline 后 permissionless (D5)。
