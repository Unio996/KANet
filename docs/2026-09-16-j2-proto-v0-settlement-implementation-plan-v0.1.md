> **Status**: CURRENT

# 原型 v0 结算实现计划 v0.6（六个结算builder + 意图状态机 + 驱动接线，复用covenant_broadcast）

出处：Owner 2026-09-16 批准实现（D-022，账本1491，Bettor转达"按最简洁的方案走"），在
`docs/2026-09-16-j2-proto-v0-settlement-design-v0.1.md`（v0.8，下称"设计文档"，尤其§1/§2/§7）
基础上给出**可以直接落码的**文件清单、每个builder的精确签名、DB迁移SQL、测试/simnet验证清单、
分批提交顺序。**v0.2更新**：Bettor审v0.1（`eb361933`）批准落码，5个开放点逐条裁定，批准开始
第1批（DB迁移）落码。**v0.3更新（账本1495，Codex复核`origin/coord/codex-bridge@6a5016dd`发现，
2026-09-19交接期间转达）**：v0.2"claim_draw/withdraw/ticket_reclaim用委员keypair代替bettor
签名"这条裁定一度被判定依据不成立，三个builder暂缓实现。**v0.4更新（账本1495，Bettor实核生产
代码`proto.js:212-215`+主网真实数据）**：v0.3的判断本身是误判——我当时验证时查了测试夹具
（`register_append`独立随机生成bettorPk的行为）而不是生产API（生产API固定复用委员pubkey兼任
bettorPk），阻塞解除，不需要改`proto_bets`表结构，六个builder全部按原计划推进；Codex的
MUST-PROVE签名前公钥断言仍要落实（当前相等是实现巧合非协议保证）。**v0.5更新（账本1497，Bettor
批3收货后新增MUST：构造期mass上限fail-closed断言）**：新增§6b记录`proto-mass-ceiling.mjs`的
实现与接入范围；接入既有`buildRegisterAppendTxJson`时意外测出一个**既有生产代码**(`selectChangeShape`,
账本1427/1455/1462)的真实风险——找零选择逻辑不检查找零值是否小到让storage mass超过节点500,000
硬顶，已停下报Bettor（不自己改既有money-path函数），详见§6b与§8开放点9。**v0.6更新
（批4close_commit builder落码+离线测试16/16 PASS，commit`51b5133a`；真实跑simnet验证链时
撞见意外发现②）**：`register_append#1`(首笔下注)在`SIGNED_INPUT_CEILING_SOMPI`(1.0 KAS)约束内
穷举全部候选fee UTXO面值(85M-100M)仍无一能满足95%阈值，比意外发现①更棘手(不是换UTXO能解决的
问题)，已停下报Bettor，simnet验证链停在这一步，详见§6b与§8开放点10。

D-021合规：本文档不写真实relay地址、真实账户余额、完整relay关联txid。

---

## 0. 范围与不做的事（v0.1未变）

**做**：①`market_seal`②`close_commit`③`convert_to_claim`④`claim_draw`(full分支)⑤`withdraw`
(`KanetTokenClaim.spend`)⑥输家ticket自我回收(`buildTicketReclaimTxJson`)，共6个builder；对应
意图状态机表`proto_settlement_intents`；驱动接线（沿用`proto-driver.mjs`，新增专属开关）；
relay侧**复用现有`covenant_broadcast`命令**（v0.2更新，见§5）。

**不做（本轮范围外，按Owner裁定）**：
- `RootClaim.sil:103 require(payout>=1000)`删除 + partial自续约偏移修复——Owner裁定单独一支，
  不进本轮活市场路线，本文档不覆盖，另开一份实现计划。
- `convert_to_refundclaim`/`refund_payout`/`refund_flip`的生产builder——(A)路线不需要，暂缓。
- `RootClose.sil`（refund_flip触发权限/grace）——Owner裁定维持现状，不改代码。

---

## 1. 文件清单

### 1.1 新增文件

| 路径 | 用途 | 参照既有模式 |
|---|---|---|
| `kasia-console/src/lib/proto-close-commit-witness.mjs` | `RootClose.close_commit`entry ABI编码（5委员sig+CLTV相关参数） | `proto-register-append-witness.mjs` |
| `kasia-console/src/lib/proto-convert-to-claim-witness.mjs` | `RootClose.convert_to_claim`entry ABI编码 | `proto-ktt-transfer-witness.mjs` |
| `kasia-console/src/lib/proto-claim-draw-witness.mjs` | `RootClaim.claim_draw`entry ABI编码（本轮只做full分支；**含ticket输入的bettorSig签名**——v0.2更新，见§2.4） | 同上 |
| `kasia-console/src/lib/proto-ktt-claim-spend-witness.mjs` | `KanetTokenClaim.spend`entry ABI编码（赢家checkSig） | 同上 |
| `kasia-console/src/lib/proto-ticket-reclaim-witness.mjs` | `PoolSideTicket.authorize_spend`entry ABI编码（bettor自己checkSig） | 同上 |
| `kasia-console/src/lib/proto-tx-assembly-settlement.mjs` | 六个`buildXTxJson`函数本体（见§2）——**Bettor批准新文件**（裁定①）；**必须import复用**`proto-tx-assembly.mjs`导出的`selectChangeShape`/`selectFeeUtxoByConstruction`/`computeRequiredFeeSompiOrThrow`/`GENESIS_OUTPUT_SOMPI`/`CONTINUATION_OUTPUT_SOMPI`/`PROTO_V0_COMPUTE_BUDGET`/`SOMPI_PER_MASS`，**不复制粘贴**这些常量/helper的定义 |
| `kasia-console/src/lib/proto-settlement-intent.mjs` | `proto_settlement_intents`表的DB读写helper（`ensureSettlementIntent`/`markSettlementIntent`/`recordSettlementIntentPhase`/`checkXLanded`系列） | `proto-bet-intent.mjs`/`proto-market-intent.mjs`（函数命名与状态机形状原样照抄） |

### 1.2 修改文件（v0.2：relay命令那一行删除，改为ingest端点扩展）

| 路径 | 改动 |
|---|---|
| `kasia-console/src/lib/proto-covenant-builder.mjs` | 新增`computeRootCloseGenesisArtifact`/`computeRootClaimGenesisArtifact`/`computeKanetTokenClaimGenesisArtifact`（同既有`computeKttGenesisArtifact`/`computeTicketGenesisArtifact`同构） |
| `kasia-console/src/db/migrate.js` | 新增v210迁移块（见§3） |
| `kasia-console/src/services/proto-driver.mjs` | 新增`isProtoSettlementDriverEnabled()`（独立开关，见§4）+ 六步的tick处理分支 + 启动日志 |
| `kasia-console/src/api/ingest.js` | **v0.2新增**：`/ingest/proto-bet-intent-phase`端点新增`intentKey.startsWith('settle:')`分支，路由到`proto-settlement-intent.mjs`的`recordSettlementIntentPhase`（不新开端点，照抄既有`'genesis:'`前缀分支的写法，见§5） |
| `docs/DATABASE.md` | 补`proto_settlement_intents`表条目（用途/字段/写入方/读取方/陷阱） |

**relay侧`covenant-broadcast-relay.mjs`/`relay.mjs`/`kasia-relay/src/lib/commands.mjs`/
`proto-relay-ipc.mjs`——v0.2确认：均不改动**（Bettor裁定⑤，见§5）。

---

## 2. 六个builder的精确签名（输入/输出/签名输入）

**通用记号**：`CONT`=`CONTINUATION_OUTPUT_SOMPI`=`GENESIS_OUTPUT_SOMPI`=20,000,000 sompi（MUST-4，
两个常量当前同值）；所有KAS侧面值统一用这个值，不取字面`DUST_MIN`。

### 2.1 `buildMarketSealTxJson`（① `ShardLeaf_direct.convert_to_rootclose`）

- **输入**：`[leaf(当前UTXO,CONT), held_token(若count>1有合并代币,CONT), fee]`
- **输出**：`[RootClose genesis(CONT), 代币转出到RootClose(CONT,owner=RootClose covid), fee找零]`
- **签名输入**：只有fee input需要relay签名（`signInputIndices=[feeIdx]`）；leaf/held_token走各自
  entry witness（AB11声明宏性质，不需要私钥）
- **CovenantBinding**：RootClose genesis走`populateGenesisCovenants`（`kaspa.covenantId(fundingOutpoint,
  [{index,output}])`纯函数，无需查链）；代币转出输出是genesis（新KanetTestToken实例）
- **MUST**：广播成功后**立即**把`prepared_tx_json`暂存进`proto_settlement_intents`（MUST-2，
  下一步`close_commit`要用）

### 2.2 `buildCloseCommitTxJson`（② `RootClose.close_commit`）

- **输入**：`[RootClose(当前UTXO,CONT), fee]`——**输入UTXO必须从①暂存的`prepared_tx_json`反推
  outpoint/amount/scriptPubKey，不查链**（MUST-2）
- **输出**：`[RootClose续约(closed:1,winningSide,payoutRoot,CONT), fee找零]`
- **签名输入**：fee input走relay签名；**committee witness签名**（`c0Sig..c4Sig`，v0单keypair
  5遍同签名，见设计文档§1.2；5笔已在simnet真实ACCEPT过，不是新开放问题）
- **MUST-1**：`lockTime=deadline_ms`（毫秒时间戳，`tx`对象内部，不是顶层）；committee-签名input
  的`sequence`取普通值`0`；**提交时节点当前时间必须已经真实超过`deadline_ms`**
- **MUST-2**：与①背靠背提交，是同一个逻辑单元，中间不能被别的操作打断

### 2.3 `buildConvertToClaimTxJson`（③ `RootClose.convert_to_claim`）

- **输入**：`[RootClose(当前UTXO,CONT), 代币输入(owner=RootClose covid,CONT), fee]`
- **输出**：`[RootClaim genesis(7 State字段照抄+claimed_bitmap:0,CONT), 代币转给RootClaim(CONT,
  owner=RootClaim covid), fee找零]`
- **签名输入**：只有fee input
- **MUST-4**：新建RootClaim genesis输出KAS值用`CONT`常量

### 2.4 `buildClaimDrawTxJson`（④ `RootClaim.claim_draw`，仅full分支：`payout==pool_value`）
**v0.2定案（Bettor裁定②，覆盖v0.1的"待核实"标记）**

- **输入**：`[RootClaim(当前UTXO,CONT), 代币输入(owner=RootClaim covid,CONT), 赢家ticket(bettor
  自己那张,CONT), fee]`
- **输出**：`[KanetTokenClaim genesis(market_cov_id=RootClaim自己covid, winner_pk=ticket里的
  bettorPk, amount=payout,CONT), 代币转给新KanetTokenClaim(CONT,owner=该claim covid), fee找零]`
  ——**无RootClaim续约输出**（full分支代码不留root续约，见`RootClaim.sil`行166-171注释）
- **签名输入**：fee input + **ticket输入需要`sig bettorSig`**（`checkSig(bettorSig,
  pubkey(bettorPk))`）——**定案依据**：`PoolSideTicket.sil`唯一入口是
  `entry authorize_spend(sig bettorSig) { require(checkSig(bettorSig, pubkey(bettorPk))); }`，
  没有其它约束；NWT已在simnet真实构造这笔`authorize_spend`签名花费并ACCEPT（设计文档§0.14b
  "追加验证②"）——ticket作为`claim_draw`的输入被消费，同样要带这个签名，不能省略。
  **covenant-construction-spec原文"ticketInIdx需要bettor签名"与`RootClaim.sil`读到的实际require
  链之间的既有分歧，到此以"源码+simnet实证"为准正式关闭**（v0.1曾标记"待NWT核实"，v0.2按此定案，
  不再是开放点）。
- **bettorSig来源——🔴 v0.4定案（Bettor实核生产代码+主网真实数据推翻v0.3的阻塞判断，账本1495）**：
  v0.3基于**测试夹具**（`proto-tx-assembly-register-append.test.mjs`/`run-full-chain.mjs`用
  `new kaspa.PrivateKey(randomBytes(32)...)`独立随机生成bettorPk）得出"bettorPk与委员keypair
  无关"，**这是夹具行为，不是生产路径**——真实生产API`kasia-console/src/api/proto.js:212-215`
  **不从请求体读bettor_pk**，直接取`JSON.parse(market.committee_pubkeys_json)[0]`（文件头注引
  账本1354裁定"复用本市场委员会pubkey兼任"）；`proto-broadcast-ops.mjs:215/237`
  `computeTicketGenesisArtifact({bettorPk: bet.bettor_pk,...})`确认链上ticket烤进去的就是这个
  值。Bettor实核主网库：活市场`a59c7b48`两笔下注`bettor_pk===committee_pubkeys_json[0]`均为
  true，`committee_privkey_enc`存在——**ticket私钥可恢复（`decryptCommitteePrivkey`），阻塞
  解除，不需要给`proto_bets`加私钥列，不改任何既有表结构**。
  **v0.3的方向本身没有错**（v0确实需要独立核实这个假设，不能想当然），**错在验证时看错了代码
  ——查了测试夹具当成生产路径**，这条已写入下方"实现纪律新增"作为ANTI-PATTERNS候选，防止同类
  错误再发生。
- **Codex的MUST-PROVE仍然要做（Bettor v0.4确认，理由更新）**：当前`bettorPk==committeePk[0]`
  是**实现决定的巧合，不是协议保证**——真实多用户下注场景一旦落地（每个bettor有自己独立身份）
  就会分叉，这条防御性断言是那一天的第一道拦截，不是当前场景下多余的代码。**任何签名前，必须
  从该ticket/claim自身的落库状态推导应签的公钥，并断言"手上这把私钥的公钥 == 该ticket承诺的
  bettorPk"，不等即fail-closed，在任何IPC/签名之前拦下**。回归至少两条：①`bettorPk !=
  committeePk[0]`且只有委员key可用时必须失败（不能静默用委员key顶替）；②推导出的公钥与ticket
  的`bettorPk`完全相等时才放行。解出的私钥不进日志、不进夹具文件（同既有委员私钥处理纪律）。
- **中止条件**：若实际场景`payout<pool_value`（partial），**立即停止，不构造**——partial分支的
  修复归属另一支（本文档§0已声明范围外）。

### 2.5 `buildWithdrawTxJson`（⑤ `KanetTokenClaim.spend`）—— v0.4：阻塞解除，按原计划实现

- **输入**：`[KanetTokenClaim(当前UTXO,CONT), 代币输入(owner=本claim covid,CONT), fee]`
- **输出**：`[代币转出到目的地(to_market_input=false，普通新genesis输出，owner=witness指定的任意
  值，CONT), fee找零]`
- **签名输入**：`sig s`——`KanetTokenClaim.sil:106 require(checkSig(s, pubkey(winner_pk)))`，
  验证对象是`winner_pk`（赢家自己的pubkey，来自claim_draw构造时"winner_pk=ticket里的bettorPk"
  这条链）。**v0.4：`winner_pk`同样是`committee_pubkeys_json[0]`**（同2.4的验证结论——生产
  register_append从来只用委员pubkey兼任bettorPk，claim_draw把这个值原样搬进`winner_pk`，不是
  独立身份），签名用同一把委员私钥，console侧解密即用即弃，**MUST-PROVE同2.4：签名前断言推导出
  的公钥与claim记录里的`winner_pk`相等**。
- **无续约**（`.sil`头注"花后不续约,不受V-T-8影响"）

### 实现纪律新增（v0.4，本轮自己的教训，ANTI-PATTERNS候选）：验证"生产路径用哪个值"必须读
生产API/生产builder的真实代码，不能读测试夹具的构造逻辑当生产行为——两者可能因为"夹具为了测试
方便走了独立随机生成"而分叉（本例：`register_append`的测试夹具用随机私钥模拟"任意bettor"这个
泛化场景，方便测多个不同bettorPk的情况；生产API为了v0单操作员简化，实际固定复用委员pubkey）。
下次类似"这个值从哪来"的问题，先grep生产API handler（`src/api/*.js`）与生产builder调用点
（`proto-broadcast-ops.mjs`一类），而不是先读`*.test.mjs`——测试夹具的构造选择是"够测试用即可"，
不代表生产约束。

**本批次全部6个builder均不再受阻塞，按原计划实现**：①market_seal②close_commit③convert_to_claim
④claim_draw⑤withdraw⑥ticket_reclaim。

### 2.6 `buildTicketReclaimTxJson`（⑥ 输家ticket自我回收，`PoolSideTicket.authorize_spend`）——
v0.4：阻塞解除，按原计划实现

- **签名同2.4的bettorSig来源+MUST-PROVE**：该ticket的`authorize_spend`用同一把委员私钥（其
  `bettorPk`同样是`committee_pubkeys_json[0]`），签名前同样要断言推导出的公钥与该ticket的
  `bettor_pk`相等。
- **输入**：`[该ticket UTXO(CONT)]`——**单covenant输入，无独立fee input**（NWT的真实构造是
  单输入+单输出，票本身的0.2 KAS减掉fee直接就是输出金额，见设计文档§0.14b"追加验证②"）
- **输出**：`[代币/KAS转给bettor自己指定的地址]`
- **签名输入**：`sig bettorSig`——同2.4/2.5一致的来源（v0用委员keypair，console侧解密即用即弃）
- **⚠️ fee计算陷阱（v0.2重申，设计文档§0.14b已警告）**：**不能直接复用
  `computeRequiredFeeSompiOrThrow`**——kaspa-wasm本地`calculateTransactionMass`对这个"单covenant
  输入+单P2PK输出"的极简形状本地mass被低估约9.5倍（本地814 vs 节点真实7,750，storageMass=5,555/
  computeMass=7,750，见设计文档§0.14b表#9）。**落码方案**：新增专门的fee计算路径，按
  `SOMPI_PER_MASS × max(该形状真实storageMass基线, 真实computeMass基线)`打底并加安全余量（不低于
  NWT实测的2,000,000 sompi这个下限），**合入前必须用`getMempoolEntry`对生产字节做一次真实mass
  核实**，不能假设跟审计构造完全一样。

---

## 3. DB迁移（v210，接v209之后）——v0.2：ADD COLUMN/CREATE TABLE幂等守卫，允许NULL不给默认值

```sql
-- v210 (2026-09-16, J2, 结算实现, 设计文档§2/实现计划§3, Owner D-022批准；Bettor裁定④)
CREATE TABLE IF NOT EXISTS proto_settlement_intents (
  intent_key       TEXT PRIMARY KEY,          -- 'settle:market:<market_id>:seal' /
                                               --  'settle:market:<market_id>:resolve' /
                                               --  'settle:claim:<claim_id>:convert_to_claim' /
                                               --  'settle:claim:<claim_id>:claim_draw' /
                                               --  'settle:claim:<claim_id>:withdraw' /
                                               --  'settle:ticket:<bet_id>:reclaim'
                                               -- （统一 'settle:' 前缀，供 ingest.js 的intent_key
                                               --   前缀分派识别，见§5；内部 subject_type 段供
                                               --   proto-settlement-intent.mjs 自己再细分）
  subject_type     TEXT NOT NULL CHECK (subject_type IN ('market','claim','ticket')),
  subject_id       TEXT NOT NULL,             -- market_id / proto_claims.id / bet_id
  step             TEXT NOT NULL CHECK (step IN (
                     'seal','resolve','convert_to_claim','claim_draw','withdraw','reclaim'
                   )),                        -- 只含本轮已批准的六步，不含refund相关(Bettor裁定④:
                                               --  "本轮只实现已批准的六个builder对应的step,
                                               --   不预留未实现分支的死代码")
  depends_on       TEXT,                      -- 'resolve'依赖'seal'; 'claim_draw'依赖'convert_to_claim';
                                               --  'withdraw'依赖'claim_draw'; 'seal'/'reclaim'无依赖
  status           TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','prepared','submitted','landed','ambiguous')),
  prepared_txid    TEXT, prepared_tx_json TEXT, submitted_txid TEXT,
  landed_depth     INTEGER, landed_at TEXT, last_error TEXT,
  created_at       TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proto_settlement_intents_subject ON proto_settlement_intents(subject_type, subject_id, step);
CREATE INDEX IF NOT EXISTS idx_proto_settlement_intents_status_updated ON proto_settlement_intents(status, updated_at);
```

**表设计保持通用**（`subject_type`/`step`未来可扩展加`refund`相关值），**但本轮CHECK约束只列
已批准的六步，不为未实现的分支预留死代码**（Bettor裁定④）。`intent_key`格式从v0.1提案的多前缀
（`seal:`/`resolve:`/`claim:...`）改为v0.2统一`settle:<subject_type>:<subject_id>:<step>`——
理由见§5（配合ingest端点的单一前缀分派）。`ADD COLUMN`/`CREATE TABLE`均用`IF NOT EXISTS`幂等
守卫，新表本身没有需要`ALTER`既有表的部分（同v209"允许NULL不给默认值"的纪律——本表除
`intent_key`/`subject_type`/`subject_id`/`step`/`status`/`created_at`/`updated_at`外，其余列
均允许NULL，不给默认值）。

---

## 4. 驱动接线

- 新增`isProtoSettlementDriverEnabled()`（`proto-driver.mjs`）：`process.env.
  PROTO_SETTLEMENT_DRIVER_ENABLED==='1' && !!PROTO_RELAY_ID`——**独立于现有`isProtoDriverEnabled()`
  的开关**（Bettor批准，Owner裁定①"主网执行另走闸门"的具体实现）。**默认关闭**。**启动日志**：
  同现有驱动一样，明确打印`started`/`disabled`两种状态（照抄`proto-driver.mjs`现有
  `startProtoDriver()`的日志格式，不新造一种日志风格）——Bettor v0.2新增要求。
- tick处理沿用现有`proto-driver.mjs`的轮询结构，新增对`proto_settlement_intents`表`status='pending'`
  行的处理分支，按`depends_on`确认前置step已经`landed`才推进。
- `market_seal`的触发条件`count==seal_count`已有，不需要新增触发逻辑，只需要新增"触发后建intent
  行"这一步。
- `close_commit`/`ticket_reclaim`需要MUST-1的CLTV前置检查——驱动逻辑在构造前先做这个判断，不
  依赖"广播失败再重试"的被动模式。

---

## 5. relay侧：复用`covenant_broadcast`，不新增命令（v0.2，Bettor裁定⑤，推翻v0.1的6命令方案）

**Bettor否决v0.1"新增6个COMMAND_TYPES"的方案**，理由：`covenant-broadcast-relay.mjs:17-22`已经
明确写"per-kind精细校验在console侧、relay不信任也不需要知道kind"——relay侧本就是kind-无关的；
新增6个命令只会扩大m0a漏斗接口面，不带来任何额外校验能力，与D-022"最简洁"的方向相反。

**v0.2方案：结算六步全部走现有`covenant_broadcast`命令，`PROTO_COMMAND_ALLOWLIST`/
`kasia-relay/src/lib/commands.mjs`都不改动**。落地方式照抄**已有的、完全同构的先例**——
`kasia-console/src/api/ingest.js`的`/ingest/proto-bet-intent-phase`端点**已经**用`intentKey`
前缀区分回执落进哪张表（`'genesis:'`→`proto-market-intent.mjs`的`recordMarketIntentPhase`；
其余→`proto-bet-intent.mjs`的`recordBetIntentPhase`，端点自己的注释原话："covenant_broadcast
命令本身与kind无关，同一个端点靠intent_key前缀区分该回执落进哪张表/哪个状态机模块，不是新开
一个端点"）。v0.2新增第三个分支：

```js
// kasia-console/src/api/ingest.js，/ingest/proto-bet-intent-phase 端点内，
// 'genesis:' 分支之后、既有 recordBetIntentPhase 兜底分支之前插入：
if (intentKey.startsWith('settle:')) {
  const { recordSettlementIntentPhase } = await import('../lib/proto-settlement-intent.mjs');
  const r = recordSettlementIntentPhase({ intentKey, phase, txid, txJson });
  if (!r.ok) return reply.code(409).send({ ok: false, error: r.error });
  return reply.code(201).send({ ok: true, status: r.intent.status });
}
```

这就是§3把`intent_key`格式统一成`settle:<subject_type>:<subject_id>:<step>`的原因——ingest端点
只需要认`'settle:'`这一个前缀，`proto-settlement-intent.mjs`自己内部再按`subject_type`/`step`
细分逻辑（写的都是同一张`proto_settlement_intents`表，不需要像genesis/bet那样分裂成两张表）。
**relay_id鉴权（`process.env.PROTO_RELAY_ID`匹配）、PSK校验、fail-closed语义全部沿用端点既有
逻辑，不新增一套鉴权**。

committee签名（`close_commit`）与bettor签名（`claim_draw`/`withdraw`/`ticket_reclaim`）这些
"非fee input"签名，在console侧构造完整签名字节后，作为已签名交易的一部分传给relay——**relay
收到的始终是"构造好、除fee input外已完整签名"的交易**，只需要按`covenant-broadcast-relay.mjs`
既有逻辑签自己的fee input、校验、广播，不需要relay理解"这个签名是委员的还是bettor的"这类语义
区别（这正是"relay不需要知道kind"这条原则的自然延伸）。

---

## 6. 测试与simnet验证清单（v0.2：provenance记录字段补全，Bettor v0.2新增要求）

**每个builder落码后，缺一不可**：
1. 单元测试（`*.test.mjs`）：覆盖正常构造路径 + 至少1个异常路径（fee不够/mass超限/找零形状
   选择fail-closed）。
2. `node scripts/lint-kanet.mjs <改动文件>` 0 error（含`R-COMMAND-REGISTRATION`——本轮虽不新增
   命令，但仍需确认lint不因其它改动新增warning）。
3. **生产字节在simnet真实提交ACCEPT**——不能只用cli-debugger PASS或单测通过就合入。**provenance
   记录必须包含（Bettor v0.2新增要求）**：交易`version`、ABI编码器commit、simnet节点二进制
   sha256、节点侧`storageMass`与`computeMass`两个维度（不能只记一个"mass"数字，同设计文档§0.14b
   "margin必须两个维度分别核对"这条纪律）。落进
   `docs/provenance/<日期>-j2-proto-v0-settlement-<builder名>-simnet-verify/`。
4. `close_commit`/`ticket_reclaim`：额外验证MUST-1的CLTV规则，用simnet真实提交而不是debugger离线。
5. `ticket_reclaim`：额外用`getMempoolEntry`核实生产字节的真实mass/fee（见2.6"fee计算陷阱"）。
6. implied fee恒等式独立复算（账本1455纪律，每个builder落码时都要加这个断言）。
7. 全部6个builder各自simnet ACCEPT之后，**再跑一次(A)路线6步+1步（含ticket回收）的完整端到端
   simnet链**，走真实驱动接线（不是手写脚本逐步调用）。

---

## 6b. 构造期mass上限fail-closed断言（v0.5新增，账本1497 Bettor MUST）

**背景**：批3(market_seal)simnet真跑，register_append#1的storageMass=457,504(约91.5%)，与NWT
此前同名步骤445,518(89.10%)相比浮动约1.2万——"设计里算过一次没超"不构成运行期保证，每一次真实
构造都必须重新核一遍两个维度的mass。

**实现**：新文件`kasia-console/src/lib/proto-mass-ceiling.mjs`，导出`assertMassWithinCeiling`——
取①本地`kaspa.calculateTransactionMass`、②按v2.0.1真实consensus公式(`consensus/core/src/mass/
mod.rs::calc_storage_mass`)手算的storage mass、③同源手算的compute mass，三者较大值，
`≥MASS_CEILING_THRESHOLD`(=500,000×0.95=475,000，具名常量+注释解释95%留边理由)即throw，
在任何IPC/广播之前拦下。错误文案带三个信号的测量值+所选fee UTXO面值(便于换面值重试)。

**已接入**：`buildMarketGenesisTxJson`、`buildRegisterAppendTxJson`(`proto-tx-assembly.mjs`)、
`buildMarketSealTxJson`(`proto-tx-assembly-settlement.mjs`)。input侧plurality由调用方显式传入
(kaspa-wasm的TransactionInput/utxo对象不暴露covenant标志，无法从已构造的Transaction对象自动推断，
调用方构造时本来就知道哪些输入是covenant续约/genesis输入)。

**单测**：`proto-mass-ceiling.test.mjs`，7/7 PASS，含"极小面值输出必然throw"与"正常形状放行"两条
Bettor要求的向量。

**🔴 意外发现（既有生产代码风险，未修，已停下报Bettor 2026-09-19）**：接入
`buildRegisterAppendTxJson`后，既有回归测试`proto-tx-assembly-register-append.test.mjs`账本1455
向量⑦⑧(0.85 KAS fee输入场景)从PASS变FAIL——`selectChangeShape`(既有函数，非本批新写)的"形状(a)
带找零"分支只检查费用合理性，不检查找零值是否小到让storage mass爆炸。该向量选中的找零≈1-4M
sompi(远低于`CONTINUATION_OUTPUT_SOMPI`=20M)，喂进KIP-9公式`C·p²/amount`直接把storage mass
推到1,041,946(本地`kaspa.calculateTransactionMass`直接算出，非手算公式偏差)，超500,000硬顶2倍多。
这与账本1427(Bettor当时去掉"找零必须0或≥20M"dust门槛，改按fee经济性二选一)时间线吻合——去掉门槛
解决了0.95 KAS步骤B场景被误伤的问题，但重新打开了小额dust找零这个口子，只是当时没有mass断言去
暴露它。`buildRegisterAppendTxJson`是每笔真实下注都会走的既有生产路径，理论上存在真实风险面。
**未修复，等Bettor裁定**——详见§8开放点9。register_append的mass断言wiring本身已完成且逻辑正确
(断言按预期fail-closed拦下了这笔真实会被节点拒收的交易)，问题在`selectChangeShape`本身，不在
新断言。

**主网执行前的额外要求（Bettor MUST第4点，需要在§7"11.主网执行"落地时执行，本节先记录要求）**：
路线(A)第二笔下注在主网的真实形状（fee UTXO是真实0.95 KAS那枚，leaf是a59c7b48链上输出）与simnet
不同，广播前必须用生产builder算出两维度mass并记录（走`assertMassWithinCeiling`即可，不需要另外
手动算），超95%阈值即中止换面值，不要等节点拒收才知道。

**🔴 意外发现②（比①更棘手，未修，已停下报Bettor 2026-09-19）**：接入`buildRegisterAppendTxJson`
后真实跑simnet(批4验证链genesis→bet1→...)，`register_append#1`(市场首笔下注，无held输入)在
`SIGNED_INPUT_CEILING_SOMPI=100,000,000`(既有relay侧签名面值硬顶)约束内，**穷举85M-100M全部
候选fee UTXO面值，无一能让mass降到95%阈值(475,000)以下**——即使用满ceiling上限100,000,000，
mass仍是476,668(95.33%)，只比阈值高0.33个百分点。规律：fee面值越大→找零越大→storage mass
越低(找零值是`C·p²/amount`的分母)，但在100M这个硬顶处已经是能做到的最好成绩，仍不达标。这不是
"换UTXO能解决"的问题(意外发现①的候选修法"mass超限就换面值"在这里穷举全部候选后仍无解)——
是register_append#1这个形状在现有ceiling约束下的可行区间与95%阈值本身没有交集。详见对Bettor的
汇报(2026-09-19)。候选方向(未定案，等Bettor裁定): (a)该步骤/该量级下调阈值(如97-98%，代价是margin
变窄); (b)提高`SIGNED_INPUT_CEILING_SOMPI`(需评估relay侧签名面值上限背后的安全考量); (c)认定
register_append当前witness/state编码的mass天花板本来就这么高，需要找降mass的构造改动(未深挖);
(d)其它。simnet验证链已停在这一步，close_commit本身尚未真实跑到（[RootClose,fee]两输入形状目测
mass余量正常，但要等register_append#1这条路先通）。

---

## 7. 分批提交顺序（v0.2：relay命令批次删除，其余不变；Bettor批准第1批立即开工）

1. **DB迁移**（v210，§3）——最先做，风险最低，后续所有builder都依赖这张表存在。**批准立即开工**。
2. **`proto-settlement-intent.mjs`**（§1.1，intent状态机helper）+ **`/ingest/proto-bet-intent-phase`
   端点`'settle:'`分支**（§5，两者天然一批，分支代码依赖这个模块存在）。
3. **`buildMarketSealTxJson`**（①）+ 对应witness模块（若不需要新witness——复用leaf自己的AB11
   声明宏——落码时确认）+ simnet验证。
4. **`buildCloseCommitTxJson`**（②）+ `proto-close-commit-witness.mjs` + simnet验证。
5. **`buildConvertToClaimTxJson`**（③）+ `proto-convert-to-claim-witness.mjs` + simnet验证。
6. **`buildClaimDrawTxJson`**（④，仅full分支，含ticket的bettorSig签名+委员keypair来源）+
   `proto-claim-draw-witness.mjs` + simnet验证。
7. **`buildWithdrawTxJson`**（⑤）+ `proto-ktt-claim-spend-witness.mjs` + simnet验证。
8. **`buildTicketReclaimTxJson`**（⑥）+ `proto-ticket-reclaim-witness.mjs` + fee计算陷阱专门
   处理（2.6节）+ simnet验证。
9. **驱动接线**（§4，`proto-driver.mjs`扩展，含启动日志）——等六个builder都各自simnet验证过
   之后再接线。**relay侧无需改动**（§5，v0.2删除此前的relay命令批次）。
10. **端到端集成验证**（测试清单第7条）——全部接线完成后，跑一次真正走驱动的完整simnet全链。
11. **主网执行**——集成验证通过后，走Owner裁定①"另走闸门"，具体触发方式待Bettor/Owner另行确认。

---

## 8. 剩余开放点（v0.6：新增开放点10，等Bettor裁定；其余此前均已裁定或待裁定中）

1. ~~新文件组织~~——**已裁定**：批准新文件，import复用不复制粘贴（§1.1）。
2. ~~claim_draw是否需要ticket签名~~——**已裁定**：需要，源码+simnet实证定案（§2.4）。
3. ~~bettorSig如何获取真实私钥~~——**v0.4已定案**：v0.3的阻塞判断本身是误判（查了测试夹具当生产
   路径）——Bettor实核生产API(`proto.js:212-215`)+主网真实数据确认`bettorPk`就是
   `committee_pubkeys_json[0]`，委员私钥可解密复用，不需要改`proto_bets`表结构。Codex的
   MUST-PROVE签名前公钥断言仍要做（当前相等是实现巧合非协议保证）。`T-PROTO-BETTORPK-BINDING`
   观察票范围收窄为"真实多用户场景下bettorPk与委员身份分离后的密钥来源"。
4. ~~`subject_type='ticket'`~~——**已裁定**：批准，且v0.2进一步明确`intent_key`统一
   `settle:`前缀格式（§3/§5）。
5. ~~relay命令~~——**已裁定**：否决新命令，复用`covenant_broadcast`+ingest端点前缀分派（§5）。
9. **🔴 待裁定（v0.5新增，账本1497衍生发现）**：`selectChangeShape`(既有生产函数)"形状(a)带找零"
   分支不检查找零值是否会让storage mass超过节点500,000硬顶，account-1455回归向量⑦⑧实测触发
   1,041,946(超2倍)，详见§6b。已停下报Bettor(2026-09-19)，未自行修改。候选方案(仅供参考，未定案)：
   让形状(a)分支在判`okA`时也过一遍`assertMassWithinCeiling`的手算部分，超限则`okA=false`退回
   形状(b)(不留找零，剩余全部并入fee)——不恢复账本1427已废弃的字面值dust门槛，改用真实mass判据。
   影响面：`buildRegisterAppendTxJson`/`buildMarketGenesisTxJson`两个既有生产路径共用
   `selectChangeShape`，改动前需要Bettor审(铁律0，既有money-path函数)。
10. **🔴 待裁定（v0.6新增，账本1497衍生发现②）**：`register_append#1`(首笔下注，无held输入)在
    `SIGNED_INPUT_CEILING_SOMPI`(1.0 KAS硬顶)约束内，穷举85M-100M全部候选fee UTXO面值实测——
    即使用满ceiling上限100,000,000，mass仍是476,668(95.33%)，比95%阈值(475,000)高0.33个百分点，
    无一候选达标，详见§6b。已停下报Bettor(2026-09-19)，未自行修改阈值/ceiling常量/构造逻辑。
    候选方向：(a)该步骤/量级下调阈值；(b)提高`SIGNED_INPUT_CEILING_SOMPI`；(c)找降mass的
    witness/state编码改动；(d)其它。simnet验证链(genesis→bet1→bet2→market_seal→close_commit)
    停在register_append#1这一步，close_commit本身尚未真实跑到。

第1-2批（DB迁移+intent状态机）已完成落码。六个builder（第3-8批）全部不再受阻塞，按分批顺序
（§7）继续推进，当前在做第3批（market_seal）。
