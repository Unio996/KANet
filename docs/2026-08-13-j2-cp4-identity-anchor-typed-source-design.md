# CP4：§4 身份锚改 typed/named 源（评估 + 设计报审）

> **Status**: CURRENT · **已实现·隔离 worktree·待审未 land**
> J2 · 2026-08-13 · 应 @Bettor 22:0xZ 派工（Codex `311f12f8` 裁 §4 身份锚 OPEN/MUST-FIX）
> 作用域：**实读**（`docs/DATABASE.md`、`pool-bshard-market-setup.mjs`、全仓 grep）。
>
> 📌 **实现状态注记（2026-08-13 · Bettor spawn 实现臂 · (225) 方案 A GO）**：本设计已按方案 A 落码于隔离
>    worktree（**未 push、未 land**，待 Bettor 审 + J1/NWT/Codex 复核）。落地形态：
>    ① migrate **v197** `pool_markets.root_tmpl_hash` 列 + write-once trigger（DDL 单源 `src/lib/pool-market-anchor.mjs`）；
>    ② 新模块 `pool-market-anchor.mjs`：`persistMarketRootAnchor`（MUST1 结构绑定 = 校验 `rootTmplHash==leafCtor[8]`）+ `getMarketRootAnchor`（MUST2 命名可信 resolver）；
>    ③ `buildRefundCommand` **删自由 `expectedRootTmplHashHex` 参**，改收 `db`+`marketId`，调自持 resolver；
>    ④ 测试 `pool-market-anchor-cp4.test.mjs`（15 格全绿）+ `.mutants.mjs`（4 变异全 detected）+ 回归 `u1-roundtrip-b1`（17 格全绿、既有 mutants detected=7/MISSED=2 不变）。
>    🔴 **接线现状（诚实标）**：computeMarketGenesis 今天**无生产建市事务调用方**（仅 e2e/probe），故持久化钩子的
>    **live 接线是 OPEN seam**（机制+DB 层已测，"某条 live 建市路径会传 persistDb"尚不存在，与退款轨零活调用方同态）。

## 0. 先认一句

Codex 裁的这条，**是我自己在 CP3 §4 写过、然后在实现里没解决的那点**。
我把锚做成了**自由字符串参数** `expectedRootTmplHashHex` —— 于是「跨边界」只值调用方的自觉：
**同一个调用方完全可以拿候选 redeem 自己算一个锚喂进来，检查就退化成自己跟自己比。**
J1 注过「非循环性 builder 机器证不了」，我把它记成了"纪律"，Codex 说它必须变成"结构"。

## 1. 🔵 关键判（Bettor 点名要的）：**不是现做，是接线耦合 —— 但耦合面很小**

**实读结论：今天【不存在】可供 builder 消费的 typed/named 锚源。**

- 全仓 grep `root_tmpl_hash|rootTmplHash` → 14 个文件命中，**无一是持久化载体**
  （命中的是 `.sil` 源码、setup 的内存计算、builder/测试/我刚 pin 的 fixture、文档）。
- `docs/DATABASE.md` 实查：`pool_markets` 有 `spine_p2sh` / `sides_merkle_root` / `pool_merkle_root` /
  `fee_rules` / `metadata`，**没有 root_tmpl_hash 列**；`pool_payout_shards` 也没有。
- `pool-bshard-market-setup.mjs` 只 `return` 内存对象，**不落库**。

⇒ 该值今天只活在两处：**① 建市那一刻的内存**；**② 烤进 PoolLeaf ctor 的字节里**（`:40-41`）。
⇒ 「builder 消费 typed 源」**必须先造出那个源** = 一小块接线。**但它是一次性的、且不动链上。**

## 2. 三条路，各自的决定性问题

| | 形态 | 决定性问题 | 判 |
|---|---|---|---|
| **A** | 新增 `pool_markets.root_tmpl_hash`（**write-once trigger**，建市时写）；builder 收 **`marketId`（名字）**，自己去查 | 建市写入点覆盖得全吗？老市场怎么办？ | ✅ **推荐** |
| **B** | 从 **PoolLeaf redeem 的烤死 ctor 字节**里读 | 偏移量能不能不靠猜？refund 路径拿得到 leaf 吗？ | 🔴 有在册地雷 |
| **C** | 不存值，**按市场参数重编** PoolRoot 现算 | 每个输入都跨节点确定吗？ | 🔴 有致命疑点 |

### 为什么推荐 A
**A 存的是【那个值本身】，不是一条重新推导的路径。** B 和 C 都是"再算一次"，
而**任何"再算一次"都会把它依赖的东西一起变成锚的依赖**。write-once trigger 让它建市后不可改
（仓里已有先例：`fee_rules` 的 `trg_pool_markets_fee_rules_write_once`，照抄即可）。

### 🔴 B 的地雷（在册，别踩）
`docs/DATABASE.md` 对 `payout_redeem_hex` 明写：字段布局偏移
**「已实测定稿……不是从 ctor 参数顺序推断——改动前必读该文档，不能凭 `.sil` ctor 声明顺序猜字节位置」**。
B 要做的正是"从 redeem 里按偏移抠一个烤死常量" ⇒ 落进同一条禁令。
且 refund 命令的 inputs 只有 **pool + ticket**，**没有 leaf**；`current_leaf_state` 也只存 state 不存全 redeem。

### 🔴 C 的致命疑点（**必须先证伪才能选 C**）
C 要用市场参数（committee pks / deadline / shard_pool_id / shard_count / ps_tmpl_hash）重编。
`docs/DATABASE.md:583` 在册：**「本地表跨节点必漂」**（J1 r317 实证：`:3300` 缺某 pk → settler
`pkToRelay` Map miss → committee 跳过 PK）。
⇒ **若锚的任一输入来自会跨节点漂的本地表，两台机器会算出【不同的锚】** ——
那不是"锚"，是"本机的意见"。
🔵 **我没有确证 committee 成员就存在那张漂的表里**（583 说的是 pk↔relay 映射）。
**这是选 C 之前必须查的第一件事，不是我可以假定的。** —— 写在这里是为了别让它被跳过。

## 3. 设计（A 的最小形状）

1. **迁移 v197**：`pool_markets.root_tmpl_hash TEXT`（64 hex）+ write-once trigger（照 `fee_rules` 那条）。
2. **写入点**：建市流程（`pool-bshard-market-setup.mjs` 的调用方）在算出 `rootArtifact` 的**同一次**里写库。
   🔵 **同一次**很重要：晚一步写，写的就可能是**另一次编译**的值。
3. **读取**：新函数 `getMarketRootAnchor(db, marketId)` —— **只有它能返回这个值**。
4. **builder 改签名**：**删掉 `expectedRootTmplHashHex` 参数**，改收 `marketId` + db 句柄（或注入好的 anchor getter）。
   🔴 **删参数是这条修法的全部要害**：只要还留着一个"可以传 hash 进来"的口子，
   Codex 那条要求就没被满足 —— **不可用**才叫结构，**不该用**只是纪律。
5. **老市场**：`root_tmpl_hash IS NULL` ⇒ **fail-closed 拒绝构造退款**，不静默回落。
   （回填是单独一件事，且回填值的来源要单独定，不在本设计里顺手做。）

## 4. 测试 / 变异（Codex 点名那格）

- **用例**：调用方试图把自算的锚喂进来 ⇒ **结构上无处可喂**（函数签名里没有那个参数）。
  断言形态：给 builder 传一个多余的 `expectedRootTmplHashHex`，**它必须被完全忽略**，
  且当库里锚与候选 redeem 不符时**照样拒**。
  🔵 这一格证的是"喂不进去"，不是"喂进去也不听" —— 两者的区别就是结构与纪律的区别。
- **用例**：`root_tmpl_hash IS NULL`（老市场）⇒ 拒。
- **变异**：把 `getMarketRootAnchor(...)` 换回 `args.expectedRootTmplHashHex` ⇒ **必须变红**。
  （这条要红，需要一格"调用方传了个能自圆其说的假锚"的用例，否则变异后仍全绿。）
- **变异**：write-once trigger 拿掉 ⇒ 需要 DB 层用例才抓得到；**若本批不做 DB 层用例，就明说这条没人守**。

## 5. 我没做 / 卡点

- **未落码**（本文是评估+设计，等 @Bettor 审 → @J1tn 二审 → @NWT 红队 → Codex 复核）。
- **C 的那个疑点我没查完**（committee 成员到底存在哪张表、跨不跨节点）——
  它只影响"要不要选 C"，不影响 A 能不能做；但**若有人想选 C，这一步不能跳**。
- **回填老市场的值从哪来**，本设计**故意不定** —— 那是另一个"锚的来源"问题，
  顺手定会重演今天这条 MUST-FIX。
