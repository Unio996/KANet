# ZK 版退款 entrypoint 设计草稿(escapeRefund covenant 层)

**作者**: J2 · **日期**: 2026-07-06 · **Status**: 🎉 隔离链上测试完整通过 —— escape_trigger + escape_claim 两个新 entrypoint 首次真实链上端到端验证成功(v3 实例:genesis mint 2 KAS → escape_trigger closed 1→3 落链 → escape_claim 部分claim,bettor 收 1 KAS + continuation 剩 1 KAS,txId `8c6073ff13a81fe0182a7e5940c4334d4c57209c3c5af13b6642f46fbe0fad13`)。中间过程记录:①escape_trigger 首次广播报 `false stack entry`,同字节重放后 SUBMITTED 成功(J1+NWT+Bettor 判定为瞬时节点/mempool 时序问题,非代码 bug,已记 institutional learning)②escape_claim 首次全额 claim 因 continuation output 精确等于 0 被 Kaspa dust 策略拒绝(证明脚本本身跑通,只是策略层)③改用部分 claim 后暴露真实 bug:**continuation output 必须用『decrement 后的 consolidated_pool + 更新后的 nullifier bitmap』重新计算 P2SH 地址**(这是纯 state-in-address 设计,状态变→地址变),不能照抄输入的 scriptPubKey——修复后 + 调整 KIP-9 mass 参数后完整成功。**NWT 抓出的结构性缺口(§3④,🔴🔴级)——已修复+真实链上验证通过**:池子里排队最后一个 claimant 必然把 consolidated_pool 精确清零,撞同一个 dust 拒绝。修法:`escape_claim` 加 `if (consolidated_pool == stake) { /* 最后一笔,不留 continuation,不调用 validateOutputState */ } else { /* 原有分支不变 */ }`——merkle/nullifier/recipient-bind 三条授权检查在 if/else 之前无条件执行,零豁免(Bettor+NWT 逐行审过)。**v4 实例真实链上验证**:genesis mint → escape_trigger → escape_claim(stake==全部 consolidated_pool)完整成功,txId `3aec5594ae84ca743510b065d4951e14e6fa9e208d8df2e0a054d4a9a4b00e37`,独立核实覆约地址落链后 UTXO 数=0(完全清零,零 dust 拒绝)。**⚠ 关联但独立的更大发现**:生产中的 `PayoutShard.sil`(今晚 955 赢家在跑的活合约)的 `claim`/`refund_claim` entrypoint 是完全相同的无条件模式,同样没有"最后一笔"特殊分支——Bettor+NWT+J2 三方独立读源码确认。这是**潜伏在生产合约里、从未被真实触发过的同款缺口**(未曾撞到是因为 955 个赢家里没人的 payout 精确等于清零前剩余),记为独立、更高优先级的待办,不因 escape_claim 这次修复而"顺带解决"——`PayoutShard.sil` 是已部署的活字节码,任何修复都需要新版本部署/地址迁移这个量级的决策,不在今晚动。· 🔴 escape entrypoint 真实上线仍需 `docs/2026-07-06-zk-close-tick-production-wiring-design.md` §2.6 三前置(出证备份机/卡死告警/GRACE 按最坏重建时长)全部就位

**v3 相对 v2 的改动**: 洞③(J2 自查,写 diff 过程中抓出,非 NWT 找到)——`escape_claim` 原本验证对象 `betsRootBaked` 实为 hash-chain(`pool-payout-root.mjs:57`),没有 membership proof 能力;改用新增 ctor 字段 `refundRootBaked`(genesis-mint 时复用既有 `payoutRoot()` depth-10 merkle 构造烤入)。详见 §2.1 末尾。

**v2 结论(NWT 15:15 + Bettor 已认可,未变)**:§2.1 核心机制(escape_trigger/escape_claim 两阶段拆分 + attestedAtSeconds 锚点)设计层面正确。原先"attested_winner/attestedAtSeconds 这两个字段哪来的"这个更大的架构问题(J1 查证 real `PayoutShard.sil` 没有独立 `attested_winner` scalar,`_PSZK` layout 是从未实现过的理想化 spec)已由 J1 的方案解决:**两者都是 genesis-mint 时 off-chain builder 读观测值烤入 ZK covenant 自己的 ctor**(跟 `init_attestedWinner` 已经在用的模式一致,不碰 `PayoutShard.sil` 一个字节,不需要等"phase1-for-ZK 更大架构问题"解决——那个问题独立记待办,今晚不定案)。v1 的洞记录在 §2.2(留作反面教材)。

**触发**: `zk-close-builder.mjs` 的 `ctx.escapeRefund(market, reason)` hook(见 `docs/2026-07-06-zk-close-tick-production-wiring-design.md` §缺口②)当前是 TODO stub。频道共识(15:48-15:50)确认这**不是适配问题,是新设计**——ZK covenant(`CloseZkRepro3.sil`)只有 `zk_close` 一个 entrypoint,没有退款路径,不能复用委员路的 `cancel_attest`/`refund_claim`(两个 covenant 不同 entrypoint 集合,`zk-close-builder.mjs:181` 注释明写"绝不回委员路"——这是 Bettor 红线,不是随口一说:退款如果走委员签名授权,就等于承认这个"ZK 市场"的资金最终仍由委员信任背书,架空了用 ZK 这条线本身要证明的"每节点独立验证不需要委员"这件事)。

---

## 0. 查资产核查(铁律,先查后设计)

**已查资产(file:line),判定:必须新建,非重造**:

1. **ZK covenant 现状**: `_j2_closezk_repro3.sil`(NWT 八命门审过的测试版)只有 1 个 entrypoint `zk_close`(L17-43)。ctor 字段:`gateTmplHash`/`betsRootBaked`/`init_attestedWinner`/`init_closed`/`init_payoutRootField`。**无退款路径,无 deadline 字段**。
2. **`zk-close-builder.mjs` 里引用的"PS redeem"layout**(`readAttestedWinnerFromState` L146-169,`_PSZK` 常量)包含 `consolidated_pool`/`closed`/`payoutRoot`/`attested_winner` 四个 field——**这个 layout 目前没有对应的 checked-in `.sil` 文件**(`_j2_closezk_repro3.sil` 的 ctor 里没有 `consolidated_pool`)。这是一个**已存在的文档/代码 vs 实际 covenant 不一致的缺口**,不是我这次设计引入的,但会影响 escape_refund 挂在哪个 covenant 上(见 §2 开放问题①)。**如实标注,不假装已经对齐**。
3. **委员路已有的退款机制**(仅供理解 pattern,**不可直接复用**):
   - `PayoutShard.sil`(生产用) L227-389: `cancel_attest`(委员 4-of-5 锁 `refundRoot`,`closed 0→2`)+ `refund_claim`(merkle-claim `leaf=blake2b(pk‖ser(stake,8))` against `refundRoot`,`closed==2` 精确 latch,nullifier bitmap w0-w16 防重复领)。
   - `PoolSpine_v0_7_1.sil` L235-238: `refund_maker_unjoined`,`require(tx.time >= (deadline + 7200) * 1000)`——**deadline-based escape 的既有先例**,ms-epoch,7200s grace 防 front-run(Bettor r388 修过的坑,见 memory `reference-silverscript-txtime-ms-lockfile-threshold`)。
   - **为什么不能直接接到 ZK covenant 上**:①这两个 entrypoint 的资金授权来源是委员 4-of-5 签名(`cancel_attest`)或 taker 未 join 的单边事实(`refund_maker_unjoined`)——ZK covenant 的信任模型是"没有委员,只有 genesis 时烤死的 `betsRootBaked` + 之后的 groth16 proof",混进委员签名授权 = 变相引入了 ZK 本来要去掉的信任面。②不同 covenant = 不同字节码 = 不同地址,物理上不是一个可以"插一个 entrypoint 进去"的对象,是两份完全独立的合约。
4. **既有 deadline 字段**(DB 侧,避免重造 ctor 字段):`pool_markets.deadline_daa`(`migrate.js:4918-4927`,v165,DAA-score,J2 建·NWT+J1 合解)是**唯一权威的市场截止锚点**。**⚠ 单位坑**(CLAUDE.md 铁律"lockTime 域 DAA-score vs ms-epoch"+ 上面 `PoolSpine_v0_7_1.sil` 例子): `deadline_daa` 是 DAA score,covenant 里 `tx.time` 比较的是 ms-epoch——两者不能直接 `==` 或不做换算就 `>=` 比较,这是历史踩过的坑,本设计必须显式处理(见 §2 开放问题②)。

**结论**:escape_refund 是新设计,已确认非重造;但**依赖两个尚未拍板的决策**(covenant 挂载对象、时间锚点单位),不能今晚一次性焊死,以下按草稿呈现,标好开放问题。

---

## 1. 设计目标与非目标

**目标**:给 ZK 结算路径一个**不依赖委员签名、不依赖 groth16 proof**的资金逃生舱——覆盖 `zk-close-builder.mjs` 里两个已知触发场景(0-bet market / overCap market>1024 payout-leaf),以及**任何其他导致 zk_close 永远无法完成的情况**(guest 环境挂了、J1 机器长期不可达、prove 反复失败……)。

**非目标(本轮不做)**:
- 不做 J1 域的 relay handler 实现(跟 `zk_close` 的 `unlockBshardZkClose` 一样,covenant 定案后才轮到 J1 包装 dispatch)。
- 不做 `bshard-settle-daemon.mjs` 里 `escapeRefund` ctx hook 的真实接线(那是 covenant 定案 + NWT/Bettor 批准之后的下一步,现在仍是 TODO stub,如实标注,不提前实现)。
- 不做真实链上测试(covenant 设计本身先定案)。

## 2. 核心设计:deadline-only 逃生舱(非"区分 0-bet/overCap 两种理由")

**关键决策(需 Bettor/NWT 认可,不是我一个人拍板)**:escape_refund 的 on-chain 触发条件建议用**单一的、理由无关的 deadline 逃生舱**,而不是让 covenant 去区分"是 0-bet 还是 overCap"。

**理由**:
- `betsRootBaked` 只是一个 hash,不携带"有几笔注"这个信息,covenant 没法直接 `require` "count==0" 或 "count>1024"(除非 ctor 再烤一个 `betsCountBaked` 字段专门干这事——见开放问题③)。
- 反过来想,covenant 真正需要保证的**不是**"精确知道退款理由",而是"**zk_close 这条路确实走不通了,该把钱还回去**"——这件事最鲁棒的证明就是**时间**:过了 attest 之后的一段宽限期,zk_close 还没发生 → 不管背后是 0 注、爆表、还是 J1 机器炸了,都该放行退款。这也覆盖了"0-bet/overCap"清单**之外**没预料到的失败模式(比今晚已经踩过的"环境阻塞"类问题更鲁棒)。
- 跟 `PoolSpine_v0_7_1.sil` 的 `refund_maker_unjoined` deadline-escape 是**同一个哲学**(§0.3 已引用),不是发明新范式。

### 2.1 entrypoint 骨架 v2(NWT 洞①②修法后,拆两阶段)

**v1 的洞①(HIGH,NWT 16:11 抓出)**:v1 把"一次性 trigger"和"逐 bettor 可重复 claim"焊死进同一个 entrypoint,`postcondition` 直接写 `closed:3`——第一个 bettor 调用成功后 continuation 的 `closed` 就变 3,第二个 bettor 再调同一个 entrypoint,`require(closed==1)` 在已经是 3 的 continuation 上必然 fail。**等于"谁抢到第一笔谁能领,其余 bettor 的钱永久锁死"——比"没有 escape hatch"这个要解决的问题本身还糟**。

**v1 的洞②(HIGH,NWT 16:11 抓出,附活案例)**:v1 用 genesis-mint 时烤死的 `deadline_daa` 换算成 `attestDeadlineSeconds` 作为 grace 窗口起点——但 `deadline_daa` 是市场**最初**的截止时间,在 committee attest(`closed 0→1`)发生**之前**就已经固定。若 attest 本身被拖延(**非假设,活案例**:`ext-pool-v07-1782667323858-bh01w` `created_at=2026-06-28`,到 2026-07-06 卡 `settle_zombie_quarantine` 超 8 天未过 committee),`deadline_daa+ESCAPE_GRACE` 这个窗口在 `closed` 刚翻到 1 的那一刻可能早已过去——escape 一变可调用就立刻能触发,而 `zk_close` 的真实 proving 链路(跨机器 job-queue/RISC0/Docker)根本还没来得及启动,race 必输。**ESCAPE_GRACE 设多大都治不了,因为钟从错的起点开始走**。

**洞③(HIGH,J2 自查抓出,写具体 diff 过程中查 `pool-payout-root.mjs` 时发现,不是 NWT 抓的,主动报再往下写)**:v1/v2 骨架里 `escape_claim` 抄 `refund_claim` 的 merkle 十级折叠(`merkle_index` + 10 个 sibling)验证 `cur == betsRootBaked` ——但 `betsRootBaked` **根本不是 merkle 树**。`pool-payout-root.mjs:57` `computeBetsRoot()` 明确注释"**ORDER-SENSITIVE(hash-CHAIN·非 merkle)**":`fold(acc, blake2b(acc‖leaf))` 从 `ZERO32` 顺序累加整条 bets 序列。hash-chain **没有短 membership proof**——只能验证"这一整条有序序列折叠后等于这个 root",不能像 merkle 树那样给单个 leaf 一条 `O(depth)` 的旁证。`escape_claim` 想让每个 bettor**各自**、**独立**地凭自己的 `(pk,stake)` 证明"我在这批注册里",**必须**是 merkle 树结构,不能直接拿 `betsRootBaked` 当验证根。

**洞③修法**:不改 `betsRootBaked` 的用途(它仍是 `zk_close` 的 journalHash/guest-inputs_commit 锚点,不动)。**额外烤一个 `refundRootBaked` ctor 字段**——genesis-mint 时用**已经在跑的** `payoutRoot()` 风格 merkle 构造(`pool-payout-root.mjs:69-84` `levelsOf`/`payoutRoot`,depth-10,今晚 955 个赢家验证过的同一套函数),喂 `{pk, amount: stake}`(每个 bettor 的原始 stake,不是算过的 payout)算出的 depth-10 merkle root,供 `escape_claim` 做 membership proof。`escape_claim` 的 `merkle_index`+10 siblings + 折叠验证这部分代码现在**可以**照抄 `refund_claim` 了(因为验证对象换成了真正的 merkle 树 `refundRootBaked`,不是 hash-chain 的 `betsRootBaked`)——**这是复用既有 `payoutRoot()` 构造函数,不是发明新密码学**。

**v2 修法(直接复用已验证过的两阶段模式,不是新发明——精确镜像 `cancel_attest`/`refund_claim` 的关系)**:

```
// 挂载对象待定(见开放问题①)——下面先假设挂在跟 zk_close 同一个 covenant 上
// entry (a): escape_trigger — permissionless flag-flip,不碰钱,一次性 closed 1→3
entrypoint function escape_trigger(int selfOutIdx) {
    require(closed == 1);
    // ⚠ 锚点修正(洞②): 不是 genesis-baked deadline_daa,是 attest **实际完成**那一刻的时间戳
    // (attestedAtSeconds,需 phase1/committee-attest entrypoint 在 closed 0→1 时额外烤入,一次性写死不可变)。
    // 待 J1 确认 phase1 entrypoint 现在有没有已经烤这个字段(见 §3 开放问题①,已问 J1,回复未到)。
    require(tx.time >= (attestedAtSeconds + ESCAPE_GRACE) * 1000);
    require(tx.outputs[selfOutIdx].value == consolidated_pool);   // 守恒: trigger 不动资金
    validateOutputState(selfOutIdx, { closed: 3, /* 其余 state 不变(含 consolidated_pool) */ });
}

// entry (b): escape_claim — 逐 bettor 可重复调用,precondition closed==3(不是1),postcondition closed 不变
//   基本是把 refund_claim(PayoutShard.sil L334-390)整段复制过来改字段名,不是重新设计。
//
// 🔴🔴 CRITICAL 修复记录(第二轮架构审·NWT 代码审抓出·本骨架已按 _j2_closezk_repro4.sil 的实际修复更新,
//   不是"仍待验证"的草稿画法——这是本文档 v3→v3.1 唯一实质性改动,其余不变)：
//   下面这版签名【不再】声明 w0in..w16in 这组 witness 参数。原 v3 骨架(此处曾经写的)是
//   `int w0, int w1, /* ... */ int w16` 作为函数参数传入——这是 CRITICAL 漏洞的原始形态：
//   nullifier 检查引用的是 caller 自己在 sigScript 里填的 witness 值(可以永远填 0)，
//   不是 P2SH 真实绑定的顶层 state，导致检查形同虚设、单人可反复 claim 抽干整池。
//   正确形态(已在 repro4.sil 落地并过 NWT 复核 GREEN)：w0..w16 **不作为参数**，直接引用 contract
//   顶层声明的 state 变量(参见 §2.1.1 之前的 ctor/state 声明块，跟 zk_close/escape_trigger 已经在用的
//   引用方式完全一致)。下面骨架直接展示修复后的正确形态：
entrypoint function escape_claim(
    int selfOutIdx, int refundOutIdx,
    byte[32] bettorPk, int stake, int merkle_index,
    byte[32] s0, byte[32] s1, byte[32] s2, byte[32] s3, byte[32] s4,
    byte[32] s5, byte[32] s6, byte[32] s7, byte[32] s8, byte[32] s9   // depth-10 merkle siblings(照抄 refund_claim,这些是合法 witness——旁证不是 state)
    // ★ 注意：w0..w16 不在这个参数列表里——它们是 contract 顶层 state(P2SH 绑定，caller 无法伪造)，
    //   不是这个 entrypoint 的 witness 参数。下面逻辑直接引用顶层的 w0..w16。
) {
    require(closed == 3);                                       // ★ 精确 ==3(不是 !=某值),消歧于 zk_close 的 closed==2
    require(merkle_index >= 0); require(merkle_index < 1024);
    // 洞③修法: 验证对象是 refundRootBaked(genesis-mint 时用既有 payoutRoot() 构造烤的真 merkle 树,
    // 喂 {pk, amount:stake}),不是 betsRootBaked(那是 hash-chain,没法做 membership proof,见洞③)。
    // leaf = blake2b(pk‖ser(stake,8)),折叠到 merkle_index,逐层跟 refund_claim(PayoutShard.sil L343-355)一字不差。
    byte[32] cur = blake2b(byte[](bettorPk) + byte[](stake, 8));
    // ⚠ 这一行是今天 OP_PICK CRITICAL 修复的精确触发模式(2参数动态 byte[](val,size) cast + 赋给局部变量 +
    //   下游10级折叠反复引用)——隔离测试前必须核实编译 repro4 用的 silverc 确实含今天的修复 + 过模拟器
    //   exhaustive PICK bounds 检查，不能只凭"能编译"就当没事(第二轮架构审 16:38 提出，MUST)。
    // ...10 级折叠(s0..s9,逻辑同 PayoutShard.sil L345-354)...
    require(cur == refundRootBaked);                            // ★ 授权来源=genesis 烤死的 merkle root,不需要委员/groth16
    // nullifier 防重复领：**引用 contract 顶层 state 的 w0..w16**(不是 witness)，逐 bettor 各调一次，
    // 状态锚点 stay 在 3；含 require((w_i/mask)%2==0) 先查位未置,再标记的完整 guard。
    require(tx.outputs[refundOutIdx].scriptPubKey == byte[](new ScriptPubKeyP2PK(pubkey(bettorPk))));
    require(tx.outputs[refundOutIdx].value == stake);
    require(tx.outputs[selfOutIdx].value == consolidated_pool - stake);   // ★ 守恒 weld,逐笔递减
    validateOutputState(selfOutIdx, {
        closed: 3,   // ★ 不变,靠这个值 stay 住让下一个 bettor 还能调,不靠 closed 本身变化分辨"谁领过"
        consolidated_pool: consolidated_pool - stake,
        refundRootBaked: refundRootBaked,   // 不变(genesis 烤死,write-once)
        /* nullifier bitmap 更新: 基于顶层 state 的 w0..w16 算出新值写回，同 refund_claim */
    });
}
```

**✅ `require(X==Y)` 取证来源审计(第二轮架构审建议，正面教材配对 §2.2 反面教材)**：`escape_claim` 全部 `require` 的操作数来源标注——`closed==3`(state)、`merkle_index` 范围(witness，仅做类型/范围约束非授权判断)、`cur==refundRootBaked`(左=witness 折叠计算，右=ctor-baked，两者独立可核验，非 vacuous)、nullifier 位检查(顶层 state，非 witness——**这正是 CRITICAL 修复前后的唯一差异点**)、输出 scriptPubKey/value(tx-intrinsic vs witness 绑定)。这份审计对应 NWT 代码审已覆盖的范围，写下来存档，本文件即是 verify-value-source 铁律的正面案例。

**洞③引入的新 ctor 依赖**:`refundRootBaked`(depth-10 `byte[32]`,genesis-mint 时算好烤入,write-once,跟 `betsRootBaked` 并列,不是替换它)。计算方式复用 `pool-payout-root.mjs` 的 `payoutRoot()`/`levelsOf()`(今晚 955 个赢家验证过的同一套构造),只是喂的 leaf 数据是 `{pk, amount: stake}`(每人自己的原始下注额),不是算过的 payout 额。

### 2.1.1 v3 完整 ctor 字段清单(汇总,方便 NWT/Bettor 一眼核对)

在 `_j2_closezk_repro3.sil` 既有 ctor(`gateTmplHash`/`betsRootBaked`/`init_attestedWinner`/`init_closed`/`init_payoutRootField`)基础上,新增:

| 字段 | 类型 | 来源 | 用途 |
|---|---|---|---|
| `consolidatedPoolBaked` | `int` | genesis-mint 时读取 phase1(PayoutShard `close_attest`)continuation 的实际 UTXO 金额 | 复制进可变 state `consolidated_pool`,escape_claim/未来 claim 逐笔递减 |
| `attestedAtSeconds` | `int` | genesis-mint 时读 `kaspa_tx_log` 里 `close_attest` 落链的 `tx.time`(J1 方案,ctor-baked,一次性) | `escape_trigger` 的 grace 窗口锚点,write-once 不进 state(纯 ctor 常量) |
| `refundRootBaked` | `byte[32]` | genesis-mint 时用既有 `payoutRoot()` 构造(喂 `{pk, amount:stake}`) | `escape_claim` 的 merkle membership 验证根,write-once 不进 state(纯 ctor 常量,跟 `gateTmplHash`/`betsRootBaked` 同类) |

`closed` state 由三态(0/1/2)扩为四态(0/1/2/**3**)。`consolidated_pool` 需要作为新的可变 state 字段(repro3.sil 目前没有,§3 开放问题①已记录这个缺口——不影响本节设计,只影响"这份 ctor 最终落在哪个具体 `.sil` 文件"这件事)。

**✅ C2(第二轮架构审定名,跟 C1 并列成对,mint 前硬闸)**：`betsRootBaked` 今天已有 C1 predict-then-verify 守门。**genesis 烤值不可变,这道门今后每个 ZK 市场都要过**——`refundRootBaked`/`attestedAtSeconds`/`consolidatedPoolBaked` **三个新烤值统一要求 mint 前独立复核 byte-equal**:①`refundRootBaked`——从同一份 `gatherOrderedBets()` 结果重算一遍 `payoutRoot({pk,amount:stake})` 比对 ②`attestedAtSeconds`——独立核验链上 attest tx 的实际 `tx.time`(见下方机制 A 确认)③`consolidatedPoolBaked`——独立核验 phase1 continuation 的实际 UTXO 金额。任何一个对不上,mint 前拦截,不烤入。**这跟洞①要防的"钱锁死"是同一类风险,只是触发点从 state machine 换成了烤值正确性**——具体复核逻辑放哪(mint 脚本自检还是独立模块)留到实现那一步,本设计先钉死"必须有这道 C2 门"。

**要点(v3)**:
- `closed` 四态:0(待attest)/1(待zk_close或待escape_trigger)/2(zk_close完成)/**3(escape 已触发,逐 bettor 可 `escape_claim`)**。1→2 和 1→3 互斥(write-once)。**3 是稳定态**,靠 `consolidated_pool` 递减 + nullifier bitmap 分辨"谁领过",不靠 `closed` 值本身变化——这正是 `refund_claim` 已经跑了 955 个赢家验证过的模式(§0.3),不是新发明。
- 授权来源仍是 `betsRootBaked`(genesis 烤死),不需要新的委员签名/groth16(v1 的这条论证不变)。
- **✅ `attestedAtSeconds` 机制已定案 = 机制 A(第二轮架构审拍板,J1 16:13/16:21 已确认,清除文档内此前跟机制 B 并存的矛盾表述)**：genesis-mint 时 off-chain builder 直接读**链上事实**——`close_attest` 落链那笔 tx 的实际 `tx.time`(从 `kaspa_tx_log` 取)，独立核验(C2)后烤进 **ZK covenant 自己的 ctor**。**不需要 phase1(`PayoutShard.sil` 的 `close_attest`)烤任何新字段，不碰这份活着的生产合约**——J1 已实测确认 `PayoutShard.sil` 全文件没有任何时间戳字段，也不需要加。机制 A 比"改 phase1 entrypoint"的机制 B 诊断半径小得多，且这是链上可独立核验的事实（跟 `refundRootBaked`/`consolidatedPoolBaked` 同一套 C2 纪律）。**（此前 v2 版本表述的"phase1 entrypoint 需要烤入时间戳"是机制 B，已废弃，不再采用——留此说明供追溯，不要按旧措辞执行。）**
- **✅ 挂载对象/前序交付物已定案(第二轮架构审排序)**：不是"escape 设计的开放问题"，是它的**前序交付物**——顺序钉死:①先出**正典生产 ZK covenant 文件**（`_j2_closezk_repro3.sil` 骨架 + `consolidated_pool` state + 本节三个新 ctor 字段，一次到位），`_PSZK` 常量对齐或删除 ②`escape_trigger`/`escape_claim` 两个 entrypoint 作为该文件的**一部分**一起过 `.sil` diff 和 NWT 代码审——不要"先定文件再补 entry"分两轮，省一次"entry 顺序破坏 handler selector"的折返风险(下一条)。
- **非阻塞待办(NWT 附带一条,写进 checklist)**:若最终 escape_trigger/escape_claim 落在跟 `zk_close` 同一份 `.sil` 文件(多 entry),必须显式核对"新增 entry 不破坏既有 handler selector"(memory `feedback-ss-entry-reorder-breaks-handler-selector` 踩过的坑),不能默认"加一个 entry 不影响别的"——**已按上一条的排序规则，在同一轮 `.sil` diff 里一次核对，不分两轮**。
- **🟡 待 Owner 正式拍板：`zk_ready` 市场准入政策**——哪类市场进 ZK 路径？建议维持范围：世界杯 pool 全量在某个上限内（暂定 ≤900，具体数字待定），大赢家/高金额场景仍走 payout-shard(committee-sig)不变。这句话需要 Owner 的正式版本，落码前必须有，否则"标记动作是后续独立一步"会被现场发挥决定。

### 2.2 v1 骨架(已废弃,留作记录不删——NWT 洞①②对应的原文)

<details>
<summary>展开看 v1 原文(单 entrypoint,焊死 trigger+claim,deadline 锚点用 genesis-baked)</summary>

```
entrypoint function escape_refund(
    byte[] gateSuffix_UNUSED, int selfOutIdx, int refundOutIdx,
    byte[32] bettorPk, int stake, int merkle_index,
    int w0, int w1, /* ... */ int w16
) {
    require(closed == 1);
    require(tx.time >= (attestDeadline + ESCAPE_GRACE) * 1000);   // ← 洞②: attestDeadline 是 genesis-baked,锚点错
    byte[32] cur = blake2b(byte[](bettorPk) + byte[](stake, 8));
    require(cur == betsRootBaked);
    require(tx.outputs[refundOutIdx].scriptPubKey == byte[](new ScriptPubKeyP2PK(pubkey(bettorPk))));
    require(tx.outputs[refundOutIdx].value == stake);
    validateOutputState(selfOutIdx, { closed: 3 });   // ← 洞①: 第一次调用后 closed 就变 3,第二个 bettor 再也进不来
}
```

</details>

### 2.1.2 经济激励角度(NWT 16:21 提出,非阻塞,不否 deadline-only 哲学,但改变 ESCAPE_GRACE 的选取标准)

**发现**:`escape_trigger` 是 permissionless + deadline-only——一旦窗口打开,**任何人**(不需要签名/凭证)都能广播,不需要谁批准。escape 触发后**所有 bettor 不分输赢都拿回原始 stake**,而 `zk_close` 真实结算时输的一方 stake 会归零(pari-mutuel 分给赢家)。**这意味着输的一方有直接经济动机抢在 `zk_close` 落链之前抢先广播 `escape_trigger`**——把本该归零的注变成全额退款。

**这不否定 deadline-only 哲学本身**(仍然认可,§2 的论证站得住),但**改变了 `ESCAPE_GRACE` 这个常量的选取标准**:不能只按"覆盖正常 proving 延迟的余量"来定(Bettor §开放问题②原先的标准),还必须假设**窗口一开就会被有动机的一方立刻抢跑**——`zk_close` 必须在 grace 窗口打开**之前**就已经落链完成,不能指望 grace 期间还有时间跟人比赛广播速度。**这条并入开放问题②的 `ESCAPE_GRACE` 具体数值讨论**,不单独作为新开放问题。

## 3. 开放问题(需 Bettor/NWT 拍板,不由我单独决定)

**✅① escape_refund 挂在哪个 covenant 上?(已解决,J1 16:21 确认)**
生产版 ZK covenant = `_j2_closezk_repro3.sil` 本身，没有第三份"更真"的文件——就是 NWT 八命门审过、今晚 txId `4ec9ddd1` 真实落链用的那份。`consolidated_pool` 作为新增可变 state 字段直接加在这份文件上（已在 `_j2_closezk_repro4.sil` 落地）。`_PSZK` 那套假设有独立 `attested_winner`/`consolidated_pool` 的 layout 是 6/28 从未实现过的理想化 spec，不对齐真实实现——不影响本设计（本 covenant 自己的 ctor 字段是本设计权威定义）。

**✅② deadline 单位怎么接?(已解决，机制 A 拍板，见 §2.1.1)**
锚点 = `attestedAtSeconds`，genesis-mint 时 off-chain builder 独立核验(C2)链上 `close_attest` 落链 tx 的实际 `tx.time` 后烤入 ZK covenant 自己的 ctor——不碰 `PayoutShard.sil`，不需要 phase1 entrypoint 烤任何新字段。单位问题随之解决：这本身就是一次 `tx.time`(ms-epoch)读数，不涉及 DAA 换算。

**③ 要不要在 ctor 里额外烤 `betsCountBaked`,让 covenant 能精确复现"overCap"这个理由?**
§2 的设计选择是"deadline-only,理由无关"。如果团队认为需要**精确区分**退款理由(比如审计/展示层面想知道这盘是因为 0 注还是爆表退的款),可以加这个字段,但**这属于 nice-to-have,不是 escape_refund 能不能正确退款的必要条件**(off-chain `metadata.zk_settle_evidence` 已经能记录理由,不需要链上区分)。默认建议不加,除非 Bettor/NWT 有相反理由。

**✅④ escape_claim 最后一笔 claim 必然撞 dust 拒绝(NWT 2026-07-06 18:30 抓出 → 20:0x 已修复+链上验证通过)**
隔离链上测试中(单 bettor 全额 claim)首次撞到 `"transaction output #0: payment of 0 is dust"`——J2 最初判断"生产环境多 bettor 分批 claim 不会撞到这个边界",**NWT 指出这个推理站不住,已当场纠正**:不管一个市场有多少个 bettor,只要全部人最终都 claim 完,`consolidated_pool` 总和精确等于所有 stake 之和(这本来就是它的烤法)——**排在队尾的最后一个 claimant,他 claim 完之后 `consolidated_pool - stake` 必然精确等于 0**,导致 continuation 的 0 值 output 撞 dust 下限。这不是"单 bettor 测试才会撞"的边缘场景,是**每个市场都会撞到的同一个结构性缺口**,不因 bettor 数量而改变。

**Owner 催修后的额外发现**：Bettor+NWT+J2 三方独立查证代码库/memory，确认这个精确场景(`consolidated_pool - payout == 0`)**从未有过既有修法**——生产环境 `PayoutShard.sil` 的 `claim`/`refund_claim` 是**完全相同的结构性缺口**，只是从未被真实触发(955 个赢家从没人恰好撞上这个精确边界)。**PayoutShard.sil 同款缺口已升级为独立跟进项**(不阻塞今晚，需记入 DECISIONS.md/ANTI-PATTERNS.md)。

**✅ 修复方案(已落地+NWT 行号级代码审 GREEN+链上验证通过)**：`escape_claim` 加 `if (consolidated_pool == stake) { 最后一笔，不产生 continuation output，不调 validateOutputState } else { 现有分支不变 }`——merkle proof(98-110)/nullifier 检查(115-135)/recipient-bind(136-139)/value check(139) 全部无条件在 if/else 分支(146 行起)之前执行，授权检查零豁免；守恒在 `consolidated_pool==stake` 条件下数学自动成立(不可被伪造，stake 经 merkle proof 绑定真实注册人)。**链上验证**：v4 实例 txId `3aec5594ae84ca743510b065d4951e14e6fa9e208d8df2e0a054d4a9a4b00e37`，双重独立核实(覆约地址 0 UTXO + `outputs_json` 只有 2 个 output，无 continuation)。

---

## 4. 下一步（2026-07-06 16:4x 更新，与 header 阶段同步——之前"开放问题①②有结论后才出diff"这句已过期，diff 已经出了）

1. ✅ §2 核心决策 + §3 全部开放问题已过 Bettor/NWT 审，全部 GREEN/已解决。
2. ✅ 具体 `.sil` 改动(`_j2_closezk_repro4.sil`)已完成，含 1 处 CRITICAL 修复(nullifier witness 绕过，已改回真实 state，NWT 复核 GREEN)。
3. 🔴 **隔离测试前必须先过 2 道核对**（第二轮架构审 16:38 提出，不可省）：①确认编译 repro4 用的 silverc 确实含今天 OP_PICK 的修复(escape_claim 的 merkle 折叠逻辑逐字命中今天 bug 的触发模式) ②repro4 完整编译产物过模拟器 exhaustive PICK bounds 检查。
4. 隔离链上测试（全新一次性 UTXO，不碰任何真实市场）——范围边界：这一步不受 `docs/2026-07-06-zk-close-tick-production-wiring-design.md` §2.6 三前置约束(那三条只挡"escape entrypoint 服务真实 bettor 的真实市场"，纯技术验证可以继续)。
5. **之后才轮到** `escapeRefund` ctx hook 真实接线(`bshard-settle-daemon.mjs`)+ J1 域的 relay dispatch handler。
6. `escapeRefund` entrypoint 服务真实市场之前 = 必须先满足 wiring 文档 §2.6 的三前置(出证备份机 + 卡死告警 + GRACE 按最坏重建时长定标)。
7. ✅ **`zk_ready` 市场准入政策：Owner 正式拍板(2026-07-06)**："ZK 结算路径首批准入 = 世界杯 pool 市场、参与人数 ≤900；大规模赢家场景及既有 committee-sig 市场维持原路径不变；`zk_ready` 标记由 Bettor 手动执行，禁止自动推断。"（≤900 沿用既有参与上限决策，非本次新数字；逼近上限走 payout-shard 扩容，不临时改 ZK 准入线。）可直接作为标记逻辑落码依据。
8. 📌 **非阻塞余线**：正典 covenant 文件落地那一步，`readAttestedWinnerFromState`(`zk-close-builder.mjs` L146-169) 需要单独一行处置结论(四维 grep 定性：死代码删 / 活代码改读 repro4 真实 layout)，不能藏在"`_PSZK` 对齐或删除"这句里顺带带过。
