# ZK 结算 genesis-mint 管线设计 v2 — PayoutShardV2 + zk_handoff

**作者**: J2 · **日期**: 2026-07-07 · **Status**: DRAFT v2(取代 v1 的"中途迁移已attest市场"方案，已被 NWT+Bettor+J2 三方独立坐实为原理性死路——PayoutShard.sil 五个 entrypoint 没有一个允许把全池 value 输出到异族 covenant）。待 NWT 四层验收 + J1 relay 侧确认。

**背景**: Owner 拍板"ZK 走到底，这个架构才有未来"。团队对抗讨论收敛：今天目标改为 **ZK-native 新市场**（不是迁移存量已在 committee-sig 路径里的市场——那条路径原理性走不通，存量市场维持 committee-sig 不变，跟 Owner 已拍的准入政策一致，不是损失）。

---

## 0. 为什么是这个方案（对抗讨论收敛记录，供 Owner/后续接位一眼看懂决策脉络）

**排除的方案**:
- **"中途迁移已attest市场"**：PayoutShard.sil 全部 5 个 entrypoint（absorb/close_attest/cancel_attest/claim/refund_claim）逐条读完——claim/refund_claim 输出硬锁定到 merkle 证明过的特定 bettor 地址；其余三个只续自己（同 cov_id）。没有任何路径能把整个 `consolidated_pool` 一次性交给异族 covenant。且 covenant 是 state-in-address，已经 genesis-mint 过的市场 redeemScript 创建那一刻就定死，改源码也救不了任何现存盘。**结论 NO，原理性死路**。
- **"CloseZk 自带 absorb+attest"（原 b 案）**：需要新增 `ShardLeaf.sil` 的 `consolidate_to_zk` entry + 把 CloseZkRepro4 的 ctor 字段（attestedWinner 等）改成 mutable state + 复制 PayoutShard.sil `close_attest` 的完整 4-of-5 委员门限签名+merkle membership 逻辑（约 100 行，全系统最复杂的安全机制之一）。新代码面数倍于下面的方案，且touch 了全市场共用的活模板 `ShardLeaf.sil`。

**采用的方案（PayoutShardV2 + zk_handoff）**:
- `ShardLeaf.sil` **零改动**——J2 源码级verify（`consolidate_to_payout` 85-107 行）：唯一约束是 `OpInputCovenantId`/`OpOutputCovenantId` 的 cov_id 身份匹配 + value 算术，**不 byte-decode 对面 redeem/state 任何字段，对目标是什么 bytecode 完全不透明**。cov_id 公式 `f(genesis_outpoint, output)`（memory `reference-covenant-cov_id-genesis-mechanism`）是 instance-unique、跟 bytecode 类型无关的 opaque 值——只要新市场的 ShardLeaf 从 genesis 起就把 `payout_cov_id` 烤成 `PayoutShardV2` 实例的 cov_id，`consolidate_to_payout` 原样能用，零修改。
- `CloseZkRepro4` **零改动**——昨晚全链验证过的字节码原样复用。
- 新建 `PayoutShardV2.sil`：**PayoutShard.sil 完整复制 + 两处增量**（absorb/close_attest 核心签名逻辑/claim/refund_claim/cancel_attest 全部 REGRESSION-safe 不动，同 CloseZkRepro3→4 的纪律）：
  1. `close_attest` 的 state 里多存 `attestedWinner`(int) + `attestedAtMs`(int)（本设计 §2 的开放点，(i)/(ii) 见下）。
  2. 新增 `zk_handoff` entrypoint（§3）。
- 代价：多一跳 handoff 交易（手续费 + 一次广播），换来两个已验证合约（`ShardLeaf.sil`/`CloseZkRepro4`）零改动、新代码面全部集中在一个新文件（不碰任何 live 合约，D-005 合规）。

---

## 1. 既有资产清单（不重造）

| 需要的东西 | 复用来源 |
|---|---|
| PayoutShard 完整机制（absorb/close_attest 委员多签/claim/refund_claim/cancel_attest） | `PayoutShard.sil` 全文件复制为起点，955 赢家验证过的原逻辑 |
| shard 归集 | `consolidateAllShards()`（`pool-shard-settle.mjs:279`），零改动，市场创建时把 target 指向 `PayoutShardV2` 实例即可 |
| 委员判定胜负 | `judgeWinDir(market)`（`bshard-settle-daemon.mjs:97`） |
| betsRoot（hash-chain） | `gatherOrderedBets()`（`zk-close-builder.mjs:77`） |
| refundRoot（depth-10 merkle，喂 `{pk,amount:stake}`） | `payoutLeaf`/`payoutRoot`（`pool-payout-root.mjs:39,84`） |
| CloseZkRepro4 ctor 字段/顺序 | `_j2_closezk_repro4.sil:20-46`（昨晚验证版本，零改动） |

---

## 2. PayoutShardV2 diff（相对 PayoutShard.sil）

### 2.1 State 增量（🔴 v2.1 修正：补 Bettor 洞①的 ctor 锚字段）

```
// ctor 新增(1个): closeZkTmplAnchor —— CloseZkRepro4 编译产物模板(prefix+suffix, 挖掉运行时才知道的
// state值插入点)的blake2b锚hash。囤这个而不是把几百字节的模板bytes直接inline进V2 ctor,是因为模板bytes
// 大(hole③预警"witness还要带~800B级prefix/suffix"),inline会吃mass预算;32字节锚hash便宜,真正的大
// bytes在zk_handoff调用时由witness供,靠锚hash验真伪(同escapeRefund gateTmplHash手法,zk_close entry
// 已经在用同一模式,非新发明)。
byte[32] closeZkTmplAnchor,   // ctor param(genesis烤,不可变)

// state(非ctor,由close_attest扩展写入——见§2.2):
int attestedWinner = -1;        // -1=待attest, 0=YES, 1=NO
int attestedAtMs = 0;           // 0=待attest；改名Ms非Seconds(见§2.2)，witness供，跟其余committee-attested字段同信任模型
byte[32] betsRootBaked = ZERO32;
byte[32] refundRootBaked = ZERO32;
```

### 2.2 close_attest 扩展（**唯一可行方案** — attestedAtMs 必须 witness 供，self-read tx.time 经实测证实不可行）

**🔴 实测更正（2026-07-07 22:1x，J2 用当前 fixed silverc 直接编译验证，非假设）**：`tx.time` 在当前 parser 下**唯一合法用法是孤立句式 `require(tx.time >= <expr>);`**——不能赋值给变量、不能用于 `validateOutputState`、不能配 `==`、不能出现在复合/算术表达式里（4 组独立 probe 全部同一个 parse error，跟 `ShardLeaf.sil` 注释早警告的 `da9fc22 parser` 限制完全吻合）。**"self-read tx.time" 技术上不可行，不是设计选择，是语言限制**。

**唯一可行形态**：`attestedAtMs`（存毫秒，省一次除法，避免 ms/s 单位歧义）跟 `new_payoutRoot`/`new_betsRoot`/`new_refundRoot` 一样，**witness 供 + committee 5 签 sighash 覆盖**。**这不是信任降级**——`new_payoutRoot` 等三个值本来就完全依赖 committee 多签背书（committee 身份本身靠链上 `poolMerkleRoot` merkle 证明锚定，非外部证书），`attestedAtMs` 走同一路径是一致的信任模型，不是额外弱化。NWT 已确认此修法 GREEN。

在原有 `new_payoutRoot`（committee 5 签 sighash 覆盖）基础上，追加 **`new_attestedWinner`(int) / `new_betsRoot`(byte32) / `new_refundRoot`(byte32) / `new_attestedAtMs`(int)**，一并进 committee 签名的 sighash 覆盖范围。

```
entrypoint function close_attest(
    int      selfOutIdx,
    byte[32] new_payoutRoot,
    int      new_attestedWinner,      // 新增
    byte[32] new_betsRoot,            // 新增
    byte[32] new_refundRoot,          // 新增
    int      new_attestedAtMs,        // 新增, witness供(非self-read, 见上实测结论)
    sig c0Sig, sig c1Sig, sig c2Sig, sig c3Sig, sig c4Sig,
    ... // 委员 pubkey/merkle proof 参数全部不变,一字不动(NWT 审核重点:门限签名/pairwise distinctness/depth-8 merkle membership 逻辑原样复制,零简化)
) {
    require(closed == 0);
    ... // ①②③ 委员验证逻辑一字不动
    validateOutputState(selfOutIdx, {
        consolidated_pool: consolidated_pool,
        closed: 1,
        payoutRoot: new_payoutRoot,
        attestedWinner: new_attestedWinner,   // 新增透传
        attestedAtMs: new_attestedAtMs,       // 新增透传, witness供
        betsRootBaked: new_betsRoot,          // 新增透传
        refundRootBaked: new_refundRoot,      // 新增透传
        w0..w16: 不变
    });
}
```

**NWT 补充③（防御性好消息，非阻塞）**：若委员 close_attest 时算错了 `betsRoot`（bug/失误），不会被静默接受——`zk_close` 既有的 C1 predict-then-verify 会在下游拦住（J2 独立算的 gather betsRoot 跟 baked 值对不上就 abort）。这条防线已经存在，不需要为此新造机制。

**(ii) 显式退路（仅当 (i) 的委员签名工具链改造超出今天时间预算才启用，不能悄悄降级）**: `attestedWinner`/`betsRootBaked`/`refundRootBaked` 改为 driver-side（genesis-mint 脚本/操作者）直接算好传入 `zk_handoff` 的 witness，**不经过 committee 签名验证**——这三个值退化成"driver 说了算，链上不校验来源"。若启用，必须：①在 COORD-LEDGER/DECISIONS.md 显式记录"这次 demo 的 attestedWinner 来源信任级别低于 committee-sig 市场"，②Owner 知情同意这个信任降级，③留一条后续工单升级到 (i)。**不允许不声明就用 (ii)**。

**🔴 诚实口径提醒（NWT 补充④，报数时必须写清楚）**：`refundRootBaked` 只服务 `escape_claim`，今天 `escape` entrypoint 不上生产（fail-closed）——意味着今天的 demonstrate **验证不到 refundRoot 算对没算对**。报数不能说"全部字段验证过"，要明确写"betsRoot/attestedWinner 经 C1 链上验证，refundRootBaked 未经今天流程验证，留给 escape 上生产那天"。

### 2.3 新增 `zk_handoff` entrypoint（🔴 v2.1 修正：补锚定检查，修 Bettor 洞①）

```
entrypoint function zk_handoff(
    int      selfOutIdx,             // = CloseZkRepro4 genesis 的 output index
    byte[]   closeZkPrefixWitness,    // CloseZk 编译模板的固定前缀段(witness喂,大, 用锚hash验真伪)
    byte[]   closeZkSuffixWitness,    // CloseZk 编译模板的固定后缀段(同上)
    byte[]   feeInputWitness          // NWT补充②: 独立fee input, 不从consolidated_pool扣(见下)
) {
    require(closed == 1);   // 必须已委员attest过
    // 🔒 锚定检查(修洞①): witness喂的prefix/suffix必须匹配ctor烤死的模板锚——没有这一步,
    // caller能自由构造任意"CloseZk模板"(带后门redeem)通过下面的重构检查卷走全池,这是跟
    // 昨晚w0in CRITICAL bug同一个class的漏洞(caller-suppliable数据未经绑定检查)。
    require(blake2b(closeZkPrefixWitness + closeZkSuffixWitness) == closeZkTmplAnchor);
    // 用锚定过的prefix/suffix + 本合约state值(attestedWinner/betsRootBaked/refundRootBaked/
    // attestedAtMs/consolidated_pool/17个全0 nullifier word/init_payoutRootField=ZERO32占位——
    // NWT补充①: 这个占位值必须跟真实genesis-mint产出的CloseZk redeem byte-exact一致,不能各算各的)
    // 拼出完整CloseZkRepro4 genesis redeem, 再hash算目标P2SH地址。
    byte[32] expectedCloseZkRedeemHash = blake2b(closeZkPrefixWitness + <state值序列化拼接> + closeZkSuffixWitness);
    require(tx.outputs[selfOutIdx].scriptPubKey == new ScriptPubKeyP2SH(expectedCloseZkRedeemHash));
    require(tx.outputs[selfOutIdx].value == consolidated_pool);   // ★ 守恒: 全池一次性交接, 不留PayoutShardV2续约output
    // 无 validateOutputState —— 本 entry 是 PayoutShardV2 生命周期终点(同 escape_claim 的 last-claimant 分支手法,
    // UTXO 花过即不存在,零 double-invoke 风险,NWT 已确认此模式)。
}
```

**⚠ 精确的字节级 splice 逻辑（prefix/suffix 分割点、state 值如何序列化插入）留到实际 `.sil` diff 阶段用既有 canonical-pipeline splice 工具核对**（同 `shard_redeem_hex`/`spliceLeafState` 的既有模式，非新发明——见 COORD-LEDGER "已沉的可复用资产"节）。本节先钉死机制骨架（锚定+重构+P2SH校验），落码时字节级细节仍需 NWT 逐字节核对。

**NWT 补充②（relay 侧，J1 需知晓）**：`zk_handoff` 的 tx 需要一个独立 fee input（不能从 `consolidated_pool` 扣），同昨晚 escapeRefund 手法——relay 组装时要显式带这个 input，不是自动的。

**🔴 修正（Bettor 拍板，取代下面已划掉的"操作纪律"提案——这不是演示纯度问题，是真实的分配数学错配）**:

~~J2 原提案：不加新 ctor flag，操作纪律约定不调用 claim/refund_claim。~~ **这个提案错了，已撤回**：若赢家在 `zk_handoff` 广播前，走 V1 遗留的 `claim` 领走自己一份，`CloseZkRepro4` 的 guest proof 仍按**全量原始 bets** 算 `payoutRoot`（无法动态感知"某笔已经被 V1 claim 领走"），但实际到手的 `consolidated_pool` 已经缩水——`zk_close` 落链后按原 `payoutRoot` 放出的支付总额会超过 `consolidated_pool` 实际剩余，**排在后面的赢家分不到钱，市场坏死**。这是跟 `settleMarketLive`"没赔完标 completed"同族的双路径分配数学错配，不是"演示不干净但钱没事"，必须结构性堵死。

**拍板（结构性，非 flag 门）**:
1. **`claim` entrypoint 从 `PayoutShardV2.sil` 源码里整个物理删除**——不是加一个 flag 挡住，是这个 entry 根本不存在。ZK-native 市场的赢家支付路径 = `CloseZkRepro4` 独占，`PayoutShardV2` 上没有第二条领钱路径。
2. **`refund_claim` 保留**，但要核实其 precondition 精确限定在 `closed==2`（cancel 路径）——市场取消走这条老退款路径，不经过 ZK，这条不能删，否则被取消的盘没有退路。`closed` 是 write-once（0→1 XOR 0→2），`refund_claim`(closed==2) 与 `zk_handoff`(closed==1) 对同一个 UTXO **互斥，不会同时生效**。
3. **claim 删除的连带核查（diff 时逐条走）**：
   - **entry selector 重编号安全**：`claim` 被删除 + `zk_handoff` 被新增，dispatch/selector 逻辑会变——虽然 `PayoutShardV2.sil` 是全新文件全新编译，理论上没有旧 entry 顺序遗留问题，但按 memory `feedback-ss-entry-reorder-breaks-handler-selector` 的教训，**不默认"新文件天然安全"，必须显式验证**编译产物的 selector dispatch 正确路由到每个剩余/新增 entry。
   - **确认 `absorb`/`close_attest`/`cancel_attest` 零引用 `claim` 内部逻辑**（`claim` 只在自己的函数体内使用 merkle proof/nullifier bitmap 那套，其余三个 entry 不应该有任何调用/依赖关系——需要 diff 时逐行确认删除 `claim` 不会破坏其余 entry 的编译/行为）。

**zk_handoff 是生命周期终点，无 continuation output** — 已确认同 `escape_claim` 的 last-claimant 分支手法，零 double-invoke 风险（UTXO 花过即消失）。

---

## 3. 管线步骤（更新版，取代 v1 §3）

```
1. 市场创建时(押注开始前): genesis-mint PayoutShardV2 实例(跟今天PayoutShard genesis完全同一套relay流程,
   只是合约文件换V2), init_consolidated_pool=0/closed=0/attestedWinner=-1/attestedAtMs=0/
   betsRootBaked=ZERO32/refundRootBaked=ZERO32。同时把这个实例的cov_id烤进本市场的ShardLeaf ctor
   (payout_cov_id字段)——跟今天market setup流程一致, 只是target合约不同。
2. 押注进行, deadline到, shards通过既有consolidateAllShards()逐步absorb进PayoutShardV2(零改动,
   直接复用, 因为ShardLeaf侧对V1/V2无感知差异)。
3. judgeWinDir(market) 判定胜负(既有委员机制)。
4. gatherOrderedBets()算betsRootHex; payoutRoot(bets.map(pk,stake))算refundRootHex(既有函数)。
5. 委员对V2实例调用扩展版close_attest, 5签sighash覆盖new_payoutRoot+new_attestedWinner+new_betsRoot+
   new_refundRoot——委员judge工具链在原有基础上多算两个哈希, 签名脚本改动量小。closed 0→1。
6. 编译CloseZkRepro4 genesis(用刚attest的attestedWinner/betsRootBaked/refundRootBaked/attestedAtMs
   + consolidated_pool + 17个全0 nullifier word), 算出目标redeem hash。
7. 调用PayoutShardV2的zk_handoff, 一次性把全部consolidated_pool转给这个CloseZkRepro4 genesis output。
   NO TX NO STATE: 广播后checkLanded确认, LAND后才写market.metadata.zk_continuation + 转zk_ready。
8. 后续走已验证的zkCloseTick→zkClosePhase2→(J1 relay handler)→zk_close, 昨晚全链验证过的流程,
   attestedWinner从metadata companion字段直读(缺口B处置, 见下)。
```

---

## 4. `zk_continuation` metadata schema（不变，J1 接口契约）

```jsonc
{
  "outpoint": { "txid": "<zk_handoff tx 的 txid>", "index": 0 },
  "redeemHex": "<CloseZkRepro4 genesis 完整 redeem hex>",
  "valueSompi": "<== consolidatedPool>",
  "attestedWinner": 0,
  "attestedAtMs": 1234567890,
  "mintedAt": "2026-07-07T...",
  "sourceCloseAttestTxid": "<PayoutShardV2 close_attest 落链 txid>",
  "sourceZkHandoffTxid": "<同 outpoint.txid, 冗余记录方便排查>"
}
```

---

## 5. 缺口B处置（不变）

`zk-close-builder.mjs:152-169`(`readAttestedWinnerFromState`) + `_PSZK` 常量整体删除，`zkClosePhase2:188` 改读 `cont.attestedWinner`。

---

## 6. 资金流与守恒（更新版）

```
真实押注(shards) → consolidateAllShards()[零改动] → PayoutShardV2 UTXO(consolidated_pool=Σstake)
   → close_attest扩展版[委员5签, 新增betsRoot/refundRoot commit] → closed=1, 全部attest值锁入state
   → zk_handoff[新entry] → CloseZkRepro4 genesis UTXO(value == 同一个consolidated_pool, byte-exact)
```

守恒断言：`zk_handoff` tx 的 `output[CloseZkGenesis].value == PayoutShardV2 UTXO 花费前的 value == consolidated_pool`（§3 步骤2 只算一次，无重复计算风险）。

---

## 7. 剩余开放问题

1. **J1 确认**：relay 侧需要新增两个命令——`zk_handoff` 组装（读 PayoutShardV2 state 重构目标 CloseZk redeem hash + 组 2-input tx）+ 沿用昨晚验证过的 `unlockBshardZkClose`。
2. **NWT 四层验收**：`close_attest` 扩展 + `zk_handoff` 新逻辑，按 escapeRefund 昨晚同款三连（nullifier/state machine 单向性/守恒weld）+ 四层验收（bounds+符号标签/机制推导diff/non-vacuous binding恒等式/live-node接受）走。
3. **claim/refund_claim 竞态窗口处置**：结构性拍板——`claim` 从 `PayoutShardV2.sil` 物理删除，`refund_claim` 保留（仅 `closed==2` cancel 路径可达，跟 `zk_handoff` 的 `closed==1` 互斥）。见 §2.3 修正节，非操作纪律。
