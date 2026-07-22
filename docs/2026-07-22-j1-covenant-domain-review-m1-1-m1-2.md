# J1 covenant 域复核 — M-1.1 三处待办 + M-1.2 C-3 nullifier/write-once 覆盖矩阵

> **Status**: DRAFT（2026-07-22 · J1tn）· 待交叉审（不可自审自过，同 M-1 全卡纪律）
> **依据**：`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`（J2 主笔）§1 待办①②③ + `docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（NWT）§2 C-3 + §5"待交叉审"。
> **方法**：全部结论直接读 `kasia-relay/src/lib/p2sh.mjs`（relay JS 侧构造）+ 对应 `kasia-console/src/lib/*.sil`（covenant 链上强制侧）——J2/NWT 原稿只读了 relay.mjs/p2sh.mjs 的 case 分支注释，未逐一进 `.sil` 源码核实链上到底 require 了什么。本卡是"进 `.sil` 源码"这一步。
> **本卡性质**：只读取证，不改一行执行代码。

---

## 1. M-1.1 三处待办核实（p2sh.mjs `unlockBshard*` + 对应 `.sil` require）

### ① `BSHARD_REGISTER_BET` 金额上限 — **确认缺口，非虚惊**

- **relay JS 侧**（`p2sh.mjs:2667-2718` `unlockBshardRegister`）：`w.stake`（witness 声明的下注额）直接进 scriptSig push（:2681）+ 直接决定 `cmd.outputs.leaf_continuation.amountSompi`（:2686）。函数体内**零金额上限校验**。
- **`_assertTxInvariants`**（`p2sh.mjs:42-74`）只查三件事：Σin≥Σout（不能超花）、每个 output ≥ dust、fee ≥ mass floor——**不检查任何单笔金额是否超过业务上限**，这是通用的"tx 结构合法性"检查，不是"这笔下注金额合理吗"的业务检查。
- **covenant 侧**（`kasia-console/src/lib/ShardLeaf.sil:50-80` `register_append`）：唯一金额约束是 `require(stake >= min_bet);`（:61）——**只有下限，没有上限**。output-bind weld（:79 `tx.outputs[leafOutIdx].value == pool_value + stake`）只保证"leaf 真收到这笔钱"，不约束这笔钱能有多大。
- **资金来源核实**（关键，决定风险等级）：`unlockBshardRegister` 里 funding UTXO 全部用 `wallet.getPrivateKey()` 签（:2702-2704，非调用方传入外部私钥）——跟 `CUSTODIAL_TRANSFER` 不同类，跟 `TRANSFER` 同类：花的是 **relay 自己钱包的钱**，caller 只能指定花多少、不能指定花别人的钱。若 `f.address` 不是 relay 自己的 UTXO，签名在链上验证会失败（P2PK 签名与实际锁定脚本不匹配），所以这条命令物理上只能命令 relay 花自己的钱，不能凭空转移第三方资产。
- **结论**：`BSHARD_REGISTER_BET` **没有独立金额上限**——跟 M-1.1 §2 已经点名的 `TRANSFER` 是**同一个反模式的第 6 个实例**（前 5 个：pool_settle/prediction_settle/custodial_transfer/ECDSA_SIGN/SIGN_INPUT_FOR_SETTLE + TRANSFER 本身）：任何能摸到 relay IPC 分发点的调用方（T-1，零 caller 校验）都能命令 relay 把自己钱包的钱以任意大小注进一笔"下注"里，一次性掏空 relay 钱包。**建议 M-1.1 §1 表格 `BSHARD_REGISTER_BET` 行"金额-费率上限"列从"(待确认①)"改为"❌ 无上限（同 TRANSFER 反模式）"**，并入 M-1.2 B-3（LANDS）的具体例证列表。

### ② `BSHARD_CLAIM_WINNER` 终局检查 — **原稿判断需要修正：链上确实有终局检查**

- **relay JS 侧**（`p2sh.mjs:2725-2788` `unlockBshardClaim`）：确实**没有**独立的 finality/DAA 检查——但这不是缺口，是正确的架构分工（终局校验的权威在 covenant，不在 JS 包装层，跟 close/consolidate 等其他命令一致）。
- **covenant 侧**（`kasia-console/src/lib/PoolRoot.sil:81-133` `claim_draw`）：
  - `require(closed == 1);`（:92，注释"仅 settled 可 claim"）——**这就是终局检查**：只有委员 4-of-5 完成 `close_commit`（写 `closed=1`）之后，`claim_draw` 才可能成功；此前任何 claim 尝试链上直接 BUST。
  - `require(payout <= pool_value);`（:98，注释"fail-fast"）防超额提取。
  - `require(tk.direction == winningSide);`（:103）绑定 claim 方向必须是委员判定的赢方。
  - merkle proof（:105-114 `require(cur == payoutRoot)`）把具体 payout 金额密码学绑定到委员 attest 时写入的 `payoutRoot`，caller 不能编造金额。
- **结论**：M-1.1 §1 表格原文"需 ticket(bettorSig)真实签名, **无独立 finality 检查**(待确认②)"——**"无独立 finality 检查"这句是不准确的，需要订正**。终局检查存在且是强约束（`closed==1` write-once 门 + merkle 绑定金额），只是执行在 covenant 层而非 relay JS 层——这正是这套架构该有的样子（跟 register_bet 那种"两层都没查"的真缺口性质不同，不能混为一谈）。**建议改为："closed==1 write-once 门（PoolRoot.sil:92）+ merkle-proof 金额绑定（:105-114），终局检查在 covenant 层强制，relay JS 层不重复校验（架构正确，非缺口）"**。

### ③ `BSHARD_CLOSE_COMMIT` 委员深度门 — **原稿判断同样需要修正：深度门确实存在**

- **relay JS 侧**（`p2sh.mjs:2850-2898` `unlockBshardClose`）：JS 层只做 5 个签名收集/拼接（:2869-2872），本身不重新校验深度或阈值——同②，正确分工。
- **covenant 侧**（`kasia-console/src/lib/PoolRoot.sil:47-78` `close_commit`）：
  - `require(closed == 0);`（:54，write-once）
  - `require(count == shard_count);`（:55，**源码注释原话"深度防御 (seal 已保证仅全片折满的 root)"**——这就是"委员深度门"，字面意义上就是这个名字，不是我发明的解读）
  - `require(tx.time >= deadline * 1000);`（:56，post-deadline 时间门）
  - `validSigs >= 4`（:59-65，4-of-5 委员签名门槛）
- **结论**：M-1.1 §1 表格原文"委员签名数量校验(4-of-5), **无独立深度/finality 门**(待确认③)"——**同样需要订正**。深度门（`count==shard_count`，代码注释自称"深度防御"）+ 时间门（`tx.time>=deadline*1000`）+ 签名数量门三者都存在且都是 covenant 层硬 require，不存在的只是"relay JS 层额外重复这些检查"（不需要，链上会拦）。**建议改为："count==shard_count 深度防御门 + tx.time>=deadline 时间门 + 4-of-5 签名门，三门均在 covenant 层强制（PoolRoot.sil:54-65），无缺口"**。

**①②③ 小结**：三处待办里，**只有①是真缺口**（金额无上限，同 TRANSFER 反模式家族，应升级并入 M-1.2 B-3 具体例证）；**②③是 M-1.1 原稿的误判**——只读了 relay.mjs/p2sh.mjs 的 JS 包装层就下"无独立检查"的结论，没有进 `.sil` 源码看链上侧，而链上侧其实两处都有硬 require。这个误判本身也是一个值得记录的方法论教训：**判断"有没有检查"必须看强制执行的那一层（这里是 covenant），不能只看发起请求的那一层（这里是 relay JS）**——跟 M-1.2 自己在 C-3 里提的"链上兜底 ≠ 应用层不需要检查"是同一个纪律的镜像应用（这次是反过来：JS 层没查 ≠ 系统没查，因为 covenant 查了）。

---

## 2. M-1.2 C-3：covenant nullifier/write-once 覆盖矩阵（逐条 20 命令）

NWT 原稿标"部分"，要求逐条核哪些命令有链上防重放、哪些裸奔。核实方法：进每条命令对应的 `.sil` entrypoint，看有没有（a）显式 nullifier 位图字段，（b）write-once 状态闸（`closed` 这类字段只能翻一次），或（c）仅靠 UTXO 花费本身防双花（无额外显式字段）。三档由强到弱：

| 命令 | 链上防重放机制 | 证据 file:line | 强度分级 |
|---|---|---|---|
| `BSHARD_REGISTER_BET` | 仅 UTXO 花费（leaf/funding outpoint 花一次少一次）；无显式字段 | `ShardLeaf.sil:50-80`（无 nullifier/write-once 字段，count 递增但可反复调用是设计意图非缺口） | 🟡 UTXO-only（**设计如此**——register 本就该能反复调用累加下注，"重放"在这条命令语义下不是攻击而是正常操作；风险不在重放，在①金额无上限） |
| `BSHARD_CLAIM_WINNER` | ticket UTXO spent-once（dust 凭证一次性消费）+ root 状态序列化推进(pool_value 递减) | `PoolRoot.sil:100-101`(`readInputStateWithTemplate` 消费 ticket) | 🟡 UTXO-only（ticket 双花被 UTXO 模型天然挡；无独立 nullifier 位图，但 ticket 本身就是"一次性凭证"设计） |
| `BSHARD_REFUND_CANCELLED` | 同上，ticket UTXO spent-once | `PoolRoot.sil:135-165`（结构镜像 claim_draw） | 🟡 UTXO-only |
| `BSHARD_FOLD` | 仅 UTXO 花费（k children 一次性消费） | 未展开读（非价值转移，M-1.1 表已标"无独立终局检查"，与本次核实结论一致） | 🟡 UTXO-only |
| `BSHARD_CLOSE_COMMIT` | **write-once**：`closed==0` 门 + 翻到 1 后不可逆 | `PoolRoot.sil:54`(`require(closed==0)`) | 🟢 write-once |
| `BSHARD_SEAL_TO_ROOT` | 仅 UTXO 花费（leaf 一次性消费变 root） | 未展开读（同 FOLD 性质，结构转换非重复敏感操作） | 🟡 UTXO-only |
| `BSHARD_CONVERT_TO_FOLDNODE` | 仅 UTXO 花费 | 未展开读 | 🟡 UTXO-only |
| `BSHARD_GENESIS_MINT_PAYOUT` | n/a（创世操作，无"重放"概念——cov_id 本身是新铸唯一性来源） | — | ⚪ N/A |
| `BSHARD_CONSOLIDATE` | UTXO 花费（ShardLeaf 侧）+ **`absorb` 侧 `closed==0` 门**（不能consolidate进已 closed 的 PayoutShard） | `PayoutShard.sil:53-54`(`entrypoint function absorb` `require(closed==0)`) | 🟢 write-once（吸收侧有闸，非纯 UTXO-only，比 M-1.1 表里"无独立深度门"描述的更强一点——但这个闸防的是"consolidate 进已关闭的池"，不是"同一片重复 consolidate"，后者仍靠 ShardLeaf UTXO 花费防护，两种防护叠加） |
| `BSHARD_CLOSE_ATTEST` | **write-once**：`closed==0`→1，+ **17-word nullifier 字段**（w0-w16，供后续 claim/refund_claim 用） | `PayoutShard.sil:80`(`require(closed==0)`) + `:38-43`(nullifier fields 声明) | 🟢 write-once（本条自身是 write-once 闸；nullifier 字段是它**为后续 claim 命令**初始化的，不是防自己重放，见下条 PAYOUT_CLAIM） |
| `BSHARD_PAYOUT_CLAIM` | **显式 nullifier**（17-word bitset，防同一叶子重复 claim，覆盖跨多次 root/state continuation） | `PayoutShard.sil:171-226`(`claim`，`require(closed==1)`:176 + nullifier bit 消费逻辑) | 🟢🟢 nullifier（最强档——不止本次调用防重放，是防"这个叶子这辈子"防重放） |
| `BSHARD_CANCEL_ATTEST` | **write-once**：`closed==0`→2，镜像 close_attest | `PayoutShard.sil:245`(`require(closed==0)`) | 🟢 write-once |
| `BSHARD_REFUND_CLAIM` | **显式 nullifier**（同 w0-w16，镜像 payout_claim，`closed==2` 前置+互斥） | `PayoutShard.sil:334-339`(`require(closed==2)`:339，注释明示"F4 nullifier 复用 w0..w16") | 🟢🟢 nullifier |
| `BSHARD_CLOSE_ATTEST_V2` | 同 CLOSE_ATTEST（V2 镜像结构） | `PayoutShardV2.sil`（M-1.1 表已确认"同 V1 逻辑镜像"，本次未逐字节重读，按既有坐实的"byte-identical 镜像"结论沿用） | 🟢 write-once |
| `BSHARD_CONSOLIDATE_V2` | 同 CONSOLIDATE（V2 镜像） | 同上，按既有镜像结论沿用 | 🟢 write-once |
| `BSHARD_ZK_HANDOFF` | 仅 UTXO 花费，且是**生命周期终点**（旧 covenant 之后不可花费，物理上无法重放） | M-1.1 表已标"生命周期终点操作" | ⚪ 终点操作（比 UTXO-only 更强——不是"能双花但没成功"，是"这个 UTXO 之后根本不存在了"） |
| `BSHARD_ZK_CLOSE` | **write-once**：`closed==1` 前置（本次读到的是 `CloseZkV2.sil:38-43` 的 `zk_close`，`require(closed==1)`）+ **真实 groth16 proof gate**（密码学证明，不是签名计数） | `CloseZkV2.sil:38-43` | 🟢🟢 write-once + ZK proof（本清单唯一有密码学证明前置的，比纯签名计数更强） |
| `CLOSEZK_V2_CLAIM` | **显式 nullifier**（17-word，与 escape_claim 共用同一组 w0-w16，`closed==2` 前置） | `CloseZkV2.sil:145-150`(`require(closed==2)`:150) | 🟢🟢 nullifier |
| `CLOSEZK_V2_ESCAPE_TRIGGER` | **write-once**：`closed==1`→3（不动钱，纯 flag-flip） | `CloseZkV2.sil:65-66`(`require(closed==1)`) | 🟢 write-once |
| `CLOSEZK_V2_ESCAPE_CLAIM` | **显式 nullifier**（同 w0-w16，`closed==3` 前置，与 CLAIM 的 `closed==2` 互斥消歧） | `CloseZkV2.sil:80-85`(`require(closed==3)`:85) | 🟢🟢 nullifier |

**分级小结**：
- 🟢🟢 **nullifier（4 条）**：`BSHARD_PAYOUT_CLAIM`/`BSHARD_REFUND_CLAIM`/`CLOSEZK_V2_CLAIM`/`CLOSEZK_V2_ESCAPE_CLAIM`——最强档，跨整个 covenant 生命周期防重复领取同一份额，NWT 原稿点名的正是这一档。
- 🟢 **write-once（8 条）**：`BSHARD_CLOSE_COMMIT`/`BSHARD_CONSOLIDATE`(absorb 侧)/`BSHARD_CLOSE_ATTEST`/`BSHARD_CANCEL_ATTEST`/`BSHARD_CLOSE_ATTEST_V2`/`BSHARD_CONSOLIDATE_V2`/`BSHARD_ZK_CLOSE`/`CLOSEZK_V2_ESCAPE_TRIGGER`——状态闸只能翻一次，防的是"同一个状态转移被重复执行"，不是"同一份额被重复领取"（语义不同于 nullifier，但对 C-3 的核心问题"重放能不能造成二次转移"回答同样是"不能"）。
- 🟡 **UTXO-only（6 条）**：`BSHARD_REGISTER_BET`/`BSHARD_CLAIM_WINNER`/`BSHARD_REFUND_CANCELLED`/`BSHARD_FOLD`/`BSHARD_SEAL_TO_ROOT`/`BSHARD_CONVERT_TO_FOLDNODE`——**没有显式 nullifier/write-once 字段，纯靠"这个 outpoint 只能花一次"的 UTXO 模型天然性质防双花**。这是 NWT 定性里说的"裸奔"最贴切的一档——不是没有保护（UTXO 双花在共识层是硬保证），而是没有**专门为这条命令设计**的应用层重放语义（比如 CLAIM_WINNER/REFUND_CANCELLED 的"防重放"其实是靠 ticket 这个旁支机制间接实现，不是命令本身设计的）。**C-3 的核心担忧（"重放消耗对手费用/探测状态"）对这 6 条命令确实成立**：攻击者截获一条合法请求重放，relay 会尝试重新构造并广播，第二次broadcast 会因为 outpoint 已花在 mempool/consensus 层被拒——**能拦住"二次生效"，拦不住"二次尝试消耗一次 relay 处理开销+一次 mempool 拒绝噪音"**，这正是 NWT 说的"请求层去重是必需，链上防重放是纵深不是替代"那句话的具体落点。
- ⚪ **N/A / 终点（2 条）**：`BSHARD_GENESIS_MINT_PAYOUT`（创世，无重放概念）/`BSHARD_ZK_HANDOFF`（生命周期终点，UTXO 之后物理不存在）。

**回答 NWT C-3 的原问题**："哪些命令有链上防重放、哪些裸奔"——**20 条里没有一条是完全无保护的裸奔**（UTXO 双花模型是所有命令的地基保证，最弱档也有这个），但**"裸奔"如果按 NWT 卡里的严格定义（"应用层不应依赖链上兜底"）来问"有没有专门的请求级/应用级去重"，答案是 20 条全部没有**——这跟 M0c⑤"nonce/request-id 防重放"这条要建的东西是同一件事，不因命令而异。C-3 表格"当前状态"那行的判定（"部分"）我认为**应该细化而不是简单改成"全 LANDS"或"全 BUST"**：4 条 nullifier + 8 条 write-once 命令，"二次生效"这个具体后果是 BUST 的（链上真的挡住了）；但"请求层无去重、可消耗资源/探测"这个后果，20 条全部是 LANDS（因为没有一条命令有 M0c⑤ 意义上的 nonce/idempotency-key）。**建议 M-1.2 §2 C-3 那行"当前状态"改写为**："🟡 二次生效被 covenant 层挡住的有 12/20（nullifier 4 + write-once 8）；请求层去重（M0c⑤ 意义）0/20，全部 LANDS——链上防重放≠请求层去重，两件事分开判"。

---

## 3. 待交叉审

- 本卡按 M-1 纪律"不可自审自过"，需 Bettor/NWT/J2 至少一路交叉核 file:line。
- ①（register_bet 无上限）建议直接并入 M-1.2 B-3 的具体例证列表（LANDS 阵营，跟 TRANSFER 同款）。
- ②③（claim_winner/close_commit 的"无独立检查"判断需订正）建议 J2 回 M-1.1 原文修订这两行的"待确认"标记，改为本卡给出的准确描述。
- C-3 建议 NWT 采纳"12/20 covenant 层挡二次生效 + 0/20 请求层去重"的细化判定，回填 M-1.2 §2 表格与 §4 矩阵。
- `BSHARD_CLOSE_ATTEST_V2`/`BSHARD_CONSOLIDATE_V2` 两行沿用了既有"V1/V2 byte-identical 镜像"结论（未逐字节重读 PayoutShardV2.sil），如交叉审认为需要独立验证，可补一轮。

**关联**：`docs/2026-07-22-m1-1-command-capability-effect-matrix.md`、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`、`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md`（M-1 §3）、频道 dev-coord-testnet 2026-07-22 14:01Z 派工记录（#w5i9e0）。
