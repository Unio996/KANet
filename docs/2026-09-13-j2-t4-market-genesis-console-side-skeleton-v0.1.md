# T4 · 市场创世（console 侧）设计骨架 v0.1（不写码）

> **Status**: DRAFT-FOR-REVIEW **v0.1**（2026-09-13 · J2 · Bettor 派工「console 侧市场创世：状态初值由单源产物生成 + 创世前全部状态字段逐字节对照（范围已拍 = 全部字段）+ P2SH 重算 + `market_genesis` 走 submit_intents + landed 硬门；与 (c) 的 `escrow_landed_at` 消费门衔接（T4 下注入口按 `escrow_landed_at` 非空才匹配）；填错自毁的检测与告警；写清哪些是 (c) 已有机制复用、哪些新增」· 输入：T2 骨架 §4（`docs/2026-09-13-j2-t2-market-and-claim-covenant-a2-skeleton-v0.1.md`，T4 对照检查骨架初稿）· T3 v0.2 §1（22 常量去向，Q8 裁 `poolMerkleRoot/committee_hash` 搬状态 T4 对照升 MUST）· (c) patch（`coord/j2-c-no-tx-landed`，`lib/submit-intent.mjs` / `services/escrow-landed-gate.mjs`，已合入待 Owner 批）· 既有机制：`lib/pool-shard-register.mjs` `ensurePayoutShard`（genesis-mint 流程模板）+ `lib/bshard-payout-family-coherence.mjs` `assertPayoutShardCoherence`（K-18 §3.4，recompile + 逐字节比对 + 三态分类，本稿的对照检查**直接复用/推广**这一个既有函数，不重新发明）· 交 NWT → Bettor → 🔴 市场创世 = 钱路 ⇒ Owner 批（D-017 §3）后才落码。

## 0. 一句话

市场创世的"填错自毁"风险不是新问题——`assertPayoutShardCoherence`（K-18）已经在用"recompile + 字节比对 + 三态分类（真 FAIL / 环境 inconclusive / 数据 FAIL）"的形来守 `pool_merkle_root`/`predicate_commit` 两个字段。T4 做两件事：① **把这个既有函数的覆盖面从 2 个字段扩到 A″ 全部状态字段**（T3 §1 的 13 个搬状态字段 + 4 个代币锚字段，逐条见 §2）；② **把创世 tx 本身纳入 (c) 的 submit-intent + landed 硬门框架**（新 `intent_kind: 'market_genesis'`），使"市场创世"与"escrow 锁仓"共享同一套幂等/落链/消费门纪律，而不是市场创世单独发明一套。**新增的只有**：覆盖面扩大后的对照函数（结构复用，内容新增）、`market_genesis` intent kind、`pool_markets` 新列、创世前置检查的调用点、与 T4 下注入口的衔接判据。**复用的**：submit-intent 全部机制（幂等键/两阶段/同字节重播/landed 门）、escrow-landed-gate 的门形状（"NULL ⇒ 拒下游动作"）、K-18 三态分类纪律、`pool-bshard-artifacts.mjs` 的单源编译产物（`compileSil`/`ctorBytes32`/`extractTemplateArtifact`）、`ensurePayoutShard` 的"编 redeem → transfer 种子 → relay genesis-mint 命令 → landed 检查 → INSERT 行"骨架顺序。

## 1. 现状（不重述，只钉出处）

- **单源产物**已存在：`pool-bshard-artifacts.mjs` `compileSil`（隔离子进程调 pinned `silverc`）+ `pool-template-artifact.mjs` `extractTemplateArtifact`（取 `template_hash/state_span`）——T4 对 A″ 三个新合约（`KanetTestToken`/`sil-v1` 市场家族/`KanetTokenClaim`）沿用同一对，不新写编译器调用。
- **对照检查**已存在但覆盖窄：`assertPayoutShardCoherence(psRow, { p2sh, tier })`（`bshard-payout-family-coherence.mjs:122`）只核 `pool_merkle_root`/`predicate_commit` 两列，`tier='full'` 时 recompile 字节比对，`tier='cheap'` 只核 `probeStructuralSignature`（解码状态区 + 位点比对，不跑 silverc）。三态分类纪律（§3.4 判据①②③：真 FAIL / 环境 inconclusive / 数据格式 FAIL）已经踩过坑写好（2026-07-21 事故预防注释）。
- **genesis 流程**已存在骨架：`ensurePayoutShard`——查表 → 不存在则 `compilePayoutShardRedeem`（=单源产物）→ `transfer` 种子 KAS → relay `bshard_genesis_mint_payout` 命令拿 `payoutCovId` → `landed(psTx, psAddr)` 检查 → `INSERT INTO payout_shards`。**这个顺序本身就是"创世 = 一个需要落链确认才能记账的动作"**，只是它的 landed 检查是一个独立小函数（旧形），不是 (c) 的 submit-intent 框架。
- **(c) 的消费门**已存在：`escrow-landed-gate.mjs` 的形 = `usesEscrowLock`（判定条件）+ `escrowGateFor`（门在 `exchange-machine.transition` 单一所有权点）+ `applyIntentLanded`（对账器回填，NULL 时才写，幂等）。T4 要做的"下注入口按 `escrow_landed_at`/`market_landed_at` 非空才匹配"是**同一个形的第二个实例**，不是新发明。

## 2. 对照检查扩面（复用 `assertPayoutShardCoherence` 的结构，覆盖面 = A″ 全部状态字段）

### 2.1 判据不变，覆盖面表（T3 §1 的 13+4 个字段逐条给"结构签名"位点）
沿用 K-18 三态：① `tier='cheap'`（结构签名，`probeStructuralSignature` 同形：解码状态区字节，逐字段位点比对 DB 列，**不跑 silverc**，热路径用）；② `tier='full'`（① + recompile 全字节比对，**只在创世那一刻**跑，一次性成本可接受）；③ 三态分类照抄 §3.4 判据（recompile 真跑完不等 = FAIL；silverc 子进程起不来 = inconclusive；DB 列本身格式非法 hex/长度错 = 数据 FAIL，不降级 inconclusive）。

| 字段（T3 §1/§4 来源） | 属于哪个合约状态 | 结构签名位点（cheap tier） | 备注 |
|---|---|---|---|
| `token_tmpl_hash`/`token_prefix_len`/`token_suffix_len` | 市场（T2/T3 每文件新增） | 状态区固定偏移（编译期已知，从 `state_span` 派生） | 代币锚，A″ 核心；四个新字段里最关键 |
| `claim_tmpl_hash` | 市场（创建领取输出的入口所在文件） | 同上 | 与 RootClose 已有的 `claim_tmpl_hash`（RootClaim 模板，留 ctor）**不是同一物**——T4 检查两者都要核，但来源不同（一个状态一个 ctor） |
| `poolMerkleRoot` | PayoutShard/PayoutShardV2 | 沿用 `probeStructuralSignature` 现有位点（`V1_POOL_MERKLE_ROOT_OFF`），**只是判定从"ctor 值"改成"状态初值"**——位点计算方式不变（状态区内固定偏移这件事本来就是 A″ 的前提：Q4 已证状态值不影响 `template_hash`，位点由 `state_span` 决定与值无关） |
| `committee_hash` | RootClose | 新增位点（`decodeV1State` 现在没有 RootClose 的解码器——**新增**：`decodeRootCloseState`，形照抄 `decodeV1State`） |
| `predicate_commit` | PayoutShard/PayoutShardV2（搬状态） | 同 `poolMerkleRoot`，沿用现有 `V1_PREDICATE_COMMIT_OFF` | baked-use 两行删除后（T3 §1）此字段的"存在性"证明改成"确实在状态区能读到"，与其余字段同形，不再需要特殊 self-compare 技巧 |
| `market_id`（若不删，见 T3 §1 待选） | — | — | T3 §1 倾向删；若删，此行不适用 |
| `shard_pool_id`/`payout_cov_id`/`deadline`/`seal_count`/`min_bet`/`betsRootBaked`/`refundRootBaked`/`attestedAtMs` | 各自文件 | 新增位点（每个合约需要一个 `decode*State` 解码器——**新增工作量**：7 文件 × 1 个解码器，形照抄 `decodeV1State`，`bshard-payout-family-coherence.mjs` 现在只有 V1/V2 两种，T4 要给主网集 7 文件各配一个） |

**结论**：对照函数**不是**从零写，是把 `bshard-payout-family-coherence.mjs` 的解码器族从 2 个（V1/V2）扩到 **7 个**（每个主网集文件一个），每个解码器把该文件全部状态字段的偏移表出来；`assertPayoutShardCoherence` 本身的三段判据逻辑（a family 声明 / b cheap 结构签名 / c full recompile）**原样复用**，只是判据 (b) 循环的字段列表变长。

### 2.2 P2SH 重算
`ensurePayoutShard` 里 `psAddr = p2sh(redeem)` 已经是这个动作（`pool-bshard-artifacts.mjs` 的 `p2sh` helper，等价于 P12/P13 探针用的 `aa20‖blake2b(prefix‖state‖suffix)‖87`）。T4 **复用同一 `p2sh` helper**，创世前算一次期望地址，与即将广播的 tx 输出 `scriptPublicKey` 比对；不等 ⇒ 不广播（NO TX）。**不新增算法**，只新增"广播前比对"这一步（现状 `ensurePayoutShard` 是广播后才用 `psAddr` 记账，没有广播前比对——这是 T4 相对现状的真实新增，不是复用）。

## 3. `market_genesis` intent（复用 (c) submit-intent 框架，新增一个 kind）

### 3.1 复用（(c) 已有，零改动）
- `lib/submit-intent.mjs` 的 `ensureIntent`/`recordIntentPhase`/`markIntent`/`checkIntentLanded`/`resumeStaleIntents`/`alertIntent`——**全部函数签名不变**，只是调用方传 `intentKind: 'market_genesis'`。
- relay 两阶段（`prepared`{确定性 txid + 已签名字节}/`submitted`）与同字节重播——市场创世 tx 与 escrow 锁仓 tx 在 relay 侧走的是**同一个** `transfer` 命令扩展点（`intent_key`/`replay_tx_json`/`prepared_txid` 三个可选字段），**不新增 relay 端代码**。
- `checkIntentLanded(minDepth = REORG_SAFE_MIN_DEPTH)`——创世落链深度门与 escrow 锁仓同一常量（`pool-shard-register.mjs:88`），不新写数字。

### 3.2 新增
- `INTENT_KINDS` 数组加 `'market_genesis'`；`KIND_PREFIX` 加 `market_genesis: 'genesis:'`（幂等键 `'genesis:' + market_id`，与设计草案 §10.6 提过的形一致，本稿定案）。
- 创世不是简单 `{ type: 'transfer', target, amount }`，是 relay 端的 `bshard_genesis_mint_payout`（或 A″ 新市场家族对应的新命令类型）——**`transferWithIntent` 目前假定命令是 `transfer`**（`lib/submit-intent.mjs:214` 硬编码 `{ type: 'transfer', ... }`），T4 需要给 `transferWithIntent` 加一个可选 `cmdType`/`cmdBuilder` 参数，把 `{ type: 'transfer', target, amount, intent_key }` 换成 `{ type: cmdType, ...cmdArgs, intent_key }`（保持 `intent_key` 贯穿两阶段的机制不变）。**这是 (c) 框架的一处小泛化**，标记为 T4 对 (c) 的唯一改动点，需要在 (c) 侧一并小改（或 T4 单开一个 `genesisWithIntent` 复制 `transferWithIntent` 的骨架但换命令形——两个方案都可行，倾向前者避免重复维护两套 attempt/mempool/replay 逻辑）。

### 3.3 落链硬门（新表列，形同 `escrow_landed_at`）
`pool_markets`（或 A″ 新市场表，视 T3/T5 定名）加：
- `market_landed_at TEXT` / `market_landed_depth INTEGER`（唯一写入方 = 对账器 `applyIntentLanded` 的推广，见 §4）。
- `template_anchors_json TEXT`（T2 §4 提过的锚记录：`{token:{hash,span,source_sha256}, claim:{…}, market:{…}}`，创世时写一次，供后续每笔下注/派彩构造前再对照，同 K-18 coherence gate 的"谁编译谁 declare"纪律）。

## 4. 与 (c) `escrow_landed_at` 消费门的衔接（复用门形，新增一个门实例）

`escrow-landed-gate.mjs` 现在管的是"预测 offer 的 escrow 锁仓"；T4 要新增的是"市场本身"这一层门，**两层门独立、都要过**：
```
下注(T4 入口) 可执行  ⟺  market_landed_at IS NOT NULL          // 新门：市场存在且已落链(本稿)
                        ∧ (若该 offer 用 escrow 锁)escrow_landed_at IS NOT NULL   // 既有门((c)，未改)
```
- **新增**：`services/market-landed-gate.mjs`（形照抄 `escrow-landed-gate.mjs`）：`usesMarketGenesisGate(offer)`（恒真——A″ 下所有市场都要经过创世 intent，无老路径例外，比 `usesEscrowLock` 简单）、`marketGateFor(offer)`（读 `pool_markets.market_landed_at`）、`applyMarketLanded`（对账器回填，形同 `applyIntentLanded`，`intent_kind='market_genesis'` 分支）。
- **衔接点**：T4 下注入口（`api/pool.js` 或 A″ 新入口，批 T v0.7 T4 行"bettor 自 mint + owner 烤成市场 covenant-id"）在构造下注 tx 前先查 `marketGateFor`；未落链 ⇒ 拒（409 形，同 `takerAcceptGate` 的返回形）。
- **对账器**：`tx-landed-reconciler.mjs` 的 `reconcileIntents` 循环已经通用处理"所有 kind 的 submitted intent"（`listIntents({status:'submitted', kinds: null})`——不挑 kind），**加 `market_genesis` 之后自动被扫到，不用改对账器主循环**；只需在 `applyIntentLanded` 的 switch 里加一支 `market_genesis → 写 pool_markets.market_landed_at`（`escrow-landed-gate.mjs:66-68` 那个 `if/else if` 加第三支）。

## 5. 填错自毁的检测与告警

"填错"分两类，处置不同：
1. **创世前能拦的**（§2 对照检查 FAIL）：不广播，`alertIntent`（复用 (c) 的告警函数）打 `market_genesis_coherence_mismatch`，附具体哪个字段不符——这类不是"自毁"，是"根本没创世"，NO TX 原则下最干净。
2. **创世后才发现的**（对照检查在广播前通过、但源文件与生产用的 pinned 编译器版本之间有漂移，或人手改过市场行）：K-18 已有"逐笔构造前再对照一次"的纪律（同 `_checkCoherenceNonBlocking`，`ensurePayoutShard` 现有代码里已经在查表命中已存在市场时调用）——**复用这个既有调用点**，`tier='cheap'` 每次构造前查，`tier='full'` 定期巡检（同 `bshard-coherence-observability-monitor.mjs` 的既有形，批 T v0.7 提过的 `ps_coherence_gate_fail` 事件）。这类市场"自毁"（创世状态填错、代币模板锚不对）在 A″ 下的后果 = 该市场永远收不到/派不出代币（T1 v0.5 §2.1 已写"是自毁，非漏洞"）；T4 只负责**尽早发现并告警**，不负责修复（修复 = 该市场作废，走既有 refund/cancel 路径，不在 T4 范围）。

## 6. 请 NWT 判
1. §3.2 的泛化方案（给 `transferWithIntent` 加 `cmdType`/`cmdBuilder` vs 单开 `genesisWithIntent` 复制骨架）——我倾向前者，但会碰 (c) 已合入的文件，需要 NWT 判是否值得为 T4 再开一小笔 (c) 侧 patch，还是等 T4 真正落码时一起做。
2. §2.1 表格"7 个解码器"的工作量是否值得——替代方案：**放弃 `tier='cheap'` 的逐字段解码**，A″ 下每次都跑 `tier='full'`（recompile，反正只在创世/巡检两个低频时刻用，不在热路径）；代价 = 巡检变慢，收益 = 不用写 7 个解码器。我倾向**保留 cheap tier 但只解码"新增的 4 个代币锚字段"**（其余字段沿用 K-18 现有覆盖或暂不查，分期做），先把 A″ 最要紧的锚点覆盖住。
3. `market_landed_at` 落在 `pool_markets` 现表还是 A″ 新市场表——依赖 T3/T5 是否重新建表，本稿先写在 `pool_markets`（假设沿用），若 T5 决定新表需要改列位置不改逻辑。

## 7. 没核到的
- `pool_markets` 表当前是否已有类似"创世确认"语义的列（未逐列核对 34 列全表，只读了 T2/T3 提到的几个）。
- `decodeV1State`/`decodeRootCloseState`（新增）的具体字节偏移表需要对着 T3 v0.2 改完的 .sil（还未落码）逐字段量，本稿只定"要做"不定"怎么量"。
- `bshard-coherence-observability-monitor.mjs` 现有巡检 cron 的 tick 间隔与批量上限，T4 是否直接复用同一 cron 还是新开一个（新市场家族与 bshard 家族巡检成本可能不同量级），未核。
