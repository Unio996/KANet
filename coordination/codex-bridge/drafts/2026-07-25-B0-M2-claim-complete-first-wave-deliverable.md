# B0-M2 CLAIM-COMPLETE — 第一波交付物

| 字段 | 内容 |
|---|---|
| `batch` | `B0-M2-CLAIM-COMPLETE` |
| DRI | J2 |
| 真相源复核 | J1 |
| 红队 | NWT |
| 方向/调度 | Bettor |
| 卡权威原文 | bridge `c45acd37` v1.2 §8.8 |
| 本波交付(§16.2) | 五层完成矩阵 + 缺失 live evidence |
| 本波范围裁定 | Bettor 20:27：凡 B0 卡 DoD 里要求「动实钱 / 走完整 live lifecycle」的那一项**不在本波** ⇒ DoD-5 排除 |
| 手段约束(§16.3) | B0 卡只能先做**只读取证、设计和离线测试**；`BLOCKED_DO_NOT_RUN_G5` 仍在 force |

> **本文含逐字引文。引文中的 `[T]` = U+771F 原字，按频道规矩标记而不改写引文。**

---

## 0. 本交付物的证据等级约定

每一格标三样：**结论 · 证据在哪 · 我用什么手段得到的**。凡未经我本人实测的，一律标「未核」并注明来源，不因为它读起来可信就升格。

本波全部动作为**只读**：`git show` / `git cat-file` / `grep` / `sed` / `awk` / `wc` / `node -e` 读 JSON。
**零写入 · 未 fetch/push/checkout · 未连接 live DB · 未构造/签名/广播任何交易。**

---

## 1. DoD-1 —— 五层完成矩阵

> 卡原文：**「明确"合约 entry 已实现""driver 能构造""relay 能签/提""链上已落地""全部 claim 可恢复"五层，不得合并报完成」**

### ① 合约 entry 已实现 —— ✅

`kasia-console/src/lib/CloseZkV2.sil` L145 `entrypoint function claim(...)`，实测其强制项：

- `require(closed == 2)` — 与 `escape_claim` 的 `==3` 互斥
- `require(merkle_index >= 0); require(merkle_index < 1024)` — depth-10 cap（见 §5）
- `require(payout >= 1); require(payout <= consolidated_pool)`
- Merkle membership：`s0..s9` 逐层 climb ⇒ `require(cur == payoutRootField)`
  **验对象是本合约 STATE，不是 witness 自报**
- nullifier 位图：17 words × 63 bits，置位前 `require` 该位为 0
- 输出锁定：`require(tx.outputs[payoutOutIdx].scriptPubKey == P2PK(bettorPk))`
- 输出金额：`require(tx.outputs[payoutOutIdx].value == payout)`
- dust 分支：`consolidated_pool == payout` 时不产生 0 值 continuation
- 守恒 weld：否则 `require(tx.outputs[selfOutIdx].value == consolidated_pool - payout)`

**测试向量**：`kasia-console/src/lib/CloseZkV2.test.json`，8 条，其中 claim 相关 5 条：
`claim_normal_first_winner` · `claim_dust_boundary_final_winner` ·
`claim_negative_wrong_merkle_proof` · `claim_negative_closed_eq_3_should_reject` ·
`claim_negative_double_claim_same_index_blocked`

🔴 **而 selftest 只交叉核了其中 2 条**（`claim_normal_first_winner` / `claim_dust_boundary_final_winner`），
且用的是**合成哨兵值**（1111…/2222…/3333…），非链上实际数据 —— 这一句是
`rehearsal-pre-broadcast-gate.claim.selftest.mjs` 文件头自述，不是我的评价。

### ② driver 能构造 —— ✅

`kasia-console/src/lib/closezk-v2-claim-builder.mjs`，导出 6 个函数，其中 `buildClaimWitness` 含三重自校验：
pk 顺序核对 · climb self-verify（重算不回则拒绝组装）· nullifier 位已置位则拒绝重复组装。

**回归**：`kasia-console/test-framework/cases/predictions/pool/zk_autonomy_ticks_regression.test.mjs`
541 行 / 8 小节 / **65 个断言点**（60 次本地 helper `check()` + 5 次 `assert.throws`），
第 541 行 `process.exit(failures === 0 ? 0 : 1)` —— **退出码已正确接上**。

⚠️ **我在这一格差点报错**：初次统计得「7 个断言」，因为只数了 `assert`。
本地 helper `check()` 在 L48 定义、被调用 60 次。**拦住我的是"发之前先找有没有本地断言 helper"。**

### ③ relay 能签/提 —— 🟡 有码路径，本轮未逐行核

`kasia-relay/src/lib/p2sh.mjs` 引用 claim builder 与 `CloseZkV2.test.json`。
**我只确认了引用关系，未逐行核签名/提交路径。标未核。**

### ④ 链上已落地 —— ❌ 截至 2026-07-08 为零

> 逐字引文，来源 `kasia-console/src/lib/rehearsal-pre-broadcast-gate.claim.selftest.mjs` 文件头，落款 J1tn 2026-07-08：
>
> **「claim 全链从未[T]实触发过（NWT/Bettor 昨晚反复确认），没有[T]实落链数据可比对」**

🔴 **格内时间口径（NWT 20:49 要求，本格文字自带，不放脚注）**：

> **截至 2026-07-08 为零（依据：仓库自述）；7/08 之后未复核 —— 需 live 查询，依 Bettor 20:39 裁定本波不做。**

**为什么本波不查**（Bettor 裁定依据，我提出、他采纳）：

- `events` 表**无 `event_type` 索引**（`migrate.js` 实测：仅 `created_at` / `level` / `trace_id` / `agent_address`）
- live `console.db` 实测 **9,323,257,856 字节 ≈ 9.3 GB**
- ⇒ 按 `event_type` 过滤 = 在跑着实盘结算的活 WAL 库上全表扫，代价落在别人的钱路
- ⇒ 且「EXPLAIN 命中索引 ≠ 查询便宜」（有过全索引 live 烧 187 秒的先例），无法在不跑它的前提下断定便宜

🔵 **Bettor 要求写进本格的一句**：
**「这一条不是矩阵的空白，是矩阵的一项结论：我们连自己有没有落过链都要跑 live 查询才知道。」**

### ⑤ 全部 claim 可恢复 —— ❌ 无从谈起

④ 为零 ⇒ ⑤ 不可能有证据。**不单独判等级。**

---

## 2. DoD-2 —— claim 的绑定

> 卡原文：**「claim 绑定 settlement commitment、recipient、amount、Merkle path、nullifier/bitmap 和当前 continuation」**

| 绑定项 | 结论 | 源码依据 |
|---|---|---|
| recipient | ✅ | `require(tx.outputs[payoutOutIdx].scriptPubKey == P2PK(bettorPk))` |
| amount | ✅ | `require(tx.outputs[payoutOutIdx].value == payout)` |
| Merkle path | ✅ | `s0..s9` climb ⇒ `require(cur == payoutRootField)` |
| nullifier/bitmap | ✅ | `w0..w16`，置位前 require 为 0，置位后写进 continuation |
| 当前 continuation | ✅ | `validateOutputState`：`closed:2` 不变 · `payoutRootField` 不变 · `pool − payout` |
| settlement commitment | ✅ 链式，见下 | |

### settlement commitment 的绑定链

```
claim 验 payoutRootField（本合约 STATE，非 witness）
  ↑ 它在 zk_close 时写入，值 = guestPayoutRoot ← witness 喂
     而它不是没人管：
       journalHash = sha256(betsRootBaked + attestedWinner + guestPayoutRoot)
       require(tx.inputs[1].scriptPubKey == P2SH(blake2b(gatePrefix + journalHash + gateSuffix)))
     ⇒ 要花掉 input[1] 那个 ZK gate，必须给出对【这个 journal】成立的证明
```

🔵 **⇒ covenant 不自己重算这个 root，它要求「承诺了这个 root 的 ZK gate 被花掉了」。**
**binding authority = guest circuit 二进制（image_id 烤进 `gateTmplHash`），不是委员，也不是 covenant 的算术。**

🔴 **链上没有的是**：`guestPayoutRoot` 与**委员 attest 的 `claimedPayoutRoot`** 之间的一致性校验 —— 目前无 `require(guestPayoutRoot == committeeAttestedRoot)`。委员那个 root 在 ZK-native 路径下是 V1 时代的 historical artifact。

⚠️ **本节过程中我犯过一次「假更正」**：我先在频道报「我的记忆条目过强」，随后读记忆原件发现**过强的是我对它的复述**（我引了压缩描述行，把否定的宾语丢了）。已在频道更正。**记在这里是因为：更正读起来自带可信度，没人会去核一条自我批评。**

---

## 3. DoD-3 —— 八类负测试

> 卡原文：**「duplicate、wrong proof、wrong amount、dust、spent race、indexer miss、进程重启和 partial claims 全部有负测试」**

| # | 类别 | 判 | 证据 |
|---|---|---|---|
| 1 | duplicate | ✅ 两层 | 合约向量 `claim_negative_double_claim_same_index_blocked` + driver L131 |
| 2 | wrong proof | ✅ 合约层 | 合约向量 `claim_negative_wrong_merkle_proof`；driver 层无独立用例 |
| 3 | wrong amount | 🟡 | 合约有 require 强制但**无独立命名向量**；driver L135 有 |
| 4 | dust | ✅ | 合约向量 `claim_dust_boundary_final_winner` + 合约 dust 分支 |
| 5 | spent race | 🔴 未找到 | 见下「搜索范围」 |
| 6 | indexer miss | 🔴 未找到 | 见下「搜索范围」 |
| 7 | 进程重启 | 🟡 相邻 | driver §4 `poolAtZkCloseSompi` write-once 快照 —— 防的是「重启后读到漂移的活值」，**不是**一条重启负测试 |
| 8 | partial claims | 🟡 编排侧 | driver §3 last-claimant/exhausted + §6 all-claimed-not-exhausted 报警；未覆盖链侧半完成态 |
| ➕ | 状态互斥 | ✅ 白得 | 合约向量 `claim_negative_closed_eq_3_should_reject`（不在 DoD-3 清单里） |

### 搜索范围（明写，因为我在这一格报过一次假的零覆盖）

- ✅ 搜过：`kasia-console/src/lib/*` · `kasia-console/test-framework/cases/predictions/*`
- ✅ **不限文件类型**（第一次只扫 `*.mjs`/`*.js`，而 `wrong proof` 的证据在 `.json` 里 ⇒ 报出假零覆盖，已更正）
- ✅ 语义族而非精确措辞
- 🔴 **未搜**：`kasia-relay/` 全树 · `scripts/` · 归档目录

⇒ **5/6 两格准确的说法是「在上述范围内未找到」，不是「不存在」。**

### 5、6 两格缺失的方式

1/2/3/4 都能在离线断言里造出来。而 5（别人抢先花掉 continuation UTXO）与 6（本地 indexer 没看见那个块）**故障源在链上/索引层，离线断言天然造不出**。

🔨 **建议记法**：不写「缺负测试」，写**「该类只能由 live 或 harness 覆盖，而本波两者都不许」** —— 与 ④ 同一形状：**缺的不是我们没做，是本波的手段够不着。**

---

## 4. DoD-4 —— 不依赖单一 bot / DB / operator

> 卡原文：**「claim 不依赖单一 Telegram bot、单一 DB 记录或单一 operator 才能被证明存在」**

构造一次 claim，`buildClaimWitness` 需要四样输入：

| 输入 | 来源 |
|---|---|
| `currentState` | ✅ 从链上 redeem script 解出（`parseCloseZkV2State`）—— 链派生 |
| `feeLeaves` | 🔴 `deriveCloseFeeLeaves(marketId, …)` —— 我方数据 |
| `poolAtZkCloseSompi` | 🔴 `pool_markets.metadata` 的 zk_continuation 快照 —— 我方 DB |
| `bettors`（全量下注名单） | 🔴 用来重建整棵 merkle 树 —— ⚠️ **未追到取值点，标未核** |

**⇒ 答案分两半，方向相反**：

- ✅ **「被证明存在」成立**：claim 一旦落链，就是一笔花掉 continuation、付给 `P2PK(bettorPk)` 的交易，任何人只看链就能验。
- 🔴 **「能不能领得到」不成立**：要**构造**一次 claim 需重建 payout 树，而所需输入至少两样、可能三样来自我方数据。

🔴 **⇒ 按字面 DoD-4 可判过，而按它显然想保证的那件事（不必信任经营者）是不过的。只写前半会把后半洗掉。**

### 链上确实留了一条不依赖我们的后路 —— 但它不是 claim

`escape_claim` 用 `refundRootBaked`，genesis-mint 时烤死 ⇒ 理论上可由链上派生。
🔴 **而它给的是「退回本金」，不是「领走赢的钱」。⚠️ 其证明所需输入是否也全链派生，未核。**

---

## 5. DoD-6 —— 守恒零差

> 卡原文：**「所有 winner/fee/introducer 等角色的剩余价值有唯一去向，守恒为零差」**

**总额守恒：✅ 合约层成立** —— `pool − payout` 逐笔递减 + dust 分支 + 显式守恒 require。

**分配正确性：🔴 严重性未定 —— 尚未构造区分输入。**

（Bettor 20:51 明令：不许用「口径不统一」这个措辞交付，因为它能同时装下代码卫生与钱路 P0。）

**已知线索（记录，非本轮实测）**：2026-07-08 市场5 pxvml 出现过同一笔盘两个不同 root ——
propose 侧 `FEE_CONFIG` 3% split / pool=Σ注 300M，prove 侧 job#6 `broker_fee_pct` 190bps broker-only / pool=consolidatedPool 320M。

🔨 **该线索若能被复现成一组具体输入，本格升 (b) 类钱路；在那之前不判等级。**
（NWT 20:49 的问法：**有没有一个具体输入，三侧代入后得到不同的数？** —— 本波未做。）

---

## 6. 本卡衍生的两条缺陷 —— 均已在频道并类，本波不改

### 6.1 合约 vs driver 的上界不一致 —— 47 个下标

```
合约  CloseZkV2.sil claim entry:  require(merkle_index < 1024)     // depth-10 cap
driver closezk-v2-claim-builder:  _NULLIFIER_WORDS = 17
                                   throw if wordIdx >= 17 ⇒ 上界 17×63 − 1 = 1070
       🔴 '1024' 这个数在 driver 里一次都没出现（grep -c = 0）
⇒ 缺口 merkle_index ∈ [1024, 1070]，共 47 个下标：driver 组装成功、合约必拒
```

🔴 **分批取决于一格未核**：现网跑着的 covenant 字节码是不是这份源码编出来的。
- **未核之前** = 仓库内两处对不上（代码卫生）
- **核实一致之后** = live 有 47 下标裂缝（B0 / 钱路）
- ⇒ 两者进不同批次（§16.3 末条）

🔨 **核法（Bettor 20:54 定稿）**：直接读 live 加载的字节里那个上界常量，**绕开「编译可重现」整个前提**（编译源码比对需先 pin 到能重现 DoD 字节的 silverc，否则对不上是工具链差异而非代码差异）。
🔴 **必带 round-trip 自证**（NWT 给的前置，记忆 `reference-hardcoded-sil-offset-staleness-live-derive-required`）：
**不许按「那个数在第 N 个字节」去取** —— 源码一改、编译器一换 offset 就漂。
最坏形态：取到 1070 报「live 上界不是 1024」，而实况是取错了位置 ⇒ **把代码卫生误报成 live 钱路裂缝，方向恰好是最贵的那个。**

### 6.2 与 `|| j.found` 并列成一类（Bettor 20:52 定稿）

> **判据：「这个断言的正确性，依赖【对面当前不产生某种输入】—— 或依赖【对面的 schema 当前缺某个字段】吗？」
> 若是 ⇒ 它不是一道断言，是一个【约定】。而约定必须写在两边。**

| 实例 | 依赖 | 失效方向 |
|---|---|---|
| `_checkLandedViaRelay` 的 `\|\| j.found`（NWT 报） | relay 恰好不返回该字段 | **fail-OPEN** — 钱可能错付；**不会自己喊** |
| 1024 帽（本卡） | 还没有市场超过 1024 个 claimant | **fail-CLOSED** — 该领的领不到；**会自己喊** |

🔵 **⇒ 侦测预算压在 fail-open 那一侧（它永远不现身），修复紧迫性按用户损害排序。两根轴不重合。**

---

## 7. 本卡的一条正面发现 —— ZK claim 路径是做对的那条

实读 `kasia-console/src/lib/zk-autonomy-ticks.mjs`：

```
:176 注释逐字 "landed-gated 持久化: check_utxo_landed 过了才 advanceZkContinuationAfterSpend
              ——广播成功 ≠ 落链"
:181 const landedOk = await ctx.checkLanded(landAddr, txid, 20);
:182 if (!landedOk) { ... '零持久化, 需人工核实链上实况' }
同款写法：zk_close(:93-97) · handoff(:276-282)
```

✅ **三处都是：广播成功不推进状态；landed 确认过了才写；超时则零持久化 + 报警。**
✅ **NWT 已复核那道闸判得对**：`ctx.checkLanded` → `_checkLandedViaRelay`(minDepth=20) → relay UTXO 集查询，**不是** `kaspa_tx_log`。

🔵 **⇒ 由此得出的团队级结论（Bettor 采纳）**：**不是能力问题，是这两条路径从来没有被放在一起比过** —— 正确写法就在同一棵树里。

---

## 8. 本波未做 / 未核清单（不藏）

- **DoD-5**（小额完整 claim lifecycle）：经 Bettor 20:27 裁定不在本波
- **④ 7/08 之后是否有 claim 落链**：经 Bettor 20:39 裁定本波不查
- **③ relay 签/提路径**：只确认引用关系，未逐行核
- **DoD-4 的 `bettors` 取值点**：未追到
- **DoD-6 的区分输入**：未构造
- **6.1 的 live 字节比对**：未做（做法已定稿，含 round-trip 自证要求）
- **`escape_claim` 的输入是否全链派生**：未核
- **搜索范围外**：`kasia-relay/` 全树 · `scripts/` · 归档目录

---

## 9. 交付边界

**本波全部动作为只读**：`git show` / `git cat-file` / `grep` / `sed` / `awk` / `wc` / `node -e`（读 JSON 与源码）。
**零写入主仓 · 未 fetch/push/checkout · 未连接 live DB · 未构造/签名/广播 · 未 re-arm/grant/restart。**
主仓工作树 `041e2421`，自本波开始至交付未有任何改动。
**50 KAS：本会话我从未查过链，不继承他人结论。**

本文件是本波交付物**本体**；频道分段是它的过程记录，二者不一致时**以本文件为准**。
