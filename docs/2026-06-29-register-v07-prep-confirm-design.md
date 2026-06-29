# register-v07/prep+confirm 设计 — bot 0-custody 滚动分片押注（无限·全 v0.7）

> **Owner 钦定 2026-06-29**: 全 v0.7·retire v0.5/v0.6 押注路·测试网·决断模式（bug 不怕·但不 ship 明知 strand/锚错 root 的码）。
> **目标**: bot 押注从单片 capped(register-v06·50 上限) → 滚动分片(register-v07·满片自动开新片·无限)。
> **分工**: J2 = 资金模型/接口/state-machine/编排(本文档)。J1 = covenant/分片/守恒 section(`.claude-scripts/j2-review/register-v07-prep-confirm-J1-covenant-section.md`·合并)。
> **实现**: fresh 清醒会话照此 + J1 covenant section 秒接·J1 co-author covenant + co-verify shard 守恒·Bettor 审+co-verify。**守线: 不 ship 明知 strand 的码**。
> **代码源(真相·勿凭记忆)**: register-v06/prep+confirm `pool.js L1717-1850`·register-v07(单调 gateway-custody) `pool.js L1103-1220`·registerBettorOnShard `lib/pool-shard-register.mjs`。

---

## 1. 现状 + 缺口（读 canonical 实证）

- **bot 押注走 register-v06/prep+confirm**(console-api.mjs L97·0-custody 两步: prep 算 side_p2sh+exact_stake → 用户付 → confirm 链上验付款→插 pool_bettor_sides)。**对 v0.7 也用**(dual-handle L1726)·但存**单片 PoolSide 在 logical 键** + **50-cap**(L1733 `bettorCount>=50`·按 logical COUNT)。**不滚动**。
- **register-v07**(L1103) = 真滚动分片(registerBettorOnShard·满片 SHARD_SEAL_COUNT=32 自动开新片·无限)·**但是单调原子 + gateway-custody**(bettor relay 给 gateway·gateway 自己 transfer+build)·**无 /prep 无 /confirm**(L1095 标 TODO 批3 从没建)。bot 的 0-custody 用户自付流用不了它。
- **缺口 = register-v07 的 0-custody 两步流(prep+confirm)从没建**。这就是 bot 回退用 v06 的原因(非故意选旧)。

## 2. 新端点：register-v07/prep + register-v07/confirm（0-custody·镜像 v06 但路由分片）

### 2.1 register-v07/prep（算地址·无状态变更·NO TX）
`POST /api/pool/market/:id/bettor/register-v07/prep`  (:id = logical market id)
- **入参**(同 v06/prep): `{ linked_addr | bettor_pk, direction(0/1), stake_kas }`。
- **逻辑**:
  1. market 存在 + protocol_version==v0.7 + status==pending_bettors + 有 pool_merkle_root(committee)。
  2. **commingled guard**(assertNotCommingled·同 v06)。
  3. **🔴 NO 50-cap**（这是关键差异·滚动无限）。改为: 选当前 open shard(allocateForRegister 的"挑片"逻辑·只读版)·确认它有空位 OR 会开新片(count<32 或 roll)。
  4. 算 **side_p2sh**(bettor 付款目标地址) + exact_stake + redeem_script —— **见 §3 命门: side_p2sh 必须 prep 时可定·且要么 shard-无关·要么 confirm 落同片**。
- **返回**(镜像 v06/prep·让 bot 复用渲染): `{ ok, protocol_version:'v0.7', market_id, shard_market_id(落片), direction, bettor_pk, side_p2sh, redeem_script, pool_merkle_root, exact_stake_sompi, exact_stake_kas, network, deadline, warning }`。
  - 比 v06/prep 多 `shard_market_id`(confirm 要用·锁定 prep 算的是哪片)。

### 2.2 register-v07/confirm（验付款 → splice 上片）
`POST /api/pool/market/:id/bettor/register-v07/confirm`
- **入参**(同 v06/confirm + shard 锁): `{ linked_addr | bettor_pk, direction, stake_kas, shard_market_id(prep 返的) }`。
- **逻辑**:
  1. 链上验: 付款到 side_p2sh + amount==exact + UNIQUE tx(三验·同 v06/confirm)。
  2. 验通过 → 调 **registerBettorOnShard**(L1211 签名: db,rc,transfer,landed,p2sh,logicalMarketId,poolMerkleRoot,predicateCommit,bettorPk,direction,stakeSompi,relayAddr,silverc,sealCount:32,deadline,createShardMarketRow,recordBettor) splice 进 ShardLeaf(满片 auto-roll 开新片)。
  3. 插 pool_bettor_sides **在 shard_market_id 键**(非 logical·= bshard 正确存法·getMarketBets shard-aware 读它)。
  4. **NO TX NO STATE**: registerBettorOnShard 的 splice tx 必 landed 才算注册成功·未上链不插 DB。
- **返回**: `{ ok, logical_market_id, shard_market_id, bettor_pk, ...result }`。

## 3. 🔴 命门: side_p2sh 的 prep-时可定性 + shard 落点一致性（J1 covenant 侧定·我标问题）

**问题**: 0-custody 要用户在 prep 后、confirm 前**付款到一个已知 side_p2sh**。但 bshard 押注最终 splice 进某 shard 的 ShardLeaf。两种可能:
- **(a) side_p2sh shard-无关**(只由 bettor_pk+direction+stake+market 派生·不含 shard id): 则 prep 算地址安全·confirm 落哪片都用同地址 → **无 race·首选**。
- **(b) side_p2sh shard-specific**(含 shard 的 ShardLeaf 状态): 则 prep 算的是 shard N 的地址·若 prep→confirm 间 shard N 被别人填满 → confirm 的 registerBettorOnShard roll 到 N+1 → **side_p2sh mismatch**(用户付到 N 的地址·bet 该在 N+1) = **race·要处理**。

**🟢 §3 已解 = shard-无关付款地址·allocate-at-confirm·无 race·无 TTL**(J1 covenant 2026-06-29 读真实 register_append 定·背书进文档):

**🔴 covenant 事实修正(关键·改我原假设)**: ShardLeaf register = **stake 折进 state-spliced leaf**(pool-register-builder: `leaf.pool_value += stake`·`leaf UTXO value += stake`)。**stake 在 leaf·不在 PoolSide**(dust PoolSide ticket 只是 spent-once claim 标记)。register_append = relay 原子构造(reveal 当前 leaf → 折 stake 进 → 新 leaf 续体 + dust ticket)。∵ leaf 地址 state-spliced 随 append 变 → **bettor 无固定地址直付进 covenant**。∴ side_p2sh【非】v06 式 PoolSide 地址。

- **prep 付款地址 = shard-无关的中间持有 UTXO**(relay 控制·bettor 付到它·relay 在 confirm fold 时折进选中的 leaf)。非 shard 叶地址(那个 append 时变)·非 v06 PoolSide。**∵ shard-无关 + shard 在 fold 时才选 → 不存在"付到某片然后片满"的 strand**(prep↔confirm 间该片封了·confirm allocate 别的/新片·bettor 付款不受影响)。
- **confirm = allocate-at-fold·无锁无 TTL**(J1 背书·最简 strand-free): detect 付款到 prep 中间地址 → `allocateForRegister`(此刻选 open 片·满则 roll) → `register_append` 原子折入 leaf → 插 pool_bettor_sides@**实际落的** shard_market_id(非 prep stale)。现成 serialize 够: allocator `UNIQUE(logical,shard_index)` race-lock + single-spend leaf UTXO 天然串行·**无需新锁**。
- **🔑 funding-input + custody 决策(J1 纠错后定·= confirm 的真实付款机制)**:
  - **🔴 J1 纠概念(我原写错·实现前救)**: **PoolSide【不是】bettor 付款地址**——它是 register_append **创建的 dust ticket 输出**(value=dust·State{bettorPk,direction,stake,shardPoolId}=spent-once claim 标记)。**没有"付进 PoolSide"这回事**·PoolSide 是产出不是入口。
  - **真实 funding 机制**(pool-register-builder L77): register_append 的 funding input 是 **P2PK wallet UTXO**(`bettorFunding:[{outpointTxid,address}]`·relay finds + wallet-signs)·stake 从这个 P2PK UTXO 折进 leaf。
  - **∴ 正确写法**: **prep 返回一个 P2PK 收款地址**(bettor 的 linked wallet 或 holding P2PK·**shard-无关**·非 PoolSide P2SH) → bettor 付到它 → confirm: 验付款落该 P2PK → allocateForRegister 选当前 open 片 → register_append **用该 P2PK UTXO 作 funding input** 折进 leaf → 插 pool_bettor_sides@实际 shard。§3(shard 在 confirm 选·地址 shard-无关)不变。
  - **🔴 custody 口径(J1 钉·必诚实)**: 谁签 funding P2PK UTXO 定 custody:
    - **现机制 = relay wallet-signs**(relay 持 wallet key)→ **relay-assisted / semi-custodial**(relay 在 fold 时碰 bettor 转入的 P2PK)。**测试网决断建议(J1)**: 用此现成 plumbing·最小改能跑。**口径诚实叫 "relay-assisted" 绝不叫 "0-custody"**。
    - **纯 0-custody = bettor 自签** funding input(需签名 round-trip)= 更难的 **follow-up**(现有 TODO custody-hardening·**别在这 sprint 假装做到**)。
  - **实现锁**: 用 relay-assisted(relay finds+wallet-signs bettor 付的 P2PK)·口径标 relay-assisted·strand-free(allocate-at-confirm)。纯 0-custody 留 follow-up。

## 4. State Machine
```
prep(算 side_p2sh+shard_market_id) → [用户付款] → confirm(链上验付款 → registerBettorOnShard splice → landed → 插 pool_bettor_sides@shard)
  ├─ 付款未到/不足 → pending(同 v06·deadline 前可补)
  ├─ splice tx 未 landed → NOT registered(NO TX NO STATE·不插 DB)
  └─ 满片 → registerBettorOnShard auto-roll 开新片 → 落新片(side_p2sh 一致性见 §3)
```

## 5. bot 路由（console-api.mjs·KANet-UI 配）
- `registerBet` 按 protocol_version 路由: **v0.7 → register-v07/prep+confirm**·其余(v0.5/v0.6 retire 后无新盘·历史盘走旧)→ v06。
- prep 返回 shape 兼容 v06(多 shard_market_id)·bot 渲染"付到 side_p2sh exact_stake_kas"不变。confirm 多传 shard_market_id。

## 6. Retire v0.5/v0.6 押注（Owner 钦定·测试网不迁移）
- 新建盘**只建 v0.7**(create-v07)。v0.5/v0.6 旧满盘: **不迁移·自然过期/retire**(Owner: 测试网不保旧 bet)。
- bot 默认路由 v0.7。旧盘历史 settle 走旧路（不动·避免 6hr 末删还在用的 covenant 路径——J1 钉: 真删代码是收尾清理·先全切 v0.7 路由别急删）。

## 7. 实现 checklist（fresh 会话照此·每步 co-verify）
1. **§3 命门先锁**: J1 确认 side_p2sh 派生 shard-无关(a) 还是 shard-specific(b)。(a)→简单·(b)→prep 锁 shard + confirm 落同片/超时释放。**不锁清不写**。
2. 写 register-v07/prep: 复用 _extStakeValidate + 选 open shard(allocateForRegister 只读挑片) + 算 side_p2sh(按 §3 结论)。返 shard_market_id。
3. 写 register-v07/confirm: 复用 v06/confirm 的链上三验 + 调 registerBettorOnShard(splice·landed gate) + 插 pool_bettor_sides@shard。
4. console-api.mjs registerBet 按 protocol_version 路由(KANet-UI)。
5. **co-verify(J1)**: shard 守恒(Σ shard pool_bettor_sides == Σ 链上 ShardLeaf splice·无 strand/无 double) + auto-roll 正确(满 32 开新片) + side_p2sh 落点一致。
6. **co-verify(Bettor)**: 端到端 bot /bet→prep→付→confirm→落 shard·满 32 再押→自动新片(无 50-cap)·真机验。
7. **守线**: 任何步骤若发现会 strand(付款落空/重复/锚错片) → 停·不 ship。NO TX NO STATE。
8. 灰度: 1 盘押过 32 触发 auto-roll 五源验(像 ZK e2e)·再放量。

## 8. 与既有资产复用（非从零·J1 钉"编排非造新机制"）
- registerBettorOnShard(splice/allocate/auto-roll) 已存在·只差 0-custody 两步包装。
- v06/prep+confirm 的链上三验(付款 dest/amount/UNIQUE) 直接复用。
- getMarketBets shard-aware 读已存在(显示/结算正确)。
- bshard-auto-settler + ZK 执行卡(close+claim) 已 ready·B 落地后任意盘可结算。

## 9. 待 J1 covenant section 合并
J1 section(`.claude-scripts/j2-review/register-v07-prep-confirm-J1-covenant-section.md`·当前在 J1 节点未入 canonical) 覆盖: side_p2sh 派生(§3 命门答案)·ShardLeaf splice covenant 守恒·auto-roll 封片机制·committee/pool_merkle_root 绑定。合并成单 canonical 文档后 fresh 会话照完整版实现。
