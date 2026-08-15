# D3 设计稿 · 按职责拆腿结算 j34vb（canary#2）

> **Status**: CURRENT
> J2（settler 域）· 2026-08-16 · 承接 (280) 派工 / (281) Codex 硬约束 / `docs/2026-08-16-j2-d1-premise-correction.md`
> **本稿全部结论基于只读实测，逐条附坐标。零写库、零上链、零系统动作。**
> 审阅路径：@Bettor 审 → @NWT 红队 → Codex 复核 → 落码 → 链稳即结算。

---

## 0. TL;DR

**我不选 D1，也不选 D2，提第三案 D3：把 `side_lock_daa` 承担的【四项】职责拆开，各自用最强可得的手段处理，
只在真正无法恢复的那一项上做【显式、有界、一次性承诺】的风险接受。**

实测结果把问题缩得比 (280)(281) 预想的小很多：

| 职责 | 现状坐标 | D3 处置 | 需要风险接受吗 |
|---|---|---|---|
| A 规范排序 | `pool-payout-root.mjs:70,74` + `bshard-close-enforce.mjs:609,618,631` | 改锚 `side_lock_tx` 字典序 | **否**（链上不可变+全序） |
| B 委员排除 | `bshard-close-enforce.mjs:798,799` | 去掉 `<=deadlineDaa` 条件，**无条件排除** | **否**（安全方向，且实测为 **no-op**） |
| C 入场谓词 | `bshard-close-enforce.mjs:467`（及 `:799` 的 `<=`） | **无法从共识恢复** ⇒ 显式风险接受 | **是**（唯一一处） |
| D 完整集 | `bshard-close-enforce.mjs` C1(ii) | 不动，如实标注仍 **PARTIAL** | 否（不新增风险，也不假称改善） |

**⇒ 需要风险接受的只有 C 这一项，而它有可量化的边界。A/B 两项是纯确定性替换，不涉及政策变更。**

---

## 1. `side_lock_daa` 到底承重什么（源码实读，非推断）

`kasia-console/src/lib/`（⚠ 不是 `src/services/`，(280) 坐标写偏一格）：

- **`bshard-close-enforce.mjs:466`** — 存在性：`b.side_lock_daa == null` ⇒ fail-loud（"不盲信 DB"）
- **`bshard-close-enforce.mjs:467`** — **入场谓词**：`side_lock_daa > deadline_daa` ⇒ 拒（"越界 bet 不算"）
- **`bshard-close-enforce.mjs:798`** — 委员排除前置：NULL ⇒ `throw`（"fail-loud 防 cross-node fork"）
- **`bshard-close-enforce.mjs:799`** — 委员排除条件：`side_lock_daa <= deadlineDaa` ⇒ `exclude.push(bettor_pk)`
- **`pool-payout-root.mjs:70,74`** — `canonicalBetOrder`：排序键 `side_lock_daa ASC`，tiebreak `side_lock_tx` 字典序；NULL ⇒ `throw`

Codex (281) 的判断成立：**降锚只解排序，解不了入场谓词。** 但它也只有这两类，而排除与完整集可以分别处理。

---

## 2. Leg A — 规范排序改锚 `side_lock_tx`（无需风险接受）

**规则**：某市场只要**有任一行缺 `side_lock_daa`**，该市场**整体**改用 `side_lock_tx` ASC（字典序）作为唯一排序键。
🔴 **必须整市场原子切换，绝不允许逐行混用两种键** —— 混用会让不同节点对"哪几行用哪个键"产生分歧，那才是真 fork 面。

**确定性**：`side_lock_tx` 是链上 txid，64-hex 小写，跨节点逐字节一致，字典序是全序且无并列
（本盘 10 行 txid 两两不同，已核）。⇒ **任何节点独立重算都得到同一序列，不需要任何本地状态。**

**🔴 不动钱（这条我实测过，是 Leg A 能成立的关键）**：
`bshard-close-enforce.mjs:631` `const winners = ordered.map(b => ({ pk: b.pk, amount: b.stake }))`
—— **每个人的金额 = 他自己的 stake，与序无关**。序只决定 position-aware merkle 的**叶位**（`:627` 注释原话：
"payoutRoot 是 position-aware merkle(叶子落哪个 index 由数组序决定)…但序依然影响结果"）。
⇒ **改序改的是 merkle 叶位与证明路径，不改任何人拿多少钱。** 前提是全网用同一序 —— 这正是本 leg 保证的。

**待 @NWT 攻**：`side_lock_tx` 是 DB 列，理论上可被本地篡改。反制：它同时被 §4 的承诺物钉住（见下），
且篡改会立刻使 betsRoot/refundRoot 重算与其他节点不一致 ⇒ 不是静默 fork，是 fail-loud 分歧。

---

## 3. Leg B — 委员排除改为无条件（无需风险接受，且实测 no-op）

**规则**：`:799` 的 `if (Number(b.side_lock_daa) <= deadlineDaa)` 条件**去掉**，改为**无条件** `exclude.push(bettor_pk)`；
`:798` 的 NULL fail-loud 随之取消（它只为这个条件服务）。

**为什么安全（方向性论证）**：该排除的目的是"下注者不判自己的盘"（`:788-790` 注释 #27a）。
无条件排除得到的集合是现规则的**超集** ⇒ **不可能放进一个本该被排除的利益相关委员**。
把一个"可能过严"的规则用在防串谋上，方向是对的；它唯一的代价是**可能缩小候选池**。

**🔴 而这个代价在 j34vb 上实测为零**：
```
pool_snapshots(ext-pool-v07-1783969245093-j34vb): pool_size=9
members: 20a0accd5c 20f208b765 4a355a7724 6a9bc5222a 7b51569337 8dc765248c e72d8e7ea8 e8e8d82782 e92cf4a304
本盘 distinct bettor_pk = 2: 4173a91cef… / 81101a7142…   ⇒ 两个都【不在】池内
```
（另核：`oracle_registry` 5 行、`oracle_stake_enrollments` 18 行，两 pk 均零命中。）
⇒ **排除他们对 `selectCommittee` 的输出没有任何影响** —— 这一腿是免费的。
⚠ **作用域**：这是 j34vb 的实测，不是通则。若把 D3 推广到别的盘，**必须逐盘复测候选池是否被削到不足**。

---

## 4. Leg C — 入场谓词：**无法恢复，做显式风险接受**（唯一需要政策决定的一项）

### 4.1 先如实说：它恢复不了

`side_lock_daa <= deadline_daa` 要的是"这注在 deadline 之前**被链接受**"。该事实的共识来源是接受块的 header，
而**块体已被协议剪裁**——2026-07-17 两节点已互证并给了结构性理由（剪裁点是协议共识函数而非节点缓存策略），
见 `docs/2026-08-16-j2-canary2-was-already-investigated-2026-07-17.md`。今日我又独立走尽三条路：
tx_log 双钥匙（对照 2/2 命中、目标 0/8）、构造期地址→UTXO（**两个已知 DAA 的对照地址同样查不到** ⇒ 该探针零判别力）。

**⇒ 照 Codex (281)③ 的定性：这是【风险政策变更】，不是【等价替换】。本稿按此措辞，不称"等价"。**

### 4.2 风险有多大（可量化，但这是政策接受不是证明）

两条**真链锚**夹住了这批注（我自算，未用记忆值）：

| 行 | `confirmed_at` | `side_lock_daa` |
|---|---|---|
| 35974（锚①） | 1784021500 | **59,950,126** |
| 35976（锚②） | 1784059228 | **60,244,919** |

⇒ 实测速率 `(60,244,919 − 59,950,126) / (1784059228 − 1784021500) = 294,793 / 37,728` = **7.8137 DAA/s**
（与 2026-07-17 J2 自算的 7.81 独立吻合）。

最晚一注 **35978**（`confirmed_at=1784060052`，比锚② 晚 824 s）⇒ 估 `60,244,919 + 824×7.8137 ≈ **60,251,357**`
（与 07-17 报的区间上端 60,251,357 **逐位吻合**，两次独立计算）。

`deadline_daa = **61,421,827**` ⇒ **余量 = 61,421,827 − 60,251,357 = 1,170,470 DAA ≈ 1.73 天**（按上述速率）。

**⇒ "这 8 注实际在 deadline 之后入场"要成立，需要同时满足：插入序造假 + 两条链锚之一造假 + 速率估计错约 3 个数量级。**
🔵 但**这仍然是推断**：`confirmed_at` 是本机 DB 墙钟、速率是插值。**它降低概率，不构成共识证明。**

### 4.3 🔴 fork 安全：决定必须【承诺一次、按 hash 消费】，绝不许各节点各自推导

这是本稿最要害的一条，也是我认为 D1/D2 原样都危险的真正原因：
**任何"让节点自己根据本地 DB 推导出一个替代 DAA/判断"的写法，都会把 fail-loud 换成 silent fork。**
现有那三处 fail-loud 正是为此而立（`:798` 注释原话："fail-loud 防 cross-node fork"）。

**D3 的机制**：
1. 生成**一份市场作用域的 admissibility 裁决制品**（JSON），内容至少包含：
   `market_id` · 8 行的 `(side_lock_tx, bettor_pk, direction, stake_amount, pay_addr, exact_stake_sompi)` ·
   裁决=`admitted` · **依据与其局限的原文**（4.1/4.2 两节）· 两条链锚 · 速率 · `deadline_daa` · 版本号。
2. 取 `blake2b(canonical_json)` ⇒ 承诺进 `pool_markets.metadata`（**不新增表**，沿用在册 transport 约定）。
3. enforce 侧：**不重新推导任何东西**。只做两件事——
   (a) 该市场被标记时，读制品、**重算 hash 并比对**，不符/缺失 ⇒ **fail-loud**（比现在更严，不是更松）；
   (b) hash 相符 ⇒ 对制品**逐字列出的那 8 个 `side_lock_tx`** 跳过 `:467` 谓词，**其余行照旧全额执行**。
4. 制品**只对 `market_id` + 那 8 个具体 txid 生效**，其他盘/其他行零影响；**不可复用、不是通用旁路**。

**⇒ fork 论证**：所有节点消费的是**同一份按 hash 钉死的输入**，不是各自的 DB 推导。
两节点若拿到不同制品 ⇒ hash 不符 ⇒ **双方都 fail-loud**，而不是各自算出不同 payoutRoot 后分叉。

### 4.4 谁签这份制品（我给建议，裁定不归我）

- **最强**：委员会签（与 close attest 同一组）。但存在自举问题——委员会本身要先能跑到签名点。
- **可行**：**Owner 签 + hash 承诺进 metadata**，理由是 Owner 已就 canary#2 给出结果导向直令；
  **风险接受本来就是政策行为，由政策主体签是对的**。
- 🔴 **必须避免的坑**（在册 `payoutRoot 零验/未与委员绑定`）：**制品不得只被 driver 自己检查**。
  enforce 必须**独立重算 hash**，否则又变成"调用方喂什么就信什么"。

---

## 5. Leg D — 完整集：不动，且如实标注它本来就没全闭

C1(ii) `verifyBettorsCompleteFromChain` 从链上 rolling-shard leaf state 重建完整 bettor 集，
**代码自己写着"诚实: C1 现 PARTIAL, 非全闭"**。D3 **不改动它，也不假称改善它**。

- (280) 说"行集由 `sides_merkle_root`/`pool_merkle_root` 钉死"是错的：j34vb 的 `sides_merkle_root` 是**空字符串**
  （v0.7 全量 EMPTY 3,247/SET 453；**已结算的 v0.7 里 149 个是空的**⇒ bshard 路不用该字段），
  而 `pool_merkle_root` 钉的是 **oracle 池成员**（`:755`、`:759`），与"有哪些 bettor 行"无关。详见前发的前提更正稿。
- 🔵 **可做的交叉校验（建议入稿件验收项，不是新机制）**：`market_shards(id=1353).bettor_count = 10`
  与加载到的行数 10 一致；leaf state 的聚合 `pool_value` 亦可与 Σstake 对账。这是**旁证**不是证明。
- ⚠ **诚实边界**：Leg C 的制品把 8 个 txid 逐字钉死，**顺带**给了行集一个强得多的锚（少一行或多一行都会 hash 不符）。
  但这只覆盖**这 8 行**，不覆盖"是否还存在第 11 个未被加载的 bettor" —— **那条缺口 D3 没有关，NWT 请照此攻。**

---

## 6. Leg E — 资金腿：8 位 bettor 的经济权益**一分不动**

Codex (281)④ 点名："排除出委员会"不得静默变成"排除出经济权益"。**D3 结构上不可能发生这件事**，因为：

- D3 **从不把这 8 行移出** `bettors` 集：`:466` 存在性、排序、betsRoot、refundRoot、payoutRoot **全部照常包含它们**。
  被跳过的只有 `:467` 那一个**谓词判断**。
- 反过来说，**D2（把 8 行标 excluded）才是会碰到资金腿的那个方案**——它必须另行设计本金退路，
  而本盘 `claim_txid` 全为 NULL、资金已进滚动分片叶，退路要动 covenant。**这是我不选 D2 的主要原因之一：
  它用一个更大的资金动作，去换一个本可以不动资金的问题。**
- **验收判据（可机器检查）**：结算前后，这 8 行在 `refundRoot`/`payoutRoot` 的叶集合中**必须仍然存在且金额等于各自 `stake_amount`**。
  任何一行消失或金额改变 ⇒ 视为设计被违反，停手。

---

## 7. 四位一体一致性（Codex (281)④ 的检查单）

| Codex 要求 | D3 的答复 |
|---|---|
| committee | Leg B：无条件排除（超集，安全方向），j34vb 实测 no-op |
| payout / 承诺 | Leg A：排序改锚，**不改金额**；Leg C 制品 hash 承诺进 metadata，enforce 独立重算 |
| complete-set | Leg D：**不动、不假称改善**；制品顺带钉死这 8 行，但第 11 人缺口仍开（如实声明） |
| 8 人本金处置 | Leg E：**零变动**，并给出可机器检查的验收判据 |

四条同稿、互不矛盾：**A/B/D 不涉及资金与政策；C 是唯一政策项且被承诺物限定在 8 个 txid 上；E 保证 C 不外溢到钱。**

---

## 8. 我**不**主张什么（免得被读成比实际更强）

1. **不主张**这 8 注确实在 deadline 前入场——**这是接受的风险，不是证明的事实**（Codex 定性，本稿照办）。
2. **不主张**行集完整性被解决——C1(ii) 仍 PARTIAL，第 11 个 bettor 的缺口 D3 没关。
3. **不主张** D3 可推广到其他盘——Leg B 的 no-op 是 j34vb 的实测，别的盘要逐盘复测。
4. **不主张**已验证过运行时行为——**本稿零落码、零执行**；下面的测试计划是**待做**，不是已做。
5. `side_lock_tx` 的不可篡改性只到"篡改会导致跨节点 hash 分歧并 fail-loud"，**不到"本地改不了这一列"**。

---

## 9. 落码前的测试计划（待做，非已做）

1. **确定性对照**：同一份 10 行输入，在两台机独立跑 `canonicalBetOrder`（改锚版）+ betsRoot/refundRoot 重算 ⇒ **逐字节相同**。
2. **弱注入臂**（在册：正向+反向只证会红会绿，必须有第三条）：只篡改**一个** `side_lock_tx` 的一个字符 ⇒ **必须仍然红**。
3. **制品闸**：hash 不符 / 制品缺失 / 制品里少一个 txid ⇒ **三种都必须 fail-loud**，且失败信息逐字打印期望与实际
   （在册：`step.id` 不进输出，要让红说话必须把话放进会被打印的载体）。
4. **Leg B no-op 验证**：改前/改后 `selectCommittee` 输出**逐字节相同**（本盘应如此，因两 pk 不在池内）。
5. **Leg E 验收**：结算 payload 里 8 行的叶子与金额与改动前一致。
6. 用例落 `kasia-console/test-framework/cases/`，⚠ 文件名必须 `*.test.mjs`（在册：runner 只收这个模式，`m0c1-gate/` 下 10 个文件因此从未被扫到）。

---

## 9-bis. 🔬 Leg A 的可复现产物（**已跑**，用仓内现成函数，零落码）

> 与 §9 的"待做"分清楚：**下面这些是已经跑出来的数**，而 §9 的用例仍未写。
> 用的是 `kasia-console/src/lib/pool-payout-root.mjs` 的**现成导出**，我没有自造哈希。

**① 全序无并列（Leg A 的前提）**：10 行 `side_lock_tx` **distinct = 10** ⇒ 字典序是全序，无 tiebreak 需求。

**② D3 规范序（`side_lock_tx` ASC）**：

| idx | row | dir | stake | side_lock_daa | side_lock_tx |
|----|-----|-----|-------|---------------|--------------|
| 0 | 35977 | 0 | 5000000000 | NULL | `0ae3860499be9cc8b5ba…` |
| 1 | 35978 | 1 | 1500000000 | NULL | `35f45414e304e1c84b1d…` |
| 2 | 35970 | 0 | 5000000000 | NULL | `3e8d263696b2e0000a65…` |
| 3 | 35972 | 0 | 5000000000 | NULL | `6920cc8b9cee8e6d41e1…` |
| 4 | 35973 | 1 | 1500000000 | NULL | `88a441a70a240b8469ee…` |
| 5 | 35965 | 0 | 5000000000 | NULL | `952a4f68c790bfe4001c…` |
| 6 | 35975 | 1 | 1500000000 | NULL | `a422b5e8c171778efd96…` |
| 7 | 35974 | 0 | 5000000000 | **59950126** | `ae6a7a04e7e9630979d4…` |
| 8 | 35976 | 0 | 5000000000 | **60244919** | `afbaaf628aeae3c24919…` |
| 9 | 35971 | 0 | 5000000000 | NULL | `ff62a67e35864c7fccb2…` |

**③ 根值（供跨机比对；两台机独立跑应逐字节相同）**：
```
betsRoot   (D3 序) = 8bbe255e8f2a8e078adfa9f45c4642d2bca18ccf3dd8d436d56b0c55c0818c11
refundRoot (D3 序) = c328da80433d24dfa4398e0de31878dfb06565606a9864095542776b1f204fec
```

**④ 对照臂（我没有【断言】现行规则会 throw，我把它跑了）**：对同一批行调现行 `canonicalBetOrder` ⇒
`canonicalBetOrder: bettor 4173a91cef 无 side_lock_daa (未链锚, fail-loud, 不回退本地序)` ✅ 与 §1 描述一致。

**⑤ 弱注入臂（在册：正+反只证会红会绿，必须有第三条）**：只把 row35965 的 `side_lock_tx` **首字符 9→0**
⇒ 该行序位 **5 → 0**，`betsRoot` **改变**。⇒ **根确实绑在 txid 上，不是碰巧对。**

**⚠ 一处会绊倒下一个人的命名坑**：`bshard-close-enforce.mjs:633` 调的 `computeMerkleRoot` **不是** `pool-payout-root` 的导出名——
`:30` 是 `import { … payoutRoot as computeMerkleRoot } …`。**照 enforce 里的名字去 import 会拿到 `undefined` 而不是报错**
（我就先撞了这一下）。在册同族：`一名多物`。

**复现（只读，~10 行）**：
```js
const pr = await import('file:///D:/kanet-tn12/kasia-console/src/lib/pool-payout-root.mjs');
// rows = SELECT id,bettor_pk pk,direction,stake_amount stake,side_lock_tx FROM pool_bettor_sides WHERE market_id LIKE '%j34vb%'
const ordered = rows.sort((a,b)=> a.side_lock_tx.toLowerCase() < b.side_lock_tx.toLowerCase() ? -1 : 1);
pr.computeBetsRoot(ordered.map(b=>({pk:b.pk,stake:b.stake,direction:b.direction}))).toString('hex');
pr.payoutRoot   (ordered.map(b=>({pk:b.pk,amount:b.stake})))                     .toString('hex');
```

## 10. 给审阅者的三个明确问题

1. **@Bettor / Owner 域**：4.4 的**签名主体**取哪个（委员会签 / Owner 签 + enforce 独立验 hash）？这是政策决定，我不自裁。
2. **@NWT 红队重点**：请攻 §5 那条我**自己声明没关**的缺口（第 11 个未加载 bettor），以及 §2 末尾 `side_lock_tx` 本地篡改面。
   **别攻"两 root 钉死"**——那个前提不存在（见前提更正稿）。
3. **@Codex**：D3 把 (281)③ 的 admissibility 从"降锚假装等价"改成"承诺一次的显式风险接受 + hash 消费"，
   请裁这个形态是否满足"必须独立恢复谓词，否则按风险政策变更处理"的第二支。
