> **Status**: CURRENT

# 原型 v0 后端 API 设计 v0.1（代币创世 / 市场创建 / 下注 / claim）

出处：`docs/2026-09-14-bettor-prototype-v0-scope-token-market-ui.md` §4 派工，J2 第二步交付。
先发 Bettor 审，过了再落码（Bettor 1332 硬要求：每个端点写明调哪个合约的哪个 entry；单列写表/daemon 一节）。

依赖前置交付：`docs/2026-09-14-j2-mainnet-sil-ctor-fields-v0.1.md`（ctor 字段清单）+
`kasia-console/scripts/mainnet-sil-set.json`（10 合约路径+sha256 单一声明）。

## §0 合约级约束 + Bettor 裁定（1335，取代此前的开放问题①）

`KanetTestToken.sil`（v0.6, `src/lib/sil-v1/KanetTestToken.sil:70-104`）的 `transferPolicy` 只留了 **"b-in"**
一条接收路径：每个 transfer 输出的 `owner` 必须满足 `ownerIsMarketInput(recv_idx[j], owner)`——即 `owner` 字段
声明的 covenant id，必须真实等于**本笔交易里某个市场模板输入**的 covenant id。v0.6 主动删掉了"转给任意另一个
人自己的持仓"（b-out）那条路（文件头注释：退路①解 V-T-6）。**推论**：一个 KTT genesis 输出的 `init_owner`
如果不是"某个已存在市场的 covenant id"，它就永远花不出去——代币铸造在合约层面天然是"为某个特定市场铸一笔
定向筹码"，不是先攒一个通用余额再到处花。

**Bettor 裁定（1335，取代原 (a)/(b) 二选一）**：拆成两层，而不是二选一——

- **"代币定义"**（`/tokens/create`）：名称/ticker/描述/默认面额，**只写 DB，不广播，不产生任何可花费链上
  余额**。这一层满足 Owner"代币属性配置需要界面互动"，同时不假装它是一个通用余额（诚实）。
- **"铸筹码"**：不是独立操作，是下注这个复合动作的第一半（§2.3），`owner` 直接绑定到下注目标市场的
  covenant id，元数据（名称/ticker）从代币定义带过去展示用。

否决了"代币页纯展示不可配置"的方向——配置权在定义层，链上实例（筹码）层不需要、也不应该再单独暴露配置项。

## §1 端到端流程（按 1335 裁定）

```
① 创建代币定义(纯DB) → ② 创建市场(ShardLeaf_direct genesis 空壳，绑定一个代币定义) →
③ 下注 = 复合动作: 铸定向筹码(KTT genesis, owner=市场cov id) → register_append spend →
④ 达到 seal_count 后 convert_to_rootclose → ⑤ 委员宣布结果(close_commit) →
⑥ 赢家 claim_draw / 输家或取消 refund_flip+refund_payout → ⑦ KanetTokenClaim.spend 提现
```

## §2 端点 × 合约 × entry 映射

### 2.1 `POST /api/proto/tokens` — 创建代币定义（纯 DB，不上链）

- **调用**：无——不构造任何交易，不碰 `KanetTestToken.sil`。
- **写表**：`proto_token_defs`（id, name, ticker, description, default_denomination, created_at）。
- **不碰**：任何链上路径、`pool_markets` / `market_shards` / `payout_shards` / relay 私钥路径。
- 这一层只是"配置模板"，界面上代币属性配置的互动全在这里；本身不产生可花费余额。

### 2.2 `POST /api/proto/markets` — 建市场壳（选一个代币定义）

- **调用**：无 entry（genesis）。
- **合约**：`ShardLeaf_direct`（`src/lib/ShardLeaf_direct.sil`）。
- **ctor 填法**：`market_id`=后端生成 UUID 编码；`ps_tmpl_hash`=协议常量（dust ticket 模板 hash，一次算出）；
  `shard_pool_id`=同 `market_id` 或独立生成；`seal_count`=**2**（v0 固定，见 §5 depth-1 cap 说明，界面可选但
  上限先钉 2）；`min_bet`=用户输入；`rootclose_tmpl_hash`=后端**先完整编译一份携带本市场 `committee_hash`/
  `deadline_ms`/`token_tmpl_hash` 等真实 ctor 值的 `RootClose` 模板**、取其 blake2b 锚（RootClose 此时并不
  上链，只是算出它未来存在时的模板 hash——同 `closeZkTmplAnchor`/`claim_tmpl_hash` 等既有"模板锚"手法，非
  新发明）；`rootclose_init_payoutRoot`=ZERO32；`token_tmpl_hash`=`KanetTestToken` 编译模板 hash（协议常量，
  与选中哪个代币定义无关——ctor 层面所有 KTT 实例共用同一份编译模板，代币定义只影响展示元数据）；
  `init_local_yes`/`init_local_no`/`init_count`/`init_pool_value`=0。
- **写表**：`proto_markets`（id, token_def_id(FK proto_token_defs), question(DB展示用), deadline_ms, min_bet,
  seal_count, committee_pubkeys(json, 5 项见§5), committee_privkey_ref, shardleaf_txid, shardleaf_vout,
  status='betting', rootclose_tmpl_hash, created_at）。
- **不碰**：`pool_markets` / `market_shards` / `payout_shards`。

### 2.3 `POST /api/proto/markets/:id/bet` — 下注（复合动作：铸筹码 + spend，两笔链上交易）

**这是唯一一个内部两步、需要显式失败态处理的端点。** 前端一个按钮，后端顺序做两件事，每步各自的 txid 回显给
前端；**NO-TX-NO-STATE 铁律要求**：第二笔没落链之前，绝不能把 `proto_bets` 记成"已下注"完成态。

**步骤 A — 铸定向筹码**：无 entry（genesis）。合约 `KanetTestToken`。`init_amount`=下注金额；`init_owner`=
本市场 `ShardLeaf_direct` 的 covenant id（后端计算，非用户输入）；`init_owner_scheme`=`SCHEME_COVENANT_ID`；
`init_borrow_scheme`=`BORROW_DISABLED`；`init_borrow_guard`/`init_extension_commitment`=ZERO32；
`market_tmpl_suffix`/`_len`=协议常量（§4）；`max_ins`/`max_outs`=协议常量。名称/ticker 从
`proto_markets.token_def_id → proto_token_defs` 带出，纯展示，不进 ctor。

**步骤 B — spend 进市场**：`entry register_append(side, stake, leafOutIdx, psOutIdx, bettorPk, ps_prefix,
ps_suffix, stakeInIdx, tok_out, tok_prefix, tok_suffix)` on `ShardLeaf_direct`。输入 = 当前市场
`ShardLeaf_direct` UTXO（`proto_markets.shardleaf_txid/vout`）+ 步骤 A 刚铸的 KTT UTXO（`stakeInIdx`）。输出 =
consolidated `ShardLeaf_direct` continuation（手写 AB11 形 state 编码，非 `validateOutputState`，见
`ShardLeaf_direct.sil:150-158` 注释）+ dust ticket 输出（`Tk{bettorPk, direction:side, stake, shardPoolId}`）。

**失败态矩阵**：

| 情形 | 处置 |
|---|---|
| A 广播失败（未上链） | 不写 `proto_bets` 任何行；报错给前端，允许原样重试（视为从未发生） |
| A 已上链、B 未发起（进程崩/网络断） | `proto_bets` 写一行 `status='chip_minted_pending_stake'`，记 A 的 txid+vout；界面显示"续做下注"按钮，**重放用同一笔 A 的 UTXO 走步骤 B，不重铸** |
| A 已上链、B 广播失败（未上链） | 同上——B 失败不影响 A 已铸成的筹码，UTXO 仍在，允许重试步骤 B（幂等：`stakeInIdx` 指向的 UTXO 若已被花费则查链上是否已存在对应 `register_append` 结果，避免双花重复计入） |
| A、B 均已上链 | `proto_bets` 更新为 `status='confirmed'`，记 A+B 两个 txid |

**写表**：`proto_bets`（id, market_id, bettor_pk, side, stake, mint_txid, mint_vout, ticket_txid, ticket_vout,
stake_tx_id, status, created_at, confirmed_at）；`UPDATE proto_markets SET shardleaf_txid=?, shardleaf_vout=?`
（仅在 B 确认后推进当前 UTXO 指针）。

### 2.3.1 NWT 保留项答复（1336，落码前必须满足）

**MUST：中间态接既有 intent 机制**——`submit-intent.mjs`（`src/lib/submit-intent.mjs`）是全仓这一类问题
的既有权威解法（prepared→submitted→landed 状态机、同字节重播、inputs_spent 时"查 kaspa_tx_log 正向证据、
查不到就 AMBIGUOUS/HOLD 不重建"），但它的 schema（`target_address`+`amount_kas`，围绕 relay 的 plain
`transfer` IPC 设计）装不下覆盖两笔"覆盖候选(genesis 输出 / entry-spend 原始交易)"的形状——**不改
`submit_intents` 表本身**（它是生产 payout/escrow 在用的表，不该为原型加不相关列），而是新建
**`proto_bet_intents`** 表，照抄同一套状态机哲学（`status` ∈ `pending/prepared/submitted/landed/ambiguous`，
`prepared_tx_json` 落地即可同字节重播，"查不到证据≠可以重建"同一条纪律），但两行覆盖 A（铸筹码）与 B
（register_append）两步，`b_intent` 行的 `depends_on` 指向 A 行的 intent_key，B 只有在 A 行 landed 后才允许
从 pending 转 prepared。重启捡回复用同样的 `resumeStaleIntents` 思路（新写一份专属版本，因为 A/B 两步的
"landed 判定"不是简单的 address watch，而是查特定 outpoint 是否仍未花费——见下）。

`landed` 判定：A（genesis 新输出）用 `check_utxo_landed`-同类查询判该 outpoint 是否已确认存在；B（entry-spend）
判该 tx 是否已确认花掉 A 的那个 outpoint（`kaspa_tx_log` 或直接查 A 的 outpoint 是否已被消费）。这部分需要
一个新的轻量 helper（`checkOutpointLanded` / `checkOutpointSpent`），落码阶段与 relay 侧 IPC 接口对齐，NWT
另审。

**保留项①：`register_append` 的真实鉴权 require 列表**（`ShardLeaf_direct.sil:114-160`）：

```
require(count < seal_count);
require(side == 0 || side == 1);
require(stake >= min_bet);
validateOutputStateWithTemplate(psOutIdx, Tk{bettorPk, direction:side, stake, shardPoolId}, ps_prefix, ps_suffix, ps_tmpl_hash);
int owned_total = scanOwnedTokenInputs(tok_prefix, tok_suffix); require(owned_total == pool_value);
TokenState stakeTk = readInputStateWithTemplate(stakeInIdx, ...); require(stakeTk.amount == stake);
validateOutputStateWithInputTemplate(tok_out, TokenState{amount: pool_value+stake, owner: OpInputCovenantId(this.activeInputIndex), ...}, stakeInIdx, ...);
// + 手写 AB11 state continuation 核对 leafOutIdx 的 scriptPubKey
```

**如实结论（不回避）**：这里**没有针对 `stakeInIdx` 那个 token 输入的签名校验，也没有校验 `bettorPk` 与该
token 的"真正所有者"有任何绑定关系**——`bettorPk` 是调用方自由填写的 witness 参数。这意味着：TX1（铸筹码）
落链后到 TX2（register_append）确认前的窗口内，**任何看得到这条链的人都可以抢先构造自己的 TX2**，把
`bettorPk` 填成他们自己的公钥，把这笔已铸的筹码算作"他们的"下注——受害者的钱仍然合法进了市场池（金额没有
被凭空拿走），但受害者**拿不到下注凭证（dust ticket），后续也就无法 claim**，实质等价于被抢走了这次下注
的资格。**这是真实存在的竞态，不是我判断错——v0 范围稿 §2 已明确"完整红队审查不在本任务"、Owner 直令
"安全/漏洞留后面"，本竞态记为已知限制，不在 v0 修**：v0 是单操作员顺序操作（没有第二方在监听 mempool 抢跑），
实际发生概率为零，但**这条边界必须写清楚，不能让下一轮误以为"两步都发了就是安全的"**。生产化前必须补
签名绑定（如 `bettorPk` 对应的私钥对 TX2 签一个覆盖 `stakeInIdx` 的 witness，或改用 P2PK 式的所有权证明）。

**保留项②：会不会有"一次性字段"被别人的成功注册消耗、导致 TX2 永远接不上**——**有，且已确认会发生**：
`count`（`ShardLeaf_direct` 的 state 字段，每次成功 `register_append` +1）就是这个"一次性/可耗尽"字段，
门槛 `require(count < seal_count)`。若在 TX1 落链到 TX2 确认之间，**别人的 `register_append` 先把
`count` 推到 `seal_count`**（v0 固定=2，见 §5），本笔 TX2 会在这条 require 上 revert；更进一步，若市场已经
被 `convert_to_rootclose` 转走（`ShardLeaf_direct` 那个 UTXO 已花费、不再存在），TX2 连"能不能重试"都无从
谈起——**这笔已铸的筹码永久孤儿化，当前 9 个合约里没有任何入口能把它要回来**（`KanetTestToken.transferPolicy`
仍然要求接收方是"该 owner 声明的市场输入"，而那个市场实例已经不是可花费的 UTXO 了）。**v0 处置**：不修（补
一条"孤儿筹码回收"entry 是合约层改动，超出本轮范围）；后端在**发起 TX1 之前**先查一次
`proto_markets.status`/`count` 是否仍在 betting 且未满，降低触发概率（不是消除，只是给单操作员场景一个
额外的心智提示）；`proto_bets` 状态机加一个 `orphaned_chip` 终态，界面如实显示"这笔铸币孤儿化，资金锁死在
链上，非本轮范围可修"，不假装能恢复。

**达到 seal_count 后**：单独一次操作员触发的动作（非本端点自动串联，避免把"下注"和"封盘"两个不同权限/时机
的动作揉进一个请求）：

**`entry convert_to_rootclose(rcOutIdx, rc_prefix, rc_suffix, tokenInIdx, tokenOutIdx, tok_prefix, tok_suffix)`**
（同文件），把 `ShardLeaf_direct` 转成真正的 `RootClose` genesis（用 §2.2 算好的 `rc_prefix`/`rc_suffix`
witness 供）。`UPDATE proto_markets SET status='sealed', rootclose_txid=?, rootclose_vout=?`。

### 2.4 `POST /api/proto/markets/:id/resolve` — 委员宣布结果（v0 单操作员模拟委员会，见 §5）

- **调用**：`entry close_commit(c0Pk..c4Pk, c0Sig..c4Sig, rootOutIdx, new_winningSide, new_payoutRoot,
  tok_prefix, tok_suffix)`。
- **合约**：`RootClose`（`src/lib/RootClose.sil`）。
- **`new_payoutRoot` 计算**：复用既有 `kasia-console/src/lib/pool-payout-root.mjs`（`payoutLeaf` /
  `levelsOf` / `payoutRoot`）——depth 上限 1（2 叶子），赢家分全池（v0 不切协议费，`payout = pool_value` 全归
  唯一或最多两位赢家均分，具体分账规则界面显示清楚即可，非本设计要点）。
- **写表**：`proto_markets` 更新 `status='resolved'`, `winning_side`, `payout_root`, `rootclose_txid/vout`。
- **取消路径**（deadline+grace 后无人 resolve）：`entry refund_flip(rootOutIdx, tok_prefix, tok_suffix)`，
  `status='cancelled'`。

### 2.5 `POST /api/proto/markets/:id/claim` — 赢家/退款人领取

- **赢家路径**：`entry claim_draw(rootOutIdx, claimOutIdx, tokenInIdx, tokenOutIdx, remainTokenOutIdx, payout,
  merkle_index, tree_depth, siblings, ticketInIdx, ticket_prefix_len, ticket_suffix_len, tok_prefix, tok_suffix,
  claim_prefix, claim_suffix)` on **`RootClaim`**（`RootClose.convert_to_claim` 先把 `RootClose` 转成
  `RootClaim`，同一请求链式调用，或分两步——本设计建议分两步更好排错：先 `convert_to_claim`，界面显示"可
  领取"，再 `claim_draw`）。
- **退款路径**：`entry refund_payout(...)` on **`RefundClaim`**（先 `RootClose.convert_to_refundclaim`）。
- 两条路径的落地目的地都是新建 **`KanetTokenClaim`** 输出（`ClaimState{market_cov_id, winner_pk, amount,
  token_tmpl_hash, market_suffix_hash}`）。
- **写表**：`proto_claims`（id, market_id, bettor_pk, claim_txid, claim_vout, amount, claimed_at）。

### 2.6 `POST /api/proto/markets/:id/withdraw` — 从 claim covenant 最终提到自己名下

- **调用**：`entry spend(sig s, tok_in_idx, tok_out_idx, to_market_input, dest_idx, tok_prefix, tok_suffix,
  market_suffix_witness)`。
- **合约**：`KanetTokenClaim`（`src/lib/KanetTokenClaim.sil`）。
- 需要赢家自己的签名（`sig s`）——v0 界面上"claim"按钮实际触发这一步，界面持有的是哪个 keypair见 §5。
- **写表**：更新 `proto_claims.withdrawn_at`, `withdraw_txid`。

### 2.7 只读端点

`GET /api/proto/tokens`、`GET /api/proto/markets`、`GET /api/proto/markets/:id`（含 bets/claims 列表）——纯
`SELECT`，零链上写。

## §3 表设计：完全隔离的新命名空间

**新表前缀 `proto_`**（与生产 `pool_markets` / `market_shards` / `payout_shards` / `pool_bettor_sides` /
`pool_committee` / `exchange_offers` 零共用、零外键指向）：

| 表 | 用途 |
|---|---|
| `proto_token_defs` | 代币定义（名称/ticker/描述/默认面额）——纯 DB，不对应任何链上实例 |
| `proto_markets` | 市场壳 + 当前 UTXO 指针 + 状态机 + FK 指向一个 `proto_token_defs` |
| `proto_bets` | 每笔下注（铸筹码+spend 两步复合动作的最终状态，含 `orphaned_chip` 终态）+ dust ticket 指针 |
| `proto_bet_intents` | §2.3.1：A/B 两步各自的 prepared/submitted/landed/ambiguous 状态机（照抄 `submit-intent.mjs` 哲学，独立 schema） |
| `proto_claims` | 每笔 claim/refund + withdraw 状态 |

`migrate.js` 新增 v205（当前 v204，落码时按最新版本接）。

### §3.1 生产结算 daemon 绝对碰不到这些表——逐条核实

`bshard-settle-daemon.mjs` 的"选熟盘"主查询硬编码在 `pool_markets`（`WHERE protocol_version = 'v0.7'`，
`src/services/bshard-settle-daemon.mjs:616-617`），以及对 `market_shards` / `payout_shards` / `pool_bettor_sides`
的下游查询（同文件 209/804/821 行等）——**这些表名与 `proto_*` 没有任何交集，SQL 层面结构性碰不到**，不是
"过滤掉"，是"根本不存在于它的 FROM/JOIN 列表里"。其余生产 daemon（`market-seeder.js` / `prediction-voter`
一类）同理，均按各自硬编码表名工作，零通用"扫描全部市场类表"的代码路径。

**⇒ 原型市场对生产 ZK 结算线（结构性）不可见，符合范围稿 §2"绕开 ZK 路径"的要求，且不需要额外开关/白名单
——隔离靠的是表名本身不重叠，不是运行时判断。**

## §4 协议常量的一次性计算

以下值对所有市场/代币通用，只需算一次、写死在后端常量文件里（同 `pool-shard-register.mjs` 里
`computeCloseZkTmplAnchor` 等既有"模板锚"计算的手法，不新发明机制）：

- `KanetTestToken` 编译产物的 `market_tmpl_suffix`（其字节码尾部，需先编译一份 `ShardLeaf_direct` 拿到共同
  尾部常量）。
- `ShardLeaf_direct` 的 `ps_tmpl_hash`（dust ticket 模板）。
- `token_tmpl_hash` = `KanetTestToken` 编译产物的 blake2b 锚。

这部分需要一个新的 `scripts/proto-v0-template-anchors.mjs` 一次性计算脚本（只读，产出写进
`kasia-console/scripts/proto-v0-template-anchors.json`，落码阶段单独一笔提交，NWT 审）。

## §5 v0 简化：单操作员模拟 5-委员会 — **已裁定（Bettor GREEN-with-rulings，本轮）**

`RootClose.close_commit` 要求 4-of-5 委员签名（`c0Sig..c4Sig` 对 `c0Pk..c4Pk`，且
`blake2b(c0Pk+c1Pk+c2Pk+c3Pk+c4Pk) == committee_hash`）。**裁定：v0 接受**市场创建时后端生成**一个**测试用
keypair、`c0Pk..c4Pk` 全部填同一个公钥（合约代码里没有"5 个 pubkey 互不相同"的显式 distinctness 检查，
`validSigs>=4` 用同一把 sig 验 5 次即可全过）——**条件**：① NWT 落码审时独立确认合约无 distinctness 检查
这一读码结论（不是我一个人说了算）；② `committee_privkey_ref` **不落明文**，用 `src/services/crypto.js` 的 `encrypt`/`decrypt`（`CONSOLE_ENCRYPTION_KEY`
派生，`relay_nodes` 表私钥列已在用同一对函数）存——复用既有加密工具函数，不是复用 `relay_nodes` 表本身：
私钥仍然独立于 relay 系统，只是加密/解密走同一份已审过的库函数，不用另造一套明文/弱加密存储。

**这是刻意的简化，不是漏洞遗留**——生产委员会机制（真正的去中心化 5 独立委员）不在 v0 范围内。

## §6 KAS 侧资金来源 — **已裁定（B′，Bettor GREEN-with-rulings，本轮）**

上述每一笔链上操作（genesis dust 输出、covenant 续约 KAS weld ≥DUST_MIN）都需要一个真实付 KAS 的输入/找零
来源——KTT 代币本身不承载 KAS 价值。**两个此前提出的方案都被否决**：

- ~~(A) 复用生产 fee-relay 签名通道~~ —— 否决：原型 bug 直接耦合到持真钱的 relay，违反范围稿 §3 精神。
- ~~(B) console 进程内自持私钥独立签名~~ —— 否决：违反架构铁律"Relay 是唯一链上出口 / Console 不碰链"
  （`CLAUDE.md`"必读：安全审查遗留问题"第 2 条），且要新造一套明文密钥存储机制。

**裁定 (B′)：建一个专属原型 relay 身份**（名字前缀 `proto-`，**由操作员经既有 relay 导入路径一次性创建**——
这是操作员在既有 UI 上的手动动作，不是本轮新写的代码路径；Owner 转入 ≈2 KAS 种子资金）。原型后端只经**既有
relay IPC 通道**（`sendCommand`/`sendCommandAsync`，同生产代码复用的同一套机制，非新开端点）对**这一个**
relay 发交易构造/签名请求。

**硬闸**（落码时必须实现，不是建议）：
- `PROTO_RELAY_ID` 由 env 变量钉死，后端代码**不接受请求体传入 relay_id**（杜绝调用方指定任意 relay，同
  T-LOOPBACK-AUTHZ 那批热修堵的洞是同一种形状，这里从设计层面直接不留这个参数）。
- 每次发交易前**断言**：该 relay 的 `name` 以 `proto-` 开头 **且** 链上余额 `< 5 KAS`——两条任一不满足
  fail-closed 拒发（防止原型代码不小心配置指向了某个真实生产 relay，或该 relay 意外被转入大额资金）。

这样资金隔离（专属身份、金额上限）+ 架构合规（走既有 relay 签名通道，不新造明文密钥存储、不违反
Console-不碰链）同时满足。

## §7 §3 边界自查清单（供 NWT 轻量核对照，按 §5/§6 裁定更新）

- [ ] 零新增 `import` 来自 `relay-manager.js` 的 `startRelay`/`stopRelay`/私钥相关导出。
- [ ] 零调用 `/relays/*` `/api/relay/*` 系列端点（HTTP 内部调用或直接函数调用均不算）。
- [ ] 零读取 `ADMIN_SECRET_*` 环境变量。
- [ ] §5 的测试 keypair 私钥用 `relay_nodes` 同款加密 helper 存进 `proto_markets` 自己的字段，不进
      `relay_nodes` 表本身，不被 `relay-hotwallet-monitor.js` 或任何健康检查扫描到。
- [ ] §6 (B′)：`PROTO_RELAY_ID` 确实由 env 钉死、代码路径里搜不到任何"请求体 relay_id 直接喂进发交易函数"
      的形状；每次发交易前的 `name` 前缀 + 余额上限双重断言确实在广播前执行、fail-closed。

## §8 已知限制（不得漂成"已处理"——落码/交付材料引用本节须原样带走这句话）

1. **T-PROTO-BETTORPK-BINDING**（§2.3.1 保留项①）：`register_append` 的 `bettorPk` witness 参数与
   `stakeInIdx` 那个代币输入之间**没有签名绑定**，TX1（铸筹码）落链到 TX2 确认之间存在真实抢跑窗口。
   **v0 单操作员场景接受**（没有第二方在监听 mempool 抢跑，实际发生概率为零）——**任何第二方/多用户场景
   参与前必须先修这条**，不是"以后有空再说"的一般性技术债。
2. **T-ORPHAN-CHIP-RECOVERY-ENTRY**（§2.3.1 保留项②）：`count` 字段可被并发下注耗尽，导致已铸筹码永久
   孤儿化，当前 9 个合约里**没有任何入口能追回**。v0 处置 = 发起 TX1 前的预检（降低触发概率，不消除）+
   `proto_bets.orphaned_chip` 终态如实展示。**这是合约层缺口，需要新增一个回收 entry 才能真正解决**，不在
   本轮范围。

## §9 新增 relay 命令 `covenant_broadcast`（ledger 1347，与 §6 一起报 Owner）

`proto-bet-intent.mjs` 的 `resolvePrepared`（同字节重播分支）需要一个能广播"调用方已经构造好的任意
签名交易"的 relay 命令——**这个命令目前不存在**。核实过 `kasia-relay/src/lib/commands.mjs:197-199`：
`replay_tx_json`/`prepared_txid`/`intent_key` 三个字段只挂在既有 `TRANSFER` 命令类型上（转账语义，
`target`+`amount`），没有通用形态。**这改变了 §6 的决策账**：无论选 (B′) 还是 (C)，都需要在 kasia-relay
新增这个命令，不再是"零新代码"。

### §9.1 命令名与语义：`covenant_broadcast`

- **输入**：
  - `tx_json`：已构造（未签或半签）交易的 JSON 表示（同 kaspa-wasm `Transaction` 可序列化形态，
    inputs/outputs/scriptPubKeys 齐全，covenant 侧的 witness/sigScript 由调用方在构造阶段填好，
    relay 不碰这部分）。
  - `sign_input_indices`：需要 relay 用自身私钥签名的输入索引清单（通常只有"花费 relay 自己持有的
    KAS 那一个输入"需要签，covenant 相关的输入已经带着自己的 witness，不需要 relay 签）。
  - `expected_txid`：期望的最终 txid（finalize 后），用于同字节重播断言——**同 `TRANSFER` 命令
    `prepared_txid` 的既有契约**，relay 侧断言重播产出的 txid 必须等于这个值，不相等即拒绝（防止
    "同一个 intent_key 重播出两笔不同的交易"这种双花窗口）。
  - `intent_key`：复用 `TRANSFER` 已经验证过的两阶段回执机制（`prepared` 在广播前落表，`submitted`
    在广播后落表——`lib/submit-intent-relay.mjs` 那一套，`covenant_broadcast` 直接复用，不重新发明）。
- **输出**：`{ok, txId, fee, code, error}`，与 `TRANSFER`/`custodial_transfer` 现有回执形状一致。

### §9.2 安全约束

1. **只签 `sign_input_indices` 列出的索引**，其余输入原样保留——防止调用方哄骗 relay 签一个它没被
   要求签的、意料之外的输入。
2. **净损耗守恒公式（NWT 1352 打回重写，原"存在一个付回自身的输出"表述可被绕过：relay 签一笔 1 KAS
   输入，输出 A 付 0.00001 KAS 回自己满足"存在性"、输出 B 把 0.99999 KAS 转去任意地址，relay 净损
   ≈1 KAS 而旧表述挡不住这个）——两条互相独立、缺一不可**：

   ```
   net_loss = Σ(relay 签名的 input.value) − Σ(outputs 中 scriptPubKey == relay 自身地址 的 value)
   require(net_loss ≤ FEE_CEILING)         // 硬编码常量, 量级 = 一笔真实手续费(几千 sompi), 远小于 0.5 KAS
   require(Σ(relay 签名的 input.value) ≤ SIGNED_INPUT_CEILING)   // 0.5 KAS——防止即使 net_loss 算对, 签一笔巨额输入本身也是风险(如输入被恶意 UTXO 污染/女巫)
   ```

   `net_loss` 卡的是"这笔交易到底净花掉了 relay 多少钱"（即使找零精确到自己地址、总输入很小，也不能让
   净损耗超过手续费量级）；`SIGNED_INPUT_CEILING` 卡的是"relay 一次性签名暴露的总价值上限"（两者是不同
   的量、不同的攻击面，分开写清楚，不用一条描述性语言笼统带过）。
3. **执行权限**：(B′) 形态下，只允许 `PROTO_RELAY_ID` 那一个 relay 执行该命令（其余 relay 收到直接
   拒绝，同 T-LOOPBACK-AUTHZ 那批热修"专属 tier"的思路）；(C) 形态下，该命令只在独立 proto relay 进程
   里注册，生产 relay 完全不认识它——两种形态都确保"生产 relay 永远不会被这条命令误用"。

### §9.3 (B′) vs (C) 改动量表

| | (B′) 复用现有 relay 基础设施 | (C) 独立 proto relay 进程 |
|---|---|---|
| 碰 `relay-manager.js`？ | 否——权限检查直接在 `relay.mjs` 的命令 handler 里做（"只有 `PROTO_RELAY_ID` 才认这条命令"），不需要新的启动/准入逻辑 | 否——完全平行体系，`relay-manager.js` 不知道这个进程存在 |
| 碰 `relay_nodes` 表结构？ | 否——不改 schema，只是走既有导入流程新增一行数据（`name` 前缀 `proto-`） | 否——这个进程根本不进 `relay_nodes` 表 |
| 新增/改动文件 | 3 个：`commands.mjs`（+1 行字段注册）、`relay.mjs`（+1 个 `case` 分支，~50-80 行，含两阶段回执+§9.2 约束校验）、新文件 `lib/covenant-broadcast.mjs`（核心签名+校验逻辑，~100-150 行） | 5-8 个：全新独立入口脚本（如 `proto-relay.mjs`，需要重新实现自己的 IPC dispatch/私钥加载/广播逻辑，即使复用 `sendKaspa` 等既有库函数，胶水代码不少）+ 对应的命令处理模块 |
| 运维复杂度 | 低——现有 relay 进程多认一个命令 | 高——多一个独立进程要启动/监控/纳入健康检查 |
| 代码信任基础 | 高——复用已经过 T-LOOPBACK-AUTHZ 等审查的现有 relay IPC 骨架 | 低——新写的并行基础设施没有跟现有 relay 同等程度的审查历史 |

**（B）console 内自持私钥独立签名**已在 §6 否决（违反"Relay 是唯一链上出口"架构铁律），不再进这张表。

### §9.4 与 `proto-bet-intent.mjs` `resolvePrepared` 的接口契约

`src/lib/proto-bet-intent.mjs` 当前的占位代码（`resolvePrepared` 同字节重播分支）：

```js
rep = await sendCmd(relayId, {
  type: 'broadcast_raw_tx', intent_key: key, replay_tx_json: row.prepared_tx_json, prepared_txid: txid,
}, undefined, origin);
```

命令定案后，**只需要把 `type: 'broadcast_raw_tx'` 改成 `type: 'covenant_broadcast'`**——`replay_tx_json`/
`prepared_txid` 两个字段名刻意沿用 `TRANSFER` 已验证过的同字节重播契约，`rep.txId`/`rep.code ===
'inputs_spent'` 等返回值判断逻辑也完全复用，`resolvePrepared` 函数本体不需要因为换了命令类型而改
一行逻辑，只改这一个字符串常量。首次构造（pending→prepared→submitted）那一半不经过 `resolvePrepared`
——由调用方注入的 `buildAndBroadcast` 回调自己发送首次 `covenant_broadcast`（带 `tx_json`/
`sign_input_indices`/`expected_txid` 等构造专属字段），并在真正广播前先调 `recordBetIntentPhase('prepared', ...)`
落表，这一点与 `submit-intent.mjs` 的既有约定完全一致，不是新规则。
