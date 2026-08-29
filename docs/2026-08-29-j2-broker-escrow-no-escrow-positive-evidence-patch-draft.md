# `checkBrokerEscrow` 修法 patch 草案 v0.2 —— 三态 + RPC 必需 + L2 coverage 账 + 选项 B `held_for_review` · **batch: broker-money-path, NOT maintenance-window**

> **v0.2（NWT GREEN-with-MUST 收窄，2026-08-29）**：① `NOT_PAID` 须 **coverage-attested-absence AND `rpcUtxoLookup` 成功且 no-match**（RPC 缺/抛/劣化 ⇒ UNKNOWN）；② coverage 判据改消费 **L2 `indexerCoverage()` holes 账**（`70208425` §2.2 v199），删除 v0.1 的 `relay created_at ≤ order` heuristic（它 capture 不了 relay 重启 gap / watched 集变更 / eventloop 丢 POST）；**依赖 L2 期 1 先落**，过渡形 = 无账一律 UNKNOWN；③ `spc_tip_heartbeat` 保留为必要非充分；④ 🔴 **深层（Bettor 上 Owner）**：Kaspa 无地址历史索引，RPC UTXO 读也只是 current-UTXO（收款后扫走 = 无 UTXO 但付过）⇒ **任何 absence-based `no_escrow` 根本可错** ⇒ **选项 B**：`no_escrow` 从"永久免退款终态"改为可逆 **`held_for_review`**（保用户退款路 + loud 审计 + 人工复核）；reconciler 只进它不进 `failed`。**Owner 定 A/B 后落**（候选 `decideReconcileAction(verdict, mode)` 两种都实现，默认 B）。候选 v0.2 + 向量 16/16 在 `docs/provenance/2026-08-29-broker-escrow-v01/`（v02 文件）。
> **选项 B 状态机改动草案**（`broker-state-machine.js`）：`STATES` 加 `held_for_review`（非终态）；`TRANSITIONS`：`awaiting_payment → held_for_review`（reconciler，`reason:'reconcile_no_escrow_review'`）、`held_for_review → {paid, refunded, failed(须 refundTxHash 或人工 no_escrow 显式二次确认), awaiting_payment(人工放回)}`；`TX_REQUIRED[held_for_review] = null`（不需 tx）；审计 marker 照 `state_<to>` 惯例；UI/tg-bot 对 `held_for_review` 显示"待人工复核"。`no_escrow` 保留只给**人工**路径（Owner/operator 明确操作），reconciler 不再产生它。
>
> **Status**: DRAFT v0.2（v0.1 正文保留在下，以 v0.2 头为准） · J2 2026-08-29 · 源：定级页 `c6d0729b` §②（NWT 定 P2 潜伏 → retail 真用户开放前 P1；零历史真影响——Bettor 亲核 live：`no_escrow:true` 共 4 条全 `test-order-mrj*` 7/13）· 流程：报备 → NWT → **Owner 批（钱路）** · 闸 = gating retail broker 对真用户开放 · **不动代码**；候选 + 真 schema 离线向量在 `docs/provenance/2026-08-29-broker-escrow-v01/`。

## §0 NWT 三原则（全部机械化在候选里）
1. **免退款终态 `no_escrow` 须 positive 证据**，不得从 `kaspa_tx_log` 0 行的 absence 推（它有已知 ingest 缺口）。
2. **网络前缀不符 = config 错 ⇒ alert + 当作已持币（true），永不 no_escrow。**
3. 与维护窗正交：独立报备/独立批。

## §1 设计：布尔 → 三态；只有 `NOT_PAID` 才允许 `no_escrow`
| verdict | 判据（全部成立） | `reconcileStaleOrders` 动作 |
|---|---|---|
| `ESCROWED` | 索引 `kaspa_tx_log` 有 peer→broker 入金（`to_address = broker ∧ observed_at ≥ created_at ∧ amount ∈ [qty−0.5, qty+0.5]`，与原 :253-258 **同形**）**或** 注入的链读 `rpcUtxoLookup(broker)` 有金额匹配 UTXO | **不动**（broker 持币；留给 intake 重试/人工） |
| `NOT_PAID` | ① 地址来源正确（`env BROKER_KAS_ADDR` 或 `relay_nodes[BROKER_RELAY_ID].address`）∧ ② 前缀与 `KASPA_NETWORK` 一致 ∧ ③ 零匹配行 ∧ ④ **索引覆盖了订单窗**：`spc_tip_heartbeat.updated_at` ≤ 5 min 陈 ∧ broker relay 行 `created_at ≤ order.created_at`（= 地址在 watched 集合内） | `transition → failed, {no_escrow:true, reason:'reconcile_no_escrow', evidence:{…}}` |
| `UNKNOWN` | 其余任一：地址缺/前缀错/qty 非法/索引心跳陈或缺/relay 晚于订单/查询或 RPC 抛 | **skip + 一次性告警**（`events` 表 `broker_escrow_unknown`，按 order_id 去重）；单继续 `awaiting_payment` 等 intake/人工 |
🔴 **诚实边界**：Kaspa 节点无地址历史索引，"明确未付"的绝对 positive 证据在链上**不存在**（UTXO 集只见未花）。候选给的 `NOT_PAID` = **coverage-attested absence**（索引在岗且监听该地址贯穿窗口 + 零行）——强于裸 absence，弱于链读；可选 `rpcUtxoLookup` 注入把 ESCROWED 侧再加一道链读。NWT 若要求更强，唯一更强的形是"broker 地址的入金全部经 relay `check_utxo_landed` 型链读回核"——那需要 relay IPC，写在 §5 待定。

## §2 diff 草案（不 apply；候选全文 `broker-escrow-check.v01.mjs` → 落地时放 `kasia-console/src/lib/broker-escrow-check.mjs`）
```diff
--- kasia-console/src/services/broker-state-machine.js
@@ -21,2 +21,3 @@
 import crypto from 'node:crypto';
 import { sqlite as defaultDb } from '../db/client.js';
+import { checkBrokerEscrowV2, ESCROW } from '../lib/broker-escrow-check.mjs';   // 三态; 见 docs/2026-08-29-j2-broker-escrow-no-escrow-positive-evidence-patch-draft.md
@@ -249,26 +250,12 @@
-const TRADER_B_KAS_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
-
-export function checkBrokerEscrow(peerAddr, qty, orderCreatedAt, db = defaultDb) {
-  … (原 :251-274 布尔实现)
-}
+// 🔴 2026-08-29 修 (定级页 c6d0729b §②): 原硬编主网地址 ⇒ TN12 上恒 false ⇒ 安全网方向反 (永远 force-fail+no_escrow)。
+//   改三态: 只有 NOT_PAID(coverage-attested absence) 才允许 no_escrow; 配置错/索引陈 ⇒ UNKNOWN ⇒ 永不 no_escrow。
+export function checkBrokerEscrow(peerAddr, qty, orderCreatedAt, db = defaultDb) {
+  // 兼容壳 (其它调用方若有): ESCROWED/UNKNOWN ⇒ true(别 force-fail); NOT_PAID ⇒ false
+  return checkBrokerEscrowV2({ db, peerAddr, qty, orderCreatedAt }).verdict !== ESCROW.NOT_PAID;
+}
@@ reconcileStaleOrders
   for (const row of stale) {
-    const escrowed = checkBrokerEscrow(row.user_kasia_address, parseFloat(row.qty), row.created_at, db);
-    if (!escrowed) {
+    const r = checkBrokerEscrowV2({ db, peerAddr: row.user_kasia_address, qty: parseFloat(row.qty), orderCreatedAt: row.created_at });
+    if (r.verdict === ESCROW.UNKNOWN) {
+      // 永不 no_escrow; 一次性告警 (按 order 去重), 单留在 awaiting_payment
+      alertEscrowUnknownOnce(db, row.id, r.reason);
+      continue;
+    }
+    if (r.verdict === ESCROW.NOT_PAID) {
       const result = transition({
         orderId: row.id, expectedFromState: 'awaiting_payment', toState: 'failed',
-        opts: { no_escrow: true, reason: 'reconcile_no_escrow', triggeredBy: 'reconcileStaleOrders' },
+        opts: { no_escrow: true, reason: 'reconcile_no_escrow', triggeredBy: 'reconcileStaleOrders', evidence: r.evidence },   // positive/coverage 证据随单入 marker
         db,
       });
       if (result.ok) forceFailedCount++;
     }
+    // ESCROWED ⇒ 不动 (broker 持币)
   }
```
`alertEscrowUnknownOnce`：`INSERT INTO events (…, event_type='broker_escrow_unknown', payload_json={order_id, reason})`，先 `SELECT 1 … WHERE event_type=? AND json_extract(payload_json,'$.order_id')=?`（与 `zk-prove-job-stuck-alert.mjs:35-39` 同形；`events(event_type)` 无索引——L1 索引清单里已有，落地前后皆可）。
`kanet.env` 加 `BROKER_KAS_ADDR=<TN12 broker 地址>`（或依赖既有 `BROKER_RELAY_ID` 走 `relay_nodes`）；**两者都缺 ⇒ UNKNOWN（告警），不是 crash**。

## §3 回归向量（真 schema：`runMigrations` 到 temp DB；候选 13/13）
V1 主网地址 + TN12 ⇒ UNKNOWN(`network_prefix_mismatch`)，compat=true（**今天生产形的直接回归**）· V2 地址未配置 ⇒ UNKNOWN · V3 经 `relay_nodes[BROKER_RELAY_ID]` 解析前缀对 · V4 零行 + 心跳陈 20 min ⇒ UNKNOWN · V5 零行 + 心跳 30 s + relay 早于订单 ⇒ NOT_PAID，compat=false · V6 无心跳行 ⇒ UNKNOWN · V7 有 10.2 KAS 入金(±0.5) ⇒ ESCROWED · V8 入金早于订单窗不算 · V9 金额不在容差不算 · V10 错网地址即使有行也 UNKNOWN（配置校验先于查询）· V11 `rpcUtxoLookup` 命中 ⇒ ESCROWED / 抛 ⇒ UNKNOWN · V12 relay 晚于订单 ⇒ UNKNOWN(`broker_watched_after_order`) · V13 qty 非法 ⇒ UNKNOWN。
落地后加：V14 `reconcileStaleOrders` 对 UNKNOWN 不 transition 且 events 只写一条（去重）；V15 对 NOT_PAID 的 marker 含 `evidence.coverage.ok=true`。

## §4 影响面
- 调用方唯一 `reconcileStaleOrders`（`index.js:826-829` 15 min）；`retail_dex_orders` 现 `awaiting_payment`=0 ⇒ 落地当刻零动作。
- 行为变化只在"零匹配行"分支：原 ⇒ 必 force-fail；新 ⇒ 仅索引在岗时 force-fail，否则等（**方向 = 作者 :236-241 自述的安全方向**）。
- 代价：UNKNOWN 单可能长期滞留 `awaiting_payment`（配置错时）——告警一次即暴露 config 错，这是想要的。

## §5 待定（NWT/Owner）
- 是否要求 `NOT_PAID` 再加 relay IPC 链读（`check_utxo_landed` 型对 broker 地址回核）作第三源硬前置——加则 `reconcileStaleOrders` 变 async 且依赖 relay 在线（relay 离线 ⇒ UNKNOWN，方向仍安全）。
- `BROKER_KAS_ADDR` 与 `BROKER_RELAY_ID` 两来源优先级（候选：env 显式 > relay_nodes）。
- 陈注释清理：`:236-241` 保留作者方向判断，删主网常量。
