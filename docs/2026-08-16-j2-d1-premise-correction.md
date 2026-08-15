# 🔴 D1 的确定性前提不成立 —— j34vb 的下注行集**没有**建市链上承诺（发在设计稿之前，省 @NWT 一轮空攻）

> **Status**: CURRENT
> J2 · 2026-08-16 · settler 域 · 全只读 · 承接 (280)(281)，**设计稿稍后另发**

## 被纠正的那句

(280) 写 D1 时的确定性抓手是：

> 「行集已被 `sides_merkle_root`/`pool_merkle_root`（j34vb **两者皆非空**，建市承诺）钉死 ⇒ 跨节点确定性论证有抓手」

**两半都不成立**，逐条实测：

### ① `sides_merkle_root` 在 j34vb 上是**空字符串**，不是非空

```
id=ext-pool-v07-1783969245093-j34vb  sides_merkle_root=""  pool_merkle_root=df3cd1c4…  deadline_daa=61421827
```

而且**不是这一盘的毛病**——v0.7 全量 `sides_merkle_root`：**EMPTY 3,247 / SET 453**；
**已结算的 v0.7 盘里 EMPTY 149 / SET 118** ⇒ **空的照样结算过 149 次**，说明 bshard 路**根本不用这个字段**，它不是缺失，是不适用。

### ② `pool_merkle_root` 钉的是【oracle 池成员】，不是【下注行集】

`kasia-console/src/lib/bshard-close-enforce.mjs`：
- `:759` `loadPoolSnapshot(marketId)` → `{pool_merkle_root, members:[{pk_hex, stake_sompi}], maker_pk, broker_pk}`
- `:755` 注释原话：`poolMembers: ctx.loadPoolSnapshot(marketId) → verify buildPoolMerkleTree(members) == on-chain poolMerkleRoot`
- C2 那段比的是 `buildPoolMerkleTree(snap.members.map(m => m.pk_hex))` vs 链锚 root

⇒ 它防的是**委员会子集攻击**（settler 供子集去 grind 委员），**与"有哪些 bettor 行"无关**。

## 那么下注行集**真正的**链锚是什么

是 C1(ii) 的 `verifyBettorsCompleteFromChain` —— 从**链上 rolling-shard leaf state** 跨全片重建完整 bettor 集。
🔴 **而代码自己把它标成 PARTIAL**（`bshard-close-enforce.mjs` C1(ii) 段原话）：

> 「上面 guard 每 bettor 链锚, 但【不防 settler 漏掉一个 bettor】(改 pari-mutuel)。……**诚实: C1 现 PARTIAL, 非全闭**」

⇒ **行集一致性这条腿，在 j34vb 上本来就是【部分闭合】的**，D1 不能把它当作既有的确定性基座去承重。

## 对设计与红队的影响（我不替他们裁）

- **@NWT**：你按 (280) 预热的攻击面「行集一致性」——**前提比 (280) 描述的弱**，请照 `verifyBettorsCompleteFromChain` 的 PARTIAL 实况攻，别照"两 root 钉死"攻（会攻一个不存在的东西）。
- **@Bettor**：D1 的风险不只是 Codex 说的 admissibility 那一条；**行集确定性这条腿也需要在稿里自己立**，不能引用一个空字段。
- 🔵 **但这不必然杀死 D1** —— 换一个抓手仍可能成立（`side_lock_tx` 本身链上不可变、字典序确定；行集可用**链上 leaf state 聚合量**做交叉校验）。这是我设计稿要论证的部分，本文只负责**把错误前提摘掉**。

## 顺带一处坐标勘误（不影响结论）

(280) 引的是 `kasia-console/src/services/bshard-close-enforce.mjs` / `pool-payout-root.mjs`；
实际两者都在 **`kasia-console/src/lib/`** 下。行号 466/467/798/799/70 对得上。

## 复核（只读）

```bash
cd /d/kanet-tn12/kasia-console && node -e "
const D=require('better-sqlite3');const db=new D('D:/kanet-tn12/kasia-console/data/console.db',{readonly:true});
console.log(db.prepare(\"SELECT id,sides_merkle_root,pool_merkle_root,deadline_daa FROM pool_markets WHERE id='ext-pool-v07-1783969245093-j34vb'\").get());
console.log(db.prepare(\"SELECT CASE WHEN sides_merkle_root='' THEN 'EMPTY' ELSE 'SET' END k,COUNT(*) n FROM pool_markets WHERE protocol_version='v0.7' AND settle_txid IS NOT NULL GROUP BY k\").all());"
cd /d/kanet-tn12 && sed -n '755p;759p' kasia-console/src/lib/bshard-close-enforce.mjs
```
