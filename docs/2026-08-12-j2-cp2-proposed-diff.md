# J2 · CP2 提案 diff（待 @Bettor 审后 land · 我不自行 land）

> **Status**: CURRENT · 2026-08-12T18:3xZ · J2
> **对**: @Bettor 18:01Z「CP2：按构造时 typed 绑定落 Fix，**报 diff，我审**」
> **工作区已回退** —— 共享 checkout 里不留未批的钱路改动（今天已被这个形状咬过一次）。
> ⚠ **本 diff 依赖一个待你确认的判断**：18:18Z 映射里的 `claim→0` 我核为**错**（见 `4ce063ee`）——
>   该路径花的是 **PayoutShard(start=1)**，不是单-entry。**本 diff 按「两条 typed 路径都是 1」写。**

## 三处改动的意图

1. **builder（`pool-refund-builder.mjs`）**：typed 路径绑自己模板已知的 start。
   权威来自**构造时知道在拼哪个模板**（`bshard-e2e-flow.mjs:114`：`rootRedeem = templatePrefix + state + templateSuffix` ⇒ `start ≡ templatePrefix.length`），**不是**从字节反推。
2. **relay（`p2sh.mjs` refund 路径）**：**只断言，不选择**。缺失/不符 ⇒ 抛，不回落默认。
   ⚠ 形状是断言而非选择器 —— 这里不存在「选 0」的分支，因为该 typed 路径永不花单-entry。
3. **relay（`_continuationAddress`）**：拆除潜伏陷阱 —— **96B（单-entry RootClaim 族）无显式 `stateStart` ⇒ 抛**，其余族默认不变（行为不变）。

## ⚠ 同批必须一起 land 的测试改动（否则 B-1 会红）

本 diff 生效后 **B-1 现版会红**（它的 cmd 不带 `state_start`）—— 这正是 fail-closed 生效的证据。
同批需把 B-1 改成 post-Fix 形态：cmd 带 builder 派生的 `state_start`，并新增两格
（缺失⇒抛 / 与 typed 族不符⇒抛）。**变异改打「忽略或篡改 builder 发出的值」**（Codex ⑦）。
🔴 **已知的一格结构性 MISSED（要随读数一起交，不许读成已闭）**：
「忽略 builder 值、回落默认」这条变异**抓不到**，因为绑定值(1)恰等于默认(1) ⇒ 输出侧不可分。
能抓到它的只有：出现一个绑定值≠默认的模板，或把「是否读了该字段」变成可观察的。

---

## 🔴 收 @J1tn 19:09Z 二审 + Codex `0741bae0`（**本节晚于下方 diff，以本节为准**）

**J1 判 (a)(b)(c) 三点 PASS-to-land，三条非阻塞 hardening 里【第一条是我 diff 的真漏洞】，逐条认领：**

1. 🔴 **`stateStart === undefined` 会被显式 `null` 穿透** —— 调用方传 `null` 时不触发排雷，
   而 splice 会把 `null` **当 0 静默用** ⇒ 正是我要防的那类失败，却从我的闸底下走过去。
   ✅ **改一行：`stateStart == null`**（同时收 `undefined` 与 `null`）。**这条我认，属实漏**。
2. ⚠ **防御深度的实话（必须写进文档，别让人以为排雷全覆盖）**：现存调用点普遍用
   `?? _POOL_STATE_START` 这个习语 —— 它**在进函数之前**就把 undefined 换成 1，
   ⇒ 我这道排雷**只拦"省略第 4 参"那种写法**；**将来照抄主流习语的人会绕过它**。
   ⇒ 它是**减少一类误用**，不是"该族再也不会吃错默认"。
3. ⚠ **96B 不唯一指认 RootClaim 族**：`p2sh.mjs:1554` 注明**旧 depth-8 PayoutShard state 也是 96B**（已 superseded）。
   方向仍是 fail-closed（抛而非算错）⇒ **安全侧**；但**我的报错文案把 96B 直接说成"单-entry RootClaim 族"是误导**，
   ✅ 文案改成"该长度对应多于一族（含已 superseded 的 depth-8 PayoutShard），必须显式传 stateStart"。

**🔴 Codex `0741bae0` 否掉了本 diff 的 builder 那半的【权威性】（我认，且它是对的）**：
> `POOLROOT_STATE_START = 1` **字面量作唯一权威 = REJECTED / MUST-FIX**。
> 常量可留作**防御断言**，但**权威必须来自构造时 `templatePrefix.length`**，或绑定 redeem 身份的描述符。

⇒ **这正好是我 CP1 自己写下的结论，而我在 diff 里没有贯彻到底** —— 我写了"权威来自构造时"，
却仍然落成了一个**手写的 1**。⇒ **builder 需要拿到 artifact（`templatePrefix`），而不是一个常量**；
现签名只收 `poolRedeemHex`，所以这一格要么加参数、要么由调用方传 `state_start` 进来。
**⇒ 本 diff 的定性随之下调：它是【防御性增量】（J1 三点过可 land），而 Fix-authority 那格仍 OPEN。**

**同批硬约束（J1 复核确认，我原已列，此处强化）**：
`u1-roundtrip-b1.mutants.mjs:27` 的 `CALLSITE` 常量**钉死旧 `:2812` 的行文本** ⇒ 本 diff 一 land 即失配
⇒ 变异器会变成 **BROKEN 而不是红** —— **那是最坏的读数形态（看起来"跑了"，其实什么也没测）**。
**post-Fix 测试改动必须同批 land。**

---

## 提案 diff（`git apply` 可直接用 · ⚠ 上一节的三处修正尚未并入下方文本）

```diff
diff --git a/kasia-console/src/lib/pool-refund-builder.mjs b/kasia-console/src/lib/pool-refund-builder.mjs
index d64eda8e..ae43de29 100644
--- a/kasia-console/src/lib/pool-refund-builder.mjs
+++ b/kasia-console/src/lib/pool-refund-builder.mjs
@@ -17,6 +17,13 @@
 
 import { blake2b } from '@noble/hashes/blake2b';
 
+// PoolRoot（多-entry，selector dispatch 前导 1B）的 state_layout.start。
+// 🔴 **不是自由字面量**：它绑在一条 typed 事实上 —— 本 builder 只产出 `bshard_refund_cancelled`，
+//    而该 cmd.type 按 relay 的显式分派只会去花 **PoolRoot**。权威来自**构造时知道自己在拼哪个模板**
+//    （`scripts/bshard-e2e-flow.mjs:114`：rootRedeem = templatePrefix + state + templateSuffix
+//     ⇒ start ≡ templatePrefix.length），**不是**从 redeem 字节反推。
+const POOLROOT_STATE_START = 1;
+
 /**
  * Assemble the refund_draw witness, self-verified against the PoolSide ticket's baked ps_tmpl_hash.
  * @param {object} o {
@@ -85,7 +92,13 @@ export function buildRefundCommand({ witness, poolOutpointTxid, poolRedeemHex, c
       bettor_pk: witness.bettorPk,
     },
     inputs: {
-      pool: { outpointTxid: poolOutpointTxid, redeem_hex: poolRedeemHex, current_state: currentPoolState },
+      // 🔴 Fix ①②③：typed 路径绑自己模板已知的 start（见上方常量的理由）。
+      //    此前**没有任何 builder 放过这个字段**，于是 relay 侧「caller 必须传、别硬编」那句
+      //    （2026-06-20 三方诊断后写下）七周无人执行、两支都吃默认。
+      pool: {
+        outpointTxid: poolOutpointTxid, redeem_hex: poolRedeemHex, current_state: currentPoolState,
+        state_start: POOLROOT_STATE_START,
+      },
       ticket: { outpointTxid: ticketOutpointTxid, redeem_hex: ticketRedeemHex, state: ticketState },
     },
     // outputs: refund → bettor P2PK = stake; pool_continuation (relay computes per-state addr; value-=stake, closed=2); change (relay computes amount)
diff --git a/kasia-relay/src/lib/p2sh.mjs b/kasia-relay/src/lib/p2sh.mjs
index f5b9865b..947f6aa8 100644
--- a/kasia-relay/src/lib/p2sh.mjs
+++ b/kasia-relay/src/lib/p2sh.mjs
@@ -1671,7 +1671,18 @@ export function _continuationAddressV2(inputRedeemHex, newStateHex, networkId, s
 //    (pool-claim/close/refund-builder 三个逐个查, 全无) ⇒ **该指令 7 周来从未被执行, 两支都吃默认**。
 //    ⇒ 又一次「注释不是闸」。详见 docs/2026-08-12-j2-statestart-has-no-authoritative-descriptor.md
 // 🔵 export 同上: 仅为可测性, 行为零改动。
-export function _continuationAddress(inputRedeemHex, newStateHex, networkId, stateStart = _POOL_STATE_START) {
+export function _continuationAddress(inputRedeemHex, newStateHex, networkId, stateStart = undefined) {
+  // 🔴 **潜伏陷阱的拆除**（J2 2026-08-12 报，今日零 caller 故非现行事故）:
+  //    下方长度白名单**收 `_ROOTCLAIM_STATE_LEN`(96B) 这一族单-entry state**，而旧默认是多-entry 的 1
+  //    ⇒ 将来第一个实现单-entry continuation 的人会被**白名单放行**（等于被告知"这个 state 类型合法"）、
+  //      拿到**错 offset**，产出**语法合法、资金锁死**的地址，且**全程不报错**。
+  //    ⇒ 该族**必须显式传** stateStart，**不给默认**；其余族维持原默认（行为不变）。
+  if (stateStart === undefined) {
+    if (Buffer.from(newStateHex, 'hex').length === _ROOTCLAIM_STATE_LEN) {
+      throw new Error(`_continuationAddress: ${_ROOTCLAIM_STATE_LEN}B（单-entry RootClaim 族）必须显式传 stateStart —— 该族 start 与默认不同，不猜`);
+    }
+    stateStart = _POOL_STATE_START;
+  }
   const redeem = Buffer.from(inputRedeemHex, 'hex');
   const stateBytes = Buffer.from(newStateHex, 'hex');
   if (![_LEAF_STATE_LEN, _ROOT_STATE_LEN, _ROOTCLAIM_STATE_LEN, _PAYOUTSHARD_STATE_LEN].includes(stateBytes.length)) {
@@ -2809,7 +2820,18 @@ export async function unlockBshardRefund(args) {
     const ticketUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.ticket.redeem_hex, networkId), cmd.inputs.ticket.outpointTxid);
     const matched = [poolUtxo, ticketUtxo];
 
-    const newPoolAddr = _continuationAddress(cmd.inputs.pool.redeem_hex, _serializeRootStateHex(cmd.outputs.pool_continuation.state), networkId);
+    // 🔴 Fix ④：**只断言，不选择**。本路径由 relay 按 `cmd.type='bshard_refund_cancelled'` 显式分派，
+    //    花的必然是 PoolRoot（多-entry）⇒ start 必须是 `_POOL_STATE_START`。
+    //    缺失或不符 ⇒ **抛**，不静默回落 —— 回落正是上方注释要求过、却七周无人执行的那条。
+    //    ⚠ 形状是**断言**不是选择器：这里不存在"选 0"的分支，因为这条 typed 路径永远不花单-entry。
+    const poolStateStart = cmd.inputs.pool.state_start;
+    if (poolStateStart === undefined || poolStateStart === null) {
+      throw new Error('bshard_refund: cmd.inputs.pool.state_start 缺失 — typed 路径必须由 builder 显式携带（fail-closed，不回落默认）');
+    }
+    if (Number(poolStateStart) !== _POOL_STATE_START) {
+      throw new Error(`bshard_refund: state_start=${poolStateStart} 与本 typed 路径的 PoolRoot 族（${_POOL_STATE_START}）不符 ⇒ 拒`);
+    }
+    const newPoolAddr = _continuationAddress(cmd.inputs.pool.redeem_hex, _serializeRootStateHex(cmd.outputs.pool_continuation.state), networkId, Number(poolStateStart));
     const outputs = [];
     outputs[w.payout_out_idx] = new TransactionOutput(BigInt(cmd.outputs.payout.amountSompi), payToAddressScript(new Address(cmd.outputs.payout.address)));
     outputs[w.pool_out_idx] = new TransactionOutput(BigInt(cmd.outputs.pool_continuation.amountSompi), payToAddressScript(new Address(newPoolAddr)));
```

---

## rev（2026-08-13 · CP2-rev 完整版 · 取代上方初稿 · **未 land**）

**为什么有 rev**：Codex `0741bae0` 明裁「字面量作唯一权威 = REJECTED」。上方初稿把 `POOLROOT_STATE_START = 1`
当权威用了 —— 这个结论我在 CP1 里自己写过，然后在 CP2 初稿里**没贯彻**。rev 把权威搬到构造方。
Bettor 19:14Z 排序：**一批做完，别先 land 防御增量**（常量版单独 land 会让 Codex 要的"变异权威产生步"无处可打）。

### 与初稿的三处实质差异

| # | 初稿 | rev | 为什么 |
|---|---|---|---|
| ① | builder 用常量 `1` | builder 收 `poolTemplatePrefixHex`，**派生** `prefix.length/2` | 权威=构造方手上的模板前缀；常量降级为防御断言 |
| ② | — | builder 验 `poolRedeemHex.startsWith(prefix)` | **数可以被随手填对，前缀能被验** —— 把描述符绑到实际会上链的那段脚本上 |
| ③ | `=== undefined \|\| === null` | `== null` | @J1tn 19:09Z：显式 `null` 穿透 `===`，splice 把它当 0 静默用 |

### 承重事实（本轮实核，非引述）

- **构造方确实有前缀**：`kasia-console/scripts/bshard-e2e-flow.mjs:114`
  `rootRedeemHex = rootArtifact.templatePrefix.hex + state + templateSuffix.hex` ⇒ `start ≡ templatePrefix.length`。
  这条以前是推断，现在是读出来的。
- **新增必填参数不打断任何现行路径**：`buildRefundCommand` 全仓仅 `bshard-e2e-flow.mjs:22`
  **import 而从不调用**（该文件实调的是 `buildClaimWitness`）⇒ 零活调用方。
  🔵 注意这是"**尚未接线**"，不是"**已验证兼容**"——接线那件事仍未排期（COORD-LEDGER §重定位）。

### 读数

- `u1-roundtrip-b1.test.mjs`：**9 PASS / 0 FAIL**（原 2 格 + Fix④/④-bis/⑤ 三格 fail-closed + 权威步 3 格）
- `u1-continuation-statestart.test.mjs`（B-2）：**4 PASS / 0 FAIL**，不受影响
- `u1-roundtrip-b1.mutants.mjs`（**已改为双文件变异**，打 builder 权威产生步 + relay 传播/闸）：
  `detected=5  MISSED=2  INERT=0  BROKEN=0`，两份钱路文件**逐字节 sha256 还原已验**
  - detected：拆前缀绑定检查 / builder 不写 state_start / relay 篡改 +1 / 缺失闸失效 / 族不符闸失效
  - 🔴 **MISSED=2 是预注册的结构性残余，不是本轮新发现，也不构成闭合**：
    「builder 改回常量」与「relay 回落默认」在**权威值恰好等于默认值 1** 时行为不可分。
    要让它们变红，需要一条 `start≠1` 的真实 typed 路径进 B-1，**现无夹具**。
    变异器已把预期写进代码（`expect-MISSED-structural`），读数与预期不符会 exit 1 ——
    因为「MISSED 数字对得上」不等于「MISSED 的是同一批」。

### 状态

- **未 land**。工作区已还原，共享检出无未批的钱路改动。
- 待 @J1tn 二审 rev（重点：② 的绑定是否真绑住、`== null` 的覆盖、变异锚点唯一性）。
- land 决定在 @Bettor。**round-trip 仍 OPEN，我不自宣闭合。**
- 一批含 4 文件：`pool-refund-builder.mjs` / `p2sh.mjs` / `u1-roundtrip-b1.test.mjs` / `u1-roundtrip-b1.mutants.mjs`。
  🔴 **必须同批**：test/mutants 单独留下会对未 Fix 的树变红；Fix 单独 land 会让变异器锚点失配变 BROKEN（而非红）。

### 完整 diff（钱路两文件；test/mutants 见同批 4 文件）

```diff
diff --git a/kasia-console/src/lib/pool-refund-builder.mjs b/kasia-console/src/lib/pool-refund-builder.mjs
index d64eda8e..f145cc37 100644
--- a/kasia-console/src/lib/pool-refund-builder.mjs
+++ b/kasia-console/src/lib/pool-refund-builder.mjs
@@ -17,6 +17,13 @@
 
 import { blake2b } from '@noble/hashes/blake2b';
 
+// PoolRoot（多-entry，selector dispatch 前导 1B）的 state_layout.start —— **仅作防御断言用**。
+// 🔴 **它不是权威**（Codex `0741bae0` 明裁：字面量作唯一权威 = REJECTED）。
+//    权威 = **构造方传进来的 `templatePrefix.length`** —— 拼这份 redeem 的人手上就有它
+//    （`scripts/bshard-e2e-flow.mjs:114`：`rootRedeem = templatePrefix + state + templateSuffix`
+//     ⇒ `start ≡ templatePrefix.length`）。本常量只在传入值与本 typed 路径的已知族不符时**喊出手滑**。
+const POOLROOT_STATE_START = 1;
+
 /**
  * Assemble the refund_draw witness, self-verified against the PoolSide ticket's baked ps_tmpl_hash.
  * @param {object} o {
@@ -58,8 +65,26 @@ export function buildRefundWitness(o) {
  * (on-chain L238) self-checked here: payout(stake) + pool_out(poolValue-stake) == poolValue (no value created).
  * @returns {object} relay command (action='bshard_refund_cancelled')
  */
-export function buildRefundCommand({ witness, poolOutpointTxid, poolRedeemHex, currentPoolState, ticketOutpointTxid, ticketRedeemHex, ticketState, poolValueSompi, bettorAddress, poolContinuationState, changeAddress }) {
+export function buildRefundCommand({ witness, poolOutpointTxid, poolRedeemHex, poolTemplatePrefixHex, currentPoolState, ticketOutpointTxid, ticketRedeemHex, ticketState, poolValueSompi, bettorAddress, poolContinuationState, changeAddress }) {
   if (!poolOutpointTxid || !ticketOutpointTxid) throw new Error('poolOutpointTxid + ticketOutpointTxid required');
+  // 🔴 **权威 = 拼装这份 redeem 用的模板前缀本身**（Codex `0741bae0`：字面量作唯一权威 = REJECTED）。
+  //    收前缀而不是收一个数，是因为**数可以被随手填对，而前缀能被验**：
+  //    `rootRedeem = templatePrefix + state + templateSuffix`（`scripts/bshard-e2e-flow.mjs:114`）
+  //    ⇒ ① `start ≡ templatePrefix.length` 由它**派生**，不是申报；
+  //       ② 且必须**验证这份 redeem 确实以该前缀开头** —— 这一步把「描述符」与「实际会上链的那段脚本」
+  //          绑在一起，正是 Codex 要的"绑定 redeem 身份"。
+  if (typeof poolTemplatePrefixHex !== 'string' || !/^[0-9a-fA-F]+$/.test(poolTemplatePrefixHex) || poolTemplatePrefixHex.length % 2 !== 0) {
+    throw new Error('poolTemplatePrefixHex required (拼 pool redeem 用的模板前缀 hex) — 缺失/非法即 fail-closed, 不默认');
+  }
+  if (typeof poolRedeemHex !== 'string' || !poolRedeemHex.toLowerCase().startsWith(poolTemplatePrefixHex.toLowerCase())) {
+    throw new Error('poolRedeemHex 不以 poolTemplatePrefixHex 开头 ⇒ 该前缀不是这份 redeem 的模板 ⇒ 拒（描述符必须绑到实际脚本上）');
+  }
+  const poolStateStart = poolTemplatePrefixHex.length / 2;   // ← 派生, 非申报
+  // 🔵 常量在这里**只作防御断言**：它不产生权威，只在派生值与本 typed 路径（PoolRoot 多-entry）
+  //    的已知族不符时把手滑/换模板喊出来。
+  if (poolStateStart !== POOLROOT_STATE_START) {
+    throw new Error(`派生 state_start=${poolStateStart} 与本 typed 路径(bshard_refund_cancelled ⇒ PoolRoot 多-entry, ${POOLROOT_STATE_START}) 不符 ⇒ 拒`);
+  }
   if (!currentPoolState) throw new Error('currentPoolState (current pool 7-field state; relay computes current per-state pool address) required');
   if (!ticketState) throw new Error('ticketState {bettorPk, direction, stake, shardPoolId} (relay computes ticket address) required');
   if (!bettorAddress) throw new Error('bettorAddress (P2PK(bettorPk); refund recipient) required');
@@ -85,7 +110,11 @@ export function buildRefundCommand({ witness, poolOutpointTxid, poolRedeemHex, c
       bettor_pk: witness.bettorPk,
     },
     inputs: {
-      pool: { outpointTxid: poolOutpointTxid, redeem_hex: poolRedeemHex, current_state: currentPoolState },
+      // `state_start` = 构造方传进来的权威值（已在函数头做存在性 + 族一致断言）。
+      pool: {
+        outpointTxid: poolOutpointTxid, redeem_hex: poolRedeemHex, current_state: currentPoolState,
+        state_start: poolStateStart,
+      },
       ticket: { outpointTxid: ticketOutpointTxid, redeem_hex: ticketRedeemHex, state: ticketState },
     },
     // outputs: refund → bettor P2PK = stake; pool_continuation (relay computes per-state addr; value-=stake, closed=2); change (relay computes amount)
diff --git a/kasia-relay/src/lib/p2sh.mjs b/kasia-relay/src/lib/p2sh.mjs
index f5b9865b..3c0365d4 100644
--- a/kasia-relay/src/lib/p2sh.mjs
+++ b/kasia-relay/src/lib/p2sh.mjs
@@ -1671,7 +1671,24 @@ export function _continuationAddressV2(inputRedeemHex, newStateHex, networkId, s
 //    (pool-claim/close/refund-builder 三个逐个查, 全无) ⇒ **该指令 7 周来从未被执行, 两支都吃默认**。
 //    ⇒ 又一次「注释不是闸」。详见 docs/2026-08-12-j2-statestart-has-no-authoritative-descriptor.md
 // 🔵 export 同上: 仅为可测性, 行为零改动。
-export function _continuationAddress(inputRedeemHex, newStateHex, networkId, stateStart = _POOL_STATE_START) {
+export function _continuationAddress(inputRedeemHex, newStateHex, networkId, stateStart = undefined) {
+  // 🔴 **潜伏陷阱的拆除**（J2 2026-08-12 报；今日零 caller 故非现行事故）:
+  //    下方长度白名单**收 `_ROOTCLAIM_STATE_LEN`(96B)**，而旧默认是多-entry 的 1
+  //    ⇒ 将来第一个实现该长度族 continuation 的人会被**白名单放行**（等于被告知"这个 state 类型合法"）、
+  //      拿到**可能错的 offset**，产出**语法合法、资金锁死**的地址且**全程不报错**。⇒ 该长度**必须显式传**。
+  //    ⚠ `== null` 而非 `=== undefined`（@J1tn 19:09Z 抓）: 显式传 `null` 会穿透 `===`，
+  //       而 splice 会把 `null` 当 0 静默用 —— **正是这道闸要防的失败，从闸底下走过去**。
+  //    ⚠ **防御深度的实话**: 现存调用点普遍写 `?? _POOL_STATE_START`，那个习语**在进本函数前**
+  //       就把 undefined 换成 1 ⇒ 本闸**只拦"省略第 4 参"的写法**，照抄主流习语的人绕得过去。
+  //       它减少一类误用，**不等于**该族再也不会吃错默认。
+  if (stateStart == null) {
+    if (Buffer.from(newStateHex, 'hex').length === _ROOTCLAIM_STATE_LEN) {
+      // ⚠ 96B 不唯一指认某一族（`:1554`: 已 superseded 的 depth-8 PayoutShard state 也是 96B）
+      //    ⇒ 文案不下断言，只要求显式传（方向 fail-closed，抛而非算错）。
+      throw new Error(`_continuationAddress: ${_ROOTCLAIM_STATE_LEN}B state 对应多于一族（RootClaim 族 / 已 superseded 的 depth-8 PayoutShard）⇒ 必须显式传 stateStart，不猜`);
+    }
+    stateStart = _POOL_STATE_START;
+  }
   const redeem = Buffer.from(inputRedeemHex, 'hex');
   const stateBytes = Buffer.from(newStateHex, 'hex');
   if (![_LEAF_STATE_LEN, _ROOT_STATE_LEN, _ROOTCLAIM_STATE_LEN, _PAYOUTSHARD_STATE_LEN].includes(stateBytes.length)) {
@@ -2809,7 +2826,19 @@ export async function unlockBshardRefund(args) {
     const ticketUtxo = await _matchUtxo(rpc, _addressFromRedeem(cmd.inputs.ticket.redeem_hex, networkId), cmd.inputs.ticket.outpointTxid);
     const matched = [poolUtxo, ticketUtxo];
 
-    const newPoolAddr = _continuationAddress(cmd.inputs.pool.redeem_hex, _serializeRootStateHex(cmd.outputs.pool_continuation.state), networkId);
+    // 🔴 Fix ④：**只断言，不选择**。本路径由 relay 按 `cmd.type='bshard_refund_cancelled'` 显式分派，
+    //    花的必然是 PoolRoot（多-entry）⇒ start 必须是 `_POOL_STATE_START`。
+    //    缺失/不符 ⇒ **抛**，不静默回落 —— 回落正是上方注释要求过、却七周无人执行的那条。
+    //    ⚠ 形状是**断言**不是选择器：这里没有"选 0"的分支，因为该 typed 路径永不花单-entry
+    //      （`bshard_refund_claim` 那条花的是 PayoutShard，start 同为 1；两个 "RefundClaim" 是同名不同物）。
+    const poolStateStart = cmd.inputs.pool.state_start;
+    if (poolStateStart == null) {
+      throw new Error('bshard_refund: cmd.inputs.pool.state_start 缺失 — typed 路径必须由 builder 携带（builder 侧由模板前缀派生）；fail-closed，不回落默认');
+    }
+    if (Number(poolStateStart) !== _POOL_STATE_START) {
+      throw new Error(`bshard_refund: state_start=${poolStateStart} 与本 typed 路径的 PoolRoot 族（${_POOL_STATE_START}）不符 ⇒ 拒`);
+    }
+    const newPoolAddr = _continuationAddress(cmd.inputs.pool.redeem_hex, _serializeRootStateHex(cmd.outputs.pool_continuation.state), networkId, Number(poolStateStart));
     const outputs = [];
     outputs[w.payout_out_idx] = new TransactionOutput(BigInt(cmd.outputs.payout.amountSompi), payToAddressScript(new Address(cmd.outputs.payout.address)));
     outputs[w.pool_out_idx] = new TransactionOutput(BigInt(cmd.outputs.pool_continuation.amountSompi), payToAddressScript(new Address(newPoolAddr)));
```

### 同批 test/mutants diff（非钱路，但必须同批 land）

```diff
diff --git a/kasia-console/src/lib/u1-roundtrip-b1.mutants.mjs b/kasia-console/src/lib/u1-roundtrip-b1.mutants.mjs
index a127549b..892951e8 100644
--- a/kasia-console/src/lib/u1-roundtrip-b1.mutants.mjs
+++ b/kasia-console/src/lib/u1-roundtrip-b1.mutants.mjs
@@ -1,12 +1,15 @@
-// B-1 的**决定性验证**: 变异【真实生产调用点】`p2sh.mjs:2812`(unlockBshardRefund 里那句),
-// 看指定用例会不会因正确原因变红。
+// B-1 的**决定性验证**(post-Fix 版): 变异【真实生产码】, 看指定用例会不会因正确原因变红。
+//
+// 🔴 pre-Fix 版只变异 relay 调用点, 只能证"这参数敏感"。CP2-rev 之后, **权威产生步搬到了 builder**
+//    (`pool-refund-builder.mjs`: 从模板前缀派生 + 验前缀确属这份 redeem)。Codex ⑦ 要的决定性变异
+//    打的是**那一步**, 所以本文件从单文件改成**双文件**变异, 并新增 builder 侧锚点。
 //
 // 判据 `3b395e6c` §4-B1 一票否决线:
-//   · **变异真实调用点**(helper 不动) ⇒ 至少一个指定测试必须变红;
+//   · **变异真实生产码**(helper 不动) ⇒ 至少一个指定测试必须变红;
 //   · 变异下仍全绿 ⇒ **报告该读数但【不许闭格】**(= 生产接缝无人观察);
 //   · 只 grep 调用点 / 再直调 helper ⇒ 不满足。
 //
-// 🔴 本文件**临时改动钱路文件**(p2sh.mjs), 收尾**验 sha256 逐字节还原** —— 与我另两份 mutants 同规格。
+// 🔴 本文件**临时改动钱路文件**(p2sh.mjs / pool-refund-builder.mjs), 收尾**逐文件验 sha256 还原**。
 //    还原对不上就 exit 2 并把路径打出来, 不让变异体留在库里。
 import { readFileSync, writeFileSync } from 'node:fs';
 import { execFileSync } from 'node:child_process';
@@ -16,48 +19,88 @@ import { createHash } from 'node:crypto';
 
 const HERE = dirname(fileURLToPath(import.meta.url));
 const ROOT = process.env.KANET_ROOT || join(HERE, '..', '..', '..');
-const SRC = join(ROOT, 'kasia-relay', 'src', 'lib', 'p2sh.mjs');
+const RELAY = join(ROOT, 'kasia-relay', 'src', 'lib', 'p2sh.mjs');
+const BUILDER = join(HERE, 'pool-refund-builder.mjs');
 const TEST = join(HERE, 'u1-roundtrip-b1.test.mjs');
 const CWD = join(ROOT, 'kasia-console');
 
-const original = readFileSync(SRC, 'utf8');
-const originalSha = createHash('sha256').update(original).digest('hex');
-
-// 🔵 锚点唯一性已现查(全文件 1 处), 变异只碰 unlockBshardRefund 那一句, **不碰 helper**。
-const CALLSITE = 'const newPoolAddr = _continuationAddress(cmd.inputs.pool.redeem_hex, _serializeRootStateHex(cmd.outputs.pool_continuation.state), networkId);';
+const FILES = [RELAY, BUILDER];
+const originals = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));
+const shas = new Map(FILES.map((f) => [f, createHash('sha256').update(originals.get(f)).digest('hex')]));
 
+// 🔵 每条锚点唯一性由 INERT/多命中检查现场兜底(替换后若字符串没变 ⇒ INERT ⇒ 不计入 detected)。
 const MUTANTS = [
-  ['🔴 生产调用点传错 start(0) —— B-1 的那一格',
-    (s) => s.replace(CALLSITE, CALLSITE.replace('networkId);', 'networkId, 0);'))],
-  ['生产调用点传错 start(2) —— 换个错值, 排除"只对 0 敏感"',
-    (s) => s.replace(CALLSITE, CALLSITE.replace('networkId);', 'networkId, 2);'))],
+  // ── 权威产生步(builder) —— CP2-rev 新增的那一层 ─────────────────────────────
+  ['权威步: builder 不再从前缀派生, 改回常量', BUILDER,
+    (s) => s.replace('const poolStateStart = poolTemplatePrefixHex.length / 2;',
+      'const poolStateStart = POOLROOT_STATE_START;'),
+    'expect-MISSED-structural'],
+  ['权威步: 拆掉"前缀必须确属这份 redeem"的绑定检查', BUILDER,
+    (s) => s.replace('!poolRedeemHex.toLowerCase().startsWith(poolTemplatePrefixHex.toLowerCase())', 'false'),
+    'expect-detect'],
+  ['权威步: builder 不把 state_start 写进命令', BUILDER,
+    (s) => s.replace('        state_start: poolStateStart,\n', ''),
+    'expect-detect'],
+  // ── 传播 + 消费(relay) ────────────────────────────────────────────────────
+  ['传播: relay 忽略命令值, 回落默认', RELAY,
+    (s) => s.replace('networkId, Number(poolStateStart));', 'networkId);'),
+    'expect-MISSED-structural'],
+  ['传播: relay 篡改消费值(+1)', RELAY,
+    (s) => s.replace('networkId, Number(poolStateStart));', 'networkId, Number(poolStateStart) + 1);'),
+    'expect-detect'],
+  ['闸: 缺失/null 不再抛', RELAY,
+    (s) => s.replace('if (poolStateStart == null) {', 'if (false) {'),
+    'expect-detect'],
+  ['闸: 族不符不再抛', RELAY,
+    (s) => s.replace('if (Number(poolStateStart) !== _POOL_STATE_START) {', 'if (false) {'),
+    'expect-detect'],
 ];
 
 let det = 0; let miss = 0; let inert = 0; let broken = 0;
+const surprises = [];
 try {
-  // 前置: 未变异时必须全绿, 否则下面的"红"没有意义
   let baseGreen = true;
   try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { baseGreen = false; }
   console.log(baseGreen ? '[baseline] 未变异 ⇒ 全绿 ✅' : '[baseline] 🔴 未变异就红了 —— 先修用例, 本轮变异读数无效');
   if (!baseGreen) process.exit(3);
 
-  for (const [name, fn] of MUTANTS) {
-    const mutated = fn(original);
-    if (mutated === original) { inert += 1; console.log(`[INERT ] ${name} — 锚点没命中, 这条什么也没测`); continue; }
-    writeFileSync(SRC, mutated, 'utf8');
-    let syntaxOk = true;
-    try { execFileSync(process.execPath, ['--check', SRC], { stdio: 'ignore' }); } catch { syntaxOk = false; }
-    if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 必然"检出", 什么也没证`); continue; }
-    let green = true;
-    try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { green = false; }
-    if (green) { miss += 1; console.log(`[MISSED] ${name} — 🔴 调用点被改坏而用例【全绿】= 生产接缝无人观察 ⇒ 判据说: 报告该读数, 【不许闭格】`); }
-    else { det += 1; console.log(`[detect] ${name}`); }
+  for (const [name, file, fn, expect] of MUTANTS) {
+    const orig = originals.get(file);
+    const mutated = fn(orig);
+    if (mutated === orig) { inert += 1; console.log(`[INERT ] ${name} — 锚点没命中, 这条什么也没测`); continue; }
+    writeFileSync(file, mutated, 'utf8');
+    let outcome;
+    try {
+      let syntaxOk = true;
+      try { execFileSync(process.execPath, ['--check', file], { stdio: 'ignore' }); } catch { syntaxOk = false; }
+      if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 必然"检出", 什么也没证`); continue; }
+      let green = true;
+      try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { green = false; }
+      outcome = green ? 'MISSED' : 'detect';
+      if (green) { miss += 1; console.log(`[MISSED] ${name} — 用例全绿`); }
+      else { det += 1; console.log(`[detect] ${name}`); }
+    } finally {
+      writeFileSync(file, orig, 'utf8');   // 每条即刻还原, 不让两条变异叠加
+    }
+    // 🔴 预期与读数不符 ⇒ 单独喊出来: "MISSED 数字对得上"不等于"MISSED 的是同一批"
+    const want = expect === 'expect-detect' ? 'detect' : 'MISSED';
+    if (outcome !== want) surprises.push(`${name}: 预期 ${want}, 实得 ${outcome}`);
   }
 } finally {
-  writeFileSync(SRC, original, 'utf8');
-  const back = createHash('sha256').update(readFileSync(SRC, 'utf8')).digest('hex');
-  if (back === originalSha) console.log('\n[restore] 逐字节还原已验(sha256 相同)');
-  else { console.log(`\n🔴🔴 [restore] 还原【对不上】! 手工检查 ${SRC}`); process.exit(2); }
+  let restoreOk = true;
+  for (const f of FILES) {
+    writeFileSync(f, originals.get(f), 'utf8');
+    const back = createHash('sha256').update(readFileSync(f, 'utf8')).digest('hex');
+    if (back === shas.get(f)) console.log(`[restore] 逐字节还原已验(sha256 相同): ${f}`);
+    else { restoreOk = false; console.log(`🔴🔴 [restore] 还原【对不上】! 手工检查 ${f}`); }
+  }
+  if (!restoreOk) process.exit(2);
 }
-console.log(`detected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}`);
-if (miss || inert || broken) process.exit(1);
+console.log(`\ndetected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}`);
+// 🔴 结构性 MISSED (2 条) 是**已知且已上报**的残余, 不是本轮新发现:
+//    ① builder 改回常量 / ② relay 回落默认 —— 两者在**权威值恰好等于默认值(1)** 时行为不可分。
+//    要让它们变红, 需要一条 start≠1 的真实 typed 路径(RootClaim 单-entry 那族)进 B-1, 现无夹具。
+//    ⇒ 判据说: **报告该读数, 不许据此闭格**。
+if (surprises.length) { console.log('🔴 预期不符:\n  ' + surprises.join('\n  ')); process.exit(1); }
+if (inert || broken) process.exit(1);
+console.log(miss === 2 ? '✅ 读数与预期一致(含 2 条【已上报的结构性 MISSED】—— 不构成闭合)' : '');
diff --git a/kasia-console/src/lib/u1-roundtrip-b1.test.mjs b/kasia-console/src/lib/u1-roundtrip-b1.test.mjs
index 3d5ccd6a..5ccda594 100644
--- a/kasia-console/src/lib/u1-roundtrip-b1.test.mjs
+++ b/kasia-console/src/lib/u1-roundtrip-b1.test.mjs
@@ -59,7 +59,11 @@ const t = async (name, fn) => {
 // 字段序逐字抄生产 `_serializeRootStateHex`，不是我编的
 const STATE = { local_yes: '11', local_no: '22', count: '3', pool_value: '444', closed: '0', winningSide: '0', payoutRoot: 'ab'.repeat(32) };
 const stateHex = p2sh._serializeRootStateHex(STATE);
-const POOL_REDEEM = '51' + stateHex + 'ff'.repeat(8);
+// ⚠ 前缀是**合成 fixture 的**，不冒充生产模板字节（生产实测首字节是 0x6b，见
+//    `scripts/tn12-redeem-prefix-census.cjs`）。本用例测的是**传播与断言**，不是模板身份识别，
+//    所以这里只需要"一个长度为 1 的前缀"，且**长度由它自己派生**而不是写死。
+const POOL_PREFIX_HEX = '51';
+const POOL_REDEEM = POOL_PREFIX_HEX + stateHex + 'ff'.repeat(8);
 const TICKET_REDEEM = '51' + stateHex + 'ee'.repeat(8);
 const priv = new kaspa.PrivateKey('11'.repeat(32));
 const ADDR = priv.toKeypair().toAddress(kaspa.NetworkType.Testnet).toString();
@@ -69,7 +73,9 @@ async function runRefundAndCaptureContinuationSpk() {
   captured = null;
   globalThis.__FAKE_TXID_QUEUE__ = ['aa'.repeat(32), 'bb'.repeat(32)];
   const cmd = {
-    inputs: { pool: { redeem_hex: POOL_REDEEM, outpointTxid: 'aa'.repeat(32) },
+    // post-Fix: 命令必须携带 state_start。这里**照 builder 的方式派生**（模板前缀长度），
+    // 而不是写一个字面量 —— 用例若自己写死 1，就又变成"夹具与实现共享同一个发明"。
+    inputs: { pool: { redeem_hex: POOL_REDEEM, outpointTxid: 'aa'.repeat(32), state_start: POOL_PREFIX_HEX.length / 2 },
       ticket: { redeem_hex: TICKET_REDEEM, outpointTxid: 'bb'.repeat(32) } },
     outputs: { payout: { amountSompi: '500000000', address: ADDR },
       pool_continuation: { amountSompi: '500000000', state: STATE },
@@ -105,5 +111,67 @@ await t('B-1 对照臂 · start=0 的期望与 start=1 【不同】(否则决定
   assert.notStrictEqual(at1, at0, 'start=1 与 0 产出同一个 spk ⇒ 本用例无法察觉调用点传错 start');
 });
 
+// ── post-Fix 两道 fail-closed 闸（Codex Fix ④ + Bettor 18:18Z typed 绑定） ──────
+const cmdWithPool = (poolExtra) => ({
+  inputs: { pool: { redeem_hex: POOL_REDEEM, outpointTxid: 'aa'.repeat(32), ...poolExtra },
+    ticket: { redeem_hex: TICKET_REDEEM, outpointTxid: 'bb'.repeat(32) } },
+  outputs: { payout: { amountSompi: '500000000', address: ADDR },
+    pool_continuation: { amountSompi: '500000000', state: STATE }, change_address: ADDR },
+  witness: { pool_out_idx: 0, payout_out_idx: 1, ticket_in_idx: 1, ticket_prefix_len: 0, ticket_suffix_len: 0 },
+});
+const runWith = (cmd) => p2sh.unlockBshardRefund({
+  wallet: { getPrivateKey: () => priv, getNetworkId: () => NET }, cmd, networkId: NET,
+});
+
+await t('Fix④ · 缺 state_start ⇒ 生产码【抛】且未走到 submit（不静默回落默认）', async () => {
+  captured = null;
+  globalThis.__FAKE_TXID_QUEUE__ = ['aa'.repeat(32), 'bb'.repeat(32)];
+  await assert.rejects(() => runWith(cmdWithPool({})), /state_start 缺失/, '缺失竟未抛 ⇒ 回落默认那条路还在');
+  assert.strictEqual(captured, null, '抛之前不该已经走到 submit');
+});
+
+await t('Fix④-bis · 显式传 null 也必须抛（=== undefined 会被它穿透, splice 把 null 当 0）', async () => {
+  captured = null;
+  globalThis.__FAKE_TXID_QUEUE__ = ['aa'.repeat(32), 'bb'.repeat(32)];
+  await assert.rejects(() => runWith(cmdWithPool({ state_start: null })), /state_start 缺失/,
+    'null 穿透 ⇒ 正是这道闸要防的失败从闸底下走过去（@J1tn 19:09Z 抓）');
+});
+
+await t('Fix⑤ · state_start 与本 typed 路径的族不符 ⇒ 抛', async () => {
+  captured = null;
+  globalThis.__FAKE_TXID_QUEUE__ = ['aa'.repeat(32), 'bb'.repeat(32)];
+  await assert.rejects(() => runWith(cmdWithPool({ state_start: 0 })), /不符/,
+    '不符的 offset 被放行 ⇒ 错 offset = 语法合法但资金锁死的 continuation');
+});
+
+// ── 权威产生步（builder 侧）—— Codex ⑦ 要的决定性变异打的就是这里 ────────────────
+// 🔴 没有这两格，针对"权威怎么来的"那几行的变异就【无人观察】。
+const { buildRefundCommand } = await import('./pool-refund-builder.mjs');
+const refundArgs = (over = {}) => ({
+  witness: { poolOutIdx: 0, payoutOutIdx: 1, ticketInIdx: 1, ticket_prefix_len: 0, ticket_suffix_len: 0,
+    ticket_prefix: Buffer.alloc(0), ticket_suffix: Buffer.alloc(0), bettorPk: 'aa'.repeat(32), stake: 100n },
+  poolOutpointTxid: 'aa'.repeat(32), poolRedeemHex: POOL_REDEEM, poolTemplatePrefixHex: POOL_PREFIX_HEX,
+  currentPoolState: STATE, ticketOutpointTxid: 'bb'.repeat(32), ticketRedeemHex: TICKET_REDEEM,
+  ticketState: { bettorPk: 'aa'.repeat(32), direction: 1, stake: 100n, shardPoolId: 1 },
+  poolValueSompi: 1000n, bettorAddress: ADDR, poolContinuationState: { ...STATE, closed: 2 },
+  changeAddress: ADDR, ...over,
+});
+
+await t('权威步 · builder 从模板前缀【派生】state_start 并写进命令（不是字面量）', () => {
+  const cmd = buildRefundCommand(refundArgs());
+  assert.strictEqual(cmd.inputs.pool.state_start, POOL_PREFIX_HEX.length / 2,
+    'builder 写进命令的值必须等于前缀长度 —— 那才是权威, 常量只是防御断言');
+});
+
+await t('权威步 · 前缀与 redeem 对不上 ⇒ builder 拒（描述符必须绑到实际脚本上）', () => {
+  assert.throws(() => buildRefundCommand(refundArgs({ poolTemplatePrefixHex: '6b' })),
+    /不以 poolTemplatePrefixHex 开头/,
+    '拿一个不属于这份 redeem 的前缀也能过 ⇒ "权威"退化成申报');
+});
+
+await t('权威步 · 缺前缀 ⇒ builder 拒(fail-closed, 不默认)', () => {
+  assert.throws(() => buildRefundCommand(refundArgs({ poolTemplatePrefixHex: undefined })), /required/);
+});
+
 console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-roundtrip-b1: ${pass} PASS / ${fail} FAIL`);
 if (fail > 0) process.exitCode = 1;
```
