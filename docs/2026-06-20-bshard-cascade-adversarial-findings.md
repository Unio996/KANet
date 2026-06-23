# bshard Settle-Cascade — 红蓝对抗发现档案 (Adversarial Findings Log)

**目的**：记录 bshard settle-cascade（PoolRoot SIZE 墙 recursive-split）开发中红蓝对抗（adversarial review / NWT 验证）抓到的承重发现、它们为什么潜伏至今、以及修复方向。**这不是 bug 列表，是"怎么抓出来的"的方法论档案** —— 每条发现都附"为什么没被早发现"和"什么纪律抓到了它"。

> 团队角色：J1（SS 合约域）/ J2（probe + builder + mass 域）/ KANet-UI（单写者 deploy + R6 编译点）/ Bettor（协调 + attack-review）/ NWT（对抗验证 + determinism + 方向守门）。红蓝 = 出码方 vs 独立验证方，**每个发现至少两方独立确认才算数**。

相关文档：设计 spec `docs/2026-06-19-cascade-convert-split-spec.md`；陷阱档案 `docs/ANTI-PATTERNS.md`；silverc 真实能力记忆 `reference-silverscript-real-capabilities`。

---

## 🔴 F1 — CRITICAL：spent-once 票可被 re-mint 击穿（双领/抽池）

**严重度**：CRITICAL（trustless 破 / 池失偿）。三方独立确认（NWT 发现 + J1 code-read 背书 + Bettor code-read 背书）。

### 机制
每个押注者持一张 dust「票」（`PoolSide_v08_shard.sil`），设计意图："票被花掉 = 只能领一次"（spent-once nullifier）。攻击链：
1. 真 winner（payoutRoot 里有自己 leaf `blake2b(pk‖payout)`）用真票正常 claim → 拿 payout P，真票花掉。
2. winner **自己重铸一张假票**：票的 P2SH 地址 = `blake2b(redeem)`，`redeem` = `PoolSide` 编译 + ctor `{bettorPk, direction, stake, shardPoolId}`。这 4 个状态字段**全是押注者自选的** → 他算得出地址、发 dust 进去 = 造出一张状态合法的票 UTXO。
3. 票的唯一花费闸是 `authorize_spend(sig bettorSig)` = 只需 `bettorPk` 的签名。**winner 就是 bettorPk 本人，持私钥** → 签得出 → 花得掉假票。
4. `RootClaim.claim_draw` 只验：`readInputStateWithTemplate(ps_tmpl_hash)`（验**代码模板 hash**，非 provenance）+ `shardPoolId` 匹配 + `direction == winningSide` + merkle（`leaf = blake2b(pk‖payout8)`，**只按 pk+金额索引，不绑票 UTXO 身份**）。同一 leaf 可反复证明。

**后果**：winner 铸任意多假票，每张领一次同一个 P，抽干奖池 = 偷其他 winner 的钱。`RefundClaim` **更糟**：refund 付 `tk.stake`（无 merkle 约束），铸一张 `stake = 整池` 的假票一笔抽干。

### 为什么潜伏至今
- 这是从旧版 `PoolRoot.sil` **verbatim 港来的既存潜在漏洞**，非 cascade 新引入。
- happy-path e2e（每个 winner 只领一次）**从来没触发过双领** → 单跑 settle 必过，证明不了 nullifier 真防双领。**"e2e 跑通"≠"机制安全"**。

### 抓到它的纪律
- **深扎承重假设**：NWT 没停在"RootClaim 引用了 spent-once ticket = R7 满足"，而是去核**那个 spent-once 假设本身在哪个合约、能不能被绕**（跨合约依赖）。
- **verify-not-echo 对自己**：NWT 发现后**先自我 refute 8 个角度**（能不能造票/模板检查抓不抓状态/leaf 有没有 outpoint/票花费有没有额外条件……）全没破，才上报 → 不让全队 fire-drill 一个假警报。
- **default-to-real**：adversarial-verify 模式，疑似漏洞默认"真"直到被 refute，而非默认"应该没事"。
- **NO TX NO TRUTH**：最终裁决 = e2e 跑一个真·双领攻击 case，链上 land=坐实 / bust=有保护。不靠推演定论。

### 修复
- **outpoint-bind 方案被否（见 F2）**。
- **采用 claimed-bitmap**：把 nullifier 从"链下可重造的票 UTXO"搬进**链上不可重造的合约 state**。`RootClaim` 加 `claimed_mask`（领过的 merkle_index 标记掉，再领被 require 挡）。depth-1 = 2 winner（从 depth-2 降，给 bitmap 字节预算让路）。re-mint 没用：同 merkle_index 已标记。

#### 🔴 F1b — bitmap fix 的残洞：index-aliasing 双领（眼审漏、Bettor 抓）

claimed-bitmap **方向对但 v1 实现不完整**，有一个 aliasing 绕过（Bettor 发现，NWT 眼审签了 line-PASS 漏掉 = verify-not-echo-on-self 失败的实例）：
- **根因**：`merkle_index` 只有下界 `require(>=0)`，**无上界**。merkle climb 只消费 `tree_depth` 个低位（depth-1 = 只 bit0 = index%2），但 `mask = 2^merkle_index` 用**完整** index → `merkle_index` 和 `merkle_index + 2^tree_depth` 在 climb 里**别名**（同 proof 同 siblings 验过）却映射到**不同 bitmap slot**。
- **trace（depth-1, winner 真在 index0）**：①claim index=0 → climb bit0=0 proof 验过 → mask=1 → bitmap 0→1。②重铸同票 claim index=2 → climb bit0=(2/1)%2=0 **同 proof 验过** → mask=2^2=4 → (bitmap=1/4)%2=0 ✓ → **又领一次**。可继续 index=4,6… 每个不同 slot → N 领抽干。
- **修复**：climb 后 `div == 2^tree_depth`（climb 循环已累乘），加一句 `require(merkle_index < div)` = 把 index 绑到树的合法范围，高位 alias 全拒（~几字节，复用 div 无需新 loop）。**这一并修了 aliasing + mask 溢出**（无界 index 是同根；但注意：单 i64 bitmap 在 depth-8/256-winner 仍 `2^index` 溢出 → post-DoD winner-tree-shard 必须换 byte[] 位图/per-shard nullifier，range-check 只对 DoD 小 depth 够）。
- **META 教训**：这**正印证**"代码审 PASS ≠ DoD，链上攻击 case 才是终裁"——眼审签 PASS 漏了 aliasing，但 fix 后的攻击 case（试 index=0 然后 index=2）会立刻 LAND 暴露它。**攻击 case 必须枚举 aliasing 变体**（同 winner 试 index, index+2^depth, …），不只试"同 index 重领"。DoD 闸 = **变体 A（同 index 重领）+ 变体 B（aliasing index=2）双双 fix 前 LAND / fix 后 BUST**。NO TX NO TRUTH 的价值就在这：它逮得到眼审漏的。

#### ✅ F1 OUTCOME — R7 链上闭环（2026-06-20，4-result 多方独立强验）

R7 双领 fix 链上实堵，**四发结果矩阵全部多方独立强验**（NWT + Bettor 各自从自己 :3200 跑 check_utxo_landed + 读 console.log，非 echo）：

| 变体 | 修复前（漏洞在）LAND | 修复后（2435f041）BUST |
|---|---|---|
| **A** 同 index 重铸 | 05da9cdd → `d4d75c65` check_utxo_landed=**true**（双领成功） | `53c39f60` log=**Rejected** script verification failed |
| **B** aliasing index=2 | 61817fc7 → `204fd603` check_utxo_landed=**true**（双领成功） | `0d95fe09` log=**Rejected** |

**归因隔离**：A 前/后只差 claimed-bitmap → bitmap 是挡 re-mint 的因；B 前/后只差 `require(merkle_index<div)` → range-check 是挡 aliasing 的因。同结构对照排除"别的 require 误挡"假阳性。

**永久教材（Owner + Bettor 锁）**：**安全 fix 的 review-PASS ≠ 实堵；链上 teeth（pre-fix LAND + post-fix BUST 同结构对照）才是真裁。** 眼审会漏（本案 NWT 眼审签 PASS 漏 aliasing，Bettor 红队抓出）；live-e2e/对抗验不可替代。**强弱证据要分清**：console.log 只记失败（带 txid），成功落链不在 log → LAND 必须 check_utxo_landed 地址正验，绝不凭"没被拒"的弱证据签。

> ⚠ **R7 closed ≠ 完整 cascade DoD**：SIZE/attack 用的是直接 funded 隔离 genesis（证零件各自对），不是 seal 真产的一条龙。完整 DoD 要 register→fold→seal→RootClose→close_commit→convert→claim 一个真市场全 phase 串通一次（spec §0）+ refund gate-off② 链上证。**零件全绿≠机制跑通。**
### 🔴 PRODUCTION 硬前置（DoD 过了也别丢 — Bettor + NWT 锁）

refund 的 gate-off（不修 RefundClaim、靠 closed-XOR 结构性不可达）**只对受控 DoD settle 成立**。原因：gate② 的 binding 前提 = `close_commit`（closed 0→1）**赢** `refund_flip`（closed 0→2，且 `require(tx.time >= deadline + 7200000)` = deadline+2h grace）的 race。受控 DoD 脚本保证 close 在 grace 内 fire → closed 锁 1 → refund_flip 永挡 → `convert_to_refundclaim`(closed==2) 结构不可达 → RefundClaim 攻击面从不被创建。

**但任何 production / 非受控市场上线前，refund-merkle fix（close/cancel 时委员 commit 全 bettor+stake 的 merkle + claimed-bitmap）必须先落** —— 那里 close 不保证及时，若某市场 grace 过了还没 close（被弃）→ refund_flip 可动 → closed→2 → refund 攻击面变活（铸 `stake=整池` 假票一笔抽干）。

威胁模型补充（Bettor）：真威胁 = **手搓 raw tx 的重铸攻击者**（绕 relay handler）。所以 ①UI 不集成 refund handler + ③不部署 = **defense-in-depth，不是安全边界**（攻击者手搓不经 handler）。**唯一真闸 = ② covenant 链上强制 closed==2 不可达**（= R1 closed-XOR latch，已行级审 SOLID，一物两用：既防 F2 insolvency 又结构性 gate-off 未修的 refund）。链上坐实 ② = closed=1 后手搓一笔 `convert_to_refundclaim` 实测 fail（require closed==2 不满足），NWT 独立 co-verify = NO TX NO TRUTH 证 gate 真在、非嘴上说的。

---

## 🟡 F2 — outpoint-bind 修复不可行（silverc 无 input-outpoint 自省原语）

**类型**：fix 可行性闸（"别建到一半发现做不了"）。NWT 查文档 + J1 compile 双向确认。

J1 第一反应修法："merkle leaf = `blake2b(pk‖payout‖register_ticket_outpoint)`，claim 验被花票的 outpoint == leaf 里的"。**但**：
- NWT 查 silverc `DECL.md` + `TUTORIAL.md`：输入自省**只有** `tx.inputs[i].value` + `tx.inputs[i].scriptPubKey` + `readInputState(WithTemplate)` + `OpCov*/OpAuth*` 族，**没有 outpoint/txid/prevout 原语**。
- J1 compile 实证：`tx.inputs[i].previousOutpoint/transactionId` → silverc 编译报错 `field access not supported`。
- 而且 re-mint 克隆票 **scriptPubKey 一模一样**（同 ctor → 同 redeem → 同 P2SH）→ scriptPubKey 也不能当判别符。

→ outpoint-bind fix **编译不出来**，确定死。**教训（CLAUDE.md 铁律）**：写链上前必查 silverc 官方文档/compile 确认原语真存在，别凭印象设计 fix。

---

## F3 — 设计阶段红蓝对抗发现（cascade spec v1→v3）

cascade spec 落码前的对抗审，每条都在"落码前"拦下，省返工：

| # | 发现 | 类型 | 抓到的纪律 |
|---|---|---|---|
| **缺口1** | R2 bridge forge 不对称：spec 只要求 `convert→RootClaim` 桥全字段约束，但 `seal→RootClose` 桥有**一样的 forge 面**（4 个 account 字段若不列 → sealer 伪造 pool_value 抬高自己 payout） | covenant new_states 部分字段约束 = forge 缺口 | 对称性检查：一个桥要的约束，所有同类桥都要 |
| **缺口2** | spec 的 RootClaim 描述**漏了 dust-ticket spent-once 消费** → 自然引出 F1 的深挖 | nullifier 必须显式 | 实读 PoolRoot 现版怎么防双领，不假设 |
| **close 两揭** | close_commit 原设计在一个 tx 内 spend RootClose + bridge RootClaim = 两 reveal ≈ 14960u BUST | SIZE 承重 | J2 probe-not-model：拆成 close-self + 独立 convert，每步单揭 |
| **§51 非法 fallback** | spec 文档 §51 写"RootClose 撞墙则 refund 拆出去"，但这破 closed-XOR（F2 insolvency）——**同一 spec 自打架** | 文档内部矛盾 | 文档 vs 频道：落码人读文档，channel 说了不算，必改文档字面 |
| **convert-out 逃生门不存在** | J2 提的 fallback"拆 convert 出去降 RootClose 2-entry"机制不成立——convert 必须花 RootClose 才能 bridge，**必然是 RootClose 的 entry** | 假逃生门 | 质疑逃生门是否真存在，别乐观依赖 |
| **"7u crossing" 误读** | 全队（含 Bettor）一度把 `used=10006` 读成"只差 7u 微调就过"。真相：`used=N` 是 double-blake2b **中途**触限的中断点、**非单调**（更小合约 1189B 反而 used=12354 **更高**） | 测量语义误读 | J2 verify-not-echo 拦下；binary-search land/bust 干净裁决取代不可信外推 |

**SIZE 墙最终解**：committee_hash lever（baked 单 hash 替 5 pubkey，witness 必 hash-match 保 R8 provenance，省 ~128B）→ recursive-split 三件 `RootClose 839B / RootClaim 855B / RefundClaim 612B` 全链上 probe PASS（多 vantage 独立 co-verify）。

---

## 🎉 Cascade DoD 闭环（2026-06-20，full-stitch 端到端 + 全队四方验）

单小市场全 6-phase cascade settle **端到端单 run 链上跑通**（每 phase 经 `kaspa_tx_log` block-accepted）。canonical run 6 笔 **tx_id**（artifact 文件钉死）→ 各自落入的 **block_hash**：

| phase | tx_id | 落入 block_hash |
|---|---|---|
| genesis (ShardLeaf_direct) | `4b4929e4` | `18032a05` |
| register_append | `cedcb7fb` | `c8765994` |
| convert→RootClose | `77225f26` | `82f05b8f` |
| 委员 close_commit | `eb6e2937` | `2704aa61` |
| convert→RootClaim | `452fc8fb` | `45ab126c` |
| claim_draw | `389d8715` | `0fb4c1e8` |

> ⚠ **左列=tx_id（交易本身），右列=含该 tx 的 block_hash（区块）** —— 显式标清正是因为 F-tail #5 那条就是把 block_hash 误读成 tx_id 的实例。别混。

**达成的 DoD 维度**：
- ✅ **机制**：6-phase 端到端 block-accepted（spec §0 单市场全 cascade settle 一次）
- ✅ **R7 双领 CLOSED**：4-result 正负 teeth（见 F1 OUTCOME）
- ✅ **委员门 load-bearing（两维度 teeth 齐，R7 级正+负对照）**：
  - (a) **pubkey-binding**：blake2b(5 witness pubkey)==genesis committee_hash 多方本机重算 MATCH + 负测 swap-1-pubkey close → BUST（txid `170dc2c4`，"verification failed"，多 vantage log 读）= 证 committee_hash 门挡（攻击者换 pubkey 不行）
  - (b) **sig-threshold**：positive=5 正确 pubkey + 4 真 sig → LAND；负测=同 close 但只 3 真 sig + 2 OP_0（pubkey 全对、只 sig 数不足）→ BUST（txid `f5c3497a`，"verification failed"，NWT/Bettor/UI 三方 log 验）= 证 `require(validSigs>=4)` 阈值挡（degenerate 接受 <4 不行）。与 (a) 正交：(a) 证 hash 维度、(b) 证阈值维度。
- ✅ **skip-fold SIZE**：register 505B(ShardLeaf_direct monolithic)/convert→RootClose 851B 链上 probe PASS
- ✅ **refund gate-off②**：convert_to_refundclaim 在 closed==1 → BUST（多方 log）

**重要方法论收获（NWT/UI 同时踩+纠）**：**完成的 cascade 上跑 `check_utxo_landed` 全返 false ≠ non-landing** —— cascade 每步输出被下一步花掉（genesis→register 花→convert 花→…→claim），现在查全是 spent → 不在当前 UTXO 集。**验完成链的 landing 必用 `kaspa_tx_log.tx_id` block-accepted 查（历史落块），或 per-step at-the-time check（花掉前）**，不能用 live-tip 的 check_utxo_landed 事后整查。这是"verify-not-echo 也要 verify 自己的查询【方法】"——继 partial-txid 假阴之后第二次同类教训。

**skip-fold 设计**（STEP1 convert_to_foldnode SIZE 墙的解）：单 shard（shardCount=1）无 fold 可做，FoldNode 的 fold covenant 是 dead code → **ShardLeaf_direct**（register + 直 convert→RootClose，跳 FoldNode 1242B WithTemplate 墙）。retarget 现有 convert entry（4-field FoldNode new_state → 7-field RootClose canonical-open）比加 seal entry 净（不撑大 register 的 monolithic reveal 险）。register on 507B ShardLeaf_direct probe PASS = +56B modest 增不撞 9999。

### 📋 Tracked post-DoD 完整性 follow-up（非 blocker，记此防丢）

1. ~~**委员门 4-of-5 阈值 negative teeth**~~ → ✅ **DONE（2026-06-20）**：3-sig（c0/c1/c2 真签 + c3/c4 OP_0）→ BUST（txid `f5c3497a`，validSigs=3<4，三方 log 验）。委员门两维度 teeth 齐（见上"委员门 load-bearing"）。
2. **refund-merkle fix**：production/非受控市场上线前必落（见 F1 PRODUCTION 硬前置）。J1 出 SPEC（spec 定稿非全建；refund 非 blocker、全建是大工程、covenant-lineage 可能超越它）。
3. **multi-shard fold**：shardCount>1 需 FoldNode 聚合（DoD 是单 shard skip-fold）。
4. **单 i64 claimed-bitmap 上限 ~63 winner**：winner-tree-shard（§7 scale）需换 byte[] 位图（见 F1b）。
5. ~~**DoD 记录 provenance：多 run 残留**~~ —— **撤回，这是 NWT 的 misread**：把 block_hash 当成了不同的 tx_id（UI kaspa_tx_log join 证 tx eb6e2937 落在 block 2704aa61 = 同一 run）。provenance 本就干净、单一 canonical run。教训：`tx_id` vs `block_hash` 别混 —— verify-not-echo 对自己的【读取】也要较真（本会话第三次同类自纠：partial-txid 假阴 → check_utxo_landed 完成链方法 → tx_id/block_hash 混淆）。核 provenance 的本能对，具体读错了。

---

## 方法论总纲（为什么红蓝对抗抓得到）

1. **probe-not-model**：SIZE/spend-units 禁估算，链上 land/bust 干净裁决。2 锚拟合 = underdetermined，造 controlled probe 实测。
2. **verify-not-echo（对自己也是）**：发现先自我 refute 多角度，过了才上报；签字前实读实际 code 非凭理解 canonical。
3. **NO TX NO TRUTH**：安全断言最终靠链上攻击 case 裁决（happy-path 证明不了安全）。
4. **每个 require(X==Y) 必问 Y 哪来的**：witness/entry param = spender 可控 = 可伪造；必 cov-derived / chain-anchored / maker-signed。
5. **covenant new_states 全字段必列**：未列字段 = FREE = 可伪造。
6. **写链上前查 silverc 真原语**：DECL.md + TUTORIAL.md + compile 实证，别凭印象判定能/不能。
7. **多方独立确认**：出码方 + 独立验证方各自 code-read / probe / log-read，至少两方对上才落定。
8. **verify-not-echo 也要 verify 自己的查询【输入 + 方法 + 读取】**：独立验证者本身会用错工具/读错数，把假象当 finding。本会话 NWT 三次同类自纠（都干脆认账、撤回、记档）：
   - **截断 txid 假阴**：用 22-hex（非全 64）查 `check_utxo_landed` → `landed:false` 是查询假象，非 non-landing。
   - **check_utxo_landed 查完成链**：完成的 cascade 每步输出被下一步合法花掉 → 事后查 live-tip UTXO 全 `false` = 方法假象。右验法 = `kaspa_tx_log.tx_id` block-accepted 查（历史落块）/ per-step at-the-time check（花掉前）。
   - **tx_id vs block_hash 混淆**：把"包含 tx 的 block_hash"误读成"不同的 tx_id"→ 开了个假的 provenance 🔴（实为单一 canonical run）。
   核 provenance/同-run 的**本能对**（该核），但读错了具体值就是假警 —— 独立验证者对自己同样苛刻，才不污染信号。
9. **多层对抗审：连"对抗审者"也要被审 + "知道原则 ≠ 自动套用"**：refund-merkle SPEC 经四方验（含 NWT/Bettor adversarial review）签 SOLID，但**外部 claude.ai Architect 红队回审抓到 2 个我们漏的 🔴**：
   - **F-refund-1**（amount-weld）：refundRoot 的 merkle membership 只证 "leaf 在集"，不证 "集里那个 stake 金额是真锁仓的" → register 时 `leaf.stake` 必 weld 实际锁仓 value（`Σleaf.stake == pool_value`），否则虚高 stake 的 genuine leaf 超额退 = 盗池。
   - **F-refund-2**：leaf 排序用"到达序"非 pk-ASC（确定性）。
   - **教训核心**：NWT **恰好 championed 过 amount-binding**（#31 settle-chunk：leaf 必绑 amount 非只 pk），却**没把它 transfer 到 refund 域** = "知道一个原则" 不等于 "在新 context 自动想起来用它"。**对策**：把反复出现的承重模式固化成 checklist（如"任何 merkle-membership 设计必问：金额绑了没？排序确定吗？"），别靠临场想起。
   - **元元教训**：四方独立对抗审仍有共同盲区（大家都盯机制/forge，没盯 amount-weld）→ **多一层外部/异质红队**抓得到同质团队的集体盲点。红蓝对抗是分层的，越多正交视角越好。

---

**状态：FINAL（2026-06-20）** —— cascade DoD 闭环 + 委员门两维度 teeth 齐 + R7 双领 CLOSED + skip-fold + refund gate②，全多方独立验，已报 Owner。post-DoD tail：refund-merkle 全建 / multi-shard fold / i64-bitmap winner cap（见 Tracked follow-up）。

*维护：撞到新的承重发现 → 即追加一条（机制 + 为什么潜伏 + 抓到的纪律 + 修复）。这是活档案。*
