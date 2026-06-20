# 决议 — legacy/孤立单链上有锁却永久冻结·系统根治（修法 A）

> **状态**: Owner 终裁 APPROVE 修法 A（2026-06-06 05:1x）
> **任务**: #28
> **红线**: G5 守 — 这是机制层资金安全 bug，报机制不报经济闭环
> **原则**: 系统根治不准短平快（不手动退单了事，让所有同病单自愈）

---

## 一、不变量（这才是"系统上解决"）

> **任何「deadline 已过 + 链上有锁(side_lock_tx 实)」的市场，必须能到达 settle 或 refund 终态，不准因 protocol_version 被永久孤立。**

当前协议违反它。本决议补上 legacy 终态路径。

---

## 二、六层查实（证据闭合）

| 层 | 实证 |
|----|------|
| 场景 | Owner 4611 KAS 卡 4 市场，0 返回，bot 显示"等开奖"实为冻结 |
| 真实数据 | 大头 4606 KAS 在 2 个 legacy(ver=null) 市场（SOL `u7hq4` 2501 / Iran `pg1ab` 2105），每笔 side_lock_tx 链上实锁；另 4 个 legacy 小单同病。系统影响面 = **6 单 / 4610 KAS** |
| 协议 | deadline-watcher 只推进 v0.6/v0.7；refunding handler 只退 v0.6/v0.7 |
| 执行逻辑 | `pool-market-settler.js:117` `protocol_version IN ('v0.6','v0.7')` 排除 legacy；`:1574` `skip non-v0.6/v0.7`。注释原文 `flagged, not touched` |
| 数据流 | legacy 既不进 settle 也不进 refund = 永久冻结 |
| 链上脚本 | `PoolSide.sil` (v0.5) **有 refund 分支**（见三）|

**交叉佐证**：J1（SS 解码）+ J2（filter 考古 commit 43c06c7）+ KANet-UI（认账：deadline-watcher 排除是它 6/2 加的安全 gate，标"另案 flag"未补 follow-up = 它的 debt）+ Bettor ④ 源码核。共识无裂缝。

---

## 三、链上脚本依据（Bettor ④ 核 PoolSide.sil L121-134）

```
entry 2 — refund_market_cancelled(sig bettorSig):
  L124  require(checkSig(bettorSig, pubkey(bettorPk)));     // 仅押注人自签
  L128  require(tx.time >= deadline * 1000);                // ms 语义, 无 grace, 过期即可
  L130  require(tx.outputs.length == 1);
  L131  byte[34] bettorLock = new ScriptPubKeyP2PK(pubkey(bettorPk));
  L132  require(tx.outputs[0].scriptPubKey == byte[](bettorLock));
  L133  require(tx.outputs[0].value == stakeAmount - 1000);  // 扣 fee
```

- **纯超时退款**：deadline 过 + 押注人签 → 领回 `stakeAmount-1000`，不需 maker/oracle/委员任何配合
- **注意**：L121-122 注释写 "maker sig" 是 **stale**，代码实际只要 `bettorSig`。实现以代码为准
- 6 个 legacy 单全部早过 deadline → 全部可花

---

## 四、修法 A（J2 实现 · Bettor 关1 已审护栏）

1. settler 新增 **legacy-refund-builder**：对 ver=null/v0.5 + deadline 过 + 有 side_lock_tx + 未 settle/refund 的市场，逐 side 构造 refund TX 走 `refund_market_cancelled` entry：
   - 输入：side P2SH UTXO（用 `side_redeem_script_hex`）
   - 签名：押注人 key（relay 绑定单，key 在 relay → 可自动签）
   - 输出：1 个 P2PK→bettorPk，value = `stakeAmount - minerFee`
   - lockTime：设到 `tx.time >= deadline*1000`（ms）
2. **关1 护栏（必守）**：legacy 只走 **refund 路**，**绝不**放进委员 settle 路（= J2/UI 当初加 filter 的原意）。移除 version 死排除时**精确路由**到 refund-builder，不是裸删 filter 让它流进 verifying→committee。
3. 退款 TX 入库（地址+txid 双锚点），更新 `refund_txid` + `protocol_status=refunded`。

---

## 五、验收（DoD · Bettor 守关2/关3）

- **关2 链上验**：6 个 legacy 单逐一退款 TX 落链 `is_accepted=true`，bettor 钱包实收 `stakeAmount-1000`；Owner 那 4606 KAS 到账绑定地址。看链不看码。
- **关3 回归不变量**（NWT）：新增"链上有锁必达终态"回归——构造一个 ver=null 过期有锁市场，跑 settler，断言它进 refund 而非永久 pending。守住永不退化。
- **NO TX NO STATE CHANGE**：refund_txid 只在广播确认上链后才写，try-catch 吞失败 = 退回。

---

## 六、边界（守 G5）

- 报"机制层资金可自愈退款链上证"，**不报经济闭环**。
- 范式终点 = 测试网公开，非 mainnet 生产。
