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

## 提案 diff（`git apply` 可直接用）

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
