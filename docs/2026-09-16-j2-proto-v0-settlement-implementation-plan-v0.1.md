> **Status**: CURRENT

# 原型 v0 结算实现计划 v0.1（六个结算builder + 意图状态机 + 驱动接线 + relay漏斗命令）

出处：Owner 2026-09-16 批准实现（D-022，账本1491，Bettor转达"按最简洁的方案走"），在
`docs/2026-09-16-j2-proto-v0-settlement-design-v0.1.md`（v0.8，下称"设计文档"，尤其§1/§2/§7）
基础上给出**可以直接落码的**文件清单、每个builder的精确签名、DB迁移SQL、测试/simnet验证清单、
分批提交顺序。**本文档只是计划，铁律0要求先报计划、Bettor审过再动手——本文档尚未落任何代码**。

D-021合规：本文档不写真实relay地址、真实账户余额、完整relay关联txid。

---

## 0. 范围与不做的事

**做**：①`market_seal`②`close_commit`③`convert_to_claim`④`claim_draw`(full分支)⑤`withdraw`
(`KanetTokenClaim.spend`)⑥输家ticket自我回收(`buildTicketReclaimTxJson`)，共6个builder；对应
意图状态机表`proto_settlement_intents`；驱动接线（沿用`proto-driver.mjs`，新增专属开关）；
relay漏斗命令注册。

**不做（本轮范围外，按Owner裁定）**：
- `RootClaim.sil:103 require(payout>=1000)`删除 + partial自续约偏移修复——**Owner裁定单独一支**，
  不进本轮活市场路线，本文档不覆盖，另开一份实现计划。
- `convert_to_refundclaim`/`refund_payout`/`refund_flip`的生产builder——(A)路线不需要，暂缓；
  只做完settlement design v0.8已确认"debugger PASS但未过simnet"的那几个入口的**审计验证**留档，
  不在本轮生产化范围。
- `RootClose.sil`（refund_flip触发权限/grace）——Owner裁定维持现状，不改代码。

---

## 1. 文件清单

### 1.1 新增文件

| 路径 | 用途 | 参照既有模式 |
|---|---|---|
| `kasia-console/src/lib/proto-close-commit-witness.mjs` | `RootClose.close_commit`entry ABI编码（5委员sig+CLTV相关参数） | `proto-register-append-witness.mjs` |
| `kasia-console/src/lib/proto-convert-to-claim-witness.mjs` | `RootClose.convert_to_claim`entry ABI编码（`convert_to_refundclaim`结构相同，同文件共用，参数化`claim`/`refundclaim`两套协议常量） | `proto-ktt-transfer-witness.mjs` |
| `kasia-console/src/lib/proto-claim-draw-witness.mjs` | `RootClaim.claim_draw`entry ABI编码（`refund_payout`结构相同，本轮只做full分支，同文件预留partial接口但不实现） | 同上 |
| `kasia-console/src/lib/proto-ktt-claim-spend-witness.mjs` | `KanetTokenClaim.spend`entry ABI编码（赢家checkSig） | 同上 |
| `kasia-console/src/lib/proto-ticket-reclaim-witness.mjs` | `PoolSideTicket.authorize_spend`entry ABI编码（bettor自己checkSig，全新入口，此前从未在生产代码里出现过） | 同上 |
| `kasia-console/src/lib/proto-tx-assembly-settlement.mjs` | 六个`buildXTxJson`函数本体（见下§2），复用`proto-tx-assembly.mjs`导出的`selectChangeShape`/`selectFeeUtxoByConstruction`/`computeRequiredFeeSompiOrThrow`/`GENESIS_OUTPUT_SOMPI`/`CONTINUATION_OUTPUT_SOMPI`/`PROTO_V0_COMPUTE_BUDGET`/`SOMPI_PER_MASS` | **提议新文件**（不塞进已有560行的`proto-tx-assembly.mjs`，理由见下§1.3），复用而非重复其常量/helper |
| `kasia-console/src/lib/proto-settlement-intent.mjs` | `proto_settlement_intents`表的DB读写helper（`ensureSettlementIntent`/`markSettlementIntent`/`recordSettlementIntentPhase`/`checkXLanded`系列） | `proto-bet-intent.mjs`/`proto-market-intent.mjs`（函数命名与状态机形状原样照抄） |

### 1.2 修改文件

| 路径 | 改动 |
|---|---|
| `kasia-console/src/lib/proto-covenant-builder.mjs` | 新增`computeRootCloseGenesisArtifact`/`computeRootClaimGenesisArtifact`/`computeKanetTokenClaimGenesisArtifact`（同既有`computeKttGenesisArtifact`/`computeTicketGenesisArtifact`同构，各自算出redeem脚本+scriptPubKey，供builder调用） |
| `kasia-console/src/db/migrate.js` | 新增v210迁移块（见§3） |
| `kasia-console/src/services/proto-driver.mjs` | 新增`isProtoSettlementDriverEnabled()`（独立开关，见§4）+ 六步的tick处理分支 |
| `kasia-relay/src/lib/commands.mjs` | 新增6个`COMMAND_TYPES`常量 + 对应`COMMAND_FIELD_TYPES`注册（lint `R-COMMAND-REGISTRATION`会抓漏注册，落码时必须两处同步） |
| `kasia-console/src/lib/proto-relay-ipc.mjs` | `PROTO_COMMAND_ALLOWLIST`新增6项 |
| `docs/DATABASE.md` | 补`proto_settlement_intents`表条目（用途/字段/写入方/读取方/陷阱），改表前必查纪律的另一半——改完也要写 |

### 1.3 "新文件 vs 塞进已有文件"的说明（供Bettor审时定夺，不是我擅自决定）

`proto-tx-assembly.mjs`目前560行（`market_genesis`+`register_append`+全部共享helper）。六个新
builder各自需要真实ABI编码、covenant_id计算、mass/fee形状选择的完整流程，参照`buildRegisterAppendTxJson`
的量级（约110行），估计新增500-700行——若塞进同一个文件会接近1200-1300行，超出目前该文件的既有
量级一倍以上。**本计划提议拆到新文件`proto-tx-assembly-settlement.mjs`，import复用共享helper**，
不是重复实现。如果Bettor倾向于维持"只有一个`proto-tx-assembly.mjs`"的单文件哲学，也可以照旧塞
进同一个文件——这是本计划唯一一处"文件组织"层面的可选项，其它文件清单不受这个选择影响。

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
  5遍同签名，见设计文档§1.2；`T-PROTO-COMMITTEE-SIG-DISTINCTNESS`留待落码时cli-debugger离线向量
  核实"5个相同签名是否被接受"——本轮5笔已在simnet真实ACCEPT过，不是新开放问题，可直接照抄audit构造）
- **MUST-1**：`lockTime=deadline_ms`（毫秒时间戳，`tx`对象内部，不是顶层）；committee-签名input
  的`sequence`取普通值`0`（不能`MAX_TX_IN_SEQUENCE_NUM`）；**提交时节点当前时间必须已经真实超过
  `deadline_ms`**（两条CLTV规则叠加的唯一自洽解，见MUST-1精确规则）
- **MUST-2**：与①背靠背提交，是同一个逻辑单元，中间不能被别的操作打断

### 2.3 `buildConvertToClaimTxJson`（③ `RootClose.convert_to_claim`）

- **输入**：`[RootClose(当前UTXO,CONT), 代币输入(owner=RootClose covid,CONT), fee]`
- **输出**：`[RootClaim genesis(7 State字段照抄+claimed_bitmap:0,CONT), 代币转给RootClaim(CONT,
  owner=RootClaim covid), fee找零]`
- **签名输入**：只有fee input（委员裁决已经在②锁定进`winningSide`/`payoutRoot`，这步不需要重新
  授权）
- **MUST-4**：新建RootClaim genesis输出KAS值用`CONT`常量

### 2.4 `buildClaimDrawTxJson`（④ `RootClaim.claim_draw`，仅full分支：`payout==pool_value`）

- **输入**：`[RootClaim(当前UTXO,CONT), 代币输入(owner=RootClaim covid,CONT), 赢家ticket(bettor
  自己那张,CONT), fee]`
- **输出**：`[KanetTokenClaim genesis(market_cov_id=RootClaim自己covid, winner_pk=ticket里的
  bettorPk, amount=payout,CONT), 代币转给新KanetTokenClaim(CONT,owner=该claim covid), fee找零]`
  ——**无RootClaim续约输出**（full分支代码不留root续约，见`RootClaim.sil`行166-171注释）
- **签名输入**：只有fee input——**ticket的花费本身不需要签名校验**（`claim_draw`只用
  `readInputStateWithTemplate`读ticket的State，没有对ticket输入做`checkSig`；这与
  covenant-construction-spec原文"ticketInIdx需要bettor签名"这句话不一致，是既有的、设计文档
  §1.3已标记过的"待NWT核实的技术点"——落码时须再次确认，若NWT/后续复核证实ticket确实不需要签名，
  这里就不需要构造签名witness；若证实需要，须在此处补上）
- **中止条件**：若实际场景`payout<pool_value`（partial），**立即停止，不构造**——partial分支的
  修复归属另一支（本文档0节已声明范围外）

### 2.5 `buildWithdrawTxJson`（⑤ `KanetTokenClaim.spend`）

- **输入**：`[KanetTokenClaim(当前UTXO,CONT), 代币输入(owner=本claim covid,CONT), fee]`
- **输出**：`[代币转出到目的地(to_market_input=false，普通新genesis输出，owner=witness指定的任意
  值，CONT), fee找零]`
- **签名输入**：`sig s`（赢家=committee keypair对`winner_pk`的签名，console侧算好编码进entry
  witness）+ fee input relay签名
- **无续约**（`.sil`头注"花后不续约,不受V-T-8影响"）

### 2.6 `buildTicketReclaimTxJson`（⑥ 输家ticket自我回收，`PoolSideTicket.authorize_spend`）

- **输入**：`[该ticket UTXO(CONT), fee]`——**单covenant输入**（这是本轮唯一一个只有1个covenant
  输入、没有代币/state输入的entry，形状与其它5个都不同）
- **输出**：`[代币/KAS转给bettor自己指定的地址（普通P2PK或新genesis，由调用方决定）, fee找零]`——
  **实测中fee input与该ticket UTXO甚至可以合并成一步付款**（见设计文档§0.14b"追加验证②"，NWT
  的真实构造是"单输入+单输出"，没有单独fee input，票本身的0.2 KAS减掉fee直接就是输出金额）——
  本builder按这个更简单的形状实现，不强行套用其它5个builder的"独立fee input"模式
- **签名输入**：`sig bettorSig`（bettor自己对`authorize_spend`的签名，`checkSig(bettorSig,
  pubkey(bettorPk))`）——**这是bettor自己的私钥，不是relay/committee的**，需要console侧UI/API
  层设计"如何让bettor提供自己的签名"这一步（本计划不代为设计前端交互，只覆盖builder+relay漏斗
  这一层；bettor签名的获取方式——是否复用现有`kasia-relay`托管的某个身份，还是要求bettor导入
  自己的私钥——是一个需要Owner/Bettor单独确认的产品问题，本文档标记为**待确认，不阻塞其它5个
  builder的实现**）
- **⚠️ fee计算陷阱（设计文档§0.14b/§7.1已警告，此处重申）**：**不能直接复用
  `computeRequiredFeeSompiOrThrow`**——该函数依赖kaspa-wasm本地`calculateTransactionMass`，对这个
  "单covenant输入+单P2PK输出"的极简形状本地mass被低估约9.5倍（本地814 vs 节点真实7,750）。
  **落码方案**：新增`computeTicketReclaimFeeSompiOrThrow`（或在通用函数里加一个"已知不可靠形状"
  的特判），按`SOMPI_PER_MASS × max(nwt观测的storageMass基线, computeMass基线)`打底，再加安全
  余量（比如×1.5或参照NWT实测的2,000,000 sompi直接做一个下限常量），并在合入前**必须**用
  `getMempoolEntry`对生产字节做一次真实mass核实（不能只信本地估算）——这条待办已经写进§7.1的
  builder表格"相关MUST"列，本计划重申为落码时的具体行动项。

---

## 3. DB迁移（v210，接v209之后）

```sql
-- v210 (2026-09-16, J2, 结算实现, 设计文档§2/实现计划§3, Owner D-022批准)
CREATE TABLE IF NOT EXISTS proto_settlement_intents (
  intent_key       TEXT PRIMARY KEY,          -- 'seal:<market_id>' / 'resolve:<market_id>' /
                                               --  'claim:<claim_id>:convert' / 'claim:<claim_id>:draw' /
                                               --  'claim:<claim_id>:withdraw' / 'ticket_reclaim:<ticket_id>'
  subject_type     TEXT NOT NULL CHECK (subject_type IN ('market','claim','ticket')),
  subject_id       TEXT NOT NULL,             -- market_id / proto_claims.id / ticket标识(bet_id)
  step             TEXT NOT NULL CHECK (step IN (
                     'seal','resolve',
                     'convert_to_claim','claim_draw','withdraw',
                     'ticket_reclaim'
                   )),
  depends_on       TEXT,                      -- 'resolve'依赖'seal'; 'claim_draw'依赖'convert_to_claim';
                                               --  'withdraw'依赖'claim_draw'
  status           TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','prepared','submitted','landed','ambiguous')),
  prepared_txid    TEXT, prepared_tx_json TEXT, submitted_txid TEXT,
  landed_depth     INTEGER, landed_at TEXT, last_error TEXT,
  created_at       TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proto_settlement_intents_subject ON proto_settlement_intents(subject_type, subject_id, step);
CREATE INDEX IF NOT EXISTS idx_proto_settlement_intents_status_updated ON proto_settlement_intents(status, updated_at);
```

**与设计文档§2原提案的差异**：①`step`CHECK去掉了`cancel_refund`/`convert_to_refundclaim`/
`refund_payout`（本轮范围外，见§0"不做的事"，等对应builder落码时再补，不在v210一次性加全）；
②新增`ticket`作为第三种`subject_type`（原提案只有`market`/`claim`两种，输家ticket回收是本计划
新增的第六个builder，需要一个新的subject归属）。**这条改动幅度不大但请Bettor审时特别确认**——
设计文档原提案没预料到"ticket回收"这个后来才发现的第六个builder。

**幂等性**：`CREATE TABLE IF NOT EXISTS`+`CREATE INDEX IF NOT EXISTS`，同既有v206-v209迁移块的
幂等纪律（重跑不报错）。不涉及既有表的`ALTER`，风险最低的一类迁移。

---

## 4. 驱动接线

- 新增`isProtoSettlementDriverEnabled()`（`proto-driver.mjs`）：`process.env.
  PROTO_SETTLEMENT_DRIVER_ENABLED==='1' && !!PROTO_RELAY_ID`——**独立于现有`isProtoDriverEnabled()`
  的开关**，不复用同一个环境变量（Owner裁定①"主网执行另走闸门"——独立开关就是这个闸门的具体实现，
  打开genesis/register_append的驱动不会连带打开结算驱动）。**默认关闭**（未设置环境变量时为
  `false`），主网执行前不得自动发起任何结算交易——这条本身不需要额外代码保证，是"默认值+显式判断"
  这个既有模式的自然延伸。
- tick处理沿用现有`proto-driver.mjs`的轮询结构，新增对`proto_settlement_intents`表`status='pending'`
  行的处理分支，按`depends_on`确认前置step已经`landed`才推进（`seal`无依赖；`resolve`依赖`seal`
  landed；`convert_to_claim`依赖`resolve`landed；`claim_draw`依赖`convert_to_claim`landed；
  `withdraw`依赖`claim_draw`landed；`ticket_reclaim`无依赖，随时可发起）。
- `market_seal`的触发条件`count==seal_count`已有（既有`proto_markets`表字段可查），不需要新增
  触发逻辑，只需要新增"触发后建intent行"这一步。
- `close_commit`/`ticket_reclaim`需要MUST-1的CLTV前置检查（"当前时间是否已经真实超过
  `deadline_ms`"）——驱动逻辑在构造前先做这个判断，不依赖"广播失败再重试"的被动模式（同设计文档
  §7.3既有要求）。

---

## 5. relay漏斗命令

`kasia-relay/src/lib/commands.mjs`新增6个`COMMAND_TYPES`（命名建议，Bettor可调整）：
`PROTO_SETTLEMENT_SEAL`/`PROTO_SETTLEMENT_RESOLVE`/`PROTO_SETTLEMENT_CONVERT_TO_CLAIM`/
`PROTO_SETTLEMENT_CLAIM_DRAW`/`PROTO_SETTLEMENT_WITHDRAW`/`PROTO_SETTLEMENT_TICKET_RECLAIM`——
**每个都必须同时在`COMMAND_FIELD_TYPES`里注册对应字段类型**（本仓lint `R-COMMAND-REGISTRATION`
现有WARN规则专门抓这种半截注册，落码时先跑一次lint确认不新增这类warning，不能只加COMMAND_TYPES
一半）。`proto-relay-ipc.mjs`的`PROTO_COMMAND_ALLOWLIST`同步加这6项。committee签名（`close_commit`）
与bettor签名（`ticket_reclaim`，若future需要`claim_draw`）这两类"非fee input"签名，需要在漏斗
命令层面明确区分签名者身份，不能全部走`signOnlyDeclaredInputs`的默认fee签名路径——具体接线方式
参照`covenant-broadcast.mjs`既有扩展模式，落码时现定，本计划不预先给出伪代码。

---

## 6. 测试与simnet验证清单

**每个builder落码后，缺一不可**：
1. 单元测试（`*.test.mjs`，同现有`proto-tx-assembly-register-append.test.mjs`模式）：覆盖正常
   构造路径 + 至少1个异常路径（fee不够/mass超限/找零形状选择fail-closed）。
2. `node scripts/lint-kanet.mjs <改动文件>` 0 error（含`R-COMMAND-REGISTRATION`等既有规则）。
3. **生产字节在simnet真实提交ACCEPT**——不能只用cli-debugger PASS或单测通过就合入（设计文档
   §0.13闸的既有纪律，§7.1六个builder表格逐条重申过）；日志/txid/mass数字入
   `docs/provenance/<日期>-j2-proto-v0-settlement-<builder名>-simnet-verify/`（同NWT既有provenance
   目录命名习惯）。
4. `close_commit`/`ticket_reclaim`：额外验证MUST-1的CLTV规则（committee/bettor签名input
   `sequence=0`，`lockTime`真实已过）——用simnet真实提交而不是debugger离线（debugger对
   `close_commit`的checkSig判定已确认不可信，见设计文档§0.10/§0.13）。
5. `ticket_reclaim`：额外用`getMempoolEntry`核实生产字节的真实mass/fee（见2.6"fee计算陷阱"），
   不能假设跟NWT审计构造那次完全一样。
6. implied fee恒等式独立复算（`Σinputs.utxo.amount − Σoutputs.value == 该形状选定的netLoss`，
   账本1455纪律，每个builder落码时都要加这个断言，不是可选项）。
7. 全部6个builder各自simnet ACCEPT之后，**再跑一次(A)路线6步+1步（含ticket回收）的完整端到端
   simnet链**，验证六个builder组合起来、按真实依赖顺序执行、用真实驱动接线（不是手写脚本逐步
   调用）也能跑通——这一步是"builder各自能用"与"驱动真的把它们正确串起来"之间的差距，缺了会
   在主网执行时才发现集成问题。

---

## 7. 分批提交顺序（按Owner建议的实现顺序，每批独立commit，lint 0 + 对应simnet证据齐了再提交下一批）

1. **DB迁移**（v210，§3）——最先做，风险最低，后续所有builder都依赖这张表存在。
2. **`proto-settlement-intent.mjs`**（§1.1，intent状态机helper）——单独一批，可以先用假数据/既有
   表做单测，不依赖任何新builder。
3. **`buildMarketSealTxJson`**（①）+ 对应witness模块（若市场封盘不需要新witness——`convert_to_
   rootclose`复用leaf自己的AB11声明宏，可能不需要单独的witness文件，落码时确认）+ simnet验证。
4. **`buildCloseCommitTxJson`**（②）+ `proto-close-commit-witness.mjs` + simnet验证——这是
   唯一涉及committee真实签名+CLTV两条MUST的builder，独立一批方便单独审查。
5. **`buildConvertToClaimTxJson`**（③）+ `proto-convert-to-claim-witness.mjs` + simnet验证。
6. **`buildClaimDrawTxJson`**（④，仅full分支）+ `proto-claim-draw-witness.mjs` + simnet验证——
   落码时先确认2.4节"ticket是否需要签名"这个待核实点，确认结果影响这一批的具体实现。
7. **`buildWithdrawTxJson`**（⑤）+ `proto-ktt-claim-spend-witness.mjs` + simnet验证。
8. **`buildTicketReclaimTxJson`**（⑥）+ `proto-ticket-reclaim-witness.mjs` + fee计算陷阱的
   专门处理（2.6节）+ simnet验证——放最后，因为它是设计文档发现最晚、跟其它5个builder耦合最少
   的一个，独立性最强，晚做不影响其它批次。
9. **驱动接线**（§4，`proto-driver.mjs`扩展）+ **relay漏斗命令**（§5，`commands.mjs`/
   `proto-relay-ipc.mjs`）——等六个builder都各自simnet验证过之后再接线，这样接线阶段只需要排查
   "串联逻辑对不对"，不用同时排查"builder本身对不对"。
10. **端到端集成验证**（测试清单第7条）——全部接线完成后，跑一次真正走驱动的完整simnet全链。
11. **主网执行**——集成验证通过后，走Owner裁定①"另走闸门"（`PROTO_SETTLEMENT_DRIVER_ENABLED`
    开关+这道闸具体如何触发，需要Bettor/Owner在实现完成后另行确认，本计划不预先设计这道闸的
    UI/触发方式）。

---

## 8. 待Bettor审时确认的开放点（不阻塞开始实现，但落码前最好有答案）

1. §1.3：`proto-tx-assembly-settlement.mjs`新文件 vs 塞进既有`proto-tx-assembly.mjs`——本计划
   倾向新文件，Bettor可以否决改成塞进旧文件。
2. §2.4：`claim_draw`消费ticket是否需要bettor签名（`covenant-construction-spec`原文与
   `RootClaim.sil`实际读到的source之间的既有分歧，设计文档§1.3已标记，本计划继承标记，不代为
   决定）。
3. §2.6：bettor如何提供自己的`authorize_spend`签名（复用relay托管身份 vs 要求bettor自己导入
   私钥）——产品问题，不影响其它5个builder，可以晚点定。
4. §3：`proto_settlement_intents`新增`subject_type='ticket'`这个设计文档原提案没有的分支，
   请确认可以接受。
5. §5：6个`COMMAND_TYPES`的具体命名，仅为建议，Bettor可调整。

写完计划，等Bettor审过再动手落码（铁律0）。
