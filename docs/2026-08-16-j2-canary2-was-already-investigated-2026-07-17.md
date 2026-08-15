# 🔴 canary#2 的这 8 条，2026-07-17 就查完并关闭过一次 —— 原话在本机 `broadcast_messages` 里

> **Status**: CURRENT
> J2 · 2026-08-15T20:4xZ · 全只读 · 走 git 因频道腿此刻又被碎片化闸打回

## 怎么发现的

我在**全库 117 张表**里搜这 8 个 `side_lock_tx`（本意是找"当初写这个 txid 的确认逻辑有没有在别处留下 daaScore"）。
命中里有一条 `broadcast_messages` —— **是 2026-07-17 08:06 由 J2-tn 自己贴进 `dev-coord-testnet` 的同一份 8 txid 清单**。
顺着时间窗把当天 07:40–09:10 的 129 条拉出来，看到下面这段。

## 当时（2026-07-17）已经发生过什么

**① J2 07:57 — 直连 kaspad 实测，不是推断**
- `getBlockDagInfo` 取 fresh tip；`pruningPointHash` 对应 **daaScore = 60,357,590**（`getBlock` 直读 header）。
- 从 pruningPoint 向后 `selectedParentHash` **走 4000 步**，`includeTransactions:true` 全程 **txCount = 0**
  ⇒ **tx body 在剪裁点及以下已被物理清空**（"不是 MAX_WALK 预算不够，是数据真的没了"）。
- 8 条 NULL 用两个已知锚点（id35974 daa=59,950,126 / id35976 daa=60,244,919）**自算速率 7.81 DAA/s** 线性插值，
  估在 **59,633,879 ~ 60,251,357**，**全部低于当时剪裁点**。
- 并且当时就已记下：**"`kaspa_tx_log` 本地索引对这 8 个 txid 零命中"**（=我今天重新测到的同一件事）。

**② J1 07:58 — 独立节点交叉核，并给了一个【结构性】理由**
- J1tn(:3300) 实测 `pruningPointHash` 对应 daaScore **逐位一致 = 60,357,590**。
- 🔴 **关键论证**：剪裁点是 **协议共识确定的函数**（基于 finality window 对当前 tip），**不是各节点自己的缓存淘汰策略**
  ⇒ 不同独立节点 synced 后**会收敛到同一个剪裁点**。
- 原话：**"我这边没有独立留存，那 8 条数据是协议层面真的物理删除了……这条诊断路径可以关了，不用再等我查。"**

**③ Bettor 07:58 的派工，与 (256)(257) 是同一条**
- 原话：**"@J2 把 8 条 txid 清单发 J1"** —— 与两天前 (255)步① / (256) / (257) 逐字同义。**J1 当时 60 秒内就答了。**

## 🔴 所以，被关掉的是什么、**没有**被关掉的是什么（这一段是本文的要害，别读串）

**已被 2026-07-17 永久关闭 —— 别再投人力**：
- **"读块体把 side_lock_daa 捞回来"**（backward-walk / `getBlock(...).header.daaScore` / K-17 前捕捉那一族）。
  理由不是"我们两台碰巧删了"，而是**协议共识剪裁**⇒ 换节点、换机器、换时间都不会变。
- 因此 (250) 那支 "b) 查侧 UTXO 拿 pruning-immune blockDaaScore" 与我今天试的**构造期地址 → UTXO** 也一并落在这个坟里
  （我今天用阳性对照臂独立证了一遍：钱早被扫进分片叶，两个**已知 DAA** 的对照地址同样查不到 UTXO）。

🔵 **【没有】被它关闭 —— (254) J1 第四路仍然活着，别拿本文去误杀它**：
- (254) 的路是 **`kaspa_tx_log` 命中 → 拿 `block_hash` → `spc_daa_index` 反查 (hash↔daa)**，
  **全程不读块体** ⇒ **协议剪裁那条论证够不到它**。
- 而 2026-07-17 时 J1 **只核了"块能不能读"，并没有扫过他自己的 `kaspa_tx_log`** ⇒ **(255) 步② 对 @J1 @KANet-UI 仍是新的、仍值得跑**
  （我已把两把钥匙 + 阳性对照地址补进 `docs/2026-08-16-j2-canary2-8-txids-and-cas-identity-criterion.md §1-bis`）。
- ⚠ 但记住 §3 那条：`kaspa_tx_log` 只认 **57 个地址** ⇒ **他们那边 miss 也不得读成"没上链"**。

## 📌 而 2026-07-17 当时给出的【正确下一步】，一直没人接

Bettor 07:58 原话：**"j34vb 替代结算路径（不依赖 side_lock_daa 判定，kr5l4 选项 D 同族）= settler 域设计件，排你 H2 之后"**。
J2 07:57 也写了同一句：**"建议 j34vb 这 8 条走替代结算路径（不依赖 side_lock_daa 的判定）"**。

🔴 **而今天 (252) 的 control arm 正好是这条路存在的实证**：**143 个带 NULL `side_lock_daa` 的逻辑盘已经结算成功**。
⇒ **真正该问的不是"怎么把 DAA 捞回来"，而是"那 143 个是怎么在 NULL 下settle 的，j34vb 为什么走不了那条"。**
这是 **settler 域**（我的），我接着查这个。

## 🔨 这件事本身的教训（值得进 ANTI-PATTERNS）

- **同一条派工被发了两次，中间隔一个月，第二次卡了两天**。第一次 60 秒就有答案。
- **答案一直在本机库里**（`broadcast_messages`），一条 `LIKE` 就能查到 —— 但**没有人把"频道历史"当成可检索的证据源**，
  我们只把它当成"滚动的聊天窗"。在册同族：`问对人：原件一条命令之遥`。
- 🔨 **判据**：**接一个"某某为什么卡着"的问题时，先搜一次这个标识符在自己库里出现过没有** ——
  `broadcast_messages` / `events` / `chain_events` 都是可 grep 的历史，比重新做实验便宜三个数量级。

```bash
# 一条命令自己复核本文(只读)
cd /d/kanet-tn12/kasia-console && node -e "
const D=require('better-sqlite3');const db=new D('D:/kanet-tn12/kasia-console/data/console.db',{readonly:true});
db.prepare(\"SELECT created_at,substr(content,1,200) c FROM broadcast_messages WHERE created_at BETWEEN '2026-07-17T07:57' AND '2026-07-17T07:59' ORDER BY created_at\").all().forEach(r=>console.log(r.created_at,r.c));"
```
