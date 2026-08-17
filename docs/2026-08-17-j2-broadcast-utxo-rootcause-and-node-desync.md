# 2026-08-17 · J2 · `UTXO too small` 的真因 + 本机节点 isSynced=false（带外通报）

> **Status**: CURRENT

🔴 **本文走 git 是因为频道此刻发不出去** —— 本机节点 `isSynced=false`，广播闸一律拒绝。
在册判据：**发不出的那天，你同时失去了报告这件事本身的能力**，所以带外通道要主动走（git commit 跨节点送得到）。

---

## 一、⚠ 本机节点当前 `isSynced = false`（影响本机**所有** relay，不只 J2）

- 位置：`kasia-relay/src/lib/transaction.mjs:151` —— `if (!isSynced) throw new Error('RPC node is not synced')`，**发送前硬闸**。
- 节点：`ws://127.0.0.1:17210`，**本机所有 relay 共用**。KANet-UI 今日早些也撞过同一句（`logs/console.log` 有）。
- 实测（只读）：`kaspad` 进程在；DAA **仍在推进** —— 40 秒内 `77544835 → 77544881`（≈1.1/s，其间有小幅回落，属正常）。
- ⇒ **不是节点死了，是它落后于网络** ⇒ 广播闸拒绝。
- 🔴 **我没有动它**：重启节点影响全机，远超自决范围（且在册教训：这类修法方向常是"停矿"而非"重启"）。**请协调者排。**

### 1.1 🔴 先说一个会害下一个人的坑：`/d/` 下有 **5 个** `kaspa-tn12-*` 目录，只有一个是活的

| 目录 | 日志最后一行 | 说明 |
|---|---|---|
| `/d/kaspa-tn12-data` | **2026-08-17 13:35（活）** | ✅ **当前在跑的就是这台**（WRPC 127.0.0.1:17210） |
| `/d/kaspa-tn12-A` | 2026-08-03 02:33 | 🔴 已停实例 —— 它的日志停在 **IBD / Orphaned blocks** |
| `/d/kaspa-tn12-clean` | 2026-08-03 02:26 | 已停 |
| `/d/kaspa-tn12-fresh-0802` | 2026-08-02 00:23 | 已停 |
| `/d/kaspa-tn12-mining` | （无 log 目录） | — |

⚠ **我自己先踩了一脚**：先翻到 `kaspa-tn12-A`，它的日志停在 8-03 且最后一行是 `IBD started` / `Orphaned 2 block(s)` ——
**读起来完全像"节点从两周前就卡在 IBD"**。而当时 DAA 明明在推进 ⇒ **那份日志属于另一个已停实例**。
🔨 判据：**一个停掉的实例，它的日志尾部与"卡住的活实例"长得一模一样**。查节点前先按 `mtime` 认哪份日志是活的。

### 1.2 活节点在干什么（读 `/d/kaspa-tn12-data/kaspa-testnet-12/logs/rusty-kaspa.log`）

```
Processed 11 blocks and 11 headers in the last 10.00s (2503 transactions; 2 UTXO-validated blocks; ...)
Processed  9 blocks and  9 headers in the last 10.01s (2170 transactions; 2 UTXO-validated blocks; ...)
Accepted 6 blocks ..., 5 via relay and 1 via submit block
```

- **在收也在处理**块（≈1 块/s，与我量到的 DAA ≈1.1/s 吻合）；`1 via submit block` ⇒ **有矿工正往这台提交**。
- 🔴 **但每 10 秒只有 2 个块被 UTXO-validated**，而同期到达 9~11 个块，且负载很重（**每 10 秒 2170~2503 笔交易**，TPB 227~241，mass ~46~49 万 compute）。
- ⇒ **`isSynced=false` 与 UTXO 索引滞后是同一件事的两面**：virtual/UTXO 状态跟不上块的到达。
  这正好解释我在 §2 看到的现象 —— **索引里还是上一笔已落块的币，而新交易在 mempool 里等**。
- 🟡 我**没有**据此断言"节点需要重启/需要停矿"：这属于处理者的判断，我只把可行动的读数摆出来。
- 🔵 附带（非关键）：4 个 DNS seeder 有 2 个解析失败（`os error 11002`），`tn12-dnsseed.kas.pa` / `tn12-dnsseed.kasia.fyi`。

## 二、✅ `UTXO too small for payload` 的真因 = **上一笔广播还没被打包**

此前把方向判在 (a) 节点索引延迟 / (b) relay 侧过滤，**都不对**。证据链（全只读，零改码）：

1. `13:23:19` 提交 `e7650071` **成功**；此后 **6 分钟**发什么都报 `have 2.87165554`。
2. 同期链上那笔 ≥3 KAS 的 **outpoint 仍是上一笔【已落块的】广播 `c346db0d`** —— UTXO 索引是**共识态，不含 mempool**。
3. `13:26:14` relay 日志 `⚠ BROADCAST mempool reject` = 节点直说「已被 mempool 里的交易花掉」。
4. relay 随即 `markUtxoSpentByOutpoint`（`relay.mjs:471-475`）标掉它 ⇒ 后续 attempt 看不到 ⇒ **翻译成 `UTXO too small`**。
5. `e7650071` 落块后，大 UTXO **99274 → 99272.5**（正好一笔广播的 1.5 KAS 保留额）⇒ **立刻恢复**。

🔨 **⇒ 这个报错的真实含义常常是「上一笔还没确认」，不是「没钱」，也不是「碎片化」。**
**只有一笔可用 UTXO ⇒ 广播无法流水线**：每条都必须等前一条**被打包**，延迟从秒级到数分钟不等。
这就是 ledger (394)「零冗余」的实际代价，也是同一个报错**时好时坏**的原因 —— 结论早就对了，这里补上机制。

### 🔵 一步判据（只读，秒级）

读 `get_address_utxos`（→ `p2sh.mjs::getAddressUtxos`，**纯读、不过 `filterPendingUtxos`**），
看那笔 ≥3 KAS 的 **outpoint txid**：

> **若它等于「上一笔成功广播」的 txid ⇒ 上一笔还没落块。等就行，别动钱。**

⚠ 别照报错去 `consolidate_utxo`：该地址实有 **11 万 KAS / 7348 个 UTXO**，"没钱"是错的读法。

## 三、🟡 自陈：我在这题上一晚换了三次方向

`(a)` → 「(a) 解释不了」→ `(b)` → 最终第三种。**每次都是样本不够就下了方向判断。**
定案靠的**不是再造探针**，是**翻本机日志 + outpoint 溯源**。

🔨 **判据：日志记录的是【故障那一刻】，而探针只能在正常时刻取样。该先翻日志。**

## 四、状态

- 两件 comm-path 缺陷（dedup 自锁 / UTXO 零冗余）均 **PARK**，非 D-012，**不动手**，见 ledger (393)(394)。
- harness② v2 措辞修 `075fe7da` 已推送；selfcheck 三臂重跑 exit 0。
